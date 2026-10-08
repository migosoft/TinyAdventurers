# Compact Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send snapshots (30 Hz) and inputs (60 Hz) as compact MessagePack arrays with quantized positions and aim, without changing what the game code sees.

**Architecture:** A new Rust module `wire.rs` holds the array types (`SnapW`, `EntW`, `SelfW`, `BossW`, `EvW`, `InputW`), the quantizers and `encode_snap`. ts-rs exports those types. A new client module `wire.ts` turns a `SnapW` back into today's `Snapshot` and packs `InputMsg` into an `InputW`. `net.ts` is the only place that switches between the two forms.

**Tech Stack:** Rust (serde, rmp-serde 1, ts-rs 10), TypeScript (@msgpack/msgpack 3, vitest 3).

**Spec:** [compact-snapshots.md](compact-snapshots.md)

## Global Constraints

- Positions on the wire: `u32` in 1/`POS_SCALE` px, `POS_SCALE = 16`, rounded, clamped at 0.
- Entity aim on the wire: `u8`, `round(aim / 2π · 256)` wrapped to 0–255; the client reads 128–255 as negative and returns [−π, π).
- `me` position/dash, cooldowns, hide time, input `aim`/`aim_dist`, hp, damage values, boss bar, `Boom.r`, `srv_ms`: unchanged types, exact.
- Event codes: `Dmg 0, Heal 1, Boom 2, Died 3, Raise 4, Immune 5, Tile 6, Msg 7, Coins 8, Sink 9`. `Tile` keeps its tile coordinates.
- Snapshots are a bare top-level array; every other server message stays a `t`-tagged map.
- Inputs are a bare top-level array; the server detects it by the first byte `0x90–0x9f`, `0xdc` or `0xdd`.
- Never edit `client/src/generated/*` by hand; `cargo test` writes it.
- No local Rust: run cargo in Docker (command in HANDOFF.md, "Environment notes"). Below it is abbreviated as `CARGO_TEST`:
  `MSYS_NO_PATHCONV=1 docker run --rm -v "C:\\Users\\Goll\\Desktop\\TinyAdventurers":/work -v ta-cargo:/usr/local/cargo/registry -v ta-target:/work/server/target -w /work/server rust:1-slim-bookworm cargo test --release`

## Review Focus

- A dead player spectating someone (`spectating` set, `alive` false) must unpack to the same `SelfState`: fixture case 2 (Task 2) and the client test (Task 3).
- Aims near ±π and negative aims (west-facing enemies) must come back in [−π, π), or the staff swing in `EntityView.ts:298` jumps: Rust quantizer test (Task 1) and client range test (Task 3).
- An input with no shot (`primary`/`secondary` null or undefined) must reach the server as `None`: Rust decode test (Task 1) and `packInput` test (Task 3).
- Positions beyond 4,096 px (a bigger map later) must still round-trip: entity at x 5000.25 in the fixture (Task 2).
- Non-ASCII text in `Msg` events ("Zoë fell into the abyss") must arrive intact: fixture event (Task 2).

---

### Task 1: Rust wire module

**Files:**
- Create: `server/src/wire.rs`
- Modify: `server/src/main.rs` (add `mod wire;` after `mod run;`)
- Modify: `server/src/protocol.rs` (`decode`, header comment)

**Interfaces:**
- Produces: `wire::POS_SCALE: f64`, `wire::EV_CODES: [&str; 10]`, `wire::q_pos(f64) -> u32`, `wire::q_aim(f64) -> u8`, `wire::encode_snap(&Snapshot) -> Vec<u8>`, the exported types `SnapW`, `EntW`, `SelfW`, `BossW`, `EvW`, `InputW`, `impl From<InputW> for InputMsg`, and `#[cfg(test)] wire::sample_snapshots() -> Vec<Snapshot>`.

- [ ] **Step 1: Write `server/src/wire.rs` with the tests first and stub bodies**

```rust
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
    todo!()
}

/// Angle in 1/256 of a full turn, wrapped to 0-255.
pub fn q_aim(a: f64) -> u8 {
    todo!()
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
        todo!()
    }
}

pub fn encode_snap(s: &Snapshot) -> Vec<u8> {
    todo!()
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
```

- [ ] **Step 2: Add the module and run the tests to see them fail**

In `server/src/main.rs`, add `mod wire;` after `mod run;`. Then run `CARGO_TEST`.
Expected: compile error `cannot find function ev_w` (the stubs exist, `ev_w` does not).

- [ ] **Step 3: Implement the bodies**

Replace the stubs in `wire.rs`:

