//! The Elven Ranger's wolf: the numbers of an ally monster (run/wolf.rs).

use super::attributes::{self, AttrSources, Attributes};
use super::damage::{DamageType::Cold, Resistances};
use super::races::{self, Adjust, Race, Profile};

pub const WOLF_HP: f64 = 80.0;
/// The wolf's modifier from 10; read the Attributes through `wolf_attrs()`. HP and speed (at its own CON) keep the `WOLF_*` numbers; its Bite and Pounce are abilities (`sheet::kit_for`).
pub const WOLF_ATTR_MODS: Attributes = Attributes::new(7, 5, 5, -7, 2, -3);
pub const WOLF_WEIGHT: f64 = 10.0;
pub const WOLF_SPEED: f64 = 88.0;
pub const WOLF_RADIUS: f64 = 5.0;
/// Starts following beyond 2 tiles, stops inside 20 px.
pub const WOLF_FOLLOW: f64 = 32.0;
pub const WOLF_FOLLOW_STOP: f64 = 20.0;
/// Enemies this close to the ranger are bitten...
pub const WOLF_GUARD: f64 = 48.0;
/// ...and enemies this close to the wolf (it fights back).
pub const WOLF_DEFEND: f64 = 24.0;
/// It never chases farther than this from the ranger.
pub const WOLF_LEASH: f64 = 96.0;
pub const WOLF_REAPPEAR: f64 = 192.0;
/// How often (s) a companion checks that it can still reach its leader (a sealed door: it reappears).
pub const COMPANION_REACH_EVERY: f64 = 0.5;
pub const WOLF_HEAL_SHARE: f64 = 0.2;
pub const WOLF_DEAD_COOLDOWN: f64 = 60.0;

/// How a companion behaves around its leader: the numbers of the shared follow script (run/companion.rs).
#[derive(Debug)]
pub struct Escort {
    /// Starts following beyond this distance, stops inside `follow_stop`.
    pub follow: f64,
    pub follow_stop: f64,
    /// Enemies this close to the leader are attacked...
    pub guard: f64,
    /// ...and enemies this close to the companion (it fights back).
    pub defend: f64,
    /// It never chases farther than this from the leader.
    pub leash: f64,
    /// Beyond this distance from the leader it reappears beside them.
    pub reappear: f64,
}

pub const WOLF_ESCORT: Escort = Escort { follow: WOLF_FOLLOW, follow_stop: WOLF_FOLLOW_STOP, guard: WOLF_GUARD, defend: WOLF_DEFEND, leash: WOLF_LEASH, reappear: WOLF_REAPPEAR };

/// The knight (#149): a first guess (label `balancing`), a little wider than the wolf's since it fights in melee.
pub const KNIGHT_ESCORT: Escort = Escort { follow: 40.0, follow_stop: 24.0, guard: 64.0, defend: 28.0, leash: 128.0, reappear: 192.0 };

/// HP at CON 10 (55): `WOLF_HP` minus `CON_HP` per point of the wolf's own CON modifier.
pub fn wolf_base_hp() -> f64 {
    WOLF_HP - attributes::CON_HP * (races::own_con(WOLF_ATTR_MODS) - attributes::BASELINE) as f64
}

/// The wolf is a magical beast.
pub fn wolf_races() -> &'static [Race] {
    &[Race::MagicalBeast]
}

/// The wolf's Attributes: 10, its race's bonuses, its modifier.
pub fn wolf_attr_sources() -> AttrSources {
    races::creature_sources(wolf_races(), WOLF_ATTR_MODS)
}

pub fn wolf_attrs() -> Attributes {
    wolf_attr_sources().total()
}

/// A magical beast with 20 % extra cold resistance.
pub fn wolf_profile() -> Profile {
    races::profile(wolf_races(), Adjust { res: Resistances::of(&[(Cold, 0.2)]), ..Adjust::NONE })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_wolf_is_a_magical_beast_with_int_6() {
        assert_eq!(wolf_attrs(), Attributes::new(17, 15, 15, 6, 12, 7));
    }

    #[test]
    fn wolf_stat_block_keeps_todays_hp() {
        assert_eq!(attributes::hp(wolf_base_hp(), races::own_con(WOLF_ATTR_MODS)), WOLF_HP);
        assert_eq!(WOLF_WEIGHT, 10.0);
    }
}
