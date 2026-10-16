//! What a hero sees: the visibility polygon from a pixel position and the
//! tiles it covers. Mirrored by `client/src/sim/vispoly.ts` and `view.ts`
//! (checked with shared test fixtures); the client draws the same polygon as
//! the edge of sight, so the floor it lights is the floor monsters are sent on.

use crate::dungeon::{Map, TILE};
use crate::fov::Fov;
use crate::math::Vec2;

/// A wall edge in px: x0, y0, x1, y1.
pub type Segment = [f64; 4];

/// The sight radius in px for `vision` tiles: it covers the tiles whose centres the shadowcast reaches.
pub fn sight_radius(vision: i32) -> f64 {
    (vision as f64 + 0.5) * TILE
}

/// Runs of tile edges between an opaque and an open tile, within `r` px (plus a tile) of (px, py).
/// Off-map counts as opaque.
pub fn wall_segments(map: &Map, px: f64, py: f64, r: f64) -> Vec<Segment> {
    let x0 = ((px - r) / TILE).floor() as i32 - 1;
    let y0 = ((py - r) / TILE).floor() as i32 - 1;
    let x1 = ((px + r) / TILE).floor() as i32 + 1;
    let y1 = ((py + r) / TILE).floor() as i32 + 1;
    let mut segs = Vec::new();
    // Horizontal edges: the line between row y-1 and row y. A run continues while the opaque side stays the same.
    for y in y0..=y1 + 1 {
        let (mut start, mut side) = (0, 0);
        for x in x0..=x1 + 1 {
            let above = map.opaque(x, y - 1);
            let below = map.opaque(x, y);
            let s = if x <= x1 && above != below { if above { 1 } else { 2 } } else { 0 };
            if s != side {
                if side != 0 {
                    segs.push([start as f64 * TILE, y as f64 * TILE, x as f64 * TILE, y as f64 * TILE]);
                }
                start = x;
                side = s;
            }
        }
    }
    // Vertical edges: the line between column x-1 and column x.
    for x in x0..=x1 + 1 {
        let (mut start, mut side) = (0, 0);
        for y in y0..=y1 + 1 {
            let left = map.opaque(x - 1, y);
            let right = map.opaque(x, y);
            let s = if y <= y1 && left != right { if left { 1 } else { 2 } } else { 0 };
            if s != side {
                if side != 0 {
                    segs.push([x as f64 * TILE, start as f64 * TILE, x as f64 * TILE, y as f64 * TILE]);
                }
                start = y;
                side = s;
            }
        }
    }
    segs
}

/// Distance along the unit ray (dx, dy) from (ox, oy) to the nearest segment, at most `max`.
fn cast(ox: f64, oy: f64, dx: f64, dy: f64, segs: &[Segment], max: f64) -> f64 {
    let mut best = max;
    for &[ax, ay, bx, by] in segs {
        let (ex, ey) = (bx - ax, by - ay);
        let den = dx * ey - dy * ex;
        if den.abs() < 1e-12 {
            continue; // parallel
        }
        let t = ((ax - ox) * ey - (ay - oy) * ex) / den;
        let u = ((ax - ox) * dy - (ay - oy) * dx) / den;
        if t > 0.0 && t < best && u >= -1e-9 && u <= 1.0 + 1e-9 {
            best = t;
        }
    }
    best
}

/// Ray angle offset beside a segment end.
const EPS: f64 = 1e-4;

/// A visibility polygon: its points and their ray angles, sorted (from -π).
pub struct SightPolygon {
    pub points: Vec<(f64, f64)>,
    pub angles: Vec<f64>,
}

/// The visibility polygon from (px, py) within `r` px: rays at `steps` even angles and to every
/// segment end (and just beside it), each stopping at the nearest segment or at `r`.
pub fn sight_polygon(map: &Map, px: f64, py: f64, r: f64, steps: usize) -> SightPolygon {
    use std::f64::consts::PI;
    let segs = wall_segments(map, px, py, r);
    let mut angles: Vec<f64> = (0..steps).map(|i| (i as f64 / steps as f64) * PI * 2.0 - PI).collect();
    for &[ax, ay, bx, by] in &segs {
        for (x, y) in [(ax, ay), (bx, by)] {
            if (x - px).powi(2) + (y - py).powi(2) > r * r * 1.1 {
                continue;
            }
            let a = (y - py).atan2(x - px);
            angles.extend([a - EPS, a, a + EPS]);
        }
    }
    angles.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let points = angles
        .iter()
        .map(|&a| {
            let (dx, dy) = (a.cos(), a.sin());
            let t = cast(px, py, dx, dy, &segs, r);
            (px + dx * t, py + dy * t)
        })
        .collect();
    SightPolygon { points, angles }
}

