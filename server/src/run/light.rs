//! Light sources: one registry per run. Features add, switch, recolour and
//! remove lights only through `Run::add_light` and friends; `Run::is_lit`
//! answers "is this spot lit?" for visibility and, later, gameplay (the
//! shadow, the torch-extinguishing enemy). Every light lights the tiles a
//! shadowcast of its radius from its tile reaches. Static lights (anchored to
//! a tile) are baked into a per-tile map, rebuilt only after a change; moving
//! lights (anchored to an entity, or a short-lived flash on a point) are cast
//! from their tile into a second layer, once per snapshot. The client casts both the same way for
//! drawing (`client/src/game/light.ts`, shared fixtures), so a tile the
//! server counts as lit is never drawn fully black (its light fades out
//! inside the lit tiles, never beyond them).

use super::Run;
use crate::defs::lights::{self, Colour, LightKind};
use crate::dungeon::{Map, TILE};
use crate::fov::Fov;
use crate::math::Vec2;
use crate::protocol::{Ev, LightInfo};
use crate::wire::{q_pos, POS_SCALE};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Anchor {
    /// Static: fixed on this tile.
    Tile(i32, i32),
    /// Moving: follows the entity with this id (any list), removed with it.
    Entity(u32),
    /// Moving (sent like one), but still: a flash at this spot (`Run::add_flash`).
    Point(Vec2),
}

#[derive(Debug, Clone)]
pub struct LightSource {
    pub id: u32,
    pub kind: LightKind,
    pub colour: Colour,
    pub anchor: Anchor,
    pub on: bool,
    /// Run time at which the sweep removes it (flashes).
    pub expires: Option<f64>,
}

/// A lit moving light at its entity's position (for one query or snapshot).
#[derive(Debug, Clone, Copy)]
pub struct Lit {
    pub pos: Vec2,
    /// The tile it is cast from (`light_tile`).
    pub tile: (i32, i32),
    pub kind: LightKind,
    pub colour: Colour,
}

impl Lit {
    pub fn new(pos: Vec2, kind: LightKind, colour: Colour) -> Self {
        Lit { pos, tile: light_tile(pos), kind, colour }
    }

    /// How far from its position its light can fall, in px: the lit tiles
    /// lie within its radius of its tile, whose centre is under a tile away.
    pub fn reach(&self) -> f64 {
        (lights::def(self.kind).radius as f64 + 1.0) * TILE
    }
}

/// The tile a moving light is cast from: the tile of its position as the
/// snapshot sends it (f32, then 1/POS_SCALE px), so the client, which only
/// knows that position, casts from the same tile.
pub fn light_tile(pos: Vec2) -> (i32, i32) {
    let sent = |v: f64| q_pos(v as f32 as f64) as f64 / POS_SCALE;
    Map::tile_of(Vec2::new(sent(pos.x), sent(pos.y)))
}

pub struct Lights {
    pub sources: Vec<LightSource>,
    next_id: u32,
    w: i32,
    h: i32,
    /// Static layer: tiles lit by at least one static light.
    lit: Vec<bool>,
    dirty: bool,
    /// Moving layer: tiles lit by a moving light (`cast_moving`), and which
    /// ones are set, to clear them cheaply.
    moving: Vec<bool>,
    touched: Vec<usize>,
    fov: Fov,
}

impl Lights {
    pub fn new(w: i32, h: i32) -> Self {
        let n = (w * h) as usize;
        Lights { sources: Vec::new(), next_id: 1, w, h, lit: vec![false; n], dirty: false, moving: vec![false; n], touched: Vec::new(), fov: Fov::new(w, h) }
    }

