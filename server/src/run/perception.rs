//! One perception rule for every creature: within vision, in line of sight, and lit or within darkvision.
use super::Run;
use crate::collision::line_of_sight;
use crate::defs::entity_types::Sight;
use crate::dungeon::Map;
use crate::math::Vec2;

/// Needs `Run::refresh_lights` this tick (`Run::step` does it before the AI).
pub fn sees(run: &Run, sight: Sight, from: Vec2, to: Vec2) -> bool {
    let d = from.dist(to);
    if d > sight.vision_px() || !line_of_sight(&run.layout.map, from, to) {
        return false;
    }
    let (x, y) = Map::tile_of(to);
    run.lights.lit(x, y) || d <= sight.vision_px() * sight.darkvision
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
        let human = Sight { vision: 9.0, darkvision: 0.0 };
        assert!(!sees(&run, human, at(tx - 3, ty), at(tx, ty)));
        run.add_light(LightKind::Torch, Anchor::Tile(tx, ty), None);
        run.refresh_lights();
        assert!(sees(&run, human, at(tx - 3, ty), at(tx, ty)));
    }

    #[test]
    fn a_monster_sees_a_dark_hero_at_two_tiles_not_four() {
        let (run, tx, ty) = dark_run();
        let monster = Sight { vision: 8.0, darkvision: 1.0 / 3.0 };
        assert!(sees(&run, monster, at(tx - 2, ty), at(tx, ty)));
        assert!(!sees(&run, monster, at(tx - 4, ty), at(tx, ty)));
    }

    #[test]
    fn undead_see_a_dark_hero_at_full_vision() {
        let (run, tx, ty) = dark_run();
        let undead = Sight { vision: 6.0, darkvision: 1.0 };
        assert!(sees(&run, undead, at(tx - 5, ty), at(tx, ty)));
        assert!(!sees(&run, undead, at(tx - 7, ty), at(tx, ty)), "beyond vision, on carved floor");
    }

    #[test]
    fn objects_see_nothing() {
        let (run, tx, ty) = dark_run();
        assert!(!sees(&run, Sight::NONE, at(tx, ty) + Vec2::new(TILE * 0.5, 0.0), at(tx, ty)));
    }

    #[test]
    fn walls_still_block() {
        let (mut run, tx, ty) = dark_run();
        for y in ty - 4..=ty + 4 {
            run.layout.map.set(tx - 1, y, Tile::Wall);
        }
        run.lights.fill();
        let undead = Sight { vision: 8.0, darkvision: 1.0 };
        assert!(!sees(&run, undead, at(tx - 3, ty), at(tx, ty)));
    }
}
