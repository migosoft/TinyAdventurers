pub mod cove;
pub mod generate;
pub mod stone;
pub mod water_shapes;
pub mod woodland;

use crate::defs::enemies::EnemyType;
use crate::math::Vec2;

pub const TILE: f64 = 16.0;
/// Speed multipliers on terrain (tuned in the balancing pass).
pub const SHALLOW_SPEED: f64 = 0.7;
pub const LAVA_SPEED: f64 = 0.4;
/// Lava burns heroes for this much every `LAVA_TICK` seconds (20/s).
pub const LAVA_DAMAGE: f64 = 10.0;
pub const LAVA_TICK: f64 = 0.5;
/// Seconds from stepping into a chasm (or ending a dash over deep water) to death.
pub const FALL_TIME: f64 = 0.7;
/// Barrels only: how long a barrel takes to sink in deep water. A hero or monster drowns by breath (`BREATH`).
pub const DROWN_TIME: f64 = 0.9;
/// Seconds in deep water until the head is under (balancing pass).
pub const HEAD_UNDER: f64 = 1.2;
/// Total seconds in deep water before drowning, at baseline CON (balancing pass).
pub const BREATH: f64 = 2.2;
/// Change of that breath per CON point, through `factor` (balancing pass).
pub const BREATH_PCT: f64 = 0.10;
/// Swimming speed with the head above water (balancing pass).
pub const SWIM_SPEED: f64 = SHALLOW_SPEED;
/// Speed with the head under water (balancing pass).
pub const UNDER_SPEED: f64 = SHALLOW_SPEED * 0.5;

/// Is the head under water after `t` seconds in deep water?
pub fn head_under(t: f64) -> bool {
    t >= HEAD_UNDER
}

/// Factor on walking speed for the time `t` in deep water: slower once the head is under.
pub fn under_factor(t: f64) -> f64 {
    if head_under(t) {
        UNDER_SPEED / SWIM_SPEED
    } else {
        1.0
    }
}

/// Seconds in deep water before a creature of this CON drowns (infinite when breathless).
pub fn breath(con: i32, breathless: bool) -> f64 {
    if breathless {
        f64::INFINITY
    } else {
        BREATH * crate::defs::attributes::factor(con, BREATH_PCT)
    }
}

/// Does this tile start the water clock of a walker? Here only deep water, and not mid-dash. #346's Swim trait plugs in here (and in `drowningTile` in `client/src/sim/map.ts`).
pub fn drowning_tile(t: u8, dashing: bool) -> bool {
    !dashing && t == Tile::DeepWater as u8
}

/// Water, chasm or lava.
pub fn is_terrain(t: u8) -> bool {
    (Tile::ShallowWater as u8..=Tile::Lava as u8).contains(&t)
}

crate::defs::enum_list::listed_enum! {
/// Tile values sent to the client (one byte each).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tile: u8 {
    Void = 0,
    Floor = 1,
    Wall = 2,
    DoorOpen = 3,
    DoorClosed = 4,
    /// Slows everyone; enemies wade too.
    ShallowWater = 5,
    /// Blocks walking; a hero whose dash ends here drowns.
    DeepWater = 6,
    /// Heroes who step in fall to their death; enemies avoid it.
    Chasm = 7,
    /// Slows and burns heroes; only demon types walk it unharmed.
    Lava = 8,
    /// A tree trunk (the nymph's cove, the woodland): blocks walking and dashing (ghosts pass), sight and
    /// shots like a column. Light passes (`hard_opaque` is false; see #257).
    Trunk = 9,
    /// A dirt road: open ground, like floor.
    Road = 10,
    /// A dense hedge of undergrowth: a wall that blocks sight and shots but not light.
    Thicket = 11,
    /// An invisible wall (#259): the end of the playable part of an open map (the woodland road runs on past it).
    /// Drawn as the open ground beside it; blocks every mover, phasers too, like the map's edge; sight, light and
    /// shots pass.
    Barrier = 12,
}
}

/// Which tiles stop a sight line: every opaque tile, or only the hard ones (light passes trunks and thickets).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Blocker {
    All,
    Hard,
}

