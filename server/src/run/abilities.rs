//! Player abilities (one executor per AbilityId) and projectile simulation.

use super::entities::{AiState, Projectile};
use super::{Run, TICK_HZ};
use crate::collision::line_of_sight;
use crate::defs::abilities::{self as ab, AbilityId};
use crate::defs::classes::PLAYER_RADIUS;
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
        .filter(|(_, m)| m.alive)
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
                run.hurt_monster(mi, ab::DAGGER_DAMAGE * mult, crit, Some(pi));
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
                if m.ai.target == Some(pid) {
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
    let hits: Vec<usize> = run
        .monsters
        .iter()
        .enumerate()
        .filter(|(_, m)| {
            if !m.alive {
                return false;
            }
            let mp = m.pos_ago(rw);
            let d = mp.dist(pos);
            if d > range + m.radius {
                return false;
            }
            let in_arc = angle_diff(pos.angle_to(mp), aim).abs() <= arc / 2.0 || d < m.radius + PLAYER_RADIUS;
            in_arc && line_of_sight(&run.dungeon.map, pos, mp)
        })
        .map(|(i, _)| i)
        .collect();
    for mi in hits {
        run.hurt_monster(mi, damage, crit, Some(pi));
    }
}

/// Barbarian dash: damage each monster touched once per dash.
pub fn dash_contact(run: &mut Run, pi: usize) {
    let rw = rewind_ticks(run, pi);
    let pos = run.players[pi].pos();
    let dmg = ab::def(AbilityId::Dash).damage * run.players[pi].mods.damage;
    let hits: Vec<(usize, u32)> = run
        .monsters
        .iter()
        .enumerate()
        .filter(|(_, m)| m.alive && !run.players[pi].dash_hit.contains(&m.id) && m.pos_ago(rw).dist(pos) < PLAYER_RADIUS + m.radius + 4.0)
        .map(|(i, m)| (i, m.id))
        .collect();
    for (mi, id) in hits {
        run.players[pi].dash_hit.push(id);
        run.hurt_monster(mi, dmg, false, Some(pi));
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
    let start = p.pos() + dir * 6.0;
    // Fast-forward by half the round trip: the client already shows it moving.
    let ff = (p.rtt / 2.0).min(0.15);
    let vel = dir * speed;
    let ahead = start + vel * ff;
    let pos = if line_of_sight(&run.dungeon.map, p.pos(), ahead) { ahead } else { start };
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
        target,
        dead: false,
    });
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
        damage,
        radius: 3.0,
        life,
        crit: false,
        explode_r,
        explode_k,
        target: None,
        dead: false,
    });
}

pub fn tick_projectiles(run: &mut Run, dt: f64) {
    for i in 0..run.projectiles.len() {
        if run.projectiles[i].dead {
            continue;
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
            if run.dungeon.map.solid_at(pos) {
                impact(run, i, prev, None);
                break;
            }
            let pr = &run.projectiles[i];
            if pr.from_player {
                let hit = run.monsters.iter().position(|m| m.alive && m.pos.dist(pos) < m.radius + pr.radius);
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

/// Projectile `i` hits something at `pos` (target index on the opposing team, if any).
fn impact(run: &mut Run, i: usize, pos: Vec2, target: Option<usize>) {
    let pr = &mut run.projectiles[i];
    pr.dead = true;
    let (from_player, owner, damage, crit, explode_r, k) = (pr.from_player, pr.owner, pr.damage, pr.crit, pr.explode_r, pr.explode_k);
    let src = if from_player { run.player_idx(owner) } else { None };
    if explode_r > 0.0 {
        explode(run, pos, explode_r, damage, from_player, src, k, crit);
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

#[allow(clippy::too_many_arguments)]
pub fn explode(run: &mut Run, pos: Vec2, r: f64, damage: f64, from_player: bool, src: Option<usize>, k: u8, crit: bool) {
    run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: r as f32, k }, Some(pos));
    if from_player {
        let hits: Vec<usize> = run
            .monsters
            .iter()
            .enumerate()
            .filter(|(_, m)| m.alive && m.pos.dist(pos) < r + m.radius && line_of_sight(&run.dungeon.map, pos, m.pos))
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
            .filter(|(_, p)| p.alive && p.pos().dist(pos) < r + PLAYER_RADIUS && line_of_sight(&run.dungeon.map, pos, p.pos()))
            .map(|(i, _)| i)
            .collect();
        for qi in hits {
            run.hurt_player(qi, damage);
        }
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
    fn cooldown_is_enforced() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        try_use(&mut run, 0, AbilityId::MagicMissile, 1, true);
        try_use(&mut run, 0, AbilityId::MagicMissile, 2, true);
        assert_eq!(run.projectiles.len(), 1);
    }
}
