//! The body's facing: creatures do not write `aim` any more, they wish (`Monster.face_to`, else the way they
//! walk), and one pass per tick turns the body toward the wish at its turn speed (DEX, race). Walking off the
//! facing is slower (`off_facing_mul`).

use super::entities::Monster;
use super::{charm, Run};
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
const WALK_MIN: f64 = 0.05;
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

/// How fast the body turns (rad/s).
pub fn body_speed(m: &Monster) -> f64 {
    BODY_TURN.get(&m.attrs) * m.turn
}

/// How fast the head turns (rad/s).
pub fn head_speed(a: &Attributes) -> f64 {
    HEAD_TURN.get(a)
}

/// The pause (s) before a creature reacts to a hit or a seen attack.
#[allow(dead_code)] // the glance comes with a later task
pub fn startle(a: &Attributes) -> f64 {
    STARTLE.per(a)
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
    // A boss's script still writes its own facing (until its task); every other creature wishes.
    if !m.alive || m.dormant || m.hiding || m.effects.no_act() || m.effects.no_turn() || (m.is_boss && !charm::is_on(m)) {
        return;
    }
    let wish = m.face_to.or_else(|| (moved.len() > WALK_MIN).then(|| moved.angle()));
    if let Some(w) = wish {
        m.aim = turn_toward(m.aim, w, body_speed(m) * dt);
    }
    // The head: straight ahead while an attack winds up or runs, else toward the wish within the neck.
    let busy = m.ai.windup.is_some() || m.ai.cast.is_some() || m.slam.is_some() || m.channel.is_some() || m.dash.is_some();
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
        assert!(off <= ATTACK_FACING + 1e-9, "faced within the gate: {}", off.to_degrees());
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
        let (mut run, mi) = duel(14.0);
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
        assert!(angle_diff(m.aim, before).abs() <= ATTACK_FACING + body_speed(m) * DT, "no jump: {}", angle_diff(m.aim, before).to_degrees());
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
}
