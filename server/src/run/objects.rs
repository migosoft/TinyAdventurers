//! World objects: things on the map with state that are neither heroes nor
//! monsters (chests, barrels; later torches, levers, the carriage). One list,
//! one snapshot encoding, one damage path (`hurt_object`) and one use path.

use super::Run;
use crate::defs::damage::{resolve, Damage, Resistances};
use crate::defs::kinds::EntityKind;
use crate::defs::lights::{self, LightKind};
use crate::collision::line_of_sight;
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::abilities::{KNOCK_DECAY, KNOCK_MIN_SPEED};
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
    /// Lit while its light is on (`torch_on`): the light registry holds that state.
    Torch { wall: (i32, i32), side: crate::dungeon::TorchSide, light: u32 },
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

impl WorldObject {
    /// Blocks movement, shots and paths: solid, still there and not a sinking barrel.
    pub fn blocks(&self) -> bool {
        self.solid && !self.gone && !matches!(&self.state, ObjState::Barrel(b) if b.sinking.is_some())
    }
}

impl WorldObject {
    /// Owns a static light: always sent, so its light can be drawn from afar.
    pub fn owns_light(&self) -> bool {
        matches!(self.state, ObjState::Torch { .. })
    }
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

    /// A wall torch with its static light (lit).
    pub fn spawn_torch(&mut self, t: &crate::dungeon::TorchSpawn) -> u32 {
        let (fx, fy) = t.front();
        let light = self.add_light(crate::defs::lights::LightKind::Torch, crate::run::light::Anchor::Tile(fx, fy), None);
        self.spawn_object(EntityKind::Torch, t.pos(), ObjState::Torch { wall: t.wall, side: t.side, light })
    }

    /// Footprints of the solid objects, except `except` (an object's own id).
    pub fn solids(&self, except: Option<u32>) -> Vec<crate::collision::Solid> {
        self.objects
            .iter()
            .filter(|o| o.blocks() && Some(o.id) != except)
            .map(|o| crate::collision::Solid { x: o.pos.x, y: o.pos.y, half: o.radius })
            .collect()
    }
}

/// Lights or puts out a torch (its light).
pub fn set_torch(run: &mut Run, oi: usize, on: bool) {
    let ObjState::Torch { light, .. } = run.objects[oi].state else { return };
    run.set_light(light, on);
}

/// Is the torch with this light burning?
pub fn torch_on(run: &Run, light: u32) -> bool {
    run.lights.get(light).map_or(false, |l| l.on)
}

