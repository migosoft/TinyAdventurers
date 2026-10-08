//! Compact wire forms of the two frequent messages (docs/compact-snapshots.md).
//! Snapshots go out as a bare MessagePack array (`SnapW`) and inputs come in
//! as one (`InputW`). The readable types in `protocol.rs` stay what the
//! simulation and the client code use.

use serde::{Deserialize, Serialize};
use std::f64::consts::TAU;
use ts_rs::TS;

use crate::protocol::{BossId, Ev, InputMsg, Snapshot};

/// Positions on the wire are whole numbers in 1/POS_SCALE px. MessagePack
/// stores them in 3 bytes up to 4096 px and in 5 bytes beyond.
pub const POS_SCALE: f64 = 16.0;

/// Event codes on the wire, by index. Exported to the client as `EV`.
pub const EV_CODES: [&str; 10] = ["Dmg", "Heal", "Boom", "Died", "Raise", "Immune", "Tile", "Msg", "Coins", "Sink"];

pub fn q_pos(v: f64) -> u32 {
    (v * POS_SCALE).round().max(0.0) as u32
}

/// Angle in 1/256 of a full turn, wrapped to 0-255.
pub fn q_aim(a: f64) -> u8 {
    ((a / TAU * 256.0).round() as i64).rem_euclid(256) as u8
}

/// `[id, kind, x, y, hp, anim, aim, anim_ms, flags, extra]`, see `EntSnap`.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct EntW(pub u32, pub u8, pub u32, pub u32, pub u8, pub u8, pub u8, pub u16, pub u8, pub u32);

/// `[alive, hp, max_hp, x, y, dash_t, dash_dx, dash_dy, cd1, cd2, hidden, spectating]`, exact values.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SelfW(pub bool, pub f32, pub f32, pub f64, pub f64, pub f64, pub f64, pub f64, pub f32, pub f32, pub f32, pub Option<u32>);

/// `[kind, hp, max_hp, immune, enraged]`
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct BossW(pub BossId, pub f32, pub f32, pub bool, pub bool);

/// `[code, ...fields of the Ev variant]`, positions scaled (not `Tile`).
#[derive(Debug, Clone, Serialize, TS)]
#[serde(untagged)]
#[ts(export)]
pub enum EvW {
    Dmg(u8, u32, u32, f32, bool, bool),
    Heal(u8, u32, u32, f32),
    Boom(u8, u32, u32, f32, u8),
    Died(u8, u32, u32, u32, u8),
    Raise(u8, u32, u32, bool),
    Immune(u8, u32, u32),
    Tile(u8, u16, u16, u8),
    Msg(u8, String),
    Coins(u8, u32, u32, u32),
    Sink(u8, u32, u32, u32, u8),
}

/// `[tick, ack, ents, me, boss, ev, srv_ms]`
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct SnapW(pub u32, pub u32, pub Vec<EntW>, pub SelfW, pub Option<BossW>, pub Vec<EvW>, pub f32);

/// `[seq, mx, my, aim, aim_dist, primary, secondary, view_lag, rtt]`, see `InputMsg`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InputW(pub u32, pub i8, pub i8, pub f32, pub f32, pub Option<u16>, pub Option<u16>, pub u16, pub u16);

impl From<InputW> for InputMsg {
    fn from(w: InputW) -> Self {
        let InputW(seq, mx, my, aim, aim_dist, primary, secondary, view_lag, rtt) = w;
        InputMsg { seq, mx, my, aim, aim_dist, primary, secondary, view_lag, rtt }
    }
}

fn ev_w(e: &Ev) -> EvW {
    let q = |v: f32| q_pos(v as f64);
    match e {
        Ev::Dmg { x, y, v, crit, p } => EvW::Dmg(0, q(*x), q(*y), *v, *crit, *p),
        Ev::Heal { x, y, v } => EvW::Heal(1, q(*x), q(*y), *v),
        Ev::Boom { x, y, r, k } => EvW::Boom(2, q(*x), q(*y), *r, *k),
        Ev::Died { id, x, y, kind } => EvW::Died(3, *id, q(*x), q(*y), *kind),
        Ev::Raise { x, y, fire } => EvW::Raise(4, q(*x), q(*y), *fire),
        Ev::Immune { x, y } => EvW::Immune(5, q(*x), q(*y)),
        Ev::Tile { x, y, v } => EvW::Tile(6, *x, *y, *v),
        Ev::Msg { text } => EvW::Msg(7, text.clone()),
        Ev::Coins { x, y, v } => EvW::Coins(8, q(*x), q(*y), *v),
        Ev::Sink { id, x, y, how } => EvW::Sink(9, *id, q(*x), q(*y), *how),
    }
}

