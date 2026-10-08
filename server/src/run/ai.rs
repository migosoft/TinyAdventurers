//! Enemy AI: perception (sight radius + line of sight), chase/attack,
//! search last known position, return home, and A* pathfinding.

use super::abilities::spawn_monster_projectile;
use super::entities::{AiState, Windup};
use super::Run;
use crate::collision::{line_of_sight, move_box, terrain_line, walk_line};
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::enemies::{self, AttackStyle, EnemyType};
use crate::defs::kinds::Anim;
use crate::dungeon::{Map, Mover, TILE};
use crate::math::Vec2;
use crate::protocol::Ev;
use rand::Rng;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};

/// Nearest living, non-hidden player the monster can see right now.
pub fn find_visible_player(run: &Run, from: Vec2, sight: f64) -> Option<usize> {
    run.players
        .iter()
        .enumerate()
        .filter(|(_, p)| p.alive && p.hidden <= 0.0)
        .map(|(i, p)| (i, p.pos().dist(from)))
        .filter(|&(i, d)| d <= sight && line_of_sight(&run.dungeon.map, from, run.players[i].pos()))
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(i, _)| i)
}

fn set_anim(run: &mut Run, mi: usize, a: Anim) {
    let m = &mut run.monsters[mi];
    if m.anim != a {
        m.anim = a;
        m.anim_start = run.time;
    }
}

/// Move a monster toward `to` with wall sliding. Returns true when arrived.
pub fn move_toward(run: &mut Run, mi: usize, to: Vec2, speed: f64, dt: f64) -> bool {
    let m = &run.monsters[mi];
    let d = to - m.pos;
    let dist = d.len();
    if dist < 2.0 {
        return true;
    }
    let step = (speed * dt).min(dist);
    let v = d.norm() * step;
    let (x, y) = move_box(&run.dungeon.map, m.pos.x, m.pos.y, v.x, v.y, m.radius, m.mover);
    let m = &mut run.monsters[mi];
    m.pos = Vec2::new(x, y);
    false
}

/// Follow an A* path to `goal`, recomputing it periodically. Figures wider
/// than a tile (the demon, the dragon) prefer paths a tile clear of walls and
/// terrain, so they rarely wedge into a pit corner, and skip a waypoint they
/// cannot get any closer to. A boss that finds no path walks straight at the
/// goal instead of giving up.
pub fn path_toward(run: &mut Run, mi: usize, goal: Vec2, speed: f64, dt: f64) -> bool {
    let (pos, need_repath) = {
        let m = &mut run.monsters[mi];
        m.ai.repath_t -= dt;
        (m.pos, m.ai.path.is_empty() || m.ai.repath_t <= 0.0)
    };
    if pos.dist(goal) < 4.0 {
        return true;
    }
    let (mover, radius, is_boss) = (run.monsters[mi].mover, run.monsters[mi].radius, run.monsters[mi].is_boss);
    let wide = radius > TILE / 2.0;
    let side = (goal - pos).norm().perp() * radius;
    let map = &run.dungeon.map;
    if walk_line(map, pos, goal, mover) && (!wide || terrain_line(map, pos + side, goal + side, mover) && terrain_line(map, pos - side, goal - side, mover)) {
        run.monsters[mi].ai.path.clear();
        return move_toward(run, mi, goal, speed, dt);
    }
    if need_repath {
        let path = astar_clear(&run.dungeon.map, pos, goal, 2500, mover, wide).unwrap_or_default();
        let m = &mut run.monsters[mi];
        m.ai.path = path;
        m.ai.repath_t = 0.6;
        if m.ai.path.is_empty() {
            if is_boss {
                return move_toward(run, mi, goal, speed, dt);
            }
            return true; // unreachable: give up
        }
    }
    let Some(&next) = run.monsters[mi].ai.path.first() else { return true };
    let before = run.monsters[mi].pos;
    let arrived = move_toward(run, mi, next, speed, dt);
    let stuck = wide && run.monsters[mi].pos.dist(before) < speed * dt * 0.25;
    if arrived || stuck {
        run.monsters[mi].ai.path.remove(0);
    }
    false
}

