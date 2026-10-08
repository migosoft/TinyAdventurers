//! Seeded dungeon generation.
//!
//! Built in a canonical orientation (start room at the bottom, boss hall
//! centered at the top), then rotated by a random quarter turn so the start
//! can be on any side and the boss hall is centered on the opposite side.

use super::{is_terrain, ChestSpawn, Dungeon, Map, Rect, Room, RoomKind, Spawn, Tile};
use crate::defs::enemies::EnemyType;
use crate::math::Vec2;
use crate::protocol::BossId;
use rand::seq::SliceRandom;
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::collections::VecDeque;

pub const SIZE: i32 = 140;
const BOSS_W: i32 = 26;
const BOSS_H: i32 = 20;
const START_SIZE: i32 = 8;
const TARGET_ROOMS: usize = 24;

/// Which liquid the dungeon's terrain uses. Chasms appear in every theme.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Theme {
    Water,
    Lava,
}

impl Theme {
    /// Lava in the demon's dungeon, water everywhere else.
    pub fn for_boss(boss: BossId) -> Theme {
        if boss == BossId::Demon {
            Theme::Lava
        } else {
            Theme::Water
        }
    }
}

pub fn generate(seed: u64, theme: Theme) -> Dungeon {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    // Retry until all guarantees hold (deterministic: same rng stream).
    for _ in 0..50 {
        if let Some(d) = try_generate(&mut rng, theme) {
            return d;
        }
    }
    panic!("dungeon generation failed for seed {seed}");
}

