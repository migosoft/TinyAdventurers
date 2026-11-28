//! The stone layout of a level (#380): one stone kind per map cell. Crystals (instead of
//! torches in rock) read the kinds, and the client gets them in `RunStartInfo.stone` for its stonework.

use super::generate::{bfs, regions};
use super::{Dungeon, Map, Rect, Tile, TorchSpawn, WallLight, TILE};
use crate::collision::line_of_sight;
use crate::defs::lights::{def, LightKind};
use crate::math::Vec2;
use rand::{RngExt, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::collections::VecDeque;

/// Stone kind: masonry of laid blocks.
pub const LAID: u8 = 0;
/// Stone kind: natural rock.
pub const ROCK: u8 = 1;
/// Mixed into the seed for the stone's own random stream ("STONE").
pub const STONE_SALT: u64 = 0x53_544f_4e45;
/// A `Zones` level has this many zones at least and at most.
const MIN_ZONES: usize = 2;
const MAX_ZONES: usize = 3;

/// How a level's stone is laid out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoneLayout {
    /// All masonry.
    Laid,
    /// All natural rock.
    Rock,
    /// Two or three zones of both kinds, by distance from the start room.
    Zones,
}

/// A cell that is neither wall nor void: floor, doors, terrain.
fn is_open(map: &Map, x: i32, y: i32) -> bool {
    let t = map.get(x, y);
    t != Tile::Wall as u8 && t != Tile::Void as u8
}

/// Each room's depth: the path distance of its centre from the start room's centre. A centre that
/// is not safe ground (a pool in the middle) has none, so the room's smallest reachable depth counts.
fn room_depths(d: &Dungeon) -> Vec<i32> {
    let map = &d.map;
    let (sx, sy) = d.rooms[d.start].rect.center();
    let dists = bfs(map, sx, sy);
    let depth_of = |r: &Rect| {
        let (cx, cy) = r.center();
        let at = dists[(cy * map.w + cx) as usize];
        if at >= 0 {
            return at;
        }
        (r.y..r.y + r.h).flat_map(|y| (r.x..r.x + r.w).map(move |x| (x, y))).map(|(x, y)| dists[(y * map.w + x) as usize]).filter(|&v| v >= 0).min().unwrap_or(0)
    };
    d.rooms.iter().map(|r| depth_of(&r.rect)).collect()
}

/// Share of the regions (rooms and corridor stretches) whose rock is lit by torches, not crystals (a first guess for the balancing pass).
pub const ROCK_TORCH_SHARE: f64 = 1.0 / 3.0;
/// Mixed into the seed for the cave choice's own random stream ("CAVE").
pub const CAVE_SALT: u64 = 0x43_4156_45;

/// Every region is a crystal cave or, with `ROCK_TORCH_SHARE`, a torch cave. In rock a lit torch of
/// a crystal cave becomes a crystal, and a torch of a torch cave or an unlit one (a sunlit room) stays;
/// then no rock torch stays within a crystal's light. The start room and the boss hall keep a light:
/// one that lost its lit rock torches becomes a crystal cave.
pub fn crystals(seed: u64, d: &mut Dungeon) {
    let (region, count) = regions(&d.map, &d.rooms);
    let mut rng = ChaCha8Rng::seed_from_u64(seed ^ CAVE_SALT);
    let mut torch_cave: Vec<bool> = (0..count).map(|_| rng.random_bool(ROCK_TORCH_SHARE)).collect();
    let (w, reach) = (d.map.w, f64::from(def(LightKind::Crystal).radius) * TILE);
    let input = std::mem::take(&mut d.torches);
    let region_of = |t: &TorchSpawn| region[(t.front().1 * w + t.front().0) as usize];
    let in_rock = |t: &TorchSpawn| d.stone[(t.front().1 * w + t.front().0) as usize] == ROCK;
    loop {
        let mut out = input.clone();
        out.iter_mut().filter(|t| t.lit && in_rock(t) && !torch_cave[region_of(t)]).for_each(|t| t.kind = WallLight::Crystal);
        let crystals: Vec<Vec2> = out.iter().filter(|t| t.kind == WallLight::Crystal).map(|t| Map::center_of(t.front().0, t.front().1)).collect();
        out.retain(|t| {
            let a = Map::center_of(t.front().0, t.front().1);
            t.kind == WallLight::Crystal || !in_rock(t) || !crystals.iter().any(|&b| (a.x - b.x).hypot(a.y - b.y) <= reach && line_of_sight(&d.map, a, b))
        });
        let bare: Vec<usize> = [d.start, d.boss]
            .into_iter()
            .filter(|&ri| torch_cave[ri] && input.iter().any(|t| t.lit && in_rock(t) && region_of(t) == ri) && !out.iter().any(|t| region_of(t) == ri))
            .collect();
        if bare.is_empty() {
            d.torches = out;
            return;
        }
        bare.into_iter().for_each(|ri| torch_cave[ri] = false);
    }
}

