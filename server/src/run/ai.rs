//! Enemy AI: perception (sight radius + line of sight), chase/attack,
//! search last known position, return home, and A* pathfinding.

use super::abilities::spawn_monster_projectile;
use super::effects::Creature;
use super::entities::{AiState, Pierce, Target, Windup};
use super::Run;
use crate::collision::{line_of_sight, move_box, terrain_line, walk_line};
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::damage::Damage;
use crate::defs::enemies::{self, AttackStyle, EnemyType};
use crate::defs::kinds::Anim;
use crate::dungeon::{Map, Mover, TILE};
use crate::math::Vec2;
use crate::protocol::Ev;
use crate::defs::races::Sight;
use rand::Rng;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};

/// Nearest living hero the monster can see right now.
pub fn find_visible_hero(run: &Run, from: Vec2, sight: Sight) -> Option<usize> {
    run.players
        .iter()
        .enumerate()
        .filter(|(_, p)| p.alive)
        .filter(|(_, p)| super::perception::sees(run, sight, from, p.pos()))
        .map(|(i, p)| (i, p.pos().dist(from)))
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(i, _)| i)
}

/// Nearest living hero or ally (not sinking) the monster can see right now; a hero wins a tie.
pub fn find_visible_foe(run: &Run, from: Vec2, sight: Sight) -> Option<Creature> {
    let heroes = (0..run.players.len()).filter(|&i| run.players[i].alive).map(Creature::Player);
    let allies = (0..run.monsters.len()).filter(|&i| run.monsters[i].is_ally() && run.monsters[i].alive && run.monsters[i].sinking.is_none()).map(Creature::Monster);
    heroes
        .chain(allies)
        .map(|c| (c, run.creature_pos(c)))
        .filter(|&(_, p)| super::perception::sees(run, sight, from, p))
        .map(|(c, p)| (c, p.dist(from)))
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(c, _)| c)
}

fn set_anim(run: &mut Run, mi: usize, a: Anim) {
    let m = &mut run.monsters[mi];
    if m.anim != a {
        m.anim = a;
        m.anim_start = run.time;
    }
}

/// A monster on ground it cannot walk (blown into lava): it walks straight
/// to the nearest tile it can, ignoring heroes until it is out.
pub fn escape_terrain(run: &mut Run, mi: usize, dt: f64) {
    let (pos, mover, speed) = (run.monsters[mi].pos, run.monsters[mi].mover, run.monsters[mi].speed * run.monsters[mi].effects.speed_mul());
    if speed <= 0.0 {
        return;
    }
    let (tx, ty) = Map::tile_of(pos);
    let mut best: Option<(f64, Vec2)> = None;
    for dy in -3..=3 {
        for dx in -3..=3 {
            let c = Map::center_of(tx + dx, ty + dy);
            if !run.layout.map.blocks(tx + dx, ty + dy, mover) && best.map_or(true, |(d, _)| c.dist(pos) < d) {
                best = Some((c.dist(pos), c));
            }
        }
    }
    if let Some((_, to)) = best {
        let solids = run.solids(None);
        let m = &run.monsters[mi];
        let v = (to - pos).norm() * (speed.max(20.0) * dt).min(to.dist(pos));
        // Out of the lava: the Dash mover lets it cross the blocked tiles it stands on.
        let (x, y) = move_box(&run.layout.map, pos.x, pos.y, v.x, v.y, m.radius, Mover::Dash, &solids);
        run.monsters[mi].pos = Vec2::new(x, y);
        set_anim(run, mi, Anim::Move);
    }
}

/// A frightened monster: no attacks, no wind-up; it walks straight away from the one who
/// frightened it (the source's position is read each tick; once the source is gone, from
/// where it was last seen). Its normal movement, so walls slide it and chasms stop it.
pub fn flee(run: &mut Run, mi: usize, dt: f64) {
    run.monsters[mi].ai.windup = None;
    let Some((source, last)) = run.monsters[mi].effects.fear_from() else { return };
    let now = source.and_then(|id| {
        let alive = |p: &crate::run::entities::Player| p.alive && p.id == id;
        run.players.iter().find(|p| alive(p)).map(|p| p.pos()).or_else(|| run.monsters.iter().find(|o| o.alive && o.id == id).map(|o| o.pos))
    });
    // A source standing on the creature gives no direction: keep the remembered spot.
    let mut from = last;
    if let Some(p) = now.filter(|p| p.dist(run.monsters[mi].pos) >= 1.0) {
        from = p;
        run.monsters[mi].effects.set_fear_from(p);
    }
    let m = &run.monsters[mi];
    let away = m.pos - from;
    let dir = if away.len() < 1.0 {
        // On the spot: turn around once and remember a spot behind, so the next tick keeps going.
        let dir = Vec2::new(-m.aim.cos(), -m.aim.sin());
        let behind = m.pos - dir * 2.0;
        run.monsters[mi].effects.set_fear_from(behind);
        dir
    } else {
        away.norm()
    };
    let m = &run.monsters[mi];
    let pos = m.pos;
    let speed = gait(run, mi, m.speed);
    move_toward(run, mi, pos + dir * 24.0, speed, dt);
    run.monsters[mi].aim = dir.angle();
    set_anim(run, mi, Anim::Move);
}

/// Move a monster toward `to` with wall sliding. Returns true when arrived.
pub fn move_toward(run: &mut Run, mi: usize, to: Vec2, speed: f64, dt: f64) -> bool {
    let m = &run.monsters[mi];
    let d = to - m.pos;
    let dist = d.len();
    if dist < 2.0 {
        return true;
    }
    let speed = speed * m.effects.speed_mul();
    if speed <= 0.0 {
        return false;
    }
    let step = (speed * dt).min(dist);
    let v = d.norm() * step;
    let solids = run.solids(None);
    let (x, y) = move_box(&run.layout.map, m.pos.x, m.pos.y, v.x, v.y, m.radius, m.mover, &solids);
    let m = &mut run.monsters[mi];
    m.pos = Vec2::new(x, y);
    false
}

