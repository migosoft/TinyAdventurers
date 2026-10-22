//! The abilities as data (spec §6.3): what each one is, what it uses and its own numbers.
//! `sheet::resolve_ability` turns a def into a hero's numbers.

use super::attributes::{Attr, CHA_DMG, INT_DMG};
use super::damage::{DamageSplit, DamageType};
use super::effects::{EffectKind, EffectLook};
use super::kinds::EntityKind;
use super::requirements::Requirement;
use super::weapons::WeaponKind;
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
        /// A frost bolt that chills.
        FrostShard = 7,
        /// A spark that jumps on to the nearest enemies.
        ChainSpark = 8,
        /// The Paladin's holy bolt.
        Judgement = 9,
        /// A throw of the Throwing Axes.
        Hurl = 10,
        /// Three arrows in a fan.
        Volley = 11,
        /// A sword, mace or hammer strike with a holy share.
        Smite = 12,
        /// A swing all around.
        Whirl = 13,
        /// A thrust that does double from behind.
        FlankingThrust = 14,
        /// Coats the weapon in poison for a while.
        PoisonCoat = 15,
        /// A ring of frost around the Wizard that freezes.
        FrostNova = 16,
        /// A shout that frightens enemies and hastens allies.
        WarCry = 17,
        /// A hammer blow that lands after a wind-up.
        GroundSlam = 18,
        /// Hastens the party around.
        Haste = 19,
        /// Cleanses the party around and wards it.
        Purify = 20,
        /// Holy ground at the Paladin's feet that hurts enemies standing in it.
        Consecrate = 21,
        /// Roots at an aimed spot that entangle enemies standing in them.
        Entangle = 22,
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
    /// An instant hit on the enemies around the user.
    Ring,
    Dash,
    /// An effect or a heal on the user and the allies around.
    SelfArea,
    /// A hazard placed at the user's feet or at an aimed spot.
    GroundArea,
    /// An effect on the user only.
    Buff,
    Summon,
}

/// The effect an ability applies by itself (to the user, the allies around, or the enemies a
/// ring or a hazard touches), for its `duration`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OwnEffect {
    pub kind: EffectKind,
    /// The Attribute whose value is the effect's power.
    pub power: Attr,
    pub look: EffectLook,
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
    /// Its projectile or ground area; its split is `kind_split(kind)` unless `split` is set.
    pub kind: Option<EntityKind>,
    /// The split, instead of `kind_split(kind)`.
    pub split: Option<DamageSplit>,
    /// The effect it applies by itself.
    pub effect: Option<OwnEffect>,
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
    /// A non-physical share added to the weapon's split (`DamageSplit::with_shares`).
    pub share: Option<(DamageType, f64)>,
}

impl WeaponMult {
    pub const ONE: WeaponMult = WeaponMult { damage: 1.0, time: 1.0, arc: None, share: None };
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
    /// The half-angle (rad) of the cone "from behind" its target in which it does more; 0 = none.
    pub behind: f64,
    /// The classes whose own pool can hold it: the class start now, the tree in plan 4.
    pub classes: &'static [ClassId],
}

pub const DASH_SPEED: f64 = 300.0;
/// Volley: the arrows of one shot, and the angle between the outer two (30 degrees).
pub const VOLLEY_ARROWS: u8 = 3;
pub const VOLLEY_SPREAD: f64 = 30.0 * std::f64::consts::PI / 180.0;
/// Chain Spark: how many times it jumps on, how far (px) from the last target, and the factor on
/// the damage of each jump.
pub const CHAIN_JUMPS: u8 = 2;
pub const CHAIN_REACH: f64 = 48.0;
pub const CHAIN_FALLOFF: f64 = 0.7;
/// "From behind": the half-angle (60 degrees) of the cone behind a target, and the factor on a hit inside it.
pub const BEHIND_ARC: f64 = 60.0 * std::f64::consts::PI / 180.0;
pub const BEHIND_MULT: f64 = 2.0;
/// Poison Coat: the poison share added to every weapon attack, and the seconds of Poisoned it applies.
pub const COAT_SHARE: f64 = 0.3;
pub const COAT_POISON_SECS: f64 = 3.0;
/// How long (s) Smite's holy flash lasts.
pub const SMITE_FLASH: f64 = 0.3;
/// Ground Slam: the wind-up (s) before it lands, and the push (px) it gives at least.
pub const SLAM_WINDUP: f64 = 0.5;
pub const SLAM_PUSH: f64 = 24.0;
/// How long (s) Frost Nova's and Purify's flashes last.
pub const NOVA_FLASH: f64 = 0.3;
/// The Magic flash's colour: icy blue, like the Frost Shard's light.
pub const NOVA_TINT: u32 = 0x78c8ff;
pub const PURIFY_FLASH: f64 = 0.3;
/// Entangle: the seconds of Entangled each pulse of the roots (every 0.5 s) renews.
pub const ENTANGLE_PULSE_SECS: f64 = 1.0;

