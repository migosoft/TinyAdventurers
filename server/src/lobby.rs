//! Lobby: connected accounts, their selected character, open runs (rooms),
//! boss selection, ready and start. The lobby never waits for the database:
//! the socket handler does the queries first and then hands the result in
//! (`set_character`, `apply_progress`), so the lock is only held briefly.

use crate::db::{self, Character, Db};
use crate::defs::attributes::{Attr, Attributes};
use crate::defs::classes;
use crate::defs::items::{self, EquipSlot, Equipment, ItemId};
use crate::defs::loadout::{Build, Loadout, Pick};
use crate::defs::requirements::Requirement;
use crate::defs::abilities::{self, AbilityId};
use crate::sheet::hero_sheet;
use crate::progress::Progress;
use crate::protocol::{encode, BossId, ClassId, ClientMsg, LevelChoice, LevelId, RoomPlayer, RunSummary, ServerMsg};
use crate::run::{run_task, Award, Member, Run, RunCmd, RunRecord};
use crate::telemetry;
use axum::extract::ws::Message;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

pub const MAX_PLAYERS: usize = 4;

pub type SharedLobby = Arc<Mutex<Lobby>>;

pub struct Conn {
    pub account: i32,
    pub tx: UnboundedSender<Message>,
    pub room: Option<u32>,
    pub ready: bool,
    /// The character this connection plays (a cached copy of its database row).
    pub character: Option<Character>,
    /// The debug loadout, if one was set (reset when the character changes, and replaced by a real
    /// `SetLoadout`, which clears it and `debug_loadout`).
    pub loadout: Option<Loadout>,
    /// `loadout` came from `DebugLoadout`, so the run counts as a debug run.
    pub debug_loadout: bool,
    /// The weapons set by `DebugEquip` (the class's starters until then; reset with the character).
    pub debug_equipment: Equipment,
    /// The slots `DebugEquip` touched: only those replace the saved weapons.
    pub debug_touched: [bool; EquipSlot::COUNT],
    /// When it connected (Unix ms), for the admin's online list.
    pub since: f64,
}

/// The Attribute points that lift each Attribute of `class` to the highest Attribute requirement of
/// the build's two picks and its equipped items (debug builds only; proficiency is not lifted).
pub fn debug_lift(class: ClassId, b: &Build) -> Attributes {
    let start = crate::sheet::attrs_without_items(class, b);
    let mut need = [0i32; Attr::COUNT];
    let picks = [b.loadout.primary.ability, b.loadout.secondary.ability];
    let reqs = picks
        .iter()
        .flat_map(|a| abilities::def(*a).req.iter())
        .chain(EquipSlot::ALL.iter().filter_map(|s| b.equipment.get(*s)).flat_map(|i| items::def(i).req.iter()));
    for r in reqs {
        match *r {
            Requirement::Attr(a, n) => need[a as usize] = need[a as usize].max(n),
            Requirement::WeaponKind(_) => {}
        }
    }
    let mut lift = Attributes::default();
    for a in Attr::ALL {
        lift.add(a, (need[a as usize] - start.get(a)).max(0));
    }
    lift
}

fn unix_ms() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0.0, |d| d.as_millis() as f64)
}

pub struct Room {
    pub name: String,
    pub host: u32,
    pub members: Vec<u32>,
    /// End boss chosen by the host, `None` = random.
    pub boss: Option<BossId>,
    /// Always the dungeon until there is a level picker.
    pub level: LevelId,
    pub run_tx: Option<UnboundedSender<RunCmd>>,
}

pub struct Lobby {
    conns: HashMap<u32, Conn>,
    rooms: BTreeMap<u32, Room>,
    next_conn: u32,
    next_room: u32,
    /// `None` in tests: runs then bank nothing.
    db: Option<Db>,
    /// Handle to ourselves, passed to run tasks so they can report back.
    me: Option<SharedLobby>,
}

pub fn new_shared(db: Option<Db>) -> SharedLobby {
    let lobby = Arc::new(Mutex::new(Lobby { conns: HashMap::new(), rooms: BTreeMap::new(), next_conn: 1, next_room: 1, db, me: None }));
    lobby.lock().unwrap().me = Some(lobby.clone());
    lobby
}

fn send(tx: &UnboundedSender<Message>, msg: &ServerMsg) {
    let _ = tx.send(Message::Binary(encode(msg).into()));
}

/// Called by a run task when the dungeon is over: everyone returns to the
/// lobby, then the earned XP and coins are banked on the characters and the
/// run is recorded for the statistics.
pub async fn finish_run(lobby: &SharedLobby, rid: u32, awards: Vec<Award>, record: RunRecord) {
    telemetry::metrics().run_finished(&record);
    let db = {
        let mut l = lobby.lock().unwrap();
        l.run_finished(rid);
        l.db.clone()
    };
    let Some(db) = db else { return };
    if !awards.is_empty() {
        match db::bank_awards(&db, &awards).await {
            Ok(banked) => {
                let mut l = lobby.lock().unwrap();
                for (id, p) in banked {
                    l.apply_progress(id, p);
                }
            }
            Err(e) => tracing::error!("run {rid}: cannot bank awards {awards:?}: {e}"),
        }
    }
    // Statistics only: a failure is logged and never affects the players.
    if let Err(e) = db::record_run(&db, &record).await {
        tracing::error!("run {rid}: cannot record the run: {e}");
    }
}

/// What the lobby holds right now, for the admin dashboard and the gauges.
#[derive(Debug, Clone, Default)]
pub struct Live {
    pub online: u32,
    pub in_run: u32,
    pub rooms_open: u32,
    pub runs_active: u32,
    pub players: Vec<LivePlayer>,
}

#[derive(Debug, Clone)]
pub struct LivePlayer {
    pub account: i32,
    pub character: Option<(String, ClassId)>,
    pub in_run: bool,
    pub since: f64,
}

impl Lobby {
    /// A new connection of a logged-in account. An older connection of the
    /// same account is closed: one account plays in one place only.
    pub fn connect(&mut self, account: i32, tx: UnboundedSender<Message>) -> u32 {
        self.kick_account(account, "You logged in from another window.");
        let id = self.next_conn;
        self.next_conn += 1;
        send(&tx, &ServerMsg::Welcome { id });
        self.conns.insert(id, Conn { account, tx, room: None, ready: false, character: None, loadout: None, debug_loadout: false, debug_equipment: Equipment::default(), debug_touched: [false; EquipSlot::COUNT], since: unix_ms() });
        self.send_lobby_to(id);
        id
    }

    pub fn disconnect(&mut self, id: u32) {
        self.leave_room(id);
        self.conns.remove(&id);
    }

    /// Closes every connection of an account (new login elsewhere, logout,
    /// account deleted).
    pub fn kick_account(&mut self, account: i32, why: &str) {
        let ids: Vec<u32> = self.conns.iter().filter(|(_, c)| c.account == account).map(|(id, _)| *id).collect();
        for id in ids {
            if let Some(c) = self.conns.get(&id) {
                send(&c.tx, &ServerMsg::Error { msg: why.into() });
                let _ = c.tx.send(Message::Close(None));
            }
            self.disconnect(id);
        }
    }

