//! How an ability looks when a figure uses it: the projectile, the burst, the flash. A look never
//! changes a number: the rules read the ability's numbers and only the spawn and event code reads a
//! `Look`. An ability has one look for every figure unless the table below says otherwise.

use super::abilities::AbilityId;
use super::kinds::EntityKind;
use super::lights::LightKind;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Look {
    /// The projectile drawn, instead of the ability's or weapon's own.
    pub projectile: Option<EntityKind>,
    /// The `Ev::Boom` kind of its burst; 0 for none.
    pub boom: u8,
    /// The light that flashes where it lands.
    pub light: Option<LightKind>,
    /// The colour of that flash, instead of the light's own.
    pub tint: Option<u32>,
}

/// An ability's look for the heroes (and for everyone it is not overridden for).
pub fn default_look(id: AbilityId) -> Look {
    use AbilityId::*;
    let look = |boom, light, tint| Look { projectile: None, boom, light, tint };
    match id {
        HolyLight => look(1, Some(LightKind::Holy), None),
        GroundSlam | Smash => look(5, None, None),
        FrostNova => look(10, Some(LightKind::Magic), Some(super::abilities::NOVA_TINT)),
        WarCry => look(11, None, None),
        RingOfFire => look(2, None, None),
        Nova => look(6, None, None),
        Haste => look(12, None, None),
        Purify => look(13, Some(LightKind::Holy), None),
        Smite => look(0, Some(LightKind::Holy), None),
        MagicMissile | Fireball | Strike | Charge | Shoot | SummonWolf | FrostShard | ChainSpark | Judgement | Hurl | Volley | Whirl | FlankingThrust | PoisonCoat | Consecrate
        | Entangle | Bite | ShadowBolt | FireBolt | Pounce | TailWhip | FireBreath | Swoop | GloomBolts | BlindingCurse | SleepMist | StoneGaze => look(0, None, None),
    }
}

/// The look of `id` when `figure` uses it.
pub fn look(figure: EntityKind, id: AbilityId) -> Look {
    match (figure, id) {
        // The ogre's slam kicks up dust, not a hero's flash.
        (EntityKind::Ogre, AbilityId::GroundSlam) => Look { tint: Some(0x8b6b4a), ..default_look(id) },
        // The dragon's fireball is its own ball, bursting with the boss shockwave of the old volley.
        (EntityKind::Dragon, AbilityId::Fireball) => Look { projectile: Some(EntityKind::DragonFireball), boom: 4, ..default_look(id) },
        _ => default_look(id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_figure_without_an_entry_looks_like_the_default() {
        for id in AbilityId::ALL {
            assert_eq!(look(EntityKind::SkeletonWarrior, id), default_look(id), "{id:?}");
        }
    }
}
