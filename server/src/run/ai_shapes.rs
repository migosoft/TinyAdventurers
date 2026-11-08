//! The shared AI's rule for each ability `Shape`: when a creature (a monster in the chase today, a
//! charmed hero next) uses an ability on the foe it has picked. One rule per shape, written once;
//! `worth_using` matches every `Shape` with no `_` arm, so a new shape does not build until it has
//! a rule here. The numbers are first guesses (see "Balancing waits").

use super::ai::SWING_SLACK;
use super::effects::Creature;
use super::targets;
use super::Run;
use crate::collision::{line_of_sight, walk_line};
use crate::defs::abilities::{self as ab, Shape};
use crate::defs::classes::PLAYER_RADIUS;
use crate::dungeon::Mover;
use crate::math::Vec2;
use crate::sheet::ResolvedAbility;

/// A self-centred ability (Holy Light, Haste, Purify, Poison Coat) is cast when a foe is this near (px).
pub const SELF_AREA_NEAR: f64 = 96.0;

/// A summoned wolf below this share of its HP is worth healing (Summon Wolf heals a living one).
const WOLF_WORTH_HEALING: f64 = 0.6;

/// The distance (px) from which `a` can start against a foe of body radius `foe_radius`: a swing a
/// little inside its real reach, a ring from its radius, a dash from its travel (or its range), the
/// rest from their range. Movement follows the main ability's reach.
pub fn reach_of(a: &ResolvedAbility, foe_radius: f64) -> f64 {
    match ab::def(a.id).shape {
        Shape::Swing => a.range + foe_radius - SWING_SLACK,
        Shape::Ring => a.radius,
        Shape::Dash if a.range == 0.0 => a.speed * a.duration + foe_radius,
        _ => a.range,
    }
}

/// How far (px, from the centre of the user) the user's own melee reaches: a monster's first swing,
/// a hero's fallback strike; 0 when it has none.
fn melee_reach(run: &Run, user: Creature) -> f64 {
    match user {
        Creature::Player(pi) => run.players[pi].sheet.fallback.range,
        Creature::Monster(mi) => run.monsters[mi].kit.iter().find(|a| ab::def(a.id).shape == Shape::Swing).map_or(0.0, |a| a.range),
    }
}

/// How many creatures `user` fights (its side's foes, `targets::fights`) have their centre within `r` of it.
fn foes_within(run: &Run, user: Creature, r: f64) -> usize {
    let at = run.creature_pos(user);
    let me = targets::stance(run, user);
    let near = |c: Creature| c != user && run.creature_pos(c).dist(at) <= r && targets::fights(&me, &targets::stance(run, c));
    let heroes = (0..run.players.len()).map(Creature::Player).filter(|&c| run.creature_alive(c) && near(c)).count();
    let others = (0..run.monsters.len()).filter(|&mi| run.monsters[mi].sinking.is_none()).map(Creature::Monster).filter(|&c| run.creature_alive(c) && near(c)).count();
    heroes + others
}

/// Does the user carry the effect `a` applies by itself? Then casting it again is no use.
fn carries_own_effect(run: &Run, user: Creature, a: &ResolvedAbility) -> bool {
    a.effect.iter().any(|e| run.has_effect(user, e.kind))
}

/// Would a summon be cast now? A monster: its minions have room. A hero: no living wolf, or one below 60 % HP.
fn summon_has_use(run: &Run, user: Creature, a: &ResolvedAbility) -> bool {
    match user {
        Creature::Monster(mi) => super::minions::room(run, mi, a) > 0,
        Creature::Player(pi) => match run.players[pi].wolf.and_then(|id| run.monster_idx(id)).filter(|&wi| run.monsters[wi].alive) {
            None => true,
            Some(wi) => run.monsters[wi].hp < run.monsters[wi].max_hp * WOLF_WORTH_HEALING,
        },
    }
}

