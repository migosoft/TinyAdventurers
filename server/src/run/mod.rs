//! One dungeon run: an authoritative 60 Hz simulation in its own tokio task.

pub mod abilities;
pub mod ai;
pub mod bosses;
pub mod debug;
pub mod entities;
pub mod visibility;

use crate::collision::MoveState;
use crate::defs::progression::{self, StatUpgrades};
use crate::defs::{bosses as boss_defs, classes, enemies};
use crate::defs::enemies::EnemyType;
use crate::defs::kinds::{Anim, EntityKind};
use crate::dungeon::{generate::generate, Dungeon, Tile};
use crate::fov::Fov;
use crate::lobby::SharedLobby;
use crate::math::Vec2;
use crate::protocol::{encode, BossId, ClassId, ClientMsg, Ev, InputMsg, PlayerInfo, PlayerStats, RunStartInfo, ServerMsg};
use axum::extract::ws::Message;
use bosses::BossBehaviour;
use entities::*;
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::collections::VecDeque;
use std::time::{Duration, Instant};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};

pub const TICK_HZ: f64 = 60.0;
pub const DT: f64 = 1.0 / TICK_HZ;
/// Snapshots are sent every N ticks (60 / 2 = 30 Hz).
pub const SNAPSHOT_EVERY: u32 = 2;
/// Monsters farther than this from every player do not think.
const ACTIVE_RANGE: f64 = 420.0;
const END_DELAY: f64 = 3.0;

/// What one profile banks at the end of a run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Award {
    pub token: String,
    pub xp: u32,
    pub coins: u32,
}

pub struct Member {
    pub conn: u32,
    pub name: String,
    pub class: ClassId,
    pub tx: UnboundedSender<Message>,
    /// Profile token (XP is banked there) and its bought upgrades.
    pub token: Option<String>,
    pub upgrades: StatUpgrades,
}

pub enum RunCmd {
    Msg { conn: u32, msg: ClientMsg },
    Leave { conn: u32 },
}

pub struct Run {
    pub id: u32,
    pub tick: u32,
    pub time: f64,
    pub dungeon: Dungeon,
    pub players: Vec<Player>,
    pub monsters: Vec<Monster>,
    pub projectiles: Vec<Projectile>,
    pub hazards: Vec<Hazard>,
    pub chests: Vec<Chest>,
    /// Events since the last snapshot, with an optional position for FOV filtering.
    pub events: Vec<(Ev, Option<Vec2>)>,
    pub next_id: u32,
    pub rng: ChaCha8Rng,
    pub boss_id: BossId,
    pub boss_ent: u32,
    pub boss: Option<Box<dyn BossBehaviour>>,
    pub boss_awake: bool,
    pub door_closed: bool,
    pub ended: Option<(bool, f64)>,
    /// Someone used debug mode (immortal): no XP is banked for this run.
    pub debug_used: bool,
    pub srv_ms: f32,
}

