//! The woodland (#203): a seeded forest road from left to right. `generate` builds the map, the plants
//! (roadside trees, bushes, the dense edge of the thicket) and the spots for enemy groups and animals.

use super::{Layout, Map, Rect, Spawn, Tile, TILE};
use crate::defs::enemies::EnemyType;
use crate::math::Vec2;
use rand::seq::SliceRandom;
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::collections::{HashSet, VecDeque};

pub const WOODLAND_W: i32 = 140;
pub const WOODLAND_H: i32 = 46;
const WOODLAND_SALT: u64 = 0x300D_1A4D;

/// Wire ids match the client's PLANT_KINDS order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum PlantKind {
    Round = 0,
    Wide = 1,
    Tall = 2,
    Conifer = 3,
    Bush = 4,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plant {
    pub kind: PlantKind,
    /// Foot position in px.
    pub foot: Vec2,
    pub seed: u32,
    /// Size in percent: a tree's scale * 100; a bush's drawn width is 32 * scale_pct / 100 px.
    pub scale_pct: u8,
    pub mirrored: bool,
}

#[derive(Clone, Debug)]
pub struct Woodland {
    pub plants: Vec<Plant>,
    /// Tiles; the party's spawns lie inside.
    pub start: Rect,
    /// Tiles; a living hero inside wins.
    pub end: Rect,
    /// Bounding rects of the clearings, in order along the road.
    pub clearings: Vec<Rect>,
    pub animals: Vec<(EnemyType, Vec2)>,
    /// 1..=1_000_000, for the client's grass, flowers and critters.
    pub seed: u32,
    /// The clearings' ellipses (centre x, centre y, radii; tiles), then the end's: roadside trees stay out of them.
    ellipses: Vec<[f64; 4]>,
}

/// The edge's plants come from fixed (seed, scale_pct) pairs, 12 per kind (index = `PlantKind as usize`),
/// so the client draws at most 60 distinct edge looks. Trees 80..120 %, bushes 113..150 % (36..48 px).
// balancing
const EDGE_SEEDS: [[(u32, u8); 12]; 5] = [
    [(101, 100), (102, 84), (103, 116), (104, 92), (105, 120), (106, 80), (107, 108), (108, 96), (109, 112), (110, 88), (111, 118), (112, 104)],
    [(201, 96), (202, 112), (203, 80), (204, 104), (205, 88), (206, 120), (207, 92), (208, 116), (209, 84), (210, 100), (211, 108), (212, 118)],
    [(301, 104), (302, 88), (303, 120), (304, 96), (305, 80), (306, 112), (307, 84), (308, 108), (309, 92), (310, 118), (311, 100), (312, 116)],
    [(401, 92), (402, 108), (403, 84), (404, 120), (405, 100), (406, 80), (407, 116), (408, 96), (409, 118), (410, 88), (411, 112), (412, 104)],
    [(501, 130), (502, 113), (503, 147), (504, 120), (505, 140), (506, 116), (507, 150), (508, 123), (509, 137), (510, 127), (511, 143), (512, 133)],
];

/// The tile a tree's trunk stands on; bushes have none.
pub fn trunk_tiles(p: &Plant) -> Vec<(i32, i32)> {
    if p.kind == PlantKind::Bush {
        vec![]
    } else {
        vec![Map::tile_of(p.foot)]
    }
}

/// Smooth 1-D value noise in [-1, 1], one lattice value every `step` tiles.
struct Noise {
    v: Vec<f64>,
    step: f64,
}
impl Noise {
    fn new(rng: &mut ChaCha8Rng, len: i32, step: f64) -> Self {
        Noise { v: (0..(len as f64 / step) as usize + 3).map(|_| rng.gen_range(-1.0..=1.0)).collect(), step }
    }
    fn at(&self, x: f64) -> f64 {
        let (i, t) = ((x / self.step).floor(), (x / self.step).fract());
        let i = i as usize;
        let s = t * t * (3.0 - 2.0 * t);
        self.v[i] * (1.0 - s) + self.v[i + 1] * s
    }
}

