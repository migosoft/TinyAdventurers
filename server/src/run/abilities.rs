//! Player abilities (one executor per AbilityId) and projectile simulation.

use super::entities::{HazardPulse, HazardSide, MonsterDash, Pierce, Projectile};
use super::targets::{self, side, Side};
use super::{Run, TICK_HZ};
use crate::collision::{line_of_sight, move_box};
use crate::dungeon::Mover;
use crate::defs::abilities::{self as ab, AbilityId, Shape, Uses};
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::damage::{overkill_rest, Damage, DamageSplit, Mult, What};
use crate::defs::damage::DamageType;
use crate::defs::effects::{EffectKind, EffectLook, OnHit};
use crate::defs::kinds::{Anim, EntityKind};
use crate::defs::lights::{self, LightKind};
use crate::defs::looks;
use super::effects::{Apply, Creature};
use crate::math::{angle_diff, Vec2};
use crate::protocol::Ev;
use crate::sheet::ResolvedAbility;
use rand::Rng;

/// Cooldowns tick per processed input on both client and server; a small
/// tolerance absorbs rounding differences.
const COOLDOWN_LEEWAY: f64 = 0.05;

/// How many ticks to rewind monsters for a hero's hit checks (the lag compensation); none for a monster user.
fn rewind_ticks(run: &Run, c: Creature) -> usize {
    match c {
        Creature::Player(pi) => ((run.players[pi].view_lag * TICK_HZ).round() as usize).min(super::entities::HISTORY_LEN - 1),
        Creature::Monster(_) => 0,
    }
}

/// Where creature `c` was `rw` ticks ago (only monsters are rewound).
fn pos_ago(run: &Run, c: Creature, rw: usize) -> Vec2 {
    match c {
        Creature::Player(pi) => run.players[pi].pos(),
        Creature::Monster(mi) => run.monsters[mi].pos_ago(rw),
    }
}

/// The direction creature `c` faces (radians).
fn aim_of(run: &Run, c: Creature) -> f64 {
    match c {
        Creature::Player(pi) => run.players[pi].aim,
        Creature::Monster(mi) => run.monsters[mi].aim,
    }
}

/// How far the user aims an aimed ability: a hero's cursor distance, a monster's `monster_use` target.
fn aim_dist_of(run: &Run, c: Creature) -> f64 {
    match c {
        Creature::Player(pi) => run.players[pi].aim_dist,
        Creature::Monster(mi) => run.monsters[mi].aim_dist,
    }
}

/// The figure that uses it: what its abilities look like depends on it (`defs::looks`).
fn figure_of(run: &Run, c: Creature) -> EntityKind {
    match c {
        Creature::Player(pi) => run.players[pi].kind(),
        Creature::Monster(mi) => run.monsters[mi].kind,
    }
}

/// The hero a hit credits (its damage, last hit by, keystones): the user if it is a hero.
fn hero_of(c: Creature) -> Option<usize> {
    match c {
        Creature::Player(pi) => Some(pi),
        Creature::Monster(_) => None,
    }
}

/// The hero a hit pays (XP, damage, kills): the user if it is a hero, the ranger of an ally (the wolf).
/// Keystones read the hit's `by`, so only a hero's own hits count for them.
fn credit_of(run: &Run, c: Creature) -> Option<usize> {
    match c {
        Creature::Player(pi) => Some(pi),
        Creature::Monster(mi) => run.monsters[mi].companion.as_ref().and_then(|c| run.player_idx(c.leader)),
    }
}

/// A hit of `by` on `target`: one by a hero or an ally goes through `hurt_monster` with the hero it pays as
/// its source (credit, keystones for a hero's own, crit), anything else through `hurt_creature`. The wolf's
/// bite marks its target for Pack Hunter.
pub fn hurt(run: &mut Run, target: Creature, dmg: Damage, crit: bool, by: Creature) {
    match (target, credit_of(run, by)) {
        (Creature::Monster(mi), Some(pi)) => {
            if hero_of(by).is_none() && dmg.why.what == What::Ability(AbilityId::Bite) {
                super::keystones::bite(&mut run.monsters[mi]);
            }
            run.hurt_monster(mi, dmg, crit, Some(pi));
        }
        _ => run.hurt_creature(target, dmg),
    }
}

/// What a hero's melee strike hits: a monster, or a closed chest (so a chest and a hidden mimic answer alike).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MeleeTarget {
    Monster(usize),
    Object(usize),
}

/// Every monster on the ground that the heroes fight (an enemy, or a creature with a grudge against them; never a
/// calm wild animal) or closed chest within the hero's reach, nearest first. A
/// bodiless creature that the strike's damage `split` passes through is none.
pub fn melee_targets(run: &Run, pi: usize, split: &DamageSplit) -> Vec<MeleeTarget> {
    let rw = rewind_ticks(run, Creature::Player(pi));
    let pos = run.players[pi].pos();
    let reach = run.players[pi].sheet.reach;
    let monsters = run
        .monsters
        .iter()
        .enumerate()
        .filter(|&(i, m)| m.alive && !m.airborne && (m.side == Side::Hostile || m.grudge.heroes) && !run.passes_through(Creature::Monster(i), split))
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
    melee_targets(run, pi, &run.players[pi].sheet.fallback.split).first().copied()
}

/// The melee-rule strike: `strike` hits the nearest of `targets`; a kill carries the rest of its damage on to the next.
fn melee_strike(run: &mut Run, pi: usize, targets: &[MeleeTarget], strike: &ResolvedAbility, crit: bool) {
    let pos = run.players[pi].pos();
    let aim = run.players[pi].aim;
    let mut dmg = weapon_damage(run, Creature::Player(pi), strike);
    for &t in targets {
        match t {
            MeleeTarget::Monster(mi) => {
                let m = &run.monsters[mi];
                let rest = overkill_rest(dmg.amount, &dmg.split, m.hp, &m.effects.res(m.res));
                run.hurt_monster(mi, dmg.clone(), crit, Some(pi));
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

/// How far (px) from the point a gaze is aimed at a creature's edge may be: it stares at who stands there.
const GAZE_AIM_SLACK: f64 = 2.0;

/// The radius (px) of the burst the Ring of Fire shows where its user stands.
const RING_BURST_RADIUS: f64 = 30.0;

/// The projectile of a shooting ability.
fn kind_of(projectile: Option<EntityKind>) -> EntityKind {
    projectile.expect("a shot has a projectile")
}

/// The damage of one hit of `a`: its split, on-hit and power.
fn damage_of(user: u32, a: &ResolvedAbility) -> Damage {
    hit_damage(user, a, false)
}

/// `damage_of`, with the ability's own effects on the hit too if it `carries_own` (a shot does).
fn hit_damage(user: u32, a: &ResolvedAbility, carries_own: bool) -> Damage {
    Damage { on_hit: a.hit_effects(carries_own), ..Damage::new(a.damage, a.split).with_power(a.power) }.by(user, What::Ability(a.id)).with_base(a.base)
}

/// The damage of one hit of the weapon attack `a` (or of an ability that uses none: `damage_of`).
/// While the user is coated (Poison Coat) every weapon attack adds a poison share and applies
/// Poisoned after its weapon's own on-hit.
fn weapon_damage(run: &Run, c: Creature, a: &ResolvedAbility) -> Damage {
    weapon_hit_damage(run, c, a, false)
}

/// `weapon_damage`, with the ability's own effects on the hit too if it `carries_own`.
fn weapon_hit_damage(run: &Run, c: Creature, a: &ResolvedAbility, carries_own: bool) -> Damage {
    let dmg = hit_damage(run.creature_id(c), a, carries_own);
    if ab::def(a.id).uses == Uses::Nothing || !run.has_effect(c, EffectKind::Coated) {
        return dmg;
    }
    let on_hit = OnHit { kind: EffectKind::Poisoned, secs: ab::COAT_POISON_SECS, magical: false, power: a.power, look: EffectLook::Plain };
    let on_hit = dmg.on_hit.iter().copied().chain([on_hit]).collect();
    Damage { split: a.split.with_shares(&[(DamageType::Poison, ab::COAT_SHARE)]), on_hit, ..dmg }.with_mult(Mult::Coat(ab::COAT_SHARE))
}

/// Uses the hero's primary or secondary ability, with its numbers from the hero's sheet.
pub fn try_use(run: &mut Run, pi: usize, primary: bool, shot: u16) {
    let cd = if primary { run.players[pi].cd1 } else { run.players[pi].cd2 };
    if cd > COOLDOWN_LEEWAY || !run.players[pi].alive {
        return;
    }
    let def = if primary { run.players[pi].sheet.primary.clone() } else { run.players[pi].sheet.secondary.clone() };
    let crit = false;
    let cooldown = def.cooldown;
    if def.ranged {
        let targets = melee_targets(run, pi, &run.players[pi].sheet.fallback.split);
        if !targets.is_empty() {
            super::rules_log::too_close(run, pi, primary, targets[0]);
            if !primary {
                return;
            }
            let fallback = run.players[pi].sheet.fallback.clone();
            melee_strike(run, pi, &targets, &fallback, crit);
            let p = &mut run.players[pi];
            p.cd1 = super::keystones::cooldown(p, fallback.cooldown);
            p.anim = Anim::Melee;
            p.anim_start = run.time;
            let started = p.cd1;
            super::rules_log::cast(run, pi, &fallback, started);
            return;
        }
    }
    if run.players[pi].sheet.disabled[if primary { 0 } else { 1 }].is_some() {
        return;
    }
    let anim = use_ability(run, Creature::Player(pi), &def, shot);
    let p = &mut run.players[pi];
    let cooldown = super::keystones::cooldown(p, cooldown);
    if primary {
        p.cd1 = cooldown;
    } else {
        p.cd2 = cooldown;
    }
    p.anim = anim;
    p.anim_start = run.time;
    super::rules_log::cast(run, pi, &def, cooldown);
}

/// The cooldowns running on one monster, per ability: two monsters of one ability never share one.
#[derive(Debug, Clone, Default)]
pub struct Cooldowns(Vec<(AbilityId, f64)>);

impl Cooldowns {
    pub fn ready(&self, id: AbilityId) -> bool {
        !self.0.iter().any(|&(i, left)| i == id && left > 0.0)
    }
    #[cfg(test)]
    pub fn left(&self, id: AbilityId) -> f64 {
        self.0.iter().find(|&&(i, _)| i == id).map_or(0.0, |&(_, left)| left)
    }
    pub fn start(&mut self, id: AbilityId, secs: f64) {
        self.0.retain(|&(i, _)| i != id);
        self.0.push((id, secs));
    }
    pub fn tick(&mut self, dt: f64) {
        for (_, left) in &mut self.0 {
            *left -= dt;
        }
        self.0.retain(|&(_, left)| left > 0.0);
    }
}

/// Monster `mi` uses ability `id` of its kit at the point `at` (a blast or a ground area lands there, like
/// a hero's cursor). False if it has no such ability, it is on cooldown, or it is a minion ability with no room. The numbers are the kit's:
/// nothing is passed in.
pub fn monster_use(run: &mut Run, mi: usize, id: AbilityId, at: Vec2) -> bool {
    let Some(a) = run.monsters[mi].kit.get(id).cloned() else { return false };
    if id == AbilityId::Vanish {
        // Its cooldown is `invis_cd`, which pauses while Invisible, not the ability cooldowns.
        return run.go_invisible(mi, a.duration, a.cooldown);
    }
    if !run.monsters[mi].cds.ready(id) {
        return false;
    }
    // A cast with no room left raises nothing and spends no cooldown.
    if ab::def(id).own.minions.is_some() && super::minions::room(run, mi, &a) == 0 {
        return false;
    }
    let m = &mut run.monsters[mi];
    m.aim = m.pos.angle_to(at);
    m.aim_dist = m.pos.dist(at);
    m.cds.start(id, a.cooldown);
    let anim = use_ability(run, Creature::Monster(mi), &a, 0);
    // A slam keeps the pose of its wind-up until it lands.
    if id != AbilityId::GroundSlam && run.monsters[mi].anim != anim {
        run.monsters[mi].anim = anim;
        run.monsters[mi].anim_start = run.time;
    }
    true
}

/// Uses ability `a` for user `c`: the executor of its shape does the effect and returns the user's
/// animation. Cooldowns, the ranged-in-melee fallback and keystones are the caller's.
fn use_ability(run: &mut Run, c: Creature, a: &ResolvedAbility, shot: u16) -> Anim {
    if ab::is_attack(&ab::def(a.id)) {
        run.act(c); // an attack ends Invisible; Haste or Purify do not
    }
    match ab::def(a.id).shape {
        Shape::Projectile => use_projectile(run, c, a, shot),
        Shape::Blast => use_blast(run, c, a, shot),
        Shape::Swing => use_swing(run, c, a, shot),
        Shape::Ring => use_ring(run, c, a, shot),
        Shape::Dash => use_dash(run, c, a, shot),
        Shape::SelfArea => use_self_area(run, c, a, shot),
        Shape::GroundArea => use_ground_area(run, c, a, shot),
        Shape::Buff => use_buff(run, c, a, shot),
        Shape::Summon => use_summon(run, c, a, shot),
        Shape::Breath => use_breath(run, c, a, shot),
        Shape::Gaze => use_gaze(run, c, a, shot),
    }
}

/// `use_ability` for a test that hands in a resolved ability it has changed.
#[cfg(test)]
pub(crate) fn use_for_tests(run: &mut Run, c: Creature, a: &ResolvedAbility, shot: u16) -> Anim {
    use_ability(run, c, a, shot)
}

// One function per ability shape: it does the ability's effect and returns the hero's animation.
// An id-specific rule is a `match a.id` listing every id of the shape; the ids of other shapes
// share one arm that names them, so a new id cannot be forgotten.

/// A shot: a spell's or innate ability's own projectile (Magic Missile, Frost Shard, Chain Spark,
/// Judgement, Blinding Curse, Sleep Mist), or the ranged weapon's (Shoot, Hurl; Volley fires three in a fan,
/// Gloom Bolts five). A shot with an own effect carries it.
fn use_projectile(run: &mut Run, c: Creature, a: &ResolvedAbility, shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::Projectile);
    let aim = aim_of(run, c);
    match a.id {
        AbilityId::MagicMissile => {
            spawn_shot(run, c, a, EntityKind::Missile, shot, Vec2::from_angle(aim), None, 0.0);
        }
        AbilityId::FrostShard | AbilityId::Judgement | AbilityId::Shoot | AbilityId::Hurl | AbilityId::ShadowBolt | AbilityId::FireBolt | AbilityId::BlindingCurse | AbilityId::SleepMist | AbilityId::CharmMonster => {
            spawn_shot(run, c, a, kind_of(a.projectile), shot, Vec2::from_angle(aim), None, 0.0);
        }
        // It stops at the first foe; the jumps are made there (`chain_jumps`, `spawn_shot` gives it no pierce).
        AbilityId::ChainSpark => {
            spawn_shot(run, c, a, kind_of(a.projectile), shot, Vec2::from_angle(aim), None, 0.0);
        }
        AbilityId::Volley | AbilityId::GloomBolts => {
            let own = ab::def(a.id).own;
            for (i, off) in ab::shot_offsets(own.count, own.spread).into_iter().enumerate() {
                spawn_shot(run, c, a, kind_of(a.projectile), ab::volley_shot(shot, i as u8), Vec2::from_angle(aim + off), None, 0.0);
            }
        }
        // The demon's ring: `count` orbs spread over the full circle, starting at the aim, and a burst where it stands.
        AbilityId::RingOfFire => {
            let pos = run.creature_pos(c);
            let own = ab::def(a.id).own;
            for (i, off) in ab::shot_offsets(own.count, own.spread).into_iter().enumerate() {
                spawn_shot(run, c, a, kind_of(a.projectile), ab::volley_shot(shot, i as u8), Vec2::from_angle(aim + off), None, 0.0);
            }
            let look = looks::look(figure_of(run, c), a.id);
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: RING_BURST_RADIUS as f32, k: look.boom }, Some(pos));
        }
        AbilityId::Fireball | AbilityId::Strike | AbilityId::HolyLight | AbilityId::Charge | AbilityId::SummonWolf | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::PoisonCoat | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Haste | AbilityId::Purify | AbilityId::Consecrate | AbilityId::Entangle | AbilityId::Bite | AbilityId::Pounce | AbilityId::TailWhip | AbilityId::FireBreath | AbilityId::Smash | AbilityId::Swoop | AbilityId::Nova | AbilityId::StoneGaze | AbilityId::Touch | AbilityId::Vanish | AbilityId::RaiseDead | AbilityId::SummonImps => {
            unreachable!("{:?} is not a projectile", a.id)
        }
    }
    Anim::Shoot
}

/// A shot that bursts where it lands: Fireball, at the aimed distance.
fn use_blast(run: &mut Run, c: Creature, a: &ResolvedAbility, shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::Blast);
    let (pos, aim, aim_dist) = (run.creature_pos(c), aim_of(run, c), aim_dist_of(run, c));
    let dir = Vec2::from_angle(aim);
    match a.id {
        AbilityId::Fireball => {
            let target = pos + dir * aim_dist.clamp(24.0, a.range);
            spawn_shot(run, c, a, EntityKind::Fireball, shot, dir, Some(target), a.radius);
        }
        AbilityId::MagicMissile | AbilityId::Strike | AbilityId::HolyLight | AbilityId::Charge | AbilityId::Shoot | AbilityId::SummonWolf | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::PoisonCoat | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Haste | AbilityId::Purify | AbilityId::Consecrate | AbilityId::Entangle | AbilityId::Bite | AbilityId::ShadowBolt | AbilityId::FireBolt | AbilityId::Pounce | AbilityId::TailWhip | AbilityId::FireBreath | AbilityId::Smash | AbilityId::Swoop | AbilityId::RingOfFire | AbilityId::Nova | AbilityId::GloomBolts | AbilityId::BlindingCurse | AbilityId::SleepMist | AbilityId::CharmMonster | AbilityId::StoneGaze | AbilityId::Touch | AbilityId::Vanish | AbilityId::RaiseDead | AbilityId::SummonImps => {
            unreachable!("{:?} is not a blast", a.id)
        }
    }
    Anim::Cast
}

