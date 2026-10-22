use super::abilities::AbilityId;
use super::attributes::Attributes;
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
    /// Start HP and speed: references for calibration and the client's demo scenes (removed in plan 5).
    pub hp: f64,
    pub speed: f64,
    /// The class's own points, without the race bonus (see `start_attrs`).
    #[serde(skip)]
    pub attrs: Attributes,
    /// HP before the CON bonus: `hp(base_hp, start CON) == hp`.
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
        ClassId::Wizard => ClassDef { class, kind: EntityKind::Wizard, hp: 70.0, speed: 72.0, attrs: Attributes::new(8, 14, 12, 15, 13, 10), base_hp: 60.0, weight: 9.0, primary: MagicMissile, secondary: Fireball, weapons: &[K::Staff, K::Dagger], max_armor: ArmorClass::Cloth, starter: (ItemId::RedStaff, None) },
        ClassId::Paladin => ClassDef { class, kind: EntityKind::Paladin, hp: 120.0, speed: 66.0, attrs: Attributes::new(15, 8, 13, 10, 12, 14), base_hp: 105.0, weight: 12.0, primary: Strike, secondary: HolyLight, weapons: &[K::Sword, K::Mace, K::Hammer], max_armor: ArmorClass::Heavy, starter: (ItemId::KnightSword, None) },
        ClassId::Barbarian => ClassDef { class, kind: EntityKind::Barbarian, hp: 140.0, speed: 70.0, attrs: Attributes::new(15, 13, 14, 8, 12, 10), base_hp: 120.0, weight: 13.0, primary: Strike, secondary: Charge, weapons: &[K::Axe, K::Hammer, K::Club, K::Sword, K::Spear, K::ThrowingAxe], max_armor: ArmorClass::Medium, starter: (ItemId::GreatAxe, None) },
        ClassId::ElvenRanger => {
            ClassDef { class, kind: EntityKind::ElvenRanger, hp: 90.0, speed: 80.0, attrs: Attributes::new(10, 13, 12, 8, 14, 13), base_hp: 80.0, weight: 10.0, primary: Shoot, secondary: SummonWolf, weapons: &[K::Dagger, K::DuellingSword, K::Machete, K::Bow, K::Crossbow], max_armor: ArmorClass::Light, starter: (ItemId::Rapier, Some(ItemId::ElvenBow)) }
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

/// Class points plus the race bonus (the Elf's DEX +2).
/// The class's own proficiencies: its weapon kinds and armor up to `max_armor`.
pub fn prof_base(class: ClassId) -> Vec<Prof> {
    let d = def(class);
    d.weapons.iter().map(|&k| Prof::Weapon(k)).chain(std::iter::once(Prof::Armor(d.max_armor))).collect()
}

pub fn start_attrs(class: ClassId) -> Attributes {
    def(class).attrs.plus(races::race_attrs(races(class)))
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
            assert_eq!(attributes::hp(d.base_hp, start_attrs(c).get(Attr::Con)), d.hp, "{c:?}");
        }
    }

    #[test]
    fn classes_use_the_standard_array() {
        for c in ClassId::ALL {
            let mut v: Vec<i32> = Attr::ALL.iter().map(|&a| start_attrs(c).get(a)).collect();
            v.sort();
            assert_eq!(v, [8, 10, 12, 13, 14, 15], "{c:?}");
        }
        assert_eq!(def(ClassId::ElvenRanger).attrs.get(Attr::Dex), 13);
        assert_eq!(start_attrs(ClassId::ElvenRanger).get(Attr::Dex), 15);
    }

    #[test]
    fn class_weights_match_the_spec() {
        assert_eq!(def(ClassId::Wizard).weight, 9.0);
        assert_eq!(def(ClassId::Paladin).weight, 12.0);
        assert_eq!(def(ClassId::Barbarian).weight, 13.0);
        assert_eq!(def(ClassId::ElvenRanger).weight, 10.0);
    }
}
