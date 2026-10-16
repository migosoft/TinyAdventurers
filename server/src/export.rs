//! `cargo test` writes generated client files:
//! - `client/src/generated/defs.ts`: entity kinds, animation ids, flags,
//!   class and ability numbers (so the client predicts with the same values)
//! - `client/src/generated/fixtures.json`: collision/FOV test vectors that the
//!   TypeScript ports must reproduce exactly.
//! - `client/src/generated/wire-fixtures.json`: sample snapshots as wire
//!   bytes and readable form for the client's unpack test.
//! The protocol types themselves are exported by ts-rs (`#[ts(export)]`).

use crate::collision::{step_move, MoveState, Solid};
use crate::defs::abilities::{self as ab};
use crate::defs::classes::{self, PLAYER_RADIUS};
use crate::defs::effects::{self, EffectKind};
use crate::defs::{bosses, enemies};
use crate::defs::kinds::{flags, Anim, EntityKind};
use crate::dungeon::{Map, Tile, TILE};
use crate::fov::{Fov, PLAYER_FOV_RADIUS};
use crate::protocol::ClassId;
use crate::run::{DT, SNAPSHOT_EVERY, TICK_HZ};
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde_json::json;
use std::path::PathBuf;

fn out_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../client/src/generated")
}

#[test]
fn export_defs() {
    let kinds: serde_json::Map<String, serde_json::Value> = EntityKind::ALL.iter().map(|k| (format!("{k:?}"), json!(*k as u8))).collect();
    let anims: serde_json::Map<String, serde_json::Value> = Anim::ALL.iter().map(|a| (format!("{a:?}"), json!(*a as u8))).collect();
    let class_defs: serde_json::Map<String, serde_json::Value> = ClassId::ALL
        .iter()
        .map(|c| {
            let d = classes::def(*c);
            (format!("{c:?}"), json!({ "kind": d.kind as u8, "hp": d.hp, "speed": d.speed, "primary": d.primary, "secondary": d.secondary }))
        })
        .collect();
    let abilities: serde_json::Map<String, serde_json::Value> =
        ab::ALL.iter().map(|a| (format!("{a:?}"), serde_json::to_value(ab::def(*a)).unwrap())).collect();
    let mut consts = json!({
        "TILE": TILE,
        "TICK_HZ": TICK_HZ,
        "DT": DT,
        "SNAPSHOT_HZ": TICK_HZ / SNAPSHOT_EVERY as f64,
        "PLAYER_RADIUS": PLAYER_RADIUS,
        "FOV_RADIUS": PLAYER_FOV_RADIUS,
        "DASH_SPEED": ab::DASH_SPEED,
        "KNOCK_DECAY": ab::KNOCK_DECAY,
        "KNOCK_MIN_SPEED": ab::KNOCK_MIN_SPEED,
        "DAGGER_RANGE": ab::DAGGER_RANGE,
        "DAGGER_COOLDOWN": ab::DAGGER_COOLDOWN,
        "HIDDEN_CRIT_MULT": ab::HIDDEN_CRIT_MULT,
        "MIMIC_HOP_CYCLE": enemies::MIMIC_HOP_CYCLE,
        "MIMIC_HOP_AIR_START": enemies::MIMIC_HOP_AIR.0,
        "MIMIC_HOP_AIR_END": enemies::MIMIC_HOP_AIR.1,
        "MIMIC_WAKE_T": enemies::MIMIC_WAKE_T,
        "OGRE_SLAM_RADIUS": enemies::OGRE_SLAM_RADIUS,
        "OGRE_SLAM_WINDUP": enemies::OGRE_SLAM_WINDUP,
        "DRAGON_CLAW_WINDUP": bosses::DRAGON_CLAW_WINDUP,
        "DRAGON_BITE_WINDUP": bosses::DRAGON_BITE_WINDUP,
        "DRAGON_BITE_RANGE": bosses::DRAGON_BITE_RANGE,
        "DRAGON_BITE_KNOCK": bosses::DRAGON_BITE_KNOCK,
        "DRAGON_TAIL_WINDUP": bosses::DRAGON_TAIL_WINDUP,
        "DRAGON_BREATH_WINDUP": bosses::DRAGON_BREATH_WINDUP,
        "DRAGON_BREATH_TIME": bosses::DRAGON_BREATH_TIME,
        "DRAGON_TAKEOFF": bosses::DRAGON_TAKEOFF,
        "DRAGON_LAND": bosses::DRAGON_LAND,
        "DRAGON_SMASH_RADIUS": bosses::DRAGON_SMASH_RADIUS,
        "DRAGON_SMASH_KNOCK": bosses::DRAGON_SMASH_KNOCK,
        "DRAGON_CLAW_KNOCK": bosses::DRAGON_CLAW_KNOCK,
        "DRAGON_TAIL_KNOCK": bosses::DRAGON_TAIL_KNOCK,
        "DRAGON_FIREBALL_KNOCK": bosses::DRAGON_FIREBALL_KNOCK,
        "LICH_NOVA_RADIUS": bosses::LICH_NOVA_RADIUS,
        "LICH_NOVA_WINDUP": bosses::LICH_NOVA_WINDUP,
        "LICH_NOVA_KNOCK": bosses::LICH_NOVA_KNOCK,
        "SHALLOW_SPEED": crate::dungeon::SHALLOW_SPEED,
        "LAVA_SPEED": crate::dungeon::LAVA_SPEED,
        "FALL_TIME": crate::dungeon::FALL_TIME,
        "DROWN_TIME": crate::dungeon::DROWN_TIME,
        "POS_SCALE": crate::wire::POS_SCALE,
    });
    // A second object: one json! with all of them hits the macro recursion limit.
    let demon = json!({
        "DEMON_CLEAVE_WINDUP": bosses::DEMON_CLEAVE_WINDUP,
        "DEMON_SWOOP_WINDUP": bosses::DEMON_SWOOP_WINDUP,
        "DEMON_SWOOP_TIME": bosses::DEMON_SWOOP_TIME,
        "DEMON_RING_WINDUP": bosses::DEMON_RING_WINDUP,
        "DEMON_CLEAVE_RECOVER": bosses::DEMON_CLEAVE_RECOVER,
        "DEMON_SWOOP_RECOVER": bosses::DEMON_SWOOP_RECOVER,
        "DEMON_RING_RECOVER": bosses::DEMON_RING_RECOVER,
        "DEMON_ENRAGED_PACE": bosses::DEMON_ENRAGED_PACE,
        "DEMON_CLEAVE_KNOCK": bosses::DEMON_CLEAVE_KNOCK,
        "DEMON_SWOOP_KNOCK": bosses::DEMON_SWOOP_KNOCK,
    });
    consts.as_object_mut().unwrap().extend(demon.as_object().unwrap().clone());
    let lich = json!({
        "LICH_ORB_SPEED": bosses::LICH_ORB_SPEED,
        "LICH_GAZE_WINDUP": bosses::LICH_GAZE_WINDUP,
        "LICH_BLIND_WINDUP": bosses::LICH_BLIND_WINDUP,
        "LICH_SLEEP_WINDUP": bosses::LICH_SLEEP_WINDUP,
    });
    consts.as_object_mut().unwrap().extend(lich.as_object().unwrap().clone());
    let shots = json!({ "SHOT_HEIGHT": crate::run::entities::SHOT_HEIGHT, "DRAGON_LIFT": crate::run::entities::DRAGON_LIFT });
    consts.as_object_mut().unwrap().extend(shots.as_object().unwrap().clone());
    let objs = json!({
        "BARREL_RADIUS": crate::defs::objects::BARREL_RADIUS, "TORCH_RADIUS": crate::defs::objects::TORCH_RADIUS,
        "BARREL_FUSE": crate::defs::objects::BARREL_FUSE,
        "BARREL_BLAST_R": crate::defs::objects::BARREL_BLAST_R, "USE_REACH": crate::defs::objects::USE_REACH,
    });
    consts.as_object_mut().unwrap().extend(objs.as_object().unwrap().clone());
    let fl = json!({
        "HIDDEN": flags::HIDDEN, "IMMUNE": flags::IMMUNE, "ENRAGED": flags::ENRAGED,
        "DORMANT": flags::DORMANT, "HURT": flags::HURT, "DEAD": flags::DEAD, "AIRBORNE": flags::AIRBORNE,
    });
    let tiles = json!({
        "Void": Tile::Void as u8, "Floor": Tile::Floor as u8, "Wall": Tile::Wall as u8,
        "DoorOpen": Tile::DoorOpen as u8, "DoorClosed": Tile::DoorClosed as u8,
        "ShallowWater": Tile::ShallowWater as u8, "DeepWater": Tile::DeepWater as u8,
        "Chasm": Tile::Chasm as u8, "Lava": Tile::Lava as u8,
    });
    // Shot hitboxes per monster kind (`Monster::shot_dist`): footprint radius and drawn height.
    let mut hitbox = serde_json::Map::new();
    let monsters = enemies::EnemyType::ALL.iter().map(|&t| (enemies::def(t).kind, enemies::def(t).radius));
    let boss_defs = crate::protocol::BossId::ALL.iter().map(|&b| (bosses::def(b).kind, bosses::def(b).radius));
    for (kind, r) in monsters.chain(boss_defs) {
        hitbox.insert((kind as u8).to_string(), json!({ "r": r, "h": kind.body_height() }));
    }
    hitbox.insert((EntityKind::Barrel as u8).to_string(), json!({ "r": crate::defs::objects::BARREL_RADIUS, "h": 0.0 }));
    let ev: serde_json::Map<String, serde_json::Value> =
        crate::wire::EV_CODES.iter().enumerate().map(|(i, n)| (n.to_string(), json!(i))).collect();
    let dmg_types: serde_json::Map<_, _> = crate::defs::damage::DamageType::ALL.iter().map(|t| (t.name().to_string(), json!(*t as u8))).collect();
    let light_kinds: serde_json::Map<_, _> =
        crate::defs::lights::LightKind::ALL.iter().map(|k| (format!("{k:?}"), json!(*k as u8))).collect();
    let light_defs: serde_json::Map<_, _> = crate::defs::lights::LightKind::ALL
        .iter()
        .map(|k| ((*k as u8).to_string(), serde_json::to_value(crate::defs::lights::def(*k)).unwrap()))
        .collect();
    let effect_ids: serde_json::Map<_, _> = EffectKind::ALL.iter().map(|k| (format!("{k:?}"), json!(*k as u8))).collect();
    let effect_defs: serde_json::Map<_, _> = EffectKind::ALL
        .iter()
        .map(|k| {
            let d = effects::def(*k);
            ((*k as u8).to_string(), json!({ "positive": d.positive, "prone": d.prone, "no_turn": d.no_turn, "duration": d.duration }))
        })
        .collect();
    let p = |v: &serde_json::Value| serde_json::to_string_pretty(v).unwrap();
    let ts = format!(
        "// Generated by `cargo test` (server/src/export.rs). Do not edit.\n\n\
         export const KIND = {} as const;\n\n\
         export const ANIM = {} as const;\n\n\
         export const FLAG = {} as const;\n\n\
         export const TILE_ID = {} as const;\n\n\
         export const CONST = {} as const;\n\n\
         export const CLASSES = {} as const;\n\n\
         export const ABILITIES = {} as const;\n\n\
         export const HITBOX: Record<number, {{ r: number; h: number }}> = {};\n\n\
         export const EV = {} as const;\n\n\
         export const DMG_TYPE = {} as const;\n\n\
         export const LIGHT_KIND = {} as const;\n\n\
         export const LIGHT: Record<number, {{ radius: number; colour: number; intensity: number; flicker: number }}> = {};\n\n\
         export const EFFECT = {} as const;\n\n\
         export const EFFECTS: Record<number, {{ positive: boolean; prone: boolean; no_turn: boolean; duration: number }}> = {};\n",
        p(&json!(kinds)),
        p(&json!(anims)),
        p(&fl),
        p(&tiles),
        p(&consts),
        p(&json!(class_defs)),
        p(&json!(abilities)),
        p(&json!(hitbox)),
        p(&json!(ev)),
        p(&json!(dmg_types)),
        p(&json!(light_kinds)),
        p(&json!(light_defs)),
        p(&json!(effect_ids)),
        p(&json!(effect_defs)),
    );
    std::fs::create_dir_all(out_dir()).unwrap();
    std::fs::write(out_dir().join("defs.ts"), ts).unwrap();
}

