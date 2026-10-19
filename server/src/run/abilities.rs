//! Player abilities (one executor per AbilityId) and projectile simulation.

use super::entities::Projectile;
use super::{Run, TICK_HZ};
use crate::collision::line_of_sight;
use crate::defs::abilities::{self as ab, AbilityId};
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::damage::{kind_split, Damage};
use crate::defs::effects::OnHit;
use crate::defs::kinds::{Anim, EntityKind};
use crate::defs::lights::{self, LightKind};
use super::effects::Creature;
use crate::math::{angle_diff, Vec2};
use crate::protocol::Ev;

/// Cooldowns tick per processed input on both client and server; a small
/// tolerance absorbs rounding differences.
const COOLDOWN_LEEWAY: f64 = 0.05;

/// How many ticks to rewind monsters for this player's hit checks.
fn rewind_ticks(run: &Run, pi: usize) -> usize {
    ((run.players[pi].view_lag * TICK_HZ).round() as usize).min(super::entities::HISTORY_LEN - 1)
}

/// What the dagger stabs: a monster, or a closed chest (so a chest and a hidden mimic answer alike).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DaggerTarget {
    Monster(usize),
    Object(usize),
}

/// The dagger is used instead of the crossbow when a monster or a closed chest is this close.
pub fn dagger_target(run: &Run, pi: usize) -> Option<DaggerTarget> {
    let rw = rewind_ticks(run, pi);
    let pos = run.players[pi].pos();
    let reach = run.players[pi].sheet.fallback.map_or(ab::DAGGER_RANGE, |f| f.range);
    let monsters = run
        .monsters
        .iter()
        .enumerate()
        .filter(|(_, m)| m.alive && !m.airborne && !m.is_ally())
        .map(|(i, m)| (DaggerTarget::Monster(i), m.pos_ago(rw).dist(pos) - m.radius));
    let chests = run
        .objects
        .iter()
        .enumerate()
        .filter(|(_, o)| !o.gone && matches!(o.state, crate::run::objects::ObjState::Chest { opened: None }))
        .map(|(i, o)| (DaggerTarget::Object(i), o.pos.dist(pos) - o.radius));
    monsters
        .chain(chests)
        .filter(|&(_, d)| d <= reach)
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(t, _)| t)
}

/// The power of an ability's damage-type effects: the hero's governing Attribute for it (`ab::governing`).
fn hero_power(run: &Run, pi: usize, id: AbilityId) -> i32 {
    ab::governing(id).map_or(0, |a| run.players[pi].sheet.attrs.get(a))
}

/// Uses the hero's primary or secondary ability, with its numbers from the hero's sheet.
pub fn try_use(run: &mut Run, pi: usize, primary: bool, shot: u16) {
    let cd = if primary { run.players[pi].cd1 } else { run.players[pi].cd2 };
    if cd > COOLDOWN_LEEWAY || !run.players[pi].alive {
        return;
    }
    let def = if primary { run.players[pi].sheet.primary } else { run.players[pi].sheet.secondary };
    let id = def.id;
    let (pos, aim, aim_dist) = {
        let p = &run.players[pi];
        (p.pos(), p.aim, p.aim_dist)
    };
    let dir = Vec2::from_angle(aim);
    let crit = false;
    let on_hit = ab::on_hit(id);
    let power = hero_power(run, pi, id);
    let mut cooldown = def.cooldown;
    let anim = match id {
        AbilityId::MagicMissile => {
            spawn_player_projectile(run, pi, EntityKind::Missile, shot, dir, def.speed, def.damage, def.radius, def.range / def.speed, 0.0, None, crit, on_hit, power);
            Anim::Shoot
        }
        AbilityId::Fireball => {
            let target = pos + dir * aim_dist.clamp(24.0, def.range);
            let life = def.range / def.speed + 0.1;
            spawn_player_projectile(run, pi, EntityKind::Fireball, shot, dir, def.speed, def.damage, 4.0, life, def.radius, Some(target), crit, on_hit, power);
            Anim::Cast
        }
        AbilityId::Sword | AbilityId::Axe => {
            melee_arc(run, pi, def.range, def.arc, def.damage, crit, on_hit, power);
            Anim::Melee
        }
        AbilityId::Heal => {
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: def.radius as f32, k: 1 }, Some(pos));
            run.add_flash(LightKind::Holy, pos, lights::HOLY_FLASH);
            let mut total = 0.0;
            for qi in 0..run.players.len() {
                let q = &run.players[qi];
                if q.alive && q.pos().dist(pos) <= def.radius {
                    total += run.heal_player(qi, def.damage);
                }
            }
            for mi in 0..run.monsters.len() {
                let m = &run.monsters[mi];
                if m.is_ally() && m.alive && m.pos.dist(pos) <= def.radius {
                    total += run.heal_monster(mi, def.damage);
                }
            }
            run.players[pi].healing += total;
            Anim::Cast
        }
        AbilityId::Dash => {
            let p = &mut run.players[pi];
            p.mv.dash_t = def.duration;
            p.mv.dash_dx = dir.x;
            p.mv.dash_dy = dir.y;
            p.dash_hit.clear();
            Anim::Dash
        }
        AbilityId::CrossbowDagger => {
            if let Some(t) = dagger_target(run, pi) {
                let thrust = run.players[pi].sheet.fallback.expect("a hero with the crossbow has the rapier");
                cooldown = thrust.cooldown;
                let dmg = Damage { on_hit, ..Damage::new(thrust.damage, run.players[pi].melee).with_power(power) };
                match t {
                    DaggerTarget::Monster(mi) => {
                        run.hurt_monster(mi, dmg, crit, Some(pi));
                    }
                    DaggerTarget::Object(oi) => {
                        let by = run.players[pi].id;
                        crate::run::objects::hurt_object(run, oi, dmg, Some(by));
                    }
                }
                Anim::Melee
            } else {
                spawn_player_projectile(run, pi, EntityKind::Bolt, shot, dir, def.speed, def.damage, def.radius, def.range / def.speed, 0.0, None, crit, on_hit, power);
                Anim::Shoot
            }
        }
        AbilityId::SummonWolf => {
            super::companion::use_ability(run, pi);
            Anim::Cast
        }
    };
    let p = &mut run.players[pi];
    if primary {
        p.cd1 = cooldown;
    } else {
        p.cd2 = cooldown;
    }
    p.anim = anim;
    p.anim_start = run.time;
}

