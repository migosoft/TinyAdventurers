//! Pure shapes for ponds, streams and rivers (tile coordinates; a tile (x, y) has its centre at (x + 0.5, y + 0.5)).

use super::Tile;
use rand::Rng;
use rand_chacha::ChaCha8Rng;

/// One ellipse of a pond's shape: centre and radii in tiles.
#[derive(Clone, Debug)]
pub struct Blob {
    pub cx: f64,
    pub cy: f64,
    pub rx: f64,
    pub ry: f64,
}

pub const DEEP_IN: f64 = 2.4; // balancing
const WOBBLE_AMP: f64 = 0.6; // balancing
const WOBBLE_WAVE: f64 = 4.0; // balancing
const PATH_STEP: f64 = 3.0; // balancing
const PATH_SWING: f64 = 1.5; // balancing

fn lattice(seed: u32, ix: i32, iy: i32) -> f64 {
    let mut h = seed ^ (ix as u32).wrapping_mul(0x9E37_79B1) ^ (iy as u32).wrapping_mul(0x85EB_CA77);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2C1B_3C6D);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297A_2D39);
    h ^= h >> 15;
    h as f64 / u32::MAX as f64 * 2.0 - 1.0
}

fn wobble(seed: u32, x: f64, y: f64) -> f64 {
    let (u, v) = (x / WOBBLE_WAVE, y / WOBBLE_WAVE);
    let (ix, iy) = (u.floor(), v.floor());
    let (fx, fy) = (u - ix, v - iy);
    let (sx, sy) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
    let (ix, iy) = (ix as i32, iy as i32);
    let top = lattice(seed, ix, iy) * (1.0 - sx) + lattice(seed, ix + 1, iy) * sx;
    let bottom = lattice(seed, ix, iy + 1) * (1.0 - sx) + lattice(seed, ix + 1, iy + 1) * sx;
    (top * (1.0 - sy) + bottom * sy) * WOBBLE_AMP
}

/// Signed distance-like value: > 0 inside the union of the blobs, about "tiles inside", with a wobbled edge.
pub fn inside(blobs: &[Blob], wobble_seed: u32, x: f64, y: f64) -> f64 {
    plain(blobs, x, y) + wobble(wobble_seed, x, y)
}

/// `inside` without the wobble.
fn plain(blobs: &[Blob], x: f64, y: f64) -> f64 {
    blobs
        .iter()
        .map(|b| {
            let (dx, dy) = ((x - b.cx) / b.rx, (y - b.cy) / b.ry);
            (1.0 - (dx * dx + dy * dy).sqrt()) * b.rx.min(b.ry)
        })
        .fold(f64::NEG_INFINITY, f64::max)
}

/// Every tile whose centre is inside (the wobbled value is > 0). `DeepWater` where the UNWOBBLED value is >= `DEEP_IN`
/// and all 8 neighbours are water, else `ShallowWater`: the wobble shapes the shore only, so a blob whose smaller
/// radius is below `DEEP_IN` is always all shallow. One piece is only tested for blobs of radius 3 and more.
pub fn blob_tiles(blobs: &[Blob], wobble_seed: u32) -> Vec<(i32, i32, Tile)> {
    let val = |x: i32, y: i32| inside(blobs, wobble_seed, x as f64 + 0.5, y as f64 + 0.5);
    let margin = |b: &Blob| (WOBBLE_AMP * b.rx.max(b.ry) / b.rx.min(b.ry)).ceil() as i32 + 1;
    let min_x = blobs.iter().map(|b| (b.cx - b.rx).floor() as i32 - margin(b)).min().unwrap_or(0);
    let max_x = blobs.iter().map(|b| (b.cx + b.rx).ceil() as i32 + margin(b)).max().unwrap_or(0);
    let min_y = blobs.iter().map(|b| (b.cy - b.ry).floor() as i32 - margin(b)).min().unwrap_or(0);
    let max_y = blobs.iter().map(|b| (b.cy + b.ry).ceil() as i32 + margin(b)).max().unwrap_or(0);
    let mut out = Vec::new();
    for y in min_y..=max_y {
        for x in min_x..=max_x {
            if val(x, y) <= 0.0 {
                continue;
            }
            let ringed = (-1..=1).all(|dy| (-1..=1).all(|dx| val(x + dx, y + dy) > 0.0));
            let deep = plain(blobs, x as f64 + 0.5, y as f64 + 0.5) >= DEEP_IN && ringed;
            let tile = if deep { Tile::DeepWater } else { Tile::ShallowWater };
            out.push((x, y, tile));
        }
    }
    out
}

