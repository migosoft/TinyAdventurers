//! Which monsters an area or chaining ability may hit, and why one is passed over. The rules and the
//! rules log share this one decision.

use super::effects::Creature;
use super::entities::Monster;
use super::Run;
use crate::collision::line_of_sight;
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::damage::DamageSplit;
use crate::defs::effects::EffectKind;
use crate::math::{angle_diff, Vec2};

/// Whom a creature fights for. `Neutral` is nobody's foe and nobody's friend: it is never a target and
/// nothing hurts it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Side {
    Neutral = 0,
    Hostile = 1,
    Friendly = 2,
}

/// Do `a` and `b` fight each other? Only a Hostile and a Friendly do; a Neutral has no foes.
pub fn foes(a: Side, b: Side) -> bool {
    matches!((a, b), (Side::Hostile, Side::Friendly) | (Side::Friendly, Side::Hostile))
}

/// The side creature `c` fights for.
pub fn side(run: &Run, c: Creature) -> Side {
    match c {
        Creature::Player(i) => run.players[i].side,
        Creature::Monster(mi) => run.monsters[mi].side,
    }
}

/// The sides a creature holds a grudge against, for good: it fights them (and they fight it) though the
/// side table says otherwise. A hit on a wild animal sets it (`Run::hurt_monster`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Grudge {
    pub heroes: bool,
    pub enemies: bool,
}

impl Grudge {
    /// Is `s` a side it holds a grudge against? The heroes' side is Friendly, the enemies' Hostile.
    pub fn has(&self, s: Side) -> bool {
        match s {
            Side::Friendly => self.heroes,
            Side::Hostile => self.enemies,
            Side::Neutral => false,
        }
    }
}

/// What a wild animal does when it is hit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reaction {
    /// It keeps a grudge against the side that hit it.
    FightBack,
    /// It runs from the attacker.
    Flee,
}

/// A wild animal: Neutral, calm until hit, and anything may hit it (unlike the unrecruited knight).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Wild {
    pub reaction: Reaction,
    /// The id of the creature a `Flee` animal runs from: set when it is hit by one, cleared when it calms down.
    pub scare: Option<u32>,
}

/// Whom a creature fights for and holds a grudge against; `me` is the creature itself (a user never hits
/// itself), `None` for a shot or a hazard.
#[derive(Debug, Clone, Copy)]
pub struct Stance {
    pub side: Side,
    pub grudge: Grudge,
    pub me: Option<Creature>,
}

impl Stance {
    /// A shot or a hazard of `side`: no grudge, nobody's body.
    pub fn of_side(side: Side) -> Stance {
        Stance { side, grudge: Grudge::default(), me: None }
    }
}

/// The stance of creature `c`; a hero holds no grudge.
pub fn stance(run: &Run, c: Creature) -> Stance {
    match c {
        Creature::Player(i) => Stance { side: run.players[i].side, grudge: Grudge::default(), me: Some(c) },
        Creature::Monster(mi) => Stance { side: run.monsters[mi].side, grudge: run.monsters[mi].grudge, me: Some(c) },
    }
}

/// Do `a` and `b` fight each other? The side table, plus either one's grudge against the other's side.
pub fn fights(a: &Stance, b: &Stance) -> bool {
    foes(a.side, b.side) || a.grudge.has(b.side) || b.grudge.has(a.side)
}

/// May a hero (or a companion) hit `m`? An enemy, a creature with a grudge against the heroes, or a wild animal.
pub fn heroes_may_hit(m: &Monster) -> bool {
    m.side == Side::Hostile || m.grudge.heroes || m.wild.is_some()
}

/// May an enemy hit `m`? An ally of the heroes, a creature with a grudge against the enemies, or a wild animal.
pub fn enemies_may_hit(m: &Monster) -> bool {
    m.side == Side::Friendly || m.grudge.enemies || m.wild.is_some()
}

