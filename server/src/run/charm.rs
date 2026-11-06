//! Charm: a monster under a Charmed effect fights for the heroes, then turns back. The effect itself
//! (timer, save, pause by anti-magic or a Dispel) is in run/effects.rs; here the monster's side, companion,
//! wildness, grudge and home are switched when the effect comes on and restored exactly when it goes off.
//! The switch happens once per step (`sync`), so every way an effect comes on or off (a hit, the timer, a
//! pause and its end) goes through the one place. The companion code (run/companion.rs) does the rest.

use super::entities::{Ai, Companion, Monster};
use super::targets::{Grudge, Side, Wild};
use super::{rules_log, Run};
use crate::defs::companions::{Escort, KNIGHT_ESCORT};
use crate::defs::effects::EffectKind;
use crate::math::Vec2;

/// A monster's charm: who charmed it, whether the switch is made now, and what it was before.
#[derive(Debug, Clone)]
pub struct Charm {
    /// The player id of the hero that charmed it (the last one, after a refresh).
    pub caster: u32,
    /// Whether it acts charmed now. False while anti-magic or a Dispel pauses the effect: it is its old self
    /// again, and `before` is kept for when the pause lifts.
    pub on: bool,
    before: Before,
}

/// What a charm replaces and gives back. Taken once, when the charm first comes on; a refresh keeps it.
#[derive(Debug, Clone)]
struct Before {
    side: Side,
    companion: Option<Companion>,
    wild: Option<Wild>,
    grudge: Grudge,
    home: Vec2,
}

/// The escort script a charmed monster follows: the knight's.
const ESCORT: &Escort = &KNIGHT_ESCORT;

/// Whether `m` acts charmed now.
pub fn is_on(m: &Monster) -> bool {
    m.charm.as_ref().is_some_and(|c| c.on)
}

/// The hero a charmed effect that counts now (not paused) names, if any.
fn wanted(m: &Monster) -> Option<u32> {
    let fx = &m.effects;
    fx.list().iter().find(|a| a.kind == EffectKind::Charmed && !a.paused(fx.anti_magic)).and_then(|a| a.source)
}

/// Whether any Charmed entry is on the monster, paused or not.
fn present(m: &Monster) -> bool {
    m.effects.list().iter().any(|a| a.kind == EffectKind::Charmed)
}

/// Switches every monster to or from its charm for this step: those without a master first, then the owned
/// ones, which read the state their master has this step.
pub fn sync(run: &mut Run) {
    for owned in [false, true] {
        for mi in 0..run.monsters.len() {
            if run.monsters[mi].owner.is_some() == owned {
                sync_one(run, mi);
            }
        }
    }
}

/// Brings monster `mi` in line with its Charmed effect: on, refreshed by another hero, or off.
pub fn sync_one(run: &mut Run, mi: usize) {
    let m = &run.monsters[mi];
    if !m.alive || m.sinking.is_some() {
        return;
    }
    let (wanted, present, state) = (wanted(m), present(m), m.charm.as_ref().map(|c| (c.on, c.caster)));
    match (wanted, state) {
        (Some(caster), Some((true, now))) => {
            if caster != now {
                set_caster(&mut run.monsters[mi], caster);
            }
        }
        (Some(caster), _) => switch_on(run, mi, caster),
        (None, Some((true, _))) => {
            rules_log::charm(run, mi, false);
            restore(&mut run.monsters[mi]);
            if !present {
                run.monsters[mi].charm = None;
            }
        }
        (None, Some((false, _))) if !present => run.monsters[mi].charm = None,
        (None, _) => {}
    }
}

/// Puts the charm back to the monster's old self at once (it died, or its charm is over) and forgets it. No log line.
#[allow(dead_code)] // the death paths call it (#223)
pub fn revert(run: &mut Run, mi: usize) {
    let m = &mut run.monsters[mi];
    if is_on(m) {
        restore(m);
    }
    m.charm = None;
}

