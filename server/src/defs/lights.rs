//! Light kinds (data only) and which entity kinds carry a light from spawn.
//! A new light source is a new row here plus an `add_light` call
//! (`run/light.rs`), never new core code. Exported to the client as `LIGHT`.

use super::kinds::EntityKind;
use serde::Serialize;

/// 0xRRGGBB.
pub type Colour = u32;

super::enum_list::listed_enum! {
    /// `ALL` and `COUNT` grow with a new variant (`listed_enum!`).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    pub enum LightKind: u8 {
        Torch = 0,
        Lava = 1,
        Fire = 2,
        Magic = 3,
        /// The flash of an explosion (`Run::add_flash`).
        Blast = 4,
        /// The flash of a healing wave (`Run::add_flash`).
        Holy = 5,
        /// The Radiant keystone's glow around the hero.
        Radiant = 6,
        /// Sunlight through a crack in the ceiling (`Run::add_sun`).
        Daylight = 7,
    }
}

/// How long an explosion lights its surroundings (s).
pub const BLAST_FLASH: f64 = 0.4;
/// How long a healing wave lights its surroundings (s); as long as its ring.
pub const HOLY_FLASH: f64 = 0.6;

/// First guesses for the balancing pass.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct LightDef {
    /// Reach in tiles (shadowcast radius).
    pub radius: i32,
    /// Default colour; a single light can override it.
    pub colour: Colour,
    /// Brightness at the centre (0..1, client only).
    pub intensity: f64,
    /// How strongly the client wobbles it (0..1).
    pub flicker: f64,
}

pub fn def(k: LightKind) -> LightDef {
    match k {
        LightKind::Torch => LightDef { radius: 7, colour: 0xffaa5a, intensity: 1.0, flicker: 0.15 },
        LightKind::Lava => LightDef { radius: 2, colour: 0xff461e, intensity: 0.8, flicker: 0.05 },
        LightKind::Fire => LightDef { radius: 4, colour: 0xff8c3c, intensity: 0.9, flicker: 0.2 },
        LightKind::Magic => LightDef { radius: 3, colour: 0x9678ff, intensity: 0.7, flicker: 0.1 },
        LightKind::Blast => LightDef { radius: 4, colour: 0xffb060, intensity: 1.0, flicker: 0.3 },
        LightKind::Holy => LightDef { radius: 4, colour: 0xffe890, intensity: 0.9, flicker: 0.1 },
        LightKind::Radiant => LightDef { radius: 2, colour: 0xffe890, intensity: 0.6, flicker: 0.05 },
        LightKind::Daylight => LightDef { radius: 7, colour: 0xdce8ff, intensity: 0.9, flicker: 0.0 },
    }
}

/// The light an entity of this kind carries from spawn (`None` colour = the kind's).
pub fn kind_light(k: EntityKind) -> Option<(LightKind, Option<Colour>)> {
    use EntityKind as K;
    match k {
        K::Fireball | K::FireBolt | K::FireOrb | K::DragonFireball | K::FireBreath | K::FirePatch => Some((LightKind::Fire, None)),
        K::Missile | K::ChainSpark => Some((LightKind::Magic, None)),
        K::Judgement | K::HolyGround => Some((LightKind::Holy, None)),
        K::FrostBolt => Some((LightKind::Magic, Some(0x78c8ff))),
        K::ShadowBolt | K::GloomBolt => Some((LightKind::Magic, Some(0xaa3cdc))),
        K::BlindOrb => Some((LightKind::Magic, Some(0x6a3c8c))),
        K::SleepOrb => Some((LightKind::Magic, Some(0xc080ff))),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use EntityKind as K;

    #[test]
    fn daylight_is_cool_white_and_steady() {
        let d = def(LightKind::Daylight);
        assert_eq!((d.radius, d.colour, d.flicker), (7, 0xdce8ff, 0.0));
        assert!((d.intensity - 0.9).abs() < 1e-9);
        assert!(LightKind::ALL.contains(&LightKind::Daylight));
    }

    #[test]
    fn every_kind_has_a_sane_def() {
        for k in LightKind::ALL {
            let d = def(k);
            assert!(d.radius >= 1 && d.radius <= 9, "{k:?}");
            assert!(d.colour <= 0xffffff && d.intensity > 0.0 && d.intensity <= 1.0 && d.flicker >= 0.0);
        }
    }

    #[test]
    fn fire_and_magic_shots_glow_arrows_do_not() {
        for k in [K::Fireball, K::FireBolt, K::FireOrb, K::DragonFireball, K::FireBreath, K::FirePatch] {
            assert_eq!(kind_light(k), Some((LightKind::Fire, None)), "{k:?}");
        }
        assert_eq!(kind_light(K::Missile), Some((LightKind::Magic, None)));
        assert_eq!(kind_light(K::FrostBolt), Some((LightKind::Magic, Some(0x78c8ff))));
        assert_eq!(kind_light(K::GloomBolt), Some((LightKind::Magic, Some(0xaa3cdc))));
        assert!(kind_light(K::SleepOrb).is_some());
        assert_eq!(kind_light(K::ShadowBolt), Some((LightKind::Magic, Some(0xaa3cdc))));
        for k in [K::Arrow, K::Bolt, K::Wizard, K::Barrel, K::Chest, K::Ogre] {
            assert_eq!(kind_light(k), None, "{k:?}");
        }
    }
}
