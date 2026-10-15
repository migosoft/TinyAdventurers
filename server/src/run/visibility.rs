//! Per-player snapshots. Each player only receives monsters, enemy projectiles,
//! objects, hazards and positional events that are inside their own field of
//! vision **and lit** (`run/light.rs`). Always sent: the party, their own shots,
//! party-wide events; events on a hero need sight only.

use super::levels::Level;
use super::Run;
use crate::defs::enemies::EnemyType;
use crate::defs::kinds::{flags, Anim, EntityKind};
use crate::defs::lights;
use crate::dungeon::{Map, TILE};
use crate::fov::{Fov, PLAYER_FOV_RADIUS};
use crate::math::Vec2;
use crate::protocol::{EntSnap, Ev, MovingLight, SelfState, Snapshot};
use crate::run::light::{reaches, Lights, Lit};
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

/// Lit by the static layer or a moving light.
fn lit(lights: &Lights, moving: &[Lit], map: &Map, p: Vec2) -> bool {
    let (x, y) = Map::tile_of(p);
    lights.static_lit(x, y) || moving.iter().any(|l| reaches(map, l, p))
}

/// In the viewer's sight and lit (large figures: any part of them).
fn seen(fov: &Fov, lights: &Lights, moving: &[Lit], map: &Map, p: Vec2, radius: f64) -> bool {
    let at = |q: Vec2| {
        let (x, y) = Map::tile_of(q);
        fov.is_visible(x, y) && lit(lights, moving, map, q)
    };
    if at(p) {
        return true;
    }
    if radius > 8.0 {
        let r = radius * 0.8;
        return [(-r, -r), (r, -r), (-r, r), (r, r)].into_iter().any(|(dx, dy)| at(p + Vec2::new(dx, dy)));
    }
    false
}

/// Events: party-wide ones always; events on a hero where the hero is in
/// sight; the rest where they are seen (in sight and lit).
fn ev_seen(fov: &Fov, lights: &Lights, moving: &[Lit], map: &Map, at: Option<Vec2>, on_hero: bool) -> bool {
    match at {
        None => true,
        Some(p) if on_hero => visible(fov, p, 0.0),
        Some(p) => seen(fov, lights, moving, map, p, 0.0),
    }
}

/// Moving lights whose light can reach the viewer's sight; the colour only
/// when it is not the kind's default.
fn lights_for(view: Vec2, moving: &[Lit]) -> Vec<MovingLight> {
    let range = (PLAYER_FOV_RADIUS as f64 + 1.0) * TILE;
    moving
        .iter()
        .filter(|l| l.pos.dist(view) <= range + l.reach)
        .map(|l| MovingLight(l.pos.x as f32, l.pos.y as f32, l.kind as u8, (l.colour != lights::def(l.kind).colour).then_some(l.colour)))
        .collect()
}

/// Lich drain beams: the lich first, then its channelling disciples (see `Snapshot::drain`).
fn drain_points(run: &Run) -> Vec<Vec2> {
    let Some(lich) = run.monsters.iter().find(|m| m.alive && m.kind == EntityKind::Lich) else { return Vec::new() };
    let from = run.monsters.iter().filter(|m| m.alive && m.etype == Some(EnemyType::Disciple) && m.anim == Anim::Channel);
    std::iter::once(lich.pos).chain(from.map(|m| m.pos)).collect()
}

/// The drain beams for one player: during the boss fight, or while the lich or
/// any channelling disciple is in view, all of them, even the ends out of sight.
/// FOV only, not light: the beams are magic light and show in the dark.
fn drain_for(fov: &Fov, boss_awake: bool, pts: &[Vec2]) -> Option<Vec<(f32, f32)>> {
    (pts.len() > 1 && (boss_awake || pts.iter().any(|&p| visible(fov, p, 0.0)))).then(|| pts.iter().map(|p| (p.x as f32, p.y as f32)).collect())
}

fn ms_since(run: &Run, t: f64) -> u16 {
    ((run.time - t) * 1000.0).clamp(0.0, 65535.0) as u16
}

fn hp_byte(hp: f64, max: f64) -> u8 {
    ((hp / max).clamp(0.0, 1.0) * 255.0).round() as u8
}

