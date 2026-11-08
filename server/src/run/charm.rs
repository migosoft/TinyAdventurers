//! Charm: a monster under a Charmed effect fights for the heroes, then turns back. The effect itself
//! (timer, save, pause by anti-magic or a Dispel) is in run/effects.rs; here the monster's side, companion,
//! wildness, grudge and home are switched when the effect comes on and restored exactly when it goes off.
//! The switch happens once per step (`sync`), so every way an effect comes on or off (a hit, the timer, a
//! pause and its end) goes through the one place. The companion code (run/companion.rs) does the rest.

use super::entities::{Ai, Companion, Monster};
use super::targets::{self, Grudge, Side, Wild};
use super::{companion, rules_log, Run};
use crate::defs::companions::{Escort, KNIGHT_ESCORT};
use crate::defs::effects::EffectKind;
use crate::math::Vec2;

/// A monster's charm: who charmed it, whether the switch is made now, and what it was before.
#[derive(Debug, Clone)]
pub struct Charm {
    /// The entity id of the creature that charmed it, a hero or a monster (the last one, after a refresh).
    pub caster: u32,
    /// The side it fights for while charmed: the caster's side when the charm switched on (or was last refreshed).
    pub side: Side,
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

/// The creature (a hero's or a monster's entity id) a charmed effect that counts now (not paused) names, if any.
fn own_caster(m: &Monster) -> Option<u32> {
    let fx = &m.effects;
    fx.list().iter().find(|a| a.kind == EffectKind::Charmed && !a.paused(fx.anti_magic)).and_then(|a| a.source)
}

/// The caster of the charm that `mi`'s living master acts under now, if it has a master and is charmed.
fn master_caster(run: &Run, mi: usize) -> Option<u32> {
    let id = run.monsters[mi].owner?;
    let master = run.monsters.iter().find(|o| o.id == id && o.alive)?;
    master.charm.as_ref().filter(|c| c.on).map(|c| c.caster)
}

/// The hero `mi` is charmed by now, if any: through its own effect, else through its master's charm.
fn wanted(run: &Run, mi: usize) -> Option<u32> {
    own_caster(&run.monsters[mi]).or_else(|| master_caster(run, mi))
}

/// Whether anything keeps a charm on `mi`: a Charmed entry on it, paused or not, or its master's charm.
fn present(run: &Run, mi: usize) -> bool {
    let m = &run.monsters[mi];
    m.effects.list().iter().any(|a| a.kind == EffectKind::Charmed) || master_caster(run, mi).is_some()
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
    let (wanted, present, state) = (wanted(run, mi), present(run, mi), m.charm.as_ref().map(|c| (c.on, c.caster)));
    match (wanted, state) {
        (Some(caster), Some((true, now))) => {
            if caster != now {
                set_caster(run, mi, caster);
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
    if is_on(&run.monsters[mi]) {
        drop_leaderless(run, mi);
    } else {
        follow_summoner(run, mi);
    }
}

/// A charmed creature with no one to escort (its caster is gone and no hero is on its side) is a plain
/// hunter of the charm's side until the charm ends. Its charm and `before` stay.
fn drop_leaderless(run: &mut Run, mi: usize) {
    let m = &run.monsters[mi];
    if m.companion.as_ref().is_some_and(|c| companion::leader_of(run, c, m.side).is_none()) {
        let m = &mut run.monsters[mi];
        m.companion = None;
        m.ai = Ai::new(m.pos);
    }
}

/// The summoner rule: a summoned companion with no charm of its own (the wolf) fights for its summoner's
/// side, whatever side that is now. Its summoner gone, it vanishes (`companion::update_leaders`).
fn follow_summoner(run: &mut Run, mi: usize) {
    let m = &run.monsters[mi];
    let Some(c) = m.companion.as_ref().filter(|c| c.summoned) else { return };
    let Some(summoner) = run.creature_by_id(c.recruiter) else { return };
    let side = targets::side(run, summoner);
    if side != m.side {
        let m = &mut run.monsters[mi];
        m.side = side;
        reset_fight(m);
    }
}

/// Drops what a creature was doing against its old foes: its target, wind-up and charge.
fn reset_fight(m: &mut Monster) {
    m.ai = Ai::new(m.pos);
    m.slam = None;
    m.dash = None;
    m.channel = None;
    if let Some(c) = m.companion.as_mut() {
        c.prey = None;
    }
}

/// The side a charm by `caster` puts a creature on: the caster's side now. A caster that is gone (a shot that
/// outlived it) leaves the opposite of the target's own side: Friendly for a Hostile or Neutral target,
/// Hostile for a Friendly one.
fn side_for(run: &Run, caster: u32, target: Side) -> Side {
    let own = run.creature_by_id(caster).map(|c| targets::side(run, c)).filter(|&s| s != Side::Neutral);
    own.unwrap_or(if target == Side::Friendly { Side::Hostile } else { Side::Friendly })
}

/// The side the charm of `mi` by `caster` gives it: its master's charm side for a minion (it goes where its
/// master goes), else `side_for`.
fn charm_side(run: &Run, mi: usize, caster: u32, target: Side) -> Side {
    let master = run.monsters[mi].owner.and_then(|id| run.monsters.iter().find(|o| o.id == id && o.alive));
    match master.and_then(|o| o.charm.as_ref()).filter(|c| c.on && c.caster == caster) {
        Some(c) => c.side,
        None => side_for(run, caster, target),
    }
}

/// The escort script a charmed creature follows: led by `caster`.
fn escort_of(caster: u32) -> Companion {
    Companion { escort: ESCORT, leader: caster, recruiter: caster, summoned: false, prey: None, following: false, reach_t: 0.0 }
}

/// Puts the charm back to the monster's old self at once (it died, or its charm is over) and forgets it. No log line.
pub fn revert(run: &mut Run, mi: usize) {
    let m = &mut run.monsters[mi];
    if is_on(m) {
        restore(m);
    }
    m.charm = None;
}

/// Another creature's charm took over (a refresh): the charm now follows the new caster's side. `before` stays.
fn set_caster(run: &mut Run, mi: usize, caster: u32) {
    let target = run.monsters[mi].charm.as_ref().map_or(run.monsters[mi].side, |c| c.before.side);
    let side = charm_side(run, mi, caster, target);
    let m = &mut run.monsters[mi];
    let changed = m.side != side;
    if let Some(c) = m.charm.as_mut() {
        c.caster = caster;
        c.side = side;
    }
    m.side = side;
    match m.companion.as_mut() {
        Some(c) => {
            c.recruiter = caster;
            c.leader = caster;
        }
        None => m.companion = Some(escort_of(caster)),
    }
    if changed {
        reset_fight(m);
    }
}

fn switch_on(run: &mut Run, mi: usize, caster: u32) {
    let m = &mut run.monsters[mi];
    // A charm kept through a pause has its `before` already: never overwrite it with the charmed state.
    let before = match m.charm.take() {
        Some(c) => c.before,
        None => Before { side: m.side, companion: m.companion.clone(), wild: m.wild, grudge: m.grudge, home: m.ai.home },
    };
    let side = charm_side(run, mi, caster, before.side);
    let m = &mut run.monsters[mi];
    m.charm = Some(Charm { caster, side, on: true, before });
    m.side = side;
    m.companion = Some(escort_of(caster));
    m.wild = None;
    m.grudge = Grudge::default();
    m.ai = Ai::new(m.pos);
    m.channel = None;
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
    m.channel = None;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::enemies::EnemyType;
    use crate::protocol::{BossId, ClassId};
    use crate::run::behaviour::{role, Role};
    use crate::run::effects::{Apply, Creature};
    use crate::run::targets::heroes_may_hit;
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
        use crate::run::entities::{Target, Windup};
        let mut run = arena(&[ClassId::Wizard]);
        let oi = spawn(&mut run, EnemyType::OrcWarrior, 80.0);
        charm(&mut run, oi, 0, 1.0);
        run.step();
        let foe = run.monsters.iter().find(|m| m.is_boss).unwrap().id;
        let m = &mut run.monsters[oi];
        m.ai.windup = Some(Windup { t: 5.0, aim: 0.0, alt: false, at: None, id: None });
        m.ai.cast = Some((crate::defs::abilities::AbilityId::RaiseDead, 5.0));
        m.ai.target = Some(Target::Monster(foe));
        m.slam = Some(5.0);
        m.dash = Some(crate::run::entities::MonsterDash { id: crate::defs::abilities::AbilityId::Pounce, dir: Vec2::new(1.0, 0.0), left: 50.0, hit: Vec::new(), attack: true });
        m.channel = Some((crate::defs::abilities::AbilityId::FireBreath, 5.0, 0.1));
        m.companion.as_mut().unwrap().prey = Some(foe);
        run.remove_effect(Creature::Monster(oi), EffectKind::Charmed);
        run.step();
        let m = &run.monsters[oi];
        assert!(m.ai.windup.is_none() && m.ai.cast.is_none() && m.slam.is_none() && m.dash.is_none() && m.channel.is_none());
        assert!(m.companion.is_none() && m.charm.is_none());
        assert_ne!(m.ai.target, Some(Target::Monster(foe)), "the former prey is not its target");
    }

    #[test]
    fn every_charmable_creature_steps_charmed() {
        // Creatures with no attack (the bunny, deer and stag) have no prey, and must not stop the server.
        let mut tried = Vec::new();
        for t in EnemyType::ALL {
            let mut run = arena(&[ClassId::Wizard]);
            let mi = spawn(&mut run, t, 80.0);
            let src = Some((run.players[0].id, run.players[0].pos()));
            if !run.apply(Creature::Monster(mi), Apply { power: None, magical: true, source: src, ..Apply::plain(EffectKind::Charmed, Some(30.0)) }) {
                continue;
            }
            tried.push(t);
            spawn(&mut run, EnemyType::OrcWarrior, 40.0);
            steps(&mut run, 240);
        }
        for t in [EnemyType::Bunny, EnemyType::Deer, EnemyType::Stag, EnemyType::OrcWarrior] {
            assert!(tried.contains(&t), "{t:?} accepts Charmed");
        }
    }

    #[test]
    fn a_charmed_calm_animal_sinking_pays_nothing() {
        use crate::dungeon::Tile;
        let mut run = arena(&[ClassId::Wizard]);
        let bi = spawn(&mut run, EnemyType::Deer, 80.0);
        charm(&mut run, bi, 0, 30.0);
        run.step();
        assert!(is_on(&run.monsters[bi]));
        let (tx, ty) = crate::dungeon::Map::tile_of(run.monsters[bi].pos);
        run.layout.map.set(tx, ty, Tile::Chasm);
        run.monsters[bi].last_hit_by = Some(0);
        let id = run.monsters[bi].id;
        steps(&mut run, 200);
        assert!(run.monster_idx(id).map_or(true, |i| !run.monsters[i].alive), "it sank");
        assert_eq!(run.players[0].kills, 0, "a calm wild animal is no kill, charmed or not");
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

    /// A necromancer with two raised minions, as indices (master, minions).
    fn necro(run: &mut Run) -> (usize, Vec<usize>) {
        let ni = spawn(run, EnemyType::Necromancer, 120.0);
        let id = run.monsters[ni].id;
        let at = run.monsters[ni].pos;
        let minions = [EnemyType::RaisedSkeleton, EnemyType::RaisedArcher]
            .into_iter()
            .map(|t| {
                let k = run.spawn_enemy(t, at, Some(id));
                run.monster_idx(k).unwrap()
            })
            .collect();
        (ni, minions)
    }

    #[test]
    fn a_charmed_necromancer_takes_its_skeletons() {
        let mut run = arena(&[ClassId::Wizard]);
        let (ni, minions) = necro(&mut run);
        let hero = run.players[0].id;
        charm(&mut run, ni, 0, 1.0);
        run.step();
        for &k in &minions {
            let m = &run.monsters[k];
            assert_eq!(m.side, Side::Friendly);
            assert_eq!(role(m), Role::Escort);
            let c = m.companion.as_ref().expect("a companion");
            assert_eq!((c.leader, c.recruiter), (hero, hero));
            assert!(is_on(m));
        }
        steps(&mut run, 70);
        for &k in std::iter::once(&ni).chain(&minions) {
            let m = &run.monsters[k];
            assert_eq!(m.side, Side::Hostile);
            assert!(m.companion.is_none() && m.charm.is_none());
        }
    }

    #[test]
    fn minions_raised_while_charmed_are_friendly_at_once() {
        use crate::defs::abilities::AbilityId;
        let mut run = arena(&[ClassId::Wizard]);
        let ni = spawn(&mut run, EnemyType::Necromancer, 120.0);
        let id = run.monsters[ni].id;
        charm(&mut run, ni, 0, 1.0);
        run.step();
        let ppos = run.players[0].pos();
        assert!(crate::run::abilities::monster_use(&mut run, ni, AbilityId::RaiseDead, ppos));
        let new: Vec<_> = run.monsters.iter().filter(|m| m.owner == Some(id)).collect();
        assert_eq!(new.len(), 2);
        assert!(new.iter().all(|m| m.side == Side::Friendly && is_on(m) && m.companion.is_some()));
        steps(&mut run, 70);
        assert!(run.monsters.iter().filter(|m| m.owner == Some(id) && m.alive).all(|m| m.side == Side::Hostile));
    }

    #[test]
    fn anti_magic_on_the_master_turns_the_minions_back() {
        let mut run = arena(&[ClassId::Wizard]);
        let (ni, minions) = necro(&mut run);
        charm(&mut run, ni, 0, 5.0);
        run.step();
        run.set_anti_magic(Creature::Monster(ni), true);
        run.step();
        for &k in std::iter::once(&ni).chain(&minions) {
            assert_eq!(run.monsters[k].side, Side::Hostile);
        }
        run.set_anti_magic(Creature::Monster(ni), false);
        run.step();
        for &k in std::iter::once(&ni).chain(&minions) {
            assert_eq!(run.monsters[k].side, Side::Friendly);
        }
    }

    #[test]
    fn a_minion_charmed_alone() {
        // Imps (skeletons are undead and immune).
        let mut run = arena(&[ClassId::Wizard]);
        let si = spawn(&mut run, EnemyType::Summoner, 120.0);
        let (id, at) = (run.monsters[si].id, run.monsters[si].pos);
        let imps: Vec<usize> = (0..2)
            .map(|_| {
                let k = run.spawn_enemy(EnemyType::SummonedImp, at, Some(id));
                run.monster_idx(k).unwrap()
            })
            .collect();
        charm(&mut run, imps[0], 0, 5.0);
        run.step();
        assert_eq!(run.monsters[imps[0]].side, Side::Friendly);
        assert_eq!(run.monsters[imps[1]].side, Side::Hostile);
        assert_eq!(run.monsters[si].side, Side::Hostile);
        run.kill_monster(si);
        assert!(!run.monsters[imps[0]].alive, "it still dies with its master");
    }

    fn fallen_msg(run: &Run) -> bool {
        run.events.iter().any(|(e, _)| matches!(e, crate::protocol::Ev::Msg { text } if text.contains("has fallen")))
    }

    fn died(run: &Run, id: u32) -> bool {
        run.events.iter().any(|(e, _)| matches!(e, crate::protocol::Ev::Died { id: d, .. } if *d == id))
    }

    #[test]
    fn a_charmed_monster_dies_as_an_enemy() {
        use crate::defs::damage::Damage;
        use crate::run::progression::{coins_for_kill, xp_for_kill};
        // Twin runs: an uncharmed orc and a charmed one, each killed by a hit with no hero behind it.
        let mut gains = Vec::new();
        for charmed in [false, true] {
            let mut run = arena(&[ClassId::Wizard]);
            let oi = spawn(&mut run, EnemyType::OrcWarrior, 80.0);
            let id = run.monsters[oi].id;
            if charmed {
                charm(&mut run, oi, 0, 5.0);
                run.step();
                assert!(is_on(&run.monsters[oi]));
            }
            let (xp, coins) = (run.players[0].xp, run.players[0].coins);
            run.events.clear();
            run.hurt_monster(oi, Damage::physical(1e6), false, None);
            assert!(!run.monsters[oi].alive);
            assert!(died(&run, id) && !fallen_msg(&run), "charmed {charmed}");
            gains.push((run.players[0].xp - xp, run.players[0].coins - coins));
        }
        assert_eq!(gains[0], gains[1]);
        assert_eq!(gains[1], (xp_for_kill(Some(EnemyType::OrcWarrior)), coins_for_kill(Some(EnemyType::OrcWarrior))));
        assert!(gains[1].0 > 0);
        // The same through kill_monster_by.
        let mut run = arena(&[ClassId::Wizard]);
        let oi = spawn(&mut run, EnemyType::OrcWarrior, 80.0);
        charm(&mut run, oi, 0, 5.0);
        run.step();
        let xp = run.players[0].xp;
        run.events.clear();
        run.kill_monster_by(oi, false);
        assert_eq!(run.players[0].xp - xp, xp_for_kill(Some(EnemyType::OrcWarrior)));
        assert!(!fallen_msg(&run));
    }

    #[test]
    fn a_charmed_masters_minions_die_with_it() {
        let mut run = arena(&[ClassId::Wizard]);
        let (ni, minions) = necro(&mut run);
        charm(&mut run, ni, 0, 5.0);
        run.step();
        assert!(minions.iter().all(|&k| is_on(&run.monsters[k])));
        run.events.clear();
        run.kill_monster_by(ni, false);
        for &k in &minions {
            assert!(!run.monsters[k].alive);
        }
        assert!(!fallen_msg(&run), "no companion died");
    }

    #[test]
    fn a_charmed_wild_animal_pays_as_before() {
        let mut run = arena(&[ClassId::Wizard]);
        let bi = spawn(&mut run, EnemyType::Boar, 80.0);
        assert!(!run.monsters[bi].grudge.heroes);
        charm(&mut run, bi, 0, 5.0);
        run.step();
        let (xp, coins) = (run.players[0].xp, run.players[0].coins);
        run.events.clear();
        run.kill_monster_by(bi, true);
        assert!(!run.monsters[bi].alive);
        assert_eq!((run.players[0].xp, run.players[0].coins), (xp, coins));
        assert!(!fallen_msg(&run));
    }

    #[test]
    fn room_is_unchanged() {
        let mut run = arena(&[ClassId::Wizard]);
        let (ni, _) = necro(&mut run);
        let a = run.monsters[ni].kit.iter().find(|a| crate::defs::abilities::def(a.id).own.minions.is_some()).cloned().unwrap();
        let before = crate::run::minions::room(&run, ni, &a);
        charm(&mut run, ni, 0, 5.0);
        run.step();
        assert_eq!(crate::run::minions::room(&run, ni, &a), before);
    }

    /// A boss run on open floor with the boss `dx` px from the hero, awake, the hero unhurtable.
    fn boss_run(boss: BossId, dx: f64) -> (Run, usize) {
        let mut run = test_run(&[ClassId::Wizard], boss);
        crate::run::ai::tests::open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        run.players[0].debug = true;
        let bi = run.monsters.iter().position(|m| m.is_boss).unwrap();
        run.monsters[bi].pos = run.players[0].pos() + Vec2::new(dx, 0.0);
        run.monsters[bi].dormant = false;
        run.level.boss_mut().unwrap().awake = true;
        (run, bi)
    }

    /// Counts the boss behaviour's ticks.
    struct Counter(std::sync::Arc<std::sync::atomic::AtomicUsize>);
    impl crate::run::bosses::BossBehaviour for Counter {
        fn tick(&mut self, _run: &mut Run, _dt: f64) {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
    }

    #[test]
    fn a_charmed_boss_pauses_its_pattern() {
        use std::sync::{atomic::{AtomicUsize, Ordering}, Arc};
        let (mut run, bi) = boss_run(BossId::Demon, 100.0);
        let ticks = Arc::new(AtomicUsize::new(0));
        run.level.boss_mut().unwrap().behaviour = Some(Box::new(Counter(ticks.clone())));
        steps(&mut run, 5);
        assert_eq!(ticks.load(Ordering::SeqCst), 5);
        // The Demon resists 50 %, which halves the 2 s: about 1 s (60 steps) of charm.
        charm(&mut run, bi, 0, 2.0);
        run.step();
        assert!(is_on(&run.monsters[bi]));
        let (n, from) = (ticks.load(Ordering::SeqCst), run.monsters[bi].pos.dist(run.players[0].pos()));
        steps(&mut run, 30);
        assert!(is_on(&run.monsters[bi]));
        assert_eq!(ticks.load(Ordering::SeqCst), n, "the pattern waits");
        assert!(run.monsters[bi].pos.dist(run.players[0].pos()) < from - 5.0, "it comes to the caster");
        steps(&mut run, 80);
        assert!(!is_on(&run.monsters[bi]));
        assert!(ticks.load(Ordering::SeqCst) > n, "the pattern resumes");
    }

    #[test]
    fn a_charmed_boss_fights_hostiles_with_its_kit() {
        use crate::defs::damage::What;
        for boss in [BossId::Demon, BossId::Dragon] {
            let (mut run, bi) = boss_run(boss, 60.0);
            let kit: Vec<_> = run.monsters[bi].kit.iter().map(|a| a.id).collect();
            assert!(!kit.is_empty());
            let oi = spawn(&mut run, EnemyType::OrcWarrior, 90.0);
            let (orc, hp) = (run.monsters[oi].id, run.monsters[oi].hp);
            charm(&mut run, bi, 0, 10.0);
            let mut hit_by = None;
            for _ in 0..60 {
                run.step();
                let Some(oi) = run.monster_idx(orc) else { break };
                if run.monsters[oi].hp < hp {
                    hit_by = run.last_hit.as_ref().map(|d| d.why.what);
                    break;
                }
            }
            let Some(What::Ability(a)) = hit_by else { panic!("{boss:?}: the orc was not hit by an ability: {hit_by:?}") };
            assert!(kit.contains(&a), "{boss:?} hit with {a:?}, not from its kit {kit:?}");
        }
    }

    #[test]
    fn the_lich_cannot_be_charmed() {
        let (mut run, bi) = boss_run(BossId::Lich, 100.0);
        let src = Some((run.players[0].id, run.players[0].pos()));
        assert!(!run.apply(Creature::Monster(bi), Apply { power: None, magical: true, source: src, ..Apply::plain(EffectKind::Charmed, Some(5.0)) }));
        run.step();
        assert!(!is_on(&run.monsters[bi]));
    }

    #[test]
    fn killing_a_charmed_boss_wins() {
        let (mut run, bi) = boss_run(BossId::Demon, 100.0);
        charm(&mut run, bi, 0, 5.0);
        run.step();
        assert!(is_on(&run.monsters[bi]));
        run.kill_monster_by(bi, false);
        assert!(matches!(run.ended, Some((true, _))), "{:?}", run.ended);
    }

    // ---- Charm for any side (#224) ----

    /// Charm from creature `caster` (an entity id, a hero's or a monster's, or one that is gone) on monster `mi`.
    fn charm_by(run: &mut Run, mi: usize, caster: u32, secs: f64) {
        let at = crate::run::ai::living_pos(run, caster).unwrap_or(Vec2::ZERO);
        assert!(run.apply(Creature::Monster(mi), Apply { power: None, magical: true, source: Some((caster, at)), ..Apply::plain(EffectKind::Charmed, Some(secs)) }));
    }

    /// A held orc `dx` px east of hero 0 with plenty of HP: it neither moves nor dies.
    fn held_orc(run: &mut Run, dx: f64) -> usize {
        let oi = spawn(run, EnemyType::OrcWarrior, dx);
        let m = &mut run.monsters[oi];
        m.ai.hold = 1e9;
        m.hp = 1000.0;
        m.max_hp = 1000.0;
        oi
    }

    /// Hero `pi`'s wolf, as an index.
    fn wolf_of(run: &mut Run, pi: usize) -> usize {
        let id = crate::run::wolf::spawn_wolf(run, pi);
        run.monster_idx(id).unwrap()
    }

    #[test]
    fn an_enemys_charm_takes_the_wolf() {
        let mut run = arena(&[ClassId::ElvenRanger]);
        let (hero, wi) = (run.players[0].id, wolf_of(&mut run, 0));
        let oi = held_orc(&mut run, 50.0);
        let orc = run.monsters[oi].id;
        charm_by(&mut run, wi, orc, 5.0);
        run.step();
        let w = &run.monsters[wi];
        assert_eq!(w.side, Side::Hostile);
        assert_eq!(role(w), Role::Escort);
        let c = w.companion.as_ref().expect("a companion");
        assert_eq!((c.leader, c.recruiter, c.summoned), (orc, orc, false));
        let hp = run.players[0].hp;
        let mut bit = false;
        for _ in 0..180 {
            run.step();
            if run.players[0].hp < hp {
                bit = true;
                break;
            }
        }
        assert!(bit, "the charmed wolf bites hero 0");
        steps(&mut run, 300);
        let w = &run.monsters[wi];
        assert!(w.alive && w.charm.is_none());
        assert_eq!(w.side, Side::Friendly);
        let c = w.companion.as_ref().expect("a companion");
        assert_eq!((c.leader, c.recruiter, c.summoned), (hero, hero, true));
        assert_eq!(run.players[0].wolf, Some(w.id));
    }

    /// A knight recruited by hero `pi`, 20 px east of them.
    fn recruit_knight(run: &mut Run, pi: usize) -> usize {
        let at = run.players[pi].pos() + Vec2::new(20.0, 0.0);
        let id = run.spawn_enemy(EnemyType::Knight, at, None);
        let ki = run.monster_idx(id).unwrap();
        let hero = run.players[pi].id;
        let m = &mut run.monsters[ki];
        m.side = Side::Friendly;
        m.companion = Some(Companion { escort: &KNIGHT_ESCORT, leader: hero, recruiter: hero, summoned: false, prey: None, following: false, reach_t: 0.0 });
        ki
    }

    #[test]
    fn an_enemys_charm_takes_the_knight() {
        let mut run = arena(&[ClassId::Wizard, ClassId::Paladin]);
        let h1 = run.players[1].id;
        let ki = recruit_knight(&mut run, 1);
        let oi = held_orc(&mut run, 120.0);
        let orc = run.monsters[oi].id;
        charm_by(&mut run, ki, orc, 1.0);
        run.step();
        let k = &run.monsters[ki];
        assert_eq!(k.side, Side::Hostile);
        assert_eq!(role(k), Role::Escort);
        let c = k.companion.as_ref().unwrap();
        assert_eq!((c.leader, c.recruiter, c.summoned), (orc, orc, false));
        steps(&mut run, 70);
        let k = &run.monsters[ki];
        assert!(k.charm.is_none());
        assert_eq!(k.side, Side::Friendly);
        let c = k.companion.as_ref().unwrap();
        assert_eq!((c.leader, c.recruiter, c.summoned), (h1, h1, false));
    }

    #[test]
    fn a_monster_charmed_by_a_monster_hunts_when_the_caster_dies() {
        let mut run = arena(&[ClassId::ElvenRanger]);
        run.lights.fill();
        let wi = wolf_of(&mut run, 0);
        let (ci, bi) = (held_orc(&mut run, 200.0), spawn(&mut run, EnemyType::OrcWarrior, 240.0));
        run.monsters[bi].hp = 1000.0;
        run.monsters[bi].max_hp = 1000.0;
        // Ids: a dead monster leaves the list, and the indices move.
        let (caster, charmed, wolf) = (run.monsters[ci].id, run.monsters[bi].id, run.monsters[wi].id);
        charm_by(&mut run, bi, caster, 3.0);
        run.step();
        let idx = |run: &Run, id: u32| run.monster_idx(id).unwrap();
        assert_eq!(run.monsters[idx(&run, charmed)].side, Side::Hostile);
        assert_eq!(run.monsters[idx(&run, charmed)].companion.as_ref().map(|c| c.leader), Some(caster));
        run.kill_monster(ci);
        // The wolf stands beside it, and so does the hero (the wolf stays by its ranger).
        let (bi, wi) = (idx(&run, charmed), idx(&run, wolf));
        let at = run.monsters[bi].pos;
        run.players[0].debug = true;
        run.players[0].mv.x = at.x - 40.0;
        run.players[0].mv.y = at.y;
        run.monsters[wi].pos = at + Vec2::new(-20.0, 0.0);
        run.monsters[wi].ai.hold = 1e9;
        let wolf_hp = run.monsters[wi].hp;
        run.step();
        let m = &run.monsters[idx(&run, charmed)];
        assert!(m.companion.is_none(), "no leader left: a plain hunter");
        assert_eq!(m.side, Side::Hostile);
        assert!(is_on(m));
        let mut hit = false;
        for _ in 0..120 {
            run.step();
            if run.monsters[idx(&run, wolf)].hp < wolf_hp {
                hit = true;
                break;
            }
        }
        assert!(hit, "it still attacks the wolf");
        steps(&mut run, 200);
        let m = &run.monsters[idx(&run, charmed)];
        assert!(m.charm.is_none() && m.companion.is_none());
        assert_eq!(m.side, Side::Hostile);
    }

    #[test]
    fn a_refresh_by_the_other_side_keeps_before() {
        let mut run = arena(&[ClassId::Wizard]);
        let oi = spawn(&mut run, EnemyType::OrcWarrior, 80.0);
        let ci = held_orc(&mut run, 300.0);
        let (hero, caster) = (run.players[0].id, run.monsters[ci].id);
        charm_by(&mut run, oi, hero, 1.0);
        run.step();
        assert_eq!(run.monsters[oi].side, Side::Friendly);
        charm_by(&mut run, oi, caster, 1.0);
        run.step();
        let m = &run.monsters[oi];
        assert_eq!(m.side, Side::Hostile);
        let c = m.companion.as_ref().expect("a companion");
        assert_eq!((c.leader, c.recruiter), (caster, caster));
        let ch = m.charm.as_ref().unwrap();
        assert_eq!((ch.caster, ch.side, ch.before.side), (caster, Side::Hostile, Side::Hostile));
        assert!(ch.before.companion.is_none());
        steps(&mut run, 70);
        let m = &run.monsters[oi];
        assert!(m.charm.is_none() && m.companion.is_none());
        assert_eq!(m.side, Side::Hostile);
    }

    #[test]
    fn a_charm_whose_caster_is_gone_takes_the_opposite_side() {
        let mut run = arena(&[ClassId::ElvenRanger]);
        let oi = spawn(&mut run, EnemyType::OrcWarrior, 80.0);
        let bi = spawn(&mut run, EnemyType::Boar, 120.0);
        let wi = wolf_of(&mut run, 0);
        let gone = 99_999;
        run.players[0].debug = true;
        // They fight each other meanwhile: nobody may die.
        for mi in [oi, bi, wi] {
            run.monsters[mi].hp = 1e6;
            run.monsters[mi].max_hp = 1e6;
        }
        for (mi, was) in [(oi, Side::Hostile), (bi, Side::Neutral), (wi, Side::Friendly)] {
            assert_eq!(run.monsters[mi].side, was);
            charm_by(&mut run, mi, gone, 5.0);
        }
        run.step();
        for (mi, now) in [(oi, Side::Friendly), (bi, Side::Friendly), (wi, Side::Hostile)] {
            let m = &run.monsters[mi];
            assert_eq!(m.side, now, "{:?}", m.kind);
            assert_eq!(m.charm.as_ref().unwrap().side, now);
        }
        // The orc still has a hero to follow; the wolf has no Hostile creature or hero to lead it.
        assert_eq!(run.monsters[oi].companion.as_ref().map(|c| c.leader), Some(run.players[0].id));
        assert!(run.monsters[wi].companion.is_none());
        steps(&mut run, 310);
        assert_eq!(run.monsters[oi].side, Side::Hostile);
        assert_eq!(run.monsters[bi].side, Side::Neutral);
        assert_eq!(run.monsters[wi].side, Side::Friendly);
        assert_eq!(run.monsters[wi].companion.as_ref().map(|c| (c.summoned, c.recruiter)), Some((true, run.players[0].id)));
    }

    #[test]
    fn the_wolf_follows_its_rangers_side() {
        let mut run = arena(&[ClassId::ElvenRanger]);
        let wi = wolf_of(&mut run, 0);
        run.players[0].side = Side::Hostile;
        run.step();
        assert_eq!(run.monsters[wi].side, Side::Hostile);
        assert!(run.monsters[wi].alive && run.monsters[wi].charm.is_none());
        run.players[0].side = Side::Friendly;
        run.step();
        assert_eq!(run.monsters[wi].side, Side::Friendly);
        assert!(run.monsters[wi].alive);
    }

    #[test]
    fn a_recruited_knight_leaves_a_hero_on_another_side() {
        let mut run = arena(&[ClassId::Wizard, ClassId::Paladin]);
        let (h0, h1) = (run.players[0].id, run.players[1].id);
        let ki = recruit_knight(&mut run, 1);
        run.step();
        assert_eq!(run.monsters[ki].companion.as_ref().unwrap().leader, h1, "it follows its recruiter");
        run.players[1].side = Side::Hostile;
        run.step();
        assert_eq!(run.monsters[ki].companion.as_ref().unwrap().leader, h0, "it follows a hero on its side");
        run.players[0].side = Side::Hostile;
        let at = run.monsters[ki].pos;
        steps(&mut run, 30);
        let k = &run.monsters[ki];
        assert!(k.alive && k.side == Side::Friendly);
        assert_eq!(k.pos, at, "with no hero on its side it idles");
        assert!(k.companion.as_ref().unwrap().prey.is_none());
    }

    #[test]
    fn the_wolf_charmed_while_its_ranger_is_charmed() {
        let mut run = arena(&[ClassId::ElvenRanger, ClassId::Wizard]);
        let (wi, h1) = (wolf_of(&mut run, 0), run.players[1].id);
        run.players[0].side = Side::Hostile;
        run.step();
        assert_eq!(run.monsters[wi].side, Side::Hostile);
        charm_by(&mut run, wi, h1, 1.0);
        steps(&mut run, 3);
        assert_eq!(run.monsters[wi].side, Side::Friendly, "its own charm wins");
        assert!(is_on(&run.monsters[wi]));
        steps(&mut run, 70);
        let w = &run.monsters[wi];
        assert!(w.charm.is_none() && w.alive);
        assert_eq!(w.side, Side::Hostile, "then it takes the ranger's side");
        run.players[0].side = Side::Friendly;
        run.step();
        assert_eq!(run.monsters[wi].side, Side::Friendly);
    }

    #[test]
    fn the_wolf_dying_charmed_frees_its_ranger() {
        let mut run = arena(&[ClassId::ElvenRanger]);
        let wi = wolf_of(&mut run, 0);
        let oi = held_orc(&mut run, 150.0);
        let orc = run.monsters[oi].id;
        charm_by(&mut run, wi, orc, 5.0);
        run.step();
        assert!(is_on(&run.monsters[wi]));
        run.events.clear();
        run.kill_monster(wi);
        assert_eq!(run.players[0].wolf, None);
        assert!(run.players[0].cd2 > 0.0, "the dead-wolf cooldown");
        assert!(run.events.iter().any(|(e, _)| matches!(e, crate::protocol::Ev::Msg { text } if text.contains("wolf has fallen"))));
    }

    #[test]
    fn the_wolf_vanishes_with_its_ranger_on_any_side() {
        let mut run = arena(&[ClassId::ElvenRanger, ClassId::Wizard]);
        let wi = wolf_of(&mut run, 0);
        let id = run.monsters[wi].id;
        run.players[0].side = Side::Hostile;
        run.players[0].alive = false;
        run.step();
        assert!(run.monster_idx(id).map_or(true, |i| !run.monsters[i].alive));
        assert_eq!(run.players[0].wolf, None);
    }

    #[test]
    fn a_charmed_disciple_stays_put() {
        let mut run = arena(&[ClassId::Wizard]);
        let di = spawn(&mut run, EnemyType::Disciple, 400.0);
        let pos = run.monsters[di].pos;
        charm(&mut run, di, 0, 5.0);
        run.events.clear();
        steps(&mut run, 60);
        assert!(is_on(&run.monsters[di]));
        assert_eq!(run.monsters[di].pos, pos);
        assert!(!run.events.iter().any(|(e, _)| matches!(e, crate::protocol::Ev::Boom { k: 9, .. })), "no reappear puff");
    }
}
