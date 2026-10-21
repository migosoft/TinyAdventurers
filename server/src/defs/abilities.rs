use super::attributes::{Attr, INT_DMG, CHA_DMG, STR_DMG};
use super::items::EquipSlot;
use crate::protocol::ClassId;
use serde::Serialize;
use ts_rs::TS;

/// Every attack/ability a class can have. A class picks one primary and one
/// secondary; later loadout selection only needs to swap these ids.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, TS)]
pub enum AbilityId {
    MagicMissile,
    Fireball,
    Sword,
    Heal,
    Axe,
    Dash,
    /// Crossbow, or an automatic dagger stab when an enemy is in melee range.
    CrossbowDagger,
    /// The Elven Ranger's secondary: summons or heals the Dire Wolf.
    SummonWolf,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct AbilityDef {
    pub id: AbilityId,
    pub cooldown: f64,
    pub damage: f64,
    /// Melee reach or projectile max range (px).
    pub range: f64,
    /// Melee arc (radians) or 0.
    pub arc: f64,
    /// Projectile speed (px/s) or 0.
    pub speed: f64,
    /// Projectile / effect radius (px).
    pub radius: f64,
    /// Duration for the dash (s).
    pub duration: f64,
}

pub const DAGGER_RANGE: f64 = 22.0;
pub const DASH_SPEED: f64 = 300.0;
/// Knockback: the push speed is multiplied by this every 1/60 s step
/// (e^-0.25, so a push is mostly over after about 0.2 s), and stops below
/// `KNOCK_MIN_SPEED` px/s. See `collision::knock_speed`.
pub const KNOCK_DECAY: f64 = 0.7788007830714049;
pub const KNOCK_MIN_SPEED: f64 = 8.0;

const fn d(id: AbilityId, cooldown: f64, damage: f64, range: f64, arc: f64, speed: f64, radius: f64, duration: f64) -> AbilityDef {
    AbilityDef { id, cooldown, damage, range, arc, speed, radius, duration }
}

/// An effect a hero ability applies on a hit (loadouts and items will set these). None yet.
pub fn on_hit(id: AbilityId) -> Option<super::effects::OnHit> {
    let _ = id;
    None
}

pub fn def(id: AbilityId) -> AbilityDef {
    use AbilityId::*;
    match id {
        MagicMissile => d(id, 0.35, 12.0, 220.0, 0.0, 230.0, 3.0, 0.0),
        Fireball => d(id, 6.0, 45.0, 260.0, 0.0, 140.0, 38.0, 0.0),
        Sword => d(id, 0.45, 20.0, 22.0, 1.75, 0.0, 0.0, 0.0),
        Heal => d(id, 10.0, 35.0, 64.0, 0.0, 0.0, 64.0, 0.0),
        Axe => d(id, 0.8, 32.0, 25.0, 2.45, 0.0, 0.0, 0.0),
        Dash => d(id, 5.0, 25.0, 0.0, 0.0, DASH_SPEED, 10.0, 0.18),
        CrossbowDagger => d(id, 0.7, 16.0, 260.0, 0.0, 290.0, 2.0, 0.0),
        SummonWolf => d(id, 8.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
    }
}

/// Which Attribute moves which number of an ability, and by how much per point.
/// Interim table: plan 3 replaces it with weapons.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Scaling {
    pub damage: Option<(Attr, f64)>,
    /// Attack speed: shortens the cooldown.
    pub speed: Option<(Attr, f64)>,
    pub arc: Option<(Attr, f64)>,
    /// Melee reach or projectile range, and the projectile's speed.
    pub reach: Option<(Attr, f64)>,
}

pub fn scaling(id: AbilityId) -> Scaling {
    use AbilityId::*;
    let none = Scaling::default();
    match id {
        MagicMissile | Fireball => Scaling { damage: Some((Attr::Int, INT_DMG)), ..none },
        Heal => Scaling { damage: Some((Attr::Cha, CHA_DMG)), ..none },
        Dash => Scaling { damage: Some((Attr::Str, STR_DMG)), ..none },
        // The weapon abilities take their numbers from the weapon (`uses_weapon`).
        Sword | Axe | CrossbowDagger | SummonWolf => none,
    }
}

/// The weapon slot whose weapon an ability strikes with (interim until plan 3).
pub fn uses_weapon(id: AbilityId) -> Option<EquipSlot> {
    use AbilityId::*;
    match id {
        Sword | Axe | Dash => Some(EquipSlot::Melee),
        CrossbowDagger => Some(EquipSlot::Ranged),
        MagicMissile | Fireball | Heal | SummonWolf => None,
    }
}

/// The Attribute that governs an ability (spec §5, §6.3): the power of the damage-type
/// effects its hits apply. Spells INT, innate magic CHA. The weapon abilities have
/// none: their power is the weapon's (`ResolvedWeapon::power`). Summon Wolf deals no
/// damage of its own.
pub fn governing(id: AbilityId) -> Option<Attr> {
    use AbilityId::*;
    match id {
        MagicMissile | Fireball => Some(Attr::Int),
        Heal => Some(Attr::Cha),
        Sword | Axe | Dash | CrossbowDagger | SummonWolf => None,
    }
}

/// The class whose start Attributes are the reference of this ability's numbers.
pub fn owner(id: AbilityId) -> ClassId {
    use AbilityId::*;
    match id {
        MagicMissile | Fireball => ClassId::Wizard,
        Sword | Heal => ClassId::Paladin,
        Axe | Dash => ClassId::Barbarian,
        CrossbowDagger | SummonWolf => ClassId::ElvenRanger,
    }
}

pub const ALL: [AbilityId; 8] = [
    AbilityId::MagicMissile,
    AbilityId::Fireball,
    AbilityId::Sword,
    AbilityId::Heal,
    AbilityId::Axe,
    AbilityId::Dash,
    AbilityId::CrossbowDagger,
    AbilityId::SummonWolf,
];
