# Progression 3b: the 16 new abilities — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 16 new abilities of spec §6.6 on the 3a framework, together with the effect-system changes the user decided on 2026-10-21 (no chance, damage-type tiers, Chilled, Singed, Tainted, Entangled, Fear, Warded, effect looks), and make every new ability testable in the browser through the `?debug` waiting room.

**Architecture:** Abilities stay data (`defs/abilities.rs`); `run/abilities.rs::try_use` dispatches by **`Shape`** instead of by id, so a new ability is a def plus, at most, a small id-specific rule inside its shape's executor. Effects stay data (`defs/effects.rs`); one apply path (`Run::apply`) takes an `Apply` record that carries power, magic, look and source. The client predicts by shape too (`ABILITIES[id].shape`).

**Tech Stack:** Rust (server, `cargo test`), TypeScript + Phaser (client, vitest), ts-rs generated bindings (`client/src/generated`), msgpack wire format (`server/src/wire.rs`, `client/src/wire.ts`).

**Spec:** [docs/superpowers/specs/2026-10-18-progression-design.md](../specs/2026-10-18-progression-design.md): §5, §6.3–6.6, §13 "In the run", and the section **"Changes decided on 2026-10-21 (before plan 3b)"**, which overrides the older sections where they differ. Read that section first.

## Global Constraints

