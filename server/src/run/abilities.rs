//! Player abilities (one executor per AbilityId) and projectile simulation.

use super::entities::{HazardPulse, HazardSide, Pierce, Projectile};
use super::{targets, Run, TICK_HZ};
use crate::collision::line_of_sight;
use crate::defs::abilities::{self as ab, AbilityId, Shape, Uses};
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::damage::{kind_split, overkill_rest, Damage, Mult, What};
use crate::defs::damage::DamageType;
#[cfg(test)]
use crate::defs::damage::DamageSplit;
use crate::defs::effects::{EffectKind, EffectLook, OnHit};
use crate::defs::kinds::{Anim, EntityKind};
use crate::defs::lights::{self, LightKind};
use super::effects::{Apply, Creature};
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
#[cfg(test)]
pub fn melee_target(run: &Run, pi: usize) -> Option<MeleeTarget> {
    melee_targets(run, pi).first().copied()
}

/// The melee-rule strike: `strike` hits the nearest of `targets`; a kill carries the rest of its damage on to the next.
fn melee_strike(run: &mut Run, pi: usize, targets: &[MeleeTarget], strike: &ResolvedAbility, crit: bool) {
    let pos = run.players[pi].pos();
    let aim = run.players[pi].aim;
    let mut dmg = weapon_damage(run, pi, strike);
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
                    Some(rest) if !run.monsters[mi].alive => {
                        dmg.amount = rest;
                        dmg = dmg.with_mult(Mult::Overkill { from: run.monsters[mi].id });
                    }
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

/// The projectile of a shooting ability.
fn kind_of(projectile: Option<EntityKind>) -> EntityKind {
    projectile.expect("a shot has a projectile")
}

/// The damage of one hit of `a`: its split, on-hit and power.
fn damage_of(hero: u32, a: &ResolvedAbility) -> Damage {
    Damage { on_hit: a.on_hit, ..Damage::new(a.damage, a.split).with_power(a.power) }.by(hero, What::Ability(a.id)).with_base(a.base)
}

/// The damage of one hit of the weapon attack `a` (or of an ability that uses none: `damage_of`).
/// While the hero is coated (Poison Coat) every weapon attack adds a poison share and applies
/// Poisoned instead of its weapon's own on-hit.
fn weapon_damage(run: &Run, pi: usize, a: &ResolvedAbility) -> Damage {
    let dmg = damage_of(run.players[pi].id, a);
    if ab::def(a.id).uses == Uses::Nothing || !run.players[pi].effects.has(EffectKind::Coated) {
        return dmg;
    }
    let on_hit = OnHit { kind: EffectKind::Poisoned, secs: ab::COAT_POISON_SECS, magical: false, power: a.power, look: EffectLook::Plain };
    Damage { split: a.split.with_shares(&[(DamageType::Poison, ab::COAT_SHARE)]), on_hit: Some(on_hit), ..dmg }.with_mult(Mult::Coat(ab::COAT_SHARE))
}

/// Uses the hero's primary or secondary ability, with its numbers from the hero's sheet.
pub fn try_use(run: &mut Run, pi: usize, primary: bool, shot: u16) {
    let cd = if primary { run.players[pi].cd1 } else { run.players[pi].cd2 };
    if cd > COOLDOWN_LEEWAY || !run.players[pi].alive {
        return;
    }
    let def = if primary { run.players[pi].sheet.primary } else { run.players[pi].sheet.secondary };
    let id = def.id;
    let crit = false;
    let cooldown = def.cooldown;
    if def.ranged {
        let targets = melee_targets(run, pi);
        if !targets.is_empty() {
            super::rules_log::too_close(run, pi, primary, targets[0]);
            if !primary {
                return;
            }
            let fallback = run.players[pi].sheet.fallback;
            melee_strike(run, pi, &targets, &fallback, crit);
            let p = &mut run.players[pi];
            p.cd1 = super::keystones::cooldown(p, fallback.cooldown);
            p.anim = Anim::Melee;
            p.anim_start = run.time;
            return;
        }
    }
    let anim = match ab::def(id).shape {
        Shape::Projectile => use_projectile(run, pi, &def, shot),
        Shape::Blast => use_blast(run, pi, &def, shot),
        Shape::Swing => use_swing(run, pi, &def, shot),
        Shape::Ring => use_ring(run, pi, &def, shot),
        Shape::Dash => use_dash(run, pi, &def, shot),
        Shape::SelfArea => use_self_area(run, pi, &def, shot),
        Shape::GroundArea => use_ground_area(run, pi, &def, shot),
        Shape::Buff => use_buff(run, pi, &def, shot),
        Shape::Summon => use_summon(run, pi, &def, shot),
    };
    let p = &mut run.players[pi];
    let cooldown = super::keystones::cooldown(p, cooldown);
    if primary {
        p.cd1 = cooldown;
    } else {
        p.cd2 = cooldown;
    }
    p.anim = anim;
    p.anim_start = run.time;
}

// One function per ability shape: it does the ability's effect and returns the hero's animation.
// An id-specific rule is a `match a.id` listing every id of the shape; the ids of other shapes
// share one arm that names them, so a new id cannot be forgotten.

/// A shot: a spell's or innate ability's own projectile (Magic Missile, Frost Shard, Chain Spark,
/// Judgement), or the ranged weapon's (Shoot, Hurl; Volley fires three in a fan).
fn use_projectile(run: &mut Run, pi: usize, a: &ResolvedAbility, shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::Projectile);
    let aim = run.players[pi].aim;
    let crit = false;
    let pierce = Pierce::new(a.pierce, a.pierce_through);
    let life = a.range / a.speed;
    let w = weapon_damage(run, pi, a);
    match a.id {
        AbilityId::MagicMissile => {
            spawn_player_projectile(run, pi, EntityKind::Missile, shot, Vec2::from_angle(aim), a.speed, w, a.radius, life, 0.0, None, crit, pierce);
        }
        AbilityId::FrostShard | AbilityId::Judgement | AbilityId::Shoot | AbilityId::Hurl => {
            spawn_player_projectile(run, pi, kind_of(a.projectile), shot, Vec2::from_angle(aim), a.speed, w, a.radius, life, 0.0, None, crit, pierce);
        }
        // It stops at the first enemy; the jumps are made there (`chain_jumps`).
        AbilityId::ChainSpark => {
            spawn_player_projectile(run, pi, kind_of(a.projectile), shot, Vec2::from_angle(aim), a.speed, w, a.radius, life, 0.0, None, crit, Pierce::Never);
        }
        AbilityId::Volley => {
            let step = ab::VOLLEY_SPREAD / (ab::VOLLEY_ARROWS - 1) as f64;
            for i in 0..ab::VOLLEY_ARROWS {
                let angle = aim + (i as f64 - (ab::VOLLEY_ARROWS - 1) as f64 / 2.0) * step;
                spawn_player_projectile(run, pi, kind_of(a.projectile), ab::volley_shot(shot, i), Vec2::from_angle(angle), a.speed, w, a.radius, life, 0.0, None, crit, pierce);
            }
        }
        AbilityId::Fireball | AbilityId::Strike | AbilityId::HolyLight | AbilityId::Charge | AbilityId::SummonWolf | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::PoisonCoat | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Haste | AbilityId::Purify | AbilityId::Consecrate | AbilityId::Entangle => {
            unreachable!("{:?} is not a projectile", a.id)
        }
    }
    Anim::Shoot
}

/// A shot that bursts where it lands: Fireball, at the aimed distance.
fn use_blast(run: &mut Run, pi: usize, a: &ResolvedAbility, shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::Blast);
    let (pos, aim, aim_dist) = {
        let p = &run.players[pi];
        (p.pos(), p.aim, p.aim_dist)
    };
    let dir = Vec2::from_angle(aim);
    let crit = false;
    match a.id {
        AbilityId::Fireball => {
            let target = pos + dir * aim_dist.clamp(24.0, a.range);
            let life = a.range / a.speed + 0.1;
            let dmg = damage_of(run.players[pi].id, a);
            spawn_player_projectile(run, pi, EntityKind::Fireball, shot, dir, a.speed, dmg, 4.0, life, a.radius, Some(target), crit, Pierce::Never);
        }
        AbilityId::MagicMissile | AbilityId::Strike | AbilityId::HolyLight | AbilityId::Charge | AbilityId::Shoot | AbilityId::SummonWolf | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::PoisonCoat | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Haste | AbilityId::Purify | AbilityId::Consecrate | AbilityId::Entangle => {
            unreachable!("{:?} is not a blast", a.id)
        }
    }
    Anim::Cast
}

/// A swing of the melee weapon: Strike, Smite (a holy flash where it first hits), Whirl (all around)
/// and Flanking Thrust (double from behind).
fn use_swing(run: &mut Run, pi: usize, a: &ResolvedAbility, _shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::Swing);
    match a.id {
        AbilityId::Strike | AbilityId::Whirl | AbilityId::FlankingThrust => {
            melee_arc(run, pi, a, false);
        }
        AbilityId::Smite => {
            if let Some(at) = melee_arc(run, pi, a, false) {
                run.add_flash(LightKind::Holy, at, ab::SMITE_FLASH);
            }
        }
        AbilityId::MagicMissile | AbilityId::Fireball | AbilityId::HolyLight | AbilityId::Charge | AbilityId::Shoot | AbilityId::SummonWolf | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::PoisonCoat | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Haste | AbilityId::Purify | AbilityId::Consecrate | AbilityId::Entangle => {
            unreachable!("{:?} is not a swing", a.id)
        }
    }
    Anim::Melee
}

/// An instant effect on the enemies around the user: Frost Nova hurts them (and freezes), War Cry
/// frightens them and hastens the party, Ground Slam starts its wind-up (`land_slam`).
fn use_ring(run: &mut Run, pi: usize, a: &ResolvedAbility, _shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::Ring);
    let pos = run.players[pi].pos();
    match a.id {
        AbilityId::FrostNova => {
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: a.radius as f32, k: 10 }, Some(pos));
            run.add_tinted_flash(LightKind::Magic, Some(ab::NOVA_TINT), pos, ab::NOVA_FLASH);
            let rule = targets::Rule { at: pos, reach: a.radius, plus_radius: false, arc: None, los: true, skip_hiding: false, skip_dormant: false, skip_airborne: false };
            let log = super::rules_log::on(run);
            let (hit, skips) = targets::select(run, &rule, &[], log, |mi| run.monsters[mi].pos);
            let by = run.players[pi].id;
            super::rules_log::skipped(run, by, What::Ability(a.id), &skips, None);
            for mi in hit {
                run.hurt_monster(mi, damage_of(run.players[pi].id, a), false, Some(pi));
            }
        }
        AbilityId::WarCry => {
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: a.radius as f32, k: 11 }, Some(pos));
            let own = a.effect.expect("War Cry has its own effect");
            let source = Some((run.players[pi].id, pos));
            let origin = Some((run.players[pi].id, What::Ability(a.id)));
            let rule = targets::Rule { at: pos, reach: a.radius, plus_radius: false, arc: None, los: false, skip_hiding: true, skip_dormant: true, skip_airborne: false };
            let log = super::rules_log::on(run);
            let (afraid, skips) = targets::select(run, &rule, &[], log, |mi| run.monsters[mi].pos);
            super::rules_log::skipped(run, run.players[pi].id, What::Ability(a.id), &skips, None);
            for mi in afraid {
                run.apply(Creature::Monster(mi), Apply { source, origin, ..Apply::from_hit(own) });
            }
            for c in party_around(run, pos, a.radius) {
                run.apply(c, Apply { origin, ..Apply::plain(EffectKind::Accelerated, Some(a.duration)) });
            }
        }
        AbilityId::GroundSlam => {
            run.players[pi].slam = Some(ab::SLAM_WINDUP);
        }
        AbilityId::MagicMissile | AbilityId::Fireball | AbilityId::Strike | AbilityId::HolyLight | AbilityId::Charge | AbilityId::Shoot | AbilityId::SummonWolf | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::PoisonCoat | AbilityId::Haste | AbilityId::Purify | AbilityId::Consecrate | AbilityId::Entangle => {
            unreachable!("{:?} is not a ring", a.id)
        }
    }
    Anim::Cast
}

