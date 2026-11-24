//! How a creature aims an arcing shot (#321): the same helper for monsters, companions and charmed heroes.
//! The landing point is scattered over a disc (DEX), tightened by range finding after misses on the same
//! target and moved ahead of a moving target by Lead (INT tiers, `defs/smarts.rs`).

use super::arc::flight_time;
use super::effects::Creature;
use super::entities::AimMemory;
use super::{Run, DT};
use crate::defs::attributes::{Attr, Attributes};
use crate::defs::smarts::Smart;
use crate::math::Vec2;
use crate::sheet::ResolvedAbility;
use rand::Rng;

/// Lead reads the target's speed over this many ticks.
const LEAD_TICKS: usize = 4;

fn attrs_of(run: &Run, c: Creature) -> Attributes {
    match c {
        Creature::Player(pi) => run.players[pi].sheet.attrs,
        Creature::Monster(mi) => run.monsters[mi].attrs,
    }
}

/// The memory of creature `c`; a hero not driven by the charm AI has none.
fn memory(run: &mut Run, c: Creature) -> Option<&mut AimMemory> {
    match c {
        Creature::Player(pi) => run.players[pi].charm.as_mut().map(|ch| &mut ch.brain.aim),
        Creature::Monster(mi) => Some(&mut run.monsters[mi].ai.aim),
    }
}

/// The target `c` last aimed an arcing shot at (for `Projectile.aimed`).
pub fn aimed_at(run: &mut Run, c: Creature) -> Option<u32> {
    memory(run, c).map(|m| m.target).filter(|&t| t != 0)
}

/// The scatter factor of a memory (0 = unset = 1).
fn factor(m: &AimMemory) -> f64 {
    if m.factor == 0.0 { 1.0 } else { m.factor }
}

/// Where creature `c` aims an arcing ability `a` at `foe`: a ground point.
pub fn creature_aim(run: &mut Run, c: Creature, foe: Creature, a: &ResolvedAbility) -> Vec2 {
    let (pos, attrs, foe_id) = (run.creature_pos(c), attrs_of(run, c), run.creature_id(foe));
    let int = attrs.get(Attr::Int);
    let mut at = run.creature_pos(foe);
    if run.smarts.can(int, Smart::Lead) {
        // One step, no iteration: the flight time to where the target stands now.
        let t = flight_time((pos.dist(at) - 6.0).max(0.0), a.speed);
        at = at + run.creature_vel(foe) * t;
    }
    let ranged = run.smarts.can(int, Smart::RangeFinding);
    let mem = memory(run, c).expect("only a creature with an AI aims");
    if mem.target != foe_id {
        *mem = AimMemory { target: foe_id, factor: 1.0 };
    }
    let f = if ranged { factor(mem) } else { 1.0 };
    let radius = pos.dist(at) * run.smarts.scatter.per(&attrs) * f;
    // Uniform over the disc: r = R sqrt(u).
    let r = radius * run.rng.gen::<f64>().sqrt();
    let th = run.rng.gen_range(0.0..std::f64::consts::TAU);
    at + Vec2::from_angle(th) * r
}

/// An aimed shot of `owner` ended: `struck` if it hit `aimed`. Range finding learns from it.
pub fn shot_done(run: &mut Run, owner: u32, aimed: u32, struck: bool) {
    let Some(c) = run.creature_by_id(owner) else { return };
    if !run.smarts.can(attrs_of(run, c).get(Attr::Int), Smart::RangeFinding) {
        return;
    }
    let (mult, floor) = (run.smarts.range_find_mult, run.smarts.range_find_floor);
    let Some(mem) = memory(run, c) else { return };
    if mem.target != aimed {
        return;
    }
    mem.factor = if struck { 1.0 } else { (factor(mem) * mult).max(floor) };
}

