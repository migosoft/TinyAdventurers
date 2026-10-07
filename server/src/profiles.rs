//! Persistent player profiles: banked XP and coins and bought upgrades, keyed by an
//! anonymous token the client keeps in localStorage. Stored as one JSON file
//! (`PROFILE_PATH`) that is rewritten atomically (tmp + rename) on changes.

use crate::defs::progression::{cost_table, upgrade_cost, StatUpgrades, UpgradeStat, MAX_LEVEL};
use crate::protocol::ProfileInfo;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Profile {
    /// Unspent XP.
    pub xp: u32,
    /// All XP ever earned.
    #[serde(default)]
    pub total_xp: u32,
    #[serde(default)]
    pub upgrades: StatUpgrades,
    /// Unspent coins.
    #[serde(default)]
    pub coins: u32,
}

impl Profile {
    fn is_empty(&self) -> bool {
        *self == Profile::default()
    }
}

pub struct ProfileStore {
    /// `None` keeps profiles in memory only (tests).
    path: Option<PathBuf>,
    profiles: HashMap<String, Profile>,
}

fn valid_token(t: &str) -> bool {
    t.len() == 32 && t.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn new_token() -> String {
    format!("{:032x}", rand::random::<u128>())
}

impl ProfileStore {
    pub fn in_memory() -> ProfileStore {
        ProfileStore { path: None, profiles: HashMap::new() }
    }

    /// Loads the store. A missing file starts empty; an unreadable one is
    /// moved aside (never overwritten) and the store starts empty.
    pub fn load(path: PathBuf) -> ProfileStore {
        let profiles = match std::fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<HashMap<String, Profile>>(&text) {
                Ok(p) => p.into_iter().filter(|(t, _)| valid_token(t)).collect(),
                Err(e) => {
                    let aside = path.with_extension(format!("corrupt-{}", std::process::id()));
                    tracing::error!("cannot parse {}: {e}; moving it to {}", path.display(), aside.display());
                    let _ = std::fs::rename(&path, &aside);
                    HashMap::new()
                }
            },
            Err(_) => HashMap::new(),
        };
        tracing::info!("{} profile(s) loaded from {}", profiles.len(), path.display());
        ProfileStore { path: Some(path), profiles }
    }

    /// Returns the token to use for a connection: the client's own if it is
    /// well-formed (an unknown one gets a fresh profile), else a new one.
    pub fn resolve(&mut self, token: Option<&str>) -> String {
        let token = match token {
            Some(t) if valid_token(t) => t.to_string(),
            _ => new_token(),
        };
        self.profiles.entry(token.clone()).or_default();
        token
    }

    pub fn upgrades(&self, token: &str) -> StatUpgrades {
        self.profiles.get(token).map(|p| p.upgrades).unwrap_or_default()
    }

    pub fn info(&self, token: &str) -> ProfileInfo {
        let p = self.profiles.get(token).cloned().unwrap_or_default();
        ProfileInfo { token: token.to_string(), xp: p.xp, coins: p.coins, upgrades: p.upgrades, mods: p.upgrades.modifiers(), costs: cost_table() }
    }

    /// Banks XP earned in a run (call `save` afterwards).
    pub fn add_xp(&mut self, token: &str, xp: u32) {
        if xp == 0 {
            return;
        }
        let p = self.profiles.entry(token.to_string()).or_default();
        p.xp = p.xp.saturating_add(xp);
        p.total_xp = p.total_xp.saturating_add(xp);
    }

    /// Banks coins earned in a run (call `save` afterwards).
    pub fn add_coins(&mut self, token: &str, coins: u32) {
        if coins == 0 {
            return;
        }
        let p = self.profiles.entry(token.to_string()).or_default();
        p.coins = p.coins.saturating_add(coins);
    }

    /// Buys the next level of a stat and saves.
    pub fn buy(&mut self, token: &str, stat: UpgradeStat) -> Result<(), &'static str> {
        let p = self.profiles.get_mut(token).ok_or("No profile.")?;
        let level = *p.upgrades.level_mut(stat);
        if level >= MAX_LEVEL {
            return Err("That stat is already at the maximum level.");
        }
        let cost = upgrade_cost(level);
        if p.xp < cost {
            return Err("Not enough XP.");
        }
        p.xp -= cost;
        *p.upgrades.level_mut(stat) += 1;
        self.save();
        Ok(())
    }

    /// Writes all non-empty profiles to disk.
    pub fn save(&self) {
        let Some(path) = &self.path else { return };
        let data: BTreeMap<&String, &Profile> = self.profiles.iter().filter(|(_, p)| !p.is_empty()).collect();
        let result = (|| -> std::io::Result<()> {
            if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
                std::fs::create_dir_all(dir)?;
            }
            let tmp = path.with_extension("tmp");
            std::fs::write(&tmp, serde_json::to_vec(&data).expect("profiles to json"))?;
            std::fs::rename(&tmp, path)
        })();
        if let Err(e) = result {
            tracing::error!("cannot save profiles to {}: {e}", path.display());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_issued_and_kept() {
        let mut s = ProfileStore::in_memory();
        let t = s.resolve(None);
        assert!(valid_token(&t));
        assert_eq!(s.resolve(Some(&t)), t, "known token is kept");
        assert_ne!(s.resolve(Some("../../etc")), "../../etc", "malformed token is replaced");
    }

    #[test]
    fn buying_costs_xp_and_respects_limits() {
        let mut s = ProfileStore::in_memory();
        let t = s.resolve(None);
        assert!(s.buy(&t, UpgradeStat::Damage).is_err(), "no XP yet");
        s.add_xp(&t, upgrade_cost(0) + 10);
        s.buy(&t, UpgradeStat::Damage).unwrap();
        let info = s.info(&t);
        assert_eq!(info.xp, 10);
        assert_eq!(info.upgrades.damage, 1);
        assert!(info.mods.damage > 1.0);

        s.add_xp(&t, 1_000_000);
        for _ in 0..MAX_LEVEL {
            let _ = s.buy(&t, UpgradeStat::Armor);
        }
        assert_eq!(s.upgrades(&t).armor, MAX_LEVEL);
        assert!(s.buy(&t, UpgradeStat::Armor).is_err(), "max level");
    }

    #[test]
    fn profiles_survive_a_reload_and_empty_ones_are_not_saved() {
        let path = std::env::temp_dir().join(format!("ta-profiles-{}.json", new_token()));
        let mut s = ProfileStore::load(path.clone());
        let t = s.resolve(None);
        let _empty = s.resolve(None);
        s.add_xp(&t, 500);
        s.buy(&t, UpgradeStat::Life).unwrap();

        let s2 = ProfileStore::load(path.clone());
        assert_eq!(s2.profiles.len(), 1);
        assert_eq!(s2.info(&t).xp, 500 - upgrade_cost(0));
        assert_eq!(s2.upgrades(&t).life, 1);
        let _ = std::fs::remove_file(path);
    }
}