/// Why a creature is not a target.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Skip {
    Dead,
    Ally,
    /// Neutral: nobody's foe, never a target.
    Neutral,
    Hiding,
    /// Under the Invisible effect; skipped where a target is picked (`skip_invisible`).
    Invisible,
    Dormant,
    Airborne,
    /// The attack passes through it: it has no body and resists every type of the attack fully.
    Bodiless,
    OutOfReach,
    OutsideArc,
    NoLineOfSight,
    AlreadyHit,
}

/// The cone of a swing.
#[derive(Clone, Copy)]
pub struct Arc {
    pub aim: f64,
    /// The whole angle (rad).
    pub width: f64,
    /// The user's body radius: a creature closer than that and its own radius touches the user.
    pub user_radius: f64,
}

#[derive(Clone, Copy)]
/// What an ability needs of a creature. One that is dead, on the user's side, already hit or out of reach is
/// never a target; the other filters are switched on by the rule.
pub struct Rule {
    /// Where the ability reaches from.
    pub at: Vec2,
    pub reach: f64,
    /// The creature's body radius is added to `reach`.
    pub plus_radius: bool,
    /// Only inside it, or touching the user.
    pub arc: Option<Arc>,
    /// Needs a clear line from `at`.
    pub los: bool,
    /// Skips a hiding mimic.
    pub skip_hiding: bool,
    pub skip_dormant: bool,
    pub skip_airborne: bool,
    /// Skips an invisible creature: only where a target is picked (a jump, a gaze); an area, a swing or a dash
    /// that covers one still hits it.
    pub skip_invisible: bool,
    /// Skips a calm wild animal (one that is no foe of the user): only where a target is picked, as for `skip_invisible`.
    pub skip_calm: bool,
    /// The damage split of the attack, if it deals damage: a bodiless creature that fully resists it is passed
    /// through (`Skip::Bodiless`) and gets nothing from it. `None` for a rule that only applies effects.
    pub passes: Option<DamageSplit>,
}

/// Is `c`, standing at `pos`, a target of `rule` for a user of `side`? `hit` are those already hit. The
/// checks are a plain conjunction; the line of sight, which costs most, comes last.
pub fn check(run: &Run, user: &Stance, c: Creature, pos: Vec2, rule: &Rule, hit: &[Creature]) -> Result<(), Skip> {
    let (alive, radius, hiding, dormant, airborne) = match c {
        Creature::Player(i) => (run.players[i].alive, PLAYER_RADIUS, false, false, false),
        Creature::Monster(i) => {
            let m = &run.monsters[i];
            // A sinking Friendly monster is no target of the Hostile, and a sinking wild animal is no one's.
            let sinks_out = m.sinking.is_some() && (m.wild.is_some() || user.side == Side::Hostile && m.side == Side::Friendly);
            (m.alive && !sinks_out, m.radius, m.hiding, m.dormant, m.airborne)
        }
    };
    if !alive {
        return Err(Skip::Dead);
    }
    let d = pos.dist(rule.at);
    let limit = if rule.plus_radius { rule.reach + radius } else { rule.reach };
    if !(d <= limit) {
        return Err(Skip::OutOfReach);
    }
    if let Some(arc) = rule.arc {
        let in_arc = angle_diff(rule.at.angle_to(pos), arc.aim).abs() <= arc.width / 2.0 || d < radius + arc.user_radius;
        if !in_arc {
            return Err(Skip::OutsideArc);
        }
    }
    // A Neutral creature is nobody's target, unless it is a wild animal (anyone may hit it). Then only a foe
    // of the user is picked on purpose, and any other is hit by an area or a swing.
    let their = stance(run, c);
    let wild = matches!(c, Creature::Monster(i) if run.monsters[i].wild.is_some());
    if their.side == Side::Neutral && !wild {
        return Err(Skip::Neutral);
    }
    if !fights(user, &their) {
        if !wild {
            return Err(Skip::Ally);
        }
        if rule.skip_calm {
            return Err(Skip::Neutral);
        }
    }
    if user.me == Some(c) {
        return Err(Skip::AlreadyHit);
    }
    if let Some(split) = &rule.passes {
        if run.passes_through(c, split) {
            return Err(Skip::Bodiless);
        }
    }
    if rule.skip_hiding && hiding {
        return Err(Skip::Hiding);
    }
    if rule.skip_invisible && run.has_effect(c, EffectKind::Invisible) {
        return Err(Skip::Invisible);
    }
    if rule.skip_dormant && dormant {
        return Err(Skip::Dormant);
    }
    if rule.skip_airborne && airborne {
        return Err(Skip::Airborne);
    }
    if hit.contains(&c) {
        return Err(Skip::AlreadyHit);
    }
    if rule.los && !line_of_sight(&run.layout.map, rule.at, pos) {
        return Err(Skip::NoLineOfSight);
    }
    Ok(())
}