/// One kind per cell, row-major, `map.w * map.h` long.
pub fn lay(seed: u64, layout: StoneLayout, d: &Dungeon) -> Vec<u8> {
    let map = &d.map;
    let len = (map.w * map.h) as usize;
    match layout {
        StoneLayout::Laid => return vec![LAID; len],
        StoneLayout::Rock => return vec![ROCK; len],
        StoneLayout::Zones => {}
    }
    let mut rng = ChaCha8Rng::seed_from_u64(seed ^ STONE_SALT);
    let n = rng.random_range(MIN_ZONES..=MAX_ZONES);
    let first = rng.random_range(0..2usize);

    let depths = room_depths(d);
    let max = depths.iter().copied().max().unwrap_or(0) as usize;

    const NONE: u8 = u8::MAX;
    let mut kinds = vec![NONE; len];
    let idx = |x: i32, y: i32| (y * map.w + x) as usize;
    let mut queue = VecDeque::new();
    // Rooms: the kind of the zone their depth falls in; they seed the corridor walk in index order.
    for (room, &depth) in d.rooms.iter().zip(&depths) {
        let zone = (n - 1).min(depth as usize * n / (max + 1));
        let kind = ((first + zone) % 2) as u8;
        let r = &room.rect;
        for y in r.y..r.y + r.h {
            for x in r.x..r.x + r.w {
                if map.in_bounds(x, y) && kinds[idx(x, y)] == NONE {
                    kinds[idx(x, y)] = kind;
                    queue.push_back((x, y));
                }
            }
        }
    }
    // Corridors: open cells outside every room take the kind of the room that reaches them first.
    while let Some((x, y)) = queue.pop_front() {
        let kind = kinds[idx(x, y)];
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let (nx, ny) = (x + dx, y + dy);
            if map.in_bounds(nx, ny) && is_open(map, nx, ny) && kinds[idx(nx, ny)] == NONE {
                kinds[idx(nx, ny)] = kind;
                queue.push_back((nx, ny));
            }
        }
    }
    // Walls and void: the kind of the open cell that reaches them first, a wall's own open
    // neighbours (4 sides) before a diagonal one.
    for y in 0..map.h {
        for x in 0..map.w {
            if kinds[idx(x, y)] != NONE {
                queue.push_back((x, y));
            }
        }
    }
    for (x, y) in queue.clone() {
        let kind = kinds[idx(x, y)];
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let (nx, ny) = (x + dx, y + dy);
            if map.in_bounds(nx, ny) && kinds[idx(nx, ny)] == NONE {
                kinds[idx(nx, ny)] = kind;
                queue.push_back((nx, ny));
            }
        }
    }
    while let Some((x, y)) = queue.pop_front() {
        let kind = kinds[idx(x, y)];
        for dy in -1..=1 {
            for dx in -1..=1 {
                let (nx, ny) = (x + dx, y + dy);
                if map.in_bounds(nx, ny) && kinds[idx(nx, ny)] == NONE {
                    kinds[idx(nx, ny)] = kind;
                    queue.push_back((nx, ny));
                }
            }
        }
    }
    // Only a map with no open cell at all is left unfilled.
    kinds.iter_mut().filter(|k| **k == NONE).for_each(|k| *k = LAID);
    kinds
}

#[cfg(test)]
mod tests {
    use super::super::generate::{generate, regions, Theme};
    use super::super::{Room, RoomKind, TorchSpawn, WallLight};
    use super::*;