/// Follow an A* path to `goal`, recomputing it periodically. Figures wider
/// than a tile (the demon, the dragon) prefer paths a tile clear of walls and
/// terrain, so they rarely wedge into a pit corner, and skip a waypoint they
/// cannot get any closer to. A boss that finds no path walks straight at the
/// goal instead of giving up.
pub fn path_toward(run: &mut Run, mi: usize, goal: Vec2, speed: f64, dt: f64) -> bool {
    let (pos, need_repath) = {
        let m = &mut run.monsters[mi];
        m.ai.repath_t -= dt;
        (m.pos, m.ai.path.is_empty() || m.ai.repath_t <= 0.0)
    };
    if pos.dist(goal) < 4.0 {
        return true;
    }
    let (mover, radius, is_boss) = (run.monsters[mi].mover, run.monsters[mi].radius, run.monsters[mi].is_boss);
    let wide = radius > TILE / 2.0;
    let side = (goal - pos).norm().perp() * radius;
    let map = &run.layout.map;
    if walk_line(map, pos, goal, mover) && object_free_line(run, pos, goal, radius) && (!wide || terrain_line(map, pos + side, goal + side, mover) && terrain_line(map, pos - side, goal - side, mover)) {
        run.monsters[mi].ai.path.clear();
        return move_toward(run, mi, goal, speed, dt);
    }
    if need_repath {
        let blocked = run.object_tiles();
        let path = astar_clear(&run.layout.map, pos, goal, 2500, mover, wide, &blocked).unwrap_or_default();
        let m = &mut run.monsters[mi];
        m.ai.path = path;
        m.ai.repath_t = 0.6;
        if m.ai.path.is_empty() {
            if is_boss {
                return move_toward(run, mi, goal, speed, dt);
            }
            return true; // unreachable: give up
        }
    }
    let Some(&next) = run.monsters[mi].ai.path.first() else { return true };
    let before = run.monsters[mi].pos;
    let arrived = move_toward(run, mi, next, speed, dt);
    let stuck = wide && run.monsters[mi].pos.dist(before) < speed * dt * 0.25;
    if arrived || stuck {
        run.monsters[mi].ai.path.remove(0);
    }
    false
}

/// No solid object (a barrel) within a body's reach of the straight line.
fn object_free_line(run: &Run, a: Vec2, b: Vec2, radius: f64) -> bool {
    let d = b - a;
    let l2 = d.dist2(Vec2::new(0.0, 0.0)).max(1e-9);
    run.objects.iter().filter(|o| o.blocks()).all(|o| {
        let t = (((o.pos.x - a.x) * d.x + (o.pos.y - a.y) * d.y) / l2).clamp(0.0, 1.0);
        (a + d * t).dist(o.pos) >= radius + o.radius + 6.0
    })
}

pub fn tick_monster(run: &mut Run, mi: usize, dt: f64) {
    let Some(etype) = run.monsters[mi].etype else { return };
    if run.monsters[mi].dormant || run.monsters[mi].hiding {
        return;
    }
    if run.monsters[mi].ai.hold > 0.0 {
        run.monsters[mi].ai.hold -= dt;
        return;
    }
    let def = enemies::def(etype);
    let (pos, sight) = (run.monsters[mi].pos, run.monsters[mi].sight_now());
    {
        let ai = &mut run.monsters[mi].ai;
        ai.cd -= dt;
        ai.alt_cd -= dt;
        ai.raise_cd -= dt;
    }

    // Perception: only players in sight radius with line of sight count.
    let seen = find_visible_foe(run, pos, sight);
    if let Some(foe) = seen {
        let (fid, fpos) = (run.creature_id(foe), run.creature_pos(foe));
        let ai = &mut run.monsters[mi].ai;
        ai.target = Some(match foe {
            Creature::Player(_) => Target::Player(fid),
            Creature::Monster(_) => Target::Ally(fid),
        });
        ai.last_known = fpos;
        ai.state = AiState::Chase;
        ai.path.clear();
    } else if run.monsters[mi].ai.target.is_some() {
        let ai = &mut run.monsters[mi].ai;
        ai.target = None;
        ai.windup = None;
        ai.state = AiState::Search;
        ai.search_t = 2.0;
    }

    // Disciples channel the lich and otherwise only shoot.
    if etype == EnemyType::Disciple {
        set_anim(run, mi, if run.monsters[mi].ai.windup.is_some() { Anim::Windup } else { Anim::Channel });
    }

    // Finish a wind-up: the attack lands only if the target is still seen.
    if let Some(w) = run.monsters[mi].ai.windup {
        let t = w.t - dt;
        if t > 0.0 {
            run.monsters[mi].ai.windup = Some(Windup { t, aim: w.aim, alt: w.alt, at: w.at });
            return;
        }
        run.monsters[mi].ai.windup = None;
        // A barrel aimed at that is still there and unlit; otherwise the seen hero.
        let barrel = match w.at {
            Some(Target::Object(id)) => run
                .objects
                .iter()
                .find(|o| o.id == id && !o.gone && matches!(&o.state, crate::run::objects::ObjState::Barrel(b) if b.fuse.is_none()))
                .map(|o| o.pos),
            _ => None,
        };
        if let Some(foe) = seen {
            let attack = if w.alt { def.alt.unwrap_or(def.attack) } else { def.attack };
            perform_attack(run, mi, foe, attack, w.alt, barrel);
        }
        return;
    }

    if matches!(etype, EnemyType::Necromancer | EnemyType::Summoner) {
        if seen.is_some() {
            let minions = run.monsters.iter().filter(|o| o.alive && o.owner == Some(run.monsters[mi].id)).count();
            if run.monsters[mi].ai.raise_cd <= 0.0 && minions < enemies::NECRO_MAX_MINIONS {
                raise_minions(run, mi, etype == EnemyType::Summoner);
                return;
            }
        }
    }

    match run.monsters[mi].ai.state {
        AiState::Chase => {
            let Some(foe) = seen else { return };
            let ppos = run.creature_pos(foe);
            let foe_radius = run.creature_radius(foe);
            let d = pos.dist(ppos);
            let aim = pos.angle_to(ppos);
            run.monsters[mi].aim = aim;
            // Reach and wind-up of an attack; movement follows the main attack.
            let reach = |a: AttackStyle| match a {
                AttackStyle::Melee { range, windup, .. } => (range + foe_radius + def.radius, 0.0, windup),
                AttackStyle::Ranged { range, preferred, windup, .. } => (range, preferred, windup),
                AttackStyle::Slam { radius, windup, .. } => (radius, 0.0, windup),
            };
            let (range, preferred, _) = reach(def.attack);
            if let Some(alt) = def.alt {
                // Second attack: a claw when the target is in reach, a bolt only from afar.
                let (alt_range, _, windup) = reach(alt);
                let usable = match alt {
                    AttackStyle::Melee { .. } => d <= alt_range,
                    AttackStyle::Ranged { .. } => d <= alt_range && d >= enemies::ALT_BOLT_MIN_DIST && d > range,
                    // A slam is worth it for two heroes in reach, or one while the club recovers.
                    AttackStyle::Slam { radius, .. } => {
                        let near = run.foes_in(pos, radius, None).len();
                        near >= 2 || near == 1 && run.monsters[mi].ai.cd > 0.0
                    }
                };
                if usable && run.monsters[mi].ai.alt_cd <= 0.0 {
                    run.monsters[mi].ai.windup = Some(Windup { t: windup, aim, alt: true, at: None });
                    set_anim(run, mi, if matches!(alt, AttackStyle::Slam { .. }) { Anim::Slam } else { Anim::Windup });
                    return;
                }
            }
            if d <= range && run.monsters[mi].ai.cd <= 0.0 {
                let (_, _, windup) = reach(def.attack);
                let at = match def.attack {
                    AttackStyle::Ranged { range, .. } if !run.monsters[mi].is_boss => barrel_near(run, mi, ppos, range).map(Target::Object),
                    _ => None,
                };
                let aim = match at {
                    Some(Target::Object(id)) => run.objects.iter().find(|o| o.id == id).map_or(aim, |o| pos.angle_to(o.pos)),
                    _ => aim,
                };
                run.monsters[mi].ai.windup = Some(Windup { t: windup, aim, alt: false, at });
                set_anim(run, mi, Anim::Windup);
                return;
            }
            if def.speed <= 0.0 {
                return;
            }
            let speed = gait(run, mi, def.speed);
            if preferred > 0.0 && d < preferred - 25.0 {
                // Ranged enemies back off to their preferred distance.
                let away = pos + (pos - ppos).norm() * 16.0;
                move_toward(run, mi, away, speed * 0.8, dt);
                set_anim(run, mi, Anim::Move);
            } else if d > range * 0.85 || preferred == 0.0 && d > range * 0.7 {
                // Wide figures (the ogre) path around corners and terrain edges.
                if def.radius > TILE / 2.0 {
                    path_toward(run, mi, ppos, speed, dt);
                } else {
                    move_toward(run, mi, ppos, speed, dt);
                }
                set_anim(run, mi, Anim::Move);
            } else {
                set_anim(run, mi, Anim::Idle);
            }
        }
        AiState::Search => {
            if def.speed <= 0.0 {
                run.monsters[mi].ai.state = AiState::Idle;
                return;
            }
            let goal = run.monsters[mi].ai.last_known;
            let speed = gait(run, mi, def.speed);
            let arrived = path_toward(run, mi, goal, speed, dt);
            if arrived {
                set_anim(run, mi, Anim::Idle);
                let ai = &mut run.monsters[mi].ai;
                ai.search_t -= dt;
                if ai.search_t <= 0.0 {
                    ai.state = AiState::Return;
                    ai.path.clear();
                }
            } else {
                set_anim(run, mi, Anim::Move);
            }
        }
        AiState::Return => {
            let home = run.monsters[mi].ai.home;
            let speed = gait(run, mi, def.speed * 0.7);
            if path_toward(run, mi, home, speed, dt) {
                run.monsters[mi].ai.state = AiState::Idle;
                set_anim(run, mi, Anim::Idle);
            } else {
                set_anim(run, mi, Anim::Move);
            }
        }
        AiState::Idle => {
            // Disciples stand still; an awake mimic waits where it was found.
            if def.speed <= 0.0 || etype == EnemyType::Disciple || etype == EnemyType::Mimic {
                return;
            }
            let home = run.monsters[mi].ai.home;
            run.monsters[mi].ai.wander_t -= dt;
            if run.monsters[mi].ai.wander_t <= 0.0 {
                let off = Vec2::new(run.rng.gen_range(-24.0..24.0), run.rng.gen_range(-24.0..24.0));
                let ai = &mut run.monsters[mi].ai;
                ai.wander_t = 3.0 + (off.x.abs() / 8.0);
                ai.wander_to = Some(home + off);
            }
            if let Some(to) = run.monsters[mi].ai.wander_to {
                let before = run.monsters[mi].pos;
                if move_toward(run, mi, to, def.speed * 0.4, dt) || run.monsters[mi].pos.dist2(before) < 1e-6 {
                    run.monsters[mi].ai.wander_to = None;
                    set_anim(run, mi, Anim::Idle);
                } else {
                    let a = before.angle_to(to);
                    run.monsters[mi].aim = a;
                    set_anim(run, mi, Anim::Move);
                }
            }
        }
    }
}