/// Who a user may look at: the monsters (the heroes' side also meets its own allies here, to tell why they
/// are passed over), or, for the enemies, the heroes and then the allies and the wild animals and others
/// with a grudge against them. A Neutral user (a wild animal) looks at the heroes and every monster. Monsters
/// first by index for the heroes' side, as before.
fn candidates(run: &Run, user: &Stance) -> Vec<Creature> {
    match user.side {
        Side::Friendly => (0..run.monsters.len()).map(Creature::Monster).collect(),
        Side::Hostile => {
            let heroes = (0..run.players.len()).map(Creature::Player);
            let others = (0..run.monsters.len()).filter(|&mi| enemies_may_hit(&run.monsters[mi])).map(Creature::Monster);
            heroes.chain(others).collect()
        }
        Side::Neutral => (0..run.players.len()).map(Creature::Player).chain((0..run.monsters.len()).map(Creature::Monster)).collect(),
    }
}

/// The creatures that pass `check` with `pos_of` as their position (the foes of `side`: for the heroes
/// enemy monsters, for the monsters heroes and allies), and, only when `collect` is set (the log is on),
/// the others with their reason.
pub fn select(run: &Run, user: &Stance, rule: &Rule, hit: &[Creature], collect: bool, pos_of: impl Fn(Creature) -> Vec2) -> (Vec<Creature>, Vec<(Creature, Skip)>) {
    let (mut chosen, mut skips) = (Vec::new(), Vec::new());
    for c in candidates(run, user) {
        match check(run, user, c, pos_of(c), rule, hit) {
            Ok(()) => chosen.push(c),
            Err(why) if collect => skips.push((c, why)),
            Err(_) => {}
        }
    }
    (chosen, skips)
}

/// Adds `more` to `skips`, once per creature.
pub fn merge(skips: &mut Vec<(Creature, Skip)>, more: Vec<(Creature, Skip)>) {
    for s in more {
        if !skips.iter().any(|(c, _)| *c == s.0) {
            skips.push(s);
        }
    }
}

