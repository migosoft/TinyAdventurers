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

/// Whether a shot touches a creature's hit cylinder (radius `hit_r`, height `top`): `z` is the shot's height, or
/// None for a flat shot, which meets the whole cylinder. The real flight and the dodge's replay share it.
pub fn shot_touches(z: Option<f64>, body: Vec2, hit_r: f64, top: f64, p: Vec2, shot_r: f64) -> bool {
    p.dist(body) < hit_r + shot_r && z.map_or(true, |z| z < top)
}

/// Whether an arc of `flight` seconds has landed after `flown` seconds.
pub fn has_landed(flight: f64, flown: f64) -> bool {
    flown >= flight - 1e-9
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

    #[test]
    fn the_hit_cylinder_matches_the_parity_table() {
        use crate::defs::{bosses, enemies::{self, EnemyType}};
        use crate::run::entities::{hit_radius, DRAGON_LIFT};
        use crate::protocol::BossId;
        // (radius, height of the top, point, shot height, hit)
        let g = (enemies::def(EnemyType::GoblinArcher).radius, EnemyType::GoblinArcher);
        let gk = enemies::def(g.1).kind;
        let ogre = enemies::def(EnemyType::Ogre);
        let fd = bosses::def(BossId::FireDemon);
        let dr = bosses::def(BossId::Dragon);
        let rows: [(f64, f64, (f64, f64), Option<f64>, bool); 13] = [
            (g.0, gk.body_height(), (8.9, 0.0), None, true),
            (g.0, gk.body_height(), (9.1, 0.0), None, false),
            (g.0, gk.body_height(), (0.0, -8.9), None, true),
            (g.0, gk.body_height(), (0.0, -9.1), None, false),
            (ogre.radius, ogre.kind.body_height(), (0.0, -12.9), None, true),
            (ogre.radius, ogre.kind.body_height(), (0.0, -18.0), None, false),
            (fd.radius, fd.kind.body_height(), (0.0, -45.0), None, false),
            (dr.radius, dr.kind.body_height() + DRAGON_LIFT, (0.0, -19.9), None, true),
            (dr.radius, dr.kind.body_height() + DRAGON_LIFT, (0.0, -50.0), None, false),
            (g.0, gk.body_height(), (5.0, 0.0), Some(9.9), true),
            (g.0, gk.body_height(), (5.0, 0.0), Some(10.0), false),
            (dr.radius, dr.kind.body_height() + DRAGON_LIFT, (19.9, 0.0), Some(67.9), true),
            (dr.radius, dr.kind.body_height() + DRAGON_LIFT, (19.9, 0.0), Some(68.0), false),
        ];
        for (i, (r, top, p, z, hit)) in rows.into_iter().enumerate() {
            assert_eq!(shot_touches(z, Vec2::new(0.0, 0.0), hit_radius(r), top, Vec2::new(p.0, p.1), 3.0), hit, "row {i}");
        }
    }
}
