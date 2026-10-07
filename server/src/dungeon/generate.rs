//! Seeded dungeon generation.
//!
//! Built in a canonical orientation (start room at the bottom, boss hall
//! centered at the top), then rotated by a random quarter turn so the start
//! can be on any side and the boss hall is centered on the opposite side.

use super::{Dungeon, Map, Rect, Room, RoomKind, Spawn, Tile};
use crate::defs::enemies::EnemyType;
use crate::math::Vec2;
use rand::seq::SliceRandom;
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::collections::VecDeque;

pub const SIZE: i32 = 140;
const BOSS_W: i32 = 26;
const BOSS_H: i32 = 20;
const START_SIZE: i32 = 8;
const TARGET_ROOMS: usize = 24;

pub fn generate(seed: u64) -> Dungeon {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    // Retry until all guarantees hold (deterministic: same rng stream).
    for _ in 0..50 {
        if let Some(d) = try_generate(&mut rng) {
            return d;
        }
    }
    panic!("dungeon generation failed for seed {seed}");
}

fn try_generate(rng: &mut ChaCha8Rng) -> Option<Dungeon> {
    let mut map = Map::new(SIZE, SIZE);
    let mut rooms: Vec<Room> = Vec::new();

    let boss = Rect { x: SIZE / 2 - BOSS_W / 2, y: 3, w: BOSS_W, h: BOSS_H };
    let start = Rect { x: SIZE / 2 - START_SIZE / 2, y: SIZE - START_SIZE - 4, w: START_SIZE, h: START_SIZE };
    rooms.push(Room { rect: start, kind: RoomKind::Start });

    // Rooms and halls stay out of the band around the boss hall, so only the
    // boss corridor ever reaches it.
    let min_y = boss.y + boss.h + 5;
    let mut attempts = 0;
    while rooms.len() < TARGET_ROOMS && attempts < 600 {
        attempts += 1;
        let hall = rng.gen_bool(0.3);
        let (w, h) = if hall { (rng.gen_range(12..=18), rng.gen_range(11..=15)) } else { (rng.gen_range(6..=10), rng.gen_range(6..=10)) };
        let x = rng.gen_range(3..SIZE - w - 3);
        let y = rng.gen_range(min_y..SIZE - h - 3);
        let r = Rect { x, y, w, h };
        if rooms.iter().any(|o| o.rect.intersects(&r, 3)) {
            continue;
        }
        rooms.push(Room { rect: r, kind: if hall { RoomKind::Hall } else { RoomKind::Room } });
    }
    if rooms.len() < 12 {
        return None;
    }

    for room in &rooms {
        carve_rect(&mut map, &room.rect);
    }

    // Minimum spanning tree (Prim) over room centers, plus a few loops.
    let n = rooms.len();
    let centers: Vec<(i32, i32)> = rooms.iter().map(|r| r.rect.center()).collect();
    let dist = |a: usize, b: usize| {
        let (ax, ay) = centers[a];
        let (bx, by) = centers[b];
        (((ax - bx).pow(2) + (ay - by).pow(2)) as f64).sqrt()
    };
    let mut in_tree = vec![false; n];
    in_tree[0] = true;
    let mut edges: Vec<(usize, usize)> = Vec::new();
    for _ in 1..n {
        let mut best: Option<(usize, usize, f64)> = None;
        for a in 0..n {
            if !in_tree[a] {
                continue;
            }
            for b in 0..n {
                if in_tree[b] {
                    continue;
                }
                let dd = dist(a, b);
                if best.map_or(true, |(_, _, bd)| dd < bd) {
                    best = Some((a, b, dd));
                }
            }
        }
        let (a, b, _) = best?;
        in_tree[b] = true;
        edges.push((a, b));
    }
    let mut extra = 0;
    for a in 0..n {
        for b in (a + 1)..n {
            if extra >= 6 {
                break;
            }
            if edges.iter().any(|&(x, y)| (x == a && y == b) || (x == b && y == a)) {
                continue;
            }
            if dist(a, b) < 34.0 && rng.gen_bool(0.2) {
                edges.push((a, b));
                extra += 1;
            }
        }
    }
    for &(a, b) in &edges {
        carve_l(&mut map, centers[a], centers[b], rng.gen_bool(0.5));
    }

    // Boss hall: a single corridor from the bottom center of the hall down to
    // the nearest room, with a door at the hall entrance.
    carve_rect(&mut map, &boss);
    let (bx, by) = (boss.x + boss.w / 2, boss.y + boss.h);
    let nearest = (0..n)
        .min_by_key(|&i| {
            let (cx, cy) = centers[i];
            (cx - bx).pow(2) + (cy - by).pow(2)
        })
        .unwrap();
    let (tx, ty) = centers[nearest];
    carve_v(&mut map, by, ty, bx);
    carve_h(&mut map, bx, tx, ty);
    let door: Vec<(i32, i32)> = (-1..=1).map(|dx| (bx + dx, by)).collect();
    for &(x, y) in &door {
        map.set(x, y, Tile::DoorOpen);
    }
    rooms.push(Room { rect: boss, kind: RoomKind::Boss });
    let boss_idx = rooms.len() - 1;

    add_walls(&mut map);

    // Guarantees: everything reachable, boss hall farthest by path distance.
    let (sx, sy) = rooms[0].rect.center();
    let dists = bfs(&map, sx, sy);
    let room_dist = |r: &Rect| {
        let (cx, cy) = r.center();
        dists[(cy * SIZE + cx) as usize]
    };
    if rooms.iter().any(|r| room_dist(&r.rect) < 0) {
        return None;
    }
    let boss_d = room_dist(&boss);
    // Margin: rotation can shift integer room centers by a tile.
    if rooms.iter().take(boss_idx).any(|r| room_dist(&r.rect) >= boss_d - 4) {
        return None;
    }

    let max_d = rooms.iter().take(boss_idx).map(|r| room_dist(&r.rect)).max().unwrap_or(1).max(1);
    let mut spawns = Vec::new();
    for (i, room) in rooms.iter().enumerate() {
        if room.kind == RoomKind::Start || room.kind == RoomKind::Boss {
            continue;
        }
        let depth = room_dist(&room.rect) as f64 / max_d as f64;
        populate(rng, room, depth, i, &mut spawns);
    }

    let mut dungeon = Dungeon {
        map,
        rooms,
        start: 0,
        boss: boss_idx,
        door,
        spawns,
        player_spawns: Vec::new(),
    };

    let turns = rng.gen_range(0..4);
    for _ in 0..turns {
        rotate(&mut dungeon);
    }
    let c = dungeon.rooms[0].rect.center_px();
    dungeon.player_spawns = vec![
        c + Vec2::new(-12.0, -12.0),
        c + Vec2::new(12.0, -12.0),
        c + Vec2::new(-12.0, 12.0),
        c + Vec2::new(12.0, 12.0),
    ];
    Some(dungeon)
}