impl Run {
    pub fn new(id: u32, members: Vec<Member>, seed: u64, boss: Option<BossId>) -> Run {
        let dungeon = generate(seed);
        let mut rng = ChaCha8Rng::seed_from_u64(seed ^ 0x5eed);
        let boss_id = boss.unwrap_or_else(|| BossId::ALL[rng.gen_range(0..BossId::ALL.len())]);
        let (w, h) = (dungeon.map.w, dungeon.map.h);
        let mut run = Run {
            id,
            tick: 0,
            time: 0.0,
            players: Vec::new(),
            monsters: Vec::new(),
            projectiles: Vec::new(),
            hazards: Vec::new(),
            chests: Vec::new(),
            events: Vec::new(),
            next_id: 1,
            rng,
            boss_id,
            boss_ent: 0,
            boss: None,
            boss_awake: false,
            door_closed: false,
            ended: None,
            debug_used: false,
            srv_ms: 0.0,
            dungeon,
        };
        for (i, m) in members.into_iter().enumerate() {
            let def = classes::def(m.class);
            let mods = m.upgrades.modifiers();
            let max_hp = def.hp * mods.life;
            let p = run.dungeon.player_spawns[i % run.dungeon.player_spawns.len()];
            let id = run.alloc_id();
            run.players.push(Player {
                id,
                conn: m.conn,
                tx: Some(m.tx),
                name: m.name,
                class: m.class,
                def,
                mv: MoveState { x: p.x, y: p.y, dash_t: 0.0, dash_dx: 0.0, dash_dy: 0.0 },
                hp: max_hp,
                max_hp,
                mods,
                xp: 0,
                coins: 0,
                token: m.token,
                alive: true,
                aim: 0.0,
                aim_dist: 0.0,
                cd1: 0.0,
                cd2: 0.0,
                hidden: 0.0,
                anim: Anim::Idle,
                anim_start: 0.0,
                moving: false,
                hurt_t: 0.0,
                inputs: VecDeque::new(),
                ack: 0,
                view_lag: 0.1,
                rtt: 0.05,
                spectating: None,
                dash_hit: Vec::new(),
                fov: Fov::new(w, h),
                kills: 0,
                damage: 0.0,
                healing: 0.0,
                debug: false,
            });
        }
        let n = run.players.len();
        let spawns = run.dungeon.spawns.clone();
        for s in spawns {
            run.spawn_enemy(s.enemy, s.pos, None, n);
        }
        // Mimics are monsters from the start, asleep and drawn as a closed chest.
        for c in run.dungeon.chests.clone() {
            if c.mimic {
                let id = run.spawn_enemy(EnemyType::Mimic, c.pos, None, n);
                let mi = run.monster_idx(id).unwrap();
                run.monsters[mi].asleep = true;
            } else {
                let id = run.alloc_id();
                run.chests.push(Chest { id, pos: c.pos, opened: None });
            }
        }
        run.spawn_boss(n);
        run
    }

    pub fn alloc_id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    pub fn spawn_enemy(&mut self, t: EnemyType, pos: Vec2, owner: Option<u32>, party: usize) -> u32 {
        let d = enemies::def(t);
        let id = self.alloc_id();
        let hp = d.hp * (0.75 + 0.25 * party.max(1) as f64);
        self.monsters.push(Monster {
            id,
            etype: Some(t),
            kind: d.kind,
            pos,
            hp,
            max_hp: hp,
            speed: d.speed,
            radius: d.radius,
            sight: d.sight,
            alive: true,
            aim: 0.0,
            anim: Anim::Idle,
            anim_start: self.time,
            hurt_t: 0.0,
            ai: Ai::new(pos),
            owner,
            history: VecDeque::with_capacity(HISTORY_LEN),
            is_boss: false,
            asleep: false,
        });
        id
    }

    fn spawn_boss(&mut self, party: usize) {
        let d = boss_defs::def(self.boss_id);
        let pos = self.dungeon.boss_hall().center_px();
        let id = self.alloc_id();
        let hp = d.hp * boss_defs::hp_scale(party);
        self.monsters.push(Monster {
            id,
            etype: None,
            kind: d.kind,
            pos,
            hp,
            max_hp: hp,
            speed: d.speed,
            radius: d.radius,
            sight: 400.0,
            alive: true,
            aim: std::f64::consts::FRAC_PI_2,
            anim: Anim::Idle,
            anim_start: 0.0,
            hurt_t: 0.0,
            ai: Ai::new(pos),
            owner: None,
            history: VecDeque::with_capacity(HISTORY_LEN),
            is_boss: true,
            asleep: true,
        });
        self.boss_ent = id;
        let mut behaviour = bosses::create(self.boss_id);
        behaviour.spawn_extras(self, pos, party);
        self.boss = Some(behaviour);
    }

