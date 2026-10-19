//! The character sheet: every number of a hero or monster, resolved from its
//! class or stat block and its Attributes. At the start Attributes each number
//! equals today's `defs` value bit for bit (see `defs::attributes::Scaled`);
//! each Attribute point above or below moves it. The simulation reads heroes
//! and monsters from here.

use crate::defs::abilities::{self as ab, AbilityDef, AbilityId, Scaling};
use crate::defs::attributes::{self, Attr, Attributes, Scaled, CON_MOVE};
use crate::defs::bosses::{self, hp_scale};
use crate::defs::classes;
use crate::defs::companions::{wolf_base_hp, WOLF_ATTRS, WOLF_SPEED, WOLF_WEIGHT};
use crate::defs::damage::{DamageSplit, Resistances};
use crate::defs::effects::EffectResponses;
use crate::defs::enemies::{self, EnemyType};
use crate::defs::progression::{Modifiers, StatUpgrades};
use crate::defs::races::Sight;
use crate::protocol::{BossId, ClassId};
use serde::Serialize;
use ts_rs::TS;

/// An ability with its numbers resolved for one hero.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct ResolvedAbility {
    pub id: AbilityId,
    pub cooldown: f64,
    pub damage: f64,
    pub range: f64,
    pub arc: f64,
    pub speed: f64,
    pub radius: f64,
    pub duration: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct Sheet {
    /// Class + race + `extra`.
    pub attrs: Attributes,
    pub max_hp: f64,
    pub speed: f64,
    pub weight: f64,
    pub res: Resistances,
    pub responses: EffectResponses,
    pub melee: DamageSplit,
    pub sight: Sight,
    pub primary: ResolvedAbility,
    pub secondary: ResolvedAbility,
    /// The melee thrust of a ranged hero (the Elven Ranger's rapier); none for the others until plan 3.
    pub fallback: Option<ResolvedAbility>,
    /// Fraction of incoming damage blocked by the old armor upgrade (removed in plan 4).
    pub armor: f64,
}

/// Movement speed: `base` is the value at `ref_con`; CON moves it by `CON_MOVE` per point.
fn move_speed(base: f64, ref_con: i32, attrs: &Attributes) -> f64 {
    Scaled { value: base, attr: Attr::Con, pct: CON_MOVE, at: ref_con }.get(attrs)
}

/// One ability for a hero with `attrs`; the reference Attributes are the owner class's start values.
fn resolve(d: AbilityDef, s: Scaling, attrs: &Attributes, reference: &Attributes, m: &Modifiers) -> ResolvedAbility {
    let get = |value: f64, sc: Option<(Attr, f64)>| match sc {
        Some((attr, pct)) => Scaled { value, attr, pct, at: reference.get(attr) }.get(attrs),
        None => value,
    };
    let cooldown = match s.speed {
        Some((attr, pct)) => Scaled { value: d.cooldown, attr, pct, at: reference.get(attr) }.per(attrs),
        None => d.cooldown,
    };
    ResolvedAbility {
        id: d.id,
        cooldown: cooldown / m.attack_speed,
        // The damage upgrade never touched heals.
        damage: get(d.damage, s.damage) * if d.id == AbilityId::Heal { 1.0 } else { m.damage },
        range: get(d.range, s.reach),
        arc: get(d.arc, s.arc),
        speed: get(d.speed, s.reach),
        radius: d.radius,
        duration: d.duration,
    }
}

