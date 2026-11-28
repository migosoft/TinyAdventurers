//! The AI that drives a charmed hero (#224). Every tick, whatever the client sends, `input` makes the input
//! the player would have sent: a step toward the foe (or the caster), an aim at the foe, and the primary and
//! secondary when `ai_shapes::worth_using` says so and the slot is ready. `Run::step_player` then runs it
//! through the ordinary `apply_input`, so the hero moves, ticks its cooldowns and uses its abilities exactly
//! as for a player. Nothing here knows an ability by its id: the rule per ability is its `Shape`'s.

use super::abilities::COOLDOWN_LEEWAY;
use super::ai::{plan_step, Step, Walker};
use super::ai_shapes::{reach_of, worth_using};
use super::effects::Creature;
use super::entities::Brain;
use super::{perception, targets, Run, DT};
use crate::defs::abilities::{self as ab, Shape};
use crate::defs::companions::KNIGHT_ESCORT;
use crate::defs::effects::EffectKind;
use crate::defs::classes::PLAYER_RADIUS;
use crate::dungeon::Mover;
use crate::math::Vec2;
use crate::protocol::InputMsg;
use crate::sheet::ResolvedAbility;

/// The first shot id of a charmed hero's shots. A client's own ids start at 1 and never reach it in a run, so
/// the two never meet.
pub const AI_SHOT_BASE: u16 = 0xF000;
/// The hero stops walking inside this share of its primary's reach.
const STOP_SHARE: f64 = 0.85;
/// A path's lane is a tile centre line: the hero steers back onto it when further off than this many px.
const LANE_SLACK: f64 = 2.0;
/// A waypoint is reached within this many px.
const WAYPOINT_REACHED: f64 = 6.0;
/// A place the foe was last seen is reached within this many px.
const LAST_KNOWN_REACHED: f64 = 12.0;

impl Brain {
    pub fn new() -> Brain {
        Brain { path: Vec::new(), repath_t: 0.0, last_known: None, shot: AI_SHOT_BASE, aim: Default::default() }
    }
}

/// The nearest living creature hero `pi` fights (`targets::fights`) and sees now. A monster must be awake,
/// visible and on the ground, as for a companion's prey.
fn nearest_foe(run: &Run, pi: usize) -> Option<Creature> {
    let p = &run.players[pi];
    // A charmed hero has no head: it sees along its body, in a cone that takes in what a head would sweep.
    let (from, sight, dir) = (p.pos(), p.sight_now(), p.aim);
    let sight = crate::defs::races::Sight { cone: (sight.cone + 2.0 * sight.neck).min(360.0), ..sight };
    let me = targets::stance(run, Creature::Player(pi));
    // A creature in the drowning state (`water_t > 0`) is out of reach.
    let heroes = (0..run.players.len()).filter(|&i| i != pi && run.players[i].alive && run.players[i].sinking.is_none() && run.players[i].water_total() <= 0.0).map(Creature::Player);
    let monsters = (0..run.monsters.len())
        .filter(|&i| {
            let m = &run.monsters[i];
            m.alive && !m.dormant && !m.hiding && !m.airborne && m.sinking.is_none() && m.water_t <= 0.0
        })
        .map(Creature::Monster);
    heroes
        .chain(monsters)
        .filter(|&c| targets::fights(&me, &targets::stance(run, c)) && !run.has_effect(c, EffectKind::Invisible))
        .map(|c| (c, run.creature_pos(c)))
        .filter(|&(_, at)| perception::sees(run, sight, from, dir, at))
        .min_by(|a, b| a.1.dist(from).total_cmp(&b.1.dist(from)))
        .map(|(c, _)| c)
}

/// The step direction (each -1, 0 or 1) closest to `d`.
fn quantize(d: Vec2) -> (i8, i8) {
    let len = d.len();
    if len < 1e-6 {
        return (0, 0);
    }
    let q = |v: f64| if v > 0.38 { 1 } else if v < -0.38 { -1 } else { 0 };
    (q(d.x / len), q(d.y / len))
}

/// The step along the path's axis toward `d`: the larger axis, plus the other one when the hero is off the
/// lane (`LANE_SLACK`), so its body clears the corners. The waypoints lie tile centre to tile centre, so the
/// way is along one axis at a time.
fn quantize_path(d: Vec2) -> (i8, i8) {
    let q = |v: f64| if v > LANE_SLACK { 1 } else if v < -LANE_SLACK { -1 } else { 0 };
    let main = |v: f64| if v > 0.0 { 1 } else if v < 0.0 { -1 } else { 0 };
    if d.x.abs() >= d.y.abs() { (main(d.x), q(d.y)) } else { (q(d.x), main(d.y)) }
}

/// The step toward `goal`: the monsters' pathfinding (`ai::plan_step`, for an enemy mover, an 8-direction
/// walker) says where to go next, and this turns it into one of 8 directions. No way: stand still.
fn steer(run: &mut Run, pi: usize, goal: Vec2) -> (i8, i8) {
    let pos = run.players[pi].pos();
    let walker = Walker { pos, mover: Mover::Enemy, radius: PLAYER_RADIUS, boss: false, eight: true };
    let Some(c) = run.players[pi].charm.as_mut() else { return (0, 0) };
    let (mut path, mut repath_t) = (std::mem::take(&mut c.brain.path), c.brain.repath_t);
    let step = plan_step(run, &walker, &mut path, &mut repath_t, goal, DT);
    while step != Step::Done && path.first().is_some_and(|w| pos.dist(*w) < WAYPOINT_REACHED) {
        path.remove(0);
    }
    let first = path.first().copied();
    let Some(c) = run.players[pi].charm.as_mut() else { return (0, 0) };
    (c.brain.path, c.brain.repath_t) = (path, repath_t);
    match step {
        Step::Done => (0, 0),
        Step::Straight(to) => quantize(to - pos),
        Step::Waypoint(_) => first.map_or((0, 0), |w| quantize_path(w - pos)),
    }
}

