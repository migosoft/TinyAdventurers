//! Lobby: connected accounts, their selected character, open runs (rooms),
//! boss selection, ready and start. The lobby never waits for the database:
//! the socket handler does the queries first and then hands the result in
//! (`set_character`, `apply_progress`), so the lock is only held briefly.

use crate::db::{self, Character, Db};
use crate::progress::Progress;
use crate::protocol::{encode, BossId, ClientMsg, RoomPlayer, RunSummary, ServerMsg};
use crate::run::{run_task, Award, Member, Run, RunCmd};
use axum::extract::ws::Message;
use std::collections::{BTreeMap, HashMap};
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
}

pub struct Room {
    pub name: String,
    pub host: u32,
    pub members: Vec<u32>,
    /// End boss chosen by the host, `None` = random.
    pub boss: Option<BossId>,
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
/// lobby, then the earned XP and coins are banked on the characters.
pub async fn finish_run(lobby: &SharedLobby, rid: u32, awards: Vec<Award>) {
    let db = {
        let mut l = lobby.lock().unwrap();
        l.run_finished(rid);
        l.db.clone()
    };
    let Some(db) = db.filter(|_| !awards.is_empty()) else { return };
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

impl Lobby {
    /// A new connection of a logged-in account. An older connection of the
    /// same account is closed: one account plays in one place only.
    pub fn connect(&mut self, account: i32, tx: UnboundedSender<Message>) -> u32 {
        self.kick_account(account, "You logged in from another window.");
        let id = self.next_conn;
        self.next_conn += 1;
        send(&tx, &ServerMsg::Welcome { id });
        self.conns.insert(id, Conn { account, tx, room: None, ready: false, character: None });
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
        c.character = Some(character);
        send(&c.tx, &ServerMsg::Character(info));
    }

    /// The character to buy upgrades for: never during a run.
    pub fn can_shop(&self, id: u32) -> Result<i32, &'static str> {
        if self.in_running_run(id) {
            return Err("Upgrades can only be bought between runs.");
        }
        self.conns.get(&id).and_then(|c| c.character.as_ref()).map(|ch| ch.id).ok_or("Choose a character first.")
    }

    /// New progress of a character, fresh from the database. Older results
    /// arriving late (`rev`) are ignored.
    pub fn apply_progress(&mut self, character: i32, p: Progress) {
        for c in self.conns.values_mut() {
            if let Some(ch) = c.character.as_mut().filter(|ch| ch.id == character && p.rev > ch.progress.rev) {
                ch.progress = p.clone();
                send(&c.tx, &ServerMsg::Character(ch.info()));
            }
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
                self.rooms.insert(rid, Room { name, host: id, members: vec![id], boss: None, run_tx: None });
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
        let members: Vec<Member> = room
            .members
            .iter()
            .filter_map(|m| {
                let c = self.conns.get(m)?;
                let ch = c.character.as_ref()?;
                Some(Member { conn: *m, name: ch.name.clone(), class: ch.class, tx: c.tx.clone(), character: Some(ch.id), upgrades: ch.progress.upgrades })
            })
            .collect();
        let seed: u64 = rand::random();
        let boss = room.boss;
        let run = Run::new(rid, members, seed, boss);
        tracing::info!("run {rid} started: {} player(s), boss {:?}{}", run.players.len(), run.boss_id, if boss.is_some() { " (chosen)" } else { "" });
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
                Some(RoomPlayer { id: *m, name: ch.name.clone(), class: ch.class, ready: c.ready })
            })
            .collect();
        let msg = ServerMsg::Room { run_id: rid, name: room.name.clone(), host: room.host, players, boss: room.boss };
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
    use crate::defs::progression::UpgradeStat;
    use crate::protocol::ClassId;

    fn character(account: i32, id: i32, class: ClassId) -> Character {
        Character { id, account_id: account, name: format!("hero{id}"), class, progress: Progress::new() }
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
        l.set_character(id, character(1, 11, ClassId::Assassin));
        assert_eq!(l.conns[&id].character.as_ref().unwrap().id, 10);
        l.handle(id, ClientMsg::LeaveRun);
        assert!(l.can_select(id).is_ok());
    }

    #[tokio::test]
    async fn shopping_between_runs_only_and_newest_progress_wins() {
        let shared = new_shared(None);
        let mut l = shared.lock().unwrap();
        let id = join(&mut l, 1, ClassId::Wizard);
        assert_eq!(l.can_shop(id), Ok(10));
        l.handle(id, ClientMsg::CreateRun { name: "r".into() });
        assert_eq!(l.can_shop(id), Ok(10), "waiting room is fine");
        l.handle(id, ClientMsg::StartRun);
        assert!(l.can_shop(id).is_err(), "no shopping during a run");
        let rid = l.conns[&id].room.unwrap();
        l.run_finished(rid);
        assert_eq!(l.can_shop(id), Ok(10));

        let mut newer = Progress::new();
        newer.bank(500, 0);
        newer.buy(UpgradeStat::Life).unwrap();
        newer.rev = 3;
        let mut older = Progress::new();
        older.rev = 2;
        l.apply_progress(10, newer.clone());
        l.apply_progress(10, older);
        l.apply_progress(77, Progress { rev: 9, xp: 1, ..Progress::new() });
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
        finish_run(&shared, rid, vec![Award { character: played.id, xp: 120, coins: 7 }]).await;
        {
            let l = shared.lock().unwrap();
            assert!(l.conns[&id].room.is_none(), "back in the lobby");
            let cached = &l.conns[&id].character.as_ref().unwrap().progress;
            assert_eq!((cached.xp, cached.coins), (120, 7), "cached copy refreshed");
        }
        let stored = db::load_character(&db, a, played.id).await.unwrap().unwrap().progress;
        assert_eq!((stored.xp, stored.total_xp, stored.coins), (120, 120, 7));
        assert_eq!(db::load_character(&db, a, idle.id).await.unwrap().unwrap().progress, Progress::new());
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
}