    pub fn start_info(&self, p: &Player) -> ServerMsg {
        ServerMsg::RunStarted(RunStartInfo {
            width: self.dungeon.map.w as u16,
            height: self.dungeon.map.h as u16,
            tiles: self.dungeon.map.tiles.clone(),
            tile_size: crate::dungeon::TILE as u16,
            you: p.id,
            players: self.players.iter().map(|q| PlayerInfo { ent: q.id, name: q.name.clone(), class: q.class }).collect(),
            spawn_x: p.mv.x,
            spawn_y: p.mv.y,
            mods: p.mods,
        })
    }

    pub fn send(&self, p: &Player, msg: &ServerMsg) {
        if let Some(tx) = &p.tx {
            let _ = tx.send(Message::Binary(encode(msg).into()));
        }
    }

    pub fn event(&mut self, ev: Ev, at: Option<Vec2>) {
        self.events.push((ev, at));
    }

    pub fn player_idx(&self, id: u32) -> Option<usize> {
        self.players.iter().position(|p| p.id == id)
    }
    pub fn monster_idx(&self, id: u32) -> Option<usize> {
        self.monsters.iter().position(|m| m.id == id)
    }

    pub fn handle(&mut self, cmd: RunCmd) {
        match cmd {
            RunCmd::Msg { conn, msg } => {
                let Some(pi) = self.players.iter().position(|p| p.conn == conn) else { return };
                match msg {
                    ClientMsg::Input(input) => {
                        let p = &mut self.players[pi];
                        if input.seq > p.ack && p.inputs.len() < 120 {
                            p.inputs.push_back(input);
                        }
                    }
                    ClientMsg::Spectate { dir } => self.cycle_spectate(pi, dir),
                    ClientMsg::Debug { on } => self.set_debug(pi, on),
                    _ => {}
                }
            }
            RunCmd::Leave { conn } => {
                if let Some(pi) = self.players.iter().position(|p| p.conn == conn) {
                    let p = &mut self.players[pi];
                    p.tx = None;
                    if p.alive {
                        p.alive = false;
                        let (id, pos, kind) = (p.id, p.pos(), p.kind() as u8);
                        self.event(Ev::Died { id, x: pos.x as f32, y: pos.y as f32, kind }, None);
                        let name = self.players[pi].name.clone();
                        self.event(Ev::Msg { text: format!("{name} left the dungeon") }, None);
                    }
                }
            }
        }
    }

    fn cycle_spectate(&mut self, pi: usize, dir: i8) {
        if self.players[pi].alive {
            return;
        }
        let alive: Vec<u32> = self.players.iter().filter(|p| p.alive).map(|p| p.id).collect();
        if alive.is_empty() {
            return;
        }
        let cur = self.players[pi].spectating.and_then(|s| alive.iter().position(|&a| a == s)).unwrap_or(0) as i32;
        let n = alive.len() as i32;
        let next = ((cur + dir as i32) % n + n) % n;
        self.players[pi].spectating = Some(alive[next as usize]);
    }

    pub fn step(&mut self) {
        self.tick += 1;
        self.time += DT;

        for pi in 0..self.players.len() {
            self.step_player(pi);
        }
        self.touch_chests();

        let player_pos: Vec<Vec2> = self.players.iter().filter(|p| p.alive).map(|p| p.pos()).collect();
        for mi in 0..self.monsters.len() {
            let m = &self.monsters[mi];
            if !m.alive || m.is_boss {
                continue;
            }
            let active = player_pos.iter().any(|pp| pp.dist2(m.pos) < ACTIVE_RANGE * ACTIVE_RANGE);
            if active {
                ai::tick_monster(self, mi, DT);
            }
        }
        if self.boss_awake {
            if let Some(mut b) = self.boss.take() {
                b.tick(self, DT);
                self.boss = Some(b);
            }
        }
        ai::separate_monsters(self);

        abilities::tick_projectiles(self, DT);
        self.tick_hazards(DT);

        for m in &mut self.monsters {
            if m.history.len() >= HISTORY_LEN {
                m.history.pop_front();
            }
            m.history.push_back(m.pos);
            m.hurt_t = (m.hurt_t - DT).max(0.0);
        }
        self.monsters.retain(|m| m.alive);
        self.projectiles.retain(|p| !p.dead);
        self.hazards.retain(|h| h.life > 0.0);

        self.check_boss_hall();
        self.check_end();
    }