/// Where the hero goes and how near it needs to get: the foe (inside 0.85 of its primary's reach), the place the
/// foe was last seen, else the caster at escort distances. `None`: stand.
fn goal_of(run: &mut Run, pi: usize, foe: Option<Creature>) -> Option<(Vec2, f64)> {
    let pos = run.players[pi].pos();
    if let Some(f) = foe {
        let at = run.creature_pos(f);
        let reach = reach_of(&run.players[pi].sheet.primary, run.creature_radius(f));
        if let Some(c) = run.players[pi].charm.as_mut() {
            c.brain.last_known = Some(at);
        }
        return Some((at, STOP_SHARE * reach));
    }
    let last = run.players[pi].charm.as_ref().and_then(|c| c.brain.last_known);
    if let Some(at) = last {
        if pos.dist(at) > LAST_KNOWN_REACHED {
            return Some((at, LAST_KNOWN_REACHED));
        }
        if let Some(c) = run.players[pi].charm.as_mut() {
            c.brain.last_known = None;
        }
    }
    let caster = run.players[pi].charm.as_ref()?.caster;
    let leader = run.creature_by_id(caster).filter(|&c| run.creature_alive(c))?;
    let e = &KNIGHT_ESCORT;
    // The escort script's hysteresis: start walking beyond `follow`, stop inside `follow_stop`.
    let stop = if run.players[pi].moving { e.follow_stop } else { e.follow };
    Some((run.creature_pos(leader), stop))
}

/// How many shot ids a use of `a` takes: one per shot of a fan (Volley), else one.
fn shots_of(a: &ResolvedAbility) -> u16 {
    let d = ab::def(a.id);
    match d.shape {
        Shape::Projectile => d.own.count.max(1) as u16,
        Shape::Blast | Shape::Swing | Shape::Ring | Shape::Dash | Shape::SelfArea | Shape::GroundArea | Shape::Buff | Shape::Summon | Shape::Breath | Shape::Gaze => 1,
    }
}

