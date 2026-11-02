//! The nymph's cove (#202): a dedicated 26x20 room in every dungeon, with a big tree in the middle
//! and five suns. `try_generate` places the room (stream 14); `finish_cove` runs after the rotation.

use super::generate::{sun_margins_ok, sun_tile_ok};
use super::{Cove, Dungeon, Rect, RoomKind, Tile};

/// Suns in the cove stay at least this far apart (tiles, Euclidean).
const COVE_SUN_GAP: f64 = 3.0;

/// The tile nearest to `(x, y)` in `r` that `ok` accepts (ties: lowest y, then x).
fn nearest(r: &Rect, x: i32, y: i32, ok: impl Fn(i32, i32) -> bool) -> Option<(i32, i32)> {
    (r.y..r.y + r.h)
        .flat_map(|ty| (r.x..r.x + r.w).map(move |tx| (tx, ty)))
        .filter(|&(tx, ty)| ok(tx, ty))
        .min_by_key(|&(tx, ty)| ((tx - x).pow(2) + (ty - y).pow(2), ty, tx))
}

/// Plant the trunk at the cove room's centre, give it its suns (the trunk tile first, then the
/// four quarter centres) and record `d.cove`. Call after the rotation and `place_suns`; `seed` was
/// drawn before the rotation.
pub fn finish_cove(d: &mut Dungeon, seed: u32) {
    let rect = d.rooms.iter().find(|r| r.kind == RoomKind::Cove).expect("a cove room").rect;
    let tree = (rect.x + rect.w / 2, rect.y + rect.h / 2);
    let mut suns: Vec<(i32, i32)> = Vec::new();
    // The sun on the trunk: the margins matter, the tile type does not (it becomes the trunk).
    let first = if sun_margins_ok(&rect, tree.0, tree.1) { Some(tree) } else { nearest(&rect, tree.0, tree.1, |x, y| sun_tile_ok(&d.map, &rect, x, y)) };
    suns.extend(first);
    for (fx, fy) in [(1, 1), (3, 1), (1, 3), (3, 3)] {
        let Some(p) = nearest(&rect, rect.x + rect.w * fx / 4, rect.y + rect.h * fy / 4, |x, y| sun_tile_ok(&d.map, &rect, x, y)) else { continue };
        let near = |s: &(i32, i32)| (((s.0 - p.0).pow(2) + (s.1 - p.1).pow(2)) as f64).sqrt() < COVE_SUN_GAP;
        if !suns.iter().any(near) {
            suns.push(p);
        }
    }
    d.map.set(tree.0, tree.1, Tile::Trunk);
    d.suns.extend(suns);
    d.cove = Some(Cove { rect, tree, seed });
}

#[cfg(test)]
mod tests {
    use super::super::generate::{bfs, generate, Theme, SIZE};
    use super::super::{is_terrain, Dungeon, Rect, RoomKind, Tile};
    use super::*;

    fn each_dungeon(seeds: u64, mut f: impl FnMut(u64, &Dungeon)) {
        for seed in 0..seeds {
            let theme = if seed % 2 == 0 { Theme::Water } else { Theme::Lava };
            f(seed, &generate(seed, theme));
        }
    }

    fn tiles_of(r: &Rect) -> impl Iterator<Item = (i32, i32)> {
        let r = *r;
        (r.y..r.y + r.h).flat_map(move |y| (r.x..r.x + r.w).map(move |x| (x, y)))
    }

    #[test]
    fn every_dungeon_has_one_cove_room() {
        each_dungeon(200, |seed, d| {
            let coves: Vec<_> = d.rooms.iter().filter(|r| r.kind == RoomKind::Cove).collect();
            assert_eq!(coves.len(), 1, "seed {seed}");
            let r = coves[0].rect;
            assert!((r.w, r.h) == (26, 20) || (r.w, r.h) == (20, 26), "seed {seed}: {r:?}");
            assert_eq!(d.cove.expect("cove").rect, r, "seed {seed}");
            assert!((1..=1_000_000).contains(&d.cove.unwrap().seed), "seed {seed}");
            assert!(!r.intersects(&d.rooms[d.start].rect, 0), "seed {seed}: on the start room");
            assert!(!r.intersects(d.boss_hall(), 0), "seed {seed}: on the boss hall");
        });
    }

    #[test]
    fn cove_room_is_clear() {
        each_dungeon(200, |seed, d| {
            let c = d.cove.unwrap();
            let trunks: Vec<_> = tiles_of(&c.rect).filter(|&(x, y)| d.map.get(x, y) == Tile::Trunk as u8).collect();
            assert_eq!(trunks, vec![(c.rect.x + c.rect.w / 2, c.rect.y + c.rect.h / 2)], "seed {seed}");
            assert_eq!(trunks[0], c.tree, "seed {seed}");
            assert!(tiles_of(&c.rect).all(|(x, y)| !is_terrain(d.map.get(x, y))), "seed {seed}: terrain in the cove");
            let inside = |p: crate::math::Vec2| c.rect.contains(p);
            assert!(d.spawns.iter().all(|s| !inside(s.pos)), "seed {seed}: spawn in the cove");
            assert!(d.chests.iter().all(|s| !inside(s.pos)), "seed {seed}: chest in the cove");
            assert!(d.barrels.iter().all(|&p| !inside(p)), "seed {seed}: barrel in the cove");
            assert!(d.haunts.iter().all(|&p| !inside(p)), "seed {seed}: haunt in the cove");
        });
    }

    #[test]
    fn cove_trunk_cuts_nothing_off() {
        each_dungeon(200, |seed, d| {
            let (tx, ty) = d.cove.unwrap().tree;
            for (dx, dy) in (-1..=1).flat_map(|dy| (-1..=1).map(move |dx| (dx, dy))).filter(|&p| p != (0, 0)) {
                assert!(d.map.safe(tx + dx, ty + dy), "seed {seed}: trunk neighbour {dx},{dy}");
            }
            let (sx, sy) = d.rooms[d.start].rect.center();
            let dist = bfs(&d.map, sx, sy);
            for y in 0..SIZE {
                for x in 0..SIZE {
                    assert!(!d.map.safe(x, y) || dist[(y * SIZE + x) as usize] >= 0, "seed {seed}: {x},{y} cut off");
                }
            }
        });
    }

    #[test]
    fn cove_has_its_suns() {
        each_dungeon(200, |seed, d| {
            let c = d.cove.unwrap();
            let mine: Vec<(i32, i32)> = d.suns.iter().copied().filter(|&(x, y)| c.rect.contains_tile(x, y)).collect();
            assert_eq!(mine.len(), 5, "seed {seed}");
            assert!(mine.contains(&c.tree), "seed {seed}: no sun on the trunk");
            for (i, &(x, y)) in mine.iter().enumerate() {
                if (x, y) != c.tree {
                    assert!(sun_tile_ok(&d.map, &c.rect, x, y), "seed {seed}: sun {x},{y}");
                }
                for &(ox, oy) in &mine[i + 1..] {
                    assert!((((x - ox).pow(2) + (y - oy).pow(2)) as f64).sqrt() >= 3.0, "seed {seed}: suns too close");
                }
            }
            for t in &d.torches {
                let (fx, fy) = t.front();
                assert!(!c.rect.contains_tile(fx, fy) || !t.lit, "seed {seed}: lit torch in the cove");
            }
        });
    }

    #[test]
    fn generation_still_succeeds() {
        each_dungeon(1000, |seed, d| assert!(d.rooms.len() >= 12, "seed {seed}"));
    }
}