/// A small room with pillars, a corridor and every kind of terrain for the
/// shared test vectors.
fn fixture_map() -> Map {
    let mut m = Map::new(24, 20);
    for y in 1..19 {
        for x in 1..23 {
            m.set(x, y, Tile::Floor);
        }
    }
    for (x, y) in [(6, 5), (7, 5), (6, 6), (12, 9), (13, 9), (13, 10), (17, 4), (5, 14), (18, 15), (19, 15)] {
        m.set(x, y, Tile::Wall);
    }
    for y in 1..12 {
        m.set(10, y, Tile::Wall);
    }
    for x in 11..23 {
        m.set(x, 1, Tile::ShallowWater);
        m.set(x, 2, Tile::ShallowWater);
    }
    for x in 1..10 {
        m.set(x, 17, Tile::ShallowWater);
        m.set(x, 18, Tile::ShallowWater);
    }
    for (x, y) in [(15, 6), (16, 6), (15, 7), (16, 7)] {
        m.set(x, y, Tile::DeepWater);
    }
    for y in 5..9 {
        m.set(20, y, Tile::Chasm);
        m.set(21, y, Tile::Chasm);
    }
    for y in 13..16 {
        for x in 14..18 {
            m.set(x, y, Tile::Lava);
        }
    }
    m
}