/// Is it worth `user` using `a` on `foe` now? Range and the shape's own sense only; cooldowns, wind-ups
/// and pacing stay with the caller. `main_ready` says whether the user's main ability is ready (a ring
/// is worth a single foe only while it is not).
pub fn worth_using(run: &Run, user: Creature, a: &ResolvedAbility, foe: Creature, main_ready: bool) -> bool {
    let map = &run.layout.map;
    let pos = run.creature_pos(user);
    let fpos = run.creature_pos(foe);
    let foe_radius = run.creature_radius(foe);
    let d = pos.dist(fpos);
    let seen = || line_of_sight(map, pos, fpos);
    let near = || d <= SELF_AREA_NEAR;
    match ab::def(a.id).shape {
        Shape::Swing => d <= reach_of(a, foe_radius),
        Shape::Projectile => d <= a.range && seen(),
        // As a projectile, but not with a foe in melee (a Wizard's "Too close").
        Shape::Blast => d <= a.range && seen() && d > melee_reach(run, user) + foe_radius,
        // Only creatures it fights count: a calm animal in the ring is no reason to slam. A slam is
        // worth it for two foes in reach, or one while the main ability recovers.
        Shape::Ring => {
            let n = foes_within(run, user, a.radius);
            n >= 2 || n == 1 && !main_ready
        }
        Shape::Dash => {
            let aim = pos.angle_to(fpos);
            let end = pos + Vec2::from_angle(aim) * (a.speed * a.duration);
            d <= reach_of(a, foe_radius) && walk_line(map, pos, end, Mover::Enemy)
        }
        Shape::GroundArea => {
            if a.range > 0.0 {
                d <= a.range
            } else {
                d <= a.radius
            }
        }
        Shape::SelfArea => near(),
        Shape::Buff => near() && !carries_own_effect(run, user, a),
        Shape::Summon => summon_has_use(run, user, a) && seen(),
        // The breath and the gaze belong to the bosses' own patterns, never to the generic chase.
        Shape::Breath | Shape::Gaze => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::abilities::AbilityId;
    use crate::defs::effects::EffectKind;
    use crate::defs::enemies::EnemyType;
    use crate::dungeon::{Map, Tile};
    use crate::protocol::{BossId, ClassId};
    use crate::run::ai::tests::open_floor;
    use crate::run::tests::test_run;
    use crate::sheet::{resolve_ability, Body};

    /// Hero 0 of `class` on open floor, alone with its enemy `OrcWarrior` `off` px east.
    fn scene(class: ClassId, off: f64) -> (Run, Creature, Creature) {
        let mut run = test_run(&[class], BossId::Lich);
        open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let at = run.players[0].pos();
        let id = run.spawn_enemy(EnemyType::OrcWarrior, at + Vec2::new(off, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        (run, Creature::Player(0), Creature::Monster(mi))
    }

    /// Ability `id` as hero 0 has it, with its melee and ranged weapons.
    fn hero_ability(run: &Run, id: AbilityId) -> ResolvedAbility {
        let s = &run.players[0].sheet;
        let weapons: Vec<_> = std::iter::once(s.melee.clone()).chain(s.ranged.clone()).collect();
        resolve_ability(&ab::def(id), &s.attrs, &weapons, Body { radius: PLAYER_RADIUS }).expect("resolvable")
    }

    #[test]
    fn every_shape_has_a_rule() {
        const SHAPES: [Shape; 11] = [
            Shape::Swing,
            Shape::Projectile,
            Shape::Blast,
            Shape::Ring,
            Shape::Dash,
            Shape::SelfArea,
            Shape::GroundArea,
            Shape::Buff,
            Shape::Summon,
            Shape::Breath,
            Shape::Gaze,
        ];
        let (run, user, foe) = scene(ClassId::ElvenRanger, 40.0);
        let mut seen = Vec::new();
        for id in AbilityId::ALL {
            let a = hero_ability(&run, id);
            let _ = worth_using(&run, user, &a, foe, true);
            seen.push(ab::def(id).shape);
        }
        for s in SHAPES {
            assert!(seen.contains(&s), "no ability of shape {s:?} in AbilityId::ALL, so its rule is untested");
        }
        // The two boss shapes are never used by the generic chase.
        for id in AbilityId::ALL {
            if matches!(ab::def(id).shape, Shape::Breath | Shape::Gaze) {
                assert!(!worth_using(&run, user, &hero_ability(&run, id), foe, true), "{id:?}");
            }
        }
    }

    #[test]
    fn a_swing_and_a_projectile_need_range() {
        let (run, user, foe) = scene(ClassId::ElvenRanger, 20.0);
        assert!(worth_using(&run, user, &hero_ability(&run, AbilityId::Strike), foe, true), "in reach");
        let (run, user, foe) = scene(ClassId::ElvenRanger, 400.0);
        assert!(!worth_using(&run, user, &hero_ability(&run, AbilityId::Strike), foe, true), "out of reach");
        let shoot = hero_ability(&run, AbilityId::Shoot);
        assert!(!worth_using(&run, user, &shoot, foe, true), "out of range ({})", shoot.range);
        let (mut run, user, foe) = scene(ClassId::ElvenRanger, 100.0);
        assert!(worth_using(&run, user, &hero_ability(&run, AbilityId::Shoot), foe, true), "in range, in the open");
        let (tx, ty) = Map::tile_of(run.players[0].pos() + Vec2::new(50.0, 0.0));
        run.layout.map.set(tx, ty, Tile::Wall);
        assert!(!worth_using(&run, user, &hero_ability(&run, AbilityId::Shoot), foe, true), "a wall in the line of fire");
    }

    #[test]
    fn a_ring_waits_for_two_foes_or_a_cooling_main() {
        let (mut run, user, foe) = scene(ClassId::Paladin, 20.0);
        let ring = hero_ability(&run, AbilityId::WarCry);
        assert_eq!(ab::def(AbilityId::WarCry).shape, Shape::Ring);
        assert!(!worth_using(&run, user, &ring, foe, true), "one foe, main ready: the main ability");
        assert!(worth_using(&run, user, &ring, foe, false), "one foe, main cooling: the ring");
        let at = run.players[0].pos();
        run.spawn_enemy(EnemyType::OrcWarrior, at + Vec2::new(-20.0, 5.0), None);
        assert!(worth_using(&run, user, &ring, foe, true), "two foes: the ring");
        let (run, user, foe) = scene(ClassId::Paladin, 300.0);
        assert!(!worth_using(&run, user, &hero_ability(&run, AbilityId::WarCry), foe, false), "nobody in the ring");
    }

    #[test]
    fn a_blast_is_not_cast_in_melee() {
        let (run, user, foe) = scene(ClassId::Wizard, 150.0);
        let ball = hero_ability(&run, AbilityId::Fireball);
        assert!(worth_using(&run, user, &ball, foe, true), "at range");
        let (run, user, foe) = scene(ClassId::Wizard, 20.0);
        assert!(!worth_using(&run, user, &ball, foe, true), "a foe in melee: the Wizard's Too close rule");
    }

    #[test]
    fn a_dash_needs_a_free_line() {
        let (mut run, user, foe) = scene(ClassId::Barbarian, 20.0);
        let charge = hero_ability(&run, AbilityId::Charge);
        assert!(worth_using(&run, user, &charge, foe, true), "open floor, foe in dash reach");
        let (tx, ty) = Map::tile_of(run.players[0].pos() + Vec2::new(40.0, 0.0));
        run.layout.map.set(tx, ty, Tile::Wall);
        assert!(!worth_using(&run, user, &charge, foe, true), "the dash would cross a wall");
        let (run, user, foe) = scene(ClassId::Barbarian, 300.0);
        assert!(!worth_using(&run, user, &charge, foe, true), "too far");
    }

    #[test]
    fn a_dash_does_not_land_in_a_chasm() {
        let (mut run, user, foe) = scene(ClassId::Barbarian, 20.0);
        let charge = hero_ability(&run, AbilityId::Charge);
        let end = run.players[0].pos() + Vec2::new(a_dash_len(&charge), 0.0);
        let (tx, ty) = Map::tile_of(end);
        run.layout.map.set(tx, ty, Tile::Chasm);
        assert!(!worth_using(&run, user, &charge, foe, true), "it would land in a chasm");
    }

    fn a_dash_len(a: &ResolvedAbility) -> f64 {
        a.speed * a.duration
    }

    #[test]
    fn consecrate_needs_a_foe_at_the_feet() {
        let (run, user, foe) = scene(ClassId::Paladin, 20.0);
        let c = hero_ability(&run, AbilityId::Consecrate);
        assert!(worth_using(&run, user, &c, foe, true), "a foe at the feet");
        let (run, user, foe) = scene(ClassId::Paladin, 200.0);
        assert!(!worth_using(&run, user, &c, foe, true), "a foe far from the feet");
    }

    #[test]
    fn entangle_is_aimed_in_range() {
        let (run, user, foe) = scene(ClassId::ElvenRanger, 100.0);
        let e = hero_ability(&run, AbilityId::Entangle);
        assert!(worth_using(&run, user, &e, foe, true), "in range");
        let (run, user, foe) = scene(ClassId::ElvenRanger, 300.0);
        assert!(!worth_using(&run, user, &e, foe, true), "out of range");
    }

    #[test]
    fn a_self_area_needs_a_foe_near() {
        let (run, user, foe) = scene(ClassId::Paladin, 60.0);
        let h = hero_ability(&run, AbilityId::HolyLight);
        assert!(worth_using(&run, user, &h, foe, true), "a foe near");
        let (run, user, foe) = scene(ClassId::Paladin, 250.0);
        assert!(!worth_using(&run, user, &h, foe, true), "no foe near");
    }

    #[test]
    fn poison_coat_is_not_recast_while_coated() {
        let (mut run, user, foe) = scene(ClassId::ElvenRanger, 60.0);
        let coat = hero_ability(&run, AbilityId::PoisonCoat);
        assert!(worth_using(&run, user, &coat, foe, true), "a foe near, not coated");
        run.apply_effect(user, EffectKind::Coated, Some(5.0));
        assert!(!worth_using(&run, user, &coat, foe, true), "already coated");
    }

    #[test]
    fn a_wolf_is_summoned_when_there_is_none_or_it_is_hurt() {
        let (mut run, user, foe) = scene(ClassId::ElvenRanger, 100.0);
        let s = hero_ability(&run, AbilityId::SummonWolf);
        assert!(worth_using(&run, user, &s, foe, true), "no wolf");
        let id = crate::run::wolf::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(id).unwrap();
        assert!(!worth_using(&run, user, &s, foe, true), "a healthy wolf");
        run.monsters[wi].hp = run.monsters[wi].max_hp * 0.5;
        assert!(worth_using(&run, user, &s, foe, true), "a hurt wolf is healed");
    }
}
