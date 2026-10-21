//! Player abilities (one executor per AbilityId) and projectile simulation.

use super::entities::{Pierce, Projectile};
use super::{Run, TICK_HZ};
use crate::collision::line_of_sight;
use crate::defs::abilities::AbilityId;
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::damage::{kind_split, overkill_rest, Damage, DamageSplit};
use crate::defs::effects::OnHit;
use crate::defs::kinds::{Anim, EntityKind};
use crate::defs::lights::{self, LightKind};
use super::effects::Creature;
use crate::math::{angle_diff, Vec2};
use crate::protocol::Ev;
use crate::sheet::ResolvedAbility;

/// Cooldowns tick per processed input on both client and server; a small
/// tolerance absorbs rounding differences.
const COOLDOWN_LEEWAY: f64 = 0.05;

/// How many ticks to rewind monsters for this player's hit checks.
fn rewind_ticks(run: &Run, pi: usize) -> usize {
    ((run.players[pi].view_lag * TICK_HZ).round() as usize).min(super::entities::HISTORY_LEN - 1)
}

/// What a hero's melee strike hits: a monster, or a closed chest (so a chest and a hidden mimic answer alike).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MeleeTarget {
    Monster(usize),
    Object(usize),
}

/// Every monster on the ground (not an ally) or closed chest within the hero's reach, nearest first.
pub fn melee_targets(run: &Run, pi: usize) -> Vec<MeleeTarget> {
    let rw = rewind_ticks(run, pi);
    let pos = run.players[pi].pos();
    let reach = run.players[pi].sheet.reach;
    let monsters = run
        .monsters
        .iter()
        .enumerate()
        .filter(|(_, m)| m.alive && !m.airborne && !m.is_ally())
        .map(|(i, m)| (MeleeTarget::Monster(i), m.pos_ago(rw).dist(pos) - m.radius));
    let chests = run
        .objects
        .iter()
        .enumerate()
        .filter(|(_, o)| !o.gone && matches!(o.state, crate::run::objects::ObjState::Chest { opened: None }))
        .map(|(i, o)| (MeleeTarget::Object(i), o.pos.dist(pos) - o.radius));
    let mut near: Vec<(MeleeTarget, f64)> = monsters.chain(chests).filter(|&(_, d)| d <= reach).collect();
    near.sort_by(|a, b| a.1.total_cmp(&b.1));
    near.into_iter().map(|(t, _)| t).collect()
}

/// The nearest thing in melee reach: where a ranged primary strikes instead of shooting, and what blocks a ranged secondary.
pub fn melee_target(run: &Run, pi: usize) -> Option<MeleeTarget> {
    melee_targets(run, pi).first().copied()
}

/// The melee-rule strike: `strike` hits the nearest of `targets`; a kill carries the rest of its damage on to the next.
fn melee_strike(run: &mut Run, pi: usize, targets: &[MeleeTarget], strike: &ResolvedAbility, crit: bool) {
    let pos = run.players[pi].pos();
    let aim = run.players[pi].aim;
    let mut dmg = damage_of(strike);
    for &t in targets {
        match t {
            MeleeTarget::Monster(mi) => {
                let m = &run.monsters[mi];
                let rest = overkill_rest(dmg.amount, &dmg.split, m.hp, &m.effects.res(m.res));
                run.hurt_monster(mi, dmg, crit, Some(pi));
                if strike.push > 0.0 {
                    run.knock_creature(Creature::Monster(mi), pos, aim, strike.push, strike.push_str);
                }
                match rest {
                    Some(rest) if !run.monsters[mi].alive => dmg.amount = rest,
                    _ => break,
                }
            }
            MeleeTarget::Object(oi) => {
                let by = run.players[pi].id;
                crate::run::objects::hurt_object(run, oi, dmg, Some(by));
                break;
            }
        }
    }
}

/// The projectile kind for an `EntityKind` id.
fn kind_of(id: Option<u8>) -> EntityKind {
    EntityKind::ALL.into_iter().find(|&k| Some(k as u8) == id).expect("a shot has a projectile")
}

