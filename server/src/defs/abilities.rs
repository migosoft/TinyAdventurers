use serde::Serialize;

/// Every attack/ability a class can have. A class picks one primary and one
/// secondary; later loadout selection only needs to swap these ids.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum AbilityId {
    MagicMissile,
    Fireball,
    Sword,
    Heal,
    Axe,
    Dash,
    /// Crossbow, or an automatic dagger stab when an enemy is in melee range.
    CrossbowDagger,
    Hide,
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
    /// Duration for dash / hide (s).
    pub duration: f64,
}

pub const DAGGER_RANGE: f64 = 22.0;
pub const DAGGER_DAMAGE: f64 = 18.0;
pub const DAGGER_COOLDOWN: f64 = 0.35;
pub const HIDDEN_CRIT_MULT: f64 = 4.0;
pub const DASH_SPEED: f64 = 300.0;

const fn d(id: AbilityId, cooldown: f64, damage: f64, range: f64, arc: f64, speed: f64, radius: f64, duration: f64) -> AbilityDef {
    AbilityDef { id, cooldown, damage, range, arc, speed, radius, duration }
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
        Hide => d(id, 8.0, 0.0, 0.0, 0.0, 0.0, 0.0, 6.0),
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
    AbilityId::Hide,
];