/// A gently winding polyline from `from` to `to` (tile coordinates), a point about every 3 tiles, sideways swing at most 1.5 tiles.
pub fn winding_path(rng: &mut ChaCha8Rng, from: (f64, f64), to: (f64, f64)) -> Vec<(f64, f64)> {
    let (dx, dy) = (to.0 - from.0, to.1 - from.1);
    let len = (dx * dx + dy * dy).sqrt();
    let n = ((len / PATH_STEP).round() as usize).max(1);
    let (nx, ny) = if len > 0.0 { (-dy / len, dx / len) } else { (0.0, 0.0) };
    (0..=n)
        .map(|i| {
            let t = i as f64 / n as f64;
            // the sine keeps both ends exactly on `from` and `to`
            let side = if i == 0 || i == n { 0.0 } else { rng.gen_range(-1.0..=1.0) * PATH_SWING * (t * std::f64::consts::PI).sin() };
            (from.0 + dx * t + nx * side, from.1 + dy * t + ny * side)
        })
        .collect()
}

/// The 4-connected line of tiles under a polyline, in order, without repeats.
/// A tile the line comes back to cuts the loop out, so the line stays 4-connected and repeat-free.
pub fn path_tiles(path: &[(f64, f64)]) -> Vec<(i32, i32)> {
    let mut out: Vec<(i32, i32)> = Vec::new();
    let push = |t: (i32, i32), out: &mut Vec<(i32, i32)>| match out.iter().position(|&o| o == t) {
        Some(i) => out.truncate(i + 1),
        None => out.push(t),
    };
    for (i, w) in path.windows(2).enumerate() {
        let steps = (((w[1].0 - w[0].0).hypot(w[1].1 - w[0].1)) / 0.25).ceil().max(1.0) as usize;
        for s in (if i == 0 { 0 } else { 1 })..=steps {
            let t = s as f64 / steps as f64;
            let tile = ((w[0].0 + (w[1].0 - w[0].0) * t).floor() as i32, (w[0].1 + (w[1].1 - w[0].1) * t).floor() as i32);
            if let Some(&last) = out.last() {
                if last.0 != tile.0 && last.1 != tile.1 {
                    push((tile.0, last.1), &mut out); // a diagonal step goes through a corner tile
                }
            }
            push(tile, &mut out);
        }
    }
    if out.is_empty() {
        if let Some(p) = path.first() {
            out.push((p.0.floor() as i32, p.1.floor() as i32));
        }
    }
    debug_assert!(out.windows(2).all(|w| (w[0].0 - w[1].0).abs() + (w[0].1 - w[1].1).abs() == 1));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use std::collections::HashSet;

    fn blob(cx: f64, cy: f64, rx: f64, ry: f64) -> Blob {
        Blob { cx, cy, rx, ry }
    }

    #[test]
    fn one_blob_is_an_ellipse() {
        let b = [blob(20.0, 20.0, 6.0, 4.0)];
        assert!(inside(&b, 1, 20.0, 20.0) > 3.0);
        assert!(inside(&b, 1, 20.0 + 6.0 + 2.0, 20.0) < 0.0);
        assert!(inside(&b, 1, 20.0, 20.0 + 4.0 + 2.0) < 0.0);
    }

    #[test]
    fn tiles_are_one_piece() {
        let mut rng = ChaCha8Rng::seed_from_u64(7);
        for seed in 0..200u32 {
            let mut blobs = vec![blob(50.0, 50.0, rng.gen_range(3.0..8.0), rng.gen_range(3.0..8.0))];
            for _ in 0..rng.gen_range(1..4) {
                let p = &blobs[blobs.len() - 1];
                let (a, r) = (rng.gen_range(0.0..std::f64::consts::TAU), rng.gen_range(0.0..0.7));
                let (cx, cy) = (p.cx + a.cos() * p.rx * r, p.cy + a.sin() * p.ry * r);
                blobs.push(blob(cx, cy, rng.gen_range(3.0..8.0), rng.gen_range(3.0..8.0)));
            }
            let tiles = blob_tiles(&blobs, seed);
            let set: HashSet<(i32, i32)> = tiles.iter().map(|t| (t.0, t.1)).collect();
            let mut seen = HashSet::new();
            let mut stack = vec![(tiles[0].0, tiles[0].1)];
            while let Some(c) = stack.pop() {
                if !set.contains(&c) || !seen.insert(c) {
                    continue;
                }
                stack.extend([(c.0 + 1, c.1), (c.0 - 1, c.1), (c.0, c.1 + 1), (c.0, c.1 - 1)]);
            }
            assert_eq!(seen.len(), set.len(), "seed {seed}");
        }
    }

    #[test]
    fn deep_is_ringed_by_shallow() {
        let tiles = blob_tiles(&[blob(30.0, 30.0, 9.0, 7.0), blob(36.0, 32.0, 6.0, 6.0)], 3);
        let water: HashSet<(i32, i32)> = tiles.iter().map(|t| (t.0, t.1)).collect();
        assert!(tiles.iter().any(|t| t.2 == Tile::DeepWater));
        for &(x, y, t) in &tiles {
            if t == Tile::DeepWater {
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        assert!(water.contains(&(x + dx, y + dy)));
                    }
                }
            }
        }
    }

    #[test]
    fn a_small_blob_is_all_shallow() {
        for seed in 0..100 {
            for c in [10.0, 10.5] {
                let tiles = blob_tiles(&[blob(c, c, 1.5, 1.5)], seed);
                assert!(!tiles.is_empty());
                assert!(tiles.iter().all(|t| t.2 == Tile::ShallowWater), "seed {seed} at {c}");
            }
        }
    }

    #[test]
    fn path_tiles_are_4_connected_and_end_at_both_ends() {
        for seed in 0..20 {
            let mut rng = ChaCha8Rng::seed_from_u64(seed);
            for (from, to, first, last) in [((3.2, 4.7), (40.5, 22.1), (3, 4), (40, 22)), ((10.4, 3.1), (12.7, 45.9), (10, 3), (12, 45))] {
                let tiles = path_tiles(&winding_path(&mut rng, from, to));
                assert_eq!(tiles[0], first);
                assert_eq!(*tiles.last().unwrap(), last);
                for w in tiles.windows(2) {
                    assert_eq!((w[0].0 - w[1].0).abs() + (w[0].1 - w[1].1).abs(), 1, "{w:?}");
                }
                assert_eq!(tiles.len(), tiles.iter().collect::<HashSet<_>>().len());
            }
        }
    }

    #[test]
    fn winding_path_stays_within_reach() {
        let mut rng = ChaCha8Rng::seed_from_u64(2);
        let (from, to) = ((5.0, 5.0), (45.0, 25.0));
        let (dx, dy): (f64, f64) = (to.0 - from.0, to.1 - from.1);
        let len = (dx * dx + dy * dy).sqrt();
        let path = winding_path(&mut rng, from, to);
        assert_eq!((path[0], *path.last().unwrap()), (from, to));
        for p in &path {
            let off = ((p.0 - from.0) * dy - (p.1 - from.1) * dx).abs() / len;
            assert!(off <= 1.5 + 1e-9, "{off}");
        }
    }

    #[test]
    fn same_seed_same_shape() {
        let b = [blob(20.0, 20.0, 6.0, 4.0)];
        assert_eq!(blob_tiles(&b, 9), blob_tiles(&b, 9));
        assert_ne!(blob_tiles(&b, 9), blob_tiles(&b, 10));
    }
}
