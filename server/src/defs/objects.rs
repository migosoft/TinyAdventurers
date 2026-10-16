//! World object definitions (see `run/objects.rs`).

use super::damage::{Damage, DamageSplit, DamageType};
use super::entity_types::{self, Adjust, EntityType, Profile};
use super::kinds::EntityKind;

#[derive(Debug, Clone, Copy)]
pub struct ObjDef {
    /// Footprint: a circle for touching and shots, a square of this half size when solid.
    pub radius: f64,
    /// Blocks movement and shots.
    pub solid: bool,
}

pub fn def(kind: EntityKind) -> ObjDef {
    match kind {
        EntityKind::Chest => ObjDef { radius: CHEST_RADIUS, solid: false },
        EntityKind::Barrel => ObjDef { radius: BARREL_RADIUS, solid: true },
        EntityKind::Torch => ObjDef { radius: TORCH_RADIUS, solid: false },
        _ => panic!("{kind:?} is not an object"),
    }
}

/// Chest footprint: the same as the mimic's, so shots and the dagger treat both alike.
pub const CHEST_RADIUS: f64 = 6.0;
/// Barrels (first guesses for the balancing pass).
pub const BARREL_RADIUS: f64 = 6.0;
/// Torch footprint (hits and hand reach); it hangs on the wall, nothing collides with it.
pub const TORCH_RADIUS: f64 = 4.0;
/// Seconds from the first hit to the explosion; also the delay per link of a chain.
pub const BARREL_FUSE: f64 = 0.3;
pub const BARREL_BLAST_R: f64 = 40.0;
pub const BARREL_BLAST_DAMAGE: f64 = 30.0;
pub const BARREL_BLAST_KNOCK: f64 = 40.0;
/// How far a push with E slides a barrel (px).
pub const BARREL_PUSH: f64 = 48.0;
/// Share of a chest's coins the party still gets when the chest is smashed.
pub const BROKEN_CHEST_SHARE: f64 = 1.0 / 3.0;
/// Hand reach for using an object: gap (px) between the hero's and the object's footprints.
pub const USE_REACH: f64 = 6.0;

pub fn barrel_blast() -> Damage {
    Damage::new(BARREL_BLAST_DAMAGE, DamageSplit::split(&[(DamageType::Heat, 0.5)]))
}

/// Every object is of entity type `Object` (so it resists poison fully).
pub fn profile(_kind: EntityKind) -> Profile {
    entity_types::profile(&[EntityType::Object], Adjust::NONE)
}
