//! A boss fight in a sealable arena. Any level can include one.

use crate::defs::bosses as boss_defs;
use crate::defs::enemies::EnemyType;
use crate::defs::kinds::Anim;
use crate::dungeon::{Mover, Rect, Tile};
use crate::math::Vec2;
use crate::protocol::{BossBar, BossId, Ev};
use crate::run::bosses::{self, BossBehaviour};
use crate::run::entities::*;
use crate::run::{Run, END_DELAY};
use std::collections::VecDeque;

pub struct BossEncounter {
    pub boss_id: BossId,
    /// Entity id of the boss monster (0 until spawned).
    pub boss_ent: u32,
    /// Taken out while it ticks, like before.
    pub behaviour: Option<Box<dyn BossBehaviour>>,
    pub awake: bool,
    /// The hall: entering wakes the boss, all heroes inside seals the door.
    pub arena: Rect,
    pub door: Vec<(i32, i32)>,
    pub door_closed: bool,
}

impl BossEncounter {
    pub fn new(boss_id: BossId, arena: Rect, door: Vec<(i32, i32)>) -> Self {
        BossEncounter { boss_id, boss_ent: 0, behaviour: None, awake: false, arena, door, door_closed: false }
    }
}

fn enc(run: &Run) -> &BossEncounter {
    run.level.boss().expect("level has a boss encounter")
}
fn enc_mut(run: &mut Run) -> &mut BossEncounter {
    run.level.boss_mut().expect("level has a boss encounter")
}

/// Spawns the sleeping boss in the arena centre, then its extras.
pub fn spawn(run: &mut Run, party: usize) {
    let boss_id = enc(run).boss_id;
    let d = boss_defs::def(boss_id);
    let prof = boss_defs::profile(boss_id);
    let pos = enc(run).arena.center_px();
    let id = run.alloc_id();
    let hp = d.hp * boss_defs::hp_scale(party);
    run.monsters.push(Monster {
        id,
        res: prof.res,
        melee: prof.melee,
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
        mover: if boss_id == BossId::Demon { Mover::Demon } else { Mover::Enemy },
        airborne: false,
    });
    enc_mut(run).boss_ent = id;
    let mut behaviour = bosses::create(boss_id);
    behaviour.spawn_extras(run, pos, party);
    enc_mut(run).behaviour = Some(behaviour);
}

pub fn tick(run: &mut Run, dt: f64) {
    if enc(run).awake {
        if let Some(mut b) = enc_mut(run).behaviour.take() {
            b.tick(run, dt);
            enc_mut(run).behaviour = Some(b);
        }
    }
}

/// Wake on entry, seal the door once every living hero is inside.
pub fn check_arena(run: &mut Run) {
    let hall = enc(run).arena;
    let alive: Vec<Vec2> = run.players.iter().filter(|p| p.alive).map(|p| p.pos()).collect();
    if !enc(run).awake && alive.iter().any(|p| hall.contains(*p)) {
        enc_mut(run).awake = true;
        // Mimics elsewhere keep their disguise.
        for m in run.monsters.iter_mut().filter(|m| m.etype != Some(EnemyType::Mimic)) {
            m.asleep = false;
        }
        let text = match enc(run).boss_id {
            BossId::Demon => "A demon awakens!",
            BossId::Lich => "The lich rises - slay its disciples!",
            BossId::Dragon => "The dragon awakens!",
        };
        run.event(Ev::Msg { text: text.into() }, None);
    }
    if enc(run).awake && !enc(run).door_closed && !alive.is_empty() && alive.iter().all(|p| hall.contains(*p)) {
        enc_mut(run).door_closed = true;
        for (x, y) in enc(run).door.clone() {
            run.layout.map.set(x, y, Tile::DoorClosed);
            run.event(Ev::Tile { x: x as u16, y: y as u16, v: Tile::DoorClosed as u8 }, None);
        }
    }
}

/// Immunity and wake-on-hit; false = the hit is refused.
pub fn on_hurt(run: &mut Run, mi: usize) -> bool {
    let immune = enc(run).behaviour.as_ref().map_or(false, |b| !b.can_be_damaged(run));
    if immune {
        let pos = run.monsters[mi].pos;
        run.event(Ev::Immune { x: pos.x as f32, y: pos.y as f32 }, Some(pos));
        return false;
    }
    enc_mut(run).awake = true;
    run.monsters[mi].asleep = false;
    true
}

/// Killing the boss wins the run.
pub fn on_killed(run: &mut Run, id: u32) {
    if id == enc(run).boss_ent && run.ended.is_none() {
        run.ended = Some((true, run.time + END_DELAY));
        run.event(Ev::Msg { text: "The boss is defeated!".into() }, None);
    }
}

/// The boss while it lives, else the arena centre.
pub fn debug_target(run: &Run) -> Vec2 {
    let e = enc(run);
    run.monsters.iter().find(|m| m.id == e.boss_ent && m.alive).map_or_else(|| e.arena.center_px(), |m| m.pos)
}

pub fn bar(run: &Run) -> Option<BossBar> {
    let e = enc(run);
    if !e.awake {
        return None;
    }
    let immune = e.behaviour.as_ref().map_or(false, |b| !b.can_be_damaged(run));
    let enraged = e.behaviour.as_ref().map_or(false, |b| b.enraged());
    let (hp, max) = run.monsters.iter().find(|m| m.id == e.boss_ent).map_or((0.0, 1.0), |m| (m.hp, m.max_hp));
    Some(BossBar { kind: e.boss_id, hp: hp as f32, max_hp: max as f32, immune, enraged })
}
