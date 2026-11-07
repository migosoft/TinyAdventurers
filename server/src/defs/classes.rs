use super::abilities::AbilityId;
use super::attributes::{AttrSources, Attributes};
use super::races::{self, Adjust, Race, Profile};
use super::items::{ArmorClass, ItemId};
use super::kinds::EntityKind;
use super::trees::Prof;
use super::weapons::WeaponKind;
use crate::protocol::ClassId;
use serde::Serialize;

pub const PLAYER_RADIUS: f64 = 5.0;
/// How far a hero's melee reaches beyond its body: a hero's reach is `HERO_REACH + PLAYER_RADIUS`.
pub const HERO_REACH: f64 = 17.0;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct ClassDef {
    pub class: ClassId,
    #[serde(skip)]
    pub kind: EntityKind,
    /// Start HP: references for calibration and the client's demo scenes (removed in plan 5). Defined at the class's own CON (10 + modifier, before races).
    pub hp: f64,
    /// Start speed, defined at the class's own CON (10 + modifier, before races).
    pub speed: f64,
    /// The class's modifier from 10 (see `attr_sources`).
    #[serde(skip)]
    pub attr_mods: Attributes,
    /// HP at CON 10: `hp(base_hp, 10 + attr_mods.Con) == hp` (own CON, before races).
    #[serde(skip)]
    pub base_hp: f64,
    /// Body weight for pushes (armor adds later).
    #[serde(skip)]
    pub weight: f64,
    pub primary: AbilityId,
    pub secondary: AbilityId,
    /// The weapon kinds the class is proficient with (spec §6.3).
    #[serde(skip)]
    pub weapons: &'static [WeaponKind],
    /// The heaviest armor class the class can wear.
    #[serde(skip)]
    pub max_armor: ArmorClass,
    /// The starting melee weapon and, if any, ranged weapon.
    #[serde(skip)]
    pub starter: (ItemId, Option<ItemId>),
}

pub fn def(class: ClassId) -> ClassDef {
    use AbilityId::*;
    use WeaponKind as K;
    match class {
        ClassId::Wizard => ClassDef { class, kind: EntityKind::Wizard, hp: 70.0, speed: 72.0, attr_mods: Attributes::new(-2, 4, 2, 5, 3, 0), base_hp: 60.0, weight: 9.0, primary: MagicMissile, secondary: Fireball, weapons: &[K::Staff, K::Dagger], max_armor: ArmorClass::Cloth, starter: (ItemId::RedStaff, None) },
        ClassId::Paladin => ClassDef { class, kind: EntityKind::Paladin, hp: 120.0, speed: 66.0, attr_mods: Attributes::new(5, -2, 3, 0, 2, 4), base_hp: 105.0, weight: 12.0, primary: Strike, secondary: HolyLight, weapons: &[K::Sword, K::Mace, K::Hammer], max_armor: ArmorClass::Heavy, starter: (ItemId::KnightSword, None) },
        ClassId::Barbarian => ClassDef { class, kind: EntityKind::Barbarian, hp: 140.0, speed: 70.0, attr_mods: Attributes::new(5, 3, 4, -2, 2, 0), base_hp: 120.0, weight: 13.0, primary: Strike, secondary: Charge, weapons: &[K::Axe, K::Hammer, K::Club, K::Sword, K::Spear, K::ThrowingAxe], max_armor: ArmorClass::Medium, starter: (ItemId::GreatAxe, None) },
        ClassId::ElvenRanger => {
            ClassDef { class, kind: EntityKind::ElvenRanger, hp: 90.0, speed: 80.0, attr_mods: Attributes::new(0, 3, 2, -2, 4, 3), base_hp: 80.0, weight: 10.0, primary: Shoot, secondary: SummonWolf, weapons: &[K::Dagger, K::DuellingSword, K::Machete, K::Bow, K::Crossbow], max_armor: ArmorClass::Light, starter: (ItemId::Rapier, Some(ItemId::ElvenBow)) }
        }
    }
}

/// The races of a hero: humans, except the Ranger, an elf (armour items will add resistances later).
pub fn races(class: ClassId) -> &'static [Race] {
    match class {
        ClassId::ElvenRanger => &[Race::Elf],
        _ => &[Race::Human],
    }
}

/// The class's own proficiencies: its weapon kinds and armor up to `max_armor`.
pub fn prof_base(class: ClassId) -> Vec<Prof> {
    let d = def(class);
    d.weapons.iter().map(|&k| Prof::Weapon(k)).chain(std::iter::once(Prof::Armor(d.max_armor))).collect()
}

/// The sources of the class's Attributes, layers 1-3: base 10, race bonus, class modifier.
pub fn attr_sources(class: ClassId) -> AttrSources {
    races::creature_sources(races(class), def(class).attr_mods)
}


pub fn profile(class: ClassId) -> Profile {
    races::profile(races(class), Adjust::NONE)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::attributes::{self, Attr};

    #[test]
    fn class_hp_comes_from_base_and_con() {
        for c in ClassId::ALL {
            let d = def(c);
            assert_eq!(attributes::hp(d.base_hp, races::own_con(d.attr_mods)), d.hp, "{c:?}");
        }
    }

    #[test]
    fn heroes_keep_todays_attributes() {
        let today = [(ClassId::Wizard, Attributes::new(8, 14, 12, 15, 13, 10)), (ClassId::Paladin, Attributes::new(15, 8, 13, 10, 12, 14)),
            (ClassId::Barbarian, Attributes::new(15, 13, 14, 8, 12, 10)), (ClassId::ElvenRanger, Attributes::new(10, 15, 12, 8, 14, 13))];
        for (c, a) in today {
            assert_eq!(attr_sources(c).total(), a, "{c:?}");
            assert_eq!(attr_sources(c).total(), races::creature_sources(races(c), def(c).attr_mods).total(), "{c:?}");
        }
    }

    #[test]
    fn classes_use_the_standard_array() {
        for c in ClassId::ALL {
            let mut v: Vec<i32> = Attr::ALL.iter().map(|&a| attr_sources(c).total().get(a)).collect();
            v.sort();
            assert_eq!(v, [8, 10, 12, 13, 14, 15], "{c:?}");
        }
        assert_eq!(def(ClassId::ElvenRanger).attr_mods.get(Attr::Dex), 3);
        assert_eq!(attr_sources(ClassId::ElvenRanger).total().get(Attr::Dex), 15);
    }

    #[test]
    fn class_weights_match_the_spec() {
        assert_eq!(def(ClassId::Wizard).weight, 9.0);
        assert_eq!(def(ClassId::Paladin).weight, 12.0);
        assert_eq!(def(ClassId::Barbarian).weight, 13.0);
        assert_eq!(def(ClassId::ElvenRanger).weight, 10.0);
    }
}
