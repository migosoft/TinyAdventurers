//! The woodland (#203): a seeded forest road from left to right. `generate` builds the map, the plants
//! (roadside trees, bushes, the dense edge of the thicket) and the spots for enemy groups and animals.
//! The forest and the road run on past both ends of the playable part; a column of `Tile::Barrier` (an
//! invisible wall) across the walkable band stops the party there (#259).

use super::water_shapes::{blob_tiles, path_tiles, winding_path, Blob};
use super::{Layout, Map, Rect, Spawn, Tile, TILE};
use crate::defs::enemies::EnemyType;
use crate::defs::foliage::{LeafPalette, WOODLAND_FOLIAGE};
use crate::math::Vec2;
use rand::seq::SliceRandom;
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::collections::{HashSet, VecDeque};

/// The playable stretch of road (tiles), between the two invisible walls.
pub const WOODLAND_PLAY_W: i32 = 180;
/// Forest and road beyond each invisible wall (#259), so the road does not visibly end; nothing lives there.
/// The client's camera stops at the map's edge, so no screen sees past it.
pub const WOODLAND_RUNOUT: i32 = 24;
/// The client's ground image is 16 px a tile and must fit a 4096 px texture: at most 256 tiles (#427).
pub const WOODLAND_W: i32 = WOODLAND_PLAY_W + 2 * WOODLAND_RUNOUT;
pub const WOODLAND_H: i32 = 72;
/// The road's clearing (#427), in tiles from the road's centre line: no tree nearer than `ROAD_CLEAR` and no
/// grove's centre nearer than `ROAD_SPARSE`, so only a grove's rim and a lone tree reach into the strip between.
/// A lone tree: one tile in `ROAD_SPARSE_ONE_IN` may grow one (rolled once a tile, not once a pass: the passes
/// would fill the ground).
// balancing
const ROAD_CLEAR: f64 = 6.0;
const ROAD_SPARSE: f64 = 11.0;
const ROAD_SPARSE_ONE_IN: u32 = 200;
/// Groves: the least distance between two centres and a grove's radius, in tiles. Outside the groves a tree
/// grows only on a `ROAD_SPARSE_ONE_IN` tile, as in the road's clearing.
// balancing
const GROVE_GAP: f64 = 15.0;
const GROVE_R: std::ops::RangeInclusive<f64> = 3.0..=5.5;
/// Ground bushes: one per this many walkable tiles, scattered over the whole ground in clumps of `BUSH_CLUMP`.
// balancing
const BUSH_TILES: usize = 60;
const BUSH_CLUMP: std::ops::RangeInclusive<i32> = 1..=3;
/// The western invisible wall's column; the playable part is the columns strictly between the two walls.
const WALL_W: i32 = WOODLAND_RUNOUT + 2;
/// The eastern invisible wall's column.
const WALL_E: i32 = WOODLAND_RUNOUT + WOODLAND_PLAY_W - 3;

/// Is column `x` inside the playable part (between the invisible walls)?
pub fn playable_x(x: i32) -> bool {
    x > WALL_W && x < WALL_E
}
const WOODLAND_SALT: u64 = 0x300D_1A4D;
/// The sun rolls from its own stream, so a seed's map, plants and animals do not move.
const SUN_SALT: u64 = 0x5355_4e5f_4c49;
/// Degrees above the horizon.
// balancing
pub const SUN_ELEVATION: std::ops::RangeInclusive<u8> = 35..=70;

/// The pond rolls from its own stream too (#360), so a seed without a pond keeps its old map.
const POND_SALT: u64 = 0x504f_4e44_3336_30;
/// Water (#360): the chance of a pond, tries to place it, blobs, the first blob's and the next blobs' radii,
/// how far into the previous blob a next centre lies (share of the way to its edge), the first centre's
/// gap to the road beyond its radius.
// balancing
const POND_PCT: u32 = 60;
const POND_TRIES: usize = 30;
const POND_BLOBS: std::ops::RangeInclusive<usize> = 2..=4;
const POND_FIRST_RX: std::ops::RangeInclusive<f64> = 3.5..=6.0;
const POND_FIRST_RY: std::ops::RangeInclusive<f64> = 2.5..=4.0;
const POND_NEXT_RX: std::ops::RangeInclusive<f64> = 2.0..=4.5;
const POND_NEXT_RY: std::ops::RangeInclusive<f64> = 2.0..=3.5;
const POND_NEXT_AT: std::ops::RangeInclusive<f64> = 0.5..=0.9;
const POND_ROAD_GAP: std::ops::RangeInclusive<f64> = 5.0..=8.0;
/// Placement: columns kept free after the start and before the end ellipse, a water tile's distance from the
/// road's centre line (least, and the nearest tile's most), tiles kept from the thicket (Chebyshev).
// balancing
const POND_FROM_ENDS: i32 = 24;
const POND_ROAD_MIN: f64 = 4.5;
const POND_ROAD_MAX: f64 = 9.5;
const POND_THICKET_GAP: i32 = 2;
/// Streams: share with none, share with an inflow only (the rest has both), columns around the pond where a
/// stream may meet the band's edge, how many sources to try, share of inflows from across the road, columns
/// an outflow keeps from an inflow on its side, tiles of straight stream before and after the road.
// balancing
const STREAM_NONE_PCT: u32 = 30;
const STREAM_INFLOW_PCT: u32 = 45;
const STREAM_REACH: i32 = 14;
const STREAM_TRIES: usize = 10;
const STREAM_FAR_PCT: u32 = 50;
const STREAM_APART: i32 = 8;
const STREAM_STRAIGHT: i32 = 3;
/// The chance of a bridge over a narrow arm of the pond.
// balancing
const POND_BRIDGE_PCT: u32 = 40;
/// Trees keep this far (Chebyshev) from any water.
// balancing
const TREE_SHORE_GAP: i32 = 2;

/// The run's sun: which side it stands on (-1 west, +1 east) and how high.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Sun {
    pub side: i8,
    pub elevation_deg: u8,
}

crate::defs::enum_list::listed_enum! {
    /// Wire ids match the client's `PLANT_KINDS` order; `export.rs` writes them to `PLANT_KIND` in the generated
    /// defs, and a client test checks the order.
    #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
    pub enum PlantKind: u8 {
        Round = 0,
        Wide = 1,
        Tall = 2,
        Conifer = 3,
        Bush = 4,
    }
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
    /// How much of its leaf a plant carries, in percent.
    pub leaf_pct: u8,
    /// A dead tree: bare limbs, no leaves, no sway.
    pub dead: bool,
}

/// A stream (tiles, in flow order): `inflow` runs from the band's edge into the pond, else out of it.
#[derive(Clone, Debug)]
pub struct Stream {
    pub points: Vec<(f64, f64)>,
    pub inflow: bool,
}

/// A bridge deck's tiles; `along_x` is its travel axis; `road` is a bridge of the road over a stream.
#[derive(Clone, Debug)]
pub struct Bridge {
    pub rect: Rect,
    pub along_x: bool,
    pub road: bool,
}