impl Run {
    /// A creature's velocity (px/s) over its last `LEAD_TICKS` ticks (fewer while its history is short), from its
    /// position history: one tick is jittery for a hero, whose speed changes with every input.
    pub fn creature_vel(&self, c: Creature) -> Vec2 {
        let len = match c {
            Creature::Player(pi) => self.players[pi].history.len(),
            Creature::Monster(mi) => self.monsters[mi].history.len(),
        };
        let ago = |t| match c {
            Creature::Player(pi) => self.players[pi].pos_ago(t),
            Creature::Monster(mi) => self.monsters[mi].pos_ago(t),
        };
        let n = LEAD_TICKS.min(len.saturating_sub(1)).max(1);
        (ago(1) - ago(1 + n)) * (1.0 / (n as f64 * DT))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::enemies::EnemyType;
    use crate::protocol::{BossId, ClassId};
    use crate::run::tests::test_run_seed;

    /// A goblin archer (INT `int`, DEX `dex`) `dist` px west of hero 0, which does not act.
    fn fixture(seed: u64, int: i32, dex: i32, dist: f64) -> (Run, usize, ResolvedAbility) {
        let mut run = test_run_seed(&[ClassId::ElvenRanger], BossId::Lich, seed);
        run.monsters.clear();
        let at = run.players[0].pos() - Vec2::new(dist, 0.0);
        let id = run.spawn_enemy(EnemyType::GoblinArcher, at, None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].attrs = Attributes::new(10, dex, 10, int, 10, 10);
        let a = run.monsters[mi].kit.iter().next().unwrap().clone();
        (run, mi, a)
    }

    fn mem(run: &Run, mi: usize) -> (u32, f64) {
        let m = &run.monsters[mi].ai.aim;
        (m.target, factor(m))
    }

    #[test]
    fn scatter_shrinks_with_dex() {
        let spread = |dex| crate::defs::smarts::SMARTS.scatter.per(&Attributes::new(10, dex, 10, 10, 10, 10));
        assert!((spread(10) - 0.15).abs() < 1e-12);
        assert!(spread(20) < spread(10));
    }

    #[test]
    fn scatter_is_even_over_the_disc() {
        let (mut run, mi, a) = fixture(1, 10, 10, 100.0);
        let foe = Creature::Player(0);
        let at = run.players[0].pos();
        let ds: Vec<f64> = (0..2000).map(|_| creature_aim(&mut run, Creature::Monster(mi), foe, &a).dist(at)).collect();
        assert!(ds.iter().all(|&d| d <= 15.0 + 1e-9));
        let mean = ds.iter().sum::<f64>() / ds.len() as f64;
        assert!((mean - 10.0).abs() < 1.0, "mean {mean}");
    }

    #[test]
    fn range_finding_tightens_after_misses() {
        let (mut run, mi, a) = fixture(1, 16, 10, 100.0);
        let (me, foe) = (Creature::Monster(mi), Creature::Player(0));
        let (owner, fid) = (run.monsters[mi].id, run.players[0].id);
        creature_aim(&mut run, me, foe, &a);
        assert_eq!(mem(&run, mi), (fid, 1.0));
        shot_done(&mut run, owner, fid, false);
        shot_done(&mut run, owner, fid, false);
        assert!((mem(&run, mi).1 - 0.36).abs() < 1e-9);
        for _ in 0..3 {
            shot_done(&mut run, owner, fid, false);
        }
        assert_eq!(mem(&run, mi).1, 0.25);
        shot_done(&mut run, owner, fid, false);
        shot_done(&mut run, owner, fid, true);
        assert_eq!(mem(&run, mi).1, 1.0);
        shot_done(&mut run, owner, fid, false);
        run.monsters[mi].ai.aim.target = 999; // a new target resets
        creature_aim(&mut run, me, foe, &a);
        assert_eq!(mem(&run, mi), (fid, 1.0));
    }

    #[test]
    fn below_tier_2_never_tightens() {
        let (mut run, mi, a) = fixture(1, 10, 10, 100.0);
        let (owner, fid) = (run.monsters[mi].id, run.players[0].id);
        creature_aim(&mut run, Creature::Monster(mi), Creature::Player(0), &a);
        for _ in 0..4 {
            shot_done(&mut run, owner, fid, false);
        }
        assert_eq!(mem(&run, mi).1, 1.0);
    }

    #[test]
    fn lead_aims_ahead() {
        let (mut run, mi, a) = fixture(1, 21, 10, 100.0);
        let s = 60.0;
        let pos = run.players[0].pos();
        run.players[0].history = [pos - Vec2::new(s * DT, 0.0), pos].into_iter().collect();
        let t = flight_time(100.0 - 6.0, a.speed);
        let n = 500;
        let mean_x = (0..n).map(|_| creature_aim(&mut run, Creature::Monster(mi), Creature::Player(0), &a).x).sum::<f64>() / n as f64;
        assert!((mean_x - (pos.x + s * t)).abs() < 2.0, "mean {mean_x} want {}", pos.x + s * t);
    }

    #[test]
    fn lead_smooths_the_speed_over_several_ticks() {
        let (mut run, _, _) = fixture(1, 21, 10, 100.0);
        // Three steps of 30 px over four ticks, the last tick standing still: one tick alone would read 0.
        let x0 = run.players[0].pos().x;
        run.players[0].history = [0.0, 30.0, 60.0, 90.0, 90.0].into_iter().map(|d| Vec2::new(x0 + d, 0.0)).collect();
        let v = run.creature_vel(Creature::Player(0));
        assert!((v.x - 90.0 / (4.0 * DT)).abs() < 1e-6, "{v:?}");
    }

    #[test]
    fn a_barrel_shot_is_not_tagged_with_the_last_foe() {
        let (mut run, mi, a) = fixture(1, 16, 10, 100.0);
        creature_aim(&mut run, Creature::Monster(mi), Creature::Player(0), &a);
        let fid = run.players[0].id;
        let barrel = run.monsters[mi].pos - Vec2::new(40.0, 0.0);
        crate::run::ai::perform_attack(&mut run, mi, Creature::Player(0), false, Some(barrel));
        assert_eq!(run.projectiles.len(), 1);
        assert_eq!(run.projectiles[0].aimed, None, "a miss at a barrel teaches nothing");
        assert_eq!(run.monsters[mi].ai.aim.target, fid, "the memory of the foe stays");
    }

    #[test]
    fn a_volley_teaches_range_finding_once() {
        let (mut run, mi, _) = fixture(1, 16, 10, 100.0);
        let m = &mut run.monsters[mi];
        m.kit = crate::sheet::monster_kit(&[crate::defs::abilities::AbilityId::Volley], &m.attrs, &[crate::defs::items::ItemId::GoblinShortbow], crate::sheet::Body { radius: m.radius }, &[]);
        crate::run::ai::perform_attack(&mut run, mi, Creature::Player(0), false, None);
        assert_eq!(run.projectiles.len(), 3);
        assert_eq!(run.projectiles.iter().filter(|p| p.aimed.is_some()).count(), 1, "the middle arrow stands for the volley");
    }

    #[test]
    fn same_seed_same_shots() {
        let shots = || {
            let (mut run, mi, a) = fixture(7, 10, 10, 100.0);
            (0..5).map(|_| creature_aim(&mut run, Creature::Monster(mi), Creature::Player(0), &a)).collect::<Vec<_>>()
        };
        assert_eq!(shots(), shots());
    }
}
