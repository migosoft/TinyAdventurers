//! Companions: monsters that fight for the heroes. Who each follows (the leader hierarchy) and the
//! pieces of a follower's script that any companion shares. The Ranger's wolf is in run/wolf.rs.

use super::entities::Companion;
use super::targets::Side;
use super::{ai, perception, Run};
use crate::collision::walk_line;
use crate::defs::companions::{Escort, WOLF_REACH_EVERY};
use crate::defs::effects::EffectKind;
use crate::defs::kinds::Anim;
use crate::dungeon::Mover;
use crate::math::Vec2;
use crate::protocol::Ev;

/// The hero (index into `run.players`) `c` follows: its recruiter while that hero is alive and in the
/// run; else, for a recruited companion, the party leader (the host, the first player) if alive, else the
/// next living hero in join order. A summoned companion has no one else: `None` means it vanishes.
/// A pure function of who is alive now. Fallen heroes never come back before #221, so a switch of
/// leader is for good without any stored history.
pub fn leader_of(run: &Run, c: &Companion) -> Option<usize> {
    let alive = |pi: usize| run.players[pi].alive;
    let recruiter = run.player_idx(c.recruiter).filter(|&pi| alive(pi));
    if c.summoned {
        return recruiter;
    }
    recruiter.or_else(|| (0..run.players.len()).find(|&pi| alive(pi)))
}

/// Sets every companion's `leader`. A summoned companion whose summoner is gone vanishes at once, with
/// a puff: no death event, no message, no cooldown. A recruited one with no leader at all keeps its last
/// (the run is ending).
pub fn update_leaders(run: &mut Run) {
    for mi in 0..run.monsters.len() {
        let m = &run.monsters[mi];
        let Some(c) = m.companion.as_ref().filter(|_| m.alive) else { continue };
        match leader_of(run, c) {
            Some(pi) => {
                let id = run.players[pi].id;
                run.monsters[mi].companion.as_mut().expect("a companion").leader = id;
            }
            None if c.summoned => {
                let (pos, recruiter) = (m.pos, c.recruiter);
                run.monsters[mi].alive = false;
                if let Some(pi) = run.player_idx(recruiter) {
                    run.players[pi].wolf = None;
                }
                run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: 10.0, k: 9 }, None);
            }
            None => {}
        }
    }
}

pub(super) fn set_anim(run: &mut Run, mi: usize, a: Anim) {
    let m = &mut run.monsters[mi];
    if m.anim != a {
        m.anim = a;
        m.anim_start = run.time;
    }
}

/// Whether companion `mi` must reappear beside its leader: far from them, or (checked every
/// `WOLF_REACH_EVERY` s) unable to reach them, as behind a sealed door. Mid-dash it may be over a chasm,
/// where no path starts: no reach check then.
pub fn lost(run: &mut Run, mi: usize, leader: Vec2, e: &Escort, dt: f64) -> bool {
    let pos = run.monsters[mi].pos;
    let dashing = run.monsters[mi].dash.is_some();
    let mut lost = pos.dist(leader) > e.reappear;
    let c = run.monsters[mi].companion.as_mut().expect("a companion");
    c.reach_t -= dt;
    if c.reach_t <= 0.0 && !dashing {
        c.reach_t = WOLF_REACH_EVERY;
        let map = &run.layout.map;
        // A leader on lava or over a chasm cannot be reached on foot, and no spot beside them is safe.
        lost |= !map.blocks_at(leader, Mover::Enemy) && !(walk_line(map, pos, leader, Mover::Enemy) || ai::astar(map, pos, leader, 2500, Mover::Enemy).is_some());
    }
    lost
}

/// The companion appears beside its leader with the green puff, dropping whatever it was doing.
/// With no free spot beside them it stays where it is (false).
pub fn reappear(run: &mut Run, mi: usize, leader: Vec2) -> bool {
    let Some(spot) = super::wolf::spot_beside(run, leader) else { return false };
    let m = &mut run.monsters[mi];
    m.pos = spot;
    m.knock = Vec2::ZERO;
    m.ai.path.clear();
    m.ai.windup = None;
    m.dash = None;
    let c = m.companion.as_mut().expect("a companion");
    c.prey = None;
    c.following = false;
    set_anim(run, mi, Anim::Idle);
    run.event(Ev::Boom { x: spot.x as f32, y: spot.y as f32, r: 10.0, k: 9 }, None);
    true
}