/// The sheet of a hero: `extra` is the shop, tree and item points on top of the start Attributes.
pub fn hero_sheet(class: ClassId, extra: Attributes, up: &StatUpgrades) -> Sheet {
    let def = classes::def(class);
    let start = classes::start_attrs(class);
    let attrs = start.plus(extra);
    let m = up.modifiers();
    let prof = classes::profile(class);
    let ability = |id: AbilityId| resolve(ab::def(id), ab::scaling(id), &attrs, &classes::start_attrs(ab::owner(id)), &m);
    let fallback = (class == ClassId::ElvenRanger).then(|| {
        let thrust = AbilityDef {
            id: AbilityId::CrossbowDagger,
            cooldown: ab::DAGGER_COOLDOWN,
            damage: ab::DAGGER_DAMAGE,
            range: ab::DAGGER_RANGE,
            arc: 0.0,
            speed: 0.0,
            radius: 0.0,
            duration: 0.0,
        };
        resolve(thrust, ab::DAGGER_SCALING, &attrs, &start, &m)
    });
    Sheet {
        attrs,
        max_hp: attributes::hp(def.base_hp, attrs.get(Attr::Con)) * m.life,
        speed: move_speed(def.speed, start.get(Attr::Con), &attrs) * m.move_speed,
        weight: def.weight,
        res: prof.res,
        responses: classes::responses(class),
        melee: prof.melee,
        sight: prof.sight,
        primary: ability(def.primary),
        secondary: ability(def.secondary),
        fallback,
        armor: m.armor,
    }
}

/// The numbers a monster's spawn reads.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MonsterStats {
    pub attrs: Attributes,
    pub weight: f64,
    pub max_hp: f64,
    pub speed: f64,
}

/// Enemy stats for a party of `party` players (the same HP scaling the run applies).
pub fn enemy_stats(t: EnemyType, party: usize) -> MonsterStats {
    let d = enemies::def(t);
    let con = d.attrs.get(Attr::Con);
    MonsterStats {
        attrs: d.attrs,
        weight: d.weight,
        max_hp: attributes::hp(enemies::base_hp(t), con) * enemies::party_hp_scale(party),
        speed: move_speed(d.speed, con, &d.attrs),
    }
}

/// Boss stats for a party of `party` players.
pub fn boss_stats(b: BossId, party: usize) -> MonsterStats {
    let d = bosses::def(b);
    let con = d.attrs.get(Attr::Con);
    // The boss HP is the total; take the CON bonus out and put it back.
    let base = d.hp - attributes::CON_HP * (con - attributes::BASELINE) as f64;
    MonsterStats { attrs: d.attrs, weight: d.weight, max_hp: attributes::hp(base, con) * hp_scale(party), speed: move_speed(d.speed, con, &d.attrs) }
}

