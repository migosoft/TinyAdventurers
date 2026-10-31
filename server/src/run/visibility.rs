//! Per-player snapshots. Each player only receives monsters, enemy projectiles,
//! objects, hazards and positional events that are inside their own field of
//! vision **and lit** (`run/light.rs`). Always sent: the party, their own shots,
//! party-wide events; events on a hero need sight only. A torch (it owns a
//! light) needs sight only: the client keeps light state from the start info
//! and the light events, so a torch out of sight is not worth sending.

use super::levels::Level;
use super::Run;
use crate::defs::enemies::EnemyType;
use crate::defs::kinds::{flags, Anim, EntityKind};
use crate::defs::lights;
use crate::dungeon::{Map, TILE};
use crate::vispoly::View;
use crate::math::Vec2;
use crate::protocol::{EntSnap, Ev, MovingLight, SelfState, Snapshot};
use crate::run::light::{Lights, Lit};
use crate::run::perception::dark_reach;
use crate::wire::encode_snap;

fn visible(view: &View, p: Vec2, radius: f64) -> bool {
    let (x, y) = Map::tile_of(p);
    if view.is_visible(x, y) {
        return true;
    }
    if radius > 8.0 {
        // Large figures: visible if any part of them is.
        let r = radius * 0.8;
        for (dx, dy) in [(-r, -r), (r, -r), (-r, r), (r, r)] {
            let (x, y) = Map::tile_of(p + Vec2::new(dx, dy));
            if view.is_visible(x, y) {
                return true;
            }
        }
    }
    false
}

/// The darkvision percentage (0-100) sent to the client in `SelfW`.
pub(crate) fn darkvision_pct(sight: &crate::defs::races::Sight) -> u8 {
    (sight.darkvision * 100.0).round() as u8
}

/// The filter's darkvision range in tiles: vision times the quantised percentage the client gets,
/// so server and client decide the same tiles.
pub(crate) fn dark_range(sight: &crate::defs::races::Sight) -> f64 {
    sight.vision * (f64::from(darkvision_pct(sight)) / 100.0)
}

/// The viewer's tile and darkvision range in tiles (`vision * darkvision`, quantised).
#[derive(Clone, Copy)]
pub(crate) struct Dark {
    pub tile: (i32, i32),
    pub range: f64,
}

/// A tile a hero is sent: in the viewer's field of view, and lit or within darkvision.
pub(crate) fn hero_tile_seen(view: &View, lights: &Lights, viewer: (i32, i32), range: f64, x: i32, y: i32) -> bool {
    view.is_visible(x, y) && (lights.lit(x, y) || dark_reach(viewer, (x, y), range))
}