/// Whether (qx, qy) lies inside `s`, cast from (px, py). The polygon is star-shaped around the
/// viewer with its points sorted by angle: the point's angle is bracketed by binary search, and it
/// is inside when it lies on the viewer's side of the edge between the two bracketing points (the
/// edge from the last point back to the first closes the circle across ±π).
pub fn inside(s: &SightPolygon, px: f64, py: f64, qx: f64, qy: f64) -> bool {
    let n = s.angles.len();
    if n < 2 {
        return false;
    }
    let a = (qy - py).atan2(qx - px);
    // The last ray at or before the point's angle; none: the last ray (the closing edge).
    let i = s.angles.partition_point(|&b| b <= a).checked_sub(1).unwrap_or(n - 1);
    let j = if i == n - 1 { 0 } else { i + 1 };
    let ((ax, ay), (bx, by)) = (s.points[i], s.points[j]);
    let (ex, ey) = (bx - ax, by - ay);
    let side_v = ex * (py - ay) - ey * (px - ax);
    if side_v.abs() < 1e-9 {
        return (qx - px).hypot(qy - py) <= (ax - px).hypot(ay - py).min((bx - px).hypot(by - py));
    }
    (ex * (qy - ay) - ey * (qx - ax)) * side_v >= 0.0
}

/// Sample points per tile side (4×4, 4 px apart, 2 px in from the edges).
const SAMPLES: i32 = 4;

/// The tiles a hero sees: open tiles any of whose 16 sample points lie inside the polygon, and
/// walls by the tile FOV (as the client's mask draws them).
pub struct View {
    pub fov: Fov,
    w: i32,
    h: i32,
    stamp: Vec<u32>,
    gen: u32,
}

impl View {
    pub fn new(w: i32, h: i32) -> Self {
        View { fov: Fov::new(w, h), w, h, stamp: vec![0; (w * h).max(0) as usize], gen: 0 }
    }

    /// The view from `p` (px) with `vision` tiles.
    pub fn compute(&mut self, map: &Map, p: Vec2, vision: i32) {
        let r = sight_radius(vision);
        self.gen = self.gen.wrapping_add(1).max(1);
        let (tx, ty) = Map::tile_of(p);
        self.fov.compute(map, tx, ty, vision);
        let poly = sight_polygon(map, p.x, p.y, r, 96);
        let x0 = (((p.x - r) / TILE).floor() as i32).max(0);
        let y0 = (((p.y - r) / TILE).floor() as i32).max(0);
        let x1 = (((p.x + r) / TILE).floor() as i32).min(self.w - 1);
        let y1 = (((p.y + r) / TILE).floor() as i32).min(self.h - 1);
        for y in y0..=y1 {
            for x in x0..=x1 {
                let seen = if map.opaque(x, y) {
                    self.fov.is_visible(x, y)
                } else {
                    (0..SAMPLES * SAMPLES).any(|k| {
                        let (i, j) = (k % SAMPLES, k / SAMPLES);
                        inside(&poly, p.x, p.y, x as f64 * TILE + 2.0 + 4.0 * i as f64, y as f64 * TILE + 2.0 + 4.0 * j as f64)
                    })
                };
                if seen {
                    self.stamp[(y * self.w + x) as usize] = self.gen;
                }
            }
        }
    }