/// The woodland's water (#360): `bounds` encloses the pond and its streams; `seed` shapes the pond's shore.
/// `blobs` with `seed` are the pond's free shape (`water_shapes::inside`): the client draws its shore from them.
#[derive(Clone, Debug)]
pub struct Pond {
    pub streams: Vec<Stream>,
    pub bridges: Vec<Bridge>,
    pub seed: u32,
    pub blobs: Vec<Blob>,
    /// The bounding rect of the pond and its streams; read by the tests.
    #[cfg_attr(not(test), allow(dead_code))] // read by the tests only
    pub bounds: Rect,
}

#[derive(Clone, Debug)]
pub struct Woodland {
    pub plants: Vec<Plant>,
    /// Tiles; the party's spawns lie inside.
    #[cfg_attr(not(test), allow(dead_code))] // read by the tests only
    pub start: Rect,
    /// Tiles; a living hero inside wins.
    pub end: Rect,
    /// Bounding rects of the clearings, in order along the road.
    #[cfg_attr(not(test), allow(dead_code))] // read by the tests only
    pub clearings: Vec<Rect>,
    pub animals: Vec<(EnemyType, Vec2)>,
    /// 1..=1_000_000, for the client's grass, flowers and critters.
    pub seed: u32,
    pub sun: Sun,
    /// The colours of the leaves.
    pub palette: LeafPalette,
    /// The pond, if the seed has one.
    pub pond: Option<Pond>,
    /// The clearings' ellipses (centre x, centre y, radii; tiles), then the end's: roadside trees stay out of them.
    #[cfg_attr(not(test), allow(dead_code))] // read by the tests only
    ellipses: Vec<[f64; 4]>,
}

/// The edge's plants come from fixed (seed, scale_pct) pairs, 12 per kind (index = `PlantKind as usize`),
/// so the client draws at most 48 distinct edge looks (the edge picks only Round, Wide, Conifer and Bush: 4 x 12). Trees 80..120 %, bushes 113..150 % (36..48 px).
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

fn is_water_tile(t: u8) -> bool {
    t == Tile::ShallowWater as u8 || t == Tile::DeepWater as u8
}

/// What a stream's planning looks at.
struct WaterCtx<'a> {
    map: &'a Map,
    start: Rect,
    ellipses: &'a [[f64; 4]],
    /// The pond's tiles.
    water: &'a HashSet<(i32, i32)>,
    /// The pond's tiles in order, for the nearest one.
    pond: &'a [(i32, i32)],
    /// -1 when the pond lies above the road, +1 below.
    side: i32,
    /// The columns a stream may meet the band's edge in.
    reach: (i32, i32),
}

struct StreamPlan {
    points: Vec<(f64, f64)>,
    tiles: Vec<(i32, i32)>,
    /// The tiles of the widened mouth (only those that were Floor).
    wide: Vec<(i32, i32)>,
    inflow: bool,
    road_bridge: Option<Bridge>,
}

impl WaterCtx<'_> {
    fn free_tile(&self, x: i32, y: i32) -> bool {
        playable_x(x) && !self.start.contains_tile(x, y) && !self.ellipses.iter().any(|e| in_ellipse(e, x, y))
    }
}

/// The Floor tile at the band's edge of column `x`, from the top (`dir` < 0) or the bottom: a Thicket lies beyond it.
fn band_edge(map: &Map, x: i32, dir: i32) -> Option<(i32, i32)> {
    let open = |&y: &i32| map.get(x, y) != Tile::Thicket as u8;
    let y = if dir < 0 { (0..map.h).find(open) } else { (0..map.h).rev().find(open) }?;
    (map.get(x, y) == Tile::Floor as u8).then_some((x, y))
}

/// A stream between the band's edge (across the road when `far`) and the pond's nearest tile, or None.
fn plan_stream(rng: &mut ChaCha8Rng, c: &WaterCtx, inflow: bool, far: bool, apart: Option<i32>) -> Option<StreamPlan> {
    let (floor, road) = (Tile::Floor as u8, Tile::Road as u8);
    for _ in 0..STREAM_TRIES {
        let x = rng.gen_range(c.reach.0..=c.reach.1);
        if !playable_x(x) || apart.is_some_and(|a| (x - a).abs() < STREAM_APART) {
            continue;
        }
        let Some(edge) = band_edge(c.map, x, if far { -c.side } else { c.side }) else { continue };
        let e = (edge.0 as f64 + 0.5, edge.1 as f64 + 0.5);
        let d2 = |t: &&(i32, i32)| (t.0 as f64 + 0.5 - e.0).powi(2) + (t.1 as f64 + 0.5 - e.1).powi(2);
        let p = *c.pond.iter().min_by(|a, b| d2(a).total_cmp(&d2(b)))?;
        let p = (p.0 as f64 + 0.5, p.1 as f64 + 0.5);
        let (from, to) = if inflow { (e, p) } else { (p, e) };
        let mut points = winding_path(rng, from, to);
        let mut road_bridge = None;
        let mut cross_x = None;
        if far {
            // straight along one column from 3 tiles before the road to 3 tiles after it
            let Some(&(cx, _)) = path_tiles(&points).iter().find(|t| c.map.get(t.0, t.1) == road) else { continue };
            let rows: Vec<i32> = (0..c.map.h).filter(|&y| c.map.get(cx, y) == road).collect();
            let (rt, rb) = (rows[0], rows[rows.len() - 1]);
            if rows.len() as i32 != rb - rt + 1 {
                continue;
            }
            let dir = if to.1 > from.1 { 1.0 } else { -1.0 };
            let (ya, yb) = if dir > 0.0 { (rt - STREAM_STRAIGHT, rb + STREAM_STRAIGHT) } else { (rb + STREAM_STRAIGHT, rt - STREAM_STRAIGHT) };
            let (ya, yb) = (ya as f64 + 0.5, yb as f64 + 0.5);
            let (Some(i), Some(j)) = (points.iter().position(|p| (p.1 - ya) * dir >= 0.0), points.iter().position(|p| (p.1 - yb) * dir > 0.0)) else { continue };
            if i == 0 {
                continue;
            }
            let after = points.split_off(j);
            points.truncate(i);
            points.extend([(cx as f64 + 0.5, ya), (cx as f64 + 0.5, yb)]);
            points.extend(after);
            road_bridge = Some(Bridge { rect: Rect { x: cx, y: rt, w: 1, h: rb - rt + 1 }, along_x: true, road: true });
            cross_x = Some(cx);
        }
        let tiles = path_tiles(&points);
        let fits = tiles.len() >= 2
            && tiles.iter().all(|&(x, y)| {
                let t = c.map.get(x, y);
                c.free_tile(x, y) && (c.water.contains(&(x, y)) || t == floor || (t == road && cross_x == Some(x)))
            });
        if !fits {
            continue;
        }
        // the last two stream tiles before the pond (not pond water) are one tile wider
        let dry: Vec<usize> = (0..tiles.len()).filter(|&i| !c.water.contains(&tiles[i])).collect();
        let mouth: Vec<usize> = if inflow { dry.iter().rev().take(2).copied().collect() } else { dry.iter().take(2).copied().collect() };
        let mut wide = vec![];
        for i in mouth {
            let t = tiles[i];
            let other = tiles[if i + 1 < tiles.len() { i + 1 } else { i - 1 }];
            let w = if t.1 == other.1 { (t.0, t.1 + 1) } else { (t.0 + 1, t.1) };
            if c.map.get(w.0, w.1) == floor && c.free_tile(w.0, w.1) {
                wide.push(w);
            }
        }
        return Some(StreamPlan { points, tiles, wide, inflow, road_bridge });
    }
    None
}