    const SEEDS: u64 = 40;

    fn each_dungeon(mut f: impl FnMut(u64, &Dungeon)) {
        for seed in 0..SEEDS {
            for theme in [Theme::WATER, Theme::LAVA] {
                f(seed, &generate(seed, theme));
            }
        }
    }

    fn seeds_and_themes() -> impl Iterator<Item = (u64, Theme)> {
        (0..SEEDS).flat_map(|seed| [Theme::WATER, Theme::LAVA].map(|theme| (seed, theme)))
    }

    fn zones(seed: u64, theme: Theme) -> Dungeon {
        generate(seed, Theme { stone: StoneLayout::Zones, ..theme })
    }

    fn of_layout(seed: u64, theme: Theme, stone: StoneLayout) -> Dungeon {
        generate(seed, Theme { stone, ..theme })
    }

    fn is_rock(d: &Dungeon, t: &TorchSpawn) -> bool {
        let (fx, fy) = t.front();
        d.stone[(fy * d.map.w + fx) as usize] == ROCK
    }

    fn room_has_sun(d: &Dungeon, r: &Room) -> bool {
        d.suns.iter().any(|&(sx, sy)| r.rect.contains_tile(sx, sy))
    }

    #[test]
    fn rock_has_crystal_caves_and_torch_caves() {
        let (mut crystals_seen, mut rock_torches_seen) = (0, 0);
        for (seed, theme) in seeds_and_themes() {
            for t in &of_layout(seed, theme, StoneLayout::Laid).torches {
                assert_eq!(t.kind, WallLight::Torch, "seed {seed} Laid");
            }
            let z = zones(seed, theme);
            for t in z.torches.iter().filter(|t| !is_rock(&z, t)) {
                assert_eq!(t.kind, WallLight::Torch, "seed {seed} Zones: laid stone");
            }
            let d = of_layout(seed, theme, StoneLayout::Rock);
            crystals_seen += d.torches.iter().filter(|t| t.kind == WallLight::Crystal).count();
            rock_torches_seen += d.torches.iter().filter(|t| t.kind == WallLight::Torch && t.lit).count();
        }
        assert!(crystals_seen > 100 && rock_torches_seen > 100, "{crystals_seen} crystals, {rock_torches_seen} lit rock torches");
    }

    #[test]
    fn no_region_has_both() {
        for (seed, theme) in seeds_and_themes() {
            let d = of_layout(seed, theme, StoneLayout::Rock);
            let (region, count) = regions(&d.map, &d.rooms);
            let mut crystal = vec![false; count];
            let mut torch = vec![false; count];
            for t in d.torches.iter().filter(|t| t.lit) {
                let (fx, fy) = t.front();
                let ri = region[(fy * d.map.w + fx) as usize];
                if t.kind == WallLight::Crystal { crystal[ri] = true } else { torch[ri] = true }
            }
            assert!((0..count).all(|ri| !(crystal[ri] && torch[ri])), "seed {seed}: a region with both");
        }
    }

    #[test]
    fn no_rock_torch_hangs_in_a_crystals_light() {
        let reach = f64::from(crate::defs::lights::def(crate::defs::lights::LightKind::Crystal).radius);
        for (seed, theme) in seeds_and_themes() {
            for layout in [StoneLayout::Rock, StoneLayout::Zones] {
                let d = of_layout(seed, theme, layout);
                for t in d.torches.iter().filter(|t| t.kind == WallLight::Torch && is_rock(&d, t)) {
                    let a = Map::center_of(t.front().0, t.front().1);
                    for c in d.torches.iter().filter(|c| c.kind == WallLight::Crystal) {
                        let b = Map::center_of(c.front().0, c.front().1);
                        let lit = (a.x - b.x).hypot(a.y - b.y) <= reach * super::super::TILE && crate::collision::line_of_sight(&d.map, a, b);
                        assert!(!lit, "seed {seed} {layout:?}: torch {:?} in the light of crystal {:?}", t.wall, c.wall);
                    }
                }
            }
        }
    }

