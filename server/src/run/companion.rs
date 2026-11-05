//! Companions: monsters that fight for the heroes. Who each follows (the leader hierarchy) and the
//! pieces of a follower's script that any companion shares. The Ranger's wolf is in run/wolf.rs.

use super::entities::{AiState, Companion};
use super::targets::Side;
use super::{ai, perception, Run};
use crate::collision::walk_line;
use crate::defs::companions::{Escort, KNIGHT_ESCORT, COMPANION_REACH_EVERY, WOLF_RADIUS};
use crate::defs::effects::EffectKind;
use crate::defs::enemies;
use crate::defs::kinds::Anim;
use crate::dungeon::{Map, Mover};
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

/// The first of 8 points 12 px around `pos` (east first, then clockwise) where the
/// companion can stand: walkable ground, clear of solid objects. None when there is no such point.
pub fn spot_beside(run: &Run, pos: Vec2) -> Option<Vec2> {
    let solids = run.solids(None);
    (0..8)
        .map(|i| pos + Vec2::from_angle(i as f64 * std::f64::consts::FRAC_PI_4) * 12.0)
        .find(|&p| !run.layout.map.blocks_at(p, Mover::Enemy) && !solids.iter().any(|s| (p.x - s.x).abs() < s.half + WOLF_RADIUS && (p.y - s.y).abs() < s.half + WOLF_RADIUS))
}

/// Where a summoned companion appears: beside `pos`, else the nearest walkable tile centre within
/// 2 tiles, else `pos` itself (a summon is never refused).
pub fn summon_spot(run: &Run, pos: Vec2) -> Vec2 {
    spot_beside(run, pos).unwrap_or_else(|| {
        let (tx, ty) = Map::tile_of(pos);
        (-2i32..=2)
            .flat_map(|dy| (-2i32..=2).map(move |dx| (tx + dx, ty + dy)))
            .map(|(x, y)| Map::center_of(x, y))
            .filter(|&c| !run.layout.map.blocks_at(c, Mover::Enemy))
            .min_by(|a, b| a.dist(pos).total_cmp(&b.dist(pos)))
            .unwrap_or(pos)
    })
}

pub(super) fn set_anim(run: &mut Run, mi: usize, a: Anim) {
    let m = &mut run.monsters[mi];
    if m.anim != a {
        m.anim = a;
        m.anim_start = run.time;
    }
}

/// Whether companion `mi` must reappear beside its leader: far from them, or (checked every
/// `COMPANION_REACH_EVERY` s) unable to reach them, as behind a sealed door. Mid-dash it may be over a chasm,
/// where no path starts: no reach check then.
pub fn lost(run: &mut Run, mi: usize, leader: Vec2, e: &Escort, dt: f64) -> bool {
    let pos = run.monsters[mi].pos;
    let dashing = run.monsters[mi].dash.is_some();
    let mut lost = pos.dist(leader) > e.reappear;
    let c = run.monsters[mi].companion.as_mut().expect("a companion");
    c.reach_t -= dt;
    if c.reach_t <= 0.0 && !dashing {
        c.reach_t = COMPANION_REACH_EVERY;
        let map = &run.layout.map;
        // A leader on lava or over a chasm cannot be reached on foot, and no spot beside them is safe.
        lost |= !map.blocks_at(leader, Mover::Enemy) && !(walk_line(map, pos, leader, Mover::Enemy) || ai::astar(map, pos, leader, 2500, Mover::Enemy).is_some());
    }
    lost
}