    /// Registers a light (on); light ids are separate from entity ids.
    pub fn push(&mut self, kind: LightKind, anchor: Anchor, colour: Option<Colour>) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        let colour = colour.unwrap_or(lights::def(kind).colour);
        self.sources.push(LightSource { id, kind, colour, anchor, on: true, expires: None });
        if matches!(anchor, Anchor::Tile(..)) {
            self.dirty = true;
        }
        id
    }

    pub fn get(&self, id: u32) -> Option<&LightSource> {
        self.sources.iter().find(|s| s.id == id)
    }

    /// The map or a static light changed: rebuild on the next `refresh`.
    pub fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    /// Rebuilds the static layer if anything changed since the last call.
    pub fn refresh(&mut self, map: &Map) {
        if !self.dirty {
            return;
        }
        self.dirty = false;
        self.lit.iter_mut().for_each(|v| *v = false);
        let statics: Vec<(i32, i32, LightKind)> = self
            .sources
            .iter()
            .filter(|s| s.on)
            .filter_map(|s| match s.anchor {
                Anchor::Tile(x, y) => Some((x, y, s.kind)),
                Anchor::Entity(_) | Anchor::Point(_) => None,
            })
            .collect();
        for (x, y, kind) in statics {
            self.cast(map, x, y, kind, |lights, i| lights.lit[i] = true);
        }
    }

    /// Marks every tile a light of this kind on tile (x, y) lights: a
    /// shadowcast of its radius, in the square window around it.
    fn cast(&mut self, map: &Map, x: i32, y: i32, kind: LightKind, mut mark: impl FnMut(&mut Self, usize)) {
        let r = lights::def(kind).radius;
        self.fov.compute(map, x, y, r);
        for ty in (y - r).max(0)..=(y + r).min(self.h - 1) {
            for tx in (x - r).max(0)..=(x + r).min(self.w - 1) {
                if self.fov.is_visible(tx, ty) {
                    mark(self, (ty * self.w + tx) as usize);
                }
            }
        }
    }

    /// Rebuilds the moving layer for these lights (once per snapshot or query).
    pub fn cast_moving(&mut self, map: &Map, moving: &[Lit]) {
        for i in std::mem::take(&mut self.touched) {
            self.moving[i] = false;
        }
        for l in moving {
            self.cast(map, l.tile.0, l.tile.1, l.kind, |lights, i| {
                if !lights.moving[i] {
                    lights.moving[i] = true;
                    lights.touched.push(i);
                }
            });
        }
    }

    /// The static layer (call `refresh` first).
    pub fn static_lit(&self, x: i32, y: i32) -> bool {
        self.inside(x, y) && self.lit[(y * self.w + x) as usize]
    }

    /// Lit by a static or a moving light (call `refresh` and `cast_moving` first).
    pub fn lit(&self, x: i32, y: i32) -> bool {
        self.inside(x, y) && {
            let i = (y * self.w + x) as usize;
            self.lit[i] || self.moving[i]
        }
    }

    fn inside(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.w && y < self.h
    }
}

impl Run {
    /// Adds a light (switched on). Static lights added after the start are
    /// announced with `Ev::LightAdd`; those added while the run is built go
    /// out in `RunStartInfo.lights` instead.
    pub fn add_light(&mut self, kind: LightKind, anchor: Anchor, colour: Option<Colour>) -> u32 {
        let id = self.lights.push(kind, anchor, colour);
        if let (Anchor::Tile(x, y), true) = (anchor, self.tick > 0) {
            let colour = self.lights.get(id).unwrap().colour;
            self.event(Ev::LightAdd { id, kind: kind as u8, colour, x: x as u16, y: y as u16, on: true }, None);
        }
        id
    }

    /// A short flash of light on a spot (an explosion): a moving light that
    /// the sweep removes after `secs`. No event: it goes out in snapshots.
    pub fn add_flash(&mut self, kind: LightKind, pos: Vec2, secs: f64) -> u32 {
        let id = self.add_light(kind, Anchor::Point(pos), None);
        let expires = self.time + secs;
        if let Some(s) = self.lights.sources.iter_mut().find(|s| s.id == id) {
            s.expires = Some(expires);
        }
        id
    }

    pub fn set_light(&mut self, id: u32, on: bool) {
        self.change_light(id, |s| s.on = on);
    }

    pub fn set_light_colour(&mut self, id: u32, colour: Colour) {
        self.change_light(id, |s| s.colour = colour);
    }