#[allow(clippy::too_many_arguments)]
fn melee_arc(run: &mut Run, pi: usize, range: f64, arc: f64, damage: f64, crit: bool, on_hit: Option<OnHit>, power: i32) {
    let rw = rewind_ticks(run, pi);
    let (pos, aim) = (run.players[pi].pos(), run.players[pi].aim);
    let dmg = Damage { on_hit, ..Damage::new(damage, run.players[pi].melee).with_power(power) };
    let hits: Vec<usize> = run
        .monsters
        .iter()
        .enumerate()
        .filter(|(_, m)| {
            // Flying monsters are out of reach of melee.
            if !m.alive || m.airborne || m.is_ally() {
                return false;
            }
            let mp = m.pos_ago(rw);
            let d = mp.dist(pos);
            if d > range + m.radius {
                return false;
            }
            let in_arc = angle_diff(pos.angle_to(mp), aim).abs() <= arc / 2.0 || d < m.radius + PLAYER_RADIUS;
            in_arc && line_of_sight(&run.layout.map, pos, mp)
        })
        .map(|(i, _)| i)
        .collect();
    for mi in hits {
        run.hurt_monster(mi, dmg, crit, Some(pi));
    }
    let objs: Vec<usize> = (0..run.objects.len())
        .filter(|&i| {
            let o = &run.objects[i];
            let d = o.pos.dist(pos);
            if o.gone || d > range + o.radius {
                return false;
            }
            let in_arc = angle_diff(pos.angle_to(o.pos), aim).abs() <= arc / 2.0 || d < o.radius + PLAYER_RADIUS;
            in_arc && line_of_sight(&run.layout.map, pos, o.pos)
        })
        .collect();
    let by = run.players[pi].id;
    for oi in objs {
        crate::run::objects::hurt_object(run, oi, dmg, Some(by));
    }
}

