//! The module layer of a creature's behaviour: what an ability brings with it. `AbilityDef.module` names
//! the module; the base AI (run/ai.rs) asks the kit's modules, in kit order, at fixed points. A hook
//! returns true when its module claimed the tick, else the base AI goes on. Giving a creature the
//! ability gives it the behaviour.

use super::abilities::{monster_dash_secs, monster_dash_to, monster_use, tick_monster_dash};
use super::ai::{set_anim, SWING_SLACK};
use super::effects::Creature;
use super::entities::{MonsterDash, Windup};
use super::Run;
use crate::collision::line_of_sight;
use crate::defs::abilities::{self as ab, AbilityId, Module, Shape};
use crate::defs::kinds::Anim;
use crate::dungeon::{Mover, Tile};
use crate::math::Vec2;

/// The dash that just ended (what `tick_monster_dash` returns).
pub type DashDone = MonsterDash;

/// The modules of monster `mi`'s kit, in kit order.
fn kit_modules(run: &Run, mi: usize) -> Vec<Module> {
    run.monsters[mi].kit.iter().filter_map(|a| ab::def(a.id).module).collect()
}

/// A foe may be in sight (`seen`): Ambush vanishes, drifts and strikes.
pub fn on_sight(run: &mut Run, mi: usize, dt: f64, seen: Option<Creature>) -> bool {
    for module in kit_modules(run, mi) {
        let claimed = match module {
            Module::Ambush => super::ambush::tick(run, mi, dt, seen),
            Module::Leap | Module::Minions => false,
        };
        if claimed {
            return true;
        }
    }
    false
}

/// Where the base AI would choose its attack: Minions run a cast or start one.
pub fn on_act(run: &mut Run, mi: usize, dt: f64, seen: Option<Creature>) -> bool {
    for module in kit_modules(run, mi) {
        let claimed = match module {
            Module::Minions => super::minions::act(run, mi, dt, seen),
            Module::Leap => seen.is_some_and(|foe| leap_start(run, mi, foe)),
            Module::Ambush => false,
        };
        if claimed {
            return true;
        }
    }
    false
}

/// A wind-up for ability `id` ran out (`seen`: the foe still in sight). True when its module handled it.
pub fn on_windup_end(run: &mut Run, mi: usize, id: AbilityId, seen: Option<Creature>) -> bool {
    match ab::def(id).module {
        Some(Module::Leap) => {
            leap_end(run, mi, id, seen);
            true
        }
        Some(Module::Ambush | Module::Minions) | None => false,
    }
}

/// One tick of monster `mi`'s dash. When it ends, its module hears of it (`on_dash_end`).
pub fn dash_step(run: &mut Run, mi: usize, dt: f64) {
    if let Some(done) = tick_monster_dash(run, mi, dt) {
        on_dash_end(run, mi, &done);
    }
}

/// One of the creature's dashes finished (`done`). A Leap that hurt its foe holds the next swing back
/// a cooldown, and an attack dash that ended on ground it cannot stand on carries on (`overrun`).
pub fn on_dash_end(run: &mut Run, mi: usize, done: &DashDone) {
    if ab::def(done.id).module != Some(Module::Leap) {
        return;
    }
    if !done.hit.is_empty() {
        let main = run.monsters[mi].kit.first().expect("a creature has its main ability").cooldown;
        let ai = &mut run.monsters[mi].ai;
        ai.cd = ai.cd.max(main);
    }
    if done.attack && run.layout.map.blocks_at(run.monsters[mi].pos, run.monsters[mi].mover) {
        overrun(run, mi, done.id, done.dir);
    }
}

/// The creature stands on `tile`. On a chasm, deep water or (unless it walks lava) lava, with its Leap
/// ready, it leaps back to the last safe tile it stood on, and the Leap's cooldown starts. True if it did.
/// A creature that cannot act (asleep, stoned, or fleeing in fear: `Run::step` skips its tick) does not: its
/// dash would never tick, so it falls, drowns or burns like any creature.
pub fn on_danger(run: &mut Run, mi: usize, tile: u8) -> bool {
    let m = &run.monsters[mi];
    if m.effects.no_act() || m.effects.fear_from().is_some() && !m.hiding && !m.dormant {
        return false;
    }
    let deadly = tile == Tile::Chasm as u8 || tile == Tile::DeepWater as u8 || tile == Tile::Lava as u8 && m.mover != Mover::Demon;
    let Some(id) = leap_ability(run, mi) else { return false };
    if !deadly || !m.cds.ready(id) {
        return false;
    }
    run.monsters[mi].knock = Vec2::ZERO;
    dash_back(run, mi, id);
    true
}

