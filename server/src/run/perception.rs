//! One perception rule for every creature: within vision, in line of sight, and lit or within darkvision.
use super::Run;
use crate::collision::line_of_sight;
use crate::defs::races::Sight;
use crate::dungeon::Map;
use crate::math::{angle_diff, Vec2};

/// Whether `tile` is within darkvision `range` (tiles) of the viewer's tile. Range 0 is no darkvision at all.
pub fn dark_reach(viewer: (i32, i32), tile: (i32, i32), range: f64) -> bool {
    let (dx, dy) = ((tile.0 - viewer.0) as f64, (tile.1 - viewer.1) as f64);
    range > 0.0 && dx * dx + dy * dy <= range * range
}

/// Anything closer than this (px) is felt whatever the direction.
pub const FELT_PX: f64 = 1.0;

/// Whether `to` lies within a cone of `cone_deg` (full angle) around `dir` (rad) seen from `from`. A cone of 360 or
/// more sees all round, and anything closer than `FELT_PX` is within it.
pub fn in_cone(cone_deg: f64, dir: f64, from: Vec2, to: Vec2) -> bool {
    cone_deg >= 360.0 || from.dist(to) < FELT_PX || angle_diff(from.angle_to(to), dir).abs() <= cone_deg.to_radians() / 2.0
}

/// What `sees` was before facing: range, line of sight and light, all round. Needs `Run::refresh_lights` this tick
/// (`Run::step` does it before the AI).
pub fn in_open(run: &Run, sight: Sight, from: Vec2, to: Vec2) -> bool {
    let d = from.dist(to);
    if d > sight.vision_px() || !line_of_sight(&run.layout.map, from, to) {
        return false;
    }
    let (x, y) = Map::tile_of(to);
    run.lights.lit(x, y) || d <= sight.vision_px() * sight.darkvision
}