pub fn tick_monster(run: &mut Run, mi: usize, dt: f64) {
    let Some(etype) = run.monsters[mi].etype else { return };
    if run.monsters[mi].asleep {
        return;
    }
    if run.monsters[mi].ai.hold > 0.0 {
        run.monsters[mi].ai.hold -= dt;
        return;
    }
    let def = enemies::def(etype);
    let (pos, sight) = (run.monsters[mi].pos, run.monsters[mi].sight);
    {
        let ai = &mut run.monsters[mi].ai;
        ai.cd -= dt;
        ai.alt_cd -= dt;
        ai.raise_cd -= dt;
    }

    // Perception: only players in sight radius with line of sight count.
    let seen = find_visible_player(run, pos, sight);
    if let Some(pi) = seen {
        let (pid, ppos) = (run.players[pi].id, run.players[pi].pos());
        let ai = &mut run.monsters[mi].ai;
        ai.target = Some(pid);
        ai.last_known = ppos;
        ai.state = AiState::Chase;
        ai.path.clear();
    } else if run.monsters[mi].ai.target.is_some() {
        let ai = &mut run.monsters[mi].ai;
        ai.target = None;
        ai.windup = None;
        ai.state = AiState::Search;
        ai.search_t = 2.0;
    }

    // Disciples channel the lich and otherwise only shoot.
    if etype == EnemyType::Disciple {
        set_anim(run, mi, if run.monsters[mi].ai.windup.is_some() { Anim::Windup } else { Anim::Channel });
    }

    // Finish a wind-up: the attack lands only if the target is still seen.
    if let Some(w) = run.monsters[mi].ai.windup {
        let t = w.t - dt;
        if t > 0.0 {
            run.monsters[mi].ai.windup = Some(Windup { t, aim: w.aim, alt: w.alt });
            return;
        }
        run.monsters[mi].ai.windup = None;
        if let Some(pi) = seen {
            let attack = if w.alt { def.alt.unwrap_or(def.attack) } else { def.attack };
            perform_attack(run, mi, pi, attack, w.alt);
        }
        return;
    }

    if matches!(etype, EnemyType::Necromancer | EnemyType::Summoner) {
        if let Some(_pi) = seen {
            let minions = run.monsters.iter().filter(|o| o.alive && o.owner == Some(run.monsters[mi].id)).count();
            if run.monsters[mi].ai.raise_cd <= 0.0 && minions < enemies::NECRO_MAX_MINIONS {
                raise_minions(run, mi, etype == EnemyType::Summoner);
                return;
            }
        }
    }

    match run.monsters[mi].ai.state {
        AiState::Chase => {
            let Some(pi) = seen else { return };
            let ppos = run.players[pi].pos();
            let d = pos.dist(ppos);
            let aim = pos.angle_to(ppos);
            run.monsters[mi].aim = aim;
            // Reach and wind-up of an attack; movement follows the main attack.
            let reach = |a: AttackStyle| match a {
                AttackStyle::Melee { range, windup, .. } => (range + PLAYER_RADIUS + def.radius, 0.0, windup),
                AttackStyle::Ranged { range, preferred, windup, .. } => (range, preferred, windup),
                AttackStyle::Slam { radius, windup, .. } => (radius, 0.0, windup),
            };
            let (range, preferred, _) = reach(def.attack);
            if let Some(alt) = def.alt {
                // Second attack: a claw when the target is in reach, a bolt only from afar.
                let (alt_range, _, windup) = reach(alt);
                let usable = match alt {
                    AttackStyle::Melee { .. } => d <= alt_range,
                    AttackStyle::Ranged { .. } => d <= alt_range && d >= enemies::ALT_BOLT_MIN_DIST && d > range,
                    // A slam is worth it for two heroes in reach, or one while the club recovers.
                    AttackStyle::Slam { radius, .. } => {
                        let near = run.players.iter().filter(|p| p.alive && p.pos().dist(pos) <= radius).count();
                        near >= 2 || near == 1 && run.monsters[mi].ai.cd > 0.0
                    }
                };
                if usable && run.monsters[mi].ai.alt_cd <= 0.0 {
                    run.monsters[mi].ai.windup = Some(Windup { t: windup, aim, alt: true });
                    set_anim(run, mi, if matches!(alt, AttackStyle::Slam { .. }) { Anim::Slam } else { Anim::Windup });
                    return;
                }
            }
            if d <= range && run.monsters[mi].ai.cd <= 0.0 {
                let (_, _, windup) = reach(def.attack);
                run.monsters[mi].ai.windup = Some(Windup { t: windup, aim, alt: false });
                set_anim(run, mi, Anim::Windup);
                return;
            }
            if def.speed <= 0.0 {
                return;
            }
            let speed = gait(run, mi, def.speed);
            if preferred > 0.0 && d < preferred - 25.0 {
                // Ranged enemies back off to their preferred distance.
                let away = pos + (pos - ppos).norm() * 16.0;
                move_toward(run, mi, away, speed * 0.8, dt);
                set_anim(run, mi, Anim::Move);
            } else if d > range * 0.85 || preferred == 0.0 && d > range * 0.7 {
                // Wide figures (the ogre) path around corners and terrain edges.
                if def.radius > TILE / 2.0 {
                    path_toward(run, mi, ppos, speed, dt);
                } else {
                    move_toward(run, mi, ppos, speed, dt);
                }
                set_anim(run, mi, Anim::Move);
            } else {
                set_anim(run, mi, Anim::Idle);
            }
        }
        AiState::Search => {
            if def.speed <= 0.0 {
                run.monsters[mi].ai.state = AiState::Idle;
                return;
            }
            let goal = run.monsters[mi].ai.last_known;
            let speed = gait(run, mi, def.speed);
            let arrived = path_toward(run, mi, goal, speed, dt);
            if arrived {
                set_anim(run, mi, Anim::Idle);
                let ai = &mut run.monsters[mi].ai;
                ai.search_t -= dt;
                if ai.search_t <= 0.0 {
                    ai.state = AiState::Return;
                    ai.path.clear();
                }
            } else {
                set_anim(run, mi, Anim::Move);
            }
        }
        AiState::Return => {
            let home = run.monsters[mi].ai.home;
            let speed = gait(run, mi, def.speed * 0.7);
            if path_toward(run, mi, home, speed, dt) {
                run.monsters[mi].ai.state = AiState::Idle;
                set_anim(run, mi, Anim::Idle);
            } else {
                set_anim(run, mi, Anim::Move);
            }
        }
        AiState::Idle => {
            // Disciples stand still; an awake mimic waits where it was found.
            if def.speed <= 0.0 || etype == EnemyType::Disciple || etype == EnemyType::Mimic {
                return;
            }
            let home = run.monsters[mi].ai.home;
            run.monsters[mi].ai.wander_t -= dt;
            if run.monsters[mi].ai.wander_t <= 0.0 {
                let off = Vec2::new(run.rng.gen_range(-24.0..24.0), run.rng.gen_range(-24.0..24.0));
                let ai = &mut run.monsters[mi].ai;
                ai.wander_t = 3.0 + (off.x.abs() / 8.0);
                ai.wander_to = Some(home + off);
            }
            if let Some(to) = run.monsters[mi].ai.wander_to {
                let before = run.monsters[mi].pos;
                if move_toward(run, mi, to, def.speed * 0.4, dt) || run.monsters[mi].pos.dist2(before) < 1e-6 {
                    run.monsters[mi].ai.wander_to = None;
                    set_anim(run, mi, Anim::Idle);
                } else {
                    let a = before.angle_to(to);
                    run.monsters[mi].aim = a;
                    set_anim(run, mi, Anim::Move);
                }
            }
        }
    }
}

