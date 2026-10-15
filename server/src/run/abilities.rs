//! Player abilities (one executor per AbilityId) and projectile simulation.

use super::entities::{AiState, Projectile, Target};
use super::{Run, TICK_HZ};
use crate::collision::line_of_sight;
use crate::defs::abilities::{self as ab, AbilityId};
use crate::defs::classes::PLAYER_RADIUS;
use crate::defs::damage::{kind_split, Damage};
use crate::defs::kinds::{Anim, EntityKind};
use crate::math::{angle_diff, Vec2};
use crate::protocol::Ev;

/// Cooldowns tick per processed input on both client and server; a small
/// tolerance absorbs rounding differences.
const COOLDOWN_LEEWAY: f64 = 0.05;

/// How many ticks to rewind monsters for this player's hit checks.
fn rewind_ticks(run: &Run, pi: usize) -> usize {
    ((run.players[pi].view_lag * TICK_HZ).round() as usize).min(super::entities::HISTORY_LEN - 1)
}

/// The dagger is used instead of the crossbow when a monster is this close.
pub fn dagger_target(run: &Run, pi: usize) -> Option<usize> {
    let rw = rewind_ticks(run, pi);
    let pos = run.players[pi].pos();
    run.monsters
        .iter()
        .enumerate()
        .filter(|(_, m)| m.alive && !m.airborne)
        .map(|(i, m)| (i, m.pos_ago(rw).dist(pos) - m.radius))
        .filter(|&(_, d)| d <= ab::DAGGER_RANGE)
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(i, _)| i)
}

pub fn try_use(run: &mut Run, pi: usize, id: AbilityId, shot: u16, primary: bool) {
    let cd = if primary { run.players[pi].cd1 } else { run.players[pi].cd2 };
    if cd > COOLDOWN_LEEWAY || !run.players[pi].alive {
        return;
    }
    let def = ab::def(id);
    let (pos, aim, aim_dist, hidden) = {
        let p = &run.players[pi];
        (p.pos(), p.aim, p.aim_dist, p.hidden > 0.0)
    };
    let dir = Vec2::from_angle(aim);
    let attack = !matches!(id, AbilityId::Heal | AbilityId::Hide);
    let crit = hidden && attack;
    let mult = (if crit { ab::HIDDEN_CRIT_MULT } else { 1.0 }) * run.players[pi].mods.damage;
    let mut cooldown = def.cooldown;
    let anim = match id {
        AbilityId::MagicMissile => {
            spawn_player_projectile(run, pi, EntityKind::Missile, shot, dir, def.speed, def.damage * mult, def.radius, def.range / def.speed, 0.0, None, crit);
            Anim::Shoot
        }
        AbilityId::Fireball => {
            let target = pos + dir * aim_dist.clamp(24.0, def.range);
            let life = def.range / def.speed + 0.1;
            spawn_player_projectile(run, pi, EntityKind::Fireball, shot, dir, def.speed, def.damage * mult, 4.0, life, def.radius, Some(target), crit);
            Anim::Cast
        }
        AbilityId::Sword | AbilityId::Axe => {
            melee_arc(run, pi, def.range, def.arc, def.damage * mult, crit);
            Anim::Melee
        }
        AbilityId::Heal => {
            run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: def.radius as f32, k: 1 }, Some(pos));
            let mut total = 0.0;
            for qi in 0..run.players.len() {
                let q = &run.players[qi];
                if q.alive && q.pos().dist(pos) <= def.radius {
                    total += run.heal_player(qi, def.damage);
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
            if let Some(mi) = dagger_target(run, pi) {
                cooldown = ab::DAGGER_COOLDOWN;
                run.hurt_monster(mi, Damage::new(ab::DAGGER_DAMAGE * mult, run.players[pi].melee), crit, Some(pi));
                Anim::Melee
            } else {
                spawn_player_projectile(run, pi, EntityKind::Bolt, shot, dir, def.speed, def.damage * mult, def.radius, def.range / def.speed, 0.0, None, crit);
                Anim::Shoot
            }
        }
        AbilityId::Hide => {
            let pid = run.players[pi].id;
            run.players[pi].hidden = def.duration;
            for m in &mut run.monsters {
                if m.ai.target == Some(Target::Player(pid)) {
                    m.ai.target = None;
                    m.ai.windup = None;
                    m.ai.state = AiState::Search;
                    m.ai.search_t = 1.5;
                    m.ai.path.clear();
                }
            }
            Anim::Cast
        }
    };
    let p = &mut run.players[pi];
    let cooldown = cooldown / p.mods.attack_speed;
    if attack {
        p.hidden = 0.0;
    }
    if primary {
        p.cd1 = cooldown;
    } else {
        p.cd2 = cooldown;
    }
    p.anim = anim;
    p.anim_start = run.time;
}