/// The companion appears beside its leader with the green puff, dropping whatever it was doing.
/// With no free spot beside them it stays where it is (false).
pub fn reappear(run: &mut Run, mi: usize, leader: Vec2) -> bool {
    let Some(spot) = spot_beside(run, leader) else { return false };
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

/// The companion `mi` this tick: reappear beside its leader when lost, else fight its prey through the
/// enemy AI, else follow. Not called while it is pushed, sinking, asleep or frozen (`Run::step`).
pub fn tick(run: &mut Run, mi: usize, dt: f64) {
    let Some(leader) = run.monsters[mi].companion.as_ref().and_then(|c| run.player_idx(c.leader)).filter(|&pi| run.players[pi].alive) else {
        run.monsters[mi].ai.state = AiState::Idle;
        return;
    };
    let at = run.players[leader].pos();
    if lost(run, mi, at, &KNIGHT_ESCORT, dt) && reappear(run, mi, at) {
        return;
    }
    let prey = find_prey(run, mi, at, &KNIGHT_ESCORT);
    run.monsters[mi].companion.as_mut().expect("a companion").prey = prey.map(|pi| run.monsters[pi].id);
    if prey.is_some() {
        ai::tick_monster(run, mi, dt);
    } else {
        let m = &mut run.monsters[mi];
        m.ai.windup = None;
        m.ai.state = AiState::Idle;
        let speed = enemies::def(m.etype.expect("a companion enemy")).speed;
        follow(run, mi, leader, &KNIGHT_ESCORT, speed, dt);
    }
}

/// Companion `mi` has fallen: no XP, no coins, no kill.
pub fn died(run: &mut Run, mi: usize) {
    let m = &mut run.monsters[mi];
    m.alive = false;
    m.hp = 0.0;
    let (id, pos, kind) = (m.id, m.pos, m.kind);
    let name = super::rules_log::tags::tag_name(kind).unwrap_or("companion");
    run.event(Ev::Died { id, x: pos.x as f32, y: pos.y as f32, kind: kind as u8 }, None);
    run.event(Ev::Msg { text: format!("The {name} has fallen") }, None);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::companions::KNIGHT_ESCORT;
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

    // ---- The knight: follow, guard and fight through the enemy AI ----

    /// Open lit floor around the heroes; two heroes (host first).
    fn knight_run() -> Run {
        let mut run = test_run(&[ClassId::Wizard, ClassId::Paladin], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        crate::run::ai::tests::open_floor(&mut run);
        run.lights.fill();
        run
    }

    /// A Friendly knight recruited by hero `recruiter`, 20 px east of them.
    fn knight_with(run: &mut Run, recruiter: usize) -> usize {
        let at = run.players[recruiter].pos() + Vec2::new(20.0, 0.0);
        let id = run.spawn_enemy(EnemyType::Knight, at, None);
        let mi = run.monster_idx(id).unwrap();
        let hero = run.players[recruiter].id;
        let m = &mut run.monsters[mi];
        m.side = Side::Friendly;
        m.companion = Some(Companion { leader: hero, recruiter: hero, summoned: false, prey: None, following: false, reach_t: 0.0, last_safe: at });
        mi
    }

    /// Moves every hero to `to`.
    fn move_heroes(run: &mut Run, to: Vec2) {
        for p in run.players.iter_mut() {
            p.mv.x = to.x;
            p.mv.y = to.y;
        }
    }

    /// An orc `dx` px east of hero 0 that stands still (held) with plenty of HP, so only the knight's blows count.
    fn dummy_orc(run: &mut Run, dx: f64) -> usize {
        let id = run.spawn_enemy(EnemyType::OrcWarrior, run.players[0].pos() + Vec2::new(dx, 0.0), None);
        let oi = run.monster_idx(id).unwrap();
        run.monsters[oi].ai.hold = 1e9;
        run.monsters[oi].hp = 1000.0;
        run.monsters[oi].max_hp = 1000.0;
        oi
    }

    #[test]
    fn knight_follows_its_leader() {
        let mut run = knight_run();
        let mi = knight_with(&mut run, 0);
        let to = run.players[0].pos() + Vec2::new(100.0, 0.0);
        move_heroes(&mut run, to);
        for _ in 0..60 {
            run.step();
        }
        let d = run.monsters[mi].pos.dist(run.players[0].pos());
        assert!(d <= KNIGHT_ESCORT.follow, "the knight caught up: {d}");
    }

    #[test]
    fn knight_fights_the_enemy_nearest_its_leader() {
        let mut run = knight_run();
        let mi = knight_with(&mut run, 0);
        let (near, far) = (dummy_orc(&mut run, 30.0), dummy_orc(&mut run, 60.0));
        let (max0, max1) = (run.players[0].max_hp, run.players[1].max_hp);
        let mut first_hurt = None;
        for _ in 0..240 {
            run.step();
            if first_hurt.is_none() {
                first_hurt = [near, far].into_iter().find(|&o| run.monsters[o].hp < 1000.0);
            }
        }
        assert_eq!(first_hurt, Some(near), "the nearer orc was hit first");
        // The orcs are held, so any damage to a hero or the knight's own side would come from the knight.
        assert!(run.players[0].hp == max0 && run.players[1].hp == max1, "no hero was hurt");
        assert!(run.monsters[mi].hp == run.monsters[mi].max_hp, "the knight was not hurt");
    }

    #[test]
    fn knight_keeps_its_leash() {
        let mut run = knight_run();
        let mi = knight_with(&mut run, 0);
        let orc = dummy_orc(&mut run, 200.0);
        for _ in 0..120 {
            run.step();
        }
        let d = run.monsters[mi].pos.dist(run.players[0].pos());
        assert!(d <= KNIGHT_ESCORT.leash, "the knight stayed within its leash: {d}");
        assert_eq!(run.monsters[orc].hp, 1000.0, "the orc beyond the leash was left alone");
    }

    #[test]
    fn knight_reappears_when_lost() {
        let mut run = knight_run();
        let mi = knight_with(&mut run, 0);
        let to = run.players[0].pos() + Vec2::new(300.0, 0.0);
        move_heroes(&mut run, to);
        run.step();
        let d = run.monsters[mi].pos.dist(run.players[0].pos());
        assert!(d <= 20.0, "the knight is beside the hero: {d}");
    }

    #[test]
    fn knight_kill_pays_the_party() {
        let mut run = knight_run();
        let mi = knight_with(&mut run, 0);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, run.players[0].pos() + Vec2::new(30.0, 0.0), None);
        let oi = run.monster_idx(id).unwrap();
        run.monsters[oi].ai.hold = 1e9;
        let xp = crate::defs::progression::xp_for_kill(Some(EnemyType::OrcWarrior));
        let before: Vec<u32> = run.players.iter().map(|p| p.xp).collect();
        let kid = run.monsters[mi].id;
        let gone = |run: &Run| run.monsters.iter().all(|m| m.id != id || !m.alive);
        for _ in 0..1200 {
            run.step();
            if gone(&run) {
                break;
            }
        }
        assert!(gone(&run), "the knight killed the orc");
        assert!(run.monsters.iter().any(|m| m.id == kid && m.alive), "the knight lives");
        for (p, b) in run.players.iter().zip(before) {
            assert_eq!(p.xp, b + xp, "every hero gained the XP");
        }
        assert_eq!(run.players[0].kills, 1, "the leader is credited");
        assert_eq!(run.players[1].kills, 0);
    }

    #[test]
    fn companion_falling_gives_nothing() {
        use crate::run::entities::Sink;
        let mut run = knight_run();
        let mi = knight_with(&mut run, 0);
        let kid = run.monsters[mi].id;
        run.monsters[mi].sinking = Some((0.05, Sink::Fall));
        run.events.clear();
        let before: Vec<(u32, u32, u32)> = run.players.iter().map(|p| (p.xp, p.kills, p.coins)).collect();
        for _ in 0..10 {
            run.step();
        }
        assert!(run.monsters.iter().all(|m| m.id != kid || (!m.alive && m.hp == 0.0)), "the knight is dead");
        let after: Vec<(u32, u32, u32)> = run.players.iter().map(|p| (p.xp, p.kills, p.coins)).collect();
        assert_eq!(before, after, "no XP, kills or coins");
        assert!(!run.events.iter().any(|(e, _)| matches!(e, Ev::Coins { .. })));
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Msg { text } if text == "The Knight has fallen")), "the message");
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Died { .. })));
    }
}
