//! One dungeon run: an authoritative 60 Hz simulation in its own tokio task.

pub mod abilities;
pub mod ai;
pub mod bosses;
pub mod companion;
pub mod debug;
pub mod effects;
pub mod entities;
pub mod levels;
pub mod light;
pub mod objects;
pub mod perception;
pub mod rules_log;
pub mod visibility;

use crate::collision::MoveState;
use crate::defs::damage::{kind_split, resolve, Damage, DamageSplit, DamageType, What, Why};
use crate::defs::attributes::{push_dist, Attr};
use crate::defs::progression;
use crate::defs::{classes, enemies};
use crate::defs::enemies::EnemyType;
use crate::defs::loadout::Build;
use crate::defs::kinds::{Anim, EntityKind};
use crate::dungeon::{self, Layout, Mover, Tile};
use crate::vispoly::View;
use crate::lobby::SharedLobby;
use crate::math::Vec2;
use crate::telemetry;
use crate::protocol::{encode, BossId, ClassId, ClientMsg, Ev, InputMsg, LevelChoice, LevelId, PlayerInfo, PlayerStats, RunStartInfo, ServerMsg};
use axum::extract::ws::Message;
use levels::Level;
use entities::*;
use effects::Apply;
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
pub(crate) const END_DELAY: f64 = 3.0;

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
    /// Account and character the XP is banked to.
    pub account: Option<i32>,
    pub character: Option<i32>,
    /// Extra Attributes, equipment, loadout and bought upgrades (validated in the lobby).
    pub build: Build,
    /// The loadout was set with the debug message (counts as a debug run).
    pub debug_loadout: bool,
}

/// How a run ended, for the statistics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Victory,
    Defeat,
    /// Everyone left before the end.
    Abandoned,
}

impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Outcome::Victory => "victory",
            Outcome::Defeat => "defeat",
            Outcome::Abandoned => "abandoned",
        }
    }
}

/// A finished run as the statistics store it (`db::record_run`).
#[derive(Debug, Clone)]
pub struct RunRecord {
    pub level: LevelId,
    pub boss: Option<BossId>,
    pub outcome: Outcome,
    pub duration_s: f64,
    pub debug: bool,
    pub players: Vec<RunPlayerRecord>,
}

#[derive(Debug, Clone)]
pub struct RunPlayerRecord {
    pub account: Option<i32>,
    pub character: Option<i32>,
    pub class: ClassId,
    pub kills: u32,
    pub damage: f64,
    pub healing: f64,
    pub xp: u32,
    pub coins: u32,
    /// Alive at the end.
    pub survived: bool,
    /// Left before the end: neither survived nor died.
    pub left: bool,
}

impl RunPlayerRecord {
    pub fn died(&self) -> bool {
        !self.survived && !self.left
    }
}

pub enum RunCmd {
    Msg { conn: u32, msg: ClientMsg },
    Leave { conn: u32 },
}

pub struct Run {
    pub id: u32,
    pub tick: u32,
    pub time: f64,
    pub layout: Layout,
    pub level: Level,
    pub players: Vec<Player>,
    pub monsters: Vec<Monster>,
    pub projectiles: Vec<Projectile>,
    pub hazards: Vec<Hazard>,
    pub objects: Vec<objects::WorldObject>,
    pub lights: light::Lights,
    /// Events since the last snapshot, with an optional position for FOV filtering.
    pub events: Vec<(Ev, Option<Vec2>)>,
    /// Indices into `events` of events on a hero: sent wherever the hero is in sight, lit or not.
    pub on_hero: Vec<usize>,
    pub next_id: u32,
    pub rng: ChaCha8Rng,
    pub ended: Option<(bool, f64)>,
    /// Someone used debug mode (immortal): no XP is banked for this run.
    pub debug_used: bool,
    pub srv_ms: f32,
    pub log: rules_log::RulesLog,
    /// Test-only capture of the last `Damage` that reached `hurt_monster` or `hurt_player`.
    #[cfg(test)]
    pub last_hit: Option<Damage>,
}

/// A patch of fire that hurts heroes and allies (the dragon's; the wolf's fire).
pub fn spawn_fire_patch(run: &mut Run, pos: Vec2, radius: f64, life: f64, damage: f64) {
    let kind = EntityKind::FirePatch;
    run.spawn_hazard(kind, pos, radius, life, HazardSide::Monsters, HazardPulse::Hurt(Damage::new(damage, kind_split(kind))));
}

/// A hazard's pulse as a hit: a pulse that came from an ability keeps its source; the rest are the
/// hazard's own, by its owner when it has one.
fn hazard_hit(dmg: Damage, kind: EntityKind, owner: Option<u32>) -> Damage {
    if dmg.why.what != What::Unknown {
        return dmg;
    }
    Damage { why: Why { by: owner, what: What::Hazard(kind), ..dmg.why }, ..dmg }
}

impl Run {
    pub fn new(id: u32, members: Vec<Member>, seed: u64, choice: LevelChoice) -> Run {
        let mut rng = ChaCha8Rng::seed_from_u64(seed ^ 0x5eed);
        let (layout, level) = Level::build(seed, &choice, &mut rng);
        let (w, h) = (layout.map.w, layout.map.h);
        let mut run = Run {
            id,
            tick: 0,
            time: 0.0,
            players: Vec::new(),
            monsters: Vec::new(),
            projectiles: Vec::new(),
            hazards: Vec::new(),
            objects: Vec::new(),
            lights: light::Lights::new(w, h),
            events: Vec::new(),
            on_hero: Vec::new(),
            next_id: 1,
            rng,
            ended: None,
            debug_used: false,
            srv_ms: 0.0,
            log: rules_log::RulesLog::default(),
            #[cfg(test)]
            last_hit: None,
            layout,
            level,
        };
        run.debug_used = members.iter().any(|m| m.debug_loadout);
        for (i, m) in members.into_iter().enumerate() {
            let sheet = crate::sheet::hero_sheet(m.class, &m.build).expect("validated in the lobby");
            let max_hp = sheet.max_hp;
            let p = run.layout.player_spawns[i % run.layout.player_spawns.len()];
            let id = run.alloc_id();
            run.players.push(Player {
                id,
                res: sheet.res,
                conn: m.conn,
                tx: Some(m.tx),
                name: m.name,
                class: m.class,
                kind: classes::def(m.class).kind,
                mv: MoveState::at(p.x, p.y),
                hp: max_hp,
                max_hp,
                xp: 0,
                coins: 0,
                account: m.account,
                character: m.character,
                alive: true,
                aim: 0.0,
                aim_dist: 0.0,
                cd1: 0.0,
                cd2: 0.0,
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
                view: View::new(w, h),
                kills: 0,
                left: false,
                damage: 0.0,
                healing: 0.0,
                debug: false,
                sinking: None,
                last_safe: dungeon::Map::center_of(dungeon::Map::tile_of(p).0, dungeon::Map::tile_of(p).1),
                burn_t: dungeon::LAVA_TICK,
                sight: sheet.sight,
                darkvision: None,
                effects: effects::Effects::default(),
                wolf: None,
                slam: None,
                sheet,
            });
            // An item's light goes with its wearer (light ids are separate from entity ids).
            if let Some(k) = run.players.last().unwrap().sheet.light {
                run.add_light(k, light::Anchor::Entity(id), None);
            }
        }
        let spawns = run.layout.spawns.clone();
        for s in spawns {
            let t = run.level.enemy_type(s.enemy);
            run.spawn_enemy(t, s.pos, None);
        }
        // Mimics are monsters from the start, hiding and drawn as a closed chest.
        for c in run.layout.chests.clone() {
            if c.mimic {
                let id = run.spawn_enemy(EnemyType::Mimic, c.pos, None);
                let mi = run.monster_idx(id).unwrap();
                run.monsters[mi].hiding = true;
            } else {
                run.spawn_object(EntityKind::Chest, c.pos, objects::ObjState::Chest { opened: None });
            }
        }
        Level::populate(&mut run);
        // Barrels last, so every other entity keeps its id.
        for b in run.layout.barrels.clone() {
            run.spawn_object(EntityKind::Barrel, b, objects::ObjState::Barrel(objects::Barrel::new()));
        }
        // Torches after the barrels, so every other entity keeps its id.
        for t in run.layout.torches.clone() {
            run.spawn_torch(&t);
        }
        // Lava glows from the start (light ids are separate from entity ids).
        run.add_lava_lights();
        run
    }