/// The damage of one hit of `a`: its split, on-hit and power.
fn damage_of(a: &ResolvedAbility) -> Damage {
    Damage { on_hit: a.on_hit, ..Damage::new(a.damage, a.split).with_power(a.power) }
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
    let cooldown = def.cooldown;
    if def.ranged {
        let targets = melee_targets(run, pi);
        if !targets.is_empty() {
            if !primary {
                return;
            }
            let fallback = run.players[pi].sheet.fallback;
            melee_strike(run, pi, &targets, &fallback, crit);
            let p = &mut run.players[pi];
            p.cd1 = fallback.cooldown;
            p.anim = Anim::Melee;
            p.anim_start = run.time;
            return;
        }
    }
    let anim = match id {
        AbilityId::MagicMissile => {
            spawn_player_projectile(run, pi, EntityKind::Missile, shot, dir, def.speed, def.damage, def.radius, def.range / def.speed, 0.0, None, crit, def.split, def.on_hit, def.power, Pierce::new(def.pierce, def.pierce_through));
            Anim::Shoot
        }
        AbilityId::Fireball => {
            let target = pos + dir * aim_dist.clamp(24.0, def.range);
            let life = def.range / def.speed + 0.1;
            spawn_player_projectile(run, pi, EntityKind::Fireball, shot, dir, def.speed, def.damage, 4.0, life, def.radius, Some(target), crit, def.split, def.on_hit, def.power, Pierce::Never);
            Anim::Cast
        }
        AbilityId::Strike => {
            melee_arc(run, pi, &def, crit);
            Anim::Melee
        }
        AbilityId::HolyLight => {
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
        AbilityId::Charge => {
            let p = &mut run.players[pi];
            p.mv.dash_t = def.duration;
            p.mv.dash_dx = dir.x;
            p.mv.dash_dy = dir.y;
            p.dash_hit.clear();
            Anim::Dash
        }
        AbilityId::Shoot => {
            spawn_player_projectile(run, pi, kind_of(def.projectile), shot, dir, def.speed, def.damage, def.radius, def.range / def.speed, 0.0, None, crit, def.split, def.on_hit, def.power, Pierce::new(def.pierce, def.pierce_through));
            Anim::Shoot
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

/// A swing of the melee ability `a` (its reach, arc, damage, split, on-hit and power).
fn melee_arc(run: &mut Run, pi: usize, a: &ResolvedAbility, crit: bool) {
    let rw = rewind_ticks(run, pi);
    let (pos, aim) = (run.players[pi].pos(), run.players[pi].aim);
    let (range, arc, dmg) = (a.range, a.arc, damage_of(a));
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
        if a.push > 0.0 {
            run.knock_creature(Creature::Monster(mi), pos, aim, a.push, a.push_str);
        }
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

/// Barbarian Charge: damage each monster touched once per dash, with the secondary's damage, split, on-hit and power.
pub fn dash_contact(run: &mut Run, pi: usize) {
    let rw = rewind_ticks(run, pi);
    let pos = run.players[pi].pos();
    let (aim, ab) = (run.players[pi].aim, run.players[pi].sheet.secondary);
    let dmg = damage_of(&ab);
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
        if ab.push > 0.0 {
            run.knock_creature(Creature::Monster(mi), pos, aim, ab.push, ab.push_str);
        }
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
    split: DamageSplit,
    on_hit: Option<OnHit>,
    power: i32,
    pierce: Pierce,
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
        damage: Damage { on_hit, ..Damage::new(damage, split).with_power(power) },
        radius,
        life: (life - ff).max(0.05),
        crit,
        explode_r,
        explode_k: 0,
        knock: 0.0,
        target,
        dead: false,
        pierce,
        hit: Vec::new(),
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
        pierce: Pierce::Never,
        hit: Vec::new(),
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

/// Moves projectile `i` for `dt` in steps of at most 4 px. It ends at the first wall,
/// target point or object it meets, and at a figure unless it pierces it (`impact`);
/// it never hits a figure twice.
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
        let target = if pr.from_player {
            run.monsters.iter().position(|m| m.alive && !m.is_ally() && !pr.hit.contains(&m.id) && m.shot_dist(pos) < m.radius + pr.radius).map(Creature::Monster)
        } else {
            // Heroes first, then allies.
            let hero = run.players.iter().position(|p| p.alive && !pr.hit.contains(&p.id) && p.pos().dist(pos) < PLAYER_RADIUS + pr.radius).map(Creature::Player);
            let ally = || {
                run.monsters
                    .iter()
                    .position(|m| m.is_ally() && m.alive && m.sinking.is_none() && !pr.hit.contains(&m.id) && m.shot_dist(pos) < m.radius + pr.radius)
                    .map(Creature::Monster)
            };
            hero.or_else(ally)
        };
        if let Some(c) = target {
            impact(run, i, pos, Some(c));
            // A piercing shot flies on through the rest of this step.
            if run.projectiles[i].dead {
                break;
            }
        }
    }
}

/// Projectile `i` hits something at `pos` (a creature on the opposing team, if any).
/// An explosion never pierces. A shot that pierces (`Pierce`) stays alive: through-piercing
/// with full damage, overkill with the rest of its damage after a kill.
fn impact(run: &mut Run, i: usize, pos: Vec2, target: Option<Creature>) {
    let pr = &mut run.projectiles[i];
    pr.dead = true;
    let (from_player, owner, damage, crit, explode_r, k, knock, pierce) = (pr.from_player, pr.owner, pr.damage, pr.crit, pr.explode_r, pr.explode_k, pr.knock, pr.pierce);
    let src = if from_player { run.player_idx(owner) } else { None };
    if explode_r > 0.0 {
        let str = shot_str(run, from_player, owner);
        explode(run, pos, explode_r, damage, from_player, src, k, crit, knock, str);
        return;
    }
    let Some(c) = target else { return };
    // The rest after a kill, from the target's HP and resistances before the hit.
    let rest = match pierce {
        Pierce::Overkill { left } if left > 0 => overkill_left(run, c, &damage),
        Pierce::Overkill { .. } | Pierce::Never | Pierce::Through { .. } => None,
    };
    match c {
        Creature::Monster(mi) if from_player => {
            run.hurt_monster(mi, damage, crit, src);
        }
        _ if !from_player => run.hurt_creature(c, damage),
        _ => {}
    }
    let (id, alive) = match c {
        Creature::Player(pi) => (run.players[pi].id, run.players[pi].alive),
        Creature::Monster(mi) => (run.monsters[mi].id, run.monsters[mi].alive),
    };
    let pr = &mut run.projectiles[i];
    let next = match pr.pierce {
        Pierce::Through { left, then } if left > 0 => Some(if left == 1 { Pierce::from_u8(then) } else { Pierce::Through { left: left - 1, then } }),
        Pierce::Overkill { left } => match rest {
            Some(rest) if !alive => {
                pr.damage.amount = rest;
                Some(if left == u8::MAX { pr.pierce } else { Pierce::from_u8(left - 1) })
            }
            Some(_) | None => None,
        },
        Pierce::Through { .. } | Pierce::Never => None,
    };
    if let Some(next) = next {
        pr.pierce = next;
        pr.hit.push(id);
        pr.dead = false;
    }
}

/// What is left of `damage` if it kills creature `c` (`overkill_rest`), with the HP, resistances
/// and armor its hurt function uses.
fn overkill_left(run: &Run, c: Creature, damage: &Damage) -> Option<f64> {
    let (hp, res, armor) = match c {
        Creature::Player(pi) => {
            let p = &run.players[pi];
            (p.hp, p.effects.res(p.res), p.sheet.armor)
        }
        Creature::Monster(mi) => {
            let m = &run.monsters[mi];
            (m.hp, m.effects.res(m.res), 0.0)
        }
    };
    // A hero's armor takes its share after the resistances (`hurt_player`).
    if armor >= 1.0 {
        return None;
    }
    overkill_rest(damage.amount, &damage.split, hp / (1.0 - armor), &res)
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
        run.spawn_enemy(EnemyType::OrcWarrior, pos, None);
        run.monsters.len() - 1
    }

    /// An enemy of type `t` `dist` px east of hero `pi`, with `hp`; its index.
    fn put_enemy(run: &mut Run, pi: usize, t: EnemyType, dist: f64, hp: f64) -> usize {
        let pos = run.players[pi].pos() + Vec2::new(dist, 0.0);
        let id = run.spawn_enemy(t, pos, None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].hp = hp;
        run.monsters[mi].max_hp = run.monsters[mi].max_hp.max(hp);
        mi
    }

    #[test]
    fn a_ranged_primary_strikes_in_melee() {
        use crate::defs::damage::DamageType;
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 10.0);
        let hp = run.monsters[mi].hp;
        try_use(&mut run, 0, true, 1);
        assert!(run.monsters[mi].hp < hp, "the thrust hit immediately");
        assert!(run.projectiles.is_empty(), "no bolt fired");
        assert_eq!(run.players[0].cd1, 0.35, "the rapier's interval");

        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 10.0);
        let hp = run.monsters[mi].hp;
        let res = run.monsters[mi].res.get(DamageType::Physical);
        try_use(&mut run, 0, true, 1);
        assert!((hp - run.monsters[mi].hp - 6.0 * (1.0 - res)).abs() < 1e-9, "the Red Staff at STR 8");
        assert!(run.projectiles.is_empty());
        assert_eq!(run.players[0].cd1, 1.0);

        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        put_monster_near(&mut run, 0, 60.0);
        try_use(&mut run, 0, true, 1);
        assert_eq!(run.projectiles.len(), 1);
        assert_eq!(run.projectiles[0].kind, EntityKind::Missile);
    }

    #[test]
    fn a_ranged_secondary_in_melee_does_nothing() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 10.0);
        let hp = run.monsters[mi].hp;
        run.events.clear();
        try_use(&mut run, 0, false, 1);
        assert!(run.projectiles.is_empty());
        assert_eq!(run.players[0].cd2, 0.0);
        assert_eq!(run.monsters[mi].hp, hp);
        assert!(run.events.is_empty(), "no event");
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        put_monster_near(&mut run, 0, 60.0);
        try_use(&mut run, 0, false, 1);
        assert_eq!(run.projectiles.len(), 1);
        assert_eq!(run.projectiles[0].kind, EntityKind::Fireball);
        assert_eq!(run.players[0].cd2, 6.0);
    }

    #[test]
    fn area_and_self_abilities_still_fire_in_melee() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        put_monster_near(&mut run, 0, 10.0);
        try_use(&mut run, 0, false, 1);
        assert_eq!(run.players[0].cd2, 10.0);
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        put_monster_near(&mut run, 0, 10.0);
        try_use(&mut run, 0, false, 1);
        assert!(run.players[0].mv.dash_t > 0.0);
    }

    #[test]
    fn shoot_fires_its_weapons_projectile() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.players[0].sheet.primary.projectile = Some(EntityKind::Arrow as u8);
        try_use(&mut run, 0, true, 1);
        assert_eq!(run.projectiles[0].kind, EntityKind::Arrow);
    }

    #[test]
    fn ranged_properties_stay_off_melee() {
        use crate::defs::damage::DamageType;
        use crate::defs::effects::{EffectKind, OnHit};
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        let heat = DamageSplit::pure(DamageType::Heat);
        run.players[0].sheet.primary.split = heat;
        let mi = put_monster_near(&mut run, 0, 10.0);
        run.monsters[mi].hp = 1000.0;
        run.events.clear();
        try_use(&mut run, 0, true, 1);
        let ty = run.events.iter().find_map(|(e, _)| if let Ev::Dmg { ty, .. } = e { Some(*ty) } else { None });
        assert_eq!(ty, Some(DamageType::Physical as u8), "the thrust is physical");
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.players[0].sheet.primary.split = heat;
        try_use(&mut run, 0, true, 1);
        assert_eq!(run.projectiles[0].damage.split, heat, "the bolt carries the primary's split");

        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        let hit = OnHit { kind: EffectKind::Slowed, secs: 2.0, magical: false, power: 10 };
        run.players[0].sheet.secondary.on_hit = Some(hit);
        let mi = put_monster_near(&mut run, 0, 6.0);
        run.monsters[mi].hp = 1000.0;
        dash_contact(&mut run, 0);
        assert!(run.monsters[mi].effects.list().iter().any(|a| a.kind == EffectKind::Slowed));
    }

    #[test]
    fn a_melee_kill_carries_on() {
        let goblins = |hps: [f64; 3]| {
            let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
            run.monsters.retain(|m| m.is_boss || m.owner.is_some());
            run.players[0].aim = 0.0;
            let mis: Vec<usize> = [8.0, 12.0, 16.0].iter().zip(hps).map(|(&d, hp)| put_enemy(&mut run, 0, EnemyType::GoblinArcher, d, hp)).collect();
            try_use(&mut run, 0, true, 1);
            mis.iter().map(|&mi| (run.monsters[mi].alive, run.monsters[mi].hp)).collect::<Vec<_>>()
        };
        let r = goblins([5.0, 5.0, 24.0]);
        assert!(!r[0].0 && !r[1].0);
        assert!((r[2].1 - 16.0).abs() < 1e-9, "24 - (18 - 5 - 5) = 16: {r:?}");
        let r = goblins([24.0, 5.0, 24.0]);
        assert!((r[0].1 - 6.0).abs() < 1e-9 && r[1].1 == 5.0 && r[2].1 == 24.0, "{r:?}");
    }

    #[test]
    fn a_pushing_weapon_pushes_on_strike() {
        for (push, pushed) in [(20.0, true), (0.0, false)] {
            let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
            run.monsters.retain(|m| m.is_boss || m.owner.is_some());
            run.players[0].aim = 0.0;
            let mi = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 12.0, 1000.0);
            run.players[0].sheet.primary.push = push;
            try_use(&mut run, 0, true, 1);
            assert_eq!(run.monsters[mi].knock.x > 0.0, pushed, "push {push}");
        }
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

        // Rapier: the ranger shoots the bow instead.
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 10.0);
        run.monsters[mi].airborne = true;
        assert_eq!(melee_target(&run, 0), None);

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
        spawn_player_projectile(run, 0, EntityKind::Missile, 1, Vec2::new(1.0, 0.0), 230.0, 5.0, 3.0, 1.0, 0.0, None, false, kind_split(EntityKind::Missile), None, 0, Pierce::Never);
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
        run.spawn_enemy(EnemyType::Ogre, pos, None);
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
            let id = run.spawn_enemy(t, at, None);
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
        for (class, ability) in [(ClassId::Wizard, AbilityId::MagicMissile), (ClassId::ElvenRanger, AbilityId::Shoot)] {
            // Up to 150 ms fast-forward: the shot starts ~40 px out, past the first orc.
            for rtt in [0.0, 0.1, 0.3] {
                let mut run = test_run(&[class], BossId::Demon);
                run.monsters.retain(|m| m.is_boss || m.owner.is_some());
                let p = run.players[0].pos();
                let line: Vec<usize> = [30.0, 40.0, 50.0]
                    .iter()
                    .map(|&d| {
                        run.spawn_enemy(EnemyType::OrcWarrior, p + Vec2::new(d, 0.0), None);
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

    // ---- Piercing: overkill and through ----

    /// Hero 0 aims east at enemies of type `t` at `dists` px with `hps`; it uses its primary,
    /// the shots fly for half a second, and each enemy's (alive, HP lost) comes back.
    fn shoot_line(mut run: Run, t: EnemyType, dists: &[f64], hps: &[f64]) -> Vec<(bool, f64)> {
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        run.players[0].aim = 0.0;
        let mis: Vec<usize> = dists.iter().zip(hps).map(|(&d, &hp)| put_enemy(&mut run, 0, t, d, hp)).collect();
        try_use(&mut run, 0, true, 1);
        assert!(!run.projectiles.is_empty(), "a shot");
        for _ in 0..30 {
            tick_projectiles(&mut run, 1.0 / TICK_HZ);
        }
        mis.iter().zip(hps).map(|(&mi, &hp)| (run.monsters[mi].alive, hp - run.monsters[mi].hp.max(0.0))).collect()
    }

    #[test]
    fn a_killing_bolt_flies_on() {
        let run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        assert_eq!(run.players[0].sheet.primary.damage, 16.0);
        let r = shoot_line(run, EnemyType::GoblinArcher, &[30.0, 40.0, 50.0], &[5.0, 5.0, 24.0]);
        assert!(!r[0].0 && !r[1].0, "{r:?}");
        assert!(r[2].0 && (r[2].1 - 6.0).abs() < 1e-9, "16 - 5 - 5 = 6: {r:?}");
    }

    #[test]
    fn an_exact_kill_stops_the_shot() {
        use crate::defs::effects::{EffectKind, OnHit};
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        assert_eq!(run.players[0].sheet.primary.damage, 16.0);
        run.players[0].sheet.primary.on_hit = Some(OnHit { kind: EffectKind::Slowed, secs: 2.0, magical: false, power: 10 });
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        run.players[0].aim = 0.0;
        let first = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 30.0, 16.0);
        let second = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 40.0, 24.0);
        try_use(&mut run, 0, true, 1);
        for _ in 0..30 {
            tick_projectiles(&mut run, 1.0 / TICK_HZ);
        }
        assert!(!run.monsters[first].alive);
        assert_eq!(run.monsters[second].hp, 24.0, "the goblin behind is untouched");
        assert!(run.monsters[second].effects.list().is_empty(), "and not slowed");
    }

    #[test]
    fn an_exact_melee_kill_stops_the_strike() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        run.players[0].aim = 0.0;
        // The rapier thrust does 18 (a_melee_kill_carries_on).
        let first = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 8.0, 18.0);
        let second = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 12.0, 24.0);
        run.events.clear();
        try_use(&mut run, 0, true, 1);
        assert!(!run.monsters[first].alive);
        assert_eq!(run.monsters[second].hp, 24.0, "the next goblin is untouched");
        let hurt = run.events.iter().filter(|(e, _)| matches!(e, Ev::Dmg { .. })).count();
        assert_eq!(hurt, 1, "one damage number");
    }

    #[test]
    fn spells_stop_at_the_first_enemy() {
        let run = test_run(&[ClassId::Wizard], BossId::Demon);
        let r = shoot_line(run, EnemyType::GoblinArcher, &[30.0, 40.0], &[1.0, 1.0]);
        assert_eq!(r, [(false, 1.0), (true, 0.0)]);

        use super::super::tests::test_run_with;
        use crate::defs::loadout::{Build, Pick, Source};
        let c = ClassId::Wizard;
        let mut b = Build::start(c);
        b.equipment = crate::defs::items::Equipment::starter(c).with(EquipSlot::Ring1, ItemId::SeekersBand);
        b.loadout.primary = Pick { ability: AbilityId::MagicMissile, source: Source::Item(EquipSlot::Ring1) };
        let run = test_run_with(&[(c, b)], BossId::Demon);
        assert_eq!(run.players[0].sheet.primary.pierce, 1);
        let r = shoot_line(run, EnemyType::GoblinArcher, &[30.0, 40.0, 50.0], &[1.0, 1.0, 1.0]);
        assert_eq!(r, [(false, 1.0), (false, 1.0), (true, 0.0)]);
    }

    #[test]
    fn an_immune_target_stops_the_shot() {
        use crate::defs::damage::DamageType;
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.players[0].sheet.primary.split = DamageSplit::pure(DamageType::Poison);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        run.players[0].aim = 0.0;
        let skel = put_enemy(&mut run, 0, EnemyType::SkeletonWarrior, 30.0, 1.0);
        let gob = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 40.0, 24.0);
        try_use(&mut run, 0, true, 1);
        for _ in 0..30 {
            tick_projectiles(&mut run, 1.0 / TICK_HZ);
        }
        assert!(run.monsters[skel].alive, "poison does not hurt the skeleton");
        assert_eq!(run.monsters[gob].hp, 24.0, "and the goblin behind it is untouched");
    }

    #[test]
    fn overkill_never_hits_the_same_enemy_twice() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        run.players[0].aim = 0.0;
        run.players[0].rtt = 0.3;
        let mi = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 30.0, 5.0);
        let x = run.monsters[mi].pos.x as f32;
        run.events.clear();
        try_use(&mut run, 0, true, 1);
        for _ in 0..30 {
            tick_projectiles(&mut run, 1.0 / TICK_HZ);
        }
        assert!(!run.monsters[mi].alive);
        let hurt = run.events.iter().filter(|(e, _)| matches!(e, Ev::Dmg { x: ex, .. } if *ex == x)).count();
        assert_eq!(hurt, 1);
    }

    #[test]
    fn through_piercing_ignores_hp() {
        let c = ClassId::ElvenRanger;
        let line = |hps: &[f64]| {
            let run = armed(c, EquipSlot::Ranged, ItemId::HuntersBow);
            assert_eq!(run.players[0].sheet.primary.pierce_through, 2);
            let bolt = run.players[0].sheet.primary.damage;
            (bolt, shoot_line(run, EnemyType::OrcWarrior, &[30.0, 40.0, 50.0, 60.0], hps))
        };
        // Two passes at full damage, then the overkill rule: the third is hit and stops the bolt.
        let (bolt, r) = line(&[70.0, 70.0, 70.0, 70.0]);
        assert_eq!(r, [(true, bolt), (true, bolt), (true, bolt), (true, 0.0)], "bolt {bolt}");
        // A 1-HP third orc dies, and the rest flies on to the fourth.
        let (bolt, r) = line(&[70.0, 70.0, 1.0, 70.0]);
        assert_eq!(&r[..2], [(true, bolt), (true, bolt)]);
        assert_eq!(r[2], (false, 1.0));
        assert!((r[3].1 - (bolt - 1.0)).abs() < 1e-9, "{r:?}");
    }

    #[test]
    fn a_through_mod_works_on_a_spell() {
        use crate::defs::loadout::{apply_mods, AbilityMod};
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        run.players[0].sheet.primary = apply_mods(run.players[0].sheet.primary, &[AbilityMod::PierceThrough(1)]);
        let dmg = run.players[0].sheet.primary.damage;
        let r = shoot_line(run, EnemyType::OrcWarrior, &[30.0, 40.0, 50.0], &[70.0, 70.0, 70.0]);
        assert_eq!(r, [(true, dmg), (true, dmg), (true, 0.0)]);
    }

    #[test]
    fn an_enemy_arrow_can_pierce() {
        let mut run = test_run(&[ClassId::Wizard, ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let p = run.players[0].pos();
        run.players[1].mv.x = p.x - 10.0;
        run.players[1].mv.y = p.y;
        run.players[0].hp = 1.0;
        let id = run.spawn_enemy(EnemyType::OrcArcher, p + Vec2::new(60.0, 0.0), None);
        let oi = run.monster_idx(id).unwrap();
        let attack = crate::defs::enemies::def(EnemyType::OrcArcher).attack;
        let hp = run.players[1].hp;
        crate::run::ai::perform_attack(&mut run, oi, Creature::Player(0), attack, false, None);
        assert_eq!(run.projectiles.last().unwrap().pierce, super::super::entities::Pierce::Overkill { left: u8::MAX });
        for _ in 0..60 {
            tick_projectiles(&mut run, 1.0 / TICK_HZ);
        }
        assert!(!run.players[0].alive, "the Wizard falls");
        assert!(run.players[1].hp < hp, "and the arrow flies on into the Paladin");
    }

    #[test]
    fn pierce_new_encodes_the_two_numbers() {
        use super::super::entities::Pierce;
        assert_eq!(Pierce::new(0, 0), Pierce::Never);
        assert_eq!(Pierce::new(3, 0), Pierce::Overkill { left: 3 });
        assert_eq!(Pierce::new(u8::MAX, 2), Pierce::Through { left: 2, then: u8::MAX });
        assert_eq!(Pierce::from_u8(0), Pierce::Never);
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
            run.spawn_enemy(EnemyType::OrcWarrior, p + Vec2::new(50.0, 0.0), None);
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
        spawn_player_projectile(&mut run, 0, EntityKind::Fireball, 1, Vec2::new(1.0, 0.0), 300.0, 1.0, 4.0, 2.0, 20.0, Some(target), false, kind_split(EntityKind::Fireball), None, 0, Pierce::Never);
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
            let mut extra = crate::defs::attributes::Attributes::default();
            extra.add(Attr::Int, int - 15);
            p.sheet = crate::sheet::hero_sheet(ClassId::Wizard, &crate::defs::loadout::Build { extra, ..crate::defs::loadout::Build::start(ClassId::Wizard) }).unwrap();
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
        let id = run.spawn_enemy(t, p + Vec2::new(60.0, 0.0), None);
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

    // ---- Weapon effects ride only on that weapon's attacks ----

    use crate::defs::items::{EquipSlot, ItemId};

    /// One hero of `class` wearing the starters with `item` in `slot`.
    fn armed(class: ClassId, slot: EquipSlot, item: ItemId) -> Run {
        use super::super::tests::{build_with, test_run_with};
        test_run_with(&[(class, build_with(class, slot, item))], BossId::Lich)
    }

    fn has_effects(run: &Run, mi: usize) -> bool {
        !run.monsters[mi].effects.list().is_empty()
    }

    #[test]
    fn weapon_effects_ride_only_on_weapon_attacks() {
        use crate::defs::attributes::Attr;
        use crate::defs::damage::{DamageSplit, DamageType};
        // A Paladin's Flame Tongue swing: half heat, so the orc burns at the wielder's STR 15.
        let mut run = armed(ClassId::Paladin, EquipSlot::Melee, ItemId::FlameTongue);
        let mi = put_monster_near(&mut run, 0, 12.0);
        run.monsters[mi].hp = 1000.0;
        run.players[0].aim = 0.0;
        try_use(&mut run, 0, true, 1);
        let con = run.monsters[mi].attrs.get(Attr::Con);
        assert_eq!(con, 16);
        assert_eq!(burn_left(&run, Creature::Monster(mi)), Some(burn_secs(15, con)), "the swing burns");

        // Her Holy Light does not carry the sword's heat.
        let mut run = armed(ClassId::Paladin, EquipSlot::Melee, ItemId::FlameTongue);
        let mi = put_monster_near(&mut run, 0, 20.0);
        assert_eq!(run.players[0].sheet.secondary.id, AbilityId::HolyLight);
        assert!(run.monsters[mi].pos.dist(run.players[0].pos()) <= run.players[0].sheet.secondary.radius);
        try_use(&mut run, 0, false, 1);
        assert!(!has_effects(&run, mi), "Holy Light leaves the orc as it was");

        // A Barbarian dashing through an orc with Flame Tongue.
        let mut run = armed(ClassId::Barbarian, EquipSlot::Melee, ItemId::FlameTongue);
        let mi = put_monster_near(&mut run, 0, 6.0);
        run.monsters[mi].hp = 1000.0;
        dash_contact(&mut run, 0);
        let power = run.players[0].sheet.melee.power;
        assert_eq!(burn_left(&run, Creature::Monster(mi)), Some(burn_secs(power, 16)), "the dash burns");

        // The Ember Staff's heat stays off Magic Missile.
        let mut run = armed(ClassId::Wizard, EquipSlot::Melee, ItemId::EmberStaff);
        assert!(run.players[0].sheet.melee.split.share(DamageType::Heat) > 0.0);
        try_use(&mut run, 0, true, 1);
        assert_eq!(run.projectiles[0].damage.split, kind_split(EntityKind::Missile));

        // The wolf bites with its own race's split, whatever its owner wields.
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Lich);
        run.players[0].sheet.melee.split = DamageSplit::pure(DamageType::Heat);
        assert_eq!(run.players[0].sheet.secondary.id, AbilityId::SummonWolf);
        try_use(&mut run, 0, false, 1);
        let wolf = run.players[0].wolf.and_then(|id| run.monster_idx(id)).expect("a wolf");
        let bite = run.monsters[wolf].melee;
        assert!((bite.share(DamageType::Magical) - 0.2).abs() < 1e-12, "{bite:?}");
        assert_eq!(bite.share(DamageType::Heat), 0.0);
    }

    /// A torch on a wall north of hero 0, with the hero right under it, facing it.
    fn torch_ahead(run: &mut Run) -> usize {
        use crate::dungeon::{Map, Tile, TorchSide, TorchSpawn};
        run.monsters.retain(|m| m.is_boss);
        run.objects.clear();
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 1..=ty + 1 {
            for x in tx - 2..=tx + 2 {
                run.layout.map.set(x, y, Tile::Floor);
            }
        }
        for x in tx - 2..=tx + 2 {
            run.layout.map.set(x, ty - 2, Tile::Wall);
        }
        run.spawn_torch(&TorchSpawn { wall: (tx, ty - 2), side: TorchSide::Face });
        let oi = run.objects.len() - 1;
        let at = run.objects[oi].pos;
        run.players[0].mv.x = at.x;
        run.players[0].mv.y = at.y + 8.0;
        run.players[0].aim = -std::f64::consts::FRAC_PI_2;
        oi
    }

    fn torch_lit(run: &Run, oi: usize) -> bool {
        matches!(run.objects[oi].state, crate::run::objects::ObjState::Torch { light, .. } if crate::run::objects::torch_on(run, light))
    }

    #[test]
    fn a_flaming_sword_lights_a_torch() {
        let mut run = armed(ClassId::Paladin, EquipSlot::Melee, ItemId::FlameTongue);
        let oi = torch_ahead(&mut run);
        crate::run::objects::set_torch(&mut run, oi, false);
        try_use(&mut run, 0, true, 1);
        assert!(torch_lit(&run, oi), "Flame Tongue lights it");

        let mut run = armed(ClassId::Paladin, EquipSlot::Melee, ItemId::KnightSword);
        let oi = torch_ahead(&mut run);
        assert!(torch_lit(&run, oi));
        try_use(&mut run, 0, true, 1);
        assert!(!torch_lit(&run, oi), "a plain sword puts it out");
    }

    #[test]
    fn the_staff_of_rot_poisons_every_hit() {
        use crate::defs::attributes::Attr;
        use crate::defs::effects::{scaled_secs, EffectKind};
        let mut run = armed(ClassId::Wizard, EquipSlot::Melee, ItemId::StaffOfRot);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let id = run.spawn_enemy(EnemyType::GoblinArcher, run.players[0].pos() + Vec2::new(12.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].hp = 1000.0;
        run.players[0].aim = 0.0;
        assert_eq!(run.players[0].sheet.attrs.get(Attr::Str), 8);
        let con = run.monsters[mi].attrs.get(Attr::Con);
        assert_eq!(con, 10);
        let strike = ResolvedAbility { range: 20.0, arc: 1.6, damage: 6.0, ..run.players[0].sheet.fallback };
        melee_arc(&mut run, 0, &strike, false);
        let poison = run.monsters[mi].effects.list().iter().find(|a| a.kind == EffectKind::Poisoned).map(|a| a.left);
        // A 50 % poison share is the higher tier: Poisoned (4 s) at power max(10, STR 8) = 10.
        assert_eq!(poison, Some(scaled_secs(4.0, 10, con)));
    }

    #[test]
    fn an_items_light_follows_the_hero() {
        use crate::run::light::Anchor;
        let run = armed(ClassId::Paladin, EquipSlot::Melee, ItemId::GoldenSword);
        let id = run.players[0].id;
        let l = run.lights.sources.iter().find(|s| s.anchor == Anchor::Entity(id)).expect("the sword's light");
        assert_eq!(l.kind, LightKind::Holy);
        let run = test_run(&[ClassId::Paladin], BossId::Lich);
        let id = run.players[0].id;
        assert!(!run.lights.sources.iter().any(|s| s.anchor == Anchor::Entity(id)), "a starter hero carries no light");
    }

    #[test]
    fn heavy_armor_is_pushed_less_and_resists() {
        use crate::defs::attributes::push_dist;
        assert_eq!(push_dist(20.0, 16, 19.0), 0.0);
        assert_eq!(push_dist(20.0, 16, 12.0), 20.0);
        let hit = |run: &mut Run| {
            run.monsters.retain(|m| m.is_boss);
            let at = run.players[0].pos();
            let id = run.spawn_enemy(EnemyType::OrcWarrior, at - Vec2::new(16.0, 0.0), None);
            let oi = run.monster_idx(id).unwrap();
            let attack = crate::defs::enemies::def(EnemyType::OrcWarrior).attack;
            let hp = run.players[0].hp;
            crate::run::ai::perform_attack(run, oi, Creature::Player(0), attack, false, None);
            (hp - run.players[0].hp, run.players[0].mv.knock_vx)
        };
        let mut run = armed(ClassId::Paladin, EquipSlot::Armor, ItemId::PlateArmor);
        let (lost, knock) = hit(&mut run);
        assert!((lost - 14.0 * 0.75).abs() < 1e-9, "plate blocks a quarter: {lost}");
        assert_eq!(knock, 0.0, "and is not pushed");
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        let (lost, knock) = hit(&mut run);
        assert_eq!(lost, 14.0);
        assert_eq!(knock, crate::collision::knock_speed(20.0, super::super::DT));
    }

}
