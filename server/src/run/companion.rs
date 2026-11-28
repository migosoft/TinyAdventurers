//! Companions: monsters that fight for the heroes. Who each follows (the leader hierarchy) and the
//! pieces of a follower's script that any companion shares. The Ranger's wolf is one of them: its spawn and death are in run/wolf.rs.

use super::entities::{Ai, AiState, Companion};
use super::effects::Creature;
use super::targets::{self, Side};
use super::{ai, perception, Run};
use crate::collision::walk_line;
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::companions::{Escort, KNIGHT_ESCORT, COMPANION_REACH_EVERY, WOLF_RADIUS};
use crate::defs::effects::EffectKind;
use crate::defs::kinds::Anim;
use crate::defs::objects::USE_REACH;
use crate::dungeon::{Layout, Map, Mover, Rect};
use crate::math::Vec2;
use crate::protocol::Ev;

/// The creature `c` follows, for a companion on `side`: its recruiter while that creature is alive, in the
/// run and (for a recruited one) on `side`; else, for a recruited companion, the party leader (the host, the
/// first player) if alive and on `side`, else the next living hero on `side` in join order. A summoned
/// companion takes its recruiter whatever side it is on, and has no one else: `None` means it vanishes.
/// A pure function of who is alive now and on which side. Fallen heroes never come back before #221, so a
/// switch of leader is for good without any stored history.
pub fn leader_of(run: &Run, c: &Companion, side: Side) -> Option<Creature> {
    let recruiter = run.creature_by_id(c.recruiter).filter(|&r| run.creature_alive(r));
    if c.summoned {
        return recruiter;
    }
    recruiter
        .filter(|&r| targets::side(run, r) == side)
        .or_else(|| (0..run.players.len()).find(|&pi| run.players[pi].alive && run.players[pi].side == side).map(Creature::Player))
}

/// Sets every companion's `leader`. A summoned companion whose summoner is gone vanishes at once, with
/// a puff: no death event, no message, no cooldown. A recruited one with no leader at all keeps its last
/// (the run is ending).
pub fn update_leaders(run: &mut Run) {
    for mi in 0..run.monsters.len() {
        let m = &run.monsters[mi];
        let Some(c) = m.companion.as_ref().filter(|_| m.alive) else { continue };
        match leader_of(run, c, m.side) {
            Some(leader) => {
                let id = run.creature_id(leader);
                run.monsters[mi].companion.as_mut().expect("a companion").leader = id;
            }
            None if c.summoned => {
                let (pos, recruiter) = (m.pos, c.recruiter);
                run.monsters[mi].alive = false;
                if let Some(pi) = run.player_idx(recruiter) {
                    run.players[pi].wolf = None;
                }
                run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: 10.0, k: 9 }, None);
            }
            None => {}
        }
    }
}

/// The first of 8 points 12 px around `pos` (east first, then clockwise) where the
/// companion can stand: walkable ground, clear of solid objects. None when there is no such point.
pub fn spot_beside(run: &Run, pos: Vec2) -> Option<Vec2> {
    let solids = run.solids(None);
    (0..8)
        .map(|i| pos + Vec2::from_angle(i as f64 * std::f64::consts::FRAC_PI_4) * 12.0)
        .find(|&p| !run.layout.map.blocks_at(p, Mover::Enemy) && !solids.iter().any(|s| (p.x - s.x).abs() < s.half + WOLF_RADIUS && (p.y - s.y).abs() < s.half + WOLF_RADIUS))
}

/// Where a summoned companion appears: beside `pos`, else the nearest walkable tile centre within
/// 2 tiles, else `pos` itself (a summon is never refused).
pub fn summon_spot(run: &Run, pos: Vec2) -> Vec2 {
    spot_beside(run, pos).unwrap_or_else(|| {
        let (tx, ty) = Map::tile_of(pos);
        (-2i32..=2)
            .flat_map(|dy| (-2i32..=2).map(move |dx| (tx + dx, ty + dy)))
            .map(|(x, y)| Map::center_of(x, y))
            .filter(|&c| !run.layout.map.blocks_at(c, Mover::Enemy))
            .min_by(|a, b| a.dist(pos).total_cmp(&b.dist(pos)))
            .unwrap_or(pos)
    })
}

