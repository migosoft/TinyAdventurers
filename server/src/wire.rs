//! Compact wire forms of the two frequent messages (docs/compact-snapshots.md).
//! Snapshots go out as a bare MessagePack array (`SnapW`) and inputs come in
//! as one (`InputW`). The readable types in `protocol.rs` stay what the
//! simulation and the client code use.

use serde::{Deserialize, Serialize};
use std::f64::consts::TAU;
use ts_rs::TS;

use crate::defs::items::ItemId;
use crate::defs::trees::NodeId;
use crate::protocol::{BossId, Ev, InputMsg, Snapshot};

/// Positions on the wire are whole numbers in 1/POS_SCALE px. MessagePack
/// stores them in 3 bytes up to 4096 px and in 5 bytes beyond.
pub const POS_SCALE: f64 = 16.0;

/// Event codes on the wire, by index. Exported to the client as `EV`.
#[cfg(test)]
pub const EV_CODES: [&str; 18] = ["Dmg", "Heal", "Boom", "Died", "Raise", "Immune", "Tile", "Msg", "Coins", "Sink", "Light", "LightAdd", "LightRemove", "Effect", "Zap", "Cast", "Land", "Cue"];

pub fn q_pos(v: f64) -> u32 {
    (v * POS_SCALE).round().max(0.0) as u32
}

/// Angle in 1/256 of a full turn, wrapped to 0-255.
pub fn q_aim(a: f64) -> u8 {
    ((a / TAU * 256.0).round() as i64).rem_euclid(256) as u8
}

/// Element 6 of an entity: a hazard's radius in whole px (a plain number), else the aim as `q_aim`.
/// The client's `isHazardKind` (`anim/defs.ts`) must name the same kinds.
fn q_aim_or_radius(kind: u8, v: f64) -> u16 {
    use crate::defs::kinds::EntityKind::{FirePatch, FrostPatch, HolyGround, Roots};
    if [FirePatch, FrostPatch, HolyGround, Roots].iter().any(|&k| k as u8 == kind) {
        v.round().clamp(0.0, u16::MAX as f64) as u16
    } else {
        q_aim(v) as u16
    }
}

/// The direction of the last blow to a creature: 0 = none, 1..=255 = the angle in 255 steps of a turn.
pub fn hurt_byte(dir: Option<f64>) -> u8 {
    dir.map_or(0, |a| 1 + ((a / TAU * 255.0).round() as i64).rem_euclid(255) as u8)
}

/// A head's angle relative to its body (within ±π): 128 = straight ahead, 1 and 255 = ∓π.
pub fn head_byte(gaze: f64) -> u8 {
    (128.0 + gaze / std::f64::consts::PI * 127.0).round().clamp(1.0, 255.0) as u8
}

/// A creature's drowning stage (`water_t` seconds in deep water; 0 or less: not drowning): 0 = not in the drowning state, else
/// `1 + min(round(t * 10), 126)`, plus `DROWN_BREATHLESS` for a breathless creature (it makes no bubbles).
pub fn drown_byte(t: f64, breathless: bool) -> u8 {
    if t <= 0.0 {
        return 0;
    }
    1 + (t * 10.0).round().min(126.0) as u8 + if breathless { DROWN_BREATHLESS } else { 0 }
}

/// The bit of a drown byte that marks a breathless creature.
pub const DROWN_BREATHLESS: u8 = 128;

/// `[id, kind, x, y, hp, anim, aim (a hazard: radius px), anim_ms, flags, extra, effects, side, hurt_dir, head, drown]`, see `EntSnap`.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct EntW(pub u32, pub u8, pub u32, pub u32, pub u8, pub u8, pub u16, pub u16, pub u8, pub u32, pub u32, pub u8, pub u8, pub u8, pub u8);