/// Who is moving. The walking rules (`Map::blocks`) differ per mover.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mover {
    Hero,
    Enemy,
    /// A walker that can enter deep water but must not stop in it (monsters that may swim for a while).
    Breathless,
    /// Imps, chorts, summoners and the demon boss: lava does not stop them.
    Demon,
    /// A hero mid-dash: jumps deep water, chasms and lava.
    Dash,
    /// Ghosts and shades (the phasing trait): drift through walls and solid objects and float over
    /// terrain. Only Void and the edge of the map stop them; they may not rest inside a wall (`can_stop`).
    Incorporeal,
}

impl Mover {
    /// The mover of a monster: its traits decide (a phantom floats, a breathless one wades), then its lava-walking.
    pub fn of_creature(traits: crate::defs::races::Traits, demon: bool) -> Mover {
        if traits.phasing {
            Mover::Incorporeal
        } else if traits.breathless {
            Mover::Breathless
        } else if demon {
            Mover::Demon
        } else {
            Mover::Enemy
        }
    }
}

#[derive(Debug, Clone)]
pub struct Map {
    pub w: i32,
    pub h: i32,
    pub tiles: Vec<u8>,
    /// Counts the tiles changed by `set`: a cache of something derived from the tiles (a view, wall edges) is current while it matches.
    pub rev: u32,
}

