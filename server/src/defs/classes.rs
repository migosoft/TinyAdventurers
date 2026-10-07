use super::abilities::AbilityId;
use super::kinds::EntityKind;
use crate::protocol::ClassId;
use serde::Serialize;

pub const PLAYER_RADIUS: f64 = 5.0;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct ClassDef {
    pub class: ClassId,
    #[serde(skip)]
    pub kind: EntityKind,
    pub hp: f64,
    pub speed: f64,
    pub primary: AbilityId,
    pub secondary: AbilityId,
}

pub fn def(class: ClassId) -> ClassDef {
    use AbilityId::*;
    match class {
        ClassId::Wizard => ClassDef { class, kind: EntityKind::Wizard, hp: 70.0, speed: 72.0, primary: MagicMissile, secondary: Fireball },
        ClassId::Paladin => ClassDef { class, kind: EntityKind::Paladin, hp: 120.0, speed: 66.0, primary: Sword, secondary: Heal },
        ClassId::Barbarian => ClassDef { class, kind: EntityKind::Barbarian, hp: 140.0, speed: 70.0, primary: Axe, secondary: Dash },
        ClassId::Assassin => {
            ClassDef { class, kind: EntityKind::Assassin, hp: 90.0, speed: 80.0, primary: CrossbowDagger, secondary: Hide }
        }
    }
}
