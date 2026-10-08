# Compact snapshots and inputs

Status: done 2026-10-08 (approach A). Branch `feature/compact-snapshots`.

## Goal

Smaller network messages as a tidy-up: the two frequent messages (snapshots at 30 Hz, inputs at 60 Hz) lose their field names and use smaller numbers. Expected: snapshots about 50–60 % smaller, inputs about half. No change in how the game plays or feels; prediction stays exact. Rare messages (lobby, `RunStarted`, `RunEnded`, `Pong`, …) stay as they are. No delta compression and no general compression (deflate): the user chose the simple option.

## Wire forms

Both stay MessagePack in binary WebSocket frames.

**Snapshot (server → client): a bare top-level array** instead of `{t: "Snap", ...}`:

```
SnapW = [tick, ack, ents: EntW[], me: SelfW, boss: BossW | nil, ev: EvW[], srv_ms]
EntW  = [id, kind, x, y, hp, anim, aim, anim_ms, flags, extra]
SelfW = [alive, hp, max_hp, x, y, dash_t, dash_dx, dash_dy, cd1, cd2, hidden, spectating | nil]
BossW = [kind, hp, max_hp, immune, enraged]
EvW   = [code, ...fields in the order of the `Ev` variant]
```

The client decodes every frame. If the result is an array, it is a snapshot; otherwise it is a normal `ServerMsg` map. (A tuple cannot sit inside the `t`-tagged `ServerMsg` enum, and the bare array also saves the tag.)

**Input (client → server): a bare top-level array**
`InputW = [seq, mx, my, aim, aim_dist, primary | nil, secondary | nil, view_lag, rtt]`.
The server looks at the first byte: a MessagePack array marker (`0x90–0x9f`, `0xdc`, `0xdd`) means an input, anything else is decoded as `ClientMsg` as before. All input values stay exact.

## Numbers

| Value | Wire |
|---|---|
| Entity and event positions | `u32`, in 1/`POS_SCALE` px, `POS_SCALE = 16`, rounded |
| Entity `aim` | `u8`, 1/256 of a full turn (`round(aim / 2π · 256)` wrapped to 0–255); the client reads 129–255 as negative and 128 as +π, so it gets the angle back in (−π, π], the range of `atan2` on the server (`EntityView`'s staff swing uses the raw angle, so exactly-left must stay +π) |
| `me` position and dash, cooldowns, hide time | exact, unchanged types |
| Input `aim`, `aim_dist` | exact `f32` |
| hp, damage/heal values, boss bar numbers, `Boom.r`, `srv_ms` | unchanged types |

MessagePack writes the smallest integer form that fits, so positions take 3 bytes up to 4,096 px (256 tiles; maps are 140 tiles today) and 5 bytes beyond. Bigger maps need no change. `POS_SCALE` is exported to the client in `defs.ts` (`CONST`).

Event codes follow the order of the `Ev` variants: `Dmg 0, Heal 1, Boom 2, Died 3, Raise 4, Immune 5, Tile 6, Msg 7, Coins 8, Sink 9`. Event positions (`x`, `y` in `Dmg`, `Heal`, `Boom`, `Died`, `Raise`, `Immune`, `Coins`, `Sink`) are scaled like entity positions; `Tile` keeps its tile coordinates.

## Code

**Server (`protocol.rs`, `wire.rs`):**
- `Snapshot`, `EntSnap`, `SelfState`, `BossBar` and `Ev` stay as the readable form and keep their ts-rs export, so the client's types do not change.
- New wire types with `#[ts(export)]`: `SnapW`, `EntW`, `SelfW`, `BossW`, `EvW` (`#[serde(untagged)]` enum of tuple variants, each starting with its `u8` code) and `InputW` (`Deserialize`).
- `encode_snap(&Snapshot) -> Vec<u8>` converts and packs with `rmp_serde::to_vec`. `visibility.rs` calls it.
- `decode` checks the first byte and turns an `InputW` into `ClientMsg::Input(InputMsg)`.

**Client:**
- New `client/src/wire.ts`: `unpackSnap(w: SnapW): Snapshot` and `packInput(i: InputMsg): InputW`, using `POS_SCALE`.
- `net.ts`: after `decode`, an array goes through `unpackSnap` and is dispatched as `{t: 'Snap', ...}`, so all handlers stay unchanged. `send()` packs `Input` messages with `packInput`. `lastSnapshotBytes` keeps working (F3).

## Tests

- Rust: an input array decodes to the same `InputMsg`; a map `ClientMsg` still decodes; an encoded sample snapshot is smaller than the old encoding (sizes printed).
- Parity fixture: `cargo test` writes `client/src/generated/wire-fixtures.json` with sample snapshots as bytes (number array) and their readable form before rounding. The samples cover every event type, a living and a dead spectating player, with and without a boss bar, and projectile `extra`. A client test unpacks the bytes and must match: positions within 1/32 px, aim within half a step, everything else exactly.
- Live: smoke test without browser errors; snapshot bytes in F3 before and after; prediction correction 0.00 px under `?lag=150&jitter=40&loss=2`.

## Docs

TECHNICAL §4 (protocol) and §8 (typical numbers), HANDOFF.