/// `[alive, hp, max_hp, x, y, dash_t, dash_dx, dash_dy, cd1, cd2, spectating, knock, darkvision, vision, effects, speed_mul, no_act, cd_mul, cd_rate, paused_items, paused_nodes, charmed_by, water_t]`, exact values;
/// `knock` is `[vx, vy]` while pushed, nil otherwise (one byte); `darkvision` is the viewed hero's percentage, 0-100.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SelfW(pub bool, pub f32, pub f32, pub f64, pub f64, pub f64, pub f64, pub f64, pub f32, pub f32, pub Option<u32>, pub Option<(f64, f64)>, pub u8, pub f32, pub Vec<(u8, f32, i16, bool)>, pub f32, pub bool, pub f32, pub f32, pub Vec<ItemId>, pub Vec<NodeId>, pub Option<String>, pub f64);

/// `[kind, hp, max_hp, immune]`
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct BossW(pub BossId, pub f32, pub f32, pub bool);

/// `[code, ...fields of the Ev variant]`, positions scaled (not `Tile`).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(untagged)]
#[ts(export)]
pub enum EvW {
    Dmg(u8, u32, u32, f32, bool, bool, u8, bool),
    Heal(u8, u32, u32, f32, bool),
    Boom(u8, u32, u32, f32, u8),
    Died(u8, u32, u32, u32, u8),
    Raise(u8, u32, u32, u8),
    Immune(u8, u32, u32),
    Tile(u8, u16, u16, u8),
    Msg(u8, String),
    Coins(u8, u32, u32, u32),
    Sink(u8, u32, u32, u32, u8),
    Light(u8, u32, bool, u32),
    LightAdd(u8, u32, u8, u32, u16, u16, bool, u8),
    LightRemove(u8, u32),
    Effect(u8, u32, u8, bool, u8),
    Zap(u8, u32, u32, u32, u32),
    Cast(u8, u32, u32, u32, u8, u16, u8, u8),
    Land(u8, u32, u32, u32, u8, u8, u32),
    Cue(u8, u32, u32, u32, u8),
}

/// `[x, y, kind, colour]`, positions scaled, see `MovingLight`.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct LightW(pub u32, pub u32, pub u8, pub Option<u32>);

/// `[tick, ack, ents, me, boss, ev, srv_ms, drain, lights, looks, dark, dark_ev, solids]`; `drain` is flat `[x0, y0, x1, y1, ...]` (scaled), nil when there is none;
/// `looks` is `[[entity, effect, look], ...]` for the non-default looks of the sent entities' effects;
/// `dark` lists the sent entities in sight but in the dark, `dark_ev` the indices into `ev` of the positional events in the dark;
/// `solids` is flat `[x0, y0, half0, x1, ...]` (scaled): the blocking objects near the viewer that `ents` lacks, collision only;
/// a fourteenth field `log` follows only for a player with the rules log on.
#[derive(Debug, Clone, TS)]
#[ts(export)]
pub struct SnapW(pub u32, pub u32, pub Vec<EntW>, pub SelfW, pub Option<BossW>, pub Vec<EvW>, pub f32, pub Option<Vec<u32>>, pub Vec<LightW>, pub Vec<(u32, u8, u8)>, pub Vec<u32>, pub Vec<u16>, pub Vec<u32>, pub Option<crate::run::rules_log::LogW>);

/// A bare array of 13 fields, or 14 when the rules log is on: the log is the last field and is left out
/// when `None`, so the bytes while it is off are what they always were.
impl Serialize for SnapW {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeTuple;
        let mut t = s.serialize_tuple(if self.13.is_some() { 14 } else { 13 })?;
        t.serialize_element(&self.0)?;
        t.serialize_element(&self.1)?;
        t.serialize_element(&self.2)?;
        t.serialize_element(&self.3)?;
        t.serialize_element(&self.4)?;
        t.serialize_element(&self.5)?;
        t.serialize_element(&self.6)?;
        t.serialize_element(&self.7)?;
        t.serialize_element(&self.8)?;
        t.serialize_element(&self.9)?;
        t.serialize_element(&self.10)?;
        t.serialize_element(&self.11)?;
        t.serialize_element(&self.12)?;
        if let Some(log) = &self.13 {
            t.serialize_element(log)?;
        }
        t.end()
    }
}

