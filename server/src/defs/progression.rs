//! Progression: players earn XP during runs; it is banked in their profile
//! (`crate::profiles`) when the run ends and spent on permanent stat upgrades
//! in the lobby. The simulation reads every upgraded stat through `Modifiers`.

use super::enemies::EnemyType;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Upgrade levels a player has bought (persisted in the profile).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StatUpgrades {
    pub damage: u8,
    pub attack_speed: u8,
    pub move_speed: u8,
    pub life: u8,
    pub armor: u8,
}

/// Effective multipliers applied by the simulation. Sent to the owning
/// client in `RunStartInfo` so its prediction (speed, cooldowns) matches.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct Modifiers {
    /// Multiplies all damage dealt.
    pub damage: f64,
    /// Divides ability cooldowns (1.2 = 20% faster attacks).
    pub attack_speed: f64,
    /// Multiplies movement speed.
    pub move_speed: f64,
    /// Multiplies maximum life.
    pub life: f64,
    /// Fraction of incoming damage ignored (0..0.6).
    pub armor: f64,
}

impl Default for Modifiers {
    fn default() -> Self {
        Modifiers { damage: 1.0, attack_speed: 1.0, move_speed: 1.0, life: 1.0, armor: 0.0 }
    }
}

pub const MAX_LEVEL: u8 = 10;

/// A stat that can be upgraded with XP.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum UpgradeStat {
    Damage,
    AttackSpeed,
    MoveSpeed,
    Life,
    Armor,
}

impl StatUpgrades {
    pub fn level_mut(&mut self, stat: UpgradeStat) -> &mut u8 {
        match stat {
            UpgradeStat::Damage => &mut self.damage,
            UpgradeStat::AttackSpeed => &mut self.attack_speed,
            UpgradeStat::MoveSpeed => &mut self.move_speed,
            UpgradeStat::Life => &mut self.life,
            UpgradeStat::Armor => &mut self.armor,
        }
    }

    pub fn modifiers(&self) -> Modifiers {
        let l = |v: u8| v.min(MAX_LEVEL) as f64;
        Modifiers {
            damage: 1.0 + 0.08 * l(self.damage),
            attack_speed: 1.0 + 0.06 * l(self.attack_speed),
            move_speed: 1.0 + 0.04 * l(self.move_speed),
            life: 1.0 + 0.10 * l(self.life),
            armor: (0.04 * l(self.armor)).min(0.6),
        }
    }
}

/// XP cost of buying the next level.
pub fn upgrade_cost(current_level: u8) -> u32 {
    100 + 75 * current_level as u32
}

/// Cost of each level, indexed by the current level (sent to clients).
pub fn cost_table() -> Vec<u32> {
    (0..MAX_LEVEL).map(upgrade_cost).collect()
}

/// XP awarded to every living party member for a kill.
pub fn xp_for_kill(enemy: Option<EnemyType>) -> u32 {
    use EnemyType::*;
    match enemy {
        Some(GoblinArcher) => 5,
        Some(SkeletonWarrior) | Some(SkeletonArcher) => 8,
        Some(RaisedSkeleton) => 2,
        Some(OrcWarrior) | Some(OrcArcher) => 12,
        Some(Necromancer) => 25,
        Some(Disciple) => 20,
        Some(Mimic) => 15,
        Some(Imp) | Some(Chort) => 8,
        Some(SummonedImp) => 2,
        Some(Summoner) => 25,
        None => 300, // boss
    }
}

/// Coins every living party member gets for opening a chest.
pub const CHEST_COINS: std::ops::RangeInclusive<u32> = 8..=15;

/// Coins every living party member gets for a kill (most enemies carry none).
pub fn coins_for_kill(enemy: Option<EnemyType>) -> u32 {
    match enemy {
        Some(EnemyType::Mimic) => 25,
        None => 50, // boss
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_upgrades_means_neutral_modifiers() {
        assert_eq!(StatUpgrades::default().modifiers(), Modifiers::default());
        let m = StatUpgrades { armor: 50, ..Default::default() }.modifiers();
        assert!(m.armor <= 0.6);
    }
}