pub(super) fn set_anim(run: &mut Run, mi: usize, a: Anim) {
    let m = &mut run.monsters[mi];
    if m.anim != a {
        m.anim = a;
        m.anim_start = run.time;
    }
}

/// Whether companion `mi` must reappear beside its leader: far from them, or (checked every
/// `COMPANION_REACH_EVERY` s) unable to reach them, as behind a sealed door. Mid-dash it may be over a chasm,
/// where no path starts: no reach check then.
pub fn lost(run: &mut Run, mi: usize, leader: Vec2, e: &Escort, dt: f64) -> bool {
    let pos = run.monsters[mi].pos;
    let dashing = run.monsters[mi].dash.is_some();
    let mut lost = pos.dist(leader) > e.reappear;
    let c = run.monsters[mi].companion.as_mut().expect("a companion");
    c.reach_t -= dt;
    if c.reach_t <= 0.0 && !dashing {
        c.reach_t = COMPANION_REACH_EVERY;
        let map = &run.layout.map;
        // A leader on lava or over a chasm cannot be reached on foot, and no spot beside them is safe.
        lost |= !map.blocks_at(leader, Mover::Enemy) && !(walk_line(map, pos, leader, Mover::Enemy) || ai::astar(map, pos, leader, 2500, Mover::Enemy).is_some());
    }
    lost
}

/// The companion appears beside its leader with the green puff, dropping whatever it was doing.
/// With no free spot beside them it stays where it is (false).
pub fn reappear(run: &mut Run, mi: usize, leader: Vec2) -> bool {
    let Some(spot) = spot_beside(run, leader) else { return false };
    let m = &mut run.monsters[mi];
    m.pos = spot;
    m.knock = Vec2::ZERO;
    m.ai.path.clear();
    m.ai.windup = None;
    m.dash = None;
    let c = m.companion.as_mut().expect("a companion");
    c.prey = None;
    c.following = false;
    set_anim(run, mi, Anim::Idle);
    run.event(Ev::Boom { x: spot.x as f32, y: spot.y as f32, r: 10.0, k: 9 }, None);
    true
}

/// The foe a companion goes for: a living hero or monster it fights (`targets::fights`: its side's foes and its
/// grudges), awake and visible (not dormant, hiding, invisible or flying), seen by the companion, near the
/// leader (guard) or the companion (it fights back), within the leash. The one nearest the leader.
pub fn find_prey(run: &Run, mi: usize, leader: Vec2, e: &Escort) -> Option<Creature> {
    let w = &run.monsters[mi];
    let sight = w.sight_now();
    // A companion with no attack (a charmed deer) has no prey.
    let attack = w.kit.first()?.split;
    let me = targets::stance(run, Creature::Monster(mi));
    // A creature in the drowning state (`water_t > 0`) is out of reach: not worth chasing.
    let heroes = (0..run.players.len()).filter(|&i| run.players[i].alive && run.players[i].sinking.is_none() && run.players[i].mv.water_t <= 0.0).map(Creature::Player);
    let monsters = (0..run.monsters.len())
        .filter(|&i| {
            let f = &run.monsters[i];
            i != mi && f.alive && !f.dormant && !f.hiding && !f.airborne && f.sinking.is_none() && f.water_t <= 0.0
        })
        .map(Creature::Monster);
    heroes
        .chain(monsters)
        .filter(|&c| targets::fights(&me, &targets::stance(run, c)) && !run.has_effect(c, EffectKind::Invisible))
        // An attack that passes through the foe cannot hurt it: not worth chasing.
        .filter(|&c| !run.passes_through(c, &attack))
        .map(|c| (c, run.creature_pos(c), match c {
            Creature::Player(_) => PLAYER_RADIUS,
            Creature::Monster(i) => run.monsters[i].radius,
        }))
        .filter(|&(_, p, radius)| {
            let (to_l, to_w) = (p.dist(leader), p.dist(w.pos));
            (to_l <= e.guard + radius || to_w <= e.defend + radius) && to_l <= e.leash
        })
        .filter(|&(_, p, _)| perception::sees(run, sight, w.pos, w.gaze_dir(), p))
        .min_by(|a, b| a.1.dist(leader).total_cmp(&b.1.dist(leader)))
        .map(|(c, _, _)| c)
}