/// Every living hero and ally (the wolf) within `radius` of `pos`, the user included.
fn party_around(run: &Run, pos: Vec2, radius: f64) -> Vec<Creature> {
    let heroes = run.players.iter().enumerate().filter(|(_, q)| q.alive && q.pos().dist(pos) <= radius).map(|(qi, _)| Creature::Player(qi));
    let allies = run.monsters.iter().enumerate().filter(|(_, m)| m.is_ally() && m.alive && m.pos.dist(pos) <= radius).map(|(mi, _)| Creature::Monster(mi));
    heroes.chain(allies).collect()
}

/// Counts down a hero's Ground Slam wind-up; it lands at the hero's position then. A hero who
/// died (`step_player` clears it), sinks or is pushed loses it.
pub fn tick_slam(run: &mut Run, pi: usize) {
    let p = &mut run.players[pi];
    let Some(left) = p.slam else { return };
    if p.sinking.is_some() || p.mv.knocked() || p.mv.dash_t > 0.0 {
        p.slam = None;
        return;
    }
    let left = left - super::DT;
    if left > 1e-9 {
        p.slam = Some(left);
    } else {
        land_slam(run, pi);
    }
}

/// Ground Slam lands: the weapon's damage on every enemy within its radius, pushed away from the hero.
pub fn land_slam(run: &mut Run, pi: usize) {
    run.players[pi].slam = None;
    let a = run.players[pi].sheet.secondary;
    debug_assert!(a.id == AbilityId::GroundSlam);
    let (pos, aim) = (run.players[pi].pos(), run.players[pi].aim);
    run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: a.radius as f32, k: 5 }, Some(pos));
    let dmg = weapon_damage(run, pi, &a);
    let push = a.push.max(ab::SLAM_PUSH);
    let rule = targets::Rule { at: pos, reach: a.radius, plus_radius: false, arc: None, los: true, skip_hiding: false, skip_dormant: false, skip_airborne: true };
    let log = super::rules_log::on(run);
    let (hit, skips) = targets::select(run, &rule, &[], log, |mi| run.monsters[mi].pos);
    super::rules_log::skipped(run, run.players[pi].id, What::Ability(a.id), &skips, None);
    for mi in hit {
        run.hurt_monster(mi, dmg, false, Some(pi));
        run.knock_creature(Creature::Monster(mi), pos, aim, push, a.push_str);
    }
}

/// A dash that hurts what it touches (`dash_contact`): Charge.
fn use_dash(run: &mut Run, pi: usize, a: &ResolvedAbility, _shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::Dash);
    let dir = Vec2::from_angle(run.players[pi].aim);
    match a.id {
        AbilityId::Charge => {
            let p = &mut run.players[pi];
            p.mv.dash_t = a.duration;
            p.mv.dash_dx = dir.x;
            p.mv.dash_dy = dir.y;
            p.dash_hit.clear();
        }
        AbilityId::MagicMissile | AbilityId::Fireball | AbilityId::Strike | AbilityId::HolyLight | AbilityId::Shoot | AbilityId::SummonWolf | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::PoisonCoat | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Haste | AbilityId::Purify | AbilityId::Consecrate | AbilityId::Entangle => {
            unreachable!("{:?} is not a dash", a.id)
        }
    }
    Anim::Dash
}

/// An effect or a heal on the user and the allies around: Holy Light, Haste, Purify.
fn use_self_area(run: &mut Run, pi: usize, a: &ResolvedAbility, _shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::SelfArea);
    let pos = run.players[pi].pos();
    match a.id {
        AbilityId::HolyLight => {
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: a.radius as f32, k: 1 }, Some(pos));
            run.add_flash(LightKind::Holy, pos, lights::HOLY_FLASH);
            let mut total = 0.0;
            let by = Some((run.players[pi].id, What::Ability(a.id)));
            for qi in 0..run.players.len() {
                let q = &run.players[qi];
                if q.alive && q.pos().dist(pos) <= a.radius {
                    total += run.heal_player(qi, a.damage, by);
                }
            }
            for mi in 0..run.monsters.len() {
                let m = &run.monsters[mi];
                if m.is_ally() && m.alive && m.pos.dist(pos) <= a.radius {
                    total += run.heal_monster(mi, a.damage, by);
                }
            }
            run.players[pi].healing += total;
        }
        AbilityId::Haste => {
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: a.radius as f32, k: 12 }, Some(pos));
            let own = a.effect.expect("Haste has its own effect");
            for c in party_around(run, pos, a.radius) {
                run.apply(c, Apply { origin: Some((run.players[pi].id, What::Ability(a.id))), ..Apply::plain(own.kind, Some(own.secs)) });
            }
        }
        AbilityId::Purify => {
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: a.radius as f32, k: 13 }, Some(pos));
            run.add_flash(LightKind::Holy, pos, ab::PURIFY_FLASH);
            let own = a.effect.expect("Purify has its own effect");
            for c in party_around(run, pos, a.radius) {
                let held = match c {
                    Creature::Player(i) => run.players[i].effects.kinds(),
                    Creature::Monster(i) => run.monsters[i].effects.kinds(),
                };
                for k in held.into_iter().filter(|&k| !crate::defs::effects::def(k).positive) {
                    run.remove_effect_why(c, k, super::rules_log::EndReason::Purify);
                }
                run.apply(c, Apply { origin: Some((run.players[pi].id, What::Ability(a.id))), ..Apply::plain(own.kind, Some(own.secs)) });
            }
        }
        AbilityId::MagicMissile | AbilityId::Fireball | AbilityId::Strike | AbilityId::Charge | AbilityId::Shoot | AbilityId::SummonWolf | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::PoisonCoat | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Consecrate | AbilityId::Entangle => {
            unreachable!("{:?} is not a self area", a.id)
        }
    }
    Anim::Cast
}

/// A hazard of the hero's side, placed at the user's feet (Consecrate hurts) or at an aimed spot
/// (Entangle binds).
fn use_ground_area(run: &mut Run, pi: usize, a: &ResolvedAbility, _shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::GroundArea);
    let (id, pos, aim, aim_dist) = {
        let p = &run.players[pi];
        (p.id, p.pos(), p.aim, p.aim_dist)
    };
    let side = HazardSide::Heroes { owner: id };
    match a.id {
        AbilityId::Consecrate => {
            run.spawn_hazard(kind_of(a.projectile), pos, a.radius, a.duration, side, HazardPulse::Hurt(damage_of(id, a)));
        }
        AbilityId::Entangle => {
            // Aimed like the Fireball, but it stops short of the first wall on the way.
            let dir = Vec2::from_angle(aim);
            let want = aim_dist.clamp(24.0, a.range);
            let mut d = 0.0;
            while d + 2.0 <= want && !run.layout.map.opaque_at(pos + dir * (d + 2.0)) {
                d += 2.0;
            }
            let at = pos + dir * if d + 2.0 > want && !run.layout.map.opaque_at(pos + dir * want) { want } else { d };
            let own = a.effect.expect("Entangle has its own effect");
            let bind = OnHit { secs: ab::ENTANGLE_PULSE_SECS, ..own };
            run.spawn_hazard(kind_of(a.projectile), at, a.radius, a.duration, side, HazardPulse::Bind(bind));
        }
        AbilityId::MagicMissile | AbilityId::Fireball | AbilityId::Strike | AbilityId::HolyLight | AbilityId::Charge | AbilityId::Shoot | AbilityId::SummonWolf | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::PoisonCoat | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Haste | AbilityId::Purify => {
            unreachable!("{:?} is not a ground area", a.id)
        }
    }
    Anim::Cast
}

/// An effect on the user only: Poison Coat.
fn use_buff(run: &mut Run, pi: usize, a: &ResolvedAbility, _shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::Buff);
    match a.id {
        AbilityId::PoisonCoat => {
            let own = a.effect.expect("Poison Coat has its own effect");
            run.apply(Creature::Player(pi), Apply::from_hit(own));
        }
        AbilityId::MagicMissile | AbilityId::Fireball | AbilityId::Strike | AbilityId::HolyLight | AbilityId::Charge | AbilityId::Shoot | AbilityId::SummonWolf | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Haste | AbilityId::Purify | AbilityId::Consecrate | AbilityId::Entangle => {
            unreachable!("{:?} is not a buff", a.id)
        }
    }
    Anim::Cast
}

/// Summons or heals the companion: Summon Wolf.
fn use_summon(run: &mut Run, pi: usize, a: &ResolvedAbility, _shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::Summon);
    match a.id {
        AbilityId::SummonWolf => super::companion::use_ability(run, pi),
        AbilityId::MagicMissile | AbilityId::Fireball | AbilityId::Strike | AbilityId::HolyLight | AbilityId::Charge | AbilityId::Shoot | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::PoisonCoat | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Haste | AbilityId::Purify | AbilityId::Consecrate | AbilityId::Entangle => {
            unreachable!("{:?} is not a summon", a.id)
        }
    }
    Anim::Cast
}

