//! The character sheet: every number of a hero or monster, resolved from its
//! class or stat block and its Attributes. At the start Attributes each number
//! equals today's `defs` value bit for bit (see `defs::attributes::Scaled`);
//! each Attribute point above or below moves it. The simulation reads heroes
//! and monsters from here.

use crate::defs::abilities::{self as ab, AbilityDef, AbilityId, Scaling};
use crate::defs::attributes::{self, Attr, Attributes, Scaled, CON_MOVE};
use crate::defs::bosses;
use crate::defs::classes;
use crate::defs::companions::{wolf_base_hp, WOLF_ATTRS, WOLF_SPEED, WOLF_WEIGHT};
use crate::defs::damage::{DamageType, Resistances};
use crate::defs::effects::{EffectResistances, OnHit};
use crate::defs::enemies::{self, EnemyType};
use crate::defs::items::{self, EquipSlot, Equipment, ItemBase, ItemId, PropKind};
use crate::defs::lights::{self, LightKind};
use crate::defs::progression::{Modifiers, StatUpgrades};
use crate::defs::races::Sight;
use crate::defs::weapons::{resolve_melee, resolve_ranged, ResolvedWeapon};
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
    /// Class + race + `extra` + item points.
    pub attrs: Attributes,
    pub max_hp: f64,
    pub speed: f64,
    pub weight: f64,
    pub res: Resistances,
    pub effect_res: EffectResistances,
    /// The Melee slot's weapon, or the class starter.
    pub melee: ResolvedWeapon,
    /// The Ranged slot's weapon, or the class starter (none for the classes without one).
    pub ranged: Option<ResolvedWeapon>,
    /// The light of the worn item with the largest radius.
    #[allow(dead_code)] // plan 2, task 5 (the run carries it)
    pub light: Option<LightKind>,
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

/// A weapon item for one wielder, with the shares and on-hit its own properties gave it.
fn arm(id: ItemId, attrs: &Attributes, shares: &[(DamageType, f64)], on_hit: Option<OnHit>) -> ResolvedWeapon {
    let w = match items::def(id).base {
        ItemBase::Melee(k, s) => resolve_melee(k, &s, attrs),
        ItemBase::Ranged(k, s) => resolve_ranged(k, &s, attrs),
        b => panic!("{id:?} is not a weapon: {b:?}"),
    };
    ResolvedWeapon { split: w.split.with_shares(shares), on_hit: on_hit.map(|h| OnHit { power: w.power, ..h }), ..w }
}