```rust
pub fn q_pos(v: f64) -> u32 {
    (v * POS_SCALE).round().max(0.0) as u32
}

/// Angle in 1/256 of a full turn, wrapped to 0-255.
pub fn q_aim(a: f64) -> u8 {
    ((a / TAU * 256.0).round() as i64).rem_euclid(256) as u8
}

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
```

In `server/src/protocol.rs`, replace `decode`:

```rust
pub fn decode(bytes: &[u8]) -> Option<ClientMsg> {
    match bytes.first() {
        // A bare array is a compact input (see wire.rs).
        Some(0x90..=0x9f | 0xdc | 0xdd) => rmp_serde::from_slice::<crate::wire::InputW>(bytes).ok().map(|w| ClientMsg::Input(w.into())),
        _ => rmp_serde::from_slice(bytes).ok(),
    }
}
```

and change the module comment at the top of `protocol.rs` to:

```rust
//! Client <-> server messages. Encoded as MessagePack (structs as maps,
//! `EntSnap` as a compact array). Snapshots and inputs travel in the compact
//! array forms of `wire.rs`. TypeScript types are generated by ts-rs into
//! `client/src/generated/` when `cargo test` runs.
```

- [ ] **Step 4: Run the tests**

Run `CARGO_TEST`. Expected: all tests pass (61 old + 5 new), and the `snapshot: old … B, new … B` lines appear with `-- --nocapture` if you want the numbers. `client/src/generated/` now also contains `SnapW.ts`, `EntW.ts`, `SelfW.ts`, `BossW.ts`, `EvW.ts`, `InputW.ts`. If ts-rs rejects the untagged `EvW`, check that the variant tuples export as `[number, ...] | ...` in `EvW.ts`.

- [ ] **Step 5: Commit**

```bash
git add server/src/wire.rs server/src/main.rs server/src/protocol.rs client/src/generated
git commit -m "Wire module: compact snapshot and input arrays"
```

### Task 2: Export `POS_SCALE`, `EV` and the wire fixture

**Files:**
- Modify: `server/src/export.rs` (`export_defs` and a new test `export_wire_fixtures`; module comment)

**Interfaces:**
- Consumes: `wire::POS_SCALE`, `wire::EV_CODES`, `wire::encode_snap`, `wire::sample_snapshots`.
- Produces: `CONST.POS_SCALE` and `EV` (`{ Dmg: 0, … Sink: 9 } as const`) in `client/src/generated/defs.ts`; `client/src/generated/wire-fixtures.json` = `{ "cases": [{ "bytes": number[], "snap": Snapshot }] }`, where `snap` is the readable `Snapshot` before quantization.

- [ ] **Step 1: Add `POS_SCALE` and `EV` to `export_defs`**

In `consts`, add after `"DROWN_TIME": …,`:

```rust
        "POS_SCALE": crate::wire::POS_SCALE,
```

Before `let p = |v: …`, add:

```rust
    let ev: serde_json::Map<String, serde_json::Value> =
        crate::wire::EV_CODES.iter().enumerate().map(|(i, n)| (n.to_string(), json!(i))).collect();
```

In the `format!` string, add a line after the `ABILITIES` line:

```rust
         export const ABILITIES = {} as const;\n\n\
         export const EV = {} as const;\n",
```

(remove the `\n",` ending from the `ABILITIES` line), and add `p(&json!(ev)),` as the last argument.

- [ ] **Step 2: Add the fixture test** at the end of `export.rs`:

```rust
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
```

Extend the module comment list with:

```rust
//! - `client/src/generated/wire-fixtures.json`: sample snapshots as wire
//!   bytes and readable form for the client's unpack test.
```

- [ ] **Step 3: Run and check the output**

Run `CARGO_TEST`. Expected: all pass. Then check:
`grep -n "POS_SCALE\|export const EV" client/src/generated/defs.ts` shows both, and `client/src/generated/wire-fixtures.json` exists with 2 cases; the first case's `bytes` starts with `151` (0x97).

- [ ] **Step 4: Commit**

```bash
git add server/src/export.rs client/src/generated
git commit -m "Export POS_SCALE, event codes and wire fixtures"
```

### Task 3: Client unpack and pack

**Files:**
- Create: `client/src/wire.ts`
- Test: `client/src/wire.test.ts`

**Interfaces:**
- Consumes: generated `SnapW`, `EvW`, `InputW`, `Snapshot`, `EntSnap`, `Ev`, `InputMsg`; `CONST.POS_SCALE`, `EV`; `wire-fixtures.json`.
- Produces: `unpackSnap(w: SnapW): Snapshot` and `packInput(i: InputMsg): InputW`.

