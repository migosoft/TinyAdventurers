//! The body's facing: creatures do not write `aim` any more, they wish (`Monster.face_to`, else the way they
//! walk), and one pass per tick turns the body toward the wish at its turn speed (DEX, race). Walking off the
//! facing is slower (`off_facing_mul`).

use super::entities::{AiState, Glance, Monster};
use super::targets::Side;
use super::Run;
use crate::defs::effects::EffectKind;
use crate::protocol::Ev;
use crate::defs::abilities::{self as ab, Shape};
use crate::defs::attributes::Attributes;
use crate::sheet::ResolvedAbility;
use crate::defs::races::{BODY_TURN, HEAD_TURN, OFF_FACING_FULL, OFF_FACING_MIN, STARTLE};
use crate::dungeon::{Mover, TILE};
use crate::math::{angle_diff, Vec2};
use rand::Rng;
use std::f64::consts::{PI, TAU};

/// Seconds between idle looks and how long one lasts (min, max; `run.rng`), and how far of the neck they reach.
const IDLE_LOOK_EVERY: (f64, f64) = (3.0, 7.0);
const IDLE_LOOK_FOR: (f64, f64) = (1.0, 2.0);
const IDLE_LOOK_SPAN: f64 = 0.8;

/// How far (rad) off its target the body may be when an attack starts or is released.
pub const ATTACK_FACING: f64 = 30.0 * PI / 180.0;
/// A step shorter than this (px) is no walk: the body keeps its facing.
pub const WALK_MIN: f64 = 0.05;
/// The fastest a target's motion (px/s) may count when the turn leads it.
pub const LEAD_SPEED_MAX: f64 = 400.0;
/// How far (px) and in what steps the placement rays look for the longest free line.
const FREE_MAX: f64 = 20.0 * TILE;
const FREE_STEP: f64 = 4.0;
const RAYS: usize = 8;
/// A ray within this of the longest counts as a tie (px); the seeded pick chooses among the ties.
const FREE_TIE: f64 = TILE;
/// The body is home again when it faces its home facing within this angle (rad).
const HOME_SETTLED: f64 = 5.0 * PI / 180.0;

/// `from` turned toward `to` along the shorter way by at most `max_step` (rad); never past `to`.
pub fn turn_toward(from: f64, to: f64, max_step: f64) -> f64 {
    let d = angle_diff(to, from);
    if d.abs() <= max_step {
        to
    } else {
        angle_diff(from + d.signum() * max_step, 0.0)
    }
}

/// Seconds after a cue in which the creature shows no further one.
pub const CUE_QUIET: f64 = 2.0;

/// The attention cue (#422): `!` (k 0) when a creature starts to chase, `?` (k 1) when it starts to look or search.
/// Only a living, visible, hostile non-companion that can act sends one. `Ai.cued` is the state last compared: it
/// stands still for `CUE_QUIET` after a cue and during a hold (the Mimic's reveal), so a creature that flickers
/// between states shows one cue per quiet time, and the last cue shown catches up with the state it ended in.
pub fn cue(run: &mut Run, mi: usize) {
    let m = &mut run.monsters[mi];
    m.ai.cue_t = (m.ai.cue_t - super::DT).max(0.0);
    if m.ai.cue_t > 0.0 || m.ai.hold > 0.0 {
        return;
    }
    let (prev, now) = (m.ai.cued, m.ai.state);
    m.ai.cued = now;
    let looking = |s: AiState| matches!(s, AiState::Look | AiState::Search);
    let k = if now == AiState::Chase && prev != AiState::Chase {
        0
    } else if looking(now) && !looking(prev) {
        1
    } else {
        return;
    };
    if !m.alive || m.side != Side::Hostile || m.companion.is_some() || m.hiding || m.dormant || m.effects.no_act() || m.effects.has(EffectKind::Invisible) {
        return;
    }
    m.ai.cue_t = CUE_QUIET;
    let (id, pos) = (m.id, m.pos);
    run.event(Ev::Cue { id, x: pos.x as f32, y: pos.y as f32, k }, Some(pos));
}

/// How fast the body turns (rad/s).
pub fn body_speed(m: &Monster) -> f64 {
    BODY_TURN.get(&m.attrs) * m.turn
}

/// How fast the head turns (rad/s).
pub fn head_speed(a: &Attributes) -> f64 {
    HEAD_TURN.get(a)
}

/// The pause (s) before a creature reacts to a hit or a seen attack.
pub fn startle(a: &Attributes) -> f64 {
    STARTLE.per(a)
}

/// How long (s) a creature looks around, and how far (rad) to each side of the direction it turned to.
pub const SEARCH_TIME: f64 = 2.0;
const LOOK_AROUND: f64 = 60.0 * PI / 180.0;

/// How far (tiles) back along an attack a hit creature searches, how long (s) its head looks at a blow while
/// fighting, and how long (s) it ignores further blows after a glance in which it kept its target.
pub const SEARCH_BACK: f64 = 3.0;
pub const GLANCE_HOLD: f64 = 0.5;
pub const GLANCE_AGAIN: f64 = 4.0;

/// The point a creature searches after a blow that came from direction `back`: up to `SEARCH_BACK` tiles along
/// it, cut before the first spot the creature cannot stand on (wall, chasm). Never the attacker's position.
pub fn search_point(run: &Run, mi: usize, back: f64) -> Vec2 {
    let m = &run.monsters[mi];
    let dir = Vec2::from_angle(back);
    let (max, mut d) = (SEARCH_BACK * TILE, 0.0);
    // The whole body fits there: the point and its four edge points (the body's radius) are free of what its mover avoids.
    let free = |p: Vec2| [Vec2::ZERO, Vec2::new(m.radius, 0.0), Vec2::new(-m.radius, 0.0), Vec2::new(0.0, m.radius), Vec2::new(0.0, -m.radius)].iter().all(|&o| !run.layout.map.blocks_at(p + o, m.mover));
    while d < max && free(m.pos + dir * (d + FREE_STEP).min(max)) {
        d = (d + FREE_STEP).min(max);
    }
    m.pos + dir * d
}

/// Monster `mi` was hit by a blow that came from direction `back` (rad). After its startle its head glances
/// that way; with nothing to fight it turns and searches back along the blow. Never learns where the attacker is.
pub fn notice(run: &mut Run, mi: usize, back: f64) {
    let (pos, sight, gaze) = (run.monsters[mi].pos, run.monsters[mi].sight_now(), run.monsters[mi].gaze_dir());
    let m = &run.monsters[mi];
    // A hidden mimic, a companion and a fleeing animal have their own rules.
    let busy = m.ai.windup.is_some() || m.ai.cast.is_some() || m.slam.is_some() || m.channel.is_some() || m.dash.is_some() || m.ai.acting;
    // An immune hit (0 damage) is still felt. A chaser mid-glance ignores further blows, or sustained fire would
    // restart the glance (and its startle) forever.
    let glancing = m.ai.glance.is_some_and(|g| g.wait > 0.0 || m.ai.target.is_some());
    if !m.alive || m.hiding || busy || (m.ai.deaf_t > 0.0 && m.ai.target.is_some()) || glancing || m.companion.is_some() || m.wild.is_some_and(|w| w.scare.is_some()) {
        return;
    }
    let (chasing, stationary) = (m.ai.target.is_some(), m.base_ai == crate::defs::enemies::BaseAi::Stationary);
    let search = (!stationary && !m.is_boss).then(|| search_point(run, mi, back));
    let inside = crate::run::perception::in_cone(sight.cone, gaze, pos, pos + Vec2::from_angle(back) * TILE);
    let ai = &mut run.monsters[mi].ai;
    let g = Glance { wait: 0.0, dir: back, hold: GLANCE_HOLD, around: false, body: false, search: None };
    if chasing {
        if !inside {
            glance(run, mi, g);
        }
    } else if inside {
        // Already looking that way: no turn, straight to the search.
        if let Some(p) = search {
            ai.enter(AiState::Search);
            ai.last_known = p;
            ai.path.clear();
            ai.search_t = SEARCH_TIME;
        }
    } else {
        ai.enter(AiState::Look);
        ai.path.clear();
        glance(run, mi, Glance { body: true, search, ..g });
    }
}