/// The nearest creature that would pass `rule` with twice its reach but is beyond its reach, and how far.
pub fn nearest_beyond(run: &Run, user: &Stance, rule: &Rule, hit: &[Creature]) -> Option<(Creature, f64)> {
    let wide = Rule { reach: 2.0 * rule.reach, ..*rule };
    let (near, _) = select(run, user, &wide, hit, false, |c| run.creature_pos(c));
    near.into_iter().map(|c| (c, run.creature_pos(c).dist(rule.at))).filter(|&(_, d)| d > rule.reach).min_by(|a, b| a.1.total_cmp(&b.1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::damage::{kind_split, Damage};
    use crate::defs::enemies::EnemyType;
    use crate::defs::kinds::EntityKind;
    use crate::protocol::{BossId, ClassId};
    use crate::run::abilities::explode;
    use crate::run::tests::test_run;

    /// A lone ranger, a wolf, a Hostile orc, and a Neutral orc beside the hero (indices of the last two).
    fn fixture() -> (Run, usize, usize, usize) {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let wolf = crate::run::wolf::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        let spot = run.players[0].pos();
        run.monsters[wi].pos = spot + Vec2::new(-30.0, 0.0);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, spot + Vec2::new(0.0, 100.0), None);
        let oi = run.monster_idx(id).unwrap();
        let id = run.spawn_enemy(EnemyType::OrcWarrior, spot + Vec2::new(12.0, 0.0), None);
        let ni = run.monster_idx(id).unwrap();
        run.monsters[ni].side = Side::Neutral;
        (run, wi, oi, ni)
    }

    fn rule(at: Vec2) -> Rule {
        Rule { at, reach: 60.0, plus_radius: true, arc: None, los: false, skip_hiding: false, skip_dormant: false, skip_airborne: false, skip_invisible: false, skip_calm: false, passes: None }
    }

    #[test]
    fn foes_table() {
        use Side::*;
        assert!(foes(Hostile, Friendly) && foes(Friendly, Hostile));
        for s in [Neutral, Hostile, Friendly] {
            assert!(!foes(Neutral, s) && !foes(s, Neutral));
        }
        assert!(!foes(Friendly, Friendly) && !foes(Hostile, Hostile));
    }

    #[test]
    fn side_reads_state() {
        let (mut run, wi, oi, ni) = fixture();
        assert_eq!(side(&run, Creature::Player(0)), Side::Friendly);
        assert_eq!(side(&run, Creature::Monster(wi)), Side::Friendly);
        assert_eq!(side(&run, Creature::Monster(oi)), Side::Hostile);
        assert_eq!(side(&run, Creature::Monster(ni)), Side::Neutral);
        run.monsters[oi].side = Side::Friendly;
        assert_eq!(side(&run, Creature::Monster(oi)), Side::Friendly);
    }

    #[test]
    fn neutral_is_never_a_target() {
        let (run, _, _, ni) = fixture();
        let neutral = Creature::Monster(ni);
        let r = rule(run.players[0].pos());
        for user in [Side::Friendly, Side::Hostile] {
            let (chosen, skips) = select(&run, &Stance::of_side(user), &r, &[], true, |c| run.creature_pos(c));
            assert!(!chosen.contains(&neutral), "{user:?} must not target it");
            if user == Side::Friendly {
                assert!(skips.contains(&(neutral, Skip::Neutral)), "{skips:?}");
            }
        }
    }

    #[test]
    fn neutral_is_untouchable() {
        use crate::defs::effects::EffectKind;
        use crate::run::effects::Creature as C;
        let (mut run, _, _, ni) = fixture();
        let hp = run.monsters[ni].hp;
        let dmg = || Damage::physical(5.0);
        assert!(!run.hurt_monster(ni, dmg(), false, Some(0)));
        assert!(!run.hurt_monster(ni, dmg(), false, None));
        assert_eq!(run.monsters[ni].hp, hp);
        assert!(!run.apply_effect_from(C::Monster(ni), EffectKind::Slowed, Some(5.0), 1, false));
        assert!(!run.monsters[ni].effects.has(EffectKind::Slowed));
        let from = run.monsters[ni].pos - Vec2::new(10.0, 0.0);
        run.knock_monster(ni, from, 30.0, 30);
        assert_eq!(run.monsters[ni].knock, Vec2::ZERO);
        run.monsters[ni].hp = hp - 1.0;
        assert_eq!(run.heal_monster(ni, 5.0, None), 0.0);
        assert_eq!(run.monsters[ni].hp, hp - 1.0);
        run.monsters[ni].hp = hp;
        let at = run.monsters[ni].pos;
        let fireball = Damage::new(10.0, kind_split(EntityKind::Fireball));
        explode(&mut run, at, 30.0, fireball, Side::Friendly, Some(0), 0, false, 20.0, 30);
        explode(&mut run, at, 30.0, dmg(), Side::Hostile, None, 4, false, 20.0, 30);
        assert_eq!(run.monsters[ni].hp, hp);
        assert_eq!(run.monsters[ni].knock, Vec2::ZERO);
    }

    #[test]
    fn enemy_ignores_neutral() {
        let (mut run, wi, oi, ni) = fixture();
        run.monsters[wi].alive = false;
        run.players[0].alive = false;
        run.monsters[oi].pos = run.monsters[ni].pos + Vec2::new(8.0, 0.0);
        assert_eq!(super::super::ai::find_visible_foe(&run, oi), None);
    }

    // ---- Wild animals: anyone may hit them, and a hit gives a grudge ----

    use crate::defs::abilities::AbilityId;
    use crate::defs::damage::What;

    /// Makes monster `mi` a calm wild animal.
    fn make_wild(run: &mut Run, mi: usize) {
        run.monsters[mi].side = Side::Neutral;
        run.monsters[mi].wild = Some(Wild { reaction: Reaction::FightBack, scare: None });
    }

    /// The fixture with the Neutral orc beside the hero made wild.
    fn wild_fixture() -> (Run, usize, usize, usize) {
        let (mut run, wi, oi, ni) = fixture();
        make_wild(&mut run, ni);
        (run, wi, oi, ni)
    }

    fn strike_by(run: &Run, mi: usize) -> Damage {
        Damage::physical(1.0).by(run.monsters[mi].id, What::Ability(AbilityId::Strike))
    }

    #[test]
    fn a_hero_hit_gives_a_grudge_against_the_heroes() {
        let (mut run, wi, _, ni) = wild_fixture();
        assert_eq!(run.monsters[ni].grudge, Grudge::default());
        assert!(run.hurt_monster(ni, Damage::physical(1.0), false, Some(0)));
        assert_eq!(run.monsters[ni].grudge, Grudge { heroes: true, enemies: false });
        // The wolf's hit counts as the heroes' too, through its `by` or through the hero it pays.
        let (mut run, wi2, _, ni) = wild_fixture();
        assert_eq!(wi, wi2);
        let bite = Damage::physical(1.0).by(run.monsters[wi].id, What::Ability(AbilityId::Bite));
        run.hurt_monster(ni, bite.clone(), false, None);
        assert_eq!(run.monsters[ni].grudge, Grudge { heroes: true, enemies: false });
        let (mut run, wi, _, ni) = wild_fixture();
        crate::run::abilities::hurt(&mut run, Creature::Monster(ni), bite, false, Creature::Monster(wi));
        assert_eq!(run.monsters[ni].grudge, Grudge { heroes: true, enemies: false });
        // So does the knight's: a Friendly monster that is not the wolf.
        let (mut run, _, oi, ni) = wild_fixture();
        run.monsters[oi].side = Side::Friendly;
        run.hurt_monster(ni, strike_by(&run, oi), false, None);
        assert_eq!(run.monsters[ni].grudge, Grudge { heroes: true, enemies: false });
    }

    #[test]
    fn an_enemy_hit_gives_a_grudge_against_the_enemies() {
        let (mut run, _, oi, ni) = wild_fixture();
        assert!(run.hurt_monster(ni, strike_by(&run, oi), false, None));
        assert_eq!(run.monsters[ni].grudge, Grudge { heroes: false, enemies: true });
    }

    #[test]
    fn both_hits_give_both() {
        let (mut run, _, oi, ni) = wild_fixture();
        run.hurt_monster(ni, strike_by(&run, oi), false, None);
        run.hurt_monster(ni, Damage::physical(1.0), false, Some(0));
        assert_eq!(run.monsters[ni].grudge, Grudge { heroes: true, enemies: true });
    }

    #[test]
    fn only_a_wild_animal_gets_a_grudge() {
        let (mut run, _, oi, ni) = fixture();
        run.hurt_monster(oi, Damage::physical(1.0), false, Some(0));
        assert_eq!(run.monsters[oi].grudge, Grudge::default());
        assert!(!run.hurt_monster(ni, Damage::physical(1.0), false, Some(0)));
        assert_eq!(run.monsters[ni].grudge, Grudge::default(), "the knight takes nothing");
    }

    #[test]
    fn a_barrel_a_hero_lit_and_a_burn_tick_count_as_hits_but_lava_does_not() {
        use crate::defs::effects::{EffectKind, EffectLook};
        use crate::run::effects::Apply;
        use crate::run::objects::{Barrel, ObjState};
        // A barrel lit by the hero.
        let (mut run, _, _, ni) = wild_fixture();
        let hero = run.players[0].id;
        let at = run.monsters[ni].pos + Vec2::new(10.0, 0.0);
        let hp = run.monsters[ni].hp;
        let lit = Barrel { igniter: Some(hero), ..Barrel::new() };
        run.spawn_object(crate::defs::kinds::EntityKind::Barrel, at, ObjState::Barrel(lit));
        let oi = run.objects.len() - 1;
        crate::run::objects::explode_barrel(&mut run, oi);
        assert!(run.monsters[ni].hp < hp, "the blast hurt the animal");
        assert_eq!(run.monsters[ni].grudge, Grudge { heroes: true, enemies: false });
        // A burn a hero set, and one an enemy set.
        for (by_enemy, want) in [(false, Grudge { heroes: true, enemies: false }), (true, Grudge { heroes: false, enemies: true })] {
            let (mut run, _, oi, ni) = wild_fixture();
            let from = if by_enemy { run.monsters[oi].id } else { run.players[0].id };
            let burn = Apply { kind: EffectKind::Burning, secs: Some(5.0), power: Some(10), magical: false, look: EffectLook::Plain, source: Some((from, Vec2::ZERO)), origin: None };
            assert!(run.apply(Creature::Monster(ni), burn), "a wild animal takes effects");
            assert_eq!(run.monsters[ni].grudge, Grudge::default(), "applying it is no hit");
            let hp = run.monsters[ni].hp;
            for _ in 0..240 {
                run.tick_effects();
            }
            assert!(run.monsters[ni].hp < hp, "the burn ticked");
            assert_eq!(run.monsters[ni].grudge, want, "by_enemy {by_enemy}");
        }
        // Lava has no `by`.
        let (mut run, _, _, ni) = wild_fixture();
        let lava = Damage { why: crate::defs::damage::Why { what: What::Lava, ..crate::defs::damage::Why::NONE }, ..Damage::physical(1.0) };
        let hp = run.monsters[ni].hp;
        assert!(run.hurt_monster(ni, lava, false, None));
        assert!(run.monsters[ni].hp < hp);
        assert_eq!(run.monsters[ni].grudge, Grudge::default());
    }

    #[test]
    fn an_area_attack_hits_the_animal_and_spares_the_knight_beside_it() {
        let (mut run, _, _, ni) = wild_fixture();
        let spot = run.monsters[ni].pos;
        let id = run.spawn_enemy(EnemyType::Knight, spot + Vec2::new(6.0, 0.0), None);
        let ki = run.monster_idx(id).unwrap();
        run.monsters[ki].side = Side::Neutral;
        let (animal_hp, knight_hp) = (run.monsters[ni].hp, run.monsters[ki].hp);
        explode(&mut run, spot, 30.0, Damage::physical(5.0), Side::Friendly, Some(0), 0, false, 20.0, 30);
        assert!(run.monsters[ni].hp < animal_hp, "the animal is hit");
        assert!(run.monsters[ni].knock != Vec2::ZERO, "and pushed");
        assert_eq!(run.monsters[ki].hp, knight_hp, "the knight is spared");
        assert_eq!(run.monsters[ki].knock, Vec2::ZERO);
        // An enemy's blast hits both kinds of Neutral the same way.
        let (animal_hp, knight_hp) = (run.monsters[ni].hp, run.monsters[ki].hp);
        explode(&mut run, spot, 30.0, Damage::physical(5.0), Side::Hostile, None, 4, false, 20.0, 30);
        assert!(run.monsters[ni].hp < animal_hp);
        assert_eq!(run.monsters[ki].hp, knight_hp);
    }

    #[test]
    fn effects_and_pushes_reach_a_wild_animal_but_never_the_knight() {
        use crate::defs::effects::EffectKind;
        use crate::run::effects::Creature as C;
        let (mut run, _, _, ni) = wild_fixture();
        assert!(run.apply_effect_from(C::Monster(ni), EffectKind::Slowed, Some(5.0), 1, false));
        assert!(run.monsters[ni].effects.has(EffectKind::Slowed));
        let from = run.monsters[ni].pos - Vec2::new(10.0, 0.0);
        run.knock_monster(ni, from, 30.0, 30);
        assert!(run.monsters[ni].knock != Vec2::ZERO);
        // A heal still refuses any Neutral.
        run.monsters[ni].hp -= 1.0;
        assert_eq!(run.heal_monster(ni, 5.0, None), 0.0);
        // The knight beside it takes none of it (`neutral_is_untouchable` covers every source).
        let (mut run, _, _, ni) = fixture();
        assert!(!run.apply_effect_from(C::Monster(ni), EffectKind::Slowed, Some(5.0), 1, false));
        let from = run.monsters[ni].pos - Vec2::new(10.0, 0.0);
        run.knock_monster(ni, from, 30.0, 30);
        assert_eq!(run.monsters[ni].knock, Vec2::ZERO);
    }

    #[test]
    fn heroes_shots_and_dashes_hit_a_calm_animal() {
        use crate::run::abilities::{dash_contact, tick_projectiles, try_use};
        let (mut run, _, _, ni) = wild_fixture();
        run.monsters[ni].pos = run.players[0].pos() + Vec2::new(120.0, 0.0);
        let hp = run.monsters[ni].hp;
        run.players[0].aim = 0.0;
        try_use(&mut run, 0, true, 1);
        for _ in 0..90 {
            tick_projectiles(&mut run, 1.0 / crate::run::TICK_HZ);
        }
        assert!(run.monsters[ni].hp < hp, "the arrow hit it");
        assert!(run.monsters[ni].grudge.heroes);
        // A dash.
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let id = run.spawn_enemy(EnemyType::OrcWarrior, run.players[0].pos() + Vec2::new(6.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        make_wild(&mut run, mi);
        let hp = run.monsters[mi].hp;
        dash_contact(&mut run, Creature::Player(0));
        assert!(run.monsters[mi].hp < hp, "the dash hit it");
        assert!(run.monsters[mi].grudge.heroes);
    }

    #[test]
    fn chain_spark_skips_a_calm_animal() {
        let (mut run, _, _, ni) = wild_fixture();
        let animal = Creature::Monster(ni);
        let user = stance(&run, Creature::Player(0));
        let pick = Rule { skip_calm: true, ..rule(run.players[0].pos()) };
        let (chosen, skips) = select(&run, &user, &pick, &[], true, |c| run.creature_pos(c));
        assert!(!chosen.contains(&animal) && skips.contains(&(animal, Skip::Neutral)), "{skips:?}");
        // An area or a swing (no `skip_calm`) still hits it.
        let (chosen, _) = select(&run, &user, &rule(run.players[0].pos()), &[], false, |c| run.creature_pos(c));
        assert!(chosen.contains(&animal));
        // One with a grudge against the heroes is a foe: picked.
        run.monsters[ni].grudge.heroes = true;
        let (chosen, _) = select(&run, &user, &pick, &[], false, |c| run.creature_pos(c));
        assert!(chosen.contains(&animal));
        // It is not its own target.
        let me = stance(&run, animal);
        let (chosen, _) = select(&run, &me, &rule(run.monsters[ni].pos), &[], false, |c| run.creature_pos(c));
        assert!(!chosen.contains(&animal));
    }

    #[test]
    fn enemies_ignore_a_calm_animal_but_fight_one_with_a_grudge_against_them() {
        let (mut run, wi, oi, ni) = wild_fixture();
        run.monsters[wi].alive = false;
        run.players[0].alive = false;
        run.monsters[oi].pos = run.monsters[ni].pos + Vec2::new(8.0, 0.0);
        let find = |run: &Run, mi| super::super::ai::find_visible_foe(run, mi);
        assert_eq!(find(&run, oi), None);
        run.monsters[ni].grudge.heroes = true;
        assert_eq!(find(&run, oi), None, "a grudge against the heroes is no quarrel with the enemies");
        run.monsters[ni].grudge.enemies = true;
        assert_eq!(find(&run, oi), Some(Creature::Monster(ni)));
        // The animal sees the enemy as its foe, and ignores a hero it holds no grudge against.
        run.monsters[ni].grudge.heroes = false;
        run.players[0].alive = true;
        assert_eq!(find(&run, ni), Some(Creature::Monster(oi)));
        run.monsters[ni].grudge.enemies = false;
        assert_eq!(find(&run, ni), None);
        run.monsters[ni].grudge.heroes = true;
        assert_eq!(find(&run, ni), Some(Creature::Player(0)));
    }

    #[test]
    fn companions_pick_an_animal_with_a_grudge_against_the_heroes_as_prey_never_a_calm_one() {
        use crate::defs::companions::WOLF_ESCORT;
        let (mut run, wi, oi, ni) = wild_fixture();
        run.monsters[oi].alive = false;
        let hero = run.players[0].pos();
        run.monsters[wi].pos = hero;
        run.monsters[ni].pos = hero + Vec2::new(20.0, 0.0);
        assert_eq!(crate::run::companion::find_prey(&run, wi, hero, &WOLF_ESCORT), None, "a calm one");
        run.monsters[ni].grudge.enemies = true;
        assert_eq!(crate::run::companion::find_prey(&run, wi, hero, &WOLF_ESCORT), None, "a grudge against the enemies only");
        run.monsters[ni].grudge.heroes = true;
        assert_eq!(crate::run::companion::find_prey(&run, wi, hero, &WOLF_ESCORT), Some(ni));
    }

    #[test]
    fn a_wild_animal_cannot_be_recruited() {
        let (mut run, _, _, ni) = wild_fixture();
        assert!(!crate::run::companion::recruit(&mut run, 0));
        assert_eq!(run.monsters[ni].side, Side::Neutral);
        assert!(run.monsters[ni].companion.is_none());
        run.monsters[ni].wild = None;
        assert!(crate::run::companion::recruit(&mut run, 0), "control: the knight can");
    }

    #[test]
    fn fights_is_the_side_table_plus_grudges() {
        let st = |side, heroes, enemies| Stance { side, grudge: Grudge { heroes, enemies }, me: None };
        let (hero, enemy, calm) = (st(Side::Friendly, false, false), st(Side::Hostile, false, false), st(Side::Neutral, false, false));
        assert!(fights(&hero, &enemy) && !fights(&hero, &calm) && !fights(&enemy, &calm));
        let hates_heroes = st(Side::Neutral, true, false);
        assert!(fights(&hates_heroes, &hero) && fights(&hero, &hates_heroes), "both directions");
        assert!(!fights(&hates_heroes, &enemy));
        let hates_both = st(Side::Neutral, true, true);
        assert!(fights(&hates_both, &hero) && fights(&enemy, &hates_both));
        assert!(!fights(&hates_both, &calm));
    }
}
