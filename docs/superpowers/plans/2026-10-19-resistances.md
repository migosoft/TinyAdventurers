# One Resistance System, No Party-Size HP (TODO 4b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-effect immunities (`EffectResponse`) with one percentage effect resistance per effect, rename "element" to "damage-type effect", make half-added enum variants impossible, and remove party-size HP scaling.

**Architecture:** A new `EffectResistances([f64; EffectKind::COUNT])` sits next to `Resistances` in `races::Profile` and `races::Adjust`, so every creature gets it from the same `races::profile` fold that gives its damage resistances; bosses move their table into their `Adjust`. `apply_effect` multiplies the duration by `1 - r` (refuse at `r >= 1`) where the response match was. A `macro_rules!` declares `DamageType` and `EffectKind` and derives `ALL`/`COUNT`.

**Tech Stack:** Rust (server, `cargo test` in `server/`), TypeScript + vitest (client, Node 26 via `bash -lic` in `client/`).

**Spec:** `docs/superpowers/specs/2026-10-19-resistances-design.md`

## Global Constraints

- Branch `feature/skill-tree-design`. Part A must leave both fingerprint tests (`level_setup_is_unchanged`, `simulation_is_unchanged_after_waking_the_boss` in `server/src/run/mod.rs`) passing **unchanged**. If one changes, stop and find out why.
- Never write "element"/"elemental" in new code, comments or docs; say "damage-type effect(s)".
- Immune = 1.0, reduced = 0.5. Effect resistance floor: `MIN_RESISTANCE` (-1.0, from `defs/damage.rs`).
- Not touched: boss invulnerability (`BossBehaviour::can_be_damaged`, `Ev::Immune`, `BossBar.immune`) and the "immune" damage number (`Dmg.imm`).
- Server: no warnings (`cargo build --tests 2>&1 | grep -c warning` → 0). Client: `npm test`, `npm run typecheck`, `npm run build`.
- Terminology: "Attributes"; "ability" means only LMB/RMB abilities.

## Review Focus

1. A negative effect resistance must lengthen, floored at -1 (at most double) — test `negative_effect_resistance_lengthens_at_most_double` in Task 2.
2. A positive effect (Accelerated on the dragon) is still halved by its 0.5 resistance, without the save — test `dragon_haste_is_halved` in Task 2.
3. A creature with effect resistances from both its race and its `Adjust` sums them (Elf + an adjust) — test `effect_res_sums_races_and_adjust` in Task 2.
4. A damage-type effect (Burning) on a fully heat-resistant creature is still refused, and a resisted effect still cancels its opposite — existing `a_resisted_effect_still_cancels_its_opposite`, converted in Task 2.
5. Part B on a party of one changes nothing; on four, HP is the solo value — test `enemy_hp_ignores_party_size` in Task 5.

---

### Task 1: Variant hardening macro (`DamageType`, `EffectKind`)

**Files:**
- Modify: `server/src/defs/damage.rs:9-29`, `server/src/defs/effects.rs:8-32`
- Possibly create: `server/src/defs/kinds.rs` already exists; put the macro in a new `server/src/defs/enum_list.rs` and `#[macro_use]`/`pub(crate) use` it from `defs/mod.rs`.

**Interfaces:**
- Produces: `DamageType::ALL`, `DamageType::COUNT`, `EffectKind::ALL`, `EffectKind::COUNT` — same names and types as today (`[T; COUNT]`, `usize`), now generated.

- [ ] **Step 1:** Write a `macro_rules! listed_enum` that takes attributes, a name, a repr and `Variant = n,` lines, and emits the enum plus `impl { pub const ALL: [Self; N] = [...]; pub const COUNT: usize = Self::ALL.len(); }` and a `const _: () = { let mut i = 0; while i < COUNT { assert!(ALL[i] as usize == i); i += 1; } };` block. `ALL` is built from the same variant list, so a variant cannot be missing from it.
- [ ] **Step 2:** Declare `DamageType` and `EffectKind` with it (same derives, `#[repr(u8)]`, same discriminants). Add `const _: () = assert!(EffectKind::COUNT <= 16);` with a comment (snapshot `u16` mask). `name()`, `bit()`, `from_u8()` stay hand-written.
- [ ] **Step 3:** Run `cd server && cargo test` — all pass, fingerprints unchanged, no warnings.
- [ ] **Step 4:** Commit `TODO 4b: DamageType and EffectKind declare ALL/COUNT from one variant list`.