/// Movement speed for this tick. Mimics hop: no movement on the ground
/// (crouch, landing, rest), and the average speed packed into the airborne
/// part of each cycle. The hop clock is the Move animation clock, so the
/// client can draw the same phases.
fn gait(run: &Run, mi: usize, speed: f64) -> f64 {
    let m = &run.monsters[mi];
    if m.etype != Some(EnemyType::Mimic) {
        return speed;
    }
    if m.anim != Anim::Move {
        return 0.0; // the hop starts next tick, with a fresh clock
    }
    let phase = ((run.time - m.anim_start) / enemies::MIMIC_HOP_CYCLE).fract();
    let (a, b) = enemies::MIMIC_HOP_AIR;
    if phase >= a && phase < b {
        speed / (b - a)
    } else {
        0.0
    }
}

/// A barrel worth shooting instead of the hero: unlit, solid, in range and
/// sight of the shooter, close enough to the hero for the blast to catch
/// them, and far enough that the blast spares the shooter. The one closest
/// to the hero.
fn barrel_near(run: &Run, mi: usize, hero: Vec2, range: f64) -> Option<u32> {
    use crate::defs::objects::BARREL_BLAST_R;
    let m = &run.monsters[mi];
    run.objects
        .iter()
        .filter(|o| !o.gone && matches!(&o.state, crate::run::objects::ObjState::Barrel(b) if b.fuse.is_none() && b.sinking.is_none()))
        .filter(|o| o.pos.dist(hero) < BARREL_BLAST_R + PLAYER_RADIUS)
        .filter(|o| o.pos.dist(m.pos) > BARREL_BLAST_R + m.radius + 8.0 && o.pos.dist(m.pos) <= range)
        .filter(|o| line_of_sight(&run.layout.map, m.pos, o.pos))
        .min_by(|a, b| a.pos.dist(hero).total_cmp(&b.pos.dist(hero)))
        .map(|o| o.id)
}

/// Minimum pause (s) between a monster's two different attacks.
const ATTACK_GAP: f64 = 0.4;