/// The Ranger's wolf: never scaled by party size.
pub fn wolf_stats() -> MonsterStats {
    let con = WOLF_ATTRS.get(Attr::Con);
    MonsterStats { attrs: WOLF_ATTRS, weight: WOLF_WEIGHT, max_hp: attributes::hp(wolf_base_hp(), con), speed: move_speed(WOLF_SPEED, con, &WOLF_ATTRS) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::abilities::{DAGGER_COOLDOWN, DAGGER_DAMAGE, DAGGER_RANGE};
    use crate::defs::companions::WOLF_HP;

    fn plus(a: Attr, n: i32) -> Attributes {
        let mut x = Attributes::default();
        x.add(a, n);
        x
    }

    fn same(r: &ResolvedAbility, d: &AbilityDef) {
        assert_eq!(r.id, d.id);
        assert_eq!(r.cooldown, d.cooldown, "{:?} cooldown", d.id);
        assert_eq!(r.damage, d.damage, "{:?} damage", d.id);
        assert_eq!(r.range, d.range, "{:?} range", d.id);
        assert_eq!(r.arc, d.arc, "{:?} arc", d.id);
        assert_eq!(r.speed, d.speed, "{:?} speed", d.id);
        assert_eq!(r.radius, d.radius, "{:?} radius", d.id);
        assert_eq!(r.duration, d.duration, "{:?} duration", d.id);
    }

    #[test]
    fn hero_sheet_reproduces_today() {
        for c in ClassId::ALL {
            let d = classes::def(c);
            let s = hero_sheet(c, Attributes::default(), &StatUpgrades::default());
            assert_eq!(s.max_hp, d.hp, "{c:?}");
            assert_eq!(s.speed, d.speed, "{c:?}");
            assert_eq!(s.weight, d.weight, "{c:?}");
            same(&s.primary, &ab::def(d.primary));
            same(&s.secondary, &ab::def(d.secondary));
            assert_eq!(s.armor, 0.0);
        }
        let r = hero_sheet(ClassId::ElvenRanger, Attributes::default(), &StatUpgrades::default());
        assert_eq!(r.attrs.get(Attr::Dex), 15);
        assert_eq!(
            r.fallback,
            Some(ResolvedAbility {
                id: AbilityId::CrossbowDagger,
                cooldown: DAGGER_COOLDOWN,
                damage: DAGGER_DAMAGE,
                range: DAGGER_RANGE,
                arc: 0.0,
                speed: 0.0,
                radius: 0.0,
                duration: 0.0
            })
        );
        assert!(hero_sheet(ClassId::Wizard, Attributes::default(), &StatUpgrades::default()).fallback.is_none());
    }

    #[test]
    fn attributes_move_the_numbers() {
        let up = StatUpgrades::default();
        let w = hero_sheet(ClassId::Wizard, plus(Attr::Int, 2), &up);
        assert!((w.primary.damage - 12.0 * 1.35 / 1.25).abs() < 1e-12);
        let b = hero_sheet(ClassId::Barbarian, plus(Attr::Dex, 2), &up);
        assert!((b.primary.cooldown - 0.8 / (1.10 / 1.06)).abs() < 1e-12);
        assert!((b.primary.arc - 2.45 * 1.15 / 1.09).abs() < 1e-12);
        let p = hero_sheet(ClassId::Paladin, plus(Attr::Con, 2), &up);
        assert_eq!(p.max_hp, 130.0);
        assert!((p.speed - 66.0 * 1.05 / 1.03).abs() < 1e-12);
    }

    #[test]
    fn upgrades_still_apply() {
        let up = StatUpgrades { damage: 2, attack_speed: 1, move_speed: 1, life: 1, armor: 1, ..Default::default() };
        let m = up.modifiers();
        let s = hero_sheet(ClassId::Paladin, Attributes::default(), &up);
        let sword = ab::def(AbilityId::Sword);
        assert_eq!(s.primary.damage, sword.damage * m.damage);
        assert_eq!(s.primary.cooldown, sword.cooldown / m.attack_speed);
        assert_eq!(s.speed, 66.0 * m.move_speed);
        assert_eq!(s.max_hp, 120.0 * m.life);
        assert_eq!(s.armor, m.armor);
        assert_eq!(s.secondary.damage, ab::def(AbilityId::Heal).damage, "the heal is no damage");
        // What the modifiers really give.
        assert!((m.damage - 1.16).abs() < 1e-12 && (m.attack_speed - 1.06).abs() < 1e-12);
        assert!((m.move_speed - 1.04).abs() < 1e-12 && (m.life - 1.10).abs() < 1e-12 && (m.armor - 0.04).abs() < 1e-12);
    }

    #[test]
    fn enemy_stats_reproduce_today() {
        for t in EnemyType::ALL {
            let d = enemies::def(t);
            for party in 1..=4 {
                let s = enemy_stats(t, party);
                // The run's own scaling (run/mod.rs spawn_enemy).
                assert_eq!(s.max_hp, d.hp * (0.75 + 0.25 * party as f64), "{t:?} x{party}");
                assert_eq!(s.speed, d.speed, "{t:?}");
                assert_eq!(s.weight, d.weight);
            }
        }
    }

    #[test]
    fn boss_stats_reproduce_today() {
        for b in BossId::ALL {
            let d = bosses::def(b);
            for party in 1..=4 {
                let s = boss_stats(b, party);
                // The run's own scaling (run/levels/boss.rs spawn).
                assert_eq!(s.max_hp, d.hp * (0.5 + 0.5 * party as f64), "{b:?} x{party}");
                assert_eq!(s.speed, d.speed, "{b:?}");
                assert_eq!(s.weight, 40.0);
            }
        }
    }

    #[test]
    fn wolf_stats_reproduce_today() {
        let s = wolf_stats();
        assert_eq!(s.max_hp, WOLF_HP);
        assert_eq!(s.speed, WOLF_SPEED);
        assert_eq!(s.weight, 10.0);
    }

    #[test]
    fn low_con_enemy_still_moves() {
        let block = Attributes::new(10, 10, -200, 10, 10, 10);
        assert!(move_speed(40.0, 12, &block) > 0.0);
    }
}