    fn step_player(&mut self, pi: usize) {
        let p = &mut self.players[pi];
        p.hurt_t = (p.hurt_t - DT).max(0.0);
        if !p.alive {
            p.inputs.clear();
            let spec = p.spectating;
            if spec.map_or(true, |s| !self.players.iter().any(|q| q.id == s && q.alive)) {
                let first = self.players.iter().find(|q| q.alive).map(|q| q.id);
                self.players[pi].spectating = first;
            }
            return;
        }
        // One input per step; catch up with two when the queue builds up.
        let n = if p.inputs.len() > 3 { 2 } else { 1 };
        for _ in 0..n {
            let Some(input) = self.players[pi].inputs.pop_front() else { break };
            self.apply_input(pi, input);
        }
        let p = &mut self.players[pi];
        // Non-looping action animations fall back to idle/move.
        let action_done = matches!(p.anim, Anim::Melee | Anim::Shoot | Anim::Cast) && self.time - p.anim_start > 0.25
            || p.anim == Anim::Dash && p.mv.dash_t <= 0.0;
        if action_done || matches!(p.anim, Anim::Idle | Anim::Move) {
            let a = if p.moving { Anim::Move } else { Anim::Idle };
            if p.anim != a {
                p.anim = a;
                p.anim_start = self.time;
            }
        }
    }

    fn apply_input(&mut self, pi: usize, input: InputMsg) {
        let map = &self.dungeon.map;
        let p = &mut self.players[pi];
        p.ack = input.seq;
        p.aim = input.aim as f64;
        p.aim_dist = input.aim_dist as f64;
        p.view_lag = (input.view_lag as f64 / 1000.0).clamp(0.0, 0.45);
        p.rtt = (input.rtt as f64 / 1000.0).clamp(0.0, 0.5);
        p.cd1 = (p.cd1 - DT).max(0.0);
        p.cd2 = (p.cd2 - DT).max(0.0);
        let was_hidden = p.hidden > 0.0;
        p.hidden = (p.hidden - DT).max(0.0);
        if was_hidden && p.hidden <= 0.0 {
            p.hidden = 0.0;
        }
        let dashing = p.mv.dash_t > 0.0;
        p.mv = crate::collision::step_move(
            map,
            &p.mv,
            input.mx,
            input.my,
            p.def.speed * p.mods.move_speed,
            crate::defs::abilities::DASH_SPEED,
            classes::PLAYER_RADIUS,
            DT,
        );
        p.moving = input.mx != 0 || input.my != 0;
        if dashing {
            abilities::dash_contact(self, pi);
        }
        if let Some(shot) = input.primary {
            let id = self.players[pi].def.primary;
            abilities::try_use(self, pi, id, shot, true);
        }
        if let Some(shot) = input.secondary {
            let id = self.players[pi].def.secondary;
            abilities::try_use(self, pi, id, shot, false);
        }
    }

    /// A living player close to a chest opens it (coins for the whole party);
    /// close to a sleeping mimic, the mimic wakes up.
    fn touch_chests(&mut self) {
        let alive: Vec<Vec2> = self.players.iter().filter(|p| p.alive).map(|p| p.pos()).collect();
        let near = |pos: Vec2| alive.iter().any(|p| p.dist(pos) < enemies::CHEST_TOUCH);
        for ci in 0..self.chests.len() {
            let c = &self.chests[ci];
            if c.opened.is_some() || !near(c.pos) {
                continue;
            }
            let pos = c.pos;
            self.chests[ci].opened = Some(self.time);
            let coins = self.rng.gen_range(progression::CHEST_COINS);
            self.give_coins(pos, coins);
        }
        for mi in 0..self.monsters.len() {
            let m = &self.monsters[mi];
            if m.alive && m.asleep && m.etype == Some(EnemyType::Mimic) && near(m.pos) {
                self.wake_mimic(mi);
            }
        }
    }