/// A swing of the melee weapon: Strike, Bite, Touch, Smite (a holy flash where it first hits), Whirl (all around),
/// Flanking Thrust (double from behind) and Tail Whip (aimed behind the user).
fn use_swing(run: &mut Run, c: Creature, a: &ResolvedAbility, _shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::Swing);
    match a.id {
        AbilityId::Strike | AbilityId::Bite | AbilityId::Touch | AbilityId::TailWhip | AbilityId::Whirl | AbilityId::FlankingThrust => {
            melee_arc(run, c, a, false);
        }
        AbilityId::Smite => {
            if let Some(at) = melee_arc(run, c, a, false) {
                let look = looks::look(figure_of(run, c), a.id);
                run.add_tinted_flash(look.light.expect("Smite flashes"), look.tint, at, ab::SMITE_FLASH);
            }
        }
        AbilityId::MagicMissile | AbilityId::Fireball | AbilityId::HolyLight | AbilityId::Charge | AbilityId::Shoot | AbilityId::SummonWolf | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::PoisonCoat | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Haste | AbilityId::Purify | AbilityId::Consecrate | AbilityId::Entangle | AbilityId::ShadowBolt | AbilityId::FireBolt | AbilityId::Pounce | AbilityId::FireBreath | AbilityId::Smash | AbilityId::Swoop | AbilityId::RingOfFire | AbilityId::Nova | AbilityId::GloomBolts | AbilityId::BlindingCurse | AbilityId::SleepMist | AbilityId::CharmMonster | AbilityId::StoneGaze | AbilityId::Vanish | AbilityId::RaiseDead | AbilityId::SummonImps => {
            unreachable!("{:?} is not a swing", a.id)
        }
    }
    Anim::Melee
}

/// An instant effect on the enemies around the user: Frost Nova hurts them (and freezes), War Cry
/// frightens them and hastens the party, Ground Slam starts its wind-up (`land_slam`).
fn use_ring(run: &mut Run, c: Creature, a: &ResolvedAbility, _shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::Ring);
    let pos = run.creature_pos(c);
    match a.id {
        AbilityId::FrostNova => {
            let look = looks::look(figure_of(run, c), a.id);
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: a.radius as f32, k: look.boom }, Some(pos));
            run.add_tinted_flash(look.light.expect("Frost Nova flashes"), look.tint, pos, ab::NOVA_FLASH);
            let rule = targets::Rule { at: pos, reach: a.radius, plus_radius: false, arc: None, los: true, skip_hiding: false, skip_dormant: false, skip_airborne: false, skip_invisible: false, skip_calm: false, passes: Some(a.split) };
            let log = super::rules_log::on(run);
            let (hit, skips) = targets::select(run, &targets::stance(run, c), &rule, &[], log, |t| run.creature_pos(t));
            let by = run.creature_id(c);
            super::rules_log::skipped(run, by, What::Ability(a.id), &skips, None);
            for t in hit {
                hurt(run, t, damage_of(run.creature_id(c), a), false, c);
            }
        }
        AbilityId::WarCry => {
            let look = looks::look(figure_of(run, c), a.id);
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: a.radius as f32, k: look.boom }, Some(pos));
            debug_assert!(!a.effect.is_empty(), "War Cry has its own effects");
            let source = Some((run.creature_id(c), pos));
            let origin = Some((run.creature_id(c), What::Ability(a.id)));
            let rule = targets::Rule { at: pos, reach: a.radius, plus_radius: false, arc: None, los: false, skip_hiding: true, skip_dormant: true, skip_airborne: false, skip_invisible: false, skip_calm: false, passes: None };
            let log = super::rules_log::on(run);
            let (afraid, skips) = targets::select(run, &targets::stance(run, c), &rule, &[], log, |t| run.creature_pos(t));
            super::rules_log::skipped(run, run.creature_id(c), What::Ability(a.id), &skips, None);
            for t in afraid {
                for &own in &a.effect {
                    run.apply(t, Apply { source, origin, ..Apply::from_hit(own) });
                }
            }
            for c in party_around(run, pos, a.radius) {
                run.apply(c, Apply { origin, ..Apply::plain(EffectKind::Accelerated, Some(a.duration)) });
            }
        }
        AbilityId::GroundSlam => match c {
            Creature::Player(pi) => run.players[pi].slam = Some(a.windup),
            Creature::Monster(mi) => run.monsters[mi].slam = Some(a.windup),
        },
        // The dragon's landing: the weapon's blow on everything around, objects too, pushed away from the user.
        AbilityId::Smash => {
            let look = looks::look(figure_of(run, c), a.id);
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: a.radius as f32, k: look.boom }, Some(pos));
            let dmg = weapon_damage(run, c, a);
            let aim = aim_of(run, c);
            for oi in crate::run::objects::objects_in(run, pos, a.radius, None) {
                crate::run::objects::hurt_object(run, oi, dmg.clone(), None);
            }
            let rule = targets::Rule { at: pos, reach: a.radius, plus_radius: false, arc: None, los: false, skip_hiding: false, skip_dormant: false, skip_airborne: true, skip_invisible: false, skip_calm: false, passes: Some(dmg.split) };
            let log = super::rules_log::on(run);
            let (hit, skips) = targets::select(run, &targets::stance(run, c), &rule, &[], log, |t| run.creature_pos(t));
            super::rules_log::skipped(run, run.creature_id(c), What::Ability(a.id), &skips, None);
            for t in hit {
                hurt(run, t, dmg.clone(), false, c);
                run.knock_creature(t, pos, aim, a.push, a.push_str);
            }
        }
        // A burst around the user: it hurts every foe within the radius and the objects too, and pushes the
        // foes straight away with the user's own STR.
        AbilityId::Nova => {
            let look = looks::look(figure_of(run, c), a.id);
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: a.radius as f32, k: look.boom }, Some(pos));
            let dmg = damage_of(run.creature_id(c), a);
            crate::run::objects::hurt_objects_in(run, pos, a.radius, None, dmg.clone());
            let rule = targets::Rule { at: pos, reach: a.radius, plus_radius: false, arc: None, los: false, skip_hiding: false, skip_dormant: false, skip_airborne: false, skip_invisible: false, skip_calm: false, passes: Some(dmg.split) };
            let log = super::rules_log::on(run);
            let (hit, skips) = targets::select(run, &targets::stance(run, c), &rule, &[], log, |t| run.creature_pos(t));
            super::rules_log::skipped(run, run.creature_id(c), What::Ability(a.id), &skips, None);
            for t in hit {
                let away = pos.angle_to(run.creature_pos(t));
                hurt(run, t, dmg.clone(), false, c);
                run.knock_creature(t, pos, away, a.push, a.push_str);
            }
        }
        AbilityId::MagicMissile | AbilityId::Fireball | AbilityId::Strike | AbilityId::HolyLight | AbilityId::Charge | AbilityId::Shoot | AbilityId::SummonWolf | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::PoisonCoat | AbilityId::Haste | AbilityId::Purify | AbilityId::Consecrate | AbilityId::Entangle | AbilityId::Bite | AbilityId::ShadowBolt | AbilityId::FireBolt | AbilityId::Pounce | AbilityId::TailWhip | AbilityId::FireBreath | AbilityId::Swoop | AbilityId::RingOfFire | AbilityId::GloomBolts | AbilityId::BlindingCurse | AbilityId::SleepMist | AbilityId::CharmMonster | AbilityId::StoneGaze | AbilityId::Touch | AbilityId::Vanish | AbilityId::RaiseDead | AbilityId::SummonImps => {
            unreachable!("{:?} is not a ring", a.id)
        }
    }
    Anim::Cast
}

/// A channelled cone: Fire Breath starts its channel on the user; `tick_channel` pulses it. Only a monster
/// channels.
fn use_breath(run: &mut Run, c: Creature, a: &ResolvedAbility, _shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::Breath);
    match a.id {
        AbilityId::FireBreath => {
            let Creature::Monster(mi) = c else { unreachable!("only a monster breathes fire") };
            // The first pulse comes with the first tick.
            run.monsters[mi].channel = Some((a.id, a.duration, 0.0));
        }
        AbilityId::MagicMissile | AbilityId::Fireball | AbilityId::Strike | AbilityId::HolyLight | AbilityId::Charge | AbilityId::Shoot | AbilityId::SummonWolf | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::PoisonCoat | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Haste | AbilityId::Purify | AbilityId::Consecrate | AbilityId::Entangle | AbilityId::Bite | AbilityId::ShadowBolt | AbilityId::FireBolt | AbilityId::Pounce | AbilityId::TailWhip | AbilityId::Smash | AbilityId::Swoop | AbilityId::RingOfFire | AbilityId::Nova | AbilityId::GloomBolts | AbilityId::BlindingCurse | AbilityId::SleepMist | AbilityId::CharmMonster | AbilityId::StoneGaze | AbilityId::Touch | AbilityId::Vanish | AbilityId::RaiseDead | AbilityId::SummonImps => {
            unreachable!("{:?} is not a breath", a.id)
        }
    }
    Anim::Breath
}

/// Counts down monster `mi`'s channel (it ends with its time, its death or sleep). Fire Breath pulses every `BREATH_PULSE` s: its damage on every foe in
/// the cone and every object in it (with a line of sight), and sometimes a burning patch on the ground.
pub fn tick_channel(run: &mut Run, mi: usize, dt: f64) {
    let Some((id, left, pulse)) = run.monsters[mi].channel else { return };
    let (left, pulse) = (left - dt, pulse - dt);
    if left <= 0.0 || !run.monsters[mi].alive || run.monsters[mi].effects.no_act() {
        run.monsters[mi].channel = None;
        return;
    }
    if pulse > 0.0 {
        run.monsters[mi].channel = Some((id, left, pulse));
        return;
    }
    run.monsters[mi].channel = Some((id, left, ab::BREATH_PULSE));
    let a = run.monsters[mi].kit.get(id).expect("a monster that channels has the ability in its kit").clone();
    let c = Creature::Monster(mi);
    let (pos, aim) = (run.monsters[mi].pos, run.monsters[mi].aim);
    let half = a.arc / 2.0;
    let dmg = damage_of(run.monsters[mi].id, &a);
    let rule = targets::Rule { at: pos, reach: a.range, plus_radius: false, arc: Some(targets::Arc { aim, width: a.arc, user_radius: 0.0 }), los: true, skip_hiding: false, skip_dormant: false, skip_airborne: false, skip_invisible: false, skip_calm: false, passes: Some(dmg.split) };
    let log = super::rules_log::on(run);
    let (hit, skips) = targets::select(run, &targets::stance(run, c), &rule, &[], log, |t| run.creature_pos(t));
    super::rules_log::skipped(run, run.creature_id(c), What::Ability(a.id), &skips, None);
    for t in hit {
        hurt(run, t, dmg.clone(), false, c);
    }
    for oi in crate::run::objects::objects_in(run, pos, a.range, Some((aim, half))) {
        if line_of_sight(&run.layout.map, pos, run.objects[oi].pos) {
            crate::run::objects::hurt_object(run, oi, dmg.clone(), None);
        }
    }
    if run.rng.gen_bool(ab::BREATH_PATCH_CHANCE) {
        let at = pos + Vec2::from_angle(aim + run.rng.gen_range(-half..half)) * run.rng.gen_range(ab::BREATH_PATCH_NEAREST..a.range);
        if !run.layout.map.opaque_at(at) {
            super::spawn_fire_patch(run, at, ab::BREATH_PATCH_RADIUS, ab::BREATH_PATCH_SECS, ab::BREATH_PATCH_DAMAGE);
        }
    }
}

/// Every living hero and ally (the wolf) within `radius` of `pos`, the user included.
fn party_around(run: &Run, pos: Vec2, radius: f64) -> Vec<Creature> {
    let heroes = run.players.iter().enumerate().filter(|(_, q)| q.alive && q.pos().dist(pos) <= radius).map(|(qi, _)| Creature::Player(qi));
    let allies = run.monsters.iter().enumerate().filter(|(_, m)| m.side == Side::Friendly && m.alive && m.pos.dist(pos) <= radius).map(|(mi, _)| Creature::Monster(mi));
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
        land_slam(run, Creature::Player(pi));
    }
}

/// Counts down a monster's Ground Slam wind-up (the AI stands still meanwhile); it lands then.
/// `Run::step` clears it when the monster is pushed, sinks, sleeps or flees.
pub fn tick_monster_slam(run: &mut Run, mi: usize, dt: f64) {
    let Some(left) = run.monsters[mi].slam else { return };
    let left = left - dt;
    if left > 1e-9 {
        run.monsters[mi].slam = Some(left);
    } else {
        land_slam(run, Creature::Monster(mi));
    }
}

/// Ground Slam lands: the weapon's damage on every enemy within its radius, pushed away from the user.
pub fn land_slam(run: &mut Run, c: Creature) {
    let a = match c {
        Creature::Player(pi) => {
            run.players[pi].slam = None;
            run.players[pi].sheet.secondary.clone()
        }
        Creature::Monster(mi) => {
            run.monsters[mi].slam = None;
            run.monsters[mi].kit.get(AbilityId::GroundSlam).expect("a monster that slams has Ground Slam in its kit").clone()
        }
    };
    debug_assert!(a.id == AbilityId::GroundSlam);
    let (pos, aim) = (run.creature_pos(c), aim_of(run, c));
    let look = looks::look(figure_of(run, c), a.id);
    run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: a.radius as f32, k: look.boom }, Some(pos));
    let dmg = weapon_damage(run, c, &a);
    let rule = targets::Rule { at: pos, reach: a.radius, plus_radius: false, arc: None, los: true, skip_hiding: false, skip_dormant: false, skip_airborne: true, skip_invisible: false, skip_calm: false, passes: Some(dmg.split) };
    let log = super::rules_log::on(run);
    let (hit, skips) = targets::select(run, &targets::stance(run, c), &rule, &[], log, |t| run.creature_pos(t));
    super::rules_log::skipped(run, run.creature_id(c), What::Ability(a.id), &skips, None);
    for t in hit {
        hurt(run, t, dmg.clone(), false, c);
        run.knock_creature(t, pos, aim, a.push, a.push_str);
    }
}

/// How long (s) a monster's dash `a` lasts when aimed `aim_dist` px away: its own duration, else the time
/// to cross that distance and a little more, so it reaches its mark, but never farther than its range.
pub fn monster_dash_secs(a: &ResolvedAbility, aim_dist: f64) -> f64 {
    if a.duration > 0.0 {
        a.duration
    } else {
        (aim_dist / a.speed + 0.05).min(a.range / a.speed)
    }
}

/// Monster `mi` dashes with its kit's ability `id` to the point `to`, hurting nothing (the wolf's way back
/// from a chasm, and over ground it cannot stand on). It crosses the distance at the ability's speed, but
/// never farther than its range from the body's edge. `uses_it` starts the ability's kit cooldown, as
/// `monster_use` does. False if the kit has no such ability.
pub fn monster_dash_to(run: &mut Run, mi: usize, id: AbilityId, to: Vec2, uses_it: bool) -> bool {
    let Some(a) = run.monsters[mi].kit.get(id).cloned() else { return false };
    let m = &mut run.monsters[mi];
    let d = m.pos.dist(to);
    let dir = if d > 1e-6 { (to - m.pos).norm() } else { Vec2::new(1.0, 0.0) };
    let left = d.min(a.range + m.radius) / a.speed;
    if uses_it {
        m.cds.start(id, a.cooldown);
    }
    m.dash = Some(MonsterDash { id, dir, left, hit: Vec::new(), attack: false });
    true
}

