//! Enemy AI: perception (sight radius + line of sight), chase/attack,
//! search last known position, return home, and A* pathfinding.

use super::abilities::{monster_use, tick_monster_slam};
use super::effects::Creature;
use super::entities::{AiState, Target, Windup};
use super::Run;
use crate::collision::{line_of_sight, move_box, terrain_line, walk_line};
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::abilities::{self as ab, AbilityId, Shape};
use crate::defs::enemies::{self, EnemyType};
use crate::defs::kinds::Anim;
use crate::dungeon::{Map, Mover, TILE};
use crate::math::Vec2;
use crate::protocol::Ev;
use crate::sheet::ResolvedAbility;
use crate::defs::effects::EffectKind;
use crate::defs::races::Sight;
use rand::Rng;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};

/// Nearest living hero the monster can see right now.
pub fn find_visible_hero(run: &Run, from: Vec2, sight: Sight) -> Option<usize> {
    run.players
        .iter()
        .enumerate()
        .filter(|(_, p)| p.alive && !p.effects.has(EffectKind::Invisible))
        .filter(|(_, p)| super::perception::sees(run, sight, from, p.pos()))
        .map(|(i, p)| (i, p.pos().dist(from)))
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(i, _)| i)
}

/// Nearest living hero or ally (not sinking) the monster can see right now; a hero wins a tie.
pub fn find_visible_foe(run: &Run, from: Vec2, sight: Sight) -> Option<Creature> {
    let heroes = (0..run.players.len()).filter(|&i| run.players[i].alive && !run.players[i].effects.has(EffectKind::Invisible)).map(Creature::Player);
    let allies = (0..run.monsters.len()).filter(|&i| run.monsters[i].is_ally() && run.monsters[i].alive && run.monsters[i].sinking.is_none() && !run.monsters[i].effects.has(EffectKind::Invisible)).map(Creature::Monster);
    heroes
        .chain(allies)
        .map(|c| (c, run.creature_pos(c)))
        .filter(|&(_, p)| super::perception::sees(run, sight, from, p))
        .map(|(c, p)| (c, p.dist(from)))
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(c, _)| c)
}

