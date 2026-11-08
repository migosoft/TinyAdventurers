//! The woodland (#203): a forest road in daylight with wild animals and enemy groups in the clearings. The
//! party wins by walking into the end clearing; there is no boss.

use super::LevelRules;
use crate::defs::enemies::EnemyType;
use crate::dungeon::woodland::generate;
use crate::dungeon::{Layout, Rect};
use crate::math::Vec2;
use crate::run::{Run, END_DELAY};

/// XP for every living hero when the party reaches the end.
pub const WOODLAND_END_XP: u32 = 150; // balancing

pub struct WoodlandLevel {
    /// Tiles; a living hero inside wins.
    pub end: Rect,
    /// Wild animals (type, spot), spawned after the enemy groups.
    pub animals: Vec<(EnemyType, Vec2)>,
}

impl WoodlandLevel {
    pub fn build(seed: u64) -> (Layout, WoodlandLevel) {
        let (layout, w) = generate(seed);
        (layout, WoodlandLevel { end: w.end, animals: w.animals })
    }
}

impl LevelRules for WoodlandLevel {
    fn populate(run: &mut Run) {
        let animals = match &run.level {
            super::Level::Woodland(w) => w.animals.clone(),
            _ => return,
        };
        for (t, pos) in animals {
            run.spawn_enemy(t, pos, None);
        }
    }
    fn post_tick(run: &mut Run) {
        let super::Level::Woodland(w) = &run.level else { return };
        if run.ended.is_some() || !run.players.iter().any(|p| p.alive && w.end.contains(Vec2::new(p.mv.x, p.mv.y))) {
            return;
        }
        run.ended = Some((true, run.time + END_DELAY));
        for p in run.players.iter_mut().filter(|p| p.alive) {
            p.xp += WOODLAND_END_XP;
        }
    }
    fn debug_target(run: &Run) -> Option<Vec2> {
        let super::Level::Woodland(w) = &run.level else { return None };
        let (x, y) = w.end.center();
        Some(crate::dungeon::Map::center_of(x, y))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::ClassId;
    use crate::protocol::{LevelChoice, LevelId, ServerMsg};
    use crate::run::targets::Side;
    use crate::run::{Build, Member};
    use rand::{Rng, SeedableRng};
    use tokio::sync::mpsc::unbounded_channel;

    fn woodland_run(classes: &[ClassId], seed: u64) -> Run {
        let members = classes
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let (tx, _rx) = unbounded_channel();
                std::mem::forget(_rx);
                Member { conn: i as u32 + 1, name: format!("p{i}"), class: *c, tx, account: None, character: None, build: Build::start(*c) }
            })
            .collect();
        Run::new(1, members, seed, LevelChoice::Woodland {})
    }

    fn end_of(run: &Run) -> Rect {
        let super::super::Level::Woodland(w) = &run.level else { panic!() };
        w.end
    }

    #[test]
    fn woodland_run_starts_with_daylight_and_no_boss() {
        let mut run = woodland_run(&[ClassId::Paladin], 3);
        assert!(run.level.boss().is_none());
        assert_eq!(run.level.id(), LevelId::Woodland);
        run.lights.refresh(&run.layout.map);
        let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(1);
        for _ in 0..5 {
            let (x, y) = (rng.gen_range(0..run.layout.map.w), rng.gen_range(0..run.layout.map.h));
            assert!(run.lights.lit(x, y), "{x},{y}");
        }
        let ServerMsg::RunStarted(info) = run.start_info(&run.players[0]) else { panic!() };
        assert!(info.daylight);
        let w = info.woodland.expect("the plants are sent");
        assert_eq!(w.plants.len(), run.layout.woodland.as_ref().unwrap().plants.len());
        assert_eq!(info.level, LevelId::Woodland);
        assert!(info.cove.is_none());
    }

    #[test]
    fn animals_and_enemies_spawn() {
        for seed in 0..5u64 {
            let run = woodland_run(&[ClassId::Paladin], seed);
            let wl = run.layout.woodland.as_ref().unwrap();
            let wild: Vec<_> = run.monsters.iter().filter(|m| m.wild.is_some()).collect();
            assert_eq!(wild.len(), wl.animals.len(), "seed {seed}");
            assert!(wild.iter().all(|m| m.side == Side::Neutral));
            for (m, (t, pos)) in wild.iter().zip(&wl.animals) {
                assert_eq!((m.etype, m.pos), (Some(*t), *pos), "seed {seed}");
            }
            let hostile: Vec<_> = run.monsters.iter().filter(|m| m.wild.is_none()).collect();
            assert_eq!(hostile.len(), run.layout.spawns.len(), "seed {seed}");
            assert!(hostile.iter().all(|m| m.side == Side::Hostile && !m.is_boss));
            for (m, s) in hostile.iter().zip(&run.layout.spawns) {
                assert_eq!((m.etype, m.pos), (Some(s.enemy), s.pos), "seed {seed}: no level substitution");
            }
        }
    }

    #[test]
    fn reaching_the_end_wins_and_pays() {
        let mut run = woodland_run(&[ClassId::Paladin, ClassId::Wizard], 4);
        let end = end_of(&run);
        let (x, y) = end.center();
        let c = crate::dungeon::Map::center_of(x, y);
        for p in &mut run.players {
            p.mv.x = c.x;
            p.mv.y = c.y;
        }
        let before: Vec<u32> = run.players.iter().map(|p| p.xp).collect();
        run.step();
        assert!(matches!(run.ended, Some((true, _))));
        let after: Vec<u32> = run.players.iter().map(|p| p.xp).collect();
        for (b, a) in before.iter().zip(&after) {
            assert_eq!(*a, b + WOODLAND_END_XP);
        }
        run.step();
        assert_eq!(run.players.iter().map(|p| p.xp).collect::<Vec<_>>(), after, "paid once");
    }

    #[test]
    fn a_dead_hero_in_the_end_does_not_win() {
        let mut run = woodland_run(&[ClassId::Paladin], 4);
        let (x, y) = end_of(&run).center();
        let c = crate::dungeon::Map::center_of(x, y);
        run.players[0].mv.x = c.x;
        run.players[0].mv.y = c.y;
        run.players[0].alive = false;
        run.step();
        assert!(!matches!(run.ended, Some((true, _))));
        assert_eq!(run.players[0].xp, 0);
    }

    #[test]
    fn only_the_living_hero_is_paid_when_another_has_died() {
        let mut run = woodland_run(&[ClassId::Paladin, ClassId::Wizard], 4);
        let (x, y) = end_of(&run).center();
        let c = crate::dungeon::Map::center_of(x, y);
        run.players[0].mv.x = c.x;
        run.players[0].mv.y = c.y;
        run.players[1].alive = false;
        let before: Vec<u32> = run.players.iter().map(|p| p.xp).collect();
        run.step();
        assert!(matches!(run.ended, Some((true, _))), "one living hero in the end wins");
        assert_eq!(run.players[0].xp, before[0] + WOODLAND_END_XP);
        assert_eq!(run.players[1].xp, before[1], "the dead hero earns nothing");
    }

    #[test]
    fn woodland_run_ends_in_defeat_when_all_die() {
        let mut run = woodland_run(&[ClassId::Paladin, ClassId::Wizard], 5);
        for p in &mut run.players {
            p.alive = false;
        }
        run.step();
        assert!(matches!(run.ended, Some((false, _))));
    }
}