    /// The mimic drops its disguise: a short pause while the lid flies open, then it hunts.
    pub fn wake_mimic(&mut self, mi: usize) {
        let m = &mut self.monsters[mi];
        m.asleep = false;
        m.ai.hold = enemies::MIMIC_WAKE_T;
        m.ai.cd = m.ai.cd.max(enemies::MIMIC_WAKE_T);
    }

    /// Coins go to every living party member, like XP.
    fn give_coins(&mut self, pos: Vec2, coins: u32) {
        if coins == 0 {
            return;
        }
        for p in self.players.iter_mut().filter(|p| p.alive) {
            p.coins += coins;
        }
        // Sent to everyone: the whole party counts the coins, even out of sight.
        self.event(Ev::Coins { x: pos.x as f32, y: pos.y as f32, v: coins }, None);
    }

    fn tick_hazards(&mut self, dt: f64) {
        for hi in 0..self.hazards.len() {
            let h = &mut self.hazards[hi];
            h.life -= dt;
            h.pulse_t -= dt;
            if h.pulse_t > 0.0 {
                continue;
            }
            h.pulse_t = 0.5;
            let (pos, r, dmg) = (h.pos, h.radius, h.damage);
            for pi in 0..self.players.len() {
                let p = &self.players[pi];
                if p.alive && p.pos().dist(pos) < r + classes::PLAYER_RADIUS {
                    self.hurt_player(pi, dmg);
                }
            }
        }
    }

    pub fn spawn_hazard(&mut self, kind: EntityKind, pos: Vec2, radius: f64, life: f64, damage: f64) {
        let id = self.alloc_id();
        self.hazards.push(Hazard { id, kind, pos, radius, life, pulse_t: 0.25, damage });
    }

    pub fn hurt_player(&mut self, pi: usize, dmg: f64) {
        let p = &mut self.players[pi];
        if !p.alive {
            return;
        }
        let dmg = dmg * (1.0 - p.mods.armor);
        // Debug mode: hits still show, but nothing is subtracted.
        if !p.debug {
            p.hp -= dmg;
        }
        p.hurt_t = 0.15;
        let pos = p.pos();
        self.event(Ev::Dmg { x: pos.x as f32, y: pos.y as f32 - 10.0, v: dmg as f32, crit: false, p: true }, Some(pos));
        let p = &mut self.players[pi];
        if p.hp <= 0.0 {
            p.hp = 0.0;
            p.alive = false;
            p.mv.dash_t = 0.0;
            let (id, kind, name) = (p.id, p.kind() as u8, p.name.clone());
            self.event(Ev::Died { id, x: pos.x as f32, y: pos.y as f32, kind }, None);
            self.event(Ev::Msg { text: format!("{name} has fallen") }, None);
        }
    }

    pub fn heal_player(&mut self, pi: usize, amount: f64) -> f64 {
        let p = &mut self.players[pi];
        if !p.alive {
            return 0.0;
        }
        let healed = amount.min(p.max_hp - p.hp);
        p.hp += healed;
        let pos = p.pos();
        if healed > 0.0 {
            self.event(Ev::Heal { x: pos.x as f32, y: pos.y as f32 - 10.0, v: healed as f32 }, Some(pos));
        }
        healed
    }

