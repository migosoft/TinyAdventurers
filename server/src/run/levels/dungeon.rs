//! The room-and-corridor dungeon with an end boss in its hall.

use super::{boss, BossEncounter, Level, LevelRules};
use crate::dungeon::generate::{generate, Theme};
use crate::dungeon::{Layout, Room};
use crate::math::Vec2;
use crate::protocol::{BossBar, BossId};
use crate::run::Run;
use rand::Rng;
use rand_chacha::ChaCha8Rng;

pub struct DungeonLevel {
    // Not read yet; kept as part of the level's interface (debug tools and future rules).
    #[allow(dead_code)]
    pub rooms: Vec<Room>,
    #[allow(dead_code)]
    pub start: usize,
    pub boss: BossEncounter,
    /// Where the boss's haunt appears (`enemies::haunt_for`).
    pub haunts: Vec<Vec2>,
}

impl DungeonLevel {
    /// Picks the boss first (random from the run's rng, as before), then generates its dungeon.
    pub fn build(seed: u64, boss: Option<BossId>, rng: &mut ChaCha8Rng) -> (Layout, DungeonLevel) {
        let boss_id = boss.unwrap_or_else(|| BossId::ALL[rng.gen_range(0..BossId::ALL.len())]);
        let (layout, parts) = generate(seed, Theme::for_boss(boss_id)).split();
        let encounter = BossEncounter::new(boss_id, *parts.boss_hall(), parts.door);
        (layout, DungeonLevel { rooms: parts.rooms, start: parts.start, boss: encounter, haunts: parts.haunts })
    }
}

impl LevelRules for DungeonLevel {
    fn populate(run: &mut Run) {
        boss::spawn(run);
        // The haunts after the boss, so every earlier entity keeps its id.
        let (haunts, boss) = match &run.level {
            Level::Dungeon(d) => (d.haunts.clone(), d.boss.boss_id),
            #[cfg(test)]
            Level::Test => return,
        };
        if let Some(t) = crate::defs::enemies::haunt_for(boss) {
            for pos in haunts {
                run.spawn_enemy(t, pos, None);
            }
        }
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