- [ ] **Step 1: Write the failing test** `client/src/wire.test.ts`:

```ts
// The client must unpack exactly what the server packed (fixtures written by
// `cargo test`, server/src/export.rs). Positions and aim lose precision on
// the wire by design; everything else must match.
import { decode } from '@msgpack/msgpack';
import { describe, expect, it } from 'vitest';
import { CONST } from './generated/defs';
import type { SnapW } from './generated/SnapW';
import fixtures from './generated/wire-fixtures.json';
import { packInput, unpackSnap } from './wire';

const POS_TOL = 0.5 / CONST.POS_SCALE + 1e-6;
const AIM_TOL = Math.PI / 256 + 1e-6;

function close(got: unknown, want: unknown, path: string): void {
  if (typeof want === 'number') {
    expect(typeof got, path).toBe('number');
    let d = Math.abs((got as number) - want);
    if (/^ents\.\d+\.6$/.test(path)) {
      d = Math.min(d, 2 * Math.PI - d);
      expect(d, path).toBeLessThanOrEqual(AIM_TOL);
    } else if (/^(ents\.\d+\.[23]|ev\.\d+\.[xy])$/.test(path)) {
      expect(d, path).toBeLessThanOrEqual(POS_TOL);
    } else {
      expect(d, path).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(want)));
    }
  } else if (want !== null && typeof want === 'object') {
    expect(got !== null && typeof got === 'object', path).toBe(true);
    expect(Object.keys(got as object).sort(), path).toEqual(Object.keys(want).sort());
    for (const k of Object.keys(want)) {
      close((got as Record<string, unknown>)[k], (want as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
    }
  } else {
    expect(got, path).toEqual(want);
  }
}

describe('wire', () => {
  it('unpacks the server snapshots', () => {
    expect(fixtures.cases.length).toBe(2);
    for (const c of fixtures.cases) {
      const snap = unpackSnap(decode(Uint8Array.from(c.bytes)) as SnapW);
      close(snap, c.snap, '');
    }
  });

  it('returns aims in [-pi, pi)', () => {
    const snap = unpackSnap(decode(Uint8Array.from(fixtures.cases[0].bytes)) as SnapW);
    for (const e of snap.ents) {
      expect(e[6]).toBeGreaterThanOrEqual(-Math.PI);
      expect(e[6]).toBeLessThan(Math.PI);
    }
  });

  it('packs inputs in field order with null for no shot', () => {
    const i = { seq: 7, mx: 1, my: -1, aim: 0.5, aim_dist: 30, primary: 3, secondary: undefined as unknown as null, view_lag: 80, rtt: 40 };
    expect(packInput(i)).toEqual([7, 1, -1, 0.5, 30, 3, null, 80, 40]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd client && npx vitest run src/wire.test.ts`
Expected: FAIL, `Failed to resolve import "./wire"`.

- [ ] **Step 3: Write `client/src/wire.ts`**