/// Monster `mi` reacts, once per shot, to a foe's shot in flight that it sees and that would hit it or a creature
/// of its side near the shot (`notice` with the direction the shot came from). Ids of shots that are gone are dropped.
pub fn notice_shots(run: &mut Run, mi: usize) {
    let live: Vec<u32> = run.projectiles.iter().filter(|p| !p.dead).map(|p| p.id).collect();
    run.monsters[mi].ai.noticed.retain(|id| live.contains(id));
    let m = &run.monsters[mi];
    if !m.alive {
        return;
    }
    let (reach, sight, gaze, pos, side) = (run.smarts.notice_px(&m.attrs), m.sight_now(), m.gaze_dir(), m.pos, m.side);
    let mut seen = Vec::new();
    for (pi, pr) in run.projectiles.iter().enumerate() {
        if pr.dead || pr.owner == m.id || m.ai.noticed.contains(&pr.id) || pr.vel.len() <= 0.0 || pr.pos.dist(pos) > reach || !crate::run::perception::sees(run, sight, pos, gaze, pr.pos) {
            continue;
        }
        let aimed_at_us = run.monsters.iter().enumerate().any(|(j, o)| {
            o.alive && (j == mi || (o.side == side && o.pos.dist(pr.pos) <= reach)) && super::targets::may_hit(run, pr.side, super::effects::Creature::Monster(j)) && super::dodge::course_hit(run, pi, j, o.pos, 0.0).is_some()
        });
        if aimed_at_us {
            seen.push((pr.id, (pr.vel * -1.0).angle()));
        }
    }
    for (id, back) in seen {
        run.monsters[mi].ai.noticed.push(id);
        notice(run, mi, back);
    }
}

/// A creature sees `target` at `at` this tick: it becomes its target and last known place. Its motion while seen
/// (for leading the turn when it slips out of the cone) is sampled only from the tick before (`last_known` is
/// that tick's position), and never faster than a plausible runner.
pub fn see_target(ai: &mut super::entities::Ai, tick: u32, dt: f64, target: super::entities::Target, at: Vec2) {
    let sampled = ai.target == Some(target) && ai.seen_tick.is_some_and(|t| t.wrapping_add(1) == tick);
    ai.last_vel = if sampled { (at - ai.last_known) * (1.0 / dt) } else { Vec2::ZERO };
    if ai.last_vel.len() > LEAD_SPEED_MAX {
        ai.last_vel = ai.last_vel.norm() * LEAD_SPEED_MAX;
    }
    ai.seen_tick = Some(tick);
    ai.target = Some(target);
    ai.last_known = at;
}

/// Boss `bi`'s perception for this tick, before its script: the hero it sees (`bosses::target`) is its target and
/// its motion; one that left the cone makes the head and body turn to where it was (no search), and the look
/// ends in Idle. Nothing changes while the script is in an action.
pub fn track_boss(run: &mut Run, bi: usize) {
    let seen = super::bosses::target(run, bi).map(|(pi, p, _)| (run.players[pi].id, p));
    let (tick, dt) = (run.tick, super::DT);
    let (pos, sight) = (run.monsters[bi].pos, run.monsters[bi].sight_now());
    let m = &mut run.monsters[bi];
    if m.ai.acting {
        // Mid-action the body keeps turning to the target, like a monster's wind-up (flying, it follows its path).
        if m.ai.target.is_some() && !m.airborne {
            m.face_to = Some(pos.angle_to(m.ai.last_known));
        }
        return;
    }
    if let Some((id, p)) = seen {
        let ai = &mut m.ai;
        see_target(ai, tick, dt, super::entities::Target::Player(id), p);
        if ai.state != AiState::Chase {
            ai.enter(AiState::Chase);
        }
    } else if m.ai.target.is_some() {
        let lost = match m.ai.target {
            Some(super::entities::Target::Player(id)) => run.players.iter().find(|p| p.id == id && p.alive && !p.effects.has(crate::defs::effects::EffectKind::Invisible)).map(|p| p.pos()),
            _ => None,
        };
        let open = lost.is_some_and(|p| super::perception::in_open(run, sight, pos, p));
        let ai = &mut run.monsters[bi].ai;
        ai.target = None;
        let (last, vel) = (ai.last_known, ai.last_vel);
        ai.enter(AiState::Look);
        // Flying, the body follows the flight path: only the head looks.
        let airborne = run.monsters[bi].airborne;
        let lead = last + vel * startle(&run.monsters[bi].attrs);
        glance(run, bi, Glance { wait: 0.0, dir: pos.angle_to(if open { lead } else { last }), hold: SEARCH_TIME, around: open, body: !airborne, search: None });
    } else if m.ai.state == AiState::Look && m.ai.glance.is_none() {
        m.ai.enter(AiState::Idle);
    }
}

/// Monster `mi` starts glancing `g` after its startle.
pub fn glance(run: &mut Run, mi: usize, mut g: Glance) {
    g.wait = startle(&run.monsters[mi].attrs);
    run.monsters[mi].ai.search = g.search;
    run.monsters[mi].ai.glance = Some(g);
}

/// Counts the glance of monster `mi` down and turns its wishes into what it looks at; none while it startles.
/// Returns false while the creature is still startled (nothing turns then).
fn glance_wishes(m: &mut Monster, dt: f64) -> bool {
    let neck = m.sight_now().neck.to_radians();
    let (aim, vel) = (m.aim, m.ai.last_vel);
    let Some(g) = &mut m.ai.glance else { return true };
    if g.wait > 0.0 {
        g.wait -= dt;
        return false;
    }
    let mut look = g.dir;
    if g.around {
        let lead = if vel.len() > WALK_MIN { angle_diff(vel.angle(), g.dir).signum() } else { 1.0 };
        look += if g.hold > SEARCH_TIME / 2.0 { lead } else { -lead } * LOOK_AROUND;
    }
    let (dir, follow) = (g.dir, g.body && angle_diff(g.dir, aim).abs() > neck);
    g.hold -= dt;
    if g.hold <= 0.0 {
        m.ai.glance = None;
        // A chaser's glance that ended with its target kept: it ignores blows for a while.
        if m.ai.state == AiState::Chase {
            m.ai.deaf_t = GLANCE_AGAIN;
        }
    }
    m.look_to = Some(look);
    if follow {
        m.face_to = Some(dir);
    }
    true
}

/// How far (rad) off the target the body may be for an attack to start or be released: none for an
/// ability that needs no facing, half the arc for a wide swing, else `ATTACK_FACING`.
pub fn gate(a: &ResolvedAbility) -> Option<f64> {
    match ab::def(a.id).shape {
        Shape::Ring | Shape::SelfArea | Shape::Buff | Shape::Summon => None,
        Shape::Swing => Some(ATTACK_FACING.max(a.arc / 2.0)),
        Shape::Projectile | Shape::Blast | Shape::Dash | Shape::GroundArea | Shape::Breath | Shape::Gaze => Some(ATTACK_FACING),
    }
}

/// Whether the body of monster `mi` faces `at` within `gate`.
pub fn faces(run: &Run, mi: usize, at: Vec2, gate: Option<f64>) -> bool {
    let m = &run.monsters[mi];
    gate.map_or(true, |g| angle_diff(m.pos.angle_to(at), m.aim).abs() <= g)
}

/// Where the attack goes: `at` inside the gate, else the point at the same distance on the gate's edge.
pub fn release_point(run: &Run, mi: usize, at: Vec2, gate: Option<f64>) -> Vec2 {
    let m = &run.monsters[mi];
    let Some(g) = gate else { return at };
    let d = angle_diff(m.pos.angle_to(at), m.aim);
    if d.abs() <= g {
        return at;
    }
    m.pos + Vec2::from_angle(m.aim + d.signum() * g) * m.pos.dist(at)
}

/// The factor on the walking speed for a walk along `walk_angle` with the body facing `aim`.
pub fn off_facing_mul(walk_angle: f64, aim: f64) -> f64 {
    let off = angle_diff(walk_angle, aim).abs();
    if off <= OFF_FACING_FULL {
        1.0
    } else {
        1.0 - (1.0 - OFF_FACING_MIN) * (off - OFF_FACING_FULL) / (PI - OFF_FACING_FULL)
    }
}

/// The turn pass for monster `mi`, which moved by `moved` this tick on its own accord.
pub fn turn(run: &mut Run, mi: usize, moved: Vec2, dt: f64) {
    let m = &mut run.monsters[mi];
    // Every creature passes here each tick, bosses too (their scripts never run the base AI).
    m.ai.deaf_t = (m.ai.deaf_t - dt).max(0.0);
    if !m.alive || m.dormant || m.hiding || m.effects.no_act() || m.effects.no_turn() {
        return;
    }
    if !glance_wishes(m, dt) {
        return;
    }
    let wish = m.face_to.or_else(|| (moved.len() > WALK_MIN).then(|| moved.angle()));
    if let Some(w) = wish {
        m.aim = turn_toward(m.aim, w, body_speed(m) * dt);
    }
    // The head: straight ahead while an attack winds up or runs, else toward the wish within the neck.
    let busy = m.ai.windup.is_some() || m.ai.cast.is_some() || m.slam.is_some() || m.channel.is_some() || m.dash.is_some() || m.ai.acting;
    let neck = m.sight_now().neck.to_radians();
    let want = match m.look_to {
        Some(l) if !busy => angle_diff(l, m.aim).clamp(-neck, neck),
        _ => 0.0,
    };
    m.gaze = turn_toward(m.gaze, want, head_speed(&m.attrs) * dt);
}