/// `alt`: the second attack, which has its own cooldown. Either attack also
/// keeps the other one back for a moment, so they never land at once.
pub(crate) fn perform_attack(run: &mut Run, mi: usize, foe: Creature, attack: AttackStyle, alt: bool, at: Option<Vec2>) {
    let pos = run.monsters[mi].pos;
    let ppos = run.creature_pos(foe);
    let aim = pos.angle_to(at.unwrap_or(ppos));
    run.monsters[mi].aim = aim;
    let set_cd = |run: &mut Run, cd: f64| {
        let ai = &mut run.monsters[mi].ai;
        if alt {
            ai.alt_cd = cd;
            ai.cd = ai.cd.max(ATTACK_GAP);
        } else {
            ai.cd = cd;
            ai.alt_cd = ai.alt_cd.max(ATTACK_GAP);
        }
    };
    let on_hit = run.monsters[mi].etype.and_then(|t| enemies::on_hit(t, alt));
    // Melee and slams; a shot takes its owner's power in `spawn_monster_projectile`.
    let power = run.monsters[mi].etype.map_or(0, |t| run.monsters[mi].attrs.get(enemies::governing(t, None)));
    let with = |d: Damage| match on_hit {
        Some(h) => d.with_power(power).with_effect(h),
        None => d.with_power(power),
    };
    match attack {
        AttackStyle::Melee { range, damage, cooldown, knock, .. } => {
            set_cd(run, cooldown);
            set_anim(run, mi, Anim::Melee);
            let reach = range + run.creature_radius(foe) + run.monsters[mi].radius + 4.0;
            if pos.dist(ppos) <= reach {
                let dmg = with(Damage::new(damage, run.monsters[mi].melee));
                run.hurt_creature(foe, dmg);
                let str = run.push_str(mi);
                run.knock_creature(foe, pos, aim, knock, str);
            }
        }
        AttackStyle::Ranged { projectile, speed, damage, cooldown, range, pierce, .. } => {
            let cd = cooldown * run.rng.gen_range(0.85..1.15);
            set_cd(run, cd);
            set_anim(run, mi, Anim::Shoot);
            let id = run.monsters[mi].id;
            let dir = Vec2::from_angle(aim);
            spawn_monster_projectile(run, id, projectile, pos + dir * 5.0, dir, speed, damage, range * 1.3 / speed, 0.0, 0, 0.0);
            if let Some(h) = on_hit {
                run.projectiles.last_mut().unwrap().damage.on_hit = Some(h); // the shot just spawned
            }
            if pierce {
                run.projectiles.last_mut().unwrap().pierce = Pierce::Overkill { left: u8::MAX }; // a weapon shot
            }
        }
        AttackStyle::Slam { radius, damage, cooldown, knock, .. } => {
            set_cd(run, cooldown);
            set_anim(run, mi, Anim::Idle);
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: radius as f32, k: 5 }, Some(pos));
            let dmg = with(Damage::new(damage, run.monsters[mi].melee));
            crate::run::objects::hurt_objects_in(run, pos, radius, None, dmg);
            let str = run.push_str(mi);
            for c in run.foes_in(pos, radius, None) {
                let away = pos.angle_to(run.creature_pos(c));
                run.hurt_creature(c, dmg);
                run.knock_creature(c, pos, away, knock, str);
            }
        }
    }
}

/// Necromancers raise skeletons; summoners (`fire`) summon imps.
fn raise_minions(run: &mut Run, mi: usize, fire: bool) {
    let (pos, id) = (run.monsters[mi].pos, run.monsters[mi].id);
    run.monsters[mi].ai.raise_cd = enemies::NECRO_RAISE_COOLDOWN;
    set_anim(run, mi, Anim::Cast);
    for k in 0..2 {
        let a = run.rng.gen_range(0.0..std::f64::consts::TAU);
        let mut spot = pos + Vec2::from_angle(a) * 14.0;
        if run.layout.map.blocks_at(spot, run.monsters[mi].mover) {
            spot = pos;
        }
        let minions = run.monsters.iter().filter(|o| o.alive && o.owner == Some(id)).count();
        if minions >= enemies::NECRO_MAX_MINIONS || k > 0 && run.rng.gen_bool(0.5) {
            break;
        }
        let t = if fire { EnemyType::SummonedImp } else { EnemyType::RaisedSkeleton };
        run.spawn_enemy(t, spot, Some(id));
        run.event(Ev::Raise { x: spot.x as f32, y: spot.y as f32, k: fire as u8 }, Some(spot));
    }
}

/// Push overlapping monsters apart so groups don't stack on one spot.
pub fn separate_monsters(run: &mut Run) {
    let n = run.monsters.len();
    let solids = run.solids(None);
    for i in 0..n {
        if !run.monsters[i].alive || run.monsters[i].speed <= 0.0 || run.monsters[i].dormant || run.monsters[i].hiding {
            continue;
        }
        for j in 0..n {
            if i == j || !run.monsters[j].alive {
                continue;
            }
            let (a, b) = (run.monsters[i].pos, run.monsters[j].pos);
            let min = run.monsters[i].radius + run.monsters[j].radius;
            let d2 = a.dist2(b);
            if d2 < min * min && d2 > 1e-6 {
                let d = d2.sqrt();
                let push = (a - b) * ((min - d) / d * 0.5);
                let (r, mover) = (run.monsters[i].radius, run.monsters[i].mover);
                let (x, y) = move_box(&run.layout.map, a.x, a.y, push.x.clamp(-2.0, 2.0), push.y.clamp(-2.0, 2.0), r, mover, &solids);
                run.monsters[i].pos = Vec2::new(x, y);
            }
        }
    }
}

/// 4-directional A* on the tiles this mover can walk. Returns waypoints
/// (tile centers), excluding the start tile.
pub fn astar(map: &Map, from: Vec2, to: Vec2, max_nodes: usize, mover: Mover) -> Option<Vec<Vec2>> {
    astar_clear(map, from, to, max_nodes, mover, false, &HashSet::new())
}

/// A* as above; with `clear`, tiles next to anything this mover cannot enter
/// cost extra, so figures wider than a tile keep their distance where they can.
fn astar_clear(map: &Map, from: Vec2, to: Vec2, max_nodes: usize, mover: Mover, clear: bool, blocked: &HashSet<(i32, i32)>) -> Option<Vec<Vec2>> {
    let near_blocked = |x: i32, y: i32| (-1..=1).any(|dy| (-1..=1).any(|dx| map.blocks(x + dx, y + dy, mover)));
    let start = Map::tile_of(from);
    let goal = Map::tile_of(to);
    if map.blocks(goal.0, goal.1, mover) {
        return None;
    }
    let h = |p: (i32, i32)| (p.0 - goal.0).abs() + (p.1 - goal.1).abs();
    let mut open = BinaryHeap::new();
    let mut came: HashMap<(i32, i32), (i32, i32)> = HashMap::new();
    let mut g: HashMap<(i32, i32), i32> = HashMap::new();
    g.insert(start, 0);
    open.push(Reverse((h(start), start)));
    let mut expanded = 0;
    while let Some(Reverse((_, cur))) = open.pop() {
        if cur == goal {
            let mut path = vec![to];
            let mut c = cur;
            while let Some(&prev) = came.get(&c) {
                if prev == start {
                    break;
                }
                path.push(Map::center_of(prev.0, prev.1));
                c = prev;
            }
            path.reverse();
            return Some(path);
        }
        expanded += 1;
        if expanded > max_nodes {
            return None;
        }
        let cg = g[&cur];
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let nb = (cur.0 + dx, cur.1 + dy);
            if map.blocks(nb.0, nb.1, mover) || (blocked.contains(&nb) && nb != goal) {
                continue;
            }
            // Tiles beside a barrel are a tight squeeze for a body: go around when there is room.
            let squeeze = nb != goal && (-1..=1).any(|dy| (-1..=1).any(|dx| blocked.contains(&(nb.0 + dx, nb.1 + dy))));
            let ng = cg + if squeeze { 8 } else if clear && nb != goal && near_blocked(nb.0, nb.1) { 5 } else { 1 };
            if g.get(&nb).map_or(true, |&old| ng < old) {
                g.insert(nb, ng);
                came.insert(nb, cur);
                open.push(Reverse((ng + h(nb), nb)));
            }
        }
    }
    None
}