/// Walks toward `leader` once beyond `e.follow` (until inside `e.follow_stop`); otherwise stands facing the
/// side the leader aims at.
pub fn follow(run: &mut Run, mi: usize, leader: Creature, e: &Escort, speed: f64, dt: f64) {
    let aim = match leader {
        Creature::Player(pi) => run.players[pi].aim,
        Creature::Monster(li) => run.monsters[li].aim,
    };
    let leader = run.creature_pos(leader);
    let pos = run.monsters[mi].pos;
    let d = pos.dist(leader);
    let c = run.monsters[mi].companion.as_mut().expect("a companion");
    if c.following && d < e.follow_stop {
        c.following = false;
    } else if d > e.follow {
        c.following = true;
    }
    if c.following {
        run.monsters[mi].face_to = Some(pos.angle_to(leader));
        ai::path_toward(run, mi, leader, speed, dt);
        set_anim(run, mi, Anim::Move);
    } else {
        run.monsters[mi].ai.path.clear();
        run.monsters[mi].face_to = Some(if aim.cos() >= 0.0 { 0.0 } else { std::f64::consts::PI });
        set_anim(run, mi, Anim::Idle);
    }
}

/// The first part of a companion's tick: the creature (hero or monster) it follows, or `None` when the tick is
/// over. With no living leader a recruited one is its own leader (it fights back, else stands), a summoned one idles; lost, it reappears beside them (even mid-dash, which it drops).
/// Not called while it is pushed, sinking, asleep or frozen (`Run::step`).
pub fn regroup(run: &mut Run, mi: usize, dt: f64) -> Option<Creature> {
    let side = run.monsters[mi].side;
    let Some(leader) = run.monsters[mi].companion.as_ref().and_then(|c| leader_of(run, c, side)) else {
        // A recruited one with no one to follow is its own leader: it defends itself, else stands (`act`).
        if run.monsters[mi].companion.as_ref().is_some_and(|c| !c.summoned) {
            return Some(Creature::Monster(mi));
        }
        run.monsters[mi].ai.enter(AiState::Idle);
        if let Some(c) = run.monsters[mi].companion.as_mut() {
            c.prey = None;
        }
        return None;
    };
    let at = run.creature_pos(leader);
    let escort = run.monsters[mi].companion.as_ref().expect("a companion").escort;
    // A creature that cannot move (the Disciple) neither follows nor reappears: it stays and fights from there.
    if run.monsters[mi].base.speed == 0.0 {
        return Some(leader);
    }
    if lost(run, mi, at, escort, dt) && reappear(run, mi, at) {
        return None;
    }
    Some(leader)
}

/// Counts the AI's waits (`cd`, `alt_cd`) down by the creature's own clock, on a tick that does not run
/// `ai::tick_monster` (which counts them itself): following, climbing out of lava, dashing.
pub fn count_waits(run: &mut Run, mi: usize, dt: f64) {
    let m = &mut run.monsters[mi];
    let cdt = m.effects.cooldown_dt(dt);
    m.ai.cd -= cdt;
    m.ai.alt_cd -= cdt;
}