    pub fn is_visible(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.w && y < self.h && self.stamp[(y * self.w + x) as usize] == self.gen
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dungeon::Tile;

    /// A map from rows of characters: '#' wall, 'D' closed door, anything else floor.
    fn grid(rows: &[&str]) -> Map {
        let mut m = Map::new(rows[0].len() as i32, rows.len() as i32);
        for (y, row) in rows.iter().enumerate() {
            for (x, c) in row.chars().enumerate() {
                m.set(x as i32, y as i32, match c {
                    '#' => Tile::Wall,
                    'D' => Tile::DoorClosed,
                    _ => Tile::Floor,
                });
            }
        }
        m
    }

    /// An open room w×h inside a ring of walls, with extra walls.
    fn room(w: i32, h: i32, walls: &[(i32, i32)]) -> Map {
        let rows: Vec<String> = (0..h)
            .map(|y| (0..w).map(|x| if x == 0 || y == 0 || x == w - 1 || y == h - 1 || walls.contains(&(x, y)) { '#' } else { '.' }).collect())
            .collect();
        grid(&rows.iter().map(|s| s.as_str()).collect::<Vec<_>>())
    }

    #[test]
    fn wall_segments_merge_straight_walls() {
        let map = grid(&["#######", "#.....#", "#.....#", "#.....#", "#######"]);
        let segs = wall_segments(&map, 3.5 * TILE, 2.5 * TILE, 100.0);
        assert_eq!(segs.len(), 4);
        for s in [[16.0, 16.0, 96.0, 16.0], [16.0, 64.0, 96.0, 64.0], [16.0, 16.0, 16.0, 64.0], [96.0, 16.0, 96.0, 64.0]] {
            assert!(segs.contains(&s), "missing {s:?} in {segs:?}");
        }
    }

    #[test]
    fn polygon_is_a_circle_in_an_open_room() {
        let map = room(21, 21, &[]);
        let s = sight_polygon(&map, 168.0, 168.0, 80.0, 96);
        assert!(s.points.len() >= 96);
        for (x, y) in &s.points {
            assert!(((x - 168.0).hypot(y - 168.0) - 80.0).abs() < 1e-6);
        }
        assert_eq!(sight_radius(0), 8.0);
        assert_eq!(sight_radius(9), 9.5 * TILE);
    }

    #[test]
    fn pillar_casts_a_wedge() {
        let map = room(21, 21, &[(13, 10)]);
        let s = sight_polygon(&map, 168.0, 168.0, 128.0, 96);
        let half = 8f64.atan2(40.0);
        let wedge: Vec<_> = s.points.iter().filter(|(x, y)| (y - 168.0).atan2(x - 168.0).abs() < half - 0.01).collect();
        assert!(!wedge.is_empty());
        for (x, _) in wedge {
            assert!((x - 208.0).abs() < 1e-6, "ray in the wedge ends at x {x}");
        }
    }

    #[test]
    fn inside_works_across_pi_and_behind_a_pillar() {
        let s = sight_polygon(&room(21, 21, &[]), 168.0, 168.0, 80.0, 96);
        assert!(inside(&s, 168.0, 168.0, 247.0, 168.0));
        assert!(!inside(&s, 168.0, 168.0, 249.0, 168.0));
        assert!(inside(&s, 168.0, 168.0, 89.0, 168.0)); // angle π: the closing edge
        assert!(!inside(&s, 168.0, 168.0, 87.0, 168.001));
        let p = sight_polygon(&room(21, 21, &[(13, 10)]), 168.0, 168.0, 128.0, 96);
        assert!(!inside(&p, 168.0, 168.0, 240.0, 168.0));
        assert!(inside(&p, 168.0, 168.0, 240.0, 200.0));
    }

    #[test]
    fn view_sees_floor_behind_a_doorway_beyond_the_fov() {
        let rows: Vec<String> = (0..11)
            .map(|y| (0..21).map(|x| if x == 0 || y == 0 || x == 20 || y == 10 || (x == 10 && y != 5) { '#' } else { '.' }).collect())
            .collect();
        let map = grid(&rows.iter().map(|s| s.as_str()).collect::<Vec<_>>());
        let mut v = View::new(map.w, map.h);
        v.compute(&map, Vec2::new(144.8, 79.2), 9);
        assert!(!v.fov.is_visible(15, 5));
        assert!(v.is_visible(15, 5));
        assert!(!v.is_visible(15, 2));
    }

    #[test]
    fn view_shows_walls_by_fov_and_a_blind_viewer_its_own_tile() {
        let map = room(9, 9, &[]);
        let mut v = View::new(map.w, map.h);
        v.compute(&map, Vec2::new(4.5 * TILE, 4.5 * TILE), 9);
        assert!(v.fov.is_visible(0, 4) && v.is_visible(0, 4));
        assert!(!v.is_visible(-1, 4));
        v.compute(&map, Vec2::new(4.5 * TILE, 4.5 * TILE), 0);
        assert!(v.is_visible(4, 4));
        assert!(!v.is_visible(6, 4));
    }

    #[test]
    fn a_closed_door_blocks() {
        let map = grid(&["#########", "#...D...#", "#########"]);
        let s = sight_polygon(&map, 24.0, 24.0, 160.0, 96);
        let far = s.points.iter().map(|p| p.0).fold(f64::MIN, f64::max);
        assert!((far - 64.0).abs() < 1e-6);
    }
}
