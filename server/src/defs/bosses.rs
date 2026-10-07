use super::kinds::EntityKind;
use crate::protocol::BossId;

#[derive(Debug, Clone, Copy)]
pub struct BossDef {
    #[allow(dead_code)]
    pub id: BossId,
    pub kind: EntityKind,
    /// Base HP for one player; scaled by party size.
    pub hp: f64,
    pub radius: f64,
    pub speed: f64,
}

pub fn def(id: BossId) -> BossDef {
    match id {
        BossId::Demon => BossDef { id, kind: EntityKind::Demon, hp: 1300.0, radius: 11.0, speed: 50.0 },
        BossId::Lich => BossDef { id, kind: EntityKind::Lich, hp: 900.0, radius: 8.0, speed: 34.0 },
        BossId::Dragon => BossDef { id, kind: EntityKind::Dragon, hp: 2000.0, radius: 17.0, speed: 34.0 },
    }
}

/// HP multiplier for party size.
pub fn hp_scale(players: usize) -> f64 {
    0.5 + 0.5 * players.max(1) as f64
}

pub const LICH_DISCIPLES: usize = 6;
/// HP per second the lich drains from each living disciple.
pub const LICH_DRAIN_PER_DISCIPLE: f64 = 6.0;