pub fn send_snapshots(run: &mut Run) {
    let events = std::mem::take(&mut run.events);
    let on_hero = std::mem::take(&mut run.on_hero);
    run.lights.refresh(&run.layout.map);
    let moving = run.moving_lights();
    let behaviour = run.level.boss().and_then(|b| b.behaviour.as_ref());
    let boss_immune = behaviour.map_or(false, |b| !b.can_be_damaged(run));
    let boss_enraged = behaviour.map_or(false, |b| b.enraged());
    let boss_bar = Level::boss_bar(run);

    let drain = drain_points(run);

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
        fov.compute(&run.layout.map, tx, ty, PLAYER_FOV_RADIUS);

        let (map, lights) = (&run.layout.map, &run.lights);
        let mut ents = player_snaps.clone();
        for m in &run.monsters {
            if !m.alive || !seen(&fov, lights, &moving, map, m.pos, m.radius) {
                continue;
            }
            let mut f = 0;
            if m.hurt_t > 0.0 {
                f |= flags::HURT;
            }
            if m.asleep {
                f |= flags::ASLEEP;
            }
            if m.airborne {
                f |= flags::AIRBORNE;
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
            // The heroes' own shots are sent even out of view, so they don't seem to vanish at its edge.
            if pr.dead || !(pr.from_player || seen(&fov, lights, &moving, map, pr.pos, 0.0)) {
                continue;
            }
            let extra = (pr.owner << 16) | pr.shot as u32;
            ents.push(EntSnap(pr.id, pr.kind as u8, pr.pos.x as f32, pr.pos.y as f32, 255, 0, pr.vel.angle() as f32, 0, 0, extra));
        }
        for o in &run.objects {
            if o.gone || !(o.owns_light() || seen(&fov, lights, &moving, map, o.pos, 0.0)) {
                continue;
            }
            ents.push(super::objects::snap(o, run.time));
        }
        for h in &run.hazards {
            if !seen(&fov, lights, &moving, map, h.pos, h.radius) {
                continue;
            }
            let extra = (h.life * 1000.0) as u32;
            ents.push(EntSnap(h.id, h.kind as u8, h.pos.x as f32, h.pos.y as f32, 255, 0, 0.0, 0, 0, extra));
        }
        let ev: Vec<Ev> = events
            .iter()
            .enumerate()
            .filter(|(i, (_, at))| ev_seen(&fov, lights, &moving, map, *at, on_hero.contains(i)))
            .map(|(_, (e, _))| e.clone())
            .collect();
        let drain = drain_for(&fov, run.level.boss().map_or(false, |b| b.awake), &drain);

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
                knock_vx: me.mv.knock_vx,
                knock_vy: me.mv.knock_vy,
                cd1: me.cd1 as f32,
                cd2: me.cd2 as f32,
                hidden: me.hidden as f32,
                spectating: if me.alive { None } else { me.spectating },
            },
            boss: boss_bar.clone(),
            ev,
            drain,
            lights: lights_for(view_pos, &moving),
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
    use crate::defs::lights::LightKind;
    use crate::run::light::{Anchor, Lights};

    /// Hero on open floor, no lights, FOV computed; returns the hero's tile.
    fn dark_view(run: &mut Run) -> (i32, i32) {
        run.monsters.retain(|m| m.is_boss);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 4..=ty + 4 {
            for x in tx - 7..=tx + 7 {
                run.layout.map.set(x, y, crate::dungeon::Tile::Floor);
            }
        }
        run.lights = Lights::new(run.layout.map.w, run.layout.map.h);
        run.players[0].fov.compute(&run.layout.map, tx, ty, PLAYER_FOV_RADIUS);
        (tx, ty)
    }

    fn sees(run: &mut Run, p: Vec2, r: f64) -> bool {
        run.lights.refresh(&run.layout.map);
        let moving = run.moving_lights();
        seen(&run.players[0].fov, &run.lights, &moving, &run.layout.map, p, r)
    }

    #[test]
    fn a_monster_in_the_dark_is_hidden_until_lit() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let (tx, ty) = dark_view(&mut run);
        let p = Map::center_of(tx + 4, ty);
        assert!(!sees(&mut run, p, 6.0), "in sight but dark");
        let torch = run.add_light(LightKind::Torch, Anchor::Tile(tx + 5, ty), None);
        assert!(sees(&mut run, p, 6.0), "lit by the torch");
        run.set_light(torch, false);
        assert!(!sees(&mut run, p, 6.0), "dark again");
        crate::run::abilities::spawn_monster_projectile(&mut run, 999, EntityKind::FireBolt, Map::center_of(tx + 3, ty), Vec2::new(0.0, 1.0), 1.0, 1.0, 3.0, 0.0, 0, 0.0);
        assert!(sees(&mut run, p, 6.0), "a fire bolt lights it");
    }

    #[test]
    fn hero_events_are_sent_in_the_dark_monster_events_are_not() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let (tx, ty) = dark_view(&mut run);
        run.lights.refresh(&run.layout.map);
        let fov = &run.players[0].fov;
        let near = Some(Map::center_of(tx + 2, ty));
        assert!(ev_seen(fov, &run.lights, &[], &run.layout.map, near, true), "on a hero: sight is enough");
        assert!(!ev_seen(fov, &run.lights, &[], &run.layout.map, near, false), "elsewhere: it must be lit");
        assert!(ev_seen(fov, &run.lights, &[], &run.layout.map, None, false), "party-wide events always");
    }

    #[test]
    fn hurt_and_heal_on_a_hero_are_marked_as_hero_events() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        run.events.clear();
        run.on_hero.clear();
        run.hurt_player(0, crate::defs::damage::Damage::physical(5.0));
        run.heal_player(0, 3.0);
        assert_eq!(run.on_hero, vec![0, 1]);
    }

    #[test]
    fn moving_lights_near_the_viewer_are_listed_with_their_colour_only_when_custom() {
        let view = Vec2::new(100.0, 100.0);
        let fire = Lit { pos: view + Vec2::new(40.0, 0.0), reach: 56.0, kind: LightKind::Fire, colour: 0xff8c3c };
        let frost = Lit { pos: view + Vec2::new(0.0, 30.0), reach: 40.0, kind: LightKind::Magic, colour: 0x78c8ff };
        let far = Lit { pos: view + Vec2::new(2000.0, 0.0), reach: 56.0, kind: LightKind::Fire, colour: 0xff8c3c };
        let out = lights_for(view, &[fire, frost, far]);
        assert_eq!(out.len(), 2);
        assert_eq!((out[0].2, out[0].3), (LightKind::Fire as u8, None));
        assert_eq!((out[1].2, out[1].3), (LightKind::Magic as u8, Some(0x78c8ff)));
    }

    #[test]
    fn monsters_outside_fov_are_not_sent() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let ppos = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let near = run.spawn_enemy(EnemyType::GoblinArcher, ppos + Vec2::new(20.0, 0.0), None, 1);
        let far = run.spawn_enemy(EnemyType::GoblinArcher, ppos + Vec2::new(16.0 * 30.0, 0.0), None, 1);
        let (tx, ty) = Map::tile_of(ppos);
        run.players[0].fov.compute(&run.layout.map, tx, ty, PLAYER_FOV_RADIUS);
        let fov = &run.players[0].fov;
        let near_m = run.monsters.iter().find(|m| m.id == near).unwrap();
        let far_m = run.monsters.iter().find(|m| m.id == far).unwrap();
        assert!(visible(fov, near_m.pos, near_m.radius));
        assert!(!visible(fov, far_m.pos, far_m.radius));
    }

    #[test]
    fn drain_beams_are_sent_even_when_lich_and_disciples_are_out_of_view() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        let pts = drain_points(&run);
        assert!(pts.len() >= 6, "the lich and its channelling disciples");
        assert_eq!(pts[0], run.monsters.iter().find(|m| m.is_boss).unwrap().pos, "the lich comes first");
        // The heroes start far from the boss hall: nothing of the drain is in view.
        let ppos = run.players[0].pos();
        let (tx, ty) = Map::tile_of(ppos);
        run.players[0].fov.compute(&run.layout.map, tx, ty, PLAYER_FOV_RADIUS);
        let fov = &run.players[0].fov;
        assert!(pts.iter().all(|&p| !visible(fov, p, 0.0)));
        assert_eq!(drain_for(fov, false, &pts), None, "not before the fight");
        let sent = drain_for(fov, true, &pts).expect("sent during the fight although out of view");
        assert_eq!(sent.len(), pts.len());
        // Before the fight it is sent as soon as one end is in view.
        let mut fov2 = Fov::new(run.layout.map.w, run.layout.map.h);
        let (tx, ty) = Map::tile_of(pts[1]);
        fov2.compute(&run.layout.map, tx, ty, 1);
        assert!(drain_for(&fov2, false, &pts).is_some());
    }

    #[test]
    fn torches_own_a_light_so_they_are_always_sent() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        run.spawn_torch(&crate::dungeon::TorchSpawn { wall: (1, 1), side: crate::dungeon::TorchSide::Face });
        let o = run.objects.last().unwrap();
        assert!(o.owns_light());
    }
}