- **No chance anywhere** (the user): no roll decides anything. `OnHit.chance` and the roll in `hit_effect` are removed; nothing new may use `rng` for a gameplay outcome.
- **No wildcard arms** (the user): every `match` over `AbilityId`, `Shape`, `EffectKind`, `EffectLook`, `AbilityMod`, `PropKind`, `WeaponKind`, `EquipSlot` or `DamageType` lists every variant; no `_ =>`. New enums with ids use `listed_enum!` (a gap in the ids does not compile).
- **Names:** "Attributes" (never "ability scores"); "ability" means only the LMB primary and RMB secondary. Never say "elemental"; say "damage-type effect".
- **No immunities, only resistances:** 100 % resistance refuses; there is no separate immunity flag.
- **Numbers** are the spec's: §6.6 table at the requirement's minimum, overridden by the 2026-10-21 section (Frost Shard 40 % cold / 30 % physical / 30 % magical; Frost Nova pure cold; Chilled ×0.7 move speed; Singed 3 heat/s 3 s; Tainted 2 poison/s 3 s; Fear base 3 s; Warded 3 s; Staff of Rot 50 % poison).
- **Effect bitmask:** `EffectKind::COUNT <= 16` (the snapshot's `u16`). This plan brings it to 15.
- **Sandbox:** in the agent sandbox run `cd server && cargo test -- --skip export_bindings` (focused: `cargo test --bin '*' <filter> -- --skip export_bindings`). The 55 ts-rs export tests cannot write `client/src/generated` there. **Every task that changes exported data** (effects, abilities, kinds, ResolvedAbility, protocol, wire fixtures) regenerates the bindings with the docker suite `docker compose -f docker-compose.test.yml run --rm test` (from the repo root) and commits the changed files under `client/src/generated`. If docker is not reachable from the sandbox, say so in the task report; the main session runs it.
- **Client checks:** `cd client && bash -lic 'npx vitest run && npx tsc --noEmit && npm run build'`.
- **Fingerprints:** `level_setup_is_unchanged`, `simulation_is_unchanged_after_waking_the_boss` and `plan_3a_fight_is_pinned` (`server/src/run/mod.rs`) must pass unchanged after every task. If a task changes one on purpose, it re-records it with a dated comment saying which rule moved it; no other task may.
- **Commits:** one commit per task at least, message `Progression 3b: <what>`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

## Review Focus

1. **Fear's source disappears or stands on the creature** (the frightening hero dies, leaves, or overlaps it): the creature keeps fleeing from the source's last position and never stands still or divides by zero. → test `fear_flees_from_the_last_known_spot_when_the_source_is_gone` (Task 2).
2. **Chain Spark never jumps to an ally, the wolf, an object or through a wall**: a reasonable player expects the wolf next to the goblin to be safe. → test `chain_spark_skips_allies_objects_and_walls` (Task 4).
3. **Volley's three shot ids around the 16-bit wrap and 0**: the client's cosmetic arrows must match the server's three shots, also when `shotId` wraps. → client test `volleyShotIds never contains 0 and wraps` (Task 9) and server test `volley_spawns_three_shots_with_consecutive_ids` (Task 4).
4. **Poison Coat on a weapon that already has an on-hit** (the Staff of Rot no longer has one, but the Wizard's fallback strike or a future poisoned dagger may): the coat's Poisoned wins for the coat's duration and the weapon's own effect returns afterwards. → test `the_coat_replaces_a_weapon_on_hit_while_it_lasts` (Task 5).
5. **The debug lift never leaks into a normal run**: a player without `?debug` (or on a server with debug off) gets exactly `Build::start` Attributes; `DebugEquip` is refused during a run and while ready, like `DebugLoadout`. → tests `debug_lift_only_for_debug_builds` and `debug_equip_is_refused_during_a_run_and_while_ready` (Task 8).

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `server/src/defs/effects.rs` | Effect data: new kinds, `EffectLook`, `save`, `resisted_by`, `replaces`, `flees`, tiered `TYPE_EFFECTS` | 1, 2 |
| `server/src/run/effects.rs` | `Apply`, `Run::apply`, tiers, replace/cancel order, looks, sources | 1, 2 |
| `server/src/run/ai.rs` | `flee` for frightened monsters | 2 |
| `server/src/run/mod.rs` | step loop (flee before thinking), hazards with a side and a pulse | 2, 7 |
| `server/src/defs/races.rs`, `defs/bosses.rs` | Fear resistances | 2 |
| `server/src/defs/abilities.rs` | 16 new ids, `Shape` Ring/GroundArea/Buff, `OwnStats.split`/`effect`, `WeaponMult.share`, id constants | 3–7 |
| `server/src/defs/loadout.rs` | `AbilityMod::AddOnHit`, `BehindArc`; `apply_mods` | 3 |
| `server/src/sheet.rs` | resolve the new fields (`behind`, own effect, split override, share) | 3 |
| `server/src/run/abilities.rs` | dispatch by shape; one executor per shape | 3–7 |
| `server/src/defs/kinds.rs`, `defs/lights.rs`, `defs/damage.rs` | new entity kinds `ChainSpark`, `Judgement`, `ThrownAxe`, `HolyGround`, `Roots` | 4, 7 |
| `server/src/defs/items.rs` | Throwing Axes, War Hammer; Staff of Rot | 1, 4, 6 |
| `server/src/protocol.rs`, `wire.rs` | `Snapshot.looks`, `Ev::Zap`, `ClientMsg::DebugEquip` | 2, 4, 8 |
| `server/src/lobby.rs` | `DebugEquip`, debug Attribute lift | 8 |
| `server/src/export.rs` | `shape` in `ABILITIES`, new `EFFECTS` fields | 3, 2 |
| `client/src/game/GameScene.ts`, `game/world.ts` | prediction by shape, Volley ids, hazards, Zap, Boom kinds | 9 |
| `client/src/game/anim/defs.ts` | projectile looks of the new kinds; full-circle swing | 9 |
| `client/src/game/status.ts`, `ui/text.ts`, `wire.ts` | new effect visuals, glyphs, looks decode | 1, 2, 10 |
| `client/src/ui/lobby.ts` | debug weapon selects | 8 |
| `docs/TECHNICAL.md`, `docs/PLAYER_GUIDE.md`, `docs/TODO.md`, `HANDOFF.md` | docs | 11 |

---

### Task 1: No chance, damage-type tiers, Chilled, Singed, Tainted

**Files:**
- Modify: `server/src/defs/effects.rs` (kinds, defs, `TYPE_EFFECTS`, `type_effects`, `OnHit`)
- Modify: `server/src/run/effects.rs` (`apply_effect`, `hit_effect`, `type_effect_hit`)
- Modify: `server/src/defs/items.rs:219-230` (Staff of Rot), every `OnHit { .. chance .. }` literal (grep `chance`)
- Modify: `client/src/ui/text.ts` (`EFFECT_GLYPH`), `client/src/ui/effectGlyph.test.ts`
- Test: `server/src/defs/effects.rs` tests, `server/src/run/effects.rs` tests

**Interfaces:**
- Produces: `EffectKind::{Chilled = 8, Singed = 9, Tainted = 10}`; `EffectDef.resisted_by: Option<DamageType>` (the damage type whose resistance alone resists it; replaces every use of "`dot.is_some()` means damage-type effect"); `EffectDef.replaces: &'static [EffectKind]` (the weaker tier); `TYPE_EFFECTS: [(DamageType, f64, EffectKind); 6]` (type, least share, effect), ordered so the stronger tier of a type comes first; `pub const TYPE_EFFECT_LOW: f64 = 0.25`, `TYPE_EFFECT_SHARE` stays `0.5`; `type_effects(split) -> Vec<EffectKind>` returns at most one effect per type, its highest tier met; `OnHit { kind, secs, magical, power }` (no `chance`).

- [ ] **Step 1: Write the failing tests** (in `defs/effects.rs` tests unless noted)

```rust
#[test]
fn tiers_pick_one_effect_per_type() {
    use crate::defs::damage::DamageSplit;
    assert_eq!(type_effects(&DamageSplit::split(&[(Cold, 0.4)])), vec![EffectKind::Chilled]);
    assert_eq!(type_effects(&DamageSplit::pure(Cold)), vec![EffectKind::Frozen]);
    assert_eq!(type_effects(&DamageSplit::split(&[(Heat, 0.25)])), vec![EffectKind::Singed]);
    assert_eq!(type_effects(&DamageSplit::split(&[(Heat, 0.2)])), vec![], "the claws' 20 % stay below the floor");
    assert_eq!(type_effects(&DamageSplit::split(&[(Poison, 0.3)])), vec![EffectKind::Tainted]);
    assert_eq!(type_effects(&DamageSplit::split(&[(Heat, 0.7), (Magical, 0.2)])), vec![EffectKind::Burning]);
}

#[test]
fn tier_effects_have_their_numbers() {
    let c = def(EffectKind::Chilled);
    assert_eq!((c.resisted_by, c.mods), (Some(Cold), &[m(MoveSpeed, Mul, 0.7)][..]));
    assert_eq!((def(EffectKind::Singed).dot, def(EffectKind::Singed).duration), (Some((Heat, 3.0)), 3.0));
    assert!(def(EffectKind::Singed).ends_in_water);
    assert_eq!((def(EffectKind::Tainted).dot, def(EffectKind::Tainted).duration), (Some((Poison, 2.0)), 3.0));
    assert_eq!(def(EffectKind::Frozen).replaces, &[EffectKind::Chilled]);
    assert_eq!(def(EffectKind::Burning).replaces, &[EffectKind::Singed]);
    assert_eq!(def(EffectKind::Poisoned).replaces, &[EffectKind::Tainted]);
}
```

Replace `type_effects_match_their_defs` with `type_effect_rows_match_their_defs`: for every row `(t, share, k)`, `def(k).resisted_by == Some(t)`; every kind with `resisted_by` appears in exactly one row; every `replaces` entry has the same `resisted_by`.

In `run/effects.rs` tests (use `test_run`, a monster from the existing helpers):

```rust
#[test] fn the_stronger_tier_replaces_the_weaker()      // Chilled on, then Frozen lands → Chilled gone; Frozen on → Chilled refused (apply returns false)
#[test] fn a_refused_freeze_leaves_the_chill()           // target cold resistance 1.0 or save 20 above power: Frozen refused, Chilled stays
#[test] fn fire_and_cold_cancel_across_tiers()           // Singed ends Frozen and Chilled; Chilled ends Burning and Singed; the canceller itself is not applied
#[test] fn a_resisted_singe_still_thaws()                // heat resistance 1.0 + Singed hit on a Frozen creature: Frozen gone
#[test] fn an_on_hit_effect_always_lands()               // OnHit without chance applied 20 times on fresh monsters: always on; run.rng state unchanged (compare a clone's next u64)
#[test] fn the_staff_of_rot_poisons_every_hit()          // replaces `a_poisoned_blade_poisons_at_the_wielders_power` in run/abilities.rs: Wizard with StaffOfRot strikes a goblin → Poisoned on every hit, at the power of the Wizard's STR 8 (a Staff is a Melee weapon)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd server && cargo test --bin '*' tier -- --skip export_bindings` and `cargo test --bin '*' effects -- --skip export_bindings`
Expected: compile errors (unknown `EffectKind::Chilled`, field `resisted_by`), then failures.

- [ ] **Step 3: Implement**

- `EffectKind` gains `Chilled = 8, Singed = 9, Tainted = 10` in `listed_enum!`.
- `EffectDef` gains `resisted_by` and `replaces` (default `None`, `&[]` in `NONE`). Burning, Frozen, Poisoned, Chilled, Singed, Tainted set `resisted_by`.
- `cancels`: Burning and Singed cancel `[Frozen, Chilled]`; Frozen and Chilled cancel `[Burning, Singed]`.
- `apply_effect` order (the 2026-10-21 rules; keep the doc comment current):
  1. cancel (as now: any present cancelled effect is removed, return false);
  2. refuse if an active effect `replaces` contains `kind`;
  3. resistance (`resisted_by`'s damage resistance ≥ 1 refuses; otherwise `effect_secs` for an effect without `resisted_by`), water, `secs <= 0`;
  4. add; **only then** remove every kind in `def(kind).replaces`.
- `hit_effect` applies without any roll. Remove `chance` from `OnHit` and from every literal (`grep -rn "chance" server/src`).
- `type_effect_hit` uses the new `type_effects`.
- Staff of Rot: props `plain!(PropKind::DamageShare(DamageType::Poison, 0.5))` only (no `OnHit`), so `weapon_properties_fill_split_and_on_hit` in `sheet.rs` expects `rot.melee.on_hit == None` and a poison share of 0.5.
- Client `EFFECT_GLYPH`: Chilled `'C'`, Singed `'G'`, Tainted `'T'`; extend `effectGlyph.test.ts` with these three.
- Update the `TECHNICAL`-style doc comments in `defs/effects.rs` (module comment: how to add an effect now includes `resisted_by`/`replaces` and a `TYPE_EFFECTS` row).

- [ ] **Step 4: Run all server tests**

Run: `cd server && cargo test -- --skip export_bindings`
Expected: all pass, fingerprints unchanged (no fingerprint run uses a 25–50 % share or a chance below 1; if one moves, stop and report why before re-recording).

- [ ] **Step 5: Regenerate bindings and run the client checks**

Run: `docker compose -f docker-compose.test.yml run --rm test` (repo root), then the client checks.
Expected: all pass; `client/src/generated/defs.ts` lists the three new effects.

- [ ] **Step 6: Commit** — `Progression 3b: no chance, damage-type tiers (Chilled, Singed, Tainted)`

---

### Task 2: Apply records, effect looks and sources, own saves; Entangled, Fear, Warded, Coated

**Files:**
- Modify: `server/src/defs/effects.rs`, `server/src/run/effects.rs`, `server/src/run/ai.rs`, `server/src/run/mod.rs` (step loop), `server/src/defs/races.rs`, `server/src/defs/bosses.rs`
- Modify: `server/src/protocol.rs` (`Snapshot.looks`), `server/src/wire.rs` (`SnapW` 10th field), `server/src/run/visibility.rs` (fill `looks`), `server/src/export.rs` (`EFFECTS` gains `flees`, `EFFECT_LOOK` ids)
- Modify: `client/src/wire.ts` (decode `looks`), `client/src/net.ts` types if the `Snapshot` type lives there, `client/src/ui/text.ts` glyphs, `client/src/ui/effectGlyph.test.ts`, `client/src/wire.test.ts`
- Test: `server/src/run/effects.rs`, `server/src/run/ai.rs`, `server/src/wire.rs`, `client/src/wire.test.ts`

**Interfaces:**
- Consumes: Task 1's `apply_effect` order.
- Produces:
  - `EffectKind::{Entangled = 11, Fear = 12, Warded = 13, Coated = 14}`.
  - `listed_enum! pub enum EffectLook: u8 { Plain = 0, Vines = 1 }` in `defs/effects.rs` (serialized as its id).
  - `EffectDef.save: Option<Attr>` (Fear `Some(Wil)`, Entangled `Some(Str)`, others `None` → §5 rule), `EffectDef.flees: bool` (Fear only).
  - `ActiveEffect { kind, left, dot_t, look: EffectLook, source: Option<u32>, from: Vec2 }` (`from`: where the source was last seen; `Vec2::ZERO` when there is no source).
  - `pub struct Apply { pub kind: EffectKind, pub secs: Option<f64>, pub power: Option<i32>, pub magical: bool, pub look: EffectLook, pub source: Option<(u32, Vec2)> }` with `Apply::plain(kind, secs)` (unscaled, `Plain`, no source) and `Apply::from_hit(h: OnHit)`.
  - `Run::apply(&mut self, c: Creature, a: Apply) -> bool` — the one apply path. `apply_effect(c, kind, secs)` = `apply(c, Apply::plain(kind, secs))`; `apply_effect_from(c, kind, secs, power, magical)` stays as a thin wrapper. A refresh keeps the longer time and takes the new `look`, `source` and `from`.
  - `OnHit` gains `look: EffectLook` (`Plain` everywhere today).
  - `Effects::looks(&self) -> impl Iterator<Item = (EffectKind, EffectLook)>` (non-`Plain` only); `Effects::fear_from(&self) -> Option<(Option<u32>, Vec2)>`.
  - `Snapshot.looks: Vec<(u32, u8, u8)>` (entity id, effect id, look id) for every sent entity's non-`Plain` effects; `SnapW` appends it as the 10th element; the client `Snapshot` gains `looks: [number, number, number][]`.
  - `ai::flee(run: &mut Run, mi: usize, dt: f64)`.

- [ ] **Step 1: Write the failing tests**

```rust
// defs/effects.rs
#[test] fn new_effects_have_their_rules()
// Entangled: no_move, !no_act, !no_turn, save Some(Str), negative; Fear: flees, save Some(Wil), negative, duration 3.0;
// Warded: positive, mods = ResistEffect(Blind|Sleep|Petrified) Add 1.0 (exactly these three); Coated: positive, no mods.

// run/effects.rs
#[test] fn an_effect_names_its_own_save()
// Fear at power 16 on a goblin (WIL 8) lasts 3 × 1.4 = 4.2 s (±1e-9), whatever `magical` says; on an orc (WIL 11) 3.75 s.
// Entangled at power 14 on an ogre (STR 19) lasts base × (1 + (14 − 19)/20).
#[test] fn the_look_and_source_ride_on_the_effect()
// apply Entangled with look Vines, source (hero id, pos): `effects.looks()` yields (Entangled, Vines); refresh with Plain → Plain.
#[test] fn warded_refuses_the_lichs_spells_only()
// Warded on a hero: Sleep, Blind, Petrified refused; Slowed and Burning still land.
#[test] fn undead_and_bosses_never_fear_and_demons_fear_half()
// skeleton: refused; imp: 0.5 × the scaled time; every BossId profile: Fear resistance ≥ 1.0.

// run/ai.rs
#[test] fn a_frightened_monster_runs_away_and_does_not_attack()
// orc chasing a hero at 20 px, Fear from the hero: after 30 steps it is farther, its aim points away (|angle_diff(aim, hero→orc)| < 0.3), no Dmg event on the hero, `ai.windup` is None.
#[test] fn fear_flees_from_the_last_known_spot_when_the_source_is_gone()
// Fear with source id 999 (no such creature) and from = a point 10 px west: it walks east; with from == its own position it walks along its reversed aim; no NaN in pos.
#[test] fn an_entangled_monster_stays_put_but_still_shoots()
// goblin archer Entangled 3 s with a hero in range: position unchanged after 60 steps, at least one arrow projectile spawned.

// wire.rs
#[test] fn snapshot_carries_effect_looks()   // encode a Snapshot with looks [(7, 11, 1)]: the decoded array's 10th element is [[7, 11, 1]]
```

Client `wire.test.ts`: the fixture snapshot decodes `looks` (regenerated fixture from `export_wire_fixtures`; add one entity with an Entangled Vines look to `sample_snapshots`).

- [ ] **Step 2: Run them to verify they fail** — `cargo test --bin '*' effects -- --skip export_bindings`, `cargo test --bin '*' ai -- --skip export_bindings`; expected compile errors on the new names.

- [ ] **Step 3: Implement**

- `apply_effect_from`'s save: `def(kind).save.unwrap_or(if magical { Wil } else { Con })`. Positive effects stay unscaled.
- **Step loop** (`run/mod.rs` monster loop): after the `no_act` check and before `is_ally`, a monster whose effects have a `flees` effect calls `ai::flee` and `continue`s (bosses are skipped by the loop already; allies never get Fear from heroes, but keep the order so an ally would flee too).
- **`ai::flee`**: clear `ai.windup`; resolve the source each tick (a living player or monster with that id → update `from` to its position); direction = `pos − from`, or the reversed `aim` when shorter than 1 px; `move_toward(run, mi, pos + dir.norm() * 24.0, speed, dt)`; set `aim` to the direction and the anim to `Move`. No rng.
- **Races:** `Race::Undead` effect resistances `Fear 1.0`; `Race::Demon` `Fear 0.5` (keep `plain`'s shape: give those two a `RaceDef { effect_res: …, ..plain(…) }`). **Bosses:** the demon's list adds `Fear 0.5` (race 0.5 + 0.5), the dragon's and the lich's `Fear 1.0` (the lich's race already gives 1.0; adding it in its list is not needed — assert the totals in the test, not the lists).
- **Snapshot:** `visibility.rs` pushes `(m.id, kind, look)` for each sent monster's and player's non-`Plain` effect.
- Export `EFFECTS[id].flees` and `EFFECT_LOOK` (`{ Plain: 0, Vines: 1 }`) for the client.
- Client glyphs: Entangled `'E'`, Fear `'R'`, Warded `'W'`, Coated `'V'`; test them. The client stores `looks` per entity in the world state (`EntState.looks?: Map<effect, look>` or a field the status view reads); the drawing comes in Task 10.

- [ ] **Step 4: Run all server tests** — expected pass, fingerprints unchanged (no new effect is applied by anything yet).
- [ ] **Step 5: Regenerate bindings (docker) and run the client checks** — expected pass.
- [ ] **Step 6: Commit** — `Progression 3b: effect looks and sources, own saves; Entangled, Fear, Warded, Coated`

---

### Task 3: The ability model for 3b (shapes, own effects, split override, share, behind; dispatch by shape)

No new ability yet: the seven abilities must behave exactly as before.

**Files:**
- Modify: `server/src/defs/abilities.rs`, `server/src/defs/loadout.rs`, `server/src/sheet.rs`, `server/src/run/abilities.rs`, `server/src/export.rs`
- Test: `server/src/defs/abilities.rs`, `server/src/defs/loadout.rs`, `server/src/sheet.rs`, `server/src/run/abilities.rs`

**Interfaces:**
- Produces:
  - `Shape::{Swing, Projectile, Blast, Ring, Dash, SelfArea, GroundArea, Buff, Summon}`. `Ring`: an instant hit on enemies around the user; `SelfArea`: an effect or heal on the user and allies around; `GroundArea`: a hazard placed at the feet or at an aimed spot; `Buff`: an effect on the user only.
  - `OwnStats` gains `split: Option<DamageSplit>` (overrides `kind_split(kind)`) and `effect: Option<OwnEffect>`; `pub struct OwnEffect { pub kind: EffectKind, pub power: Attr, pub look: EffectLook }`. `OwnStats.kind` doc: "its projectile or ground area".
  - `WeaponMult` gains `share: Option<(DamageType, f64)>` (an added non-physical share, through `with_shares`).
  - `AbilityDef` gains `behind: f64` (0 for every ability until Flanking Thrust).
  - `ResolvedAbility` gains `behind: f64` (half-angle in rad of the "from behind" cone; 0 = none) and `#[serde(skip)] effect: Option<OnHit>` (the own effect, `secs` = `duration`, `power` = `attrs.get(own.effect.power)`, `magical` = category is Spell or Innate, `look`). `on_hit` stays the weapon's/hit's.
  - `AbilityMod::AddOnHit(OnHit)` (sets `on_hit`; a `power` of 0 takes the ability's `power`) and `AbilityMod::BehindArc(f64)` (adds rad to `behind`; sum, never below 0). Both handled in `apply_mods` and listed in `sheet::wolf_mods`'s exhaustive match.
  - `run/abilities.rs`: `try_use` keeps the melee rule, then `match def.shape` → one private fn per shape: `use_projectile`, `use_blast`, `use_swing`, `use_ring`, `use_dash`, `use_self_area`, `use_ground_area`, `use_buff`, `use_summon`, each `fn(run: &mut Run, pi: usize, a: &ResolvedAbility, shot: u16) -> Anim`. Inside a shape fn, an id-specific rule is a `match a.id` that lists every id of that shape and nothing else may call it with another (`debug_assert!(ab::def(a.id).shape == Shape::X)`); ids of other shapes go in one arm `X | Y => unreachable!("{:?} is not a <shape>", a.id)` — that arm names them, so no wildcard.
  - `export.rs`: `ABILITIES[id].shape` (`"Swing"` etc.).

- [ ] **Step 1: Write the failing tests**

```rust
// defs/abilities.rs: replace ability_data_is_consistent's invariants
// - Spell or Innate ⇒ uses Nothing (techniques may use nothing: War Cry, Poison Coat);
// - uses Melee ⇒ shape Swing | Dash | Ring;  uses Ranged ⇒ shape Projectile;
// - shape Blast | GroundArea with ranged == true needs own.range > 0;
// - own.effect ⇒ shape Ring | SelfArea | GroundArea | Buff;
// - Spell/Innate with own.damage > 0 ⇒ own.at > 0.

// defs/loadout.rs
#[test] fn add_on_hit_and_behind_arc_mods()
// AddOnHit(OnHit{kind: Poisoned, secs: 2.0, magical: true, power: 0, look: Plain}) on the Paladin's Strike: on_hit Some with power == r.power;
// BehindArc(0.5) twice on an ability with behind 1.0 → 2.0; BehindArc(-5.0) → 0.0.

// sheet.rs
#[test] fn own_split_and_share_and_effect_resolve()
// with test-only defs: an OwnStats split override wins over kind_split; WeaponMult share Magical 0.3 on the knight sword → split 0.7/0.3;
// an own effect resolves power from its Attr and secs from duration.

// run/abilities.rs
#[test] fn every_shape_still_plays_today()   // the seven abilities: same Anim, cooldown and spawned kind as before (one assert per ability; reuse existing helpers)
```

`hero_sheet_reproduces_today` and the three fingerprints must pass unchanged.

- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement** the fields, `resolve_ability` (Melee: `split = melee.split.with_shares(share)` when `share` is set; Nothing: `split = own.split.unwrap_or(kind_split…)`; every branch fills `effect` from `own.effect`), the mods, the shape dispatch (move today's arms into their shape fns unchanged), the export field. Let `governing` return `(Attr, f64)` with the damage percentage so the `unreachable!` arm in `sheet.rs` goes (a 3a leftover).
- [ ] **Step 4: Run all server tests** — pass, fingerprints unchanged.
- [ ] **Step 5: Regenerate bindings (docker); client checks** — pass (the client ignores `shape` until Task 9).
- [ ] **Step 6: Commit** — `Progression 3b: ability shapes, own effects and shares; dispatch by shape`

---

### Task 4: Projectile abilities — Frost Shard, Chain Spark, Judgement, Hurl, Volley

**Files:**
- Modify: `server/src/defs/abilities.rs`, `server/src/defs/kinds.rs`, `server/src/defs/lights.rs`, `server/src/defs/damage.rs`, `server/src/defs/items.rs`, `server/src/run/abilities.rs`, `server/src/protocol.rs` (`Ev::Zap`), `server/src/wire.rs` (`EvW::Zap`, code 15), `client/src/wire.ts` (decode Zap; drawing in Task 9)
- Test: those files' tests

**Interfaces:**
- Consumes: Task 3's shapes and `use_projectile`.
- Produces:
  - `AbilityId::{FrostShard = 7, ChainSpark = 8, Judgement = 9, Hurl = 10, Volley = 11}`.
  - `EntityKind::{ChainSpark = 63, Judgement = 64, ThrownAxe = 65}` (below 70, so `isProjectileKind` holds); `ALL` grows; `kind_split`: ChainSpark and Judgement `pure(Magical)`, ThrownAxe physical; `kind_light`: ChainSpark Magic (as Missile), Judgement Holy, ThrownAxe none.
  - `ItemId::ThrowingAxes = 41`: `ranged(K::ThrowingAxe, 16.0, 0.9, 170.0, 220.0, 3.0, EntityKind::ThrownAxe, At::BASE)`, sprite `weapon_throwing_axe`, `ALL` classes, no requirement (the agent's numbers, for the balancing pass).
  - Constants in `defs/abilities.rs`: `VOLLEY_ARROWS: u8 = 3`, `VOLLEY_SPREAD: f64 = 30° in rad` (the arrows at −15°, 0, +15°), `CHAIN_JUMPS: u8 = 2`, `CHAIN_REACH: f64 = 48.0`, `CHAIN_FALLOFF: f64 = 0.7`.
  - `Ev::Zap { x: f32, y: f32, x2: f32, y2: f32 }` (one per jump, sent to the whole party like hero hits), `EvW::Zap(15, u32, u32, u32, u32)`.
  - `pub fn volley_shot(shot: u16, i: u8) -> u16` = `shot.wrapping_add(i)` — the server's rule; the client reserves ids so none is 0 (Task 9).

Defs (spec §6.6 and the 2026-10-21 section; `own(damage, cooldown, range, speed, radius, duration, kind, at)`):

| Id | Slot | Category | Uses | ranged | req | shape | own / weapon_mult |
|---|---|---|---|---|---|---|---|
| FrostShard | Primary | Spell | Nothing | true | INT 14 | Projectile | own(10, 0.5, 200, 200, 3, 0, FrostBolt, 14), split 40 % Cold, 30 % Physical, 30 % Magical; classes Wizard |
| ChainSpark | Primary | Spell | Nothing | true | INT 18 | Projectile | own(14, 0.8, 180, 260, 3, 0, ChainSpark, 18); Wizard |
| Judgement | Primary | Innate | Nothing | true | CHA 16 | Projectile | own(18, 0.9, 150, 220, 3, 0, Judgement, 16); Paladin |
| Hurl | Primary | WeaponAttack | Ranged | true | WeaponKind[ThrowingAxe] | Projectile | NO_OWN, ONE; Barbarian |
| Volley | Primary | WeaponAttack | Ranged | true | DEX 15, WeaponKind[Bow, Longbow] | Projectile | NO_OWN, damage 0.6, time 1.4; ElvenRanger |

Spell projectiles stop at the first enemy (`pierce` 0 as Magic Missile); Hurl and Volley pierce by overkill like Shoot.

- [ ] **Step 1: Write the failing tests** (`run/abilities.rs`, using `test_run_with` and a debug-style build `Build { own: vec![id], loadout: …, extra: <Attributes to meet the req>, .. }`; add a test helper `run_with_ability(class, slot, id, extra, equipment) -> Run`)

```rust
#[test] fn frost_shard_chills_and_never_freezes()        // hit on a goblin: Chilled on, Frozen off; damage = 10 × INT scaling × split vs res; cooldown 0.5
#[test] fn chain_spark_jumps_twice_with_falloff()        // three goblins 30 px apart in a line: damages d, 0.7 d, 0.49 d (after INT scaling); two Ev::Zap; a fourth goblin farther untouched
#[test] fn chain_spark_skips_allies_objects_and_walls()  // wolf and a chest within 48 px of the first target, a goblin behind a wall tile: no jump to any of them (Review Focus 2)
#[test] fn chain_spark_never_returns()                   // two goblins only: one jump, not back to the first
#[test] fn judgement_is_holy_and_magical()               // projectile kind Judgement, split pure Magical, a Holy light attached
#[test] fn hurl_needs_a_throwing_axe()                    // Barbarian without one: LoadoutError::Requirement(Hurl, WeaponKind); with ThrowingAxes in Ranged: spawns ThrownAxe, overkill pierce u8::MAX
#[test] fn volley_spawns_three_shots_with_consecutive_ids() // shot 0xfffe: shots 0xfffe, 0xffff, 0x0000 (server rule), angles aim−15°, aim, aim+15°, each damage 0.6 × the bow's; cooldown 1.4 × the bow's
#[test] fn volley_falls_back_to_strike_in_melee()         // ranged primary: in melee it strikes with the rapier like Shoot
```

`wire.rs`: `event_codes_follow_ev_codes` covers Zap = 15.

- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement** in `use_projectile`: one projectile for every id but Volley (three, via `volley_shot`); the kind is `a.projectile`. Chain Spark: in `impact`, when a hero's projectile of kind `ChainSpark` hurts a monster, call `chain_jumps(run, src_pi, first_mi, damage)`: up to `CHAIN_JUMPS` times pick the nearest living non-ally monster not yet hit within `CHAIN_REACH` of the last target with `line_of_sight`, hurt it with `damage.amount × CHAIN_FALLOFF^n` (same split, power, on-hit), push an `Ev::Zap` from the last target to it. The projectile itself stops (`Pierce::Never`).
- [ ] **Step 4: Run all server tests** — pass, fingerprints unchanged.
- [ ] **Step 5: Regenerate bindings (docker); client checks** (the client must decode `Zap` without crashing: `wire.test.ts` fixture includes one).
- [ ] **Step 6: Commit** — `Progression 3b: Frost Shard, Chain Spark, Judgement, Hurl, Volley`

---

### Task 5: Weapon swings and the coat — Smite, Whirl, Flanking Thrust, Poison Coat

**Files:**
- Modify: `server/src/defs/abilities.rs`, `server/src/run/abilities.rs`
- Test: `server/src/run/abilities.rs`

**Interfaces:**
- Consumes: Task 2's `Coated`, Task 3's `behind`, `WeaponMult.share`, `use_swing`, `use_buff`.
- Produces:
  - `AbilityId::{Smite = 12, Whirl = 13, FlankingThrust = 14, PoisonCoat = 15}`.
  - Constants: `BEHIND_ARC: f64 = 60° in rad` (half-angle), `BEHIND_MULT: f64 = 2.0`, `COAT_SHARE: f64 = 0.3`, `COAT_POISON_SECS: f64 = 3.0`, `SMITE_FLASH: f64 = 0.3`.
  - `fn weapon_damage(run: &Run, pi: usize, a: &ResolvedAbility) -> Damage` in `run/abilities.rs`: `damage_of(a)`, and while the hero has `Coated` and `ab::def(a.id).uses != Uses::Nothing`: the split with `COAT_SHARE` poison added (`with_shares`) and `on_hit = Poisoned COAT_POISON_SECS, non-magical, power a.power`. **Every** weapon attack uses it: Strike, the fallback, Shoot, Hurl, Volley, Charge, Smite, Whirl, Flanking Thrust, Ground Slam (Task 6).

| Id | Slot | Category | Uses | ranged | req | shape | numbers |
|---|---|---|---|---|---|---|---|
| Smite | Primary | WeaponAttack | Melee | false | CHA 15, WeaponKind[Sword, Mace, Hammer] | Swing | mult damage 1.4, time 1.6, share (Magical, 0.3); Paladin |
| Whirl | Primary | Technique | Melee | false | DEX 14 | Swing | mult damage 0.75, time 1.3, arc Some(TAU); Barbarian |
| FlankingThrust | Primary | WeaponAttack | Melee | false | DEX 16, WeaponKind[Dagger, DuellingSword, Katana, Machete] | Swing | ONE; `behind` = BEHIND_ARC (`AbilityDef.behind`, Task 3); ElvenRanger |
| PoisonCoat | Secondary | Technique | Nothing | false | WIL 15 | Buff | own(0, 16, 0, 0, 0, 6, None, 0), effect Coated (power Wil, Plain); ElvenRanger |

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn smite_adds_holy_and_flashes()          // knight sword: damage 20 × 1.4 split 0.7/0.3 magical; cooldown 0.45 × 1.6; a Holy flash at the first enemy hit (SMITE_FLASH); none when it hits nothing
#[test] fn smite_needs_a_sword_mace_or_hammer()   // Paladin with an axe-kind melee weapon: LoadoutError::Requirement
#[test] fn whirl_hits_all_around()                // goblins north, south, east, west within reach: all four hurt, each 0.75 × the axe's; cooldown 0.8 × 1.3
#[test] fn flanking_thrust_doubles_from_behind()  // goblin facing away (aim pointing from ranger to goblin): ×2 and the Dmg event has crit = true; facing the ranger: ×1, crit false; at 59° off its back ×2, at 61° ×1
#[test] fn find_the_gap_widens_behind()           // BehindArc(30° in rad) mod: at 80° off the back ×2
#[test] fn poison_coat_poisons_weapon_attacks_only() // after Poison Coat: Coated 6 s on the ranger; a bow shot's split has 0.3 poison and its on-hit Poisoned 3 s lands (the 0.3 share alone would Taint; Poisoned replaces Tainted); after 6 s the bow is plain again
#[test] fn the_coat_replaces_a_weapon_on_hit_while_it_lasts() // a weapon with an OnHit Slowed (test item via sheet edit): coated → Poisoned only; uncoated → Slowed (Review Focus 4)
```

- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.** `melee_arc` takes the `Damage` from `weapon_damage` and, for `a.behind > 0`, doubles a hit whose `angle_diff(target.pos.angle_to(hero_pos), target.aim + PI).abs() <= a.behind` and passes `crit = true` for it. Smite's flash: `run.add_flash(LightKind::Holy, first_hit_pos, SMITE_FLASH)`. `use_buff` applies the own effect to the hero (`Apply` from `a.effect`, unscaled because positive).
- [ ] **Step 4: Run all server tests** — pass, fingerprints unchanged (Strike's damage path is the same while not coated).
- [ ] **Step 5: Regenerate bindings (docker); client checks.**
- [ ] **Step 6: Commit** — `Progression 3b: Smite, Whirl, Flanking Thrust, Poison Coat`

---

### Task 6: Rings and party effects — Frost Nova, War Cry, Ground Slam, Haste, Purify

**Files:**
- Modify: `server/src/defs/abilities.rs`, `server/src/defs/items.rs` (War Hammer), `server/src/run/abilities.rs`, `server/src/run/entities.rs` (`Player.slam: Option<f64>`), `server/src/run/mod.rs` (`step_player` ticks the slam), `server/src/protocol.rs` (Boom codes doc)
- Test: `server/src/run/abilities.rs`

**Interfaces:**
- Consumes: Task 2's `Fear`, `Warded`, `Apply` with source; Task 3's `use_ring`, `use_self_area`; Task 5's `weapon_damage`.
- Produces:
  - `AbilityId::{FrostNova = 16, WarCry = 17, GroundSlam = 18, Haste = 19, Purify = 20}`.
  - `ItemId::WarHammer = 42`: `melee(K::Hammer, 26.0, 1.0, 1.8, 24.0, phys(), At::BASE)`, sprite `weapon_hammer`, `ALL`, no requirement (the agent's numbers).
  - Constants: `SLAM_WINDUP: f64 = 0.5`, `SLAM_PUSH: f64 = 24.0` (Ground Slam pushes `max(weapon push, SLAM_PUSH)` with the hero's STR), `NOVA_FLASH: f64 = 0.3`, `PURIFY_FLASH: f64 = 0.3`.
  - `Ev::Boom` codes (protocol doc): `10` frost ring, `11` war cry, `12` haste ring, `13` purify ring; Ground Slam reuses `5` (shockwave).
  - `Player.slam: Option<f64>` (seconds until the slam lands); `pub fn land_slam(run: &mut Run, pi: usize)`.

| Id | Slot | Category | Uses | ranged | req | shape | numbers |
|---|---|---|---|---|---|---|---|
| FrostNova | Secondary | Spell | Nothing | false | INT 17 | Ring | own(22, 9, 0, 0, 44, 0, None, 17), split pure Cold; Wizard |
| WarCry | Secondary | Technique | Nothing | false | STR 16 | Ring | own(0, 12, 0, 0, 56, 3, None, 0), effect Fear (power Str, Plain); Barbarian |
| GroundSlam | Secondary | Technique | Melee | false | STR 17, WeaponKind[Hammer, Club] | Ring | own(0, 6, 0, 0, 34, 0, None, 0), mult damage 1.2; Barbarian |
| Haste | Secondary | Spell | Nothing | false | INT 15, WIL 14 | SelfArea | own(0, 14, 64, 0, 64, 4, None, 0), effect Accelerated (power Int); Wizard |
| Purify | Secondary | Innate | Nothing | false | WIL 14 | SelfArea | own(0, 15, 64, 0, 64, 3, None, 0), effect Warded (power Cha); Paladin |

Rules: War Cry gives the enemies in its radius Fear (source = the hero) and every hero and ally within its radius (the user included) Accelerated for the same `duration`. Haste: Accelerated on the user and every hero and ally within `radius`. Purify: on the user and every hero and ally within `radius`, remove every non-positive effect, then apply Warded. Frost Nova hurts every non-ally monster within `radius` (line of sight) with its damage; it freezes through the tier rule. Ground Slam: using it sets `slam = Some(SLAM_WINDUP)` and the `Cast` anim; when it reaches 0 the slam lands at the hero's position then (radius, `weapon_damage`, push away from the hero), with `Ev::Boom k 5`; a hero who dies, sinks or is knocked meanwhile loses the slam.

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn frost_nova_freezes_around_the_wizard()      // goblins at 30 px and 60 px: the near one hurt and Frozen, the far one untouched; Boom k 10; cooldown 9; works in melee
#[test] fn war_cry_frightens_enemies_and_hastens_allies() // goblin within 56: Fear with source = the hero id, 4.2 s at STR 16 vs WIL 8; the hero and a second hero within 56: Accelerated 3 s; the wolf (ally) never frightened
#[test] fn war_cry_spares_the_undead()                // skeleton in range: no Fear (race resistance)
#[test] fn ground_slam_lands_after_its_windup()       // War Hammer, STR 17: no damage before 0.5 s, then every goblin within 34 hurt 1.2 × the hammer and pushed; Boom k 5 at the landing position
#[test] fn ground_slam_needs_a_hammer_or_club()       // the Great Axe: LoadoutError::Requirement
#[test] fn a_knocked_hero_loses_the_slam()            // knock the hero during the wind-up: nothing lands
#[test] fn haste_hastens_the_party_in_range()         // two heroes and the wolf within 64, one hero at 100: three Accelerated 4 s, one not
#[test] fn purify_cleanses_and_wards()                // hero Burning and Slowed and Accelerated: after Purify Burning and Slowed gone, Accelerated stays, Warded 3 s; then a lich Sleep is refused
```

- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement** the defs, the item, `use_ring` (Frost Nova, War Cry, Ground Slam), `use_self_area` (Holy Light as before, Haste, Purify), the slam timer (tick in `step_player` before abilities; clear on death, sink or knock).
- [ ] **Step 4: Run all server tests** — pass, fingerprints unchanged.
- [ ] **Step 5: Regenerate bindings (docker); client checks.**
- [ ] **Step 6: Commit** — `Progression 3b: Frost Nova, War Cry, Ground Slam, Haste, Purify`

---

### Task 7: Ground areas — Consecrate and Entangle; hazards with a side

**Files:**
- Modify: `server/src/defs/abilities.rs`, `server/src/defs/kinds.rs`, `server/src/defs/lights.rs`, `server/src/defs/damage.rs`, `server/src/run/entities.rs` (`Hazard`), `server/src/run/mod.rs` (`tick_hazards`, `spawn_hazard`), `server/src/run/abilities.rs` (`use_ground_area`), callers of `spawn_hazard` (dragon, companion, tests)
- Test: `server/src/run/abilities.rs`, `server/src/run/mod.rs`

**Interfaces:**
- Consumes: Task 2's `Apply` and `EffectLook::Vines`; Task 3's `use_ground_area`, `ResolvedAbility.effect`.
- Produces:
  - `AbilityId::{Consecrate = 21, Entangle = 22}` (23 ids in all).
  - `EntityKind::{HolyGround = 71, Roots = 72}`; `kind_split(HolyGround) = pure(Magical)`; `kind_light(HolyGround) = Holy`, Roots none.
  - `pub enum HazardSide { Monsters, Heroes { owner: u32 } }` (who the hazard belongs to: `Monsters` hurts heroes and allies, as fire patches do today; `Heroes` acts on non-ally monsters only, crediting `owner`). `pub enum HazardPulse { Hurt(Damage), Bind(OnHit) }`. `Hazard { id, kind, pos, radius, life, pulse_t, side, pulse }`.
  - `Run::spawn_hazard(kind, pos, radius, life, side, pulse)`; `pub fn spawn_fire_patch(run, pos, radius, life, damage)` keeps today's callers' meaning.
  - Constant `ENTANGLE_PULSE_SECS: f64 = 1.0`.
  - `visibility.rs` sends a hazard's radius in `EntSnap.6` (the aim field, unused for hazards), so the client can size the area (Task 9).

| Id | Slot | Category | Uses | ranged | req | shape | numbers |
|---|---|---|---|---|---|---|---|
| Consecrate | Secondary | Innate | Nothing | false | CHA 15 | GroundArea | own(8, 12, 0, 0, 40, 5, HolyGround, 15): at the hero's feet, 8 (CHA-scaled) magical every 0.5 s to enemies inside; Paladin |
| Entangle | Secondary | Innate | Nothing | true | CHA 14 | GroundArea | own(0, 14, 120, 0, 36, 4, Roots, 0), effect Entangled (power Cha, look Vines): aimed like the Fireball (`aim_dist.clamp(24, range)`), every 0.5 s Entangled `ENTANGLE_PULSE_SECS` on enemies inside; ElvenRanger |

Hazard pulses keep today's 0.5 s rhythm and first pulse at 0.25 s. A hero hazard never touches objects except as fire patches do today (Consecrate and Roots leave barrels alone: the agent's call); a `Monsters` hazard keeps `hurt_objects_in`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn fire_patches_still_burn_heroes()          // existing behaviour with the new Hazard: a dragon fire patch hurts a hero standing in it (adapt the existing hazard tests; they must still pass)
#[test] fn consecrate_hurts_enemies_only()           // goblin and hero and wolf inside: goblin hurt every 0.5 s (kill credited to the paladin), hero and wolf untouched; lasts 5 s; Holy light while it lasts
#[test] fn entangle_binds_enemies_at_the_aimed_spot() // goblin 80 px away at the aim: Entangled with look Vines; it cannot move but still attacks; after the roots end it is free within 1 s
#[test] fn entangle_is_blocked_in_melee()            // an enemy within reach: nothing placed, cooldown not spent
#[test] fn strong_creatures_break_free_sooner()      // the ogre (STR 19) entangled shorter than a goblin (STR 8) by the save formula (one pulse each)
```

- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.** `tick_hazards` matches `(side, pulse)` exhaustively: `(Monsters, Hurt)` = today; `(Heroes { owner }, Hurt)` = `hurt_monster(mi, dmg, false, owner's index)` on non-ally monsters touching; `(Heroes { .. }, Bind(h))` = `apply(Creature::Monster(mi), Apply::from_hit(h) with source Some(owner))`; `(Monsters, Bind(h))` = the same on `foes_touching` (no source of today uses it; keep it for webs later).
- [ ] **Step 4: Run all server tests** — pass, fingerprints unchanged (fire patches act as before).
- [ ] **Step 5: Regenerate bindings (docker); client checks** (the client draws unknown hazard kinds not at all until Task 9; it must not crash).
- [ ] **Step 6: Commit** — `Progression 3b: Consecrate and Entangle; hazards with a side`

---

### Task 8: Debug weapons and the debug Attribute lift

**Files:**
- Modify: `server/src/protocol.rs` (`ClientMsg::DebugEquip { slot: EquipSlot, item: Option<ItemId> }`), `server/src/lobby.rs` (`Conn.debug_equipment: Equipment`, handler, `build_of`), `client/src/ui/lobby.ts` (two weapon selects)
- Test: `server/src/lobby.rs`, `server/src/protocol.rs`, `client/src/ui/lobby.test.ts` (create if missing)

**Interfaces:**
- Consumes: `Build`, `hero_sheet`, `items::check_equipment`.
- Produces:
  - `DebugEquip`: only `EquipSlot::Melee` or `EquipSlot::Ranged` (else error "Only weapons."); same guards and messages as `debug_loadout_if` ("Debug is off.", "Join a dungeon first.", "Not during a run.", "Not while ready.", "Choose a character first."); sets the slot on `debug_equipment` (starting as `Equipment::starter(class)`) and `debug_loadout = true`.
  - `build_of` for a debug build: `equipment = debug_equipment`, `own` = every ability of the class (as now), and **`extra` = the Attribute points that lift each Attribute to the highest Attribute requirement of the two picks and the equipped weapons** (`pub fn debug_lift(class, &Build) -> Attributes`, in `lobby.rs`). Proficiency is not lifted: a weapon the class is not trained in stays refused ("You are not trained in…").
  - Client: in the `?debug` row, a melee and a ranged `<select>` listing the hero weapon items for the class's proficiencies (`ITEMS` export if present; otherwise add `ITEMS` with `name`, `slot`, `kind` to `export.rs`), plus "(starter)" and, for ranged, "(none)"; on change send `DebugEquip`. The lobby keeps the pick per run like `debugPick`; a rejected pick is reset when the server answers with an error (fixes a 3a leftover for both rows).

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn debug_equip_sets_a_weapon()                       // Barbarian: DebugEquip Ranged ThrowingAxes, DebugLoadout Hurl → Ready succeeds; the run's sheet primary is Hurl with a ThrownAxe projectile
#[test] fn debug_equip_is_refused_during_a_run_and_while_ready() // the five guard messages; Armor slot → "Only weapons." (Review Focus 5)
#[test] fn debug_lift_only_for_debug_builds()                 // a debug Barbarian picking Ground Slam + War Hammer gets STR 17; a normal Barbarian's build has extra == Attributes::default() (Review Focus 5)
#[test] fn the_lift_meets_both_picks()                        // Wizard Chain Spark (INT 18) + Haste (INT 15, WIL 14): INT 18, WIL 14, others unchanged
```

`protocol.rs`: a JSON round trip of `{"t":"DebugEquip","slot":"Ranged","item":"ThrowingAxes"}`.

- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all server tests**; **Step 5:** regenerate bindings (docker), client checks; **Step 6: Commit** — `Progression 3b: debug weapons and Attribute lift`

---

### Task 9: Client — prediction by shape, Volley ids, new projectiles, hazards, rings, Zap

**Files:**
- Modify: `client/src/game/GameScene.ts` (`predictAbility`, `fixedStep`, `spawnCosmetic`, `drawHazard`, `Boom`/`Zap` events, own figure anim), `client/src/game/world.ts` (pure helpers), `client/src/game/anim/defs.ts` (projectiles, `isHazardKind`), `client/src/game/effects.ts` (tinted ring/line helpers if needed)
- Test: `client/src/game/world.test.ts`

**Interfaces:**
- Consumes: `ABILITIES[id].shape` (Task 3), `ResolvedAbility.projectile`, kinds from Tasks 4 and 7, `Ev Zap` (Task 4), Boom codes 10–13 (Task 6).
- Produces (in `world.ts`, unit-tested):
  - `export function volleyShotIds(next: number, n: number): number[]` — `n` consecutive ids starting at `next`, wrapping at 0x10000, **never containing 0** (skip past 0 by starting at 1 if the run would include it). `fixedStep` reserves them and sends the first.
  - `export function volleyAngles(aim: number, n: number, spread: number): number[]` — `aim − spread/2 … aim + spread/2` evenly (n = 1 → `[aim]`). The constants come from `CONST` (export `VOLLEY_ARROWS`, `VOLLEY_SPREAD`, and `HERO_REACH` in `export.rs`'s consts; the last closes a 3a leftover).
  - `export function cosmeticCount(id: AbilityId): number` — `VOLLEY_ARROWS` for Volley, 1 otherwise.

Behaviour:
- `predictAbility` switches on `ABILITIES[a.id].shape` (exhaustive over the `Shape` union): Projectile → cosmetic(s) of `a.projectile` with `a.radius`, life `range / speed`, Volley three at `volleyAngles`; Blast → today's Fireball cosmetic; Swing → `ANIM.Melee`; Dash → `ANIM.Dash`; Ring, SelfArea, GroundArea, Buff, Summon → `ANIM.Cast`. Charge's dash detection uses `shape === 'Dash'`.
- Whirl: a Melee anim with `a.arc >= 2π − 0.01` plays the swoosh around the full circle (`anim/defs.ts`; read the arc from the own hero's ability instead of the fixed 1.75 / 2.45 — a 3a leftover).
- Projectiles (`PROJECTILES`): ChainSpark as Missile; Judgement glow `0xffd860`, trail `0xfff0a0`; ThrownAxe frame `weapon_throwing_axe`, scale 0.8, spinning (rotate by elapsed time instead of orienting along the aim).
- Hazards: `isHazardKind(k)` = FirePatch, HolyGround, Roots; `drawHazard` tints by kind (FirePatch as now; HolyGround gold `0xffd040` with few rising sparks; Roots green `0x40a040` with leaf-green particles) and scales the glow to the hazard's radius (`EntState.aim` of a hazard, Task 7; FirePatch 10 px, HolyGround 40, Roots 36).
- Events: `Boom k 10` frost ring (`fx.nova` tinted `0x78c8ff`), `k 11` war cry (`fx.ring` red-orange, a short camera shake for the own hero), `k 12` haste ring (`fx.ring` yellow), `k 13` purify ring (`fx.healRing` tinted white-gold); `Zap` draws a short-lived jagged violet line between the two points.

- [ ] **Step 1: Write the failing tests** (`world.test.ts`)

```ts
it('volleyShotIds never contains 0 and wraps', () => {
  expect(volleyShotIds(5, 3)).toEqual([5, 6, 7]);
  expect(volleyShotIds(0xfffe, 3)).toEqual([1, 2, 3]);
  expect(volleyShotIds(0xffff, 1)).toEqual([0xffff]);
  expect(volleyShotIds(0, 1)).toEqual([1]);
});
it('volleyAngles spreads evenly around the aim', () => {
  const a = volleyAngles(1, 3, Math.PI / 6);
  expect(a[0]).toBeCloseTo(1 - Math.PI / 12); expect(a[1]).toBeCloseTo(1); expect(a[2]).toBeCloseTo(1 + Math.PI / 12);
  expect(volleyAngles(1, 1, Math.PI / 6)).toEqual([1]);
});
it('only Volley fires more than one cosmetic', () => { expect(cosmeticCount('Volley')).toBe(3); expect(cosmeticCount('Shoot')).toBe(1); });
```

(Note for the server side of Review Focus 3: Task 4's `volley_shot` simply adds; because the client never sends a first id whose run includes 0, the server never sees one.)

- [ ] **Step 2: Run them to verify they fail** — `cd client && bash -lic 'npx vitest run src/game/world.test.ts'`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Client checks** — pass. **Step 5:** e2e smoke (below, "Verify") for `Wizard,Barbarian` with the starters: no browser errors, correction 0.00 px.
- [ ] **Step 6: Commit** — `Progression 3b (client): prediction by shape, Volley, new projectiles, hazards, rings`

---

### Task 10: Client — new effect visuals and looks

**Files:**
- Modify: `client/src/game/status.ts` (`StatusView`), `client/src/game/anim/EntityView.ts` (speed of the walk cycle for Chilled), `client/src/game/GameScene.ts` (pass looks), `client/src/game/GalleryScene.ts` (the effect gallery shows the new ones)
- Test: `client/src/game/status.test.ts`

**Interfaces:**
- Consumes: `Snapshot.looks` (Task 2), `EFFECT`, `EFFECT_LOOK`, `EFFECTS[id].flees`.
- Produces: `export function lookOf(looks: [number, number, number][], id: number, effect: number): number` (`EFFECT_LOOK.Plain` when absent), unit-tested; `StatusView.update` takes the entity's looks.

Visuals (reuse existing helpers; proper art is TODO priority 13):
- **Chilled**: a faint pale-blue tint and occasional single snowflakes (lighter than Frozen); the walk cycle at ×0.7 pace in `EntityView`.
- **Singed**: a few small embers (lighter than Burning's flames). **Tainted**: a faint green pulse (lighter than Poisoned's).
- **Entangled**: `Plain` look = grey bands around the feet; `Vines` look = green vines around the feet. Drawn by look, so a later web is one more look.
- **Fear**: a small "!" above the head (the `SOUND_TEXT` style of the wolf's growl; if the pixel font has no "!", two stacked rectangles). **Warded**: a thin gold outline pulse. **Coated**: a green glint on the weapon hand (`handX/handY` of the figure).

- [ ] **Step 1: Write the failing test** — `lookOf` returns the sent look for (id, effect) and `Plain` otherwise.
- [ ] **Step 2: Run it to verify it fails.** **Step 3: Implement.** **Step 4: Client checks.**
- [ ] **Step 5: Commit** — `Progression 3b (client): effect visuals and looks`

---

### Task 11: Docs, final checks

**Files:** `docs/TECHNICAL.md` (§5 effects: tiers, `Apply`, looks, sources, saves; §11a abilities: shapes, the 16 abilities, hazards with a side, debug weapons and lift; "How to add an ability" and "How to add an effect" updated), `docs/PLAYER_GUIDE.md` (each class's new abilities and their requirements; the effects table), `docs/TODO.md` (close the 3a leftovers this plan fixed: `governing`'s `unreachable!`, `HERO_REACH` and swoosh arcs on the client, the rejected debug pick; note the effect mask at 15 of 16), `HANDOFF.md` ("Next session": 3b done, verification numbers, what to check in the browser, next plan 4).

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2: Verify** (record the numbers in HANDOFF):
  - `cd server && cargo test -- --skip export_bindings` — all pass, fingerprints unchanged or re-recorded with a dated reason;
  - docker suite `docker compose -f docker-compose.test.yml run --rm test` — all pass, `git status client/src/generated` clean afterwards;
  - client checks — pass;
  - smoke after rebuilding the containers: `cd tools/e2e && BROWSER=/usr/bin/brave-browser node smoke.mjs http://localhost:8080/ "" shots ElvenRanger,Paladin` and `Wizard,Barbarian` — no browser errors, correction 0.00 px.
- [ ] **Step 3: Commit** — `Progression 3b: docs`

**Browser checks for the user** (list in HANDOFF; with `?debug` and the debug row): each of the 16 abilities once; Volley's three arrows never flicker or double; Chain Spark's lines; Hurl with the Throwing Axes; Ground Slam with the War Hammer; an entangled archer still shoots; a frightened orc runs and comes back; the Ember Staff now singes.
