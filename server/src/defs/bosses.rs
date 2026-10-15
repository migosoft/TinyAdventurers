use super::entity_types::{self, Adjust, EntityType, Profile};
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

/// Demon timings (s), shared with the client: each attack's animation starts
/// with its wind-up (the hit lands at the end of it), then the strike frames
/// play out in a short recovery. Enraged, every timer runs at
/// 1 / DEMON_ENRAGED_PACE speed, so these last DEMON_ENRAGED_PACE times as long.
pub const DEMON_CLEAVE_WINDUP: f64 = 0.45;
pub const DEMON_SWOOP_WINDUP: f64 = 0.6;
pub const DEMON_SWOOP_TIME: f64 = 0.55;
pub const DEMON_RING_WINDUP: f64 = 0.5;
pub const DEMON_CLEAVE_RECOVER: f64 = 0.3;
pub const DEMON_SWOOP_RECOVER: f64 = 0.25;
pub const DEMON_RING_RECOVER: f64 = 0.35;
pub const DEMON_ENRAGED_PACE: f64 = 0.6;
/// Knockback (px): heroes hit by the cleave or the swoop slide this far away from the
/// demon. Its melee hits push hard (the user asked for "significant knockback").
pub const DEMON_CLEAVE_KNOCK: f64 = 56.0;
pub const DEMON_SWOOP_KNOCK: f64 = 64.0;

pub const LICH_DISCIPLES: usize = 6;
/// HP per second the lich drains from each living disciple.
pub const LICH_DRAIN_PER_DISCIPLE: f64 = 6.0;
/// Lich nova: every LICH_NOVA_EVERY s (random in the range) it stands still for
/// LICH_NOVA_WINDUP s (a ring telegraph fills up), then a dark burst hits every
/// hero within LICH_NOVA_RADIUS (px, hero centres) and pushes them straight away.
pub const LICH_NOVA_EVERY: (f64, f64) = (10.0, 12.0);
pub const LICH_NOVA_WINDUP: f64 = 1.2;
pub const LICH_NOVA_RADIUS: f64 = 56.0;
pub const LICH_NOVA_DAMAGE: f64 = 24.0;
pub const LICH_NOVA_KNOCK: f64 = 64.0;
/// Each summon tops the lich's raised skeletons up to this many of each kind.
pub const LICH_SKELETONS: usize = 5;
pub const LICH_ARCHERS: usize = 5;

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

/// Entity type plus each boss's own adjustments.
pub fn profile(id: BossId) -> Profile {
    use super::damage::{DamageSplit, DamageType::*, Resistances};
    let (ty, adj) = match id {
        BossId::Demon => (EntityType::Demon, Adjust { res: Resistances::of(&[(Magical, 0.2)]), melee: None, vision: Some(25.0), darkvision: None }),
        BossId::Lich => (EntityType::Undead, Adjust { res: Resistances::of(&[(Physical, 0.4), (Magical, 0.4)]), melee: None, vision: Some(25.0), darkvision: None }),
        BossId::Dragon => (EntityType::Dragon, Adjust { res: Resistances::of(&[(Heat, 1.0)]), melee: Some(DamageSplit::split(&[(Heat, 0.2)])), vision: Some(25.0), darkvision: None }),
    };
    entity_types::profile(&[ty], adj)
}

/// How each boss takes effects (user, 2026-10-15). Everyone else takes them in full.
pub fn responses(id: BossId) -> crate::defs::effects::EffectResponses {
    use crate::defs::effects::{EffectKind::*, EffectResponse::*, EffectResponses};
    match id {
        BossId::Lich => EffectResponses::of(&[(Sleep, Immune), (Blind, Immune), (Petrified, Reduced)]),
        BossId::Dragon => EffectResponses::of(&[(Sleep, Immune), (Blind, Reduced), (Petrified, Reduced), (Slowed, Reduced), (Accelerated, Reduced)]),
        BossId::Demon => EffectResponses::of(&[(Sleep, Immune)]),
    }
}
