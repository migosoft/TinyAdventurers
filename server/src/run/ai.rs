//! Enemy AI: perception (sight radius + line of sight), chase/attack,
//! search last known position, return home, and A* pathfinding.

use super::abilities::spawn_monster_projectile;
use super::entities::{AiState, Windup};
use super::Run;
use crate::collision::{line_of_sight, move_box};
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::enemies::{self, AttackStyle, EnemyType};
use crate::defs::kinds::Anim;
use crate::dungeon::Map;
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
    let (x, y) = move_box(&run.dungeon.map, m.pos.x, m.pos.y, v.x, v.y, m.radius);
    let m = &mut run.monsters[mi];
    m.pos = Vec2::new(x, y);
    false
}

/// Follow an A* path to `goal`, recomputing it periodically.
fn path_toward(run: &mut Run, mi: usize, goal: Vec2, speed: f64, dt: f64) -> bool {
    let (pos, need_repath) = {
        let m = &mut run.monsters[mi];
        m.ai.repath_t -= dt;
        (m.pos, m.ai.path.is_empty() || m.ai.repath_t <= 0.0)
    };
    if pos.dist(goal) < 4.0 {
        return true;
    }
    if line_of_sight(&run.dungeon.map, pos, goal) {
        run.monsters[mi].ai.path.clear();
        return move_toward(run, mi, goal, speed, dt);
    }
    if need_repath {
        let path = astar(&run.dungeon.map, pos, goal, 2500).unwrap_or_default();
        let m = &mut run.monsters[mi];
        m.ai.path = path;
        m.ai.repath_t = 0.6;
        if m.ai.path.is_empty() {
            return true; // unreachable: give up
        }
    }
    let Some(&next) = run.monsters[mi].ai.path.first() else { return true };
    if move_toward(run, mi, next, speed, dt) {
        run.monsters[mi].ai.path.remove(0);
    }
    false
}