    #[test]
    fn sunlit_rock_rooms_keep_unlit_torches_and_get_no_crystal() {
        let mut unlit_seen = 0;
        for (seed, theme) in seeds_and_themes() {
            let d = of_layout(seed, theme, StoneLayout::Rock);
            for t in &d.torches {
                let (fx, fy) = t.front();
                let sunlit = d.rooms.iter().any(|r| r.rect.contains_tile(fx, fy) && room_has_sun(&d, r));
                assert!(!(sunlit && t.kind == WallLight::Crystal), "seed {seed}: crystal at {:?} in a sunlit room", t.wall);
                if !t.lit {
                    assert_eq!(t.kind, WallLight::Torch, "seed {seed}");
                    unlit_seen += 1;
                }
            }
        }
        assert!(unlit_seen > 0, "the seeds hold unlit rock torches");
    }

    #[test]
    fn wall_lights_sit_where_the_laid_torches_are() {
        for (seed, theme) in seeds_and_themes() {
            let laid: Vec<_> = of_layout(seed, theme, StoneLayout::Laid).torches.iter().map(|t| (t.wall, t.side)).collect();
            for t in &of_layout(seed, theme, StoneLayout::Rock).torches {
                assert!(laid.contains(&(t.wall, t.side)), "seed {seed}: {:?}", t.wall);
            }
        }
    }

    #[test]
    fn start_room_and_boss_hall_keep_a_light() {
        for (seed, theme) in seeds_and_themes() {
            for layout in [StoneLayout::Laid, StoneLayout::Rock, StoneLayout::Zones] {
                let d = of_layout(seed, theme, layout);
                for ri in [d.start, d.boss] {
                    let r = &d.rooms[ri];
                    let lit = d.torches.iter().any(|t| t.lit && r.rect.contains_tile(t.front().0, t.front().1));
                    assert!(lit || room_has_sun(&d, r), "seed {seed} {layout:?}: room {ri} has no light");
                }
            }
        }
        // Seed 156 hits step 4: its start room's torch cave lost every lit rock torch to a crystal's light, so it flips to a crystal cave. (Was 109 before rand 0.10 changed the stream, #445; found by scanning seeds for a torch-cave start room that ends with a crystal and no lit torch.)
        let d = of_layout(156, Theme::WATER, StoneLayout::Rock);
        let start = &d.rooms[d.start].rect;
        let fronting: Vec<_> = d.torches.iter().filter(|t| start.contains_tile(t.front().0, t.front().1)).collect();
        assert!(fronting.iter().any(|t| t.kind == WallLight::Crystal), "the start room has a crystal");
        assert!(!fronting.iter().any(|t| t.kind == WallLight::Torch && t.lit), "and no lit rock torch");
    }

    #[test]
    fn the_cave_choice_has_its_own_stream() {
        for seed in 0..5 {
            let (a, b) = (of_layout(seed, Theme::WATER, StoneLayout::Rock), of_layout(seed, Theme::WATER, StoneLayout::Laid));
            assert_eq!(a.map.tiles, b.map.tiles, "seed {seed}");
            assert_eq!(a.spawns.len(), b.spawns.len());
            assert!(a.spawns.iter().zip(&b.spawns).all(|(p, q)| p.enemy == q.enemy && p.pos == q.pos), "seed {seed}: spawns");
            assert_eq!(a.chests.len(), b.chests.len());
            assert!(a.chests.iter().zip(&b.chests).all(|(p, q)| p.pos == q.pos && p.mimic == q.mimic), "seed {seed}: chests");
            assert_eq!(a.barrels, b.barrels, "seed {seed}");
            let c = of_layout(seed, Theme::WATER, StoneLayout::Rock);
            assert_eq!(a.torches.iter().map(|t| (t.wall, t.side, t.lit, t.kind)).collect::<Vec<_>>(), c.torches.iter().map(|t| (t.wall, t.side, t.lit, t.kind)).collect::<Vec<_>>(), "seed {seed}: generate is deterministic");
            assert_eq!(a.stone, c.stone, "seed {seed}: stone");
        }
    }