#[cfg(test)]
pub(crate) mod tests {
    use super::super::tests::{test_run, test_run_seed};
    use super::*;
    use crate::defs::kinds::EntityKind;
    use crate::dungeon::Tile;
    use crate::protocol::{BossId, ClassId};

    #[test]
    fn wide_bosses_reach_every_spot_of_their_hall_around_the_chasms() {
        for seed in 0..24u64 {
            for boss in [BossId::Demon, BossId::Dragon] {
                let mut run = test_run_seed(&[ClassId::Paladin], boss, seed);
                let bi = run.monsters.iter().position(|m| m.is_boss).unwrap();
                let r = run.level.boss().unwrap().arena;
                let home = r.center_px();
                let speed = run.monsters[bi].speed;
                for (x, y) in (r.y..r.y + r.h).flat_map(|y| (r.x..r.x + r.w).map(move |x| (x, y))).filter(|(x, y)| (x + y) % 3 == 0) {
                    if !run.layout.map.safe(x, y) {
                        continue;
                    }
                    let goal = Map::center_of(x, y);
                    run.monsters[bi].pos = home;
                    run.monsters[bi].ai.path.clear();
                    for _ in 0..(15.0 / super::super::DT) as usize {
                        if run.monsters[bi].pos.dist(goal) < 24.0 {
                            break;
                        }
                        path_toward(&mut run, bi, goal, speed, super::super::DT);
                    }
                    // Close enough to fight: a pocket by a wall-side chasm may keep a wide boss a little off.
                    let at = run.monsters[bi].pos;
                    let near = run.monsters[bi].radius + 2.0 * TILE;
                    assert!(at.dist(goal) < near, "seed {seed} {boss:?}: stuck at {at:?} on the way to {goal:?}");
                }
            }
        }
    }

    #[test]
    fn a_demons_claw_burns_a_fifth_of_its_damage() {
        use crate::defs::damage::{DamageType, Resistances};
        let hit = |res: Resistances| {
            let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
            run.players[0].res = res;
            let hp = run.players[0].hp;
            let ppos = run.players[0].pos();
            let id = run.spawn_enemy(EnemyType::Chort, ppos - Vec2::new(12.0, 0.0), None);
            let mi = run.monster_idx(id).unwrap();
            perform_attack(&mut run, mi, Creature::Player(0), enemies::def(EnemyType::Chort).attack, false, None);
            hp - run.players[0].hp
        };
        assert!((hit(Resistances::NONE) - 9.0).abs() < 1e-9);
        assert!((hit(Resistances::of(&[(DamageType::Heat, 1.0)])) - 9.0 * 0.8).abs() < 1e-9, "the heat fifth is shrugged off");
    }

    #[test]
    fn an_archer_punches_a_hero_in_reach() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let ppos = run.players[0].pos();
        let id = run.spawn_enemy(EnemyType::GoblinArcher, ppos - Vec2::new(10.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].ai.cd = 0.0;
        run.monsters[mi].ai.alt_cd = 0.0;
        run.projectiles.clear();
        let hp = run.players[0].hp;
        let mut first = None;
        for _ in 0..120 {
            run.step();
            if first.is_none() {
                first = run.monsters[mi].ai.windup.map(|w| w.alt);
            }
            if run.players[0].hp < hp {
                break;
            }
        }
        assert_eq!(first, Some(true), "the first wind-up is the melee alt");
        assert!(run.players[0].hp < hp, "the punch lands");
        assert!(run.projectiles.is_empty(), "no arrow is shot");
    }

    #[test]
    fn only_strong_melee_pushes() {
        let pushes = |t: EnemyType, alt: bool| {
            let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
            let ppos = run.players[0].pos();
            let id = run.spawn_enemy(t, ppos - Vec2::new(12.0, 0.0), None);
            let mi = run.monster_idx(id).unwrap();
            let d = enemies::def(t);
            let attack = if alt { d.alt.unwrap() } else { d.attack };
            perform_attack(&mut run, mi, Creature::Player(0), attack, alt, None);
            run.players[0].mv.knocked()
        };
        assert!(pushes(EnemyType::OrcWarrior, false));
        assert!(pushes(EnemyType::Ogre, false), "ogre club");
        assert!(pushes(EnemyType::Ogre, true), "ogre slam");
        assert!(pushes(EnemyType::Chort, false), "chort claw");
        assert!(!pushes(EnemyType::Chort, true), "chort fire bolt");
        assert!(!pushes(EnemyType::Imp, true), "imp claw");
        assert!(!pushes(EnemyType::SkeletonWarrior, false));
        assert!(!pushes(EnemyType::OrcArcher, false));
    }

    #[test]
    fn enemy_ignores_player_without_line_of_sight() {
        const SIGHT: Sight = Sight { vision: 7.5, darkvision: 1.0 };
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        let ppos = run.players[0].pos();
        // Open line of sight: seen.
        assert!(find_visible_hero(&run, ppos + Vec2::new(40.0, 0.0), SIGHT).is_some());
        // Wall in between: not seen.
        let (tx, ty) = Map::tile_of(ppos);
        for dy in -3..=3 {
            run.layout.map.set(tx + 1, ty + dy, Tile::Wall);
        }
        assert!(find_visible_hero(&run, ppos + Vec2::new(40.0, 0.0), SIGHT).is_none());
        // Out of sight radius: not seen.
        assert!(find_visible_hero(&run, ppos + Vec2::new(0.0, -0.0) + Vec2::new(-200.0, 0.0), SIGHT).is_none());
    }