/// The sheet of a hero: `extra` is the shop and tree points on top of the start
/// Attributes. `equip` must be valid for the class (`items::check_equipment`);
/// an empty weapon slot uses the class's starter.
pub fn hero_sheet(class: ClassId, extra: Attributes, equip: &Equipment, up: &StatUpgrades) -> Sheet {
    let def = classes::def(class);
    let start = classes::start_attrs(class);
    let unequipped = start.plus(extra);
    debug_assert!(items::check_equipment(class, equip, &unequipped).is_ok(), "{class:?}: {:?}", items::check_equipment(class, equip, &unequipped));
    let m = up.modifiers();
    let prof = classes::profile(class);

    // The worn items, with the starters in empty weapon slots.
    let (starter_melee, starter_ranged) = def.starter;
    let worn: Vec<(EquipSlot, ItemId)> = EquipSlot::ALL
        .iter()
        .filter_map(|&s| {
            let id = match s {
                EquipSlot::Melee => Some(equip.get(s).unwrap_or(starter_melee)),
                EquipSlot::Ranged => equip.get(s).or(starter_ranged),
                _ => equip.get(s),
            };
            id.map(|id| (s, id))
        })
        .collect();

    // Armor bases first, then the properties (spec §10).
    let mut res = prof.res;
    let mut weight = def.weight;
    for &(_, id) in &worn {
        if let ItemBase::Armor(a) = items::def(id).base {
            res.set(DamageType::Physical, res.get(DamageType::Physical) + a.physical);
            weight += a.weight;
        }
    }
    let mut attrs = unequipped;
    let mut effect_res = prof.effect_res;
    let (mut move_frac, mut bonus_hp) = (0.0, 0.0);
    let mut light: Option<LightKind> = None;
    // Index 0: the melee weapon, 1: the ranged one.
    let mut shares: [Vec<(DamageType, f64)>; 2] = Default::default();
    let mut on_hits: [Option<OnHit>; 2] = [None, None];
    for &(slot, id) in &worn {
        let weapon = match slot {
            EquipSlot::Melee => Some(0),
            EquipSlot::Ranged => Some(1),
            _ => None,
        };
        for p in items::def(id).props {
            match p.kind {
                PropKind::Attr(a, n) => attrs.add(a, n),
                PropKind::Resist(t, v) => res.set(t, res.get(t) + v),
                PropKind::EffectResist(k, v) => effect_res.set(k, effect_res.get(k) + v),
                PropKind::Weight(w) => weight += w,
                PropKind::MoveSpeed(f) => move_frac += f,
                PropKind::MaxHp(hp) => bonus_hp += hp,
                PropKind::Light(k) => {
                    if light.is_none_or(|l| lights::def(k).radius > lights::def(l).radius) {
                        light = Some(k);
                    }
                }
                // Weapon-only (a data test refuses them elsewhere): they go to their own weapon.
                PropKind::DamageShare(t, v) => {
                    if let Some(i) = weapon {
                        shares[i].push((t, v));
                    }
                }
                PropKind::OnHit(h) => {
                    if let Some(i) = weapon {
                        on_hits[i] = Some(OnHit { magical: p.magical, ..h });
                    }
                }
            }
        }
    }
    let melee_id = worn.iter().find(|w| w.0 == EquipSlot::Melee).map(|w| w.1).expect("a hero always has a melee weapon");
    let melee = arm(melee_id, &attrs, &shares[0], on_hits[0]);
    let ranged = worn.iter().find(|w| w.0 == EquipSlot::Ranged).map(|w| arm(w.1, &attrs, &shares[1], on_hits[1]));

    // Abilities: the weapon ones take the weapon's numbers (interim until plan 3); the old upgrades multiply after.
    let ability = |id: AbilityId| {
        let r = resolve(ab::def(id), ab::scaling(id), &attrs, &classes::start_attrs(ab::owner(id)), &m);
        match id {
            AbilityId::Sword | AbilityId::Axe => {
                ResolvedAbility { damage: melee.damage * m.damage, cooldown: melee.cooldown / m.attack_speed, arc: melee.arc, ..r }
            }
            AbilityId::CrossbowDagger => {
                let w = ranged.expect("the crossbow needs a ranged weapon");
                ResolvedAbility {
                    damage: w.damage * m.damage,
                    cooldown: w.cooldown / m.attack_speed,
                    range: w.range,
                    speed: w.projectile_speed,
                    radius: w.radius,
                    ..r
                }
            }
            AbilityId::MagicMissile | AbilityId::Fireball | AbilityId::Heal | AbilityId::Dash | AbilityId::SummonWolf => r,
        }
    };
    let fallback = (class == ClassId::ElvenRanger).then(|| ResolvedAbility {
        id: AbilityId::CrossbowDagger,
        cooldown: melee.cooldown / m.attack_speed,
        damage: melee.damage * m.damage,
        range: ab::DAGGER_RANGE,
        arc: 0.0,
        speed: 0.0,
        radius: 0.0,
        duration: 0.0,
    });
    Sheet {
        attrs,
        max_hp: (attributes::hp(def.base_hp, attrs.get(Attr::Con)) + bonus_hp) * m.life,
        speed: move_speed(def.speed, start.get(Attr::Con), &attrs) * (1.0 + move_frac) * m.move_speed,
        weight,
        res,
        effect_res,
        melee,
        ranged,
        light,
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

/// Enemy stats. HP does not depend on the party size (TODO 4b).
pub fn enemy_stats(t: EnemyType) -> MonsterStats {
    let d = enemies::def(t);
    let con = d.attrs.get(Attr::Con);
    MonsterStats {
        attrs: d.attrs,
        weight: d.weight,
        max_hp: attributes::hp(enemies::base_hp(t), con),
        speed: move_speed(d.speed, con, &d.attrs),
    }
}

/// Boss stats. HP does not depend on the party size (TODO 4b).
pub fn boss_stats(b: BossId) -> MonsterStats {
    let d = bosses::def(b);
    let con = d.attrs.get(Attr::Con);
    // The boss HP is the total; take the CON bonus out and put it back.
    let base = d.hp - attributes::CON_HP * (con - attributes::BASELINE) as f64;
    MonsterStats { attrs: d.attrs, weight: d.weight, max_hp: attributes::hp(base, con), speed: move_speed(d.speed, con, &d.attrs) }
}

/// The Ranger's wolf.
pub fn wolf_stats() -> MonsterStats {
    let con = WOLF_ATTRS.get(Attr::Con);
    MonsterStats { attrs: WOLF_ATTRS, weight: WOLF_WEIGHT, max_hp: attributes::hp(wolf_base_hp(), con), speed: move_speed(WOLF_SPEED, con, &WOLF_ATTRS) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::abilities::DAGGER_RANGE;
    use crate::defs::attributes::{factor, STR_DMG};
    use crate::defs::damage::DamageSplit;
    use crate::defs::effects::EffectKind;
    use crate::defs::kinds::EntityKind;
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
            let s = hero_sheet(c, Attributes::default(), &Equipment::starter(c), &StatUpgrades::default());
            assert_eq!(s.max_hp, d.hp, "{c:?}");
            assert_eq!(s.speed, d.speed, "{c:?}");
            assert_eq!(s.weight, d.weight, "{c:?}");
            same(&s.primary, &ab::def(d.primary));
            same(&s.secondary, &ab::def(d.secondary));
            assert_eq!(s.armor, 0.0);
            assert_eq!(s.melee.split, DamageSplit::physical(), "{c:?}");
            assert_eq!(s.light, None, "{c:?}");
            assert_eq!(s.res, classes::profile(c).res, "{c:?}");
        }
        let r = hero_sheet(ClassId::ElvenRanger, Attributes::default(), &Equipment::starter(ClassId::ElvenRanger), &StatUpgrades::default());
        assert_eq!(r.attrs.get(Attr::Dex), 15);
        assert_eq!(
            r.fallback,
            Some(ResolvedAbility {
                id: AbilityId::CrossbowDagger,
                cooldown: 0.35,
                damage: 18.0,
                range: DAGGER_RANGE,
                arc: 0.0,
                speed: 0.0,
                radius: 0.0,
                duration: 0.0
            })
        );
        assert_eq!(r.ranged.unwrap().projectile, Some(EntityKind::Bolt));
        assert!(hero_sheet(ClassId::Wizard, Attributes::default(), &Equipment::starter(ClassId::Wizard), &StatUpgrades::default()).fallback.is_none());
    }

    #[test]
    fn attributes_move_the_numbers() {
        let up = StatUpgrades::default();
        let w = hero_sheet(ClassId::Wizard, plus(Attr::Int, 2), &Equipment::starter(ClassId::Wizard), &up);
        assert!((w.primary.damage - 12.0 * 1.35 / 1.25).abs() < 1e-12);
        let b = hero_sheet(ClassId::Barbarian, plus(Attr::Dex, 2), &Equipment::starter(ClassId::Barbarian), &up);
        assert!((b.primary.cooldown - 0.8 / (1.10 / 1.06)).abs() < 1e-12);
        assert!((b.primary.arc - 2.45 * 1.15 / 1.09).abs() < 1e-12);
        let p = hero_sheet(ClassId::Paladin, plus(Attr::Con, 2), &Equipment::starter(ClassId::Paladin), &up);
        assert_eq!(p.max_hp, 130.0);
        assert!((p.speed - 66.0 * 1.05 / 1.03).abs() < 1e-12);
    }

    #[test]
    fn attributes_move_the_ranger_numbers() {
        let up = StatUpgrades::default();
        // The ranger starts at DEX 15 (class 13 + Elf 2) and STR 10.
        let dex = hero_sheet(ClassId::ElvenRanger, plus(Attr::Dex, 2), &Equipment::starter(ClassId::ElvenRanger), &up);
        let bow = dex.primary;
        assert!((bow.damage - 16.0 * 1.35 / 1.25).abs() < 1e-12, "crossbow damage by DEX");
        assert!((bow.cooldown - 0.7 / (1.14 / 1.10)).abs() < 1e-12, "firing speed by DEX");
        assert_eq!((bow.range, bow.speed), (260.0, 290.0), "DEX does not move the reach");
        let thrust = dex.fallback.expect("the ranger has a rapier thrust");
        assert!((thrust.damage - 18.0 * 1.35 / 1.25).abs() < 1e-12, "rapier damage by DEX");
        assert!((thrust.cooldown - 0.35 / (1.14 / 1.10)).abs() < 1e-12, "rapier speed by DEX");
        assert_eq!(thrust.range, 22.0);
        let str2 = hero_sheet(ClassId::ElvenRanger, plus(Attr::Str, 2), &Equipment::starter(ClassId::ElvenRanger), &up).primary;
        assert!((str2.range - 260.0 * 1.04 / 1.00).abs() < 1e-12, "range by STR");
        assert!((str2.speed - 290.0 * 1.04 / 1.00).abs() < 1e-12, "projectile speed by STR");
        assert_eq!((str2.damage, str2.cooldown), (16.0, 0.7), "STR does not move damage or speed");
    }

    #[test]
    fn upgrades_still_apply() {
        let up = StatUpgrades { damage: 2, attack_speed: 1, move_speed: 1, life: 1, armor: 1, ..Default::default() };
        let m = up.modifiers();
        let s = hero_sheet(ClassId::Paladin, Attributes::default(), &Equipment::starter(ClassId::Paladin), &up);
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

    fn with(c: ClassId, extra: Attributes, items: &[(EquipSlot, ItemId)]) -> Sheet {
        let e = items.iter().fold(Equipment::starter(c), |e, &(s, i)| e.with(s, i));
        hero_sheet(c, extra, &e, &StatUpgrades::default())
    }

    #[test]
    fn empty_slots_fall_back_to_the_starters() {
        let up = StatUpgrades::default();
        for c in ClassId::ALL {
            let a = hero_sheet(c, Attributes::default(), &Equipment::default(), &up);
            let b = hero_sheet(c, Attributes::default(), &Equipment::starter(c), &up);
            assert_eq!((a.primary, a.secondary, a.fallback, a.melee), (b.primary, b.secondary, b.fallback, b.melee), "{c:?}");
            assert_eq!(a.ranged, b.ranged, "{c:?}");
        }
    }

    #[test]
    fn another_weapon_changes_the_strike() {
        let p = with(ClassId::Paladin, Attributes::default(), &[(EquipSlot::Melee, ItemId::GoldenSword)]);
        let want = 22.0 * factor(15, STR_DMG) / factor(10, STR_DMG);
        assert!((p.primary.damage - want).abs() < 1e-12 && (want - 27.5).abs() < 1e-12, "{}", p.primary.damage);
        assert!((p.primary.cooldown - 0.5 / (0.96 / 1.0)).abs() < 1e-12);
        assert!((p.primary.arc - 1.8 * 0.94).abs() < 1e-12);
        assert_eq!(p.primary.range, ab::def(AbilityId::Sword).range);
        assert_eq!(p.light, Some(LightKind::Holy));
        let b = with(ClassId::Barbarian, Attributes::default(), &[(EquipSlot::Melee, ItemId::KnightSword)]);
        assert_eq!(b.primary.damage, 20.0);
        assert!((b.primary.cooldown - 0.45 / (1.06 / 0.96)).abs() < 1e-12);
    }

    #[test]
    fn armor_and_trinkets_fold_in() {
        let gear = [
            (EquipSlot::Armor, ItemId::PlateArmor),
            (EquipSlot::Ring1, ItemId::BandOfVigor),
            (EquipSlot::Shoes, ItemId::BootsOfHaste),
            (EquipSlot::Belt, ItemId::GirdleOfWarding),
        ];
        let p = with(ClassId::Paladin, Attributes::default(), &gear);
        assert_eq!(p.res.get(DamageType::Physical), 0.25);
        assert_eq!(p.weight, 12.0 + 7.0);
        assert_eq!(p.attrs.get(Attr::Con), 14);
        assert_eq!(p.max_hp, 125.0 + 10.0);
        assert!((p.speed - 66.0 * 1.04 / 1.03 * 1.05).abs() < 1e-12, "{}", p.speed);
        assert_eq!(p.effect_res.get(EffectKind::Blind), 1.0);
        let mut iron = gear;
        iron[2] = (EquipSlot::Shoes, ItemId::IronBoots);
        let q = with(ClassId::Paladin, Attributes::default(), &iron);
        assert_eq!(q.weight, 12.0 + 7.0 + 3.0);
        assert!((q.speed - 66.0 * 1.04 / 1.03 * 0.95).abs() < 1e-12, "{}", q.speed);
    }

    #[test]
    fn weapon_properties_fill_split_and_on_hit() {
        let start = hero_sheet(ClassId::Wizard, Attributes::default(), &Equipment::starter(ClassId::Wizard), &StatUpgrades::default());
        let ember = with(ClassId::Wizard, Attributes::default(), &[(EquipSlot::Melee, ItemId::EmberStaff)]);
        assert!((ember.melee.split.share(DamageType::Heat) - 0.25).abs() < 1e-12);
        assert_eq!(ember.light, Some(LightKind::Fire));
        assert_eq!(ember.primary, start.primary, "Magic Missile ignores the staff");
        let rot = with(ClassId::Wizard, plus(Attr::Int, 0), &[(EquipSlot::Melee, ItemId::StaffOfRot)]);
        assert_eq!(rot.melee.on_hit, Some(OnHit { kind: EffectKind::Poisoned, secs: 3.0, chance: 0.15, magical: false, power: 8 }));
        assert_eq!(rot.primary, start.primary, "Magic Missile ignores the staff");
    }

    #[test]
    fn enemy_stats_reproduce_today() {
        for t in EnemyType::ALL {
            let d = enemies::def(t);
            let s = enemy_stats(t);
            assert_eq!(s.max_hp, d.hp, "{t:?}: the party size no longer scales HP (TODO 4b)");
            assert_eq!(s.speed, d.speed, "{t:?}");
            assert_eq!(s.weight, d.weight);
        }
    }

    #[test]
    fn boss_stats_reproduce_today() {
        for b in BossId::ALL {
            let d = bosses::def(b);
            let s = boss_stats(b);
            assert_eq!(s.max_hp, d.hp, "{b:?}: the party size no longer scales HP (TODO 4b)");
            assert_eq!(s.speed, d.speed, "{b:?}");
            assert_eq!(s.weight, 40.0);
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