/// A dash that hurts what it touches (`dash_contact`, `tick_monster_dash`): Charge, Pounce, Swoop.
fn use_dash(run: &mut Run, c: Creature, a: &ResolvedAbility, _shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::Dash);
    let dir = Vec2::from_angle(aim_of(run, c));
    match a.id {
        AbilityId::Charge | AbilityId::Pounce | AbilityId::Swoop => match c {
            Creature::Player(pi) => {
                debug_assert!(a.id == AbilityId::Charge, "a hero has no Pounce or Swoop");
                let p = &mut run.players[pi];
                p.mv.dash_t = a.duration;
                p.mv.dash_dx = dir.x;
                p.mv.dash_dy = dir.y;
                p.dash_hit.clear();
            }
            Creature::Monster(mi) => {
                let left = monster_dash_secs(a, run.monsters[mi].aim_dist);
                run.monsters[mi].dash = Some(MonsterDash { id: a.id, dir, left, hit: Vec::new(), attack: true });
            }
        },
        AbilityId::MagicMissile | AbilityId::Fireball | AbilityId::Strike | AbilityId::HolyLight | AbilityId::Shoot | AbilityId::SummonWolf | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::PoisonCoat | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Haste | AbilityId::Purify | AbilityId::Consecrate | AbilityId::Entangle | AbilityId::Bite | AbilityId::ShadowBolt | AbilityId::FireBolt | AbilityId::TailWhip | AbilityId::FireBreath | AbilityId::Smash | AbilityId::RingOfFire | AbilityId::Nova | AbilityId::GloomBolts | AbilityId::BlindingCurse | AbilityId::SleepMist | AbilityId::CharmMonster | AbilityId::StoneGaze | AbilityId::Touch | AbilityId::Vanish | AbilityId::RaiseDead | AbilityId::SummonImps => {
            unreachable!("{:?} is not a dash", a.id)
        }
    }
    Anim::Dash
}

/// A stare: hurts nothing, applies its own effect to the foe standing at the aimed point if the user still
/// sees it. Only a monster gazes (Stone Gaze).
fn use_gaze(run: &mut Run, c: Creature, a: &ResolvedAbility, _shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::Gaze);
    let Creature::Monster(mi) = c else { unreachable!("only a monster gazes") };
    let (pos, sight) = (run.monsters[mi].pos, run.monsters[mi].sight_now());
    let at = pos + Vec2::from_angle(aim_of(run, c)) * aim_dist_of(run, c);
    debug_assert!(!a.effect.is_empty(), "a gaze has its own effects");
    let source = Some((run.creature_id(c), pos));
    let origin = Some((run.creature_id(c), What::Ability(a.id)));
    let rule = targets::Rule { at, reach: GAZE_AIM_SLACK, plus_radius: true, arc: None, los: false, skip_hiding: true, skip_dormant: true, skip_airborne: false, skip_invisible: true, skip_calm: true, passes: None };
    let (stared_at, _) = targets::select(run, &targets::stance(run, c), &rule, &[], false, |t| run.creature_pos(t));
    for t in stared_at {
        if super::perception::sees(run, sight, pos, run.creature_pos(t)) {
            for &own in &a.effect {
                run.apply(t, Apply { source, origin, ..Apply::from_hit(own) });
            }
        }
    }
    Anim::Gaze
}

/// An effect or a heal on the user and the allies around: Holy Light, Haste, Purify.
fn use_self_area(run: &mut Run, c: Creature, a: &ResolvedAbility, _shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::SelfArea);
    let pos = run.creature_pos(c);
    match a.id {
        AbilityId::HolyLight => {
            let look = looks::look(figure_of(run, c), a.id);
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: a.radius as f32, k: look.boom }, Some(pos));
            run.add_tinted_flash(look.light.expect("Holy Light flashes"), look.tint, pos, lights::HOLY_FLASH);
            let mut total = 0.0;
            let by = Some((run.creature_id(c), What::Ability(a.id)));
            for qi in 0..run.players.len() {
                let q = &run.players[qi];
                if q.alive && q.pos().dist(pos) <= a.radius {
                    total += run.heal_player(qi, a.damage, by);
                }
            }
            for mi in 0..run.monsters.len() {
                let m = &run.monsters[mi];
                if m.side == Side::Friendly && m.alive && m.pos.dist(pos) <= a.radius {
                    total += run.heal_monster(mi, a.damage, by);
                }
            }
            if let Some(pi) = hero_of(c) {
                run.players[pi].healing += total;
            }
        }
        AbilityId::Haste => {
            let look = looks::look(figure_of(run, c), a.id);
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: a.radius as f32, k: look.boom }, Some(pos));
            debug_assert!(!a.effect.is_empty(), "Haste has its own effects");
            let origin = Some((run.creature_id(c), What::Ability(a.id)));
            for t in party_around(run, pos, a.radius) {
                for own in &a.effect {
                    run.apply(t, Apply { origin, magical: own.magical, ..Apply::plain(own.kind, Some(own.secs)) });
                }
            }
        }
        AbilityId::Purify => {
            let look = looks::look(figure_of(run, c), a.id);
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: a.radius as f32, k: look.boom }, Some(pos));
            run.add_tinted_flash(look.light.expect("Purify flashes"), look.tint, pos, ab::PURIFY_FLASH);
            debug_assert!(!a.effect.is_empty(), "Purify has its own effects");
            let origin = Some((run.creature_id(c), What::Ability(a.id)));
            for t in party_around(run, pos, a.radius) {
                let held = match t {
                    Creature::Player(i) => run.players[i].effects.present_kinds(),
                    Creature::Monster(i) => run.monsters[i].effects.present_kinds(),
                };
                for k in held.into_iter().filter(|&k| !crate::defs::effects::def(k).positive) {
                    run.remove_effect_why(t, k, super::rules_log::EndReason::Purify);
                }
                for own in &a.effect {
                    run.apply(t, Apply { origin, magical: own.magical, ..Apply::plain(own.kind, Some(own.secs)) });
                }
            }
        }
        AbilityId::MagicMissile | AbilityId::Fireball | AbilityId::Strike | AbilityId::Charge | AbilityId::Shoot | AbilityId::SummonWolf | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::PoisonCoat | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Consecrate | AbilityId::Entangle | AbilityId::Bite | AbilityId::ShadowBolt | AbilityId::FireBolt | AbilityId::Pounce | AbilityId::TailWhip | AbilityId::FireBreath | AbilityId::Smash | AbilityId::Swoop | AbilityId::RingOfFire | AbilityId::Nova | AbilityId::GloomBolts | AbilityId::BlindingCurse | AbilityId::SleepMist | AbilityId::CharmMonster | AbilityId::StoneGaze | AbilityId::Touch | AbilityId::Vanish | AbilityId::RaiseDead | AbilityId::SummonImps => {
            unreachable!("{:?} is not a self area", a.id)
        }
    }
    Anim::Cast
}

/// A hazard of the user's side, placed at the user's feet (Consecrate hurts) or at an aimed spot
/// (Entangle binds).
fn use_ground_area(run: &mut Run, c: Creature, a: &ResolvedAbility, _shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::GroundArea);
    let (id, pos, aim, aim_dist) = (run.creature_id(c), run.creature_pos(c), aim_of(run, c), aim_dist_of(run, c));
    let side = match side(run, c) {
        Side::Friendly => HazardSide::Heroes { owner: id },
        Side::Hostile => HazardSide::Monsters,
        Side::Neutral => unreachable!("a neutral creature acts no ability"),
    };
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
            debug_assert!(!a.effect.is_empty(), "Entangle has its own effects");
            let binds = a.effect.iter().map(|&own| OnHit { secs: ab::ENTANGLE_PULSE_SECS, ..own }).collect();
            run.spawn_hazard(kind_of(a.projectile), at, a.radius, a.duration, side, HazardPulse::Bind(binds));
        }
        AbilityId::MagicMissile | AbilityId::Fireball | AbilityId::Strike | AbilityId::HolyLight | AbilityId::Charge | AbilityId::Shoot | AbilityId::SummonWolf | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::PoisonCoat | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Haste | AbilityId::Purify | AbilityId::Bite | AbilityId::ShadowBolt | AbilityId::FireBolt | AbilityId::Pounce | AbilityId::TailWhip | AbilityId::FireBreath | AbilityId::Smash | AbilityId::Swoop | AbilityId::RingOfFire | AbilityId::Nova | AbilityId::GloomBolts | AbilityId::BlindingCurse | AbilityId::SleepMist | AbilityId::CharmMonster | AbilityId::StoneGaze | AbilityId::Touch | AbilityId::Vanish | AbilityId::RaiseDead | AbilityId::SummonImps => {
            unreachable!("{:?} is not a ground area", a.id)
        }
    }
    Anim::Cast
}

/// An effect on the user only: Poison Coat.
fn use_buff(run: &mut Run, c: Creature, a: &ResolvedAbility, _shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::Buff);
    match a.id {
        AbilityId::PoisonCoat => {
            debug_assert!(!a.effect.is_empty(), "Poison Coat has its own effects");
            for &own in &a.effect {
                run.apply(c, Apply::from_hit(own));
            }
        }
        AbilityId::Vanish => unreachable!("Vanish goes through go_invisible"),
        AbilityId::MagicMissile | AbilityId::Fireball | AbilityId::Strike | AbilityId::HolyLight | AbilityId::Charge | AbilityId::Shoot | AbilityId::SummonWolf | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Haste | AbilityId::Purify | AbilityId::Consecrate | AbilityId::Entangle | AbilityId::Bite | AbilityId::ShadowBolt | AbilityId::FireBolt | AbilityId::Pounce | AbilityId::TailWhip | AbilityId::FireBreath | AbilityId::Smash | AbilityId::Swoop | AbilityId::RingOfFire | AbilityId::Nova | AbilityId::GloomBolts | AbilityId::BlindingCurse | AbilityId::SleepMist | AbilityId::CharmMonster | AbilityId::StoneGaze | AbilityId::Touch | AbilityId::RaiseDead | AbilityId::SummonImps => {
            unreachable!("{:?} is not a buff", a.id)
        }
    }
    Anim::Cast
}

/// Summons or heals the companion: Summon Wolf.
fn use_summon(run: &mut Run, c: Creature, a: &ResolvedAbility, _shot: u16) -> Anim {
    debug_assert!(ab::def(a.id).shape == Shape::Summon);
    match a.id {
        AbilityId::SummonWolf => {
            let Creature::Player(pi) = c else { unreachable!("only a hero summons the wolf") };
            super::wolf::use_ability(run, pi)
        }
        AbilityId::RaiseDead | AbilityId::SummonImps => {
            let Creature::Monster(mi) = c else { unreachable!("only monsters raise minions") };
            super::minions::raise(run, mi, a);
        }
        AbilityId::MagicMissile | AbilityId::Fireball | AbilityId::Strike | AbilityId::HolyLight | AbilityId::Charge | AbilityId::Shoot | AbilityId::FrostShard | AbilityId::ChainSpark | AbilityId::Judgement | AbilityId::Hurl | AbilityId::Volley | AbilityId::Smite | AbilityId::Whirl | AbilityId::FlankingThrust | AbilityId::PoisonCoat | AbilityId::FrostNova | AbilityId::WarCry | AbilityId::GroundSlam | AbilityId::Haste | AbilityId::Purify | AbilityId::Consecrate | AbilityId::Entangle | AbilityId::Bite | AbilityId::ShadowBolt | AbilityId::FireBolt | AbilityId::Pounce | AbilityId::TailWhip | AbilityId::FireBreath | AbilityId::Smash | AbilityId::Swoop | AbilityId::RingOfFire | AbilityId::Nova | AbilityId::GloomBolts | AbilityId::BlindingCurse | AbilityId::SleepMist | AbilityId::CharmMonster | AbilityId::StoneGaze | AbilityId::Touch | AbilityId::Vanish => {
            unreachable!("{:?} is not a summon", a.id)
        }
    }
    Anim::Cast
}

/// A swing of the melee ability `a`, aimed behind the user if it is `backward` (its reach, arc, damage, split, on-hit and power). A hit from
/// behind its target (`a.behind`) does `BEHIND_MULT` times the damage and counts as a crit.
/// Returns where it first hit a monster.
fn melee_arc(run: &mut Run, c: Creature, a: &ResolvedAbility, crit: bool) -> Option<Vec2> {
    let rw = rewind_ticks(run, c);
    let pos = run.creature_pos(c);
    let aim = aim_of(run, c) + if ab::def(a.id).backward { std::f64::consts::PI } else { 0.0 };
    let (range, arc, dmg) = (a.range, a.arc, weapon_damage(run, c, a));
    // Flying monsters are out of reach of melee; a foe touching the user is hit whatever the arc.
    let rule = targets::Rule { at: pos, reach: range, plus_radius: true, arc: Some(targets::Arc { aim, width: arc, user_radius: run.creature_radius(c) }), los: true, skip_hiding: false, skip_dormant: false, skip_airborne: true, skip_invisible: false, skip_calm: false, passes: Some(dmg.split) };
    let log = super::rules_log::on(run);
    let (hits, skips) = targets::select(run, &targets::stance(run, c), &rule, &[], log, |t| pos_ago(run, t, rw));
    super::rules_log::skipped(run, run.creature_id(c), What::Ability(a.id), &skips, None);
    let first = hits.first().map(|&t| run.creature_pos(t));
    for t in hits {
        let behind = a.behind > 0.0 && angle_diff(pos_ago(run, t, rw).angle_to(pos), aim_of(run, t) + std::f64::consts::PI).abs() <= a.behind;
        if behind {
            hurt(run, t, Damage { amount: dmg.amount * ab::BEHIND_MULT, ..dmg.clone() }.with_mult(Mult::Behind(ab::BEHIND_MULT)), true, c);
        } else {
            hurt(run, t, dmg.clone(), crit, c);
        }
        if a.push > 0.0 {
            run.knock_creature(t, pos, aim, a.push, a.push_str);
        }
    }
    let objs: Vec<usize> = (0..run.objects.len())
        .filter(|&i| {
            let o = &run.objects[i];
            let d = o.pos.dist(pos);
            if o.gone || d > range + o.radius {
                return false;
            }
            let in_arc = angle_diff(pos.angle_to(o.pos), aim).abs() <= arc / 2.0 || d < o.radius + run.creature_radius(c);
            in_arc && line_of_sight(&run.layout.map, pos, o.pos)
        })
        .collect();
    let by = hero_of(c).map(|pi| run.players[pi].id);
    for oi in objs {
        crate::run::objects::hurt_object(run, oi, dmg.clone(), by);
    }
    first
}

/// Barbarian Charge: damage each monster touched once per dash, with the secondary's damage, split, on-hit and power.
pub fn dash_contact(run: &mut Run, c: Creature) {
    let Creature::Player(pi) = c else { unreachable!("a monster's dash is ticked by `tick_monster_dash`") };
    let rw = rewind_ticks(run, c);
    let pos = run.players[pi].pos();
    let (aim, ab) = (run.players[pi].aim, run.players[pi].sheet.secondary.clone());
    let dmg = weapon_damage(run, c, &ab);
    let hits: Vec<(usize, u32)> = run
        .monsters
        .iter()
        .enumerate()
        .filter(|(i, m)| m.alive && !m.airborne && targets::heroes_may_hit(m) && !run.players[pi].dash_hit.contains(&m.id) && m.pos_ago(rw).dist(pos) < PLAYER_RADIUS + m.radius + ab.radius && !run.passes_through(Creature::Monster(*i), &dmg.split))
        .map(|(i, m)| (i, m.id))
        .collect();
    for (mi, id) in hits {
        run.players[pi].dash_hit.push(id);
        run.hurt_monster(mi, dmg.clone(), false, Some(pi));
        if ab.push > 0.0 {
            run.knock_creature(Creature::Monster(mi), pos, aim, ab.push, ab.push_str);
        }
    }
    let objs: Vec<(usize, u32)> = run
        .objects
        .iter()
        .enumerate()
        .filter(|(_, o)| !o.gone && !run.players[pi].dash_hit.contains(&o.id) && o.pos.dist(pos) < PLAYER_RADIUS + o.radius + ab.radius)
        .map(|(i, o)| (i, o.id))
        .collect();
    let by = run.players[pi].id;
    for (oi, id) in objs {
        run.players[pi].dash_hit.push(id);
        crate::run::objects::hurt_object(run, oi, dmg.clone(), Some(by));
    }
}

