//! Level types. A level decides the map, what spawns besides the shared
//! enemies and chests, and how the run is won or lost. Adding one: a new file
//! implementing `LevelRules` (only the hooks it needs), a `Level` variant, a
//! `LevelId`/`LevelChoice` entry, and one arm in each `match` below.

pub mod boss;
pub mod dungeon;

pub use boss::BossEncounter;
pub use dungeon::DungeonLevel;

use super::Run;
use crate::defs::enemies::EnemyType;
use crate::dungeon::Layout;
use crate::math::Vec2;
use crate::protocol::{BossBar, BossId, LevelChoice, LevelId};
use rand_chacha::ChaCha8Rng;

/// Hooks are associated functions on the whole run, so a level's state stays
/// in `run.level` while they run (boss behaviours read `boss_ent` from it).
pub trait LevelRules {
    /// Spawns the level's own monsters after the shared enemies and chests.
    fn populate(_run: &mut Run, _party: usize) {}
    /// Before monster separation, where boss behaviours act.
    fn tick(_run: &mut Run, _dt: f64) {}
    /// After the step's clean-up, before the end check (wake-ups, doors).
    fn post_tick(_run: &mut Run) {}
    /// A monster died; may end the run (`run.ended`).
    fn on_killed(_run: &mut Run, _id: u32) {}
    /// A boss monster is about to take damage; false = immune.
    fn on_boss_hurt(_run: &mut Run, _mi: usize) -> bool {
        true
    }
    fn failed(run: &Run) -> bool {
        !run.players.iter().any(|p| p.alive)
    }
    /// Where the debug path leads.
    fn debug_target(_run: &Run) -> Option<Vec2> {
        None
    }
    fn boss_bar(_run: &Run) -> Option<BossBar> {
        None
    }
}

pub enum Level {
    Dungeon(DungeonLevel),
    /// Only default hooks: proves a level without a boss works.
    #[cfg(test)]
    Test,
}

#[cfg(test)]
pub struct TestLevel;
#[cfg(test)]
impl LevelRules for TestLevel {}

macro_rules! dispatch {
    ($level:expr, $f:ident($($a:expr),*)) => {
        match $level {
            Level::Dungeon(_) => DungeonLevel::$f($($a),*),
            #[cfg(test)]
            Level::Test => TestLevel::$f($($a),*),
        }
    };
}

impl Level {
    pub fn build(seed: u64, choice: &LevelChoice, rng: &mut ChaCha8Rng) -> (Layout, Level) {
        match choice {
            LevelChoice::Dungeon { boss } => {
                let (layout, d) = DungeonLevel::build(seed, *boss, rng);
                (layout, Level::Dungeon(d))
            }
        }
    }

    pub fn id(&self) -> LevelId {
        match self {
            Level::Dungeon(_) => LevelId::Dungeon,
            // The test level is not a protocol level (ts-rs exports in test builds).
            #[cfg(test)]
            Level::Test => LevelId::Dungeon,
        }
    }

    pub fn boss(&self) -> Option<&BossEncounter> {
        match self {
            Level::Dungeon(d) => Some(&d.boss),
            #[cfg(test)]
            Level::Test => None,
        }
    }

    pub fn boss_mut(&mut self) -> Option<&mut BossEncounter> {
        match self {
            Level::Dungeon(d) => Some(&mut d.boss),
            #[cfg(test)]
            Level::Test => None,
        }
    }

    pub fn boss_id(&self) -> Option<BossId> {
        self.boss().map(|b| b.boss_id)
    }

    /// The level's version of a generic enemy (demon dungeon: imps for archers, …).
    pub fn enemy_type(&self, t: EnemyType) -> EnemyType {
        self.boss_id().map_or(t, |b| crate::defs::enemies::for_boss(t, b))
    }

    pub fn populate(run: &mut Run, party: usize) { dispatch!(run.level, populate(run, party)) }
    pub fn tick(run: &mut Run, dt: f64) { dispatch!(run.level, tick(run, dt)) }
    pub fn post_tick(run: &mut Run) { dispatch!(run.level, post_tick(run)) }
    pub fn on_killed(run: &mut Run, id: u32) { dispatch!(run.level, on_killed(run, id)) }
    pub fn on_boss_hurt(run: &mut Run, mi: usize) -> bool { dispatch!(run.level, on_boss_hurt(run, mi)) }
    pub fn failed(run: &Run) -> bool { dispatch!(run.level, failed(run)) }
    pub fn debug_target(run: &Run) -> Option<Vec2> { dispatch!(run.level, debug_target(run)) }
    pub fn boss_bar(run: &Run) -> Option<BossBar> { dispatch!(run.level, boss_bar(run)) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dungeon::generate::{generate, Theme};
    use crate::protocol::{BossId, ClassId};
    use crate::run::tests::test_run;
    use rand::{Rng, SeedableRng};

    #[test]
    fn dungeon_build_matches_the_generator() {
        for seed in 0..12u64 {
            for boss in BossId::ALL {
                let mut rng = ChaCha8Rng::seed_from_u64(seed ^ 0x5eed);
                let (layout, level) = Level::build(seed, &LevelChoice::Dungeon { boss: Some(boss) }, &mut rng);
                let (want, parts) = generate(seed, Theme::for_boss(boss)).split();
                assert_eq!(layout.map.tiles, want.map.tiles);
                assert_eq!(layout.player_spawns, want.player_spawns);
                assert_eq!(level.boss().unwrap().arena, *parts.boss_hall());
                assert_eq!(level.boss_id(), Some(boss));
            }
        }
    }

    #[test]
    fn random_boss_uses_the_run_rng_like_before() {
        for seed in 0..12u64 {
            let mut rng = ChaCha8Rng::seed_from_u64(seed ^ 0x5eed);
            let want = BossId::ALL[ChaCha8Rng::seed_from_u64(seed ^ 0x5eed).gen_range(0..BossId::ALL.len())];
            let (_, level) = Level::build(seed, &LevelChoice::Dungeon { boss: None }, &mut rng);
            assert_eq!(level.boss_id(), Some(want));
        }
    }

    #[test]
    fn a_level_without_rules_uses_the_defaults() {
        let mut run = test_run(&[ClassId::Paladin, ClassId::Wizard], BossId::Demon);
        run.monsters.retain(|m| !m.is_boss);
        run.level = Level::Test;
        assert!(Level::boss_bar(&run).is_none());
        assert!(Level::debug_target(&run).is_none());
        assert!(crate::run::debug::boss_path(&run, 0).is_empty(), "no target, no path");
        assert!(run.level.boss().is_none());
        for _ in 0..10 {
            run.step();
        }
        assert!(run.ended.is_none());
        for p in &mut run.players {
            p.alive = false;
        }
        run.step();
        assert_eq!(run.ended.map(|e| e.0), Some(false), "everyone dead = defeat");
        // `RunEnded.boss` becomes an `Option` in the next step of the split.
        assert!(run.level.boss_id().is_none());
    }
}