/// Barrels in the fixture room (floor tiles), so the port is checked against solids too.
fn fixture_solids() -> Vec<Solid> {
    vec![Solid { x: 4.5 * TILE, y: 8.5 * TILE, half: 6.0 }, Solid { x: 8.5 * TILE, y: 12.5 * TILE, half: 6.0 }, Solid { x: 13.5 * TILE, y: 4.5 * TILE, half: 6.0 }]
}

#[test]
fn export_fixtures() {
    let map = fixture_map();
    let solids = fixture_solids();
    let mut rng = ChaCha8Rng::seed_from_u64(99);
    let mut moves = Vec::new();
    for case in 0..10 {
        let (tx, ty) = if case < 6 { (3, 3 + case * 2) } else { (12, 3 + (case - 6) * 4) };
        let mut s = MoveState::at(tx as f64 * TILE + 8.0, ty as f64 * TILE + 8.0);
        let start = s;
        let speed = 60.0 + case as f64 * 5.0;
        let mut inputs = Vec::new();
        let mut out = Vec::new();
        let (mut mx, mut my) = (1i8, 0i8);
        for step in 0..400 {
            if step % 25 == 0 {
                mx = rng.gen_range(-1..=1);
                my = rng.gen_range(-1..=1);
            }
            let dash = step % 97 == 50;
            if dash {
                let a: f64 = rng.gen_range(0.0..std::f64::consts::TAU);
                s.dash_t = 0.18;
                s.dash_dx = a.cos();
                s.dash_dy = a.sin();
            }
            // A push (14-44 px, any direction) now and then, carried into terrain and walls.
            let knock = step % 97 == 20;
            if knock {
                let a: f64 = rng.gen_range(0.0..std::f64::consts::TAU);
                let v = crate::collision::knock_speed(rng.gen_range(14.0..44.0), DT);
                s.knock_vx = a.cos() * v;
                s.knock_vy = a.sin() * v;
            }
            let pushed = [s.knock_vx, s.knock_vy];
            s = step_move(&map, &s, mx, my, speed, ab::DASH_SPEED, PLAYER_RADIUS, DT, &solids);
            inputs.push(json!({
                "mx": mx, "my": my,
                "dash": if dash { json!([s.dash_dx, s.dash_dy]) } else { json!(null) },
                "knock": if knock { json!(pushed) } else { json!(null) },
            }));
            out.push(json!([s.x, s.y]));
        }
        moves.push(json!({ "start": [start.x, start.y], "speed": speed, "inputs": inputs, "out": out }));
    }
    let mut fov = Fov::new(map.w, map.h);
    let mut fovs = Vec::new();
    for (cx, cy) in [(3, 3), (8, 8), (15, 12), (11, 2), (20, 17)] {
        fov.compute(&map, cx, cy, PLAYER_FOV_RADIUS);
        let mut vis = Vec::new();
        for y in 0..map.h {
            for x in 0..map.w {
                if fov.is_visible(x, y) {
                    vis.push(y * map.w + x);
                }
            }
        }
        fovs.push(json!({ "x": cx, "y": cy, "visible": vis }));
    }
    use crate::defs::lights::LightKind;
    use crate::run::light::{Anchor, Lights, Lit};
    let mut lights = Lights::new(map.w, map.h);
    for (x, y) in [(3, 3), (8, 8), (15, 12)] {
        lights.push(LightKind::Torch, Anchor::Tile(x, y), None);
    }
    for y in 0..map.h {
        for x in 0..map.w {
            if map.get(x, y) == Tile::Lava as u8 {
                lights.push(LightKind::Lava, Anchor::Tile(x, y), None);
            }
        }
    }
    lights.refresh(&map);
    let lit: Vec<i32> = (0..map.w * map.h).filter(|i| lights.static_lit(i % map.w, i / map.w)).collect();
    let srcs: Vec<serde_json::Value> = lights.sources.iter().map(|s| match s.anchor {
        Anchor::Tile(x, y) => json!([s.id, s.kind as u8, s.colour, x, y, true]),
        Anchor::Entity(_) | Anchor::Point(_) => unreachable!(),
    }).collect();
    // Moving lights (px, on the wire's 1/16 px grid): open floor, beside the
    // pillar's corner, against the long wall, exactly on a tile corner.
    let mut alone = Lights::new(map.w, map.h);
    let moving: Vec<serde_json::Value> = [(136.0, 216.0, LightKind::Fire), (95.0, 97.0, LightKind::Fire), (159.5, 72.0, LightKind::Fire), (176.0, 176.0, LightKind::Fire), (40.25, 250.0, LightKind::Magic)]
        .iter()
        .map(|&(x, y, kind)| {
            alone.cast_moving(&map, &[Lit::new(crate::math::Vec2::new(x, y), kind, crate::defs::lights::def(kind).colour)]);
            let lit: Vec<i32> = (0..map.w * map.h).filter(|i| alone.lit(i % map.w, i / map.w)).collect();
            json!({ "x": x, "y": y, "kind": kind as u8, "lit": lit })
        })
        .collect();
    // Darkvision: what a hero sees (FOV, and the static light or within range) from unlit floor,
    // partial ranges, so the circle's edge is tested: some unlit tile is seen only by darkvision
    // and some unlit FOV tile is not seen. Plus range 0 and the full range (the FOV radius).
    let mut view = crate::vispoly::View::new(map.w, map.h);
    let mut dark_cases = Vec::new();
    for (cx, cy, range) in [(12, 5, 3.0), (18, 4, 4.5), (3, 14, 3.0), (11, 7, 4.5), (20, 3, PLAYER_FOV_RADIUS as f64), (20, 17, 0.0)] {
        assert!(!lights.lit(cx, cy), "darkvision viewer {cx},{cy} stands on an unlit tile");
        view.compute(&map, Map::center_of(cx, cy), PLAYER_FOV_RADIUS);
        let seen: Vec<i32> = (0..map.w * map.h).filter(|i| crate::run::visibility::hero_tile_seen(&view, &lights, (cx, cy), range, i % map.w, i / map.w)).collect();
        let unlit_fov = |i: &i32| view.is_visible(i % map.w, i / map.w) && !lights.lit(i % map.w, i / map.w);
        let dark_only = seen.iter().filter(|i| unlit_fov(i)).count();
        let dark_unseen = (0..map.w * map.h).filter(|i| unlit_fov(i) && !seen.contains(i)).count();
        println!("DV {cx},{cy} r{range}: seen {} dark-only {dark_only} dark-unseen {dark_unseen}", seen.len());
        if range > 0.0 {
            assert!(dark_only > 0, "viewer {cx},{cy}: no unlit tile seen by darkvision");
            if range < PLAYER_FOV_RADIUS as f64 {
                assert!(dark_unseen > 0, "viewer {cx},{cy}: no unlit FOV tile outside the range");
            }
        }
        dark_cases.push(json!({ "x": cx, "y": cy, "range": range, "seen": seen }));
    }
    // The hero's view (vispoly.rs): polygon points and visible tiles from pixel positions beside
    // the long wall's end, the 3-tile pillar and the wall block, on a tile corner and in the open.
    let mut view_cases = Vec::new();
    for (x, y) in [(150.5, 200.3), (90.7, 108.2), (186.4, 168.9), (176.0, 208.0), (60.0, 200.0)] {
        let p = crate::math::Vec2::new(x, y);
        assert!(!map.opaque_at(p), "view viewer {x},{y} stands on open floor");
        view.compute(&map, p, PLAYER_FOV_RADIUS);
        let poly = crate::vispoly::sight_polygon(&map, x, y, crate::vispoly::sight_radius(PLAYER_FOV_RADIUS), 96);
        let points: Vec<f64> = poly.points.iter().flat_map(|&(a, b)| [a, b]).collect();
        let visible: Vec<i32> = (0..map.w * map.h).filter(|i| view.is_visible(i % map.w, i / map.w)).collect();
        view_cases.push(json!({ "x": x, "y": y, "vision": PLAYER_FOV_RADIUS, "points": points, "visible": visible }));
    }
    let light_case = json!({ "sources": srcs, "lit": lit, "moving": moving });
    let doc = json!({
        "lights": light_case, "darkvision": dark_cases, "view": view_cases,
        "w": map.w, "h": map.h, "tiles": map.tiles,
        "radius": PLAYER_RADIUS, "dt": DT, "dashSpeed": ab::DASH_SPEED, "fovRadius": PLAYER_FOV_RADIUS,
        "solids": solids.iter().map(|s| json!([s.x, s.y, s.half])).collect::<Vec<_>>(),
        "moves": moves, "fov": fovs,
    });
    std::fs::create_dir_all(out_dir()).unwrap();
    std::fs::write(out_dir().join("fixtures.json"), serde_json::to_string(&doc).unwrap()).unwrap();
}

/// Sample snapshots as wire bytes plus their readable form; the client's
/// `wire.test.ts` unpacks the bytes and compares.
#[test]
fn export_wire_fixtures() {
    let cases: Vec<serde_json::Value> = crate::wire::sample_snapshots()
        .iter()
        .map(|s| json!({ "bytes": crate::wire::encode_snap(s), "snap": s }))
        .collect();
    std::fs::create_dir_all(out_dir()).unwrap();
    std::fs::write(out_dir().join("wire-fixtures.json"), serde_json::to_string(&json!({ "cases": cases })).unwrap()).unwrap();
}