/// One tick of monster `mi`'s dash: it moves through the air (over chasms) and hurts each foe it touches
/// once, with the dash's ability and for the side it fights for. A Pounce ends at the first foe it hurts.
/// Returns the dash when it ended this tick.
pub fn tick_monster_dash(run: &mut Run, mi: usize, dt: f64) -> Option<MonsterDash> {
    let dash = run.monsters[mi].dash.clone()?;
    let a = run.monsters[mi].kit.get(dash.id).expect("a dash is an ability of its kit").clone();
    let solids = run.solids_for(run.monsters[mi].mover, None);
    let m = &run.monsters[mi];
    let v = dash.dir * (a.speed * dt.min(dash.left));
    let (x, y) = move_box(&run.layout.map, m.pos.x, m.pos.y, v.x, v.y, m.radius, Mover::Dash, &solids);
    let m = &mut run.monsters[mi];
    m.pos = Vec2::new(x, y);
    m.aim = dash.dir.y.atan2(dash.dir.x);
    if m.anim != Anim::Dash {
        m.anim = Anim::Dash;
        m.anim_start = run.time;
    }
    let mut dash = MonsterDash { left: dash.left - dt, ..dash };
    let mut done = dash.left <= 1e-9;
    if dash.attack {
        let touched = monster_dash_contact(run, mi, &a, &mut dash.hit);
        done |= touched && dash.id == AbilityId::Pounce;
    }
    if done {
        run.monsters[mi].dash = None;
        Some(dash)
    } else {
        run.monsters[mi].dash = Some(dash);
        None
    }
}

/// The foes monster `mi` touches in its dash (within its body plus `a.radius` of the foe's edge) and has not
/// hurt yet (`hit`): each is hurt with `a`'s damage and pushed away. True if there was one.
fn monster_dash_contact(run: &mut Run, mi: usize, a: &ResolvedAbility, hit: &mut Vec<u32>) -> bool {
    let c = Creature::Monster(mi);
    let (pos, aim) = (run.monsters[mi].pos, run.monsters[mi].aim);
    let dmg = weapon_damage(run, c, a);
    let rule = targets::Rule { at: pos, reach: run.monsters[mi].radius + a.radius, plus_radius: true, arc: None, los: false, skip_hiding: true, skip_dormant: true, skip_airborne: true, skip_invisible: false, skip_calm: false, passes: Some(dmg.split) };
    let (touched, _) = targets::select(run, &targets::stance(run, c), &rule, &[], false, |t| run.creature_pos(t));
    let mut any = false;
    for t in touched {
        let id = run.creature_id(t);
        if hit.contains(&id) {
            continue;
        }
        hit.push(id);
        any = true;
        hurt(run, t, dmg.clone(), false, c);
        if a.push > 0.0 {
            run.knock_creature(t, pos, aim, a.push, a.push_str);
        }
    }
    any
}

/// The radius of a shot that bursts at its target point (Fireball); other shots use their ability's radius.
const SHELL_RADIUS: f64 = 4.0;

