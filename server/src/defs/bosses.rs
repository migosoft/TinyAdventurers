use super::attributes::Attributes;
use super::races::{self, Adjust, Race, Profile};
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
    /// For effect power and saves (the scripts keep their own constants).
    pub attrs: Attributes,
    /// Never pushed.
    pub weight: f64,
}

pub fn def(id: BossId) -> BossDef {
    match id {
        BossId::Demon => BossDef { id, kind: EntityKind::Demon, hp: 1300.0, radius: 11.0, speed: 50.0, attrs: Attributes::new(22, 14, 20, 14, 16, 20), weight: 40.0 },
        BossId::Lich => BossDef { id, kind: EntityKind::Lich, hp: 900.0, radius: 8.0, speed: 34.0, attrs: Attributes::new(10, 14, 14, 22, 18, 16), weight: 40.0 },
        BossId::Dragon => BossDef { id, kind: EntityKind::Dragon, hp: 2000.0, radius: 17.0, speed: 34.0, attrs: Attributes::new(24, 10, 22, 16, 14, 20), weight: 40.0 },
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

/// Race plus each boss's own adjustments.
pub fn profile(id: BossId) -> Profile {
    use super::damage::{DamageSplit, DamageType::*, Resistances};
    let (ty, adj) = match id {
        BossId::Demon => (Race::Demon, Adjust { res: Resistances::of(&[(Magical, 0.2)]), melee: None, vision: Some(25.0), darkvision: None }),
        BossId::Lich => (Race::Undead, Adjust { res: Resistances::of(&[(Physical, 0.4), (Magical, 0.4)]), melee: None, vision: Some(25.0), darkvision: None }),
        BossId::Dragon => (Race::Dragon, Adjust { res: Resistances::of(&[(Heat, 1.0)]), melee: Some(DamageSplit::split(&[(Heat, 0.2)])), vision: Some(25.0), darkvision: None }),
    };
    races::profile(&[ty], adj)
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

/// Lich effect spells (user, 2026-10-15; tune in the balancing pass). Wind-up,
/// cooldown and when the first one may come after the fight starts (s, staggered).
pub const LICH_BLIND_WINDUP: f64 = 0.6;
pub const LICH_BLIND_COOLDOWN: f64 = 10.0;
pub const LICH_BLIND_FIRST: f64 = 4.0;
pub const LICH_BLIND_DAMAGE: f64 = 6.0;
pub const LICH_BLIND_SECS: f64 = 3.0;
pub const LICH_SLEEP_WINDUP: f64 = 0.8;
pub const LICH_SLEEP_COOLDOWN: f64 = 14.0;
pub const LICH_SLEEP_FIRST: f64 = 7.0;
pub const LICH_SLEEP_SECS: f64 = 4.0;
pub const LICH_GAZE_WINDUP: f64 = 1.0;
pub const LICH_GAZE_COOLDOWN: f64 = 18.0;
pub const LICH_GAZE_FIRST: f64 = 9.0;
pub const LICH_GAZE_SECS: f64 = 3.0;
/// Speed of the blinding and sleep orbs (px/s): slow enough to dodge.
pub const LICH_ORB_SPEED: f64 = 90.0;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::attributes::Attr;

    #[test]
    fn bosses_weigh_forty() {
        for id in BossId::ALL {
            assert_eq!(def(id).weight, 40.0, "{id:?}");
        }
        assert_eq!(def(BossId::Lich).attrs.get(Attr::Int), 22);
        assert_eq!(def(BossId::Demon).attrs, Attributes::new(22, 14, 20, 14, 16, 20));
        assert_eq!(def(BossId::Dragon).attrs, Attributes::new(24, 10, 22, 16, 14, 20));
        assert_eq!(def(BossId::Lich).attrs, Attributes::new(10, 14, 14, 22, 18, 16));
    }
}