/// Movement speed for this tick. Mimics hop: no movement on the ground
/// (crouch, landing, rest), and the average speed packed into the airborne
/// part of each cycle. The hop clock is the Move animation clock, so the
/// client can draw the same phases.
fn gait(run: &Run, mi: usize, speed: f64) -> f64 {
    let m = &run.monsters[mi];
    if m.etype != Some(EnemyType::Mimic) {
        return speed;
    }
    if m.anim != Anim::Move {
        return 0.0; // the hop starts next tick, with a fresh clock
    }
    let phase = ((run.time - m.anim_start) / enemies::MIMIC_HOP_CYCLE).fract();
    let (a, b) = enemies::MIMIC_HOP_AIR;
    if phase >= a && phase < b {
        speed / (b - a)
    } else {
        0.0
    }
}

/// Minimum pause (s) between a monster's two different attacks.
const ATTACK_GAP: f64 = 0.4;

/// `alt`: the second attack, which has its own cooldown. Either attack also
/// keeps the other one back for a moment, so they never land at once.
fn perform_attack(run: &mut Run, mi: usize, pi: usize, attack: AttackStyle, alt: bool) {
    let pos = run.monsters[mi].pos;
    let ppos = run.players[pi].pos();
    let aim = pos.angle_to(ppos);
    run.monsters[mi].aim = aim;
    let set_cd = |run: &mut Run, cd: f64| {
        let ai = &mut run.monsters[mi].ai;
        if alt {
            ai.alt_cd = cd;
            ai.cd = ai.cd.max(ATTACK_GAP);
        } else {
            ai.cd = cd;
            ai.alt_cd = ai.alt_cd.max(ATTACK_GAP);
        }
    };
    match attack {
        AttackStyle::Melee { range, damage, cooldown, knock, .. } => {
            set_cd(run, cooldown);
            set_anim(run, mi, Anim::Melee);
            let reach = range + PLAYER_RADIUS + run.monsters[mi].radius + 4.0;
            if pos.dist(ppos) <= reach {
                run.hurt_player(pi, damage);
                run.knock_player(pi, pos, aim, knock);
            }
        }
        AttackStyle::Ranged { projectile, speed, damage, cooldown, range, .. } => {
            let cd = cooldown * run.rng.gen_range(0.85..1.15);
            set_cd(run, cd);
            set_anim(run, mi, Anim::Shoot);
            let id = run.monsters[mi].id;
            let dir = Vec2::from_angle(aim);
            spawn_monster_projectile(run, id, projectile, pos + dir * 5.0, dir, speed, damage, range * 1.3 / speed, 0.0, 0);
        }
        AttackStyle::Slam { radius, damage, cooldown, knock, .. } => {
            set_cd(run, cooldown);
            set_anim(run, mi, Anim::Idle);
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: radius as f32, k: 5 }, Some(pos));
            for qi in 0..run.players.len() {
                let q = &run.players[qi];
                if q.alive && q.pos().dist(pos) <= radius {
                    let away = pos.angle_to(q.pos());
                    run.hurt_player(qi, damage);
                    run.knock_player(qi, pos, away, knock);
                }
            }
        }
    }
}

