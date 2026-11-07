use super::attributes::{AttrSources, Attributes};
use super::races::{self, Adjust, Race, Profile};
use super::abilities::AbilityId;
use super::items::ItemId;
use super::kinds::EntityKind;
use crate::protocol::BossId;

#[derive(Debug, Clone, Copy)]
pub struct BossDef {
    #[allow(dead_code)]
    pub id: BossId,
    pub kind: EntityKind,
    /// At the boss's own CON (10 + modifier); scaled by party size.
    pub hp: f64,
    pub radius: f64,
    /// At the boss's own CON (10 + modifier).
    pub speed: f64,
    /// The kind's modifier from 10; read the Attributes through `attrs(…)`.
    pub attr_mods: Attributes,
    /// Never pushed.
    pub weight: f64,
    /// The abilities it uses, as the scripts choose them.
    pub abilities: &'static [AbilityId],
    /// What the abilities use: the first melee weapon is the one Strike and Smash take.
    pub weapons: &'static [ItemId],
}

pub fn def(id: BossId) -> BossDef {
    use AbilityId::*;
    use ItemId::*;
    match id {
        BossId::Demon => BossDef { id, kind: EntityKind::Demon, hp: 1300.0, radius: 11.0, speed: 50.0, attr_mods: Attributes::new(12, 4, 10, 4, 6, 10), weight: 40.0, abilities: &[Strike, Swoop, RingOfFire], weapons: &[DemonClaws] },
        BossId::Lich => BossDef { id, kind: EntityKind::Lich, hp: 900.0, radius: 8.0, speed: 34.0, attr_mods: Attributes::new(0, 4, 4, 12, 8, 6), weight: 40.0, abilities: &[Nova, GloomBolts, BlindingCurse, SleepMist, StoneGaze, RaiseDead], weapons: &[] },
        BossId::Dragon => BossDef { id, kind: EntityKind::Dragon, hp: 2000.0, radius: 17.0, speed: 34.0, attr_mods: Attributes::new(14, 0, 12, 6, 4, 10), weight: 40.0, abilities: &[Strike, AbilityId::Bite, TailWhip, FireBreath, Smash, Fireball], weapons: &[DragonClaws, DragonBite, DragonTail] },
    }
}

/// The recovery after each demon attack (s), shared with the client: the animation starts with the ability's
/// wind-up (from its kit) and the strike frames play out in this short recovery. The abilities' own numbers are the kit's.
pub const DEMON_CLEAVE_RECOVER: f64 = 0.3;
pub const DEMON_SWOOP_RECOVER: f64 = 0.25;
pub const DEMON_RING_RECOVER: f64 = 0.35;

pub const LICH_DISCIPLES: usize = 6;
/// After a nova the lich waits up to this many seconds (random) on top of the Nova's cooldown, so the
/// next one is not on the beat.
pub const LICH_NOVA_EXTRA_WAIT: f64 = 2.0;

/// Flight (s), shared with the client: lifting off, hovering after the party, landing (the landing uses
/// Smash). The dragon's attacks are its kit's abilities: their numbers come from there.
pub const DRAGON_TAKEOFF: f64 = 0.5;
pub const DRAGON_FLIGHT: f64 = 3.5;
pub const DRAGON_LAND: f64 = 0.6;
/// Seconds on the ground between flights (random in this range).
pub const DRAGON_FLIGHT_EVERY: (f64, f64) = (10.0, 12.0);

/// The races of each boss.
pub fn races(id: BossId) -> &'static [Race] {
    match id {
        BossId::Demon => &[Race::Demon],
        BossId::Lich => &[Race::Undead],
        BossId::Dragon => &[Race::Dragon],
    }
}

/// The boss's Attributes: 10, its races' bonuses, its kind's modifier.
pub fn attr_sources(id: BossId) -> AttrSources {
    races::creature_sources(races(id), def(id).attr_mods)
}

pub fn attrs(id: BossId) -> Attributes {
    attr_sources(id).total()
}

/// HP at CON 10: `hp` minus `CON_HP` per point of the boss's own CON modifier.
pub fn base_hp(id: BossId) -> f64 {
    def(id).hp - super::attributes::CON_HP * (races::own_con(def(id).attr_mods) - super::attributes::BASELINE) as f64
}

/// Races plus each boss's own adjustments.
pub fn profile(id: BossId) -> Profile {
    use super::damage::{DamageType::*, Resistances};
    use super::effects::{EffectKind::*, EffectResistances as Fx};
    // Effect resistances: the user, 2026-10-15 (then immune = 1, reduced = 0.5).
    let adj = match id {
        BossId::Demon => Adjust { res: Resistances::of(&[(Magical, 0.2)]), effect_res: Fx::of(&[(Sleep, 1.0), (Fear, 0.5)]), vision: Some(25.0), darkvision: None },
        BossId::Lich => Adjust { res: Resistances::of(&[(Physical, 0.4), (Magical, 0.4)]), effect_res: Fx::of(&[(Blind, 1.0), (Petrified, 0.5)]), vision: Some(25.0), darkvision: None },
        BossId::Dragon => Adjust {
            res: Resistances::of(&[(Heat, 1.0)]),
            effect_res: Fx::of(&[(Sleep, 1.0), (Blind, 0.5), (Petrified, 0.5), (Slowed, 0.5), (Accelerated, 0.5), (Fear, 1.0)]),
            vision: Some(25.0),
            darkvision: None,
        },
    };
    races::profile(races(id), adj)
}

/// When the lich's effect spells may first come after the fight starts (s, staggered; user, 2026-10-15; tune in
/// the balancing pass). When, not how: the spells' wind-ups, cooldowns and numbers are their kit's.
pub const LICH_GLOOM_FIRST: f64 = 2.0;
pub const LICH_NOVA_FIRST: f64 = 6.0;
pub const LICH_BLIND_FIRST: f64 = 4.0;
pub const LICH_SLEEP_FIRST: f64 = 7.0;
pub const LICH_GAZE_FIRST: f64 = 9.0;
pub const LICH_RAISE_FIRST: f64 = 8.0;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::attributes::Attr;

    #[test]
    fn bosses_weigh_forty() {
        for id in BossId::ALL {
            assert_eq!(def(id).weight, 40.0, "{id:?}");
        }
        assert_eq!(attrs(BossId::Lich).get(Attr::Int), 22);
        assert_eq!(attrs(BossId::Demon), Attributes::new(22, 14, 20, 14, 16, 20));
        assert_eq!(attrs(BossId::Dragon), Attributes::new(24, 10, 22, 16, 14, 20));
        assert_eq!(attrs(BossId::Lich), Attributes::new(10, 14, 14, 22, 18, 16));
    }
}