    pub fn alloc_id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    pub fn spawn_enemy(&mut self, t: EnemyType, pos: Vec2, owner: Option<u32>) -> u32 {
        let d = enemies::def(t);
        let prof = enemies::profile(t);
        let stats = crate::sheet::enemy_stats(t);
        let id = self.alloc_id();
        let hp = stats.max_hp;
        self.monsters.push(Monster {
            id,
            res: prof.res,
            melee: enemies::melee_split(t),
            etype: Some(t),
            kind: d.kind,
            pos,
            hp,
            max_hp: hp,
            speed: stats.speed,
            radius: d.radius,
            sight: prof.sight,
            alive: true,
            aim: 0.0,
            anim: Anim::Idle,
            anim_start: self.time,
            hurt_t: 0.0,
            ai: Ai::new(pos),
            owner,
            history: VecDeque::with_capacity(HISTORY_LEN),
            is_boss: false,
            dormant: false,
            hiding: false,
            mover: if enemies::is_demon(t) { Mover::Demon } else { Mover::Enemy },
            airborne: false,
            knock: Vec2::ZERO,
            sinking: None,
            burn_t: dungeon::LAVA_TICK,
            last_hit_by: None,
            effects: effects::Effects::default(),
            effect_res: prof.effect_res,
            attrs: stats.attrs,
            weight: stats.weight,
            ally: None,
        });
        rules_log::spawned(self, id, d.kind);
        id
    }