/// The id of arrow `i` of a Volley that starts at `shot`: the server's rule; the client
/// reserves ids so that none is 0.
pub fn volley_shot(shot: u16, i: u8) -> u16 {
    shot.wrapping_add(i as u16)
}
/// Knockback: the push speed is multiplied by this every 1/60 s step
/// (e^-0.25, so a push is mostly over after about 0.2 s), and stops below
/// `KNOCK_MIN_SPEED` px/s. See `collision::knock_speed`.
pub const KNOCK_DECAY: f64 = 0.7788007830714049;
pub const KNOCK_MIN_SPEED: f64 = 8.0;

/// No own numbers: a weapon ability takes them all from its weapon.
const NO_OWN: OwnStats = OwnStats { damage: 0.0, cooldown: 0.0, range: 0.0, speed: 0.0, radius: 0.0, duration: 0.0, kind: None, split: None, effect: None, at: 0 };

/// One sentence on what the ability does, for the character screens.
#[allow(dead_code)] // read by the progression.ts export (a test) only
pub fn text(id: AbilityId) -> &'static str {
    match id {
        AbilityId::MagicMissile => "Fast arcane bolts.",
        AbilityId::Fireball => "Explodes where it lands, hurting everything nearby.",
        AbilityId::Strike => "A sweeping blow with your melee weapon.",
        AbilityId::HolyLight => "Heals you and the allies close to you.",
        AbilityId::Charge => "Dash toward the cursor, hitting everything in the way.",
        AbilityId::Shoot => "Shoot your ranged weapon. In melee you strike with your melee weapon instead.",
        AbilityId::SummonWolf => "Calls your Dire Wolf, or heals it while it lives.",
        AbilityId::FrostShard => "A quick bolt, mostly cold, that chills what it hits.",
        AbilityId::ChainSpark => "A bolt that jumps to up to two more enemies close by, weaker each time.",
        AbilityId::Judgement => "A bolt of holy light. In melee you strike with your weapon instead.",
        AbilityId::Hurl => "Throw an axe that spins as it flies.",
        AbilityId::Volley => "Three arrows in a fan, each weaker.",
        AbilityId::Smite => "A slow, hard swing with a holy part.",
        AbilityId::Whirl => "A swing all the way around you, weaker and slower than a strike.",
        AbilityId::FlankingThrust => "A thrust that does double damage from behind.",
        AbilityId::PoisonCoat => "For a while your weapon attacks add poison and poison what they hit.",
        AbilityId::FrostNova => "A ring of cold around you that hurts and freezes every enemy in sight.",
        AbilityId::WarCry => "A shout that frightens the enemies close to you and speeds up you and your allies.",
        AbilityId::GroundSlam => "Slam the ground after a short wind-up, hitting and pushing everything around you.",
        AbilityId::Haste => "You and the allies close to you run faster for a while.",
        AbilityId::Purify => "Clears bad effects from you and the allies close to you and wards you against curses for a moment.",
        AbilityId::Consecrate => "Holy ground under your feet that hurts enemies standing in it.",
        AbilityId::Entangle => "Vines grow where you aim and root the enemies in them.",
    }
}