/// Every safe tile is reached from the road's start (deep water blocks).
fn all_reached(map: &Map, road0: (i32, i32)) -> bool {
    let seen = bfs_hero(map, road0.0, road0.1);
    (0..map.h).all(|y| (0..map.w).all(|x| !map.safe(x, y) || seen[(y * map.w + x) as usize]))
}

/// 3b. Water (#360): a pond with 0 to 2 streams and bridges, on a copy of the map that is returned only when
/// every walkable tile is still reached. Its own rng: a seed without a pond is the old map.
fn place_water(seed: u64, map: &Map, centre: &dyn Fn(i32) -> f64, start: Rect, ellipses: &[[f64; 4]], road0: (i32, i32)) -> Option<(Map, Pond)> {
    let mut rng = ChaCha8Rng::seed_from_u64(seed ^ POND_SALT);
    if rng.gen_range(0..100) >= POND_PCT {
        return None;
    }
    let end = ellipses[ellipses.len() - 1];
    let (min_x, max_x) = (start.x + start.w - 1 + POND_FROM_ENDS, (end[0] - end[2]).floor() as i32 - POND_FROM_ENDS);
    let floor = Tile::Floor as u8;
    for _ in 0..POND_TRIES {
        let pond_seed = rng.gen_range(1..=1_000_000u32);
        let side = if rng.gen_bool(0.5) { -1 } else { 1 };
        let (rx, ry) = (rng.gen_range(POND_FIRST_RX), rng.gen_range(POND_FIRST_RY));
        let cx = rng.gen_range(min_x as f64 + rx..=max_x as f64 - rx);
        let cy = centre(cx as i32) + 0.5 + side as f64 * (ry + rng.gen_range(POND_ROAD_GAP));
        let mut blobs = vec![Blob { cx, cy, rx, ry }];
        for _ in 1..rng.gen_range(POND_BLOBS) {
            let p = &blobs[blobs.len() - 1];
            let (a, f) = (rng.gen_range(0.0..std::f64::consts::TAU), rng.gen_range(POND_NEXT_AT));
            let (nx, ny) = (p.cx + a.cos() * p.rx * f, p.cy + a.sin() * p.ry * f);
            blobs.push(Blob { cx: nx, cy: ny, rx: rng.gen_range(POND_NEXT_RX), ry: rng.gen_range(POND_NEXT_RY) });
        }
        let body = blob_tiles(&blobs, pond_seed);
        let mut nearest = f64::MAX;
        let on_open_ground = body.iter().all(|&(x, y, _)| {
            let d = ((y as f64 + 0.5) - (centre(x) + 0.5)).abs();
            nearest = nearest.min(d);
            map.get(x, y) == floor
                && playable_x(x)
                && x >= min_x
                && x <= max_x
                && d >= POND_ROAD_MIN
                && !start.contains_tile(x, y)
                && !ellipses.iter().any(|e| in_ellipse(e, x, y))
                && (-(POND_THICKET_GAP - 1)..POND_THICKET_GAP).all(|dy| (-(POND_THICKET_GAP - 1)..POND_THICKET_GAP).all(|dx| map.get(x + dx, y + dy) != Tile::Thicket as u8))
        });
        if body.is_empty() || !on_open_ground || nearest > POND_ROAD_MAX {
            continue;
        }
        let mut pond_map = map.clone();
        for &(x, y, t) in &body {
            pond_map.set(x, y, t);
        }
        let water: HashSet<(i32, i32)> = body.iter().map(|t| (t.0, t.1)).collect();
        let tiles: Vec<(i32, i32)> = body.iter().map(|t| (t.0, t.1)).collect();
        let ctx = WaterCtx {
            map,
            start,
            ellipses,
            water: &water,
            pond: &tiles,
            side,
            reach: (tiles.iter().map(|t| t.0).min().unwrap() - STREAM_REACH, tiles.iter().map(|t| t.0).max().unwrap() + STREAM_REACH),
        };
        // the plans: every draw comes before the checks, so dropping a part does not move the others
        let roll = rng.gen_range(0..100);
        let (mut inflow, mut outflow) = (None, None);
        let mut far = false;
        if roll >= STREAM_NONE_PCT {
            far = rng.gen_range(0..100) < STREAM_FAR_PCT;
            inflow = plan_stream(&mut rng, &ctx, true, far, None);
        }
        if roll >= STREAM_NONE_PCT + STREAM_INFLOW_PCT {
            // an outflow keeps clear of an inflow on its own side of the road
            let apart = inflow.as_ref().filter(|_| !far).map(|s| tile_of(s.points[0]).0);
            outflow = plan_stream(&mut rng, &ctx, false, false, apart);
        }
        let used: HashSet<(i32, i32)> = [&inflow, &outflow].into_iter().flatten().flat_map(|s| s.tiles.iter().chain(&s.wide).copied()).collect();
        let mut bridge: Option<(Bridge, Vec<(i32, i32)>)> = None;
        if rng.gen_range(0..100) < POND_BRIDGE_PCT {
            // a straight line of 2 to 4 shallow tiles with Floor at both ends
            let shallow = |x: i32, y: i32| pond_map.get(x, y) == Tile::ShallowWater as u8 && water.contains(&(x, y)) && !used.contains(&(x, y));
            let dry = |x: i32, y: i32| pond_map.get(x, y) == floor && playable_x(x) && !used.contains(&(x, y));
            let mut lines: Vec<(Bridge, Vec<(i32, i32)>)> = vec![];
            for &(x, y) in &tiles {
                for (dx, dy) in [(1, 0), (0, 1)] {
                    let k = (0..=4).take_while(|&k| shallow(x + dx * k, y + dy * k)).count() as i32;
                    // a plank has water on both long sides of at least one of its tiles
                    let wet = |x: i32, y: i32| is_water_tile(pond_map.get(x, y));
                    let across = (0..k).any(|i| {
                        let (px, py) = (x + dx * i, y + dy * i);
                        wet(px + dy, py + dx) && wet(px - dy, py - dx)
                    });
                    if (2..=4).contains(&k) && across && dry(x - dx, y - dy) && dry(x + dx * k, y + dy * k) {
                        let rect = Rect { x, y, w: if dx == 1 { k } else { 1 }, h: if dy == 1 { k } else { 1 } };
                        lines.push((Bridge { rect, along_x: dx == 1, road: false }, (0..k).map(|i| (x + dx * i, y + dy * i)).collect()));
                    }
                }
            }
            if !lines.is_empty() {
                bridge = Some(lines.swap_remove(rng.gen_range(0..lines.len())));
            }
        }
        // drop the outflow, then the pond bridge, then the inflow, then the pond
        let mut tried = HashSet::new();
        for (with_in, with_out, with_bridge) in [(true, true, true), (true, false, true), (true, false, false), (false, false, false)] {
            let eff = (with_in && inflow.is_some(), with_out && outflow.is_some(), with_bridge && bridge.is_some());
            if !tried.insert(eff) {
                continue;
            }
            let streams: Vec<&StreamPlan> = [inflow.as_ref().filter(|_| eff.0), outflow.as_ref().filter(|_| eff.1)].into_iter().flatten().collect();
            let mut m = pond_map.clone();
            for s in &streams {
                for &(x, y) in s.tiles.iter().chain(&s.wide) {
                    if m.get(x, y) == floor {
                        m.set(x, y, Tile::ShallowWater);
                    }
                }
            }
            let pond_bridge = bridge.as_ref().filter(|_| eff.2);
            for &(x, y) in pond_bridge.iter().flat_map(|b| b.1.iter()) {
                m.set(x, y, Tile::Floor);
            }
            if !all_reached(&m, road0) {
                continue;
            }
            let mut wet: Vec<(i32, i32)> = tiles.clone();
            wet.extend(streams.iter().flat_map(|s| s.tiles.iter().chain(&s.wide).copied()));
            let (x0, x1) = (wet.iter().map(|t| t.0).min().unwrap(), wet.iter().map(|t| t.0).max().unwrap());
            let (y0, y1) = (wet.iter().map(|t| t.1).min().unwrap(), wet.iter().map(|t| t.1).max().unwrap());
            let mut bridges: Vec<Bridge> = streams.iter().filter_map(|s| s.road_bridge.clone()).collect();
            bridges.extend(pond_bridge.map(|b| b.0.clone()));
            let streams = streams.iter().map(|s| Stream { points: s.points.clone(), inflow: s.inflow }).collect();
            return Some((m, Pond { streams, bridges, seed: pond_seed, blobs: blobs.clone(), bounds: Rect { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } }));
        }
        // every variant failed the check: a failed try, the next one places another pond
    }
    None
}

