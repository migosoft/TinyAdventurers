//! The room-and-corridor dungeon with an end boss in its hall.

use super::{boss, BossEncounter, LevelRules};
use crate::dungeon::generate::{generate, Theme};
use crate::dungeon::{Layout, Room};
use crate::math::Vec2;
use crate::protocol::{BossBar, BossId};
use crate::run::Run;
use rand::Rng;
use rand_chacha::ChaCha8Rng;

pub struct DungeonLevel {
    // Not read yet (like `Dungeon::start`); kept as part of the level's interface.
    #[allow(dead_code)]
    pub rooms: Vec<Room>,
    #[allow(dead_code)]
    pub start: usize,
    pub boss: BossEncounter,
}

impl DungeonLevel {
    /// Picks the boss first (random from the run's rng, as before), then generates its dungeon.
    pub fn build(seed: u64, boss: Option<BossId>, rng: &mut ChaCha8Rng) -> (Layout, DungeonLevel) {
        let boss_id = boss.unwrap_or_else(|| BossId::ALL[rng.gen_range(0..BossId::ALL.len())]);
        let (layout, parts) = generate(seed, Theme::for_boss(boss_id)).split();
        let encounter = BossEncounter::new(boss_id, *parts.boss_hall(), parts.door);
        (layout, DungeonLevel { rooms: parts.rooms, start: parts.start, boss: encounter })
    }
}

impl LevelRules for DungeonLevel {
    fn populate(run: &mut Run, party: usize) {
        boss::spawn(run, party);
    }
    fn tick(run: &mut Run, dt: f64) {
        boss::tick(run, dt);
    }
    fn post_tick(run: &mut Run) {
        boss::check_arena(run);
    }
    fn on_killed(run: &mut Run, id: u32) {
        boss::on_killed(run, id);
    }
    fn on_boss_hurt(run: &mut Run, mi: usize) -> bool {
        boss::on_hurt(run, mi)
    }
    fn debug_target(run: &Run) -> Option<Vec2> {
        Some(boss::debug_target(run))
    }
    fn boss_bar(run: &Run) -> Option<BossBar> {
        boss::bar(run)
    }
}
