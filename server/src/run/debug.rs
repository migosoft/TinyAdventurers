//! Debug mode: the player is immortal and receives the shortest walkable
//! path to the boss (and to the ogre mini-boss while it lives). Can be disabled on a server with `ALLOW_DEBUG=0`.

use super::ai::astar;
use super::levels::Level;
use super::Run;
use crate::collision::walk_line;
use crate::defs::damage::Damage;
use crate::defs::enemies::EnemyType;
use crate::dungeon::Mover;
use crate::math::Vec2;
use crate::protocol::{Ev, ServerMsg};

/// Path updates every 30 ticks (0.5 s).
pub const PATH_EVERY: u32 = 30;

pub fn allowed() -> bool {
    !matches!(std::env::var("ALLOW_DEBUG").as_deref(), Ok("0") | Ok("false") | Ok("no"))
}

impl Run {
    /// Debug cheat: your hero's darkvision as a share (0..=1) of its vision.
    pub fn set_darkvision(&mut self, pi: usize, ratio: f32) {
        self.set_darkvision_if(allowed(), pi, ratio);
    }

    fn set_darkvision_if(&mut self, allowed: bool, pi: usize, ratio: f32) {
        if !allowed {
            return;
        }
        if !ratio.is_finite() {
            return;
        }
        let r = f64::from(ratio.clamp(0.0, 1.0));
        self.players[pi].darkvision = Some(r);
        self.debug_used = true;
        let name = self.players[pi].name.clone();
        self.event(Ev::Msg { text: format!("{name} darkvision {}%", (r * 100.0).round()) }, None);
    }

    pub fn set_debug(&mut self, pi: usize, on: bool) {
        let on = on && allowed();
        self.players[pi].debug = on;
        if !on {
            self.players[pi].darkvision = None;
        }
        self.debug_used |= on;
        if on {
            let name = self.players[pi].name.clone();
            self.event(Ev::Msg { text: format!("{name} entered debug mode (immortal)") }, None);
        }
        let (points, ogre) = if on { (boss_path(self, pi), ogre_path(self, pi)) } else { (Vec::new(), Vec::new()) };
        self.send(&self.players[pi], &ServerMsg::DebugPath { on, points, ogre });
    }
}

/// The living ogre mini-boss, if any.
fn ogre_target(run: &Run) -> Option<Vec2> {
    run.monsters.iter().find(|m| m.alive && m.etype == Some(EnemyType::Ogre)).map(|m| m.pos)
}

pub fn boss_path(run: &Run, pi: usize) -> Vec<(f32, f32)> {
    Level::debug_target(run).map_or_else(Vec::new, |to| shortest_path(run, pi, to))
}

/// Empty once the ogre is dead.
pub fn ogre_path(run: &Run, pi: usize) -> Vec<(f32, f32)> {
    ogre_target(run).map_or_else(Vec::new, |to| shortest_path(run, pi, to))
}

/// Shortest tile path (A*) from the player to `to`, shortened to straight
/// segments wherever there is a clear line.
fn shortest_path(run: &Run, pi: usize, to: Vec2) -> Vec<(f32, f32)> {
    let from = run.players[pi].pos();
    let map = &run.layout.map;
    // Plan the path like a cautious enemy: around deep water, chasms and lava.
    let Some(tiles) = astar(map, from, to, (map.w * map.h) as usize, Mover::Enemy) else { return Vec::new() };
    let mut pts = vec![from];
    pts.extend(tiles);
    // String pulling: skip waypoints that can be seen past.
    let mut out = vec![pts[0]];
    let mut i = 0;
    while i < pts.len() - 1 {
        let mut j = pts.len() - 1;
        while j > i + 1 && !walk_line(map, pts[i], pts[j], Mover::Enemy) {
            j -= 1;
        }
        out.push(pts[j]);
        i = j;
    }
    out.iter().map(|p| (p.x as f32, p.y as f32)).collect()
}

pub fn send_paths(run: &Run) {
    for (pi, p) in run.players.iter().enumerate() {
        if p.debug && p.alive && p.tx.is_some() {
            let (points, ogre) = (boss_path(run, pi), ogre_path(run, pi));
            run.send(p, &ServerMsg::DebugPath { on: true, points, ogre });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{BossId, ClassId};
    use crate::run::tests::test_run;

    #[test]
    fn debug_player_is_immortal_and_gets_a_path_to_the_boss() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Dragon);
        run.set_debug(0, true);
        let hp = run.players[0].hp;
        run.hurt_player(0, Damage::physical(10_000.0));
        assert!(run.players[0].alive);
        assert_eq!(run.players[0].hp, hp);

        let path = boss_path(&run, 0);
        assert!(path.len() >= 2, "path found");
        let end = path.last().unwrap();
        let boss = Level::debug_target(&run).unwrap();
        assert!((end.0 as f64 - boss.x).abs() < 1.0 && (end.1 as f64 - boss.y).abs() < 1.0, "ends at the boss");
        // Every segment is walkable in a straight line.
        for w in path.windows(2) {
            assert!(walk_line(&run.layout.map, Vec2::new(w[0].0 as f64, w[0].1 as f64), Vec2::new(w[1].0 as f64, w[1].1 as f64), Mover::Enemy));
        }

        let ogre = ogre_path(&run, 0);
        let at = ogre_target(&run).unwrap();
        let end = ogre.last().unwrap();
        assert!((end.0 as f64 - at.x).abs() < 1.0 && (end.1 as f64 - at.y).abs() < 1.0, "second path ends at the ogre");
        let oi = run.monsters.iter().position(|m| m.etype == Some(EnemyType::Ogre)).unwrap();
        run.kill_monster(oi);
        assert!(ogre_path(&run, 0).is_empty(), "no ogre path once it is dead");

        run.set_debug(0, false);
        run.hurt_player(0, Damage::physical(10_000.0));
        assert!(!run.players[0].alive, "mortal again");
    }

    #[test]
    fn the_debug_toggle_sets_darkvision_and_the_snapshot_carries_it() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let (stx, mut srx) = tokio::sync::mpsc::unbounded_channel();
        run.players[0].tx = Some(stx);
        run.set_darkvision_if(true, 0, 0.5);
        assert_eq!(run.players[0].darkvision, Some(0.5));
        assert!(run.debug_used);
        crate::run::visibility::send_snapshots(&mut run);
        let axum::extract::ws::Message::Binary(bytes) = srx.try_recv().unwrap() else { panic!("a snapshot") };
        let snap: serde_json::Value = rmp_serde::from_slice(&bytes).unwrap();
        assert_eq!(snap[3][13], 50);
    }

    #[test]
    fn the_debug_toggle_is_ignored_when_debug_is_not_allowed() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let before = run.players[0].darkvision;
        run.set_darkvision_if(false, 0, 1.0);
        assert_eq!(run.players[0].darkvision, before);
        assert!(!run.debug_used);
    }

    #[test]
    fn a_nan_darkvision_ratio_changes_nothing() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        run.set_darkvision_if(true, 0, f32::NAN);
        assert_eq!(run.players[0].darkvision, None);
        assert!(!run.debug_used);
    }

    #[test]
    fn leaving_debug_resets_the_darkvision_override() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        run.set_darkvision_if(true, 0, 0.5);
        run.set_debug(0, false);
        assert_eq!(run.players[0].darkvision, None);
    }
}