/// `[seq, mx, my, aim, aim_dist, primary, secondary, view_lag, rtt, act]`, see `InputMsg`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InputW(pub u32, pub i8, pub i8, pub f32, pub f32, pub Option<u16>, pub Option<u16>, pub u16, pub u16, #[serde(default)] pub bool);

impl From<InputW> for InputMsg {
    fn from(w: InputW) -> Self {
        let InputW(seq, mx, my, aim, aim_dist, primary, secondary, view_lag, rtt, act) = w;
        InputMsg { seq, mx, my, aim, aim_dist, primary, secondary, view_lag, rtt, act }
    }
}

fn ev_w(e: &Ev) -> EvW {
    let q = |v: f32| q_pos(v as f64);
    match e {
        Ev::Dmg { x, y, v, crit, p, ty, imm } => EvW::Dmg(0, q(*x), q(*y), *v, *crit, *p, *ty, *imm),
        Ev::Heal { x, y, v, p } => EvW::Heal(1, q(*x), q(*y), *v, *p),
        Ev::Boom { x, y, r, k } => EvW::Boom(2, q(*x), q(*y), *r, *k),
        Ev::Died { id, x, y, kind } => EvW::Died(3, *id, q(*x), q(*y), *kind),
        Ev::Raise { x, y, k } => EvW::Raise(4, q(*x), q(*y), *k),
        Ev::Immune { x, y } => EvW::Immune(5, q(*x), q(*y)),
        Ev::Tile { x, y, v } => EvW::Tile(6, *x, *y, *v),
        Ev::Msg { text } => EvW::Msg(7, text.clone()),
        Ev::Coins { x, y, v } => EvW::Coins(8, q(*x), q(*y), *v),
        Ev::Sink { id, x, y, how } => EvW::Sink(9, *id, q(*x), q(*y), *how),
        Ev::Light { id, on, colour } => EvW::Light(10, *id, *on, *colour),
        Ev::LightAdd { id, kind, colour, x, y, on, wall } => EvW::LightAdd(11, *id, *kind, *colour, *x, *y, *on, *wall),
        Ev::LightRemove { id } => EvW::LightRemove(12, *id),
        Ev::Effect { id, kind, on, look } => EvW::Effect(13, *id, *kind, *on, *look),
        Ev::Zap { x, y, x2, y2 } => EvW::Zap(14, q(*x), q(*y), q(*x2), q(*y2)),
        Ev::Cast { id, x, y, look, windup_ms, primary, aim } => EvW::Cast(15, *id, q(*x), q(*y), *look, *windup_ms, *primary as u8, q_aim(*aim as f64)),
        Ev::Land { id, x, y, kind, aim, extra } => EvW::Land(16, *id, q(*x), q(*y), *kind, q_aim(*aim as f64), *extra),
        Ev::Cue { id, x, y, k } => EvW::Cue(17, *id, q(*x), q(*y), *k),
    }
}