/// Necromancers raise skeletons; summoners (`fire`) summon imps.
fn raise_minions(run: &mut Run, mi: usize, fire: bool) {
    let (pos, id) = (run.monsters[mi].pos, run.monsters[mi].id);
    run.monsters[mi].ai.raise_cd = enemies::NECRO_RAISE_COOLDOWN;
    set_anim(run, mi, Anim::Cast);
    let party = run.players.len();
    for k in 0..2 {
        let a = run.rng.gen_range(0.0..std::f64::consts::TAU);
        let mut spot = pos + Vec2::from_angle(a) * 14.0;
        if run.dungeon.map.blocks_at(spot, run.monsters[mi].mover) {
            spot = pos;
        }
        let minions = run.monsters.iter().filter(|o| o.alive && o.owner == Some(id)).count();
        if minions >= enemies::NECRO_MAX_MINIONS || k > 0 && run.rng.gen_bool(0.5) {
            break;
        }
        let t = if fire { EnemyType::SummonedImp } else { EnemyType::RaisedSkeleton };
        run.spawn_enemy(t, spot, Some(id), party);
        run.event(Ev::Raise { x: spot.x as f32, y: spot.y as f32, fire }, Some(spot));
    }
}

/// Push overlapping monsters apart so groups don't stack on one spot.
pub fn separate_monsters(run: &mut Run) {
    let n = run.monsters.len();
    for i in 0..n {
        if !run.monsters[i].alive || run.monsters[i].speed <= 0.0 || run.monsters[i].asleep {
            continue;
        }
        for j in 0..n {
            if i == j || !run.monsters[j].alive {
                continue;
            }
            let (a, b) = (run.monsters[i].pos, run.monsters[j].pos);
            let min = run.monsters[i].radius + run.monsters[j].radius;
            let d2 = a.dist2(b);
            if d2 < min * min && d2 > 1e-6 {
                let d = d2.sqrt();
                let push = (a - b) * ((min - d) / d * 0.5);
                let (r, mover) = (run.monsters[i].radius, run.monsters[i].mover);
                let (x, y) = move_box(&run.dungeon.map, a.x, a.y, push.x.clamp(-2.0, 2.0), push.y.clamp(-2.0, 2.0), r, mover);
                run.monsters[i].pos = Vec2::new(x, y);
            }
        }
    }
}