    pub fn live(&self) -> Live {
        let mut players: Vec<LivePlayer> = self
            .conns
            .iter()
            .map(|(id, c)| LivePlayer {
                account: c.account,
                character: c.character.as_ref().map(|ch| (ch.name.clone(), ch.class)),
                in_run: self.in_running_run(*id),
                since: c.since,
            })
            .collect();
        players.sort_by(|a, b| a.since.total_cmp(&b.since));
        let runs_active = self.rooms.values().filter(|r| r.run_tx.is_some()).count() as u32;
        Live {
            online: players.len() as u32,
            in_run: players.iter().filter(|p| p.in_run).count() as u32,
            rooms_open: self.rooms.len() as u32 - runs_active,
            runs_active,
            players,
        }
    }

    /// Accounts online and the characters they play right now.
    pub fn online_ids(&self) -> (HashSet<i32>, HashSet<i32>) {
        let accounts = self.conns.values().map(|c| c.account).collect();
        let characters = self.conns.values().filter_map(|c| c.character.as_ref().map(|ch| ch.id)).collect();
        (accounts, characters)
    }

    /// The account playing this character right now, if any.
    pub fn character_owner(&self, character: i32) -> Option<i32> {
        self.conns.values().find(|c| c.character.as_ref().map_or(false, |ch| ch.id == character)).map(|c| c.account)
    }

    pub fn account_of(&self, id: u32) -> Option<i32> {
        self.conns.get(&id).map(|c| c.account)
    }

    /// The running dungeon this connection is in, for routing gameplay input.
    pub fn run_of(&self, id: u32) -> Option<UnboundedSender<RunCmd>> {
        let room = self.conns.get(&id)?.room?;
        self.rooms.get(&room)?.run_tx.clone()
    }

    fn in_running_run(&self, id: u32) -> bool {
        self.conns.get(&id).and_then(|c| c.room).and_then(|r| self.rooms.get(&r)).map_or(false, |r| r.run_tx.is_some())
    }

