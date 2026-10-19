//! The Elven Ranger's wolf: an ally monster. Spawn, behaviour and death here.

use super::entities::{Ai, Ally, Monster, Windup, WolfDash, HISTORY_LEN};
use super::{ai, perception, Run};
use crate::collision::{line_of_sight, move_box, walk_line};
use crate::defs::companions::*;
use crate::defs::damage::Damage;
use crate::defs::kinds::{Anim, EntityKind};
use crate::dungeon::{self, Map, Mover};
use crate::math::Vec2;
use crate::protocol::Ev;
use std::collections::VecDeque;

/// The first of 8 points 12 px around `pos` (east first, then clockwise) where the
/// wolf can stand: walkable ground, clear of solid objects. None when there is no such point.
pub fn spot_beside(run: &Run, pos: Vec2) -> Option<Vec2> {
    let solids = run.solids(None);
    (0..8)
        .map(|i| pos + Vec2::from_angle(i as f64 * std::f64::consts::FRAC_PI_4) * 12.0)
        .find(|&p| !run.layout.map.blocks_at(p, Mover::Enemy) && !solids.iter().any(|s| (p.x - s.x).abs() < s.half + WOLF_RADIUS && (p.y - s.y).abs() < s.half + WOLF_RADIUS))
}

/// Where a summoned wolf appears: beside `pos`, else the nearest walkable tile centre within
/// 2 tiles, else `pos` itself (a summon is never refused).
fn summon_spot(run: &Run, pos: Vec2) -> Vec2 {
    spot_beside(run, pos).unwrap_or_else(|| {
        let (tx, ty) = Map::tile_of(pos);
        (-2i32..=2)
            .flat_map(|dy| (-2i32..=2).map(move |dx| (tx + dx, ty + dy)))
            .map(|(x, y)| Map::center_of(x, y))
            .filter(|&c| !run.layout.map.blocks_at(c, Mover::Enemy))
            .min_by(|a, b| a.dist(pos).total_cmp(&b.dist(pos)))
            .unwrap_or(pos)
    })
}

/// Summons the wolf of hero `pi` beside them and returns its id.
pub fn spawn_wolf(run: &mut Run, pi: usize) -> u32 {
    let prof = wolf_profile();
    let owner = run.players[pi].id;
    let spot = summon_spot(run, run.players[pi].pos());
    let (tx, ty) = Map::tile_of(spot);
    let id = run.alloc_id();
    run.monsters.push(Monster {
        id,
        res: prof.res,
        melee: prof.melee,
        etype: None,
        kind: EntityKind::DireWolf,
        pos: spot,
        hp: WOLF_HP,
        max_hp: WOLF_HP,
        speed: WOLF_SPEED,
        radius: WOLF_RADIUS,
        sight: prof.sight,
        alive: true,
        aim: 0.0,
        anim: Anim::Idle,
        anim_start: run.time,
        hurt_t: 0.0,
        ai: Ai::new(spot),
        owner: None,
        history: VecDeque::with_capacity(HISTORY_LEN),
        is_boss: false,
        dormant: false,
        hiding: false,
        mover: Mover::Enemy,
        airborne: false,
        knock: Vec2::ZERO,
        sinking: None,
        burn_t: dungeon::LAVA_TICK,
        last_hit_by: None,
        effects: Default::default(),
        responses: wolf_responses(),
        ally: Some(Ally {
            owner,
            growled: Vec::new(),
            growl_cd: 0.0,
            growl_to: None,
            hold: 0.0,
            prey: None,
            following: false,
            reach_t: 0.0,
            dash: None,
            dash_cd: 0.0,
            last_safe: Map::center_of(tx, ty),
        }),
    });
    run.players[pi].wolf = Some(id);
    run.event(Ev::Boom { x: spot.x as f32, y: spot.y as f32, r: 10.0, k: 9 }, None);
    id
}

/// The ranger's secondary: summons the wolf, or heals the living one by its share of max HP.
pub fn use_ability(run: &mut Run, pi: usize) {
    match run.players[pi].wolf.and_then(|id| run.monster_idx(id)) {
        Some(mi) if run.monsters[mi].alive => {
            run.heal_monster(mi, WOLF_HP * WOLF_HEAL_SHARE);
        }
        _ => {
            spawn_wolf(run, pi);
        }
    }
}

/// Allies whose owner is no longer a living hero (fallen or left) vanish at once, with a puff:
/// no death event, no message, no cooldown.
pub fn vanish_orphans(run: &mut Run) {
    for mi in 0..run.monsters.len() {
        let m = &run.monsters[mi];
        let Some(owner) = m.ally.as_ref().map(|a| a.owner).filter(|_| m.alive) else { continue };
        let pi = run.player_idx(owner);
        if pi.is_some_and(|pi| run.players[pi].alive) {
            continue;
        }
        let pos = m.pos;
        run.monsters[mi].alive = false;
        if let Some(pi) = pi {
            run.players[pi].wolf = None;
        }
        run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: 10.0, k: 9 }, None);
    }
}

fn ally_mut(run: &mut Run, mi: usize) -> &mut Ally {
    run.monsters[mi].ally.as_mut().expect("an ally")
}

fn set_anim(run: &mut Run, mi: usize, a: Anim) {
    let m = &mut run.monsters[mi];
    if m.anim != a {
        m.anim = a;
        m.anim_start = run.time;
    }
}