/// 4-directional A* on the tiles this mover can walk. Returns waypoints
/// (tile centers), excluding the start tile.
pub fn astar(map: &Map, from: Vec2, to: Vec2, max_nodes: usize, mover: Mover) -> Option<Vec<Vec2>> {
    astar_clear(map, from, to, max_nodes, mover, false)
}

/// A* as above; with `clear`, tiles next to anything this mover cannot enter
/// cost extra, so figures wider than a tile keep their distance where they can.
fn astar_clear(map: &Map, from: Vec2, to: Vec2, max_nodes: usize, mover: Mover, clear: bool) -> Option<Vec<Vec2>> {
    let near_blocked = |x: i32, y: i32| (-1..=1).any(|dy| (-1..=1).any(|dx| map.blocks(x + dx, y + dy, mover)));
    let start = Map::tile_of(from);
    let goal = Map::tile_of(to);
    if map.blocks(goal.0, goal.1, mover) {
        return None;
    }
    let h = |p: (i32, i32)| (p.0 - goal.0).abs() + (p.1 - goal.1).abs();
    let mut open = BinaryHeap::new();
    let mut came: HashMap<(i32, i32), (i32, i32)> = HashMap::new();
    let mut g: HashMap<(i32, i32), i32> = HashMap::new();
    g.insert(start, 0);
    open.push(Reverse((h(start), start)));
    let mut expanded = 0;
    while let Some(Reverse((_, cur))) = open.pop() {
        if cur == goal {
            let mut path = vec![to];
            let mut c = cur;
            while let Some(&prev) = came.get(&c) {
                if prev == start {
                    break;
                }
                path.push(Map::center_of(prev.0, prev.1));
                c = prev;
            }
            path.reverse();
            return Some(path);
        }
        expanded += 1;
        if expanded > max_nodes {
            return None;
        }
        let cg = g[&cur];
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let nb = (cur.0 + dx, cur.1 + dy);
            if map.blocks(nb.0, nb.1, mover) {
                continue;
            }
            let ng = cg + if clear && nb != goal && near_blocked(nb.0, nb.1) { 5 } else { 1 };
            if g.get(&nb).map_or(true, |&old| ng < old) {
                g.insert(nb, ng);
                came.insert(nb, cur);
                open.push(Reverse((ng + h(nb), nb)));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::super::tests::{test_run, test_run_seed};
    use super::*;
    use crate::defs::kinds::EntityKind;
    use crate::dungeon::Tile;
    use crate::protocol::{BossId, ClassId};

    #[test]
    fn wide_bosses_reach_every_spot_of_their_hall_around_the_chasms() {
        for seed in 0..24u64 {
            for boss in [BossId::Demon, BossId::Dragon] {
                let mut run = test_run_seed(&[ClassId::Paladin], boss, seed);
                let bi = run.monsters.iter().position(|m| m.is_boss).unwrap();
                let r = *run.dungeon.boss_hall();
                let home = r.center_px();
                let speed = run.monsters[bi].speed;
                for (x, y) in (r.y..r.y + r.h).flat_map(|y| (r.x..r.x + r.w).map(move |x| (x, y))).filter(|(x, y)| (x + y) % 3 == 0) {
                    if !run.dungeon.map.safe(x, y) {
                        continue;
                    }
                    let goal = Map::center_of(x, y);
                    run.monsters[bi].pos = home;
                    run.monsters[bi].ai.path.clear();
                    for _ in 0..(15.0 / super::super::DT) as usize {
                        if run.monsters[bi].pos.dist(goal) < 24.0 {
                            break;
                        }
                        path_toward(&mut run, bi, goal, speed, super::super::DT);
                    }
                    // Close enough to fight: a pocket by a wall-side chasm may keep a wide boss a little off.
                    let at = run.monsters[bi].pos;
                    let near = run.monsters[bi].radius + 2.0 * TILE;
                    assert!(at.dist(goal) < near, "seed {seed} {boss:?}: stuck at {at:?} on the way to {goal:?}");
                }
            }
        }
    }

    #[test]
    fn only_strong_melee_pushes() {
        let pushes = |t: EnemyType, alt: bool| {
            let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
            let ppos = run.players[0].pos();
            let id = run.spawn_enemy(t, ppos - Vec2::new(12.0, 0.0), None, 1);
            let mi = run.monster_idx(id).unwrap();
            let d = enemies::def(t);
            let attack = if alt { d.alt.unwrap() } else { d.attack };
            perform_attack(&mut run, mi, 0, attack, alt);
            run.players[0].mv.knocked()
        };
        assert!(pushes(EnemyType::OrcWarrior, false));
        assert!(pushes(EnemyType::Ogre, false), "ogre club");
        assert!(pushes(EnemyType::Ogre, true), "ogre slam");
        assert!(pushes(EnemyType::Chort, false), "chort claw");
        assert!(!pushes(EnemyType::Chort, true), "chort fire bolt");
        assert!(!pushes(EnemyType::Imp, true), "imp claw");
        assert!(!pushes(EnemyType::SkeletonWarrior, false));
        assert!(!pushes(EnemyType::OrcArcher, false));
    }

    #[test]
    fn enemy_ignores_player_without_line_of_sight_or_hidden() {
        let mut run = test_run(&[ClassId::Assassin], BossId::Demon);
        let ppos = run.players[0].pos();
        // Open line of sight: seen.
        assert!(find_visible_player(&run, ppos + Vec2::new(40.0, 0.0), 120.0).is_some());
        // Hidden: not seen.
        run.players[0].hidden = 3.0;
        assert!(find_visible_player(&run, ppos + Vec2::new(40.0, 0.0), 120.0).is_none());
        run.players[0].hidden = 0.0;
        // Wall in between: not seen.
        let (tx, ty) = Map::tile_of(ppos);
        for dy in -3..=3 {
            run.dungeon.map.set(tx + 1, ty + dy, Tile::Wall);
        }
        assert!(find_visible_player(&run, ppos + Vec2::new(40.0, 0.0), 120.0).is_none());
        // Out of sight radius: not seen.
        assert!(find_visible_player(&run, ppos + Vec2::new(0.0, -0.0) + Vec2::new(-200.0, 0.0), 120.0).is_none());
    }

    #[test]
    fn enemy_never_attacks_unseen_player() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        let ppos = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let mi_pos = ppos + Vec2::new(30.0, 0.0);
        run.spawn_enemy(EnemyType::GoblinArcher, mi_pos, None, 1);
        let (tx, ty) = Map::tile_of(ppos);
        for dy in -4..=4 {
            run.dungeon.map.set(tx + 1, ty + dy, Tile::Wall);
        }
        let hp = run.players[0].hp;
        for _ in 0..300 {
            run.step();
        }
        assert_eq!(run.players[0].hp, hp, "no damage through walls");
        assert!(run.projectiles.is_empty());
    }

    #[test]
    fn necromancer_death_kills_raised_skeletons() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let ppos = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let necro = run.spawn_enemy(EnemyType::Necromancer, ppos + Vec2::new(60.0, 0.0), None, 1);
        let ni = run.monster_idx(necro).unwrap();
        raise_minions(&mut run, ni, false);
        run.monsters[ni].ai.raise_cd = 0.0;
        raise_minions(&mut run, ni, false);
        let minions = run.monsters.iter().filter(|m| m.owner == Some(necro) && m.alive).count();
        assert!(minions >= 1);
        run.kill_monster(ni);
        let minions = run.monsters.iter().filter(|m| m.owner == Some(necro) && m.alive).count();
        assert_eq!(minions, 0);
    }

    #[test]
    fn demon_dungeon_has_demons_instead_of_skeletons() {
        let count = |run: &Run, t: EnemyType| run.monsters.iter().filter(|m| m.etype == Some(t)).count();
        let lich = test_run(&[ClassId::Wizard], BossId::Lich);
        let demon = test_run(&[ClassId::Wizard], BossId::Demon);
        // Same seed, same map and spawn spots: only the enemy types differ.
        assert_eq!(lich.dungeon.spawns.len(), demon.dungeon.spawns.len());
        assert!(count(&lich, EnemyType::SkeletonArcher) + count(&lich, EnemyType::SkeletonWarrior) > 0, "seed has skeletons");
        assert_eq!(count(&demon, EnemyType::Imp), count(&lich, EnemyType::SkeletonArcher));
        assert_eq!(count(&demon, EnemyType::Chort), count(&lich, EnemyType::SkeletonWarrior));
        assert_eq!(count(&demon, EnemyType::Summoner), count(&lich, EnemyType::Necromancer));
        for t in [EnemyType::SkeletonArcher, EnemyType::SkeletonWarrior, EnemyType::Necromancer] {
            assert_eq!(count(&demon, t), 0, "{t:?} in the demon's dungeon");
        }
        for t in [EnemyType::Imp, EnemyType::Chort, EnemyType::Summoner] {
            assert_eq!(count(&lich, t), 0, "{t:?} outside the demon's dungeon");
        }
    }

    /// Open floor around player 0, so test monsters always see it.
    fn open_floor(run: &mut Run) {
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 3..=ty + 3 {
            for x in tx - 8..=tx + 8 {
                run.dungeon.map.set(x, y, Tile::Floor);
            }
        }
    }

    /// A lone monster of type `t` at `off` from player 0, attacks ready.
    /// Returns which attack its first wind-up leads to (`Some(alt)`).
    fn first_windup(t: EnemyType, off: Vec2) -> Option<bool> {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        open_floor(&mut run);
        let ppos = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss);
        let id = run.spawn_enemy(t, ppos + off, None, 1);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].ai.cd = 0.0;
        run.monsters[mi].ai.alt_cd = 0.0;
        tick_monster(&mut run, mi, 1.0 / 60.0);
        run.monsters[mi].ai.windup.map(|w| w.alt)
    }

    #[test]
    fn imp_claws_up_close_and_shoots_from_afar() {
        assert_eq!(first_windup(EnemyType::Imp, Vec2::new(12.0, 0.0)), Some(true), "claw");
        assert_eq!(first_windup(EnemyType::Imp, Vec2::new(80.0, 0.0)), Some(false), "fire bolt");
    }

    #[test]
    fn chort_claws_up_close_and_throws_bolts_from_afar() {
        assert_eq!(first_windup(EnemyType::Chort, Vec2::new(12.0, 0.0)), Some(false), "claw");
        assert_eq!(first_windup(EnemyType::Chort, Vec2::new(30.0, 0.0)), None, "too close for a bolt, too far for a claw");
        assert_eq!(first_windup(EnemyType::Chort, Vec2::new(80.0, 0.0)), Some(true), "fire bolt");
    }

    /// Players 0.. stand at `offs` from a lone ogre on open floor, attacks ready.
    fn ogre_among(offs: &[Vec2]) -> (Run, usize) {
        let classes = vec![ClassId::Paladin; offs.len()];
        let mut run = test_run(&classes, BossId::Lich);
        open_floor(&mut run);
        let at = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss);
        let id = run.spawn_enemy(EnemyType::Ogre, at, None, 1);
        let mi = run.monster_idx(id).unwrap();
        for (p, off) in run.players.iter_mut().zip(offs) {
            p.mv.x = at.x + off.x;
            p.mv.y = at.y + off.y;
        }
        run.monsters[mi].ai.cd = 0.0;
        run.monsters[mi].ai.alt_cd = 0.0;
        (run, mi)
    }

    #[test]
    fn ogre_slams_a_crowd_and_clubs_a_lone_hero() {
        let (mut run, mi) = ogre_among(&[Vec2::new(20.0, 0.0), Vec2::new(-16.0, 8.0)]);
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert_eq!(run.monsters[mi].ai.windup.map(|w| w.alt), Some(true), "two heroes near: slam");
        assert_eq!(run.monsters[mi].anim, Anim::Slam, "the slam has its own telegraph");

        let (mut run, mi) = ogre_among(&[Vec2::new(20.0, 0.0)]);
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert_eq!(run.monsters[mi].ai.windup.map(|w| w.alt), Some(false), "one hero, club ready: club");

        let (mut run, mi) = ogre_among(&[Vec2::new(20.0, 0.0)]);
        run.monsters[mi].ai.cd = 1.0;
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert_eq!(run.monsters[mi].ai.windup.map(|w| w.alt), Some(true), "one hero while the club recovers: slam");
    }

    #[test]
    fn ogre_slam_hits_and_pushes_every_hero_in_reach_away_from_it() {
        let r = enemies::OGRE_SLAM_RADIUS;
        let (mut run, mi) = ogre_among(&[Vec2::new(20.0, 0.0), Vec2::new(0.0, -(r - 2.0)), Vec2::new(-(r + 6.0), 0.0)]);
        let hp: Vec<f64> = run.players.iter().map(|p| p.hp).collect();
        let slam = enemies::def(EnemyType::Ogre).alt.unwrap();
        run.events.clear();
        perform_attack(&mut run, mi, 0, slam, true);
        let p = &run.players;
        assert!(p[0].hp < hp[0] && p[0].mv.knock_vx > 0.0 && p[0].mv.knock_vy.abs() < 1e-9, "east hero pushed east");
        assert!(p[1].hp < hp[1] && p[1].mv.knock_vy < 0.0 && p[1].mv.knock_vx.abs() < 1e-9, "north hero pushed north");
        assert!(p[2].hp == hp[2] && !p[2].mv.knocked(), "hero outside the radius is spared");
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Boom { k: 5, .. })), "shockwave event");
        assert!(run.monsters[mi].ai.alt_cd > 1.0, "slam cooldown started");
    }

    #[test]
    fn alt_attack_uses_its_own_cooldown_and_projectile() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        open_floor(&mut run);
        let ppos = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss);
        let id = run.spawn_enemy(EnemyType::Chort, ppos + Vec2::new(80.0, 0.0), None, 1);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].ai.alt_cd = 0.0;
        for _ in 0..60 {
            tick_monster(&mut run, mi, 1.0 / 60.0);
            if !run.projectiles.is_empty() {
                break;
            }
        }
        assert_eq!(run.projectiles.len(), 1);
        assert_eq!(run.projectiles[0].kind, EntityKind::FireBolt);
        let ai = &run.monsters[mi].ai;
        assert!(ai.alt_cd > 2.0, "bolt cooldown started");
        assert!(ai.cd < 1.0, "claw cooldown untouched (only the short gap)");
    }

    #[test]
    fn summoner_summons_imps_that_die_with_it() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let ppos = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let s = run.spawn_enemy(EnemyType::Summoner, ppos + Vec2::new(60.0, 0.0), None, 1);
        let si = run.monster_idx(s).unwrap();
        run.events.clear();
        raise_minions(&mut run, si, true);
        let imps: Vec<_> = run.monsters.iter().filter(|m| m.owner == Some(s) && m.alive).collect();
        assert!(!imps.is_empty());
        assert!(imps.iter().all(|m| m.etype == Some(EnemyType::SummonedImp) && m.kind == EntityKind::Imp), "summoned imps look like imps");
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Raise { fire: true, .. })));
        run.kill_monster(si);
        assert_eq!(run.monsters.iter().filter(|m| m.owner == Some(s) && m.alive).count(), 0);
    }

    #[test]
    fn astar_keeps_enemies_out_of_terrain() {
        let mut m = Map::new(12, 12);
        for y in 1..11 {
            for x in 1..11 {
                m.set(x, y, Tile::Floor);
            }
        }
        for y in 1..10 {
            m.set(5, y, Tile::Lava);
            m.set(7, y, Tile::Chasm);
        }
        let (from, to) = (Map::center_of(2, 2), Map::center_of(6, 2));
        let around = |p: &Vec<Vec2>| p.iter().any(|w| Map::tile_of(*w).1 >= 10);
        assert!(around(&astar(&m, from, to, 1000, Mover::Enemy).unwrap()), "enemies go around lava");
        assert!(!around(&astar(&m, from, to, 1000, Mover::Demon).unwrap()), "demons walk through lava");
        let past = Map::center_of(9, 2);
        assert!(around(&astar(&m, from, past, 1000, Mover::Demon).unwrap()), "demons go around chasms");
    }

    #[test]
    fn astar_finds_path_around_wall() {
        let mut m = Map::new(12, 12);
        for y in 1..11 {
            for x in 1..11 {
                m.set(x, y, Tile::Floor);
            }
        }
        for y in 1..9 {
            m.set(5, y, Tile::Wall);
        }
        let p = astar(&m, Map::center_of(2, 2), Map::center_of(8, 2), 1000, Mover::Enemy).unwrap();
        assert!(p.iter().any(|w| Map::tile_of(*w).1 >= 9));
    }
}
