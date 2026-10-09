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
use crate::dungeon::{self, generate::{generate, Theme}, Dungeon, Mover, Tile};
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

/// What one character banks at the end of a run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Award {
    pub character: i32,
    pub xp: u32,
    pub coins: u32,
}

pub struct Member {
    pub conn: u32,
    pub name: String,
    pub class: ClassId,
    pub tx: UnboundedSender<Message>,
    /// Character the XP is banked to, and its bought upgrades.
    pub character: Option<i32>,
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
        let mut rng = ChaCha8Rng::seed_from_u64(seed ^ 0x5eed);
        let boss_id = boss.unwrap_or_else(|| BossId::ALL[rng.gen_range(0..BossId::ALL.len())]);
        let dungeon = generate(seed, Theme::for_boss(boss_id));
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
                mv: MoveState::at(p.x, p.y),
                hp: max_hp,
                max_hp,
                mods,
                xp: 0,
                coins: 0,
                character: m.character,
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
                sinking: None,
                last_safe: dungeon::Map::center_of(dungeon::Map::tile_of(p).0, dungeon::Map::tile_of(p).1),
                burn_t: dungeon::LAVA_TICK,
            });
        }
        let n = run.players.len();
        let spawns = run.dungeon.spawns.clone();
        for s in spawns {
            let t = enemies::for_boss(s.enemy, run.boss_id);
            run.spawn_enemy(t, s.pos, None, n);
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
            mover: if enemies::is_demon(t) { Mover::Demon } else { Mover::Enemy },
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
            mover: if self.boss_id == BossId::Demon { Mover::Demon } else { Mover::Enemy },
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
        self.terrain_player(pi);
        if !self.players[pi].alive {
            return;
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
        if p.sinking.is_some() {
            p.moving = false;
            return; // falling or drowning: no more moves or attacks (the client predicts this too)
        }
        let dashing = p.mv.dash_t > 0.0;
        // Pushed: the slide carries the hero; moves and abilities are ignored until it ends.
        let knocked = !dashing && p.mv.knocked();
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
        p.moving = !knocked && (input.mx != 0 || input.my != 0);
        if dashing {
            abilities::dash_contact(self, pi);
        }
        if knocked {
            return;
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

    /// The ground under a hero's centre: a chasm or (where a dash ended) deep
    /// water takes them, lava burns them. Mid-dash heroes are in the air.
    fn terrain_player(&mut self, pi: usize) {
        let p = &mut self.players[pi];
        if let Some((t, how)) = p.sinking {
            let t = t - DT;
            if t > 0.0 {
                p.sinking = Some((t, how));
            } else {
                p.sinking = None;
                self.kill_player(pi, how);
            }
            return;
        }
        if p.mv.dash_t > 0.0 {
            return;
        }
        let pos = p.pos();
        let (tx, ty) = dungeon::Map::tile_of(pos);
        let tile = self.dungeon.map.get(tx, ty);
        let how = if tile == Tile::Chasm as u8 {
            Some((dungeon::FALL_TIME, Sink::Fall))
        } else if tile == Tile::DeepWater as u8 {
            Some((dungeon::DROWN_TIME, Sink::Drown))
        } else {
            None
        };
        if let Some((t, how)) = how {
            p.sinking = Some((t, how));
            p.mv = MoveState::at(p.mv.x, p.mv.y);
            p.anim = Anim::Idle;
            p.anim_start = self.time;
            let id = p.id;
            self.event(Ev::Sink { id, x: pos.x as f32, y: pos.y as f32, how: how as u8 }, None);
            return;
        }
        if self.dungeon.map.safe(tx, ty) {
            // The tile centre: a hero always fits there, clear of its neighbours.
            p.last_safe = dungeon::Map::center_of(tx, ty);
        }
        if tile == Tile::Lava as u8 {
            p.burn_t += DT;
            if p.burn_t >= dungeon::LAVA_TICK {
                p.burn_t -= dungeon::LAVA_TICK;
                self.hurt_player(pi, dungeon::LAVA_DAMAGE);
            }
        } else {
            p.burn_t = dungeon::LAVA_TICK; // the first touch of lava burns at once
        }
    }

    /// Death by terrain: armour does not help. In debug mode the hero climbs
    /// back out onto the last safe ground instead.
    pub fn kill_player(&mut self, pi: usize, how: Sink) {
        let p = &mut self.players[pi];
        if !p.alive {
            return;
        }
        if p.debug {
            p.mv = MoveState::at(p.last_safe.x, p.last_safe.y);
            let (id, at) = (p.id, p.last_safe);
            self.event(Ev::Sink { id, x: at.x as f32, y: at.y as f32, how: 2 }, None);
            return;
        }
        p.hp = 0.0;
        p.alive = false;
        p.mv = MoveState::at(p.mv.x, p.mv.y);
        let (id, pos, kind, name) = (p.id, p.pos(), p.kind() as u8, p.name.clone());
        self.event(Ev::Died { id, x: pos.x as f32, y: pos.y as f32, kind }, None);
        let text = match how {
            Sink::Fall => format!("{name} fell into the abyss"),
            Sink::Drown => format!("{name} drowned"),
        };
        self.event(Ev::Msg { text }, None);
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
            p.mv = MoveState::at(p.mv.x, p.mv.y);
            let (id, kind, name) = (p.id, p.kind() as u8, p.name.clone());
            self.event(Ev::Died { id, x: pos.x as f32, y: pos.y as f32, kind }, None);
            self.event(Ev::Msg { text: format!("{name} has fallen") }, None);
        }
    }

    /// Knockback from a strong melee hit: the hero slides `dist` px straight
    /// away from `from` (along `fallback` if they stand on the same spot).
    /// Mid-dash heroes are in the air and not pushed; a new push replaces an
    /// old one. Only walls stop the slide, so it can end in a chasm or deep water.
    pub fn knock_player(&mut self, pi: usize, from: Vec2, fallback: f64, dist: f64) {
        let p = &mut self.players[pi];
        if !p.alive || p.sinking.is_some() || p.mv.dash_t > 0.0 || dist <= 0.0 {
            return;
        }
        let d = p.pos() - from;
        let dir = if d.len() > 0.01 { d.norm() } else { Vec2::from_angle(fallback) };
        let v = crate::collision::knock_speed(dist, DT);
        p.mv.knock_vx = dir.x * v;
        p.mv.knock_vy = dir.y * v;
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

    /// XP and coins to bank per character. Players who left early keep
    /// what they earned; a run where debug mode was used awards nothing.
    pub fn awards(&self) -> Vec<Award> {
        if self.debug_used {
            return Vec::new();
        }
        self.players
            .iter()
            .filter_map(|p| Some(Award { character: p.character?, xp: p.xp, coins: p.coins }))
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
    crate::lobby::finish_run(&lobby, run.id, run.awards()).await;
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use tokio::sync::mpsc::unbounded_channel;

    pub fn test_run(classes: &[ClassId], boss: BossId) -> Run {
        test_run_seed(classes, boss, 7)
    }

    pub fn test_run_seed(classes: &[ClassId], boss: BossId, seed: u64) -> Run {
        let members = classes
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let (tx, _rx) = unbounded_channel();
                std::mem::forget(_rx);
                Member { conn: i as u32 + 1, name: format!("p{i}"), class: *c, tx, character: None, upgrades: StatUpgrades::default() }
            })
            .collect();
        Run::new(1, members, seed, Some(boss))
    }

    #[test]
    fn awards_go_to_characters_unless_debug_was_used() {
        let mut run = test_run(&[ClassId::Wizard, ClassId::Paladin], BossId::Demon);
        run.players[0].character = Some(5);
        run.players[0].xp = 40;
        run.players[0].coins = 12;
        run.players[1].xp = 10; // no character
        assert_eq!(run.awards(), vec![Award { character: 5, xp: 40, coins: 12 }]);
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

    /// Player 0 alone with the (sleeping) boss, next to a fresh terrain tile.
    fn terrain_run(t: Tile) -> (Run, Vec2) {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let (tx, ty) = dungeon::Map::tile_of(run.dungeon.player_spawns[0]);
        run.dungeon.map.set(tx + 2, ty, t);
        (run, dungeon::Map::center_of(tx + 2, ty))
    }

    fn said(run: &Run, what: &str) -> bool {
        run.events.iter().any(|e| matches!(&e.0, Ev::Msg { text } if text.contains(what)))
    }

    #[test]
    fn chasm_kills_after_the_fall_and_debug_climbs_back_out() {
        let (mut run, at) = terrain_run(Tile::Chasm);
        let spawn = run.players[0].pos();
        // Mid-dash heroes jump it.
        run.players[0].mv.dash_t = 0.5;
        stand_at(&mut run, at);
        assert!(run.players[0].sinking.is_none());
        run.players[0].mv.dash_t = 0.0;
        stand_at(&mut run, at);
        assert!(matches!(run.players[0].sinking, Some((_, Sink::Fall))));
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Sink { how: 0, .. })));
        assert!(run.players[0].alive, "still falling");
        for _ in 0..=(dungeon::FALL_TIME / DT) as usize {
            run.step();
        }
        assert!(!run.players[0].alive);
        assert!(said(&run, "fell into the abyss"));

        let (mut run, at) = terrain_run(Tile::Chasm);
        run.set_debug(0, true);
        stand_at(&mut run, at);
        for _ in 0..=(dungeon::FALL_TIME / DT) as usize {
            run.step();
        }
        assert!(run.players[0].alive, "debug heroes survive");
        assert_eq!(run.players[0].pos(), dungeon::Map::center_of(dungeon::Map::tile_of(spawn).0, dungeon::Map::tile_of(spawn).1), "back on safe ground");
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Sink { how: 2, .. })));
    }

    #[test]
    fn a_dash_ending_in_deep_water_drowns() {
        let (mut run, at) = terrain_run(Tile::DeepWater);
        // Deep water stops walking...
        let before = run.players[0].pos();
        for _ in 0..60 {
            let seq = run.players[0].ack + 1;
            run.players[0].inputs.push_back(InputMsg { seq, mx: 1, ..Default::default() });
            run.step();
        }
        assert!(run.players[0].pos().x < at.x - 8.0, "walked into deep water from {before:?}");
        assert!(run.players[0].sinking.is_none());
        // ...but not a dash, and where the dash ends counts.
        stand_at(&mut run, at);
        assert!(matches!(run.players[0].sinking, Some((_, Sink::Drown))));
        for _ in 0..=(dungeon::DROWN_TIME / DT) as usize {
            run.step();
        }
        assert!(!run.players[0].alive);
        assert!(said(&run, "drowned"));
    }

    /// One input per step, as a connected client sends them.
    fn walk(run: &mut Run, mx: i8, primary: Option<u16>) {
        let seq = run.players[0].ack + 1;
        run.players[0].inputs.push_back(InputMsg { seq, mx, primary, ..Default::default() });
        run.step();
    }

    #[test]
    fn a_push_into_a_chasm_is_a_fall_and_the_hero_has_no_control_meanwhile() {
        let (mut run, at) = terrain_run(Tile::Chasm);
        stand_at(&mut run, at - Vec2::new(32.0, 0.0)); // a tile centre, 24 px from the chasm
        let start = run.players[0].pos();
        // Mid-dash heroes are in the air: no push.
        run.players[0].mv.dash_t = 0.1;
        run.knock_player(0, start - Vec2::new(10.0, 0.0), 0.0, 36.0);
        assert!(!run.players[0].mv.knocked());
        run.players[0].mv.dash_t = 0.0;
        // 36 px away from a hit on the left, while walking left and attacking: slides right into the chasm.
        run.knock_player(0, start - Vec2::new(10.0, 0.0), 0.0, 36.0);
        assert!(run.players[0].mv.knocked());
        walk(&mut run, -1, Some(1));
        assert_eq!(run.players[0].cd1, 0.0, "no attack while pushed");
        assert!(run.players[0].pos().x > start.x, "the input is ignored");
        for _ in 0..30 {
            if run.players[0].sinking.is_some() {
                break;
            }
            walk(&mut run, -1, None);
        }
        assert!(matches!(run.players[0].sinking, Some((_, Sink::Fall))), "pushed into the chasm at {at:?}");
        assert!(!run.players[0].mv.knocked(), "the fall ends the slide");
    }

    #[test]
    fn a_short_push_stops_and_control_returns() {
        let (mut run, at) = terrain_run(Tile::Chasm);
        stand_at(&mut run, at - Vec2::new(32.0, 0.0));
        let start = run.players[0].pos();
        // 14 px (a chort): stops short of the chasm 24 px away.
        run.knock_player(0, start - Vec2::new(10.0, 0.0), 0.0, 14.0);
        for _ in 0..30 {
            walk(&mut run, 0, None);
        }
        assert!(!run.players[0].mv.knocked());
        assert!(run.players[0].sinking.is_none());
        assert!((run.players[0].pos().x - (start.x + 14.0)).abs() < 1.0, "x {}", run.players[0].pos().x);
        walk(&mut run, 0, Some(1));
        assert!(run.players[0].cd1 > 0.0, "attacks again");
    }

    #[test]
    fn lava_burns_heroes_over_time() {
        let (mut run, at) = terrain_run(Tile::Lava);
        let hp = run.players[0].hp;
        stand_at(&mut run, at);
        assert_eq!(run.players[0].hp, hp - dungeon::LAVA_DAMAGE, "burns at once");
        for _ in 0..69 {
            run.step();
        }
        // About a second in lava: the first touch plus two ticks.
        assert!((run.players[0].hp - (hp - 3.0 * dungeon::LAVA_DAMAGE)).abs() < 1e-9, "hp {}", run.players[0].hp);
        assert!(run.players[0].alive);
    }

    #[test]
    fn only_demons_are_lava_walkers() {
        let demon = test_run(&[ClassId::Paladin], BossId::Demon);
        let boss = demon.monsters.iter().find(|m| m.is_boss).unwrap();
        assert_eq!(boss.mover, Mover::Demon);
        assert!(demon.monsters.iter().filter(|m| m.etype == Some(EnemyType::Imp)).all(|m| m.mover == Mover::Demon));
        let lich = test_run(&[ClassId::Paladin], BossId::Lich);
        assert!(lich.monsters.iter().all(|m| m.mover == Mover::Enemy));
    }

    #[test]
    fn mimic_moves_only_while_airborne() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        let start = run.dungeon.player_spawns[0];
        let id = run.spawn_enemy(EnemyType::Mimic, start + Vec2::new(50.0, 0.0), None, 1);
        assert!(!run.dungeon.map.blocks_at(start + Vec2::new(50.0, 0.0), Mover::Enemy));
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