/// The wolf `mi` this tick: reappear, dash, bite, guard, (growl,) follow. Not called
/// while it is pushed, sinking, asleep or frozen (`Run::step`).
pub fn tick_wolf(run: &mut Run, mi: usize, dt: f64) {
    // 1. The ranger.
    let Some(owner) = run.monsters[mi].ally.as_ref().map(|a| a.owner) else { return };
    let Some(pi) = run.player_idx(owner).filter(|&pi| run.players[pi].alive) else { return };
    let ranger = run.players[pi].pos();

    // 2. Reappear beside the ranger when far, or every 0.5 s when it cannot reach them.
    //    Mid-dash it may be over a chasm, where no path starts: no reach check then.
    let pos = run.monsters[mi].pos;
    let dashing = run.monsters[mi].ally.as_ref().is_some_and(|a| a.dash.is_some());
    let mut lost = pos.dist(ranger) > WOLF_REAPPEAR;
    let a = ally_mut(run, mi);
    a.reach_t -= dt;
    if a.reach_t <= 0.0 && !dashing {
        a.reach_t = WOLF_REACH_EVERY;
        let map = &run.layout.map;
        // A ranger on lava or over a chasm cannot be reached on foot, and no spot beside her is safe.
        lost |= !map.blocks_at(ranger, Mover::Enemy) && !(walk_line(map, pos, ranger, Mover::Enemy) || ai::astar(map, pos, ranger, 2500, Mover::Enemy).is_some());
    }
    if lost && reappear(run, mi, ranger) {
        return;
    }

    // 3. Timers.
    {
        let m = &mut run.monsters[mi];
        m.ai.cd -= dt;
        let a = m.ally.as_mut().expect("an ally");
        a.dash_cd -= dt;
        a.growl_cd -= dt;
        a.hold = (a.hold - dt).max(0.0);
    }
    // Enemies that died may be growled at again as new ones: drop their ids.
    let mut growled = std::mem::take(&mut ally_mut(run, mi).growled);
    growled.retain(|&g| run.monster_idx(g).is_some_and(|i| run.monsters[i].alive));
    ally_mut(run, mi).growled = growled;

    // 3a. A dash in progress.
    if let Some(dash) = run.monsters[mi].ally.as_ref().and_then(|a| a.dash) {
        tick_dash(run, mi, pi, dash, dt);
        return;
    }

    // Blown into lava: walk out first, like any monster.
    if run.layout.map.blocks_at(run.monsters[mi].pos, Mover::Enemy) {
        ai::escape_terrain(run, mi, dt);
        return;
    }

    // 4. A bite wind-up.
    if let Some(w) = run.monsters[mi].ai.windup {
        let t = w.t - dt;
        if t > 0.0 {
            run.monsters[mi].ai.windup = Some(Windup { t, ..w });
            return;
        }
        run.monsters[mi].ai.windup = None;
        let prey = run.monsters[mi].ally.as_ref().and_then(|a| a.prey).and_then(|id| run.monster_idx(id));
        if let Some(ei) = prey.filter(|&ei| run.monsters[ei].alive) {
            let (w, e) = (&run.monsters[mi], &run.monsters[ei]);
            if w.pos.dist(e.pos) <= WOLF_BITE_RANGE + w.radius + e.radius + 4.0 {
                let (from, melee) = (w.pos, w.melee);
                run.monsters[mi].aim = from.angle_to(e.pos);
                run.hurt_monster(ei, Damage::new(WOLF_BITE_DAMAGE, melee), false, Some(pi));
                run.knock_monster(ei, from, WOLF_BITE_KNOCK);
            }
        }
        run.monsters[mi].ai.cd = WOLF_BITE_COOLDOWN;
        set_anim(run, mi, Anim::Melee);
        return;
    }

    // 5. Prey: the enemy nearest the ranger among those near the ranger or the wolf itself.
    let prey = find_prey(run, mi, ranger);
    ally_mut(run, mi).prey = prey.map(|ei| run.monsters[ei].id);
    if let Some(ei) = prey {
        let (w, e) = (&run.monsters[mi], &run.monsters[ei]);
        let (pos, epos) = (w.pos, e.pos);
        let radii = w.radius + e.radius;
        let d = pos.dist(epos);
        let reach = WOLF_BITE_RANGE + radii;
        let dash_ready = w.ally.as_ref().is_some_and(|a| a.dash_cd <= 0.0);
        let aim = pos.angle_to(epos);
        run.monsters[mi].aim = aim;
        if d > reach + 8.0 && d <= WOLF_DASH_RANGE + radii && dash_ready && line_of_sight(&run.layout.map, pos, epos) {
            let dir = (epos - pos).norm();
            let left = d / WOLF_DASH_SPEED + 0.05;
            // Never a jump to its death: the dash must end on walkable ground.
            if !run.layout.map.blocks_at(pos + dir * (WOLF_DASH_SPEED * left), Mover::Enemy) {
                let a = ally_mut(run, mi);
                a.dash = Some(WolfDash { dir, left, attack: true });
                a.dash_cd = WOLF_DASH_COOLDOWN;
                run.monsters[mi].ai.path.clear();
                set_anim(run, mi, Anim::Dash);
                return;
            }
        }
        if d <= reach {
            if run.monsters[mi].ai.cd <= 0.0 {
                run.monsters[mi].ai.windup = Some(Windup { t: WOLF_BITE_WINDUP, aim, alt: false, at: None });
                set_anim(run, mi, Anim::Windup);
            } else {
                set_anim(run, mi, Anim::Idle); // in reach: wait for the next bite
            }
            return;
        }
        ai::path_toward(run, mi, epos, WOLF_SPEED, dt);
        set_anim(run, mi, Anim::Move);
        return;
    }

    // 6. Growl: finish a step toward a detected enemy, or start the next growl.
    if tick_growl(run, mi, ranger, dt) {
        return;
    }

    // 7. Follow.
    let pos = run.monsters[mi].pos;
    let d = pos.dist(ranger);
    let a = ally_mut(run, mi);
    if a.following && d < WOLF_FOLLOW_STOP {
        a.following = false;
    } else if d > WOLF_FOLLOW {
        a.following = true;
    }
    if a.following {
        run.monsters[mi].aim = pos.angle_to(ranger);
        ai::path_toward(run, mi, ranger, WOLF_SPEED, dt);
        set_anim(run, mi, Anim::Move);
    } else {
        run.monsters[mi].ai.path.clear();
        // Faces the side the ranger aims at.
        run.monsters[mi].aim = if run.players[pi].aim.cos() >= 0.0 { 0.0 } else { std::f64::consts::PI };
        set_anim(run, mi, Anim::Idle);
    }
}

/// The growl (no prey, no wind-up): true while the wolf is on its step toward a detected enemy.
/// A growl is a sound, never a reveal: it goes to the whole party and the enemy is not shown.
/// Each enemy is growled at once, and growls are `WOLF_GROWL_EVERY` apart.
fn tick_growl(run: &mut Run, mi: usize, ranger: Vec2, dt: f64) -> bool {
    let pos = run.monsters[mi].pos;
    let a = ally_mut(run, mi);
    if let Some(to) = a.growl_to {
        if a.hold > 0.0 && pos.dist(to) >= 4.0 {
            run.monsters[mi].aim = pos.angle_to(to);
            ai::path_toward(run, mi, to, WOLF_SPEED, dt);
            set_anim(run, mi, Anim::Move);
            return true;
        }
        a.growl_to = None;
        run.monsters[mi].ai.path.clear();
    }
    let a = ally_mut(run, mi);
    if a.growl_cd > 0.0 {
        return false;
    }
    let growled = a.growled.clone();
    let sight = run.monsters[mi].sight_now();
    let seen = run
        .monsters
        .iter()
        .filter(|e| e.alive && !e.is_ally() && !e.dormant && !growled.contains(&e.id))
        .filter(|e| perception::sees(run, sight, pos, e.pos))
        .min_by(|a, b| a.pos.dist(pos).total_cmp(&b.pos.dist(pos)))
        .map(|e| (e.id, e.pos));
    let Some((eid, epos)) = seen else { return false };
    let (d, map) = (pos.dist(epos), &run.layout.map);
    let to = pos + (epos - pos).norm() * WOLF_GROWL_STEP.min(d - 8.0);
    let step = (d > 8.0 && to.dist(ranger) <= WOLF_LEASH && !map.blocks_at(to, Mover::Enemy) && walk_line(map, pos, to, Mover::Enemy)).then_some(to);
    let id = run.monsters[mi].id;
    let a = ally_mut(run, mi);
    a.growled.push(eid);
    a.growl_cd = WOLF_GROWL_EVERY;
    a.growl_to = step;
    a.hold = 0.6;
    run.monsters[mi].aim = pos.angle_to(epos);
    run.event(Ev::Growl { id }, None);
    false
}

/// One tick of the wolf's dash: through the air (it crosses chasms), an attack dash hits its prey once.
fn tick_dash(run: &mut Run, mi: usize, pi: usize, dash: WolfDash, dt: f64) {
    let solids = run.solids(None);
    let m = &run.monsters[mi];
    let v = dash.dir * (WOLF_DASH_SPEED * dt.min(dash.left));
    let (x, y) = move_box(&run.layout.map, m.pos.x, m.pos.y, v.x, v.y, m.radius, Mover::Dash, &solids);
    run.monsters[mi].pos = Vec2::new(x, y);
    run.monsters[mi].aim = dash.dir.y.atan2(dash.dir.x);
    set_anim(run, mi, Anim::Dash);
    let left = dash.left - dt;
    let mut done = left <= 1e-9;
    if dash.attack {
        let prey = run.monsters[mi].ally.as_ref().and_then(|a| a.prey).and_then(|id| run.monster_idx(id));
        if let Some(ei) = prey.filter(|&ei| run.monsters[ei].alive) {
            let (w, e) = (&run.monsters[mi], &run.monsters[ei]);
            if w.pos.dist(e.pos) < w.radius + e.radius + 4.0 {
                let (from, melee) = (w.pos, w.melee);
                run.hurt_monster(ei, Damage::new(WOLF_DASH_DAMAGE, melee), false, Some(pi));
                run.knock_monster(ei, from, WOLF_DASH_KNOCK);
                run.monsters[mi].ai.cd = WOLF_BITE_COOLDOWN;
                done = true;
            }
        }
    }
    if !done {
        ally_mut(run, mi).dash = Some(WolfDash { left, ..dash });
        return;
    }
    ally_mut(run, mi).dash = None;
    if dash.attack && run.layout.map.blocks_at(run.monsters[mi].pos, Mover::Enemy) {
        overrun(run, mi, dash.dir);
    }
}

/// An attack dash that ended over ground the wolf cannot stand on (it touched its prey above a
/// chasm): it carries on along `dir`, without more damage, to the first walkable ground within
/// `WOLF_DASH_RANGE`. With none before a wall or that far, it dashes back to its last safe tile.
fn overrun(run: &mut Run, mi: usize, dir: Vec2) {
    let (map, pos, r) = (&run.layout.map, run.monsters[mi].pos, run.monsters[mi].radius);
    let land = (1..=(WOLF_DASH_RANGE / 2.0) as usize)
        .map(|i| pos + dir * (i as f64 * 2.0))
        .take_while(|&p| !map.blocks_at(p, Mover::Dash))
        .find(|&p| !map.blocks_at(p, Mover::Enemy))
        .map(|p| p + dir * r) // a body's width onto the ground
        .filter(|&p| !map.blocks_at(p, Mover::Enemy));
    match land {
        Some(to) => {
            let left = pos.dist(to) / WOLF_DASH_SPEED;
            ally_mut(run, mi).dash = Some(WolfDash { dir, left, attack: false });
            set_anim(run, mi, Anim::Dash);
        }
        None => dash_back(run, mi),
    }
}

