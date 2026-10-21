//! The abilities as data (spec §6.3): what each one is, what it uses and its own numbers.
//! `sheet::resolve_ability` turns a def into a hero's numbers.

use super::attributes::Attr;
use super::kinds::EntityKind;
use super::requirements::Requirement;
use crate::protocol::ClassId;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

super::enum_list::listed_enum! {
    /// Every ability a hero can have: one primary (LMB) and one secondary (RMB).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
    pub enum AbilityId: u8 {
        MagicMissile = 0,
        Fireball = 1,
        /// A strike with the melee weapon; also every hero's fallback in melee.
        Strike = 2,
        HolyLight = 3,
        /// The Barbarian's dash: hurts what it touches with the melee weapon.
        Charge = 4,
        /// A shot of the ranged weapon.
        Shoot = 5,
        /// Summons or heals the Dire Wolf.
        SummonWolf = 6,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum AbilitySlot {
    Primary,
    Secondary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum AbilityCategory {
    WeaponAttack,
    Technique,
    Spell,
    Innate,
}

/// The weapon an ability strikes with, if any.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Uses {
    Melee,
    Ranged,
    Nothing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Shape {
    Swing,
    Projectile,
    Blast,
    Dash,
    SelfArea,
    Summon,
}

/// An ability's own numbers (those it does not take from a weapon).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OwnStats {
    pub damage: f64,
    pub cooldown: f64,
    pub range: f64,
    pub speed: f64,
    pub radius: f64,
    pub duration: f64,
    /// The spell's projectile; its split is `kind_split(kind)`.
    pub kind: Option<EntityKind>,
    /// The governing Attribute's value at which `damage` is given.
    pub at: i32,
}

/// How a weapon ability changes its weapon's numbers.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WeaponMult {
    pub damage: f64,
    /// The weapon's interval is multiplied by this (when the ability has no cooldown of its own).
    pub time: f64,
    /// The arc, instead of the weapon's.
    pub arc: Option<f64>,
}

impl WeaponMult {
    pub const ONE: WeaponMult = WeaponMult { damage: 1.0, time: 1.0, arc: None };
}

#[derive(Debug, Clone, Copy)]
pub struct AbilityDef {
    pub id: AbilityId,
    pub name: &'static str,
    pub slot: AbilitySlot,
    pub category: AbilityCategory,
    pub uses: Uses,
    /// A ranged ability: in melee a primary falls back to Strike and a secondary is blocked.
    pub ranged: bool,
    pub req: &'static [Requirement],
    pub shape: Shape,
    pub own: OwnStats,
    pub weapon_mult: WeaponMult,
    /// The classes whose own pool can hold it: the class start now, the tree in plan 4.
    pub classes: &'static [ClassId],
}

pub const DASH_SPEED: f64 = 300.0;
/// Knockback: the push speed is multiplied by this every 1/60 s step
/// (e^-0.25, so a push is mostly over after about 0.2 s), and stops below
/// `KNOCK_MIN_SPEED` px/s. See `collision::knock_speed`.
pub const KNOCK_DECAY: f64 = 0.7788007830714049;
pub const KNOCK_MIN_SPEED: f64 = 8.0;

/// No own numbers: a weapon ability takes them all from its weapon.
const NO_OWN: OwnStats = OwnStats { damage: 0.0, cooldown: 0.0, range: 0.0, speed: 0.0, radius: 0.0, duration: 0.0, kind: None, at: 0 };

pub fn def(id: AbilityId) -> AbilityDef {
    use AbilityCategory as C;
    use AbilityId::*;
    use AbilitySlot::*;
    use ClassId as K;
    #[allow(clippy::too_many_arguments)]
    const fn own(damage: f64, cooldown: f64, range: f64, speed: f64, radius: f64, duration: f64, kind: Option<EntityKind>, at: i32) -> OwnStats {
        OwnStats { damage, cooldown, range, speed, radius, duration, kind, at }
    }
    let base = |name: &'static str, slot, category, uses, ranged, shape, own, classes: &'static [ClassId]| AbilityDef {
        id,
        name,
        slot,
        category,
        uses,
        ranged,
        req: &[],
        shape,
        own,
        weapon_mult: WeaponMult::ONE,
        classes,
    };
    match id {
        MagicMissile => base("Magic Missile", Primary, C::Spell, Uses::Nothing, true, Shape::Projectile, own(12.0, 0.35, 220.0, 230.0, 3.0, 0.0, Some(EntityKind::Missile), 15), &[K::Wizard]),
        Fireball => base("Fireball", Secondary, C::Spell, Uses::Nothing, true, Shape::Blast, own(45.0, 6.0, 260.0, 140.0, 38.0, 0.0, Some(EntityKind::Fireball), 15), &[K::Wizard]),
        Strike => base("Strike", Primary, C::WeaponAttack, Uses::Melee, false, Shape::Swing, NO_OWN, &[K::Paladin, K::Barbarian]),
        HolyLight => base("Holy Light", Secondary, C::Innate, Uses::Nothing, false, Shape::SelfArea, own(35.0, 10.0, 64.0, 0.0, 64.0, 0.0, None, 14), &[K::Paladin]),
        Charge => AbilityDef {
            weapon_mult: WeaponMult { damage: 0.8, ..WeaponMult::ONE },
            ..base("Charge", Secondary, C::Technique, Uses::Melee, false, Shape::Dash, own(0.0, 5.0, 0.0, DASH_SPEED, 10.0, 0.18, None, 0), &[K::Barbarian])
        },
        Shoot => base("Shoot", Primary, C::WeaponAttack, Uses::Ranged, true, Shape::Projectile, NO_OWN, &[K::ElvenRanger]),
        SummonWolf => base("Summon Wolf", Secondary, C::Innate, Uses::Nothing, false, Shape::Summon, own(0.0, 8.0, 0.0, 0.0, 0.0, 0.0, None, 13), &[K::ElvenRanger]),
    }
}

/// The Attribute that governs an ability's category (spec §5, §6.3): it scales a spell's or
/// innate ability's damage and is the power of its damage-type effects. Weapon attacks and
/// techniques have none: their numbers and power are the weapon's.
pub fn governing(c: AbilityCategory) -> Option<Attr> {
    match c {
        AbilityCategory::Spell => Some(Attr::Int),
        AbilityCategory::Innate => Some(Attr::Cha),
        AbilityCategory::WeaponAttack | AbilityCategory::Technique => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::classes;

    #[test]
    fn ability_data_is_consistent() {
        for id in AbilityId::ALL {
            let d = def(id);
            assert_eq!(d.id, id);
            assert!(!d.classes.is_empty(), "{id:?}");
            let nothing = d.uses == Uses::Nothing;
            let magic = matches!(d.category, AbilityCategory::Spell | AbilityCategory::Innate);
            assert_eq!(nothing, magic, "{id:?}: uses nothing iff a spell or innate");
            if d.uses == Uses::Melee {
                assert!(matches!(d.shape, Shape::Swing | Shape::Dash), "{id:?}: a melee ability swings or dashes");
            }
            if d.req.iter().any(|r| matches!(r, Requirement::WeaponKind(_))) {
                assert!(!nothing, "{id:?}: a weapon-kind requirement needs a weapon");
            }
        }
        for c in ClassId::ALL {
            let cd = classes::def(c);
            for (id, slot) in [(cd.primary, AbilitySlot::Primary), (cd.secondary, AbilitySlot::Secondary)] {
                assert_eq!(def(id).slot, slot, "{c:?} {id:?}");
                assert!(def(id).classes.contains(&c), "{c:?} {id:?}");
            }
        }
    }
}
