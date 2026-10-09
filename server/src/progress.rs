//! A character's progression, stored as one JSONB document (`characters.progress`).
//! The document is schemaless in the database: adding a field here needs no SQL
//! migration (old rows get the `serde(default)`), and a structural change bumps
//! `CURRENT_VERSION` and adds a step to `upgrade`. Old rows are converted when
//! they are read and written back on the next save.

use crate::defs::progression::{cost_table, upgrade_cost, StatUpgrades, UpgradeStat, MAX_LEVEL};
use crate::protocol::{CharacterInfo, ClassId};
use serde::{Deserialize, Serialize};

pub const CURRENT_VERSION: u32 = 1;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Progress {
    /// Document format version (see `upgrade`).
    pub version: u32,
    /// Bumped on every save, so a cached copy can tell which of two is newer.
    pub rev: u64,
    /// Unspent XP.
    pub xp: u32,
    /// All XP ever earned.
    pub total_xp: u32,
    /// Unspent coins.
    pub coins: u32,
    pub upgrades: StatUpgrades,
}

impl Progress {
    pub fn new() -> Progress {
        Progress { version: CURRENT_VERSION, ..Default::default() }
    }

    /// Reads a stored document; anything unreadable starts fresh rather than
    /// locking the character out (the error is logged).
    pub fn from_json(value: serde_json::Value) -> Progress {
        let mut p = serde_json::from_value::<Progress>(value).unwrap_or_else(|e| {
            tracing::error!("unreadable progress document: {e}");
            Progress::default()
        });
        p.upgrade();
        p
    }

    pub fn to_json(&self) -> serde_json::Value {
        serde_json::to_value(self).expect("progress to json")
    }

    /// Converts older document versions step by step to `CURRENT_VERSION`.
    fn upgrade(&mut self) {
        // Version 0 = a document written before versioning (or `{}`): same fields.
        if self.version < 1 {
            self.version = 1;
        }
    }

    /// Banks what a run earned.
    pub fn bank(&mut self, xp: u32, coins: u32) {
        self.xp = self.xp.saturating_add(xp);
        self.total_xp = self.total_xp.saturating_add(xp);
        self.coins = self.coins.saturating_add(coins);
    }

    /// Buys the next level of a stat with XP.
    pub fn buy(&mut self, stat: UpgradeStat) -> Result<(), &'static str> {
        let level = *self.upgrades.level_mut(stat);
        if level >= MAX_LEVEL {
            return Err("That stat is already at the maximum level.");
        }
        let cost = upgrade_cost(level);
        if self.xp < cost {
            return Err("Not enough XP.");
        }
        self.xp -= cost;
        *self.upgrades.level_mut(stat) += 1;
        Ok(())
    }

    pub fn info(&self, id: i32, name: &str, class: ClassId) -> CharacterInfo {
        CharacterInfo {
            id,
            name: name.to_string(),
            class,
            xp: self.xp,
            total_xp: self.total_xp,
            coins: self.coins,
            upgrades: self.upgrades,
            mods: self.upgrades.modifiers(),
            costs: cost_table(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn buying_costs_xp_and_respects_limits() {
        let mut p = Progress::new();
        assert!(p.buy(UpgradeStat::Damage).is_err(), "no XP yet");
        p.bank(upgrade_cost(0) + 10, 3);
        p.buy(UpgradeStat::Damage).unwrap();
        assert_eq!(p.xp, 10);
        assert_eq!(p.total_xp, upgrade_cost(0) + 10);
        assert_eq!(p.coins, 3);
        assert_eq!(p.upgrades.damage, 1);
        assert!(p.info(1, "a", ClassId::Wizard).mods.damage > 1.0);

        p.bank(1_000_000, 0);
        for _ in 0..MAX_LEVEL {
            let _ = p.buy(UpgradeStat::Armor);
        }
        assert_eq!(p.upgrades.armor, MAX_LEVEL);
        assert!(p.buy(UpgradeStat::Armor).is_err(), "max level");
    }

    #[test]
    fn banking_saturates() {
        let mut p = Progress::new();
        p.bank(u32::MAX, u32::MAX);
        p.bank(5, 5);
        assert_eq!((p.xp, p.total_xp, p.coins), (u32::MAX, u32::MAX, u32::MAX));
    }

    #[test]
    fn old_and_partial_documents_are_read_with_defaults() {
        let empty = Progress::from_json(json!({}));
        assert_eq!(empty, Progress::new());

        // A pre-versioning document with only some fields and an unknown one.
        let old = Progress::from_json(json!({ "xp": 40, "upgrades": { "life": 2 }, "talents": [1, 2] }));
        assert_eq!(old.version, CURRENT_VERSION);
        assert_eq!(old.xp, 40);
        assert_eq!(old.upgrades.life, 2);
        assert_eq!(old.upgrades.damage, 0);

        let broken = Progress::from_json(json!({ "xp": "lots" }));
        assert_eq!(broken, Progress::new());
    }

    #[test]
    fn json_roundtrip() {
        let mut p = Progress::new();
        p.bank(500, 20);
        p.buy(UpgradeStat::MoveSpeed).unwrap();
        p.rev = 7;
        assert_eq!(Progress::from_json(p.to_json()), p);
    }
}