fn carve_rect(map: &mut Map, r: &Rect) {
    for y in r.y..r.y + r.h {
        for x in r.x..r.x + r.w {
            map.set(x, y, Tile::Floor);
        }
    }
}

/// Corridors are 3 tiles wide.
fn carve_h(map: &mut Map, x1: i32, x2: i32, y: i32) {
    for x in x1.min(x2) - 1..=x1.max(x2) + 1 {
        for dy in -1..=1 {
            if map.get(x, y + dy) != Tile::DoorOpen as u8 {
                map.set(x, y + dy, Tile::Floor);
            }
        }
    }
}

fn carve_v(map: &mut Map, y1: i32, y2: i32, x: i32) {
    for y in y1.min(y2)..=y1.max(y2) + 1 {
        for dx in -1..=1 {
            map.set(x + dx, y, Tile::Floor);
        }
    }
}

fn carve_l(map: &mut Map, a: (i32, i32), b: (i32, i32), horizontal_first: bool) {
    if horizontal_first {
        carve_h(map, a.0, b.0, a.1);
        carve_v(map, a.1, b.1, b.0);
    } else {
        carve_v(map, a.1, b.1, a.0);
        carve_h(map, a.0, b.0, b.1);
    }
}

fn add_walls(map: &mut Map) {
    let mut walls = Vec::new();
    for y in 0..map.h {
        for x in 0..map.w {
            if map.get(x, y) != Tile::Void as u8 {
                continue;
            }
            let near_floor = (-1..=1).any(|dy| (-1..=1).any(|dx| map.walkable(x + dx, y + dy)));
            if near_floor {
                walls.push((x, y));
            }
        }
    }
    for (x, y) in walls {
        map.set(x, y, Tile::Wall);
    }
}

/// Tile path distances from (sx, sy); -1 = unreachable.
pub fn bfs(map: &Map, sx: i32, sy: i32) -> Vec<i32> {
    let mut d = vec![-1; (map.w * map.h) as usize];
    let mut q = VecDeque::new();
    d[(sy * map.w + sx) as usize] = 0;
    q.push_back((sx, sy));
    while let Some((x, y)) = q.pop_front() {
        let cd = d[(y * map.w + x) as usize];
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let (nx, ny) = (x + dx, y + dy);
            if map.walkable(nx, ny) && d[(ny * map.w + nx) as usize] < 0 {
                d[(ny * map.w + nx) as usize] = cd + 1;
                q.push_back((nx, ny));
            }
        }
    }
    d
}