fn melee_arc(run: &mut Run, pi: usize, range: f64, arc: f64, damage: f64, crit: bool) {
    let rw = rewind_ticks(run, pi);
    let (pos, aim) = (run.players[pi].pos(), run.players[pi].aim);
    let dmg = Damage::new(damage, run.players[pi].melee);
    let hits: Vec<usize> = run
        .monsters
        .iter()
        .enumerate()
        .filter(|(_, m)| {
            // Flying monsters are out of reach of melee.
            if !m.alive || m.airborne {
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
    let dmg = Damage::new(ab::def(AbilityId::Dash).damage * run.players[pi].mods.damage, run.players[pi].melee);
    let hits: Vec<(usize, u32)> = run
        .monsters
        .iter()
        .enumerate()
        .filter(|(_, m)| m.alive && !m.airborne && !run.players[pi].dash_hit.contains(&m.id) && m.pos_ago(rw).dist(pos) < PLAYER_RADIUS + m.radius + 4.0)
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
        damage: Damage::new(damage, kind_split(kind)),
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
        damage: Damage::new(damage, kind_split(kind)),
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
                impact(run, i, pos, None);
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
        if let Some(oi) = run.objects.iter().position(|o| o.blocks() && o.pos.dist(pos) < o.radius + r) {
            impact_object(run, i, pos, oi);
            break;
        }
        let pr = &run.projectiles[i];
        if pr.from_player {
            let hit = run.monsters.iter().position(|m| m.alive && m.shot_dist(pos) < m.radius + pr.radius);
            if let Some(mi) = hit {
                impact(run, i, pos, Some(mi));
                break;
            }
        } else {
            let hit = run.players.iter().position(|p| p.alive && p.pos().dist(pos) < PLAYER_RADIUS + pr.radius);
            if let Some(qi) = hit {
                impact(run, i, pos, Some(qi));
                break;
            }
        }
    }
}

/// Projectile `i` hits something at `pos` (target index on the opposing team, if any).
fn impact(run: &mut Run, i: usize, pos: Vec2, target: Option<usize>) {
    let pr = &mut run.projectiles[i];
    pr.dead = true;
    let (from_player, owner, damage, crit, explode_r, k, knock) = (pr.from_player, pr.owner, pr.damage, pr.crit, pr.explode_r, pr.explode_k, pr.knock);
    let src = if from_player { run.player_idx(owner) } else { None };
    if explode_r > 0.0 {
        explode(run, pos, explode_r, damage, from_player, src, k, crit, knock);
        return;
    }
    if let Some(t) = target {
        if from_player {
            run.hurt_monster(t, damage, crit, src);
        } else {
            run.hurt_player(t, damage);
        }
    }
}

/// Projectile `i` hits a solid object: an explosion goes off there, a plain shot hurts the object.
fn impact_object(run: &mut Run, i: usize, pos: Vec2, oi: usize) {
    let pr = &mut run.projectiles[i];
    pr.dead = true;
    let (from_player, owner, damage, crit, explode_r, k, knock) = (pr.from_player, pr.owner, pr.damage, pr.crit, pr.explode_r, pr.explode_k, pr.knock);
    if explode_r > 0.0 {
        let src = if from_player { run.player_idx(owner) } else { None };
        explode(run, pos, explode_r, damage, from_player, src, k, crit, knock);
    } else {
        crate::run::objects::hurt_object(run, oi, damage, from_player.then_some(owner));
    }
}

#[allow(clippy::too_many_arguments)]
/// An explosion; `knock` pushes the heroes it hits straight away from it (px, enemy explosions only).
pub fn explode(run: &mut Run, pos: Vec2, r: f64, damage: Damage, from_player: bool, src: Option<usize>, k: u8, crit: bool, knock: f64) {
    // The heroes see their own explosions even out of view.
    run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: r as f32, k }, (!from_player).then_some(pos));
    if from_player {
        let hits: Vec<usize> = run
            .monsters
            .iter()
            .enumerate()
            .filter(|(_, m)| m.alive && m.pos.dist(pos) < r + m.radius && line_of_sight(&run.layout.map, pos, m.pos))
            .map(|(i, _)| i)
            .collect();
        for mi in hits {
            run.hurt_monster(mi, damage, crit, src);
        }
    } else {
        let hits: Vec<usize> = run
            .players
            .iter()
            .enumerate()
            .filter(|(_, p)| p.alive && p.pos().dist(pos) < r + PLAYER_RADIUS && line_of_sight(&run.layout.map, pos, p.pos()))
            .map(|(i, _)| i)
            .collect();
        for qi in hits {
            run.hurt_player(qi, damage);
            run.knock_player(qi, pos, 0.0, knock);
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
    fn assassin_uses_dagger_in_melee_range_and_crossbow_otherwise() {
        let mut run = test_run(&[ClassId::Assassin], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 10.0);
        let hp = run.monsters[mi].hp;
        try_use(&mut run, 0, AbilityId::CrossbowDagger, 1, true);
        assert!(run.monsters[mi].hp < hp, "dagger hit immediately");
        assert!(run.projectiles.is_empty(), "no bolt fired");
        assert_eq!(run.players[0].cd1, ab::DAGGER_COOLDOWN);

        let mut run = test_run(&[ClassId::Assassin], BossId::Demon);
        put_monster_near(&mut run, 0, 60.0);
        try_use(&mut run, 0, AbilityId::CrossbowDagger, 1, true);
        assert_eq!(run.projectiles.len(), 1, "crossbow bolt fired");
        assert_eq!(run.projectiles[0].kind, EntityKind::Bolt);
    }

    #[test]
    fn hidden_attack_crits_times_four_and_breaks_stealth() {
        let mut run = test_run(&[ClassId::Assassin], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 10.0);
        run.monsters[mi].hp = 1000.0;
        try_use(&mut run, 0, AbilityId::Hide, 1, false);
        assert!(run.players[0].hidden > 0.0);
        try_use(&mut run, 0, AbilityId::CrossbowDagger, 2, true);
        assert_eq!(run.monsters[mi].hp, 1000.0 - ab::DAGGER_DAMAGE * ab::HIDDEN_CRIT_MULT);
        assert_eq!(run.players[0].hidden, 0.0);
        // Not hidden: normal damage.
        run.players[0].cd1 = 0.0;
        try_use(&mut run, 0, AbilityId::CrossbowDagger, 3, true);
        assert_eq!(run.monsters[mi].hp, 1000.0 - ab::DAGGER_DAMAGE * (ab::HIDDEN_CRIT_MULT + 1.0));
    }

    #[test]
    fn melee_cannot_reach_a_flying_monster() {
        // Sword arc.
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        let mi = put_monster_near(&mut run, 0, 12.0);
        run.monsters[mi].airborne = true;
        let hp = run.monsters[mi].hp;
        try_use(&mut run, 0, AbilityId::Sword, 1, true);
        assert_eq!(run.monsters[mi].hp, hp, "the sword misses it in the air");
        run.monsters[mi].airborne = false;
        run.players[0].cd1 = 0.0;
        try_use(&mut run, 0, AbilityId::Sword, 2, true);
        assert!(run.monsters[mi].hp < hp, "and hits it on the ground");

        // Dagger: the assassin shoots the crossbow instead.
        let mut run = test_run(&[ClassId::Assassin], BossId::Demon);
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
        explode(&mut run, at, 30.0, Damage::physical(5.0), false, None, 4, false, 20.0);
        assert!(run.players[0].mv.knock_vx > 0.0, "pushed east, away from the blast");
        let mut run = test_run(&[ClassId::Paladin], BossId::Dragon);
        explode(&mut run, at, 30.0, Damage::physical(5.0), false, None, 4, false, 0.0);
        assert!(!run.players[0].mv.knocked(), "no knock: no push");
    }

    /// A player missile placed `dy` px north of the monster's feet, flying east past it.
    fn missile_past(run: &mut Run, mi: usize, dy: f64) {
        let at = run.monsters[mi].pos + Vec2::new(-6.0, -dy);
        assert!(!run.layout.map.opaque_at(at) && !run.layout.map.opaque_at(at + Vec2::new(12.0, 0.0)), "open floor for the test shot");
        spawn_player_projectile(run, 0, EntityKind::Missile, 1, Vec2::new(1.0, 0.0), 230.0, 5.0, 3.0, 1.0, 0.0, None, false);
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
            explode(&mut run, at, 20.0, Damage::new(10.0, kind_split(EntityKind::Fireball)), true, Some(0), 0, false, 0.0);
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
        try_use(&mut run, 0, AbilityId::MagicMissile, 1, true);
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
        explode(&mut run, at, 20.0, Damage::physical(5.0), true, Some(0), 0, false, 0.0);
        assert!(matches!(run.events[0], (Ev::Boom { .. }, None)), "the hero's explosion too");
        run.events.clear();
        run.hurt_monster(mi, Damage::physical(5.0), false, None);
        assert!(matches!(run.events[..], [(Ev::Dmg { .. }, Some(_))]), "other damage only where seen");
    }

    #[test]
    fn a_shot_stops_at_the_first_enemy_even_when_fast_forwarded() {
        for (class, ability) in [(ClassId::Wizard, AbilityId::MagicMissile), (ClassId::Assassin, AbilityId::CrossbowDagger)] {
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
                try_use(&mut run, 0, ability, 1, true);
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
        try_use(&mut run, 0, AbilityId::MagicMissile, 1, true);
        try_use(&mut run, 0, AbilityId::MagicMissile, 2, true);
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
                try_use(&mut run, 0, AbilityId::MagicMissile, 1, true);
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
        try_use(&mut run, 0, AbilityId::Sword, 1, true);
        let lit = |run: &Run| matches!(&run.objects.iter().find(|o| o.id == id).unwrap().state, crate::run::objects::ObjState::Barrel(b) if b.fuse.is_some());
        assert!(lit(&run));
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
        let id2 = run.spawn_object(EntityKind::Barrel, at, crate::run::objects::ObjState::Barrel(crate::run::objects::Barrel::new()));
        explode(&mut run, at + Vec2::new(10.0, 0.0), 20.0, Damage::physical(5.0), true, Some(0), 0, false, 0.0);
        assert!(matches!(&run.objects.iter().find(|o| o.id == id2).unwrap().state, crate::run::objects::ObjState::Barrel(b) if b.fuse.is_some()));
    }
}