fn set_caster(m: &mut Monster, caster: u32) {
    if let Some(c) = m.charm.as_mut() {
        c.caster = caster;
    }
    if let Some(c) = m.companion.as_mut() {
        c.recruiter = caster;
        c.leader = caster;
    }
}

fn switch_on(run: &mut Run, mi: usize, caster: u32) {
    let m = &mut run.monsters[mi];
    // A charm kept through a pause has its `before` already: never overwrite it with the charmed state.
    let before = match m.charm.take() {
        Some(c) => c.before,
        None => Before { side: m.side, companion: m.companion.clone(), wild: m.wild, grudge: m.grudge, home: m.ai.home },
    };
    m.charm = Some(Charm { caster, on: true, before });
    m.side = Side::Friendly;
    m.companion = Some(Companion { escort: ESCORT, leader: caster, recruiter: caster, summoned: false, prey: None, following: false, reach_t: 0.0 });
    m.wild = None;
    m.grudge = Grudge::default();
    m.ai = Ai::new(m.pos);
    rules_log::charm(run, mi, true);
}

/// Gives the monster its old side, companion, wildness, grudge and home back, where it stands. What it was
/// doing as a charmed creature is dropped. Leaves `charm` in place, off.
fn restore(m: &mut Monster) {
    let Some(c) = m.charm.as_mut() else { return };
    let b = c.before.clone();
    c.on = false;
    m.side = b.side;
    m.companion = b.companion;
    m.wild = b.wild;
    m.grudge = b.grudge;
    m.ai = Ai::new(m.pos);
    m.ai.home = b.home;
    m.slam = None;
    m.dash = None;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::effects::EffectKind;
    use crate::defs::enemies::EnemyType;
    use crate::protocol::{BossId, ClassId};
    use crate::run::behaviour::{role, Role};
    use crate::run::effects::{Apply, Creature};
    use crate::run::targets::{heroes_may_hit, Reaction};
    use crate::run::tests::test_run;

    /// An open floor with the hero(es) and no monsters but the boss.
    fn arena(classes: &[ClassId]) -> Run {
        let mut run = test_run(classes, BossId::Lich);
        crate::run::ai::tests::open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        run
    }

    fn spawn(run: &mut Run, t: EnemyType, dx: f64) -> usize {
        let at = run.players[0].pos() + Vec2::new(dx, 0.0);
        let id = run.spawn_enemy(t, at, None);
        run.monster_idx(id).unwrap()
    }

    /// Charm from hero `pi` for `secs` (the save does not scale it: no power).
    fn charm(run: &mut Run, mi: usize, pi: usize, secs: f64) {
        let src = Some((run.players[pi].id, run.players[pi].pos()));
        assert!(run.apply(Creature::Monster(mi), Apply { power: None, magical: true, source: src, ..Apply::plain(EffectKind::Charmed, Some(secs)) }));
    }

    fn steps(run: &mut Run, n: usize) {
        for _ in 0..n {
            run.step();
        }
    }

    #[test]
    fn a_charmed_orc_follows_its_caster() {
        let mut run = arena(&[ClassId::Wizard]);
        let oi = spawn(&mut run, EnemyType::OrcWarrior, 80.0);
        assert_eq!(run.monsters[oi].side, Side::Hostile);
        charm(&mut run, oi, 0, 5.0);
        run.step();
        let hero = run.players[0].id;
        let m = &run.monsters[oi];
        assert_eq!(m.side, Side::Friendly);
        assert_eq!(role(m), Role::Escort);
        let c = m.companion.as_ref().expect("a companion");
        assert_eq!((c.leader, c.recruiter, c.summoned), (hero, hero, false));
        assert!(!heroes_may_hit(m));
        assert!(is_on(m));
    }

    #[test]
    fn the_orc_turns_back_exactly() {
        let mut run = arena(&[ClassId::Wizard]);
        let oi = spawn(&mut run, EnemyType::OrcWarrior, 80.0);
        run.monsters[oi].ai.home = Vec2::new(123.0, 77.0);
        let m = &run.monsters[oi];
        let (side, grudge, home) = (m.side, m.grudge, m.ai.home);
        assert!(m.companion.is_none() && m.wild.is_none());
        charm(&mut run, oi, 0, 1.0);
        steps(&mut run, 3);
        assert!(is_on(&run.monsters[oi]));
        steps(&mut run, 70);
        let m = &run.monsters[oi];
        assert_eq!((m.side, m.grudge, m.ai.home), (side, grudge, home));
        assert!(m.companion.is_none() && m.wild.is_none());
        assert!(m.charm.is_none());
        assert!(!is_on(m));
    }

    #[test]
    fn a_wild_animal_turns_back_wild() {
        let mut run = arena(&[ClassId::Wizard]);
        let bi = spawn(&mut run, EnemyType::Boar, 80.0);
        run.monsters[bi].grudge.heroes = true;
        run.monsters[bi].ai.home = Vec2::new(200.0, 90.0);
        let wild = run.monsters[bi].wild.expect("a boar is wild");
        let side = run.monsters[bi].side;
        assert_eq!(role(&run.monsters[bi]), Role::Wildlife);
        charm(&mut run, bi, 0, 1.0);
        run.step();
        let m = &run.monsters[bi];
        assert!(m.wild.is_none() && !m.grudge.heroes);
        assert_eq!(role(m), Role::Escort);
        steps(&mut run, 70);
        let m = &run.monsters[bi];
        assert_eq!(m.wild, Some(wild));
        assert!(m.grudge.heroes);
        assert_eq!(m.side, side);
        assert_eq!(m.ai.home, Vec2::new(200.0, 90.0));
        assert_eq!(role(m), Role::Wildlife);
        let _ = Reaction::Flee;
    }

    #[test]
    fn a_refresh_keeps_the_first_before() {
        let mut run = arena(&[ClassId::Wizard, ClassId::Paladin]);
        let oi = spawn(&mut run, EnemyType::OrcWarrior, 80.0);
        charm(&mut run, oi, 0, 5.0);
        run.step();
        charm(&mut run, oi, 1, 5.0);
        run.step();
        let second = run.players[1].id;
        let m = &run.monsters[oi];
        assert_eq!(m.charm.as_ref().unwrap().before.side, Side::Hostile);
        assert!(m.charm.as_ref().unwrap().before.companion.is_none());
        let c = m.companion.as_ref().unwrap();
        assert_eq!((c.recruiter, c.leader), (second, second));
        assert_eq!(m.side, Side::Friendly);
    }

    #[test]
    fn anti_magic_pauses_and_resumes() {
        let mut run = arena(&[ClassId::Wizard]);
        let oi = spawn(&mut run, EnemyType::OrcWarrior, 80.0);
        charm(&mut run, oi, 0, 5.0);
        run.step();
        run.set_anti_magic(Creature::Monster(oi), true);
        run.step();
        let m = &run.monsters[oi];
        assert_eq!(m.side, Side::Hostile);
        assert!(m.companion.is_none());
        assert!(m.charm.is_some() && !is_on(m));
        run.set_anti_magic(Creature::Monster(oi), false);
        run.step();
        let m = &run.monsters[oi];
        assert_eq!(m.side, Side::Friendly);
        assert!(is_on(m));
        assert_eq!(m.charm.as_ref().unwrap().before.side, Side::Hostile);
    }

    #[test]
    fn a_dispel_pauses_it_like_any_magic() {
        let mut run = arena(&[ClassId::Wizard]);
        let oi = spawn(&mut run, EnemyType::OrcWarrior, 80.0);
        let c = Creature::Monster(oi);
        charm(&mut run, oi, 0, 5.0);
        run.step();
        run.pause_effect(c, EffectKind::Charmed, 1.0);
        run.step();
        assert_eq!(run.monsters[oi].side, Side::Hostile);
        assert!(run.monsters[oi].charm.is_some() && !is_on(&run.monsters[oi]));
        steps(&mut run, 62);
        let m = &run.monsters[oi];
        assert_eq!(m.side, Side::Friendly, "the pause is over, time is left");
        assert_eq!(m.charm.as_ref().unwrap().before.side, Side::Hostile);

        // A pause longer than the time left: the charm runs out under it and never comes back.
        let oj = spawn(&mut run, EnemyType::OrcWarrior, 100.0);
        charm(&mut run, oj, 0, 2.0);
        run.step();
        run.pause_effect(Creature::Monster(oj), EffectKind::Charmed, 10.0);
        steps(&mut run, 130);
        let m = &run.monsters[oj];
        assert_eq!(m.side, Side::Hostile);
        assert!(m.charm.is_none());
    }

    #[test]
    fn a_charm_outlives_its_caster_leaving() {
        // (a) the recruiter is no player (the caster left) while hero 1 is alive; (b) hero 1 is dead.
        for dead in [false, true] {
            let mut run = arena(&[ClassId::Wizard, ClassId::Paladin]);
            let h0 = run.players[0].id;
            let oi = spawn(&mut run, EnemyType::OrcWarrior, 80.0);
            charm(&mut run, oi, 1, 5.0);
            run.step();
            if dead {
                run.players[1].alive = false;
            } else {
                run.monsters[oi].companion.as_mut().unwrap().recruiter = 9999;
            }
            steps(&mut run, 2);
            let m = &run.monsters[oi];
            assert!(m.alive, "dead {dead}");
            assert_eq!(m.side, Side::Friendly, "dead {dead}");
            assert_eq!(m.companion.as_ref().unwrap().leader, h0, "dead {dead}");
        }
    }

    #[test]
    fn turning_back_drops_what_it_was_doing() {
        let mut run = arena(&[ClassId::Wizard]);
        let oi = spawn(&mut run, EnemyType::OrcWarrior, 80.0);
        charm(&mut run, oi, 0, 1.0);
        run.step();
        let foe = run.monsters.iter().find(|m| m.is_boss).unwrap().id;
        let m = &mut run.monsters[oi];
        m.ai.windup = Some(crate::run::entities::Windup { t: 5.0, aim: 0.0, alt: false, at: None, id: None });
        m.ai.target = Some(crate::run::entities::Target::Monster(foe));
        m.companion.as_mut().unwrap().prey = Some(foe);
        run.remove_effect(Creature::Monster(oi), EffectKind::Charmed);
        sync_one(&mut run, oi);
        let m = &run.monsters[oi];
        assert!(m.ai.windup.is_none() && m.ai.target.is_none() && m.companion.is_none());
    }

    #[test]
    fn sleep_beats_the_charm() {
        let mut run = arena(&[ClassId::Wizard]);
        let oi = spawn(&mut run, EnemyType::OrcWarrior, 200.0);
        charm(&mut run, oi, 0, 20.0);
        run.step();
        assert!(run.apply_effect(Creature::Monster(oi), EffectKind::Sleep, Some(20.0)));
        let at = run.monsters[oi].pos;
        steps(&mut run, 10);
        assert_eq!(run.monsters[oi].pos, at);
        assert!(is_on(&run.monsters[oi]));
    }

    #[test]
    fn charm_lines_in_the_rules_log() {
        let mut run = arena(&[ClassId::Wizard]);
        run.log.forced = true;
        let oi = spawn(&mut run, EnemyType::OrcWarrior, 80.0);
        charm(&mut run, oi, 0, 1.0);
        run.step();
        let heads: Vec<String> = rules_log::take(&mut run).into_iter().map(|r| r.head).collect();
        assert!(heads.iter().any(|h| h.contains("is charmed and follows")), "{heads:?}");
        steps(&mut run, 70);
        let heads: Vec<String> = rules_log::take(&mut run).into_iter().map(|r| r.head).collect();
        assert!(heads.iter().any(|h| h.contains("turns back")), "{heads:?}");
    }
}