fn try_generate(rng: &mut ChaCha8Rng, theme: Theme) -> Option<Dungeon> {
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

    remove_stubs(&mut map);
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
    // Chests use their own stream so they do not change the maps of existing seeds.
    let mut chest_rng = rng.clone();
    chest_rng.set_stream(7);
    let chests = place_chests(&mut chest_rng, &map, &rooms);
    // Terrain too (stream 8): layouts, spawns and chests stay the same per seed.
    let mut terrain_rng = rng.clone();
    terrain_rng.set_stream(8);
    place_terrain(&mut terrain_rng, &mut map, &rooms, theme, &mut spawns, &chests);
    // Chasms in the boss hall (stream 9), so knockback matters in the boss fight.
    let mut hall_rng = rng.clone();
    hall_rng.set_stream(9);
    place_boss_chasms(&mut hall_rng, &mut map, &boss);

    let mut dungeon = Dungeon {
        map,
        rooms,
        start: 0,
        boss: boss_idx,
        door,
        spawns,
        chests,
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

/// A cell wrapped in floor on three sides (and around both corners between them).
/// Overlapping carves leave these as one-tile wall stubs that draw as a T junction.
fn is_stub(map: &Map, x: i32, y: i32) -> bool {
    let fl = |dx: i32, dy: i32| map.get(x + dx, y + dy) == Tile::Floor as u8;
    // For each open side pair: both sides and the corner between them.
    let wraps = |(ax, ay): (i32, i32), (bx, by): (i32, i32)| fl(ax, ay) && fl(bx, by) && fl(ax + bx, ay + by);
    let (n, e, s, w) = ((0, -1), (1, 0), (0, 1), (-1, 0));
    [(n, e, s), (e, s, w), (s, w, n), (w, n, e)].iter().any(|&(a, b, c)| wraps(a, b) && wraps(b, c))
}

/// Fills one-tile wall stubs with floor. The floor already wraps around each
/// stub, so this opens no new path (the boss hall stays sealed but for its door).
fn remove_stubs(map: &mut Map) {
    loop {
        let mut stubs = Vec::new();
        for y in 1..map.h - 1 {
            for x in 1..map.w - 1 {
                if map.get(x, y) == Tile::Void as u8 && is_stub(map, x, y) {
                    stubs.push((x, y));
                }
            }
        }
        if stubs.is_empty() {
            return;
        }
        for (x, y) in stubs {
            map.set(x, y, Tile::Floor);
        }
    }
}

fn add_walls(map: &mut Map) {
    let mut walls = Vec::new();
    for y in 0..map.h {
        for x in 0..map.w {
            if map.get(x, y) != Tile::Void as u8 {
                continue;
            }
            let near_floor = (-1..=1).any(|dy| (-1..=1).any(|dx| !map.opaque(x + dx, y + dy)));
            if near_floor {
                walls.push((x, y));
            }
        }
    }
    for (x, y) in walls {
        map.set(x, y, Tile::Wall);
    }
}

/// Tile path distances from (sx, sy) over safe ground (no deep water, chasm
/// or lava); -1 = unreachable.
pub fn bfs(map: &Map, sx: i32, sy: i32) -> Vec<i32> {
    let mut d = vec![-1; (map.w * map.h) as usize];
    let mut q = VecDeque::new();
    d[(sy * map.w + sx) as usize] = 0;
    q.push_back((sx, sy));
    while let Some((x, y)) = q.pop_front() {
        let cd = d[(y * map.w + x) as usize];
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let (nx, ny) = (x + dx, y + dy);
            if map.safe(nx, ny) && d[(ny * map.w + nx) as usize] < 0 {
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

/// About one ordinary room or hall in three gets a chest, against its top wall
/// (enemies never spawn in that row) with floor on both sides so it never
/// blocks a corridor mouth. A quarter of them are mimics.
fn place_chests(rng: &mut ChaCha8Rng, map: &Map, rooms: &[Room]) -> Vec<ChestSpawn> {
    let mut out = Vec::new();
    for room in rooms {
        if !matches!(room.kind, RoomKind::Room | RoomKind::Hall) || !rng.gen_bool(0.35) {
            continue;
        }
        let r = &room.rect;
        let mimic = rng.gen_bool(0.25);
        for _ in 0..8 {
            let x = rng.gen_range(r.x + 1..r.x + r.w - 1);
            let y = r.y;
            let fits = map.safe(x, y) && map.opaque(x, y - 1) && map.safe(x - 1, y) && map.safe(x + 1, y) && map.safe(x, y + 1);
            if fits {
                out.push(ChestSpawn { pos: Map::center_of(x, y), mimic });
                break;
            }
        }
    }
    out
}

/// Widest chasm a feature may have: the Barbarian's dash (54 px) must clear it.
pub const MAX_CHASM: i32 = 3;

/// Pools (water or lava, by theme) and chasm strips in ordinary rooms and
/// halls, never in the start room or boss hall. A feature keeps clear of
/// walls, room entrances and chests, and is undone if it would cut any safe
/// ground off from the start or bring a room as far as the boss hall.
/// Enemies whose spawn it covers move to the nearest free floor in the room.
fn place_terrain(rng: &mut ChaCha8Rng, map: &mut Map, rooms: &[Room], theme: Theme, spawns: &mut [Spawn], chests: &[ChestSpawn]) {
    let (sx, sy) = rooms[0].rect.center();
    let boss = rooms.iter().find(|r| r.kind == RoomKind::Boss).map(|r| r.rect.center()).unwrap();
    let unreached = |map: &Map| {
        let d = bfs(map, sx, sy);
        let at = |(x, y): (i32, i32)| d[(y * map.w + x) as usize];
        let boss_d = at(boss);
        let too_far = rooms.iter().filter(|r| r.kind != RoomKind::Boss).any(|r| at(r.rect.center()) >= boss_d);
        (0..map.w * map.h).filter(|&i| d[i as usize] < 0 && map.safe(i % map.w, i / map.w)).count() + too_far as usize * map.tiles.len()
    };
    let cut_off = unreached(map);
    let chest_tiles: Vec<(i32, i32)> = chests.iter().map(|c| Map::tile_of(c.pos)).collect();
    for room in rooms {
        let tries = match room.kind {
            RoomKind::Room => 1,
            RoomKind::Hall => 2,
            _ => continue,
        };
        for _ in 0..tries {
            if !rng.gen_bool(if room.kind == RoomKind::Hall { 0.6 } else { 0.4 }) {
                continue;
            }
            let chasm = rng.gen_bool(0.4);
            for _ in 0..8 {
                let cells = if chasm { chasm_strip(rng, &room.rect) } else { pool(rng, &room.rect, theme) };
                let Some(cells) = cells else { break };
                let fits = cells.iter().all(|&(x, y, _)| {
                    map.get(x, y) == Tile::Floor as u8 && !chest_tiles.contains(&(x, y)) && !near_entrance(map, &room.rect, x, y)
                });
                if !fits {
                    continue;
                }
                let before: Vec<u8> = cells.iter().map(|&(x, y, _)| map.get(x, y)).collect();
                for &(x, y, t) in &cells {
                    map.set(x, y, t);
                }
                if unreached(map) == cut_off && move_spawns_off(map, &room.rect, spawns, &chest_tiles) {
                    break;
                }
                for (&(x, y, _), &t) in cells.iter().zip(&before) {
                    map.tiles[(y * map.w + x) as usize] = t;
                }
            }
        }
    }
}

/// Chasms in the boss hall: one or two strips along the walls and one or two
/// pits. They keep clear of the entrance and the boss's start, leave gaps of
/// at least three tiles around pits (the dragon is wider than two tiles), and
/// are undone if they cut any of the hall's floor off from the entrance.
fn place_boss_chasms(rng: &mut ChaCha8Rng, map: &mut Map, r: &Rect) {
    let (cx, cy) = r.center();
    let keep_clear = |x: i32, y: i32| (x - cx).abs() <= 3 && (y - cy).abs() <= 3 || (x - cx).abs() <= 4 && y >= r.y + r.h - 5;
    let connected = |map: &Map| {
        let d = bfs(map, cx, r.y + r.h - 1);
        (r.y..r.y + r.h).all(|y| (r.x..r.x + r.w).all(|x| !map.safe(x, y) || d[(y * map.w + x) as usize] >= 0))
    };
    let strips = rng.gen_range(1..=2);
    let pits = rng.gen_range(1..=2);
    for k in 0..strips + pits {
        let pit = k >= strips;
        let gap = if pit { 3 } else { 2 };
        for _ in 0..12 {
            let cells = if pit { hall_pit(rng, r) } else { wall_strip(rng, r) };
            let fits = cells.iter().all(|&(x, y)| {
                map.get(x, y) == Tile::Floor as u8 && !keep_clear(x, y) && (-gap..=gap).all(|dy| (-gap..=gap).all(|dx| map.get(x + dx, y + dy) != Tile::Chasm as u8))
            });
            if !fits {
                continue;
            }
            for &(x, y) in &cells {
                map.set(x, y, Tile::Chasm);
            }
            if connected(map) {
                break;
            }
            for &(x, y) in &cells {
                map.set(x, y, Tile::Floor);
            }
        }
    }
}

/// A pit of 2x2 to 3x2 tiles (either way round), three tiles from the walls.
fn hall_pit(rng: &mut ChaCha8Rng, r: &Rect) -> Vec<(i32, i32)> {
    let (mut w, mut h) = (rng.gen_range(2..=3), 2);
    if rng.gen_bool(0.5) {
        std::mem::swap(&mut w, &mut h);
    }
    let x0 = rng.gen_range(r.x + 3..=r.x + r.w - 3 - w);
    let y0 = rng.gen_range(r.y + 3..=r.y + r.h - 3 - h);
    (y0..y0 + h).flat_map(|y| (x0..x0 + w).map(move |x| (x, y))).collect()
}

/// A drop-off along one wall: 4 to 7 tiles long, 1 or 2 deep.
fn wall_strip(rng: &mut ChaCha8Rng, r: &Rect) -> Vec<(i32, i32)> {
    let depth = rng.gen_range(1..=2);
    let len = rng.gen_range(4..=7);
    let side = rng.gen_range(0..4);
    let along = if side < 2 { r.w } else { r.h };
    let s0 = rng.gen_range(0..=along - len);
    let mut cells = Vec::new();
    for i in s0..s0 + len {
        for j in 0..depth {
            cells.push(match side {
                0 => (r.x + i, r.y + j),
                1 => (r.x + i, r.y + r.h - 1 - j),
                2 => (r.x + j, r.y + i),
                _ => (r.x + r.w - 1 - j, r.y + i),
            });
        }
    }
    cells
}

/// Moves spawns that terrain now covers to the nearest free floor tile in the
/// room. False (nothing moved) if one finds no place.
fn move_spawns_off(map: &Map, r: &Rect, spawns: &mut [Spawn], chests: &[(i32, i32)]) -> bool {
    let mut moved: Vec<(usize, Vec2)> = Vec::new();
    for i in 0..spawns.len() {
        let (sx, sy) = Map::tile_of(spawns[i].pos);
        if map.get(sx, sy) == Tile::Floor as u8 {
            continue;
        }
        let free = |x: i32, y: i32| {
            let p = Map::center_of(x, y);
            r.contains_tile(x, y)
                && map.get(x, y) == Tile::Floor as u8
                && !chests.contains(&(x, y))
                && !spawns.iter().any(|s| s.pos == p)
                && !moved.iter().any(|m| m.1 == p)
        };
        let spot = (1..r.w.max(r.h)).find_map(|d| {
            (-d..=d).flat_map(|dy| (-d..=d).map(move |dx| (dx, dy))).filter(|(dx, dy)| dx.abs().max(dy.abs()) == d).map(|(dx, dy)| (sx + dx, sy + dy)).find(|&(x, y)| free(x, y))
        });
        let Some((x, y)) = spot else { return false };
        moved.push((i, Map::center_of(x, y)));
    }
    for (i, p) in moved {
        spawns[i].pos = p;
    }
    true
}

/// An oval pool, a tile away from the room's walls. Water pools are deep
/// wherever the whole neighbourhood is pool, so a shallow rim always surrounds
/// the deep centre; lava pools are all lava.
fn pool(rng: &mut ChaCha8Rng, r: &Rect, theme: Theme) -> Option<Vec<(i32, i32, Tile)>> {
    let (max_w, max_h) = (r.w - 2, r.h - 2);
    let (min, cap) = if theme == Theme::Water { (5, (9, 7)) } else { (4, (7, 6)) };
    if max_w < min || max_h < min {
        return None;
    }
    let w = rng.gen_range(min..=max_w.min(cap.0));
    let h = rng.gen_range(min..=max_h.min(cap.1));
    let x0 = rng.gen_range(r.x + 1..=r.x + r.w - 1 - w);
    let y0 = rng.gen_range(r.y + 1..=r.y + r.h - 1 - h);
    let (cx, cy) = (x0 as f64 + (w - 1) as f64 / 2.0, y0 as f64 + (h - 1) as f64 / 2.0);
    let (rx, ry) = (w as f64 / 2.0, h as f64 / 2.0);
    let inside = |x: i32, y: i32| ((x as f64 - cx) / rx).powi(2) + ((y as f64 - cy) / ry).powi(2) <= 1.0;
    let mut cells = Vec::new();
    for y in y0..y0 + h {
        for x in x0..x0 + w {
            if !inside(x, y) {
                continue;
            }
            let deep = (-1..=1).all(|dy| (-1..=1).all(|dx| inside(x + dx, y + dy)));
            let t = match theme {
                Theme::Lava => Tile::Lava,
                Theme::Water if deep => Tile::DeepWater,
                Theme::Water => Tile::ShallowWater,
            };
            cells.push((x, y, t));
        }
    }
    Some(cells)
}

/// A chasm from wall to wall across the room (at most `MAX_CHASM` tiles wide),
/// with a floor bridge two or three tiles wide.
fn chasm_strip(rng: &mut ChaCha8Rng, r: &Rect) -> Option<Vec<(i32, i32, Tile)>> {
    let width = rng.gen_range(1..=MAX_CHASM);
    let bridge = rng.gen_range(2..=3);
    let across = rng.gen_bool(0.5); // runs left to right
    let (len, depth) = if across { (r.w, r.h) } else { (r.h, r.w) };
    if depth < width + 4 || len < bridge + 4 {
        return None;
    }
    let at = rng.gen_range(2..=depth - 2 - width);
    let b0 = rng.gen_range(1..=len - 1 - bridge);
    let mut cells = Vec::new();
    for i in 0..len {
        if (b0..b0 + bridge).contains(&i) {
            continue;
        }
        for j in at..at + width {
            cells.push(if across { (r.x + i, r.y + j, Tile::Chasm) } else { (r.x + j, r.y + i, Tile::Chasm) });
        }
    }
    Some(cells)
}

/// Within two tiles of a room entrance: open ground outside the room (a
/// corridor mouth), so corridors never lead straight into terrain.
fn near_entrance(map: &Map, r: &Rect, x: i32, y: i32) -> bool {
    (-2..=2).any(|dy| (-2..=2).any(|dx| !r.contains_tile(x + dx, y + dy) && !map.opaque(x + dx, y + dy)))
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
    for c in &mut d.chests {
        c.pos = rot_px(c.pos);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_per_seed() {
        let a = generate(42, Theme::Water);
        let b = generate(42, Theme::Water);
        assert_eq!(a.map.tiles, b.map.tiles);
        assert_eq!(a.spawns.len(), b.spawns.len());
        assert_eq!(a.chests.len(), b.chests.len());
    }

    #[test]
    fn terrain_keeps_layout_and_chests() {
        let (w, l) = (generate(7, Theme::Water), generate(7, Theme::Lava));
        let base = |t: u8| if is_terrain(t) { Tile::Floor as u8 } else { t };
        assert_eq!(w.map.tiles.iter().map(|&t| base(t)).collect::<Vec<_>>(), l.map.tiles.iter().map(|&t| base(t)).collect::<Vec<_>>());
        assert_eq!(w.chests.iter().map(|c| c.pos).collect::<Vec<_>>(), l.chests.iter().map(|c| c.pos).collect::<Vec<_>>());
    }

    #[test]
    fn guarantees_hold_over_many_seeds() {
        let (mut chests, mut mimics) = (0, 0);
        let (mut terrain, mut open) = (0usize, 0usize);
        let mut seen = [0usize; 9];
        for seed in 0..200u64 {
            let theme = if seed % 2 == 0 { Theme::Water } else { Theme::Lava };
            let d = generate(seed, theme);
            chests += d.chests.len();
            mimics += d.chests.iter().filter(|c| c.mimic).count();
            let (sx, sy) = d.rooms[d.start].rect.center();
            assert!(d.map.safe(sx, sy), "seed {seed}: start not walkable");
            let dist = bfs(&d.map, sx, sy);
            let at = |r: &Rect| {
                let (cx, cy) = r.center();
                dist[(cy * d.map.w + cx) as usize]
            };
            let boss_d = at(d.boss_hall());
            let reached = |x: i32, y: i32| dist[(y * d.map.w + x) as usize] >= 0;
            assert!(boss_d >= 0, "seed {seed}: boss hall unreachable");
            for (i, room) in d.rooms.iter().enumerate() {
                let r = &room.rect;
                // Terrain may cover a room's centre, but never cuts off safe ground.
                for y in r.y..r.y + r.h {
                    for x in r.x..r.x + r.w {
                        assert!(!d.map.safe(x, y) || reached(x, y), "seed {seed}: room {i} cut off at {x},{y}");
                    }
                }
                if i != d.boss && d.map.safe(r.center().0, r.center().1) {
                    assert!(at(r) < boss_d, "seed {seed}: room {i} farther than boss hall");
                }
                if room.kind == RoomKind::Start {
                    assert!((r.y..r.y + r.h).all(|y| (r.x..r.x + r.w).all(|x| !is_terrain(d.map.get(x, y)))), "seed {seed}: terrain in room {i}");
                }
                if room.kind == RoomKind::Boss {
                    // Only chasms, some of them, never at the boss's start or the entrance.
                    let tiles: Vec<u8> = (r.y..r.y + r.h).flat_map(|y| (r.x..r.x + r.w).map(move |x| (x, y))).map(|(x, y)| d.map.get(x, y)).collect();
                    assert!(tiles.iter().all(|&t| !is_terrain(t) || t == Tile::Chasm as u8), "seed {seed}: other terrain in the boss hall");
                    assert!(tiles.contains(&(Tile::Chasm as u8)), "seed {seed}: no chasm in the boss hall");
                    let (cx, cy) = r.center();
                    for (x, y) in (-2..=2).flat_map(|dy| (-2..=2).map(move |dx| (cx + dx, cy + dy))) {
                        assert!(d.map.safe(x, y), "seed {seed}: chasm at the boss's start");
                    }
                    for &(x, y) in &d.door {
                        for (x, y) in (-3..=3).flat_map(|dy| (-3..=3).map(move |dx| (x + dx, y + dy))) {
                            assert!(!r.contains_tile(x, y) || d.map.safe(x, y), "seed {seed}: chasm at the entrance");
                        }
                    }
                }
            }
            for &t in &d.map.tiles {
                seen[t as usize] += 1;
                if is_terrain(t) {
                    terrain += 1;
                } else if t == Tile::Floor as u8 {
                    open += 1;
                }
            }
            let wrong = if theme == Theme::Water { Tile::Lava } else { Tile::ShallowWater };
            assert!(!d.map.tiles.contains(&(wrong as u8)), "seed {seed}: wrong liquid for {theme:?}");
            // Boss hall is on the side opposite the start.
            let s = d.rooms[d.start].rect.center_px();
            let b = d.boss_hall().center_px();
            let mid = SIZE as f64 * super::super::TILE / 2.0;
            assert!((s.x - mid) * (b.x - mid) <= 0.0 || (s.y - mid) * (b.y - mid) <= 0.0, "seed {seed}: boss not opposite");
            // All spawns are on floor tiles, none in the start room.
            for sp in &d.spawns {
                assert_eq!(d.map.tile_at(sp.pos), Tile::Floor as u8, "seed {seed}: spawn not on floor");
                assert!(!d.rooms[d.start].rect.contains(sp.pos), "seed {seed}: enemy in start room");
            }
            // Chests: on floor against a wall, outside the start room and boss hall, apart from enemies.
            for c in &d.chests {
                let (x, y) = Map::tile_of(c.pos);
                assert_eq!(d.map.get(x, y), Tile::Floor as u8, "seed {seed}: chest not on floor");
                assert!(reached(x, y), "seed {seed}: chest cut off");
                assert!([(0, 1), (0, -1), (1, 0), (-1, 0)].iter().any(|(dx, dy)| d.map.opaque(x + dx, y + dy)), "seed {seed}: chest not against a wall");
                assert!(!d.rooms[d.start].rect.contains(c.pos), "seed {seed}: chest in start room");
                assert!(!d.boss_hall().contains(c.pos), "seed {seed}: chest in boss hall");
                assert!(d.spawns.iter().all(|s| Map::tile_of(s.pos) != (x, y)), "seed {seed}: enemy on a chest");
            }
            for p in &d.player_spawns {
                assert_eq!(d.map.tile_at(*p), Tile::Floor as u8, "seed {seed}: player spawn not on floor");
            }
            // No one-tile wall stubs (they would draw as T junctions).
            for y in 1..d.map.h - 1 {
                for x in 1..d.map.w - 1 {
                    assert!(!(d.map.opaque(x, y) && is_stub(&d.map, x, y)), "seed {seed}: wall stub at {x},{y}");
                }
            }
            // The only way into the boss hall is through the door.
            for &(x, y) in &d.door {
                assert_eq!(d.map.get(x, y), Tile::DoorOpen as u8);
            }
        }
        // Every dungeon has a few chests on average, some of them mimics.
        assert!(chests >= 200 * 3, "only {chests} chests in 200 dungeons");
        assert!(mimics > 0 && mimics < chests / 2, "{mimics} mimics among {chests} chests");
        // Every kind of terrain shows up, and it covers a modest share of the floor.
        for t in [Tile::ShallowWater, Tile::DeepWater, Tile::Chasm, Tile::Lava] {
            assert!(seen[t as usize] > 0, "no {t:?} in 200 dungeons");
        }
        let share = terrain as f64 / (terrain + open) as f64;
        assert!((0.02..0.15).contains(&share), "terrain covers {:.1} % of the floor", share * 100.0);
    }
}