pub fn encode_snap(s: &Snapshot) -> Vec<u8> {
    let ents = s.ents.iter().map(|e| EntW(e.0, e.1, q_pos(e.2 as f64), q_pos(e.3 as f64), e.4, e.5, q_aim_or_radius(e.1, e.6 as f64), e.7, e.8, e.9, e.10, e.11, e.12, e.13, e.14)).collect();
    let m = &s.me;
    let me = SelfW(m.alive, m.hp, m.max_hp, m.x, m.y, m.dash_t, m.dash_dx, m.dash_dy, m.cd1, m.cd2, m.spectating, (m.knock_vx != 0.0 || m.knock_vy != 0.0).then_some((m.knock_vx, m.knock_vy)), m.darkvision, m.vision, m.effects.clone(), m.speed_mul, m.no_act, m.cd_mul, m.cd_rate, m.paused_items.clone(), m.paused_nodes.clone(), m.charmed_by.clone(), m.water_t);
    let boss = s.boss.as_ref().map(|b| BossW(b.kind, b.hp, b.max_hp, b.immune));
    let drain = s.drain.as_ref().map(|d| d.iter().flat_map(|&(x, y)| [q_pos(x as f64), q_pos(y as f64)]).collect());
    let solids = s.solids.iter().flat_map(|&(x, y, half)| [q_pos(x as f64), q_pos(y as f64), q_pos(half as f64)]).collect();
    let lights = s.lights.iter().map(|l| LightW(q_pos(l.0 as f64), q_pos(l.1 as f64), l.2, l.3)).collect();
    let w = SnapW(s.tick, s.ack, ents, me, boss, s.ev.iter().map(ev_w).collect(), s.srv_ms, drain, lights, s.looks.clone(), s.dark.clone(), s.dark_ev.clone(), solids, s.log.clone());
    rmp_serde::to_vec(&w).expect("encode snapshot")
}