impl Map {
    pub fn new(w: i32, h: i32) -> Self {
        Map { w, h, tiles: vec![Tile::Void as u8; (w * h) as usize], rev: 0 }
    }
    pub fn in_bounds(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.w && y < self.h
    }
    pub fn get(&self, x: i32, y: i32) -> u8 {
        if self.in_bounds(x, y) {
            self.tiles[(y * self.w + x) as usize]
        } else {
            Tile::Void as u8
        }
    }
    pub fn set(&mut self, x: i32, y: i32, t: Tile) {
        if self.in_bounds(x, y) {
            self.tiles[(y * self.w + x) as usize] = t as u8;
            self.rev = self.rev.wrapping_add(1);
        }
    }
    /// Blocks sight and projectiles (trunks and thickets too). Floor, roads, open doors, terrain and barriers do not.
    pub fn opaque(&self, x: i32, y: i32) -> bool {
        let t = self.get(x, y);
        !(t == Tile::Floor as u8 || t == Tile::DoorOpen as u8 || t == Tile::Road as u8 || t == Tile::Barrier as u8 || is_terrain(t))
    }
    /// Blocks light as well: opaque, except trunks and thickets (light passes them).
    pub fn hard_opaque(&self, x: i32, y: i32) -> bool {
        let t = self.get(x, y);
        self.opaque(x, y) && t != Tile::Trunk as u8 && t != Tile::Thicket as u8
    }
    pub fn blocks_sight(&self, x: i32, y: i32, b: Blocker) -> bool {
        match b {
            Blocker::All => self.opaque(x, y),
            Blocker::Hard => self.hard_opaque(x, y),
        }
    }
    pub fn opaque_at(&self, p: Vec2) -> bool {
        let (x, y) = Map::tile_of(p);
        self.opaque(x, y)
    }
    /// Blocks walking for this mover. Mirrored in `client/src/sim/map.ts`, except `Mover::Incorporeal`, which is
    /// server-only (client prediction uses movers for heroes only).
    pub fn blocks(&self, x: i32, y: i32, mover: Mover) -> bool {
        if self.get(x, y) == Tile::Barrier as u8 {
            return true;
        }
        if mover == Mover::Incorporeal {
            return self.get(x, y) == Tile::Void as u8;
        }
        if self.opaque(x, y) {
            return true;
        }
        Map::terrain_blocks(self.get(x, y), mover)
    }
    /// The movement rules for terrain: the terrain a walker of this kind cannot enter. A hero is blocked by no terrain (a chasm or deep water is deadly to it but not blocked); monsters are blocked by what would kill or hurt them.
    pub fn terrain_blocks(t: u8, mover: Mover) -> bool {
        match mover {
            Mover::Dash | Mover::Incorporeal => false,
            Mover::Hero => false,
            Mover::Breathless => t == Tile::Chasm as u8 || t == Tile::Lava as u8,
            Mover::Demon => t == Tile::DeepWater as u8 || t == Tile::Chasm as u8,
            Mover::Enemy => t == Tile::DeepWater as u8 || t == Tile::Chasm as u8 || t == Tile::Lava as u8,
        }
    }
    /// May this mover stop (rest, wait, attack) on this tile? A phasing mover may pass through walls
    /// and closed doors but not stay in them; it may hover over a chasm, deep water or lava.
    /// For everyone else it is the same as not being blocked.
    pub fn can_stop(&self, x: i32, y: i32, mover: Mover) -> bool {
        if mover == Mover::Incorporeal {
            // Whatever a dash may cross is passable for a phaser too, so a solid tile added later
            // (columns) is passed but never a resting place.
            return !self.blocks(x, y, Mover::Dash) && self.get(x, y) != Tile::Void as u8;
        }
        if mover == Mover::Breathless && self.get(x, y) == Tile::DeepWater as u8 {
            return false;
        }
        !self.blocks(x, y, mover)
    }
    pub fn can_stop_at(&self, p: Vec2, mover: Mover) -> bool {
        let (x, y) = Map::tile_of(p);
        self.can_stop(x, y, mover)
    }
    pub fn blocks_at(&self, p: Vec2, mover: Mover) -> bool {
        let (x, y) = Map::tile_of(p);
        self.blocks(x, y, mover)
    }
    /// Ground a hero can stand on without harm: floor, roads, open doors and shallow water.
    pub fn safe(&self, x: i32, y: i32) -> bool {
        let t = self.get(x, y);
        t == Tile::Floor as u8 || t == Tile::DoorOpen as u8 || t == Tile::Road as u8 || t == Tile::ShallowWater as u8
    }
    pub fn tile_at(&self, p: Vec2) -> u8 {
        let (x, y) = Map::tile_of(p);
        self.get(x, y)
    }
    /// Walking speed multiplier on this tile (a dash and a phantom ignore terrain).
    pub fn speed_factor(&self, p: Vec2, mover: Mover) -> f64 {
        let t = self.tile_at(p);
        if mover == Mover::Dash || mover == Mover::Incorporeal {
            1.0
        } else if t == Tile::ShallowWater as u8 {
            SHALLOW_SPEED
        } else if t == Tile::DeepWater as u8 {
            SWIM_SPEED
        } else if t == Tile::Lava as u8 && mover != Mover::Demon {
            LAVA_SPEED
        } else {
            1.0
        }
    }
    pub fn tile_of(p: Vec2) -> (i32, i32) {
        ((p.x / TILE).floor() as i32, (p.y / TILE).floor() as i32)
    }
    pub fn center_of(x: i32, y: i32) -> Vec2 {
        Vec2::new((x as f64 + 0.5) * TILE, (y as f64 + 0.5) * TILE)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub fn center(&self) -> (i32, i32) {
        (self.x + self.w / 2, self.y + self.h / 2)
    }
    pub fn intersects(&self, o: &Rect, pad: i32) -> bool {
        self.x - pad < o.x + o.w && o.x - pad < self.x + self.w && self.y - pad < o.y + o.h && o.y - pad < self.y + self.h
    }
    pub fn contains_tile(&self, x: i32, y: i32) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.w && y < self.y + self.h
    }
    pub fn contains(&self, p: Vec2) -> bool {
        let (x, y) = Map::tile_of(p);
        self.contains_tile(x, y)
    }
    pub fn center_px(&self) -> Vec2 {
        Vec2::new((self.x as f64 + self.w as f64 / 2.0) * TILE, (self.y as f64 + self.h as f64 / 2.0) * TILE)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoomKind {
    Start,
    Room,
    Hall,
    Boss,
    /// The nymph's cove: a sunlit room with a big tree (`cove.rs`).
    Cove,
}

/// The nymph's cove (#202): the room's floor rect (after rotation), the trunk tile, and the seed
/// the client's `covemath` plants and pixies grow from (1..=1_000_000).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cove {
    pub rect: Rect,
    pub tree: (i32, i32),
    pub seed: u32,
}

#[derive(Debug, Clone)]
pub struct Room {
    pub rect: Rect,
    pub kind: RoomKind,
}

#[derive(Debug, Clone)]
pub struct Spawn {
    pub enemy: EnemyType,
    pub pos: Vec2,
}

/// A treasure chest, or a mimic disguised as one.
#[derive(Debug, Clone)]
pub struct ChestSpawn {
    pub pos: Vec2,
    pub mimic: bool,
}

/// Where a torch hangs, seen from the floor it lights.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum TorchSide {
    /// On a brick face: the floor is below the wall cell.
    Face = 0,
    /// On a wall west of the floor (the floor is at x + 1).
    West = 1,
    /// On a wall east of the floor (the floor is at x - 1).
    East = 2,
}

