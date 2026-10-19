//! The Elven Ranger's wolf: the numbers of an ally monster (run/companion.rs).

use super::attributes::Attributes;
use super::damage::{DamageType::Cold, Resistances};
use super::races::{self, Adjust, Race, Profile};

pub const WOLF_HP: f64 = 80.0;
/// The stat block (spec section 7): saves and push power. HP, speed, bite and dash keep the `WOLF_*` numbers.
pub const WOLF_ATTRS: Attributes = Attributes::new(17, 15, 15, 3, 12, 7);
pub const WOLF_WEIGHT: f64 = 10.0;
pub const WOLF_SPEED: f64 = 88.0;
pub const WOLF_RADIUS: f64 = 5.0;
pub const WOLF_BITE_DAMAGE: f64 = 10.0;
pub const WOLF_BITE_COOLDOWN: f64 = 0.9;
pub const WOLF_BITE_KNOCK: f64 = 8.0;
pub const WOLF_BITE_RANGE: f64 = 14.0;
pub const WOLF_BITE_WINDUP: f64 = 0.2;
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
/// How often (s) it checks that it can still reach the ranger (a sealed door: it reappears).
pub const WOLF_REACH_EVERY: f64 = 0.5;
pub const WOLF_GROWL_EVERY: f64 = 4.0;
pub const WOLF_GROWL_STEP: f64 = 24.0;
pub const WOLF_HEAL_SHARE: f64 = 0.2;
pub const WOLF_DEAD_COOLDOWN: f64 = 60.0;
pub const WOLF_DASH_RANGE: f64 = 64.0;
/// The Barbarian's dash speed (300).
pub const WOLF_DASH_SPEED: f64 = crate::defs::abilities::DASH_SPEED;
pub const WOLF_DASH_DAMAGE: f64 = 20.0;
pub const WOLF_DASH_KNOCK: f64 = 12.0;
pub const WOLF_DASH_COOLDOWN: f64 = 5.0;

/// HP before the CON bonus (55): `WOLF_HP` minus 5 per CON point above 10.
pub fn wolf_base_hp() -> f64 {
    WOLF_HP - 5.0 * (15 - 10) as f64
}

/// A magical beast with 20 % extra cold resistance.
pub fn wolf_profile() -> Profile {
    races::profile(&[Race::MagicalBeast], Adjust { res: Resistances::of(&[(Cold, 0.2)]), ..Adjust::NONE })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::attributes;

    #[test]
    fn wolf_stat_block_keeps_todays_hp() {
        assert_eq!(attributes::hp(wolf_base_hp(), 15), WOLF_HP);
        assert_eq!(WOLF_WEIGHT, 10.0);
    }
}