/// Fires one shot of ability `a` for user `c` in direction `dir`. Its damage, power, speed, range and push
/// come from `a` and the user, and are stored on the projectile: it outlives its user unchanged.
/// A `target` point makes it burst there, with `explode_r`.
#[allow(clippy::too_many_arguments)]
fn spawn_shot(run: &mut Run, c: Creature, a: &ResolvedAbility, kind: EntityKind, shot: u16, dir: Vec2, target: Option<Vec2>, explode_r: f64) {
    let pos = run.creature_pos(c) + dir * 6.0;
    // Fast-forward a hero's shot by half the round trip: the client already shows it moving.
    let ff = match c {
        Creature::Player(pi) => (run.players[pi].rtt / 2.0).min(0.15),
        Creature::Monster(_) => 0.0,
    };
    let look = looks::look(figure_of(run, c), a.id);
    let kind = look.projectile.unwrap_or(kind);
    let radius = if explode_r > 0.0 { SHELL_RADIUS } else { a.radius };
    // A point it bursts at stops it, so it outlives its range a little.
    let life = a.range / a.speed + if target.is_some() { 0.1 } else { 0.0 };
    // A Chain Spark stops at the first foe; the jumps are made there (`chain_jumps`).
    let pierce = if a.id == AbilityId::ChainSpark { Pierce::Never } else { Pierce::new(a.pierce, a.pierce_through) };
    // A shot carries its weapon's effects and its own (Blinding Curse, Sleep Mist).
    let damage = weapon_hit_damage(run, c, a, true);
    let owner = run.creature_id(c);
    let id = run.alloc_id();
    run.projectiles.push(Projectile {
        id,
        kind,
        owner,
        side: side(run, c),
        shot,
        pos,
        vel: dir * a.speed,
        damage,
        radius,
        life: (life - ff).max(0.05),
        crit: false,
        explode_r,
        explode_k: look.boom,
        push: a.push,
        push_str: a.push_str,
        target,
        dead: false,
        pierce,
        hit: Vec::new(),
    });
    run.attach_kind_light(id, kind);
    // Through the same hit checks as every tick, so it cannot skip a foe on the way.
    let i = run.projectiles.len() - 1;
    advance_projectile(run, i, ff);
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
                    let (dmg, by) = (run.projectiles[i].damage.clone(), (run.projectiles[i].side == Side::Friendly).then_some(run.projectiles[i].owner));
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
        let target = if pr.side == Side::Friendly {
            // A bodiless creature that resists the shot fully is flown through.
            run.monsters
                .iter()
                .enumerate()
                .position(|(mi, m)| m.alive && targets::heroes_may_hit(m) && !pr.hit.contains(&m.id) && m.shot_dist(pos) < m.radius + pr.radius && !run.passes_through(Creature::Monster(mi), &pr.damage.split))
                .map(Creature::Monster)
        } else {
            // Heroes first, then allies.
            let hero = run.players.iter().position(|p| p.alive && !pr.hit.contains(&p.id) && p.pos().dist(pos) < PLAYER_RADIUS + pr.radius).map(Creature::Player);
            let ally = || {
                run.monsters
                    .iter()
                    .position(|m| targets::enemies_may_hit(m) && m.alive && m.sinking.is_none() && !pr.hit.contains(&m.id) && m.shot_dist(pos) < m.radius + pr.radius)
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

/// Projectile `i` hits something at `pos` (a foe of its side, if any).
/// An explosion never pierces. A shot that pierces (`Pierce`) stays alive: through-piercing
/// with full damage, overkill with the rest of its damage after a kill.
fn impact(run: &mut Run, i: usize, pos: Vec2, target: Option<Creature>) {
    let pr = &mut run.projectiles[i];
    pr.dead = true;
    let (side, owner, damage, crit, explode_r, k, push, push_str, pierce) = (pr.side, pr.owner, pr.damage.clone(), pr.crit, pr.explode_r, pr.explode_k, pr.push, pr.push_str, pr.pierce);
    let src = if side == Side::Friendly { run.player_idx(owner) } else { None };
    if explode_r > 0.0 {
        explode(run, pos, explode_r, damage, side, src, k, crit, push, push_str);
        return;
    }
    let Some(c) = target else { return };
    // The rest after a kill, from the target's HP and resistances before the hit.
    let rest = match pierce {
        Pierce::Overkill { left } if left > 0 => overkill_left(run, c, &damage),
        Pierce::Overkill { .. } | Pierce::Never | Pierce::Through { .. } => None,
    };
    // The owner may be gone by now: the shot hurts all the same, with the numbers it was spawned with.
    let by = run.player_idx(owner).map(Creature::Player).or_else(|| run.monster_idx(owner).map(Creature::Monster));
    match (c, side) {
        (Creature::Monster(_), Side::Friendly) | (_, Side::Hostile) => match by {
            Some(by) => hurt(run, c, damage.clone(), crit, by),
            None => run.hurt_creature(c, damage.clone()),
        },
        (Creature::Player(_), Side::Friendly) | (_, Side::Neutral) => {}
    }
    if let (What::Ability(AbilityId::ChainSpark), Creature::Monster(_), Some(by @ Creature::Player(_)), Side::Friendly) = (damage.why.what, c, by, side) {
        chain_jumps(run, by, c, damage);
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
                pr.damage = pr.damage.clone().with_mult(Mult::Overkill { from: id });
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
fn chain_jumps(run: &mut Run, c: Creature, first: Creature, damage: Damage) {
    let mut hit = vec![first];
    let mut last = first;
    let mut amount = damage.amount;
    let user = targets::stance(run, c);
    let log = super::rules_log::on(run);
    let (mut skips, mut stop) = (Vec::new(), None);
    for jump in 1..=ab::CHAIN_JUMPS {
        let from = run.creature_pos(last);
        let rule = targets::Rule { at: from, reach: ab::CHAIN_REACH, plus_radius: false, arc: None, los: true, skip_hiding: true, skip_dormant: true, skip_airborne: false, skip_invisible: true, skip_calm: true, passes: Some(damage.split) };
        let (near, more) = targets::select(run, &user, &rule, &hit, log, |t| run.creature_pos(t));
        // The target the spark stands on is not a candidate to log.
        targets::merge(&mut skips, more.into_iter().filter(|&(t, _)| t != last).collect());
        let next = near.into_iter().min_by(|&a, &b| run.creature_pos(a).dist(from).total_cmp(&run.creature_pos(b).dist(from)));
        let Some(t) = next else {
            if log {
                stop = targets::nearest_beyond(run, &user, &rule, &hit);
            }
            break;
        };
        amount *= ab::CHAIN_FALLOFF;
        let jump = jump as u8;
        let to = run.creature_pos(t);
        run.event(Ev::Zap { x: from.x as f32, y: from.y as f32, x2: to.x as f32, y2: to.y as f32 }, None);
        hurt(run, t, Damage { amount, ..damage.clone() }.with_mult(Mult::Chain { jump, factor: ab::CHAIN_FALLOFF.powi(jump as i32) }), false, c);
        hit.push(t);
        last = t;
    }
    skips.retain(|(t, _)| !hit.contains(t)); // hit on a later jump: no "did not jump" line
    super::rules_log::skipped(run, run.creature_id(c), What::Ability(AbilityId::ChainSpark), &skips, stop);
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
    let (side, owner, damage, crit, explode_r, k, push, push_str) = (pr.side, pr.owner, pr.damage.clone(), pr.crit, pr.explode_r, pr.explode_k, pr.push, pr.push_str);
    if explode_r > 0.0 {
        let src = if side == Side::Friendly { run.player_idx(owner) } else { None };
        explode(run, pos, explode_r, damage, side, src, k, crit, push, push_str);
    } else {
        crate::run::objects::hurt_object(run, oi, damage, (side == Side::Friendly).then_some(owner));
    }
}

#[allow(clippy::too_many_arguments)]
/// An explosion of a shot of `side`; `push` moves the foes it hits straight away from it (px), with STR
/// `push_str` against their weight, whoever shot it. It never moves a boss, an ally of the shooter's side or
/// a mimic still hiding.
pub fn explode(run: &mut Run, pos: Vec2, r: f64, damage: Damage, side: Side, src: Option<usize>, k: u8, crit: bool, push: f64, push_str: i32) {
    let heroes = side == Side::Friendly;
    // The heroes see their own explosions even out of view.
    run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: r as f32, k }, (!heroes).then_some(pos));
    run.add_flash(LightKind::Blast, pos, lights::BLAST_FLASH);
    if heroes {
        let hits: Vec<(usize, bool)> = run
            .monsters
            .iter()
            .enumerate()
            .filter(|(i, m)| m.alive && targets::heroes_may_hit(m) && m.pos.dist(pos) < r + m.radius && line_of_sight(&run.layout.map, pos, m.pos) && !run.passes_through(Creature::Monster(*i), &damage.split))
            .map(|(i, m)| (i, m.hiding))
            .collect();
        for (mi, hiding) in hits {
            run.hurt_monster(mi, damage.clone(), crit, src);
            // A mimic that was still hiding stays where it is (the hit wakes it); a boss is never pushed (`knock_monster`).
            if !hiding {
                run.knock_creature(Creature::Monster(mi), pos, 0.0, push, push_str);
            }
        }
    } else {
        let touched: Vec<Creature> = run.foes_touching(pos, r, true).into_iter().filter(|&c| !run.passes_through(c, &damage.split)).collect();
        for c in touched {
            run.hurt_creature(c, damage.clone());
            run.knock_creature(c, pos, 0.0, push, push_str);
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
        crate::run::objects::hurt_object(run, oi, damage.clone(), by);
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{enemy_use, test_run};
    use super::*;
    use crate::defs::damage::kind_split;
    use crate::defs::enemies::EnemyType;
    use crate::protocol::{BossId, ClassId};

    /// The cooldown of ability `id` for hero `pi` whose written base is `base`: the Attribute step, `base * 10 / Attribute`.
    fn written(run: &Run, pi: usize, id: AbilityId, base: f64) -> f64 {
        base * 10.0 / run.players[pi].sheet.attrs.get(ab::cooldown_attr(ab::def(id).category)) as f64
    }

    fn assert_cd(got: f64, run: &Run, pi: usize, id: AbilityId, base: f64) {
        let want = written(run, pi, id, base);
        assert!((got - want).abs() < 1e-9, "{id:?}: {got} vs {base} x 10 / Attribute = {want}");
    }

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
    fn vanish_goes_invisible_and_waits_while_invisible() {
        use crate::defs::effects::EffectKind;
        use crate::sheet::{monster_kit, Body};
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let mi = put_enemy(&mut run, 0, EnemyType::SkeletonWarrior, 30.0, 10.0);
        let d = crate::defs::enemies::def(EnemyType::SkeletonWarrior);
        run.monsters[mi].kit = monster_kit(&[AbilityId::Strike, AbilityId::Vanish], &run.monsters[mi].attrs, d.weapons, Body { radius: d.radius }, &[]);
        run.monsters[mi].traits.invisibility = true;
        let kit_cd = run.monsters[mi].kit.get(AbilityId::Vanish).expect("Vanish in the kit").cooldown;
        let c = Creature::Monster(mi);
        assert!(monster_use(&mut run, mi, AbilityId::Vanish, Vec2::new(0.0, 0.0)));
        assert!(run.has_effect(c, EffectKind::Invisible));
        assert_eq!(run.monsters[mi].invis_cd, kit_cd);
        assert!(run.monsters[mi].cds.ready(AbilityId::Vanish), "the cooldown is invis_cd, not the cds");
        assert!(!monster_use(&mut run, mi, AbilityId::Vanish, Vec2::new(0.0, 0.0)), "not while invisible");
        // The effect ends; the cooldown pauses until then and runs while visible.
        run.monsters[mi].effects.remove(EffectKind::Invisible);
        assert!(!monster_use(&mut run, mi, AbilityId::Vanish, Vec2::new(0.0, 0.0)), "cooldown still full");
        for _ in 0..((kit_cd + 0.1) / crate::run::DT).round() as usize {
            run.tick_effects();
        }
        assert!(monster_use(&mut run, mi, AbilityId::Vanish, Vec2::new(0.0, 0.0)), "ready again once it has been visible for the cooldown");
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
        assert_cd(run.players[0].cd1, &run, 0, AbilityId::Strike, 0.35);

        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 10.0);
        let hp = run.monsters[mi].hp;
        let res = run.monsters[mi].res.get(DamageType::Physical);
        try_use(&mut run, 0, true, 1);
        assert!((hp - run.monsters[mi].hp - 6.0 * (1.0 - res)).abs() < 1e-9, "the Red Staff at STR 8");
        assert!(run.projectiles.iter().all(|p| p.dead), "the shot is spent");
        assert_cd(run.players[0].cd1, &run, 0, AbilityId::Strike, 1.0);

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
        assert_cd(run.players[0].cd2, &run, 0, AbilityId::Fireball, 6.0);
    }

    #[test]
    fn area_and_self_abilities_still_fire_in_melee() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        put_monster_near(&mut run, 0, 10.0);
        try_use(&mut run, 0, false, 1);
        assert_cd(run.players[0].cd2, &run, 0, AbilityId::HolyLight, 10.0);
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
        run.players[0].sheet.secondary.on_hit = vec![hit];
        let mi = put_monster_near(&mut run, 0, 6.0);
        run.monsters[mi].hp = 1000.0;
        dash_contact(&mut run, Creature::Player(0));
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
            dash_contact(&mut run, Creature::Player(0));
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
        let ab = run.players[0].sheet.secondary.clone();
        assert_eq!(ab.id, AbilityId::Charge);
        assert!(ab.push > 0.0, "the Cleaver pushes");
        let mi = put_monster_near(&mut run, 0, 6.0);
        run.monsters[mi].hp = 1000.0;
        run.monsters[mi].weight = 10.0;
        dash_contact(&mut run, Creature::Player(0));
        let k = run.monsters[mi].knock;
        let want = crate::collision::knock_speed(push_dist(ab.push, ab.push_str, 10.0), crate::run::DT);
        assert!(k.x > 0.0 && k.y.abs() < 1e-9, "east, away from the hero: {k:?}");
        assert!((k.len() - want).abs() < 1e-9, "{} vs {want}", k.len());
        run.monsters[mi].knock = Vec2::ZERO;
        dash_contact(&mut run, Creature::Player(0));
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
    fn a_dash_touches_within_the_ability_radius_of_the_users_edge() {
        // Swoop: body radius + 8 (+ the hero's radius); Pounce: body radius + 4.
        for (id, radius, user_kit) in [
            (AbilityId::Swoop, 8.0, crate::sheet::kit_for(crate::sheet::KitSource::Boss(BossId::Demon), &crate::defs::bosses::attrs(BossId::Demon), &[])),
            (AbilityId::Pounce, 4.0, crate::sheet::kit_for(crate::sheet::KitSource::Wolf(crate::sheet::WolfMods::NONE), &crate::defs::companions::wolf_attrs(), &[])),
        ] {
            assert_eq!(user_kit.get(id).unwrap().radius, radius, "{id:?}");
            for (gap, hits) in [(radius, true), (radius + 1.0, false)] {
                let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
                let bi = run.monsters.iter().position(|m| m.is_boss).unwrap();
                run.monsters[bi].dormant = false;
                run.monsters[bi].kit = user_kit.clone();
                run.players[0].debug = false;
                let (pos, r) = (run.monsters[bi].pos, run.monsters[bi].radius);
                // Edge to edge: the hero's centre sits r + PLAYER_RADIUS + gap from the user's centre.
                run.players[0].mv.x = pos.x + r + PLAYER_RADIUS + gap;
                run.players[0].mv.y = pos.y;
                let hp = run.players[0].hp;
                let mut hit = Vec::new();
                monster_dash_contact(&mut run, bi, &user_kit.get(id).cloned().unwrap(), &mut hit);
                assert_eq!(run.players[0].hp < hp, hits, "{id:?} at a gap of {gap}");
            }
        }
    }

    #[test]
    fn a_monster_dash_never_runs_farther_than_its_range() {
        let kit = crate::sheet::kit_for(crate::sheet::KitSource::Wolf(crate::sheet::WolfMods::NONE), &crate::defs::companions::wolf_attrs(), &[]);
        let pounce = kit.get(AbilityId::Pounce).unwrap().clone();
        assert!(pounce.duration == 0.0 && pounce.range > 0.0);
        let reach = |aim_dist: f64| pounce.speed * monster_dash_secs(&pounce, aim_dist);
        assert!(reach(pounce.range / 2.0) > pounce.range / 2.0, "it still reaches a near mark");
        assert!(reach(pounce.range * 3.0) <= pounce.range + 1e-9, "re-aimed far away it stops at its range: {}", reach(pounce.range * 3.0));
        // An ability with its own duration lasts that long.
        let swoop = crate::sheet::kit_for(crate::sheet::KitSource::Boss(BossId::Demon), &crate::defs::bosses::attrs(BossId::Demon), &[]).get(AbilityId::Swoop).unwrap().clone();
        assert_eq!(monster_dash_secs(&swoop, 1000.0), swoop.duration);
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
        dash_contact(&mut run, Creature::Player(0));
        assert_eq!(run.monsters[mi].hp, hp, "the dash passes under it");
    }

    #[test]
    fn a_calm_animal_in_reach_is_no_melee_target_but_a_grudging_boar_is() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        let pos = run.players[0].pos() + Vec2::new(10.0, 0.0);
        let id = run.spawn_enemy(EnemyType::Bunny, pos, None);
        assert!(run.monster_idx(id).is_some(), "the bunny spawned");
        assert_eq!(melee_target(&run, 0), None, "a calm bunny is no melee target");
        run.players[0].aim = 0.0;
        try_use(&mut run, 0, true, 1);
        assert!(!run.projectiles.is_empty(), "the ranger shoots instead of striking");
        try_use(&mut run, 0, false, 2);
        assert!(run.players[0].cd2 > 0.0, "the secondary is usable");

        let id = run.spawn_enemy(EnemyType::Boar, pos, None);
        let boar = run.monster_idx(id).unwrap();
        run.monsters.retain(|m| m.id == id || m.is_boss);
        let boar = run.monster_idx(id).unwrap_or(boar);
        assert_eq!(melee_target(&run, 0), None, "a calm boar either");
        run.monsters[boar].grudge.heroes = true;
        assert_eq!(melee_target(&run, 0), Some(MeleeTarget::Monster(boar)), "a boar with a grudge is struck");
    }

    #[test]
    fn a_shot_keeps_its_users_numbers_after_the_user_dies() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Dragon);
        run.monsters.retain(|m| m.is_boss);
        let at = run.players[0].pos() + Vec2::new(60.0, 0.0);
        let owner = run.spawn_enemy(EnemyType::Imp, at, None);
        let mi = run.monster_idx(owner).unwrap();
        let bolt = run.monsters[mi].kit.get(AbilityId::FireBolt).unwrap().clone();
        let (power, push_str) = (run.monsters[mi].attrs.get(Attr::Cha), run.monsters[mi].attrs.get(crate::defs::attributes::Attr::Str));
        assert!(power > 0 && push_str > 0 && bolt.damage > 0.0, "numbers worth keeping");
        let target = run.players[0].pos();
        assert!(monster_use(&mut run, mi, AbilityId::FireBolt, target));
        let spawned = &run.projectiles[0];
        assert_eq!((spawned.damage.amount, spawned.damage.power, spawned.push, spawned.push_str), (bolt.damage, power, bolt.push, push_str));
        // The user is gone before the shot lands.
        run.monsters.retain(|m| m.id != owner);
        assert!(run.monster_idx(owner).is_none());
        let hp = run.players[0].hp;
        for _ in 0..240 {
            tick_projectiles(&mut run, 1.0 / TICK_HZ);
        }
        assert!(run.players[0].hp < hp, "it hurt all the same");
        let hit = run.last_hit.clone().expect("the hero was hit");
        assert_eq!((hit.amount, hit.power), (bolt.damage, power), "with the damage and power it was spawned with");
    }

    #[test]
    fn a_pushing_shot_keeps_its_push_and_strength_after_the_user_dies() {
        use crate::defs::attributes::push_dist;
        // The dragon's Fireball pushes with the dragon's STR (24), not the 30 a scripted boss push once had.
        let mut run = test_run(&[ClassId::Paladin], BossId::Dragon);
        run.monsters.retain(|m| m.is_boss);
        run.objects.clear();
        let bi = run.monsters.iter().position(|m| m.is_boss).unwrap();
        let owner = run.monsters[bi].id;
        let hall = run.level.boss().unwrap().arena.center_px();
        let hero = hall + Vec2::new(-60.0, 0.0);
        run.players[0].mv.x = hero.x;
        run.players[0].mv.y = hero.y;
        run.monsters[bi].pos = hall + Vec2::new(30.0, 0.0);
        let (str, ball) = (run.monsters[bi].attrs.get(Attr::Str), run.monsters[bi].kit.get(AbilityId::Fireball).unwrap().clone());
        // A target so heavy that the dragon's STR and STR 30 push it different distances.
        run.players[0].sheet.weight = str as f64 - 2.0;
        let (pushed, boss_push) = (push_dist(ball.push, str, run.players[0].sheet.weight), push_dist(ball.push, 30, run.players[0].sheet.weight));
        assert!(pushed > 0.0 && pushed < boss_push, "{pushed} < {boss_push}");
        // It bursts a little east of the hero, so the push is west.
        assert!(monster_use(&mut run, bi, AbilityId::Fireball, hero + Vec2::new(12.0, 0.0)));
        assert_eq!((run.projectiles[0].push, run.projectiles[0].push_str), (ball.push, str));
        // The user is gone before the shot lands.
        run.monsters.retain(|m| m.id != owner);
        for _ in 0..120 {
            tick_projectiles(&mut run, 1.0 / TICK_HZ);
        }
        assert_eq!(run.players[0].mv.knock_vx, -crate::collision::knock_speed(pushed, super::super::DT), "pushed west by the spawn-time push at the dragon's STR {str}");
    }

    #[test]
    fn targets_of_either_side() {
        let mut run = test_run(&[ClassId::ElvenRanger, ClassId::Paladin], BossId::Demon);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let wolf = crate::run::wolf::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        let spot = run.players[0].pos();
        run.monsters[wi].pos = spot + Vec2::new(10.0, 0.0);
        run.players[1].mv.x = spot.x - 10.0;
        run.players[1].mv.y = spot.y;
        let id = run.spawn_enemy(EnemyType::OrcWarrior, spot + Vec2::new(0.0, 12.0), None);
        let orc = Creature::Monster(run.monster_idx(id).unwrap());
        let rule = targets::Rule { at: spot, reach: 40.0, plus_radius: true, arc: None, los: false, skip_hiding: false, skip_dormant: false, skip_airborne: false, skip_invisible: false, skip_calm: false, passes: None };
        let at = |c: Creature| run.creature_pos(c);

        assert_eq!(side(&run, Creature::Player(0)), Side::Friendly);
        assert_eq!(side(&run, Creature::Monster(wi)), Side::Friendly, "an ally is on the heroes' side");
        assert_eq!(side(&run, orc), Side::Hostile);

        let (foes, _) = targets::select(&run, &targets::Stance::of_side(Side::Friendly), &rule, &[], false, at);
        assert!(foes.contains(&orc), "the heroes' foe is the enemy");
        assert!(foes.iter().all(|&c| side(&run, c) == Side::Hostile), "never a hero or an ally: {foes:?}");

        let (foes, _) = targets::select(&run, &targets::Stance::of_side(Side::Hostile), &rule, &[], false, at);
        assert!(foes.contains(&Creature::Player(0)) && foes.contains(&Creature::Player(1)), "both heroes");
        assert!(foes.contains(&Creature::Monster(wi)), "and the wolf");
        assert!(!foes.contains(&orc) && foes.iter().all(|&c| side(&run, c) == Side::Friendly), "never an enemy: {foes:?}");
    }

    #[test]
    fn an_enemy_explosion_with_knock_pushes_heroes_away() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Dragon);
        let at = run.players[0].pos() - Vec2::new(10.0, 0.0);
        let pusher_str = 30; // above every hero's weight + 4
        explode(&mut run, at, 30.0, Damage::physical(5.0), Side::Hostile, None, 4, false, 20.0, pusher_str);
        assert!(run.players[0].mv.knock_vx > 0.0, "pushed east, away from the blast");
        let mut run = test_run(&[ClassId::Paladin], BossId::Dragon);
        explode(&mut run, at, 30.0, Damage::physical(5.0), Side::Hostile, None, 4, false, 0.0, 0);
        assert!(!run.players[0].mv.knocked(), "no knock: no push");
    }

    #[test]
    fn a_wizards_fireball_pushes_a_light_monster() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let mi = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 40.0, 1000.0);
        let start = run.monsters[mi].pos;
        assert_eq!(run.monsters[mi].weight, 6.0);
        let (p, a) = (&mut run.players[0], 0.0);
        (p.aim, p.aim_dist) = (a, 40.0);
        try_use(&mut run, 0, false, 1);
        for _ in 0..60 {
            tick_projectiles(&mut run, 1.0 / TICK_HZ);
        }
        assert!(run.monsters[mi].hp < 1000.0, "the blast hurts it");
        // STR 8 against weight 6: half of the 20 px.
        let speed = run.monsters[mi].knock.len();
        assert!((speed - crate::collision::knock_speed(10.0, crate::run::DT)).abs() < 1e-9, "pushed 10 px: {speed}");
        assert!(run.monsters[mi].knock.x > 0.0 || run.monsters[mi].pos.x > start.x, "away from the blast");
    }

    #[test]
    fn a_fireball_never_pushes_a_boss_or_a_hiding_mimic() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Dragon);
        let at = run.players[0].pos() + Vec2::new(60.0, 0.0);
        run.monsters.retain(|m| m.is_boss);
        let bi = run.monsters.iter().position(|m| m.is_boss).unwrap();
        run.monsters[bi].pos = at;
        run.monsters[bi].dormant = false;
        let id = run.spawn_enemy(EnemyType::Mimic, at + Vec2::new(10.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        // So light that only the "hiding" rule keeps it still.
        run.monsters[mi].weight = 1.0;
        run.monsters[mi].hiding = true;
        let boom = |run: &mut Run| explode(run, at, 38.0, Damage::physical(5.0), Side::Friendly, Some(0), 0, false, 20.0, 30);
        boom(&mut run);
        assert_eq!(run.monsters[bi].knock, Vec2::ZERO, "a boss is never pushed, even by STR 30");
        assert_eq!(run.monsters[mi].knock, Vec2::ZERO, "a mimic still hiding is not moved");
        run.monsters[mi].hiding = false;
        boom(&mut run);
        assert!(run.monsters[mi].knock != Vec2::ZERO, "awake, the same blast pushes it");
        assert_eq!(run.monsters[bi].knock, Vec2::ZERO);
    }

    #[test]
    fn a_fireball_never_pushes_an_ally_of_its_users_side() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Lich);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let wolf = crate::run::wolf::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
        run.monsters[wi].pos = at + Vec2::new(8.0, 0.0);
        run.monsters[wi].weight = 1.0;
        let hp = run.monsters[wi].hp;
        explode(&mut run, at, 38.0, Damage::physical(5.0), Side::Friendly, Some(0), 0, false, 20.0, 30);
        assert_eq!((run.monsters[wi].knock, run.monsters[wi].hp), (Vec2::ZERO, hp), "the wolf is neither hurt nor pushed");
    }

    /// A player missile placed `dy` px north of the monster's feet, flying east past it.
    fn missile_past(run: &mut Run, mi: usize, dy: f64) {
        let at = run.monsters[mi].pos + Vec2::new(-6.0, -dy);
        assert!(!run.layout.map.opaque_at(at) && !run.layout.map.opaque_at(at + Vec2::new(12.0, 0.0)), "open floor for the test shot");
        let a = ResolvedAbility { damage: 5.0, speed: 230.0, range: 230.0, radius: 3.0, pierce: 0, pierce_through: 0, split: kind_split(EntityKind::Missile), ..run.players[0].sheet.primary.clone() };
        spawn_shot(run, Creature::Player(0), &a, EntityKind::Missile, 1, Vec2::new(1.0, 0.0), None, 0.0);
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
            explode(&mut run, at, 20.0, Damage::new(10.0, kind_split(EntityKind::Fireball)), Side::Friendly, Some(0), 0, false, 0.0, 0);
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
        explode(&mut run, at, 20.0, Damage::physical(5.0), Side::Friendly, Some(0), 0, false, 0.0, 0);
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
        run.players[0].sheet.primary.on_hit = vec![OnHit { kind: EffectKind::Slowed, secs: 2.0, magical: false, power: 10, look: crate::defs::effects::EffectLook::Plain }];
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
        run.players[0].sheet.primary = apply_mods(run.players[0].sheet.primary.clone(), &[AbilityMod::PierceThrough(1)]);
        let dmg = run.players[0].sheet.primary.damage;
        let r = shoot_line(run, EnemyType::OrcWarrior, &[30.0, 40.0, 50.0], &[70.0, 70.0, 70.0]);
        assert_eq!(r, [(true, dmg), (true, dmg), (true, 0.0)]);
    }

    #[test]
    fn an_unlimited_through_mod_passes_every_enemy() {
        use crate::defs::loadout::{apply_mods, AbilityMod};
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        run.players[0].sheet.primary = apply_mods(run.players[0].sheet.primary.clone(), &[AbilityMod::PierceThrough(200), AbilityMod::PierceThrough(200)]);
        assert_eq!(run.players[0].sheet.primary.pierce_through, u8::MAX);
        let dmg = run.players[0].sheet.primary.damage;
        let mut one = test_run(&[ClassId::Wizard], BossId::Demon);
        one.players[0].sheet.primary = run.players[0].sheet.primary.clone();
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
        let hp = run.players[1].hp;
        crate::run::ai::perform_attack(&mut run, oi, Creature::Player(0), false, None);
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
            let orc = run.monsters.last().unwrap().id;
            let hp = run.monsters.last().unwrap().hp;
            if from_player {
                run.players[0].aim = 0.0;
                try_use(&mut run, 0, true, 1);
            } else {
                let from = p + Vec2::new(10.0, 0.0);
                enemy_use(&mut run, EnemyType::GoblinArcher, from, AbilityId::Shoot, from + Vec2::new(100.0, 0.0));
            }
            for _ in 0..30 {
                tick_projectiles(&mut run, 1.0 / TICK_HZ);
            }
            let o = run.objects.iter().find(|o| o.id == id).unwrap();
            assert!(matches!(&o.state, crate::run::objects::ObjState::Barrel(b) if b.fuse.is_some()), "lit (player shot: {from_player})");
            assert_eq!(run.monsters[run.monster_idx(orc).unwrap()].hp, hp, "the orc behind it is spared");
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
        explode(&mut run, at + Vec2::new(10.0, 0.0), 20.0, Damage::physical(5.0), Side::Friendly, Some(0), 0, false, 0.0, 0);
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
        let a = ResolvedAbility { damage: 1.0, speed: 300.0, range: 570.0, pierce: 0, pierce_through: 0, split: kind_split(EntityKind::Fireball), ..run.players[0].sheet.primary.clone() };
        spawn_shot(&mut run, Creature::Player(0), &a, EntityKind::Fireball, 1, Vec2::new(1.0, 0.0), Some(target), 20.0);
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
        let mi = run.monster_idx(id).unwrap();
        if let Some(cha) = cha {
            let now = run.monsters[mi].attrs.get(Attr::Cha);
            run.monsters[mi].attrs.add(Attr::Cha, cha - now);
            // The kit is resolved at spawn: resolve it again with the changed Attribute.
            let d = crate::defs::enemies::def(t);
            run.monsters[mi].kit = crate::sheet::monster_kit(d.abilities, &run.monsters[mi].attrs, d.weapons, crate::sheet::Body { radius: d.radius }, &[]);
        }
        assert!(monster_use(&mut run, mi, AbilityId::FireBolt, p));
        for _ in 0..60 {
            tick_projectiles(&mut run, 1.0 / TICK_HZ);
        }
        burn_left(&run, Creature::Player(0))
    }

    #[test]
    fn a_fire_bolt_burns_at_its_users_governing_attribute() {
        let con = crate::defs::classes::start_attrs(ClassId::Paladin).get(crate::defs::attributes::Attr::Con);
        assert_eq!(con, 13);
        assert_eq!(fire_bolt_burn(EnemyType::Imp, None), Some(burn_secs(14, con)), "the imp's innate fire: CHA 14");
        assert_eq!(fire_bolt_burn(EnemyType::Chort, None), Some(burn_secs(10, con)), "the chort's CHA 9: at least 10");
        assert_eq!(fire_bolt_burn(EnemyType::Summoner, None), Some(burn_secs(16, con)), "the summoner's fire is innate too: CHA 16");
        assert_eq!(fire_bolt_burn(EnemyType::Imp, Some(6)), Some(burn_secs(10, con)), "CHA 6: at least 10");
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
        dash_contact(&mut run, Creature::Player(0));
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
        let bite = run.monsters[wolf].kit.get(AbilityId::Bite).expect("the wolf bites").split;
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
        run.spawn_torch(&TorchSpawn { wall: (tx, ty - 2), side: TorchSide::Face, lit: true });
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
        let strike = ResolvedAbility { range: 20.0, arc: 1.6, damage: 6.0, ..run.players[0].sheet.fallback.clone() };
        melee_arc(&mut run, Creature::Player(0), &strike, false);
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
            let hp = run.players[0].hp;
            crate::run::ai::perform_attack(run, oi, Creature::Player(0), false, None);
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
            let sheet = run.players[0].sheet.clone();
            let a = if primary { sheet.primary } else { sheet.secondary };
            assert_eq!(a.id, id);
            assert_eq!(ab::def(id).shape, shape, "{id:?}");
            try_use(&mut run, 0, primary, 1);
            let p = &run.players[0];
            let got = if primary { p.cd1 } else { p.cd2 };
            // 0 = the weapon's interval, already through the Attribute step on the sheet.
            if cooldown > 0.0 {
                assert_cd(got, &run, 0, id, cooldown);
            } else {
                assert_eq!(got, a.cooldown, "{id:?} cooldown");
            }
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
                let a = if primary { run.players[0].sheet.primary.clone() } else { run.players[0].sheet.secondary.clone() };
                let hero = run.players[0].id;
                let near = a.id == AbilityId::Strike || a.id == AbilityId::Charge;
                let mi = put_enemy(&mut run, 0, EnemyType::GoblinArcher, if near { 10.0 } else { 60.0 }, 1000.0);
                run.players[0].aim = 0.0;
                run.players[0].aim_dist = 60.0;
                run.last_hit = None;
                try_use(&mut run, 0, primary, 1);
                if a.id == AbilityId::Charge {
                    dash_contact(&mut run, Creature::Player(0));
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
        crate::run::ai::perform_attack(&mut run, oi, Creature::Player(0), false, None);
        let hit = run.last_hit.clone().expect("the orc hit the hero");
        assert_eq!((hit.why.by, hit.why.what), (Some(id), What::Ability(AbilityId::Strike)));
        let gid = run.spawn_enemy(EnemyType::GoblinArcher, at + Vec2::new(40.0, 0.0), None);
        let gi = run.monster_idx(gid).unwrap();
        run.last_hit = None;
        crate::run::ai::perform_attack(&mut run, gi, Creature::Player(0), false, None);
        for _ in 0..60 {
            tick_projectiles(&mut run, 1.0 / TICK_HZ);
        }
        let hit = run.last_hit.clone().expect("the arrow hit the hero");
        assert_eq!((hit.why.by, hit.why.what), (Some(gid), What::Ability(AbilityId::Shoot)));
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

    /// The wizard of `wizard_with(FrostShard)` with INT drained by 2, as `refresh_attrs` would leave it
    /// (no effect drains INT yet): Frost Shard needs INT 14 and the wizard has 15.
    fn int_drained_wizard() -> Run {
        let mut run = wizard_with(AbilityId::FrostShard, 0);
        let delta = Attributes::new(0, 0, 0, -2, 0, 0);
        let p = &mut run.players[0];
        p.sheet = crate::sheet::run_sheet(p.class, &p.build, delta, &[]);
        assert!(p.sheet.disabled[0].is_some() && p.sheet.disabled[1].is_none());
        run
    }

    #[test]
    fn a_disabled_primary_is_not_cast() {
        let mut run = int_drained_wizard();
        try_use(&mut run, 0, true, 1);
        assert!(run.projectiles.is_empty(), "no bolt");
        assert_eq!(run.players[0].cd1, 0.0);
    }

    #[test]
    fn a_disabled_ranged_primary_still_falls_back_in_melee() {
        let mut run = int_drained_wizard();
        let mi = put_enemy(&mut run, 0, EnemyType::OrcWarrior, 10.0, 1000.0);
        try_use(&mut run, 0, true, 1);
        assert!(run.monsters[mi].hp < 1000.0, "the fallback Strike hit");
        assert_eq!(run.players[0].cd1, run.players[0].sheet.fallback.cooldown);
    }

    fn lost(run: &Run, mi: usize, before: f64) -> f64 {
        before - run.monsters[mi].hp
    }

    #[test]
    fn frost_shard_chills_and_never_freezes() {
        let mut run = wizard_with(AbilityId::FrostShard, 0);
        let mi = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 60.0, 1000.0);
        let a = run.players[0].sheet.primary.clone();
        assert_eq!(a.id, AbilityId::FrostShard);
        assert_eq!(a.projectile, Some(EntityKind::FrostBolt));
        assert!((a.split.share(DamageType::Cold) - 0.4).abs() < 1e-12);
        assert!((a.split.share(DamageType::Magical) - 0.3).abs() < 1e-12);
        assert!((a.split.share(DamageType::Physical) - 0.3).abs() < 1e-12);
        try_use(&mut run, 0, true, 1);
        assert_eq!(run.projectiles.len(), 1);
        assert_eq!(run.projectiles[0].kind, EntityKind::FrostBolt);
        assert_cd(run.players[0].cd1, &run, 0, AbilityId::FrostShard, 0.5);
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
        let a = run.players[0].sheet.primary.clone();
        assert_eq!(a.id, AbilityId::ChainSpark);
        try_use(&mut run, 0, true, 1);
        assert_eq!(run.projectiles[0].kind, EntityKind::ChainSpark);
        assert_cd(run.players[0].cd1, &run, 0, AbilityId::ChainSpark, 0.8);
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
        let wolf = crate::run::wolf::spawn_wolf(&mut run, 0);
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
    fn chain_spark_skips_invisible_monsters() {
        let mut run = wizard_with(AbilityId::ChainSpark, 3);
        let first = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 60.0, 1000.0);
        let near = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 80.0, 1000.0);
        let far = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 100.0, 1000.0);
        run.monsters[near].effects.add(EffectKind::Invisible, 30.0);
        let (near_hp, far_hp) = (run.monsters[near].hp, run.monsters[far].hp);
        // The rules say why.
        let rule = targets::Rule { at: run.monsters[first].pos, reach: CHAIN_REACH, plus_radius: false, arc: None, los: true, skip_hiding: true, skip_dormant: true, skip_airborne: false, skip_invisible: true, skip_calm: true, passes: None };
        let (chosen, skips) = targets::select(&run, &targets::stance(&run, Creature::Player(0)), &rule, &[], true, |t| run.creature_pos(t));
        assert!(!chosen.contains(&Creature::Monster(near)) && chosen.contains(&Creature::Monster(far)));
        assert!(skips.contains(&(Creature::Monster(near), targets::Skip::Invisible)));
        try_use(&mut run, 0, true, 1);
        fly(&mut run);
        assert!(run.monsters[first].hp < 1000.0, "the first target is hit");
        assert_eq!(run.monsters[near].hp, near_hp, "the invisible one is passed over");
        assert!(run.monsters[far].hp < far_hp, "the spark jumps on to the next");
        assert!(run.has_effect(Creature::Monster(near), EffectKind::Invisible), "and it stays invisible");
    }

    #[test]
    fn chain_spark_never_returns() {
        let mut run = wizard_with(AbilityId::ChainSpark, 3);
        let g = goblins(&mut run, &[60.0, 90.0]);
        let a = run.players[0].sheet.primary.clone();
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
        let a = run.players[0].sheet.primary.clone();
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
        let bow = run.players[0].sheet.ranged.clone().unwrap();
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
        assert_cd(run.players[0].cd1, &run, 0, AbilityId::Volley, bow.cooldown * 1.4);
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
        let a = run.players[0].sheet.primary.clone();
        assert_eq!(a.id, AbilityId::Smite);
        let sword = run.players[0].sheet.melee.clone();
        assert!((a.damage - 20.0 * 1.4).abs() < 1e-9 && (sword.damage - 20.0).abs() < 1e-9);
        assert!((a.split.share(DamageType::Magical) - 0.3).abs() < 1e-12);
        assert!((a.split.share(DamageType::Physical) - 0.7).abs() < 1e-12);
        let mi = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 20.0, 1000.0);
        let at = run.monsters[mi].pos;
        try_use(&mut run, 0, true, 1);
        assert_cd(run.players[0].cd1, &run, 0, AbilityId::Smite, 0.45 * 1.6);
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
        let a = run.players[0].sheet.primary.clone();
        assert_eq!(a.id, AbilityId::Whirl);
        assert!((a.arc - TAU).abs() < 1e-12);
        let axe = run.players[0].sheet.melee.clone();
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
        assert_cd(run.players[0].cd1, &run, 0, AbilityId::Whirl, axe.cooldown * 1.3);
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
        let blade = run.players[0].sheet.melee.clone();
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
        let blade = run.players[0].sheet.melee.clone();
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
        let coat = run.players[0].sheet.secondary.clone();
        assert_eq!(coat.id, AbilityId::PoisonCoat);
        assert_eq!(run.players[0].sheet.primary.id, AbilityId::Shoot);
        let mi = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 80.0, 1000.0);
        let bow = run.players[0].sheet.primary.clone();
        try_use(&mut run, 0, false, 1);
        assert_cd(run.players[0].cd2, &run, 0, AbilityId::PoisonCoat, 16.0);
        let held = run.players[0].effects.list().iter().find(|e| e.kind == EffectKind::Coated).expect("coated");
        assert!((held.left - 6.0).abs() < 1e-9);
        // A bow shot carries the share and the on-hit.
        try_use(&mut run, 0, true, 2);
        let shot = run.projectiles[0].damage.clone();
        assert!((shot.split.share(DamageType::Poison) - COAT_SHARE).abs() < 1e-12);
        assert!((shot.split.share(DamageType::Physical) - (1.0 - COAT_SHARE)).abs() < 1e-12);
        let on_hit = shot.on_hit.last().copied().expect("the coat's on-hit, after the weapon's");
        assert_eq!((on_hit.kind, on_hit.secs, on_hit.magical, on_hit.power), (EffectKind::Poisoned, COAT_POISON_SECS, false, bow.power));
        fly(&mut run);
        let m = Creature::Monster(mi);
        assert!(run.has_effect(m, EffectKind::Poisoned) && !run.has_effect(m, EffectKind::Tainted), "Poisoned replaces the Tainted its share alone would give");
        // The coat itself is no weapon attack: a Technique with no weapon adds nothing to itself.
        assert_eq!(weapon_damage(&run, Creature::Player(0), &coat), damage_of(run.players[0].id, &coat), "a coated hero's Technique gets no coat");
        // After 6 s the bow is plain again.
        for _ in 0..361 {
            run.tick_effects();
        }
        assert!(!run.players[0].effects.has(EffectKind::Coated));
        run.players[0].cd1 = 0.0;
        try_use(&mut run, 0, true, 3);
        let plain = run.projectiles.last().unwrap().damage.clone();
        assert_eq!(plain.split, bow.split);
        assert_eq!(plain.on_hit, bow.on_hit);
    }

    #[test]
    fn the_coat_adds_to_a_weapon_on_hit_while_it_lasts() {
        let slowed = OnHit { kind: EffectKind::Slowed, secs: 3.0, magical: false, power: 10, look: crate::defs::effects::EffectLook::Plain };
        let strike = |coated: bool| {
            let mut run = run_with_ability(ClassId::Barbarian, AbilitySlot::Primary, AbilityId::Strike, Attributes::default(), Equipment::starter(ClassId::Barbarian));
            run.players[0].sheet.primary.on_hit = vec![slowed];
            if coated {
                run.apply_effect(Creature::Player(0), EffectKind::Coated, Some(6.0));
            }
            let mi = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 20.0, 1000.0);
            try_use(&mut run, 0, true, 1);
            let m = Creature::Monster(mi);
            (run.has_effect(m, EffectKind::Poisoned), run.has_effect(m, EffectKind::Slowed))
        };
        assert_eq!(strike(true), (true, true), "the coat adds its poison to the weapon's effect");
        assert_eq!(strike(false), (false, true), "uncoated, the weapon's effect alone");
    }

    fn eff(kind: EffectKind) -> OnHit {
        OnHit { kind, secs: 3.0, magical: false, power: 10, look: crate::defs::effects::EffectLook::Plain }
    }

    #[test]
    fn a_shot_carries_its_weapon_and_own_effects() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.players[0].sheet.primary.on_hit = vec![eff(EffectKind::Slowed)];
        run.players[0].sheet.primary.effect = vec![eff(EffectKind::Blind)];
        try_use(&mut run, 0, true, 1);
        let kinds: Vec<_> = run.projectiles[0].damage.on_hit.iter().map(|h| h.kind).collect();
        assert_eq!(kinds, vec![EffectKind::Slowed, EffectKind::Blind]);
    }

    #[test]
    fn one_hit_orders_weapon_own_mod_then_coat() {
        use crate::defs::loadout::{apply_mods, AbilityMod};
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        let mut bow = run.players[0].sheet.primary.clone();
        bow.on_hit = vec![eff(EffectKind::Slowed)];
        bow.effect = vec![eff(EffectKind::Blind)];
        run.players[0].sheet.primary = apply_mods(bow, &[AbilityMod::AddOnHit(eff(EffectKind::Weakened))]);
        let order = |run: &Run| run.projectiles.last().unwrap().damage.on_hit.iter().map(|h| h.kind).collect::<Vec<_>>();
        try_use(&mut run, 0, true, 1);
        assert_eq!(order(&run), vec![EffectKind::Slowed, EffectKind::Blind, EffectKind::Weakened]);
        run.apply_effect(Creature::Player(0), EffectKind::Coated, Some(6.0));
        run.players[0].cd1 = 0.0;
        try_use(&mut run, 0, true, 2);
        assert_eq!(order(&run), vec![EffectKind::Slowed, EffectKind::Blind, EffectKind::Weakened, EffectKind::Poisoned]);
    }

    #[test]
    fn an_area_ability_applies_every_own_effect() {
        let mut run = barbarian_war_cry();
        run.players[0].sheet.secondary.effect = vec![eff(EffectKind::Fear), eff(EffectKind::Weakened)];
        let a = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 40.0, 1000.0);
        let b = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 30.0, 1000.0);
        try_use(&mut run, 0, false, 1);
        for mi in [a, b] {
            let m = Creature::Monster(mi);
            assert!(run.has_effect(m, EffectKind::Fear) && run.has_effect(m, EffectKind::Weakened));
        }
    }

    #[test]
    fn entangle_binds_with_every_own_effect() {
        let mut run = entangle_run();
        run.players[0].sheet.secondary.effect = vec![eff(EffectKind::Entangled), eff(EffectKind::Slowed)];
        let g = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 80.0, 1000.0);
        try_use(&mut run, 0, false, 1);
        assert!(matches!(run.hazards[0].pulse, HazardPulse::Bind(ref on) if on.len() == 2 && on.iter().all(|h| h.secs == ab::ENTANGLE_PULSE_SECS)));
        run.tick_hazards(0.3);
        let m = Creature::Monster(g);
        assert!(run.has_effect(m, EffectKind::Entangled) && run.has_effect(m, EffectKind::Slowed));
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
        let a = run.players[0].sheet.secondary.clone();
        assert_eq!(a.id, AbilityId::FrostNova);
        assert_eq!(a.split, DamageSplit::pure(DamageType::Cold));
        let g = goblins(&mut run, &[30.0, 60.0]);
        // Works with an enemy in melee reach: it is not a ranged ability.
        try_use(&mut run, 0, false, 1);
        assert_cd(a.cooldown, &run, 0, AbilityId::FrostNova, 9.0);
        assert_cd(run.players[0].cd2, &run, 0, AbilityId::FrostNova, 9.0);
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
        let wolf = crate::run::wolf::spawn_wolf(&mut run, 0);
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

    fn charm_wizard() -> Run {
        run_with_ability(ClassId::Wizard, AbilitySlot::Secondary, AbilityId::CharmMonster, Attributes::new(0, 0, 0, 3, 0, 8), Equipment::default())
    }

    #[test]
    fn charm_monster_matches_the_spec() {
        use crate::defs::abilities::{AbilityCategory, AbilitySlot as Slot};
        use crate::defs::requirements::Requirement;
        let run = charm_wizard();
        let a = run.players[0].sheet.secondary.clone();
        assert_eq!(a.id, AbilityId::CharmMonster);
        assert_cd(a.cooldown, &run, 0, AbilityId::CharmMonster, 20.0);
        assert!((a.windup - 0.6).abs() < 1e-9);
        assert_eq!(a.projectile, Some(crate::defs::kinds::EntityKind::CharmOrb));
        assert_eq!(a.damage, 0.0);
        let d = ab::def(AbilityId::CharmMonster);
        assert_eq!((d.slot, d.category), (Slot::Secondary, AbilityCategory::Spell));
        assert!(d.magical && d.ranged);
        assert_eq!(d.req, &[Requirement::Attr(Attr::Int, 15), Requirement::Attr(Attr::Cha, 14)]);
        assert_eq!(d.own.effects.len(), 1);
        assert_eq!((d.own.effects[0].kind, d.own.effects[0].power), (EffectKind::Charmed, Attr::Cha));
        assert_eq!(d.classes, &[ClassId::Wizard]);
    }

    #[test]
    fn charm_orb_charms_an_orc() {
        let mut run = charm_wizard();
        let orc = put_enemy(&mut run, 0, EnemyType::OrcWarrior, 60.0, 1000.0);
        let hero_id = run.players[0].id;
        let cha = run.players[0].sheet.attrs.get(Attr::Cha);
        try_use(&mut run, 0, false, 1);
        fly(&mut run);
        let fx = *run.monsters[orc].effects.list().iter().find(|e| e.kind == EffectKind::Charmed).expect("charmed");
        assert_eq!(fx.source, Some(hero_id));
        assert!(fx.magical && fx.dispel == 0.0);
        let want = scaled_secs(8.0, cha, run.monsters[orc].attrs.get(Attr::Wil));
        assert!((fx.left - want).abs() < 1e-9, "{} vs {want}", fx.left);
        assert_eq!(run.monsters[orc].hp, 1000.0, "no damage");
    }

    #[test]
    fn charm_orb_at_an_unarmed_animal_does_not_stop_the_server() {
        let mut run = charm_wizard();
        let deer = put_enemy(&mut run, 0, EnemyType::Deer, 60.0, 1000.0);
        try_use(&mut run, 0, false, 1);
        fly(&mut run);
        assert!(run.has_effect(Creature::Monster(deer), EffectKind::Charmed));
        for _ in 0..30 {
            run.step();
        }
    }

    #[test]
    fn charm_orb_does_not_charm_the_knight() {
        let mut run = charm_wizard();
        let k = put_enemy(&mut run, 0, EnemyType::Knight, 60.0, 1000.0);
        run.monsters[k].side = Side::Neutral;
        try_use(&mut run, 0, false, 1);
        fly(&mut run);
        assert!(!run.has_effect(Creature::Monster(k), EffectKind::Charmed));
        assert_eq!(run.monsters[k].hp, 1000.0);
    }

    fn barbarian_war_cry() -> Run {
        barbarian_secondary(AbilityId::WarCry, Attributes::new(1, 0, 0, 0, 0, 0), ItemId::GreatAxe)
    }

    #[test]
    fn war_cry_frightens_enemies_and_hastens_allies() {
        let mut run = barbarian_war_cry();
        let a = run.players[0].sheet.secondary.clone();
        assert_eq!(a.id, AbilityId::WarCry);
        assert_eq!(run.players[0].sheet.attrs.get(Attr::Str), 16);
        // The wolf beside the hero.
        let goblin = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 40.0, 1000.0);
        let far = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 90.0, 1000.0);
        let wolf = crate::run::wolf::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        run.monsters[wi].pos = run.players[0].pos() + Vec2::new(0.0, 30.0);
        let hero_id = run.players[0].id;
        let hero_pos = run.players[0].pos();
        try_use(&mut run, 0, false, 1);
        assert_cd(run.players[0].cd2, &run, 0, AbilityId::WarCry, 12.0);
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
        let a = run.players[0].sheet.secondary.clone();
        assert_eq!(a.id, AbilityId::GroundSlam);
        let hammer = run.players[0].sheet.melee.clone();
        assert!((a.damage - hammer.damage * 1.2).abs() < 1e-9);
        assert_eq!(a.radius, 34.0);
        let g = goblins(&mut run, &[20.0, 30.0, 90.0]);
        try_use(&mut run, 0, false, 1);
        assert_eq!(run.players[0].slam, Some(SLAM_WINDUP));
        assert_eq!(run.players[0].anim, Anim::Cast);
        assert_cd(run.players[0].cd2, &run, 0, AbilityId::GroundSlam, 6.0);
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
        assert_eq!(run.players[0].sheet.secondary.push, ab::SLAM_PUSH, "resolved from the def's own push");
        let g = goblins(&mut run, &[20.0]);
        try_use(&mut run, 0, false, 1);
        for _ in 0..40 {
            run.step_player(0);
        }
        assert!(run.monsters[g[0]].knock.len() > 0.0, "pushed by the resolved push");
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

    fn entry_magic(run: &Run, c: Creature, kind: EffectKind) -> Option<bool> {
        let fx = match c {
            Creature::Player(i) => run.players[i].effects.list(),
            Creature::Monster(i) => run.monsters[i].effects.list(),
        };
        fx.iter().find(|a| a.kind == kind).map(|a| a.magical)
    }

    #[test]
    fn haste_and_purify_effects_are_magic() {
        let mut run = wizard_secondary(AbilityId::Haste, Attributes::new(0, 0, 0, 5, 2, 0));
        try_use(&mut run, 0, false, 1);
        assert_eq!(entry_magic(&run, Creature::Player(0), EffectKind::Accelerated), Some(true));
        let mut run = run_with_ability(ClassId::Paladin, AbilitySlot::Secondary, AbilityId::Purify, Attributes::new(0, 0, 0, 0, 2, 0), Equipment::starter(ClassId::Paladin));
        try_use(&mut run, 0, false, 1);
        assert_eq!(entry_magic(&run, Creature::Player(0), EffectKind::Warded), Some(true));
    }

    #[test]
    fn war_cry_haste_stays_plain() {
        let mut run = barbarian_war_cry();
        try_use(&mut run, 0, false, 1);
        assert_eq!(entry_magic(&run, Creature::Player(0), EffectKind::Accelerated), Some(false));
    }

    #[test]
    fn haste_keeps_invisible() {
        let mut run = wizard_secondary(AbilityId::Haste, Attributes::new(0, 0, 0, 5, 2, 0));
        run.players[0].effects.add(EffectKind::Invisible, 30.0);
        try_use(&mut run, 0, false, 1);
        assert_cd(run.players[0].cd2, &run, 0, AbilityId::Haste, ab::def(AbilityId::Haste).own.cooldown);
        assert!(run.has_effect(Creature::Player(0), EffectKind::Invisible), "a support ability is no attack");
    }

    #[test]
    fn is_attack_by_def() {
        for id in [AbilityId::Strike, AbilityId::MagicMissile, AbilityId::WarCry] {
            assert!(ab::is_attack(&ab::def(id)), "{id:?}");
        }
        for id in [AbilityId::Haste, AbilityId::Purify, AbilityId::HolyLight, AbilityId::SummonWolf, AbilityId::PoisonCoat] {
            assert!(!ab::is_attack(&ab::def(id)), "{id:?}");
        }
    }

    #[test]
    fn immune_effect_does_not_reveal() {
        let mut run = barbarian_war_cry();
        let goblin = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 40.0, 1000.0);
        run.monsters[goblin].effect_res.set(EffectKind::Fear, 1.0);
        run.monsters[goblin].effects.add(EffectKind::Invisible, 30.0);
        try_use(&mut run, 0, false, 1);
        let (outcome, _, _) = run.apply_traced(Creature::Monster(goblin), Apply::plain(EffectKind::Fear, Some(2.0)));
        assert!(matches!(outcome, crate::run::effects::EffectOutcome::Resisted | crate::run::effects::EffectOutcome::TypeImmune(_)), "{outcome:?}");
        assert!(!run.has_effect(Creature::Monster(goblin), EffectKind::Fear), "it shrugs the shout off");
        assert!(run.has_effect(Creature::Monster(goblin), EffectKind::Invisible), "and stays invisible");
    }

    #[test]
    fn war_cry_frightens_and_reveals_invisible() {
        let mut run = barbarian_war_cry();
        let goblin = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 40.0, 1000.0);
        run.monsters[goblin].effects.add(EffectKind::Invisible, 30.0);
        try_use(&mut run, 0, false, 1);
        assert!(run.has_effect(Creature::Monster(goblin), EffectKind::Fear), "the ring covers it");
        assert!(!run.has_effect(Creature::Monster(goblin), EffectKind::Invisible), "and it is revealed");
    }

    #[test]
    fn fireball_reaches_invisible() {
        use crate::defs::damage::kind_split;
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, at, None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].hp = 1000.0;
        run.monsters[mi].effects.add(EffectKind::Invisible, 30.0);
        explode(&mut run, at, 20.0, Damage::new(10.0, kind_split(EntityKind::Fireball)), Side::Friendly, Some(0), 0, false, 0.0, 0);
        let mi = run.monster_idx(id).unwrap();
        assert!(run.monsters[mi].hp < 1000.0, "hurt");
        assert!(!run.has_effect(Creature::Monster(mi), EffectKind::Invisible), "and revealed");
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
        let wolf = crate::run::wolf::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        run.monsters[wi].pos = here + Vec2::new(0.0, 40.0);
        try_use(&mut run, 0, false, 1);
        assert_cd(run.players[0].cd2, &run, 0, AbilityId::Haste, 14.0);
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
        let a = run.players[0].sheet.secondary.clone();
        assert_eq!(a.id, AbilityId::Purify);
        let me = Creature::Player(0);
        run.apply_effect(me, EffectKind::Burning, Some(5.0));
        run.apply_effect(me, EffectKind::Slowed, Some(5.0));
        run.apply_effect(me, EffectKind::Accelerated, Some(5.0));
        assert!(run.has_effect(me, EffectKind::Burning) && run.has_effect(me, EffectKind::Slowed));
        try_use(&mut run, 0, false, 1);
        assert_cd(run.players[0].cd2, &run, 0, AbilityId::Purify, 15.0);
        assert!(!run.has_effect(me, EffectKind::Burning));
        assert!(!run.has_effect(me, EffectKind::Slowed));
        assert!(run.has_effect(me, EffectKind::Accelerated), "a positive effect stays");
        assert_eq!(left(&run, me, EffectKind::Warded), Some(3.0));
        assert_eq!(booms(&run, 13).len(), 1);
        assert!(!run.apply_effect(me, EffectKind::Sleep, Some(5.0)), "Warded refuses Sleep");
        assert!(!run.has_effect(me, EffectKind::Sleep));
    }

    #[test]
    fn purify_removes_a_paused_magic_effect() {
        let mut run = run_with_ability(ClassId::Paladin, AbilitySlot::Secondary, AbilityId::Purify, Attributes::new(0, 0, 0, 0, 2, 0), Equipment::starter(ClassId::Paladin));
        let me = Creature::Player(0);
        run.players[0].effects.anti_magic = true;
        run.players[0].effects.add_with(EffectKind::Slowed, 10.0, crate::defs::effects::EffectLook::Plain, None, 0, true);
        try_use(&mut run, 0, false, 1);
        run.players[0].effects.anti_magic = false;
        assert!(!run.has_effect(me, EffectKind::Slowed), "it does not come back");
        assert!(run.players[0].effects.list().iter().all(|e| e.kind != EffectKind::Slowed));
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
        let a = run.players[0].sheet.secondary.clone();
        assert_eq!(a.id, AbilityId::Consecrate);
        assert_eq!(a.split, DamageSplit::pure(DamageType::Magical));
        let g = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 20.0, 1000.0);
        let doomed = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 25.0, 1.0);
        let wolf = crate::run::wolf::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        run.monsters[wi].pos = run.players[0].pos() + Vec2::new(0.0, 15.0);
        let (wolf_hp, hero_hp, kills) = (run.monsters[wi].hp, run.players[0].hp, run.players[0].kills);
        try_use(&mut run, 0, false, 1);
        assert_cd(run.players[0].cd2, &run, 0, AbilityId::Consecrate, 12.0);
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
        let a = run.players[0].sheet.secondary.clone();
        assert_eq!(a.id, AbilityId::Entangle);
        let g = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 80.0, 1000.0);
        let far = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 140.0, 1000.0);
        let here = run.players[0].pos();
        try_use(&mut run, 0, false, 1);
        assert_cd(run.players[0].cd2, &run, 0, AbilityId::Entangle, 14.0);
        let h = &run.hazards[0];
        assert_eq!((h.kind, h.radius, h.life), (EntityKind::Roots, 36.0, 4.0));
        assert!((h.pos.x - (here.x + 80.0)).abs() < 1e-9 && (h.pos.y - here.y).abs() < 1e-9);
        assert!(matches!(h.pulse, HazardPulse::Bind(ref on) if on.len() == 1 && on[0].kind == EffectKind::Entangled && on[0].look == EffectLook::Vines && on[0].secs == ab::ENTANGLE_PULSE_SECS));
        run.tick_hazards(0.3);
        let m = Creature::Monster(g);
        assert!(run.has_effect(m, EffectKind::Entangled));
        assert!(run.monsters[g].effects.no_move() && !run.monsters[g].effects.no_act(), "it cannot move but still acts");
        assert!(run.monsters[g].effects.looks().into_iter().any(|(k, l)| k == EffectKind::Entangled && l == EffectLook::Vines));
        assert!(!run.has_effect(Creature::Monster(far), EffectKind::Entangled), "out of the roots");
        // The roots end 3.7 s from now; the last pulse's Entangled (1 s before the save) runs out
        // `scaled_secs` later, and nothing renews it.
        let power = a.effect[0].power;
        let last = scaled_secs(ab::ENTANGLE_PULSE_SECS, power, run.monsters[g].attrs.get(crate::defs::attributes::Attr::Str));
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
        let a = run.players[0].sheet.secondary.clone();
        let power = a.effect[0].power;
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
    fn a_swing_over_an_invisible_monster_hits_it() {
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        let mi = put_enemy(&mut run, 0, EnemyType::GoblinArcher, 20.0, 1000.0);
        run.monsters[mi].effects.add(EffectKind::Invisible, 30.0);
        run.players[0].aim = 0.0;
        try_use(&mut run, 0, true, 0);
        for _ in 0..30 {
            run.step();
        }
        assert!(run.monsters[mi].hp < 1000.0, "the swing hits it");
        assert!(!run.has_effect(Creature::Monster(mi), EffectKind::Invisible), "and reveals it");
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
        let wolf_id = crate::run::wolf::spawn_wolf(run, 0);
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
        land_slam(&mut run, Creature::Player(0));
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

    // ---- Bodiless: attacks pass through a creature that fully resists them ----

    /// Gives monster `mi` the Incorporeal race's resistances and traits.
    fn make_bodiless(run: &mut Run, mi: usize) {
        use crate::defs::races::{profile, Adjust, Race};
        let prof = profile(&[Race::Incorporeal], Adjust::NONE);
        let m = &mut run.monsters[mi];
        m.res = prof.res;
        m.effect_res = prof.effect_res;
        m.traits = prof.traits;
        m.mover = Mover::Incorporeal;
    }

    #[test]
    fn passes_through_rules() {
        use crate::defs::damage::{DamageSplit, DamageType::*};
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 40.0);
        let c = Creature::Monster(mi);
        assert!(!run.passes_through(c, &DamageSplit::physical()), "a plain orc has a body");
        make_bodiless(&mut run, mi);
        assert!(run.passes_through(c, &DamageSplit::physical()));
        assert!(run.passes_through(c, &DamageSplit::pure(Heat)));
        assert!(!run.passes_through(c, &DamageSplit::pure(Magical)), "magic reaches it");
        assert!(!run.passes_through(c, &DamageSplit::split(&[(Magical, 0.5)])), "physical + magical: the magic part hits");
        // A body with full Physical resistance but no trait is hit all the same.
        let other = put_enemy(&mut run, 0, EnemyType::SkeletonWarrior, 80.0, 100.0);
        run.monsters[other].res.set(Physical, 1.0);
        assert!(!run.passes_through(Creature::Monster(other), &DamageSplit::physical()));
        assert!(!run.passes_through(Creature::Player(0), &DamageSplit::physical()), "no hero is bodiless");
    }

    #[test]
    fn passes_through_reads_the_final_resistance() {
        use crate::defs::damage::{DamageSplit, DamageType::*};
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 40.0);
        make_bodiless(&mut run, mi);
        run.monsters[mi].res.set(Physical, 0.5);
        assert!(!run.passes_through(Creature::Monster(mi), &DamageSplit::physical()), "not a full resistance");
        run.monsters[mi].res.set(Physical, 1.7);
        assert!(run.passes_through(Creature::Monster(mi), &DamageSplit::physical()), "capped at 100 %");
    }

    /// A ranger aimed east with a ghost 60 px away; the ghost is invisible and has 100 HP.
    fn ranger_and_ghost() -> (Run, usize) {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        run.objects.clear();
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        for x in tx..tx + 14 {
            run.layout.map.set(x, ty, crate::dungeon::Tile::Floor);
        }
        let gi = put_enemy(&mut run, 0, EnemyType::OrcWarrior, 60.0, 100.0);
        make_bodiless(&mut run, gi);
        run.monsters[gi].effects.add(EffectKind::Invisible, 30.0);
        run.players[0].aim = 0.0;
        (run, gi)
    }

    fn shots_fly(run: &mut Run, ticks: usize) {
        for _ in 0..ticks {
            tick_projectiles(run, 1.0 / TICK_HZ);
        }
    }

    #[test]
    fn arrow_flies_through_bodiless() {
        let (mut run, gi) = ranger_and_ghost();
        try_use(&mut run, 0, true, 1);
        shots_fly(&mut run, 20);
        assert_eq!(run.monsters[gi].hp, 100.0, "no damage");
        assert!(run.monsters[gi].effects.has(EffectKind::Invisible), "not revealed");
        assert!(run.projectiles.iter().any(|p| !p.dead), "the arrow flies on");
        assert!(run.monsters[gi].pos.x < run.projectiles[0].pos.x, "past the ghost");
    }

    #[test]
    fn shot_flies_through_bodiless_to_next() {
        let (mut run, gi) = ranger_and_ghost();
        let si = put_enemy(&mut run, 0, EnemyType::OrcWarrior, 110.0, 1000.0);
        try_use(&mut run, 0, true, 1);
        shots_fly(&mut run, 40);
        assert_eq!(run.monsters[gi].hp, 100.0);
        assert!(run.monsters[si].hp < 1000.0, "the orc behind is hurt");
    }

    #[test]
    fn magic_missile_hits_bodiless() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let gi = put_enemy(&mut run, 0, EnemyType::OrcWarrior, 60.0, 100.0);
        make_bodiless(&mut run, gi);
        run.players[0].aim = 0.0;
        try_use(&mut run, 0, true, 1);
        shots_fly(&mut run, 40);
        assert!(run.monsters[gi].hp < 100.0, "a Magical missile hurts it");
        assert!(run.projectiles.iter().all(|p| p.dead), "and stops");
    }

    #[test]
    fn swing_passes_bodiless() {
        use crate::run::rules_log::record::LineKind;
        let mut run = armed(ClassId::Paladin, EquipSlot::Melee, ItemId::GoldenSword);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let gi = put_enemy(&mut run, 0, EnemyType::OrcWarrior, 12.0, 100.0);
        make_bodiless(&mut run, gi);
        run.log.forced = true;
        run.players[0].aim = 0.0;
        let strike = ResolvedAbility { range: 30.0, arc: 1.6, damage: 6.0, push: 20.0, ..run.players[0].sheet.fallback.clone() };
        let _ = crate::run::rules_log::take(&mut run);
        melee_arc(&mut run, Creature::Player(0), &strike, false);
        let m = &run.monsters[gi];
        assert_eq!((m.hp, m.knock), (100.0, Vec2::ZERO), "no damage, no push");
        assert!(!has_effects(&run, gi));
        let recs = crate::run::rules_log::take(&mut run);
        assert!(recs.iter().all(|r| r.kind != LineKind::Hit), "no hit line");
        assert!(recs.iter().any(|r| r.kind == LineKind::Skip && r.head.contains("it has no body")), "{:?}", recs.iter().map(|r| &r.head).collect::<Vec<_>>());
    }

    #[test]
    fn explosion_passes_bodiless() {
        use crate::defs::damage::{DamageSplit, DamageType};
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let gi = put_enemy(&mut run, 0, EnemyType::OrcWarrior, 40.0, 100.0);
        make_bodiless(&mut run, gi);
        run.monsters[gi].effects.add(EffectKind::Invisible, 30.0);
        let at = run.monsters[gi].pos;
        let heat = Damage::new(20.0, DamageSplit::pure(DamageType::Heat));
        explode(&mut run, at, 30.0, heat, Side::Friendly, Some(0), 0, false, 20.0, 10);
        assert_eq!((run.monsters[gi].hp, run.monsters[gi].knock), (100.0, Vec2::ZERO));
        assert!(run.monsters[gi].effects.has(EffectKind::Invisible), "not revealed");
        let magic = Damage::new(20.0, DamageSplit::pure(DamageType::Magical));
        explode(&mut run, at, 30.0, magic, Side::Friendly, Some(0), 0, false, 0.0, 10);
        assert!(run.monsters[gi].hp < 100.0, "a Magical blast still hits it");
    }

    #[test]
    fn dash_contact_passes_bodiless() {
        // The wolf's Pounce through an incorporeal enemy: nothing happens, and it does not end the leap.
        let kit = crate::sheet::kit_for(crate::sheet::KitSource::Wolf(crate::sheet::WolfMods::NONE), &crate::defs::companions::wolf_attrs(), &[]);
        let pounce = kit.get(AbilityId::Pounce).unwrap().clone();
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let wolf = crate::run::wolf::spawn_wolf(&mut run, 0);
        let wi = run.monster_idx(wolf).unwrap();
        let gi = put_enemy(&mut run, 0, EnemyType::OrcWarrior, 0.0, 100.0);
        make_bodiless(&mut run, gi);
        // The wolf's bite and leap are 20 % Magical, which a ghost does not resist: it must resist that too.
        run.monsters[gi].res.set(DamageType::Magical, 1.0);
        run.monsters[gi].pos = run.monsters[wi].pos;
        let mut hit = Vec::new();
        assert!(!monster_dash_contact(&mut run, wi, &pounce, &mut hit), "nothing touched, so the pounce goes on");
        assert!(hit.is_empty());
        assert_eq!((run.monsters[gi].hp, run.monsters[gi].knock), (100.0, Vec2::ZERO));
    }

    #[test]
    fn hero_dash_passes_bodiless() {
        let mut run = test_run(&[ClassId::Barbarian], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 6.0);
        run.monsters[mi].hp = 1000.0;
        make_bodiless(&mut run, mi);
        dash_contact(&mut run, Creature::Player(0));
        assert_eq!((run.monsters[mi].hp, run.monsters[mi].knock), (1000.0, Vec2::ZERO));
        assert!(run.players[0].dash_hit.is_empty(), "it is not even counted as touched");
    }

    #[test]
    fn a_ranged_hero_shoots_past_a_bodiless_creature_in_reach() {
        // A bow's strike in melee passes through a ghost, so nothing is "too close": the bow fires.
        let (mut run, gi) = ranger_and_ghost();
        run.monsters[gi].pos = run.players[0].pos() + Vec2::new(10.0, 0.0);
        try_use(&mut run, 0, true, 1);
        assert_eq!(run.projectiles.len(), 1, "an arrow, not a thrust");
    }
}

