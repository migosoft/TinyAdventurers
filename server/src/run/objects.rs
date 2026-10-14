//! World objects: things on the map with state that are neither heroes nor
//! monsters (chests, barrels; later torches, levers, the carriage). One list,
//! one snapshot encoding, one damage path (`hurt_object`) and one use path.

use super::Run;
use crate::defs::damage::{resolve, Damage, Resistances};
use crate::defs::kinds::EntityKind;
use crate::math::Vec2;
use crate::protocol::EntSnap;

pub struct WorldObject {
    pub id: u32,
    pub kind: EntityKind,
    pub pos: Vec2,
    pub radius: f64,
    pub solid: bool,
    pub res: Resistances,
    pub state: ObjState,
    /// Removed at the end of the step (exploded, fallen, sunk).
    pub gone: bool,
}

pub enum ObjState {
    Chest { opened: Option<f64> },
}

impl Run {
    pub fn spawn_object(&mut self, kind: EntityKind, pos: Vec2, state: ObjState) -> u32 {
        let d = crate::defs::objects::def(kind);
        let id = self.alloc_id();
        let res = crate::defs::objects::profile(kind).res;
        self.objects.push(WorldObject { id, kind, pos, radius: d.radius, solid: d.solid, res, state, gone: false });
        id
    }

    /// Footprints of the solid objects, except `except` (an object's own id).
    pub fn solids(&self, except: Option<u32>) -> Vec<crate::collision::Solid> {
        self.objects
            .iter()
            .filter(|o| o.solid && !o.gone && Some(o.id) != except)
            .map(|o| crate::collision::Solid { x: o.pos.x, y: o.pos.y, half: o.radius })
            .collect()
    }
}

/// A hit on an object; `by` is the hero's entity id. What it does depends on the kind.
pub fn hurt_object(run: &mut Run, oi: usize, dmg: Damage, _by: Option<u32>) {
    let o = &run.objects[oi];
    if o.gone || resolve(&dmg, &o.res) <= 0.0 {
        return;
    }
    match o.state {
        ObjState::Chest { .. } => {}
    }
}

fn ms_since(time: f64, t: f64) -> u16 {
    ((time - t) * 1000.0).clamp(0.0, 65535.0) as u16
}

/// Snapshot entry. Chests: anim 1 once opened, with the time since.
pub fn snap(o: &WorldObject, time: f64) -> EntSnap {
    let (anim, since) = match o.state {
        ObjState::Chest { opened } => opened.map_or((0, 0), |t| (1, ms_since(time, t))),
    };
    EntSnap(o.id, o.kind as u8, o.pos.x as f32, o.pos.y as f32, 255, anim, 0.0, since, 0, 0)
}
