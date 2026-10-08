//! Per-player snapshots. Each player only receives monsters, projectiles,
//! hazards and positional events inside their own field of vision.

use super::Run;
use crate::defs::kinds::{flags, EntityKind};
use crate::dungeon::Map;
use crate::fov::{Fov, PLAYER_FOV_RADIUS};
use crate::math::Vec2;
use crate::protocol::{BossBar, EntSnap, Ev, SelfState, Snapshot};
use crate::wire::encode_snap;

fn visible(fov: &Fov, p: Vec2, radius: f64) -> bool {
    let (x, y) = Map::tile_of(p);
    if fov.is_visible(x, y) {
        return true;
    }
    if radius > 8.0 {
        // Large figures: visible if any part of them is.
        let r = radius * 0.8;
        for (dx, dy) in [(-r, -r), (r, -r), (-r, r), (r, r)] {
            let (x, y) = Map::tile_of(p + Vec2::new(dx, dy));
            if fov.is_visible(x, y) {
                return true;
            }
        }
    }
    false
}

fn ms_since(run: &Run, t: f64) -> u16 {
    ((run.time - t) * 1000.0).clamp(0.0, 65535.0) as u16
}

fn hp_byte(hp: f64, max: f64) -> u8 {
    ((hp / max).clamp(0.0, 1.0) * 255.0).round() as u8
}

pub fn send_snapshots(run: &mut Run) {
    let events = std::mem::take(&mut run.events);
    let boss_immune = run.boss.as_ref().map_or(false, |b| !b.can_be_damaged(run));
    let boss_enraged = run.boss.as_ref().map_or(false, |b| b.enraged());
    let boss_bar = if run.boss_awake {
        let (hp, max) = run.monsters.iter().find(|m| m.id == run.boss_ent).map_or((0.0, 1.0), |m| (m.hp, m.max_hp));
        Some(BossBar { kind: run.boss_id, hp: hp as f32, max_hp: max as f32, immune: boss_immune, enraged: boss_enraged })
    } else {
        None
    };

    // Players are always visible to their party.
    let player_snaps: Vec<EntSnap> = run
        .players
        .iter()
        .map(|p| {
            let mut f = 0;
            if p.hidden > 0.0 {
                f |= flags::HIDDEN;
            }
            if p.hurt_t > 0.0 {
                f |= flags::HURT;
            }
            if !p.alive {
                f |= flags::DEAD;
            }
            EntSnap(p.id, p.kind() as u8, p.mv.x as f32, p.mv.y as f32, hp_byte(p.hp, p.max_hp), p.anim as u8, p.aim as f32, ms_since(run, p.anim_start), f, 0)
        })
        .collect();

    for pi in 0..run.players.len() {
        if run.players[pi].tx.is_none() {
            continue;
        }
        let me = &run.players[pi];
        let view_pos = if me.alive {
            me.pos()
        } else {
            me.spectating.and_then(|s| run.players.iter().find(|q| q.id == s)).map_or(me.pos(), |q| q.pos())
        };
        let mut fov = std::mem::replace(&mut run.players[pi].fov, Fov::new(0, 0));
        let (tx, ty) = Map::tile_of(view_pos);
        fov.compute(&run.dungeon.map, tx, ty, PLAYER_FOV_RADIUS);

        let mut ents = player_snaps.clone();
        for m in &run.monsters {
            if !m.alive || !visible(&fov, m.pos, m.radius) {
                continue;
            }
            let mut f = 0;
            if m.hurt_t > 0.0 {
                f |= flags::HURT;
            }
            if m.asleep {
                f |= flags::ASLEEP;
            }
            if m.is_boss && boss_immune {
                f |= flags::IMMUNE;
            }
            if m.is_boss && boss_enraged {
                f |= flags::ENRAGED;
            }
            let extra = m.owner.unwrap_or(0);
            ents.push(EntSnap(m.id, m.kind as u8, m.pos.x as f32, m.pos.y as f32, hp_byte(m.hp, m.max_hp), m.anim as u8, m.aim as f32, ms_since(run, m.anim_start), f, extra));
        }
        for pr in &run.projectiles {
            if pr.dead || !visible(&fov, pr.pos, 0.0) {
                continue;
            }
            let extra = (pr.owner << 16) | pr.shot as u32;
            ents.push(EntSnap(pr.id, pr.kind as u8, pr.pos.x as f32, pr.pos.y as f32, 255, 0, pr.vel.angle() as f32, 0, 0, extra));
        }
        // Chests: anim 1 once opened, with the time since.
        for c in &run.chests {
            if !visible(&fov, c.pos, 0.0) {
                continue;
            }
            let (anim, since) = c.opened.map_or((0, 0), |t| (1, ms_since(run, t)));
            ents.push(EntSnap(c.id, EntityKind::Chest as u8, c.pos.x as f32, c.pos.y as f32, 255, anim, 0.0, since, 0, 0));
        }
        for h in &run.hazards {
            if !visible(&fov, h.pos, h.radius) {
                continue;
            }
            let extra = (h.life * 1000.0) as u32;
            ents.push(EntSnap(h.id, h.kind as u8, h.pos.x as f32, h.pos.y as f32, 255, 0, 0.0, 0, 0, extra));
        }
        let ev: Vec<Ev> = events.iter().filter(|(_, at)| at.map_or(true, |p| visible(&fov, p, 0.0))).map(|(e, _)| e.clone()).collect();

        let me = &run.players[pi];
        let snap = Snapshot {
            tick: run.tick,
            ack: me.ack,
            ents,
            me: SelfState {
                alive: me.alive,
                hp: me.hp as f32,
                max_hp: me.max_hp as f32,
                x: me.mv.x,
                y: me.mv.y,
                dash_t: me.mv.dash_t,
                dash_dx: me.mv.dash_dx,
                dash_dy: me.mv.dash_dy,
                cd1: me.cd1 as f32,
                cd2: me.cd2 as f32,
                hidden: me.hidden as f32,
                spectating: if me.alive { None } else { me.spectating },
            },
            boss: boss_bar.clone(),
            ev,
            srv_ms: run.srv_ms,
        };
        run.players[pi].fov = fov;
        if let Some(tx) = &run.players[pi].tx {
            let _ = tx.send(axum::extract::ws::Message::Binary(encode_snap(&snap).into()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::enemies::EnemyType;
    use crate::protocol::{BossId, ClassId};
    use crate::run::tests::test_run;

    #[test]
    fn monsters_outside_fov_are_not_sent() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let ppos = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let near = run.spawn_enemy(EnemyType::GoblinArcher, ppos + Vec2::new(20.0, 0.0), None, 1);
        let far = run.spawn_enemy(EnemyType::GoblinArcher, ppos + Vec2::new(16.0 * 30.0, 0.0), None, 1);
        let (tx, ty) = Map::tile_of(ppos);
        run.players[0].fov.compute(&run.dungeon.map, tx, ty, PLAYER_FOV_RADIUS);
        let fov = &run.players[0].fov;
        let near_m = run.monsters.iter().find(|m| m.id == near).unwrap();
        let far_m = run.monsters.iter().find(|m| m.id == far).unwrap();
        assert!(visible(fov, near_m.pos, near_m.radius));
        assert!(!visible(fov, far_m.pos, far_m.radius));
    }
}