    #[test]
    fn enemy_never_attacks_unseen_player() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        let ppos = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let mi_pos = ppos + Vec2::new(30.0, 0.0);
        run.spawn_enemy(EnemyType::GoblinArcher, mi_pos, None);
        let (tx, ty) = Map::tile_of(ppos);
        for dy in -4..=4 {
            run.layout.map.set(tx + 1, ty + dy, Tile::Wall);
        }
        let hp = run.players[0].hp;
        for _ in 0..300 {
            run.step();
        }
        assert_eq!(run.players[0].hp, hp, "no damage through walls");
        assert!(run.projectiles.is_empty());
    }

    #[test]
    fn necromancer_death_kills_raised_skeletons() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let ppos = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let necro = run.spawn_enemy(EnemyType::Necromancer, ppos + Vec2::new(60.0, 0.0), None);
        let ni = run.monster_idx(necro).unwrap();
        raise_minions(&mut run, ni, false);
        run.monsters[ni].ai.raise_cd = 0.0;
        raise_minions(&mut run, ni, false);
        let minions = run.monsters.iter().filter(|m| m.owner == Some(necro) && m.alive).count();
        assert!(minions >= 1);
        run.kill_monster(ni);
        let minions = run.monsters.iter().filter(|m| m.owner == Some(necro) && m.alive).count();
        assert_eq!(minions, 0);
    }

    #[test]
    fn demon_dungeon_has_demons_instead_of_skeletons() {
        let count = |run: &Run, t: EnemyType| run.monsters.iter().filter(|m| m.etype == Some(t)).count();
        let lich = test_run(&[ClassId::Wizard], BossId::Lich);
        let demon = test_run(&[ClassId::Wizard], BossId::Demon);
        // Same seed, same map and spawn spots: only the enemy types differ.
        assert_eq!(lich.layout.spawns.len(), demon.layout.spawns.len());
        assert!(count(&lich, EnemyType::SkeletonArcher) + count(&lich, EnemyType::SkeletonWarrior) > 0, "seed has skeletons");
        assert_eq!(count(&demon, EnemyType::Imp), count(&lich, EnemyType::SkeletonArcher));
        assert_eq!(count(&demon, EnemyType::Chort), count(&lich, EnemyType::SkeletonWarrior));
        assert_eq!(count(&demon, EnemyType::Summoner), count(&lich, EnemyType::Necromancer));
        for t in [EnemyType::SkeletonArcher, EnemyType::SkeletonWarrior, EnemyType::Necromancer] {
            assert_eq!(count(&demon, t), 0, "{t:?} in the demon's dungeon");
        }
        for t in [EnemyType::Imp, EnemyType::Chort, EnemyType::Summoner] {
            assert_eq!(count(&lich, t), 0, "{t:?} outside the demon's dungeon");
        }
    }

    /// Open floor around player 0, so test monsters always see it.
    pub(crate) fn open_floor(run: &mut Run) {
        run.lights.fill(); // these tests are not about darkness
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 3..=ty + 3 {
            for x in tx - 8..=tx + 8 {
                run.layout.map.set(x, y, Tile::Floor);
            }
        }
    }

    /// A lone monster of type `t` at `off` from player 0, attacks ready.
    /// Returns which attack its first wind-up leads to (`Some(alt)`).
    fn first_windup(t: EnemyType, off: Vec2) -> Option<bool> {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        open_floor(&mut run);
        let ppos = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss);
        let id = run.spawn_enemy(t, ppos + off, None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].ai.cd = 0.0;
        run.monsters[mi].ai.alt_cd = 0.0;
        tick_monster(&mut run, mi, 1.0 / 60.0);
        run.monsters[mi].ai.windup.map(|w| w.alt)
    }

    #[test]
    fn imp_claws_up_close_and_shoots_from_afar() {
        assert_eq!(first_windup(EnemyType::Imp, Vec2::new(12.0, 0.0)), Some(true), "claw");
        assert_eq!(first_windup(EnemyType::Imp, Vec2::new(80.0, 0.0)), Some(false), "fire bolt");
    }

    #[test]
    fn chort_claws_up_close_and_throws_bolts_from_afar() {
        assert_eq!(first_windup(EnemyType::Chort, Vec2::new(12.0, 0.0)), Some(false), "claw");
        assert_eq!(first_windup(EnemyType::Chort, Vec2::new(30.0, 0.0)), None, "too close for a bolt, too far for a claw");
        assert_eq!(first_windup(EnemyType::Chort, Vec2::new(80.0, 0.0)), Some(true), "fire bolt");
    }

    /// Players 0.. stand at `offs` from a lone ogre on open floor, attacks ready.
    pub(crate) fn ogre_among(offs: &[Vec2]) -> (Run, usize) {
        let classes = vec![ClassId::Paladin; offs.len()];
        let mut run = test_run(&classes, BossId::Lich);
        open_floor(&mut run);
        let at = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss);
        let id = run.spawn_enemy(EnemyType::Ogre, at, None);
        let mi = run.monster_idx(id).unwrap();
        for (p, off) in run.players.iter_mut().zip(offs) {
            p.mv.x = at.x + off.x;
            p.mv.y = at.y + off.y;
        }
        run.monsters[mi].ai.cd = 0.0;
        run.monsters[mi].ai.alt_cd = 0.0;
        (run, mi)
    }

    #[test]
    fn ogre_slams_a_crowd_and_clubs_a_lone_hero() {
        let (mut run, mi) = ogre_among(&[Vec2::new(20.0, 0.0), Vec2::new(-16.0, 8.0)]);
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert_eq!(run.monsters[mi].ai.windup.map(|w| w.alt), Some(true), "two heroes near: slam");
        assert_eq!(run.monsters[mi].anim, Anim::Slam, "the slam has its own telegraph");

        let (mut run, mi) = ogre_among(&[Vec2::new(20.0, 0.0)]);
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert_eq!(run.monsters[mi].ai.windup.map(|w| w.alt), Some(false), "one hero, club ready: club");

        let (mut run, mi) = ogre_among(&[Vec2::new(20.0, 0.0)]);
        run.monsters[mi].ai.cd = 1.0;
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert_eq!(run.monsters[mi].ai.windup.map(|w| w.alt), Some(true), "one hero while the club recovers: slam");
    }

    #[test]
    fn ogre_slam_hits_and_pushes_every_hero_in_reach_away_from_it() {
        let r = enemies::OGRE_SLAM_RADIUS;
        let (mut run, mi) = ogre_among(&[Vec2::new(20.0, 0.0), Vec2::new(0.0, -(r - 2.0)), Vec2::new(-(r + 6.0), 0.0)]);
        let hp: Vec<f64> = run.players.iter().map(|p| p.hp).collect();
        let slam = enemies::def(EnemyType::Ogre).alt.unwrap();
        run.events.clear();
        perform_attack(&mut run, mi, Creature::Player(0), slam, true, None);
        let p = &run.players;
        assert!(p[0].hp < hp[0] && p[0].mv.knock_vx > 0.0 && p[0].mv.knock_vy.abs() < 1e-9, "east hero pushed east");
        assert!(p[1].hp < hp[1] && p[1].mv.knock_vy < 0.0 && p[1].mv.knock_vx.abs() < 1e-9, "north hero pushed north");
        assert!(p[2].hp == hp[2] && !p[2].mv.knocked(), "hero outside the radius is spared");
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Boom { k: 5, .. })), "shockwave event");
        assert!(run.monsters[mi].ai.alt_cd > 1.0, "slam cooldown started");
    }

    #[test]
    fn ogre_slam_lights_barrels_in_its_radius() {
        use crate::run::objects::{Barrel, ObjState};
        let r = enemies::OGRE_SLAM_RADIUS;
        let (mut run, mi) = ogre_among(&[Vec2::new(20.0, 0.0)]);
        run.objects.retain(|o| o.kind != EntityKind::Barrel);
        let at = run.monsters[mi].pos;
        run.spawn_object(EntityKind::Barrel, at + Vec2::new(0.0, r), ObjState::Barrel(Barrel::new()));
        run.spawn_object(EntityKind::Barrel, at + Vec2::new(0.0, -(r + 10.0)), ObjState::Barrel(Barrel::new()));
        let slam = enemies::def(EnemyType::Ogre).alt.unwrap();
        perform_attack(&mut run, mi, Creature::Player(0), slam, true, None);
        let lit: Vec<bool> = run.objects.iter().filter(|o| o.kind == EntityKind::Barrel).map(|o| matches!(&o.state, ObjState::Barrel(b) if b.fuse.is_some())).collect();
        assert_eq!(lit, vec![true, false], "the one in reach is lit, the one outside is not");
    }

    #[test]
    fn alt_attack_uses_its_own_cooldown_and_projectile() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        open_floor(&mut run);
        let ppos = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss);
        let id = run.spawn_enemy(EnemyType::Chort, ppos + Vec2::new(80.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].ai.alt_cd = 0.0;
        for _ in 0..60 {
            tick_monster(&mut run, mi, 1.0 / 60.0);
            if !run.projectiles.is_empty() {
                break;
            }
        }
        assert_eq!(run.projectiles.len(), 1);
        assert_eq!(run.projectiles[0].kind, EntityKind::FireBolt);
        let ai = &run.monsters[mi].ai;
        assert!(ai.alt_cd > 2.0, "bolt cooldown started");
        assert!(ai.cd < 1.0, "claw cooldown untouched (only the short gap)");
    }

    #[test]
    fn summoner_summons_imps_that_die_with_it() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let ppos = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let s = run.spawn_enemy(EnemyType::Summoner, ppos + Vec2::new(60.0, 0.0), None);
        let si = run.monster_idx(s).unwrap();
        run.events.clear();
        raise_minions(&mut run, si, true);
        let imps: Vec<_> = run.monsters.iter().filter(|m| m.owner == Some(s) && m.alive).collect();
        assert!(!imps.is_empty());
        assert!(imps.iter().all(|m| m.etype == Some(EnemyType::SummonedImp) && m.kind == EntityKind::Imp), "summoned imps look like imps");
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Raise { k: 1, .. })));
        run.kill_monster(si);
        assert_eq!(run.monsters.iter().filter(|m| m.owner == Some(s) && m.alive).count(), 0);
    }

    #[test]
    fn astar_keeps_enemies_out_of_terrain() {
        let mut m = Map::new(12, 12);
        for y in 1..11 {
            for x in 1..11 {
                m.set(x, y, Tile::Floor);
            }
        }
        for y in 1..10 {
            m.set(5, y, Tile::Lava);
            m.set(7, y, Tile::Chasm);
        }
        let (from, to) = (Map::center_of(2, 2), Map::center_of(6, 2));
        let around = |p: &Vec<Vec2>| p.iter().any(|w| Map::tile_of(*w).1 >= 10);
        assert!(around(&astar(&m, from, to, 1000, Mover::Enemy).unwrap()), "enemies go around lava");
        assert!(!around(&astar(&m, from, to, 1000, Mover::Demon).unwrap()), "demons walk through lava");
        let past = Map::center_of(9, 2);
        assert!(around(&astar(&m, from, past, 1000, Mover::Demon).unwrap()), "demons go around chasms");
    }

    #[test]
    fn astar_finds_path_around_wall() {
        let mut m = Map::new(12, 12);
        for y in 1..11 {
            for x in 1..11 {
                m.set(x, y, Tile::Floor);
            }
        }
        for y in 1..9 {
            m.set(5, y, Tile::Wall);
        }
        let p = astar(&m, Map::center_of(2, 2), Map::center_of(8, 2), 1000, Mover::Enemy).unwrap();
        assert!(p.iter().any(|w| Map::tile_of(*w).1 >= 9));
    }

    #[test]
    fn a_seen_hero_becomes_the_target() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Lich);
        open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, run.players[0].pos() + Vec2::new(60.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert_eq!(run.monsters[mi].ai.target, Some(crate::run::entities::Target::Player(run.players[0].id)));
    }

    #[test]
    fn astar_goes_around_tiles_under_barrels() {
        let mut m = Map::new(12, 12);
        for y in 1..11 {
            for x in 1..11 {
                m.set(x, y, Tile::Floor);
            }
        }
        let blocked: std::collections::HashSet<(i32, i32)> = (1..10).map(|y| (5, y)).collect();
        let p = astar_clear(&m, Map::center_of(2, 2), Map::center_of(8, 2), 1000, Mover::Enemy, false, &blocked).unwrap();
        assert!(p.iter().any(|w| Map::tile_of(*w).1 >= 10));
    }

    /// An orc archer 100 px west of the hero, a barrel `barrel_off` from the hero.
    fn archer_and_barrel(barrel_off: Vec2) -> (Run, usize, u32) {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let p = run.players[0].pos();
        let id = run.spawn_enemy(EnemyType::OrcArcher, p - Vec2::new(100.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].ai.cd = 0.0;
        let b = run.spawn_object(EntityKind::Barrel, p + barrel_off, crate::run::objects::ObjState::Barrel(crate::run::objects::Barrel::new()));
        (run, mi, b)
    }

    #[test]
    fn an_archer_shoots_a_barrel_next_to_the_hero() {
        let (mut run, mi, b) = archer_and_barrel(Vec2::new(-16.0, 12.0));
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert_eq!(run.monsters[mi].ai.windup.and_then(|w| w.at), Some(crate::run::entities::Target::Object(b)));
        for _ in 0..90 {
            tick_monster(&mut run, mi, 1.0 / 60.0);
            crate::run::abilities::tick_projectiles(&mut run, 1.0 / 60.0);
        }
        let o = run.objects.iter().find(|o| o.id == b).unwrap();
        assert!(matches!(&o.state, crate::run::objects::ObjState::Barrel(x) if x.fuse.is_some()), "the barrel was shot");
    }

    #[test]
    fn an_archer_does_not_shoot_a_barrel_that_would_catch_it() {
        // Barrel 60 px east of the archer... then the hero steps 20 px west:
        // the barrel is 40 px from both, so the blast would catch the archer too.
        let (mut run, mi, _) = archer_and_barrel(Vec2::new(-60.0, 0.0));
        run.players[0].mv.x -= 20.0;
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert!(run.monsters[mi].ai.windup.is_some(), "it still attacks");
        assert_eq!(run.monsters[mi].ai.windup.and_then(|w| w.at), None, "but shoots the hero");
    }

    #[test]
    fn a_far_barrel_is_ignored() {
        let (mut run, mi, _) = archer_and_barrel(Vec2::new(0.0, 60.0));
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert_eq!(run.monsters[mi].ai.windup.and_then(|w| w.at), None);
    }

    /// Open floor around hero 0 with no lights at all, only the boss left.
    fn dark_floor(run: &mut Run) {
        open_floor(run);
        run.monsters.retain(|m| m.is_boss);
        run.lights = super::super::light::Lights::new(run.layout.map.w, run.layout.map.h);
        run.refresh_lights();
    }

    #[test]
    fn a_hit_sends_a_human_enemy_searching_in_the_dark() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        dark_floor(&mut run);
        let ppos = run.players[0].pos();
        let id = run.spawn_enemy(EnemyType::Necromancer, ppos + Vec2::new(5.0 * TILE, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert_eq!(run.monsters[mi].ai.target, None, "blind in the dark");
        run.hurt_monster(mi, Damage::physical(1.0), false, Some(0));
        assert_eq!(run.monsters[mi].ai.state, AiState::Search);
        assert_eq!(run.monsters[mi].ai.last_known, ppos);
    }

    #[test]
    fn a_fire_shot_lights_a_dark_hero_for_the_ai_this_tick() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        dark_floor(&mut run);
        let ppos = run.players[0].pos();
        let id = run.spawn_enemy(EnemyType::OrcWarrior, ppos + Vec2::new(5.0 * TILE, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        run.step();
        assert_eq!(run.monsters[mi].ai.target, None, "dark: not seen");
        // A fire shot (moving light) beside the hero lights them within this very step.
        // Owner 999 is no real entity: only the kind's light matters here.
        super::super::abilities::spawn_monster_projectile(&mut run, 999, EntityKind::FireBolt, ppos + Vec2::new(TILE, 0.0), Vec2::new(0.0, 1.0), 1.0, 1.0, 3.0, 0.0, 0, 0.0);
        run.step();
        assert_eq!(run.monsters[mi].ai.target, Some(Target::Player(run.players[0].id)));
    }

    use crate::defs::effects::EffectKind;
    use crate::math::angle_diff;
    use crate::run::effects::Apply;

    fn scared_of(run: &mut Run, mi: usize, source: Option<(u32, Vec2)>) {
        let a = Apply { source, ..Apply::plain(EffectKind::Fear, Some(5.0)) };
        assert!(run.apply(Creature::Monster(mi), a));
    }

    #[test]
    fn a_frightened_monster_runs_away_and_does_not_attack() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        let (hero, hid) = (run.players[0].pos(), run.players[0].id);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, hero + Vec2::new(20.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        run.step();
        assert_eq!(run.monsters[mi].ai.state, AiState::Chase, "it chases the hero first");
        scared_of(&mut run, mi, Some((hid, hero)));
        run.events.clear();
        let hp = run.players[0].hp;
        for _ in 0..30 {
            run.step();
        }
        let m = &run.monsters[mi];
        assert!(m.pos.dist(hero) > 20.0 + 5.0, "farther: {}", m.pos.dist(hero));
        assert!(angle_diff(m.aim, hero.angle_to(m.pos)).abs() < 0.3, "its aim points away");
        assert!(m.ai.windup.is_none());
        assert_eq!(run.players[0].hp, hp);
        assert!(!run.events.iter().any(|(e, _)| matches!(e, Ev::Dmg { .. })), "no blow on the hero");
    }

    #[test]
    fn fear_flees_from_the_last_known_spot_when_the_source_is_gone() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        let at = run.players[0].pos();
        let id = run.spawn_enemy(EnemyType::OrcWarrior, at, None);
        let mi = run.monster_idx(id).unwrap();
        run.players[0].alive = false; // keeps the monsters from other business
        scared_of(&mut run, mi, Some((999, at - Vec2::new(10.0, 0.0))));
        let x0 = run.monsters[mi].pos.x;
        flee(&mut run, mi, crate::run::DT);
        assert!(run.monsters[mi].pos.x > x0, "walks east, away from the spot 10 px west");
        // On the spot itself, with no source alive and with a live hero overlapping: it keeps
        // going along the reversed aim instead of jittering.
        for overlap in [false, true] {
            run.remove_effect(Creature::Monster(mi), EffectKind::Fear);
            let here = run.monsters[mi].pos;
            run.monsters[mi].aim = 0.0;
            let src = if overlap {
                run.players[0].alive = true;
                run.players[0].mv.x = here.x;
                run.players[0].mv.y = here.y;
                run.players[0].id
            } else {
                999
            };
            scared_of(&mut run, mi, Some((src, here)));
            for _ in 0..30 {
                flee(&mut run, mi, crate::run::DT);
                let p = run.monsters[mi].pos;
                assert!(p.x.is_finite() && p.y.is_finite());
            }
            let d = run.monsters[mi].pos - here;
            assert!(-d.x >= 10.0 && d.y.abs() < 1e-6, "overlap {overlap}: net west along the reversed aim, got {d:?}");
            run.players[0].alive = false;
        }
        // No source at all: from Vec2::ZERO, still finite.
        run.remove_effect(Creature::Monster(mi), EffectKind::Fear);
        scared_of(&mut run, mi, None);
        for _ in 0..10 {
            flee(&mut run, mi, crate::run::DT);
        }
        assert!(run.monsters[mi].pos.x.is_finite() && run.monsters[mi].pos.y.is_finite());
    }

    #[test]
    fn an_entangled_monster_stays_put_but_still_shoots() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.monsters.retain(|m| m.is_boss);
        let hero = run.players[0].pos();
        let id = run.spawn_enemy(EnemyType::GoblinArcher, hero + Vec2::new(60.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        assert!(run.apply_effect(Creature::Monster(mi), EffectKind::Entangled, Some(3.0)));
        let pos = run.monsters[mi].pos;
        for _ in 0..60 {
            run.step();
        }
        let mi = run.monster_idx(id).unwrap();
        assert_eq!(run.monsters[mi].pos, pos, "rooted");
        assert!(run.projectiles.iter().any(|p| p.owner == id), "but the arrow flies");
    }
}