pub fn encode_snap(s: &Snapshot) -> Vec<u8> {
    let ents = s.ents.iter().map(|e| EntW(e.0, e.1, q_pos(e.2 as f64), q_pos(e.3 as f64), e.4, e.5, q_aim(e.6 as f64), e.7, e.8, e.9)).collect();
    let m = &s.me;
    let me = SelfW(m.alive, m.hp, m.max_hp, m.x, m.y, m.dash_t, m.dash_dx, m.dash_dy, m.cd1, m.cd2, m.hidden, m.spectating);
    let boss = s.boss.as_ref().map(|b| BossW(b.kind, b.hp, b.max_hp, b.immune, b.enraged));
    let w = SnapW(s.tick, s.ack, ents, me, boss, s.ev.iter().map(ev_w).collect(), s.srv_ms);
    rmp_serde::to_vec(&w).expect("encode snapshot")
}

/// Sample snapshots for tests and the client fixture. Values are chosen
/// off the 1/16 px grid on purpose, so the client test sees rounding.
#[cfg(test)]
pub fn sample_snapshots() -> Vec<Snapshot> {
    use crate::protocol::{BossBar, EntSnap, SelfState};
    let busy = Snapshot {
        tick: 1234,
        ack: 567,
        ents: vec![
            EntSnap(1, 0, 123.47, 456.03, 200, 2, -1.2, 350, 0, 0),
            EntSnap(2, 1, 130.0, 460.5, 255, 0, 3.1, 0, 0, 0),
            EntSnap(300, 5, 2000.5, 1800.27, 128, 1, -3.1406, 1200, 8, 1),
            EntSnap(70000, 12, 50.1, 60.9, 255, 0, 0.7854, 0, 0, (1 << 16) | 42),
            EntSnap(70001, 12, 5000.25, 4100.0, 255, 0, 3.1416, 0, 0, 0),
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
            cd1: 0.25,
            cd2: 1.5,
            hidden: 0.0,
            spectating: None,
        },
        boss: Some(BossBar { kind: BossId::Demon, hp: 1234.5, max_hp: 2000.0, immune: true, enraged: false }),
        ev: vec![
            Ev::Dmg { x: 10.3, y: 20.7, v: 12.5, crit: true, p: false },
            Ev::Heal { x: 11.0, y: 21.0, v: 4.25 },
            Ev::Boom { x: 300.06, y: 400.94, r: 24.0, k: 2 },
            Ev::Died { id: 300, x: 2000.5, y: 1800.27, kind: 5 },
            Ev::Raise { x: 55.5, y: 66.6, fire: true },
            Ev::Immune { x: 1.0, y: 2.0 },
            Ev::Tile { x: 70, y: 12, v: 4 },
            Ev::Msg { text: "Zoë fell into the abyss".into() },
            Ev::Coins { x: 99.9, y: 88.8, v: 15 },
            Ev::Sink { id: 2, x: 130.0, y: 460.5, how: 1 },
        ],
        srv_ms: 0.125,
    };
    let spectator = Snapshot {
        tick: 99,
        ack: 0,
        ents: vec![],
        me: SelfState {
            alive: false,
            hp: 0.0,
            max_hp: 100.0,
            x: 16.0,
            y: 32.0,
            dash_t: 0.0,
            dash_dx: 0.0,
            dash_dy: 0.0,
            cd1: 0.0,
            cd2: 0.0,
            hidden: 0.0,
            spectating: Some(2),
        },
        boss: None,
        ev: vec![],
        srv_ms: 0.0,
    };
    vec![busy, spectator]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{decode, ClientMsg, ServerMsg};
    use std::f64::consts::PI;

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
        let bytes = rmp_serde::to_vec(&InputW(7, 1, -1, 0.5, 30.0, Some(3), None, 80, 40)).unwrap();
        match decode(&bytes) {
            Some(ClientMsg::Input(i)) => {
                assert_eq!((i.seq, i.mx, i.my, i.aim, i.aim_dist), (7, 1, -1, 0.5, 30.0));
                assert_eq!((i.primary, i.secondary, i.view_lag, i.rtt), (Some(3), None, 80, 40));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn snapshot_is_a_bare_array_and_smaller() {
        for s in sample_snapshots() {
            let new = encode_snap(&s);
            let old = rmp_serde::to_vec_named(&ServerMsg::Snap(s)).unwrap();
            assert_eq!(new[0], 0x97, "fixarray of 7 fields");
            println!("snapshot: old {} B, new {} B", old.len(), new.len());
            assert!(new.len() * 10 <= old.len() * 7, "old {} B, new {} B", old.len(), new.len());
        }
    }
}