/// Sample snapshots for tests and the client fixture. Values are chosen
/// off the 1/16 px grid on purpose, so the client test sees rounding.
#[cfg(test)]
pub fn sample_snapshots() -> Vec<Snapshot> {
    use crate::protocol::{BossBar, EntSnap, MovingLight, SelfState};
    let busy = Snapshot {
        tick: 1234,
        ack: 567,
        ents: vec![
            EntSnap(1, 0, 123.47, 456.03, 200, 2, -1.2, 350, 0, 0, 0, 2, 0, 128, 0),
            EntSnap(2, 1, 130.0, 460.5, 255, 0, 3.1, 0, 0, 0, 0b101, 2, 77, 200, drown_byte(0.5, false)),
            EntSnap(3, 1, 141.5, 470.25, 255, 0, 0.5, 0, 0, 0, (1 << 11) | (1 << 18), 2, 0, 128, drown_byte(1.4, true)),
            EntSnap(300, 5, 2000.5, 1800.27, 128, 1, -3.1406, 1200, 8, 1, 0, 1, 255, 1, 0),
            EntSnap(301, 26, 2010.5, 1810.27, 255, 0, 0.0, 0, 0, 0, 0, 0, 0, 128, 0),
            EntSnap(70000, 12, 50.1, 60.9, 255, 0, 0.7854, 0, 0, (1 << 16) | 42, 0, 0, 0, 128, 0),
            EntSnap(70001, 12, 5000.25, 4100.0, 255, 0, 3.1416, 0, 0, 0, 0, 0, 0, 128, 0),
        ],
        me: SelfState {
            alive: true,
            hp: 87.5,
            max_hp: 120.0,
            x: 123.456789012,
            y: 456.03125,
            dash_t: 0.12,
            dash_dx: 0.6,
            dash_dy: -0.8,
            knock_vx: -412.75,
            knock_vy: 31.0625,
            water_t: 1.35,
            cd1: 0.25,
            cd2: 1.5,
            spectating: None,
            darkvision: 0,
            vision: 9.0,
            effects: vec![(1, 2.5, 0, false), (3, 0.75, 0, true), (16, 12.0, -2, false)],
            paused_items: vec![ItemId::BandOfVigor],
            paused_nodes: vec![],
            speed_mul: 0.0,
            no_act: true,
            cd_mul: 0.8,
            cd_rate: 1.25,
            charmed_by: Some("the Orc Warrior".into()),
        },
        boss: Some(BossBar { kind: BossId::FireDemon, hp: 1234.5, max_hp: 2000.0, immune: true }),
        ev: vec![
            Ev::Dmg { x: 10.3, y: 20.7, v: 12.5, crit: true, p: false, ty: 2, imm: false },
            Ev::Heal { x: 11.0, y: 21.0, v: 4.25, p: true },
            Ev::Boom { x: 300.06, y: 400.94, r: 24.0, k: 2 },
            Ev::Died { id: 300, x: 2000.5, y: 1800.27, kind: 5 },
            Ev::Raise { x: 55.5, y: 66.6, k: 2 },
            Ev::Immune { x: 1.0, y: 2.0 },
            Ev::Tile { x: 70, y: 12, v: 4 },
            Ev::Msg { text: "Zoë fell into the abyss".into() },
            Ev::Coins { x: 99.9, y: 88.8, v: 15 },
            Ev::Sink { id: 2, x: 130.0, y: 460.5, how: 1 },
            Ev::Light { id: 3, on: false, colour: 0xffaa5a },
            Ev::LightAdd { id: 400, kind: 1, colour: 0xff461e, x: 33, y: 71, on: true, wall: 2 },
            Ev::LightRemove { id: 12 },
            Ev::Effect { id: 3, kind: 11, on: true, look: 1 },
            Ev::Zap { x: 100.03, y: 200.97, x2: 130.5, y2: 190.25 },
            Ev::Cast { id: 2, x: 130.03, y: 460.47, look: 1, windup_ms: 600, primary: true, aim: -1.2 },
            Ev::Land { id: 70002, x: 140.03, y: 450.97, kind: 28, aim: 0.5, extra: (1 << 16) | 42 },
            Ev::Cue { id: 5, x: 150.03, y: 440.97, k: 1 },
        ],
        drain: Some(vec![(400.25, 300.5), (480.0, 300.0), (330.06, 260.7)]),
        lights: vec![MovingLight(100.3, 200.7, 2, None), MovingLight(55.0, 66.06, 3, Some(0x78c8ff))],
        looks: vec![(3, 11, 1)],
        dark: vec![300, 70001],
        dark_ev: vec![2, 3],
        solids: vec![(210.03, 340.5, 6.0), (226.0, 340.5, 6.0)],
        srv_ms: 0.125,
        log: None,
    };
    let spectator = Snapshot {
        tick: 99,
        ack: 0,
        // Two hazards: element 6 is the radius in px, not an angle (40 and 48 would wrap as angles).
        ents: vec![EntSnap(500, 71, 160.0, 320.0, 255, 0, 40.0, 0, 0, 4000, 0, 0, 0, 128, 0), EntSnap(501, 70, 176.0, 336.0, 255, 0, 48.0, 0, 0, 2500, 0, 0, 0, 128, 0)],
        me: SelfState {
            alive: false,
            hp: 0.0,
            max_hp: 100.0,
            x: 16.0,
            y: 32.0,
            dash_t: 0.0,
            dash_dx: 0.0,
            dash_dy: 0.0,
            knock_vx: 0.0,
            knock_vy: 0.0,
            water_t: 0.0,
            cd1: 0.0,
            cd2: 0.0,
            spectating: Some(2),
            darkvision: 35,
            vision: 9.0,
            effects: vec![],
            paused_items: vec![],
            paused_nodes: vec![],
            speed_mul: 1.0,
            no_act: false,
            cd_mul: 1.0,
            cd_rate: 1.0,
            charmed_by: None,
        },
        boss: None,
        ev: vec![],
        drain: None,
        lights: vec![],
        looks: vec![],
        dark: vec![],
        dark_ev: vec![],
        solids: vec![],
        srv_ms: 0.0,
        log: None,
    };
    vec![busy, spectator]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{decode, ClientMsg, ServerMsg};
    use std::f64::consts::PI;

    #[test]
    fn hurt_byte_round_trips() {
        assert_eq!(hurt_byte(None), 0);
        for deg in [0.0_f64, 45.0, 90.0, 179.0, -90.0, -179.0, 359.0] {
            let a = deg.to_radians();
            let b = hurt_byte(Some(a));
            assert!((1..=255).contains(&b), "{deg}: {b}");
            let back = (b as f64 - 1.0) / 255.0 * TAU;
            let d = (back - a.rem_euclid(TAU)).abs();
            assert!(d.min(TAU - d) <= TAU / 255.0 / 2.0 + 1e-9, "{deg}: {back}");
        }
    }

    #[test]
    fn head_byte_round_trips() {
        assert_eq!(head_byte(0.0), 128);
        assert_eq!(head_byte(PI), 255);
        assert_eq!(head_byte(-PI), 1);
        assert_eq!(head_byte(9.0), 255, "clamped");
        let b = head_byte(1.0);
        assert!(((b as f64 - 128.0) / 127.0 * PI - 1.0).abs() < PI / 127.0);
    }

    #[test]
    fn drown_byte_table() {
        assert_eq!(drown_byte(0.0, false), 0, "not in deep water");
        assert_eq!(drown_byte(0.0, true), 0, "breathless, not in deep water: still 0");
        assert_eq!(drown_byte(0.05, false), 2);
        assert_eq!(drown_byte(1.2, false), 13);
        assert_eq!(drown_byte(20.0, false), 127, "capped");
        assert_eq!(drown_byte(0.05, true), 2 + 128);
        assert_eq!(drown_byte(20.0, true), 127 + 128);
    }

    #[test]
    fn a_creature_sends_its_drown_byte_last() {
        let v: serde_json::Value = rmp_serde::from_slice(&encode_snap(&sample_snapshots()[0])).unwrap();
        assert_eq!(v[2][0][14], serde_json::json!(0));
        assert_eq!(v[2][1][14], serde_json::json!(drown_byte(0.5, false)));
        assert_eq!(v[2][2][14], serde_json::json!(drown_byte(1.4, true)));
    }

    #[test]
    fn a_creature_sends_its_hit_and_head_bytes() {
        let v: serde_json::Value = rmp_serde::from_slice(&encode_snap(&sample_snapshots()[0])).unwrap();
        assert_eq!((v[2][0][12].clone(), v[2][0][13].clone()), (serde_json::json!(0), serde_json::json!(128)));
        assert_eq!((v[2][1][12].clone(), v[2][1][13].clone()), (serde_json::json!(77), serde_json::json!(200)));
    }

    #[test]
    fn only_hazard_kinds_carry_a_radius() {
        use crate::defs::kinds::EntityKind::{FirePatch, FrostPatch, HolyGround, Missile, Roots};
        for k in [FirePatch, FrostPatch, HolyGround, Roots] {
            assert_eq!(q_aim_or_radius(k as u8, 300.0), 300, "{k:?} is a radius");
        }
        assert_eq!(q_aim_or_radius(Missile as u8, 300.0), q_aim(300.0) as u16, "a missile is an aim");
    }

    #[test]
    fn positions_round_to_sixteenths() {
        assert_eq!(q_pos(123.47), 1976); // 1975.52
        assert_eq!(q_pos(0.0), 0);
        assert_eq!(q_pos(-0.2), 0);
        assert_eq!(q_pos(5000.25), 80004); // beyond 4096 px still fits
    }

    #[test]
    fn aim_wraps_into_a_byte() {
        assert_eq!(q_aim(0.0), 0);
        assert_eq!(q_aim(PI / 2.0), 64);
        assert_eq!(q_aim(-PI / 2.0), 192);
        assert_eq!(q_aim(PI), 128);
        assert_eq!(q_aim(-PI), 128);
        assert_eq!(q_aim(TAU - 0.001), 0);
    }

    #[test]
    fn a_hazard_sends_its_radius_as_a_plain_number_and_a_creature_its_aim_as_a_byte() {
        let v: serde_json::Value = rmp_serde::from_slice(&encode_snap(&sample_snapshots()[1])).unwrap();
        assert_eq!((v[2][0][6].clone(), v[2][1][6].clone()), (serde_json::json!(40), serde_json::json!(48)), "radii in px");
        let v: serde_json::Value = rmp_serde::from_slice(&encode_snap(&sample_snapshots()[0])).unwrap();
        assert_eq!(v[2][0][6], serde_json::json!(q_aim(-1.2)), "a creature's aim stays q_aim");
    }

    #[test]
    fn event_codes_follow_ev_codes() {
        for e in &sample_snapshots()[0].ev {
            let name = serde_json::to_value(e).unwrap()["t"].as_str().unwrap().to_string();
            let w = serde_json::to_value(ev_w(e)).unwrap();
            assert_eq!(EV_CODES[w[0].as_u64().unwrap() as usize], name);
        }
        assert_eq!(sample_snapshots()[0].ev.len(), EV_CODES.len(), "the sample covers every event");
    }

    #[test]
    fn input_array_decodes_to_input_msg() {
        let bytes = rmp_serde::to_vec(&InputW(7, 1, -1, 0.5, 30.0, Some(3), None, 80, 40, true)).unwrap();
        match decode(&bytes) {
            Some(ClientMsg::Input(i)) => {
                assert_eq!((i.seq, i.mx, i.my, i.aim, i.aim_dist), (7, 1, -1, 0.5, 30.0));
                assert_eq!((i.primary, i.secondary, i.view_lag, i.rtt), (Some(3), None, 80, 40));
                assert!(i.act);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn snapshot_is_a_bare_array_and_smaller() {
        for s in sample_snapshots() {
            let new = encode_snap(&s);
            let old = rmp_serde::to_vec_named(&ServerMsg::Snap(s)).unwrap();
            assert_eq!(new[0], 0x9d, "fixarray of 13 fields");
            println!("snapshot: old {} B, new {} B", old.len(), new.len());
            assert!(new.len() * 10 <= old.len() * 7, "old {} B, new {} B", old.len(), new.len());
        }
    }

    #[test]
    fn snapshot_carries_effect_looks() {
        let mut s = sample_snapshots().remove(1);
        s.looks = vec![(7, 11, 1)];
        let v: serde_json::Value = rmp_serde::from_slice(&encode_snap(&s)).unwrap();
        assert_eq!(v.as_array().unwrap().len(), 13);
        assert_eq!(v[9], serde_json::json!([[7, 11, 1]]));
    }

    #[test]
    fn snapshot_carries_the_dark_marks() {
        let samples = sample_snapshots();
        let v: serde_json::Value = rmp_serde::from_slice(&encode_snap(&samples[0])).unwrap();
        assert_eq!(v[10], serde_json::json!([300, 70001]));
        assert_eq!(v[11], serde_json::json!([2, 3]));
        let v: serde_json::Value = rmp_serde::from_slice(&encode_snap(&samples[1])).unwrap();
        assert_eq!(v[10], serde_json::json!([]));
        assert_eq!(v[11], serde_json::json!([]));
    }

    #[test]
    fn snapshot_carries_the_near_solids_flat_and_scaled() {
        let samples = sample_snapshots();
        let v: serde_json::Value = rmp_serde::from_slice(&encode_snap(&samples[0])).unwrap();
        assert_eq!(v[12], serde_json::json!([3360, 5448, 96, 3616, 5448, 96]));
        let v: serde_json::Value = rmp_serde::from_slice(&encode_snap(&samples[1])).unwrap();
        assert_eq!(v[12], serde_json::json!([]));
        assert_eq!(v.as_array().unwrap().len(), 13);
    }

    #[test]
    fn a_snapshot_with_a_log_has_it_fourteenth() {
        let mut s = sample_snapshots().remove(1);
        s.log = Some(crate::run::rules_log::LogW(vec![(1, 2, 3)], vec![]));
        let v: serde_json::Value = rmp_serde::from_slice(&encode_snap(&s)).unwrap();
        assert_eq!(v.as_array().unwrap().len(), 14);
        assert_eq!(v[13][0], serde_json::json!([[1, 2, 3]]));
    }
}