/// An idle creature now and then looks to one side (`look_to`), within most of its neck; neck 0 never looks.
pub fn idle_look(run: &mut Run, mi: usize, dt: f64) {
    let neck = run.monsters[mi].sight_now().neck.to_radians();
    if neck <= 0.0 {
        return;
    }
    let ai = &mut run.monsters[mi].ai;
    if let Some((rel, left)) = ai.idle_look {
        ai.idle_look = (left > dt).then_some((rel, left - dt));
        run.monsters[mi].look_to = Some(run.monsters[mi].aim + rel);
        return;
    }
    ai.idle_look_t -= dt;
    if ai.idle_look_t <= 0.0 {
        let rel = run.rng.gen_range(-IDLE_LOOK_SPAN..IDLE_LOOK_SPAN) * neck;
        let (every, long) = (run.rng.gen_range(IDLE_LOOK_EVERY.0..IDLE_LOOK_EVERY.1), run.rng.gen_range(IDLE_LOOK_FOR.0..IDLE_LOOK_FOR.1));
        let ai = &mut run.monsters[mi].ai;
        ai.idle_look = Some((rel, long));
        ai.idle_look_t = every;
    }
}

/// The facing a creature placed at `pos` gets: the longest free line among 8 rays, `pick` (0..1) choosing among
/// those within a tile of the longest.
pub fn spawn_facing(run: &Run, pos: Vec2, pick: f64) -> f64 {
    let len = |k: usize| {
        let dir = Vec2::from_angle(k as f64 * TAU / RAYS as f64);
        let mut d = 0.0;
        while d < FREE_MAX && !run.layout.map.blocks_at(pos + dir * (d + FREE_STEP), Mover::Enemy) {
            d += FREE_STEP;
        }
        d
    };
    let lens: Vec<f64> = (0..RAYS).map(len).collect();
    let best = lens.iter().cloned().fold(0.0, f64::max);
    let ties: Vec<usize> = (0..RAYS).filter(|&k| lens[k] >= best - FREE_TIE).collect();
    let k = ties[((pick * ties.len() as f64) as usize).min(ties.len() - 1)];
    angle_diff(k as f64 * TAU / RAYS as f64, 0.0)
}

/// Faces creature `id`, just placed by the level, along its longest free line; that is its home facing too.
pub fn place(run: &mut Run, id: u32) {
    let Some(mi) = run.monster_idx(id) else { return };
    let pick = run.rng.gen::<f64>();
    let a = spawn_facing(run, run.monsters[mi].pos, pick);
    run.monsters[mi].aim = a;
    run.monsters[mi].ai.home_aim = a;
}

