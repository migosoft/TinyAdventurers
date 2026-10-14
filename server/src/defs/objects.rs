//! World object definitions (see `run/objects.rs`).

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
        EntityKind::Chest => ObjDef { radius: 6.0, solid: false },
        _ => panic!("{kind:?} is not an object"),
    }
}

/// Every object is of entity type `Object` (so it resists poison fully).
pub fn profile(_kind: EntityKind) -> Profile {
    entity_types::profile(&[EntityType::Object], Adjust::NONE)
}
