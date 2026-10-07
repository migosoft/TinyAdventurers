//! Movement against the tile grid. Mirrored exactly by
//! `client/src/sim/collision.ts` (checked with shared test fixtures), so the
//! client can predict its own movement.

use crate::dungeon::{Map, TILE};
use crate::math::Vec2;

const EPS: f64 = 0.001;

/// Move a figure (treated as a square of half-size `r` against tiles) by
/// (dx, dy), axis by axis, sliding along walls. `dx`/`dy` must be < 1 tile.
pub fn move_box(map: &Map, x: f64, y: f64, dx: f64, dy: f64, r: f64) -> (f64, f64) {
    let mut nx = x + dx;
    if dx != 0.0 {
        let top = ((y - r) / TILE).floor() as i32;
        let bot = ((y + r - EPS) / TILE).floor() as i32;
        if dx > 0.0 {
            let tx = ((nx + r - EPS) / TILE).floor() as i32;
            if (top..=bot).any(|ty| map.solid(tx, ty)) {
                nx = tx as f64 * TILE - r;
            }
        } else {
            let tx = ((nx - r) / TILE).floor() as i32;
            if (top..=bot).any(|ty| map.solid(tx, ty)) {
                nx = (tx + 1) as f64 * TILE + r;
            }
        }
    }
    let mut ny = y + dy;
    if dy != 0.0 {
        let left = ((nx - r) / TILE).floor() as i32;
        let right = ((nx + r - EPS) / TILE).floor() as i32;
        if dy > 0.0 {
            let ty = ((ny + r - EPS) / TILE).floor() as i32;
            if (left..=right).any(|tx| map.solid(tx, ty)) {
                ny = ty as f64 * TILE - r;
            }
        } else {
            let ty = ((ny - r) / TILE).floor() as i32;
            if (left..=right).any(|tx| map.solid(tx, ty)) {
                ny = (ty + 1) as f64 * TILE + r;
            }
        }
    }
    (nx, ny)
}

/// Player movement for one fixed step. Shared with the client predictor.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MoveState {
    pub x: f64,
    pub y: f64,
    pub dash_t: f64,
    pub dash_dx: f64,
    pub dash_dy: f64,
}

pub fn step_move(map: &Map, s: &MoveState, mx: i8, my: i8, speed: f64, dash_speed: f64, r: f64, dt: f64) -> MoveState {
    let mut n = *s;
    let (vx, vy) = if n.dash_t > 0.0 {
        n.dash_t = (n.dash_t - dt).max(0.0);
        (n.dash_dx * dash_speed, n.dash_dy * dash_speed)
    } else {
        let (fx, fy) = (mx as f64, my as f64);
        let l = (fx * fx + fy * fy).sqrt();
        if l > 0.0 {
            (fx / l * speed, fy / l * speed)
        } else {
            (0.0, 0.0)
        }
    };
    let (x, y) = move_box(map, n.x, n.y, vx * dt, vy * dt, r);
    n.x = x;
    n.y = y;
    n
}

/// True if a straight line between two points crosses no solid tile.
pub fn line_of_sight(map: &Map, a: Vec2, b: Vec2) -> bool {
    let d = b - a;
    let len = d.len();
    let steps = (len / 4.0).ceil().max(1.0) as i32;
    for i in 1..steps {
        let t = i as f64 / steps as f64;
        if map.solid_at(a + d * t) {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dungeon::Tile;

    fn room() -> Map {
        let mut m = Map::new(10, 10);
        for y in 1..9 {
            for x in 1..9 {
                m.set(x, y, Tile::Floor);
            }
        }
        m
    }

    #[test]
    fn cannot_tunnel_into_walls() {
        let m = room();
        let mut s = MoveState { x: 40.0, y: 40.0, dash_t: 0.0, dash_dx: 0.0, dash_dy: 0.0 };
        for _ in 0..600 {
            s = step_move(&m, &s, 1, 1, 70.0, 300.0, 5.0, 1.0 / 60.0);
        }
        // Ends flush against the bottom-right corner walls.
        assert!((s.x - (9.0 * TILE - 5.0)).abs() < 1e-9);
        assert!((s.y - (9.0 * TILE - 5.0)).abs() < 1e-9);
        assert!(!m.solid_at(Vec2::new(s.x + 4.9, s.y + 4.9)));
        // Dash into a wall also stops.
        let mut d = MoveState { x: 40.0, y: 40.0, dash_t: 2.0, dash_dx: -1.0, dash_dy: 0.0 };
        for _ in 0..120 {
            d = step_move(&m, &d, 0, 0, 70.0, 300.0, 5.0, 1.0 / 60.0);
        }
        assert!((d.x - (16.0 + 5.0)).abs() < 1e-9);
    }

    #[test]
    fn los_blocked_by_wall() {
        let mut m = room();
        m.set(5, 3, Tile::Wall);
        m.set(5, 4, Tile::Wall);
        m.set(5, 5, Tile::Wall);
        assert!(!line_of_sight(&m, Map::center_of(3, 4), Map::center_of(7, 4)));
        assert!(line_of_sight(&m, Map::center_of(3, 7), Map::center_of(7, 7)));
    }
}