    /// Returns true if the monster took damage.
    pub fn hurt_monster(&mut self, mi: usize, dmg: f64, crit: bool, src_player: Option<usize>) -> bool {
        if !self.monsters[mi].alive {
            return false;
        }
        let pos = self.monsters[mi].pos;
        if self.monsters[mi].is_boss {
            let immune = self.boss.as_ref().map_or(false, |b| !b.can_be_damaged(self));
            if immune {
                self.event(Ev::Immune { x: pos.x as f32, y: pos.y as f32 }, Some(pos));
                return false;
            }
            self.boss_awake = true;
            self.monsters[mi].asleep = false;
        }
        let m = &mut self.monsters[mi];
        m.hp -= dmg;
        m.hurt_t = 0.15;
        let applied = dmg.min(m.hp + dmg);
        self.event(Ev::Dmg { x: pos.x as f32, y: pos.y as f32 - 10.0, v: dmg as f32, crit, p: false }, Some(pos));
        if let Some(pi) = src_player {
            self.players[pi].damage += applied;
            // Getting hit makes a monster investigate where the attack came from.
            let src = self.players[pi].pos();
            let m = &mut self.monsters[mi];
            if m.ai.target.is_none() && !m.is_boss {
                m.ai.state = AiState::Search;
                m.ai.last_known = src;
                m.ai.path.clear();
                m.ai.search_t = 3.0;
            }
            if m.asleep && m.etype == Some(EnemyType::Mimic) {
                self.wake_mimic(mi);
            }
            self.monsters[mi].asleep = false;
        }
        if self.monsters[mi].hp <= 0.0 {
            if let Some(pi) = src_player {
                self.players[pi].kills += 1;
            }
            self.kill_monster(mi);
        }
        true
    }

    pub fn kill_monster(&mut self, mi: usize) {
        let m = &mut self.monsters[mi];
        if !m.alive {
            return;
        }
        m.alive = false;
        m.hp = 0.0;
        let (id, pos, kind) = (m.id, m.pos, m.kind as u8);
        let xp = progression::xp_for_kill(m.etype);
        let coins = progression::coins_for_kill(m.etype);
        self.event(Ev::Died { id, x: pos.x as f32, y: pos.y as f32, kind }, Some(pos));
        // XP goes to every living party member (spent later via progression).
        for p in self.players.iter_mut().filter(|p| p.alive) {
            p.xp += xp;
        }
        self.give_coins(pos, coins);
        // Raised and bound minions die with their master.
        let minions: Vec<usize> = self.monsters.iter().enumerate().filter(|(_, o)| o.alive && o.owner == Some(id)).map(|(i, _)| i).collect();
        for i in minions {
            self.kill_monster(i);
        }
        if id == self.boss_ent && self.ended.is_none() {
            self.ended = Some((true, self.time + END_DELAY));
            self.event(Ev::Msg { text: "The boss is defeated!".into() }, None);
        }
    }

    fn check_boss_hall(&mut self) {
        let hall = *self.dungeon.boss_hall();
        let alive: Vec<Vec2> = self.players.iter().filter(|p| p.alive).map(|p| p.pos()).collect();
        if !self.boss_awake && alive.iter().any(|p| hall.contains(*p)) {
            self.boss_awake = true;
            // Mimics elsewhere keep their disguise.
            for m in self.monsters.iter_mut().filter(|m| m.etype != Some(EnemyType::Mimic)) {
                m.asleep = false;
            }
            let text = match self.boss_id {
                BossId::Demon => "A demon awakens!",
                BossId::Lich => "The lich rises - slay its disciples!",
                BossId::Dragon => "The dragon awakens!",
            };
            self.event(Ev::Msg { text: text.into() }, None);
        }
        if self.boss_awake && !self.door_closed && !alive.is_empty() && alive.iter().all(|p| hall.contains(*p)) {
            self.door_closed = true;
            for &(x, y) in &self.dungeon.door.clone() {
                self.dungeon.map.set(x, y, Tile::DoorClosed);
                self.event(Ev::Tile { x: x as u16, y: y as u16, v: Tile::DoorClosed as u8 }, None);
            }
        }
    }

    fn check_end(&mut self) {
        if self.ended.is_none() && !self.players.iter().any(|p| p.alive) {
            self.ended = Some((false, self.time + END_DELAY));
        }
    }