/// The rest of a companion's tick, after its dash: fight its prey through the enemy AI, else follow `leader`.
pub fn act(run: &mut Run, mi: usize, leader: Creature, dt: f64) {
    let at = run.creature_pos(leader);
    let escort = run.monsters[mi].companion.as_ref().expect("a companion").escort;
    // Blown into lava: walk out first, like any monster (the enemy movers cannot move inside a pool).
    if run.layout.map.blocks_at(run.monsters[mi].pos, run.monsters[mi].mover) {
        count_waits(run, mi, dt);
        ai::escape_terrain(run, mi, dt);
        return;
    }
    let prey = find_prey(run, mi, at, escort);
    run.monsters[mi].companion.as_mut().expect("a companion").prey = prey.map(|c| run.creature_id(c));
    if prey.is_some() {
        ai::tick_monster(run, mi, dt);
    } else {
        let m = &mut run.monsters[mi];
        m.ai.windup = None;
        m.ai.enter(AiState::Idle);
        let speed = m.base.speed;
        count_waits(run, mi, dt);
        if speed == 0.0 {
            set_anim(run, mi, Anim::Idle);
        } else {
            follow(run, mi, leader, escort, speed, dt);
        }
    }
}

/// Where the start room's knight stands: of the tile centres in `room` that an enemy can stand on, the one
/// nearest 32 px north of the heroes' spawns (their mean), clear of the spawns (20 px) and of barrels, chests
/// and torches (16 px). `None` when there is none: no knight.
pub fn knight_spot(layout: &Layout, room: &Rect) -> Option<Vec2> {
    let n = layout.player_spawns.len().max(1) as f64;
    let sum = layout.player_spawns.iter().fold(Vec2::ZERO, |a, &s| a + s);
    let want = sum * (1.0 / n) + Vec2::new(0.0, -32.0);
    let props = layout.barrels.iter().copied().chain(layout.chests.iter().map(|c| c.pos)).chain(layout.torches.iter().map(|t| t.pos()));
    let props: Vec<Vec2> = props.collect();
    (room.y..room.y + room.h)
        .flat_map(|y| (room.x..room.x + room.w).map(move |x| Map::center_of(x, y)))
        .filter(|&c| !layout.map.blocks_at(c, Mover::Enemy))
        .filter(|&c| layout.player_spawns.iter().all(|s| s.dist(c) > 20.0) && props.iter().all(|p| p.dist(c) > 16.0))
        .min_by(|a, b| a.dist(want).total_cmp(&b.dist(want)))
}

/// E beside a Neutral monster (the nearest in hand reach): it joins hero `pi` as a Friendly companion.
/// False when there is none.
pub fn recruit(run: &mut Run, pi: usize) -> bool {
    let at = run.players[pi].pos();
    let near = run
        .monsters
        .iter()
        .enumerate()
        .filter(|(_, m)| m.alive && m.side == Side::Neutral && m.wild.is_none())
        .map(|(i, m)| (i, m.pos.dist(at) - PLAYER_RADIUS - m.radius))
        .filter(|&(_, gap)| gap <= USE_REACH)
        .min_by(|a, b| a.1.total_cmp(&b.1));
    let Some((mi, _)) = near else { return false };
    let hero = run.players[pi].id;
    let (name, hero_name) = (run.monsters[mi].kind, run.players[pi].name.clone());
    let name = super::rules_log::tags::tag_name(name).unwrap_or("companion");
    let m = &mut run.monsters[mi];
    m.side = Side::Friendly;
    m.companion = Some(Companion { escort: &KNIGHT_ESCORT, leader: hero, recruiter: hero, summoned: false, prey: None, following: false, reach_t: 0.0 });
    m.ai = Ai::new(m.pos);
    let pos = m.pos;
    run.event(Ev::Msg { text: format!("{hero_name} recruited the {name}") }, None);
    run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: 10.0, k: 9 }, None);
    true
}

/// Companion `mi` has fallen: no XP, no coins, no kill.
pub fn died(run: &mut Run, mi: usize) {
    let m = &mut run.monsters[mi];
    m.alive = false;
    m.hp = 0.0;
    let (id, pos, kind) = (m.id, m.pos, m.kind);
    let name = super::rules_log::tags::tag_name(kind).unwrap_or("companion");
    run.event(Ev::Died { id, x: pos.x as f32, y: pos.y as f32, kind: kind as u8 }, None);
    run.event(Ev::Msg { text: format!("The {name} has fallen") }, None);
}

#[cfg(test)]
mod tests;
