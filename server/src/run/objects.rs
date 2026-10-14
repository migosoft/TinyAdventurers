//! World objects: things on the map with state that are neither heroes nor
//! monsters (chests, barrels; later torches, levers, the carriage). One list,
//! one snapshot encoding, one damage path (`hurt_object`) and one use path.

use super::Run;
use crate::defs::damage::{resolve, Damage, Resistances};
use crate::defs::kinds::EntityKind;
use crate::collision::line_of_sight;
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::objects::*;
use crate::run::entities::Sink;
use crate::math::Vec2;
use crate::protocol::{EntSnap, Ev};

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
    Barrel(Barrel),
}

pub struct Barrel {
    /// Seconds until it explodes, once lit.
    pub fuse: Option<f64>,
    pub lit_at: f64,
    /// Hero (entity id) who lit the first barrel of the chain: damage and kills go to them.
    pub igniter: Option<u32>,
    /// Slide velocity (px/s) after a push, decaying like knockback.
    pub vel: Vec2,
    /// Falling into a chasm or sinking in deep water: seconds left, how, start time.
    pub sinking: Option<(f64, Sink, f64)>,
}

impl Barrel {
    pub fn new() -> Self {
        Barrel { fuse: None, lit_at: 0.0, igniter: None, vel: Vec2::ZERO, sinking: None }
    }
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
pub fn hurt_object(run: &mut Run, oi: usize, dmg: Damage, by: Option<u32>) {
    let o = &run.objects[oi];
    if o.gone || resolve(&dmg, &o.res) <= 0.0 {
        return;
    }
    match &o.state {
        ObjState::Chest { .. } => {}
        ObjState::Barrel(_) => {
            let time = run.time;
            if let ObjState::Barrel(b) = &mut run.objects[oi].state {
                if b.fuse.is_none() && b.sinking.is_none() {
                    b.fuse = Some(BARREL_FUSE);
                    b.lit_at = time;
                    b.igniter = by;
                }
            }
        }
    }
}

/// `Ev::Boom` kind of a barrel explosion.
pub const BOOM_BARREL: u8 = 7;

/// Fuses burn down; a burnt-out fuse explodes the barrel.
pub fn tick_objects(run: &mut Run, dt: f64) {
    for oi in 0..run.objects.len() {
        if run.objects[oi].gone {
            continue;
        }
        let time = run.time;
        let ObjState::Barrel(b) = &mut run.objects[oi].state else { continue };
        let Some(f) = b.fuse else { continue };
        // Lit during this step (by a blast earlier in this loop): the fuse starts next step.
        let f = if b.lit_at < time { f - dt } else { f };
        b.fuse = Some(f);
        if f <= 0.0 {
            explode_barrel(run, oi);
        }
    }
}

/// The blast: hurts heroes, monsters and bosses with line of sight to it,
/// pushes heroes away, and lights every barrel in reach. Damage and kills go
/// to the hero who lit the chain.
pub fn explode_barrel(run: &mut Run, oi: usize) {
    let o = &mut run.objects[oi];
    if o.gone {
        return;
    }
    o.gone = true;
    let pos = o.pos;
    let by = match &o.state {
        ObjState::Barrel(b) => b.igniter,
        _ => None,
    };
    let src = by.and_then(|id| run.player_idx(id));
    let (r, dmg, knock) = (BARREL_BLAST_R, barrel_blast(), BARREL_BLAST_KNOCK);
    run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: r as f32, k: BOOM_BARREL }, Some(pos));
    let map = &run.layout.map;
    let heroes: Vec<usize> = (0..run.players.len())
        .filter(|&i| {
            let p = &run.players[i];
            p.alive && p.pos().dist(pos) < r + PLAYER_RADIUS && line_of_sight(map, pos, p.pos())
        })
        .collect();
    let monsters: Vec<usize> = (0..run.monsters.len())
        .filter(|&i| {
            let m = &run.monsters[i];
            m.alive && m.pos.dist(pos) < r + m.radius && line_of_sight(map, pos, m.pos)
        })
        .collect();
    let barrels: Vec<usize> = (0..run.objects.len())
        .filter(|&i| {
            let q = &run.objects[i];
            i != oi && !q.gone && q.pos.dist(pos) < r + q.radius && line_of_sight(map, pos, q.pos)
        })
        .collect();
    for qi in heroes {
        run.hurt_player(qi, dmg);
        run.knock_player(qi, pos, 0.0, knock);
    }
    for mi in monsters {
        run.hurt_monster(mi, dmg, false, src);
        run.knock_monster(mi, pos, knock);
    }
    for qi in barrels {
        hurt_object(run, qi, dmg, by);
    }
}

fn ms_since(time: f64, t: f64) -> u16 {
    ((time - t) * 1000.0).clamp(0.0, 65535.0) as u16
}