fn populate(rng: &mut ChaCha8Rng, room: &Room, depth: f64, _idx: usize, out: &mut Vec<Spawn>) {
    use EnemyType::*;
    if room.kind == RoomKind::Room && rng.gen_bool(0.15) {
        return; // a quiet room
    }
    let hall = room.kind == RoomKind::Hall;
    let count = if hall { rng.gen_range(4..=7) } else { rng.gen_range(2..=4) } + (depth * 2.0) as usize;
    let pool: &[EnemyType] = if depth < 0.35 {
        &[GoblinArcher, GoblinArcher, SkeletonWarrior]
    } else if depth < 0.7 {
        &[GoblinArcher, SkeletonWarrior, SkeletonArcher, OrcWarrior]
    } else {
        &[SkeletonArcher, OrcWarrior, OrcWarrior, OrcArcher]
    };
    let mut types: Vec<EnemyType> = (0..count).map(|_| *pool.choose(rng).unwrap()).collect();
    if hall && depth > 0.3 && rng.gen_bool(0.5) {
        types[0] = Necromancer;
    }
    let r = &room.rect;
    for t in types {
        let x = rng.gen_range(r.x + 1..r.x + r.w - 1);
        let y = rng.gen_range(r.y + 1..r.y + r.h - 1);
        out.push(Spawn { enemy: t, pos: Map::center_of(x, y) });
    }
}

/// Rotate the whole dungeon 90 degrees clockwise (map is square).
fn rotate(d: &mut Dungeon) {
    let n = d.map.w;
    let old = d.map.clone();
    for y in 0..n {
        for x in 0..n {
            // new(x, y) = old(y, n-1-x)  <=>  old(ox, oy) -> new(n-1-oy, ox)
            let v = old.get(y, n - 1 - x);
            d.map.tiles[(y * n + x) as usize] = v;
        }
    }
    let rot_pt = |(x, y): (i32, i32)| (n - 1 - y, x);
    let rot_px = |p: Vec2| Vec2::new(n as f64 * super::TILE - p.y, p.x);
    for room in &mut d.rooms {
        let r = room.rect;
        room.rect = Rect { x: n - (r.y + r.h), y: r.x, w: r.h, h: r.w };
    }
    d.door = d.door.iter().map(|&p| rot_pt(p)).collect();
    for s in &mut d.spawns {
        s.pos = rot_px(s.pos);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_per_seed() {
        let a = generate(42);
        let b = generate(42);
        assert_eq!(a.map.tiles, b.map.tiles);
        assert_eq!(a.spawns.len(), b.spawns.len());
    }

    #[test]
    fn guarantees_hold_over_many_seeds() {
        for seed in 0..200u64 {
            let d = generate(seed);
            let (sx, sy) = d.rooms[d.start].rect.center();
            assert!(d.map.walkable(sx, sy), "seed {seed}: start not walkable");
            let dist = bfs(&d.map, sx, sy);
            let at = |r: &Rect| {
                let (cx, cy) = r.center();
                dist[(cy * d.map.w + cx) as usize]
            };
            let boss_d = at(d.boss_hall());
            for (i, room) in d.rooms.iter().enumerate() {
                let rd = at(&room.rect);
                assert!(rd >= 0, "seed {seed}: room {i} unreachable");
                if i != d.boss {
                    assert!(rd < boss_d, "seed {seed}: room {i} farther than boss hall");
                }
            }
            // Boss hall is on the side opposite the start.
            let s = d.rooms[d.start].rect.center_px();
            let b = d.boss_hall().center_px();
            let mid = SIZE as f64 * super::super::TILE / 2.0;
            assert!((s.x - mid) * (b.x - mid) <= 0.0 || (s.y - mid) * (b.y - mid) <= 0.0, "seed {seed}: boss not opposite");
            // All spawns are on floor tiles, none in the start room.
            for sp in &d.spawns {
                assert!(!d.map.solid_at(sp.pos), "seed {seed}: spawn in wall");
                assert!(!d.rooms[d.start].rect.contains(sp.pos), "seed {seed}: enemy in start room");
            }
            for p in &d.player_spawns {
                assert!(!d.map.solid_at(*p), "seed {seed}: player spawn in wall");
            }
            // The only way into the boss hall is through the door.
            for &(x, y) in &d.door {
                assert_eq!(d.map.get(x, y), Tile::DoorOpen as u8);
            }
        }
    }
}