/// Whether the body faces its home facing (within `HOME_SETTLED`).
pub fn at_home_facing(m: &Monster) -> bool {
    angle_diff(m.aim, m.ai.home_aim).abs() < HOME_SETTLED
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::attributes::BASELINE_ATTRS;
    use crate::defs::abilities::AbilityId;
    use crate::defs::enemies::EnemyType;
    use crate::dungeon::Tile;
    use crate::protocol::{BossId, ClassId};
    use crate::run::ai::move_toward;
    use crate::run::ai::tests::open_floor;
    use crate::run::entities::AiState;
    use crate::run::tests::test_run;
    use crate::run::DT;

    /// An open floor with the boss far away and one `t`, 100 px east of the hero, all-round sight, DEX 10.
    fn arena(t: EnemyType) -> (Run, usize) {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let ppos = run.players[0].pos();
        let id = run.spawn_enemy(t, ppos + Vec2::new(100.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].sight.cone = 360.0;
        run.monsters[mi].attrs = BASELINE_ATTRS;
        (run, mi)
    }

    fn steps(run: &mut Run, secs: f64) {
        for _ in 0..(secs / DT).round() as usize {
            run.step();
        }
    }

    #[test]
    fn turn_toward_takes_the_shorter_way_and_never_passes_the_goal() {
        assert!((turn_toward(0.0, 2.0, 0.5) - 0.5).abs() < 1e-12);
        assert!((turn_toward(0.0, -2.0, 0.5) + 0.5).abs() < 1e-12);
        // Across the +-PI seam: from 3.0 to -3.0 is 0.283 rad up, not 6 down.
        assert!((angle_diff(turn_toward(3.0, -3.0, 0.1), 3.1)).abs() < 1e-12);
        assert!((angle_diff(turn_toward(3.0, -3.0, 1.0), -3.0)).abs() < 1e-12, "stops on the goal");
        assert_eq!(turn_toward(1.0, 1.0, 0.5), 1.0);
    }

    #[test]
    fn a_creature_turns_its_body_at_its_turn_speed() {
        let (mut run, mi) = arena(EnemyType::OrcWarrior);
        steps(&mut run, 0.25);
        let a = run.monsters[mi].aim;
        assert!(angle_diff(a, PI / 2.0).abs() < 3f64.to_radians(), "a quarter second: {}", a.to_degrees());
        steps(&mut run, 0.25);
        assert!(angle_diff(run.monsters[mi].aim, PI).abs() < 3f64.to_radians(), "half a second: faces west");
    }

    #[test]
    fn more_dex_turns_faster() {
        let (mut run, mi) = arena(EnemyType::OrcWarrior);
        let base = body_speed(&run.monsters[mi]);
        run.monsters[mi].attrs = BASELINE_ATTRS.with_delta(Attributes::new(0, 10, 0, 0, 0, 0));
        assert!(body_speed(&run.monsters[mi]) > base);
        assert!((base - TAU).abs() < 1e-9, "360 degrees a second at DEX 10");
    }

    #[test]
    fn an_ogre_turns_slower_than_an_orc() {
        let (run, orc) = arena(EnemyType::OrcWarrior);
        let (run2, ogre) = arena(EnemyType::Ogre);
        let (a, b) = (body_speed(&run.monsters[orc]), body_speed(&run2.monsters[ogre]));
        assert!((b / a - 0.6).abs() < 1e-9, "{a} {b}");
    }

    /// How far the orc walks west in one tick when its body faces `aim`.
    fn walked(aim: f64, airborne: bool) -> f64 {
        let (mut run, mi) = arena(EnemyType::OrcWarrior);
        run.monsters[mi].aim = aim;
        run.monsters[mi].airborne = airborne;
        let before = run.monsters[mi].pos;
        let speed = run.monsters[mi].speed;
        move_toward(&mut run, mi, before - Vec2::new(200.0, 0.0), speed, DT);
        before.dist(run.monsters[mi].pos)
    }

    #[test]
    fn walking_backwards_is_slower() {
        let full = walked(PI, false);
        assert!(full > 0.0);
        assert!((walked(0.0, false) / full - 0.6).abs() < 0.03, "backwards");
        assert!((walked(PI - 0.7, false) / full - 1.0).abs() < 1e-9, "within 45 degrees");
    }

    #[test]
    fn a_flying_creature_is_not_slowed() {
        assert!((walked(0.0, true) / walked(PI, true) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn a_chaser_turns_without_stopping() {
        let (mut run, mi) = arena(EnemyType::OrcWarrior);
        let mut last = run.monsters[mi].pos;
        for i in 0..10 {
            run.step();
            let p = run.monsters[mi].pos;
            assert!(p.dist(last) > 1e-6, "tick {i}: it keeps walking while it turns");
            last = p;
        }
        assert!(run.monsters[mi].aim.abs() > 0.1, "and it turned");
    }

    #[test]
    fn turning_settles() {
        let (mut run, mi) = arena(EnemyType::OrcWarrior);
        let mut signs = Vec::new();
        for _ in 0..60 {
            let before = run.monsters[mi].aim;
            run.monsters[mi].face_to = Some(PI); // exactly behind it
            turn(&mut run, mi, Vec2::ZERO, DT);
            let d = angle_diff(run.monsters[mi].aim, before);
            if d != 0.0 {
                signs.push(d.signum());
            }
        }
        assert!(signs.windows(2).all(|w| w[0] == w[1]), "one direction all the way");
        assert!(angle_diff(run.monsters[mi].aim, PI).abs() < 1e-12, "and it stays on the wish");
    }

    #[test]
    fn knockback_does_not_turn_a_creature() {
        let (mut run, mi) = arena(EnemyType::OrcWarrior);
        run.monsters[mi].aim = 1.0;
        run.monsters[mi].knock = Vec2::new(-200.0, 0.0);
        let before = run.monsters[mi].pos;
        run.step();
        assert!(run.monsters[mi].pos.dist(before) > 1.0, "it slid");
        assert_eq!(run.monsters[mi].aim, 1.0);
    }

    #[test]
    fn a_placed_creature_faces_the_longest_free_line() {
        let (mut run, mi) = arena(EnemyType::OrcWarrior);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.monsters[mi].pos);
        for y in ty - 6..=ty + 6 {
            for x in tx - 14..=tx + 14 {
                run.layout.map.set(x, y, Tile::Wall);
            }
        }
        for x in tx..=tx + 10 {
            run.layout.map.set(x, ty, Tile::Floor);
        }
        let pos = crate::dungeon::Map::center_of(tx, ty);
        for pick in [0.0, 0.5, 0.99] {
            assert!(spawn_facing(&run, pos, pick).abs() < 1e-9, "east, pick {pick}");
        }
    }

    #[test]
    fn a_creature_back_home_turns_to_its_home_facing() {
        let (mut run, mi) = arena(EnemyType::OrcWarrior);
        run.monsters[mi].sight.vision = 0.0;
        run.monsters[mi].aim = -1.0;
        run.monsters[mi].ai.home_aim = 1.2;
        run.monsters[mi].ai.state = AiState::Return;
        steps(&mut run, 1.0);
        assert_eq!(run.monsters[mi].ai.state, AiState::Idle);
        assert!(angle_diff(run.monsters[mi].aim, 1.2).abs() < 5f64.to_radians(), "{}", run.monsters[mi].aim);
    }

    /// Runs `secs` and returns the largest per-tick change of the gaze (rad) and the largest |gaze| seen.
    fn watch(run: &mut Run, mi: usize, secs: f64) -> (f64, f64) {
        let (mut jump, mut wide) = (0.0f64, 0.0f64);
        for _ in 0..(secs / DT).round() as usize {
            let before = run.monsters[mi].gaze;
            run.step();
            jump = jump.max(angle_diff(run.monsters[mi].gaze, before).abs());
            wide = wide.max(run.monsters[mi].gaze.abs());
        }
        (jump, wide)
    }

    #[test]
    fn the_head_reaches_a_side_target_before_the_body() {
        let (mut run, mi) = arena(EnemyType::OrcWarrior);
        run.monsters[mi].aim = PI - 70f64.to_radians(); // the hero lies 70 degrees to the side
        let (jump, _) = watch(&mut run, mi, 0.1);
        let m = &run.monsters[mi];
        assert!(angle_diff(m.gaze_dir(), PI).abs() < 5f64.to_radians(), "head on it: {}", m.gaze_dir().to_degrees());
        assert!(angle_diff(m.aim, PI).abs() > 20f64.to_radians(), "body still off");
        assert!(jump <= head_speed(&m.attrs) * DT + 1e-9, "never jumps");
    }

    #[test]
    fn the_head_stops_at_its_neck() {
        let (mut run, mi) = arena(EnemyType::OrcWarrior);
        run.monsters[mi].aim = 0.0; // the hero is straight behind
        let neck = run.monsters[mi].sight_now().neck.to_radians();
        let (jump, wide) = watch(&mut run, mi, 0.3);
        assert!(wide <= neck + 1e-9 && wide > neck - 0.05, "{wide} of {neck}");
        assert!(jump <= head_speed(&run.monsters[mi].attrs) * DT + 1e-9);
    }

    #[test]
    fn a_mimic_has_no_neck() {
        let (mut run, mi) = arena(EnemyType::Mimic);
        run.monsters[mi].hiding = false;
        run.monsters[mi].dormant = false;
        run.monsters[mi].aim = 0.0;
        let (_, wide) = watch(&mut run, mi, 0.5);
        assert_eq!(wide, 0.0);
    }

    #[test]
    fn the_head_is_forward_during_a_wind_up() {
        let (mut run, mi) = arena(EnemyType::OrcWarrior);
        run.monsters[mi].gaze = 1.0;
        run.monsters[mi].ai.windup = Some(crate::run::entities::Windup { t: 5.0, aim: 0.0, alt: false, at: None, id: None });
        let (jump, _) = watch(&mut run, mi, 0.3);
        assert_eq!(run.monsters[mi].gaze, 0.0);
        assert!(jump <= head_speed(&run.monsters[mi].attrs) * DT + 1e-9);
    }

    #[test]
    fn an_idle_creature_looks_about() {
        let (mut run, mi) = arena(EnemyType::OrcWarrior);
        run.monsters[mi].sight.vision = 0.0;
        run.monsters[mi].wanders = false;
        let aim = run.monsters[mi].aim;
        let (mut left, mut back) = (false, false);
        for _ in 0..(10.0 / DT) as usize {
            run.step();
            let g = run.monsters[mi].gaze.abs();
            left |= g > 0.1;
            back |= left && g < 1e-9;
        }
        assert!(left && back, "it looked and came back");
        assert_eq!(run.monsters[mi].aim, aim, "the body did not turn");
    }

    #[test]
    fn the_head_never_jumps_while_idle() {
        let (mut run, mi) = arena(EnemyType::OrcWarrior);
        run.monsters[mi].sight.vision = 0.0;
        run.monsters[mi].wanders = false;
        let (jump, _) = watch(&mut run, mi, 12.0);
        assert!(jump <= head_speed(&run.monsters[mi].attrs) * DT + 1e-9);
    }

    /// An orc `d` px east of the hero (player 0), on open floor, attack ready, body facing the hero.
    fn duel(d: f64) -> (Run, usize) {
        let (mut run, mi) = arena(EnemyType::OrcWarrior);
        run.monsters[mi].sight.cone = 150.0; // the race's cone, which `arena` widened
        let ppos = run.players[0].pos();
        run.monsters[mi].pos = ppos + Vec2::new(d, 0.0);
        run.monsters[mi].ai.cd = 0.0;
        crate::run::tests::face(&mut run, mi, ppos);
        (run, mi)
    }

    /// Puts player 0 at `at`.
    fn hero_to(run: &mut Run, at: Vec2) {
        run.players[0].mv.x = at.x;
        run.players[0].mv.y = at.y;
    }

    #[test]
    fn no_wind_up_until_the_body_faces_the_target() {
        let (mut run, mi) = duel(14.0);
        let hero = run.players[0].pos();
        run.monsters[mi].aim = 0.0; // away from the hero, who stands to the west
        run.monsters[mi].sight.cone = 360.0; // it sees the hero, but has to turn to hit
        let mut started = None;
        for _ in 0..60 {
            run.step();
            if started.is_none() && run.monsters[mi].ai.windup.is_some() {
                started = Some(angle_diff(run.monsters[mi].pos.angle_to(hero), run.monsters[mi].aim).abs());
                break;
            }
            assert!(run.monsters[mi].ai.windup.is_none());
        }
        let off = started.expect("it turns and then winds up");
        let gate = gate(run.monsters[mi].kit.first().unwrap()).unwrap();
        assert!(off <= gate + 1e-9, "faced within the gate ({}): {}", gate.to_degrees(), off.to_degrees());
        assert!(off > 1f64.to_radians(), "and it did not wait for a perfect aim: {}", off.to_degrees());
    }

    #[test]
    fn a_slam_needs_no_facing() {
        let (mut run, mi) = crate::run::ai::tests::ogre_among(&[Vec2::new(20.0, 0.0), Vec2::new(-16.0, 8.0)]);
        run.monsters[mi].sight.cone = 360.0;
        run.monsters[mi].aim = PI / 2.0; // both heroes are off to the side
        crate::run::ai::tick_monster(&mut run, mi, DT);
        assert!(run.monsters[mi].slam.is_some(), "the slam starts at once");
    }

    #[test]
    fn a_wide_swing_starts_at_half_its_arc() {
        let kit = crate::sheet::kit_for(crate::sheet::KitSource::Enemy(EnemyType::OrcWarrior), &crate::defs::enemies::attr_sources(EnemyType::OrcWarrior).total(), &[]);
        let strike = kit.get(crate::defs::abilities::AbilityId::Strike).unwrap().clone();
        let narrow = crate::sheet::ResolvedAbility { arc: 20f64.to_radians(), ..strike.clone() };
        let wide = crate::sheet::ResolvedAbility { arc: 140f64.to_radians(), ..strike };
        assert_eq!(gate(&narrow), Some(ATTACK_FACING));
        assert!((gate(&wide).unwrap() - 70f64.to_radians()).abs() < 1e-12);
        let (run, mi) = duel(14.0);
        let at = Vec2::new(0.0, 10.0);
        let rel = |deg: f64| run.monsters[mi].pos + Vec2::from_angle(run.monsters[mi].aim + deg.to_radians()) * at.y;
        assert!(!faces(&run, mi, rel(50.0), gate(&narrow)));
        assert!(faces(&run, mi, rel(50.0), gate(&wide)));
        assert!(faces(&run, mi, rel(180.0), None));
    }

    /// A duel where the hero steps `deg` degrees around the orc once its wind-up runs; returns the run, the orc,
    /// the orc's aim before the tick that released the blow and the hero's hp before.
    fn step_aside(deg: f64) -> (Run, usize, f64, f64) {
        step_aside_seen(deg, 150.0)
    }

    /// `step_aside` for an orc with a `cone` (degrees) wide.
    fn step_aside_seen(deg: f64, cone: f64) -> (Run, usize, f64, f64) {
        let (mut run, mi) = duel(14.0);
        run.monsters[mi].sight.cone = cone;
        let (hero, hp) = (run.players[0].pos(), run.players[0].hp);
        for _ in 0..30 {
            run.step();
            if run.monsters[mi].ai.windup.is_some() {
                break;
            }
        }
        assert!(run.monsters[mi].ai.windup.is_some(), "the wind-up started");
        let pos = run.monsters[mi].pos;
        hero_to(&mut run, pos + Vec2::from_angle(pos.angle_to(hero) + deg.to_radians()) * 14.0);
        let mut before = run.monsters[mi].aim;
        for _ in 0..120 {
            before = run.monsters[mi].aim;
            run.step();
            if run.monsters[mi].ai.windup.is_none() {
                break;
            }
        }
        assert!(run.monsters[mi].ai.windup.is_none(), "the wind-up ended");
        (run, mi, before, hp)
    }

    #[test]
    fn a_wind_up_is_not_cancelled_when_the_target_steps_out_of_the_cone() {
        let (run, mi, before, _) = step_aside(100.0);
        let m = &run.monsters[mi];
        assert!(m.ai.cd > 0.0, "the swing was released: its cooldown runs");
        let g = gate(m.kit.first().unwrap()).unwrap();
        assert!(angle_diff(m.aim, before).abs() <= g + body_speed(m) * DT, "no jump: {}", angle_diff(m.aim, before).to_degrees());
    }

    #[test]
    fn a_seen_hero_outside_the_gate_is_swung_at_no_further_than_the_gate() {
        let (run, mi, before, _) = step_aside_seen(60.0, 360.0);
        let m = &run.monsters[mi];
        let g = gate(m.kit.first().unwrap()).unwrap();
        assert!(m.ai.cd > 0.0, "released");
        assert!(angle_diff(m.aim, before).abs() <= g + body_speed(m) * DT, "no jump: {}", angle_diff(m.aim, before).to_degrees());
    }

    #[test]
    fn a_led_shot_at_a_strafing_target_stays_within_the_gate() {
        let (mut run, mi) = arena(EnemyType::OrcArcher);
        run.monsters[mi].ai.cd = 0.0;
        let hero = run.players[0].pos();
        run.monsters[mi].pos = hero + Vec2::new(80.0, 0.0);
        crate::run::tests::face(&mut run, mi, hero);
        let g = gate(run.monsters[mi].kit.first().unwrap()).unwrap();
        let (mut released, mut y) = (0, 0.0);
        for _ in 0..(8.0 / DT) as usize {
            y += 120.0 * DT;
            hero_to(&mut run, hero + Vec2::new(0.0, 40.0 * (y / 40.0).sin()));
            let (was, before) = (run.monsters[mi].ai.windup.is_some(), run.monsters[mi].aim);
            run.step();
            if was && run.monsters[mi].ai.windup.is_none() {
                released += 1;
                let m = &run.monsters[mi];
                assert!(angle_diff(m.aim, before).abs() <= g + body_speed(m) * DT, "no jump: {}", angle_diff(m.aim, before).to_degrees());
            }
        }
        assert!(released > 0, "it shot");
    }

    #[test]
    fn stepping_behind_makes_the_blow_miss() {
        let (run, mi, _, hp) = step_aside(180.0);
        assert!(run.monsters[mi].ai.cd > 0.0, "the attack's cooldown started");
        assert_eq!(run.players[0].hp, hp);
        assert!(!run.events.iter().any(|(e, _)| matches!(e, crate::protocol::Ev::Dmg { .. })), "no blow landed");
    }

    #[test]
    fn a_circled_creature_still_attacks() {
        let (mut run, mi) = duel(24.0);
        let (centre, hp) = (run.monsters[mi].pos, run.players[0].hp);
        let mut hit = false;
        let mut a = 0.0f64;
        for _ in 0..(6.0 / DT) as usize {
            a += 80.0 / 24.0 * DT;
            hero_to(&mut run, centre + Vec2::from_angle(a + PI) * 24.0);
            run.step();
            hit |= run.players[0].hp < hp;
        }
        assert!(hit, "a hero circling at speed 80 is hit at least once in 6 s");
    }

    /// The orc (cone 150, neck 80) was chasing the hero, who now stands west of it at 100 px, out of its cone;
    /// its body faces `aim` and it last saw the hero at `known`.
    fn lost(aim: f64, known: Option<Vec2>) -> (Run, usize) {
        let (mut run, mi) = duel(100.0);
        let hero = run.players[0].pos();
        let id = run.players[0].id;
        let m = &mut run.monsters[mi];
        m.aim = aim;
        m.gaze = 0.0;
        m.ai.state = AiState::Chase;
        m.ai.target = Some(crate::run::entities::Target::Player(id));
        m.ai.last_known = known.unwrap_or(hero);
        m.ai.last_vel = Vec2::ZERO;
        (run, mi)
    }

    /// Steps until the orc leaves `Look` (or `max` seconds); returns the states it went through.
    fn run_look(run: &mut Run, mi: usize, max: f64) -> (Vec<AiState>, f64) {
        let (mut seen, mut look_aim) = (Vec::new(), run.monsters[mi].aim);
        for _ in 0..(max / DT) as usize {
            run.step();
            let s = run.monsters[mi].ai.state;
            if seen.last() != Some(&s) {
                seen.push(s);
            }
            if s == AiState::Look {
                look_aim = run.monsters[mi].aim;
            }
            if s == AiState::Chase {
                break;
            }
        }
        (seen, look_aim)
    }

    #[test]
    fn a_target_at_its_side_is_followed_by_the_head_alone() {
        let (mut run, mi) = lost(PI - 78f64.to_radians(), None);
        let aim = run.monsters[mi].aim;
        let (states, look_aim) = run_look(&mut run, mi, 2.0);
        assert_eq!(states, vec![AiState::Look, AiState::Chase], "it looked, found the hero and chased");
        assert!(angle_diff(look_aim, aim).abs() < 5f64.to_radians(), "the body stayed: {look_aim}");
    }

    #[test]
    fn a_target_behind_turns_the_body_too() {
        let (mut run, mi) = lost(0.0, None);
        let (states, _) = run_look(&mut run, mi, 2.0);
        assert_eq!(states, vec![AiState::Look, AiState::Chase]);
        assert!(angle_diff(run.monsters[mi].aim, PI).abs() < 80f64.to_radians(), "the body turned toward the hero: {}", run.monsters[mi].aim);
    }

    #[test]
    fn it_turns_and_does_not_walk() {
        let (mut run, mi) = lost(0.0, None);
        let before = run.monsters[mi].pos;
        run.step();
        assert_eq!(run.monsters[mi].ai.state, AiState::Look);
        loop {
            run.step();
            if run.monsters[mi].ai.state != AiState::Look {
                break;
            }
            assert!(run.monsters[mi].pos.dist(before) < 0.5, "it stands");
        }
    }

    #[test]
    fn the_turn_leads_where_the_target_was_going() {
        let (mut run, mi) = lost(0.0, None);
        let vel = Vec2::new(0.0, 300.0);
        run.monsters[mi].ai.last_vel = vel;
        let (hero, attrs) = (run.players[0].pos(), run.monsters[mi].attrs);
        run.step();
        let g = run.monsters[mi].ai.glance.expect("a glance");
        let want = run.monsters[mi].pos.angle_to(hero + vel * startle(&attrs));
        assert!(angle_diff(g.dir, want).abs() < 1e-9 && angle_diff(g.dir, run.monsters[mi].pos.angle_to(hero)).abs() > 0.05);
    }

    /// Steps `secs`, each tick putting the hero straight behind the orc's gaze (never seen).
    fn keep_behind(run: &mut Run, mi: usize, secs: f64, mut each: impl FnMut(&Run)) {
        for _ in 0..(secs / DT).round() as usize {
            let m = &run.monsters[mi];
            let at = m.pos + Vec2::from_angle(m.gaze_dir() + PI) * 100.0;
            hero_to(run, at);
            run.step();
            each(run);
            assert!(run.monsters[mi].ai.target.is_none(), "it never sees the hero again");
        }
    }

    #[test]
    fn a_target_that_keeps_circling_is_given_up() {
        let (mut run, mi) = lost(0.0, None);
        let wait = startle(&run.monsters[mi].attrs);
        let mut t = 0.0;
        let mut back = None;
        keep_behind(&mut run, mi, 3.0, |r| {
            t += DT;
            // Return is left for Idle in the same tick (it is at home), so "not Look" is the sign.
            if back.is_none() && r.monsters[mi].ai.state != AiState::Look {
                back = Some(t);
            }
        });
        let back = back.expect("it gave up");
        assert!((back - (wait + SEARCH_TIME)).abs() < 0.15, "after the startle and the search time: {back}");
    }

    #[test]
    fn looking_around_goes_to_one_side_then_the_other() {
        let (mut run, mi) = lost(0.0, Some(Vec2::new(0.0, 0.0)));
        let ahead = run.monsters[mi].pos + Vec2::new(100.0, 0.0);
        run.monsters[mi].ai.last_known = ahead; // straight ahead of the body
        let aim = run.monsters[mi].aim;
        let (mut hi, mut lo, mut first_hi) = (0.0f64, 0.0f64, None);
        keep_behind(&mut run, mi, 2.4, |r| {
            let rel = angle_diff(r.monsters[mi].gaze_dir(), aim);
            hi = hi.max(rel);
            lo = lo.min(rel);
            if first_hi.is_none() && rel < -0.5 {
                first_hi = Some(false);
            }
            if first_hi.is_none() && rel > 0.5 {
                first_hi = Some(true);
            }
        });
        assert!(hi > 55f64.to_radians() && lo < -55f64.to_radians(), "{hi} {lo}");
        assert_eq!(first_hi, Some(true), "the lead side (left when it has no lead) first");
        assert!(angle_diff(run.monsters[mi].aim, aim).abs() < 1f64.to_radians(), "the body stood");
    }

    #[test]
    fn a_hidden_target_is_searched_where_it_was_last_seen() {
        let (mut run, mi) = lost(0.0, None);
        let spot = run.monsters[mi].pos + Vec2::new(120.0, 0.0);
        run.monsters[mi].ai.last_known = spot;
        run.monsters[mi].sight.vision = 0.0; // the hero is out of sight, not just out of the cone
        let (mut states, mut near) = (Vec::new(), false);
        for _ in 0..(8.0 / DT) as usize {
            run.step();
            let s = run.monsters[mi].ai.state;
            if states.last() != Some(&s) {
                states.push(s);
            }
            near |= run.monsters[mi].pos.dist(spot) < 20.0;
        }
        assert_eq!(&states[..2], &[AiState::Search, AiState::Return]);
        assert!(near, "it walked to the spot");
    }

    #[test]
    fn a_target_set_without_a_sample_gives_no_lead_and_a_fast_one_is_clamped() {
        use crate::run::entities::Target;
        let (mut run, mi) = duel(100.0);
        let hero = run.players[0].pos();
        let id = run.players[0].id;
        // A target set by something else (a charm switch): `last_known` is far off, but there is no sample.
        run.monsters[mi].ai.target = Some(Target::Player(id));
        run.monsters[mi].ai.last_known = hero + Vec2::new(3000.0, 0.0);
        run.step();
        assert_eq!(run.monsters[mi].ai.last_vel, Vec2::ZERO, "no spike");
        // A real sample of the tick before, but an absurd jump: it is clamped.
        run.monsters[mi].ai.last_known = hero + Vec2::new(3000.0, 0.0);
        run.step();
        assert!(run.monsters[mi].ai.last_vel.len() <= LEAD_SPEED_MAX + 1e-9);
    }

    #[test]
    fn a_creature_in_look_that_is_hit_searches_without_the_old_glance() {
        let (mut run, mi) = lost(0.0, None);
        run.step();
        assert_eq!(run.monsters[mi].ai.state, AiState::Look);
        run.monsters[mi].ai.glance.as_mut().unwrap().wait = 0.0; // past the startle
        // A blow from the east: the orc faces east, so the blow's origin is inside its cone.
        run.hurt_monster(mi, crate::run::Damage::physical(1.0).along(Vec2::new(-1.0, 0.0)), false, Some(0));
        assert_eq!(run.monsters[mi].ai.state, AiState::Search);
        assert!(run.monsters[mi].ai.glance.is_none(), "the old look is gone");
    }

    #[test]
    fn a_stationary_creature_turns_but_does_not_walk_or_search() {
        let (mut run, mi) = lost(0.0, None);
        run.monsters[mi].base_ai = crate::defs::enemies::BaseAi::Stationary;
        let before = run.monsters[mi].pos;
        let (mut turned, mut states) = (false, Vec::new());
        // The hero stands behind it; keep it unseen until the look is over.
        for _ in 0..(3.0 / DT) as usize {
            let m = &run.monsters[mi];
            let at = m.pos + Vec2::from_angle(m.gaze_dir() + PI) * 100.0;
            hero_to(&mut run, at);
            run.step();
            let m = &run.monsters[mi];
            turned |= angle_diff(m.aim, 0.0).abs() > 60f64.to_radians();
            assert!(m.pos.dist(before) < 0.5, "it does not walk");
            if states.last() != Some(&m.ai.state) {
                states.push(m.ai.state);
            }
        }
        assert!(turned, "the body turned toward the last sighting");
        assert!(!states.contains(&AiState::Search) && states.last() == Some(&AiState::Idle), "{states:?}");
    }

    #[test]
    fn the_startle_comes_first() {
        let (mut run, mi) = lost(0.0, None);
        let wait = startle(&run.monsters[mi].attrs);
        let (aim, gaze) = (run.monsters[mi].aim, run.monsters[mi].gaze);
        for _ in 0..((wait / DT) as usize - 2) {
            run.step();
            assert_eq!((run.monsters[mi].aim, run.monsters[mi].gaze), (aim, gaze), "nothing turns yet");
        }
        steps(&mut run, 0.1);
        assert_ne!(run.monsters[mi].aim, aim, "then it turns");
        let wise = Attributes::new(0, 0, 0, 0, 10, 0);
        assert!(startle(&BASELINE_ATTRS.with_delta(wise)) < wait, "more WIL is quicker");
    }

    // ----- hits carry their direction, and a hit creature looks back along it -----

    use crate::defs::damage::{Damage, DamageType};
    use crate::run::targets::Side;

    fn put(run: &mut Run, pi: usize, at: Vec2) {
        run.players[pi].mv.x = at.x;
        run.players[pi].mv.y = at.y;
    }

    #[test]
    fn a_poison_tick_gives_no_direction() {
        let (mut run, mi) = arena(EnemyType::OrcWarrior);
        run.monsters[mi].hurt_dir = Some(1.0);
        run.hurt_monster(mi, Damage::effect_tick(1.0, DamageType::Poison), false, None);
        assert_eq!(run.monsters[mi].hurt_dir, None);
        assert_eq!(run.last_hit.as_ref().unwrap().dir, None);
    }

    #[test]
    fn a_melee_hit_points_away_from_the_attacker() {
        let (mut run, mi) = duel(14.0);
        let hp = run.players[0].hp;
        for _ in 0..90 {
            run.step();
            if run.players[0].hp < hp {
                break;
            }
        }
        assert!(run.players[0].hp < hp, "the orc hit");
        // The orc stands east of the hero: the blow travelled west.
        let d = run.players[0].hurt_dir.expect("a direction");
        assert!(angle_diff(d, PI).abs() < 0.1, "{d}");
    }

    #[test]
    fn a_shot_points_along_its_flight() {
        let (mut run, mi) = arena(EnemyType::OrcArcher);
        run.monsters[mi].ai.cd = 0.0;
        let hp = run.players[0].hp;
        for _ in 0..(5.0 / DT) as usize {
            run.step();
            if run.players[0].hp < hp {
                break;
            }
        }
        assert!(run.players[0].hp < hp, "the arrow hit");
        let d = run.players[0].hurt_dir.expect("a direction");
        assert!(angle_diff(d, PI).abs() < 0.3, "west, along the flight: {d}");
        assert_eq!(run.last_hit.as_ref().unwrap().dir.map(|v| v.len().round()), Some(1.0), "a unit vector");
    }

    #[test]
    fn a_blast_points_away_from_its_centre() {
        let (mut run, _) = arena(EnemyType::OrcWarrior);
        let at = run.players[0].pos() + Vec2::new(10.0, 0.0);
        crate::run::abilities::explode(&mut run, at, 30.0, Damage::physical(5.0), Side::Hostile, None, 0, false, 0.0, 0, None);
        let d = run.players[0].hurt_dir.expect("a direction");
        assert!(angle_diff(d, PI).abs() < 1e-6, "away from the centre: {d}");
    }

    /// A blow that travelled along `travel` hits the orc, struck by hero 0 (as an arrow does).
    fn blow(run: &mut Run, mi: usize, travel: Vec2) {
        run.hurt_monster(mi, Damage::physical(1.0).along(travel), false, Some(0));
    }

    #[test]
    fn a_blow_from_inside_the_cone_starts_no_glance() {
        let (mut run, mi) = duel(100.0);
        blow(&mut run, mi, Vec2::new(1.0, 0.0)); // from the west, where the orc looks
        let ai = &run.monsters[mi].ai;
        assert!(ai.glance.is_none(), "it already looks that way");
        assert_eq!(ai.state, AiState::Search, "and with nothing to fight it searches at once");
    }

    #[test]
    fn no_glance_during_a_wind_up() {
        let (mut run, mi) = duel(100.0);
        run.monsters[mi].ai.windup = Some(crate::run::entities::Windup { t: 5.0, aim: 0.0, alt: false, at: None, id: None });
        blow(&mut run, mi, Vec2::new(-1.0, 0.0)); // from behind
        assert!(run.monsters[mi].ai.glance.is_none());
        assert_eq!(run.monsters[mi].ai.state, AiState::Idle);
    }

    #[test]
    fn an_arrow_in_the_back_turns_the_head_then_the_body_then_it_searches() {
        let (mut run, mi) = duel(100.0);
        let (pos, hero) = (run.monsters[mi].pos, run.players[0].pos());
        run.monsters[mi].aim = 0.0; // the hero, and the shooter, are behind it
        run.monsters[mi].sight.vision = 0.0;
        blow(&mut run, mi, Vec2::new(1.0, 0.0)); // travelled east: it came from the west
        assert_eq!(run.monsters[mi].ai.state, AiState::Look);
        let wait = startle(&run.monsters[mi].attrs);
        let (mut first_gaze, mut first_aim, mut states) = (None, None, vec![AiState::Look]);
        let mut point = None;
        for i in 0..(3.0 / DT) as usize {
            run.step();
            let m = &run.monsters[mi];
            if first_gaze.is_none() && m.gaze != 0.0 {
                first_gaze = Some(i);
            }
            if first_aim.is_none() && m.aim != 0.0 {
                first_aim = Some(i);
            }
            if (i as f64) * DT < wait - 2.0 * DT {
                assert!(m.gaze == 0.0 && m.aim == 0.0, "nothing turns for the startle");
            }
            if states.last() != Some(&m.ai.state) {
                states.push(m.ai.state);
                if m.ai.state == AiState::Search {
                    point = Some(m.ai.last_known);
                    run.monsters[mi].sight.vision = 12.0; // the hero comes into view as it walks
                }
            }
        }
        assert!(first_gaze.unwrap() <= first_aim.unwrap(), "the head leads: {first_gaze:?} {first_aim:?}");
        assert_eq!(&states[..2], &[AiState::Look, AiState::Search]);
        assert!(states.contains(&AiState::Chase), "it found the hero: {states:?}");
        assert!(point.unwrap().dist(pos + Vec2::new(-3.0 * TILE, 0.0)) < 6.0, "back along the arrow, not at the hero: {:?} {hero:?}", point);
    }

    #[test]
    fn the_search_point_stops_at_a_wall() {
        let (mut run, mi) = duel(100.0);
        let pos = run.monsters[mi].pos;
        let (wx, wy) = crate::dungeon::Map::tile_of(pos + Vec2::new(-1.5 * TILE, 0.0));
        run.layout.map.set(wx, wy, Tile::Wall);
        let p = search_point(&run, mi, PI);
        assert!(p.dist(pos) < 2.0 * TILE && !run.layout.map.blocks_at(p, run.monsters[mi].mover), "{p:?}");
        let free = search_point(&run, mi, 0.0);
        assert!((free.dist(pos) - 3.0 * TILE).abs() < 1e-6, "open floor: the full three tiles");
    }

    #[test]
    fn the_search_point_stops_at_a_chasm() {
        let (mut run, mi) = duel(100.0);
        let pos = run.monsters[mi].pos;
        let (cx, cy) = crate::dungeon::Map::tile_of(pos + Vec2::new(-1.5 * TILE, 0.0));
        for y in cy - 3..=cy + 3 {
            run.layout.map.set(cx, y, Tile::Chasm);
        }
        let p = search_point(&run, mi, PI);
        assert!(p.dist(pos) < 2.0 * TILE && !run.layout.map.blocks_at(p, run.monsters[mi].mover), "{p:?}");
    }

    #[test]
    fn a_disciple_only_turns() {
        let (mut run, mi) = duel(100.0);
        run.monsters[mi].base_ai = crate::defs::enemies::BaseAi::Stationary;
        run.monsters[mi].aim = 0.0;
        run.monsters[mi].sight.vision = 0.0;
        let before = run.monsters[mi].pos;
        blow(&mut run, mi, Vec2::new(1.0, 0.0));
        let (mut turned, mut states) = (false, Vec::new());
        for _ in 0..(3.0 / DT) as usize {
            run.step();
            let m = &run.monsters[mi];
            turned |= angle_diff(m.aim, 0.0).abs() > 60f64.to_radians();
            assert!(m.pos.dist(before) < 0.5, "it does not walk");
            if states.last() != Some(&m.ai.state) {
                states.push(m.ai.state);
            }
        }
        assert!(turned, "body and head turned to the blow");
        assert!(!states.contains(&AiState::Search), "{states:?}");
    }

    /// Two heroes and an orc: hero 0 `ahead` px west of it (its target), hero 1 at `other`, relative to the orc.
    fn two_foes(ahead: f64, other: Vec2) -> (Run, usize) {
        let mut run = test_run(&[ClassId::Paladin, ClassId::ElvenRanger], BossId::Lich);
        open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let at = run.players[0].pos() + Vec2::new(ahead, 0.0);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, at, None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].attrs = BASELINE_ATTRS;
        run.monsters[mi].ai.cd = 0.0;
        let h0 = run.players[0].pos();
        crate::run::tests::face(&mut run, mi, h0);
        put(&mut run, 1, at + other);
        (run, mi)
    }

    #[test]
    fn a_fighting_orc_shot_from_behind_keeps_swinging() {
        shot_from_behind(30);
    }

    #[test]
    fn sustained_fire_from_behind_does_not_keep_restarting_the_glance() {
        shot_from_behind(12); // an arrow every 0.2 s: faster than startle plus hold
    }

    /// The ranger's arrow in the fighting orc's back every `every` ticks for 6 s.
    fn shot_from_behind(every: usize) {
        let (mut run, mi) = two_foes(20.0, Vec2::new(80.0, 0.0));
        let g = gate(run.monsters[mi].kit.first().unwrap()).unwrap();
        steps(&mut run, 0.1);
        assert!(run.monsters[mi].ai.target.is_some(), "it fights the paladin");
        let (mut glances, mut prev_wait, mut deaf, mut hits, mut hp) = (0, 0.0, false, 0, run.players[0].hp);
        for i in 0..(6.0 / DT) as usize {
            if i % every == 0 {
                run.hurt_monster(mi, Damage::physical(1.0).along(Vec2::new(-1.0, 0.0)), false, Some(1));
            }
            run.step();
            let m = &run.monsters[mi];
            // A glance starts when its startle wait is set afresh (it only falls otherwise).
            let wait = m.ai.glance.map_or(0.0, |g| g.wait.max(0.0));
            glances += (wait > prev_wait) as usize;
            prev_wait = wait;
            deaf |= m.ai.deaf_t > 0.0;
            let off = angle_diff(m.pos.angle_to(run.players[0].pos()), m.aim).abs();
            assert!(off <= g + 0.1, "the body stays on the paladin: {}", off.to_degrees());
            if run.players[0].hp < hp {
                hits += 1;
            }
            hp = run.players[0].hp;
        }
        assert!(hits >= 2, "the paladin was hit {hits} times");
        assert!(glances >= 1 && glances <= 2, "{glances} glances in 6 s");
        assert!(deaf, "a finished glance makes it ignore blows for a while");
    }

    #[test]
    fn after_a_glance_a_target_out_of_the_cone_is_dropped_within_the_hold() {
        let (mut run, mi) = lost(PI - 170f64.to_radians(), None); // the hero is 170 degrees off: beyond head and cone, in the open
        run.monsters[mi].turn = 0.0; // the body does not follow, so the target stays out of the cone
        run.monsters[mi].ai.deaf_t = GLANCE_AGAIN; // a glance has just ended
        let mut t = 0.0;
        while run.monsters[mi].ai.state == AiState::Chase && t < 2.0 {
            run.step();
            t += DT;
        }
        assert_eq!(run.monsters[mi].ai.state, AiState::Look, "it gave the target up");
        assert!(t <= GLANCE_HOLD + 2.0 * DT, "no later than the hold: {t}");
        assert!(t >= GLANCE_HOLD - 2.0 * DT, "but the head's swing back is covered: {t}");
    }

    #[test]
    fn a_boss_hears_blows_again_four_seconds_after_a_glance() {
        let (mut run, bi) = crate::run::bosses::tests::arena(BossId::Lich, 0.0, Vec2::new(100.0, 0.0));
        run.monsters[bi].ai.deaf_t = GLANCE_AGAIN; // a glance has just ended
        steps(&mut run, GLANCE_AGAIN + 0.5);
        assert_eq!(run.monsters[bi].ai.deaf_t, 0.0, "the boss's deafness runs out like any creature's");
    }

    #[test]
    fn a_blow_from_behind_is_felt_once_the_target_is_lost() {
        let (mut run, mi) = duel(100.0);
        run.monsters[mi].ai.target = None;
        run.monsters[mi].ai.state = AiState::Search;
        run.monsters[mi].ai.deaf_t = 3.0; // left over from a glance in which it kept its target
        blow(&mut run, mi, Vec2::new(-1.0, 0.0)); // from behind
        assert!(run.monsters[mi].ai.glance.is_some(), "it reacts to the blow");
    }

    #[test]
    fn a_cast_at_a_hero_behind_is_released_within_the_gate_and_a_ring_keeps_the_aim() {
        let (mut run, bi) = crate::run::bosses::tests::arena(BossId::Lich, 0.0, Vec2::new(-100.0, 0.0));
        let hero = run.players[0].pos();
        let g = gate(&run.monsters[bi].kit.get(AbilityId::StoneGaze).unwrap().clone()).unwrap();
        assert!(crate::run::abilities::monster_use(&mut run, bi, AbilityId::StoneGaze, hero));
        let off = angle_diff(run.monsters[bi].aim, 0.0).abs(); // the body faced 0 rad before
        assert!(off <= g + 1e-9 && off > 0.0, "released at the gate's edge, not at the hero: {}", off.to_degrees());
        run.monsters[bi].aim = 0.0;
        assert!(crate::run::abilities::monster_use(&mut run, bi, AbilityId::Nova, hero));
        assert_eq!(run.monsters[bi].aim, 0.0, "a ring needs no facing and does not turn the body");
    }

    #[test]
    fn a_chaser_hit_by_a_closer_foe_switches() {
        // The ranger stands at the orc's side (south), nearer than the paladin it chases.
        let (mut run, mi) = two_foes(120.0, Vec2::new(0.0, 40.0));
        steps(&mut run, 0.1);
        assert_eq!(run.monsters[mi].ai.target, Some(crate::run::entities::Target::Player(run.players[0].id)));
        run.hurt_monster(mi, Damage::physical(1.0).along(Vec2::new(0.0, -1.0)), false, Some(1));
        steps(&mut run, 1.0);
        assert_eq!(run.monsters[mi].ai.target, Some(crate::run::entities::Target::Player(run.players[1].id)));
        assert!(run.monsters[mi].ai.glance.is_none());
    }

    // ----- a hiding Mimic turns to whoever woke it -----

    /// A hiding Mimic placed facing east, and a hero `d` px west of it (behind it).
    fn mimic_with_hero_behind(d: f64) -> (Run, usize) {
        let (mut run, mi) = arena(EnemyType::Mimic);
        run.monsters[mi].sight.cone = 150.0;
        run.monsters[mi].hiding = true;
        run.monsters[mi].aim = 0.0;
        run.monsters[mi].gaze = 0.0;
        let at = run.monsters[mi].pos;
        hero_to(&mut run, at + Vec2::new(-d, 0.0));
        (run, mi)
    }

    #[test]
    fn a_mimic_woken_by_a_hero_behind_it_turns_and_chases() {
        let (mut run, mi) = mimic_with_hero_behind(8.0);
        run.step();
        assert!(!run.monsters[mi].hiding, "touched, it wakes");
        assert_eq!(run.monsters[mi].aim, 0.0, "the body does not snap to the hero");
        steps(&mut run, 3.0);
        let m = &run.monsters[mi];
        let to_hero = (run.players[0].pos() - m.pos).angle();
        assert!(angle_diff(m.aim, to_hero).abs() <= ATTACK_FACING, "faces the hero: {} {}", m.aim, to_hero);
        assert_eq!(m.ai.state, AiState::Chase);
    }

    #[test]
    fn a_hiding_mimic_hit_from_behind_wakes_and_looks_back_along_the_blow() {
        let (mut run, mi) = mimic_with_hero_behind(60.0);
        blow(&mut run, mi, Vec2::new(1.0, 0.0)); // travelled east: it came from the west
        assert!(!run.monsters[mi].hiding);
        assert_eq!(run.monsters[mi].ai.state, AiState::Look, "it turns to the blow");
        steps(&mut run, 3.0);
        let m = &run.monsters[mi];
        assert!(angle_diff(m.aim, PI).abs() < 0.5, "turned west: {}", m.aim);
    }

    /// Steps `n` ticks (events pile up in `run.events`) and returns the `k` of every `Ev::Cue`.
    fn cues_over(run: &mut Run, n: usize) -> Vec<u8> {
        run.events.clear();
        (0..n).for_each(|_| run.step());
        run.events.iter().filter_map(|(e, _)| if let Ev::Cue { k, .. } = e { Some(*k) } else { None }).collect()
    }

    #[test]
    fn a_creature_that_sees_a_hero_cues_once() {
        let (mut run, _) = duel(100.0);
        assert_eq!(cues_over(&mut run, 40), vec![0], "one ! and no more while it chases");
    }

    #[test]
    fn a_chaser_that_loses_its_target_cues_a_question_mark() {
        let (mut run, mi) = lost(0.0, None);
        run.monsters[mi].ai.cued = AiState::Chase;
        assert_eq!(cues_over(&mut run, 10), vec![1]);
    }

    #[test]
    fn an_invisible_or_friendly_creature_cues_nothing() {
        let (mut run, mi) = duel(100.0);
        run.monsters[mi].effects.add(EffectKind::Invisible, 60.0);
        assert!(cues_over(&mut run, 40).is_empty());
        // A Friendly chaser (a charmed creature after a monster): the state changes, no cue goes out.
        let (mut run, mi) = duel(100.0);
        run.events.clear();
        run.monsters[mi].side = Side::Friendly;
        run.monsters[mi].ai.state = AiState::Chase;
        cue(&mut run, mi);
        assert!(run.events.is_empty());
        run.monsters[mi].side = Side::Hostile;
        run.monsters[mi].ai.cued = AiState::Idle;
        cue(&mut run, mi);
        assert_eq!(run.events.len(), 1, "the same creature, Hostile, cues");
    }

    #[test]
    fn a_flickering_creature_cues_once_per_quiet_time_and_ends_on_its_state() {
        let (mut run, mi) = duel(100.0);
        run.events.clear();
        let ks = |run: &Run| run.events.iter().filter_map(|(e, _)| if let Ev::Cue { k, .. } = e { Some(*k) } else { None }).collect::<Vec<_>>();
        // Chase, Look, Chase, ... every tick for a second: one `!`.
        for i in 0..(1.0 / DT) as usize {
            run.monsters[mi].ai.state = if i % 2 == 0 { AiState::Chase } else { AiState::Look };
            cue(&mut run, mi);
        }
        assert_eq!(ks(&run), vec![0]);
        // It ends looking: once the quiet time is over the `?` follows.
        run.monsters[mi].ai.state = AiState::Look;
        (0..(CUE_QUIET / DT) as usize + 1).for_each(|_| cue(&mut run, mi));
        assert_eq!(ks(&run), vec![0, 1]);
    }

    #[test]
    fn a_mimic_cues_only_after_its_reveal() {
        let (mut run, mi) = mimic_with_hero_behind(8.0);
        let mut first = None;
        run.events.clear();
        for _ in 0..(3.0 / DT) as usize {
            run.step();
            if first.is_none() {
                first = run.events.iter().find_map(|(e, _)| if let Ev::Cue { k, .. } = e { Some((*k, run.monsters[mi].ai.hold)) } else { None });
            }
        }
        let (k, hold) = first.expect("the woken Mimic cues");
        assert!(hold <= 0.0, "no cue during the reveal hold");
        assert!(k == 0 || k == 1);
    }
}