/// Whether a creature at `from` looking along `dir` (rad) sees `to`: in the open and in its cone.
pub fn sees(run: &Run, sight: Sight, from: Vec2, dir: f64, to: Vec2) -> bool {
    in_open(run, sight, from, to) && in_cone(sight.cone, dir, from, to)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dungeon::TILE;
    use crate::defs::lights::LightKind;
    use crate::dungeon::Tile;
    use crate::protocol::{BossId, ClassId};
    use crate::run::light::{Anchor, Lights};
    use crate::run::tests::test_run;

    /// An open 15x9 floor patch around the hero, no lights at all, only the boss left.
    fn dark_run() -> (Run, i32, i32) {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 4..=ty + 4 {
            for x in tx - 7..=tx + 7 {
                run.layout.map.set(x, y, Tile::Floor);
            }
        }
        run.lights = Lights::new(run.layout.map.w, run.layout.map.h);
        run.refresh_lights();
        (run, tx, ty)
    }

    fn at(x: i32, y: i32) -> Vec2 {
        Map::center_of(x, y)
    }

    #[test]
    fn a_human_does_not_see_a_dark_hero_until_a_torch_lights_them() {
        let (mut run, tx, ty) = dark_run();
        let human = Sight { vision: 9.0, darkvision: 0.0, cone: 360.0, neck: 0.0 };
        assert!(!in_open(&run, human, at(tx - 3, ty), at(tx, ty)));
        run.add_light(LightKind::Torch, Anchor::Tile(tx, ty), None);
        run.refresh_lights();
        assert!(in_open(&run, human, at(tx - 3, ty), at(tx, ty)));
    }

    /// Crystals are the only light in rock, and a broken one leaves it dark: bosses see there all the same.
    #[test]
    fn every_boss_sees_in_full_darkness() {
        for id in BossId::ALL {
            assert_eq!(crate::defs::bosses::profile(id).sight.darkvision, 1.0, "{id:?}");
        }
    }

    #[test]
    fn a_monster_sees_a_dark_hero_at_two_tiles_not_four() {
        let (run, tx, ty) = dark_run();
        let monster = Sight { vision: 8.0, darkvision: 1.0 / 3.0, cone: 360.0, neck: 0.0 };
        assert!(in_open(&run, monster, at(tx - 2, ty), at(tx, ty)));
        assert!(!in_open(&run, monster, at(tx - 4, ty), at(tx, ty)));
    }

    #[test]
    fn undead_see_a_dark_hero_at_full_vision() {
        let (run, tx, ty) = dark_run();
        let undead = Sight { vision: 6.0, darkvision: 1.0, cone: 360.0, neck: 0.0 };
        assert!(in_open(&run, undead, at(tx - 5, ty), at(tx, ty)));
        assert!(!in_open(&run, undead, at(tx - 7, ty), at(tx, ty)), "beyond vision, on carved floor");
    }

    #[test]
    fn objects_see_nothing() {
        let (run, tx, ty) = dark_run();
        assert!(!sees(&run, Sight::NONE, at(tx, ty) + Vec2::new(TILE * 0.5, 0.0), 0.0, at(tx, ty)));
    }

    #[test]
    fn walls_still_block() {
        let (mut run, tx, ty) = dark_run();
        for y in ty - 4..=ty + 4 {
            run.layout.map.set(tx - 1, y, Tile::Wall);
        }
        run.lights.fill();
        let undead = Sight { vision: 8.0, darkvision: 1.0, cone: 360.0, neck: 0.0 };
        assert!(!in_open(&run, undead, at(tx - 3, ty), at(tx, ty)));
    }

    /// A lit run (the boss's torch-free hall is dark, so light it) and a hero at (tx, ty).
    fn lit_run() -> (Run, i32, i32) {
        let (mut run, tx, ty) = dark_run();
        run.lights.fill();
        (run, tx, ty)
    }

    const DEG: f64 = std::f64::consts::PI / 180.0;
    fn seer(cone: f64) -> Sight {
        Sight { vision: 12.0, darkvision: 1.0, cone, neck: 80.0 }
    }
    /// The hero stands `deg` degrees off the viewer's `dir` (rad), 3 tiles away.
    fn off(tx: i32, ty: i32, dir: f64, deg: f64) -> (Vec2, Vec2) {
        let from = at(tx, ty);
        (from, from + Vec2::from_angle(dir + deg * DEG) * (TILE * 3.0))
    }

    #[test]
    fn a_hero_behind_is_not_seen() {
        let (run, tx, ty) = lit_run();
        let (from, to) = off(tx, ty, 0.0, 180.0);
        assert!(!sees(&run, seer(150.0), from, 0.0, to));
        assert!(in_open(&run, seer(150.0), from, to));
    }

    #[test]
    fn a_hero_at_the_cone_edge() {
        let (run, tx, ty) = lit_run();
        let (from, near) = off(tx, ty, 0.0, 74.0);
        assert!(sees(&run, seer(150.0), from, 0.0, near));
        let (_, far) = off(tx, ty, 0.0, 76.0);
        assert!(!sees(&run, seer(150.0), from, 0.0, far));
    }

    #[test]
    fn wil_widens_the_cone() {
        use crate::defs::attributes::Attributes;
        let a = |w| Attributes::new(10, 10, 10, 10, w, 10);
        let (run, tx, ty) = lit_run();
        let (from, to) = off(tx, ty, 0.0, 100.0);
        assert!(sees(&run, seer(150.0).widened(&a(20)), from, 0.0, to));
        assert!(!sees(&run, seer(150.0).widened(&a(10)), from, 0.0, to));
        assert_eq!(seer(150.0).widened(&a(10)).cone, 150.0);
        assert_eq!(seer(180.0).widened(&a(40)).cone, 360.0, "capped at all round");
    }

    #[test]
    fn the_cone_sits_on_the_gaze() {
        let (mut run, tx, ty) = lit_run();
        run.monsters[0].aim = 0.0;
        run.monsters[0].gaze = 80.0 * DEG;
        let dir = run.monsters[0].gaze_dir();
        let (from, behind_left) = off(tx, ty, 0.0, 150.0);
        assert!(sees(&run, seer(150.0), from, dir, behind_left), "150 off the body, 70 off the gaze");
        let (_, other_side) = off(tx, ty, 0.0, -80.0);
        assert!(!sees(&run, seer(150.0), from, dir, other_side), "80 off the body the other way is 160 off the gaze");
    }

    #[test]
    fn a_hero_with_more_wil_sees_wider() {
        use crate::defs::attributes::{Attr, BASELINE};
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        let base = run.players[0].sight_now().cone;
        run.players[0].sheet.attrs.add(Attr::Wil, 10);
        let wil = run.players[0].sheet.attrs.get(Attr::Wil);
        assert!(wil > BASELINE);
        assert!(run.players[0].sight_now().cone > base, "WIL {wil}");
    }

    #[test]
    fn a_360_cone_sees_all_round() {
        let (run, tx, ty) = lit_run();
        for deg in [0.0, 90.0, 180.0, -90.0] {
            let (from, to) = off(tx, ty, 0.0, deg);
            assert!(sees(&run, seer(360.0), from, 0.0, to), "{deg}");
        }
    }
}