/// Spatial hash of placed plants (cells of one tile) for the spacing checks.
struct Placed {
    cells: Vec<Vec<usize>>,
    items: Vec<(Vec2, f64)>,
}
impl Placed {
    fn new() -> Self {
        Placed { cells: vec![vec![]; (WOODLAND_W * WOODLAND_H) as usize], items: vec![] }
    }
    fn cell(p: Vec2) -> (i32, i32) {
        Map::tile_of(p)
    }
    /// Is `p` at least `spacing` tiles from every placed item (and from theirs, the larger counts)?
    fn free(&self, p: Vec2, spacing: f64) -> bool {
        let (cx, cy) = Self::cell(p);
        let reach = 4;
        for y in (cy - reach).max(0)..=(cy + reach).min(WOODLAND_H - 1) {
            for x in (cx - reach).max(0)..=(cx + reach).min(WOODLAND_W - 1) {
                for &i in &self.cells[(y * WOODLAND_W + x) as usize] {
                    let (q, s) = self.items[i];
                    if p.dist(q) < spacing.max(s) * TILE {
                        return false;
                    }
                }
            }
        }
        true
    }
    fn add(&mut self, p: Vec2, spacing: f64) {
        let (cx, cy) = Self::cell(p);
        self.cells[(cy * WOODLAND_W + cx) as usize].push(self.items.len());
        self.items.push((p, spacing));
    }
}

fn bfs_hero(map: &Map, sx: i32, sy: i32) -> Vec<bool> {
    let mut seen = vec![false; (map.w * map.h) as usize];
    let mut q = VecDeque::new();
    seen[(sy * map.w + sx) as usize] = true;
    q.push_back((sx, sy));
    while let Some((x, y)) = q.pop_front() {
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let (nx, ny) = (x + dx, y + dy);
            if map.in_bounds(nx, ny) && !map.blocks(nx, ny, super::Mover::Hero) && !seen[(ny * map.w + nx) as usize] {
                seen[(ny * map.w + nx) as usize] = true;
                q.push_back((nx, ny));
            }
        }
    }
    seen
}

fn is_open(t: u8) -> bool {
    t == Tile::Floor as u8 || t == Tile::Road as u8
}

