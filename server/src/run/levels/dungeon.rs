//! The room-and-corridor dungeon with an end boss in its hall.

use super::{boss, BossEncounter, Level, LevelRules};
use crate::dungeon::generate::{generate, Theme};
use crate::dungeon::{Layout, Room};
use crate::math::Vec2;
use crate::protocol::{BossBar, BossId};
use crate::run::targets::Side;
use crate::run::{companion, Run};
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
        let (haunts, boss, knight) = match &run.level {
            Level::Dungeon(d) => (d.haunts.clone(), d.boss.boss_id, companion::knight_spot(&run.layout, &d.rooms[d.start].rect)),
            #[cfg(test)]
            Level::Test => return,
            Level::Woodland(_) => return,
        };
        if let Some(t) = crate::defs::enemies::haunt_for(boss) {
            for pos in haunts {
                run.spawn_enemy(t, pos, None);
            }
        }
        // The knight last, so every earlier entity keeps its id: Neutral until a hero recruits it.
        if let Some(pos) = knight {
            let id = run.spawn_enemy(crate::defs::enemies::EnemyType::Knight, pos, None);
            let mi = run.monster_idx(id).expect("the knight just spawned");
            run.monsters[mi].side = Side::Neutral;
        }
        // The cove's animals after the knight, so every earlier id stays: the boar, the stag, three deer, ten
        // bunnies. Their spots come from the cove's seed, not the run's rng.
        if let Some(cove) = run.layout.cove {
            use crate::defs::enemies::EnemyType as E;
            let kinds = [E::Boar, E::Stag, E::Deer, E::Deer, E::Deer].into_iter().chain([E::Bunny; 10]);
            for (t, pos) in kinds.zip(crate::dungeon::cove::animal_spots(&run.layout, &cove)) {
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