/// A swing of the melee ability `a` (its reach, arc, damage, split, on-hit and power). A hit from
/// behind its target (`a.behind`) does `BEHIND_MULT` times the damage and counts as a crit.
/// Returns where it first hit a monster.
fn melee_arc(run: &mut Run, pi: usize, a: &ResolvedAbility, crit: bool) -> Option<Vec2> {
    let rw = rewind_ticks(run, pi);
    let (pos, aim) = (run.players[pi].pos(), run.players[pi].aim);
    let (range, arc, dmg) = (a.range, a.arc, weapon_damage(run, pi, a));
    // Flying monsters are out of reach of melee; a monster touching the hero is hit whatever the arc.
    let rule = targets::Rule { at: pos, reach: range, plus_radius: true, arc: Some((aim, arc)), los: true, skip_hiding: false, skip_dormant: false, skip_airborne: true };
    let log = super::rules_log::on(run);
    let (hits, skips) = targets::select(run, &rule, &[], log, |mi| run.monsters[mi].pos_ago(rw));
    super::rules_log::skipped(run, run.players[pi].id, What::Ability(a.id), &skips, None);
    let first = hits.first().map(|&mi| run.monsters[mi].pos);
    for mi in hits {
        let m = &run.monsters[mi];
        let behind = a.behind > 0.0 && angle_diff(m.pos_ago(rw).angle_to(pos), m.aim + std::f64::consts::PI).abs() <= a.behind;
        if behind {
            run.hurt_monster(mi, Damage { amount: dmg.amount * ab::BEHIND_MULT, ..dmg }.with_mult(Mult::Behind(ab::BEHIND_MULT)), true, Some(pi));
        } else {
            run.hurt_monster(mi, dmg, crit, Some(pi));
        }
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
    first
}

/// Barbarian Charge: damage each monster touched once per dash, with the secondary's damage, split, on-hit and power.
pub fn dash_contact(run: &mut Run, pi: usize) {
    let rw = rewind_ticks(run, pi);
    let pos = run.players[pi].pos();
    let (aim, ab) = (run.players[pi].aim, run.players[pi].sheet.secondary);
    let dmg = weapon_damage(run, pi, &ab);
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
    damage: Damage,
    radius: f64,
    life: f64,
    explode_r: f64,
    target: Option<Vec2>,
    crit: bool,
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
        damage,
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
        damage: Damage::new(damage, kind_split(kind)).with_power(shot_power(run, owner, kind)).by(owner, What::Shot(kind)),
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
    let (from_player, owner, damage, crit, explode_r, k, knock, pierce, kind) = (pr.from_player, pr.owner, pr.damage, pr.crit, pr.explode_r, pr.explode_k, pr.knock, pr.pierce, pr.kind);
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
            if let (EntityKind::ChainSpark, Some(pi)) = (kind, src) {
                chain_jumps(run, pi, mi, damage);
            }
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
        Pierce::Through { left, then } if left > 0 => Some(match left {
            u8::MAX => pr.pierce,
            1 => Pierce::from_u8(then),
            _ => Pierce::Through { left: left - 1, then },
        }),
        Pierce::Overkill { left } => match rest {
            Some(rest) if !alive => {
                pr.damage.amount = rest;
                pr.damage = pr.damage.with_mult(Mult::Overkill { from: id });
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

/// Chain Spark: from the first target `first`, up to `CHAIN_JUMPS` jumps, each to the nearest living
/// enemy within `CHAIN_REACH` of the last target that the spark has not hit and sees (no wall between,
/// no ally, no object, no hiding mimic or dormant monster), for `CHAIN_FALLOFF` times the damage of the
/// jump before. Every jump draws a `Zap`.
fn chain_jumps(run: &mut Run, pi: usize, first: usize, damage: Damage) {
    let mut hit = vec![first];
    let mut last = first;
    let mut amount = damage.amount;
    let log = super::rules_log::on(run);
    let (mut skips, mut stop) = (Vec::new(), None);
    for jump in 1..=ab::CHAIN_JUMPS {
        let from = run.monsters[last].pos;
        let rule = targets::Rule { at: from, reach: ab::CHAIN_REACH, plus_radius: false, arc: None, los: true, skip_hiding: true, skip_dormant: true, skip_airborne: false };
        let (near, more) = targets::select(run, &rule, &hit, log, |mi| run.monsters[mi].pos);
        // The target the spark stands on is not a candidate to log.
        targets::merge(&mut skips, more.into_iter().filter(|&(mi, _)| mi != last).collect());
        let next = near.into_iter().min_by(|&a, &b| run.monsters[a].pos.dist(from).total_cmp(&run.monsters[b].pos.dist(from)));
        let Some(mi) = next else {
            if log {
                stop = targets::nearest_beyond(run, &rule, &hit);
            }
            break;
        };
        amount *= ab::CHAIN_FALLOFF;
        let jump = jump as u8;
        let to = run.monsters[mi].pos;
        run.event(Ev::Zap { x: from.x as f32, y: from.y as f32, x2: to.x as f32, y2: to.y as f32 }, None);
        run.hurt_monster(mi, Damage { amount, ..damage }.with_mult(Mult::Chain { jump, factor: ab::CHAIN_FALLOFF.powi(jump as i32) }), false, Some(pi));
        hit.push(mi);
        last = mi;
    }
    skips.retain(|(mi, _)| !hit.contains(mi)); // hit on a later jump: no "did not jump" line
    super::rules_log::skipped(run, run.players[pi].id, What::Ability(AbilityId::ChainSpark), &skips, stop);
}

/// What is left of `damage` if it kills creature `c` (`overkill_rest`), with the HP, resistances
/// its hurt function uses.
fn overkill_left(run: &Run, c: Creature, damage: &Damage) -> Option<f64> {
    let (hp, res) = match c {
        Creature::Player(pi) => {
            let p = &run.players[pi];
            (p.hp, p.effects.res(p.res))
        }
        Creature::Monster(mi) => {
            let m = &run.monsters[mi];
            (m.hp, m.effects.res(m.res))
        }
    };
    overkill_rest(damage.amount, &damage.split, hp, &res)
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
        assert!(run.projectiles.iter().all(|p| p.dead), "the shot is spent");
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
        assert!(run.projectiles.iter().all(|p| p.dead), "the shot is spent");
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
        run.players[0].sheet.primary.projectile = Some(EntityKind::Arrow);
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
        let hit = OnHit { kind: EffectKind::Slowed, secs: 2.0, magical: false, power: 10, look: crate::defs::effects::EffectLook::Plain };
        run.players[0].sheet.secondary.on_hit = Some(hit);
        let mi = put_monster_near(&mut run, 0, 6.0);
        run.monsters[mi].hp = 1000.0;
        dash_contact(&mut run, 0);
        assert!(run.monsters[mi].effects.list().iter().any(|a| a.kind == EffectKind::Slowed));
    }

    #[test]
    fn bowling_charge_pushes_with_more_str() {
        use crate::defs::trees::NodeId;
        let barb = ClassId::Barbarian;
        // STR 16 against a weight of 17 pushes nothing; Bowling Charge (BL4) carries +4 STR: 20 pushes 3/4.
        let knock_of = |nodes: Vec<NodeId>| {
            // The Great Axe does not push, so the dash wields the Cleaver (push 20).
            let equipment = crate::defs::items::Equipment::starter(barb).with(EquipSlot::Melee, crate::defs::items::ItemId::Cleaver);
            let build = Build { nodes, equipment, extra: Attributes::new(1, 0, 0, 0, 0, 0), ..Build::start(barb) };
            let mut run = super::super::tests::test_run_with(&[(barb, build)], BossId::Demon);
            assert_eq!(run.players[0].sheet.attrs.get(Attr::Str), 16);
            let mi = put_monster_near(&mut run, 0, 6.0);
            run.monsters[mi].hp = 1000.0;
            run.monsters[mi].weight = 17.0;
            dash_contact(&mut run, 0);
            run.monsters[mi].knock.len()
        };
        assert_eq!(knock_of(vec![]), 0.0, "STR 16 against weight 17");
        assert!(knock_of(vec![NodeId::BL1, NodeId::BL2, NodeId::BL4]) > 0.0, "STR 20 against weight 17");
    }

    #[test]
    fn charge_pushes_away_from_the_hero_once_per_dash() {
        use crate::defs::attributes::push_dist;
        let barb = ClassId::Barbarian;
        let equipment = crate::defs::items::Equipment::starter(barb).with(EquipSlot::Melee, crate::defs::items::ItemId::Cleaver);
        let build = Build { equipment, ..Build::start(barb) };
        let mut run = super::super::tests::test_run_with(&[(barb, build)], BossId::Demon);
        let ab = run.players[0].sheet.secondary;
        assert_eq!(ab.id, AbilityId::Charge);
        assert!(ab.push > 0.0, "the Cleaver pushes");
        let mi = put_monster_near(&mut run, 0, 6.0);
        run.monsters[mi].hp = 1000.0;
        run.monsters[mi].weight = 10.0;
        dash_contact(&mut run, 0);
        let k = run.monsters[mi].knock;
        let want = crate::collision::knock_speed(push_dist(ab.push, ab.push_str, 10.0), crate::run::DT);
        assert!(k.x > 0.0 && k.y.abs() < 1e-9, "east, away from the hero: {k:?}");
        assert!((k.len() - want).abs() < 1e-9, "{} vs {want}", k.len());
        run.monsters[mi].knock = Vec2::ZERO;
        dash_contact(&mut run, 0);
        assert_eq!(run.monsters[mi].knock, Vec2::ZERO, "touched again in the same dash: no second push");
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
        spawn_player_projectile(run, 0, EntityKind::Missile, 1, Vec2::new(1.0, 0.0), 230.0, Damage::new(5.0, kind_split(EntityKind::Missile)), 3.0, 1.0, 0.0, None, false, Pierce::Never);
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
        run.players[0].sheet.primary.on_hit = Some(OnHit { kind: EffectKind::Slowed, secs: 2.0, magical: false, power: 10, look: crate::defs::effects::EffectLook::Plain });
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
    fn an_unlimited_through_mod_passes_every_enemy() {
        use crate::defs::loadout::{apply_mods, AbilityMod};
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        run.players[0].sheet.primary = apply_mods(run.players[0].sheet.primary, &[AbilityMod::PierceThrough(200), AbilityMod::PierceThrough(200)]);
        assert_eq!(run.players[0].sheet.primary.pierce_through, u8::MAX);
        let dmg = run.players[0].sheet.primary.damage;
        let mut one = test_run(&[ClassId::Wizard], BossId::Demon);
        one.players[0].sheet.primary = run.players[0].sheet.primary;
        one.monsters.retain(|m| m.is_boss || m.owner.is_some());
        one.players[0].aim = 0.0;
        let mi = put_enemy(&mut one, 0, EnemyType::OrcWarrior, 30.0, 70.0);
        try_use(&mut one, 0, true, 1);
        while one.monsters[mi].hp == 70.0 {
            tick_projectiles(&mut one, 1.0 / TICK_HZ);
        }
        use super::super::entities::Pierce;
        assert_eq!(one.projectiles[0].pierce, Pierce::Through { left: u8::MAX, then: 0 }, "the count does not go down");
        let r = shoot_line(run, EnemyType::OrcWarrior, &[30.0, 40.0, 50.0, 60.0], &[70.0, 70.0, 70.0, 70.0]);
        assert_eq!(r, [(true, dmg); 4]);
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
    fn an_overkill_shot_stops_at_a_chest() {
        use crate::run::objects::ObjState;
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        run.players[0].aim = 0.0;
        let first = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 30.0, 5.0);
        let chest = run.spawn_object(EntityKind::Chest, run.players[0].pos() + Vec2::new(45.0, 0.0), ObjState::Chest { opened: None });
        let behind = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 60.0, 24.0);
        try_use(&mut run, 0, true, 1);
        for _ in 0..30 {
            tick_projectiles(&mut run, 1.0 / TICK_HZ);
        }
        assert!(!run.monsters[first].alive, "the kill lets the rest fly on");
        assert!(run.objects.iter().find(|o| o.id == chest).unwrap().gone, "the rest smashes the chest");
        assert_eq!(run.monsters[behind].hp, 24.0, "and stops there");
        assert!(run.projectiles.iter().all(|p| p.dead), "the shot is spent");
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
        spawn_player_projectile(&mut run, 0, EntityKind::Fireball, 1, Vec2::new(1.0, 0.0), 300.0, Damage::new(1.0, kind_split(EntityKind::Fireball)), 4.0, 2.0, 20.0, Some(target), false, Pierce::Never);
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

    #[test]
    fn every_shape_still_plays_today() {
        use crate::defs::abilities::{self as ab, Shape};
        // (class, primary?, id, shape, anim, cooldown, spawned projectile kind)
        let rows = [
            (ClassId::Wizard, true, AbilityId::MagicMissile, Shape::Projectile, Anim::Shoot, 0.35, Some(EntityKind::Missile)),
            (ClassId::Wizard, false, AbilityId::Fireball, Shape::Blast, Anim::Cast, 6.0, Some(EntityKind::Fireball)),
            (ClassId::Paladin, true, AbilityId::Strike, Shape::Swing, Anim::Melee, 0.0, None),
            (ClassId::Paladin, false, AbilityId::HolyLight, Shape::SelfArea, Anim::Cast, 10.0, None),
            (ClassId::Barbarian, false, AbilityId::Charge, Shape::Dash, Anim::Dash, 5.0, None),
            (ClassId::ElvenRanger, true, AbilityId::Shoot, Shape::Projectile, Anim::Shoot, 0.0, None),
            (ClassId::ElvenRanger, false, AbilityId::SummonWolf, Shape::Summon, Anim::Cast, 8.0, None),
        ];
        for (class, primary, id, shape, anim, cooldown, kind) in rows {
            let mut run = test_run(&[class], BossId::Demon);
            let sheet = run.players[0].sheet;
            let a = if primary { sheet.primary } else { sheet.secondary };
            assert_eq!(a.id, id);
            assert_eq!(ab::def(id).shape, shape, "{id:?}");
            let want = if cooldown > 0.0 { cooldown } else { a.cooldown };
            try_use(&mut run, 0, primary, 1);
            let p = &run.players[0];
            assert_eq!(if primary { p.cd1 } else { p.cd2 }, want, "{id:?} cooldown");
            assert_eq!(p.anim, anim, "{id:?} anim");
            if let Some(k) = kind {
                assert_eq!(run.projectiles.len(), 1, "{id:?}");
                assert_eq!(run.projectiles[0].kind, k, "{id:?}");
            }
            if id == AbilityId::Shoot {
                assert_eq!(run.projectiles.len(), 1, "{id:?} fires");
            }
            if id == AbilityId::Charge {
                assert!(run.players[0].mv.dash_t > 0.0);
            }
            if id == AbilityId::SummonWolf {
                assert!(run.players[0].wolf.is_some(), "the wolf is summoned");
            }
        }
    }

    #[test]
    fn every_hit_names_its_source() {
        use crate::defs::abilities::{self as ab};
        use crate::defs::damage::What;
        // Each starter's primary and secondary against a goblin: the hit that arrives names the hero and the ability.
        for class in ClassId::ALL {
            for primary in [true, false] {
                let mut run = test_run(&[class], BossId::Demon);
                run.monsters.retain(|m| m.is_boss || m.owner.is_some());
                let a = if primary { run.players[0].sheet.primary } else { run.players[0].sheet.secondary };
                let hero = run.players[0].id;
                let near = a.id == AbilityId::Strike || a.id == AbilityId::Charge;
                let mi = put_enemy(&mut run, 0, EnemyType::GoblinArcher, if near { 10.0 } else { 60.0 }, 1000.0);
                run.players[0].aim = 0.0;
                run.players[0].aim_dist = 60.0;
                run.last_hit = None;
                try_use(&mut run, 0, primary, 1);
                if a.id == AbilityId::Charge {
                    dash_contact(&mut run, 0);
                }
                fly(&mut run);
                match ab::def(a.id).uses {
                    _ if a.id == AbilityId::HolyLight || a.id == AbilityId::SummonWolf => {
                        assert!(run.last_hit.is_none(), "{:?} hits nobody", a.id);
                    }
                    _ => {
                        let hit = run.last_hit.unwrap_or_else(|| panic!("{:?} hit nothing", a.id));
                        assert_eq!(hit.why.by, Some(hero), "{:?}", a.id);
                        assert_eq!(hit.why.what, What::Ability(a.id), "{:?}", a.id);
                        assert_eq!(hit.why.base, Some(a.base), "{:?}", a.id);
                        assert!(run.monsters[mi].hp < 1000.0, "{:?} hurt the goblin", a.id);
                    }
                }
            }
        }
        // A monster's melee on the hero, and a goblin's arrow.
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let at = run.players[0].pos();
        let id = run.spawn_enemy(EnemyType::OrcWarrior, at - Vec2::new(16.0, 0.0), None);
        let oi = run.monster_idx(id).unwrap();
        let attack = crate::defs::enemies::def(EnemyType::OrcWarrior).attack;
        crate::run::ai::perform_attack(&mut run, oi, Creature::Player(0), attack, false, None);
        let hit = run.last_hit.expect("the orc hit the hero");
        assert_eq!((hit.why.by, hit.why.what), (Some(id), What::Attack));
        let gid = run.spawn_enemy(EnemyType::GoblinArcher, at + Vec2::new(40.0, 0.0), None);
        let gi = run.monster_idx(gid).unwrap();
        let attack = crate::defs::enemies::def(EnemyType::GoblinArcher).attack;
        run.last_hit = None;
        crate::run::ai::perform_attack(&mut run, gi, Creature::Player(0), attack, false, None);
        let kind = run.projectiles.last().unwrap().kind;
        for _ in 0..60 {
            tick_projectiles(&mut run, 1.0 / TICK_HZ);
        }
        let hit = run.last_hit.expect("the arrow hit the hero");
        assert_eq!((hit.why.by, hit.why.what), (Some(gid), What::Shot(kind)));
    }

    // ---- Plan 3b: the projectile abilities ----

    use crate::defs::abilities::{AbilitySlot, CHAIN_FALLOFF, CHAIN_REACH, VOLLEY_ARROWS};
    use crate::defs::attributes::Attributes;
    use crate::defs::damage::{resolve, DamageType};
    use crate::defs::effects::EffectKind;
    use crate::defs::items::Equipment;
    use crate::defs::loadout::{Build, Loadout, LoadoutError, Pick, Source};
    use crate::defs::attributes::Attr;

    /// A run whose one hero of `class` has `id` in `slot` (from its own pool), `extra` Attribute
    /// points and `equipment`, on a cleared, open floor.
    fn run_with_ability(class: ClassId, slot: AbilitySlot, id: AbilityId, extra: Attributes, equipment: Equipment) -> Run {
        let start = Loadout::start(class);
        let pick = Pick { ability: id, source: Source::Own };
        let loadout = match slot {
            AbilitySlot::Primary => Loadout { primary: pick, ..start },
            AbilitySlot::Secondary => Loadout { secondary: pick, ..start },
        };
        let build = Build { own: vec![id], loadout, extra, equipment, ..Build::start(class) };
        let mut run = super::super::tests::test_run_with(&[(class, build)], BossId::Demon);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        for y in ty - 3..=ty + 3 {
            for x in tx - 2..=tx + 14 {
                run.layout.map.set(x, y, crate::dungeon::Tile::Floor);
            }
        }
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        run.players[0].aim = 0.0;
        run
    }

    fn wizard_with(id: AbilityId, int: i32) -> Run {
        run_with_ability(ClassId::Wizard, AbilitySlot::Primary, id, Attributes::new(0, 0, 0, int, 0, 0), Equipment::starter(ClassId::Wizard))
    }

    /// Steps the projectiles alone (no monster acts) until none is left.
    fn fly(run: &mut Run) {
        for _ in 0..240 {
            tick_projectiles(run, 1.0 / 60.0);
            run.projectiles.retain(|p| !p.dead);
            if run.projectiles.is_empty() {
                break;
            }
        }
    }

    fn lost(run: &Run, mi: usize, before: f64) -> f64 {
        before - run.monsters[mi].hp
    }

    #[test]
    fn frost_shard_chills_and_never_freezes() {
        let mut run = wizard_with(AbilityId::FrostShard, 0);
        let mi = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 60.0, 1000.0);
        let a = run.players[0].sheet.primary;
        assert_eq!(a.id, AbilityId::FrostShard);
        assert_eq!(a.projectile, Some(EntityKind::FrostBolt));
        assert!((a.split.share(DamageType::Cold) - 0.4).abs() < 1e-12);
        assert!((a.split.share(DamageType::Magical) - 0.3).abs() < 1e-12);
        assert!((a.split.share(DamageType::Physical) - 0.3).abs() < 1e-12);
        try_use(&mut run, 0, true, 1);
        assert_eq!(run.projectiles.len(), 1);
        assert_eq!(run.projectiles[0].kind, EntityKind::FrostBolt);
        assert_eq!(run.players[0].cd1, 0.5);
        fly(&mut run);
        let res = run.monsters[mi].effects.res(run.monsters[mi].res);
        let expect = resolve(&Damage::new(a.damage, a.split), &res);
        assert!((lost(&run, mi, 1000.0) - expect).abs() < 1e-9, "{} vs {expect}", lost(&run, mi, 1000.0));
        assert!(run.has_effect(Creature::Monster(mi), EffectKind::Chilled));
        assert!(!run.has_effect(Creature::Monster(mi), EffectKind::Frozen));
    }

    /// Goblins at the given distances east of the hero, each with 1000 HP.
    fn goblins(run: &mut Run, dists: &[f64]) -> Vec<usize> {
        dists.iter().map(|&d| put_enemy(run, 0, EnemyType::GoblinArcher, d, 1000.0)).collect()
    }

    #[test]
    fn chain_spark_jumps_twice_with_falloff() {
        let mut run = wizard_with(AbilityId::ChainSpark, 3);
        let g = goblins(&mut run, &[60.0, 90.0, 120.0, 200.0]);
        let a = run.players[0].sheet.primary;
        assert_eq!(a.id, AbilityId::ChainSpark);
        try_use(&mut run, 0, true, 1);
        assert_eq!(run.projectiles[0].kind, EntityKind::ChainSpark);
        assert_eq!(run.players[0].cd1, 0.8);
        run.events.clear();
        fly(&mut run);
        for (n, &mi) in g[..3].iter().enumerate() {
            let res = run.monsters[mi].effects.res(run.monsters[mi].res);
            let expect = resolve(&Damage::new(a.damage * CHAIN_FALLOFF.powi(n as i32), a.split), &res);
            assert!((lost(&run, mi, 1000.0) - expect).abs() < 1e-9, "goblin {n}: {} vs {expect}", lost(&run, mi, 1000.0));
        }
        assert_eq!(run.monsters[g[3]].hp, 1000.0, "the fourth is out of reach");
        let zaps: Vec<_> = run.events.iter().filter(|(e, _)| matches!(e, Ev::Zap { .. })).collect();
        assert_eq!(zaps.len(), 2);
        assert!(zaps.iter().all(|(_, at)| at.is_none()), "sent to the whole party");
        assert!(run.projectiles.is_empty(), "the spark itself stopped at the first");
    }

    #[test]
    fn chain_spark_skips_allies_objects_and_walls() {
        let mut run = wizard_with(AbilityId::ChainSpark, 3);
        let first = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 60.0, 1000.0);
        // A wolf and a chest beside the first target.
        let wolf = crate::run::companion::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        let at = run.monsters[first].pos;
        run.monsters[wi].pos = at + Vec2::new(0.0, 20.0);
        let wolf_hp = run.monsters[wi].hp;
        let chest = run.spawn_object(EntityKind::Chest, at + Vec2::new(0.0, -20.0), crate::run::objects::ObjState::Chest { opened: None });
        // A goblin within reach, behind a wall tile.
        let (tx, ty) = crate::dungeon::Map::tile_of(at);
        for x in tx - 1..=tx + 1 {
            run.layout.map.set(x, ty + 1, crate::dungeon::Tile::Wall);
        }
        let behind = run.spawn_enemy(EnemyType::GoblinArcher, crate::dungeon::Map::center_of(tx, ty + 2), None);
        let bi = run.monster_idx(behind).unwrap();
        assert!(run.monsters[bi].pos.dist(at) <= CHAIN_REACH, "within reach");
        assert!(!line_of_sight(&run.layout.map, at, run.monsters[bi].pos), "but not in sight");
        let behind_hp = run.monsters[bi].hp;
        try_use(&mut run, 0, true, 1);
        run.events.clear();
        fly(&mut run);
        assert!(run.monsters[first].hp < 1000.0, "the first target is hit");
        assert_eq!(run.monsters[wi].hp, wolf_hp, "the wolf is safe");
        assert_eq!(run.monsters[bi].hp, behind_hp, "no jump through a wall");
        let o = run.objects.iter().find(|o| o.id == chest).unwrap();
        assert!(matches!(o.state, crate::run::objects::ObjState::Chest { opened: None }) && !o.gone, "the chest is untouched");
        assert!(!run.events.iter().any(|(e, _)| matches!(e, Ev::Zap { .. })), "no zap");
    }

    #[test]
    fn chain_spark_never_returns() {
        let mut run = wizard_with(AbilityId::ChainSpark, 3);
        let g = goblins(&mut run, &[60.0, 90.0]);
        let a = run.players[0].sheet.primary;
        try_use(&mut run, 0, true, 1);
        run.events.clear();
        fly(&mut run);
        let zaps = run.events.iter().filter(|(e, _)| matches!(e, Ev::Zap { .. })).count();
        assert_eq!(zaps, 1, "one jump, not back to the first");
        let res = run.monsters[g[0]].effects.res(run.monsters[g[0]].res);
        let expect = resolve(&Damage::new(a.damage, a.split), &res);
        assert!((lost(&run, g[0], 1000.0) - expect).abs() < 1e-9, "the first is hit once");
    }

    #[test]
    fn judgement_is_holy_and_magical() {
        use crate::defs::lights::LightKind;
        let mut run = run_with_ability(ClassId::Paladin, AbilitySlot::Primary, AbilityId::Judgement, Attributes::new(0, 0, 0, 0, 0, 6), Equipment::starter(ClassId::Paladin));
        let a = run.players[0].sheet.primary;
        assert_eq!(a.id, AbilityId::Judgement);
        assert_eq!(a.split, DamageSplit::pure(DamageType::Magical));
        put_enemy(&mut run, 0, EnemyType::GoblinArcher, 80.0, 1000.0);
        try_use(&mut run, 0, true, 1);
        assert_eq!(run.projectiles.len(), 1);
        assert_eq!(run.projectiles[0].kind, EntityKind::Judgement);
        assert_eq!(run.projectiles[0].damage.split, DamageSplit::pure(DamageType::Magical));
        assert!(run.moving_lights().iter().any(|l| l.kind == LightKind::Holy), "a Holy light is attached");
    }

    #[test]
    fn hurl_needs_a_throwing_axe() {
        use crate::defs::loadout::LoadoutError;
        use crate::defs::requirements::Requirement;
        use crate::defs::weapons::WeaponKind;
        let pick = Pick { ability: AbilityId::Hurl, source: Source::Own };
        let build = Build { own: vec![AbilityId::Hurl], loadout: Loadout { primary: pick, ..Loadout::start(ClassId::Barbarian) }, ..Build::start(ClassId::Barbarian) };
        let err = crate::sheet::hero_sheet(ClassId::Barbarian, &build).err();
        assert_eq!(err, Some(LoadoutError::Requirement(AbilityId::Hurl, Requirement::WeaponKind(&[WeaponKind::ThrowingAxe]))));

        let equipment = Equipment::starter(ClassId::Barbarian).with(EquipSlot::Ranged, ItemId::ThrowingAxes);
        let mut run = run_with_ability(ClassId::Barbarian, AbilitySlot::Primary, AbilityId::Hurl, Attributes::default(), equipment);
        assert_eq!(run.players[0].sheet.primary.id, AbilityId::Hurl);
        put_enemy(&mut run, 0, EnemyType::GoblinArcher, 80.0, 1000.0);
        try_use(&mut run, 0, true, 1);
        assert_eq!(run.projectiles.len(), 1);
        assert_eq!(run.projectiles[0].kind, EntityKind::ThrownAxe);
        assert_eq!(run.projectiles[0].pierce, Pierce::Overkill { left: u8::MAX });
    }

    fn ranger_volley() -> Run {
        run_with_ability(ClassId::ElvenRanger, AbilitySlot::Primary, AbilityId::Volley, Attributes::new(0, 5, 0, 0, 0, 0), Equipment::starter(ClassId::ElvenRanger))
    }

    #[test]
    fn volley_spawns_three_shots_with_consecutive_ids() {
        let mut run = ranger_volley();
        run.players[0].aim = 0.4;
        let bow = run.players[0].sheet.ranged.unwrap();
        try_use(&mut run, 0, true, 0xfffe);
        assert_eq!(run.projectiles.len(), VOLLEY_ARROWS as usize);
        let shots: Vec<u16> = run.projectiles.iter().map(|p| p.shot).collect();
        assert_eq!(shots, vec![0xfffe, 0xffff, 0x0000]);
        let spread = 15.0_f64.to_radians();
        for (p, off) in run.projectiles.iter().zip([-spread, 0.0, spread]) {
            assert!(angle_diff(p.vel.y.atan2(p.vel.x), 0.4 + off).abs() < 1e-9, "{off}");
            assert!((p.damage.amount - bow.damage * 0.6).abs() < 1e-9);
            assert_eq!(p.pierce, Pierce::Overkill { left: u8::MAX });
        }
        assert!((run.players[0].cd1 - bow.cooldown * 1.4).abs() < 1e-9);
    }

    #[test]
    fn volley_falls_back_to_strike_in_melee() {
        let mut run = ranger_volley();
        let mi = put_enemy(&mut run, 0, EnemyType::OrcWarrior, 10.0, 1000.0);
        try_use(&mut run, 0, true, 1);
        assert!(run.monsters[mi].hp < 1000.0, "the rapier struck");
        assert!(run.projectiles.iter().all(|p| p.dead), "the shot is spent");
        assert_eq!(run.players[0].cd1, run.players[0].sheet.fallback.cooldown, "the rapier's interval");
    }

    // ---- Plan 3b: weapon swings and the coat ----

    use crate::defs::abilities::{BEHIND_ARC, BEHIND_MULT, COAT_POISON_SECS, COAT_SHARE, SMITE_FLASH};
    use crate::defs::effects::OnHit;
    use crate::run::light::Anchor;
    use std::f64::consts::{PI, TAU};

    /// The damage hero 0's weapon deals to monster `mi` in one hit of `dmg` (its resistances applied).
    fn dealt(run: &Run, mi: usize, dmg: f64, split: DamageSplit) -> f64 {
        resolve(&Damage::new(dmg, split), &run.monsters[mi].effects.res(run.monsters[mi].res))
    }

    fn paladin_smite() -> Run {
        run_with_ability(ClassId::Paladin, AbilitySlot::Primary, AbilityId::Smite, Attributes::new(0, 0, 0, 0, 0, 1), Equipment::starter(ClassId::Paladin))
    }

    #[test]
    fn smite_adds_holy_and_flashes() {
        let mut run = paladin_smite();
        let a = run.players[0].sheet.primary;
        assert_eq!(a.id, AbilityId::Smite);
        let sword = run.players[0].sheet.melee;
        assert!((a.damage - 20.0 * 1.4).abs() < 1e-9 && (sword.damage - 20.0).abs() < 1e-9);
        assert!((a.split.share(DamageType::Magical) - 0.3).abs() < 1e-12);
        assert!((a.split.share(DamageType::Physical) - 0.7).abs() < 1e-12);
        let mi = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 20.0, 1000.0);
        let at = run.monsters[mi].pos;
        try_use(&mut run, 0, true, 1);
        assert!((run.players[0].cd1 - 0.45 * 1.6).abs() < 1e-9);
        let expect = dealt(&run, mi, 28.0, a.split);
        assert!((lost(&run, mi, 1000.0) - expect).abs() < 1e-9, "{} vs {expect}", lost(&run, mi, 1000.0));
        let flash = run.lights.sources.iter().find(|s| s.kind == LightKind::Holy).expect("a Holy flash");
        assert!(matches!(flash.anchor, Anchor::Point(p) if p.dist(at) < 1e-9), "at the first enemy hit");
        assert!((flash.expires.unwrap() - (run.time + SMITE_FLASH)).abs() < 1e-9);

        // A swing at nothing makes no flash.
        let mut run = paladin_smite();
        try_use(&mut run, 0, true, 1);
        assert!(!run.lights.sources.iter().any(|s| s.kind == LightKind::Holy && s.expires.is_some()), "no flash");
    }

    #[test]
    fn smite_needs_a_sword_mace_or_hammer() {
        use crate::defs::loadout::check_pick;
        use crate::defs::requirements::Requirement;
        use crate::defs::weapons::WeaponKind;
        let d = ab::def(AbilityId::Smite);
        let attrs = Attributes::new(15, 8, 13, 10, 12, 15);
        let kinds = &[WeaponKind::Sword, WeaponKind::Mace, WeaponKind::Hammer];
        assert_eq!(check_pick(&d, false, &attrs, Some(WeaponKind::Axe)), Err(LoadoutError::Requirement(AbilityId::Smite, Requirement::WeaponKind(kinds))));
        for k in kinds {
            assert_eq!(check_pick(&d, false, &attrs, Some(*k)), Ok(()));
        }
        // Without the CHA it is refused too.
        let weak = Attributes::new(15, 8, 13, 10, 12, 14);
        assert_eq!(check_pick(&d, false, &weak, Some(WeaponKind::Sword)), Err(LoadoutError::Requirement(AbilityId::Smite, Requirement::Attr(Attr::Cha, 15))));
        // A Paladin's own build can hold it (her weapons are all of the three kinds).
        let build = Build { own: vec![AbilityId::Smite], loadout: Loadout { primary: Pick { ability: AbilityId::Smite, source: Source::Own }, ..Loadout::start(ClassId::Paladin) }, extra: Attributes::new(0, 0, 0, 0, 0, 1), ..Build::start(ClassId::Paladin) };
        assert!(crate::sheet::hero_sheet(ClassId::Paladin, &build).is_ok());
    }

    #[test]
    fn whirl_hits_all_around() {
        let mut run = run_with_ability(ClassId::Barbarian, AbilitySlot::Primary, AbilityId::Whirl, Attributes::new(0, 1, 0, 0, 0, 0), Equipment::starter(ClassId::Barbarian));
        let a = run.players[0].sheet.primary;
        assert_eq!(a.id, AbilityId::Whirl);
        assert!((a.arc - TAU).abs() < 1e-12);
        let axe = run.players[0].sheet.melee;
        let here = run.players[0].pos();
        let ids: Vec<usize> = [Vec2::new(20.0, 0.0), Vec2::new(-20.0, 0.0), Vec2::new(0.0, 20.0), Vec2::new(0.0, -20.0)]
            .into_iter()
            .map(|d| {
                let id = run.spawn_enemy(EnemyType::GoblinArcher, here + d, None);
                let mi = run.monster_idx(id).unwrap();
                run.monsters[mi].hp = 1000.0;
                mi
            })
            .collect();
        try_use(&mut run, 0, true, 1);
        assert!((run.players[0].cd1 - axe.cooldown * 1.3).abs() < 1e-9, "0.8 x 1.3");
        for &mi in &ids {
            let expect = dealt(&run, mi, axe.damage * 0.75, axe.split);
            assert!((lost(&run, mi, 1000.0) - expect).abs() < 1e-9, "{} vs {expect}", lost(&run, mi, 1000.0));
        }
    }

    fn ranger_thrust() -> (Run, usize) {
        let mut run = run_with_ability(ClassId::ElvenRanger, AbilitySlot::Primary, AbilityId::FlankingThrust, Attributes::new(0, 5, 0, 0, 0, 0), Equipment::starter(ClassId::ElvenRanger));
        assert_eq!(run.players[0].sheet.primary.id, AbilityId::FlankingThrust);
        assert!((run.players[0].sheet.primary.behind - BEHIND_ARC).abs() < 1e-12);
        let mi = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 18.0, 1000.0);
        (run, mi)
    }

    /// One thrust at a goblin whose back is `off` rad from the hero (0: facing straight away): the damage and the Dmg event's crit.
    fn thrust_at(run: &mut Run, mi: usize, off: f64) -> (f64, bool) {
        // The hero is west of the goblin: aim 0 faces away from the hero, so its back is to the hero.
        run.monsters[mi].aim = off;
        run.monsters[mi].hp = 1000.0;
        run.players[0].cd1 = 0.0;
        run.events.clear();
        try_use(run, 0, true, 1);
        let crit = run.events.iter().find_map(|(e, _)| if let Ev::Dmg { crit, .. } = e { Some(*crit) } else { None }).expect("a hit");
        (lost(run, mi, 1000.0), crit)
    }

    #[test]
    fn flanking_thrust_doubles_from_behind() {
        let (mut run, mi) = ranger_thrust();
        let blade = run.players[0].sheet.melee;
        let one = dealt(&run, mi, blade.damage, blade.split);
        let (v, crit) = thrust_at(&mut run, mi, 0.0);
        assert!((v - one * BEHIND_MULT).abs() < 1e-9 && crit, "from behind: {v} vs {}", one * BEHIND_MULT);
        let (v, crit) = thrust_at(&mut run, mi, PI);
        assert!((v - one).abs() < 1e-9 && !crit, "facing the ranger");
        let deg = |d: f64| d.to_radians();
        let (v, crit) = thrust_at(&mut run, mi, deg(59.0));
        assert!((v - one * 2.0).abs() < 1e-9 && crit, "59 degrees off its back");
        let (v, crit) = thrust_at(&mut run, mi, deg(61.0));
        assert!((v - one).abs() < 1e-9 && !crit, "61 degrees off its back");
    }

    #[test]
    fn find_the_gap_widens_behind() {
        let (mut run, mi) = ranger_thrust();
        let blade = run.players[0].sheet.melee;
        let one = dealt(&run, mi, blade.damage, blade.split);
        let (v, _) = thrust_at(&mut run, mi, 80.0_f64.to_radians());
        assert!((v - one).abs() < 1e-9, "80 degrees is outside the plain arc");
        run.players[0].sheet.primary.behind += 30.0_f64.to_radians();
        let (v, crit) = thrust_at(&mut run, mi, 80.0_f64.to_radians());
        assert!((v - one * 2.0).abs() < 1e-9 && crit, "and inside the widened one");
    }

    #[test]
    fn poison_coat_poisons_weapon_attacks_only() {
        let mut run = run_with_ability(ClassId::ElvenRanger, AbilitySlot::Secondary, AbilityId::PoisonCoat, Attributes::new(0, 0, 0, 0, 1, 0), Equipment::starter(ClassId::ElvenRanger));
        let coat = run.players[0].sheet.secondary;
        assert_eq!(coat.id, AbilityId::PoisonCoat);
        assert_eq!(run.players[0].sheet.primary.id, AbilityId::Shoot);
        let mi = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 80.0, 1000.0);
        let bow = run.players[0].sheet.primary;
        try_use(&mut run, 0, false, 1);
        assert_eq!(run.players[0].cd2, 16.0);
        let held = run.players[0].effects.list().iter().find(|e| e.kind == EffectKind::Coated).expect("coated");
        assert!((held.left - 6.0).abs() < 1e-9);
        // A bow shot carries the share and the on-hit.
        try_use(&mut run, 0, true, 2);
        let shot = run.projectiles[0].damage;
        assert!((shot.split.share(DamageType::Poison) - COAT_SHARE).abs() < 1e-12);
        assert!((shot.split.share(DamageType::Physical) - (1.0 - COAT_SHARE)).abs() < 1e-12);
        let on_hit = shot.on_hit.expect("the coat's on-hit");
        assert_eq!((on_hit.kind, on_hit.secs, on_hit.magical, on_hit.power), (EffectKind::Poisoned, COAT_POISON_SECS, false, bow.power));
        fly(&mut run);
        let m = Creature::Monster(mi);
        assert!(run.has_effect(m, EffectKind::Poisoned) && !run.has_effect(m, EffectKind::Tainted), "Poisoned replaces the Tainted its share alone would give");
        // The coat itself is no weapon attack: a Technique with no weapon adds nothing to itself.
        assert_eq!(weapon_damage(&run, 0, &coat), damage_of(run.players[0].id, &coat), "a coated hero's Technique gets no coat");
        // After 6 s the bow is plain again.
        for _ in 0..361 {
            run.tick_effects();
        }
        assert!(!run.players[0].effects.has(EffectKind::Coated));
        run.players[0].cd1 = 0.0;
        try_use(&mut run, 0, true, 3);
        let plain = run.projectiles.last().unwrap().damage;
        assert_eq!(plain.split, bow.split);
        assert_eq!(plain.on_hit, bow.on_hit);
    }

    #[test]
    fn the_coat_replaces_a_weapon_on_hit_while_it_lasts() {
        let slowed = OnHit { kind: EffectKind::Slowed, secs: 3.0, magical: false, power: 10, look: crate::defs::effects::EffectLook::Plain };
        let strike = |coated: bool| {
            let mut run = run_with_ability(ClassId::Barbarian, AbilitySlot::Primary, AbilityId::Strike, Attributes::default(), Equipment::starter(ClassId::Barbarian));
            run.players[0].sheet.primary.on_hit = Some(slowed);
            if coated {
                run.apply_effect(Creature::Player(0), EffectKind::Coated, Some(6.0));
            }
            let mi = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 20.0, 1000.0);
            try_use(&mut run, 0, true, 1);
            let m = Creature::Monster(mi);
            (run.has_effect(m, EffectKind::Poisoned), run.has_effect(m, EffectKind::Slowed))
        };
        assert_eq!(strike(true), (true, false), "the coat's Poisoned wins");
        assert_eq!(strike(false), (false, true), "the weapon's own effect comes back");
    }

    // ---- Plan 3b: rings and party effects ----

    use crate::defs::abilities::SLAM_WINDUP;
    use crate::defs::effects::scaled_secs;

    /// The seconds left of `kind` on `c`, if it is on.
    fn left(run: &Run, c: Creature, kind: EffectKind) -> Option<f64> {
        let fx = match c {
            Creature::Player(i) => run.players[i].effects.list(),
            Creature::Monster(i) => run.monsters[i].effects.list(),
        };
        fx.iter().find(|a| a.kind == kind).map(|a| a.left)
    }

    fn booms(run: &Run, k: u8) -> Vec<(f32, f32, f32)> {
        run.events.iter().filter_map(|(e, _)| if let Ev::Boom { x, y, r, k: kk } = e { (*kk == k).then_some((*x, *y, *r)) } else { None }).collect()
    }

    fn wizard_secondary(id: AbilityId, extra: Attributes) -> Run {
        run_with_ability(ClassId::Wizard, AbilitySlot::Secondary, id, extra, Equipment::starter(ClassId::Wizard))
    }

    fn barbarian_secondary(id: AbilityId, extra: Attributes, melee: ItemId) -> Run {
        let equipment = Equipment::starter(ClassId::Barbarian).with(EquipSlot::Melee, melee);
        run_with_ability(ClassId::Barbarian, AbilitySlot::Secondary, id, extra, equipment)
    }

    #[test]
    fn frost_nova_freezes_around_the_wizard() {
        let mut run = wizard_secondary(AbilityId::FrostNova, Attributes::new(0, 0, 0, 7, 0, 0));
        let a = run.players[0].sheet.secondary;
        assert_eq!(a.id, AbilityId::FrostNova);
        assert_eq!(a.split, DamageSplit::pure(DamageType::Cold));
        let g = goblins(&mut run, &[30.0, 60.0]);
        // Works with an enemy in melee reach: it is not a ranged ability.
        try_use(&mut run, 0, false, 1);
        assert_eq!(a.cooldown, 9.0);
        assert_eq!(run.players[0].cd2, 9.0);
        assert_eq!(run.players[0].anim, Anim::Cast);
        let expect = dealt(&run, g[0], a.damage, a.split);
        assert!((lost(&run, g[0], 1000.0) - expect).abs() < 1e-9, "{} vs {expect}", lost(&run, g[0], 1000.0));
        assert!(run.has_effect(Creature::Monster(g[0]), EffectKind::Frozen), "a pure cold hit freezes");
        assert_eq!(run.monsters[g[1]].hp, 1000.0, "the far one is outside 44 px");
        assert!(!run.has_effect(Creature::Monster(g[1]), EffectKind::Frozen));
        let pos = run.players[0].pos();
        assert_eq!(booms(&run, 10), vec![(pos.x as f32, pos.y as f32, a.radius as f32)]);
        assert_eq!(a.radius, 44.0);
    }

    #[test]
    fn frost_nova_does_not_reach_through_walls_or_the_wolf() {
        let mut run = wizard_secondary(AbilityId::FrostNova, Attributes::new(0, 0, 0, 7, 0, 0));
        let near = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 30.0, 1000.0);
        let wolf = crate::run::companion::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        run.monsters[wi].pos = run.players[0].pos() + Vec2::new(0.0, 20.0);
        let wolf_hp = run.monsters[wi].hp;
        let (tx, ty) = crate::dungeon::Map::tile_of(run.monsters[near].pos);
        run.layout.map.set(tx - 1, ty, crate::dungeon::Tile::Wall);
        let hp = run.monsters[near].hp;
        assert!(!line_of_sight(&run.layout.map, run.players[0].pos(), run.monsters[near].pos), "walled off");
        try_use(&mut run, 0, false, 1);
        assert_eq!(run.monsters[near].hp, hp);
        assert_eq!(run.monsters[wi].hp, wolf_hp, "the wolf is safe");
    }

    fn barbarian_war_cry() -> Run {
        barbarian_secondary(AbilityId::WarCry, Attributes::new(1, 0, 0, 0, 0, 0), ItemId::GreatAxe)
    }

    #[test]
    fn war_cry_frightens_enemies_and_hastens_allies() {
        let mut run = barbarian_war_cry();
        let a = run.players[0].sheet.secondary;
        assert_eq!(a.id, AbilityId::WarCry);
        assert_eq!(run.players[0].sheet.attrs.get(Attr::Str), 16);
        // The wolf beside the hero.
        let goblin = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 40.0, 1000.0);
        let far = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 90.0, 1000.0);
        let wolf = crate::run::companion::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        run.monsters[wi].pos = run.players[0].pos() + Vec2::new(0.0, 30.0);
        let hero_id = run.players[0].id;
        let hero_pos = run.players[0].pos();
        try_use(&mut run, 0, false, 1);
        assert_eq!(run.players[0].cd2, 12.0);
        let wil = run.monsters[goblin].attrs.get(Attr::Wil);
        let want = scaled_secs(3.0, 16, wil);
        let got = left(&run, Creature::Monster(goblin), EffectKind::Fear).expect("frightened");
        assert!((got - want).abs() < 1e-9, "{got} vs {want}");
        let fx = run.monsters[goblin].effects.fear_from();
        assert_eq!(fx, Some((Some(hero_id), hero_pos)), "afraid of the hero, from where it stood");
        assert!(!run.has_effect(Creature::Monster(far), EffectKind::Fear), "outside 56 px");
        assert!(!run.has_effect(Creature::Monster(wi), EffectKind::Fear), "the wolf is never frightened");
        assert_eq!(left(&run, Creature::Monster(wi), EffectKind::Accelerated), Some(3.0));
        assert_eq!(left(&run, Creature::Player(0), EffectKind::Accelerated), Some(3.0));
        assert_eq!(booms(&run, 11).len(), 1);
    }

    #[test]
    fn war_cry_hastens_a_second_hero_in_range_only() {
        let barb = ClassId::Barbarian;
        let start = Loadout::start(barb);
        let pick = Pick { ability: AbilityId::WarCry, source: Source::Own };
        let build = Build { own: vec![AbilityId::WarCry], loadout: Loadout { secondary: pick, ..start }, extra: Attributes::new(1, 0, 0, 0, 0, 0), ..Build::start(barb) };
        let mut run = super::super::tests::test_run_with(&[(barb, build), (ClassId::Paladin, Build::start(ClassId::Paladin))], BossId::Demon);
        let here = run.players[0].pos();
        run.players[1].mv.x = here.x + 50.0;
        run.players[1].mv.y = here.y;
        try_use(&mut run, 0, false, 1);
        assert_eq!(left(&run, Creature::Player(1), EffectKind::Accelerated), Some(3.0));
        let mut run2 = super::super::tests::test_run_with(&[(barb, Build { own: vec![AbilityId::WarCry], loadout: Loadout { secondary: pick, ..Loadout::start(barb) }, extra: Attributes::new(1, 0, 0, 0, 0, 0), ..Build::start(barb) }), (ClassId::Paladin, Build::start(ClassId::Paladin))], BossId::Demon);
        let here = run2.players[0].pos();
        run2.players[1].mv.x = here.x + 100.0;
        run2.players[1].mv.y = here.y;
        try_use(&mut run2, 0, false, 1);
        assert_eq!(left(&run2, Creature::Player(1), EffectKind::Accelerated), None);
    }

    #[test]
    fn war_cry_spares_the_undead() {
        let mut run = barbarian_war_cry();
        let s = put_enemy(&mut run, 0, EnemyType::SkeletonWarrior, 40.0, 1000.0);
        let g = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 40.0, 1000.0);
        try_use(&mut run, 0, false, 1);
        assert!(!run.has_effect(Creature::Monster(s), EffectKind::Fear), "the undead resist Fear fully");
        assert!(run.has_effect(Creature::Monster(g), EffectKind::Fear));
    }

    fn ground_slam() -> Run {
        barbarian_secondary(AbilityId::GroundSlam, Attributes::new(2, 0, 0, 0, 0, 0), ItemId::WarHammer)
    }

    #[test]
    fn ground_slam_lands_after_its_windup() {
        let mut run = ground_slam();
        let a = run.players[0].sheet.secondary;
        assert_eq!(a.id, AbilityId::GroundSlam);
        let hammer = run.players[0].sheet.melee;
        assert!((a.damage - hammer.damage * 1.2).abs() < 1e-9);
        assert_eq!(a.radius, 34.0);
        let g = goblins(&mut run, &[20.0, 30.0, 90.0]);
        try_use(&mut run, 0, false, 1);
        assert_eq!(run.players[0].slam, Some(SLAM_WINDUP));
        assert_eq!(run.players[0].anim, Anim::Cast);
        assert_eq!(run.players[0].cd2, 6.0);
        assert!(g.iter().all(|&i| run.monsters[i].hp == 1000.0), "nothing yet");
        assert!(booms(&run, 5).is_empty());
        let mut steps = 0;
        while run.players[0].slam.is_some() {
            run.step_player(0);
            steps += 1;
            assert!(steps <= 40, "it lands");
            if run.players[0].slam.is_some() {
                assert!(g.iter().all(|&i| run.monsters[i].hp == 1000.0), "still winding up");
            }
        }
        assert!((steps as f64 / 60.0 - SLAM_WINDUP).abs() < 0.05, "{steps} steps");
        for &i in &g[..2] {
            let expect = dealt(&run, i, a.damage, a.split);
            assert!((lost(&run, i, 1000.0) - expect).abs() < 1e-9, "{} vs {expect}", lost(&run, i, 1000.0));
        }
        assert_eq!(run.monsters[g[2]].hp, 1000.0, "outside 34 px");
        let pos = run.players[0].pos();
        assert_eq!(booms(&run, 5), vec![(pos.x as f32, pos.y as f32, 34.0)]);
        // Pushed away from the hero (they are east of it).
        for &i in &g[..2] {
            assert!(run.monsters[i].knock.x > 0.0, "pushed east");
        }
    }

    #[test]
    fn ground_slam_pushes_at_least_slam_push() {
        let mut run = ground_slam();
        assert_eq!(run.players[0].sheet.secondary.push, 24.0, "the hammer's own push");
        run.players[0].sheet.secondary.push = 0.0;
        let g = goblins(&mut run, &[20.0]);
        try_use(&mut run, 0, false, 1);
        for _ in 0..40 {
            run.step_player(0);
        }
        assert!(run.monsters[g[0]].knock.len() > 0.0, "pushed by SLAM_PUSH even when the weapon does not push");
    }

    #[test]
    fn ground_slam_needs_a_hammer_or_club() {
        use crate::defs::requirements::Requirement;
        use crate::defs::weapons::WeaponKind;
        let pick = Pick { ability: AbilityId::GroundSlam, source: Source::Own };
        let build = Build { own: vec![AbilityId::GroundSlam], loadout: Loadout { secondary: pick, ..Loadout::start(ClassId::Barbarian) }, extra: Attributes::new(2, 0, 0, 0, 0, 0), ..Build::start(ClassId::Barbarian) };
        let err = crate::sheet::hero_sheet(ClassId::Barbarian, &build).err();
        assert_eq!(err, Some(LoadoutError::Requirement(AbilityId::GroundSlam, Requirement::WeaponKind(&[WeaponKind::Hammer, WeaponKind::Club]))));
    }

    #[test]
    fn a_knocked_hero_loses_the_slam() {
        let mut run = ground_slam();
        let g = goblins(&mut run, &[20.0]);
        try_use(&mut run, 0, false, 1);
        assert!(run.players[0].slam.is_some());
        run.knock_player(0, run.players[0].pos() + Vec2::new(20.0, 0.0), 0.0, 40.0, 30);
        assert!(run.players[0].mv.knocked());
        for _ in 0..40 {
            run.step_player(0);
        }
        assert_eq!(run.players[0].slam, None);
        assert_eq!(run.monsters[g[0]].hp, 1000.0, "nothing landed");
        assert!(booms(&run, 5).is_empty());
    }

    #[test]
    fn a_dead_hero_loses_the_slam() {
        let mut run = ground_slam();
        let g = goblins(&mut run, &[20.0]);
        try_use(&mut run, 0, false, 1);
        run.players[0].alive = false;
        for _ in 0..40 {
            run.step_player(0);
        }
        assert_eq!(run.players[0].slam, None);
        assert_eq!(run.monsters[g[0]].hp, 1000.0);
    }

    #[test]
    fn ground_slam_carries_the_coat() {
        let mut run = ground_slam();
        let g = goblins(&mut run, &[20.0]);
        run.apply_effect(Creature::Player(0), EffectKind::Coated, Some(6.0));
        try_use(&mut run, 0, false, 1);
        for _ in 0..40 {
            run.step_player(0);
        }
        assert!(run.has_effect(Creature::Monster(g[0]), EffectKind::Poisoned), "a weapon attack: the coat applies");
    }

    #[test]
    fn haste_hastens_the_party_in_range() {
        let wiz = ClassId::Wizard;
        let pick = Pick { ability: AbilityId::Haste, source: Source::Own };
        let mk = || Build { own: vec![AbilityId::Haste], loadout: Loadout { secondary: pick, ..Loadout::start(wiz) }, extra: Attributes::new(0, 0, 0, 5, 2, 0), ..Build::start(wiz) };
        let mut run = super::super::tests::test_run_with(&[(wiz, mk()), (ClassId::Paladin, Build::start(ClassId::Paladin)), (ClassId::Barbarian, Build::start(ClassId::Barbarian))], BossId::Demon);
        let here = run.players[0].pos();
        run.players[1].mv.x = here.x + 50.0;
        run.players[1].mv.y = here.y;
        run.players[2].mv.x = here.x + 100.0;
        run.players[2].mv.y = here.y;
        let wolf = crate::run::companion::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        run.monsters[wi].pos = here + Vec2::new(0.0, 40.0);
        try_use(&mut run, 0, false, 1);
        assert_eq!(run.players[0].cd2, 14.0);
        assert_eq!(run.players[0].anim, Anim::Cast);
        assert_eq!(left(&run, Creature::Player(0), EffectKind::Accelerated), Some(4.0));
        assert_eq!(left(&run, Creature::Player(1), EffectKind::Accelerated), Some(4.0));
        assert_eq!(left(&run, Creature::Monster(wi), EffectKind::Accelerated), Some(4.0));
        assert_eq!(left(&run, Creature::Player(2), EffectKind::Accelerated), None, "at 100 px");
        assert_eq!(booms(&run, 12).len(), 1);
    }

    #[test]
    fn purify_cleanses_and_wards() {
        let mut run = run_with_ability(ClassId::Paladin, AbilitySlot::Secondary, AbilityId::Purify, Attributes::new(0, 0, 0, 0, 2, 0), Equipment::starter(ClassId::Paladin));
        let a = run.players[0].sheet.secondary;
        assert_eq!(a.id, AbilityId::Purify);
        let me = Creature::Player(0);
        run.apply_effect(me, EffectKind::Burning, Some(5.0));
        run.apply_effect(me, EffectKind::Slowed, Some(5.0));
        run.apply_effect(me, EffectKind::Accelerated, Some(5.0));
        assert!(run.has_effect(me, EffectKind::Burning) && run.has_effect(me, EffectKind::Slowed));
        try_use(&mut run, 0, false, 1);
        assert_eq!(run.players[0].cd2, 15.0);
        assert!(!run.has_effect(me, EffectKind::Burning));
        assert!(!run.has_effect(me, EffectKind::Slowed));
        assert!(run.has_effect(me, EffectKind::Accelerated), "a positive effect stays");
        assert_eq!(left(&run, me, EffectKind::Warded), Some(3.0));
        assert_eq!(booms(&run, 13).len(), 1);
        assert!(!run.apply_effect(me, EffectKind::Sleep, Some(5.0)), "Warded refuses Sleep");
        assert!(!run.has_effect(me, EffectKind::Sleep));
    }

    fn consecrate_run() -> Run {
        run_with_ability(ClassId::Paladin, AbilitySlot::Secondary, AbilityId::Consecrate, Attributes::new(0, 0, 0, 0, 0, 8), Equipment::starter(ClassId::Paladin))
    }

    fn entangle_run() -> Run {
        let mut run = run_with_ability(ClassId::ElvenRanger, AbilitySlot::Secondary, AbilityId::Entangle, Attributes::new(0, 0, 0, 0, 0, 14), Equipment::starter(ClassId::ElvenRanger));
        run.players[0].aim_dist = 80.0;
        run
    }

    #[test]
    fn consecrate_hurts_enemies_only() {
        let mut run = consecrate_run();
        let a = run.players[0].sheet.secondary;
        assert_eq!(a.id, AbilityId::Consecrate);
        assert_eq!(a.split, DamageSplit::pure(DamageType::Magical));
        let g = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 20.0, 1000.0);
        let doomed = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 25.0, 1.0);
        let wolf = crate::run::companion::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        run.monsters[wi].pos = run.players[0].pos() + Vec2::new(0.0, 15.0);
        let (wolf_hp, hero_hp, kills) = (run.monsters[wi].hp, run.players[0].hp, run.players[0].kills);
        try_use(&mut run, 0, false, 1);
        assert_eq!(run.players[0].cd2, 12.0);
        assert_eq!(run.hazards.len(), 1);
        let h = &run.hazards[0];
        assert_eq!((h.kind, h.radius, h.life), (EntityKind::HolyGround, 40.0, 5.0));
        assert_eq!(h.side, HazardSide::Heroes { owner: run.players[0].id });
        let hid = h.id;
        assert!(run.lights.sources.iter().any(|l| l.kind == LightKind::Holy && l.anchor == Anchor::Entity(hid)), "Holy light while it lasts");
        let res = run.monsters[g].effects.res(run.monsters[g].res);
        let one = resolve(&Damage::new(a.damage, a.split), &res);
        assert!(one > 0.0);
        let mut seen = Vec::new();
        for _ in 0..300 {
            run.tick_hazards(1.0 / 60.0); // the hazard alone: nobody walks out of it
            let n = ((1000.0 - run.monsters[g].hp) / one).round() as usize;
            if seen.last() != Some(&n) {
                seen.push(n);
            }
        }
        assert_eq!(seen, (0..=10).collect::<Vec<_>>(), "a pulse every 0.5 s from 0.25 s for 5 s");
        assert!(!run.monsters[doomed].alive);
        assert_eq!(run.players[0].kills, kills + 1, "the kill is the paladin's");
        assert_eq!(run.monsters[wi].hp, wolf_hp, "the wolf is untouched");
        assert_eq!(run.players[0].hp, hero_hp, "so is the hero");
        assert!(run.hazards[0].life < 0.05, "it lasts 5 s");
        run.step();
        assert!(run.hazards.is_empty());
    }

    #[test]
    fn entangle_binds_enemies_at_the_aimed_spot() {
        let mut run = entangle_run();
        let a = run.players[0].sheet.secondary;
        assert_eq!(a.id, AbilityId::Entangle);
        let g = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 80.0, 1000.0);
        let far = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 140.0, 1000.0);
        let here = run.players[0].pos();
        try_use(&mut run, 0, false, 1);
        assert_eq!(run.players[0].cd2, 14.0);
        let h = &run.hazards[0];
        assert_eq!((h.kind, h.radius, h.life), (EntityKind::Roots, 36.0, 4.0));
        assert!((h.pos.x - (here.x + 80.0)).abs() < 1e-9 && (h.pos.y - here.y).abs() < 1e-9);
        assert!(matches!(h.pulse, HazardPulse::Bind(on) if on.kind == EffectKind::Entangled && on.look == EffectLook::Vines && on.secs == ab::ENTANGLE_PULSE_SECS));
        run.tick_hazards(0.3);
        let m = Creature::Monster(g);
        assert!(run.has_effect(m, EffectKind::Entangled));
        assert!(run.monsters[g].effects.no_move() && !run.monsters[g].effects.no_act(), "it cannot move but still acts");
        assert!(run.monsters[g].effects.looks().any(|(k, l)| k == EffectKind::Entangled && l == EffectLook::Vines));
        assert!(!run.has_effect(Creature::Monster(far), EffectKind::Entangled), "out of the roots");
        // The roots end 3.7 s from now; the last pulse's Entangled (1 s before the save) runs out
        // `scaled_secs` later, and nothing renews it.
        let power = a.effect.unwrap().power;
        let last = scaled_secs(ab::ENTANGLE_PULSE_SECS, power, run.monsters[g].attrs.get(Attr::Str));
        for _ in 0..((3.7 + last) * 60.0) as usize + 5 {
            run.step();
        }
        assert!(run.hazards.is_empty());
        assert!(!run.has_effect(m, EffectKind::Entangled), "free within one pulse's time of the roots ending");
    }

    #[test]
    fn entangle_is_blocked_in_melee() {
        let mut run = entangle_run();
        put_enemy(&mut run, 0, EnemyType::GoblinArcher, 10.0, 1000.0);
        try_use(&mut run, 0, false, 1);
        assert!(run.hazards.is_empty());
        assert_eq!(run.players[0].cd2, 0.0);
    }

    #[test]
    fn strong_creatures_break_free_sooner() {
        let mut run = entangle_run();
        let a = run.players[0].sheet.secondary;
        let power = a.effect.unwrap().power;
        let goblin = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 80.0, 1000.0);
        let ogre = put_enemy(&mut run, 0, EnemyType::Ogre, 85.0, 1000.0);
        try_use(&mut run, 0, false, 1);
        run.tick_hazards(0.3);
        assert!(run.has_effect(Creature::Monster(ogre), EffectKind::Entangled), "the ogre is entangled");
        let (g, o) = (left(&run, Creature::Monster(goblin), EffectKind::Entangled).unwrap(), left(&run, Creature::Monster(ogre), EffectKind::Entangled).unwrap());
        assert!((g - scaled_secs(1.0, power, run.monsters[goblin].attrs.get(Attr::Str))).abs() < 1e-9);
        assert!((o - scaled_secs(1.0, power, run.monsters[ogre].attrs.get(Attr::Str))).abs() < 1e-9);
        assert!(o < g, "STR 19 against STR 8: {o} vs {g}");
    }

    #[test]
    fn entangle_stops_at_walls() {
        let mut run = entangle_run();
        let g = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 100.0, 1000.0);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos() + Vec2::new(60.0, 0.0));
        run.layout.map.set(tx, ty, crate::dungeon::Tile::Wall);
        run.players[0].aim_dist = 100.0;
        let here = run.players[0].pos();
        try_use(&mut run, 0, false, 1);
        assert_eq!(run.hazards.len(), 1);
        let at = run.hazards[0].pos;
        assert!(at.x < here.x + 60.0 && at.x > here.x && !run.layout.map.opaque_at(at), "on the hero's side of the wall");
        run.tick_hazards(0.3);
        assert!(!run.has_effect(Creature::Monster(g), EffectKind::Entangled), "the goblin behind the wall is not entangled");
    }

    #[test]
    fn war_cry_and_roots_skip_hidden_mimics_and_dormant_monsters() {
        let mut run = barbarian_war_cry();
        let mimic = put_enemy(&mut run, 0, EnemyType::Mimic, 40.0, 1000.0);
        let sleeper = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 30.0, 1000.0);
        run.monsters[mimic].hiding = true;
        run.monsters[sleeper].dormant = true;
        let at = run.monsters[mimic].pos;
        try_use(&mut run, 0, false, 1);
        for _ in 0..30 {
            run.step();
        }
        assert!(!run.has_effect(Creature::Monster(mimic), EffectKind::Fear) && !run.has_effect(Creature::Monster(sleeper), EffectKind::Fear), "no Fear on them");
        assert!(run.monsters[mimic].hiding && run.monsters[mimic].pos == at, "the mimic stays put and disguised");
        // Roots over them: not entangled either.
        let mut run = entangle_run();
        let mimic = put_enemy(&mut run, 0, EnemyType::Mimic, 80.0, 1000.0);
        let sleeper = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 84.0, 1000.0);
        run.monsters[mimic].hiding = true;
        run.monsters[sleeper].dormant = true;
        try_use(&mut run, 0, false, 1);
        run.tick_hazards(0.3);
        assert!(!run.has_effect(Creature::Monster(mimic), EffectKind::Entangled) && !run.has_effect(Creature::Monster(sleeper), EffectKind::Entangled));
    }

    #[test]
    fn a_frightened_hidden_mimic_does_not_walk() {
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        let mimic = put_enemy(&mut run, 0, EnemyType::Mimic, 40.0, 1000.0);
        run.monsters[mimic].hiding = true;
        run.apply_effect(Creature::Monster(mimic), EffectKind::Fear, Some(3.0));
        let at = run.monsters[mimic].pos;
        for _ in 0..30 {
            run.step();
        }
        assert!(run.monsters[mimic].hiding && run.monsters[mimic].pos == at, "the backstop: no flee while hiding");
    }

    #[test]
    fn roots_do_not_reach_through_a_wall() {
        let mut run = entangle_run();
        let g = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 80.0, 1000.0);
        try_use(&mut run, 0, false, 1);
        let at = run.hazards[0].pos;
        let (tx, ty) = crate::dungeon::Map::tile_of(at);
        run.monsters[g].pos = crate::dungeon::Map::center_of(tx + 1, ty);
        run.layout.map.set(tx, ty, crate::dungeon::Tile::Wall);
        let near = run.monsters[g].pos;
        assert!(near.dist(at) < 36.0 + run.monsters[g].radius, "within the circle");
        assert!(!line_of_sight(&run.layout.map, at, near), "but walled off");
        run.tick_hazards(0.3);
        assert!(!run.has_effect(Creature::Monster(g), EffectKind::Entangled));
    }

    #[test]
    fn ground_slam_does_not_hit_through_walls() {
        let mut run = ground_slam();
        let g = goblins(&mut run, &[30.0]);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.monsters[g[0]].pos);
        run.layout.map.set(tx - 1, ty, crate::dungeon::Tile::Wall);
        assert!(!line_of_sight(&run.layout.map, run.players[0].pos(), run.monsters[g[0]].pos), "walled off");
        try_use(&mut run, 0, false, 1);
        for _ in 0..40 {
            run.step_player(0);
        }
        assert_eq!(run.monsters[g[0]].hp, 1000.0, "untouched");
    }

    #[test]
    fn chain_spark_skips_dormant_monsters() {
        let mut run = wizard_with(AbilityId::ChainSpark, 3);
        let first = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 60.0, 1000.0);
        let sleeper = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 60.0, 1000.0);
        run.monsters[sleeper].pos = run.monsters[first].pos + Vec2::new(0.0, 20.0);
        run.monsters[sleeper].dormant = true;
        try_use(&mut run, 0, true, 1);
        fly(&mut run);
        assert!(run.monsters[first].hp < 1000.0);
        assert_eq!(run.monsters[sleeper].hp, 1000.0);
    }

    #[test]
    fn frost_nova_flashes_icy_blue() {
        let mut run = wizard_secondary(AbilityId::FrostNova, Attributes::new(0, 0, 0, 7, 0, 0));
        try_use(&mut run, 0, false, 1);
        let flash = run.lights.sources.iter().find(|s| s.kind == LightKind::Magic && s.expires.is_some()).expect("a Magic flash");
        assert_eq!(flash.colour, 0x78c8ff);
    }

    #[test]
    fn a_rooted_frightened_monster_does_not_play_its_walk() {
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        let g = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 40.0, 1000.0);
        run.apply_effect(Creature::Monster(g), EffectKind::Fear, Some(3.0));
        run.apply_effect(Creature::Monster(g), EffectKind::Entangled, Some(3.0));
        let at = run.monsters[g].pos;
        for _ in 0..10 {
            run.step();
        }
        assert_eq!(run.monsters[g].pos, at, "rooted");
        assert_eq!(run.monsters[g].anim, Anim::Idle);
    }

    // What today's code selects (recorded before the `targets::check` refactor, never re-recorded).
    const PIN_NOVA: &[&str] = &["ok", "dormant", "air", "hide", "back", "touch", "air_near", "dormant_near"];
    const PIN_CRY: &[&str] = &["ok", "wall", "air", "back", "touch", "air_near"];
    const PIN_SLAM: &[&str] = &["ok", "dormant", "hide", "back", "touch", "dormant_near"];
    const PIN_STRIKE: &[&str] = &["ok", "touch", "dormant_near"];
    const PIN_CHAIN: &[&str] = &["ok", "touch", "air_near"];

    /// The same crowd for every shape: (name, monster index). Hero at the origin, aiming east.
    /// "wall" is behind a wall tile, "back" behind the hero, "wolf" is the hero's ally.
    fn crowd(run: &mut Run) -> Vec<(&'static str, usize)> {
        let at = |run: &mut Run, name: &'static str, off: Vec2| {
            let pos = run.players[0].pos() + off;
            let id = run.spawn_enemy(EnemyType::GoblinArcher, pos, None);
            let mi = run.monster_idx(id).unwrap();
            run.monsters[mi].hp = 1000.0;
            run.monsters[mi].max_hp = 1000.0;
            (name, mi)
        };
        let ok = at(run, "ok", Vec2::new(20.0, 0.0));
        let dormant = at(run, "dormant", Vec2::new(26.0, -10.0));
        let air = at(run, "air", Vec2::new(0.0, -26.0));
        let hide = at(run, "hide", Vec2::new(30.0, -6.0));
        let back = at(run, "back", Vec2::new(-25.0, 0.0));
        let far = at(run, "far", Vec2::new(200.0, 0.0));
        let touch = at(run, "touch", Vec2::new(-6.0, 3.0)); // behind, but touching the hero
        let air_near = at(run, "air_near", Vec2::new(12.0, -5.0));
        let dormant_near = at(run, "dormant_near", Vec2::new(14.0, 5.0));
        run.monsters[air_near.1].airborne = true;
        run.monsters[dormant_near.1].dormant = true;
        run.monsters[dormant.1].dormant = true;
        run.monsters[air.1].airborne = true;
        run.monsters[hide.1].hiding = true;
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        run.layout.map.set(tx, ty + 1, crate::dungeon::Tile::Wall);
        let wall_id = run.spawn_enemy(EnemyType::GoblinArcher, crate::dungeon::Map::center_of(tx, ty + 2), None);
        let wall = run.monster_idx(wall_id).unwrap();
        run.monsters[wall].hp = 1000.0;
        run.monsters[wall].max_hp = 1000.0;
        assert!(!line_of_sight(&run.layout.map, run.players[0].pos(), run.monsters[wall].pos), "walled off");
        let wolf_id = crate::run::companion::spawn_wolf(run, 0);
        let wolf = run.monster_idx(wolf_id).unwrap();
        run.monsters[wolf].pos = run.players[0].pos() + Vec2::new(-10.0, -18.0);
        vec![ok, ("wall", wall), dormant, air, hide, back, touch, air_near, dormant_near, far, ("wolf", wolf)]
    }

    /// The names of those in `crowd` that took damage or, with `fear`, are afraid.
    fn hit_names(run: &Run, crowd: &[(&'static str, usize)], fear: bool) -> Vec<&'static str> {
        crowd.iter().filter(|&&(n, mi)| if fear { run.has_effect(Creature::Monster(mi), EffectKind::Fear) } else { n != "wolf" && run.monsters[mi].hp < 1000.0 }).map(|&(n, _)| n).collect()
    }

    /// Pins which targets Frost Nova, War Cry, Ground Slam, a Strike and a Chain Spark select, so the
    /// shared `targets::check` cannot change a rule.
    #[test]
    fn target_checks_keep_the_same_targets() {
        let mut run = wizard_secondary(AbilityId::FrostNova, Attributes::new(0, 0, 0, 7, 0, 0));
        let c = crowd(&mut run);
        try_use(&mut run, 0, false, 1);
        assert_eq!(hit_names(&run, &c, false), PIN_NOVA, "Frost Nova");

        let mut run = barbarian_war_cry();
        let c = crowd(&mut run);
        try_use(&mut run, 0, false, 1);
        assert_eq!(hit_names(&run, &c, true), PIN_CRY, "War Cry");

        let mut run = ground_slam();
        let c = crowd(&mut run);
        let wolf_at = run.monsters[c.last().unwrap().1].pos;
        land_slam(&mut run, 0);
        assert_eq!(hit_names(&run, &c, false), PIN_SLAM, "Ground Slam");
        assert_eq!(run.monsters[c.last().unwrap().1].pos, wolf_at, "the wolf is not knocked");

        let mut run = run_with_ability(ClassId::Barbarian, AbilitySlot::Primary, AbilityId::Strike, Attributes::default(), Equipment::starter(ClassId::Barbarian));
        let c = crowd(&mut run);
        try_use(&mut run, 0, true, 1);
        assert_eq!(hit_names(&run, &c, false), PIN_STRIKE, "Strike");

        let mut run = wizard_with(AbilityId::ChainSpark, 3);
        run.players[0].sheet.reach = 0.0; // nobody in melee reach: the spark flies instead of a Strike
        let c = crowd(&mut run);
        try_use(&mut run, 0, true, 1);
        fly(&mut run);
        assert_eq!(hit_names(&run, &c, false), PIN_CHAIN, "Chain Spark");
        assert_eq!(run.monsters[c.last().unwrap().1].hp, 80.0, "no jump to the wolf");

        // Line of sight for a Strike: a goblin in the arc and in reach, standing in a wall tile, is not hit.
        for walled in [false, true] {
            let mut run = run_with_ability(ClassId::Barbarian, AbilitySlot::Primary, AbilityId::Strike, Attributes::default(), Equipment::starter(ClassId::Barbarian));
            let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
            let g = run.spawn_enemy(EnemyType::GoblinArcher, crate::dungeon::Map::center_of(tx + 1, ty), None);
            let gi = run.monster_idx(g).unwrap();
            run.monsters[gi].hp = 1000.0;
            if walled {
                run.layout.map.set(tx + 1, ty, crate::dungeon::Tile::Wall);
            }
            assert_eq!(line_of_sight(&run.layout.map, run.players[0].pos(), run.monsters[gi].pos), !walled);
            try_use(&mut run, 0, true, 1);
            assert_eq!(run.monsters[gi].hp < 1000.0, !walled, "Strike, walled: {walled}");
        }
    }
}