/// Carve the tiles of an ellipse (centre in tiles, radii) as Floor inside the border; returns their bounding rect.
fn carve_ellipse(map: &mut Map, cx: f64, cy: f64, rx: f64, ry: f64) -> Rect {
    let (mut x0, mut y0, mut x1, mut y1) = (i32::MAX, i32::MAX, i32::MIN, i32::MIN);
    for y in 3..=WOODLAND_H - 4 {
        for x in 3..=WOODLAND_W - 4 {
            if in_ellipse(&[cx, cy, rx, ry], x, y) {
                if map.get(x, y) == Tile::Thicket as u8 {
                    map.set(x, y, Tile::Floor);
                }
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
        }
    }
    Rect { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

fn in_ellipse(e: &[f64; 4], x: i32, y: i32) -> bool {
    let (dx, dy) = ((x as f64 - e[0]) / e[2], (y as f64 - e[1]) / e[3]);
    dx * dx + dy * dy <= 1.0
}

fn jitter(rng: &mut ChaCha8Rng, x: i32, y: i32) -> Vec2 {
    Vec2::new(x as f64 * TILE + rng.gen_range(3.0..13.0), y as f64 * TILE + rng.gen_range(3.0..13.0))
}

fn fresh_seed(rng: &mut ChaCha8Rng, used: &mut HashSet<u32>) -> u32 {
    loop {
        let s = rng.gen_range(1..=1_000_000u32);
        if used.insert(s) {
            return s;
        }
    }
}

pub fn generate(seed: u64) -> (Layout, Woodland) {
    let mut rng = ChaCha8Rng::seed_from_u64(seed ^ WOODLAND_SALT);
    let (w, h) = (WOODLAND_W, WOODLAND_H);
    let mut map = Map::new(w, h);
    map.tiles.fill(Tile::Thicket as u8);

    // 1. The road.
    let (p1, p2) = (rng.gen_range(0.0..std::f64::consts::TAU), rng.gen_range(0.0..std::f64::consts::TAU));
    let centre = |x: i32| -> f64 {
        let x = x as f64;
        // balancing
        (h as f64 / 2.0 + 6.0 * (x / 17.0 + p1).sin() + 3.0 * (x / 7.0 + p2).sin()).clamp(12.0, (h - 13) as f64)
    };
    let noise = Noise::new(&mut rng, w, 9.0);
    // 2. The walkable band (a thicket border of 3 stays).
    for x in 3..=w - 4 {
        let r = 11.0 + 3.0 * noise.at(x as f64); // balancing
        for y in 3..=h - 4 {
            if (y as f64 - centre(x)).abs() <= r {
                map.set(x, y, Tile::Floor);
            }
        }
    }
    // 3. Clearings, the start and the end.
    let mut clearings: Vec<Rect> = vec![];
    let mut ellipses: Vec<[f64; 4]> = vec![];
    let mut above = rng.gen_bool(0.5);
    for i in 0..6 {
        let x = (24.0 + i as f64 * (w - 48) as f64 / 5.0 + rng.gen_range(-5.0..=5.0)).round() as i32; // balancing
        let (rx, ry) = (rng.gen_range(4.0..=6.0), rng.gen_range(3.0..=5.0)); // balancing
        let dy = rng.gen_range(7.0..=10.0); // balancing
        let c = centre(x);
        let mut cy = if above { c - dy } else { c + dy };
        if cy < 3.0 + ry || cy > (h - 4) as f64 - ry {
            cy = if above { c + dy } else { c - dy };
        }
        let cy = cy.clamp(3.0 + ry, (h - 4) as f64 - ry);
        clearings.push(carve_ellipse(&mut map, x as f64, cy, rx, ry));
        ellipses.push([x as f64, cy, rx, ry]);
        above = !above;
    }
    let (lo, hi) = ((5..=7).map(centre).fold(f64::MAX, f64::min), (5..=7).map(centre).fold(f64::MIN, f64::max));
    let (sy0, sy1) = ((lo - 4.5).floor() as i32, (hi + 4.5).ceil() as i32); // balancing
    let start = Rect { x: 3, y: sy0, w: 10, h: sy1 - sy0 + 1 };
    for y in start.y..start.y + start.h {
        for x in start.x..start.x + start.w {
            if (3..=h - 4).contains(&y) && map.get(x, y) == Tile::Thicket as u8 {
                map.set(x, y, Tile::Floor);
            }
        }
    }
    let ex = w - 9;
    let end_all = carve_ellipse(&mut map, ex as f64, centre(ex), 7.0, 6.0); // balancing
    ellipses.push([ex as f64, centre(ex), 7.0, 6.0]);
    let end_x = end_all.x.max(w - 14);
    let end = Rect { x: end_x, y: end_all.y, w: end_all.x + end_all.w - end_x, h: end_all.h };
    for x in 3..=w - 4 {
        for y in 3..=h - 4 {
            if (y as f64 - centre(x)).abs() <= 1.5 {
                map.set(x, y, Tile::Road);
            }
        }
    }
    // Floor the road cannot reach (a clearing cut off by the border) turns back to thicket.
    let road0 = (5..=7).flat_map(|x| (0..h).map(move |y| (x, y))).find(|&(x, y)| map.get(x, y) == Tile::Road as u8).unwrap();
    let seen = bfs_hero(&map, road0.0, road0.1);
    for y in 0..h {
        for x in 0..w {
            if map.safe(x, y) && !seen[(y * w + x) as usize] {
                map.set(x, y, Tile::Thicket);
            }
        }
    }
    let line = |x: i32| (centre(x) + 0.5) * TILE;
    let mut used = HashSet::new();
    let mut plants: Vec<Plant> = vec![];

    // 4. Roadside trees.
    let mut placed = Placed::new();
    let mut tiles: Vec<(i32, i32)> = (0..h)
        .flat_map(|y| (0..w).map(move |x| (x, y)))
        .filter(|&(x, y)| {
            map.get(x, y) == Tile::Floor as u8
                && ((y as f64 + 0.5) - (centre(x) + 0.5)).abs() >= 2.0
                && !start.contains_tile(x, y)
                && !ellipses.iter().any(|e| in_ellipse(e, x, y))
                && (-1..=1).all(|dy| (-1..=1).all(|dx| is_open(map.get(x + dx, y + dy))))
        })
        .collect();
    tiles.shuffle(&mut rng);
    let mut trees: Vec<Plant> = vec![];
    for _pass in 0..3 {
        for &(x, y) in &tiles {
            let roll = rng.gen_range(0..100);
            // (kind, spacing in tiles, scale range); round 30, conifer 25, tall 20, small round 15, wide 10
            let (kind, spacing, lo, hi) = match roll {
                0..=29 => (PlantKind::Round, 3.2, 80, 120),
                30..=54 => (PlantKind::Conifer, 2.4, 80, 120),
                55..=74 => (PlantKind::Tall, 2.4, 80, 120),
                75..=89 => (PlantKind::Round, 2.0, 50, 65),
                _ => (PlantKind::Wide, 3.2, 80, 120),
            }; // balancing
            let foot = jitter(&mut rng, x, y);
            if !placed.free(foot, spacing) {
                continue;
            }
            placed.add(foot, spacing);
            let scale_pct = rng.gen_range(lo..=hi);
            let mirrored = rng.gen_bool(0.5);
            trees.push(Plant { kind, foot, seed: fresh_seed(&mut rng, &mut used), scale_pct, mirrored });
        }
    }

    // 5. The edge: trees and big bushes on the thicket next to the walkable ground.
    let near_floor = |x: i32, y: i32| -> i32 {
        for d in 1..=4i32 {
            for dy in -d..=d {
                for dx in -d..=d {
                    if dx.abs().max(dy.abs()) == d && map.safe(x + dx, y + dy) {
                        return d;
                    }
                }
            }
        }
        0
    };
    let mut edge_tiles: Vec<(i32, i32, i32)> = (0..h)
        .flat_map(|y| (0..w).map(move |x| (x, y)))
        .filter(|&(x, y)| map.get(x, y) == Tile::Thicket as u8)
        .map(|(x, y)| (x, y, near_floor(x, y)))
        .filter(|t| t.2 > 0)
        .collect();
    edge_tiles.shuffle(&mut rng);
    let mut edge_placed = Placed::new();
    let mut edge: Vec<Plant> = vec![];
    let edge_plant = |rng: &mut ChaCha8Rng, kind: PlantKind, foot: Vec2| {
        let (seed, scale_pct) = EDGE_SEEDS[kind as usize][rng.gen_range(0..12)];
        Plant { kind, foot, seed, scale_pct, mirrored: rng.gen_bool(0.5) }
    };
    for &(x, y, _) in &edge_tiles {
        let foot = jitter(&mut rng, x, y);
        if edge_placed.free(foot, 3.2) {
            edge_placed.add(foot, 3.2);
            let kind = [PlantKind::Round, PlantKind::Wide, PlantKind::Conifer][rng.gen_range(0..3)];
            edge.push(edge_plant(&mut rng, kind, foot));
        }
    }
    for &(x, y, d) in &edge_tiles {
        let keep = match d {
            1 => 0.9,
            2 => 0.3,
            _ => 0.08,
        }; // balancing
        if !rng.gen_bool(keep) {
            continue;
        }
        let foot = jitter(&mut rng, x, y);
        if edge_placed.free(foot, 1.6) {
            edge_placed.add(foot, 1.6);
            edge.push(edge_plant(&mut rng, PlantKind::Bush, foot));
        }
    }
    // No bare gap along the edge: a thicket tile beside the walkable ground has a plant within 2 tiles.
    for &(x, y, d) in &edge_tiles {
        if d == 1 {
            let c = Map::center_of(x, y);
            if !edge.iter().any(|p| p.foot.dist(c) <= 2.0 * TILE) {
                let foot = jitter(&mut rng, x, y);
                edge.push(edge_plant(&mut rng, PlantKind::Bush, foot));
            }
        }
    }

    // 6. Bushes on the walkable ground, 1 per ~10 tiles.
    let walkable = map.tiles.iter().filter(|&&t| t == Tile::Floor as u8).count();
    let want = walkable / 10; // balancing
    let mut floor: Vec<(i32, i32)> = (0..h).flat_map(|y| (0..w).map(move |x| (x, y))).filter(|&(x, y)| map.get(x, y) == Tile::Floor as u8).collect();
    floor.shuffle(&mut rng);
    let mut bushes: Vec<Plant> = vec![];
    for &(x, y) in &floor {
        if bushes.len() >= want {
            break;
        }
        let foot = jitter(&mut rng, x, y);
        if (foot.y - line(x)).abs() < TILE || !placed.free(foot, 1.5) {
            continue;
        }
        placed.add(foot, 1.5);
        let scale_pct = rng.gen_range(75..=150); // balancing: 24..48 px wide
        bushes.push(Plant { kind: PlantKind::Bush, foot, seed: fresh_seed(&mut rng, &mut used), scale_pct, mirrored: rng.gen_bool(0.5) });
    }

    // 7. Trunks; a tree whose trunk cuts off walkable ground is dropped.
    loop {
        for t in &trees {
            for (x, y) in trunk_tiles(t) {
                map.set(x, y, Tile::Trunk);
            }
        }
        let seen = bfs_hero(&map, road0.0, road0.1);
        let cut = |x: i32, y: i32| map.safe(x, y) && !seen[(y * w + x) as usize];
        let bad: Vec<usize> = (0..trees.len())
            .filter(|&i| {
                let (tx, ty) = Map::tile_of(trees[i].foot);
                (-1..=1).any(|dy| (-1..=1).any(|dx| map.in_bounds(tx + dx, ty + dy) && cut(tx + dx, ty + dy)))
            })
            .collect();
        if bad.is_empty() {
            break;
        }
        for &i in bad.iter().rev() {
            let (tx, ty) = Map::tile_of(trees[i].foot);
            map.set(tx, ty, Tile::Floor);
            trees.remove(i);
        }
    }
    let trunk_feet: Vec<Vec2> = trees.iter().map(|t| t.foot).collect();

    // 8. Spots.
    let player_spawns: Vec<Vec2> = [(5, 0), (5, 1), (7, 0), (7, 1)]
        .iter()
        .map(|&(x, k)| {
            let ys: Vec<i32> = (0..h).filter(|&y| map.get(x, y) == Tile::Road as u8).collect();
            Map::center_of(x, ys[(k as usize).min(ys.len() - 1)])
        })
        .collect();
    let far = |p: Vec2| player_spawns.iter().all(|s| s.dist(p) >= 21.0 * TILE); // balancing
    let mut taken: Vec<Vec2> = vec![];
    let ok_spot = |p: Vec2, taken: &[Vec2]| trunk_feet.iter().all(|f| f.dist(p) >= 24.0) && taken.iter().all(|t| t.dist(p) >= 16.0) && far(p);
    let mut spawns: Vec<Spawn> = vec![];
    let mut order: Vec<usize> = (0..clearings.len()).collect();
    order.shuffle(&mut rng);
    let mut groups = 0;
    for &ci in &order {
        if groups == 4 {
            break;
        }
        let r = clearings[ci];
        let n = rng.gen_range(2..=4);
        let mut cand: Vec<Vec2> = (r.y..r.y + r.h)
            .flat_map(|y| (r.x..r.x + r.w).map(move |x| (x, y)))
            .filter(|&(x, y)| map.get(x, y) == Tile::Floor as u8)
            .map(|(x, y)| Map::center_of(x, y))
            .collect();
        cand.shuffle(&mut rng);
        let mut mine: Vec<Vec2> = vec![];
        for p in cand {
            if mine.len() < n && ok_spot(p, &taken) && mine.iter().all(|m| m.dist(p) >= 16.0) {
                mine.push(p);
            }
        }
        if mine.len() < 2 {
            continue;
        }
        groups += 1;
        for p in mine {
            let enemy = [EnemyType::GoblinArcher, EnemyType::OrcWarrior, EnemyType::OrcArcher][rng.gen_range(0..3)];
            taken.push(p);
            spawns.push(Spawn { enemy, pos: p });
        }
    }
    // Animals: (type, group size range). One stag stands with the first deer group.
    let mut animals: Vec<(EnemyType, Vec2)> = vec![];
    let plan: Vec<(EnemyType, i32, i32, bool)> = vec![
        (EnemyType::Bunny, 3, 5, false),
        (EnemyType::Bunny, 3, 5, false),
        (EnemyType::Bunny, 3, 5, false),
        (EnemyType::Deer, 2, 3, true),
        (EnemyType::Deer, 2, 3, false),
        (EnemyType::Boar, 1, 1, false),
        (EnemyType::Boar, 1, 1, false),
    ]; // balancing
    let walk: Vec<(i32, i32)> = floor.iter().copied().filter(|&(x, y)| !start.contains_tile(x, y) && !end_all.contains_tile(x, y)).collect();
    let mut anchors: Vec<Vec2> = vec![];
    for (ty, lo, hi, stag) in plan {
        let n = rng.gen_range(lo..=hi);
        for _try in 0..200 {
            let (ax, ay) = walk[rng.gen_range(0..walk.len())];
            let a = Map::center_of(ax, ay);
            if !ok_spot(a, &taken) || anchors.iter().any(|b| b.dist(a) < 6.0 * TILE) {
                continue;
            }
            let mut mine: Vec<Vec2> = vec![a];
            let mut near: Vec<(i32, i32)> = (ay - 3..=ay + 3).flat_map(|y| (ax - 3..=ax + 3).map(move |x| (x, y))).filter(|&(x, y)| map.get(x, y) == Tile::Floor as u8).collect();
            near.shuffle(&mut rng);
            for (x, y) in near {
                let p = Map::center_of(x, y);
                if mine.len() < (n + stag as i32) as usize && ok_spot(p, &taken) && mine.iter().all(|m| m.dist(p) >= 16.0) {
                    mine.push(p);
                }
            }
            if (mine.len() as i32) < n + stag as i32 {
                continue;
            }
            anchors.push(a);
            for (i, p) in mine.into_iter().enumerate() {
                taken.push(p);
                animals.push((if stag && i == 0 { EnemyType::Stag } else { ty }, p));
            }
            break;
        }
    }

    plants.extend(trees);
    plants.extend(bushes);
    plants.extend(edge);
    let wl = Woodland { plants, start, end, clearings, animals, seed: rng.gen_range(1..=1_000_000), ellipses };
    let layout = Layout { map, spawns, chests: vec![], barrels: vec![], torches: vec![], suns: vec![], player_spawns, cove: None, daylight: true, woodland: Some(wl.clone()) };
    (layout, wl)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEEDS: u64 = 300;

    fn each(mut f: impl FnMut(u64, &Layout, &Woodland)) {
        for seed in 0..SEEDS {
            let (l, w) = generate(seed);
            f(seed, &l, &w);
        }
    }
    fn on_thicket(l: &Layout, p: &Plant) -> bool {
        let (x, y) = Map::tile_of(p.foot);
        l.map.get(x, y) == Tile::Thicket as u8
    }
    fn tiles_of(r: Rect) -> impl Iterator<Item = (i32, i32)> {
        (r.y..r.y + r.h).flat_map(move |y| (r.x..r.x + r.w).map(move |x| (x, y)))
    }

    #[test]
    fn same_seed_same_forest() {
        for seed in 0..SEEDS {
            let (a, wa) = generate(seed);
            let (b, wb) = generate(seed);
            assert_eq!(a.map.tiles, b.map.tiles, "seed {seed}");
            assert_eq!(wa.plants, wb.plants, "seed {seed}");
            assert_eq!(format!("{:?}", a.spawns), format!("{:?}", b.spawns), "seed {seed}");
            assert_eq!(wa.animals, wb.animals, "seed {seed}");
            assert_eq!((wa.start, wa.end, &wa.clearings, wa.seed), (wb.start, wb.end, &wb.clearings, wb.seed), "seed {seed}");
        }
    }

    #[test]
    fn start_reaches_end_and_every_floor_tile() {
        each(|seed, l, w| {
            let s = l.player_spawns[0];
            let (sx, sy) = Map::tile_of(s);
            let seen = bfs_hero(&l.map, sx, sy);
            assert!(tiles_of(w.end).any(|(x, y)| l.map.safe(x, y) && seen[(y * WOODLAND_W + x) as usize]), "seed {seed}: end unreachable");
            for y in 0..WOODLAND_H {
                for x in 0..WOODLAND_W {
                    assert!(!l.map.safe(x, y) || seen[(y * WOODLAND_W + x) as usize], "seed {seed}: {x},{y} cut off");
                }
            }
            for p in &l.player_spawns {
                assert!(w.start.contains(*p), "seed {seed}: spawn outside the start");
            }
        });
    }

    #[test]
    fn border_is_thicket() {
        each(|seed, l, _| {
            for y in 0..WOODLAND_H {
                for x in 0..WOODLAND_W {
                    if x < 3 || y < 3 || x >= WOODLAND_W - 3 || y >= WOODLAND_H - 3 {
                        assert_eq!(l.map.get(x, y), Tile::Thicket as u8, "seed {seed}: {x},{y}");
                    }
                }
            }
        });
    }

    #[test]
    fn trunks_are_the_roadside_trees() {
        each(|seed, l, w| {
            let mut want: Vec<(i32, i32)> = w.plants.iter().filter(|p| !on_thicket(l, p)).flat_map(trunk_tiles).collect();
            want.sort();
            let mut got: Vec<(i32, i32)> = (0..WOODLAND_H).flat_map(|y| (0..WOODLAND_W).map(move |x| (x, y))).filter(|&(x, y)| l.map.get(x, y) == Tile::Trunk as u8).collect();
            got.sort();
            assert_eq!(got, want, "seed {seed}");
            for &(x, y) in &got {
                assert!(!w.start.contains_tile(x, y), "seed {seed}: trunk in the start");
                assert!(!w.ellipses.iter().any(|e| in_ellipse(e, x, y)), "seed {seed}: trunk in a clearing or the end ellipse");
            }
        });
    }

    #[test]
    fn no_plant_on_the_road() {
        each(|seed, l, w| {
            for p in &w.plants {
                let (x, y) = Map::tile_of(p.foot);
                if p.kind != PlantKind::Bush {
                    assert_ne!(l.map.get(x, y), Tile::Road as u8, "seed {seed}: tree on the road");
                } else {
                    assert_ne!(l.map.get(x, y), Tile::Road as u8, "seed {seed}: bush on the road");
                    let ys: Vec<i32> = (0..WOODLAND_H).filter(|&yy| l.map.get(x, yy) == Tile::Road as u8).collect();
                    if !ys.is_empty() {
                        let mid = (ys[0] + ys[ys.len() - 1] + 1) as f64 / 2.0 * TILE;
                        assert!((p.foot.y - mid).abs() >= TILE, "seed {seed}: bush within a tile of the road centre");
                    }
                }
            }
        });
    }

    #[test]
    fn counts_are_in_range() {
        each(|seed, l, w| {
            assert!((300..=1000).contains(&w.plants.len()), "seed {seed}: {} plants", w.plants.len());
            let trees = w.plants.iter().filter(|p| p.kind != PlantKind::Bush && !on_thicket(l, p)).count();
            assert!(trees >= 60, "seed {seed}: {trees} roadside trees");
            let mut per: Vec<usize> = vec![0; w.clearings.len()];
            for s in &l.spawns {
                let i = w.clearings.iter().position(|r| r.contains(s.pos)).expect("a spawn outside the clearings");
                per[i] += 1;
            }
            let groups: Vec<usize> = per.into_iter().filter(|&n| n > 0).collect();
            assert_eq!(groups.len(), 4, "seed {seed}: groups {groups:?}");
            assert!(groups.iter().all(|n| (2..=4).contains(n)), "seed {seed}: {groups:?}");
            assert!((15..=30).contains(&w.animals.len()), "seed {seed}: {} animals", w.animals.len());
            let looks: HashSet<(u8, u32, u8)> = w.plants.iter().filter(|p| on_thicket(l, p)).map(|p| (p.kind as u8, p.seed, p.scale_pct)).collect();
            assert!(looks.len() <= 80, "seed {seed}: {} edge looks", looks.len());
            for y in 0..WOODLAND_H {
                for x in 0..WOODLAND_W {
                    let beside = l.map.get(x, y) == Tile::Thicket as u8 && (-1..=1).any(|dy| (-1..=1).any(|dx| l.map.safe(x + dx, y + dy)));
                    if beside {
                        let c = Map::center_of(x, y);
                        assert!(w.plants.iter().any(|p| p.foot.dist(c) <= 2.0 * TILE), "seed {seed}: bare edge at {x},{y}");
                    }
                }
            }
        });
    }

    #[test]
    fn start_is_clear() {
        each(|seed, l, w| {
            for s in &l.player_spawns {
                for p in l.spawns.iter().map(|s| s.pos).chain(w.animals.iter().map(|a| a.1)) {
                    assert!(s.dist(p) > 20.0 * TILE, "seed {seed}: creature near the start");
                }
            }
        });
    }

    #[test]
    fn creatures_keep_their_distance() {
        each(|seed, l, w| {
            let all: Vec<Vec2> = l.spawns.iter().map(|s| s.pos).chain(w.animals.iter().map(|a| a.1)).collect();
            let feet: Vec<Vec2> = w.plants.iter().filter(|p| p.kind != PlantKind::Bush && !on_thicket(l, p)).map(|p| p.foot).collect();
            for (i, p) in all.iter().enumerate() {
                assert!(all[i + 1..].iter().all(|q| q.dist(*p) >= 16.0), "seed {seed}: creatures too close");
                assert!(feet.iter().all(|f| f.dist(*p) >= 24.0), "seed {seed}: creature near a trunk");
                assert!(l.map.safe(Map::tile_of(*p).0, Map::tile_of(*p).1), "seed {seed}");
            }
        });
    }

    #[test]
    fn report_seed_0() {
        let t = std::time::Instant::now();
        let (l, w) = generate(0);
        let dt = t.elapsed();
        let on = |k: PlantKind| w.plants.iter().filter(|p| p.kind == k).count();
        let edge = w.plants.iter().filter(|p| on_thicket(&l, p)).count();
        eprintln!(
            "seed 0: {} plants (round {} wide {} tall {} conifer {} bush {}), edge {}, spawns {}, animals {}, {:?}",
            w.plants.len(), on(PlantKind::Round), on(PlantKind::Wide), on(PlantKind::Tall), on(PlantKind::Conifer), on(PlantKind::Bush), edge, l.spawns.len(), w.animals.len(), dt
        );
        if let Ok(path) = std::env::var("WOODLAND_DUMP") {
            let mut s = String::new();
            for y in 0..WOODLAND_H {
                for x in 0..WOODLAND_W {
                    s.push(match l.map.get(x, y) {
                        t if t == Tile::Thicket as u8 => '#',
                        t if t == Tile::Road as u8 => '=',
                        t if t == Tile::Trunk as u8 => 'T',
                        _ if w.end.contains_tile(x, y) => 'E',
                        _ if w.start.contains_tile(x, y) => 'S',
                        _ => '.',
                    });
                }
                s.push('\n');
            }
            std::fs::write(path, s).unwrap();
        }
    }
}
