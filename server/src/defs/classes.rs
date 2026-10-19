use super::abilities::AbilityId;
use super::attributes::Attributes;
use super::effects::EffectResponses;
use super::races::{self, Adjust, Race, Profile};
use super::kinds::EntityKind;
use crate::protocol::ClassId;
use serde::Serialize;

pub const PLAYER_RADIUS: f64 = 5.0;

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
    #[allow(dead_code)] // used from plan 1 Task 4/5
    #[serde(skip)]
    pub base_hp: f64,
    /// Body weight for pushes (armor adds later).
    #[allow(dead_code)] // used from plan 1 Task 4/5
    #[serde(skip)]
    pub weight: f64,
    pub primary: AbilityId,
    pub secondary: AbilityId,
}

pub fn def(class: ClassId) -> ClassDef {
    use AbilityId::*;
    match class {
        ClassId::Wizard => ClassDef { class, kind: EntityKind::Wizard, hp: 70.0, speed: 72.0, attrs: Attributes::new(8, 14, 12, 15, 13, 10), base_hp: 60.0, weight: 9.0, primary: MagicMissile, secondary: Fireball },
        ClassId::Paladin => ClassDef { class, kind: EntityKind::Paladin, hp: 120.0, speed: 66.0, attrs: Attributes::new(15, 8, 13, 10, 12, 14), base_hp: 105.0, weight: 12.0, primary: Sword, secondary: Heal },
        ClassId::Barbarian => ClassDef { class, kind: EntityKind::Barbarian, hp: 140.0, speed: 70.0, attrs: Attributes::new(15, 13, 14, 8, 12, 10), base_hp: 120.0, weight: 13.0, primary: Axe, secondary: Dash },
        ClassId::ElvenRanger => {
            ClassDef { class, kind: EntityKind::ElvenRanger, hp: 90.0, speed: 80.0, attrs: Attributes::new(10, 13, 12, 8, 14, 13), base_hp: 80.0, weight: 10.0, primary: CrossbowDagger, secondary: SummonWolf }
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
#[allow(dead_code)] // used from plan 1 Task 4/5
pub fn start_attrs(class: ClassId) -> Attributes {
    def(class).attrs.plus(races::race_attrs(races(class)))
}

pub fn profile(class: ClassId) -> Profile {
    races::profile(races(class), Adjust::NONE)
}

pub fn responses(class: ClassId) -> EffectResponses {
    races::responses(races(class))
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
