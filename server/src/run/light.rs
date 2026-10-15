//! Light sources: one registry per run. Features add, switch, recolour and
//! remove lights only through `Run::add_light` and friends; `Run::is_lit`
//! answers "is this spot lit?" for visibility and, later, gameplay (the
//! shadow, the torch-extinguishing enemy). Static lights (anchored to a tile)
//! are baked into a per-tile map, rebuilt only after a change; moving lights
//! (anchored to an entity) are tested per query. The client mirrors the
//! static map for drawing (`client/src/game/light.ts`, shared fixtures).

use super::Run;
use crate::collision::line_of_sight;
use crate::defs::lights::{self, Colour, LightKind};
use crate::dungeon::{Map, TILE};
use crate::fov::Fov;
use crate::math::Vec2;
use crate::protocol::{Ev, LightInfo};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Anchor {
    /// Static: fixed on this tile.
    Tile(i32, i32),
    /// Moving: follows the entity with this id (any list), removed with it.
    Entity(u32),
}

#[derive(Debug, Clone)]
pub struct LightSource {
    pub id: u32,
    pub kind: LightKind,
    pub colour: Colour,
    pub anchor: Anchor,
    pub on: bool,
}

/// A lit moving light at its entity's position (for one query or snapshot).
#[derive(Debug, Clone, Copy)]
pub struct Lit {
    pub pos: Vec2,
    /// Reach in px.
    pub reach: f64,
    pub kind: LightKind,
    pub colour: Colour,
}

pub struct Lights {
    pub sources: Vec<LightSource>,
    next_id: u32,
    w: i32,
    h: i32,
    /// Static layer: tiles lit by at least one static light.
    lit: Vec<bool>,
    dirty: bool,
    fov: Fov,
}

impl Lights {
    pub fn new(w: i32, h: i32) -> Self {
        Lights { sources: Vec::new(), next_id: 1, w, h, lit: vec![false; (w * h) as usize], dirty: false, fov: Fov::new(w, h) }
    }

    /// Registers a light (on); light ids are separate from entity ids.
    pub fn push(&mut self, kind: LightKind, anchor: Anchor, colour: Option<Colour>) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        let colour = colour.unwrap_or(lights::def(kind).colour);
        self.sources.push(LightSource { id, kind, colour, anchor, on: true });
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
        for s in self.sources.iter().filter(|s| s.on) {
            let Anchor::Tile(x, y) = s.anchor else { continue };
            let r = lights::def(s.kind).radius;
            self.fov.compute(map, x, y, r);
            for ty in (y - r).max(0)..=(y + r).min(self.h - 1) {
                for tx in (x - r).max(0)..=(x + r).min(self.w - 1) {
                    if self.fov.is_visible(tx, ty) {
                        self.lit[(ty * self.w + tx) as usize] = true;
                    }
                }
            }
        }
    }

    /// The static layer (call `refresh` first).
    pub fn static_lit(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.w && y < self.h && self.lit[(y * self.w + x) as usize]
    }
}

/// Does a moving light reach `p`: in range and in line of sight?
pub fn reaches(map: &Map, l: &Lit, p: Vec2) -> bool {
    l.pos.dist(p) <= l.reach && line_of_sight(map, l.pos, p)
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

    /// Every lit moving light at its entity's current position.
    pub fn moving_lights(&self) -> Vec<Lit> {
        self.lights
            .sources
            .iter()
            .filter(|s| s.on)
            .filter_map(|s| {
                let Anchor::Entity(e) = s.anchor else { return None };
                let pos = self.entity_pos(e)?;
                let reach = (lights::def(s.kind).radius as f64 + 0.5) * TILE;
                Some(Lit { pos, reach, kind: s.kind, colour: s.colour })
            })
            .collect()
    }

    /// Is this spot lit by any light? (Static layer or a moving light in reach.)
    pub fn is_lit(&mut self, p: Vec2) -> bool {
        self.lights.refresh(&self.layout.map);
        let (x, y) = Map::tile_of(p);
        self.lights.static_lit(x, y) || self.moving_lights().iter().any(|l| reaches(&self.layout.map, l, p))
    }

    /// Drops moving lights whose entity is gone (after the step's clean-up).
    pub fn sweep_lights(&mut self) {
        let gone: Vec<u32> = self
            .lights
            .sources
            .iter()
            .filter_map(|s| match s.anchor {
                Anchor::Entity(e) if self.entity_pos(e).is_none() => Some(s.id),
                _ => None,
            })
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
                Anchor::Entity(_) => None,
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
        assert!(run.is_lit(at(tx - 5, ty)), "the edge of radius 5");
        assert!(!run.is_lit(at(tx - 6, ty)), "beyond it");
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
        assert!((run.moving_lights()[0].reach - 3.5 * TILE).abs() < 1e-9);
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
}