```ts
// Compact wire forms of snapshots and inputs (docs/compact-snapshots.md).
// The server sends `SnapW` arrays with positions in 1/POS_SCALE px and aim
// in 1/256 turns; unpackSnap rebuilds the readable `Snapshot` the game uses.
import { CONST, EV } from './generated/defs';
import type { EntSnap } from './generated/EntSnap';
import type { Ev } from './generated/Ev';
import type { EvW } from './generated/EvW';
import type { InputMsg } from './generated/InputMsg';
import type { InputW } from './generated/InputW';
import type { SnapW } from './generated/SnapW';
import type { Snapshot } from './generated/Snapshot';

const pos = (v: number): number => v / CONST.POS_SCALE;
/** 0-255 → [-π, π), the range the server's angles have. */
const angle = (a: number): number => ((a >= 128 ? a - 256 : a) / 256) * (2 * Math.PI);

type DmgW = [number, number, number, number, boolean, boolean];
type HealW = [number, number, number, number];
type BoomW = [number, number, number, number, number];
type DiedW = [number, number, number, number, number];
type RaiseW = [number, number, number, boolean];
type ImmuneW = [number, number, number];
type TileW = [number, number, number, number];
type MsgW = [number, string];
type CoinsW = [number, number, number, number];
type SinkW = [number, number, number, number, number];

function unpackEv(e: EvW): Ev {
  switch (e[0]) {
    case EV.Dmg: {
      const [, x, y, v, crit, p] = e as DmgW;
      return { t: 'Dmg', x: pos(x), y: pos(y), v, crit, p };
    }
    case EV.Heal: {
      const [, x, y, v] = e as HealW;
      return { t: 'Heal', x: pos(x), y: pos(y), v };
    }
    case EV.Boom: {
      const [, x, y, r, k] = e as BoomW;
      return { t: 'Boom', x: pos(x), y: pos(y), r, k };
    }
    case EV.Died: {
      const [, id, x, y, kind] = e as DiedW;
      return { t: 'Died', id, x: pos(x), y: pos(y), kind };
    }
    case EV.Raise: {
      const [, x, y, fire] = e as RaiseW;
      return { t: 'Raise', x: pos(x), y: pos(y), fire };
    }
    case EV.Immune: {
      const [, x, y] = e as ImmuneW;
      return { t: 'Immune', x: pos(x), y: pos(y) };
    }
    case EV.Tile: {
      const [, x, y, v] = e as TileW;
      return { t: 'Tile', x, y, v };
    }
    case EV.Msg: {
      const [, text] = e as MsgW;
      return { t: 'Msg', text };
    }
    case EV.Coins: {
      const [, x, y, v] = e as CoinsW;
      return { t: 'Coins', x: pos(x), y: pos(y), v };
    }
    case EV.Sink: {
      const [, id, x, y, how] = e as SinkW;
      return { t: 'Sink', id, x: pos(x), y: pos(y), how };
    }
    default:
      throw new Error(`unknown event code ${e[0]}`);
  }
}

export function unpackSnap(w: SnapW): Snapshot {
  const [tick, ack, ents, me, boss, ev, srv_ms] = w;
  return {
    tick,
    ack,
    ents: ents.map((e): EntSnap => [e[0], e[1], pos(e[2]), pos(e[3]), e[4], e[5], angle(e[6]), e[7], e[8], e[9]]),
    me: {
      alive: me[0],
      hp: me[1],
      max_hp: me[2],
      x: me[3],
      y: me[4],
      dash_t: me[5],
      dash_dx: me[6],
      dash_dy: me[7],
      cd1: me[8],
      cd2: me[9],
      hidden: me[10],
      spectating: me[11],
    },
    boss: boss && { kind: boss[0], hp: boss[1], max_hp: boss[2], immune: boss[3], enraged: boss[4] },
    ev: ev.map(unpackEv),
    srv_ms,
  };
}

export function packInput(i: InputMsg): InputW {
  return [i.seq, i.mx, i.my, i.aim, i.aim_dist, i.primary ?? null, i.secondary ?? null, i.view_lag, i.rtt];
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd client && npx tsc --noEmit && npm test`
Expected: typecheck clean; all tests pass, including the 3 new ones. If `tsc` complains that `resolveJsonModule` is missing for the fixture import, it is not: `sim.test.ts` already imports `fixtures.json` the same way.

- [ ] **Step 5: Commit**

```bash
git add client/src/wire.ts client/src/wire.test.ts
git commit -m "Client: unpack compact snapshots, pack inputs"
```

### Task 4: Switch over and measure

**Files:**
- Modify: `server/src/run/visibility.rs` (send with `encode_snap`)
- Modify: `client/src/net.ts` (`onmessage`, `send`)

**Interfaces:**
- Consumes: `wire::encode_snap`, `unpackSnap`, `packInput`.

- [ ] **Step 1: Measure the old sizes first (baseline)**

The server still sends the old form at this point. Make sure Docker Desktop runs (`docker info`), then:

```bash
docker compose up --build -d && curl -s localhost:8080/health
cd tools/e2e && node smoke.mjs http://localhost:8080/ "" shots-before Wizard,Paladin
```

Expected: `OK`, the F3 text (note the `snapshot … B` line) and `no browser errors`. Write down the snapshot size.

- [ ] **Step 2: Server sends `SnapW`**

In `server/src/run/visibility.rs`, change the import line to

```rust
use crate::protocol::{BossBar, EntSnap, Ev, SelfState, Snapshot};
use crate::wire::encode_snap;
```

and replace the end of the per-player loop

```rust
        let msg = ServerMsg::Snap(snap);
        run.players[pi].fov = fov;
        if let Some(tx) = &run.players[pi].tx {
            let _ = tx.send(axum::extract::ws::Message::Binary(encode(&msg).into()));
        }
```

with

```rust
        run.players[pi].fov = fov;
        if let Some(tx) = &run.players[pi].tx {
            let _ = tx.send(axum::extract::ws::Message::Binary(encode_snap(&snap).into()));
        }
```

`ServerMsg::Snap` stays in the enum: it keeps the client's `ServerMsg` type including `Snap`, which `net.ts` rebuilds.

- [ ] **Step 3: Client decodes arrays and packs inputs**

In `client/src/net.ts`, add the imports