    #[test]
    fn laid_and_rock_fill_the_map() {
        each_dungeon(|seed, d| {
            for (layout, kind) in [(StoneLayout::Laid, LAID), (StoneLayout::Rock, ROCK)] {
                let s = lay(seed, layout, d);
                assert_eq!(s.len(), (d.map.w * d.map.h) as usize);
                assert!(s.iter().all(|&k| k == kind), "seed {seed} {layout:?}");
            }
        });
    }

    #[test]
    fn generate_stores_the_stone_of_its_theme() {
        let d = generate(5, Theme { stone: StoneLayout::Rock, ..Theme::WATER });
        assert_eq!(d.stone.len(), (d.map.w * d.map.h) as usize);
        assert!(d.stone.iter().all(|&k| k == ROCK));
    }

    #[test]
    fn zones_keep_rooms_whole() {
        for (seed, theme) in seeds_and_themes() {
            let d = zones(seed, theme);
            for r in d.rooms.iter().map(|r| &r.rect) {
                let kind = d.stone[(r.y * d.map.w + r.x) as usize];
                for y in r.y..r.y + r.h {
                    for x in r.x..r.x + r.w {
                        assert_eq!(d.stone[(y * d.map.w + x) as usize], kind, "seed {seed}: room {r:?} at {x},{y}");
                    }
                }
            }
        }
    }

    #[test]
    fn zones_have_both_kinds_and_two_or_three_bands() {
        for seed in 0..SEEDS {
            for theme in [Theme::WATER, Theme::LAVA] {
                let d = zones(seed, theme);
                assert!(d.stone.contains(&LAID) && d.stone.contains(&ROCK), "seed {seed}: both kinds");
                let mut rooms: Vec<(i32, u8)> = room_depths(&d).into_iter().zip(&d.rooms).map(|(depth, r)| (depth, d.stone[(r.rect.y * d.map.w + r.rect.x) as usize])).collect();
                rooms.sort_by_key(|&(depth, _)| depth);
                let changes = rooms.windows(2).filter(|w| w[0].1 != w[1].1).count();
                assert!(changes <= 2, "seed {seed}: kinds by depth {rooms:?}");
            }
        }
    }