/// Snapshot entry. Chests: anim 1 once opened, with the time since.
pub fn snap(o: &WorldObject, time: f64) -> EntSnap {
    let (anim, since) = match &o.state {
        ObjState::Chest { opened } => opened.map_or((0, 0), |t| (1, ms_since(time, t))),
        ObjState::Barrel(b) => match (b.sinking, b.fuse) {
            (Some((_, how, t0)), _) => (if how == Sink::Fall { 2 } else { 3 }, ms_since(time, t0)),
            (None, Some(_)) => (1, ms_since(time, b.lit_at)),
            _ => (0, 0),
        },
    };
    EntSnap(o.id, o.kind as u8, o.pos.x as f32, o.pos.y as f32, 255, anim, 0.0, since, 0, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::damage::{DamageSplit, DamageType};
    use crate::protocol::{BossId, ClassId};
    use crate::run::tests::test_run;

    pub fn barrel_at(run: &mut Run, off: Vec2) -> (u32, usize) {
        let pos = run.players[0].pos() + off;
        let id = run.spawn_object(EntityKind::Barrel, pos, ObjState::Barrel(Barrel::new()));
        (id, run.objects.len() - 1)
    }

    fn lit(run: &Run, oi: usize) -> bool {
        matches!(&run.objects[oi].state, ObjState::Barrel(b) if b.fuse.is_some())
    }

    #[test]
    fn any_hit_lights_a_barrel_but_poison_does_not() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        let (_, oi) = barrel_at(&mut run, Vec2::new(40.0, 0.0));
        hurt_object(&mut run, oi, Damage::new(5.0, DamageSplit::pure(DamageType::Poison)), None);
        assert!(!lit(&run, oi), "objects resist poison fully");
        let pid = run.players[0].id;
        hurt_object(&mut run, oi, Damage::physical(1.0), Some(pid));
        assert!(lit(&run, oi));
        let ObjState::Barrel(b) = &run.objects[oi].state else { panic!() };
        assert_eq!((b.fuse, b.igniter), (Some(BARREL_FUSE), Some(pid)));
        assert_eq!(snap(&run.objects[oi], run.time).5, 1, "anim 1 while the fuse burns");
    }

    fn booms(run: &Run) -> usize {
        run.events.iter().filter(|(e, _)| matches!(e, crate::protocol::Ev::Boom { k: BOOM_BARREL, .. })).count()
    }

    fn step_for(run: &mut Run, secs: f64) {
        for _ in 0..(secs / crate::run::DT).round() as usize {
            run.step();
        }
    }

    #[test]
    fn a_lit_barrel_explodes_after_the_fuse_and_hurts_and_pushes_heroes() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let (_, oi) = barrel_at(&mut run, Vec2::new(20.0, 0.0));
        let hp = run.players[0].hp;
        hurt_object(&mut run, oi, Damage::physical(1.0), None);
        run.events.clear();
        step_for(&mut run, BARREL_FUSE - 0.05);
        assert_eq!(booms(&run), 0, "not yet");
        step_for(&mut run, 0.1);
        assert_eq!(booms(&run), 1);
        assert!(run.players[0].hp < hp, "the blast hurts heroes too");
        assert!(run.players[0].mv.knock_vx < 0.0, "and pushes them away (west)");
        assert!(run.objects.iter().all(|o| o.kind != EntityKind::Barrel), "the barrel is gone");
    }

    #[test]
    fn a_chain_of_ten_barrels_explodes_each_exactly_once() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        run.players[0].debug = true; // the hero stands in the middle of it
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        for x in tx - 1..=tx + 12 {
            for y in ty - 2..=ty + 2 {
                run.layout.map.set(x, y, crate::dungeon::Tile::Floor);
            }
        }
        for k in 0..10 {
            barrel_at(&mut run, Vec2::new(20.0 + 16.0 * k as f64, 0.0));
        }
        let first = run.objects.iter().position(|o| o.kind == EntityKind::Barrel).unwrap();
        hurt_object(&mut run, first, Damage::physical(1.0), None);
        run.events.clear();
        step_for(&mut run, 10.0 * BARREL_FUSE + 0.5);
        assert_eq!(booms(&run), 10);
    }

    #[test]
    fn a_chain_without_an_igniter_or_whose_igniter_left_still_explodes() {
        let mut run = test_run(&[ClassId::Paladin, ClassId::Wizard], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let (_, oi) = barrel_at(&mut run, Vec2::new(30.0, 0.0));
        let wiz = run.players[1].id;
        hurt_object(&mut run, oi, Damage::physical(1.0), Some(wiz));
        run.handle(crate::run::RunCmd::Leave { conn: 2 });
        run.events.clear();
        step_for(&mut run, BARREL_FUSE + 0.1);
        assert_eq!(booms(&run), 1);
    }
}
