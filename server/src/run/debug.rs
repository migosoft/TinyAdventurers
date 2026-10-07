//! Debug mode: the player is immortal and receives the shortest walkable
//! path to the boss. Can be disabled on a server with `ALLOW_DEBUG=0`.

use super::ai::astar;
use super::Run;
use crate::collision::line_of_sight;
use crate::math::Vec2;
use crate::protocol::{Ev, ServerMsg};

/// Path updates every 30 ticks (0.5 s).
pub const PATH_EVERY: u32 = 30;

pub fn allowed() -> bool {
    !matches!(std::env::var("ALLOW_DEBUG").as_deref(), Ok("0") | Ok("false") | Ok("no"))
}

impl Run {
    pub fn set_debug(&mut self, pi: usize, on: bool) {
        let on = on && allowed();
        self.players[pi].debug = on;
        self.debug_used |= on;
        if on {
            let name = self.players[pi].name.clone();
            self.event(Ev::Msg { text: format!("{name} entered debug mode (immortal)") }, None);
        }
        let points = if on { boss_path(self, pi) } else { Vec::new() };
        self.send(&self.players[pi], &ServerMsg::DebugPath { on, points });
    }
}

/// Where the path leads: the boss itself while it lives, else the boss hall.
fn boss_target(run: &Run) -> Vec2 {
    run.monsters.iter().find(|m| m.id == run.boss_ent && m.alive).map_or_else(|| run.dungeon.boss_hall().center_px(), |m| m.pos)
}

/// Shortest tile path (A*) from the player to the boss, shortened to
/// straight segments wherever there is a clear line.
pub fn boss_path(run: &Run, pi: usize) -> Vec<(f32, f32)> {
    let from = run.players[pi].pos();
    let to = boss_target(run);
    let map = &run.dungeon.map;
    let Some(tiles) = astar(map, from, to, (map.w * map.h) as usize) else { return Vec::new() };
    let mut pts = vec![from];
    pts.extend(tiles);
    // String pulling: skip waypoints that can be seen past.
    let mut out = vec![pts[0]];
    let mut i = 0;
    while i < pts.len() - 1 {
        let mut j = pts.len() - 1;
        while j > i + 1 && !line_of_sight(map, pts[i], pts[j]) {
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
            let points = boss_path(run, pi);
            run.send(p, &ServerMsg::DebugPath { on: true, points });
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
        run.hurt_player(0, 10_000.0);
        assert!(run.players[0].alive);
        assert_eq!(run.players[0].hp, hp);

        let path = boss_path(&run, 0);
        assert!(path.len() >= 2, "path found");
        let end = path.last().unwrap();
        let boss = boss_target(&run);
        assert!((end.0 as f64 - boss.x).abs() < 1.0 && (end.1 as f64 - boss.y).abs() < 1.0, "ends at the boss");
        // Every segment is walkable in a straight line.
        for w in path.windows(2) {
            assert!(line_of_sight(&run.dungeon.map, Vec2::new(w[0].0 as f64, w[0].1 as f64), Vec2::new(w[1].0 as f64, w[1].1 as f64)));
        }

        run.set_debug(0, false);
        run.hurt_player(0, 10_000.0);
        assert!(!run.players[0].alive, "mortal again");
    }
}