    #[test]
    fn zone_borders_lie_in_corridors() {
        for (seed, theme) in seeds_and_themes() {
            let d = zones(seed, theme);
            let in_room = |x: i32, y: i32| d.rooms.iter().any(|r| r.rect.contains_tile(x, y));
            for y in 0..d.map.h {
                for x in 0..d.map.w {
                    for (nx, ny) in [(x + 1, y), (x, y + 1)] {
                        if !d.map.in_bounds(nx, ny) || !is_open(&d.map, x, y) || !is_open(&d.map, nx, ny) {
                            continue;
                        }
                        if d.stone[(y * d.map.w + x) as usize] != d.stone[(ny * d.map.w + nx) as usize] {
                            assert!(!in_room(x, y) && !in_room(nx, ny), "seed {seed}: border {x},{y} / {nx},{ny} touches a room");
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn walls_take_the_kind_of_the_ground_they_border() {
        let mut checked = 0;
        for (seed, theme) in seeds_and_themes() {
            let d = zones(seed, theme);
            for y in 0..d.map.h {
                for x in 0..d.map.w {
                    if d.map.get(x, y) != Tile::Wall as u8 {
                        continue;
                    }
                    let open: Vec<(i32, i32)> = [(1, 0), (-1, 0), (0, 1), (0, -1)].iter().map(|&(dx, dy)| (x + dx, y + dy)).filter(|&(nx, ny)| is_open(&d.map, nx, ny)).collect();
                    if let [(nx, ny)] = open[..] {
                        assert_eq!(d.stone[(y * d.map.w + x) as usize], d.stone[(ny * d.map.w + nx) as usize], "seed {seed}: wall {x},{y}");
                        checked += 1;
                    }
                }
            }
        }
        assert!(checked > 1000, "{checked} walls checked");
    }

    #[test]
    fn stone_comes_from_its_own_stream() {
        for seed in 0..SEEDS {
            let (a, b) = (generate(seed, Theme { stone: StoneLayout::Zones, ..Theme::WATER }), generate(seed, Theme::WATER));
            assert_eq!(a.map.tiles, b.map.tiles, "seed {seed}");
            assert_eq!(a.spawns.len(), b.spawns.len());
            assert!(a.spawns.iter().zip(&b.spawns).all(|(p, q)| p.enemy == q.enemy && p.pos == q.pos), "seed {seed}: spawns");
            assert_eq!(a.chests.len(), b.chests.len());
            assert!(a.chests.iter().zip(&b.chests).all(|(p, q)| p.pos == q.pos && p.mimic == q.mimic), "seed {seed}: chests");
            assert_eq!(a.barrels, b.barrels, "seed {seed}");
            assert_eq!(a.suns, b.suns, "seed {seed}");
            assert_eq!(a.haunts, b.haunts, "seed {seed}");
            assert_eq!(a.player_spawns, b.player_spawns, "seed {seed}");
        }
    }

    #[test]
    fn lay_is_deterministic() {
        let d = zones(3, Theme::WATER);
        assert_eq!(lay(3, StoneLayout::Zones, &d), lay(3, StoneLayout::Zones, &d));
        let distinct: std::collections::HashSet<Vec<u8>> = (1..=SEEDS).map(|seed| lay(seed, StoneLayout::Zones, &d)).collect();
        assert!(distinct.len() >= 2, "the seed decides the zones");
    }

    /// The start room in the middle, a room on each side at the same depth, each joined by a one-cell corridor.
    #[test]
    fn a_dungeon_with_one_depth_band_still_gets_kinds() {
        let mut map = Map::new(25, 7);
        let rects = [Rect { x: 9, y: 1, w: 5, h: 5 }, Rect { x: 1, y: 1, w: 5, h: 5 }, Rect { x: 17, y: 1, w: 5, h: 5 }];
        for r in &rects {
            for y in r.y..r.y + r.h {
                for x in r.x..r.x + r.w {
                    map.set(x, y, Tile::Floor);
                }
            }
        }
        for x in [6, 14] {
            map.set(x, 3, Tile::Floor);
            map.set(x + 1, 3, Tile::Floor);
        }
        let rooms = vec![Room { rect: rects[0].clone(), kind: RoomKind::Start }, Room { rect: rects[1].clone(), kind: RoomKind::Room }, Room { rect: rects[2].clone(), kind: RoomKind::Boss }];
        let d = Dungeon { map, rooms, start: 0, boss: 2, door: vec![], spawns: vec![], chests: vec![], barrels: vec![], torches: vec![], suns: vec![], player_spawns: vec![], haunts: vec![], cove: None, stone: vec![] };
        let depths = room_depths(&d);
        assert_eq!(depths[1], depths[2], "equal depth");
        for seed in 0..SEEDS {
            let s = lay(seed, StoneLayout::Zones, &d);
            assert_eq!(s.len(), 25 * 7);
            assert!(s.iter().all(|&k| k == LAID || k == ROCK));
            assert_eq!(s, lay(seed, StoneLayout::Zones, &d), "deterministic");
            // The two side rooms share a depth, so they share a kind.
            assert_eq!(s[(3 * 25 + 3) as usize], s[(3 * 25 + 19) as usize]);
        }
    }

    /// Only the start room: no other depth at all (`max == 0`).
    #[test]
    fn a_dungeon_with_only_the_start_room_still_gets_kinds() {
        let mut map = Map::new(9, 9);
        let r = Rect { x: 2, y: 2, w: 5, h: 5 };
        for y in r.y..r.y + r.h {
            for x in r.x..r.x + r.w {
                map.set(x, y, Tile::Floor);
            }
        }
        let d = Dungeon { map, rooms: vec![Room { rect: r, kind: RoomKind::Start }], start: 0, boss: 0, door: vec![], spawns: vec![], chests: vec![], barrels: vec![], torches: vec![], suns: vec![], player_spawns: vec![], haunts: vec![], cove: None, stone: vec![] };
        for seed in 0..SEEDS {
            let s = lay(seed, StoneLayout::Zones, &d);
            assert_eq!(s.len(), 81);
            assert!(s.iter().all(|&k| k == LAID || k == ROCK));
            assert!(s.iter().all(|&k| k == s[40]), "one room, one kind, walls included");
            assert_eq!(s, lay(seed, StoneLayout::Zones, &d), "deterministic");
        }
    }
}