/// The enemy the wolf goes for: alive, awake and visible to the heroes (not dormant, hiding or flying),
/// seen by the wolf, near the ranger (guard) or the wolf (it fights back), within the leash. The one
/// nearest the ranger.
fn find_prey(run: &Run, mi: usize, ranger: Vec2) -> Option<usize> {
    let w = &run.monsters[mi];
    let sight = w.sight_now();
    run.monsters
        .iter()
        .enumerate()
        .filter(|(_, e)| e.alive && !e.is_ally() && !e.dormant && !e.hiding && !e.airborne && e.sinking.is_none())
        .filter(|(_, e)| {
            let (to_r, to_w) = (e.pos.dist(ranger), e.pos.dist(w.pos));
            (to_r <= WOLF_GUARD + e.radius || to_w <= WOLF_DEFEND + e.radius) && to_r <= WOLF_LEASH
        })
        .filter(|(_, e)| perception::sees(run, sight, w.pos, e.pos))
        .min_by(|a, b| a.1.pos.dist(ranger).total_cmp(&b.1.pos.dist(ranger)))
        .map(|(i, _)| i)
}

/// The wolf appears beside the ranger with the green puff, dropping whatever it was doing.
/// With no free spot beside her it stays where it is (false).
fn reappear(run: &mut Run, mi: usize, ranger: Vec2) -> bool {
    let Some(spot) = spot_beside(run, ranger) else { return false };
    let m = &mut run.monsters[mi];
    m.pos = spot;
    m.knock = Vec2::ZERO;
    m.ai.path.clear();
    m.ai.windup = None;
    let a = m.ally.as_mut().expect("an ally");
    a.prey = None;
    a.growl_to = None;
    a.dash = None;
    a.following = false;
    set_anim(run, mi, Anim::Idle);
    run.event(Ev::Boom { x: spot.x as f32, y: spot.y as f32, r: 10.0, k: 9 }, None);
    true
}

/// Pushed over a chasm with the dash ready: the wolf dashes straight back to the last
/// safe tile it stood on. That uses the dash (its cooldown starts).
pub fn dash_back(run: &mut Run, mi: usize) {
    let m = &mut run.monsters[mi];
    let pos = m.pos;
    m.ai.windup = None;
    m.ai.path.clear();
    let a = m.ally.as_mut().expect("an ally");
    let to = a.last_safe;
    let d = pos.dist(to);
    let dir = if d > 1e-6 { (to - pos).norm() } else { Vec2::new(1.0, 0.0) };
    a.dash = Some(WolfDash { dir, left: d / WOLF_DASH_SPEED, attack: false });
    a.dash_cd = WOLF_DASH_COOLDOWN;
    set_anim(run, mi, Anim::Dash);
}