### Task 2: Effect resistances replace effect responses

**Files:**
- Modify: `server/src/defs/effects.rs` (delete `EFFECT_REDUCED`, `EffectResponse`, `EffectResponses`; add `EffectResistances`, `Stat::ResistEffect`), `server/src/defs/races.rs` (`RaceDef.responses`→`effect_res`, delete `races::responses`, `Adjust.effect_res`, `Profile.effect_res`), `server/src/defs/bosses.rs` (delete `responses`; values into each boss's `Adjust`), `server/src/defs/classes.rs` (delete `classes::responses`), `server/src/defs/companions.rs` (delete `wolf_responses`), `server/src/sheet.rs` (`Sheet.responses`→`effect_res: prof.effect_res`), `server/src/run/entities.rs:242` (`Monster.responses`→`effect_res`), `server/src/run/levels/boss.rs:78`, `server/src/run/mod.rs:297`, `server/src/run/companion.rs:76` (all `effect_res: prof.effect_res`), `server/src/run/effects.rs` (`Effects::effect_res`, the rule in `apply_effect`, tests).

**Interfaces:**
- Produces in `defs/effects.rs`:
  - `pub struct EffectResistances([f64; EffectKind::COUNT])`, `#[derive(Debug, Clone, Copy, PartialEq)]`, with `pub const NONE`, `pub fn of(&[(EffectKind, f64)]) -> Self` (summing, like `Resistances::of`), `get(&self, EffectKind) -> f64`, `set(&mut self, EffectKind, f64)`, `plus(self, Self) -> Self`.
  - `Stat::ResistEffect(EffectKind)`; `resolve_stat` caps it like `Resist` (an effect never lifts it above `max(base, 1)`).
  - `pub fn effect_secs(secs: f64, r: f64) -> Option<f64>`: `None` when `r >= 1.0`, else `Some(secs * (1.0 - r.max(MIN_RESISTANCE)))`.
- Produces in `run/effects.rs`: `Effects::effect_res(&self, base: EffectResistances) -> EffectResistances` (like `Effects::res`).
- Produces in `defs/races.rs`: `Adjust.effect_res: EffectResistances` (`NONE` in `Adjust::NONE`), `Profile.effect_res`, folded in `profile` as `races.fold(NONE, plus race_def.effect_res).plus(adj.effect_res)`.

- [ ] **Step 1: Write the failing tests** (in `defs/effects.rs` tests unless noted)
  - `effect_resistances_default_to_zero` (replaces `responses_default_to_full`): `of(&[(Sleep, 1.0)]).get(Sleep) == 1.0`, `.get(Blind) == 0.0`, `NONE.get(Petrified) == 0.0`.
  - `effect_secs_scales_and_refuses`: `effect_secs(4.0, 0.5) == Some(2.0)`, `effect_secs(4.0, 1.0) == None`, `effect_secs(4.0, 0.0) == Some(4.0)`.
  - `negative_effect_resistance_lengthens_at_most_double`: `effect_secs(4.0, -0.5) == Some(6.0)`, `effect_secs(4.0, -3.0) == Some(8.0)`.
  - `damage_type_effects_have_no_effect_resistance` (the "one number" test): for every `Race` in a list of all races, every `BossId`, `companions::wolf_profile()`, every `ClassId`'s sheet `effect_res`, every `EnemyType` profile: for each `k` with `def(k).dot.is_some()`, `effect_res.get(k) == 0.0`.
  - `boss_effect_resistances_follow_the_table` (replaces `boss_responses_follow_the_table`, wherever that lives): Lich Sleep 1.0, Blind 1.0, Petrified 0.5, others 0; Dragon Sleep 1.0; Blind, Petrified, Slowed, Accelerated 0.5; Demon Sleep 1.0 only — read from `bosses::profile(id).effect_res`.
  - In `defs/races.rs`: convert `the_ranger_is_an_elf_and_elves_and_magical_beasts_sleep_never` to `classes::profile(ElvenRanger).effect_res.get(Sleep) == 1.0`, `classes::profile(Wizard).effect_res == EffectResistances::NONE`, `profile(&[Human, MagicalBeast], Adjust::NONE).effect_res.get(Sleep) == 1.0`; new `effect_res_sums_races_and_adjust`: `profile(&[Race::Elf], Adjust { effect_res: EffectResistances::of(&[(Blind, 0.25)]), ..Adjust::NONE })` has Sleep 1.0 and Blind 0.25.
  - In `run/effects.rs`: `responses_still_override_the_formula` → `effect_resistance_applies_after_the_save` (Ogre, `effect_res = of(&[(Sleep, 1.0)])` refuses at power 40; with 0.5 and power 10 vs the ogre's WIL, `left_of` equals `scaled_secs(4.0, 10, wil) * 0.5`); `dragon_haste_is_halved` (dragon boss run, `apply_effect_from(boss, Accelerated, None, 0, true)` → `left_of == def(Accelerated).duration * 0.5`); in `a_resisted_effect_still_cancels_its_opposite` replace the "immune to Burning" case (Burning is a damage-type effect) by deleting it — the "immune to heat" case already covers it; `run/companion.rs:620` → `m.effect_res.get(Sleep) == 1.0`.
- [ ] **Step 2:** `cd server && cargo test` — fails to compile (types missing). Expected.
- [ ] **Step 3: Implement.** In `apply_effect`, replace the `response` block by reading `p.effects.effect_res(p.sheet.effect_res).get(kind)` / `m.effects.effect_res(m.effect_res).get(kind)` (a missing creature returns false) and `let Some(secs) = effect_secs(secs.unwrap_or(def(kind).duration), r) else { return false };`. Only for effects whose def has no `dot` — a damage-type effect skips this step (its `dot` check below stays). Update the `apply_effect` / `apply_effect_from` doc comments ("response" → "effect resistance"). Boss `Adjust`s: Lich `of(&[(Sleep,1.0),(Blind,1.0),(Petrified,0.5)])`, Dragon `of(&[(Sleep,1.0),(Blind,0.5),(Petrified,0.5),(Slowed,0.5),(Accelerated,0.5)])`, Demon `of(&[(Sleep,1.0)])`. Races: Elf and MagicalBeast `effect_res: of(&[(Sleep, 1.0)])`. Generic enemies now take `prof.effect_res` (all their races have none; `NONE` in effect).
- [ ] **Step 4:** `cargo test` — all pass, **both fingerprints unchanged**, no warnings. `grep -rn "EffectResponse\|EFFECT_REDUCED\|\.responses\|fn responses" server/src` → nothing.
- [ ] **Step 5:** Commit `TODO 4b: one effect resistance per effect instead of immune/reduced responses`.

### Task 3: "Damage-type effect" naming and the TYPE_EFFECTS link test

**Files:** `server/src/defs/effects.rs`, `server/src/run/effects.rs`, `server/src/defs/damage.rs:112`, `server/src/defs/enemies.rs` (`governing` comment), every caller (`grep -rn "element_hit\|ELEMENT\|element_effects\|lement" server/src`).

**Interfaces:** Produces `TYPE_EFFECTS`, `type_effects(split)`, `TYPE_EFFECT_SHARE`, `TYPE_EFFECT_POWER`, `Run::type_effect_hit` (same signatures as the old names).

- [ ] **Step 1:** Test `type_effects_match_their_defs`: for each `(t, k)` in `TYPE_EFFECTS`, `def(k).dot.map(|d| d.0) == Some(t)`; and every `k` with a `dot` appears in `TYPE_EFFECTS`. Rename the existing `element_effects` test accordingly.
- [ ] **Step 2:** Rename per the spec table; replace "element"/"elemental" in every server comment and test name with "damage-type effect"/"damage type". `grep -rni "element" server/src` → only unrelated hits (e.g. HTML/DOM), none about damage.
- [ ] **Step 3:** `cargo test` passes, fingerprints unchanged, no warnings. Commit `TODO 4b: damage-type effect naming, TYPE_EFFECTS checked against the defs`.

### Task 4: Client tables cover every exported type

**Files:** `client/src/game/damage.ts` (export the colour map as `DMG_COLORS`), `client/src/game/damage.test.ts`; check `server/src/export.rs` already exports `EFFECT`/`EFFECTS` (it does, lines 147-148) and `client/src/ui/effectGlyph.test.ts` already checks every effect has a glyph.

- [ ] **Step 1:** Test `has a colour for every damage type but physical`: for each value of `DMG_TYPE` except `Physical`, `DMG_COLORS[v]` is a non-empty string. If `client/src/game/status.ts` keeps a per-effect table, add the same check for every `EFFECT` value; if it only branches per effect (as today), note it in TECHNICAL's "How to add an effect" instead.
- [ ] **Step 2:** `cd client && bash -lic 'npm test && npm run typecheck && npm run build'` — pass. Commit `TODO 4b: client test that every damage type has a colour`.

### Task 5: Docs for part A, then part B

**Files (part A docs):** `docs/superpowers/specs/2026-10-18-progression-design.md` (§3, §5, §6.6, §8, §9, §10, wording), `docs/superpowers/specs/2026-10-15-effects-design.md`, `docs/TECHNICAL.md` (or wherever TECHNICAL lives: §5, §11 "How to add an effect", §11a, new "How to add a damage type"), `PLAYER_GUIDE.md`, `client/src/uidemo/data.ts` (the five texts from the spec), `TODO.md`.
**Files (part B):** `server/src/defs/enemies.rs:269-272`, `server/src/defs/bosses.rs:40-43`, `server/src/sheet.rs` (`enemy_stats`, `boss_stats`, test at ~261), callers `run/mod.rs:264`, `run/levels/boss.rs:45`, `run/mod.rs:1245-1248`.

- [ ] **Step 1:** Edit the part A docs exactly as the spec's "Docs to change (part A)" list says. `grep -rni "immun\|element" docs PLAYER_GUIDE.md client/src/uidemo` → only the boss invulnerability phase, `Dmg.imm`, and dated history (HANDOFF entries, old plans) remain. Commit `TODO 4b part A: docs`.
- [ ] **Step 2 (part B test first):** Replace the sheet test asserting `d.hp * (0.75 + 0.25 * party)` with `enemy_hp_ignores_party_size`: `enemy_stats(t).max_hp == d.hp` for every enemy type, and `boss_stats(b).max_hp == bosses::def(b).hp` for every boss. Run: fails to compile (old signatures).
- [ ] **Step 3:** Delete `party_hp_scale` and `hp_scale`; `enemy_stats(t: EnemyType) -> MonsterStats`, `boss_stats(b: BossId) -> MonsterStats`; drop `party` parameters up the call chain where nothing else uses them (`cargo build` warnings guide this).
- [ ] **Step 4:** `cargo test`. The fingerprint runs use one hero, so they are expected to stay unchanged; if they change, re-record them once with a dated comment ("2026-10-19: party-size HP removed, TODO 4b") and say so in the commit. All other tests pass, no warnings.
- [ ] **Step 5:** Docs: TECHNICAL (party HP scaling), PLAYER_GUIDE (bosses tougher with more heroes, if mentioned). Commit `TODO 4b part B: enemy and boss HP no longer scale with party size`.

### Task 6: Finish

- [ ] **Step 1:** Full verification: `cd server && cargo test` (count), no warnings; client `npm test`, `npm run typecheck`, `npm run build`.
- [ ] **Step 2:** HANDOFF "Next session": 4b done with the numbers; next is progression plan 2. TODO.md: close "Resistances instead of immunities" and 4b; update "Effect system follow-ups". Commit and `git push`.
