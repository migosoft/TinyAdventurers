//! Field of vision via recursive shadowcasting. Mirrored by
//! `client/src/sim/fov.ts` (checked with shared test fixtures).

use crate::dungeon::Map;

const MULT: [[i32; 8]; 4] = [
    [1, 0, 0, -1, -1, 0, 0, 1],
    [0, 1, -1, 0, 0, -1, 1, 0],
    [0, 1, 1, 0, 0, -1, -1, 0],
    [1, 0, 0, 1, -1, 0, 0, -1],
];

/// Reusable visibility buffer: `stamp[i] == gen` means tile i is visible.
pub struct Fov {
    pub w: i32,
    pub h: i32,
    stamp: Vec<u32>,
    gen: u32,
}

impl Fov {
    pub fn new(w: i32, h: i32) -> Self {
        Fov { w, h, stamp: vec![0; (w * h) as usize], gen: 0 }
    }

    pub fn is_visible(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.w && y < self.h && self.stamp[(y * self.w + x) as usize] == self.gen
    }

    fn mark(&mut self, x: i32, y: i32) {
        if x >= 0 && y >= 0 && x < self.w && y < self.h {
            let g = self.gen;
            self.stamp[(y * self.w + x) as usize] = g;
        }
    }

    pub fn compute(&mut self, map: &Map, cx: i32, cy: i32, radius: i32) {
        self.gen = self.gen.wrapping_add(1).max(1);
        self.mark(cx, cy);
        for oct in 0..8 {
            self.cast(map, cx, cy, 1, 1.0, 0.0, radius, MULT[0][oct], MULT[1][oct], MULT[2][oct], MULT[3][oct]);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn cast(&mut self, map: &Map, cx: i32, cy: i32, row: i32, mut start: f64, end: f64, radius: i32, xx: i32, xy: i32, yx: i32, yy: i32) {
        if start < end {
            return;
        }
        let r2 = radius * radius;
        let mut new_start = 0.0;
        for j in row..=radius {
            let mut dx = -j - 1;
            let dy = -j;
            let mut blocked = false;
            while dx <= 0 {
                dx += 1;
                let x = cx + dx * xx + dy * xy;
                let y = cy + dx * yx + dy * yy;
                let l_slope = (dx as f64 - 0.5) / (dy as f64 + 0.5);
                let r_slope = (dx as f64 + 0.5) / (dy as f64 - 0.5);
                if start < r_slope {
                    continue;
                } else if end > l_slope {
                    break;
                }
                if dx * dx + dy * dy <= r2 {
                    self.mark(x, y);
                }
                let opaque = map.opaque(x, y);
                if blocked {
                    if opaque {
                        new_start = r_slope;
                        continue;
                    } else {
                        blocked = false;
                        start = new_start;
                    }
                } else if opaque && j < radius {
                    blocked = true;
                    self.cast(map, cx, cy, j + 1, start, l_slope, radius, xx, xy, yx, yy);
                    new_start = r_slope;
                }
            }
            if blocked {
                break;
            }
        }
    }
}

pub const PLAYER_FOV_RADIUS: i32 = 9;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dungeon::Tile;

    #[test]
    fn walls_block_vision() {
        let mut m = Map::new(20, 20);
        for y in 1..19 {
            for x in 1..19 {
                m.set(x, y, Tile::Floor);
            }
        }
        for y in 1..19 {
            m.set(10, y, Tile::Wall);
        }
        let mut f = Fov::new(20, 20);
        f.compute(&m, 5, 10, 9);
        assert!(f.is_visible(5, 10));
        assert!(f.is_visible(9, 10));
        assert!(f.is_visible(10, 10), "the wall itself is seen");
        assert!(!f.is_visible(12, 10), "behind the wall is hidden");
        // Radius limit.
        let mut open = Map::new(40, 40);
        for y in 0..40 {
            for x in 0..40 {
                open.set(x, y, Tile::Floor);
            }
        }
        let mut f2 = Fov::new(40, 40);
        f2.compute(&open, 20, 20, 9);
        assert!(f2.is_visible(29, 20));
        assert!(!f2.is_visible(30, 20));
    }
}