/// The wolf `mi` has fallen: no XP, no coins, no kill; the ranger waits for the next one.
pub fn wolf_died(run: &mut Run, mi: usize) {
    let m = &mut run.monsters[mi];
    m.alive = false;
    m.hp = 0.0;
    let (id, pos, kind) = (m.id, m.pos, m.kind as u8);
    let owner = m.ally.as_ref().map(|a| a.owner);
    run.event(Ev::Died { id, x: pos.x as f32, y: pos.y as f32, kind }, None);
    if let Some(pi) = owner.and_then(|o| run.player_idx(o)) {
        let p = &mut run.players[pi];
        p.wolf = None;
        p.cd2 = WOLF_DEAD_COOLDOWN / p.mods.attack_speed;
        let name = p.name.clone();
        run.event(Ev::Msg { text: format!("{name}'s wolf has fallen") }, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::abilities::AbilityId;
    use crate::defs::damage::{Damage, DamageType};
    use crate::defs::effects::{EffectKind, EffectResponse};
    use crate::defs::kinds::EntityKind;
    use crate::dungeon::{Map, Tile};
    use crate::math::Vec2;
    use crate::protocol::{BossId, ClassId, Ev};
    use crate::run::abilities::{dagger_target, dash_contact, tick_projectiles, try_use};
    use crate::run::effects::Creature;
    use crate::run::tests::test_run;
    use crate::run::visibility::{dark_range, snapshot_ents, Dark};
    use crate::run::{Run, DT};

    fn ranger_with_wolf() -> (Run, u32) {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        let id = spawn_wolf(&mut run, 0);
        (run, id)
    }

    fn wolf_idx(run: &Run, id: u32) -> usize {
        run.monster_idx(id).unwrap()
    }

    /// A run with the given heroes (all on the first hero's spot) and the first hero's
    /// wolf `dx` px east of hero `at`.
    fn run_with_wolf_beside(classes: &[ClassId], at: usize, dx: f64) -> (Run, u32) {
        let mut run = test_run(classes, BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        let id = spawn_wolf(&mut run, 0);
        let pos = run.players[0].pos();
        for p in run.players.iter_mut() {
            p.mv.x = pos.x;
            p.mv.y = pos.y;
        }
        let mi = wolf_idx(&run, id);
        run.monsters[mi].pos = run.players[at].pos() + Vec2::new(dx, 0.0);
        (run, id)
    }

    fn untouched(run: &Run, id: u32, what: &str) {
        let m = &run.monsters[wolf_idx(run, id)];
        assert_eq!(m.hp, 80.0, "{what}: the wolf lost no HP");
        assert_eq!(m.knock, Vec2::ZERO, "{what}: and was not pushed");
    }

    /// One input of hero `pi` per step (cooldowns tick per processed input), with the secondary pressed or not.
    fn press(run: &mut Run, pi: usize, secondary: bool) {
        let seq = run.players[pi].ack + 1;
        let secondary = secondary.then_some(1);
        run.players[pi].inputs.push_back(crate::protocol::InputMsg { seq, secondary, ..Default::default() });
        run.step();
    }

    fn wolves(run: &Run) -> Vec<&crate::run::entities::Monster> {
        run.monsters.iter().filter(|m| m.alive && m.is_ally()).collect()
    }

    #[test]
    fn right_click_summons_then_heals_and_the_wolf_never_doubles() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        press(&mut run, 0, true);
        assert_eq!(wolves(&run).len(), 1);
        assert!((run.players[0].cd2 - 8.0).abs() < 0.1, "cd2 {}", run.players[0].cd2);
        press(&mut run, 0, true);
        assert_eq!(wolves(&run).len(), 1, "the cooldown refuses a second wolf");
        let id = run.players[0].wolf.unwrap();
        let wi = wolf_idx(&run, id);
        run.monsters[wi].hp = 50.0;
        run.players[0].cd2 = 0.0;
        press(&mut run, 0, true);
        assert_eq!(run.monsters[wolf_idx(&run, id)].hp, 66.0);
        assert_eq!(wolves(&run).len(), 1);
        run.players[0].cd2 = 0.0;
        press(&mut run, 0, true);
        assert_eq!(run.monsters[wolf_idx(&run, id)].hp, 80.0, "the heal stops at the maximum");
        assert!((run.players[0].cd2 - 8.0).abs() < 0.1, "a heal at full HP still costs the cooldown: {}", run.players[0].cd2);
    }

    #[test]
    fn the_cooldowns_follow_attack_speed() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        run.players[0].mods.attack_speed = 2.0;
        press(&mut run, 0, true);
        assert!((run.players[0].cd2 - 4.0).abs() < 0.1, "cd2 {}", run.players[0].cd2);
        let id = run.players[0].wolf.unwrap();
        let wi = wolf_idx(&run, id);
        run.hurt_monster(wi, Damage::physical(200.0), false, None);
        assert!((run.players[0].cd2 - 30.0).abs() < 1e-9);
    }

    #[test]
    fn after_the_wolf_falls_the_button_waits_60_s_then_summons() {
        let (mut run, id) = ranger_with_wolf();
        let wi = wolf_idx(&run, id);
        run.hurt_monster(wi, Damage::physical(200.0), false, None);
        press(&mut run, 0, true);
        assert!(wolves(&run).is_empty(), "no wolf during the wait");
        for _ in 0..60 * 60 {
            press(&mut run, 0, false);
        }
        press(&mut run, 0, true);
        assert_eq!(wolves(&run).len(), 1, "a new wolf after 60 s");
    }

    #[test]
    fn two_rangers_each_keep_their_own_wolf() {
        let mut run = test_run(&[ClassId::ElvenRanger, ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        press(&mut run, 0, true);
        press(&mut run, 1, true);
        assert_eq!(wolves(&run).len(), 2);
        let (a, b) = (run.players[0].wolf.unwrap(), run.players[1].wolf.unwrap());
        assert_eq!(run.monsters[wolf_idx(&run, a)].ally.as_ref().unwrap().owner, run.players[0].id);
        assert_eq!(run.monsters[wolf_idx(&run, b)].ally.as_ref().unwrap().owner, run.players[1].id);
        let ai = wolf_idx(&run, a);
        run.monsters[ai].hp = 30.0;
        run.players[1].cd2 = 0.0;
        press(&mut run, 1, true);
        assert_eq!(run.monsters[wolf_idx(&run, a)].hp, 30.0, "ranger B does not heal wolf A");
        assert_eq!(run.monsters[wolf_idx(&run, b)].hp, 80.0);
        assert!((run.players[1].cd2 - 8.0).abs() < 0.1);
    }

    #[test]
    fn the_wolf_vanishes_when_its_ranger_falls_or_leaves() {
        let mut run = test_run(&[ClassId::ElvenRanger, ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        press(&mut run, 0, true);
        press(&mut run, 1, true);
        assert_eq!(wolves(&run).len(), 2);

        run.events.clear();
        run.hurt_player(0, Damage::physical(999.0));
        run.step();
        assert_eq!(run.players[0].wolf, None);
        assert_eq!(wolves(&run).len(), 1, "only the fallen ranger's wolf is gone");
        assert!(run.events.iter().any(|(e, at)| matches!(e, Ev::Boom { k: 9, .. }) && at.is_none()));
        assert!(!run.events.iter().any(|(e, _)| matches!(e, Ev::Msg { text } if text.contains("wolf has fallen"))));
        assert_eq!(run.players[0].xp, 0);

        run.events.clear();
        let conn = run.players[1].conn;
        run.handle(crate::run::RunCmd::Leave { conn });
        run.step();
        assert_eq!(run.players[1].wolf, None);
        assert!(wolves(&run).is_empty());
        assert!(run.events.iter().any(|(e, at)| matches!(e, Ev::Boom { k: 9, .. }) && at.is_none()));
        assert!(!run.events.iter().any(|(e, _)| matches!(e, Ev::Msg { text } if text.contains("wolf has fallen"))));
        assert_eq!(run.players[1].xp, 0);

        // A dead ranger's secondary is ignored.
        run.players[0].cd2 = 0.0;
        press(&mut run, 0, true);
        assert!(wolves(&run).is_empty());
    }

    #[test]
    fn a_summoned_wolf_has_its_numbers() {
        let (run, id) = ranger_with_wolf();
        let m = &run.monsters[wolf_idx(&run, id)];
        assert_eq!((m.hp, m.max_hp), (80.0, 80.0));
        assert!((m.res.get(DamageType::Cold) - 0.2).abs() < 1e-12);
        assert!((m.res.get(DamageType::Poison) - 0.1).abs() < 1e-12);
        assert!((m.res.get(DamageType::Magical) - 0.1).abs() < 1e-12);
        assert_eq!(m.responses.get(EffectKind::Sleep), EffectResponse::Immune);
        assert_eq!(m.kind, EntityKind::DireWolf);
        assert_eq!(m.ally.as_ref().unwrap().owner, run.players[0].id);
        assert_eq!(run.players[0].wolf, Some(id));
        assert!(run.events.iter().any(|(e, at)| matches!(e, Ev::Boom { k: 9, .. }) && at.is_none()), "the green puff goes to the whole party");
    }

    #[test]
    fn no_hero_attack_hurts_the_wolf() {
        // The dagger: a wolf 10 px away is no dagger target, the crossbow fires instead.
        let (mut run, id) = run_with_wolf_beside(&[ClassId::ElvenRanger], 0, 10.0);
        assert_eq!(dagger_target(&run, 0), None);
        try_use(&mut run, 0, AbilityId::CrossbowDagger, 1, true);
        assert_eq!(run.projectiles.len(), 1, "a bolt is fired");
        untouched(&run, id, "dagger");

        // A bolt flies straight through it.
        let (mut run, id) = run_with_wolf_beside(&[ClassId::ElvenRanger], 0, 40.0);
        try_use(&mut run, 0, AbilityId::CrossbowDagger, 1, true);
        for _ in 0..30 {
            tick_projectiles(&mut run, DT);
        }
        untouched(&run, id, "bolt");

        // Sword and axe swings.
        let (mut run, id) = run_with_wolf_beside(&[ClassId::ElvenRanger, ClassId::Paladin, ClassId::Barbarian], 1, 10.0);
        try_use(&mut run, 1, AbilityId::Sword, 1, true);
        untouched(&run, id, "sword");
        try_use(&mut run, 2, AbilityId::Axe, 1, true);
        untouched(&run, id, "axe");

        // The Barbarian's dash.
        try_use(&mut run, 2, AbilityId::Dash, 1, false);
        dash_contact(&mut run, 2);
        untouched(&run, id, "dash");

        // A fireball that goes off on it.
        let (mut run, id) = run_with_wolf_beside(&[ClassId::ElvenRanger, ClassId::Wizard], 1, 30.0);
        run.players[1].aim_dist = 30.0;
        try_use(&mut run, 1, AbilityId::Fireball, 1, true);
        for _ in 0..60 {
            tick_projectiles(&mut run, DT);
        }
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Boom { k: 0, .. })), "the fireball did explode");
        untouched(&run, id, "fireball");

        // The safety net.
        let (mut run, id) = ranger_with_wolf();
        let mi = wolf_idx(&run, id);
        assert!(!run.hurt_monster(mi, Damage::physical(50.0), false, Some(0)));
        untouched(&run, id, "hurt_monster");
    }

    #[test]
    fn the_wolf_dies_without_paying_and_starts_the_wait() {
        let (mut run, id) = ranger_with_wolf();
        let mi = wolf_idx(&run, id);
        run.hurt_monster(mi, Damage::physical(200.0), false, None);
        let p = &run.players[0];
        assert!(p.xp == 0 && p.coins == 0 && p.kills == 0);
        assert_eq!(p.wolf, None);
        assert!((p.cd2 - 60.0).abs() < 1e-9);
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Msg { text } if text == "p0's wolf has fallen")));
        assert!(run.events.iter().any(|(e, at)| matches!(e, Ev::Died { id: i, .. } if *i == id) && at.is_none()));
        assert!(run.ended.is_none(), "the run goes on");
    }

    #[test]
    fn the_wolf_is_sent_to_the_party_even_in_the_dark() {
        let (mut run, id) = ranger_with_wolf();
        run.players[0].darkvision = Some(0.0);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 4..=ty + 4 {
            for x in tx - 2..=tx + 14 {
                run.layout.map.set(x, y, Tile::Floor);
            }
        }
        run.lights = crate::run::light::Lights::new(run.layout.map.w, run.layout.map.h);
        let far = Map::center_of(tx + 12, ty);
        let mi = wolf_idx(&run, id);
        run.monsters[mi].pos = far;
        let goblin = run.spawn_enemy(crate::defs::enemies::EnemyType::GoblinArcher, far, None, 1);
        let p = run.players[0].pos();
        run.players[0].view.compute(&run.layout.map, p, 18);
        run.lights.refresh(&run.layout.map);
        let dark = Dark { tile: (tx, ty), range: dark_range(&run.players[0].sight_now()) };
        let view = std::mem::replace(&mut run.players[0].view, crate::vispoly::View::new(0, 0));
        let ents = snapshot_ents(&run, 0, &view, &dark);
        let wolf = ents.iter().find(|e| e.0 == id).expect("the wolf is sent");
        assert_eq!(wolf.9, run.players[0].id, "extra is the owner");
        assert!(!ents.iter().any(|e| e.0 == goblin), "an unlit enemy there is not");
    }

    #[test]
    fn damage_on_the_wolf_is_shown_like_damage_on_a_hero() {
        let (mut run, id) = ranger_with_wolf();
        run.events.clear();
        run.on_hero.clear();
        let mi = wolf_idx(&run, id);
        run.hurt_monster(mi, Damage::physical(5.0), false, None);
        let i = run.events.iter().position(|(e, _)| matches!(e, Ev::Dmg { p: true, .. })).expect("a hero-style Dmg");
        assert!(run.on_hero.contains(&i));
    }
    /// Open floor and light around hero 0, 14 tiles east and 3 tiles up and down; hero 0 in debug mode.
    fn lit_arena(run: &mut Run) {
        crate::run::ai::tests::open_floor(run);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 3..=ty + 3 {
            for x in tx - 8..=tx + 14 {
                run.layout.map.set(x, y, Tile::Floor);
            }
        }
        run.lights.fill();
        run.players[0].debug = true;
    }

    #[test]
    fn an_orc_attacks_the_wolf_when_it_is_the_nearest_foe() {
        use crate::defs::enemies::EnemyType;
        let (mut run, id) = ranger_with_wolf();
        lit_arena(&mut run);
        // The ranger is 9 tiles away, beyond the orc's sight; the wolf stands 20 px from it.
        let far = run.players[0].pos() + Vec2::new(9.0 * crate::dungeon::TILE, 0.0);
        let mi = wolf_idx(&run, id);
        run.monsters[mi].pos = far;
        let orc = run.spawn_enemy(EnemyType::OrcWarrior, far + Vec2::new(20.0, 0.0), None, 1);
        for _ in 0..120 {
            // Held there: the wolf would follow its ranger (out of its leash, the orc is no prey).
            let wi = wolf_idx(&run, id);
            if run.monsters[wi].knock == Vec2::ZERO {
                run.monsters[wi].pos = far;
            }
            run.step();
        }
        assert!(run.monsters[wolf_idx(&run, id)].hp < 80.0, "the orc hurt the wolf");
        let oi = run.monster_idx(orc).unwrap();
        assert_eq!(run.monsters[oi].ai.target, Some(crate::run::entities::Target::Ally(id)));
    }

    #[test]
    fn an_enemy_arrow_hits_the_wolf() {
        let (mut run, id) = ranger_with_wolf();
        lit_arena(&mut run);
        let mi = wolf_idx(&run, id);
        let at = run.players[0].pos() + Vec2::new(6.0 * crate::dungeon::TILE, 0.0);
        run.monsters[mi].pos = at;
        crate::run::abilities::spawn_monster_projectile(&mut run, 999, EntityKind::Arrow, at - Vec2::new(30.0, 0.0), Vec2::new(1.0, 0.0), 180.0, 7.0, 2.0, 0.0, 0, 0.0);
        for _ in 0..40 {
            tick_projectiles(&mut run, DT);
        }
        let hp = run.monsters[wolf_idx(&run, id)].hp;
        assert!((hp - 73.0).abs() < 1e-9, "the arrow's 7 damage, got hp {hp}");
        assert!(run.projectiles.iter().all(|p| p.dead), "and it stopped there");
    }

    #[test]
    fn area_attacks_hit_the_wolf() {
        use crate::defs::enemies::{self, EnemyType};
        use crate::run::objects::{explode_barrel, Barrel, ObjState};
        // The ogre's slam.
        let (mut run, oi) = crate::run::ai::tests::ogre_among(&[Vec2::new(200.0, 0.0)]);
        let id = spawn_wolf(&mut run, 0);
        let wi = wolf_idx(&run, id);
        run.players[0].debug = true;
        run.monsters[wi].pos = run.monsters[oi].pos + Vec2::new(enemies::OGRE_SLAM_RADIUS - 4.0, 0.0);
        let slam = enemies::def(EnemyType::Ogre).alt.unwrap();
        crate::run::ai::perform_attack(&mut run, oi, Creature::Monster(wi), slam, true, None);
        let w = &run.monsters[wolf_idx(&run, id)];
        assert!(w.hp < 80.0, "the slam hurt the wolf");
        assert!(w.knock.x > 0.0, "and pushed it away from the ogre");

        // A fire patch.
        let (mut run, id) = ranger_with_wolf();
        lit_arena(&mut run);
        let at = run.monsters[wolf_idx(&run, id)].pos + Vec2::new(5.0 * crate::dungeon::TILE, 0.0);
        let wi = wolf_idx(&run, id);
        run.monsters[wi].pos = at;
        // The ranger stands beside it, so the wolf stays in the fire instead of following.
        run.players[0].mv.x = at.x - 16.0;
        run.players[0].mv.y = at.y;
        run.spawn_hazard(EntityKind::FirePatch, at, 10.0, 2.0, 5.0);
        for _ in 0..30 {
            run.step();
        }
        assert!(run.monsters[wolf_idx(&run, id)].hp < 80.0, "the fire burned the wolf within half a second");

        // A barrel blast.
        let (mut run, id) = ranger_with_wolf();
        lit_arena(&mut run);
        let wi = wolf_idx(&run, id);
        let at = run.players[0].pos() + Vec2::new(5.0 * crate::dungeon::TILE, 0.0);
        run.monsters[wi].pos = at;
        run.spawn_object(EntityKind::Barrel, at - Vec2::new(10.0, 0.0), ObjState::Barrel(Barrel::new()));
        let bi = run.objects.len() - 1;
        explode_barrel(&mut run, bi);
        let w = &run.monsters[wolf_idx(&run, id)];
        assert!(w.hp < 80.0 && w.knock.x > 0.0, "the blast hurt and pushed the wolf");
    }

    #[test]
    fn a_bosses_area_attack_hits_the_wolf_but_the_boss_targets_heroes() {
        use crate::defs::bosses::{LICH_NOVA_DAMAGE, LICH_NOVA_RADIUS};
        let (mut run, bi) = crate::run::bosses::lich::tests::lich_with(&[Vec2::new(0.0, 4.0 * crate::dungeon::TILE)]);
        let boss_pos = run.monsters[bi].pos;
        let id = spawn_wolf(&mut run, 0);
        let wi = wolf_idx(&run, id);
        run.monsters[wi].pos = boss_pos + Vec2::new(LICH_NOVA_RADIUS - 10.0, 0.0);
        crate::run::bosses::lich::Lich::nova(&mut run, boss_pos);
        let hp = run.monsters[wolf_idx(&run, id)].hp;
        assert!((hp - (80.0 - LICH_NOVA_DAMAGE * 0.9)).abs() < 1e-9, "magical resistance 10 %: hp {hp}");
        // The boss sees the wolf (it is nearer than the hero) but targets the hero.
        let seen = crate::run::bosses::target(&run, bi);
        assert_eq!(seen.map(|t| t.0), Some(0));
    }

    #[test]
    fn holy_light_heals_the_wolf_and_counts_as_healing() {
        let (mut run, id) = run_with_wolf_beside(&[ClassId::ElvenRanger, ClassId::Paladin], 1, 20.0);
        let wi = wolf_idx(&run, id);
        run.monsters[wi].hp = 40.0;
        run.events.clear();
        try_use(&mut run, 1, AbilityId::Heal, 1, false);
        assert_eq!(run.monsters[wolf_idx(&run, id)].hp, 75.0);
        assert_eq!(run.players[1].healing, 35.0);
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Heal { v, p: true, .. } if *v == 35.0)));
    }

    #[test]
    fn a_wolf_blown_into_deep_water_drowns_without_paying_and_starts_the_wait() {
        use crate::run::objects::{explode_barrel, Barrel, ObjState};
        let (mut run, id) = ranger_with_wolf();
        lit_arena(&mut run);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for x in tx + 7..=tx + 9 {
            run.layout.map.set(x, ty, Tile::DeepWater);
        }
        let wi = wolf_idx(&run, id);
        let at = Map::center_of(tx + 6, ty);
        run.monsters[wi].pos = at;
        run.spawn_object(EntityKind::Barrel, at - Vec2::new(10.0, 0.0), ObjState::Barrel(Barrel::new()));
        let bi = run.objects.len() - 1;
        run.events.clear();
        explode_barrel(&mut run, bi);
        for _ in 0..8 {
            run.step();
        }
        assert!(run.monsters[wolf_idx(&run, id)].sinking.is_some(), "it went into the water");
        for _ in 0..240 {
            run.step();
        }
        assert!(run.monsters.iter().all(|m| m.id != id || !m.alive), "the wolf is gone");
        let p = &run.players[0];
        assert!(p.xp == 0 && p.coins == 0 && p.kills == 0);
        assert_eq!(p.wolf, None);
        assert!(p.cd2 > 55.0 && p.cd2 <= 60.0, "the wait for the next wolf started: {}", p.cd2);
    }

    // ---- Behaviour: follow, guard, dash, bite, leash, reappear, chasm escape ----

    use crate::defs::enemies::EnemyType;

    /// Ranger with wolf on lit open floor (the ranger in debug mode); the wolf beside the ranger.
    fn guard_run() -> (Run, u32) {
        let (mut run, id) = ranger_with_wolf();
        lit_arena(&mut run);
        (run, id)
    }

    fn wolf(run: &Run, id: u32) -> &crate::run::entities::Monster {
        &run.monsters[wolf_idx(run, id)]
    }

    fn ally(run: &Run, id: u32) -> &crate::run::entities::Ally {
        wolf(run, id).ally.as_ref().unwrap()
    }

    fn set_wolf_pos(run: &mut Run, id: u32, p: Vec2) {
        let wi = wolf_idx(run, id);
        run.monsters[wi].pos = p;
    }

    fn move_ranger(run: &mut Run, p: Vec2) {
        run.players[0].mv.x = p.x;
        run.players[0].mv.y = p.y;
    }

    fn orc_at(run: &mut Run, p: Vec2) -> u32 {
        run.spawn_enemy(EnemyType::OrcWarrior, p, None, 1)
    }

    fn hp_of(run: &Run, id: u32) -> Option<f64> {
        run.monster_idx(id).map(|i| run.monsters[i].hp)
    }

    #[test]
    fn the_wolf_follows_and_stands_still_with_the_ranger() {
        let (mut run, id) = guard_run();
        let to = run.players[0].pos() + Vec2::new(80.0, 0.0);
        move_ranger(&mut run, to);
        for _ in 0..90 {
            run.step();
        }
        let d = wolf(&run, id).pos.dist(to);
        assert!(d <= WOLF_FOLLOW, "the wolf followed: {d} px from the ranger");
        let at = wolf(&run, id).pos;
        for _ in 0..60 {
            run.step();
        }
        let w = wolf(&run, id);
        assert!(w.pos.dist(at) < 0.5, "it stands still: moved {}", w.pos.dist(at));
        assert_eq!(w.anim, Anim::Idle);
    }

    #[test]
    fn the_wolf_bites_an_enemy_near_the_ranger_and_the_kill_pays_the_ranger() {
        let (mut run, _) = guard_run();
        let at = run.players[0].pos() + Vec2::new(30.0, 0.0);
        let orc = orc_at(&mut run, at);
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].hp = 15.0;
        for _ in 0..180 {
            if hp_of(&run, orc).is_none() {
                break;
            }
            run.step();
        }
        assert!(hp_of(&run, orc).is_none(), "the wolf killed the orc");
        let p = &run.players[0];
        assert_eq!(p.kills, 1);
        assert!(p.xp > 0, "the kill pays XP");
        assert!(p.damage >= 15.0 - 1e-9, "the ranger is credited with the damage: {}", p.damage);
    }

    #[test]
    fn the_wolf_opens_with_a_dash_and_then_bites() {
        let (mut run, id) = guard_run();
        let r = run.players[0].pos();
        set_wolf_pos(&mut run, id, r + Vec2::new(10.0, 0.0));
        let orc = orc_at(&mut run, r - Vec2::new(40.0, 0.0));
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].ai.hold = 99.0;
        run.monsters[oi].hp = 500.0;
        let mut hits: Vec<(usize, f64)> = Vec::new();
        let mut dashed = false;
        for t in 0..5 * 60 {
            let before = hp_of(&run, orc).unwrap();
            run.step();
            let lost = before - hp_of(&run, orc).unwrap();
            if lost > 1e-9 {
                hits.push((t, lost));
            }
            if t < 30 && wolf(&run, id).anim == Anim::Dash {
                dashed = true;
            }
        }
        assert!(dashed, "the wolf dashed");
        assert!(hits.len() >= 2, "hits {hits:?}");
        let (t0, first) = hits[0];
        assert!(t0 < 30 && (first - WOLF_DASH_DAMAGE).abs() < 1e-9, "the dash hit for 20 within 0.5 s: {hits:?}");
        let (t1, second) = hits[1];
        assert!((second - WOLF_BITE_DAMAGE).abs() < 1e-9 && t1 - t0 <= 90, "a bite of 10 followed within 1.5 s: {hits:?}");
        let dashes = hits.iter().filter(|(_, v)| (v - WOLF_DASH_DAMAGE).abs() < 1e-9).count();
        assert_eq!(dashes, 1, "no second dash hit within 5 s: {hits:?}");
    }

    #[test]
    fn the_wolf_dash_jumps_a_chasm() {
        let (mut run, id) = guard_run();
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        move_ranger(&mut run, Map::center_of(tx, ty));
        for y in ty - 1..=ty + 1 {
            run.layout.map.set(tx - 2, y, Tile::Chasm);
        }
        set_wolf_pos(&mut run, id, Map::center_of(tx - 3, ty));
        let orc = orc_at(&mut run, Map::center_of(tx, ty) + Vec2::new(10.0, 0.0));
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].ai.hold = 99.0;
        run.monsters[oi].hp = 500.0;
        let mut dashed = false;
        for _ in 0..40 {
            run.step();
            dashed |= wolf(&run, id).anim == Anim::Dash;
            assert!(wolf(&run, id).sinking.is_none(), "it never falls");
        }
        let w = wolf(&run, id);
        assert!(dashed && w.alive && w.sinking.is_none());
        assert!(w.pos.x > Map::center_of(tx - 2, ty).x + 8.0, "it crossed the chasm: {:?}", w.pos);
        assert_eq!(run.layout.map.tile_at(w.pos), Tile::Floor as u8, "and ended on floor");
        assert!(hp_of(&run, orc).unwrap() < 500.0, "and hit the orc");
    }

    #[test]
    fn a_wolf_blown_over_a_chasm_escapes_only_with_its_dash_ready() {
        use crate::run::objects::{explode_barrel, Barrel, ObjState};
        let blast = |run: &mut Run, id: u32| {
            let at = wolf(run, id).pos - Vec2::new(10.0, 0.0);
            run.spawn_object(EntityKind::Barrel, at, ObjState::Barrel(Barrel::new()));
            let bi = run.objects.len() - 1;
            explode_barrel(run, bi);
        };
        let sank = |run: &Run, id: u32| run.events.iter().any(|(e, _)| matches!(e, Ev::Sink { id: i, how: 0, .. } if *i == id));
        let (mut run, id) = ranger_with_wolf();
        let (tx, ty) = Map::tile_of(run.layout.player_spawns[0]);
        run.layout.map.set(tx + 2, ty, Tile::Chasm);
        run.players[0].debug = true;
        set_wolf_pos(&mut run, id, Map::center_of(tx + 1, ty));
        run.step();
        assert_eq!(ally(&run, id).last_safe, Map::center_of(tx + 1, ty));

        // Dash ready: it dashes back to the last safe tile.
        run.events.clear();
        blast(&mut run, id);
        let mut started = false;
        for _ in 0..60 {
            run.step();
            assert!(wolf(&run, id).sinking.is_none(), "never sinking");
            if !started && ally(&run, id).dash.is_some() {
                started = true;
                assert!((ally(&run, id).dash_cd - WOLF_DASH_COOLDOWN).abs() < 1e-9, "the escape uses the dash: {}", ally(&run, id).dash_cd);
            }
        }
        assert!(started, "it dashed back");
        let w = wolf(&run, id);
        let (wx, wy) = Map::tile_of(w.pos);
        assert!(w.alive && run.layout.map.safe(wx, wy), "on a safe tile at {:?}", w.pos);
        assert!(!sank(&run, id), "no Sink event");
        assert_eq!(run.players[0].wolf, Some(id));
        let cd = ally(&run, id).dash_cd;
        assert!(cd > 3.9 && cd < WOLF_DASH_COOLDOWN, "the dash cooldown runs: {cd}");

        // Dash on cooldown: it falls.
        run.events.clear();
        blast(&mut run, id);
        for _ in 0..30 {
            run.step();
            if sank(&run, id) {
                break;
            }
        }
        assert!(sank(&run, id), "it sinks");
        for _ in 0..=(crate::dungeon::FALL_TIME / DT) as usize + 1 {
            run.step();
        }
        assert!(run.monster_idx(id).is_none(), "the wolf is gone");
        let p = &run.players[0];
        assert!(p.xp == 0 && p.coins == 0 && p.kills == 0);
        assert!((p.cd2 - WOLF_DEAD_COOLDOWN).abs() < 0.1, "cd2 {}", p.cd2);
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Msg { text } if text == "p0's wolf has fallen")));
    }

    #[test]
    fn the_wolf_ignores_enemies_far_from_the_ranger_and_never_leaves_the_leash() {
        let (mut run, id) = guard_run();
        let r = run.players[0].pos();
        let orc = orc_at(&mut run, r + Vec2::new(80.0, 0.0));
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].ai.hold = 99.0;
        let hp = run.monsters[oi].hp;
        for _ in 0..120 {
            run.step();
            assert!(wolf(&run, id).pos.dist(r) <= WOLF_LEASH);
        }
        assert_eq!(hp_of(&run, orc), Some(hp), "the wolf left the orc alone");
    }

    #[test]
    fn the_wolf_fights_back() {
        let (mut run, id) = guard_run();
        let r = run.players[0].pos();
        set_wolf_pos(&mut run, id, r + Vec2::new(44.0, 0.0));
        let orc = orc_at(&mut run, r + Vec2::new(60.0, 0.0));
        let hp = hp_of(&run, orc).unwrap();
        for _ in 0..120 {
            run.step();
        }
        assert!(hp_of(&run, orc).map_or(true, |h| h < hp), "the wolf bit back");
    }

    #[test]
    fn the_wolf_never_bites_dormant_or_hiding_monsters() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Lich);
        run.monsters.retain(|m| m.is_boss || m.etype == Some(EnemyType::Disciple));
        let id = spawn_wolf(&mut run, 0);
        lit_arena(&mut run);
        let r = run.players[0].pos();
        // The dormant lich and one of its idle disciples, moved beside the ranger, and a hiding mimic.
        let bi = run.monsters.iter().position(|m| m.is_boss).unwrap();
        run.monsters[bi].pos = r + Vec2::new(0.0, -20.0);
        let di = run.monsters.iter().position(|m| m.etype == Some(EnemyType::Disciple)).unwrap();
        run.monsters[di].pos = r + Vec2::new(-20.0, 0.0);
        let mimic = run.spawn_enemy(EnemyType::Mimic, r + Vec2::new(0.0, 20.0), None, 1);
        let mi = run.monster_idx(mimic).unwrap();
        run.monsters[mi].hiding = true;
        let (boss, disciple) = (run.monsters[bi].id, run.monsters[di].id);
        let full: Vec<f64> = [boss, disciple, mimic].iter().map(|&m| hp_of(&run, m).unwrap()).collect();
        for _ in 0..120 {
            run.step();
        }
        let now: Vec<f64> = [boss, disciple, mimic].iter().map(|&m| hp_of(&run, m).unwrap()).collect();
        assert_eq!(now, full, "nobody was bitten");
        let m = |i: u32| &run.monsters[run.monster_idx(i).unwrap()];
        assert!(m(boss).dormant && m(disciple).dormant && m(mimic).hiding, "and they keep their state");
        assert!(ally(&run, id).prey.is_none());
    }

    /// The boss hall, a floor spot 3 tiles inside its door and one 2 tiles outside it.
    fn by_the_door(run: &Run) -> (crate::dungeon::Rect, Vec2, Vec2) {
        let b = run.level.boss().unwrap();
        let (hall, door) = (b.arena, b.door[0]);
        let inward = [(1, 0), (-1, 0), (0, 1), (0, -1)]
            .into_iter()
            .find(|&(dx, dy)| hall.contains_tile(door.0 + dx, door.1 + dy) && !hall.contains_tile(door.0 - dx, door.1 - dy))
            .unwrap();
        let inside = Map::center_of(door.0 + 3 * inward.0, door.1 + 3 * inward.1);
        let outside = Map::center_of(door.0 - 2 * inward.0, door.1 - 2 * inward.1);
        assert!(!run.layout.map.blocks_at(outside, crate::dungeon::Mover::Enemy));
        assert!(!run.layout.map.blocks_at(inside, crate::dungeon::Mover::Enemy));
        assert!(hall.contains(inside) && !hall.contains(outside));
        (hall, inside, outside)
    }

    #[test]
    fn the_wolf_dash_never_stops_over_a_chasm_in_front_of_its_prey() {
        let (mut run, id) = guard_run();
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        move_ranger(&mut run, Map::center_of(tx + 1, ty));
        for y in ty - 1..=ty + 1 {
            run.layout.map.set(tx - 1, y, Tile::Chasm);
        }
        // The orc stands right at the chasm's far edge: the dash touches it over the chasm.
        let edge = tx as f64 * crate::dungeon::TILE;
        let orc = orc_at(&mut run, Vec2::new(edge + 6.0, Map::center_of(tx, ty).y));
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].ai.hold = 99.0;
        run.monsters[oi].hp = 500.0;
        set_wolf_pos(&mut run, id, Map::center_of(tx - 4, ty));
        for _ in 0..60 {
            run.step();
            assert!(wolf(&run, id).sinking.is_none(), "it never falls");
        }
        let w = wolf(&run, id);
        assert!(w.alive && w.sinking.is_none());
        assert_eq!(run.layout.map.tile_at(w.pos), Tile::Floor as u8, "it ended on floor at {:?}", w.pos);
        assert!(hp_of(&run, orc).unwrap() <= 500.0 - WOLF_DASH_DAMAGE + 1e-9, "the dash hit the orc");
    }

    #[test]
    fn the_wolf_reappears_beside_the_ranger_when_far_or_locked_out() {
        // Far: 250 px away.
        let (mut run, id) = guard_run();
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 2..=ty + 2 {
            for x in tx..=tx + 20 {
                run.layout.map.set(x, y, Tile::Floor);
            }
        }
        let to = run.players[0].pos() + Vec2::new(250.0, 0.0);
        move_ranger(&mut run, to);
        run.events.clear();
        run.step();
        assert!(wolf(&run, id).pos.dist(to) <= 16.0, "beside the ranger: {:?}", wolf(&run, id).pos);
        assert!(run.events.iter().any(|(e, at)| matches!(e, Ev::Boom { k: 9, .. }) && at.is_none()), "with the green puff");

        // Locked out: the hall door closes with the ranger inside and the wolf outside.
        let (mut run, id) = ranger_with_wolf();
        run.players[0].debug = true;
        let (hall, inside, outside) = by_the_door(&run);
        assert!(inside.dist(outside) < WOLF_REAPPEAR, "near enough: only the door keeps it out");
        // Both outside first, so the reach check runs on its own clock.
        move_ranger(&mut run, outside);
        set_wolf_pos(&mut run, id, outside);
        for _ in 0..10 {
            run.step();
        }
        move_ranger(&mut run, inside);
        set_wolf_pos(&mut run, id, outside);
        crate::run::levels::boss::check_arena(&mut run);
        assert!(run.level.boss().unwrap().door_closed);
        for _ in 0..31 {
            run.step();
        }
        assert!(hall.contains(wolf(&run, id).pos), "the wolf is inside the hall: {:?}", wolf(&run, id).pos);
    }

    /// The ranger (debug, so the lava spares her) in the middle of a 3x3 patch of lava on lit open floor.
    fn ranger_on_lava() -> (Run, u32, (i32, i32)) {
        let (mut run, id) = guard_run();
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 1..=ty + 1 {
            for x in tx - 1..=tx + 1 {
                run.layout.map.set(x, y, Tile::Lava);
            }
        }
        move_ranger(&mut run, Map::center_of(tx, ty));
        (run, id, (tx, ty))
    }

    #[test]
    fn the_wolf_never_reappears_onto_lava_beside_a_ranger_standing_on_it() {
        let (mut run, id, (tx, ty)) = ranger_on_lava();
        set_wolf_pos(&mut run, id, Map::center_of(tx - 4, ty));
        for _ in 0..120 {
            run.step();
            let w = wolf(&run, id);
            assert!(w.alive, "the wolf lives");
            assert!(!run.layout.map.blocks_at(w.pos, Mover::Enemy), "the wolf stands on walkable ground: {:?}", w.pos);
        }
    }

    #[test]
    fn a_summon_beside_lava_lands_on_walkable_ground() {
        let (mut run, _, (tx, ty)) = ranger_on_lava();
        // Standing on the lava, no point beside her is safe: the nearest walkable tile centre.
        run.monsters.retain(|m| m.is_boss);
        let id = spawn_wolf(&mut run, 0);
        let w = wolf(&run, id);
        assert!(!run.layout.map.blocks_at(w.pos, Mover::Enemy), "on walkable ground: {:?}", w.pos);
        assert!(w.pos.dist(Map::center_of(tx, ty)) <= 2.0 * crate::dungeon::TILE * 1.5);
        // Beside a lava tile: a free point beside her.
        let (mut run, _) = guard_run();
        run.monsters.retain(|m| m.is_boss);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        run.layout.map.set(tx + 1, ty, Tile::Lava);
        let id = spawn_wolf(&mut run, 0);
        assert!(!run.layout.map.blocks_at(wolf(&run, id).pos, Mover::Enemy));
    }

    #[test]
    fn only_heroes_wake_the_boss_open_chests_and_reveal_mimics() {
        use crate::run::objects::ObjState;
        // The wolf alone in the boss hall, the ranger just outside the open door (near enough
        // and with a path, so the wolf does not reappear beside them).
        let (mut run, id) = ranger_with_wolf();
        let (hall, inside, outside) = by_the_door(&run);
        assert!(inside.dist(outside) < WOLF_REAPPEAR);
        move_ranger(&mut run, outside);
        for _ in 0..60 {
            set_wolf_pos(&mut run, id, inside);
            run.step();
            assert!(hall.contains(wolf(&run, id).pos), "the wolf was in the hall: {:?}", wolf(&run, id).pos);
            assert!(!hall.contains(run.players[0].pos()));
        }
        let b = run.level.boss().unwrap();
        assert!(!b.awake && !b.door_closed, "the wolf does not wake the boss or seal the door");
        assert!(run.monsters.iter().find(|m| m.is_boss).unwrap().dormant);

        // On a chest and beside a hiding mimic.
        let (mut run, id) = guard_run();
        let r = run.players[0].pos();
        let chest = run.spawn_object(EntityKind::Chest, r + Vec2::new(25.0, 0.0), ObjState::Chest { opened: None });
        let mimic = run.spawn_enemy(EnemyType::Mimic, r + Vec2::new(25.0, 10.0), None, 1);
        let mi = run.monster_idx(mimic).unwrap();
        run.monsters[mi].hiding = true;
        for _ in 0..30 {
            set_wolf_pos(&mut run, id, r + Vec2::new(25.0, 2.0));
            run.step();
        }
        let o = run.objects.iter().find(|o| o.id == chest).unwrap();
        assert!(matches!(o.state, ObjState::Chest { opened: None }), "the wolf opens no chest");
        assert!(run.monsters[run.monster_idx(mimic).unwrap()].hiding, "and reveals no mimic");
    }

    #[test]
    fn a_frozen_wolf_does_nothing_and_a_sleep_never_takes() {
        let (mut run, id) = guard_run();
        let to = run.players[0].pos() + Vec2::new(80.0, 0.0);
        move_ranger(&mut run, to);
        let wi = wolf_idx(&run, id);
        assert!(run.apply_effect(Creature::Monster(wi), EffectKind::Frozen, Some(1.0)));
        let at = wolf(&run, id).pos;
        for _ in 0..55 {
            run.step();
        }
        assert_eq!(wolf(&run, id).pos, at, "frozen: it stays");
        for _ in 0..30 {
            run.step();
        }
        assert!(wolf(&run, id).pos.dist(at) > 5.0, "thawed: it follows again");
        let wi = wolf_idx(&run, id);
        assert!(!run.apply_effect(Creature::Monster(wi), EffectKind::Sleep, Some(5.0)));
    }

    // ---- The growl ----

    /// Open floor around hero 0 with no light at all (the ranger sees 6 tiles, the wolf 18).
    fn dark_arena(run: &mut Run) {
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 3..=ty + 3 {
            for x in tx - 8..=tx + 14 {
                run.layout.map.set(x, y, Tile::Floor);
            }
        }
        run.lights = crate::run::light::Lights::new(run.layout.map.w, run.layout.map.h);
    }

    fn held_orc(run: &mut Run, p: Vec2) -> u32 {
        let orc = orc_at(run, p);
        let oi = run.monster_idx(orc).unwrap();
        run.monsters[oi].ai.hold = 1e9;
        orc
    }

    fn growls(run: &Run, wolf_id: u32) -> usize {
        run.events.iter().filter(|(e, _)| matches!(e, Ev::Growl { id } if *id == wolf_id)).count()
    }

    #[test]
    fn the_wolf_growls_at_an_enemy_in_the_dark_and_steps_toward_it() {
        let (mut run, id) = ranger_with_wolf();
        dark_arena(&mut run);
        let r = run.players[0].pos();
        let orc = held_orc(&mut run, r + Vec2::new(10.0 * crate::dungeon::TILE, 0.0));
        run.events.clear();
        let (mut start, mut far) = (None, 0.0f64);
        for _ in 0..120 {
            let before = wolf(&run, id).pos;
            run.step();
            if start.is_none() && growls(&run, id) > 0 {
                start = Some(before);
            }
            if let Some(s) = start {
                far = far.max(wolf(&run, id).pos.dist(s));
            }
        }
        assert_eq!(growls(&run, id), 1, "exactly one growl");
        assert!(run.events.iter().any(|(e, at)| matches!(e, Ev::Growl { .. }) && at.is_none()), "party-wide, no position");
        assert!((16.0..=25.0).contains(&far), "stepped {far} px toward the orc");
        assert!(wolf(&run, id).pos.dist(run.players[0].pos()) <= WOLF_FOLLOW + 1.0, "and came back");
        // The growl reveals nothing: the orc is not in the ranger's snapshot.
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        let p = run.players[0].pos();
        run.players[0].view.compute(&run.layout.map, p, 18);
        run.lights.refresh(&run.layout.map);
        let dark = Dark { tile: (tx, ty), range: dark_range(&run.players[0].sight_now()) };
        let view = std::mem::replace(&mut run.players[0].view, crate::vispoly::View::new(0, 0));
        let ents = snapshot_ents(&run, 0, &view, &dark);
        assert!(!ents.iter().any(|e| e.0 == orc), "the orc stays hidden");
    }

    #[test]
    fn the_wolf_growls_at_a_hiding_mimic_but_not_at_a_dormant_boss() {
        let (mut run, id) = guard_run();
        let r = run.players[0].pos();
        let mimic = run.spawn_enemy(EnemyType::Mimic, r + Vec2::new(5.0 * crate::dungeon::TILE, 0.0), None, 1);
        let mi = run.monster_idx(mimic).unwrap();
        run.monsters[mi].hiding = true;
        run.events.clear();
        for _ in 0..90 {
            run.step();
        }
        assert_eq!(growls(&run, id), 1, "one growl at the mimic");
        assert!(run.monsters[run.monster_idx(mimic).unwrap()].hiding, "and it keeps its disguise");

        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Lich);
        run.monsters.retain(|m| m.is_boss || m.etype == Some(EnemyType::Disciple));
        let id = spawn_wolf(&mut run, 0);
        lit_arena(&mut run);
        let r = run.players[0].pos();
        for (n, mi) in run.monsters.iter().enumerate().filter(|(_, m)| !m.is_ally()).map(|(i, _)| i).collect::<Vec<_>>().into_iter().enumerate() {
            run.monsters[mi].pos = r + Vec2::new(3.0 * crate::dungeon::TILE + n as f64 * 8.0, 0.0);
        }
        assert!(run.monsters.iter().filter(|m| !m.is_ally()).all(|m| m.dormant), "the lich and its disciples sleep");
        run.events.clear();
        for _ in 0..120 {
            run.step();
        }
        assert_eq!(growls(&run, id), 0, "no growl at the dormant");
    }

    #[test]
    fn each_enemy_is_growled_at_once_and_growls_are_4_s_apart() {
        let (mut run, id) = ranger_with_wolf();
        dark_arena(&mut run);
        let r = run.players[0].pos();
        let t = crate::dungeon::TILE;
        let a = held_orc(&mut run, r + Vec2::new(10.0 * t, 0.0));
        held_orc(&mut run, r + Vec2::new(11.0 * t, 16.0));
        run.events.clear();
        let mut at = Vec::new();
        for tick in 0..60 * 12 {
            let before = growls(&run, id);
            run.step();
            if growls(&run, id) > before {
                at.push(tick);
            }
            if at.len() == 2 && tick == at[1] + 30 {
                // One orc out of sight and back: no third growl.
                let ai = run.monster_idx(a).unwrap();
                run.monsters[ai].pos = r + Vec2::new(30.0 * t, 0.0);
            }
            if at.len() == 2 && tick == at[1] + 90 {
                let ai = run.monster_idx(a).unwrap();
                run.monsters[ai].pos = r + Vec2::new(10.0 * t, 0.0);
            }
        }
        assert_eq!(at.len(), 2, "two enemies, two growls: {at:?}");
        assert!(at[1] - at[0] >= 240 && at[1] - at[0] <= 245, "4 s apart: {at:?}");
    }
}