pub fn tick_monster(run: &mut Run, mi: usize, dt: f64) {
    let Some(etype) = run.monsters[mi].etype else { return };
    if run.monsters[mi].asleep {
        return;
    }
    let def = enemies::def(etype);
    let (pos, sight) = (run.monsters[mi].pos, run.monsters[mi].sight);
    {
        let ai = &mut run.monsters[mi].ai;
        ai.cd -= dt;
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
            run.monsters[mi].ai.windup = Some(Windup { t, aim: w.aim });
            return;
        }
        run.monsters[mi].ai.windup = None;
        if let Some(pi) = seen {
            perform_attack(run, mi, pi, def.attack);
        }
        return;
    }

    if etype == EnemyType::Necromancer {
        if let Some(_pi) = seen {
            let minions = run.monsters.iter().filter(|o| o.alive && o.owner == Some(run.monsters[mi].id)).count();
            if run.monsters[mi].ai.raise_cd <= 0.0 && minions < enemies::NECRO_MAX_MINIONS {
                raise_skeleton(run, mi);
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
            let (range, preferred, windup, cooldown) = match def.attack {
                AttackStyle::Melee { range, windup, cooldown, .. } => (range + PLAYER_RADIUS + def.radius, 0.0, windup, cooldown),
                AttackStyle::Ranged { range, preferred, windup, cooldown, .. } => (range, preferred, windup, cooldown),
            };
            let _ = cooldown;
            if d <= range && run.monsters[mi].ai.cd <= 0.0 {
                run.monsters[mi].ai.windup = Some(Windup { t: windup, aim });
                set_anim(run, mi, Anim::Windup);
                return;
            }
            if def.speed <= 0.0 {
                return;
            }
            let speed = def.speed;
            if preferred > 0.0 && d < preferred - 25.0 {
                // Ranged enemies back off to their preferred distance.
                let away = pos + (pos - ppos).norm() * 16.0;
                move_toward(run, mi, away, speed * 0.8, dt);
                set_anim(run, mi, Anim::Move);
            } else if d > range * 0.85 || preferred == 0.0 && d > range * 0.7 {
                move_toward(run, mi, ppos, speed, dt);
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
            let arrived = path_toward(run, mi, goal, def.speed, dt);
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
            if path_toward(run, mi, home, def.speed * 0.7, dt) {
                run.monsters[mi].ai.state = AiState::Idle;
                set_anim(run, mi, Anim::Idle);
            } else {
                set_anim(run, mi, Anim::Move);
            }
        }
        AiState::Idle => {
            if def.speed <= 0.0 || etype == EnemyType::Disciple {
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

fn perform_attack(run: &mut Run, mi: usize, pi: usize, attack: AttackStyle) {
    let pos = run.monsters[mi].pos;
    let ppos = run.players[pi].pos();
    let aim = pos.angle_to(ppos);
    run.monsters[mi].aim = aim;
    match attack {
        AttackStyle::Melee { range, damage, cooldown, .. } => {
            run.monsters[mi].ai.cd = cooldown;
            set_anim(run, mi, Anim::Melee);
            let reach = range + PLAYER_RADIUS + run.monsters[mi].radius + 4.0;
            if pos.dist(ppos) <= reach {
                run.hurt_player(pi, damage);
            }
        }
        AttackStyle::Ranged { projectile, speed, damage, cooldown, range, .. } => {
            run.monsters[mi].ai.cd = cooldown * run.rng.gen_range(0.85..1.15);
            set_anim(run, mi, Anim::Shoot);
            let id = run.monsters[mi].id;
            let dir = Vec2::from_angle(aim);
            spawn_monster_projectile(run, id, projectile, pos + dir * 5.0, dir, speed, damage, range * 1.3 / speed, 0.0, 0);
        }
    }
}

fn raise_skeleton(run: &mut Run, mi: usize) {
    let (pos, id) = (run.monsters[mi].pos, run.monsters[mi].id);
    run.monsters[mi].ai.raise_cd = enemies::NECRO_RAISE_COOLDOWN;
    set_anim(run, mi, Anim::Cast);
    let party = run.players.len();
    for k in 0..2 {
        let a = run.rng.gen_range(0.0..std::f64::consts::TAU);
        let mut spot = pos + Vec2::from_angle(a) * 14.0;
        if run.dungeon.map.solid_at(spot) {
            spot = pos;
        }
        let minions = run.monsters.iter().filter(|o| o.alive && o.owner == Some(id)).count();
        if minions >= enemies::NECRO_MAX_MINIONS || k > 0 && run.rng.gen_bool(0.5) {
            break;
        }
        run.spawn_enemy(EnemyType::RaisedSkeleton, spot, Some(id), party);
        run.event(Ev::Raise { x: spot.x as f32, y: spot.y as f32 }, Some(spot));
    }
}

/// Push overlapping monsters apart so groups don't stack on one spot.
pub fn separate_monsters(run: &mut Run) {
    let n = run.monsters.len();
    for i in 0..n {
        if !run.monsters[i].alive || run.monsters[i].speed <= 0.0 {
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
                let r = run.monsters[i].radius;
                let (x, y) = move_box(&run.dungeon.map, a.x, a.y, push.x.clamp(-2.0, 2.0), push.y.clamp(-2.0, 2.0), r);
                run.monsters[i].pos = Vec2::new(x, y);
            }
        }
    }
}

/// 4-directional A* on tiles. Returns waypoints (tile centers), excluding the start tile.
pub fn astar(map: &Map, from: Vec2, to: Vec2, max_nodes: usize) -> Option<Vec<Vec2>> {
    let start = Map::tile_of(from);
    let goal = Map::tile_of(to);
    if map.solid(goal.0, goal.1) {
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
            if map.solid(nb.0, nb.1) {
                continue;
            }
            let ng = cg + 1;
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
    use super::super::tests::test_run;
    use super::*;
    use crate::dungeon::Tile;
    use crate::protocol::{BossId, ClassId};

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
        raise_skeleton(&mut run, ni);
        run.monsters[ni].ai.raise_cd = 0.0;
        raise_skeleton(&mut run, ni);
        let minions = run.monsters.iter().filter(|m| m.owner == Some(necro) && m.alive).count();
        assert!(minions >= 1);
        run.kill_monster(ni);
        let minions = run.monsters.iter().filter(|m| m.owner == Some(necro) && m.alive).count();
        assert_eq!(minions, 0);
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
        let p = astar(&m, Map::center_of(2, 2), Map::center_of(8, 2), 1000).unwrap();
        assert!(p.iter().any(|w| Map::tile_of(*w).1 >= 9));
    }
}