/// The ability of monster `mi`'s kit that brings the Leap module, if any.
fn leap_ability(run: &Run, mi: usize) -> Option<AbilityId> {
    run.monsters[mi].kit.iter().map(|a| a.id).find(|&id| ab::def(id).module == Some(Module::Leap))
}

/// Whether a leap of `id` from monster `mi` toward `at` ends on ground it can stand on.
fn lands_safely(run: &Run, mi: usize, id: AbilityId, at: Vec2) -> bool {
    let a = run.monsters[mi].kit.get(id).expect("the creature leaps with its kit");
    let (pos, d) = (run.monsters[mi].pos, run.monsters[mi].pos.dist(at));
    let dir = (at - pos).norm();
    !run.layout.map.blocks_at(pos + dir * (a.speed * monster_dash_secs(a, d)), run.monsters[mi].mover)
}

/// The Leap module's start: with the leap ready, a foe beyond the main attack's reach (plus 8) and
/// within the leap's range, in line of sight, and landing ground it can stand on, monster `mi` winds
/// up. The leap itself starts when the wind-up is over (`on_windup_end`). True if the wind-up started.
pub fn leap_start(run: &mut Run, mi: usize, foe: Creature) -> bool {
    let Some(id) = leap_ability(run, mi) else { return false };
    let m = &run.monsters[mi];
    if !m.cds.ready(id) {
        return false;
    }
    let (pos, fpos, radii) = (m.pos, run.creature_pos(foe), m.radius + run.creature_radius(foe));
    let leap = m.kit.get(id).expect("leap_ability found it").clone();
    let main = m.kit.first().expect("a creature has its main ability");
    // A swing starts a little inside its real reach, like the base AI's.
    let reach = match ab::def(main.id).shape {
        Shape::Swing => main.range + run.creature_radius(foe) - SWING_SLACK,
        _ => main.range,
    };
    let d = pos.dist(fpos);
    if d <= reach + 8.0 || d > leap.range + radii || !line_of_sight(&run.layout.map, pos, fpos) || !lands_safely(run, mi, id, fpos) {
        return false;
    }
    let aim = pos.angle_to(fpos);
    run.start_windup(mi, Windup { t: leap.windup, aim, alt: true, at: None, id: Some(id) });
    run.monsters[mi].ai.path.clear();
    set_anim(run, mi, Anim::Windup);
    true
}

/// The leap's wind-up is over: it leaps at the foe if it is still seen and the landing is still safe, else it stops.
fn leap_end(run: &mut Run, mi: usize, id: AbilityId, seen: Option<Creature>) {
    if let Some(foe) = seen {
        let at = run.creature_pos(foe);
        if lands_safely(run, mi, id, at) {
            monster_use(run, mi, id, at);
            return;
        }
    }
    set_anim(run, mi, Anim::Idle);
}

/// A leap that ended over ground the creature cannot stand on (it touched its foe above a chasm): it
/// carries on along `dir`, without more damage, to the first walkable ground within the leap's range.
/// With none before a wall or that far, it dashes back to its last safe tile.
fn overrun(run: &mut Run, mi: usize, id: AbilityId, dir: Vec2) {
    let range = run.monsters[mi].kit.get(id).expect("the creature leaps with its kit").range;
    let (map, pos, r, mover) = (&run.layout.map, run.monsters[mi].pos, run.monsters[mi].radius, run.monsters[mi].mover);
    let land = (1..=(range / 2.0) as usize)
        .map(|i| pos + dir * (i as f64 * 2.0))
        .take_while(|&p| !map.blocks_at(p, Mover::Dash))
        .find(|&p| !map.blocks_at(p, mover))
        .map(|p| p + dir * r) // a body's width onto the ground
        .filter(|&p| !map.blocks_at(p, mover));
    match land {
        Some(to) => {
            monster_dash_to(run, mi, id, to, false);
            set_anim(run, mi, Anim::Dash);
        }
        None => dash_back(run, mi, id),
    }
}