    /// Characters can only be switched outside of rooms.
    pub fn can_select(&self, id: u32) -> Result<i32, &'static str> {
        let c = self.conns.get(&id).ok_or("Not connected.")?;
        if c.room.is_some() {
            return Err("Leave the dungeon first.");
        }
        Ok(c.account)
    }

    pub fn set_character(&mut self, id: u32, character: Character) {
        if let Err(e) = self.can_select(id) {
            return self.error(id, e);
        }
        let Some(c) = self.conns.get_mut(&id) else { return };
        if c.account != character.account_id {
            return;
        }
        let info = character.info();
        let character_class = character.class;
        c.character = Some(character);
        c.loadout = None;
        c.debug_loadout = false;
        c.debug_equipment = Equipment::starter(character_class);
        c.debug_touched = [false; EquipSlot::COUNT];
        send(&c.tx, &ServerMsg::Character(info));
    }

    /// The character whose build may change now (buy, respec, equip, loadout, grant): not during a
    /// run (Ruling 8) and not while ready. Returns its id and class.
    pub fn can_change(&self, id: u32) -> Result<(i32, ClassId), &'static str> {
        let c = self.conns.get(&id).ok_or("Not connected.")?;
        let ch = c.character.as_ref().ok_or("Choose a character first.")?;
        if self.in_running_run(id) {
            return Err("Not during a run.");
        }
        if c.ready {
            return Err("Not while ready.");
        }
        Ok((ch.id, ch.class))
    }

    /// New progress of a character, fresh from the database. Older results
    /// arriving late (`rev`) are ignored.
    pub fn apply_progress(&mut self, character: i32, p: Progress) {
        let mut changed: Vec<Option<u32>> = Vec::new();
        for c in self.conns.values_mut() {
            if let Some(ch) = c.character.as_mut().filter(|ch| ch.id == character && p.rev > ch.progress.rev) {
                // A real `SetLoadout` replaces the debug picks; debug weapon overrides stay (`debug_touched`).
                // The debug flag goes too when no weapon override keeps it meaningful.
                if ch.progress.loadout != p.loadout {
                    c.loadout = None;
                    if !c.debug_touched.iter().any(|t| *t) {
                        c.debug_loadout = false;
                    }
                }
                ch.progress = p.clone();
                send(&c.tx, &ServerMsg::Character(ch.info()));
                changed.push(c.room);
            }
        }
        // The party lists show the saved builds.
        changed.sort();
        changed.dedup();
        for rid in changed.into_iter().flatten() {
            self.send_room(rid);
        }
    }

    /// Is this character in a room right now (then it must not be deleted)?
    pub fn character_busy(&self, character: i32) -> bool {
        self.conns.values().any(|c| c.room.is_some() && c.character.as_ref().map_or(false, |ch| ch.id == character))
    }

    pub fn forget_character(&mut self, character: i32) {
        for c in self.conns.values_mut() {
            if c.character.as_ref().map_or(false, |ch| ch.id == character) {
                c.character = None;
            }
        }
    }

    pub fn handle(&mut self, id: u32, msg: ClientMsg) {
        if !self.conns.contains_key(&id) {
            return; // closed (logged in elsewhere) but the socket has not ended yet
        }
        match msg {
            ClientMsg::CreateRun { name } => {
                if !self.has_character(id) {
                    return;
                }
                self.leave_room(id);
                let rid = self.next_room;
                self.next_room += 1;
                let name: String = name.trim().chars().filter(|c| !c.is_control()).take(24).collect();
                let name = if name.is_empty() { format!("Dungeon #{rid}") } else { name };
                self.rooms.insert(rid, Room { name, host: id, members: vec![id], boss: None, level: LevelId::Dungeon, run_tx: None });
                if let Some(c) = self.conns.get_mut(&id) {
                    c.room = Some(rid);
                    c.ready = false;
                }
                self.send_room(rid);
                self.broadcast_lobby();
            }
            ClientMsg::JoinRun { run_id } => {
                if !self.has_character(id) {
                    return;
                }
                let ok = self.rooms.get(&run_id).map_or(false, |r| r.run_tx.is_none() && r.members.len() < MAX_PLAYERS);
                if !ok {
                    self.error(id, "That dungeon is full or has already started.");
                    return;
                }
                self.leave_room(id);
                self.rooms.get_mut(&run_id).unwrap().members.push(id);
                if let Some(c) = self.conns.get_mut(&id) {
                    c.room = Some(run_id);
                    c.ready = false;
                }
                self.send_room(run_id);
                self.broadcast_lobby();
            }
            ClientMsg::LeaveRun => {
                self.leave_room(id);
                self.send_lobby_to(id);
            }
            ClientMsg::SetReady { ready } => {
                if ready {
                    if let Err(e) = self.check_build(id) {
                        return self.error(id, &e);
                    }
                }
                if let Some(c) = self.conns.get_mut(&id) {
                    c.ready = ready;
                }
                self.send_room_of(id);
            }
            ClientMsg::SelectBoss { boss } => {
                let Some(rid) = self.conns.get(&id).and_then(|c| c.room) else { return };
                if let Some(room) = self.rooms.get_mut(&rid).filter(|r| r.host == id && r.run_tx.is_none()) {
                    room.boss = boss;
                    self.send_room(rid);
                }
            }
            ClientMsg::StartRun => self.start(id),
            ClientMsg::DebugLoadout { primary, secondary } => self.debug_loadout_if(crate::run::debug::allowed(), id, primary, secondary),
            ClientMsg::DebugEquip { slot, item } => self.debug_equip_if(crate::run::debug::allowed(), id, slot, item),
            _ => {}
        }
    }

    fn has_character(&self, id: u32) -> bool {
        let ok = self.conns.get(&id).map_or(false, |c| c.character.is_some());
        if !ok {
            self.error(id, "Choose a character first.");
        }
        ok
    }

    pub fn error(&self, id: u32, msg: &str) {
        if let Some(c) = self.conns.get(&id) {
            send(&c.tx, &ServerMsg::Error { msg: msg.into() });
        }
    }

    /// Debug: set any ability of the character's class in the two slots. It skips the
    /// "unlocked" check only; `hero_sheet` still checks Attributes and weapons on Ready and Start.
    fn debug_loadout_if(&mut self, allowed: bool, id: u32, primary: Pick, secondary: Pick) {
        if !self.debug_allowed(allowed, id) {
            return;
        }
        if let Some(c) = self.conns.get_mut(&id) {
            c.loadout = Some(Loadout { primary, secondary });
            c.debug_loadout = true;
        }
    }

    /// Debug: put a weapon in the Melee or Ranged slot (`None` = the class starter of that slot, which for Ranged is no weapon unless the class has one).
    /// Same guards as `debug_loadout_if`; `hero_sheet` still checks proficiency on Ready and Start.
    fn debug_equip_if(&mut self, allowed: bool, id: u32, slot: EquipSlot, item: Option<ItemId>) {
        if !self.debug_allowed(allowed, id) {
            return;
        }
        match slot {
            EquipSlot::Melee | EquipSlot::Ranged => {}
            EquipSlot::OffHand | EquipSlot::Armor | EquipSlot::Ring1 | EquipSlot::Ring2 | EquipSlot::Shoes | EquipSlot::Belt => {
                return self.error(id, "Only weapons.");
            }
        }
        if let Some(c) = self.conns.get_mut(&id) {
            c.debug_equipment.set(slot, item);
            c.debug_touched[slot as usize] = true;
            c.debug_loadout = true;
        }
    }

    /// The guards every debug waiting-room message shares; sends the error and returns false when refused.
    fn debug_allowed(&self, allowed: bool, id: u32) -> bool {
        if !allowed {
            self.error(id, "Debug is off.");
            return false;
        }
        let Some(c) = self.conns.get(&id) else { return false };
        let Some(room) = c.room.and_then(|r| self.rooms.get(&r)) else {
            self.error(id, "Join a dungeon first.");
            return false;
        };
        let msg = if room.run_tx.is_some() {
            "Not during a run."
        } else if c.ready {
            "Not while ready."
        } else if c.character.is_none() {
            "Choose a character first."
        } else {
            return true;
        };
        self.error(id, msg);
        false
    }

    /// The character's saved build, with this connection's debug picks and pool on top.
    fn build_of(&self, id: u32) -> Option<Build> {
        let c = self.conns.get(&id)?;
        let ch = c.character.as_ref()?;
        let mut build = ch.progress.build(ch.class);
        if let Some(l) = c.loadout {
            build.loadout = l;
        }
        if c.debug_loadout {
            build.own = AbilityId::ALL.iter().copied().filter(|a| abilities::def(*a).classes.contains(&ch.class)).collect();
            // Only the weapon slots `DebugEquip` touched change; the rest stays as saved.
            for s in [EquipSlot::Melee, EquipSlot::Ranged] {
                if c.debug_touched[s as usize] {
                    build.equipment.set(s, c.debug_equipment.get(s));
                }
            }
            // The bought points stay; the lift counts them.
            build.extra = build.extra.plus(debug_lift(ch.class, &build));
        }
        Some(build)
    }

    /// Does this connection's hero pass `hero_sheet`? The message names what is wrong.
    fn check_build(&self, id: u32) -> Result<(), String> {
        let c = self.conns.get(&id).ok_or("Not connected.")?;
        let ch = c.character.as_ref().ok_or("Choose a character first.")?;
        let build = self.build_of(id).ok_or("Choose a character first.")?;
        hero_sheet(ch.class, &build).map(|_| ()).map_err(|e| e.message())
    }

    /// The room's heroes, or `None` when the room is gone.
    fn members_of(&self, rid: u32) -> Option<Vec<Member>> {
        let room = self.rooms.get(&rid)?;
        Some(
            room.members
                .iter()
                .filter_map(|m| {
                    let c = self.conns.get(m)?;
                    let ch = c.character.as_ref()?;
                    Some(Member { conn: *m, name: ch.name.clone(), class: ch.class, tx: c.tx.clone(), account: Some(c.account), character: Some(ch.id), build: self.build_of(*m)?, debug_loadout: c.debug_loadout })
                })
                .collect(),
        )
    }

    fn start(&mut self, id: u32) {
        let Some(rid) = self.conns.get(&id).and_then(|c| c.room) else { return };
        let Some(room) = self.rooms.get(&rid) else { return };
        if room.host != id || room.run_tx.is_some() {
            return;
        }
        let not_ready = room.members.iter().any(|m| *m != id && !self.conns.get(m).map_or(false, |c| c.ready));
        if not_ready {
            self.error(id, "Not everyone is ready yet.");
            return;
        }
        // The Ready check can be stale (a character changed since), so check everyone again.
        for m in &room.members {
            if let Err(e) = self.check_build(*m) {
                let who = if *m == id { e } else { format!("{}: {e}", self.conns.get(m).and_then(|c| c.character.as_ref()).map_or("A player", |ch| ch.name.as_str())) };
                self.error(id, &who);
                return;
            }
        }
        let Some(members) = self.members_of(rid) else { return };
        let seed: u64 = rand::random();
        let choice = match room.level {
            LevelId::Dungeon => LevelChoice::Dungeon { boss: room.boss },
        };
        let boss = room.boss;
        let run = Run::new(rid, members, seed, choice);
        tracing::info!("run {rid} started: {} player(s), {:?} boss {:?}{}", run.players.len(), run.level.id(), run.level.boss_id(), if boss.is_some() { " (chosen)" } else { "" });
        let (tx, rx) = unbounded_channel();
        self.rooms.get_mut(&rid).unwrap().run_tx = Some(tx);
        let lobby = self.me.clone().expect("lobby handle");
        tokio::spawn(run_task(run, rx, lobby));
        self.broadcast_lobby();
    }

    /// The run is over: its room closes and the members return to the lobby.
    fn run_finished(&mut self, rid: u32) {
        if let Some(room) = self.rooms.remove(&rid) {
            for m in room.members {
                if let Some(c) = self.conns.get_mut(&m) {
                    c.room = None;
                    c.ready = false;
                }
            }
        }
        self.broadcast_lobby();
    }

    fn leave_room(&mut self, id: u32) {
        let Some(rid) = self.conns.get(&id).and_then(|c| c.room) else { return };
        if let Some(c) = self.conns.get_mut(&id) {
            c.room = None;
            c.ready = false;
        }
        let mut remove = false;
        if let Some(room) = self.rooms.get_mut(&rid) {
            room.members.retain(|m| *m != id);
            if let Some(tx) = &room.run_tx {
                let _ = tx.send(RunCmd::Leave { conn: id });
            }
            if room.members.is_empty() {
                remove = room.run_tx.is_none();
            } else if room.host == id {
                room.host = room.members[0];
            }
        }
        if remove {
            self.rooms.remove(&rid);
        } else {
            self.send_room(rid);
        }
        self.broadcast_lobby();
    }

    fn summaries(&self) -> Vec<RunSummary> {
        self.rooms
            .iter()
            .map(|(id, r)| RunSummary {
                id: *id,
                name: r.name.clone(),
                players: r.members.len() as u8,
                max_players: MAX_PLAYERS as u8,
                started: r.run_tx.is_some(),
            })
            .collect()
    }

    fn send_lobby_to(&self, id: u32) {
        if let Some(c) = self.conns.get(&id) {
            send(&c.tx, &ServerMsg::Lobby { runs: self.summaries() });
        }
    }

    fn broadcast_lobby(&self) {
        let msg = ServerMsg::Lobby { runs: self.summaries() };
        for c in self.conns.values().filter(|c| c.room.is_none()) {
            send(&c.tx, &msg);
        }
    }

    fn send_room_of(&self, id: u32) {
        if let Some(rid) = self.conns.get(&id).and_then(|c| c.room) {
            self.send_room(rid);
        }
    }

    fn send_room(&self, rid: u32) {
        let Some(room) = self.rooms.get(&rid) else { return };
        if room.run_tx.is_some() {
            return;
        }
        let players: Vec<RoomPlayer> = room
            .members
            .iter()
            .filter_map(|m| {
                let c = self.conns.get(m)?;
                let ch = c.character.as_ref()?;
                let build = self.build_of(*m)?;
                let weapons = [EquipSlot::Melee, EquipSlot::Ranged]
                    .into_iter()
                    .filter_map(|s| match s {
                        EquipSlot::Melee => Some(build.equipment.get(s).unwrap_or(classes::def(ch.class).starter.0)),
                        _ => build.equipment.get(s),
                    })
                    .collect();
                Some(RoomPlayer { id: *m, name: ch.name.clone(), class: ch.class, ready: c.ready, loadout: build.loadout, weapons })
            })
            .collect();
        let msg = ServerMsg::Room { run_id: rid, name: room.name.clone(), host: room.host, players, level: room.level, boss: room.boss };
        for m in &room.members {
            if let Some(c) = self.conns.get(m) {
                send(&c.tx, &msg);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::attributes::Attr;
    use crate::defs::abilities::AbilityId;
    use crate::defs::loadout::{Loadout, Pick, Source};
    use crate::protocol::ClassId;

    fn character(account: i32, id: i32, class: ClassId) -> Character {
        Character { id, account_id: account, name: format!("hero{id}"), class, progress: Progress::new(class) }
    }

    fn test_record(account: i32, character: i32) -> RunRecord {
        use crate::run::{Outcome, RunPlayerRecord};
        RunRecord {
            level: LevelId::Dungeon,
            boss: Some(BossId::Dragon),
            outcome: Outcome::Victory,
            duration_s: 300.0,
            debug: false,
            players: vec![RunPlayerRecord { account: Some(account), character: Some(character), class: ClassId::Wizard, kills: 12, damage: 900.0, healing: 0.0, xp: 120, coins: 7, survived: true, left: false }],
        }
    }

    #[tokio::test]
    async fn live_counts_players_rooms_and_runs() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let a = join(&mut l, 1, ClassId::Wizard);
        let b = join(&mut l, 2, ClassId::Paladin);
        let (tx, rx) = unbounded_channel();
        std::mem::forget(rx);
        l.connect(3, tx); // no character yet
        l.handle(a, ClientMsg::CreateRun { name: "running".into() });
        l.handle(a, ClientMsg::StartRun);
        l.handle(b, ClientMsg::CreateRun { name: "waiting".into() });

        let live = l.live();
        assert_eq!((live.online, live.in_run, live.rooms_open, live.runs_active), (3, 1, 1, 1));
        let pa = live.players.iter().find(|p| p.account == 1).unwrap();
        assert!(pa.in_run);
        assert_eq!(pa.character, Some(("hero10".to_string(), ClassId::Wizard)));
        assert!(live.players.iter().find(|p| p.account == 3).unwrap().character.is_none());
        let (accounts, characters) = l.online_ids();
        assert_eq!(accounts.len(), 3);
        assert!(characters.contains(&10) && characters.contains(&20));
        assert_eq!(l.character_owner(20), Some(2));
        assert_eq!(l.character_owner(99), None);
    }

    /// Connects `account` and selects a character for it; returns the connection id.
    fn join(l: &mut Lobby, account: i32, class: ClassId) -> u32 {
        let (tx, rx) = unbounded_channel();
        std::mem::forget(rx);
        let id = l.connect(account, tx);
        l.set_character(id, character(account, account * 10, class));
        id
    }

    #[tokio::test]
    async fn only_the_host_chooses_the_boss_before_the_run() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let host = join(&mut l, 1, ClassId::Wizard);
        let guest = join(&mut l, 2, ClassId::Paladin);
        l.handle(host, ClientMsg::CreateRun { name: "r".into() });
        let rid = l.conns[&host].room.unwrap();
        l.handle(guest, ClientMsg::JoinRun { run_id: rid });
        assert_eq!(l.rooms[&rid].boss, None, "random by default");

        l.handle(guest, ClientMsg::SelectBoss { boss: Some(BossId::Dragon) });
        assert_eq!(l.rooms[&rid].boss, None, "guest cannot choose");
        l.handle(host, ClientMsg::SelectBoss { boss: Some(BossId::Lich) });
        assert_eq!(l.rooms[&rid].boss, Some(BossId::Lich));

        l.handle(guest, ClientMsg::SetReady { ready: true });
        l.handle(host, ClientMsg::StartRun);
        assert!(l.rooms[&rid].run_tx.is_some(), "run started");
        l.handle(host, ClientMsg::SelectBoss { boss: Some(BossId::Demon) });
        assert_eq!(l.rooms[&rid].boss, Some(BossId::Lich), "fixed once started");
        assert!(l.character_busy(10) && l.character_busy(20));
    }

    #[tokio::test]
    async fn rooms_need_a_character_and_characters_switch_outside_rooms_only() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let (tx, rx) = unbounded_channel();
        std::mem::forget(rx);
        let id = l.connect(1, tx);
        l.handle(id, ClientMsg::CreateRun { name: "r".into() });
        assert!(l.rooms.is_empty(), "no character, no room");

        l.set_character(id, character(2, 99, ClassId::Wizard));
        assert!(l.conns[&id].character.is_none(), "someone else's character");
        l.set_character(id, character(1, 10, ClassId::Barbarian));
        l.handle(id, ClientMsg::CreateRun { name: "r".into() });
        assert!(l.can_select(id).is_err(), "in a room");
        l.set_character(id, character(1, 11, ClassId::ElvenRanger));
        assert_eq!(l.conns[&id].character.as_ref().unwrap().id, 10);
        l.handle(id, ClientMsg::LeaveRun);
        assert!(l.can_select(id).is_ok());
    }

    #[tokio::test]
    async fn build_changes_are_refused_in_a_run_and_while_ready() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let (tx, rx) = unbounded_channel();
        std::mem::forget(rx);
        let none = l.connect(5, tx);
        assert_eq!(l.can_change(none), Err("Choose a character first."));
        let id = join(&mut l, 1, ClassId::Wizard);
        assert_eq!(l.can_change(id), Ok((10, ClassId::Wizard)), "the lobby is fine");
        l.handle(id, ClientMsg::CreateRun { name: "r".into() });
        assert_eq!(l.can_change(id), Ok((10, ClassId::Wizard)), "waiting room is fine");
        l.handle(id, ClientMsg::SetReady { ready: true });
        assert_eq!(l.can_change(id), Err("Not while ready."));
        l.handle(id, ClientMsg::SetReady { ready: false });
        l.handle(id, ClientMsg::StartRun);
        assert_eq!(l.can_change(id), Err("Not during a run."));
        let rid = l.conns[&id].room.unwrap();
        l.run_finished(rid);
        assert_eq!(l.can_change(id), Ok((10, ClassId::Wizard)));

        let mut newer = Progress::new(ClassId::Wizard);
        newer.bank(500, 0);
        newer.buy_attr(ClassId::Wizard, Attr::Int).unwrap();
        newer.rev = 3;
        let mut older = Progress::new(ClassId::Wizard);
        older.rev = 2;
        l.apply_progress(10, newer.clone());
        l.apply_progress(10, older);
        l.apply_progress(77, Progress { rev: 9, xp: 1, ..Progress::new(ClassId::Wizard) });
        assert_eq!(l.conns[&id].character.as_ref().unwrap().progress, newer);
    }

    /// Needs PostgreSQL (`DATABASE_URL`), see `db::tests`.
    #[tokio::test]
    async fn a_finished_run_banks_on_the_played_character_only() {
        let Some(db) = db::tests::test_db().await else { return };
        let a = db::create_account(&db, "Banker", "h").await.unwrap();
        let played = db::create_character(&db, a, "Played", ClassId::Wizard).await.unwrap();
        let idle = db::create_character(&db, a, "Idle", ClassId::Paladin).await.unwrap();
        let shared = new_shared(Some(db.clone()));
        let (rid, id) = {
            let mut l = shared.lock().unwrap();
            let (tx, rx) = unbounded_channel();
            std::mem::forget(rx);
            let id = l.connect(a, tx);
            l.set_character(id, played.clone());
            l.handle(id, ClientMsg::CreateRun { name: "r".into() });
            (l.conns[&id].room.unwrap(), id)
        };
        finish_run(&shared, rid, vec![Award { character: played.id, xp: 120, coins: 7 }], test_record(a, played.id)).await;
        {
            let l = shared.lock().unwrap();
            assert!(l.conns[&id].room.is_none(), "back in the lobby");
            let cached = &l.conns[&id].character.as_ref().unwrap().progress;
            assert_eq!((cached.xp, cached.coins), (120, 7), "cached copy refreshed");
        }
        let stored = db::load_character(&db, a, played.id).await.unwrap().unwrap().progress;
        assert_eq!((stored.xp, stored.total_xp, stored.coins), (120, 120, 7));
        assert_eq!(db::load_character(&db, a, idle.id).await.unwrap().unwrap().progress, Progress::new(ClassId::Paladin));
        let recorded: (String, Option<String>, String, i32) = sqlx::query_as("SELECT r.level, r.boss, r.outcome, p.kills FROM runs r JOIN run_players p ON p.run_id = r.id WHERE p.character_id = $1")
            .bind(played.id)
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(recorded, ("Dungeon".to_string(), Some("Dragon".to_string()), "victory".to_string(), 12), "the run is recorded for the statistics");
    }

    #[tokio::test]
    async fn a_second_login_closes_the_first_connection() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let first = join(&mut l, 1, ClassId::Wizard);
        l.handle(first, ClientMsg::CreateRun { name: "r".into() });
        let second = join(&mut l, 1, ClassId::Wizard);
        assert!(!l.conns.contains_key(&first));
        assert!(l.rooms.is_empty(), "its room closed with it");
        l.handle(first, ClientMsg::CreateRun { name: "late".into() });
        assert!(l.rooms.is_empty(), "messages of the closed connection are ignored");
        assert_eq!(l.account_of(second), Some(1));
        l.kick_account(1, "bye");
        assert!(l.conns.is_empty());
    }

    fn pick(ability: AbilityId) -> Pick {
        Pick { ability, source: Source::Own }
    }

    /// The server messages a connection received, errors only.
    fn errors(rx: &mut tokio::sync::mpsc::UnboundedReceiver<Message>) -> Vec<String> {
        let mut out = Vec::new();
        while let Ok(m) = rx.try_recv() {
            if let Message::Binary(b) = m {
                if let Ok(v) = rmp_serde::from_slice::<serde_json::Value>(&b) {
                    if v["t"] == "Error" {
                        out.push(v["msg"].as_str().unwrap_or_default().to_string());
                    }
                }
            }
        }
        out
    }

    #[tokio::test]
    async fn debug_loadout_is_refused_when_it_must_be() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let a = join(&mut l, 1, ClassId::Barbarian);
        let (p, s) = (pick(AbilityId::Strike), pick(AbilityId::Charge));

        l.debug_loadout_if(true, a, p, s); // outside a room
        assert!(!l.conns[&a].debug_loadout && l.conns[&a].loadout.is_none());

        l.handle(a, ClientMsg::CreateRun { name: "r".into() });
        l.debug_loadout_if(false, a, p, s); // debug off
        assert!(l.conns[&a].loadout.is_none());

        l.handle(a, ClientMsg::SetReady { ready: true });
        l.debug_loadout_if(true, a, p, s); // ready
        assert!(l.conns[&a].loadout.is_none());

        l.handle(a, ClientMsg::SetReady { ready: false });
        l.debug_loadout_if(true, a, p, s);
        assert_eq!(l.conns[&a].loadout, Some(Loadout { primary: p, secondary: s }));
        assert!(l.conns[&a].debug_loadout);
    }

    #[tokio::test]
    async fn a_debug_loadout_reaches_the_run() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let a = join(&mut l, 1, ClassId::Barbarian);
        l.handle(a, ClientMsg::CreateRun { name: "r".into() });
        l.debug_loadout_if(true, a, pick(AbilityId::Strike), pick(AbilityId::Charge));
        let rid = l.conns[&a].room.unwrap();
        let members = l.members_of(rid).unwrap();
        assert!(members[0].debug_loadout);
        let run = Run::new(rid, members, 7, LevelChoice::Dungeon { boss: None });
        assert_eq!(run.players[0].sheet.secondary.id, AbilityId::Charge);
        assert!(run.debug_used);
    }

    #[tokio::test]
    async fn a_new_character_resets_the_debug_loadout() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let a = join(&mut l, 1, ClassId::Barbarian);
        l.handle(a, ClientMsg::CreateRun { name: "r".into() });
        l.debug_loadout_if(true, a, pick(AbilityId::Strike), pick(AbilityId::Charge));
        l.handle(a, ClientMsg::LeaveRun);
        l.set_character(a, character(1, 11, ClassId::Wizard));
        assert!(l.conns[&a].loadout.is_none() && !l.conns[&a].debug_loadout);
    }

    #[tokio::test]
    async fn ready_and_start_refuse_an_invalid_loadout() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let host = join(&mut l, 1, ClassId::Wizard);
        let (tx, mut host_rx) = unbounded_channel();
        l.conns.get_mut(&host).unwrap().tx = tx;
        let guest = join(&mut l, 2, ClassId::Wizard);
        let (tx, mut guest_rx) = unbounded_channel();
        l.conns.get_mut(&guest).unwrap().tx = tx;
        l.handle(host, ClientMsg::CreateRun { name: "r".into() });
        let rid = l.conns[&host].room.unwrap();
        l.handle(guest, ClientMsg::JoinRun { run_id: rid });
        errors(&mut guest_rx);
        errors(&mut host_rx);

        l.debug_loadout_if(true, guest, pick(AbilityId::Fireball), pick(AbilityId::MagicMissile));
        l.handle(guest, ClientMsg::SetReady { ready: true });
        assert!(!l.conns[&guest].ready);
        let e = errors(&mut guest_rx);
        assert!(e.iter().any(|m| m.contains("Fireball")), "{e:?}");

        // A valid one is accepted.
        l.debug_loadout_if(true, guest, pick(AbilityId::MagicMissile), pick(AbilityId::Fireball));
        l.handle(guest, ClientMsg::SetReady { ready: true });
        assert!(l.conns[&guest].ready);

        l.debug_loadout_if(true, host, pick(AbilityId::Fireball), pick(AbilityId::MagicMissile));
        l.handle(host, ClientMsg::StartRun);
        assert!(l.rooms[&rid].run_tx.is_none(), "no run");
        let e = errors(&mut host_rx);
        assert!(e.iter().any(|m| m.contains("Fireball")), "{e:?}");
    }

    #[tokio::test]
    async fn debug_equip_sets_a_weapon() {
        use crate::defs::items::{EquipSlot, ItemId};
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let a = join(&mut l, 1, ClassId::Barbarian);
        l.handle(a, ClientMsg::CreateRun { name: "r".into() });
        l.debug_equip_if(true, a, EquipSlot::Ranged, Some(ItemId::ThrowingAxes));
        l.debug_loadout_if(true, a, pick(AbilityId::Hurl), pick(AbilityId::Charge));
        l.handle(a, ClientMsg::SetReady { ready: true });
        assert!(l.conns[&a].ready, "Hurl with Throwing Axes passes the sheet");
        let rid = l.conns[&a].room.unwrap();
        let members = l.members_of(rid).unwrap();
        let run = Run::new(rid, members, 7, LevelChoice::Dungeon { boss: None });
        let sheet = &run.players[0].sheet;
        assert_eq!(sheet.primary.id, AbilityId::Hurl);
        assert_eq!(sheet.primary.projectile, Some(crate::defs::kinds::EntityKind::ThrownAxe as u8));
    }

    #[tokio::test]
    async fn debug_equip_is_refused_during_a_run_and_while_ready() {
        use crate::defs::items::{EquipSlot, ItemId};
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let (tx, mut rx) = unbounded_channel();
        let a = join(&mut l, 1, ClassId::Barbarian);
        l.conns.get_mut(&a).unwrap().tx = tx;
        let axes = Some(ItemId::ThrowingAxes);
        let slot = EquipSlot::Ranged;
        let none = |l: &Lobby| l.conns[&a].debug_equipment == Equipment::starter(ClassId::Barbarian) && !l.conns[&a].debug_loadout;

        l.debug_equip_if(true, a, slot, axes);
        assert_eq!(errors(&mut rx), ["Join a dungeon first."]);
        l.handle(a, ClientMsg::CreateRun { name: "r".into() });
        l.debug_equip_if(false, a, slot, axes);
        assert_eq!(errors(&mut rx), ["Debug is off."]);
        l.debug_equip_if(false, a, EquipSlot::Armor, None);
        assert_eq!(errors(&mut rx), ["Debug is off."], "the guards come before Only weapons");
        l.debug_equip_if(true, a, EquipSlot::Armor, Some(ItemId::PlateArmor));
        assert_eq!(errors(&mut rx), ["Only weapons."]);
        l.handle(a, ClientMsg::SetReady { ready: true });
        errors(&mut rx);
        l.debug_equip_if(true, a, slot, axes);
        assert_eq!(errors(&mut rx), ["Not while ready."]);
        l.handle(a, ClientMsg::SetReady { ready: false });
        l.forget_character(10);
        l.debug_equip_if(true, a, slot, axes);
        assert_eq!(errors(&mut rx), ["Choose a character first."]);
        assert!(none(&l));
        l.conns.get_mut(&a).unwrap().character = Some(character(1, 10, ClassId::Barbarian));
        let rid = l.conns[&a].room.unwrap();
        l.rooms.get_mut(&rid).unwrap().run_tx = Some(unbounded_channel().0);
        l.debug_equip_if(true, a, slot, axes);
        assert_eq!(errors(&mut rx), ["Not during a run."]);
        assert!(none(&l));
    }

    #[tokio::test]
    async fn debug_lift_only_for_debug_builds() {
        use crate::defs::attributes::Attr;
        use crate::defs::classes::start_attrs;
        use crate::defs::items::{EquipSlot, ItemId};
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let a = join(&mut l, 1, ClassId::Barbarian);
        l.handle(a, ClientMsg::CreateRun { name: "r".into() });
        assert_eq!(l.build_of(a).unwrap().extra, Attributes::default());
        l.debug_equip_if(true, a, EquipSlot::Melee, Some(ItemId::WarHammer));
        l.debug_loadout_if(true, a, pick(AbilityId::Strike), pick(AbilityId::GroundSlam));
        let b = l.build_of(a).unwrap();
        assert_eq!(start_attrs(ClassId::Barbarian).plus(b.extra).get(Attr::Str), 17);
        assert!(hero_sheet(ClassId::Barbarian, &b).is_ok());
        // A new character drops the debug picks and the lift with them.
        l.handle(a, ClientMsg::LeaveRun);
        l.set_character(a, character(1, 11, ClassId::Barbarian));
        l.handle(a, ClientMsg::CreateRun { name: "r2".into() });
        assert_eq!(l.build_of(a).unwrap().extra, Attributes::default());
        assert_eq!(l.build_of(a).unwrap().equipment, Equipment::starter(ClassId::Barbarian));
    }

    #[test]
    fn the_lift_meets_both_picks() {
        use crate::defs::attributes::Attr;
        use crate::defs::classes::start_attrs;
        let mut b = Build::start(ClassId::Wizard);
        b.loadout = Loadout { primary: pick(AbilityId::ChainSpark), secondary: pick(AbilityId::Haste) };
        let got = start_attrs(ClassId::Wizard).plus(debug_lift(ClassId::Wizard, &b));
        let start = start_attrs(ClassId::Wizard);
        assert_eq!(got.get(Attr::Int), 18);
        assert_eq!(got.get(Attr::Wil), 14);
        for a in [Attr::Str, Attr::Dex, Attr::Con, Attr::Cha] {
            assert_eq!(got.get(a), start.get(a), "{a:?}");
        }
    }

    #[tokio::test]
    async fn debug_equip_none_clears_the_slot() {
        use crate::defs::items::{EquipSlot, ItemId};
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let (tx, mut rx) = unbounded_channel();
        let a = join(&mut l, 1, ClassId::ElvenRanger);
        l.conns.get_mut(&a).unwrap().tx = tx;
        l.handle(a, ClientMsg::CreateRun { name: "r".into() });
        assert_eq!(l.conns[&a].debug_equipment.get(EquipSlot::Ranged), Some(ItemId::ElvenBow));
        l.debug_equip_if(true, a, EquipSlot::Ranged, None);
        assert_eq!(l.conns[&a].debug_equipment.get(EquipSlot::Ranged), None);
        // Shoot needs the ranged weapon, so the Ranger without a bow is refused at Ready.
        l.debug_loadout_if(true, a, pick(AbilityId::Shoot), pick(AbilityId::SummonWolf));
        l.handle(a, ClientMsg::SetReady { ready: true });
        assert!(!l.conns[&a].ready);
        let e = errors(&mut rx);
        assert!(e.iter().any(|m| m.contains("Shoot") && m.contains("ranged")), "{e:?}");
        // Putting the bow back is allowed.
        l.debug_equip_if(true, a, EquipSlot::Ranged, Some(ItemId::ElvenBow));
        l.handle(a, ClientMsg::SetReady { ready: true });
        assert!(l.conns[&a].ready);
    }

    fn character_with(account: i32, id: i32, class: ClassId, progress: Progress) -> Character {
        Character { id, account_id: account, name: format!("hero{id}"), class, progress }
    }

    /// Connects `account` with a character holding `progress`; returns the connection id and its receiver.
    fn join_with(l: &mut Lobby, account: i32, class: ClassId, progress: Progress) -> (u32, tokio::sync::mpsc::UnboundedReceiver<Message>) {
        let (tx, rx) = unbounded_channel();
        let id = l.connect(account, tx);
        l.set_character(id, character_with(account, account * 10, class, progress));
        (id, rx)
    }

    /// The last server message of type `t`, as JSON.
    fn last(rx: &mut tokio::sync::mpsc::UnboundedReceiver<Message>, t: &str) -> Option<serde_json::Value> {
        let mut found = None;
        while let Ok(m) = rx.try_recv() {
            if let Message::Binary(b) = m {
                if let Ok(v) = rmp_serde::from_slice::<serde_json::Value>(&b) {
                    if v["t"] == t {
                        found = Some(v);
                    }
                }
            }
        }
        found
    }

    fn frost_shard_progress(nodes: Vec<crate::defs::trees::NodeId>) -> Progress {
        let mut p = Progress::new(ClassId::Wizard);
        p.nodes = nodes;
        p.loadout.primary = pick(AbilityId::FrostShard);
        p
    }

    #[tokio::test]
    async fn a_saved_loadout_reaches_the_run() {
        use crate::defs::trees::NodeId;
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let (a, _rx) = join_with(&mut l, 1, ClassId::Wizard, frost_shard_progress(vec![NodeId::WF1]));
        l.handle(a, ClientMsg::CreateRun { name: "r".into() });
        let rid = l.conns[&a].room.unwrap();
        let members = l.members_of(rid).unwrap();
        assert_eq!(members[0].build.loadout.primary, pick(AbilityId::FrostShard));
        assert_eq!(members[0].build.nodes, vec![NodeId::WF1]);
        assert!(!members[0].debug_loadout);
        l.handle(a, ClientMsg::SetReady { ready: true });
        assert!(l.conns[&a].ready, "the saved pick is valid");
        let run = Run::new(rid, members, 7, LevelChoice::Dungeon { boss: None });
        assert_eq!(run.players[0].sheet.primary.id, AbilityId::FrostShard);
        assert!(!run.debug_used);
    }

    #[tokio::test]
    async fn ready_refuses_a_saved_invalid_loadout() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let (a, mut rx) = join_with(&mut l, 1, ClassId::Wizard, frost_shard_progress(vec![]));
        l.handle(a, ClientMsg::CreateRun { name: "r".into() });
        errors(&mut rx);
        l.handle(a, ClientMsg::SetReady { ready: true });
        assert!(!l.conns[&a].ready);
        let e = errors(&mut rx);
        assert!(e.iter().any(|m| m.contains("Frost Shard")), "{e:?}");
        l.handle(a, ClientMsg::StartRun);
        assert!(l.rooms[&l.conns[&a].room.unwrap()].run_tx.is_none(), "Start refuses too");
    }

    #[tokio::test]
    async fn an_unequipped_item_version_breaks_neither_the_character_nor_the_party_list() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let mut p = Progress::new(ClassId::Paladin);
        p.loadout.primary = Pick { ability: AbilityId::MagicMissile, source: Source::Item(EquipSlot::Ring1) };
        let (a, mut rx) = join_with(&mut l, 1, ClassId::Paladin, p);
        let ch = last(&mut rx, "Character").expect("a Character message");
        assert_eq!(ch["sheet"]["loadout_error"], "Magic Missile is not one of your abilities.");
        assert!(ch["sheet"]["hp"].as_f64().unwrap() > 0.0);
        l.handle(a, ClientMsg::CreateRun { name: "r".into() });
        let room = last(&mut rx, "Room").expect("a Room message");
        assert_eq!(room["players"][0]["loadout"]["primary"]["ability"], "MagicMissile");
        l.handle(a, ClientMsg::SetReady { ready: true });
        assert!(!l.conns[&a].ready);
    }

    #[tokio::test]
    async fn the_party_list_shows_loadouts_and_weapons() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let mut p = Progress::new(ClassId::Barbarian);
        p.inventory.push(ItemId::ThrowingAxes);
        p.equipment.set(EquipSlot::Ranged, Some(ItemId::ThrowingAxes));
        p.loadout.primary = pick(AbilityId::Strike);
        let (a, mut rx) = join_with(&mut l, 1, ClassId::Barbarian, p);
        l.handle(a, ClientMsg::CreateRun { name: "r".into() });
        let room = last(&mut rx, "Room").unwrap();
        let me = &room["players"][0];
        assert_eq!(me["loadout"]["primary"]["ability"], "Strike");
        assert_eq!(me["loadout"]["secondary"]["ability"], "Charge");
        let weapons: Vec<&str> = me["weapons"].as_array().unwrap().iter().map(|w| w.as_str().unwrap()).collect();
        let starter = Equipment::starter(ClassId::Barbarian).get(EquipSlot::Melee).unwrap();
        assert_eq!(weapons, vec![format!("{starter:?}"), "ThrowingAxes".to_string()]);

        // The debug picks win while they are set.
        l.debug_equip_if(true, a, EquipSlot::Ranged, None);
        l.debug_loadout_if(true, a, pick(AbilityId::Strike), pick(AbilityId::GroundSlam));
        l.send_room(l.conns[&a].room.unwrap());
        let room = last(&mut rx, "Room").unwrap();
        let me = &room["players"][0];
        assert_eq!(me["loadout"]["secondary"]["ability"], "GroundSlam");
        assert_eq!(me["weapons"].as_array().unwrap().len(), 1, "the debug equipment has no ranged weapon");
    }

    #[tokio::test]
    async fn the_debug_flag_starts_from_the_real_build() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let mut p = Progress::new(ClassId::Barbarian);
        p.bought = Attributes::new(2, 0, 0, 0, 0, 0);
        let (a, _rx) = join_with(&mut l, 1, ClassId::Barbarian, p);
        l.handle(a, ClientMsg::CreateRun { name: "r".into() });
        assert_eq!(l.build_of(a).unwrap().extra, Attributes::new(2, 0, 0, 0, 0, 0), "no debug, no lift");
        l.debug_loadout_if(true, a, pick(AbilityId::Strike), pick(AbilityId::Charge));
        let b = l.build_of(a).unwrap();
        assert_eq!(b.extra.get(Attr::Str), 2 + debug_lift(ClassId::Barbarian, &Build { extra: Attributes::new(2, 0, 0, 0, 0, 0), ..b.clone() }).get(Attr::Str));
        assert!(b.extra.get(Attr::Str) >= 2, "the two bought STR stay");
        assert!(b.own.contains(&AbilityId::GroundSlam), "the whole class pool");
        assert_eq!(b.loadout.secondary, pick(AbilityId::Charge));
        assert!(crate::sheet::hero_sheet(ClassId::Barbarian, &b).is_ok());
    }

    #[tokio::test]
    async fn a_progress_change_resends_the_room() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let (a, mut rx) = join_with(&mut l, 1, ClassId::Wizard, Progress::new(ClassId::Wizard));
        l.handle(a, ClientMsg::CreateRun { name: "r".into() });
        while rx.try_recv().is_ok() {}
        let mut p = Progress::new(ClassId::Wizard);
        p.rev = 1;
        p.loadout.primary = pick(AbilityId::MagicMissile);
        l.apply_progress(10, p);
        let mut seen = Vec::new();
        while let Ok(Message::Binary(b)) = rx.try_recv() {
            seen.push(rmp_serde::from_slice::<serde_json::Value>(&b).unwrap()["t"].as_str().unwrap().to_string());
        }
        assert!(seen.contains(&"Character".to_string()) && seen.contains(&"Room".to_string()), "{seen:?}: the party list follows the saved build");
    }

    #[tokio::test]
    async fn debug_loadout_alone_keeps_the_saved_weapons_and_debug_equip_overrides() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let mut p = Progress::new(ClassId::Barbarian);
        p.inventory.push(ItemId::WarHammer);
        p.equipment.set(EquipSlot::Melee, Some(ItemId::WarHammer));
        p.equipment.set(EquipSlot::Ranged, Some(ItemId::ThrowingAxes));
        let (a, _rx) = join_with(&mut l, 1, ClassId::Barbarian, p);
        l.handle(a, ClientMsg::CreateRun { name: "r".into() });
        l.debug_loadout_if(true, a, pick(AbilityId::Strike), pick(AbilityId::Charge));
        let e = l.build_of(a).unwrap().equipment;
        assert_eq!((e.get(EquipSlot::Melee), e.get(EquipSlot::Ranged)), (Some(ItemId::WarHammer), Some(ItemId::ThrowingAxes)));
        l.debug_equip_if(true, a, EquipSlot::Ranged, None);
        let e = l.build_of(a).unwrap().equipment;
        assert_eq!((e.get(EquipSlot::Melee), e.get(EquipSlot::Ranged)), (Some(ItemId::WarHammer), None), "only the touched slot changes");
        l.handle(a, ClientMsg::LeaveRun);
        l.set_character(a, character_with(1, 10, ClassId::Barbarian, Progress::new(ClassId::Barbarian)));
        assert_eq!(l.conns[&a].debug_touched, [false; EquipSlot::COUNT]);
    }

    #[tokio::test]
    async fn a_real_set_loadout_replaces_the_debug_picks() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let (a, _rx) = join_with(&mut l, 1, ClassId::Barbarian, Progress::new(ClassId::Barbarian));
        l.handle(a, ClientMsg::CreateRun { name: "r".into() });
        l.debug_loadout_if(true, a, pick(AbilityId::Hurl), pick(AbilityId::Charge));
        assert_eq!(l.build_of(a).unwrap().loadout.primary, pick(AbilityId::Hurl));
        let mut p = Progress::new(ClassId::Barbarian);
        p.rev = 1;
        p.loadout.secondary = pick(AbilityId::GroundSlam);
        l.apply_progress(10, p);
        assert!(l.conns[&a].loadout.is_none() && !l.conns[&a].debug_loadout);
        let b = l.build_of(a).unwrap();
        assert_eq!((b.loadout.primary, b.loadout.secondary), (pick(AbilityId::Strike), pick(AbilityId::GroundSlam)));
        // Debug weapon overrides survive, and keep the debug flag.
        l.debug_equip_if(true, a, EquipSlot::Ranged, None);
        l.debug_loadout_if(true, a, pick(AbilityId::Hurl), pick(AbilityId::Charge));
        let mut p = Progress::new(ClassId::Barbarian);
        p.rev = 2;
        l.apply_progress(10, p);
        assert!(l.conns[&a].loadout.is_none() && l.conns[&a].debug_loadout && l.conns[&a].debug_touched[EquipSlot::Ranged as usize]);
    }
}
