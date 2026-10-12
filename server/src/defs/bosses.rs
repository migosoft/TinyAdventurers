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

/// Dragon timings (s), shared with the client: the wind-up of each attack
/// starts its animation, the hit lands at the end of it.
pub const DRAGON_CLAW_WINDUP: f64 = 0.4;
pub const DRAGON_BITE_WINDUP: f64 = 0.45;
pub const DRAGON_TAIL_WINDUP: f64 = 0.4;
pub const DRAGON_BREATH_WINDUP: f64 = 0.8;
pub const DRAGON_BREATH_TIME: f64 = 1.4;
/// Flight: lifting off, hovering after the party, landing (the landing is a ground smash).
pub const DRAGON_TAKEOFF: f64 = 0.5;
pub const DRAGON_FLIGHT: f64 = 3.5;
pub const DRAGON_LAND: f64 = 0.6;
/// Seconds on the ground between flights (random in this range).
pub const DRAGON_FLIGHT_EVERY: (f64, f64) = (10.0, 12.0);
/// Landing smash: hits heroes within this radius (px) and pushes them straight away.
pub const DRAGON_SMASH_RADIUS: f64 = 40.0;
pub const DRAGON_SMASH_DAMAGE: f64 = 22.0;
pub const DRAGON_SMASH_KNOCK: f64 = 36.0;
/// Pushes (px): front claw, tail swipe, fireball explosion.
pub const DRAGON_CLAW_KNOCK: f64 = 32.0;
/// Bite: straight ahead (narrow arc), reaches further than the claw (the neck stretches).
pub const DRAGON_BITE_RANGE: f64 = 46.0;
pub const DRAGON_BITE_HALF_ANGLE: f64 = 0.35;
pub const DRAGON_BITE_DAMAGE: f64 = 28.0;
pub const DRAGON_BITE_KNOCK: f64 = 24.0;
pub const DRAGON_BITE_COOLDOWN: f64 = 3.0;
pub const DRAGON_TAIL_KNOCK: f64 = 44.0;
pub const DRAGON_FIREBALL_KNOCK: f64 = 20.0;
