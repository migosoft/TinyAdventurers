//! Final bosses. Each boss implements `BossBehaviour`; adding a boss means a
//! new file here plus an entry in `create` and `defs::bosses`.

mod demon;
mod dragon;
mod lich;

use super::ai::find_visible_player;
use super::Run;
use crate::defs::kinds::Anim;
use crate::math::Vec2;
use crate::protocol::BossId;

pub trait BossBehaviour: Send {
    /// Spawn extra monsters (e.g. lich disciples) when the run is created.
    fn spawn_extras(&mut self, _run: &mut Run, _boss_pos: Vec2, _party: usize) {}
    /// Special damage condition (lich: all disciples dead).
    fn can_be_damaged(&self, _run: &Run) -> bool {
        true
    }
    fn enraged(&self) -> bool {
        false
    }
    fn tick(&mut self, run: &mut Run, dt: f64);
}

pub fn create(id: BossId) -> Box<dyn BossBehaviour> {
    match id {
        BossId::Demon => Box::new(demon::Demon::default()),
        BossId::Lich => Box::new(lich::Lich::default()),
        BossId::Dragon => Box::new(dragon::Dragon::default()),
    }
}

/// Index of the boss monster, if alive.
pub(crate) fn boss_idx(run: &Run) -> Option<usize> {
    run.monsters.iter().position(|m| m.id == run.boss_ent && m.alive)
}

pub(crate) fn set_anim(run: &mut Run, bi: usize, a: Anim) {
    let m = &mut run.monsters[bi];
    if m.anim != a {
        m.anim = a;
        m.anim_start = run.time;
    }
}

/// Nearest player the boss can see.
pub(crate) fn target(run: &Run, bi: usize) -> Option<(usize, Vec2, f64)> {
    let m = &run.monsters[bi];
    find_visible_player(run, m.pos, m.sight).map(|pi| {
        let p = run.players[pi].pos();
        (pi, p, p.dist(m.pos))
    })
}

/// Players within `r` of `at` (optionally inside a cone around `dir`).
pub(crate) fn players_in(run: &Run, at: Vec2, r: f64, cone: Option<(f64, f64)>) -> Vec<usize> {
    run.players
        .iter()
        .enumerate()
        .filter(|(_, p)| {
            if !p.alive || p.pos().dist(at) > r {
                return false;
            }
            match cone {
                Some((dir, half)) => crate::math::angle_diff(at.angle_to(p.pos()), dir).abs() <= half,
                None => true,
            }
        })
        .map(|(i, _)| i)
        .collect()
}