    fn change_light(&mut self, id: u32, f: impl FnOnce(&mut LightSource)) {
        let Some(s) = self.lights.sources.iter_mut().find(|s| s.id == id) else { return };
        let before = (s.on, s.colour);
        f(s);
        let (on, colour, anchor) = (s.on, s.colour, s.anchor);
        if (on, colour) == before || !matches!(anchor, Anchor::Tile(..)) {
            return;
        }
        self.lights.mark_dirty();
        self.event(Ev::Light { id, on, colour }, None);
    }

    pub fn remove_light(&mut self, id: u32) {
        let Some(i) = self.lights.sources.iter().position(|s| s.id == id) else { return };
        let s = self.lights.sources.remove(i);
        if matches!(s.anchor, Anchor::Tile(..)) {
            self.lights.mark_dirty();
            self.event(Ev::LightRemove { id }, None);
        }
    }

    /// Where an entity is, if it still exists (any list).
    pub fn entity_pos(&self, id: u32) -> Option<Vec2> {
        self.players.iter().find(|p| p.id == id && p.alive).map(|p| p.pos())
            .or_else(|| self.monsters.iter().find(|m| m.id == id && m.alive).map(|m| m.pos))
            .or_else(|| self.projectiles.iter().find(|p| p.id == id && !p.dead).map(|p| p.pos))
            .or_else(|| self.hazards.iter().find(|h| h.id == id && h.life > 0.0).map(|h| h.pos))
            .or_else(|| self.objects.iter().find(|o| o.id == id && !o.gone).map(|o| o.pos))
    }

    /// Every lit moving light at its entity's current position (a flash at its spot).
    pub fn moving_lights(&self) -> Vec<Lit> {
        self.lights
            .sources
            .iter()
            .filter(|s| s.on)
            .filter_map(|s| {
                let pos = match s.anchor {
                    Anchor::Entity(e) => self.entity_pos(e)?,
                    Anchor::Point(p) => p,
                    Anchor::Tile(..) => return None,
                };
                Some(Lit::new(pos, s.kind, s.colour))
            })
            .collect()
    }

    /// Is this spot lit by any light? (Its tile is in the static or the moving layer.)
    pub fn is_lit(&mut self, p: Vec2) -> bool {
        self.lights.refresh(&self.layout.map);
        let moving = self.moving_lights();
        self.lights.cast_moving(&self.layout.map, &moving);
        let (x, y) = Map::tile_of(p);
        self.lights.lit(x, y)
    }

    /// The light an entity of this kind carries (`defs::lights::kind_light`).
    pub fn attach_kind_light(&mut self, id: u32, kind: crate::defs::kinds::EntityKind) {
        if let Some((k, colour)) = lights::kind_light(kind) {
            self.add_light(k, Anchor::Entity(id), colour);
        }
    }

    /// A static `Lava` light on every lava tile (run start).
    pub fn add_lava_lights(&mut self) {
        let m = &self.layout.map;
        let lava: Vec<(i32, i32)> = (0..m.h).flat_map(|y| (0..m.w).map(move |x| (x, y))).filter(|&(x, y)| m.get(x, y) == crate::dungeon::Tile::Lava as u8).collect();
        for (x, y) in lava {
            self.add_light(LightKind::Lava, Anchor::Tile(x, y), None);
        }
    }

    /// Changes a tile during the run: sends `Ev::Tile`, keeps lava lights in step
    /// and rebuilds the light map (a door or wall changes what light reaches).
    pub fn set_tile(&mut self, x: i32, y: i32, t: crate::dungeon::Tile) {
        use crate::dungeon::Tile;
        let was_lava = self.layout.map.get(x, y) == Tile::Lava as u8;
        self.layout.map.set(x, y, t);
        self.event(Ev::Tile { x: x as u16, y: y as u16, v: t as u8 }, None);
        let lava_light = self.lights.sources.iter().find(|s| s.kind == LightKind::Lava && s.anchor == Anchor::Tile(x, y)).map(|s| s.id);
        match (was_lava, t == Tile::Lava, lava_light) {
            (true, false, Some(id)) => self.remove_light(id),
            (false, true, None) => {
                self.add_light(LightKind::Lava, Anchor::Tile(x, y), None);
            }
            _ => {}
        }
        self.lights.mark_dirty();
    }

