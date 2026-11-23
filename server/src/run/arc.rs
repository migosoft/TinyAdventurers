//! The arc of a weapon shot (#321): it leaves the hand at `SHOT_HEIGHT`, rises and falls under
//! `GRAVITY` and lands on the ground at the aimed point. The client's `sim/arc.ts` is the same maths.

use super::entities::{GRAVITY, SHOT_HEIGHT};
use crate::math::Vec2;

/// Seconds a shot takes to cover `dist` at `speed` (the arc is flown at the ground speed).
pub fn flight_time(dist: f64, speed: f64) -> f64 {
    dist / speed
}

/// The shot's height above the ground `t` seconds into a flight of `flight` seconds: `SHOT_HEIGHT` at 0, 0 at `flight`.
pub fn shot_z(flight: f64, t: f64) -> f64 {
    let vz = (GRAVITY / 2.0 * flight * flight - SHOT_HEIGHT) / flight;
    SHOT_HEIGHT + vz * t - GRAVITY / 2.0 * t * t
}

/// Whether a shot at ground point `p`, height `z` touches a body: inside the radii and below the body's top.
pub fn arc_touches(body: Vec2, body_r: f64, top: f64, p: Vec2, z: f64, shot_r: f64) -> bool {
    p.dist(body) < body_r + shot_r && z < top
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_arc_matches_the_parity_table() {
        let near = |a: f64, b: f64| assert!((a - b).abs() < 1e-9, "{a} vs {b}");
        let t = flight_time(260.0, 290.0);
        near(shot_z(t, 0.0), 8.0);
        near(shot_z(t, 0.25), 31.631299734748005);
        near(shot_z(t, 0.5), 35.26259946949601);
        assert!(shot_z(t, t).abs() < 1e-9);
        near(shot_z(flight_time(72.0, 290.0), 0.1), 7.150191570881226);
        near(shot_z(flight_time(100.0, 200.0), 0.3), 12.8);
    }

    #[test]
    fn a_body_is_touched_only_below_its_top() {
        let b = Vec2::new(0.0, 0.0);
        assert!(arc_touches(b, 5.0, 20.0, Vec2::new(6.0, 0.0), 19.9, 3.0));
        assert!(!arc_touches(b, 5.0, 20.0, Vec2::new(6.0, 0.0), 20.0, 3.0));
        assert!(!arc_touches(b, 5.0, 20.0, Vec2::new(8.0, 0.0), 1.0, 3.0));
    }
}