/// In the viewer's sight and lit or within darkvision (large figures: any part of them).
/// The lights' layers must be current (`refresh`, `cast_moving`).
pub(crate) fn seen(view: &View, lights: &Lights, dark: &Dark, p: Vec2, radius: f64) -> bool {
    let at = |q: Vec2| {
        let (x, y) = Map::tile_of(q);
        hero_tile_seen(view, lights, dark.tile, dark.range, x, y)
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

/// A world object is sent when seen; a torch (it owns a light) when in sight, lit or not.
pub(crate) fn object_sent(view: &View, lights: &Lights, dark: &Dark, o: &super::objects::WorldObject) -> bool {
    !o.gone && if o.owns_light() { visible(view, o.pos, 0.0) } else { seen(view, lights, dark, o.pos, 0.0) }
}

/// Events: party-wide ones always; events on a hero where the hero is in
/// sight; the rest where they are seen (in sight and lit, or within darkvision).
fn ev_seen(view: &View, lights: &Lights, dark: &Dark, at: Option<Vec2>, on_hero: bool) -> bool {
    match at {
        None => true,
        Some(p) if on_hero => visible(view, p, 0.0),
        Some(p) => seen(view, lights, dark, p, 0.0),
    }
}

/// Moving lights whose light can reach the viewer's sight; the colour only
/// when it is not the kind's default.
fn lights_for(view: Vec2, vision: i32, moving: &[Lit]) -> Vec<MovingLight> {
    let range = (vision as f64 + 1.0) * TILE;
    moving
        .iter()
        .filter(|l| l.pos.dist(view) <= range + l.reach())
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
fn drain_for(view: &View, boss_awake: bool, pts: &[Vec2]) -> Option<Vec<(f32, f32)>> {
    (pts.len() > 1 && (boss_awake || pts.iter().any(|&p| visible(view, p, 0.0)))).then(|| pts.iter().map(|p| (p.x as f32, p.y as f32)).collect())
}

fn ms_since(run: &Run, t: f64) -> u16 {
    ((run.time - t) * 1000.0).clamp(0.0, 65535.0) as u16
}

fn hp_byte(hp: f64, max: f64) -> u8 {
    ((hp / max).clamp(0.0, 1.0) * 255.0).round() as u8
}

/// One monster's entry. An ally's `extra` is its owner (the ranger's id).
fn monster_snap(run: &Run, m: &super::entities::Monster, boss_immune: bool, boss_enraged: bool, gaze: u32) -> EntSnap {
    let mut f = 0;
    if m.hurt_t > 0.0 {
        f |= flags::HURT;
    }
    if m.dormant {
        f |= flags::DORMANT;
    }
    if m.hiding {
        f |= flags::HIDING;
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
    let extra = match &m.ally {
        Some(a) => a.owner,
        None if m.anim == Anim::Gaze => gaze,
        None => m.owner.unwrap_or(0),
    };
    EntSnap(m.id, m.kind as u8, m.pos.x as f32, m.pos.y as f32, hp_byte(m.hp, m.max_hp), m.anim as u8, m.aim as f32, ms_since(run, m.anim_start), f, extra, m.effects.bits())
}

/// The entities hero `pi` is sent: the party and its allies always, the rest as seen
/// through `view` and `dark`.
pub(crate) fn snapshot_ents(run: &Run, _pi: usize, view: &View, dark: &Dark) -> Vec<EntSnap> {
    let behaviour = run.level.boss().and_then(|b| b.behaviour.as_ref());
    let boss_immune = behaviour.map_or(false, |b| !b.can_be_damaged(run));
    let boss_enraged = behaviour.map_or(false, |b| b.enraged());
    let gaze = behaviour.and_then(|b| b.gaze_target()).unwrap_or(0);

    // Players and their allies are always visible to their party.
    let mut ents: Vec<EntSnap> = run
        .players
        .iter()
        .map(|p| {
            let mut f = 0;
            if p.hurt_t > 0.0 {
                f |= flags::HURT;
            }
            if !p.alive {
                f |= flags::DEAD;
            }
            EntSnap(p.id, p.kind() as u8, p.mv.x as f32, p.mv.y as f32, hp_byte(p.hp, p.max_hp), p.anim as u8, p.aim as f32, ms_since(run, p.anim_start), f, 0, p.effects.bits())
        })
        .collect();
    ents.extend(run.monsters.iter().filter(|m| m.alive && m.is_ally()).map(|m| monster_snap(run, m, boss_immune, boss_enraged, gaze)));

    let lights = &run.lights;
    for m in &run.monsters {
        if !m.alive || m.is_ally() || !seen(view, lights, dark, m.pos, m.radius) {
            continue;
        }
        ents.push(monster_snap(run, m, boss_immune, boss_enraged, gaze));
    }
    for pr in &run.projectiles {
        // The heroes' own shots are sent even out of view, so they don't seem to vanish at its edge.
        if pr.dead || !(pr.from_player || seen(view, lights, dark, pr.pos, 0.0)) {
            continue;
        }
        let extra = (pr.owner << 16) | pr.shot as u32;
        ents.push(EntSnap(pr.id, pr.kind as u8, pr.pos.x as f32, pr.pos.y as f32, 255, 0, pr.vel.angle() as f32, 0, 0, extra, 0));
    }
    for o in &run.objects {
        if !object_sent(view, lights, dark, o) {
            continue;
        }
        ents.push(super::objects::snap(run, o));
    }
    for h in &run.hazards {
        if !seen(view, lights, dark, h.pos, h.radius) {
            continue;
        }
        let extra = (h.life * 1000.0) as u32;
        ents.push(EntSnap(h.id, h.kind as u8, h.pos.x as f32, h.pos.y as f32, 255, 0, h.radius as f32, 0, 0, extra, 0));
    }
    ents
}

/// The non-default effect looks of the creatures among `ents` (a creature's id is its entity id).
fn looks_of(run: &Run, ents: &[EntSnap]) -> Vec<(u32, u8, u8)> {
    let sent = |id: u32| ents.iter().any(|e| e.0 == id);
    let fx = run.players.iter().map(|p| (p.id, &p.effects)).chain(run.monsters.iter().filter(|m| m.alive).map(|m| (m.id, &m.effects)));
    fx.filter(|&(id, _)| sent(id)).flat_map(|(id, e)| e.looks().map(move |(k, l)| (id, k as u8, l as u8))).collect()
}

pub fn send_snapshots(run: &mut Run) {
    let events = std::mem::take(&mut run.events);
    let records = super::rules_log::take(run);
    let on_hero = std::mem::take(&mut run.on_hero);
    run.refresh_lights(); // shots moved after the AI: the snapshot must match what the client casts
    let moving = run.moving_lights();
    let boss_bar = Level::boss_bar(run);

    let drain = drain_points(run);

    for pi in 0..run.players.len() {
        if run.players[pi].tx.is_none() {
            continue;
        }
        let me = &run.players[pi];
        let viewed = if me.alive { me } else { me.spectating.and_then(|s| run.players.iter().find(|q| q.id == s)).unwrap_or(me) };
        let (view_pos, sight, viewed_id) = (viewed.pos(), viewed.sight_now(), viewed.id);
        let mut view = std::mem::replace(&mut run.players[pi].view, View::new(0, 0));
        let (tx, ty) = Map::tile_of(view_pos);
        let vision = sight.vision.round() as i32;
        view.compute(&run.layout.map, view_pos, vision);
        let dark = Dark { tile: (tx, ty), range: dark_range(&sight) };

        let ents = snapshot_ents(run, pi, &view, &dark);
        let looks = looks_of(run, &ents);
        let lights = &run.lights;
        let ev: Vec<Ev> = events
            .iter()
            .enumerate()
            .filter(|(i, (_, at))| ev_seen(&view, lights, &dark, *at, on_hero.contains(i)))
            .map(|(_, (e, _))| e.clone())
            .collect();
        let drain = drain_for(&view, run.level.boss().map_or(false, |b| b.awake), &drain);

        let me = &run.players[pi];
        let snap = Snapshot {
            log: super::rules_log::for_viewer(run, pi, viewed_id, &view, &dark, &ents, &records),
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
                spectating: if me.alive { None } else { me.spectating },
                darkvision: darkvision_pct(&sight),
                vision: sight.vision as f32,
                effects: me.effects.list().iter().map(|a| (a.kind as u8, a.left as f32)).collect(),
                speed_mul: me.effects.speed_mul() as f32,
                no_act: me.effects.no_act(),
                cd_mul: super::keystones::cd_mul(me),
            },
            boss: boss_bar.clone(),
            ev,
            drain,
            lights: lights_for(view_pos, vision, &moving),
            looks,
            srv_ms: run.srv_ms,
        };
        run.players[pi].view = view;
        if let Some(tx) = &run.players[pi].tx {
            let _ = tx.send(axum::extract::ws::Message::Binary(encode_snap(&snap).into()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fov::PLAYER_FOV_RADIUS;
    use crate::defs::enemies::EnemyType;
    use crate::protocol::{BossId, ClassId};
    use crate::run::tests::test_run;
    use crate::defs::lights::LightKind;
    use crate::run::light::{Anchor, Lights};

    /// Hero on open floor, no lights, FOV computed; returns the hero's tile.
    fn dark_view(run: &mut Run, darkvision: f64) -> (i32, i32) {
        run.players[0].darkvision = Some(darkvision);
        run.monsters.retain(|m| m.is_boss);
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 4..=ty + 4 {
            for x in tx - 7..=tx + 7 {
                run.layout.map.set(x, y, crate::dungeon::Tile::Floor);
            }
        }
        run.lights = Lights::new(run.layout.map.w, run.layout.map.h);
        let p = run.players[0].pos();
        run.players[0].view.compute(&run.layout.map, p, PLAYER_FOV_RADIUS);
        (tx, ty)
    }

    fn sees(run: &mut Run, p: Vec2, r: f64) -> bool {
        run.lights.refresh(&run.layout.map);
        let moving = run.moving_lights();
        run.lights.cast_moving(&run.layout.map, &moving);
        let dark = dark_of(run);
        seen(&run.players[0].view, &run.lights, &dark, p, r)
    }

    fn dark_of(run: &Run) -> Dark {
        let sight = run.players[0].sight_now();
        Dark { tile: Map::tile_of(run.players[0].pos()), range: dark_range(&sight) }
    }

    #[test]
    fn a_monster_in_the_dark_is_hidden_until_lit() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let (tx, ty) = dark_view(&mut run, 0.0);
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
    fn an_elf_sees_eighteen_tiles_far() {
        let mut run = test_run(&[ClassId::ElvenRanger], BossId::Demon);
        run.monsters.clear();
        let (tx, ty) = Map::tile_of(run.players[0].pos());
        for y in ty - 2..=ty + 2 {
            for x in tx - 2..=tx + 25 {
                run.layout.map.set(x, y, crate::dungeon::Tile::Floor);
            }
        }
        run.lights = Lights::new(run.layout.map.w, run.layout.map.h);
        let sight = run.players[0].sight_now();
        assert_eq!(sight.vision, 18.0);
        let p = run.players[0].pos();
        run.players[0].view.compute(&run.layout.map, p, sight.vision.round() as i32);
        let near = run.spawn_enemy(EnemyType::GoblinArcher, Map::center_of(tx + 16, ty), None);
        let far = run.spawn_enemy(EnemyType::GoblinArcher, Map::center_of(tx + 20, ty), None);
        run.add_light(LightKind::Torch, Anchor::Tile(tx + 17, ty), None);
        run.add_light(LightKind::Torch, Anchor::Tile(tx + 21, ty), None);
        assert!(sees(&mut run, Map::center_of(tx + 16, ty), 5.0), "16 tiles away, lit");
        let (chan, mut rx) = tokio::sync::mpsc::unbounded_channel();
        run.players[0].tx = Some(chan);
        send_snapshots(&mut run);
        let axum::extract::ws::Message::Binary(bytes) = rx.try_recv().unwrap() else { panic!() };
        let s: serde_json::Value = rmp_serde::from_slice(&bytes).unwrap();
        let has = |id: u32| s[2].as_array().unwrap().iter().any(|e| e[0] == id as u64);
        assert!(has(near), "a monster lit 16 tiles east is sent");
        assert!(!has(far), "one 20 tiles east is beyond the 18-tile view");
    }

    #[test]
    fn hero_events_are_sent_in_the_dark_monster_events_are_not() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let (tx, ty) = dark_view(&mut run, 0.0);
        run.lights.refresh(&run.layout.map);
        let view = &run.players[0].view;
        let near = Some(Map::center_of(tx + 2, ty));
        assert!(ev_seen(view, &run.lights, &dark_of(&run), near, true), "on a hero: sight is enough");
        assert!(!ev_seen(view, &run.lights, &dark_of(&run), near, false), "elsewhere: it must be lit");
        assert!(ev_seen(view, &run.lights, &dark_of(&run), None, false), "party-wide events always");
    }

    #[test]
    fn hurt_and_heal_on_a_hero_are_marked_as_hero_events() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        run.events.clear();
        run.on_hero.clear();
        run.hurt_player(0, crate::defs::damage::Damage::physical(5.0));
        run.heal_player(0, 3.0, None);
        assert_eq!(run.on_hero, vec![0, 1]);
    }

    #[test]
    fn moving_lights_near_the_viewer_are_listed_with_their_colour_only_when_custom() {
        let view = Vec2::new(100.0, 100.0);
        let fire = Lit::new(view + Vec2::new(40.0, 0.0), LightKind::Fire, 0xff8c3c);
        let frost = Lit::new(view + Vec2::new(0.0, 30.0), LightKind::Magic, 0x78c8ff);
        let far = Lit::new(view + Vec2::new(2000.0, 0.0), LightKind::Fire, 0xff8c3c);
        let out = lights_for(view, PLAYER_FOV_RADIUS, &[fire, frost, far]);
        assert_eq!(out.len(), 2);
        assert_eq!((out[0].2, out[0].3), (LightKind::Fire as u8, None));
        assert_eq!((out[1].2, out[1].3), (LightKind::Magic as u8, Some(0x78c8ff)));
    }

    #[test]
    fn a_dark_viewer_is_sent_a_monster_in_a_fire_patch_glow_but_not_one_just_outside_it() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let (tx, ty) = dark_view(&mut run, 0.0);
        let (stx, mut srx) = tokio::sync::mpsc::unbounded_channel();
        run.players[0].tx = Some(stx);
        crate::run::spawn_fire_patch(&mut run, Map::center_of(tx + 3, ty), 10.0, 3.0, 8.0);
        let inside = run.spawn_enemy(EnemyType::GoblinArcher, Map::center_of(tx + 7, ty), None);
        // 4.1 tiles from the patch: outside its radius-4 shadowcast.
        let outside = run.spawn_enemy(EnemyType::GoblinArcher, Map::center_of(tx + 7, ty + 1), None);
        send_snapshots(&mut run);
        let axum::extract::ws::Message::Binary(bytes) = srx.try_recv().unwrap() else { panic!("a snapshot") };
        let snap: serde_json::Value = rmp_serde::from_slice(&bytes).unwrap();
        let ids: Vec<u64> = snap[2].as_array().unwrap().iter().map(|e| e[0].as_u64().unwrap()).collect();
        assert!(ids.contains(&(inside as u64)), "lit by the patch");
        assert!(!ids.contains(&(outside as u64)), "dark: the client draws it black");
    }

    #[test]
    fn a_spectator_gets_the_viewed_heros_darkvision() {
        let mut run = test_run(&[ClassId::Wizard, ClassId::Wizard], BossId::Demon);
        let (tx, ty) = dark_view(&mut run, 0.0);
        let (px, py) = (run.players[0].mv.x, run.players[0].mv.y);
        run.players[1].mv.x = px;
        run.players[1].mv.y = py;
        run.players[1].darkvision = Some(1.0);
        let target = run.players[1].id;
        run.players[0].alive = false;
        run.players[0].spectating = Some(target);
        let (stx, mut srx) = tokio::sync::mpsc::unbounded_channel();
        run.players[0].tx = Some(stx);
        let near = run.spawn_enemy(EnemyType::GoblinArcher, Map::center_of(tx + 4, ty), None);
        send_snapshots(&mut run);
        let axum::extract::ws::Message::Binary(bytes) = srx.try_recv().unwrap() else { panic!("a snapshot") };
        let snap: serde_json::Value = rmp_serde::from_slice(&bytes).unwrap();
        assert_eq!(snap[3][12], 100);
        let ids: Vec<u64> = snap[2].as_array().unwrap().iter().map(|e| e[0].as_u64().unwrap()).collect();
        assert!(ids.contains(&(near as u64)), "seen in the dark through the viewed hero's darkvision");
    }

    #[test]
    fn recolouring_a_moving_light_shows_in_the_snapshot_without_an_event() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let (tx, ty) = dark_view(&mut run, 0.0);
        let (stx, mut srx) = tokio::sync::mpsc::unbounded_channel();
        run.players[0].tx = Some(stx);
        run.tick = 1; // past the start: static changes would be events now
        let orc = run.spawn_enemy(EnemyType::OrcWarrior, Map::center_of(tx + 2, ty), None);
        let light = run.add_light(LightKind::Fire, Anchor::Entity(orc), None);
        run.events.clear();
        run.set_light_colour(light, 0x3060ff);
        assert_eq!(run.moving_lights()[0].colour, 0x3060ff);
        assert!(!run.events.iter().any(|(e, _)| matches!(e, Ev::Light { .. })), "moving lights go out in snapshots only");
        send_snapshots(&mut run);
        let axum::extract::ws::Message::Binary(bytes) = srx.try_recv().unwrap() else { panic!("a snapshot") };
        let snap: serde_json::Value = rmp_serde::from_slice(&bytes).unwrap();
        let lights = snap[8].as_array().unwrap();
        assert_eq!(lights.len(), 1);
        assert_eq!((lights[0][2].as_u64(), lights[0][3].as_u64()), (Some(LightKind::Fire as u64), Some(0x3060ff)));
    }

    #[test]
    fn monsters_outside_fov_are_not_sent() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let ppos = run.players[0].pos();
        run.monsters.retain(|m| m.is_boss || m.owner.is_some());
        let near = run.spawn_enemy(EnemyType::GoblinArcher, ppos + Vec2::new(20.0, 0.0), None);
        let far = run.spawn_enemy(EnemyType::GoblinArcher, ppos + Vec2::new(16.0 * 30.0, 0.0), None);
        run.players[0].view.compute(&run.layout.map, ppos, PLAYER_FOV_RADIUS);
        let view = &run.players[0].view;
        let near_m = run.monsters.iter().find(|m| m.id == near).unwrap();
        let far_m = run.monsters.iter().find(|m| m.id == far).unwrap();
        assert!(visible(view, near_m.pos, near_m.radius));
        assert!(!visible(view, far_m.pos, far_m.radius));
    }

    #[test]
    fn drain_beams_are_sent_even_when_lich_and_disciples_are_out_of_view() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        let pts = drain_points(&run);
        assert!(pts.len() >= 6, "the lich and its channelling disciples");
        assert_eq!(pts[0], run.monsters.iter().find(|m| m.is_boss).unwrap().pos, "the lich comes first");
        // The heroes start far from the boss hall: nothing of the drain is in view.
        let ppos = run.players[0].pos();
        run.players[0].view.compute(&run.layout.map, ppos, PLAYER_FOV_RADIUS);
        let view = &run.players[0].view;
        assert!(pts.iter().all(|&p| !visible(view, p, 0.0)));
        assert_eq!(drain_for(view, false, &pts), None, "not before the fight");
        let sent = drain_for(view, true, &pts).expect("sent during the fight although out of view");
        assert_eq!(sent.len(), pts.len());
        // Before the fight it is sent as soon as one end is in view.
        let mut view2 = View::new(run.layout.map.w, run.layout.map.h);
        view2.compute(&run.layout.map, pts[1], 1);
        assert!(drain_for(&view2, false, &pts).is_some());
    }

    #[test]
    fn torches_are_sent_in_sight_lit_or_not_and_not_out_of_sight() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let (tx, ty) = dark_view(&mut run, 0.0);
        let near = crate::dungeon::TorchSpawn { wall: (tx + 3, ty), side: crate::dungeon::TorchSide::Face, lit: true };
        let far = crate::dungeon::TorchSpawn { wall: (tx + 12, ty), side: crate::dungeon::TorchSide::Face, lit: true };
        run.spawn_torch(&near);
        run.spawn_torch(&far);
        let (i_near, i_far) = (run.objects.len() - 2, run.objects.len() - 1);
        // Put both lights out: the torch in sight is still sent, the one out of sight is not.
        for oi in [i_near, i_far] {
            crate::run::objects::set_torch(&mut run, oi, false);
        }
        run.lights.refresh(&run.layout.map);
        let sent_dark = |run: &Run, oi: usize| object_sent(&run.players[0].view, &run.lights, &dark_of(&run), &run.objects[oi]);
        assert!(sent_dark(&run, i_near), "in sight, out and dark");
        assert!(!sent_dark(&run, i_far), "out of sight");
        crate::run::objects::set_torch(&mut run, i_near, true);
        run.lights.refresh(&run.layout.map);
        assert!(object_sent(&run.players[0].view, &run.lights, &dark_of(&run), &run.objects[i_near]), "in sight, lit");
        assert!(run.objects[i_near].owns_light());
    }

    fn dark_monster_sent(darkvision: f64, dx: i32) -> bool {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let (tx, ty) = dark_view(&mut run, darkvision);
        sees(&mut run, Map::center_of(tx + dx, ty), 6.0)
    }

    #[test]
    fn with_no_darkvision_nothing_changes() {
        assert!(!dark_monster_sent(0.0, 1), "one tile away, unlit");
        assert!(!dark_monster_sent(0.0, 0), "on the viewer's own tile");
    }

    #[test]
    fn full_darkvision_sends_a_monster_on_an_unlit_tile_in_fov() {
        assert!(dark_monster_sent(1.0, 4));
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let (tx, ty) = dark_view(&mut run, 1.0);
        run.layout.map.set(tx + 2, ty, crate::dungeon::Tile::Wall);
        let p = run.players[0].pos();
        run.players[0].view.compute(&run.layout.map, p, PLAYER_FOV_RADIUS);
        assert!(!sees(&mut run, Map::center_of(tx + 4, ty), 6.0), "behind a wall: out of FOV");
    }

    #[test]
    fn half_darkvision_reaches_half_the_vision() {
        // vision 9 * 0.5 = 4.5 tiles
        assert!(dark_monster_sent(0.5, 4));
        assert!(!dark_monster_sent(0.5, 5));
    }

    #[test]
    fn the_filter_range_is_the_quantised_darkvision_the_client_gets() {
        let s = crate::defs::races::Sight { vision: 9.0, darkvision: 1.0 / 3.0 };
        assert_eq!(darkvision_pct(&s), 33);
        assert_eq!(dark_range(&s), 9.0 * 0.33);
        assert_eq!(dark_range(&crate::defs::races::Sight { vision: 9.0, darkvision: 1.0 }), 9.0);
        assert_eq!(dark_range(&crate::defs::races::Sight { vision: 9.0, darkvision: 0.0 }), 0.0);
    }

    #[test]
    fn dark_reach_needs_a_positive_range() {
        use crate::run::perception::dark_reach;
        assert!(!dark_reach((3, 3), (3, 3), 0.0));
        assert!(dark_reach((3, 3), (6, 7), 5.0));
        assert!(!dark_reach((3, 3), (6, 8), 5.0));
    }

    #[test]
    fn every_class_sees_as_far_as_the_fov_radius() {
        for c in [ClassId::Wizard, ClassId::Paladin, ClassId::Barbarian] {
            assert_eq!(crate::defs::classes::profile(c).sight.vision.round() as i32, PLAYER_FOV_RADIUS);
        }
    }

    #[test]
    fn snapshots_carry_effects_and_the_own_timers() {
        use crate::defs::effects::EffectKind;
        use crate::run::effects::Creature;
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        run.players[0].tx = Some(tx);
        run.apply_effect(Creature::Player(0), EffectKind::Slowed, Some(2.0));
        run.apply_effect(Creature::Player(0), EffectKind::Blind, Some(1.0));
        send_snapshots(&mut run);
        let axum::extract::ws::Message::Binary(bytes) = rx.try_recv().unwrap() else { panic!() };
        let s: serde_json::Value = rmp_serde::from_slice(&bytes).unwrap();
        let me_ent = s[2].as_array().unwrap().iter().find(|e| e[0] == run.players[0].id).unwrap();
        assert_eq!(me_ent[10], (EffectKind::Slowed.bit() | EffectKind::Blind.bit()) as u64);
        assert_eq!(s[3][13], 0.0, "blind: vision 0");
        assert_eq!(s[3][14].as_array().unwrap().len(), 2);
        assert_eq!(s[3][15], 0.5);
        assert_eq!(s[3][16], false);
    }

    #[test]
    fn a_blind_hero_is_sent_no_enemies() {
        use crate::defs::effects::EffectKind;
        use crate::run::effects::Creature;
        let seen = |blind: bool| {
            let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
            run.players[0].tx = Some(tx);
            run.players[0].darkvision = Some(1.0);
            run.monsters.clear();
            let pos = Vec2::new(run.players[0].mv.x + 20.0, run.players[0].mv.y);
            let id = run.spawn_enemy(EnemyType::OrcWarrior, pos, None);
            if blind {
                run.apply_effect(Creature::Player(0), EffectKind::Blind, Some(5.0));
            }
            send_snapshots(&mut run);
            let axum::extract::ws::Message::Binary(bytes) = rx.try_recv().unwrap() else { panic!() };
            let s: serde_json::Value = rmp_serde::from_slice(&bytes).unwrap();
            s[2].as_array().unwrap().iter().any(|e| e[0] == id as u64)
        };
        assert!(seen(false), "a sighted hero sees the orc next to it");
        assert!(!seen(true), "a blind hero is sent no enemies");
    }
}