/// A hit on an object; `by` is the hero's entity id. What it does depends on the kind.
pub fn hurt_object(run: &mut Run, oi: usize, dmg: Damage, by: Option<u32>) {
    let o = &run.objects[oi];
    if o.gone || resolve(&dmg, &o.res) <= 0.0 {
        return;
    }
    match &o.state {
        ObjState::Chest { .. } => {}
        ObjState::Torch { .. } => {
            let heat = dmg.split.share(crate::defs::damage::DamageType::Heat) > 0.0;
            set_torch(run, oi, heat);
        }
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

/// Objects whose footprint an area attack at `at` with reach `r` touches,
/// optionally within a cone `(direction, half angle)`; like `Run::foes_in`.
pub fn objects_in(run: &Run, at: Vec2, r: f64, cone: Option<(f64, f64)>) -> Vec<usize> {
    run.objects
        .iter()
        .enumerate()
        .filter(|(_, o)| {
            if o.gone || o.pos.dist(at) > r + o.radius {
                return false;
            }
            match cone {
                Some((dir, half)) => crate::math::angle_diff(at.angle_to(o.pos), dir).abs() <= half,
                None => true,
            }
        })
        .map(|(i, _)| i)
        .collect()
}

/// An enemy's or boss's area attack hits the objects in it (no igniter).
pub fn hurt_objects_in(run: &mut Run, at: Vec2, r: f64, cone: Option<(f64, f64)>, dmg: Damage) {
    for oi in objects_in(run, at, r, cone) {
        hurt_object(run, oi, dmg, None);
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
        // Sinking: gone when it is under; no explosion.
        if let ObjState::Barrel(b) = &mut run.objects[oi].state {
            if let Some((t, how, t0)) = b.sinking {
                if t - dt > 0.0 {
                    b.sinking = Some((t - dt, how, t0));
                } else {
                    run.objects[oi].gone = true;
                }
                continue;
            }
        }
        slide_barrel(run, oi, dt);
        barrel_terrain(run, oi);
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

/// E: wakes a sleeping teammate in reach, else uses the nearest object within
/// hand reach (touching distance plus `USE_REACH`). Dead, pushed or sinking
/// heroes can't (the caller checks the push; this checks the rest).
pub fn use_object(run: &mut Run, pi: usize) {
    let p = &run.players[pi];
    if !p.alive || p.sinking.is_some() {
        return;
    }
    if run.wake_teammate(pi) {
        return;
    }
    let at = run.players[pi].pos();
    let near = run
        .objects
        .iter()
        .enumerate()
        .filter(|(_, o)| !o.gone && (matches!(&o.state, ObjState::Barrel(b) if b.sinking.is_none()) || matches!(o.state, ObjState::Torch { .. })))
        .map(|(i, o)| (i, o.pos.dist(at) - o.radius - PLAYER_RADIUS))
        .filter(|&(_, gap)| gap <= USE_REACH)
        .min_by(|a, b| a.1.total_cmp(&b.1));
    if let Some((oi, _)) = near {
        match run.objects[oi].state {
            ObjState::Barrel(_) => push_barrel(run, oi, at),
            ObjState::Torch { light, .. } => set_torch(run, oi, !torch_on(run, light)),
            ObjState::Chest { .. } => {}
        }
    }
}

/// Slides a barrel `BARREL_PUSH` px straight away from `from`.
pub fn push_barrel(run: &mut Run, oi: usize, from: Vec2) {
    let o = &mut run.objects[oi];
    let d = o.pos - from;
    let dir = if d.len() > 0.01 { d.norm() } else { Vec2::new(1.0, 0.0) };
    if let ObjState::Barrel(b) = &mut o.state {
        b.vel = dir * crate::collision::knock_speed(BARREL_PUSH, crate::run::DT);
    }
}

fn slide_barrel(run: &mut Run, oi: usize, dt: f64) {
    let ObjState::Barrel(b) = &run.objects[oi].state else { return };
    let v = b.vel;
    if v == Vec2::ZERO {
        return;
    }
    let (id, pos, r) = (run.objects[oi].id, run.objects[oi].pos, run.objects[oi].radius);
    let solids = run.solids(Some(id));
    let (x, y) = crate::collision::move_box(&run.layout.map, pos.x, pos.y, v.x * dt, v.y * dt, r, crate::dungeon::Mover::Dash, &solids);
    let to = Vec2::new(x, y);
    // A hero or monster in the way stops it (they are not shoved). Square
    // test, like the barrel's footprint, so it never ends inside a body's box.
    let overlaps = |c: Vec2, reach: f64| (c.x - to.x).abs() < reach && (c.y - to.y).abs() < reach;
    let blocked = run.players.iter().any(|p| p.alive && overlaps(p.pos(), PLAYER_RADIUS + r) && p.pos().dist(to) < p.pos().dist(pos))
        || run.monsters.iter().any(|m| m.alive && overlaps(m.pos, m.radius + r) && m.pos.dist(to) < m.pos.dist(pos));
    let ObjState::Barrel(b) = &mut run.objects[oi].state else { return };
    if blocked {
        b.vel = Vec2::ZERO;
        return;
    }
    // On the wire grid (1/POS_SCALE px): snapshots carry exactly this
    // position, so the client's predicted solids match the server's.
    let to = on_wire_grid(to);
    run.objects[oi].pos = to;
    let ObjState::Barrel(b) = &mut run.objects[oi].state else { return };
    b.vel = if to == pos { Vec2::ZERO } else { v * KNOCK_DECAY };
    if b.vel.len() < KNOCK_MIN_SPEED {
        b.vel = Vec2::ZERO;
    }
}

/// Rounds a position to the snapshot grid (multiples of 1/POS_SCALE px).
fn on_wire_grid(p: Vec2) -> Vec2 {
    let k = crate::wire::POS_SCALE;
    Vec2::new((p.x * k).round() / k, (p.y * k).round() / k)
}

/// A barrel over a chasm falls, in deep water it sinks (no explosion), in lava it goes off.
fn barrel_terrain(run: &mut Run, oi: usize) {
    use crate::dungeon::{Tile, DROWN_TIME, FALL_TIME};
    let (pos, time) = (run.objects[oi].pos, run.time);
    let tile = run.layout.map.tile_at(pos);
    let ObjState::Barrel(b) = &mut run.objects[oi].state else { return };
    if tile == Tile::Chasm as u8 {
        b.sinking = Some((FALL_TIME, Sink::Fall, time));
    } else if tile == Tile::DeepWater as u8 {
        b.sinking = Some((DROWN_TIME, Sink::Drown, time));
    } else if tile == Tile::Lava as u8 {
        b.fuse = Some(0.0);
        b.lit_at = time - 1.0;
        return;
    } else {
        return;
    }
    b.vel = Vec2::ZERO;
    b.fuse = None;
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
    run.add_flash(LightKind::Blast, pos, lights::BLAST_FLASH);
    let map = &run.layout.map;
    let foes = run.foes_touching(pos, r, true);
    let monsters: Vec<usize> = (0..run.monsters.len())
        .filter(|&i| {
            let m = &run.monsters[i];
            m.alive && !m.is_ally() && m.pos.dist(pos) < r + m.radius && line_of_sight(map, pos, m.pos)
        })
        .collect();
    let barrels: Vec<usize> = (0..run.objects.len())
        .filter(|&i| {
            let q = &run.objects[i];
            i != oi && !q.gone && q.pos.dist(pos) < r + q.radius && line_of_sight(map, pos, q.pos)
        })
        .collect();
    for c in foes {
        run.hurt_creature(c, dmg);
        run.knock_creature(c, pos, 0.0, knock);
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

/// Snapshot entry. Chests: anim 1 once opened, with the time since; torches: anim 1 while lit.
pub fn snap(run: &Run, o: &WorldObject) -> EntSnap {
    let time = run.time;
    let (anim, since) = match &o.state {
        ObjState::Chest { opened } => opened.map_or((0, 0), |t| (1, ms_since(time, t))),
        ObjState::Barrel(b) => match (b.sinking, b.fuse) {
            (Some((_, how, t0)), _) => (if how == Sink::Fall { 2 } else { 3 }, ms_since(time, t0)),
            (None, Some(_)) => (1, ms_since(time, b.lit_at)),
            _ => (0, 0),
        },
        ObjState::Torch { light, .. } => (torch_on(run, *light) as u8, 0),
    };
    let extra = match &o.state {
        ObjState::Torch { side, .. } => *side as u32,
        _ => 0,
    };
    EntSnap(o.id, o.kind as u8, o.pos.x as f32, o.pos.y as f32, 255, anim, 0.0, since, 0, extra, 0)
}

impl Run {
    /// Tiles under resting solid objects: pathfinding goes around them.
    pub fn object_tiles(&self) -> std::collections::HashSet<(i32, i32)> {
        let mut out = std::collections::HashSet::new();
        for o in self.objects.iter().filter(|o| o.blocks()) {
            let (x0, y0) = crate::dungeon::Map::tile_of(o.pos - Vec2::new(o.radius, o.radius));
            let (x1, y1) = crate::dungeon::Map::tile_of(o.pos + Vec2::new(o.radius - 0.001, o.radius - 0.001));
            for y in y0..=y1 {
                for x in x0..=x1 {
                    out.insert((x, y));
                }
            }
        }
        out
    }
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
        assert_eq!(snap(&run, &run.objects[oi]).5, 1, "anim 1 while the fuse burns");
    }

    fn booms(run: &Run) -> usize {
        run.events.iter().filter(|(e, _)| matches!(e, crate::protocol::Ev::Boom { k: BOOM_BARREL, .. })).count()
    }

    fn step_for(run: &mut Run, secs: f64) {
        for _ in 0..(secs / crate::run::DT).round() as usize {
            run.step();
        }
    }

    fn push(run: &mut Run) {
        let seq = run.players[0].ack + 1;
        run.players[0].inputs.push_back(crate::protocol::InputMsg { seq, act: true, ..Default::default() });
        run.step();
    }

    #[test]
    fn e_pushes_a_barrel_in_hand_reach_away_from_the_hero() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        for x in tx - 1..=tx + 8 {
            run.layout.map.set(x, ty, crate::dungeon::Tile::Floor);
        }
        let start = run.players[0].pos();
        let (id, _) = barrel_at(&mut run, Vec2::new(PLAYER_RADIUS + BARREL_RADIUS + 4.0, 0.0));
        push(&mut run);
        for _ in 0..60 {
            run.step();
        }
        let o = run.objects.iter().find(|o| o.id == id).unwrap();
        let moved = o.pos.x - (start.x + PLAYER_RADIUS + BARREL_RADIUS + 4.0);
        assert!((moved - BARREL_PUSH).abs() < 2.0, "slid {moved} px east");
    }

    #[test]
    fn a_barrel_out_of_reach_does_not_move() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        let (id, _) = barrel_at(&mut run, Vec2::new(PLAYER_RADIUS + BARREL_RADIUS + USE_REACH + 2.0, 0.0));
        let before = run.objects.iter().find(|o| o.id == id).unwrap().pos;
        push(&mut run);
        assert_eq!(run.objects.iter().find(|o| o.id == id).unwrap().pos, before);
    }

    #[test]
    fn a_pushed_barrel_stops_at_a_wall_and_at_another_barrel() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        for x in tx - 1..=tx + 2 {
            run.layout.map.set(x, ty, crate::dungeon::Tile::Floor);
        }
        run.layout.map.set(tx + 3, ty, crate::dungeon::Tile::Wall);
        let (id, oi) = barrel_at(&mut run, Vec2::new(PLAYER_RADIUS + BARREL_RADIUS + 2.0, 0.0));
        let from = run.players[0].pos();
        push_barrel(&mut run, oi, from);
        for _ in 0..60 {
            run.step();
        }
        let o = run.objects.iter().find(|o| o.id == id).unwrap();
        assert!(o.pos.x + BARREL_RADIUS <= (tx + 3) as f64 * crate::dungeon::TILE + 1e-6, "stopped at the wall");

        // Another barrel in the way stops it too (and is not moved).
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        run.objects.retain(|o| o.kind != EntityKind::Barrel); // the dungeon's own
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        for x in tx - 1..=tx + 6 {
            run.layout.map.set(x, ty, crate::dungeon::Tile::Floor);
        }
        let (id, oi) = barrel_at(&mut run, Vec2::new(PLAYER_RADIUS + BARREL_RADIUS + 2.0, 0.0));
        let (other, _) = barrel_at(&mut run, Vec2::new(3.0 * crate::dungeon::TILE, 0.0));
        let start = run.objects[oi].pos;
        let b0 = run.objects.iter().find(|o| o.id == other).unwrap().pos;
        let from = run.players[0].pos();
        push_barrel(&mut run, oi, from);
        step_for(&mut run, 1.0);
        let a = run.objects.iter().find(|o| o.id == id).unwrap().pos;
        let b = run.objects.iter().find(|o| o.id == other).unwrap().pos;
        assert_eq!(b, b0, "the barrel it ran into stays put");
        assert!(a.x > start.x + 1.0, "it slid");
        assert!(a.x + BARREL_RADIUS <= b.x - BARREL_RADIUS + 1e-6, "stopped at the other barrel ({} vs {})", a.x, b.x);
    }

    #[test]
    fn a_pushed_barrel_rests_on_the_wire_grid() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        run.objects.retain(|o| o.kind != EntityKind::Barrel);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        for x in tx - 1..=tx + 8 {
            run.layout.map.set(x, ty, crate::dungeon::Tile::Floor);
        }
        // Off the grid to begin with (and pushed at a slight angle).
        let (id, oi) = barrel_at(&mut run, Vec2::new(PLAYER_RADIUS + BARREL_RADIUS + 2.013, 0.37));
        let from = run.players[0].pos() - Vec2::new(0.0, 0.4);
        push_barrel(&mut run, oi, from);
        let start = run.objects[oi].pos;
        let mut seen_moving = false;
        for _ in 0..60 {
            run.step();
            let p = run.objects.iter().find(|o| o.id == id).unwrap().pos;
            if p != start {
                seen_moving = true;
                for v in [p.x, p.y] {
                    let k = v * crate::wire::POS_SCALE;
                    assert_eq!(k, k.round(), "{v} is on the 1/16 px grid");
                    assert_eq!(crate::wire::q_pos(v) as f64 / crate::wire::POS_SCALE, v, "the wire carries {v} exactly");
                }
            }
        }
        assert!(seen_moving);
    }

    /// Open floor around the hero, no monsters but the boss, no dungeon barrels.
    fn clear_run(boss: BossId) -> Run {
        let mut run = test_run(&[ClassId::Paladin], boss);
        run.monsters.retain(|m| m.is_boss);
        run.objects.retain(|o| o.kind != EntityKind::Barrel);
        run.players[0].debug = true;
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        for y in ty - 3..=ty + 3 {
            for x in tx - 6..=tx + 6 {
                run.layout.map.set(x, y, crate::dungeon::Tile::Floor);
            }
        }
        run
    }

    fn monster_at(run: &mut Run, off: Vec2) -> usize {
        let at = run.players[0].pos() + off;
        let id = run.spawn_enemy(crate::defs::enemies::EnemyType::OrcWarrior, at, None, 1);
        run.monster_idx(id).unwrap()
    }

    #[test]
    fn the_blast_hurts_and_pushes_a_nearby_monster() {
        let mut run = clear_run(BossId::Lich);
        let (_, oi) = barrel_at(&mut run, Vec2::new(16.0, 0.0));
        let mi = monster_at(&mut run, Vec2::new(40.0, 0.0));
        let hp = run.monsters[mi].hp;
        explode_barrel(&mut run, oi);
        assert!(run.monsters[mi].hp < hp, "hurt");
        assert!(run.monsters[mi].knock.x > 0.0, "pushed away (east)");
    }

    #[test]
    fn the_blast_hurts_a_boss_but_does_not_push_it() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.objects.retain(|o| o.kind != EntityKind::Barrel);
        let bi = crate::run::bosses::boss_idx(&run).unwrap();
        let at = run.monsters[bi].pos;
        let hp = run.monsters[bi].hp;
        run.spawn_object(EntityKind::Barrel, at + Vec2::new(20.0, 0.0), ObjState::Barrel(Barrel::new()));
        let oi = run.objects.len() - 1;
        explode_barrel(&mut run, oi);
        assert!(run.monsters[bi].hp < hp, "hurt");
        assert_eq!(run.monsters[bi].knock, Vec2::ZERO, "bosses are never pushed");
    }

    #[test]
    fn the_blast_does_not_go_through_walls() {
        let mut run = clear_run(BossId::Lich);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        for y in ty - 1..=ty + 1 {
            run.layout.map.set(tx + 2, y, crate::dungeon::Tile::Wall);
        }
        let t = crate::dungeon::TILE;
        let (_, oi) = barrel_at(&mut run, Vec2::new(t, 0.0));
        let behind = monster_at(&mut run, Vec2::new(3.0 * t, 0.0));
        let open = monster_at(&mut run, Vec2::new(-t, 0.0));
        let (hb, ho) = (run.monsters[behind].hp, run.monsters[open].hp);
        explode_barrel(&mut run, oi);
        assert_eq!(run.monsters[behind].hp, hb, "the wall shields it");
        assert!(run.monsters[open].hp < ho, "the same distance in the open hurts");
    }

    #[test]
    fn kills_and_damage_of_the_blast_go_to_the_igniter() {
        let mut run = clear_run(BossId::Lich);
        let (_, oi) = barrel_at(&mut run, Vec2::new(16.0, 0.0));
        let mi = monster_at(&mut run, Vec2::new(40.0, 0.0));
        run.monsters[mi].hp = 1.0;
        let pid = run.players[0].id;
        let (kills, dmg) = (run.players[0].kills, run.players[0].damage);
        hurt_object(&mut run, oi, Damage::physical(1.0), Some(pid));
        explode_barrel(&mut run, oi);
        assert!(!run.monsters[mi].alive, "killed");
        assert_eq!(run.players[0].kills, kills + 1, "the kill is the igniter's");
        assert!(run.players[0].damage > dmg, "and so is the damage");
    }

    #[test]
    fn fire_patches_light_barrels() {
        let mut run = clear_run(BossId::Lich);
        let (_, oi) = barrel_at(&mut run, Vec2::new(40.0, 0.0));
        let at = run.objects[oi].pos + Vec2::new(12.0, 0.0);
        run.spawn_hazard(EntityKind::FirePatch, at, 10.0, 3.0, 8.0);
        run.tick_hazards(0.3);
        assert!(lit(&run, oi));
    }

    #[test]
    fn objects_in_finds_footprints_in_reach_and_in_the_cone() {
        let mut run = clear_run(BossId::Lich);
        let (_, east) = barrel_at(&mut run, Vec2::new(30.0, 0.0));
        let (_, west) = barrel_at(&mut run, Vec2::new(-30.0, 0.0));
        let at = run.players[0].pos();
        assert_eq!(objects_in(&run, at, 30.0 - BARREL_RADIUS, None), vec![east, west], "touching the footprint counts");
        assert!(objects_in(&run, at, 20.0, None).is_empty());
        assert_eq!(objects_in(&run, at, 40.0, Some((0.0, 0.5))), vec![east], "only the one in the cone");
    }

    /// A barrel pushed east into fresh terrain `t` two tiles from the hero.
    fn pushed_into(t: crate::dungeon::Tile) -> (Run, u32) {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        run.players[0].debug = true;
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        run.layout.map.set(tx + 1, ty, crate::dungeon::Tile::Floor);
        run.layout.map.set(tx + 2, ty, crate::dungeon::Tile::Floor);
        run.layout.map.set(tx + 3, ty, t);
        let (id, oi) = barrel_at(&mut run, Vec2::new(PLAYER_RADIUS + BARREL_RADIUS + 2.0, 0.0));
        let from = run.players[0].pos();
        push_barrel(&mut run, oi, from);
        run.events.clear();
        (run, id)
    }

    #[test]
    fn barrels_fall_into_chasms_sink_in_water_and_explode_in_lava() {
        use crate::dungeon::Tile;
        let (mut run, id) = pushed_into(Tile::Chasm);
        step_for(&mut run, 1.0 + crate::dungeon::FALL_TIME);
        assert!(run.objects.iter().all(|o| o.id != id) && booms(&run) == 0, "fell without a bang");
        let (mut run, id) = pushed_into(Tile::DeepWater);
        step_for(&mut run, 1.0 + crate::dungeon::DROWN_TIME);
        assert!(run.objects.iter().all(|o| o.id != id) && booms(&run) == 0, "sank without a bang");
        let (mut run, _) = pushed_into(Tile::Lava);
        step_for(&mut run, 1.0);
        assert_eq!(booms(&run), 1, "lava sets it off");
    }

    #[test]
    fn a_lit_barrel_explodes_after_the_fuse_and_hurts_and_pushes_heroes() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        run.objects.retain(|o| o.kind != EntityKind::Barrel); // the dungeon's own
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
        run.objects.retain(|o| o.kind != EntityKind::Barrel); // the dungeon's own
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

    use crate::dungeon::{Map, Tile, TorchSide, TorchSpawn};

    /// A torch on the brick face just north of the hero, on open floor.
    fn torch_run() -> (Run, usize) {
        let mut run = clear_run(BossId::Lich);
        run.lights = crate::run::light::Lights::new(run.layout.map.w, run.layout.map.h);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for x in tx - 6..=tx + 6 {
            run.layout.map.set(x, ty - 2, Tile::Wall);
        }
        run.spawn_torch(&TorchSpawn { wall: (tx, ty - 2), side: TorchSide::Face });
        let oi = run.objects.len() - 1;
        (run, oi)
    }

    fn torch_lit(run: &Run, oi: usize) -> bool {
        matches!(run.objects[oi].state, ObjState::Torch { light, .. } if torch_on(run, light))
    }

    #[test]
    fn a_torch_lights_the_floor_in_front_of_it() {
        let (mut run, oi) = torch_run();
        assert!(torch_lit(&run, oi));
        let p = run.players[0].pos();
        assert!(run.is_lit(p));
        assert_eq!(snap(&run, &run.objects[oi]).5, 1);
        assert_eq!(snap(&run, &run.objects[oi]).9, TorchSide::Face as u32);
        assert!(run.objects[oi].owns_light() && !run.objects[oi].solid);
    }

    #[test]
    fn e_toggles_a_torch_in_reach() {
        let (mut run, oi) = torch_run();
        let wall_y = (Map::tile_of(run.players[0].pos()).1 - 1) as f64 * crate::dungeon::TILE;
        run.players[0].mv.y = wall_y + crate::defs::classes::PLAYER_RADIUS + 0.5; // against the wall
        run.players[0].mv.x = run.objects[oi].pos.x; // right under the torch
        push(&mut run);
        assert!(!torch_lit(&run, oi), "out");
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Light { on: false, .. })));
        push(&mut run);
        assert!(torch_lit(&run, oi), "and lit again");
    }

    #[test]
    fn heat_lights_a_torch_other_damage_puts_it_out() {
        let (mut run, oi) = torch_run();
        hurt_object(&mut run, oi, Damage::new(5.0, DamageSplit::pure(DamageType::Cold)), None);
        assert!(!torch_lit(&run, oi), "cold puts it out");
        hurt_object(&mut run, oi, Damage::new(5.0, DamageSplit::split(&[(DamageType::Heat, 0.3)])), None);
        assert!(torch_lit(&run, oi), "any heat lights it");
        hurt_object(&mut run, oi, Damage::physical(5.0), None);
        assert!(!torch_lit(&run, oi), "a sword puts it out");
        hurt_object(&mut run, oi, Damage::new(5.0, DamageSplit::pure(DamageType::Poison)), None);
        assert!(!torch_lit(&run, oi), "poison does nothing (objects resist it)");
        assert!(!run.objects[oi].gone, "torches never break");
    }

    #[test]
    fn a_barrel_blast_lights_a_torch() {
        let (mut run, oi) = torch_run();
        set_torch(&mut run, oi, false);
        let (_, bi) = barrel_at(&mut run, Vec2::new(0.0, -6.0));
        explode_barrel(&mut run, bi);
        assert!(torch_lit(&run, oi));
    }

    #[test]
    fn a_shot_into_the_torch_wall_hits_the_torch() {
        let (mut run, oi) = torch_run();
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        let from = Map::center_of(tx, ty - 1); // between the hero and the wall, flying away from the hero
        crate::run::abilities::spawn_monster_projectile(&mut run, 999, EntityKind::Arrow, from, Vec2::new(0.0, -1.0), 200.0, 5.0, 2.0, 0.0, 0, 0.0);
        step_for(&mut run, 0.3);
        assert!(!torch_lit(&run, oi), "an arrow puts it out");
    }

    #[test]
    fn a_barrel_blast_flashes_light() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        let (_, oi) = barrel_at(&mut run, Vec2::new(40.0, 0.0));
        let pos = run.objects[oi].pos;
        explode_barrel(&mut run, oi);
        let flash = run.lights.sources.iter().find(|s| s.kind == crate::defs::lights::LightKind::Blast).expect("a flash");
        assert_eq!(flash.anchor, crate::run::light::Anchor::Point(pos));
        assert!(run.moving_lights().iter().any(|l| l.kind == crate::defs::lights::LightKind::Blast));
    }
}