/// Monster `mi` leaps with `id`, hurting nothing, straight back to the last safe tile it stood on. That
/// uses the ability (its cooldown starts).
pub fn dash_back(run: &mut Run, mi: usize, id: AbilityId) {
    let m = &mut run.monsters[mi];
    m.ai.windup = None;
    m.ai.path.clear();
    let to = m.last_safe;
    monster_dash_to(run, mi, id, to, true);
    set_anim(run, mi, Anim::Dash);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::abilities::AbilityId;
    use crate::defs::effects::EffectKind;
    use crate::defs::enemies::{self, EnemyType};
    use crate::dungeon::{Map, LAVA_DAMAGE};
    use crate::run::entities::Sink;
    use crate::protocol::{BossId, ClassId};
    use crate::run::ai::tests::open_floor;
    use crate::run::tests::test_run;

    /// An orc given Pounce (not in its def), standing on the centre of the tile `dx` east of the first hero's,
    /// held in place; its last safe tile is the tile beside it. Open floor around, lights on.
    fn leaper(dx: i32) -> (Run, usize) {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        let id = run.spawn_enemy(EnemyType::OrcWarrior, Map::center_of(tx + dx, ty), None);
        let mi = run.monster_idx(id).unwrap();
        let (m, d) = (&run.monsters[mi], enemies::def(EnemyType::OrcWarrior));
        let abilities = [d.abilities, &[AbilityId::Pounce]].concat();
        run.monsters[mi].kit = crate::sheet::monster_kit(&abilities, &m.attrs, d.weapons, crate::sheet::Body { radius: m.radius }, &[]);
        run.monsters[mi].ai.hold = 99.0;
        run.monsters[mi].last_safe = Map::center_of(tx + dx - 2, ty);
        (run, mi)
    }

    fn make(run: &mut Run, mi: usize, tile: Tile) {
        let (tx, ty) = Map::tile_of(run.monsters[mi].pos);
        for y in ty - 1..=ty + 1 {
            for x in tx - 1..=tx + 1 {
                run.layout.map.set(x, y, tile);
            }
        }
    }

    /// The leaper stands on `tile` with Pounce ready: it leaps to its last safe tile, unhurt.
    fn leaps_back_from(tile: Tile) {
        let (mut run, mi) = leaper(5);
        make(&mut run, mi, tile);
        let safe = run.monsters[mi].last_safe;
        run.step();
        assert!(run.monsters[mi].dash.is_some(), "it leapt");
        assert!(!run.monsters[mi].cds.ready(AbilityId::Pounce), "the Pounce cooldown started");
        for _ in 0..60 {
            run.step();
        }
        let m = &run.monsters[mi];
        assert!(m.alive && m.sinking.is_none(), "not sinking");
        assert!(m.pos.dist(safe) < 6.0, "back on its last safe tile: {:?} vs {safe:?}", m.pos);
        assert_eq!(m.hp, m.max_hp, "not burning");
    }

    #[test]
    fn a_leaper_on_a_chasm_with_pounce_ready_leaps_back() {
        leaps_back_from(Tile::Chasm);
    }

    #[test]
    fn a_leaper_on_deep_water_with_pounce_ready_leaps_back() {
        leaps_back_from(Tile::DeepWater);
    }

    #[test]
    fn a_leaper_on_lava_with_pounce_ready_leaps_back() {
        leaps_back_from(Tile::Lava);
    }

    /// The same with Pounce cooling down: it is a creature like any other.
    fn suffers(tile: Tile) -> (Run, usize) {
        let (mut run, mi) = leaper(5);
        make(&mut run, mi, tile);
        run.monsters[mi].cds.start(AbilityId::Pounce, 99.0);
        (run, mi)
    }

    #[test]
    fn a_leaper_on_a_chasm_with_pounce_cooling_falls() {
        let (mut run, mi) = suffers(Tile::Chasm);
        let id = run.monsters[mi].id;
        run.step();
        assert!(run.monsters[mi].dash.is_none() && run.monsters[mi].sinking.is_some_and(|(_, how)| how == Sink::Fall));
        for _ in 0..60 {
            run.step();
        }
        assert!(run.monsters.iter().all(|m| m.id != id), "it fell and is gone");
    }

    /// A leaper that cannot act does not leap: with Pounce ready it still falls (a dash it could never tick would hang it in the air).
    #[test]
    fn a_sleeping_or_petrified_or_frightened_leaper_on_a_chasm_falls() {
        for fx in [EffectKind::Sleep, EffectKind::Petrified, EffectKind::Fear] {
            let (mut run, mi) = leaper(5);
            make(&mut run, mi, Tile::Chasm);
            let id = run.monsters[mi].id;
            assert!(run.monsters[mi].cds.ready(AbilityId::Pounce));
            run.monsters[mi].effects.add(fx, 30.0);
            if fx == EffectKind::Fear {
                run.monsters[mi].effects.set_fear_from(run.players[0].pos());
            }
            run.step();
            assert!(run.monsters[mi].dash.is_none(), "{fx:?}: no leap");
            assert!(run.monsters[mi].sinking.is_some_and(|(_, how)| how == Sink::Fall), "{fx:?}: it falls");
            assert!(run.monsters[mi].cds.ready(AbilityId::Pounce), "{fx:?}: the cooldown did not start");
            for _ in 0..60 {
                run.step();
            }
            assert!(run.monsters.iter().all(|m| m.id != id), "{fx:?}: it fell and is gone");
        }
    }

    #[test]
    fn a_leaper_on_deep_water_with_pounce_cooling_drowns() {
        let (mut run, mi) = suffers(Tile::DeepWater);
        let id = run.monsters[mi].id;
        run.step();
        assert!(run.monsters[mi].dash.is_none() && run.monsters[mi].sinking.is_some_and(|(_, how)| how == Sink::Drown));
        for _ in 0..80 {
            run.step();
        }
        assert!(run.monsters.iter().all(|m| m.id != id), "it drowned and is gone");
    }

    #[test]
    fn a_leaper_on_lava_with_pounce_cooling_burns() {
        let (mut run, mi) = suffers(Tile::Lava);
        let hp = run.monsters[mi].hp;
        run.step();
        assert!(run.monsters[mi].dash.is_none());
        assert_eq!(run.monsters[mi].hp, hp - LAVA_DAMAGE, "the first touch burns at once");
    }

    #[test]
    fn a_leap_never_lands_on_ground_it_cannot_stand_on() {
        let (mut run, mi) = leaper(0);
        let (tx, ty) = Map::tile_of(run.monsters[mi].pos);
        // The hero 40 px east: out of reach of the swing, within the leap. It would land 55 px east.
        run.players[0].mv.x = run.monsters[mi].pos.x + 40.0;
        run.players[0].mv.y = run.monsters[mi].pos.y;
        let foe = Creature::Player(0);
        assert!(leap_start(&mut run, mi, foe), "control: over floor it winds up");
        run.monsters[mi].ai.windup = None;
        for y in ty - 1..=ty + 1 {
            for x in tx + 3..=tx + 5 {
                run.layout.map.set(x, y, Tile::Chasm);
            }
        }
        assert!(!leap_start(&mut run, mi, foe), "over a chasm it does not");
        assert!(run.monsters[mi].ai.windup.is_none());
    }

    #[test]
    fn a_hurting_leap_holds_the_next_swing_one_cooldown() {
        let (mut run, mi) = leaper(0);
        run.monsters[mi].ai.hold = 0.0;
        run.players[0].mv.x = run.monsters[mi].pos.x + 40.0;
        run.players[0].mv.y = run.monsters[mi].pos.y;
        let hp = run.players[0].hp;
        let main = run.monsters[mi].kit.first().unwrap().cooldown;
        let mut ended = false;
        for _ in 0..120 {
            let dashing = run.monsters[mi].dash.is_some();
            run.step();
            if dashing && run.monsters[mi].dash.is_none() {
                ended = true;
                break;
            }
        }
        assert!(ended && run.players[0].hp < hp, "the leap hurt the hero");
        assert!(run.monsters[mi].ai.cd >= main - 1e-9, "the next swing waits a cooldown: {} < {main}", run.monsters[mi].ai.cd);
    }
}