fn tile_of(p: (f64, f64)) -> (i32, i32) {
    (p.0.floor() as i32, p.1.floor() as i32)
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
        (h as f64 / 2.0 + 9.0 * (x / 29.0 + p1).sin() + 3.0 * (x / 11.0 + p2).sin()).clamp(24.0, (h - 25) as f64)
    };
    let noise = Noise::new(&mut rng, w, 9.0);
    // The playable part's first column and the one past its end (the old map's edges).
    let (x0, x1) = (WOODLAND_RUNOUT, WOODLAND_RUNOUT + WOODLAND_PLAY_W);
    // 2. The walkable band (a thicket border of 3 stays above and below; it runs to the map's ends).
    for x in 0..w {
        let r = 20.0 + 4.0 * noise.at(x as f64); // balancing
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
        let x = x0 + (24.0 + i as f64 * (WOODLAND_PLAY_W - 48) as f64 / 5.0 + rng.gen_range(-5.0..=5.0)).round() as i32; // balancing
        let (rx, ry) = (rng.gen_range(5.0..=8.0), rng.gen_range(4.0..=6.0)); // balancing
        let dy = rng.gen_range(13.0..=18.0); // balancing: beyond the road's clearing
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
    let (lo, hi) = ((x0 + 5..=x0 + 7).map(centre).fold(f64::MAX, f64::min), (x0 + 5..=x0 + 7).map(centre).fold(f64::MIN, f64::max));
    let (sy0, sy1) = ((lo - 4.5).floor() as i32, (hi + 4.5).ceil() as i32); // balancing
    let start = Rect { x: x0 + 3, y: sy0, w: 10, h: sy1 - sy0 + 1 };
    for y in start.y..start.y + start.h {
        for x in start.x..start.x + start.w {
            if (3..=h - 4).contains(&y) && map.get(x, y) == Tile::Thicket as u8 {
                map.set(x, y, Tile::Floor);
            }
        }
    }
    let ex = x1 - 9;
    let end_ell = carve_ellipse(&mut map, ex as f64, centre(ex), 7.0, 6.0); // balancing
    ellipses.push([ex as f64, centre(ex), 7.0, 6.0]);
    // the clearing runs on past the eastern wall; only its playable part counts
    let end_all = Rect { w: end_ell.w.min(WALL_E - end_ell.x), ..end_ell };
    let end_x = end_all.x.max(x1 - 14);
    let end = Rect { x: end_x, y: end_all.y, w: end_all.x + end_all.w - end_x, h: end_all.h };
    for x in 0..w {
        for y in 3..=h - 4 {
            if (y as f64 - centre(x)).abs() <= 1.5 {
                map.set(x, y, Tile::Road);
            }
        }
    }
    // Floor the road cannot reach (a clearing cut off by the border) turns back to thicket.
    let road0 = (x0 + 5..=x0 + 7).flat_map(|x| (0..h).map(move |y| (x, y))).find(|&(x, y)| map.get(x, y) == Tile::Road as u8).unwrap();
    let seen = bfs_hero(&map, road0.0, road0.1);
    for y in 0..h {
        for x in 0..w {
            if map.safe(x, y) && !seen[(y * w + x) as usize] {
                map.set(x, y, Tile::Thicket);
            }
        }
    }
    // 3b. Water (#360).
    let pond = place_water(seed, &map, &centre, start, &ellipses, road0).map(|(m, p)| {
        map = m;
        p
    });
    // a pond bridge's deck and the tile beyond each end: no bush or creature there
    let bridge_zone: HashSet<(i32, i32)> = pond
        .iter()
        .flat_map(|p| p.bridges.iter())
        .flat_map(|b| {
            let r = b.rect;
            let ends: Vec<(i32, i32)> = (0..if b.along_x { r.h } else { r.w })
                .flat_map(|k| if b.along_x { [(r.x - 1, r.y + k), (r.x + r.w, r.y + k)] } else { [(r.x + k, r.y - 1), (r.x + k, r.y + r.h)] })
                .collect();
            (r.y..r.y + r.h).flat_map(move |y| (r.x..r.x + r.w).map(move |x| (x, y))).chain(ends)
        })
        .collect();
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
                && !(-TREE_SHORE_GAP..=TREE_SHORE_GAP).any(|dy| (-TREE_SHORE_GAP..=TREE_SHORE_GAP).any(|dx| is_water_tile(map.get(x + dx, y + dy))))
                && !(-1..=1).any(|dy| (-1..=1).any(|dx| bridge_zone.contains(&(x + dx, y + dy))))
        })
        .collect();
    tiles.shuffle(&mut rng);
    let mut trees: Vec<Plant> = vec![];
    let lone: Vec<bool> = tiles.iter().map(|_| rng.gen_ratio(1, ROAD_SPARSE_ONE_IN)).collect();
    // Groves (#427): beyond the road's clearing the trees stand in clumps with open grass between them, so the
    // forest reads lush with fewer plants. (centre x, centre y, radius; tiles)
    let mut groves: Vec<[f64; 3]> = vec![];
    for &(x, y) in &tiles {
        let (gx, gy) = (x as f64 + 0.5, y as f64 + 0.5);
        if (gy - centre(x) - 0.5).abs() >= ROAD_SPARSE && groves.iter().all(|g| (g[0] - gx).hypot(g[1] - gy) >= GROVE_GAP) {
            groves.push([gx, gy, rng.gen_range(GROVE_R)]);
        }
    }
    let in_grove = |x: i32, y: i32, extra: f64| groves.iter().any(|g| (g[0] - x as f64 - 0.5).hypot(g[1] - y as f64 - 0.5) <= g[2] + extra);
    for _pass in 0..3 {
        for (i, &(x, y)) in tiles.iter().enumerate() {
            let roll = rng.gen_range(0..100);
            // (kind, spacing in tiles, scale range); round 28, conifer 24, tall 19, small round 14, wide 10, dead 5.
            // A dead tree's kind is a placeholder until its seed is drawn.
            let dead = roll >= 100 - WOODLAND_FOLIAGE.dead_pct as i32;
            let (kind, spacing, lo, hi) = match roll {
                _ if dead => (PlantKind::Round, 3.2, 80, 120),
                0..=27 => (PlantKind::Round, 3.2, 80, 120),
                28..=51 => (PlantKind::Conifer, 2.4, 80, 120),
                52..=70 => (PlantKind::Tall, 2.4, 80, 120),
                71..=84 => (PlantKind::Round, 2.0, 50, 65),
                _ => (PlantKind::Wide, 3.2, 80, 120),
            }; // balancing
            let foot = jitter(&mut rng, x, y);
            // the road's clearing, from the foot's own position
            let d = (foot.y - line(x)).abs() / TILE;
            if d < ROAD_CLEAR || (!lone[i] && !in_grove(x, y, 0.0)) {
                continue;
            }
            if !placed.free(foot, spacing) {
                continue;
            }
            placed.add(foot, spacing);
            let scale_pct = rng.gen_range(lo..=hi);
            let mirrored = rng.gen_bool(0.5);
            let seed = fresh_seed(&mut rng, &mut used);
            let (kind, leaf_pct) = if dead {
                ([PlantKind::Round, PlantKind::Wide, PlantKind::Tall][seed as usize % 3], 0)
            } else {
                (kind, WOODLAND_FOLIAGE.leaf_pct)
            };
            trees.push(Plant { kind, foot, seed, scale_pct, mirrored, leaf_pct, dead });
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
        Plant { kind, foot, seed, scale_pct, mirrored: rng.gen_bool(0.5), leaf_pct: WOODLAND_FOLIAGE.leaf_pct, dead: false }
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

    // 6. Bushes on the walkable ground: small clumps scattered everywhere, so the open ground reads as meadow.
    let walkable = map.tiles.iter().filter(|&&t| t == Tile::Floor as u8).count();
    let want = walkable / BUSH_TILES;
    let mut floor: Vec<(i32, i32)> = (0..h).flat_map(|y| (0..w).map(move |x| (x, y))).filter(|&(x, y)| map.get(x, y) == Tile::Floor as u8 && !bridge_zone.contains(&(x, y))).collect();
    floor.shuffle(&mut rng);
    let mut bushes: Vec<Plant> = vec![];
    for &(sx, sy) in &floor {
        if bushes.len() >= want {
            break;
        }
        // a small clump: the tile's own bush and up to two more within two tiles
        for k in 0..rng.gen_range(BUSH_CLUMP) {
            let (x, y) = if k == 0 { (sx, sy) } else { (sx + rng.gen_range(-2..=2), sy + rng.gen_range(-2..=2)) };
            if map.get(x, y) != Tile::Floor as u8 || bridge_zone.contains(&(x, y)) {
                continue;
            }
            let foot = jitter(&mut rng, x, y);
            if (foot.y - line(x)).abs() < TILE || !placed.free(foot, 1.5) {
                continue;
            }
            placed.add(foot, 1.5);
            let scale_pct = rng.gen_range(75..=150); // balancing: 24..48 px wide
            bushes.push(Plant {
                kind: PlantKind::Bush,
                foot,
                seed: fresh_seed(&mut rng, &mut used),
                scale_pct,
                mirrored: rng.gen_bool(0.5),
                leaf_pct: WOODLAND_FOLIAGE.leaf_pct,
                dead: false,
            });
        }
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

    // 7b. The invisible walls: every open tile of the two wall columns. Last, so the reachability passes above
    // see one band from end to end and keep the forest beyond the walls.
    for x in [WALL_W, WALL_E] {
        for y in 0..h {
            if map.safe(x, y) {
                map.set(x, y, Tile::Barrier);
            }
        }
    }

    // 8. Spots.
    let player_spawns: Vec<Vec2> = [(5, 0), (5, 1), (7, 0), (7, 1)]
        .iter()
        .map(|&(x, k)| {
            let x = x0 + x;
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
            .filter(|&(x, y)| map.get(x, y) == Tile::Floor as u8 && !bridge_zone.contains(&(x, y)))
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
    // nothing lives beyond the invisible walls
    let walk: Vec<(i32, i32)> = floor.iter().copied().filter(|&(x, y)| playable_x(x) && !start.contains_tile(x, y) && !end_all.contains_tile(x, y)).collect();
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
            let mut near: Vec<(i32, i32)> = (ay - 3..=ay + 3).flat_map(|y| (ax - 3..=ax + 3).map(move |x| (x, y))).filter(|&(x, y)| playable_x(x) && map.get(x, y) == Tile::Floor as u8 && !bridge_zone.contains(&(x, y))).collect();
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
    let mut sun_rng = ChaCha8Rng::seed_from_u64(seed ^ SUN_SALT);
    let sun = Sun { side: if sun_rng.gen_bool(0.5) { -1 } else { 1 }, elevation_deg: sun_rng.gen_range(SUN_ELEVATION) };
    let wl = Woodland { plants, start, end, clearings, animals, seed: rng.gen_range(1..=1_000_000), sun, palette: WOODLAND_FOLIAGE.palette, pond, ellipses };
    let layout = Layout { map, spawns, chests: vec![], barrels: vec![], torches: vec![], suns: vec![], player_spawns, cove: None, daylight: true, woodland: Some(wl.clone()), stone: vec![] };
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
                    let reached = seen[(y * WOODLAND_W + x) as usize];
                    if playable_x(x) {
                        assert!(!l.map.safe(x, y) || reached, "seed {seed}: {x},{y} cut off");
                    } else {
                        assert!(!reached, "seed {seed}: {x},{y} beyond the invisible walls is reachable");
                    }
                }
            }
            for p in &l.player_spawns {
                assert!(w.start.contains(*p), "seed {seed}: spawn outside the start");
            }
        });
    }

    #[test]
    fn border_is_thicket_above_and_below() {
        each(|seed, l, _| {
            for y in (0..3).chain(WOODLAND_H - 3..WOODLAND_H) {
                for x in 0..WOODLAND_W {
                    assert_eq!(l.map.get(x, y), Tile::Thicket as u8, "seed {seed}: {x},{y}");
                }
            }
        });
    }

    #[test]
    fn the_road_runs_on_past_invisible_walls() {
        each(|seed, l, w| {
            // the road reaches both ends of the map
            for x in [0, WOODLAND_W - 1] {
                assert!((0..WOODLAND_H).any(|y| l.map.get(x, y) == Tile::Road as u8), "seed {seed}: no road at column {x}");
            }
            // each wall column: no open tile left, and a barrier where the road crosses it
            for x in [WALL_W, WALL_E] {
                assert!((0..WOODLAND_H).all(|y| !l.map.safe(x, y)), "seed {seed}: open tile in wall column {x}");
                assert!((0..WOODLAND_H).any(|y| l.map.get(x, y) == Tile::Barrier as u8), "seed {seed}: no barrier at column {x}");
                // the road crosses the wall (the client draws a barrier like the tile west of it, so the road runs on)
                assert!((0..WOODLAND_H).any(|y| l.map.get(x, y) == Tile::Barrier as u8 && l.map.get(x - 1, y) == Tile::Road as u8), "seed {seed}: the road does not cross column {x}");
            }
            // no barrier elsewhere; the start and the end stay inside
            for y in 0..WOODLAND_H {
                for x in 0..WOODLAND_W {
                    if l.map.get(x, y) == Tile::Barrier as u8 {
                        assert!(x == WALL_W || x == WALL_E, "seed {seed}: barrier at {x},{y}");
                    }
                }
            }
            for r in [w.start, w.end] {
                assert!(playable_x(r.x) && playable_x(r.x + r.w - 1), "seed {seed}: {r:?} crosses a wall");
            }
            // nothing lives beyond the walls
            for p in l.spawns.iter().map(|s| s.pos).chain(w.animals.iter().map(|a| a.1)).chain(l.player_spawns.iter().copied()) {
                assert!(playable_x(Map::tile_of(p).0), "seed {seed}: creature beyond a wall");
            }
            // the run-out has a forest too
            for (a, b) in [(0, WALL_W), (WALL_E + 1, WOODLAND_W)] {
                assert!(w.plants.iter().filter(|p| (a..b).contains(&Map::tile_of(p.foot).0)).count() >= 20, "seed {seed}: bare run-out");
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
            // measured over these seeds in #427: 565 to 653 plants, 133 to 202 roadside trees, 132 to 151 ground bushes
            assert!((500..=850).contains(&w.plants.len()), "seed {seed}: {} plants", w.plants.len());
            let trees = w.plants.iter().filter(|p| p.kind != PlantKind::Bush && !on_thicket(l, p)).count();
            assert!(trees >= 100, "seed {seed}: {trees} roadside trees");
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

    /// #427: the road runs through a clearing. The road's middle row is read from its tiles, which lie up to
    /// half a tile off the centre line the generator measures from; hence the half tile of slack.
    #[test]
    fn the_road_has_a_clearing() {
        each(|seed, l, w| {
            let (mut near, mut all) = (0, 0);
            for p in w.plants.iter().filter(|p| p.kind != PlantKind::Bush && !on_thicket(l, p)) {
                let x = Map::tile_of(p.foot).0;
                let ys: Vec<i32> = (0..WOODLAND_H).filter(|&y| l.map.get(x, y) == Tile::Road as u8).collect();
                if ys.is_empty() {
                    continue; // a wall column: its road tiles are barriers
                }
                let mid = (ys[0] + ys[ys.len() - 1] + 1) as f64 / 2.0 * TILE;
                let d = (p.foot.y - mid).abs() / TILE;
                assert!(d >= ROAD_CLEAR - 0.5, "seed {seed}: a tree {d:.1} tiles from the road");
                all += 1;
                near += (d < ROAD_SPARSE - 0.5) as i32;
            }
            assert!(near > 0, "seed {seed}: no tree at all near the road");
            assert!(near * 3 <= all, "seed {seed}: {near} of {all} trees stand near the road");
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

    /// The plant list as it was printed before plants carried a leaf amount and a dead mark: a dead tree
    /// reads `Bare`, and those two fields are left out. It keeps the pinned fingerprint comparable.
    fn legacy_plants(w: &Woodland) -> String {
        #[derive(Debug)]
        #[allow(dead_code)] // read through Debug
        enum PlantKind {
            Round,
            Wide,
            Tall,
            Conifer,
            Bush,
            Bare,
        }
        #[derive(Debug)]
        #[allow(dead_code)] // read through Debug
        struct Plant {
            kind: PlantKind,
            foot: Vec2,
            seed: u32,
            scale_pct: u8,
            mirrored: bool,
        }
        let old: Vec<Plant> = w
            .plants
            .iter()
            .map(|p| Plant {
                kind: match p.kind {
                    _ if p.dead => PlantKind::Bare,
                    super::PlantKind::Round => PlantKind::Round,
                    super::PlantKind::Wide => PlantKind::Wide,
                    super::PlantKind::Tall => PlantKind::Tall,
                    super::PlantKind::Conifer => PlantKind::Conifer,
                    super::PlantKind::Bush => PlantKind::Bush,
                },
                foot: p.foot,
                seed: p.seed,
                scale_pct: p.scale_pct,
                mirrored: p.mirrored,
            })
            .collect();
        format!("{old:?}")
    }

    /// FNV-1a over the map's tiles, the plants and the spawns of `generate(seed)`; the sun is not part of it.
    fn map_fingerprint(seed: u64) -> u64 {
        let (l, w) = generate(seed);
        let mut h: u64 = 0xcbf29ce484222325;
        let mut feed = |bytes: &[u8]| {
            for b in bytes {
                h = (h ^ *b as u64).wrapping_mul(0x100000001b3);
            }
        };
        feed(&l.map.tiles);
        feed(legacy_plants(&w).as_bytes());
        feed(format!("{:?}", l.spawns).as_bytes());
        h
    }

    #[test]
    fn the_map_is_unchanged_by_the_sun() {
        let got: Vec<u64> = [1u64, 2, 3, 7, 42].iter().map(|s| map_fingerprint(*s)).collect();
        // Pinned in #277, the commit that gave the woodland a sun: tiles, plants and spawns do not depend on it.
        // Re-pinned in #279: the bare roll moved the plants. Re-pinned in #427: a larger map, the road's clearing, groves, bush clumps.
        // Re-pinned in #360 for seeds 1, 2, 3 and 7, which got a pond; seed 42 has none and keeps its value.
        assert_eq!(got, vec![262704624205756269, 8904440953177393501, 11368231502334707319, 2764633660331206483, 1831013090409208476]);
    }

    /// The fingerprints pinned before the water (#360): a seed without a pond must still print them.
    const PRE_WATER_PINS: [(u64, u64); 5] = [
        (1, 10293044552774504163),
        (2, 2449216727139127116),
        (3, 3178422832859391124),
        (7, 7367593523915622726),
        (42, 1831013090409208476),
    ];

    #[test]
    fn the_map_without_a_pond_is_the_old_map() {
        for (seed, pin) in PRE_WATER_PINS {
            if generate(seed).1.pond.is_none() {
                assert_eq!(map_fingerprint(seed), pin, "seed {seed}");
            }
        }
    }

    fn is_water(l: &Layout, x: i32, y: i32) -> bool {
        let t = l.map.get(x, y);
        t == Tile::ShallowWater as u8 || t == Tile::DeepWater as u8
    }
    /// The tiles a bridge's deck covers and the tile beyond each end of it.
    fn bridge_zone(b: &Bridge) -> Vec<(i32, i32)> {
        let r = b.rect;
        let mut z: Vec<(i32, i32)> = tiles_of(r).collect();
        for k in 0..if b.along_x { r.h } else { r.w } {
            if b.along_x {
                z.extend([(r.x - 1, r.y + k), (r.x + r.w, r.y + k)]);
            } else {
                z.extend([(r.x + k, r.y - 1), (r.x + k, r.y + r.h)]);
            }
        }
        z
    }
    fn zone_of(w: &Woodland) -> HashSet<(i32, i32)> {
        w.pond.iter().flat_map(|p| p.bridges.iter()).flat_map(bridge_zone).collect()
    }
    /// The water that is not a stream's own (a tile of a stream's line or beside one): the pond's body.
    fn pond_body(l: &Layout, w: &Woodland) -> Vec<(i32, i32)> {
        let line: HashSet<(i32, i32)> = w.pond.iter().flat_map(|p| p.streams.iter()).flat_map(|s| path_tiles(&s.points)).collect();
        let near_line = |x: i32, y: i32| (-1..=1).any(|dy| (-1..=1).any(|dx| line.contains(&(x + dx, y + dy))));
        (0..WOODLAND_H).flat_map(|y| (0..WOODLAND_W).map(move |x| (x, y))).filter(|&(x, y)| is_water(l, x, y) && !near_line(x, y)).collect()
    }

    #[test]
    fn ponds_appear_in_about_60_percent() {
        let mut n = 0;
        each(|_, _, w| n += w.pond.is_some() as u64);
        eprintln!("ponds: {n} of {SEEDS}");
        assert!((SEEDS * 40 / 100..=SEEDS * 70 / 100).contains(&n), "{n} of {SEEDS} seeds have a pond");
    }

    #[test]
    fn seeds_without_a_pond_have_no_water() {
        each(|seed, l, w| {
            if w.pond.is_none() {
                assert!(l.map.tiles.iter().all(|&t| t != Tile::ShallowWater as u8 && t != Tile::DeepWater as u8), "seed {seed}");
            }
        });
    }

    #[test]
    fn water_lies_on_open_ground() {
        each(|seed, l, w| {
            let Some(p) = &w.pond else { return };
            let body = pond_body(l, w);
            assert!(!body.is_empty(), "seed {seed}: no pond body");
            let end_left = (w.ellipses.last().unwrap()[0] - w.ellipses.last().unwrap()[2]).floor() as i32;
            let mut nearest = f64::MAX;
            for &(x, y) in &body {
                let d = ((y as f64 + 0.5) - (road_centre(l, x) + 0.5)).abs();
                nearest = nearest.min(d);
                // half a tile of slack: the road's row is read from its tiles
                assert!(d >= POND_ROAD_MIN - 0.5, "seed {seed}: water {x},{y} is {d} from the road");
                assert!(playable_x(x), "seed {seed}");
                assert!(x - (w.start.x + w.start.w - 1) >= POND_FROM_ENDS && end_left - x >= POND_FROM_ENDS, "seed {seed}: water at column {x}");
                assert!(!w.start.contains_tile(x, y) && !w.ellipses.iter().any(|e| in_ellipse(e, x, y)), "seed {seed}: water in a clearing");
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        assert_ne!(l.map.get(x + dx, y + dy), Tile::Thicket as u8, "seed {seed}: water {x},{y} beside thicket");
                    }
                }
            }
            assert!(nearest <= POND_ROAD_MAX + 0.5, "seed {seed}: nearest water {nearest} from the road");
            assert!(p.bounds.contains_tile(body[0].0, body[0].1));
            assert!((1..=1_000_000).contains(&p.seed));
        });
    }

    /// The road's middle row at column `x`, from its tiles (they lie within half a tile of the generator's centre line).
    fn road_centre(l: &Layout, x: i32) -> f64 {
        let ys: Vec<i32> = (0..WOODLAND_H).filter(|&y| l.map.get(x, y) == Tile::Road as u8 || l.map.get(x, y) == Tile::Barrier as u8).collect();
        (ys[0] + ys[ys.len() - 1]) as f64 / 2.0
    }

    #[test]
    fn no_plant_or_creature_on_water_or_a_bridge() {
        each(|seed, l, w| {
            let zone = zone_of(w);
            for p in &w.plants {
                let t = Map::tile_of(p.foot);
                assert!(!is_water(l, t.0, t.1) && !zone.contains(&t), "seed {seed}: a plant at {t:?}");
            }
            for p in l.spawns.iter().map(|s| s.pos).chain(w.animals.iter().map(|a| a.1)).chain(l.player_spawns.iter().copied()) {
                let t = Map::tile_of(p);
                assert!(!is_water(l, t.0, t.1) && !zone.contains(&t), "seed {seed}: a creature at {t:?}");
            }
        });
    }

    #[test]
    fn trees_keep_two_tiles_from_the_shore() {
        each(|seed, l, _| {
            for y in 0..WOODLAND_H {
                for x in 0..WOODLAND_W {
                    if l.map.get(x, y) == Tile::Trunk as u8 {
                        for dy in -TREE_SHORE_GAP..=TREE_SHORE_GAP {
                            for dx in -TREE_SHORE_GAP..=TREE_SHORE_GAP {
                                assert!(!is_water(l, x + dx, y + dy), "seed {seed}: trunk {x},{y} near water");
                            }
                        }
                    }
                }
            }
        });
    }

    #[test]
    fn a_stream_joins_the_pond_and_the_bands_edge() {
        let mut streams = 0;
        each(|seed, l, w| {
            for s in w.pond.iter().flat_map(|p| p.streams.iter()) {
                streams += 1;
                let (src, end) = (tile_of(s.points[0]), tile_of(*s.points.last().unwrap()));
                let (pond_end, edge_end) = if s.inflow { (end, src) } else { (src, end) };
                assert!(is_water(l, pond_end.0, pond_end.1), "seed {seed}: the stream's pond end is dry");
                // the pond's body (water away from every stream line) lies within 2 tiles of the pond end
                let joins = pond_body(l, w).iter().any(|&(x, y)| (x - pond_end.0).abs() <= 2 && (y - pond_end.1).abs() <= 2);
                assert!(joins, "seed {seed}: the stream's pond end is not at the pond");
                assert!(is_water(l, edge_end.0, edge_end.1), "seed {seed}: the stream's far end is dry");
                let thicket = [(1, 0), (-1, 0), (0, 1), (0, -1)].iter().any(|d| l.map.get(edge_end.0 + d.0, edge_end.1 + d.1) == Tile::Thicket as u8);
                assert!(thicket, "seed {seed}: the stream does not reach the band's edge");
            }
        });
        assert!(streams > 0);
    }

    #[test]
    fn streams_keep_to_open_ground() {
        each(|seed, l, w| {
            for s in w.pond.iter().flat_map(|p| p.streams.iter()) {
                for (x, y) in path_tiles(&s.points) {
                    assert!(playable_x(x), "seed {seed}: stream tile {x},{y} outside the walls");
                    assert!(!w.start.contains_tile(x, y) && !w.ellipses.iter().any(|e| in_ellipse(e, x, y)), "seed {seed}: stream tile {x},{y} in the start or a clearing");
                    assert!(is_water(l, x, y) || l.map.get(x, y) == Tile::Road as u8, "seed {seed}: stream tile {x},{y} is neither water nor road");
                }
            }
        });
    }

    #[test]
    fn a_pond_bridge_is_a_plank_across_water() {
        let mut n = 0;
        each(|seed, l, w| {
            for b in w.pond.iter().flat_map(|p| p.bridges.iter()).filter(|b| !b.road) {
                n += 1;
                let r = b.rect;
                let (len, wid) = if b.along_x { (r.w, r.h) } else { (r.h, r.w) };
                assert!((2..=4).contains(&len) && wid == 1, "seed {seed}: deck {r:?}");
                assert!(tiles_of(r).all(|(x, y)| l.map.get(x, y) == Tile::Floor as u8), "seed {seed}: deck is not Floor");
                let side = |x: i32, y: i32| if b.along_x { [(x, y - 1), (x, y + 1)] } else { [(x - 1, y), (x + 1, y)] };
                assert!(tiles_of(r).any(|(x, y)| side(x, y).iter().all(|&(sx, sy)| is_water(l, sx, sy))), "seed {seed}: no water beside the deck");
                let (a, z) = if b.along_x { ((r.x - 1, r.y), (r.x + r.w, r.y)) } else { ((r.x, r.y - 1), (r.x, r.y + r.h)) };
                assert!(l.map.get(a.0, a.1) == Tile::Floor as u8 && l.map.get(z.0, z.1) == Tile::Floor as u8, "seed {seed}: an end is not Floor");
            }
        });
        assert!(n > 0);
    }

    #[test]
    fn a_stream_crossing_the_road_has_a_road_bridge() {
        let mut crossings = 0;
        each(|seed, l, w| {
            let Some(p) = &w.pond else { return };
            let mut want = vec![];
            for s in &p.streams {
                let tiles = path_tiles(&s.points);
                let road: Vec<(i32, i32)> = tiles.iter().copied().filter(|&(x, y)| l.map.get(x, y) == Tile::Road as u8).collect();
                if road.is_empty() {
                    continue;
                }
                crossings += 1;
                let c = road[0].0;
                assert!(road.iter().all(|t| t.0 == c), "seed {seed}: a stream runs along the road");
                let (rt, rb) = (road.iter().map(|t| t.1).min().unwrap(), road.iter().map(|t| t.1).max().unwrap());
                for y in rt - STREAM_STRAIGHT..=rb + STREAM_STRAIGHT {
                    assert!(tiles.contains(&(c, y)), "seed {seed}: the stream bends near the road at {c},{y}");
                }
                want.push(Rect { x: c, y: rt, w: 1, h: rb - rt + 1 });
            }
            let got: Vec<Rect> = p.bridges.iter().filter(|b| b.road).map(|b| b.rect).collect();
            assert_eq!(got, want, "seed {seed}");
            for b in p.bridges.iter().filter(|b| b.road) {
                assert!(b.along_x && tiles_of(b.rect).all(|(x, y)| l.map.get(x, y) == Tile::Road as u8), "seed {seed}: a road bridge off the road");
            }
        });
        assert!(crossings > 0);
    }

    #[test]
    fn some_seed_has_each_variant() {
        let (mut none, mut inflow, mut both, mut road, mut pond_bridge) = (0, 0, 0, 0, 0);
        each(|_, _, w| {
            let Some(p) = &w.pond else { return };
            none += p.streams.is_empty() as u32;
            inflow += (p.streams.len() == 1 && p.streams[0].inflow) as u32;
            both += (p.streams.len() == 2) as u32;
            road += p.bridges.iter().any(|b| b.road) as u32;
            pond_bridge += p.bridges.iter().any(|b| !b.road) as u32;
        });
        eprintln!("variants: no stream {none}, inflow only {inflow}, both {both}, road bridge {road}, pond bridge {pond_bridge}");
        assert!(none > 0 && inflow > 0 && both > 0 && road > 0 && pond_bridge > 0);
    }

    #[test]
    fn dead_trees_grow_by_the_road_not_on_the_edge() {
        let mut dead = 0;
        each(|seed, l, w| {
            assert!(!w.plants.iter().any(|p| p.dead && on_thicket(l, p)), "seed {seed}: a dead tree on the edge");
            for p in w.plants.iter().filter(|p| p.dead) {
                assert_eq!(p.leaf_pct, 0, "seed {seed}: a dead tree with leaves");
                assert!(matches!(p.kind, PlantKind::Round | PlantKind::Wide | PlantKind::Tall), "seed {seed}: a dead {:?}", p.kind);
                dead += 1;
            }
        });
        assert!(dead > 0, "no seed has a dead tree");
    }

    #[test]
    fn a_dead_tree_takes_its_shape_from_its_seed() {
        each(|seed, _, w| {
            for p in w.plants.iter().filter(|p| p.dead) {
                assert_eq!(p.kind, [PlantKind::Round, PlantKind::Wide, PlantKind::Tall][p.seed as usize % 3], "seed {seed}");
            }
        });
    }

    #[test]
    fn living_plants_are_full() {
        each(|seed, _, w| {
            for p in w.plants.iter().filter(|p| !p.dead) {
                assert_eq!(p.leaf_pct, WOODLAND_FOLIAGE.leaf_pct, "seed {seed}");
            }
        });
    }

    #[test]
    fn the_woodland_names_its_palette() {
        let (_, w) = generate(1);
        assert_eq!(w.palette, LeafPalette::Summer);
        assert_eq!(crate::protocol::WoodlandInfo::from(&w).palette, 0);
    }

    #[test]
    fn plant_kind_ids_match_the_client() {
        // client/src/game/vegetation.ts PLANT_KINDS has 5 entries; vegetation.test.ts pins the same
        // no `_` arm: a sixth variant fails to compile here
        let id = |k: PlantKind| match k {
            PlantKind::Round => 0,
            PlantKind::Wide => 1,
            PlantKind::Tall => 2,
            PlantKind::Conifer => 3,
            PlantKind::Bush => 4,
        };
        for k in [PlantKind::Round, PlantKind::Wide, PlantKind::Tall, PlantKind::Conifer, PlantKind::Bush] {
            assert_eq!(k as u8, id(k));
        }
    }

    #[test]
    fn the_sun_is_in_range_and_pinned_to_the_seed() {
        for seed in 1..=20u64 {
            let (_, w) = generate(seed);
            assert!(w.sun.side == -1 || w.sun.side == 1);
            assert!(SUN_ELEVATION.contains(&w.sun.elevation_deg));
            assert_eq!(w.sun, generate(seed).1.sun);
        }
        // both sides and more than one height occur
        let suns: Vec<_> = (1..=40u64).map(|s| generate(s).1.sun).collect();
        assert!(suns.iter().any(|s| s.side == -1) && suns.iter().any(|s| s.side == 1));
        assert!(suns.iter().map(|s| s.elevation_deg).collect::<std::collections::HashSet<_>>().len() > 3);
    }
}