/// What hangs on a wall cell: a torch in masonry, a crystal cluster in rock.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WallLight {
    Torch,
    Crystal,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TorchSpawn {
    /// The wall cell it hangs on.
    pub wall: (i32, i32),
    pub side: TorchSide,
    /// Starts burning. False in a sunlit room (the daylight is enough); heat lights it.
    pub lit: bool,
    /// A torch, or a crystal in rock (`stone::crystals`).
    pub kind: WallLight,
}

impl TorchSpawn {
    /// The floor tile in front of it: its light starts there.
    pub fn front(&self) -> (i32, i32) {
        let (x, y) = self.wall;
        match self.side {
            TorchSide::Face => (x, y + 1),
            TorchSide::West => (x + 1, y),
            TorchSide::East => (x - 1, y),
        }
    }
    /// Its position (px): on the wall's edge, just inside the floor tile.
    pub fn pos(&self) -> Vec2 {
        let (x, y) = (self.wall.0 as f64, self.wall.1 as f64);
        match self.side {
            TorchSide::Face => Vec2::new((x + 0.5) * TILE, (y + 1.0) * TILE + 0.5),
            TorchSide::West => Vec2::new((x + 1.0) * TILE + 0.5, (y + 0.5) * TILE),
            TorchSide::East => Vec2::new(x * TILE - 0.5, (y + 0.5) * TILE),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Dungeon {
    pub map: Map,
    pub rooms: Vec<Room>,
    pub start: usize,
    pub boss: usize,
    /// Door tiles between the boss hall and its corridor.
    pub door: Vec<(i32, i32)>,
    pub spawns: Vec<Spawn>,
    pub chests: Vec<ChestSpawn>,
    /// Explosive barrels (tile centres).
    pub barrels: Vec<Vec2>,
    /// Wall torches (placed after rotation).
    pub torches: Vec<TorchSpawn>,
    /// Sun spots (tiles): each becomes a Daylight light (`Run::add_sun`).
    pub suns: Vec<(i32, i32)>,
    pub player_spawns: Vec<Vec2>,
    /// Where a boss's haunt (`enemies::haunt_for`) appears: rare extra spawns on their own random
    /// stream, so the map and the usual spawns of a seed stay as they are.
    pub haunts: Vec<Vec2>,
    /// The nymph's cove (always `Some` from `generate`).
    pub cove: Option<Cove>,
    /// One stone kind per cell (`stone::LAID`, `stone::ROCK`), row-major, `map.w * map.h` long (`stone::lay`).
    pub stone: Vec<u8>,
}

impl Dungeon {
    #[cfg(test)]
    pub fn boss_hall(&self) -> &Rect {
        &self.rooms[self.boss].rect
    }
}

/// The map data every level type shares; `Run` only knows this.
#[derive(Debug, Clone)]
pub struct Layout {
    pub map: Map,
    pub spawns: Vec<Spawn>,
    pub chests: Vec<ChestSpawn>,
    /// Explosive barrels (tile centres).
    pub barrels: Vec<Vec2>,
    /// Wall torches (placed after rotation).
    pub torches: Vec<TorchSpawn>,
    /// Sun spots (tiles): each becomes a Daylight light (`Run::add_sun`).
    pub suns: Vec<(i32, i32)>,
    pub player_spawns: Vec<Vec2>,
    /// The nymph's cove; other level types have none.
    pub cove: Option<Cove>,
    /// Open-air level (the woodland): lit by day, no dungeon darkness.
    pub daylight: bool,
    /// The woodland's plants, start and end; other level types have none.
    pub woodland: Option<woodland::Woodland>,
    /// One stone kind per cell like `Dungeon::stone`; empty for the woodland and the test levels.
    pub stone: Vec<u8>,
}

/// What only the room-and-corridor dungeon has.
#[derive(Debug, Clone)]
pub struct DungeonParts {
    pub rooms: Vec<Room>,
    pub start: usize,
    pub boss: usize,
    /// Door tiles between the boss hall and its corridor.
    pub door: Vec<(i32, i32)>,
    /// See `Dungeon::haunts`.
    pub haunts: Vec<Vec2>,
}

impl DungeonParts {
    pub fn boss_hall(&self) -> &Rect {
        &self.rooms[self.boss].rect
    }
}

impl Dungeon {
    pub fn split(self) -> (Layout, DungeonParts) {
        let Dungeon { map, rooms, start, boss, door, spawns, chests, barrels, torches, suns, player_spawns, haunts, cove, stone } = self;
        (Layout { map, spawns, chests, barrels, torches, suns, player_spawns, cove, daylight: false, woodland: None, stone }, DungeonParts { rooms, start, boss, door, haunts })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every `Tile`. `Tile` has no list of its own: the match stops compiling when a variant is added, and the
    /// array must then get it too, so no test using this list can skip the new tile.
    fn all_tiles() -> [Tile; 13] {
        fn listed(t: Tile) {
            match t {
                Tile::Void | Tile::Floor | Tile::Wall | Tile::DoorOpen | Tile::DoorClosed | Tile::ShallowWater | Tile::DeepWater | Tile::Chasm | Tile::Lava | Tile::Trunk | Tile::Road | Tile::Thicket | Tile::Barrier => {}
            }
        }
        let all = [Tile::Void, Tile::Floor, Tile::Wall, Tile::DoorOpen, Tile::DoorClosed, Tile::ShallowWater, Tile::DeepWater, Tile::Chasm, Tile::Lava, Tile::Trunk, Tile::Road, Tile::Thicket, Tile::Barrier];
        all.iter().for_each(|&t| listed(t));
        all
    }

    #[test]
    fn can_stop_follows_dash_blocking() {
        let all = all_tiles();
        let mut m = Map::new(all.len() as i32, 3);
        for (x, t) in all.into_iter().enumerate() {
            m.set(x as i32, 1, t);
        }
        for (x, t) in all.into_iter().enumerate() {
            let x = x as i32;
            assert_eq!(m.can_stop(x, 1, Mover::Incorporeal), !m.blocks(x, 1, Mover::Dash) && t != Tile::Void, "{t:?}");
        }
    }

    #[test]
    fn trunk_blocks_heroes_dashes_and_enemies_but_not_ghosts() {
        let mut m = Map::new(3, 3);
        m.set(1, 1, Tile::Trunk);
        assert!(m.opaque(1, 1) && !m.hard_opaque(1, 1));
        for mover in [Mover::Hero, Mover::Enemy, Mover::Demon, Mover::Dash] {
            assert!(m.blocks(1, 1, mover), "{mover:?}");
            assert!(!m.can_stop(1, 1, mover), "{mover:?}");
        }
        assert!(!m.blocks(1, 1, Mover::Incorporeal));
        assert!(!m.can_stop(1, 1, Mover::Incorporeal), "a ghost may not rest in the trunk");
        assert!(!m.safe(1, 1));
        assert!(!is_terrain(Tile::Trunk as u8));
    }

    #[test]
    fn breathless_swims_through_deep_water_but_never_rests_in_it() {
        let mut m = Map::new(5, 1);
        for (x, t) in [Tile::Floor, Tile::DeepWater, Tile::Chasm, Tile::Lava, Tile::ShallowWater].into_iter().enumerate() {
            m.set(x as i32, 0, t);
        }
        assert!(!m.blocks(1, 0, Mover::Breathless) && !m.can_stop(1, 0, Mover::Breathless));
        assert!(m.blocks(2, 0, Mover::Breathless) && m.blocks(3, 0, Mover::Breathless));
        assert!(m.can_stop(4, 0, Mover::Breathless));
        assert_eq!(m.speed_factor(Map::center_of(1, 0), Mover::Breathless), SWIM_SPEED);
        for mover in [Mover::Hero, Mover::Enemy, Mover::Demon] {
            assert_eq!(m.speed_factor(Map::center_of(1, 0), mover), SWIM_SPEED, "{mover:?}");
        }
        for t in 0..=Tile::Lava as u8 {
            assert!(!Map::terrain_blocks(t, Mover::Hero), "a hero is blocked by no terrain: {t}");
        }
        assert!(under_factor(HEAD_UNDER) < 1.0 && under_factor(HEAD_UNDER - 0.01) == 1.0);
    }

    #[test]
    fn road_is_ground_and_thicket_is_a_wall() {
        let mut m = Map::new(3, 3);
        m.set(0, 1, Tile::Road);
        m.set(2, 1, Tile::Thicket);
        assert!(!m.opaque(0, 1) && m.safe(0, 1));
        assert_eq!(m.speed_factor(Map::center_of(0, 1), Mover::Hero), 1.0);
        assert!(m.opaque(2, 1) && !m.hard_opaque(2, 1) && !m.safe(2, 1));
        for mover in [Mover::Hero, Mover::Enemy, Mover::Demon, Mover::Dash] {
            assert!(!m.blocks(0, 1, mover), "road {mover:?}");
            assert!(m.blocks(2, 1, mover), "thicket {mover:?}");
        }
    }

    #[test]
    fn barrier_stops_every_mover_but_not_sight_or_light() {
        let mut m = Map::new(3, 3);
        m.set(1, 1, Tile::Barrier);
        assert!(!m.opaque(1, 1) && !m.hard_opaque(1, 1), "sight, light and shots pass");
        for mover in [Mover::Hero, Mover::Enemy, Mover::Demon, Mover::Dash, Mover::Incorporeal] {
            assert!(m.blocks(1, 1, mover), "{mover:?}");
            assert!(!m.can_stop(1, 1, mover), "{mover:?}");
        }
        assert!(!m.safe(1, 1));
        assert!(!is_terrain(Tile::Barrier as u8));
    }

    #[test]
    fn hard_opaque_is_the_old_rule() {
        let all = all_tiles();
        let mut m = Map::new(all.len() as i32, 1);
        for (x, t) in all.into_iter().enumerate() {
            m.set(x as i32, 0, t);
        }
        for (x, t) in all.into_iter().enumerate() {
            let x = x as i32;
            if t == Tile::Trunk || t == Tile::Thicket {
                assert!(m.opaque(x, 0) && !m.hard_opaque(x, 0), "{t:?}");
            } else {
                assert_eq!(m.hard_opaque(x, 0), m.opaque(x, 0), "{t:?}");
            }
        }
    }

    #[test]
    fn incorporeal_moves_through_walls_and_over_terrain() {
        let mut m = Map::new(8, 3);
        let row = [Tile::Wall, Tile::DoorClosed, Tile::DeepWater, Tile::Chasm, Tile::Lava, Tile::ShallowWater, Tile::Floor];
        for (x, t) in row.into_iter().enumerate() {
            m.set(x as i32, 1, t);
        }
        for x in 0..7 {
            assert!(!m.blocks(x, 1, Mover::Incorporeal), "tile {x}");
        }
        assert!(m.blocks(7, 1, Mover::Incorporeal), "Void blocks");
        assert!(m.blocks(-1, 1, Mover::Incorporeal), "outside the map blocks");
        assert_eq!(m.speed_factor(Map::center_of(5, 1), Mover::Incorporeal), 1.0);
        assert_eq!(m.speed_factor(Map::center_of(4, 1), Mover::Incorporeal), 1.0);
        assert!(!m.can_stop(0, 1, Mover::Incorporeal));
        assert!(!m.can_stop(1, 1, Mover::Incorporeal));
        assert!(!m.can_stop(7, 1, Mover::Incorporeal));
        for x in 2..7 {
            assert!(m.can_stop(x, 1, Mover::Incorporeal), "tile {x}");
        }
        assert!(m.can_stop(6, 1, Mover::Enemy) && !m.can_stop(0, 1, Mover::Enemy) && !m.can_stop(4, 1, Mover::Enemy));
    }
}