pub fn def(id: AbilityId) -> AbilityDef {
    use AbilityCategory as C;
    use AbilityId::*;
    use AbilitySlot::*;
    use ClassId as K;
    #[allow(clippy::too_many_arguments)]
    const fn own(damage: f64, cooldown: f64, range: f64, speed: f64, radius: f64, duration: f64, kind: Option<EntityKind>, at: i32) -> OwnStats {
        OwnStats { damage, cooldown, range, speed, radius, duration, kind, split: None, effect: None, at }
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
        behind: 0.0,
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
        FrostShard => AbilityDef {
            req: &[Requirement::Attr(Attr::Int, 14)],
            own: OwnStats { split: Some(DamageSplit::split(&[(DamageType::Cold, 0.4), (DamageType::Magical, 0.3)])), ..own(10.0, 0.5, 200.0, 200.0, 3.0, 0.0, Some(EntityKind::FrostBolt), 14) },
            ..base("Frost Shard", Primary, C::Spell, Uses::Nothing, true, Shape::Projectile, NO_OWN, &[K::Wizard])
        },
        ChainSpark => AbilityDef {
            req: &[Requirement::Attr(Attr::Int, 18)],
            ..base("Chain Spark", Primary, C::Spell, Uses::Nothing, true, Shape::Projectile, own(14.0, 0.8, 180.0, 260.0, 3.0, 0.0, Some(EntityKind::ChainSpark), 18), &[K::Wizard])
        },
        Judgement => AbilityDef {
            req: &[Requirement::Attr(Attr::Cha, 16)],
            ..base("Judgement", Primary, C::Innate, Uses::Nothing, true, Shape::Projectile, own(18.0, 0.9, 150.0, 220.0, 3.0, 0.0, Some(EntityKind::Judgement), 16), &[K::Paladin])
        },
        Hurl => AbilityDef {
            req: &[Requirement::WeaponKind(&[WeaponKind::ThrowingAxe])],
            ..base("Hurl", Primary, C::WeaponAttack, Uses::Ranged, true, Shape::Projectile, NO_OWN, &[K::Barbarian])
        },
        Volley => AbilityDef {
            req: &[Requirement::Attr(Attr::Dex, 15), Requirement::WeaponKind(&[WeaponKind::Bow, WeaponKind::Longbow])],
            weapon_mult: WeaponMult { damage: 0.6, time: 1.4, ..WeaponMult::ONE },
            ..base("Volley", Primary, C::WeaponAttack, Uses::Ranged, true, Shape::Projectile, NO_OWN, &[K::ElvenRanger])
        },
        Smite => AbilityDef {
            req: &[Requirement::Attr(Attr::Cha, 15), Requirement::WeaponKind(&[WeaponKind::Sword, WeaponKind::Mace, WeaponKind::Hammer])],
            weapon_mult: WeaponMult { damage: 1.4, time: 1.6, share: Some((DamageType::Magical, 0.3)), ..WeaponMult::ONE },
            ..base("Smite", Primary, C::WeaponAttack, Uses::Melee, false, Shape::Swing, NO_OWN, &[K::Paladin])
        },
        Whirl => AbilityDef {
            req: &[Requirement::Attr(Attr::Dex, 14)],
            weapon_mult: WeaponMult { damage: 0.75, time: 1.3, arc: Some(std::f64::consts::TAU), ..WeaponMult::ONE },
            ..base("Whirl", Primary, C::Technique, Uses::Melee, false, Shape::Swing, NO_OWN, &[K::Barbarian])
        },
        FlankingThrust => AbilityDef {
            req: &[Requirement::Attr(Attr::Dex, 16), Requirement::WeaponKind(&[WeaponKind::Dagger, WeaponKind::DuellingSword, WeaponKind::Katana, WeaponKind::Machete])],
            behind: BEHIND_ARC,
            ..base("Flanking Thrust", Primary, C::WeaponAttack, Uses::Melee, false, Shape::Swing, NO_OWN, &[K::ElvenRanger])
        },
        PoisonCoat => AbilityDef {
            req: &[Requirement::Attr(Attr::Wil, 15)],
            own: OwnStats { effect: Some(OwnEffect { kind: EffectKind::Coated, power: Attr::Wil, look: EffectLook::Plain }), ..own(0.0, 16.0, 0.0, 0.0, 0.0, 6.0, None, 0) },
            ..base("Poison Coat", Secondary, C::Technique, Uses::Nothing, false, Shape::Buff, NO_OWN, &[K::ElvenRanger])
        },
        FrostNova => AbilityDef {
            req: &[Requirement::Attr(Attr::Int, 17)],
            own: OwnStats { split: Some(DamageSplit::pure(DamageType::Cold)), ..own(22.0, 9.0, 0.0, 0.0, 44.0, 0.0, None, 17) },
            ..base("Frost Nova", Secondary, C::Spell, Uses::Nothing, false, Shape::Ring, NO_OWN, &[K::Wizard])
        },
        WarCry => AbilityDef {
            req: &[Requirement::Attr(Attr::Str, 16)],
            own: OwnStats { effect: Some(OwnEffect { kind: EffectKind::Fear, power: Attr::Str, look: EffectLook::Plain }), ..own(0.0, 12.0, 0.0, 0.0, 56.0, 3.0, None, 0) },
            ..base("War Cry", Secondary, C::Technique, Uses::Nothing, false, Shape::Ring, NO_OWN, &[K::Barbarian])
        },
        GroundSlam => AbilityDef {
            req: &[Requirement::Attr(Attr::Str, 17), Requirement::WeaponKind(&[WeaponKind::Hammer, WeaponKind::Club])],
            weapon_mult: WeaponMult { damage: 1.2, ..WeaponMult::ONE },
            ..base("Ground Slam", Secondary, C::Technique, Uses::Melee, false, Shape::Ring, own(0.0, 6.0, 0.0, 0.0, 34.0, 0.0, None, 0), &[K::Barbarian])
        },
        Haste => AbilityDef {
            req: &[Requirement::Attr(Attr::Int, 15), Requirement::Attr(Attr::Wil, 14)],
            own: OwnStats { effect: Some(OwnEffect { kind: EffectKind::Accelerated, power: Attr::Int, look: EffectLook::Plain }), ..own(0.0, 14.0, 64.0, 0.0, 64.0, 4.0, None, 0) },
            ..base("Haste", Secondary, C::Spell, Uses::Nothing, false, Shape::SelfArea, NO_OWN, &[K::Wizard])
        },
        Purify => AbilityDef {
            req: &[Requirement::Attr(Attr::Wil, 14)],
            own: OwnStats { effect: Some(OwnEffect { kind: EffectKind::Warded, power: Attr::Cha, look: EffectLook::Plain }), ..own(0.0, 15.0, 64.0, 0.0, 64.0, 3.0, None, 0) },
            ..base("Purify", Secondary, C::Innate, Uses::Nothing, false, Shape::SelfArea, NO_OWN, &[K::Paladin])
        },
        Consecrate => AbilityDef {
            req: &[Requirement::Attr(Attr::Cha, 15)],
            ..base("Consecrate", Secondary, C::Innate, Uses::Nothing, false, Shape::GroundArea, own(8.0, 12.0, 0.0, 0.0, 40.0, 5.0, Some(EntityKind::HolyGround), 15), &[K::Paladin])
        },
        Entangle => AbilityDef {
            req: &[Requirement::Attr(Attr::Cha, 14)],
            own: OwnStats { effect: Some(OwnEffect { kind: EffectKind::Entangled, power: Attr::Cha, look: EffectLook::Vines }), ..own(0.0, 14.0, 120.0, 0.0, 36.0, 4.0, Some(EntityKind::Roots), 0) },
            ..base("Entangle", Secondary, C::Innate, Uses::Nothing, true, Shape::GroundArea, NO_OWN, &[K::ElvenRanger])
        },
        SummonWolf => base("Summon Wolf", Secondary, C::Innate, Uses::Nothing, false, Shape::Summon, own(0.0, 8.0, 0.0, 0.0, 0.0, 0.0, None, 13), &[K::ElvenRanger]),
    }
}