/// The enemy a companion goes for: alive, awake and visible to the heroes (not dormant, hiding or flying),
/// seen by the companion, near the leader (guard) or the companion (it fights back), within the leash. The
/// one nearest the leader.
pub fn find_prey(run: &Run, mi: usize, leader: Vec2, e: &Escort) -> Option<usize> {
    let w = &run.monsters[mi];
    let sight = w.sight_now();
    let attack = w.kit.first().expect("a companion attacks").split;
    run.monsters
        .iter()
        .enumerate()
        .filter(|(_, f)| f.alive && f.side == Side::Hostile && !f.dormant && !f.hiding && !f.effects.has(EffectKind::Invisible) && !f.airborne && f.sinking.is_none())
        // An attack that passes through the foe cannot hurt it: not worth chasing.
        .filter(|&(i, _)| !run.passes_through(super::effects::Creature::Monster(i), &attack))
        .filter(|(_, f)| {
            let (to_l, to_w) = (f.pos.dist(leader), f.pos.dist(w.pos));
            (to_l <= e.guard + f.radius || to_w <= e.defend + f.radius) && to_l <= e.leash
        })
        .filter(|(_, f)| perception::sees(run, sight, w.pos, f.pos))
        .min_by(|a, b| a.1.pos.dist(leader).total_cmp(&b.1.pos.dist(leader)))
        .map(|(i, _)| i)
}

/// Walks toward leader `pi` once beyond `e.follow` (until inside `e.follow_stop`); otherwise stands
/// facing the side the leader aims at.
pub fn follow(run: &mut Run, mi: usize, pi: usize, e: &Escort, speed: f64, dt: f64) {
    let leader = run.players[pi].pos();
    let pos = run.monsters[mi].pos;
    let d = pos.dist(leader);
    let c = run.monsters[mi].companion.as_mut().expect("a companion");
    if c.following && d < e.follow_stop {
        c.following = false;
    } else if d > e.follow {
        c.following = true;
    }
    if c.following {
        run.monsters[mi].aim = pos.angle_to(leader);
        ai::path_toward(run, mi, leader, speed, dt);
        set_anim(run, mi, Anim::Move);
    } else {
        run.monsters[mi].ai.path.clear();
        run.monsters[mi].aim = if run.players[pi].aim.cos() >= 0.0 { 0.0 } else { std::f64::consts::PI };
        set_anim(run, mi, Anim::Idle);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::enemies::EnemyType;
    use crate::math::Vec2;
    use crate::protocol::{BossId, ClassId, Ev};
    use crate::run::entities::Companion;
    use crate::run::targets::Side;
    use crate::run::tests::test_run;
    use crate::run::Run;

    /// Three heroes (host first) and an orc that hero 1 recruited.
    fn recruited() -> (Run, usize) {
        let mut run = test_run(&[ClassId::Wizard, ClassId::Paladin, ClassId::Barbarian], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, Vec2::new(100.0, 100.0), None);
        let mi = run.monster_idx(id).unwrap();
        let m = &mut run.monsters[mi];
        m.side = Side::Friendly;
        m.companion = Some(Companion {
            leader: run.players[1].id,
            recruiter: run.players[1].id,
            summoned: false,
            prey: None,
            following: false,
            reach_t: 0.0,
            last_safe: Vec2::new(100.0, 100.0),
        });
        (run, mi)
    }

    fn leader_id(run: &Run, mi: usize) -> Option<u32> {
        let c = run.monsters[mi].companion.as_ref().unwrap();
        leader_of(run, c).map(|pi| run.players[pi].id)
    }

    #[test]
    fn leader_hierarchy() {
        let (mut run, mi) = recruited();
        assert_eq!(leader_id(&run, mi), Some(run.players[1].id), "the recruiter leads");
        run.players[1].alive = false;
        assert_eq!(leader_id(&run, mi), Some(run.players[0].id), "then the host");
        run.players[0].alive = false;
        assert_eq!(leader_id(&run, mi), Some(run.players[2].id), "then the next living hero");
        run.players[2].alive = false;
        assert_eq!(leader_id(&run, mi), None);
    }

    #[test]
    fn recruiter_is_host_then_next() {
        let (mut run, mi) = recruited();
        let host = run.players[0].id;
        run.monsters[mi].companion.as_mut().unwrap().recruiter = host;
        assert_eq!(leader_id(&run, mi), Some(host));
        run.players[0].alive = false;
        assert_eq!(leader_id(&run, mi), Some(run.players[1].id));
    }

    #[test]
    fn summoned_vanishes_with_its_summoner() {
        let mut run = test_run(&[ClassId::ElvenRanger, ClassId::Wizard], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        let id = crate::run::wolf::spawn_wolf(&mut run, 1);
        run.players[1].alive = false;
        run.events.clear();
        update_leaders(&mut run);
        let mi = run.monster_idx(id).unwrap();
        assert!(!run.monsters[mi].alive);
        assert_eq!(run.players[1].wolf, None);
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Boom { k: 9, .. })), "the puff");
    }

    #[test]
    fn recruited_stays_when_its_recruiter_falls() {
        let (mut run, mi) = recruited();
        run.players[1].alive = false;
        update_leaders(&mut run);
        assert!(run.monsters[mi].alive);
        assert_eq!(run.monsters[mi].companion.as_ref().unwrap().leader, run.players[0].id);
    }
}