/// Enemies use the shared abilities through `monster_use` (#177).
#[cfg(test)]
mod monster_uses {
    use super::super::ai::tests::{ogre_among, open_floor};
    use super::super::tests::test_run;
    use super::*;
    use crate::defs::enemies::EnemyType;
    use crate::protocol::{BossId, ClassId};

    /// A run on open floor with only the boss left, and the first hero's position.
    fn arena(classes: &[ClassId]) -> (Run, Vec2) {
        let mut run = test_run(classes, BossId::Lich);
        open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let at = run.players[0].pos();
        (run, at)
    }

    #[test]
    fn a_skeleton_strike_hits_every_hero_in_its_arc() {
        let (mut run, at) = arena(&[ClassId::Paladin, ClassId::Wizard]);
        // Two heroes inside the Rusty Sword's arc, a third behind the skeleton.
        run.players[1].mv.x = at.x + 10.0;
        run.players[1].mv.y = at.y - 6.0;
        let id = run.spawn_enemy(EnemyType::SkeletonWarrior, at - Vec2::new(14.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        let hp: Vec<f64> = run.players.iter().map(|p| p.hp).collect();
        assert!(monster_use(&mut run, mi, AbilityId::Strike, at));
        assert!(run.players[0].hp < hp[0] && run.players[1].hp < hp[1], "both heroes lose HP");
        let hit = run.last_hit.clone().expect("a hit");
        assert_eq!((hit.why.by, hit.why.what), (Some(id), What::Ability(AbilityId::Strike)));
    }

    #[test]
    fn a_strike_misses_a_hero_behind_the_skeleton() {
        let (mut run, at) = arena(&[ClassId::Paladin, ClassId::Wizard]);
        run.players[1].mv.x = at.x - 60.0;
        let id = run.spawn_enemy(EnemyType::SkeletonWarrior, at - Vec2::new(14.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        let wizard = run.players[1].hp;
        assert!(monster_use(&mut run, mi, AbilityId::Strike, at));
        assert_eq!(run.players[1].hp, wizard, "out of reach");
    }

    #[test]
    fn a_foe_touching_a_wide_user_is_hit_whatever_the_arc() {
        // The ogre (radius 10) aims east; a hero just behind it touches it, which the hero's own radius alone would not tell.
        let (mut run, at) = arena(&[ClassId::Paladin]);
        let id = run.spawn_enemy(EnemyType::Ogre, at + Vec2::new(13.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        let hp = run.players[0].hp;
        assert!(monster_use(&mut run, mi, AbilityId::Strike, at + Vec2::new(100.0, 0.0)));
        assert!(run.players[0].hp < hp, "touching the ogre: hit from behind");
    }

    #[test]
    fn two_imps_keep_separate_cooldowns() {
        let (mut run, at) = arena(&[ClassId::Paladin]);
        let a = run.spawn_enemy(EnemyType::Imp, at + Vec2::new(60.0, 0.0), None);
        let b = run.spawn_enemy(EnemyType::Imp, at + Vec2::new(60.0, 12.0), None);
        let (ai, bi) = (run.monster_idx(a).unwrap(), run.monster_idx(b).unwrap());
        assert!(monster_use(&mut run, ai, AbilityId::FireBolt, at));
        assert!(!monster_use(&mut run, ai, AbilityId::FireBolt, at), "the first one is cooling down");
        assert!(monster_use(&mut run, bi, AbilityId::FireBolt, at), "the second one is not");
        let cooldown = run.monsters[ai].kit.get(AbilityId::FireBolt).unwrap().cooldown;
        run.monsters[ai].cds.tick(cooldown + 0.01);
        assert!(monster_use(&mut run, ai, AbilityId::FireBolt, at), "ready again after its cooldown");
    }

    #[test]
    fn a_monster_uses_only_what_is_in_its_kit() {
        let (mut run, at) = arena(&[ClassId::Paladin]);
        let id = run.spawn_enemy(EnemyType::SkeletonWarrior, at + Vec2::new(14.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        assert!(!monster_use(&mut run, mi, AbilityId::FireBolt, at));
        assert!(!monster_use(&mut run, mi, AbilityId::Shoot, at));
        assert!(run.projectiles.is_empty());
    }

    #[test]
    fn an_archer_shoots_with_shoot() {
        let (mut run, at) = arena(&[ClassId::Paladin]);
        let id = run.spawn_enemy(EnemyType::SkeletonArcher, at + Vec2::new(60.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        assert!(monster_use(&mut run, mi, AbilityId::Shoot, at));
        let shot = &run.projectiles[0];
        assert_eq!(shot.damage.why.what, What::Ability(AbilityId::Shoot));
        assert_eq!(shot.side, Side::Hostile);
        let range = run.monsters[mi].kit.get(AbilityId::Shoot).unwrap().range;
        let speed = run.monsters[mi].kit.get(AbilityId::Shoot).unwrap().speed;
        assert!((shot.life - range / speed).abs() < 1e-9, "it flies its range, no further");
    }

    #[test]
    fn the_ogre_slams_with_ground_slam() {
        let (mut run, mi) = ogre_among(&[Vec2::new(20.0, 0.0), Vec2::new(-16.0, 8.0)]);
        let slam = run.monsters[mi].kit.get(AbilityId::GroundSlam).unwrap().clone();
        assert_eq!(slam.windup, 1.0, "its own 0.5 s and the club's 0.5 s");
        let hp: Vec<f64> = run.players.iter().map(|p| p.hp).collect();
        run.events.clear();
        let target = run.players[0].pos();
        assert!(monster_use(&mut run, mi, AbilityId::GroundSlam, target));
        assert_eq!(run.monsters[mi].slam, Some(slam.windup));
        tick_monster_slam(&mut run, mi, slam.windup / 2.0);
        assert!(run.players.iter().zip(&hp).all(|(p, &h)| p.hp == h), "nothing lands during the wind-up");
        tick_monster_slam(&mut run, mi, slam.windup);
        assert_eq!(run.monsters[mi].slam, None);
        for (p, h) in run.players.iter().zip(&hp) {
            assert!(p.hp < *h && p.mv.knocked(), "every hero in reach is hurt and pushed");
        }
        assert_eq!(run.last_hit.clone().expect("a hit").why.what, What::Ability(AbilityId::GroundSlam));
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Boom { k: 5, .. })));
    }

    #[test]
    fn a_pushed_ogre_loses_its_slam() {
        let (mut run, mi) = ogre_among(&[Vec2::new(20.0, 0.0), Vec2::new(-16.0, 8.0)]);
        let target = run.players[0].pos();
        assert!(monster_use(&mut run, mi, AbilityId::GroundSlam, target));
        run.monsters[mi].knock = Vec2::new(10.0, 0.0);
        run.step();
        assert_eq!(run.monsters[mi].slam, None);
    }

    #[test]
    fn a_kit_ability_with_no_fitting_weapon_is_a_data_bug() {
        use crate::defs::attributes::Attributes;
        use crate::defs::items::ItemId;
        let attrs = Attributes::default();
        let body = crate::sheet::Body { radius: 5.0 };
        // Bite needs a bite weapon, Shoot a bow.
        for (id, weapon) in [(AbilityId::Bite, ItemId::SkeletonSword), (AbilityId::Shoot, ItemId::SkeletonSword)] {
            let r = std::panic::catch_unwind(|| crate::sheet::monster_kit(&[id], &attrs, &[weapon], body, &[]));
            assert!(r.is_err(), "{id:?} with {weapon:?}");
        }
        assert!(crate::sheet::monster_kit(&[AbilityId::Bite], &attrs, &[ItemId::MimicBite], body, &[]).get(AbilityId::Bite).is_some());
    }

    #[test]
    fn look_never_changes_damage() {
        use crate::sheet::{monster_kit, Body};
        // The Wizard's Fireball and the dragon's, the dragon given the Wizard's Attributes: the same
        // damage, push and push STR, only the projectile drawn (the look) differs.
        let mut run = test_run(&[ClassId::Wizard], BossId::Dragon);
        open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let at = run.players[0].pos();
        run.players[0].aim = 0.0;
        try_use(&mut run, 0, false, 1);
        let hero_ball = run.projectiles.pop().expect("the Wizard's Fireball");
        let attrs = run.players[0].sheet.attrs;
        let bi = run.monsters.iter().position(|m| m.is_boss).unwrap();
        run.monsters[bi].kit = monster_kit(&[AbilityId::Fireball], &attrs, &[], Body { radius: run.monsters[bi].radius }, &[]);
        assert!(monster_use(&mut run, bi, AbilityId::Fireball, at + Vec2::new(60.0, 0.0)));
        let dragon_ball = run.projectiles.pop().expect("the dragon's Fireball");
        assert_eq!(hero_ball.damage.why.what, What::Ability(AbilityId::Fireball));
        assert_eq!((hero_ball.damage.amount, hero_ball.push, hero_ball.push_str), (dragon_ball.damage.amount, dragon_ball.push, dragon_ball.push_str));
        assert_eq!(hero_ball.push_str, attrs.get(crate::defs::attributes::Attr::Str));
        assert_ne!(hero_ball.kind, dragon_ball.kind, "the two balls look different");
    }
}