/// Barbarian dash: damage each monster touched once per dash.
pub fn dash_contact(run: &mut Run, pi: usize) {
    let rw = rewind_ticks(run, pi);
    let pos = run.players[pi].pos();
    let dmg = Damage {
        on_hit: ab::on_hit(AbilityId::Dash),
        ..Damage::new(run.players[pi].sheet.secondary.damage, run.players[pi].melee).with_power(hero_power(run, pi, AbilityId::Dash))
    };
    let hits: Vec<(usize, u32)> = run
        .monsters
        .iter()
        .enumerate()
        .filter(|(_, m)| m.alive && !m.airborne && !m.is_ally() && !run.players[pi].dash_hit.contains(&m.id) && m.pos_ago(rw).dist(pos) < PLAYER_RADIUS + m.radius + 4.0)
        .map(|(i, m)| (i, m.id))
        .collect();
    for (mi, id) in hits {
        run.players[pi].dash_hit.push(id);
        run.hurt_monster(mi, dmg, false, Some(pi));
    }
    let objs: Vec<(usize, u32)> = run
        .objects
        .iter()
        .enumerate()
        .filter(|(_, o)| !o.gone && !run.players[pi].dash_hit.contains(&o.id) && o.pos.dist(pos) < PLAYER_RADIUS + o.radius + 4.0)
        .map(|(i, o)| (i, o.id))
        .collect();
    let by = run.players[pi].id;
    for (oi, id) in objs {
        run.players[pi].dash_hit.push(id);
        crate::run::objects::hurt_object(run, oi, dmg, Some(by));
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_player_projectile(
    run: &mut Run,
    pi: usize,
    kind: EntityKind,
    shot: u16,
    dir: Vec2,
    speed: f64,
    damage: f64,
    radius: f64,
    life: f64,
    explode_r: f64,
    target: Option<Vec2>,
    crit: bool,
    on_hit: Option<OnHit>,
    power: i32,
) {
    let p = &run.players[pi];
    let pos = p.pos() + dir * 6.0;
    // Fast-forward by half the round trip: the client already shows it moving.
    let ff = (p.rtt / 2.0).min(0.15);
    let vel = dir * speed;
    let owner = p.id;
    let id = run.alloc_id();
    run.projectiles.push(Projectile {
        id,
        kind,
        owner,
        from_player: true,
        shot,
        pos,
        vel,
        damage: Damage { on_hit, ..Damage::new(damage, kind_split(kind)).with_power(power) },
        radius,
        life: (life - ff).max(0.05),
        crit,
        explode_r,
        explode_k: 0,
        knock: 0.0,
        target,
        dead: false,
    });
    run.attach_kind_light(id, kind);
    // Through the same hit checks as every tick, so it cannot skip an enemy on the way.
    let i = run.projectiles.len() - 1;
    advance_projectile(run, i, ff);
}

#[allow(clippy::too_many_arguments)]
pub fn spawn_monster_projectile(
    run: &mut Run,
    owner: u32,
    kind: EntityKind,
    pos: Vec2,
    dir: Vec2,
    speed: f64,
    damage: f64,
    life: f64,
    explode_r: f64,
    explode_k: u8,
    knock: f64,
) {
    let id = run.alloc_id();
    run.projectiles.push(Projectile {
        id,
        kind,
        owner,
        from_player: false,
        shot: 0,
        pos,
        vel: dir * speed,
        damage: Damage::new(damage, kind_split(kind)).with_power(shot_power(run, owner, kind)),
        radius: 3.0,
        life,
        crit: false,
        explode_r,
        explode_k,
        knock,
        target: None,
        dead: false,
    });
    run.attach_kind_light(id, kind);
}

/// The power of a monster shot's damage-type effects: its owner's governing Attribute
/// (`enemies::governing`, `bosses::governing`); 0 (so `TYPE_EFFECT_POWER`) if the owner is unknown.
fn shot_power(run: &Run, owner: u32, kind: EntityKind) -> i32 {
    let Some(m) = run.monster_idx(owner).map(|mi| &run.monsters[mi]) else { return 0 };
    match m.etype {
        Some(t) => m.attrs.get(crate::defs::enemies::governing(t, Some(kind))),
        None if m.is_boss => m.attrs.get(crate::defs::bosses::governing(kind)),
        None => 0,
    }
}

pub fn tick_projectiles(run: &mut Run, dt: f64) {
    for i in 0..run.projectiles.len() {
        if run.projectiles[i].dead {
            continue;
        }
        advance_projectile(run, i, dt);
        let pr = &mut run.projectiles[i];
        if !pr.dead {
            pr.life -= dt;
            if pr.life <= 0.0 {
                let pos = pr.pos;
                impact(run, i, pos, None);
            }
        }
    }
}

/// Moves projectile `i` for `dt` in steps of at most 4 px. It ends at the
/// first wall, target point or figure it meets: shots never pass through.
fn advance_projectile(run: &mut Run, i: usize, dt: f64) {
    if dt <= 0.0 {
        return;
    }
    let speed = run.projectiles[i].vel.len();
    let substeps = ((speed * dt) / 4.0).ceil().max(1.0) as i32;
    let sdt = dt / substeps as f64;
    for _ in 0..substeps {
        let pr = &mut run.projectiles[i];
        let prev = pr.pos;
        pr.pos = pr.pos + pr.vel * sdt;
        let pos = pr.pos;
        if let Some(t) = pr.target {
            if (t - pos).x * pr.vel.x + (t - pos).y * pr.vel.y <= 0.0 {
                // An aim point inside a wall: it goes off in front of the wall, so its flash lights only that side.
                let at = if run.layout.map.opaque_at(pos) { prev } else { pos };
                impact(run, i, at, None);
                break;
            }
        }
        if run.layout.map.opaque_at(pos) {
            // A plain shot into a torch's wall hits the torch (an explosion reaches it anyway).
            let tile = crate::dungeon::Map::tile_of(pos);
            if run.projectiles[i].explode_r == 0.0 {
                if let Some(oi) = run.objects.iter().position(|o| matches!(o.state, crate::run::objects::ObjState::Torch { wall, .. } if wall == tile)) {
                    let (dmg, by) = (run.projectiles[i].damage, run.projectiles[i].from_player.then_some(run.projectiles[i].owner));
                    crate::run::objects::hurt_object(run, oi, dmg, by);
                }
            }
            impact(run, i, prev, None);
            break;
        }
        let r = run.projectiles[i].radius;
        if let Some(oi) = run.objects.iter().position(|o| o.stops_shots() && o.pos.dist(pos) < o.radius + r) {
            impact_object(run, i, pos, oi);
            break;
        }
        let pr = &run.projectiles[i];
        if pr.from_player {
            let hit = run.monsters.iter().position(|m| m.alive && !m.is_ally() && m.shot_dist(pos) < m.radius + pr.radius);
            if let Some(mi) = hit {
                impact(run, i, pos, Some(Creature::Monster(mi)));
                break;
            }
        } else {
            // Heroes first, then allies.
            let hero = run.players.iter().position(|p| p.alive && p.pos().dist(pos) < PLAYER_RADIUS + pr.radius).map(Creature::Player);
            let ally = || run.monsters.iter().position(|m| m.is_ally() && m.alive && m.sinking.is_none() && m.shot_dist(pos) < m.radius + pr.radius).map(Creature::Monster);
            if let Some(c) = hero.or_else(ally) {
                impact(run, i, pos, Some(c));
                break;
            }
        }
    }
}

/// Projectile `i` hits something at `pos` (a creature on the opposing team, if any).
fn impact(run: &mut Run, i: usize, pos: Vec2, target: Option<Creature>) {
    let pr = &mut run.projectiles[i];
    pr.dead = true;
    let (from_player, owner, damage, crit, explode_r, k, knock) = (pr.from_player, pr.owner, pr.damage, pr.crit, pr.explode_r, pr.explode_k, pr.knock);
    let src = if from_player { run.player_idx(owner) } else { None };
    if explode_r > 0.0 {
        let str = shot_str(run, from_player, owner);
        explode(run, pos, explode_r, damage, from_player, src, k, crit, knock, str);
        return;
    }
    match target {
        Some(Creature::Monster(mi)) if from_player => {
            run.hurt_monster(mi, damage, crit, src);
        }
        Some(c) if !from_player => run.hurt_creature(c, damage),
        _ => {}
    }
}

/// Projectile `i` hits a solid object: an explosion goes off there, a plain shot hurts the object.
fn impact_object(run: &mut Run, i: usize, pos: Vec2, oi: usize) {
    let pr = &mut run.projectiles[i];
    pr.dead = true;
    let (from_player, owner, damage, crit, explode_r, k, knock) = (pr.from_player, pr.owner, pr.damage, pr.crit, pr.explode_r, pr.explode_k, pr.knock);
    if explode_r > 0.0 {
        let src = if from_player { run.player_idx(owner) } else { None };
        let str = shot_str(run, from_player, owner);
        explode(run, pos, explode_r, damage, from_player, src, k, crit, knock, str);
    } else {
        crate::run::objects::hurt_object(run, oi, damage, from_player.then_some(owner));
    }
}

/// The STR an exploding shot pushes with: its monster's (`Run::push_str`, a boss's
/// `BOSS_KNOCK_STR`). Only bosses fire pushing shots and they are never removed,
/// so a shot whose owner is gone is taken as a boss's. Hero explosions never push.
fn shot_str(run: &Run, from_player: bool, owner: u32) -> i32 {
    if from_player {
        return 0;
    }
    run.monster_idx(owner).map_or(crate::defs::bosses::BOSS_KNOCK_STR, |mi| run.push_str(mi))
}

#[allow(clippy::too_many_arguments)]
/// An explosion; `knock` pushes the heroes it hits straight away from it (px, enemy
/// explosions only), with STR `str` against their weight.
pub fn explode(run: &mut Run, pos: Vec2, r: f64, damage: Damage, from_player: bool, src: Option<usize>, k: u8, crit: bool, knock: f64, str: i32) {
    // The heroes see their own explosions even out of view.
    run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: r as f32, k }, (!from_player).then_some(pos));
    run.add_flash(LightKind::Blast, pos, lights::BLAST_FLASH);
    if from_player {
        let hits: Vec<usize> = run
            .monsters
            .iter()
            .enumerate()
            .filter(|(_, m)| m.alive && !m.is_ally() && m.pos.dist(pos) < r + m.radius && line_of_sight(&run.layout.map, pos, m.pos))
            .map(|(i, _)| i)
            .collect();
        for mi in hits {
            run.hurt_monster(mi, damage, crit, src);
        }
    } else {
        for c in run.foes_touching(pos, r, true) {
            run.hurt_creature(c, damage);
            run.knock_creature(c, pos, 0.0, knock, str);
        }
    }
    let by = src.map(|pi| run.players[pi].id);
    let objs: Vec<usize> = (0..run.objects.len())
        .filter(|&i| {
            let o = &run.objects[i];
            !o.gone && o.pos.dist(pos) < r + o.radius && line_of_sight(&run.layout.map, pos, o.pos)
        })
        .collect();
    for oi in objs {
        crate::run::objects::hurt_object(run, oi, damage, by);
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::test_run;
    use super::*;
    use crate::defs::enemies::EnemyType;
    use crate::protocol::{BossId, ClassId};

    fn put_monster_near(run: &mut Run, pi: usize, dist: f64) -> usize {
        let pos = run.players[pi].pos() + Vec2::new(dist, 0.0);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        run.spawn_enemy(EnemyType::OrcWarrior, pos, None, 1);
        run.monsters.len() - 1
    }

    #[test]
    fn ranger_uses_dagger_in_melee_range_and_crossbow_otherwise() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 10.0);
        let hp = run.monsters[mi].hp;
        try_use(&mut run, 0, true, 1);
        assert!(run.monsters[mi].hp < hp, "dagger hit immediately");
        assert!(run.projectiles.is_empty(), "no bolt fired");
        assert_eq!(run.players[0].cd1, ab::DAGGER_COOLDOWN);

        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        put_monster_near(&mut run, 0, 60.0);
        try_use(&mut run, 0, true, 1);
        assert_eq!(run.projectiles.len(), 1, "crossbow bolt fired");
        assert_eq!(run.projectiles[0].kind, EntityKind::Bolt);
    }

    #[test]
    fn melee_cannot_reach_a_flying_monster() {
        // Sword arc.
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 12.0);
        run.monsters[mi].airborne = true;
        let hp = run.monsters[mi].hp;
        try_use(&mut run, 0, true, 1);
        assert_eq!(run.monsters[mi].hp, hp, "the sword misses it in the air");
        run.monsters[mi].airborne = false;
        run.players[0].cd1 = 0.0;
        try_use(&mut run, 0, true, 2);
        assert!(run.monsters[mi].hp < hp, "and hits it on the ground");

        // Dagger: the ranger shoots the crossbow instead.
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 10.0);
        run.monsters[mi].airborne = true;
        assert_eq!(dagger_target(&run, 0), None);

        // Barbarian dash.
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 6.0);
        run.monsters[mi].airborne = true;
        let hp = run.monsters[mi].hp;
        dash_contact(&mut run, 0);
        assert_eq!(run.monsters[mi].hp, hp, "the dash passes under it");
    }

    #[test]
    fn an_enemy_explosion_with_knock_pushes_heroes_away() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Dragon);
        let at = run.players[0].pos() - Vec2::new(10.0, 0.0);
        explode(&mut run, at, 30.0, Damage::physical(5.0), false, None, 4, false, 20.0, crate::defs::bosses::BOSS_KNOCK_STR);
        assert!(run.players[0].mv.knock_vx > 0.0, "pushed east, away from the blast");
        let mut run = test_run(&[ClassId::Paladin], BossId::Dragon);
        explode(&mut run, at, 30.0, Damage::physical(5.0), false, None, 4, false, 0.0, 0);
        assert!(!run.players[0].mv.knocked(), "no knock: no push");
    }

    /// A player missile placed `dy` px north of the monster's feet, flying east past it.
    fn missile_past(run: &mut Run, mi: usize, dy: f64) {
        let at = run.monsters[mi].pos + Vec2::new(-6.0, -dy);
        assert!(!run.layout.map.opaque_at(at) && !run.layout.map.opaque_at(at + Vec2::new(12.0, 0.0)), "open floor for the test shot");
        spawn_player_projectile(run, 0, EntityKind::Missile, 1, Vec2::new(1.0, 0.0), 230.0, 5.0, 3.0, 1.0, 0.0, None, false, None, 0);
        run.projectiles[0].pos = at;
        for _ in 0..3 {
            tick_projectiles(run, 1.0 / TICK_HZ);
        }
        run.projectiles.retain(|p| !p.dead);
    }

    #[test]
    fn shots_hit_the_upper_body_of_tall_figures() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let pos = run.players[0].pos() + Vec2::new(40.0, 0.0);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        run.spawn_enemy(EnemyType::Ogre, pos, None, 1);
        let mi = run.monsters.len() - 1;
        let hp = run.monsters[mi].hp;
        // The ogre is drawn 26 px tall; a shot at its chest (drawn 8 px above its ground point) hits.
        missile_past(&mut run, mi, 18.0);
        assert!(run.monsters[mi].hp < hp, "chest hit");
        // Above its head: a miss.
        let hp = run.monsters[mi].hp;
        missile_past(&mut run, mi, 32.0);
        assert_eq!(run.monsters[mi].hp, hp, "over its head");
        // The demon (58 px) is hit up to its horns.
        let demon = run.monsters.iter().find(|m| m.kind == EntityKind::Demon).unwrap();
        assert!(demon.shot_dist(demon.pos - Vec2::new(0.0, 45.0)) < demon.radius);
        assert!(demon.shot_dist(demon.pos - Vec2::new(0.0, 70.0)) > demon.radius + 3.0);
        // Small figures keep their round hitbox.
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 40.0);
        let hp = run.monsters[mi].hp;
        missile_past(&mut run, mi, 16.0);
        assert_eq!(run.monsters[mi].hp, hp, "over the orc's head");
    }

    #[test]
    fn a_fireball_only_singes_a_demon_and_burns_a_skeleton() {
        use crate::defs::damage::kind_split;
        let blast = |t: EnemyType| {
            let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
            run.monsters.retain(|m| m.is_boss || m.owner.is_some());
            let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
            let id = run.spawn_enemy(t, at, None, 1);
            let mi = run.monster_idx(id).unwrap();
            run.monsters[mi].hp = 1000.0;
            explode(&mut run, at, 20.0, Damage::new(10.0, kind_split(EntityKind::Fireball)), true, Some(0), 0, false, 0.0, 0);
            1000.0 - run.monsters[run.monster_idx(id).unwrap()].hp
        };
        // 70 % heat (demons: immune), 20 % magical (demons: 20 %), 10 % physical.
        assert!((blast(EnemyType::Imp) - (2.0 * 0.8 + 1.0)).abs() < 1e-9);
        // Skeletons: heat -10 %, physical 10 %.
        assert!((blast(EnemyType::SkeletonWarrior) - (7.0 * 1.1 + 2.0 + 1.0 * 0.9)).abs() < 1e-9);
        assert!((blast(EnemyType::OrcWarrior) - 10.0).abs() < 1e-9, "no resistances");
    }

    #[test]
    fn shots_carry_the_type_of_their_kind() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        try_use(&mut run, 0, true, 1);
        assert_eq!(run.projectiles[0].damage.split, crate::defs::damage::DamageSplit::pure(crate::defs::damage::DamageType::Magical));
    }

    #[test]
    fn hits_by_heroes_are_shown_even_out_of_view() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 40.0);
        run.events.clear();
        run.hurt_monster(mi, Damage::physical(5.0), false, Some(0));
        assert!(matches!(run.events[..], [(Ev::Dmg { .. }, None)]), "damage number sent to the whole party");
        run.events.clear();
        let at = run.monsters[mi].pos;
        explode(&mut run, at, 20.0, Damage::physical(5.0), true, Some(0), 0, false, 0.0, 0);
        assert!(matches!(run.events[0], (Ev::Boom { .. }, None)), "the hero's explosion too");
        run.events.clear();
        run.hurt_monster(mi, Damage::physical(5.0), false, None);
        assert!(matches!(run.events[..], [(Ev::Dmg { .. }, Some(_))]), "other damage only where seen");
    }

    #[test]
    fn a_shot_stops_at_the_first_enemy_even_when_fast_forwarded() {
        for (class, ability) in [(ClassId::Wizard, AbilityId::MagicMissile), (ClassId::ElvenRanger, AbilityId::CrossbowDagger)] {
            // Up to 150 ms fast-forward: the shot starts ~40 px out, past the first orc.
            for rtt in [0.0, 0.1, 0.3] {
                let mut run = test_run(&[class], BossId::Demon);
                run.monsters.retain(|m| m.is_boss || m.owner.is_some());
                let p = run.players[0].pos();
                let line: Vec<usize> = [30.0, 40.0, 50.0]
                    .iter()
                    .map(|&d| {
                        run.spawn_enemy(EnemyType::OrcWarrior, p + Vec2::new(d, 0.0), None, 1);
                        run.monsters.len() - 1
                    })
                    .collect();
                run.players[0].aim = 0.0;
                run.players[0].rtt = rtt;
                let hp: Vec<f64> = line.iter().map(|&mi| run.monsters[mi].hp).collect();
                assert_eq!(run.players[0].sheet.primary.id, ability);
                try_use(&mut run, 0, true, 1);
                for _ in 0..30 {
                    tick_projectiles(&mut run, 1.0 / TICK_HZ);
                }
                let hit: Vec<bool> = line.iter().zip(&hp).map(|(&mi, &h)| run.monsters[mi].hp < h).collect();
                assert_eq!(hit, [true, false, false], "{class:?} at rtt {rtt}: only the first orc");
            }
        }
    }

    #[test]
    fn cooldown_is_enforced() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        try_use(&mut run, 0, true, 1);
        try_use(&mut run, 0, true, 2);
        assert_eq!(run.projectiles.len(), 1);
    }

    #[test]
    fn shots_stop_at_a_barrel_and_light_it() {
        for from_player in [true, false] {
            let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
            run.monsters.retain(|m| m.is_boss);
            let p = run.players[0].pos();
            let id = run.spawn_object(EntityKind::Barrel, p + Vec2::new(30.0, 0.0), crate::run::objects::ObjState::Barrel(crate::run::objects::Barrel::new()));
            run.spawn_enemy(EnemyType::OrcWarrior, p + Vec2::new(50.0, 0.0), None, 1);
            let hp = run.monsters.last().unwrap().hp;
            if from_player {
                run.players[0].aim = 0.0;
                try_use(&mut run, 0, true, 1);
            } else {
                spawn_monster_projectile(&mut run, 999, EntityKind::Arrow, p + Vec2::new(10.0, 0.0), Vec2::new(1.0, 0.0), 180.0, 5.0, 2.0, 0.0, 0, 0.0);
            }
            for _ in 0..30 {
                tick_projectiles(&mut run, 1.0 / TICK_HZ);
            }
            let o = run.objects.iter().find(|o| o.id == id).unwrap();
            assert!(matches!(&o.state, crate::run::objects::ObjState::Barrel(b) if b.fuse.is_some()), "lit (player shot: {from_player})");
            assert_eq!(run.monsters.last().unwrap().hp, hp, "the orc behind it is spared");
        }
    }

    #[test]
    fn a_sword_swing_and_a_fireball_light_barrels() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        let p = run.players[0].pos();
        let id = run.spawn_object(EntityKind::Barrel, p + Vec2::new(14.0, 0.0), crate::run::objects::ObjState::Barrel(crate::run::objects::Barrel::new()));
        run.players[0].aim = 0.0;
        try_use(&mut run, 0, true, 1);
        let lit = |run: &Run| matches!(&run.objects.iter().find(|o| o.id == id).unwrap().state, crate::run::objects::ObjState::Barrel(b) if b.fuse.is_some());
        assert!(lit(&run));
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
        let id2 = run.spawn_object(EntityKind::Barrel, at, crate::run::objects::ObjState::Barrel(crate::run::objects::Barrel::new()));
        explode(&mut run, at + Vec2::new(10.0, 0.0), 20.0, Damage::physical(5.0), true, Some(0), 0, false, 0.0, 0);
        assert!(matches!(&run.objects.iter().find(|o| o.id == id2).unwrap().state, crate::run::objects::ObjState::Barrel(b) if b.fuse.is_some()));
    }

    #[test]
    fn a_targeted_blast_just_inside_a_wall_goes_off_and_flashes_in_front_of_it() {
        use crate::dungeon::{Map, Tile, TILE};
        use crate::run::light::Anchor;
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for x in tx..=tx + 2 {
            run.layout.map.set(x, ty, Tile::Floor);
        }
        run.layout.map.set(tx + 3, ty, Tile::Wall);
        // The aim point lies a hair inside the wall: the shot passes it on the step that enters the wall.
        let at = run.players[0].pos();
        let target = Vec2::new((tx + 3) as f64 * TILE + 0.01, at.y);
        spawn_player_projectile(&mut run, 0, EntityKind::Fireball, 1, Vec2::new(1.0, 0.0), 300.0, 1.0, 4.0, 2.0, 20.0, Some(target), false, None, 0);
        for _ in 0..30 {
            if run.projectiles.is_empty() {
                break;
            }
            run.step();
        }
        let flash = run.lights.sources.iter().find(|s| s.kind == LightKind::Blast).expect("a flash");
        let Anchor::Point(p) = flash.anchor else { panic!("a point light") };
        assert!(!run.layout.map.opaque_at(p), "the blast goes off in front of the wall, not inside it");
    }

    // ---- Damage-type effects at the source's governing Attribute ----

    /// Seconds of Burning left on `c`, if it burns.
    fn burn_left(run: &Run, c: Creature) -> Option<f64> {
        let fx = match c {
            Creature::Player(i) => &run.players[i].effects,
            Creature::Monster(i) => &run.monsters[i].effects,
        };
        fx.list().iter().find(|a| a.kind == crate::defs::effects::EffectKind::Burning).map(|a| a.left)
    }

    fn burn_secs(power: i32, con: i32) -> f64 {
        use crate::defs::effects::{def, scaled_secs, EffectKind};
        scaled_secs(def(EffectKind::Burning).duration, power, con)
    }

    #[test]
    fn a_fireball_burns_at_the_wizards_int() {
        use crate::defs::attributes::Attr;
        for int in [15, 18] {
            let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
            let mi = put_monster_near(&mut run, 0, 40.0);
            run.monsters[mi].hp = 1000.0;
            let p = &mut run.players[0];
            assert_eq!(p.sheet.attrs.get(Attr::Int), 15);
            p.sheet.attrs.add(Attr::Int, int - 15);
            (p.aim, p.aim_dist) = (0.0, 40.0);
            try_use(&mut run, 0, false, 1);
            for _ in 0..60 {
                tick_projectiles(&mut run, 1.0 / TICK_HZ);
            }
            let con = run.monsters[mi].attrs.get(Attr::Con);
            assert_eq!(burn_left(&run, Creature::Monster(mi)), Some(burn_secs(int, con)), "INT {int} against the orc's CON {con}");
        }
    }

    /// A fire bolt fired by an enemy of type `t` (CHA set to `cha` if given) at the Paladin: the burn's seconds.
    fn fire_bolt_burn(t: EnemyType, cha: Option<i32>) -> Option<f64> {
        use crate::defs::attributes::Attr;
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let p = run.players[0].pos();
        let id = run.spawn_enemy(t, p + Vec2::new(60.0, 0.0), None, 1);
        if let Some(cha) = cha {
            let mi = run.monster_idx(id).unwrap();
            let now = run.monsters[mi].attrs.get(Attr::Cha);
            run.monsters[mi].attrs.add(Attr::Cha, cha - now);
        }
        spawn_monster_projectile(&mut run, id, EntityKind::FireBolt, p - Vec2::new(10.0, 0.0), Vec2::new(1.0, 0.0), 180.0, 1.0, 2.0, 0.0, 0, 0.0);
        for _ in 0..30 {
            tick_projectiles(&mut run, 1.0 / TICK_HZ);
        }
        burn_left(&run, Creature::Player(0))
    }

    #[test]
    fn a_fire_bolt_burns_at_its_casters_governing_attribute() {
        let con = crate::defs::classes::def(ClassId::Paladin).attrs.get(crate::defs::attributes::Attr::Con);
        assert_eq!(con, 13);
        assert_eq!(fire_bolt_burn(EnemyType::Imp, None), Some(burn_secs(14, con)), "the imp's innate fire: CHA 14");
        assert_eq!(fire_bolt_burn(EnemyType::Chort, None), Some(burn_secs(10, con)), "the chort's CHA 9: at least 10");
        assert_eq!(fire_bolt_burn(EnemyType::Summoner, None), Some(burn_secs(15, con)), "the summoner's spell: INT 15, not CHA 16");
        assert_eq!(fire_bolt_burn(EnemyType::Imp, Some(6)), Some(burn_secs(10, con)), "CHA 6: at least 10");
    }

    #[test]
    fn a_shot_whose_owner_is_unknown_burns_at_10() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let p = run.players[0].pos();
        spawn_monster_projectile(&mut run, 999, EntityKind::FireBolt, p - Vec2::new(10.0, 0.0), Vec2::new(1.0, 0.0), 180.0, 1.0, 2.0, 0.0, 0, 0.0);
        for _ in 0..30 {
            tick_projectiles(&mut run, 1.0 / TICK_HZ);
        }
        assert_eq!(burn_left(&run, Creature::Player(0)), Some(burn_secs(10, 13)));
    }

    #[test]
    fn lava_and_a_barrel_blast_burn_at_10() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.clear();
        run.objects.clear();
        run.hurt_player(0, crate::defs::objects::barrel_blast());
        assert_eq!(burn_left(&run, Creature::Player(0)), Some(burn_secs(10, 13)), "the barrel");
        run.remove_effect(Creature::Player(0), crate::defs::effects::EffectKind::Burning);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        run.set_tile(tx, ty, crate::dungeon::Tile::Lava);
        run.step();
        let left = burn_left(&run, Creature::Player(0)).expect("lava burns");
        assert!((left - burn_secs(10, 13)).abs() < 0.1, "lava, a tick later: {left}");
    }

}
