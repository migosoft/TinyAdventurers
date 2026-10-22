//! Progression rewards: players earn XP and coins during runs; they are banked on
//! their character (`crate::progress`) when the run ends and spent in the lobby.

use super::enemies::EnemyType;

/// XP awarded to every living party member for a kill.
pub fn xp_for_kill(enemy: Option<EnemyType>) -> u32 {
    use EnemyType::*;
    match enemy {
        Some(GoblinArcher) => 5,
        Some(SkeletonWarrior) | Some(SkeletonArcher) => 8,
        Some(RaisedSkeleton) | Some(RaisedArcher) => 2,
        Some(OrcWarrior) | Some(OrcArcher) => 12,
        Some(Necromancer) => 25,
        Some(Disciple) => 20,
        Some(Mimic) => 15,
        Some(Imp) | Some(Chort) => 8,
        Some(SummonedImp) => 2,
        Some(Summoner) => 25,
        Some(Ogre) => 60,
        None => 300, // boss
    }
}

/// Coins every living party member gets for opening a chest.
pub const CHEST_COINS: std::ops::RangeInclusive<u32> = 8..=15;

/// Coins every living party member gets for a kill (most enemies carry none).
pub fn coins_for_kill(enemy: Option<EnemyType>) -> u32 {
    match enemy {
        Some(EnemyType::Mimic) => 25,
        Some(EnemyType::Ogre) => 30,
        None => 50, // boss
        _ => 0,
    }
}