    pub fn start_info(&self, p: &Player) -> ServerMsg {
        ServerMsg::RunStarted(RunStartInfo {
            level: self.level.id(),
            width: self.layout.map.w as u16,
            height: self.layout.map.h as u16,
            tiles: self.layout.map.tiles.clone(),
            tile_size: crate::dungeon::TILE as u16,
            you: p.id,
            players: self.players.iter().map(|q| PlayerInfo { ent: q.id, name: q.name.clone(), class: q.class }).collect(),
            spawn_x: p.mv.x,
            spawn_y: p.mv.y,
            speed: p.sheet.speed,
            abilities: [p.sheet.primary, p.sheet.secondary],
            fallback: p.sheet.fallback,
            lights: self.light_infos(),
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

    /// An event on a hero (their damage or healing): seen wherever the hero is
    /// in sight, even in the dark (heroes are always drawn).
    pub fn event_on_hero(&mut self, ev: Ev, pos: Vec2) {
        self.on_hero.push(self.events.len());
        self.event(ev, Some(pos));
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
                    ClientMsg::DebugDarkvision { ratio } => self.set_darkvision(pi, ratio),
                    ClientMsg::DebugEffect { kind } => self.debug_effect(pi, kind),
                    ClientMsg::RulesLog { on, details } => rules_log::set_prefs(self, pi, on, details),
                    _ => {}
                }
            }
            RunCmd::Leave { conn } => {
                if let Some(pi) = self.players.iter().position(|p| p.conn == conn) {
                    let p = &mut self.players[pi];
                    p.tx = None;
                    if p.alive {
                        p.alive = false;
                        p.left = true;
                        let (id, pos, kind) = (p.id, p.pos(), p.kind() as u8);
                        self.event(Ev::Died { id, x: pos.x as f32, y: pos.y as f32, kind }, None);
                        let name = self.players[pi].name.clone();
                        self.event(Ev::Msg { text: format!("{name} left the dungeon") }, None);
                    }
                    rules_log::forget(self, self.players[pi].id);
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
        self.tick_effects();

        for pi in 0..self.players.len() {
            self.step_player(pi);
        }
        companion::vanish_orphans(self);
        self.touch_chests();
        self.refresh_lights(); // the AI perceives by the lights of this tick

        let player_pos: Vec<Vec2> = self.players.iter().filter(|p| p.alive).map(|p| p.pos()).collect();
        for mi in 0..self.monsters.len() {
            let m = &self.monsters[mi];
            if !m.alive || m.is_boss {
                continue;
            }
            if m.sinking.is_some() || m.knock != Vec2::ZERO {
                continue; // slid and sunk below
            }
            if m.effects.no_act() {
                // Asleep or stone: no thinking, attacks or wind-ups.
                let m = &mut self.monsters[mi];
                m.ai.windup = None;
                if m.anim != Anim::Idle {
                    m.anim = Anim::Idle;
                    m.anim_start = self.time;
                }
                continue;
            }
            if m.effects.fear_from().is_some() && !m.hiding && !m.dormant {
                ai::flee(self, mi, DT);
                continue;
            }
            if m.is_ally() {
                companion::tick_wolf(self, mi, DT);
                continue;
            }
            if self.layout.map.blocks_at(m.pos, m.mover) {
                ai::escape_terrain(self, mi, DT);
                continue;
            }
            let active = player_pos.iter().any(|pp| pp.dist2(m.pos) < ACTIVE_RANGE * ACTIVE_RANGE);
            if active {
                ai::tick_monster(self, mi, DT);
            }
        }
        Level::tick(self, DT);
        ai::separate_monsters(self);
        for mi in 0..self.monsters.len() {
            if self.monsters[mi].alive && !self.monsters[mi].is_boss {
                self.slide_monster(mi);
                self.terrain_monster(mi);
            }
        }

        abilities::tick_projectiles(self, DT);
        self.tick_hazards(DT);
        objects::tick_objects(self, DT);

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
        self.objects.retain(|o| !o.gone);
        self.sweep_lights();

        Level::post_tick(self);
        self.check_end();
    }

    fn step_player(&mut self, pi: usize) {
        let p = &mut self.players[pi];
        p.hurt_t = (p.hurt_t - DT).max(0.0);
        if !p.alive {
            p.slam = None;
            p.inputs.clear();
            let spec = p.spectating;
            if spec.map_or(true, |s| !self.players.iter().any(|q| q.id == s && q.alive)) {
                let first = self.players.iter().find(|q| q.alive).map(|q| q.id);
                self.players[pi].spectating = first;
            }
            return;
        }
        abilities::tick_slam(self, pi);
        let p = &mut self.players[pi];
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
        let solids = self.solids(None);
        let map = &self.layout.map;
        let p = &mut self.players[pi];
        p.ack = input.seq;
        let fx = (p.effects.speed_mul(), p.effects.no_act(), p.effects.no_turn());
        if !fx.2 {
            p.aim = input.aim as f64;
            p.aim_dist = input.aim_dist as f64;
        }
        p.view_lag = (input.view_lag as f64 / 1000.0).clamp(0.0, 0.45);
        p.rtt = (input.rtt as f64 / 1000.0).clamp(0.0, 0.5);
        p.cd1 = (p.cd1 - DT).max(0.0);
        p.cd2 = (p.cd2 - DT).max(0.0);
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
            if fx.0 == 0.0 { 0 } else { input.mx },
            if fx.0 == 0.0 { 0 } else { input.my },
            p.sheet.speed * fx.0,
            crate::defs::abilities::DASH_SPEED,
            classes::PLAYER_RADIUS,
            DT,
            &solids,
        );
        p.moving = !knocked && fx.0 > 0.0 && (input.mx != 0 || input.my != 0);
        if dashing {
            abilities::dash_contact(self, pi);
        }
        if knocked {
            return;
        }
        if fx.1 {
            return;
        }
        if input.act {
            objects::use_object(self, pi);
        }
        if let Some(shot) = input.primary {
            abilities::try_use(self, pi, true, shot);
        }
        if let Some(shot) = input.secondary {
            abilities::try_use(self, pi, false, shot);
        }
    }

    /// A blast pushes a monster straight away from `from`: `dist` px by a pusher
    /// of STR `str`, less or not at all against its weight (`push_dist`). Bosses
    /// and flying monsters are never pushed; only walls and solids stop the
    /// slide, so it can end in a chasm, deep water or lava.
    pub fn knock_monster(&mut self, mi: usize, from: Vec2, dist: f64, str: i32) {
        let m = &mut self.monsters[mi];
        let dist = push_dist(dist, str, m.weight);
        if !m.alive || m.is_boss || m.airborne || m.sinking.is_some() || dist <= 0.0 {
            return;
        }
        if m.ally.as_ref().is_some_and(|a| a.dash.is_some()) {
            return; // a dashing wolf is in the air, like a dashing hero
        }
        let dist = dist * m.effects.knock_taken();
        let d = m.pos - from;
        let dir = if d.len() > 0.01 { d.norm() } else { Vec2::new(1.0, 0.0) };
        m.knock = dir * crate::collision::knock_speed(dist, DT);
    }

    fn slide_monster(&mut self, mi: usize) {
        let v = self.monsters[mi].knock;
        if v == Vec2::ZERO {
            return;
        }
        let solids = self.solids(None);
        let m = &mut self.monsters[mi];
        let (x, y) = crate::collision::move_box(&self.layout.map, m.pos.x, m.pos.y, v.x * DT, v.y * DT, m.radius, Mover::Dash, &solids);
        m.pos = Vec2::new(x, y);
        m.knock = v * crate::defs::abilities::KNOCK_DECAY;
        if m.knock.len() < crate::defs::abilities::KNOCK_MIN_SPEED {
            m.knock = Vec2::ZERO;
        }
    }

    /// The ground under a monster's centre, like `terrain_player`: chasms and
    /// deep water take it (kill credit to the last hero who hurt it), lava
    /// burns monsters that are not lava walkers. The wolf is in the air while it
    /// dashes, and over a chasm with its dash ready it dashes back to safe ground.
    fn terrain_monster(&mut self, mi: usize) {
        let m = &mut self.monsters[mi];
        if !m.alive || m.is_boss || m.airborne || m.ally.as_ref().is_some_and(|a| a.dash.is_some()) {
            return;
        }
        if let Some((t, how)) = m.sinking {
            if t - DT > 0.0 {
                m.sinking = Some((t - DT, how));
            } else {
                m.sinking = None;
                if let Some(pi) = m.last_hit_by {
                    self.players[pi].kills += 1;
                }
                self.kill_monster(mi);
            }
            return;
        }
        let pos = m.pos;
        let (tx, ty) = dungeon::Map::tile_of(pos);
        let tile = self.layout.map.get(tx, ty);
        if let Some(a) = m.ally.as_mut() {
            if tile == Tile::Chasm as u8 && a.dash_cd <= 0.0 {
                m.knock = Vec2::ZERO;
                companion::dash_back(self, mi);
                return;
            }
            if self.layout.map.safe(tx, ty) {
                a.last_safe = dungeon::Map::center_of(tx, ty);
            }
        }
        let how = if tile == Tile::Chasm as u8 {
            Some((dungeon::FALL_TIME, Sink::Fall))
        } else if tile == Tile::DeepWater as u8 {
            Some((dungeon::DROWN_TIME, Sink::Drown))
        } else {
            None
        };
        if let Some((t, how)) = how {
            m.sinking = Some((t, how));
            m.knock = Vec2::ZERO;
            m.ai.windup = None;
            m.anim = Anim::Idle;
            m.anim_start = self.time;
            let id = m.id;
            self.event(Ev::Sink { id, x: pos.x as f32, y: pos.y as f32, how: how as u8 }, Some(pos));
            return;
        }
        if tile == Tile::Lava as u8 && m.mover != Mover::Demon {
            m.burn_t += DT;
            if m.burn_t >= dungeon::LAVA_TICK {
                m.burn_t -= dungeon::LAVA_TICK;
                self.hurt_monster(mi, Damage { why: Why { what: What::Lava, ..Why::NONE }, ..Damage::new(dungeon::LAVA_DAMAGE, DamageSplit::pure(DamageType::Heat)) }, false, None);
            }
        } else {
            m.burn_t = dungeon::LAVA_TICK;
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
        let tile = self.layout.map.get(tx, ty);
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
        if self.layout.map.safe(tx, ty) {
            // The tile centre: a hero always fits there, clear of its neighbours.
            p.last_safe = dungeon::Map::center_of(tx, ty);
        }
        if tile == Tile::Lava as u8 {
            p.burn_t += DT;
            if p.burn_t >= dungeon::LAVA_TICK {
                p.burn_t -= dungeon::LAVA_TICK;
                self.hurt_player(pi, Damage { why: Why { what: What::Lava, ..Why::NONE }, ..Damage::new(dungeon::LAVA_DAMAGE, DamageSplit::pure(DamageType::Heat)) });
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
        for oi in 0..self.objects.len() {
            let o = &self.objects[oi];
            let objects::ObjState::Chest { opened: None } = o.state else { continue };
            if o.gone || !near(o.pos) {
                continue;
            }
            let pos = o.pos;
            self.objects[oi].state = objects::ObjState::Chest { opened: Some(self.time) };
            let coins = self.rng.gen_range(progression::CHEST_COINS);
            self.give_coins(pos, coins);
        }
        for mi in 0..self.monsters.len() {
            let m = &self.monsters[mi];
            if m.alive && m.hiding && m.etype == Some(EnemyType::Mimic) && near(m.pos) {
                self.wake_mimic(mi);
            }
        }
    }

    /// The mimic drops its disguise: a short pause while the lid flies open, then it hunts.
    pub fn wake_mimic(&mut self, mi: usize) {
        rules_log::revealed(self, self.monsters[mi].id);
        let m = &mut self.monsters[mi];
        m.hiding = false;
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
            let (pos, r, side, pulse, kind) = (h.pos, h.radius, h.side, h.pulse, h.kind);
            match (side, pulse) {
                (HazardSide::Monsters, HazardPulse::Hurt(dmg)) => {
                    let dmg = hazard_hit(dmg, kind, None);
                    for c in self.foes_touching(pos, r, false) {
                        self.hurt_creature(c, dmg);
                    }
                    objects::hurt_objects_in(self, pos, r, None, dmg);
                }
                (HazardSide::Monsters, HazardPulse::Bind(on)) => {
                    for c in self.foes_touching(pos, r, false) {
                        self.apply(c, Apply::from_hit(on));
                    }
                }
                (HazardSide::Heroes { owner }, HazardPulse::Hurt(dmg)) => {
                    let dmg = hazard_hit(dmg, kind, Some(owner));
                    let credit = self.players.iter().position(|p| p.id == owner);
                    for mi in self.enemies_touching(pos, r) {
                        self.hurt_monster(mi, dmg, false, credit);
                    }
                }
                (HazardSide::Heroes { owner }, HazardPulse::Bind(on)) => {
                    let from = self.players.iter().find(|p| p.id == owner).map_or(pos, |p| p.pos());
                    for mi in self.enemies_touching(pos, r) {
                        self.apply(effects::Creature::Monster(mi), Apply { source: Some((owner, from)), ..Apply::from_hit(on) });
                    }
                }
            }
        }
    }

    /// The living, awake enemy monsters (not allies, not hiding mimics or dormant ones) whose
    /// bodies touch the circle at `at` and that its centre can see (a hazard does not reach through walls).
    fn enemies_touching(&self, at: Vec2, r: f64) -> Vec<usize> {
        (0..self.monsters.len())
            .filter(|&mi| {
                let m = &self.monsters[mi];
                m.alive && !m.is_ally() && !m.hiding && !m.dormant && m.sinking.is_none() && m.pos.dist(at) < r + m.radius && crate::collision::line_of_sight(&self.layout.map, at, m.pos)
            })
            .collect()
    }

    pub fn spawn_hazard(&mut self, kind: EntityKind, pos: Vec2, radius: f64, life: f64, side: HazardSide, pulse: HazardPulse) {
        let id = self.alloc_id();
        self.hazards.push(Hazard { id, kind, pos, radius, life, pulse_t: 0.25, side, pulse });
        self.attach_kind_light(id, kind);
    }

    pub fn hurt_player(&mut self, pi: usize, dmg: Damage) {
        #[cfg(test)]
        {
            self.last_hit = Some(dmg);
        }
        if !self.players[pi].alive {
            return;
        }
        if let (0.0, Some(h), false) = (dmg.amount, dmg.on_hit, dmg.from_effect) {
            self.hit_effect(effects::Creature::Player(pi), h); // a pure effect hit: no number, no flash
            return;
        }
        let raw = resolve(&dmg, &self.players[pi].effects.res(self.players[pi].res));
        if raw < 0.0 {
            self.heal_player(pi, -raw);
            return;
        }
        let p = &mut self.players[pi];
        let v = raw * (1.0 - p.sheet.armor);
        let imm = raw == 0.0 && dmg.amount > 0.0;
        // Debug mode: hits still show, but nothing is subtracted.
        if !p.debug {
            p.hp -= v;
        }
        if !imm {
            p.hurt_t = 0.15;
        }
        let pos = p.pos();
        let ty = dmg.split.main_type() as u8;
        self.event_on_hero(Ev::Dmg { x: pos.x as f32, y: pos.y as f32 - 10.0, v: v as f32, crit: false, p: true, ty, imm }, pos);
        let p = &mut self.players[pi];
        if p.hp <= 0.0 {
            p.hp = 0.0;
            p.alive = false;
            p.mv = MoveState::at(p.mv.x, p.mv.y);
            let (id, kind, name) = (p.id, p.kind() as u8, p.name.clone());
            self.event(Ev::Died { id, x: pos.x as f32, y: pos.y as f32, kind }, None);
            self.event(Ev::Msg { text: format!("{name} has fallen") }, None);
        }
        if self.players[pi].alive && !dmg.from_effect {
            if v > 0.0 {
                self.damage_wakes(effects::Creature::Player(pi));
            }
            self.type_effect_hit(effects::Creature::Player(pi), &dmg);
            if let Some(h) = dmg.on_hit {
                self.hit_effect(effects::Creature::Player(pi), h);
            }
        }
    }

    /// Knockback from a strong melee hit: the hero slides straight away from
    /// `from` (along `fallback` if they stand on the same spot), `dist` px by a
    /// pusher of STR `str`, less or not at all against their weight (`push_dist`).
    /// Mid-dash heroes are in the air and not pushed; a new push replaces an
    /// old one. Only walls stop the slide, so it can end in a chasm or deep water.
    pub fn knock_player(&mut self, pi: usize, from: Vec2, fallback: f64, dist: f64, str: i32) {
        let p = &mut self.players[pi];
        let dist = push_dist(dist, str, p.sheet.weight);
        if !p.alive || p.sinking.is_some() || p.mv.dash_t > 0.0 || dist <= 0.0 {
            return;
        }
        let dist = dist * p.effects.knock_taken();
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
            self.event_on_hero(Ev::Heal { x: pos.x as f32, y: pos.y as f32 - 10.0, v: healed as f32, p: true }, pos);
        }
        healed
    }

    /// Living heroes and living allies (not sinking) whose centre is within `r` of `at`, optionally inside a cone (dir, half-angle). Heroes first.
    pub fn foes_in(&self, at: Vec2, r: f64, cone: Option<(f64, f64)>) -> Vec<effects::Creature> {
        let inside = |p: Vec2| p.dist(at) <= r && cone.map_or(true, |(dir, half)| crate::math::angle_diff(at.angle_to(p), dir).abs() <= half);
        let heroes = self.players.iter().enumerate().filter(|(_, p)| p.alive && inside(p.pos())).map(|(i, _)| effects::Creature::Player(i));
        let allies = self.monsters.iter().enumerate().filter(|(_, m)| m.is_ally() && m.alive && m.sinking.is_none() && inside(m.pos)).map(|(i, _)| effects::Creature::Monster(i));
        heroes.chain(allies).collect()
    }

    /// Living heroes within r + PLAYER_RADIUS and allies within r + radius of `at`; with `los`, only those in line of sight.
    pub fn foes_touching(&self, at: Vec2, r: f64, los: bool) -> Vec<effects::Creature> {
        let reach = |p: Vec2, radius: f64| p.dist(at) < r + radius && (!los || crate::collision::line_of_sight(&self.layout.map, at, p));
        let heroes = self.players.iter().enumerate().filter(|(_, p)| p.alive && reach(p.pos(), classes::PLAYER_RADIUS)).map(|(i, _)| effects::Creature::Player(i));
        let allies = self.monsters.iter().enumerate().filter(|(_, m)| m.is_ally() && m.alive && m.sinking.is_none() && reach(m.pos, m.radius)).map(|(i, _)| effects::Creature::Monster(i));
        heroes.chain(allies).collect()
    }

    pub fn creature_pos(&self, c: effects::Creature) -> Vec2 {
        match c {
            effects::Creature::Player(i) => self.players[i].pos(),
            effects::Creature::Monster(i) => self.monsters[i].pos,
        }
    }

    pub fn creature_id(&self, c: effects::Creature) -> u32 {
        match c {
            effects::Creature::Player(i) => self.players[i].id,
            effects::Creature::Monster(i) => self.monsters[i].id,
        }
    }

    /// The body radius a melee reach is measured to.
    pub fn creature_radius(&self, c: effects::Creature) -> f64 {
        match c {
            effects::Creature::Player(_) => classes::PLAYER_RADIUS,
            effects::Creature::Monster(i) => self.monsters[i].radius,
        }
    }

    /// An enemy attack on a hero or an ally (no hero is the source).
    pub fn hurt_creature(&mut self, c: effects::Creature, dmg: Damage) {
        match c {
            effects::Creature::Player(i) => self.hurt_player(i, dmg),
            effects::Creature::Monster(i) => {
                self.hurt_monster(i, dmg, false, None);
            }
        }
    }

    pub fn knock_creature(&mut self, c: effects::Creature, from: Vec2, fallback: f64, dist: f64, str: i32) {
        match c {
            effects::Creature::Player(i) => self.knock_player(i, from, fallback, dist, str),
            effects::Creature::Monster(i) => self.knock_monster(i, from, dist, str),
        }
    }

    /// The STR monster `mi` pushes with: its own, or `BOSS_KNOCK_STR` for a boss's scripted pushes.
    pub fn push_str(&self, mi: usize) -> i32 {
        let m = &self.monsters[mi];
        if m.is_boss {
            crate::defs::bosses::BOSS_KNOCK_STR
        } else {
            m.attrs.get(Attr::Str)
        }
    }

    /// Heals monster `mi` up to its maximum; returns what it gained. Shown like a hero's heal for an ally.
    pub fn heal_monster(&mut self, mi: usize, amount: f64) -> f64 {
        let m = &mut self.monsters[mi];
        if !m.alive {
            return 0.0;
        }
        let healed = amount.min(m.max_hp - m.hp).max(0.0);
        m.hp += healed;
        let (pos, ally) = (m.pos, m.is_ally());
        if healed > 0.0 {
            let ev = Ev::Heal { x: pos.x as f32, y: pos.y as f32 - 10.0, v: healed as f32, p: ally };
            if ally {
                self.event_on_hero(ev, pos);
            } else {
                self.event(ev, Some(pos));
            }
        }
        healed
    }

    /// Returns true if the monster took damage.
    pub fn hurt_monster(&mut self, mi: usize, dmg: Damage, crit: bool, src_player: Option<usize>) -> bool {
        #[cfg(test)]
        {
            self.last_hit = Some(dmg);
        }
        if !self.monsters[mi].alive {
            return false;
        }
        let pos = self.monsters[mi].pos;
        let ally = self.monsters[mi].is_ally();
        if ally && src_player.is_some() {
            return false; // no hero attack hurts an ally
        }
        if self.monsters[mi].is_boss && !Level::on_boss_hurt(self, mi) {
            return false;
        }
        if let (0.0, Some(h), false) = (dmg.amount, dmg.on_hit, dmg.from_effect) {
            self.hit_effect(effects::Creature::Monster(mi), h);
            return true;
        }
        let raw = resolve(&dmg, &self.monsters[mi].effects.res(self.monsters[mi].res));
        let ty = dmg.split.main_type() as u8;
        // Hits by heroes go to the whole party, even out of view: the shot was seen leaving.
        let seen_by = src_player.is_none().then_some(pos);
        if raw < 0.0 {
            let m = &mut self.monsters[mi];
            let healed = (-raw).min(m.max_hp - m.hp);
            m.hp += healed;
            if healed > 0.0 {
                let ev = Ev::Heal { x: pos.x as f32, y: pos.y as f32 - 10.0, v: healed as f32, p: ally };
                if ally {
                    self.event_on_hero(ev, pos);
                } else {
                    self.event(ev, seen_by);
                }
            }
            return true;
        }
        let imm = raw == 0.0 && dmg.amount > 0.0;
        let m = &mut self.monsters[mi];
        m.hp -= raw;
        if !imm {
            m.hurt_t = 0.15;
        }
        let applied = raw.min(m.hp + raw);
        let ev = Ev::Dmg { x: pos.x as f32, y: pos.y as f32 - 10.0, v: raw as f32, crit, p: ally, ty, imm };
        if ally {
            self.event_on_hero(ev, pos); // shown like damage on a hero
        } else {
            self.event(ev, seen_by);
        }
        if src_player.is_none() && dmg.from_effect {
            if let Some(pi) = self.monsters[mi].last_hit_by.filter(|&pi| pi < self.players.len()) {
                self.players[pi].damage += applied;
            }
        }
        if let Some(pi) = src_player {
            self.monsters[mi].last_hit_by = Some(pi);
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
            if m.hiding {
                self.wake_mimic(mi);
            }
            self.monsters[mi].dormant = false;
        }
        if self.monsters[mi].hp <= 0.0 {
            if let Some(pi) = src_player {
                self.players[pi].kills += 1;
            } else if dmg.from_effect {
                if let Some(pi) = self.monsters[mi].last_hit_by.filter(|&pi| pi < self.players.len()) {
                    self.players[pi].kills += 1;
                }
            }
            self.kill_monster(mi);
        }
        if self.monsters[mi].alive && !dmg.from_effect {
            if raw > 0.0 {
                self.damage_wakes(effects::Creature::Monster(mi));
            }
            self.type_effect_hit(effects::Creature::Monster(mi), &dmg);
            if let Some(h) = dmg.on_hit {
                self.hit_effect(effects::Creature::Monster(mi), h);
            }
        }
        true
    }

    pub fn kill_monster(&mut self, mi: usize) {
        let m = &mut self.monsters[mi];
        if !m.alive {
            return;
        }
        if m.is_ally() {
            companion::wolf_died(self, mi);
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
        Level::on_killed(self, id);
    }

    fn check_end(&mut self) {
        if self.ended.is_none() && Level::failed(self) {
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
            level: self.level.id(),
            boss: self.level.boss_id(),
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

    /// The run for the statistics; `victory` is `None` when everyone left.
    pub fn record(&self, victory: Option<bool>) -> RunRecord {
        RunRecord {
            level: self.level.id(),
            boss: self.level.boss_id(),
            outcome: match victory {
                Some(true) => Outcome::Victory,
                Some(false) => Outcome::Defeat,
                None => Outcome::Abandoned,
            },
            duration_s: self.time,
            debug: self.debug_used,
            players: self
                .players
                .iter()
                .map(|p| RunPlayerRecord {
                    account: p.account,
                    character: p.character,
                    class: p.class,
                    kills: p.kills,
                    damage: p.damage,
                    healing: p.healing,
                    xp: p.xp,
                    coins: p.coins,
                    survived: p.alive,
                    left: p.left,
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
#[tracing::instrument(name = "run", skip_all, fields(run = run.id, level = ?run.level.id(), boss = ?run.level.boss_id(), players = run.players.len(), outcome = tracing::field::Empty))]
pub async fn run_task(mut run: Run, mut rx: UnboundedReceiver<RunCmd>, lobby: SharedLobby) {
    let mut outcome = None;
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
        telemetry::metrics().tick_ms(ms as f64);

        if let Some(victory) = run.finished() {
            let msg = run.end_msg(victory);
            for p in &run.players {
                run.send(p, &msg);
            }
            outcome = Some(victory);
            break;
        }
        if run.players.iter().all(|p| p.tx.is_none()) {
            break;
        }
    }
    let record = run.record(outcome);
    tracing::Span::current().record("outcome", record.outcome.as_str());
    crate::lobby::finish_run(&lobby, run.id, run.awards(), record).await;
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::defs::bosses::BOSS_KNOCK_STR;
    use crate::defs::items::{EquipSlot, Equipment, ItemId};
    use tokio::sync::mpsc::unbounded_channel;

    pub fn test_run(classes: &[ClassId], boss: BossId) -> Run {
        let with: Vec<(ClassId, Build)> = classes.iter().map(|&c| (c, Build::start(c))).collect();
        test_run_with(&with, boss)
    }

    /// The class start with `item` in `slot`.
    pub fn build_with(class: ClassId, slot: EquipSlot, item: ItemId) -> Build {
        Build { equipment: Equipment::starter(class).with(slot, item), ..Build::start(class) }
    }

    /// A run whose heroes bring the given builds.
    pub fn test_run_with(classes: &[(ClassId, Build)], boss: BossId) -> Run {
        let members = classes
            .iter()
            .enumerate()
            .map(|(i, (c, build))| {
                let (tx, _rx) = unbounded_channel();
                std::mem::forget(_rx);
                Member { conn: i as u32 + 1, name: format!("p{i}"), class: *c, tx, account: None, character: None, build: build.clone(), debug_loadout: false }
            })
            .collect();
        Run::new(1, members, 7, LevelChoice::Dungeon { boss: Some(boss) })
    }

    pub fn test_run_seed(classes: &[ClassId], boss: BossId, seed: u64) -> Run {
        let members = classes
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let (tx, _rx) = unbounded_channel();
                std::mem::forget(_rx);
                Member { conn: i as u32 + 1, name: format!("p{i}"), class: *c, tx, account: None, character: None, build: Build::start(*c), debug_loadout: false }
            })
            .collect();
        Run::new(1, members, seed, LevelChoice::Dungeon { boss: Some(boss) })
    }

    #[test]
    fn players_carry_their_sheet() {
        use crate::defs::companions::{WOLF_ATTRS, WOLF_WEIGHT};
        use crate::sheet::{boss_stats, enemy_stats, hero_sheet};
        let run = test_run(&[ClassId::Barbarian], BossId::Lich);
        let want = hero_sheet(ClassId::Barbarian, &Build::start(ClassId::Barbarian)).unwrap();
        let s = &run.players[0].sheet;
        assert_eq!(s.max_hp, want.max_hp);
        assert_eq!(s.speed, want.speed);
        assert_eq!(s.primary, want.primary);
        assert_eq!(run.players[0].max_hp, want.max_hp);
        assert!(!run.monsters.is_empty());
        for m in &run.monsters {
            let block = match m.etype {
                Some(t) => enemy_stats(t),
                None => {
                    assert!(m.is_boss);
                    boss_stats(BossId::Lich)
                }
            };
            assert_eq!(m.weight, block.weight, "{:?}", m.kind);
            assert_eq!(m.attrs, block.attrs, "{:?}", m.kind);
        }
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Lich);
        let id = companion::spawn_wolf(&mut run, 0);
        let w = run.monsters.iter().find(|m| m.id == id).unwrap();
        assert_eq!(w.weight, WOLF_WEIGHT);
        assert_eq!(w.attrs, WOLF_ATTRS);
    }

    #[test]
    fn a_resisted_hit_is_shown_as_immune_and_over_100_percent_heals() {
        use crate::defs::damage::Resistances;
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let at = run.players[0].pos() + Vec2::new(30.0, 0.0);
        let id = run.spawn_enemy(EnemyType::SkeletonWarrior, at, None);
        let mi = run.monster_idx(id).unwrap();
        let hp = run.monsters[mi].hp;
        run.events.clear();
        run.hurt_monster(mi, Damage::new(10.0, DamageSplit::pure(DamageType::Poison)), false, Some(0));
        assert_eq!(run.monsters[mi].hp, hp, "undead resist poison fully");
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Dmg { imm: true, .. })));
        // Above 100 %: the hit heals.
        run.monsters[mi].hp = hp - 20.0;
        run.monsters[mi].res = Resistances::of(&[(DamageType::Poison, 1.5)]);
        run.events.clear();
        run.hurt_monster(mi, Damage::new(10.0, DamageSplit::pure(DamageType::Poison)), false, Some(0));
        assert!((run.monsters[mi].hp - (hp - 15.0)).abs() < 1e-9);
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Heal { .. })));
        // The number carries the main type.
        run.events.clear();
        run.hurt_monster(mi, Damage::new(10.0, DamageSplit::split(&[(DamageType::Heat, 0.7)])), false, Some(0));
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Dmg { ty, imm: false, .. } if *ty == DamageType::Heat as u8)));
    }

    /// FNV-1a over everything a level setup decides, so the level refactor
    /// can prove it changed nothing.
    fn fingerprint(run: &Run) -> u64 {
        let mut h: u64 = 0xcbf29ce484222325;
        let mut eat = |v: u64| {
            for b in v.to_le_bytes() {
                h ^= b as u64;
                h = h.wrapping_mul(0x100000001b3);
            }
        };
        for &t in &run.layout.map.tiles {
            eat(t as u64);
        }
        for m in &run.monsters {
            eat(m.id as u64);
            eat(m.kind as u64);
            eat(m.pos.x.to_bits() as u64);
            eat(m.pos.y.to_bits() as u64);
            eat(m.hp.to_bits() as u64);
            eat(m.is_boss as u64);
            eat((m.dormant || m.hiding) as u64);
        }
        // Chests only: barrels and torches are spawned last (after every other
        // id) and left out, so the rest of the setup is compared with the old values.
        let is_late = |o: &objects::WorldObject| matches!(o.kind, EntityKind::Barrel | EntityKind::Torch);
        let barrels = run.objects.iter().filter(|o| is_late(o)).count() as u32;
        for o in run.objects.iter().filter(|o| !is_late(o)) {
            eat(o.id as u64);
            eat(o.pos.x.to_bits() as u64);
        }
        for p in &run.players {
            eat(p.id as u64);
            eat(p.mv.x.to_bits() as u64);
            eat(p.mv.y.to_bits() as u64);
            eat(p.hp.to_bits() as u64);
        }
        eat((run.next_id - barrels) as u64);
        h
    }

    fn random_boss_run(seed: u64) -> Run {
        let (tx, _rx) = unbounded_channel();
        std::mem::forget(_rx);
        let members = vec![Member { conn: 1, name: "p0".into(), class: ClassId::Paladin, tx, account: None, character: None, build: Build::start(ClassId::Paladin), debug_loadout: false }];
        Run::new(1, members, seed, LevelChoice::Dungeon { boss: None })
    }

    #[test]
    fn enemy_hp_ignores_party_size() {
        let four = [ClassId::Wizard, ClassId::Paladin, ClassId::Barbarian, ClassId::ElvenRanger];
        for b in BossId::ALL {
            let run = test_run(&four, b);
            let boss = run.monsters.iter().find(|m| m.is_boss).unwrap();
            assert_eq!(boss.max_hp, crate::defs::bosses::def(b).hp, "{b:?} with four heroes");
            for m in run.monsters.iter().filter(|m| !m.is_boss) {
                if let Some(t) = m.etype {
                    assert_eq!(m.max_hp, crate::defs::enemies::def(t).hp, "{t:?} with four heroes");
                }
            }
        }
    }

    #[test]
    fn start_and_end_messages_name_the_level_and_boss() {
        let run = test_run(&[ClassId::Wizard], BossId::Lich);
        let ServerMsg::RunStarted(info) = run.start_info(&run.players[0]) else { panic!() };
        assert_eq!(info.level, LevelId::Dungeon);
        let ServerMsg::RunEnded { level, boss, .. } = run.end_msg(true) else { panic!() };
        assert_eq!((level, boss), (LevelId::Dungeon, Some(BossId::Lich)));
    }

    #[test]
    fn level_setup_is_unchanged() {
        let got: Vec<u64> = (0..6).map(|s| fingerprint(&random_boss_run(s))).collect();
        // The original values: barrels are left out of the fingerprint, so
        // this proves the rest of the setup is unchanged by them.
        assert_eq!(got, vec![15034865796308420847, 11583993820610399499, 14176587140014399478, 8272529450485156440, 13502237337016626428, 4475734371267647701]);
        assert_ne!(got[0], got[1]);
        // 2026-10-21, plan 3a: checked again, unchanged.
    }

    #[test]
    fn level_setup_is_unchanged_with_the_log_on() {
        let got: Vec<u64> = (0..6)
            .map(|s| {
                let mut run = random_boss_run(s);
                run.log.forced = true;
                fingerprint(&run)
            })
            .collect();
        assert_eq!(got, vec![15034865796308420847, 11583993820610399499, 14176587140014399478, 8272529450485156440, 13502237337016626428, 4475734371267647701]);
    }

    // Unchanged after pushes by weight and durations by save (2026-10-19); the
    // boss scripts push with BOSS_KNOCK_STR above every hero weight + 4.
    #[test]
    fn simulation_is_unchanged_after_waking_the_boss() {
        let mut got = Vec::new();
        for boss in BossId::ALL {
            let mut run = test_run(&[ClassId::Paladin, ClassId::Wizard], boss);
            let hall = run.level.boss().unwrap().arena.center_px();
            for p in &mut run.players {
                p.mv.x = hall.x;
                p.mv.y = hall.y + 40.0;
            }
            for _ in 0..300 {
                run.step();
            }
            got.push(fingerprint(&run));
        }
        // Re-recorded with barrels (2026-10-14): the boss halls now hold barrels,
        // which block movement, shots and paths and can be lit, so the fight differs.
        // 2026-10-15, vision: the second boss hall (disciples are Human, no darkvision) lies partly
        // in the dark: its six disciples no longer see the heroes there (they stay Idle instead of
        // Chase) and one orc warrior loses them too, so it wanders elsewhere. Only that hall changed.
        // 2026-10-15, effects: the lich casts its blinding curse after 4 s (an orb id and a blind hero), so its hall
        // differs; demon and dragon unchanged.
        // 2026-10-15, damage-type effects: a barrel blast (half heat) now sets a monster on fire in the lich hall; the
        // burn damage changes its hp. (Lich cause confirmed from an event trace: a barrel blast of 30, half heat, set a monster on fire at about 3.7 s.) Dragon: its heat hits set heroes on fire; the burn damage changes their hp. Demon unchanged.
        // 2026-10-19, TODO 4b: enemy and boss HP no longer scale with the party size. This run has two heroes,
        // so every boss loses a third of its HP (×1.5 → ×1) and every enemy a fifth (×1.25 → ×1): all three
        // halls differ. Part A (effect resistances) left all three values unchanged before this.
        // 2026-10-21, plan 3a (Charge 25.6, reach 22, staffs and punches in melee, overkill piercing): checked
        // again, values unchanged by plan 3a. `plan_3a_fight_is_pinned` pins a fight that does exercise it.
        assert_eq!(got, vec![11853672065832131168, 7100769620128759448, 1468820053114872194]);
    }

    #[test]
    fn simulation_is_unchanged_after_waking_the_boss_with_the_log_on() {
        let mut got = Vec::new();
        for boss in BossId::ALL {
            let mut run = test_run(&[ClassId::Paladin, ClassId::Wizard], boss);
            run.log.forced = true;
            let hall = run.level.boss().unwrap().arena.center_px();
            for p in &mut run.players {
                p.mv.x = hall.x;
                p.mv.y = hall.y + 40.0;
            }
            for _ in 0..300 {
                run.step();
            }
            got.push(fingerprint(&run));
        }
        assert_eq!(got, vec![11853672065832131168, 7100769620128759448, 1468820053114872194]);
    }

    /// A short fight over `run.step()`: hero 0 aims east, holding its primary if `fire`, at enemies
    /// of type `t` placed `dists` px east of it with `hps`; the run after 2 s.
    fn fight(class: ClassId, t: crate::defs::enemies::EnemyType, dists: &[f64], hps: &[f64], fire: bool) -> Run {
        fight_with_log(class, t, dists, hps, fire, false)
    }

    /// `fight`, with the rules log forced on or not.
    fn fight_with_log(class: ClassId, t: crate::defs::enemies::EnemyType, dists: &[f64], hps: &[f64], fire: bool, log: bool) -> Run {
        let mut run = test_run(&[class], BossId::Demon);
        run.log.forced = log;
        run.monsters.retain(|m| m.is_boss);
        let p = run.players[0].pos();
        for (&d, &hp) in dists.iter().zip(hps) {
            let id = run.spawn_enemy(t, p + Vec2::new(d, 0.0), None);
            let mi = run.monster_idx(id).unwrap();
            run.monsters[mi].hp = hp;
        }
        for i in 0..120u16 {
            let seq = run.players[0].ack + 1;
            let primary = fire.then_some(i + 1);
            run.players[0].inputs.push_back(InputMsg { seq, aim: 0.0, aim_dist: 60.0, primary, ..Default::default() });
            run.step();
        }
        run
    }

    // 2026-10-21: pins plan 3a's behaviour in a real fight: a ranger's bolts piercing a line of goblins
    // on overkill, a Wizard's staff on an orc in melee, a goblin archer punching a hero beside it.
    #[test]
    fn plan_3a_fight_is_pinned() {
        use crate::defs::enemies::EnemyType as E;
        let enemies = |run: &Run| run.monsters.iter().filter(|m| !m.is_boss).map(|m| (m.alive, m.hp)).collect::<Vec<_>>();
        let ranger = fight(ClassId::ElvenRanger, E::GoblinArcher, &[40.0, 50.0, 60.0], &[5.0, 5.0, 24.0], true);
        let wizard = fight(ClassId::Wizard, E::OrcWarrior, &[12.0], &[60.0], true);
        let paladin = fight(ClassId::Paladin, E::GoblinArcher, &[12.0], &[24.0], false);
        assert!(enemies(&ranger).is_empty(), "the three goblins fall");
        assert!(matches!(enemies(&wizard)[..], [(true, hp)] if hp < 60.0) && wizard.projectiles.is_empty(), "the staff, not missiles");
        assert!(paladin.players[0].hp < paladin.players[0].max_hp, "the archer punches");
        let got = [fingerprint(&ranger), fingerprint(&wizard), fingerprint(&paladin)];
        assert_eq!(got, [12818716789722319080, 10046494661674442087, 18070867878348641130]);
    }

    #[test]
    fn plan_3a_fight_is_pinned_with_the_log_on() {
        use crate::defs::enemies::EnemyType as E;
        let ranger = fight_with_log(ClassId::ElvenRanger, E::GoblinArcher, &[40.0, 50.0, 60.0], &[5.0, 5.0, 24.0], true, true);
        let wizard = fight_with_log(ClassId::Wizard, E::OrcWarrior, &[12.0], &[60.0], true, true);
        let paladin = fight_with_log(ClassId::Paladin, E::GoblinArcher, &[12.0], &[24.0], false, true);
        let got = [fingerprint(&ranger), fingerprint(&wizard), fingerprint(&paladin)];
        assert_eq!(got, [12818716789722319080, 10046494661674442087, 18070867878348641130]);
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

    #[test]
    fn the_record_has_the_outcome_and_every_player() {
        let mut run = test_run(&[ClassId::Wizard, ClassId::Paladin], BossId::Lich);
        run.players[0].account = Some(3);
        run.players[0].character = Some(5);
        run.players[0].kills = 9;
        run.players[1].alive = false;
        run.time = 75.5;
        assert!(run.record(Some(false)).players[1].died());
        run.handle(RunCmd::Leave { conn: 1 });
        assert!(run.record(None).players[0].left && !run.record(None).players[0].died(), "leaving is not dying");
        run.players[0].alive = true;
        run.players[0].left = false;
        let r = run.record(Some(false));
        assert_eq!((r.level, r.boss, r.outcome, r.duration_s, r.debug), (LevelId::Dungeon, Some(BossId::Lich), Outcome::Defeat, 75.5, false));
        assert_eq!(r.players.len(), 2);
        assert_eq!((r.players[0].account, r.players[0].character, r.players[0].kills), (Some(3), Some(5), 9));
        assert!(r.players[0].survived && !r.players[1].survived);
        assert_eq!(run.record(Some(true)).outcome, Outcome::Victory);
        assert_eq!(run.record(None).outcome, Outcome::Abandoned, "everyone left");
        run.set_debug(1, true);
        assert!(run.record(Some(true)).debug);
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
        let pos = run.layout.player_spawns[0] + Vec2::new(40.0, 0.0);
        let id = run.spawn_object(EntityKind::Chest, pos, objects::ObjState::Chest { opened: None });
        stand_at(&mut run, pos);
        let o = run.objects.iter().find(|o| o.id == id).unwrap();
        assert!(matches!(o.state, objects::ObjState::Chest { opened: Some(_) }));
        let coins = run.players[0].coins;
        assert!(progression::CHEST_COINS.contains(&coins));
        assert_eq!(run.players[1].coins, coins, "the whole party gets the coins");
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Coins { .. })));
        stand_at(&mut run, pos);
        assert_eq!(run.players[0].coins, coins, "a chest pays only once");
    }

    #[test]
    fn every_object_resists_poison_fully() {
        let p = crate::defs::objects::profile(EntityKind::Chest);
        assert_eq!(p.res.get(DamageType::Poison), 1.0);
        assert_eq!(p.res.get(DamageType::Physical), 0.5);
    }

    #[test]
    fn a_mimic_is_hiding_not_dormant_and_the_boss_is_dormant_not_hiding() {
        let run = (1..200)
            .map(|seed| test_run_seed(&[ClassId::Paladin], BossId::Demon, seed))
            .find(|r| r.monsters.iter().any(|m| m.etype == Some(EnemyType::Mimic)))
            .expect("some seed has a mimic");
        let mimics: Vec<&Monster> = run.monsters.iter().filter(|m| m.etype == Some(EnemyType::Mimic)).collect();
        assert!(mimics.iter().all(|m| m.hiding && !m.dormant));
        let boss = run.monsters.iter().find(|m| m.is_boss).unwrap();
        assert!(boss.dormant && !boss.hiding);
    }

    #[test]
    fn mimic_sleeps_until_touched_then_waits_before_hunting() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        let pos = run.layout.player_spawns[0] + Vec2::new(60.0, 0.0);
        let id = run.spawn_enemy(EnemyType::Mimic, pos, None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].hiding = true;
        // A player in plain sight does not wake it; only touching does.
        stand_at(&mut run, pos - Vec2::new(30.0, 0.0));
        let mi = run.monster_idx(id).unwrap();
        assert!(run.monsters[mi].hiding);
        assert_eq!(run.monsters[mi].pos, pos);
        stand_at(&mut run, pos - Vec2::new(8.0, 0.0));
        let mi = run.monster_idx(id).unwrap();
        assert!(!run.monsters[mi].hiding);
        assert!(run.monsters[mi].ai.hold > 0.0);
        // The boss waking does not wake other mimics.
        let id2 = run.spawn_enemy(EnemyType::Mimic, pos + Vec2::new(0.0, 32.0), None);
        let m2 = run.monster_idx(id2).unwrap();
        run.monsters[m2].hiding = true;
        let hall = run.level.boss().unwrap().arena.center_px();
        stand_at(&mut run, hall);
        let m2 = run.monster_idx(id2).unwrap();
        assert!(run.level.boss().unwrap().awake);
        assert!(run.monsters[m2].hiding);
    }

    /// Player 0 alone with the (sleeping) boss, next to a fresh terrain tile.
    fn terrain_run(t: Tile) -> (Run, Vec2) {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let (tx, ty) = dungeon::Map::tile_of(run.layout.player_spawns[0]);
        run.layout.map.set(tx + 2, ty, t);
        (run, dungeon::Map::center_of(tx + 2, ty))
    }

    /// A lone orc east of player 0 next to fresh terrain `t` two tiles further east.
    fn orc_by(t: Tile) -> (Run, u32, Vec2) {
        let (mut run, at) = terrain_run(t);
        let orc = at - Vec2::new(16.0, 0.0);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, orc, None);
        run.players[0].debug = true;
        (run, id, at)
    }

    #[test]
    fn an_enemy_blown_into_a_chasm_falls_and_gives_xp_once() {
        let (mut run, id, _) = orc_by(Tile::Chasm);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].last_hit_by = Some(0);
        let from = run.monsters[mi].pos - Vec2::new(10.0, 0.0);
        run.knock_monster(mi, from, 40.0, BOSS_KNOCK_STR);
        for _ in 0..30 {
            run.step();
        }
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Sink { id: i, how: 0, .. } if *i == id)));
        for _ in 0..=(dungeon::FALL_TIME / DT) as usize {
            run.step();
        }
        assert!(run.monster_idx(id).is_none(), "fell");
        let xp = run.players[0].xp;
        assert!(xp > 0 && run.players[0].kills == 1);
        for _ in 0..30 {
            run.step();
        }
        assert_eq!(run.players[0].xp, xp, "XP only once");
    }

    #[test]
    fn an_enemy_blown_into_deep_water_drowns() {
        let (mut run, id, _) = orc_by(Tile::DeepWater);
        let mi = run.monster_idx(id).unwrap();
        let from = run.monsters[mi].pos - Vec2::new(10.0, 0.0);
        run.knock_monster(mi, from, 40.0, BOSS_KNOCK_STR);
        for _ in 0..30 + (dungeon::DROWN_TIME / DT) as usize {
            run.step();
        }
        assert!(run.monster_idx(id).is_none());
    }

    #[test]
    fn an_enemy_in_lava_burns_and_walks_out() {
        let (mut run, id, at) = orc_by(Tile::Lava);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].pos = at;
        let hp = run.monsters[mi].hp;
        for _ in 0..90 {
            run.step();
        }
        let mi = run.monster_idx(id).unwrap();
        assert!(run.monsters[mi].hp < hp, "burned");
        assert!(!run.layout.map.blocks_at(run.monsters[mi].pos, Mover::Enemy), "out of the lava");
    }

    #[test]
    fn orc_pushes_the_barbarian_less() {
        use crate::run::effects::Creature;
        let mut run = test_run(&[ClassId::Wizard, ClassId::Barbarian], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let at = run.players[0].pos();
        run.players[1].mv.x = at.x;
        run.players[1].mv.y = at.y;
        let id = run.spawn_enemy(EnemyType::OrcWarrior, at - Vec2::new(16.0, 0.0), None);
        let oi = run.monster_idx(id).unwrap();
        let attack = crate::defs::enemies::def(EnemyType::OrcWarrior).attack;
        // STR 16: the Wizard (weight 9) the full 20 px, the Barbarian (weight 13) 20 x 3/4 = 15 px.
        crate::run::ai::perform_attack(&mut run, oi, Creature::Player(0), attack, false, None);
        crate::run::ai::perform_attack(&mut run, oi, Creature::Player(1), attack, false, None);
        assert_eq!(run.players[0].mv.knock_vx, crate::collision::knock_speed(20.0, DT));
        assert_eq!(run.players[1].mv.knock_vx, crate::collision::knock_speed(15.0, DT));
    }

    #[test]
    fn bosses_are_never_pushed() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        let bi = run.monsters.iter().position(|m| m.is_boss).unwrap();
        let from = run.monsters[bi].pos - Vec2::new(10.0, 0.0);
        run.knock_monster(bi, from, 40.0, BOSS_KNOCK_STR);
        assert_eq!(run.monsters[bi].knock, Vec2::ZERO);
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
        run.knock_player(0, start - Vec2::new(10.0, 0.0), 0.0, 36.0, BOSS_KNOCK_STR);
        assert!(!run.players[0].mv.knocked());
        run.players[0].mv.dash_t = 0.0;
        // 36 px away from a hit on the left, while walking left and attacking: slides right into the chasm.
        run.knock_player(0, start - Vec2::new(10.0, 0.0), 0.0, 36.0, BOSS_KNOCK_STR);
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
        run.knock_player(0, start - Vec2::new(10.0, 0.0), 0.0, 14.0, BOSS_KNOCK_STR);
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
    fn lava_burns_as_heat() {
        use crate::defs::damage::{DamageType, Resistances};
        let (mut run, at) = terrain_run(Tile::Lava);
        run.players[0].res = Resistances::of(&[(DamageType::Heat, 1.0)]);
        let hp = run.players[0].hp;
        stand_at(&mut run, at);
        for _ in 0..69 {
            run.step();
        }
        assert_eq!(run.players[0].hp, hp, "immune to heat: the lava does nothing");
        let (mut run, at) = terrain_run(Tile::Lava);
        let hp = run.players[0].hp;
        stand_at(&mut run, at);
        assert_eq!(run.players[0].hp, hp - dungeon::LAVA_DAMAGE, "unprotected heroes still burn");
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
        // About a second in lava: the first touch plus two ticks, and the lava sets the hero on fire
        // (2026-10-15, effects): two burn ticks of 3 (at 0.5 s and 1.0 s) on top.
        assert!((run.players[0].hp - (hp - 3.0 * dungeon::LAVA_DAMAGE - 6.0)).abs() < 1e-9, "hp {}", run.players[0].hp);
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
        let start = run.layout.player_spawns[0];
        let id = run.spawn_enemy(EnemyType::Mimic, start + Vec2::new(50.0, 0.0), None);
        assert!(!run.layout.map.blocks_at(start + Vec2::new(50.0, 0.0), Mover::Enemy));
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

    #[test]
    fn enemy_melee_splits_are_unchanged() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        for t in EnemyType::ALL {
            let id = run.spawn_enemy(t, Vec2::new(40.0, 40.0), None);
            let m = run.monsters.iter().find(|m| m.id == id).unwrap();
            let today = match t {
                EnemyType::Imp | EnemyType::SummonedImp | EnemyType::Chort => DamageSplit::split(&[(DamageType::Heat, 0.2)]),
                _ => DamageSplit::physical(),
            };
            assert_eq!(m.melee, today, "{t:?}");
        }
    }

    #[test]
    fn fire_patches_still_burn_heroes() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        let at = run.players[0].pos();
        let hp = run.players[0].hp;
        spawn_fire_patch(&mut run, at, 10.0, 3.0, 8.0);
        assert!(matches!(run.hazards[0].side, HazardSide::Monsters));
        run.tick_hazards(0.3);
        assert!(run.players[0].hp < hp, "the first pulse comes at 0.25 s");
        let after = run.players[0].hp;
        run.tick_hazards(0.3);
        assert_eq!(run.players[0].hp, after, "the next is 0.5 s later");
    }
}
