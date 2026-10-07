//! Lobby: connected clients, open runs (rooms), class and boss selection,
//! ready, start, and the profile (XP + upgrade shop) of each connection.

use crate::profiles::ProfileStore;
use crate::protocol::{encode, BossId, ClassId, ClientMsg, RoomPlayer, RunSummary, ServerMsg};
use crate::run::{run_task, Award, Member, Run, RunCmd};
use axum::extract::ws::Message;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

pub const MAX_PLAYERS: usize = 4;

pub type SharedLobby = Arc<Mutex<Lobby>>;

pub struct Conn {
    pub name: String,
    pub tx: UnboundedSender<Message>,
    pub room: Option<u32>,
    pub class: ClassId,
    pub ready: bool,
    /// Profile token, set by `Hello`.
    pub token: Option<String>,
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
    profiles: ProfileStore,
    /// Handle to ourselves, passed to run tasks so they can report back.
    me: Option<SharedLobby>,
}

pub fn new_shared(profiles: ProfileStore) -> SharedLobby {
    let lobby = Arc::new(Mutex::new(Lobby { conns: HashMap::new(), rooms: BTreeMap::new(), next_conn: 1, next_room: 1, profiles, me: None }));
    lobby.lock().unwrap().me = Some(lobby.clone());
    lobby
}

fn send(tx: &UnboundedSender<Message>, msg: &ServerMsg) {
    let _ = tx.send(Message::Binary(encode(msg).into()));
}

impl Lobby {
    pub fn connect(&mut self, tx: UnboundedSender<Message>) -> u32 {
        let id = self.next_conn;
        self.next_conn += 1;
        send(&tx, &ServerMsg::Welcome { id });
        self.conns.insert(id, Conn { name: format!("Adventurer{id}"), tx, room: None, class: ClassId::Wizard, ready: false, token: None });
        self.send_lobby_to(id);
        id
    }

    pub fn disconnect(&mut self, id: u32) {
        self.leave_room(id);
        self.conns.remove(&id);
    }

    /// The running dungeon this connection is in, for routing gameplay input.
    pub fn run_of(&self, id: u32) -> Option<UnboundedSender<RunCmd>> {
        let room = self.conns.get(&id)?.room?;
        self.rooms.get(&room)?.run_tx.clone()
    }

    pub fn handle(&mut self, id: u32, msg: ClientMsg) {
        match msg {
            ClientMsg::Hello { name, token } => {
                let name: String = name.trim().chars().filter(|c| !c.is_control()).take(16).collect();
                let token = self.profiles.resolve(token.as_deref());
                if let Some(c) = self.conns.get_mut(&id) {
                    if !name.is_empty() {
                        c.name = name;
                    }
                    c.token = Some(token);
                }
                self.send_profile(id);
            }
            ClientMsg::CreateRun { name } => {
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
            ClientMsg::SelectClass { class } => {
                if let Some(c) = self.conns.get_mut(&id) {
                    if self.rooms.get(&c.room.unwrap_or(0)).map_or(true, |r| r.run_tx.is_none()) {
                        c.class = class;
                    }
                }
                self.send_room_of(id);
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
            ClientMsg::BuyUpgrade { stat } => {
                let Some(c) = self.conns.get(&id) else { return };
                if c.room.and_then(|r| self.rooms.get(&r)).map_or(false, |r| r.run_tx.is_some()) {
                    return self.error(id, "Upgrades can only be bought between runs.");
                }
                let Some(token) = c.token.clone() else { return };
                match self.profiles.buy(&token, stat) {
                    Ok(()) => self.send_profile(id),
                    Err(e) => self.error(id, e),
                }
            }
            _ => {}
        }
    }

    fn send_profile(&self, id: u32) {
        if let Some(c) = self.conns.get(&id) {
            if let Some(token) = &c.token {
                send(&c.tx, &ServerMsg::Profile(self.profiles.info(token)));
            }
        }
    }

    fn error(&self, id: u32, msg: &str) {
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
                self.conns.get(m).map(|c| Member {
                    conn: *m,
                    name: c.name.clone(),
                    class: c.class,
                    tx: c.tx.clone(),
                    token: c.token.clone(),
                    upgrades: c.token.as_deref().map(|t| self.profiles.upgrades(t)).unwrap_or_default(),
                })
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

    /// Called by a run task when the dungeon is over: the earned XP and coins
    /// are banked and everyone returns to the lobby.
    pub fn run_finished(&mut self, rid: u32, awards: Vec<Award>) {
        for a in &awards {
            self.profiles.add_xp(&a.token, a.xp);
            self.profiles.add_coins(&a.token, a.coins);
        }
        if !awards.is_empty() {
            self.profiles.save();
            let ids: Vec<u32> = self.conns.iter().filter(|(_, c)| c.token.as_ref().map_or(false, |t| awards.iter().any(|a| &a.token == t))).map(|(id, _)| *id).collect();
            for id in ids {
                self.send_profile(id);
            }
        }
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
            .filter_map(|m| self.conns.get(m).map(|c| RoomPlayer { id: *m, name: c.name.clone(), class: c.class, ready: c.ready }))
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
    use crate::defs::progression::{upgrade_cost, UpgradeStat};

    fn lobby() -> SharedLobby {
        new_shared(ProfileStore::in_memory())
    }

    /// Connects a client that has said `Hello`; returns its id and token.
    fn join(l: &mut Lobby) -> (u32, String) {
        let (tx, rx) = unbounded_channel();
        std::mem::forget(rx);
        let id = l.connect(tx);
        l.handle(id, ClientMsg::Hello { name: format!("p{id}"), token: None });
        let token = l.conns[&id].token.clone().expect("token issued");
        (id, token)
    }

    #[tokio::test]
    async fn only_the_host_chooses_the_boss_before_the_run() {
        let shared = lobby();
        let mut l = shared.lock().unwrap();
        let (host, _) = join(&mut l);
        let (guest, _) = join(&mut l);
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
    }

    #[tokio::test]
    async fn xp_is_banked_and_spent_between_runs_only() {
        let shared = lobby();
        let mut l = shared.lock().unwrap();
        let (id, token) = join(&mut l);
        l.handle(id, ClientMsg::CreateRun { name: "r".into() });
        let rid = l.conns[&id].room.unwrap();
        l.handle(id, ClientMsg::StartRun);

        l.profiles.add_xp(&token, 1000);
        l.handle(id, ClientMsg::BuyUpgrade { stat: UpgradeStat::Damage });
        assert_eq!(l.profiles.upgrades(&token).damage, 0, "no shopping during a run");

        l.run_finished(rid, vec![Award { token: token.clone(), xp: 50, coins: 30 }]);
        assert_eq!(l.profiles.info(&token).xp, 1050);
        assert_eq!(l.profiles.info(&token).coins, 30);
        l.handle(id, ClientMsg::BuyUpgrade { stat: UpgradeStat::Damage });
        assert_eq!(l.profiles.upgrades(&token).damage, 1);
        assert_eq!(l.profiles.info(&token).xp, 1050 - upgrade_cost(0));

        // A reconnect with the same token finds the same profile.
        let (tx, rx) = unbounded_channel();
        std::mem::forget(rx);
        let id2 = l.connect(tx);
        l.handle(id2, ClientMsg::Hello { name: String::new(), token: Some(token.clone()) });
        assert_eq!(l.conns[&id2].token.as_deref(), Some(token.as_str()));
    }
}