    pub fn finished(&self) -> Option<bool> {
        match self.ended {
            Some((victory, at)) if self.time >= at => Some(victory),
            _ => None,
        }
    }

    pub fn end_msg(&self, victory: bool) -> ServerMsg {
        ServerMsg::RunEnded {
            victory,
            boss: self.boss_id,
            time: self.time as f32,
            banked: !self.debug_used,
            stats: self
                .players
                .iter()
                .map(|p| PlayerStats {
                    name: p.name.clone(),
                    class: p.class,
                    kills: p.kills,
                    damage: p.damage as f32,
                    healing: p.healing as f32,
                    xp: p.xp,
                    coins: p.coins,
                    alive: p.alive,
                })
                .collect(),
        }
    }

    /// XP and coins to bank per profile token. Players who left early keep
    /// what they earned; a run where debug mode was used awards nothing.
    pub fn awards(&self) -> Vec<Award> {
        if self.debug_used {
            return Vec::new();
        }
        self.players
            .iter()
            .filter_map(|p| Some(Award { token: p.token.clone()?, xp: p.xp, coins: p.coins }))
            .filter(|a| a.xp > 0 || a.coins > 0)
            .collect()
    }
}

/// Runs a dungeon until it ends or everyone has left, then tells the lobby.
pub async fn run_task(mut run: Run, mut rx: UnboundedReceiver<RunCmd>, lobby: SharedLobby) {
    for p in &run.players {
        run.send(p, &run.start_info(p));
    }
    let mut interval = tokio::time::interval(Duration::from_secs_f64(DT));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Burst);
    let mut avg_ms = 0.0f32;
    loop {
        interval.tick().await;
        while let Ok(cmd) = rx.try_recv() {
            run.handle(cmd);
        }
        let t0 = Instant::now();
        run.step();
        if run.tick % debug::PATH_EVERY == 0 {
            debug::send_paths(&run);
        }
        if run.tick % SNAPSHOT_EVERY == 0 {
            visibility::send_snapshots(&mut run);
        }
        let ms = t0.elapsed().as_secs_f32() * 1000.0;
        avg_ms = avg_ms * 0.95 + ms * 0.05;
        run.srv_ms = avg_ms;

        if let Some(victory) = run.finished() {
            let msg = run.end_msg(victory);
            for p in &run.players {
                run.send(p, &msg);
            }
            break;
        }
        if run.players.iter().all(|p| p.tx.is_none()) {
            break;
        }
    }
    lobby.lock().unwrap().run_finished(run.id, run.awards());
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use tokio::sync::mpsc::unbounded_channel;

    pub fn test_run(classes: &[ClassId], boss: BossId) -> Run {
        let members = classes
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let (tx, _rx) = unbounded_channel();
                std::mem::forget(_rx);
                Member { conn: i as u32 + 1, name: format!("p{i}"), class: *c, tx, token: None, upgrades: StatUpgrades::default() }
            })
            .collect();
        Run::new(1, members, 7, Some(boss))
    }

    #[test]
    fn awards_go_to_profiles_unless_debug_was_used() {
        let mut run = test_run(&[ClassId::Wizard, ClassId::Paladin], BossId::Demon);
        run.players[0].token = Some("a".into());
        run.players[0].xp = 40;
        run.players[0].coins = 12;
        run.players[1].xp = 10; // no profile
        assert_eq!(run.awards(), vec![Award { token: "a".into(), xp: 40, coins: 12 }]);
        run.set_debug(1, true);
        assert!(run.awards().is_empty());
        assert!(matches!(run.end_msg(true), ServerMsg::RunEnded { banked: false, .. }));
    }

    /// Moves player 0 onto `pos` and steps once.
    fn stand_at(run: &mut Run, pos: Vec2) {
        run.players[0].mv.x = pos.x;
        run.players[0].mv.y = pos.y;
        run.step();
    }

    #[test]
    fn touching_a_chest_opens_it_once_and_pays_the_party() {
        let mut run = test_run(&[ClassId::Wizard, ClassId::Paladin], BossId::Demon);
        run.monsters.clear(); // keep the test about the chest
        let id = run.alloc_id();
        let pos = run.dungeon.player_spawns[0] + Vec2::new(40.0, 0.0);
        run.chests.push(Chest { id, pos, opened: None });
        stand_at(&mut run, pos);
        let c = run.chests.iter().find(|c| c.id == id).unwrap();
        assert!(c.opened.is_some());
        let coins = run.players[0].coins;
        assert!(progression::CHEST_COINS.contains(&coins));
        assert_eq!(run.players[1].coins, coins, "the whole party gets the coins");
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Coins { .. })));
        stand_at(&mut run, pos);
        assert_eq!(run.players[0].coins, coins, "a chest pays only once");
    }

    #[test]
    fn mimic_sleeps_until_touched_then_waits_before_hunting() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        let pos = run.dungeon.player_spawns[0] + Vec2::new(60.0, 0.0);
        let id = run.spawn_enemy(EnemyType::Mimic, pos, None, 1);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].asleep = true;
        // A player in plain sight does not wake it; only touching does.
        stand_at(&mut run, pos - Vec2::new(30.0, 0.0));
        let mi = run.monster_idx(id).unwrap();
        assert!(run.monsters[mi].asleep);
        assert_eq!(run.monsters[mi].pos, pos);
        stand_at(&mut run, pos - Vec2::new(8.0, 0.0));
        let mi = run.monster_idx(id).unwrap();
        assert!(!run.monsters[mi].asleep);
        assert!(run.monsters[mi].ai.hold > 0.0);
        // The boss waking does not wake other mimics.
        let id2 = run.spawn_enemy(EnemyType::Mimic, pos + Vec2::new(0.0, 32.0), None, 1);
        let m2 = run.monster_idx(id2).unwrap();
        run.monsters[m2].asleep = true;
        let hall = run.dungeon.boss_hall().center_px();
        stand_at(&mut run, hall);
        let m2 = run.monster_idx(id2).unwrap();
        assert!(run.boss_awake);
        assert!(run.monsters[m2].asleep);
    }

    #[test]
    fn mimic_moves_only_while_airborne() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        let start = run.dungeon.player_spawns[0];
        let id = run.spawn_enemy(EnemyType::Mimic, start + Vec2::new(50.0, 0.0), None, 1);
        assert!(!run.dungeon.map.solid_at(start + Vec2::new(50.0, 0.0)));
        run.players[0].debug = true; // keep the target standing
        let mut moved_on_ground = false;
        let mut moved_in_air = false;
        for _ in 0..120 {
            let Some(mi) = run.monster_idx(id) else { break };
            let (before, anim_before) = (run.monsters[mi].pos, run.monsters[mi].anim);
            run.players[0].mv.x = start.x;
            run.players[0].mv.y = start.y;
            run.step();
            let mi = run.monster_idx(id).unwrap();
            if run.monsters[mi].pos.dist(before) > 0.01 {
                // The step advanced the clock before the AI ran, so this is the phase it used.
                let phase = ((run.time - run.monsters[mi].anim_start) / enemies::MIMIC_HOP_CYCLE).fract();
                let (a, b) = enemies::MIMIC_HOP_AIR;
                if anim_before == Anim::Move && phase >= a && phase < b {
                    moved_in_air = true;
                } else if phase >= 0.0 {
                    moved_on_ground = true;
                }
            }
        }
        assert!(moved_in_air, "the mimic never hopped");
        assert!(!moved_on_ground, "the mimic slid along the ground");
    }

    #[test]
    fn run_simulates_without_panicking() {
        for boss in BossId::ALL {
            let mut run = test_run(&ClassId::ALL, boss);
            for _ in 0..600 {
                run.step();
                visibility::send_snapshots(&mut run);
            }
        }
    }
}
