pub mod generate;

use crate::defs::enemies::EnemyType;
use crate::math::Vec2;

pub const TILE: f64 = 16.0;

/// Tile values sent to the client (one byte each).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Tile {
    Void = 0,
    Floor = 1,
    Wall = 2,
    DoorOpen = 3,
    DoorClosed = 4,
}

#[derive(Debug, Clone)]
pub struct Map {
    pub w: i32,
    pub h: i32,
    pub tiles: Vec<u8>,
}

impl Map {
    pub fn new(w: i32, h: i32) -> Self {
        Map { w, h, tiles: vec![Tile::Void as u8; (w * h) as usize] }
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
        }
    }
    /// Blocks movement and sight.
    pub fn solid(&self, x: i32, y: i32) -> bool {
        let t = self.get(x, y);
        !(t == Tile::Floor as u8 || t == Tile::DoorOpen as u8)
    }
    pub fn walkable(&self, x: i32, y: i32) -> bool {
        !self.solid(x, y)
    }
    pub fn solid_at(&self, p: Vec2) -> bool {
        self.solid((p.x / TILE).floor() as i32, (p.y / TILE).floor() as i32)
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
    pub player_spawns: Vec<Vec2>,
}

impl Dungeon {
    pub fn boss_hall(&self) -> &Rect {
        &self.rooms[self.boss].rect
    }
}