    /// Drops moving lights whose entity is gone and flashes that ran out (after the step's clean-up).
    pub fn sweep_lights(&mut self) {
        let gone: Vec<u32> = self
            .lights
            .sources
            .iter()
            .filter(|s| match s.anchor {
                Anchor::Entity(e) => self.entity_pos(e).is_none(),
                _ => s.expires.is_some_and(|t| self.time >= t),
            })
            .map(|s| s.id)
            .collect();
        self.lights.sources.retain(|s| !gone.contains(&s.id));
    }

    /// The static lights for `RunStartInfo`.
    pub fn light_infos(&self) -> Vec<LightInfo> {
        self.lights
            .sources
            .iter()
            .filter_map(|s| match s.anchor {
                Anchor::Tile(x, y) => Some(LightInfo(s.id, s.kind as u8, s.colour, x as u16, y as u16, s.on)),
                Anchor::Entity(_) | Anchor::Point(_) => None,
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::kinds::EntityKind;
    use crate::defs::lights::LightKind;
    use crate::dungeon::{Map, Tile, TILE};
    use crate::protocol::{BossId, ClassId};
    use crate::run::tests::test_run;

    /// An open 15x9 floor patch around the hero, no lights at all.
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
        (run, tx, ty)
    }

    fn at(x: i32, y: i32) -> Vec2 {
        Map::center_of(x, y)
    }

    #[test]
    fn a_static_light_lights_its_radius_and_stops_at_walls() {
        let (mut run, tx, ty) = dark_run();
        assert!(!run.is_lit(at(tx, ty)), "dark to begin with");
        for y in ty - 4..=ty + 4 {
            run.layout.map.set(tx + 3, y, Tile::Wall);
        }
        run.add_light(LightKind::Torch, Anchor::Tile(tx, ty), None);
        assert!(run.is_lit(at(tx, ty)));
        assert!(run.is_lit(at(tx - 7, ty)), "the edge of radius 7");
        assert!(!run.is_lit(at(tx - 8, ty)), "beyond it");
        assert!(run.is_lit(at(tx + 3, ty)), "the wall itself is lit");
        assert!(!run.is_lit(at(tx + 4, ty)), "behind the wall is dark");
    }

    #[test]
    fn switching_recolouring_and_removing_a_static_light() {
        let (mut run, tx, ty) = dark_run();
        run.step(); // past the start: changes are sent as events now
        run.events.clear();
        let id = run.add_light(LightKind::Torch, Anchor::Tile(tx, ty), None);
        assert!(matches!(run.events[..], [(Ev::LightAdd { kind: 0, colour: 0xffaa5a, on: true, .. }, None)]));
        run.set_light(id, false);
        assert!(!run.is_lit(at(tx, ty)));
        run.set_light(id, true);
        assert!(run.is_lit(at(tx, ty)));
        run.set_light_colour(id, 0x3060ff);
        assert_eq!(run.lights.get(id).unwrap().colour, 0x3060ff);
        assert!(matches!(run.events.last(), Some((Ev::Light { on: true, colour: 0x3060ff, .. }, None))));
        let n = run.events.len();
        run.set_light(id, true);
        assert_eq!(run.events.len(), n, "no event when nothing changes");
        run.remove_light(id);
        assert!(!run.is_lit(at(tx, ty)));
        assert!(matches!(run.events.last(), Some((Ev::LightRemove { .. }, None))));
    }

    #[test]
    fn lights_added_at_start_send_no_event() {
        let (mut run, tx, ty) = dark_run();
        run.events.clear();
        assert_eq!(run.tick, 0);
        run.add_light(LightKind::Torch, Anchor::Tile(tx, ty), None);
        assert!(run.events.is_empty(), "start lights go out in RunStartInfo");
        assert_eq!(run.light_infos().len(), 1);
    }

    #[test]
    fn a_moving_light_follows_its_entity_and_is_blocked_by_walls() {
        let (mut run, tx, ty) = dark_run();
        let id = run.spawn_enemy(crate::defs::enemies::EnemyType::OrcWarrior, at(tx - 4, ty), None, 1);
        run.add_light(LightKind::Fire, Anchor::Entity(id), None);
        assert!(run.is_lit(at(tx - 4, ty)) && run.is_lit(at(tx - 2, ty)));
        assert!(!run.is_lit(at(tx + 2, ty)), "out of range");
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].pos = at(tx + 1, ty);
        assert!(run.is_lit(at(tx + 2, ty)), "it moved along");
        for y in ty - 4..=ty + 4 {
            run.layout.map.set(tx + 3, y, Tile::Wall);
        }
        assert!(!run.is_lit(at(tx + 4, ty)), "not through the wall");
        assert_eq!(run.moving_lights().len(), 1);
        assert_eq!(run.moving_lights()[0].tile, (tx + 1, ty), "cast from its tile");
    }

    #[test]
    fn a_moving_light_is_cast_from_the_tile_of_its_sent_position() {
        // 47.99 px goes out as 48 (1/16 px on the wire): tile 3, as the client sees it.
        assert_eq!(light_tile(Vec2::new(47.99, 20.0)), (3, 1));
        assert_eq!(light_tile(Vec2::new(47.9, 20.0)), (2, 1));
        assert_eq!(light_tile(Vec2::new(48.0, 31.99)), (3, 2));
    }

    #[test]
    fn a_moving_light_lights_the_shadowcast_from_its_tile() {
        let (mut run, tx, ty) = dark_run();
        run.spawn_hazard(EntityKind::FirePatch, at(tx, ty), 10.0, 3.0, 8.0);
        assert!(run.is_lit(at(tx + 4, ty)), "radius 4");
        assert!(!run.is_lit(at(tx + 4, ty + 1)), "outside the radius-4 shadowcast, though near its centre");
        let corner = Vec2::new((tx + 4) as f64 * TILE + 15.9, ty as f64 * TILE + 15.9);
        assert!(run.is_lit(corner), "anywhere on a lit tile");
    }

    #[test]
    fn the_sweep_drops_lights_of_gone_entities() {
        let (mut run, tx, ty) = dark_run();
        let id = run.spawn_enemy(crate::defs::enemies::EnemyType::OrcWarrior, at(tx - 4, ty), None, 1);
        run.add_light(LightKind::Fire, Anchor::Entity(id), None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].alive = false;
        run.step();
        assert!(run.lights.sources.is_empty());
    }

    #[test]
    fn a_light_keeps_its_kind_colour_unless_overridden() {
        let (mut run, tx, ty) = dark_run();
        let a = run.add_light(LightKind::Lava, Anchor::Tile(tx, ty), None);
        let b = run.add_light(LightKind::Torch, Anchor::Tile(tx, ty), Some(0x50ff70));
        assert_eq!(run.lights.get(a).unwrap().colour, 0xff461e);
        assert_eq!(run.lights.get(b).unwrap().colour, 0x50ff70);
    }

    #[test]
    fn a_fire_bolt_carries_a_light_and_an_arrow_does_not() {
        let (mut run, tx, ty) = dark_run();
        let from = at(tx - 6, ty);
        crate::run::abilities::spawn_monster_projectile(&mut run, 999, EntityKind::FireBolt, from, Vec2::new(1.0, 0.0), 60.0, 5.0, 3.0, 0.0, 0, 0.0);
        crate::run::abilities::spawn_monster_projectile(&mut run, 999, EntityKind::Arrow, from, Vec2::new(1.0, 0.0), 60.0, 5.0, 3.0, 0.0, 0, 0.0);
        assert_eq!(run.moving_lights().len(), 1);
        assert_eq!(run.moving_lights()[0].kind, LightKind::Fire);
        assert!(run.is_lit(from));
    }

    #[test]
    fn a_shot_that_dies_at_once_leaves_no_light() {
        let (mut run, tx, ty) = dark_run();
        run.layout.map.set(tx + 1, ty, Tile::Wall);
        let from = at(tx, ty);
        crate::run::abilities::spawn_monster_projectile(&mut run, 999, EntityKind::FireBolt, from, Vec2::new(1.0, 0.0), 600.0, 5.0, 3.0, 0.0, 0, 0.0);
        run.step();
        run.step();
        assert!(run.lights.sources.iter().all(|s| !matches!(s.anchor, Anchor::Entity(_))));
    }

    #[test]
    fn fire_patches_glow() {
        let (mut run, tx, ty) = dark_run();
        run.spawn_hazard(EntityKind::FirePatch, at(tx, ty), 10.0, 3.0, 8.0);
        assert!(run.is_lit(at(tx + 2, ty)));
    }

    #[test]
    fn lava_lights_its_surroundings_and_is_in_the_start_info() {
        let (mut run, tx, ty) = dark_run();
        run.layout.map.set(tx, ty, Tile::Lava);
        run.add_lava_lights();
        assert!(run.is_lit(at(tx, ty)) && run.is_lit(at(tx + 2, ty)));
        assert!(!run.is_lit(at(tx + 3, ty)));
        let infos = run.light_infos();
        assert!(infos.iter().any(|l| (l.1, l.3, l.4) == (LightKind::Lava as u8, tx as u16, ty as u16)));
    }

    #[test]
    fn dungeon_lava_is_lit_from_the_start() {
        let run = crate::run::tests::test_run(&[ClassId::Paladin], BossId::Demon); // lava theme
        let lava = run.layout.map.tiles.iter().filter(|&&t| t == Tile::Lava as u8).count();
        assert!(lava > 0);
        let lights = run.lights.sources.iter().filter(|s| s.kind == LightKind::Lava).count();
        assert_eq!(lights, lava);
        assert!(matches!(run.start_info(&run.players[0]), crate::protocol::ServerMsg::RunStarted(i) if i.lights.len() >= lava));
    }

    #[test]
    fn set_tile_keeps_lava_lights_in_step() {
        let (mut run, tx, ty) = dark_run();
        run.step();
        run.events.clear();
        run.set_tile(tx, ty, Tile::Lava);
        assert!(run.is_lit(at(tx, ty)));
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Tile { .. })));
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::LightAdd { .. })));
        run.set_tile(tx, ty, Tile::Floor);
        assert!(!run.is_lit(at(tx, ty)));
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::LightRemove { .. })));
    }

    #[test]
    fn a_closed_door_blocks_static_light() {
        let (mut run, tx, ty) = dark_run();
        for y in ty - 4..=ty + 4 {
            if y != ty {
                run.layout.map.set(tx + 1, y, Tile::Wall);
            }
        }
        run.add_light(LightKind::Torch, Anchor::Tile(tx, ty), None);
        assert!(run.is_lit(at(tx + 3, ty)), "through the gap");
        run.set_tile(tx + 1, ty, Tile::DoorClosed);
        assert!(!run.is_lit(at(tx + 3, ty)), "the door shuts the light in");
    }

    #[test]
    fn an_explosion_flashes_light_for_a_moment() {
        let (mut run, tx, ty) = dark_run();
        for y in ty - 4..=ty + 4 {
            run.layout.map.set(tx + 5, y, Tile::Wall);
        }
        // Three tiles from where the shot meets the wall: dark before and after the flash.
        let near = at(tx + 4, ty + 3);
        assert!(!run.is_lit(near));
        crate::run::abilities::spawn_monster_projectile(&mut run, 999, EntityKind::DragonFireball, at(tx + 3, ty), Vec2::new(1.0, 0.0), 300.0, 1.0, 2.0, 20.0, 4, 0.0);
        let mut n = 0;
        while !run.projectiles.is_empty() {
            run.step();
            n += 1;
            assert!(n < 30, "the shot hits the wall");
        }
        let boom = run.time;
        assert!(run.is_lit(near), "the blast lights it up");
        assert_eq!(run.moving_lights().iter().filter(|l| l.kind == LightKind::Blast).count(), 1);
        while run.time + crate::run::DT < boom + lights::BLAST_FLASH - 1e-6 {
            run.step();
            assert!(run.is_lit(near), "lit while the flash lasts");
        }
        run.step();
        run.step();
        assert!(!run.is_lit(near), "dark again");
        assert!(run.lights.sources.is_empty(), "the flash is swept");
    }
}