pub(crate) fn set_anim(run: &mut Run, mi: usize, a: Anim) {
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
        let solids = run.solids_for(run.monsters[mi].mover, None);
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
    let moved = run.monsters[mi].pos.dist(pos) > 1e-9;
    run.monsters[mi].aim = dir.angle();
    set_anim(run, mi, if moved { Anim::Move } else { Anim::Idle });
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
    // A phantom drifts through solid objects too.
    let solids = run.solids_for(m.mover, None);
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
    if walk_line(map, pos, goal, mover) && (mover == Mover::Incorporeal || object_free_line(run, pos, goal, radius)) && (!wide || terrain_line(map, pos + side, goal + side, mover) && terrain_line(map, pos - side, goal - side, mover)) {
        run.monsters[mi].ai.path.clear();
        return move_toward(run, mi, goal, speed, dt);
    }
    if need_repath {
        let blocked = run.object_tiles_for(mover);
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

/// May this monster rest here (idle, wait, attack)? Ordinary monsters always may; a phantom may not
/// inside a wall, a closed door or a solid object, which it can only pass through.
pub(crate) fn can_rest(run: &Run, mi: usize, p: Vec2) -> bool {
    let m = &run.monsters[mi];
    m.mover != Mover::Incorporeal
        || run.layout.map.can_stop_at(p, m.mover) && !run.objects.iter().any(|o| o.blocks() && (p.x - o.pos.x).abs() < o.radius && (p.y - o.pos.y).abs() < o.radius)
}

/// A phantom that is somewhere it may not rest walks straight to the nearest spot it may.
fn leave_wall(run: &mut Run, mi: usize, dt: f64) {
    let (pos, speed) = (run.monsters[mi].pos, run.monsters[mi].speed);
    let (tx, ty) = Map::tile_of(pos);
    let to = (-6..=6)
        .flat_map(|dy| (-6..=6).map(move |dx| Map::center_of(tx + dx, ty + dy)))
        .filter(|&c| can_rest(run, mi, c))
        .min_by(|a, b| a.dist(pos).total_cmp(&b.dist(pos)));
    if let Some(to) = to {
        // `move_toward` applies the slow once.
        move_toward(run, mi, to, speed.max(20.0), dt);
        set_anim(run, mi, Anim::Move);
    }
}

/// One AI tick. A phantom never starts an attack or a wind-up inside a wall or a solid object, and
/// when its tick leaves it standing in one, it moves out to the nearest open spot.
pub fn tick_monster(run: &mut Run, mi: usize, dt: f64) {
    let stuck = !can_rest(run, mi, run.monsters[mi].pos);
    if stuck {
        run.monsters[mi].ai.windup = None;
    }
    let before = run.monsters[mi].pos;
    tick_monster_inner(run, mi, dt);
    if stuck && run.monsters[mi].alive && run.monsters[mi].pos.dist2(before) < 1e-6 && run.monsters[mi].slam.is_none() {
        leave_wall(run, mi, dt);
    }
}

fn tick_monster_inner(run: &mut Run, mi: usize, dt: f64) {
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

    // The incorporeal ambushers (their kit holds Vanish) vanish, drift to the straggler and warn first.
    if run.monsters[mi].kit.get(AbilityId::Vanish).is_some() && super::ambush::tick(run, mi, dt, seen) {
        return;
    }

    // Disciples channel the lich and otherwise only shoot.
    if etype == EnemyType::Disciple {
        set_anim(run, mi, if run.monsters[mi].ai.windup.is_some() { Anim::Windup } else { Anim::Channel });
    }

    // A Ground Slam winding up: it stands still until the blow lands.
    if run.monsters[mi].slam.is_some() {
        tick_monster_slam(run, mi, dt);
        if run.monsters[mi].slam.is_none() {
            set_anim(run, mi, Anim::Idle);
        }
        return;
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
            perform_attack(run, mi, foe, w.alt, barrel);
        }
        return;
    }

    // A minion ability winding up: it lands whether or not a foe is still seen.
    if let Some((id, t)) = run.monsters[mi].ai.cast {
        if t > dt {
            run.monsters[mi].ai.cast = Some((id, t - dt));
        } else {
            run.monsters[mi].ai.cast = None;
            // At the foe's last known spot, so the caster keeps facing it.
            let at = run.monsters[mi].ai.last_known;
            monster_use(run, mi, id, at);
        }
        return;
    }
    // A foe in sight and room for more minions: start raising them.
    if seen.is_some() {
        let raise = def.abilities.iter().filter_map(|&id| run.monsters[mi].kit.get(id)).copied().find(|a| {
            ab::def(a.id).own.minions.is_some() && run.monsters[mi].cds.ready(a.id) && super::minions::room(run, mi, a) > 0
        });
        if let Some(a) = raise {
            run.monsters[mi].ai.cast = Some((a.id, a.windup));
            set_anim(run, mi, Anim::Windup);
            return;
        }
    }

    match run.monsters[mi].ai.state {
        AiState::Chase => {
            let Some(foe) = seen else { return };
            let ppos = run.creature_pos(foe);
            let foe_radius = run.creature_radius(foe);
            let d = pos.dist(ppos);
            let aim = pos.angle_to(ppos);
            let rest = can_rest(run, mi, pos);
            run.monsters[mi].aim = aim;
            // The reach of an ability: a swing starts a little inside its real reach, a bolt from its
            // range, a slam from its radius. Movement follows the main ability.
            let reach = |a: &ResolvedAbility| match ab::def(a.id).shape {
                Shape::Swing => a.range + foe_radius - SWING_SLACK,
                Shape::Ring => a.radius,
                _ => a.range,
            };
            let main = *run.monsters[mi].kit.get(def.abilities[0]).expect("an enemy has its main ability");
            let (range, preferred) = (reach(&main), def.preferred);
            if let Some(&alt_id) = def.abilities.get(1) {
                // Second ability: a claw when the target is in reach, a bolt only from afar, a slam
                // when it is worth it.
                let alt = *run.monsters[mi].kit.get(alt_id).expect("an enemy has its alt ability");
                let alt_range = reach(&alt);
                let usable = match ab::def(alt_id).shape {
                    Shape::Swing => d <= alt_range,
                    Shape::Projectile => d <= alt_range && d >= enemies::ALT_BOLT_MIN_DIST && d > range,
                    // A slam is worth it for two heroes in reach, or one while the club recovers.
                    Shape::Ring => {
                        let near = run.foes_in(pos, alt.radius, None).len();
                        near >= 2 || near == 1 && run.monsters[mi].ai.cd > 0.0
                    }
                    // Vanish: the ambush module uses it, not the chase.
                    Shape::Buff => false,
                    shape => unreachable!("{alt_id:?} is a {shape:?}: an alt ability swings, shoots or slams"),
                };
                if usable && rest && run.monsters[mi].ai.alt_cd <= 0.0 && run.monsters[mi].cds.ready(alt_id) {
                    if ab::def(alt_id).shape == Shape::Ring {
                        // The slam's own wind-up runs in `monster_use`.
                        set_anim(run, mi, Anim::Slam);
                        perform_attack(run, mi, foe, true, None);
                    } else {
                        run.start_windup(mi, Windup { t: alt.windup, aim, alt: true, at: None });
                        set_anim(run, mi, Anim::Windup);
                    }
                    return;
                }
            }
            if d <= range && rest && run.monsters[mi].ai.cd <= 0.0 && run.monsters[mi].cds.ready(main.id) {
                let at = match ab::def(main.id).shape {
                    Shape::Projectile if !run.monsters[mi].is_boss => barrel_near(run, mi, ppos, main.range).map(Target::Object),
                    _ => None,
                };
                let aim = match at {
                    Some(Target::Object(id)) => run.objects.iter().find(|o| o.id == id).map_or(aim, |o| pos.angle_to(o.pos)),
                    _ => aim,
                };
                run.start_windup(mi, Windup { t: main.windup, aim, alt: false, at });
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
                if !can_rest(run, mi, home + off) {
                    run.monsters[mi].ai.wander_to = None; // a phantom does not wander into a wall
                }
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

/// A swing starts this far (px) inside its reach, so it still lands on a foe who steps back during the wind-up.
pub(crate) const SWING_SLACK: f64 = 4.0;

/// The AI waits up to this share of a shot's cooldown on top of it, so a group never fires in step and
/// the AI is never faster than the ability.
const SHOT_PACE_JITTER: f64 = 0.3;

/// Uses the enemy's main ability, or its alt one (`alt`) with its own cooldown, at the foe (or at `at`,
/// a barrel). Either one also keeps the other back for a moment, so they never land at once.
pub(crate) fn perform_attack(run: &mut Run, mi: usize, foe: Creature, alt: bool, at: Option<Vec2>) {
    let etype = run.monsters[mi].etype.expect("only enemies attack through the AI");
    let id = enemies::def(etype).abilities[alt as usize];
    let target = at.unwrap_or_else(|| run.creature_pos(foe));
    if !monster_use(run, mi, id, target) {
        return;
    }
    let a = *run.monsters[mi].kit.get(id).expect("monster_use found it");
    let pace = if ab::def(id).shape == Shape::Projectile { a.cooldown * (1.0 + run.rng.gen_range(0.0..SHOT_PACE_JITTER)) } else { a.cooldown };
    let ai = &mut run.monsters[mi].ai;
    if alt {
        ai.alt_cd = pace;
        ai.cd = ai.cd.max(ATTACK_GAP);
    } else {
        ai.cd = pace;
        ai.alt_cd = ai.alt_cd.max(ATTACK_GAP);
    }
}

/// Push overlapping monsters apart so groups don't stack on one spot.
pub fn separate_monsters(run: &mut Run) {
    let n = run.monsters.len();
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
                let solids = run.solids_for(mover, None);
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
    use crate::defs::abilities::AbilityId;
    use super::*;
    use crate::defs::damage::Damage;
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
            perform_attack(&mut run, mi, Creature::Player(0), false, None);
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
            perform_attack(&mut run, mi, Creature::Player(0), alt, None);
            // A slam lands after its wind-up.
            while run.monsters[mi].slam.is_some() {
                tick_monster_slam(&mut run, mi, crate::run::DT);
            }
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

    /// The radius of the ogre's Ground Slam.
    pub(crate) fn slam_radius() -> f64 {
        crate::sheet::kit_for(crate::sheet::KitSource::Enemy(EnemyType::Ogre), &crate::defs::enemies::def(EnemyType::Ogre).attrs).get(ab::AbilityId::GroundSlam).unwrap().radius
    }

    #[test]
    fn ogre_slams_a_crowd_and_clubs_a_lone_hero() {
        let (mut run, mi) = ogre_among(&[Vec2::new(20.0, 0.0), Vec2::new(-16.0, 8.0)]);
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert!(run.monsters[mi].slam.is_some() && run.monsters[mi].ai.windup.is_none(), "two heroes near: slam (its wind-up runs in the use)");
        assert_eq!(run.monsters[mi].anim, Anim::Slam, "the slam has its own telegraph");

        let (mut run, mi) = ogre_among(&[Vec2::new(20.0, 0.0)]);
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert_eq!(run.monsters[mi].ai.windup.map(|w| w.alt), Some(false), "one hero, club ready: club");
        assert!(run.monsters[mi].slam.is_none());

        let (mut run, mi) = ogre_among(&[Vec2::new(20.0, 0.0)]);
        run.monsters[mi].ai.cd = 1.0;
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert!(run.monsters[mi].slam.is_some(), "one hero while the club recovers: slam");
    }

    #[test]
    fn ogre_slam_hits_and_pushes_every_hero_in_reach_away_from_it() {
        let r = slam_radius();
        let (mut run, mi) = ogre_among(&[Vec2::new(20.0, 0.0), Vec2::new(0.0, -(r - 2.0)), Vec2::new(-(r + 6.0), 0.0)]);
        let hp: Vec<f64> = run.players.iter().map(|p| p.hp).collect();
        run.events.clear();
        perform_attack(&mut run, mi, Creature::Player(0), true, None);
        assert!(run.players.iter().zip(&hp).all(|(p, &h)| p.hp == h), "nothing lands during the wind-up");
        while run.monsters[mi].slam.is_some() {
            tick_monster_slam(&mut run, mi, crate::run::DT);
        }
        let p = &run.players;
        assert!(p[0].hp < hp[0] && p[0].mv.knock_vx > 0.0 && p[0].mv.knock_vy.abs() < 1e-9, "east hero pushed east");
        assert!(p[1].hp < hp[1] && p[1].mv.knock_vy < 0.0 && p[1].mv.knock_vx.abs() < 1e-9, "north hero pushed north");
        assert!(p[2].hp == hp[2] && !p[2].mv.knocked(), "hero outside the radius is spared");
        assert!(run.events.iter().any(|e| matches!(e.0, Ev::Boom { k: 5, .. })), "shockwave event");
        assert!(run.monsters[mi].ai.alt_cd > 1.0, "slam cooldown started");
    }

    #[test]
    fn ogre_slam_leaves_barrels_alone() {
        use crate::run::objects::{Barrel, ObjState};
        let r = slam_radius();
        let (mut run, mi) = ogre_among(&[Vec2::new(20.0, 0.0)]);
        run.objects.retain(|o| o.kind != EntityKind::Barrel);
        let at = run.monsters[mi].pos;
        run.spawn_object(EntityKind::Barrel, at + Vec2::new(0.0, r), ObjState::Barrel(Barrel::new()));
        run.spawn_object(EntityKind::Barrel, at + Vec2::new(0.0, -(r + 10.0)), ObjState::Barrel(Barrel::new()));
        perform_attack(&mut run, mi, Creature::Player(0), true, None);
        while run.monsters[mi].slam.is_some() {
            tick_monster_slam(&mut run, mi, crate::run::DT);
        }
        let lit: Vec<bool> = run.objects.iter().filter(|o| o.kind == EntityKind::Barrel).map(|o| matches!(&o.state, ObjState::Barrel(b) if b.fuse.is_some())).collect();
        assert_eq!(lit, vec![false, false], "a slam hits no objects, whoever uses it (the club's swing does)");
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
        assert!(ai.alt_cd >= 2.0, "bolt cooldown started");
        assert!(ai.cd < 1.0, "claw cooldown untouched (only the short gap)");
    }

    /// A run with a necromancer 60 px from the hero and nothing else but the boss.
    fn necro_in_sight() -> (Run, u32, usize) {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        open_floor(&mut run);
        let ppos = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let id = run.spawn_enemy(EnemyType::Necromancer, ppos + Vec2::new(60.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        (run, id, mi)
    }

    fn raised(run: &Run, id: u32) -> usize {
        run.monsters.iter().filter(|m| m.owner == Some(id) && m.alive).count()
    }

    #[test]
    fn a_necromancer_that_sees_a_hero_winds_up_then_raises() {
        let (mut run, id, mi) = necro_in_sight();
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert!(matches!(run.monsters[mi].ai.cast, Some((AbilityId::RaiseDead, _))));
        assert_eq!(run.monsters[mi].anim, Anim::Windup);
        assert_eq!(raised(&run, id), 0);
        let mut ticks = 0;
        while run.monsters[mi].ai.cast.is_some() {
            tick_monster(&mut run, mi, 1.0 / 60.0);
            ticks += 1;
        }
        assert!((41..=43).contains(&ticks), "0.7 s of wind-up: {ticks} ticks");
        assert_eq!(raised(&run, id), 2);
        assert_eq!(run.monsters[mi].anim, Anim::Cast);
        assert!(run.monsters[mi].aim.cos() < 0.0, "still facing the hero, to its west: {}", run.monsters[mi].aim);
    }

    #[test]
    fn a_necromancer_at_its_limit_does_not_wind_up_a_raise() {
        let (mut run, id, mi) = necro_in_sight();
        let pos = run.monsters[mi].pos;
        for t in [EnemyType::RaisedSkeleton, EnemyType::RaisedArcher, EnemyType::RaisedSkeleton, EnemyType::RaisedArcher] {
            run.spawn_enemy(t, pos, Some(id));
        }
        let mut aimed = false;
        // Past its short opening gap, so it has time to start a shot.
        for _ in 0..120 {
            tick_monster(&mut run, mi, 1.0 / 60.0);
            assert_eq!(run.monsters[mi].ai.cast, None);
            aimed |= run.monsters[mi].ai.windup.is_some();
        }
        assert!(aimed, "it winds up a shot instead");
        assert_eq!(raised(&run, id), 4);
    }

    #[test]
    fn a_necromancer_killed_during_the_wind_up_raises_nothing() {
        let (mut run, id, mi) = necro_in_sight();
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert!(run.monsters[mi].ai.cast.is_some());
        run.kill_monster(mi);
        for _ in 0..60 {
            run.step();
        }
        assert_eq!(raised(&run, id), 0);
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

    /// An orc turned into a phantom: the phasing trait and mover a ghost gets from its race.
    pub(crate) fn make_phantom(run: &mut Run, mi: usize) {
        run.monsters[mi].traits.phasing = true;
        run.monsters[mi].mover = Mover::Incorporeal;
    }

    #[test]
    fn phasing_path_goes_straight_through_a_wall() {
        let mut m = Map::new(12, 7);
        for y in 1..6 {
            for x in 1..11 {
                m.set(x, y, if x == 5 { Tile::Wall } else { Tile::Floor });
            }
        }
        let (from, to) = (Map::center_of(2, 3), Map::center_of(8, 3));
        assert!(m.blocks(5, 3, Mover::Enemy));
        let p = astar(&m, from, to, 1000, Mover::Incorporeal).unwrap();
        assert!(p.iter().all(|w| Map::tile_of(*w).1 == 3), "a straight run: {p:?}");
        assert_eq!(p.len(), 6);
    }

    #[test]
    fn phasing_monster_passes_through_a_barrel() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let p = run.players[0].pos();
        // The barrel sits right in the orc's way to the hero.
        let id = run.spawn_enemy(EnemyType::OrcWarrior, p - Vec2::new(120.0, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        make_phantom(&mut run, mi);
        let barrel = p - Vec2::new(70.0, 0.0);
        run.spawn_object(EntityKind::Barrel, barrel, crate::run::objects::ObjState::Barrel(crate::run::objects::Barrel::new()));
        let mut passed = false;
        for _ in 0..600 {
            tick_monster(&mut run, mi, 1.0 / 60.0);
            passed |= run.monsters[mi].pos.x > barrel.x + 10.0;
        }
        assert!(passed, "x {} barrel {}", run.monsters[mi].pos.x, barrel.x);
    }

    /// The solid object kinds the run can spawn: every `EntityKind` with a solid object definition, so a new
    /// obstacle is covered without touching the test (a new solid kind needs a state here).
    fn solid_object_kinds() -> Vec<(EntityKind, crate::run::objects::ObjState)> {
        use crate::run::objects::{Barrel, ObjState};
        let mut out = Vec::new();
        for &k in EntityKind::ALL.iter() {
            // `def` panics for kinds that are not objects.
            let Ok(d) = std::panic::catch_unwind(|| crate::defs::objects::def(k)) else { continue };
            if !d.solid {
                continue;
            }
            let state = match k {
                EntityKind::Barrel => ObjState::Barrel(Barrel::new()),
                _ => panic!("{k:?} is a solid object: give it a state in this test"),
            };
            out.push((k, state));
        }
        assert!(!out.is_empty());
        out
    }

    #[test]
    fn phaser_passes_every_blocking_object() {
        for (kind, state) in solid_object_kinds() {
            let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
            open_floor(&mut run);
            run.monsters.retain(|m| m.is_boss);
            let p = run.players[0].pos();
            let id = run.spawn_enemy(EnemyType::OrcWarrior, p - Vec2::new(120.0, 0.0), None);
            let mi = run.monster_idx(id).unwrap();
            make_phantom(&mut run, mi);
            let at = p - Vec2::new(70.0, 0.0);
            let oi = run.objects.len();
            run.spawn_object(kind, at, state);
            assert!(run.objects[oi].blocks(), "{kind:?} blocks");
            // Solid to a walker, nothing to a phaser.
            assert!(!run.solids_for(Mover::Enemy, None).is_empty(), "{kind:?}");
            assert!(!run.object_tiles_for(Mover::Enemy).is_empty(), "{kind:?}");
            assert!(run.solids_for(Mover::Incorporeal, None).is_empty(), "{kind:?}");
            assert!(run.object_tiles_for(Mover::Incorporeal).is_empty(), "{kind:?}");
            let mut passed = false;
            for _ in 0..600 {
                tick_monster(&mut run, mi, 1.0 / 60.0);
                passed |= run.monsters[mi].pos.x > at.x + 10.0;
            }
            assert!(passed, "{kind:?}: x {} object {}", run.monsters[mi].pos.x, at.x);
        }
    }

    #[test]
    fn phasing_monster_never_attacks_from_a_wall() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let ppos = run.players[0].pos();
        let (tx, ty) = Map::tile_of(ppos);
        for dy in -2..=2 {
            run.layout.map.set(tx + 1, ty + dy, Tile::Wall);
        }
        let id = run.spawn_enemy(EnemyType::OrcWarrior, Vec2::new((tx + 1) as f64 * TILE + 2.0, ppos.y), None);
        let mi = run.monster_idx(id).unwrap();
        make_phantom(&mut run, mi);
        run.monsters[mi].ai.cd = 0.0;
        let mut attacked = false;
        for tick in 0..120 {
            tick_monster(&mut run, mi, 1.0 / 60.0);
            let m = &run.monsters[mi];
            let in_wall = !run.layout.map.can_stop_at(m.pos, m.mover);
            assert!(!(in_wall && m.ai.windup.is_some()), "tick {tick}: wind-up inside the wall");
            if tick == 60 {
                assert!(!in_wall, "out of the wall within a second");
            }
            attacked |= m.ai.windup.is_some();
        }
        assert!(attacked, "then it attacks");
    }

    #[test]
    fn a_slowed_phaser_leaves_a_wall_at_the_slowed_speed_once() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let ppos = run.players[0].pos();
        let (tx, ty) = Map::tile_of(ppos);
        for dy in -3..=3 {
            for dx in 1..=4 {
                run.layout.map.set(tx + dx, ty + dy, Tile::Wall);
            }
        }
        let at = Vec2::new((tx + 3) as f64 * TILE + 8.0, ppos.y);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, at, None);
        let mi = run.monster_idx(id).unwrap();
        make_phantom(&mut run, mi);
        run.monsters[mi].effects.add(EffectKind::Slowed, 30.0);
        let (mul, speed) = (run.monsters[mi].effects.speed_mul(), run.monsters[mi].speed.max(20.0));
        assert!(mul < 1.0);
        let before = run.monsters[mi].pos;
        leave_wall(&mut run, mi, 1.0 / 60.0);
        let moved = run.monsters[mi].pos.dist(before);
        assert!((moved - speed * mul / 60.0).abs() < 1e-6, "moved {moved}, want {}", speed * mul / 60.0);
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

    #[test]
    fn monsters_ignore_invisible_heroes() {
        use crate::defs::effects::EffectKind;
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        run.lights.fill();
        let ppos = run.players[0].pos();
        let id = run.spawn_enemy(EnemyType::SkeletonWarrior, ppos + Vec2::new(4.0 * TILE, 0.0), None);
        let mi = run.monster_idx(id).unwrap();
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert!(run.monsters[mi].ai.target.is_some(), "a hero in clear sight is seen");
        // Invisible: the chase becomes a search of the last known spot.
        run.players[0].effects.add(EffectKind::Invisible, 30.0);
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert_eq!(run.monsters[mi].ai.target, None);
        assert_eq!(run.monsters[mi].ai.state, AiState::Search);
        assert_eq!(run.monsters[mi].ai.last_known, ppos);
        assert_eq!(find_visible_foe(&run, run.monsters[mi].pos, run.monsters[mi].sight_now()), None);
        // And never targeted afresh while it lasts.
        run.monsters[mi].ai.state = AiState::Idle;
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert_eq!(run.monsters[mi].ai.target, None);
        run.players[0].effects.remove(EffectKind::Invisible);
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert!(run.monsters[mi].ai.target.is_some(), "seen again once it ends");
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
        let from = ppos + Vec2::new(TILE, 0.0);
        crate::run::tests::enemy_use(&mut run, EnemyType::Imp, from, AbilityId::FireBolt, from + Vec2::new(0.0, 100.0));
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