```ts
import type { SnapW } from './generated/SnapW';
import { packInput, unpackSnap } from './wire';
```

In `onmessage`, replace

```ts
      const msg = decode(bytes) as ServerMsg;
```

with

```ts
      const raw = decode(bytes);
      // Snapshots arrive as a bare array (wire.ts), everything else as a tagged map.
      const msg: ServerMsg = Array.isArray(raw) ? { t: 'Snap', ...unpackSnap(raw as SnapW) } : (raw as ServerMsg);
```

In `send`, replace

```ts
    const bytes = encode(msg, { ignoreUndefined: true });
```

with

```ts
    // Inputs go out as a bare array; the server reads aim as f32 anyway.
    const bytes = msg.t === 'Input' ? encode(packInput(msg), { forceFloat32: true }) : encode(msg, { ignoreUndefined: true });
```

Update the file's first comment line to `// WebSocket connection with MessagePack encoding (compact snapshots and inputs, see wire.ts), RTT measurement and a`.

- [ ] **Step 4: Run all checks**

```bash
CARGO_TEST
cd client && npx tsc --noEmit && npm test
docker compose up --build -d && curl -s localhost:8080/health
cd tools/e2e && node smoke.mjs http://localhost:8080/ "" shots Wizard,Paladin
```

Expected: all tests pass; `OK`; `no browser errors`; the F3 `snapshot` line is clearly smaller than the baseline. Look at `shots/2-start.png` … `5-debug.png`: figures, terrain and the HUD look as before.

- [ ] **Step 5: Check prediction and a busy scene in a browser**

Open `http://localhost:8080/?debug&boss=demon&lag=150&jitter=40&loss=2` (Edge via Playwright or by hand), start a run, walk, dash, attack, press F3. Expected: `correction 0.00 px` most of the time, as before; enemies face and swing correctly (staff wielders included), projectiles point the right way, damage numbers appear where hits land. Note the snapshot size with several enemies in view.

- [ ] **Step 6: Commit**

```bash
git add server/src/run/visibility.rs client/src/net.ts
git commit -m "Send compact snapshots and inputs"
```

### Task 5: Docs and handoff

**Files:**
- Modify: `docs/TECHNICAL.md` (§2 layout if it lists server/client files, §4, §8 typical numbers, §12 tests)
- Modify: `docs/TODO.md` (Network)
- Modify: `docs/compact-snapshots.md` (status line)
- Modify: `HANDOFF.md`

- [ ] **Step 1: TECHNICAL.md**
  - §4: replace "`Snap(Snapshot)`: 30 Hz …" with: snapshots are sent as a bare array `SnapW` (see `wire.rs`, `wire.ts`), with positions in 1/16 px (`POS_SCALE`), entity aim in 1/256 turns, numbered events (`EV`); the client unpacks them into `Snapshot` and dispatches them as `{t: 'Snap'}`. Inputs are sent as a bare array `InputW`; the server recognizes the array marker. Add `wire.rs` / `wire.ts` to §2 if files are listed there.
  - §8 "Typical numbers": replace "snapshot about 250 B with 2 players" with the measured new size (and the busy-scene size from Task 4 Step 5).
  - §12: mention `wire.test.ts` and `wire-fixtures.json`.
- [ ] **Step 2: TODO.md** "Network": replace "delta-compressed snapshots (currently full FOV-filtered snapshots, about 250 B each)" with "delta snapshots if bandwidth ever matters (snapshots are compact arrays now, about N B with 2 players)", N measured.
- [ ] **Step 3: compact-snapshots.md** status line: `Status: done 2026-10-08 (approach A).`
- [ ] **Step 4: HANDOFF.md**
  - New "Last session" section for this feature (branch, what changed, measured sizes before/after, checks run). Move the terrain section down to "Session before".
  - Record the user's live confirmations from 2026-10-08: terrain (normal water run, chasm/drowning), chests and mimics in a real run, and rewards (XP and coins banked and visible in the lobby). Remove them from "Not yet verified" in "Current state" and from the terrain "Not verified yet" list; change "Suggested next steps" item 1 (finish terrain) accordingly and drop "delta-compressed snapshots" from item 6.
  - "Current state": add "compact snapshots and inputs".
  - Gotchas: "Snapshots and inputs are arrays on the wire (`wire.rs`, `wire.ts`). When you add a field to `Snapshot`, `SelfState`, `EntSnap`, `Ev` or `InputMsg`, add it to the wire type, both converters and `sample_snapshots`; the fixture test fails otherwise."
- [ ] **Step 5: Commit**

```bash
git add docs HANDOFF.md
git commit -m "Docs: compact snapshots, user's live confirmations"
```