/// The Attribute that governs an ability's category (spec §5, §6.3): it scales a spell's or
/// innate ability's damage and is the power of its damage-type effects, with the percentage
/// each point moves that damage by. Weapon attacks and techniques have none: their numbers and
/// power are the weapon's.
pub fn governing(c: AbilityCategory) -> Option<(Attr, f64)> {
    match c {
        AbilityCategory::Spell => Some((Attr::Int, INT_DMG)),
        AbilityCategory::Innate => Some((Attr::Cha, CHA_DMG)),
        AbilityCategory::WeaponAttack | AbilityCategory::Technique => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::classes;

    #[test]
    fn every_ability_has_a_text() {
        for &id in AbilityId::ALL.iter() {
            assert!(!text(id).is_empty() && text(id).ends_with('.'), "{id:?}");
        }
    }

    #[test]
    fn ability_data_is_consistent() {
        for id in AbilityId::ALL {
            let d = def(id);
            assert_eq!(d.id, id);
            assert!(!d.classes.is_empty(), "{id:?}");
            let magic = matches!(d.category, AbilityCategory::Spell | AbilityCategory::Innate);
            if magic {
                assert_eq!(d.uses, Uses::Nothing, "{id:?}: a spell or innate ability uses nothing");
            }
            match d.uses {
                Uses::Melee => assert!(matches!(d.shape, Shape::Swing | Shape::Dash | Shape::Ring), "{id:?}: a melee ability swings, dashes or rings"),
                Uses::Ranged => assert_eq!(d.shape, Shape::Projectile, "{id:?}: a ranged ability shoots"),
                Uses::Nothing => {}
            }
            if matches!(d.shape, Shape::Blast | Shape::GroundArea) && d.ranged {
                assert!(d.own.range > 0.0, "{id:?}: an aimed area needs a range");
            }
            if d.own.effect.is_some() {
                assert!(matches!(d.shape, Shape::Ring | Shape::SelfArea | Shape::GroundArea | Shape::Buff), "{id:?}: an own effect needs an area or a buff");
            }
            if magic && d.own.damage > 0.0 {
                assert!(d.own.at > 0, "{id:?}: a spell's damage is given at an Attribute value");
            }
            let nothing = d.uses == Uses::Nothing;
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