/// The input the AI sends for charmed hero `pi` this tick. `seq`, `view_lag` and `rtt` are the player's own,
/// unchanged by it.
pub fn input(run: &mut Run, pi: usize) -> InputMsg {
    let me = Creature::Player(pi);
    let pos = run.players[pi].pos();
    if run.players[pi].water_total() > 0.0 {
        // In deep water: swim straight back to the last safe ground, nothing else.
        let p = &run.players[pi];
        let (mx, my) = quantize(p.last_safe - pos);
        let (view_lag, rtt) = ((p.view_lag * 1000.0).round() as u16, (p.rtt * 1000.0).round() as u16);
        return InputMsg { seq: p.ack, mx, my, aim: p.aim as f32, aim_dist: p.aim_dist as f32, view_lag, rtt, ..Default::default() };
    }
    let foe = nearest_foe(run, pi);
    let goal = goal_of(run, pi, foe);
    let (mx, my) = match goal {
        Some((at, stop)) if pos.dist(at) > stop => steer(run, pi, at),
        _ => (0, 0),
    };
    let p = &run.players[pi];
    let (aim, aim_dist) = match (foe, goal) {
        (Some(f), _) => {
            let at = run.creature_pos(f);
            (pos.angle_to(at), pos.dist(at))
        }
        (None, Some((at, _))) if (mx, my) != (0, 0) => (pos.angle_to(at), p.aim_dist),
        _ => (p.aim, p.aim_dist),
    };
    // Each slot, when a foe is in sight: ready and worth it for its shape.
    let main_ready = p.cd1 <= COOLDOWN_LEEWAY;
    let wants = |a: &ResolvedAbility, cd: f64, disabled: bool| foe.is_some_and(|f| !disabled && cd <= COOLDOWN_LEEWAY && worth_using(run, me, a, f, main_ready));
    let use_primary = wants(&p.sheet.primary, p.cd1, p.sheet.disabled[0].is_some());
    let use_secondary = wants(&p.sheet.secondary, p.cd2, p.sheet.disabled[1].is_some());
    // An arcing slot that fires is aimed like a monster's shot: scatter, range finding, lead (`aim.rs`).
    let arcing = [(use_primary, &p.sheet.primary), (use_secondary, &p.sheet.secondary)].into_iter().find(|(used, a)| *used && ab::def(a.id).arcs).map(|(_, a)| a.clone());
    let (n1, n2) = (shots_of(&p.sheet.primary), shots_of(&p.sheet.secondary));
    let (seq, view_lag, rtt) = (p.ack, (p.view_lag * 1000.0).round() as u16, (p.rtt * 1000.0).round() as u16);
    let (mut primary, mut secondary) = (None, None);
    let (mut aim, mut aim_dist) = (aim, aim_dist);
    if let (Some(a), Some(f)) = (arcing, foe) {
        let at = super::aim::creature_aim(run, me, f, &a);
        (aim, aim_dist) = (pos.angle_to(at), pos.dist(at));
    }
    // A charmed hero has no head: its body turns toward the wanted aim at the body turn speed, as a monster's does,
    // and a slot fires only once the body faces the aim within its ability's gate (as for every creature).
    let turned = super::facing::turn_toward(run.players[pi].aim, aim, crate::defs::races::BODY_TURN.get(&run.players[pi].sheet.attrs) * DT);
    let faces = |a: &ResolvedAbility| super::facing::gate(a).map_or(true, |g| crate::math::angle_diff(aim, turned).abs() <= g);
    let (use_primary, use_secondary) = (use_primary && faces(&run.players[pi].sheet.primary), use_secondary && faces(&run.players[pi].sheet.secondary));
    let aim = turned;
    if let Some(c) = run.players[pi].charm.as_mut() {
        let b = &mut c.brain;
        if use_primary {
            primary = Some(b.shot);
            b.shot = b.shot.wrapping_add(n1);
        }
        if use_secondary {
            secondary = Some(b.shot);
            b.shot = b.shot.wrapping_add(n2);
        }
    }
    InputMsg { seq, mx, my, aim: aim as f32, aim_dist: aim_dist as f32, primary, secondary, view_lag, rtt, act: false }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::abilities::{AbilityId, AbilitySlot};
    use crate::defs::damage::{Damage, DamageType, What, Why};
    use crate::defs::enemies::EnemyType;
    use crate::defs::items::{Equipment, ItemBase, ItemId};
    use crate::defs::loadout::{Build, Loadout, Pick, Source};
    use crate::defs::requirements::Requirement;
    use crate::dungeon::{Map, Tile};
    use crate::protocol::{BossId, ClassId, Ev};
    use crate::run::charm::is_hero_charmed;
    use crate::run::effects::Apply;
    use crate::run::targets::Side;
    use crate::run::tests::{test_run, test_run_with};

    /// An open floor with the heroes and no monsters but the boss.
    fn arena(classes: &[ClassId]) -> Run {
        let mut run = test_run(classes, BossId::Lich);
        crate::run::ai::tests::open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        run
    }

    /// A held orc `dx` px east of hero 0, the caster of the tests: it neither moves nor dies.
    fn held_orc(run: &mut Run, dx: f64) -> u32 {
        let at = run.players[0].pos() + Vec2::new(dx, 0.0);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, at, None);
        let mi = run.monster_idx(id).unwrap();
        let m = &mut run.monsters[mi];
        m.ai.hold = 1e9;
        m.hp = 1e6;
        m.max_hp = 1e6;
        id
    }

    /// Charm from creature `caster` on hero `pi`.
    fn charm_hero(run: &mut Run, pi: usize, caster: u32, secs: f64) {
        let at = crate::run::ai::living_pos(run, caster).unwrap_or(Vec2::ZERO);
        let apply = Apply { power: None, magical: true, source: Some((caster, at)), ..Apply::plain(EffectKind::Charmed, Some(secs)) };
        assert!(run.apply(Creature::Player(pi), apply));
    }

    fn put(run: &mut Run, pi: usize, at: Vec2) {
        run.players[pi].mv.x = at.x;
        run.players[pi].mv.y = at.y;
    }

    fn tough(run: &mut Run, pi: usize) {
        run.players[pi].hp = 1e6;
        run.players[pi].max_hp = 1e6;
    }

    fn send(run: &mut Run, pi: usize, mx: i8) {
        let seq = run.players[pi].ack + 1;
        run.players[pi].inputs.push_back(InputMsg { seq, mx, ..Default::default() });
    }

    fn steps(run: &mut Run, n: usize) {
        for _ in 0..n {
            run.step();
        }
    }

    fn said(run: &Run, what: &str) -> bool {
        run.events.iter().any(|(e, _)| matches!(e, Ev::Msg { text } if text == what))
    }

    #[test]
    fn an_enemys_charm_turns_a_hero() {
        let mut run = arena(&[ClassId::Paladin, ClassId::Paladin]);
        let at = run.players[0].pos();
        put(&mut run, 1, at + Vec2::new(60.0, 0.0));
        tough(&mut run, 0);
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 1, orc, 5.0);
        run.step();
        assert_eq!(run.players[1].side, Side::Hostile);
        assert!(is_hero_charmed(&run.players[1]));
        assert_eq!(run.players[1].charm.as_ref().unwrap().caster, orc);
        assert_eq!(run.players[1].charm.as_ref().unwrap().caster_name, "the Orc Warrior");
        // The client asks for east; the AI walks the hero west, toward hero 0.
        let x0 = run.players[1].pos().x;
        for _ in 0..30 {
            send(&mut run, 1, 1);
            run.step();
        }
        assert!(run.players[1].pos().x < x0 - 3.0, "{} -> {}", x0, run.players[1].pos().x);
        assert_eq!(run.players[0].side, Side::Friendly);
    }

    #[test]
    fn a_bot_hero_pushed_into_deep_water_swims_out() {
        let mut run = arena(&[ClassId::Paladin]);
        let orc = held_orc(&mut run, -40.0);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        run.layout.map.set(tx + 1, ty, Tile::DeepWater);
        run.players[0].last_safe = Map::center_of(tx, ty);
        charm_hero(&mut run, 0, orc, 30.0);
        put(&mut run, 0, Map::center_of(tx + 1, ty));
        for _ in 0..90 {
            run.step();
        }
        let p = &run.players[0];
        assert!(p.alive, "swam out in time");
        assert_eq!(p.mv.water_t, 0.0);
        assert_ne!(Map::tile_of(p.pos()), (tx + 1, ty), "out of the water");
    }

    #[test]
    fn the_hero_turns_back_exactly() {
        let mut run = arena(&[ClassId::Paladin]);
        let orc = held_orc(&mut run, -40.0);
        run.players[0].cd2 = 9.0;
        charm_hero(&mut run, 0, orc, 0.5);
        steps(&mut run, 5);
        assert_eq!(run.players[0].side, Side::Hostile);
        // Mid-slam and mid-dash when the charm runs out.
        run.players[0].slam = Some(5.0);
        run.players[0].mv.dash_t = 5.0;
        run.players[0].mv.dash_dx = 1.0;
        steps(&mut run, 40);
        let p = &run.players[0];
        assert_eq!(p.side, Side::Friendly);
        assert!(p.charm.is_none() && !is_hero_charmed(p));
        assert!(p.slam.is_none() && p.mv.dash_t == 0.0);
        assert!(p.cd2 < 9.0 - 0.3 && p.cd2 > 8.0, "the running cooldown goes on: {}", p.cd2);
        // The next real input moves it.
        let x0 = p.pos().x;
        for _ in 0..10 {
            send(&mut run, 0, 1);
            run.step();
        }
        assert!(run.players[0].pos().x > x0 + 3.0);
    }

    #[test]
    fn dispel_and_anti_magic_pause_a_heros_charm() {
        let mut run = arena(&[ClassId::Paladin]);
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 0, orc, 8.0);
        run.step();
        assert_eq!(run.players[0].side, Side::Hostile);
        // Anti-magic: the hero is its old self and obeys its player.
        run.set_anti_magic(Creature::Player(0), true);
        run.step();
        assert_eq!(run.players[0].side, Side::Friendly);
        assert!(run.players[0].charm.is_none());
        let x0 = run.players[0].pos().x;
        for _ in 0..10 {
            send(&mut run, 0, 1);
            run.step();
        }
        assert!(run.players[0].pos().x > x0 + 3.0, "inputs are obeyed while paused");
        run.set_anti_magic(Creature::Player(0), false);
        run.step();
        assert_eq!(run.players[0].side, Side::Hostile);
        assert_eq!(run.players[0].charm.as_ref().unwrap().caster, orc, "charmed again by the same caster");
        // A Dispel pause does the same.
        run.pause_effect(Creature::Player(0), EffectKind::Charmed, 1.0);
        run.step();
        assert_eq!(run.players[0].side, Side::Friendly);
        steps(&mut run, 62);
        assert_eq!(run.players[0].side, Side::Hostile);
        assert_eq!(run.players[0].charm.as_ref().unwrap().caster, orc);
    }

    #[test]
    fn a_heros_charm_refreshed_by_the_other_side() {
        let mut run = arena(&[ClassId::Paladin, ClassId::Paladin, ClassId::Wizard]);
        let at = run.players[0].pos();
        put(&mut run, 1, at + Vec2::new(60.0, 0.0));
        put(&mut run, 2, at + Vec2::new(60.0, 30.0));
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 1, orc, 8.0);
        run.step();
        assert_eq!(run.players[1].side, Side::Hostile);
        // The Wizard's Charm hits the charmed hero: by the refresh rule it takes the new caster's side.
        let wizard = run.players[2].id;
        charm_hero(&mut run, 1, wizard, 8.0);
        run.step();
        assert_eq!(run.players[1].side, Side::Friendly);
        assert_eq!(run.players[1].charm.as_ref().unwrap().caster, wizard);
        assert_eq!(run.players[1].charm.as_ref().unwrap().caster_name, "p2");
        assert!(is_hero_charmed(&run.players[1]), "still obeys no input");
        // It fights the orc's side now: it walks west toward the orc though the client asks east.
        let x0 = run.players[1].pos().x;
        for _ in 0..30 {
            send(&mut run, 1, 1);
            run.step();
        }
        assert!(run.players[1].pos().x < x0 - 3.0);
        let ends = run.players[1].effects.list().iter().filter(|e| e.kind == EffectKind::Charmed).count();
        assert_eq!(ends, 1);
    }

    #[test]
    fn a_wolf_summoned_while_charmed_starts_on_the_charmed_side() {
        let mut run = arena(&[ClassId::ElvenRanger, ClassId::Paladin]);
        let at = run.players[0].pos();
        put(&mut run, 1, at + Vec2::new(60.0, 0.0));
        tough(&mut run, 1);
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 0, orc, 1.0);
        let mut wolf = None;
        for _ in 0..30 {
            run.step();
            wolf = run.players[0].wolf;
            if wolf.is_some() {
                break;
            }
        }
        let wi = run.monster_idx(wolf.expect("the AI summoned the wolf")).unwrap();
        assert_eq!(run.monsters[wi].side, Side::Hostile, "Hostile at once");
        steps(&mut run, 90);
        assert!(run.players[0].charm.is_none());
        let wi = run.monster_idx(wolf.unwrap()).unwrap();
        assert_eq!(run.monsters[wi].side, Side::Friendly, "and back with its ranger");
    }

    #[test]
    fn a_silent_client_does_not_freeze_its_charmed_hero() {
        let mut run = arena(&[ClassId::Paladin, ClassId::Paladin]);
        let at = run.players[0].pos();
        put(&mut run, 1, at + Vec2::new(100.0, 0.0));
        tough(&mut run, 0);
        let orc = held_orc(&mut run, -40.0);
        run.players[1].cd1 = 3.0;
        charm_hero(&mut run, 1, orc, 8.0);
        let x0 = run.players[1].pos().x;
        let mut fired = false;
        for _ in 0..120 {
            run.step();
            fired |= run.players[1].cd2 > 1.0;
        }
        assert!(run.players[1].pos().x < x0 - 20.0, "no inputs at all: the AI still walks it");
        assert!(run.players[1].cd1 < 1.2, "its cooldowns count down per tick: {}", run.players[1].cd1);
        assert!(run.players[0].hp < 1e6 || fired, "and uses its abilities");
    }

    #[test]
    fn inputs_while_charmed_are_only_acknowledged() {
        let mut run = arena(&[ClassId::Paladin]);
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 0, orc, 8.0);
        run.step();
        // No caster and no foe left: the hero stands.
        run.monsters.retain(|m| m.id != orc);
        run.step();
        run.players[0].cd1 = 5.0;
        run.players[0].cd2 = 5.0;
        run.players[0].input_budget = 0;
        let pos = run.players[0].pos();
        run.players[0].inputs.push_back(InputMsg { seq: 7, mx: 1, primary: Some(1), secondary: Some(1), ..Default::default() });
        run.step();
        let p = &run.players[0];
        assert_eq!(p.ack, 7);
        assert_eq!(p.pos(), pos, "no move from the input");
        assert!((p.cd1 - (5.0 - DT)).abs() < 1e-9 && (p.cd2 - (5.0 - DT)).abs() < 1e-9, "ticked once, by the AI's input: {} {}", p.cd1, p.cd2);
        assert!(run.projectiles.is_empty());
        assert_eq!(p.input_budget, 0, "the budget is spent as usual");
        run.step();
        assert_eq!(run.players[0].input_budget, 1, "a silent tick banks one");
    }

    #[test]
    fn cooldowns_line_up_when_control_returns() {
        let mut run = arena(&[ClassId::Paladin]);
        let orc = held_orc(&mut run, -40.0);
        run.players[0].cd1 = 6.0;
        run.players[0].cd2 = 6.0;
        charm_hero(&mut run, 0, orc, 0.5);
        steps(&mut run, 40);
        assert!(run.players[0].charm.is_none());
        let (a, b) = (run.players[0].cd1, run.players[0].cd2);
        assert!(a < 6.0 - 0.3 && b < 6.0 - 0.3, "the AI's inputs ticked them: {a} {b}");
        send(&mut run, 0, 0);
        run.step();
        let p = &run.players[0];
        assert!((a - p.cd1 - DT).abs() < 1e-9 && (b - p.cd2 - DT).abs() < 1e-9, "one tick per real input");
    }

    #[test]
    fn the_charm_ends_mid_dash_and_mid_slam() {
        // A dash that is still on when the charm runs out is dropped, in place.
        let mut run = arena(&[ClassId::Barbarian, ClassId::Paladin]);
        let at = run.players[0].pos();
        put(&mut run, 1, at + Vec2::new(100.0, 0.0));
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 0, orc, 0.1);
        steps(&mut run, 2);
        run.players[0].mv.dash_t = 1.0;
        run.players[0].mv.dash_dx = 1.0;
        run.players[0].dash_hit.push(99);
        steps(&mut run, 4);
        assert!(run.players[0].charm.is_none());
        let p = &run.players[0];
        assert_eq!((p.mv.dash_t, p.dash_hit.len()), (0.0, 0));
        let here = p.pos();
        run.step();
        assert_eq!(run.players[0].pos(), here, "no dash left to carry it on");
        // A slam winding up is dropped and never lands.
        let mut run = arena(&[ClassId::Barbarian, ClassId::Paladin]);
        let at = run.players[0].pos();
        put(&mut run, 1, at + Vec2::new(10.0, 0.0));
        tough(&mut run, 1);
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 0, orc, 0.1);
        steps(&mut run, 2);
        run.players[0].slam = Some(0.4);
        let hp = run.players[1].hp;
        steps(&mut run, 60);
        assert!(run.players[0].slam.is_none());
        assert_eq!(run.players[1].hp, hp, "the slam never landed");
    }

    #[test]
    fn a_slam_wound_up_before_the_charm_never_lands_on_the_party() {
        // The player's own Ground Slam is still winding up when the charm lands: it must not strike the party
        // from the hero's new side.
        let build = build_with_ability(ClassId::Barbarian, AbilityId::GroundSlam);
        let mut run = test_run_with(&[(ClassId::Barbarian, build), (ClassId::Paladin, Build::start(ClassId::Paladin))], BossId::Lich);
        crate::run::ai::tests::open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let at = run.players[0].pos();
        put(&mut run, 1, at + Vec2::new(10.0, 0.0));
        tough(&mut run, 1);
        let orc = held_orc(&mut run, -40.0);
        run.players[0].cd1 = 100.0;
        run.players[0].cd2 = 100.0;
        run.players[0].slam = Some(0.1);
        charm_hero(&mut run, 0, orc, 8.0);
        let hp = run.players[1].hp;
        steps(&mut run, 30);
        assert!(run.players[0].charm.is_some());
        assert!(run.players[0].slam.is_none(), "the slam is dropped");
        assert_eq!(run.players[1].hp, hp, "the slam never landed on the party");
    }

    /// A strip of chasm in column `tx + 0`, over the rows `ty - up ..= ty + down`.
    fn chasm_column(run: &mut Run, up: i32, down: i32) -> (i32, i32) {
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - up..=ty + down {
            run.layout.map.set(tx, y, Tile::Chasm);
        }
        (tx, ty)
    }

    #[test]
    fn a_charmed_hero_walks_around_a_chasm() {
        let mut run = arena(&[ClassId::Paladin, ClassId::Paladin]);
        tough(&mut run, 0);
        let (tx, ty) = chasm_column(&mut run, 2, 2);
        // Hero 1 west of the chasm, hero 0 (its foe) east of it; the way round runs over rows ty +- 3.
        put(&mut run, 1, Map::center_of(tx - 6, ty));
        put(&mut run, 0, Map::center_of(tx + 6, ty));
        let orc = held_orc(&mut run, 0.0);
        let i = run.monster_idx(orc).unwrap();
        run.monsters[i].pos = Map::center_of(tx + 7, ty + 1);
        charm_hero(&mut run, 1, orc, 30.0);
        let d0 = run.players[1].pos().dist(run.players[0].pos());
        for _ in 0..300 {
            run.step();
            assert!(run.players[1].sinking.is_none(), "never over the chasm");
        }
        let p = &run.players[1];
        assert!(p.alive && p.sinking.is_none(), "never into the chasm");
        assert!(p.pos().dist(run.players[0].pos()) < d0 - 40.0, "and nearer the foe");
    }

    /// The arena's floor turned to wall, with a one-tile corridor along row `ty` from `tx - 6` to `tx + 4`, then
    /// down column `tx + 4` to row `ty + 3`: an L. Returns (tx, ty).
    fn l_corridor(run: &mut Run) -> (i32, i32) {
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 3..=ty + 3 {
            for x in tx - 8..=tx + 8 {
                run.layout.map.set(x, y, Tile::Wall);
            }
        }
        for x in tx - 6..=tx + 4 {
            run.layout.map.set(x, ty, Tile::Floor);
        }
        for y in ty..=ty + 3 {
            run.layout.map.set(tx + 4, y, Tile::Floor);
        }
        (tx, ty)
    }

    #[test]
    fn a_charmed_hero_rounds_a_corner_to_its_caster() {
        let mut run = arena(&[ClassId::Paladin]);
        let (tx, ty) = l_corridor(&mut run);
        let orc = held_orc(&mut run, 0.0);
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].pos = Map::center_of(tx + 4, ty + 3);
        put(&mut run, 0, Map::center_of(tx - 6, ty));
        charm_hero(&mut run, 0, orc, 30.0);
        steps(&mut run, 420);
        let d = run.players[0].pos().dist(run.monsters[oi].pos);
        assert!(d <= KNIGHT_ESCORT.follow + 6.0, "the hero followed its caster round the corner: {d}");
    }

    #[test]
    fn a_charmed_hero_does_not_stick_on_a_corner_in_sight_of_its_foe() {
        // A pillar two tiles tall with the foe seen past it at every row: the hero must reach it each time.
        for dy in -3..=3 {
            let mut run = arena(&[ClassId::Paladin, ClassId::Paladin]);
            tough(&mut run, 0);
            let (tx, ty) = Map::tile_of(run.players[0].pos());
            run.layout.map.set(tx + 3, ty, Tile::Wall);
            run.layout.map.set(tx + 3, ty + 1, Tile::Wall);
            put(&mut run, 0, Map::center_of(tx + 7, ty + dy));
            put(&mut run, 1, Map::center_of(tx - 1, ty));
            let orc = held_orc(&mut run, -40.0);
            charm_hero(&mut run, 1, orc, 30.0);
            steps(&mut run, 360);
            let d = run.players[1].pos().dist(run.players[0].pos());
            assert!(d <= 32.0, "foe {dy} rows off: still {d} px away");
        }
    }

    #[test]
    fn a_charmed_hero_gets_through_a_door_its_body_only_just_fits_off_the_centre_line() {
        // A wall column with a one-tile door; the hero and its foe share a y a few px off the door's centre line,
        // so the centre line passes but the body (radius 5) would catch the jamb.
        for off in [0.0, 3.0, 4.0, 5.0, 6.0, -4.0, -6.0] {
            let mut run = arena(&[ClassId::Paladin, ClassId::Paladin]);
            tough(&mut run, 0);
            let (tx, ty) = Map::tile_of(run.players[0].pos());
            for y in ty - 3..=ty + 3 {
                run.layout.map.set(tx + 3, y, Tile::Wall);
            }
            run.layout.map.set(tx + 3, ty, Tile::Floor);
            let (a, b) = (Map::center_of(tx + 7, ty) + Vec2::new(0.0, off), Map::center_of(tx - 1, ty) + Vec2::new(0.0, off));
            put(&mut run, 0, a);
            put(&mut run, 1, b);
            let orc = held_orc(&mut run, -40.0);
            charm_hero(&mut run, 1, orc, 30.0);
            steps(&mut run, 360);
            let d = run.players[1].pos().dist(run.players[0].pos());
            assert!(d <= 32.0, "{off} px off the door row: still {d} px away");
        }
    }

    #[test]
    fn a_charmed_hero_walks_round_a_barrel_in_its_way() {
        use crate::defs::kinds::EntityKind;
        use crate::run::objects::{Barrel, ObjState};
        let mut run = arena(&[ClassId::Paladin, ClassId::Paladin]);
        tough(&mut run, 0);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        put(&mut run, 0, Map::center_of(tx + 6, ty));
        put(&mut run, 1, Map::center_of(tx - 2, ty));
        let mid = Map::center_of(tx + 2, ty);
        run.spawn_object(EntityKind::Barrel, mid, ObjState::Barrel(Barrel::new()));
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 1, orc, 30.0);
        steps(&mut run, 300);
        let d = run.players[1].pos().dist(run.players[0].pos());
        assert!(d <= 32.0, "the hero got past the barrel: {d}");
    }

    #[test]
    fn a_charmed_hero_never_charges_over_a_chasm() {
        let build = build_with_ability(ClassId::Barbarian, AbilityId::Charge);
        let mut run = test_run_with(&[(ClassId::Barbarian, build), (ClassId::Paladin, Build::start(ClassId::Paladin))], BossId::Lich);
        crate::run::ai::tests::open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        tough(&mut run, 1);
        // A pit across the whole map, two tiles wide, with the foe 48 px away across it: within the dash.
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in 0..run.layout.map.h {
            run.layout.map.set(tx + 1, y, Tile::Chasm);
            run.layout.map.set(tx + 2, y, Tile::Chasm);
        }
        put(&mut run, 0, Map::center_of(tx, ty));
        put(&mut run, 1, Map::center_of(tx + 3, ty));
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 0, orc, 30.0);
        for _ in 0..300 {
            run.step();
            assert!(run.players[0].cd2 == 0.0, "Charge never starts");
            assert!(run.players[0].alive && run.players[0].sinking.is_none());
        }
    }

    /// Hero 0 of `class` with `id` in its slot: the debug pool (any ability of the class) with the Attributes lifted
    /// to its requirements and a weapon of the kind it asks for.
    fn build_with_ability(class: ClassId, id: AbilityId) -> Build {
        let d = ab::def(id);
        let pick = Pick { ability: id, source: Source::Own };
        let mut loadout = Loadout::start(class);
        match d.slot {
            AbilitySlot::Primary => loadout.primary = pick,
            AbilitySlot::Secondary => loadout.secondary = pick,
        }
        let kinds: Vec<_> = d.req.iter().filter_map(|r| if let Requirement::WeaponKind(k) = r { Some(*k) } else { None }).flatten().copied().collect();
        let starter = Equipment::starter(class);
        let mut options = vec![starter.clone()];
        for item in ItemId::ALL {
            match crate::defs::items::def(item).base {
                ItemBase::Melee(k, _) if kinds.contains(&k) => options.push(starter.clone().with(crate::defs::items::EquipSlot::Melee, item)),
                ItemBase::Ranged(k, _) if kinds.contains(&k) => options.push(starter.clone().with(crate::defs::items::EquipSlot::Ranged, item)),
                _ => {}
            }
        }
        for equipment in options {
            let mut b = Build { own: vec![id], loadout, equipment, ..Build::start(class) };
            b.extra = crate::lobby::debug_lift(class, &b);
            if crate::sheet::hero_sheet(class, &b).is_ok() {
                return b;
            }
        }
        panic!("no build of {class:?} can hold {id:?}");
    }

    /// Hero 0 of `class` with `id`, charmed by a held orc, and hero 1 where the ability's shape applies; no
    /// inputs for 300 ticks. True when the ability's cooldown starts.
    fn charmed_hero_uses(class: ClassId, id: AbilityId) -> bool {
        let build = build_with_ability(class, id);
        let mut run = test_run_with(&[(class, build), (ClassId::Paladin, Build::start(ClassId::Paladin))], BossId::Lich);
        crate::run::ai::tests::open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let primary = ab::def(id).slot == AbilitySlot::Primary;
        let a = if primary { run.players[0].sheet.primary.clone() } else { run.players[0].sheet.secondary.clone() };
        assert_eq!(a.id, id);
        let dist = match ab::def(id).shape {
            Shape::Swing => (a.range * 0.6).max(14.0),
            Shape::Projectile | Shape::Blast => 120.0f64.min(a.range * 0.8),
            Shape::GroundArea if a.range > 0.0 => 120.0f64.min(a.range * 0.8),
            Shape::GroundArea | Shape::Ring => a.radius * 0.5,
            Shape::Dash => 40.0,
            Shape::SelfArea | Shape::Buff | Shape::Summon => 60.0,
            Shape::Breath | Shape::Gaze => panic!("no hero holds {id:?}"),
        };
        let at = run.players[0].pos();
        put(&mut run, 1, at + Vec2::new(dist, 0.0));
        tough(&mut run, 0);
        tough(&mut run, 1);
        let orc = held_orc(&mut run, -60.0);
        charm_hero(&mut run, 0, orc, 60.0);
        for _ in 0..300 {
            run.step();
            let cd = if primary { run.players[0].cd1 } else { run.players[0].cd2 };
            if cd > a.cooldown * 0.5 {
                return true;
            }
        }
        false
    }

    #[test]
    fn a_charmed_hero_walks_up_to_a_far_foe_and_charges_it() {
        let build = build_with_ability(ClassId::Barbarian, AbilityId::Charge);
        let mut run = test_run_with(&[(ClassId::Barbarian, build), (ClassId::Paladin, Build::start(ClassId::Paladin))], BossId::Lich);
        crate::run::ai::tests::open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let range = run.players[0].sheet.secondary.range;
        let at = run.players[0].pos();
        put(&mut run, 1, at + Vec2::new(range * 3.0, 0.0));
        tough(&mut run, 0);
        tough(&mut run, 1);
        let orc = held_orc(&mut run, -60.0);
        charm_hero(&mut run, 0, orc, 60.0);
        let start = run.players[0].pos();
        let hp = run.players[1].hp;
        let mut charged = false;
        for _ in 0..600 {
            run.step();
            charged |= run.players[0].cd2 > 0.0;
            if charged {
                break;
            }
        }
        assert!(charged, "it closed in until the Charge could reach and used it");
        steps(&mut run, 60); // the dash lands
        assert!(run.players[0].pos().dist(start) > 1.0, "it walked first: the foe was out of the dash's range at the start");
        assert!(run.players[1].hp < hp, "and the Charge hurt the foe");
    }

    #[test]
    fn every_hero_ability_is_used_by_a_charmed_hero() {
        let mut checked = 0;
        for id in AbilityId::ALL {
            for &class in ab::def(id).classes {
                assert!(charmed_hero_uses(class, id), "{class:?} never used {id:?}");
                checked += 1;
            }
        }
        assert!(checked >= 20, "{checked}");
    }

    #[test]
    fn a_charmed_hero_kills_a_teammate() {
        let mut run = arena(&[ClassId::Paladin, ClassId::Paladin]);
        let at = run.players[0].pos();
        put(&mut run, 1, at + Vec2::new(14.0, 0.0));
        run.players[0].hp = 1.0;
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 1, orc, 30.0);
        let (kills, xp, damage) = (run.players[1].kills, run.players[1].xp, run.players[1].damage);
        steps(&mut run, 200);
        assert!(!run.players[0].alive, "the teammate fell");
        assert!(said(&run, "p0 has fallen to the Orc Warrior's charm"), "{:?}", run.events.iter().filter_map(|(e, _)| if let Ev::Msg { text } = e { Some(text.clone()) } else { None }).collect::<Vec<_>>());
        let p = &run.players[1];
        assert_eq!((p.kills, p.xp, p.damage), (kills, xp, damage), "no kill, XP or damage for the charmed hero");
    }

    #[test]
    fn a_charmed_hero_dies() {
        let mut run = arena(&[ClassId::Paladin, ClassId::Paladin]);
        let at = run.players[0].pos();
        put(&mut run, 1, at + Vec2::new(14.0, 0.0));
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 1, orc, 30.0);
        run.step();
        let hero0 = run.players[0].id;
        let (kills, xp) = (run.players[0].kills, run.players[0].xp);
        let blow = Damage { why: Why { by: Some(hero0), what: What::Unknown, ..Why::NONE }, ..Damage::physical(1e6) };
        run.hurt_player(1, blow);
        assert!(!run.players[1].alive);
        assert!(said(&run, "p1 has fallen to the Orc Warrior's charm"));
        run.step();
        assert_eq!(run.players[1].spectating, Some(hero0), "permadeath: it watches");
        assert!(run.players[1].charm.is_none() && run.players[1].side == Side::Friendly);
        assert_eq!((run.players[0].kills, run.players[0].xp), (kills, xp));
    }

    #[test]
    fn a_ranger_who_dies_charmed_loses_the_wolf_and_nobody_is_credited() {
        let mut run = arena(&[ClassId::ElvenRanger, ClassId::Paladin]);
        let wolf = crate::run::wolf::spawn_wolf(&mut run, 0);
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 0, orc, 30.0);
        run.step();
        assert_eq!(run.players[0].side, Side::Hostile);
        let hero1 = run.players[1].id;
        let before = [(run.players[0].kills, run.players[0].xp, run.players[0].damage), (run.players[1].kills, run.players[1].xp, run.players[1].damage)];
        let blow = Damage { why: Why { by: Some(hero1), what: What::Unknown, ..Why::NONE }, ..Damage::physical(1e6) };
        run.hurt_player(0, blow);
        assert!(!run.players[0].alive);
        steps(&mut run, 3);
        assert!(run.monster_idx(wolf).map_or(true, |i| !run.monsters[i].alive), "the wolf is gone with its ranger");
        assert_eq!(run.players[0].wolf, None);
        let after = [(run.players[0].kills, run.players[0].xp, run.players[0].damage), (run.players[1].kills, run.players[1].xp, run.players[1].damage)];
        assert_eq!(before, after, "no kill, XP or damage for anyone");
    }

    #[test]
    fn a_charmed_hero_lost_to_poison_or_the_terrain_is_the_casters_too() {
        let mut run = arena(&[ClassId::Paladin, ClassId::Paladin]);
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 1, orc, 30.0);
        run.step();
        let hero0 = run.players[0].id;
        let tick = Damage { why: Why { by: Some(hero0), what: What::Tick(EffectKind::Poisoned), ..Why::NONE }, ..Damage::effect_tick(1e6, DamageType::Poison) };
        run.hurt_player(1, tick);
        assert!(said(&run, "p1 has fallen to the Orc Warrior's charm"));
        // And a charmed hero that kills a teammate with its poison.
        let mut run = arena(&[ClassId::Paladin, ClassId::Paladin]);
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 1, orc, 30.0);
        run.step();
        let hero1 = run.players[1].id;
        let tick = Damage { why: Why { by: Some(hero1), what: What::Tick(EffectKind::Poisoned), ..Why::NONE }, ..Damage::effect_tick(1e6, DamageType::Poison) };
        run.hurt_player(0, tick);
        assert!(said(&run, "p0 has fallen to the Orc Warrior's charm"));
        // A fall: the charm is the cause.
        let mut run = arena(&[ClassId::Paladin, ClassId::Paladin]);
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 1, orc, 30.0);
        run.step();
        run.kill_player(1, crate::run::entities::Sink::Fall);
        assert!(said(&run, "p1 has fallen to the Orc Warrior's charm"));
        let mut run = arena(&[ClassId::Paladin]);
        run.kill_player(0, crate::run::entities::Sink::Fall);
        assert!(said(&run, "p0 fell into the abyss"));
    }

    #[test]
    fn an_orcs_charm_orb_turns_a_hero() {
        let mut run = arena(&[ClassId::Paladin]);
        let at = run.players[0].pos();
        let orc = crate::run::tests::enemy_use(&mut run, EnemyType::OrcWarrior, at + Vec2::new(-80.0, 0.0), AbilityId::Charm, at);
        // The orb flies 80 px at 160 px/s; the WIL save may shorten the charm but never refuses it.
        steps(&mut run, 60);
        let c = run.players[0].charm.as_ref().expect("the orb landed and the hero is charmed");
        assert_eq!(c.caster, orc);
        assert_eq!(run.players[0].side, Side::Hostile);
    }

    #[test]
    fn a_ranger_does_not_heal_a_wolf_that_fights_for_the_other_side() {
        let mut run = arena(&[ClassId::ElvenRanger]);
        let wolf = crate::run::wolf::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        run.monsters[wi].hp = 1.0;
        run.monsters[wi].side = Side::Hostile; // an enemy's Charm took it
        crate::run::wolf::use_ability(&mut run, 0);
        assert_eq!(run.monsters[wi].hp, 1.0);
        assert_eq!(run.players[0].wolf, Some(wolf), "and no second wolf is summoned");
    }

    #[test]
    fn the_ais_shots_take_their_ids_from_the_ai_range() {
        let mut run = arena(&[ClassId::Wizard, ClassId::Paladin]);
        let at = run.players[0].pos();
        put(&mut run, 1, at + Vec2::new(100.0, 0.0));
        tough(&mut run, 1);
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 0, orc, 30.0);
        run.step();
        run.players[0].cd1 = 0.0;
        run.players[0].cd2 = 99.0;
        let before = run.players[0].charm.as_ref().unwrap().brain.shot;
        assert!(before >= AI_SHOT_BASE);
        let i = input(&mut run, 0);
        assert_eq!((i.primary, i.secondary), (Some(before), None));
        assert_eq!(i.seq, run.players[0].ack);
        assert_eq!(run.players[0].charm.as_ref().unwrap().brain.shot, before + 1);
    }
    /// Hero 1 stands `dist` px from charmed hero 0 at `angle` from its aim (east); the held orc is the caster.
    fn charmed_with_a_hero_at(angle: f64, dist: f64) -> Run {
        charmed_wizard_or_paladin(ClassId::Paladin, angle, dist)
    }

    fn charmed_wizard_or_paladin(class: ClassId, angle: f64, dist: f64) -> Run {
        let mut run = arena(&[class, ClassId::Paladin]);
        let at = run.players[0].pos();
        put(&mut run, 1, at + Vec2::new(angle.cos(), angle.sin()) * dist);
        tough(&mut run, 1);
        let orc = held_orc(&mut run, -40.0);
        charm_hero(&mut run, 0, orc, 30.0);
        run.step();
        run.players[0].aim = 0.0;
        run
    }

    #[test]
    fn a_charmed_hero_turns_at_its_turn_speed() {
        let mut run = charmed_with_a_hero_at(1.2, 60.0);
        let step = crate::defs::races::BODY_TURN.get(&run.players[0].sheet.attrs) * DT;
        let i = input(&mut run, 0);
        assert!(step < 1.2, "the turn takes more than a tick");
        assert!((f64::from(i.aim) - step).abs() < 1e-4, "it turns by one tick's worth: {} vs {}", i.aim, step);
    }

    #[test]
    fn a_charmed_hero_fires_only_once_it_faces_its_foe() {
        // The foe stands 70 px off: at 100 px and 1.2 rad it was outside the test arena's floor (out of sight).
        let mut control = charmed_wizard_or_paladin(ClassId::Wizard, 0.0, 70.0);
        control.players[0].cd1 = 0.0;
        control.players[0].cd2 = 99.0;
        assert!(input(&mut control, 0).primary.is_some(), "control: facing the foe it fires at once");
        let mut run = charmed_wizard_or_paladin(ClassId::Wizard, 1.2, 70.0); // inside the cone plus neck, far outside the 30 degree gate
        run.players[0].cd1 = 0.0;
        run.players[0].cd2 = 99.0;
        let before = run.players[0].charm.as_ref().unwrap().brain.shot;
        let i = input(&mut run, 0);
        assert_eq!(i.primary, None, "it is far from facing the foe");
        assert_eq!(run.players[0].charm.as_ref().unwrap().brain.shot, before, "no shot id used up");
        let mut fired = false;
        for _ in 0..40 {
            run.players[0].cd1 = 0.0;
            let i = input(&mut run, 0);
            run.players[0].aim = f64::from(i.aim);
            if i.primary.is_some() {
                fired = true;
                assert!(crate::math::angle_diff(1.2, f64::from(i.aim)).abs() <= crate::run::facing::gate(&run.players[0].sheet.primary).unwrap() + 1e-6);
                break;
            }
        }
        assert!(fired, "it fires once it has turned to the foe");
    }

    #[test]
    fn a_charmed_hero_sees_within_its_cone_plus_neck() {
        let s = |run: &Run| {
            let s = run.players[0].sight_now();
            (s.cone + 2.0 * s.neck).min(360.0).to_radians() / 2.0
        };
        let run = charmed_with_a_hero_at(0.0, 60.0);
        let half = s(&run);
        assert!(half < std::f64::consts::PI - 0.3, "the test needs a blind spot");
        let inside = charmed_with_a_hero_at(half - 0.1, 60.0);
        assert_eq!(nearest_foe(&inside, 0), Some(Creature::Player(1)));
        let outside = charmed_with_a_hero_at(half + 0.1, 60.0);
        assert_eq!(nearest_foe(&outside, 0), None);
    }
}
