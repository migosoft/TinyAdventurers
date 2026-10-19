# One resistance system, no party-size HP (TODO 4b)

Date: 2026-10-19. Branch: `feature/skill-tree-design`. Comes before progression plan 2.

## Why

The user (2026-10-19): "Remove straight forward immunities and do everything with resistances. I think it is easier to have less sources of something and put everything into one coherent system."

Today a creature can shrug off an effect in two unrelated ways: a damage-type resistance of 100 % or more (blocks the effect tied to that type), and a per-effect `EffectResponse` (`Immune` / `Reduced` / `Full`). Plans 2 to 4 of the progression spec would add items, Purify and keystones as more immunities. This change leaves one system before they are built, so they are built on it.

The second change, also the user's decision: enemy and boss HP no longer grow with the number of heroes.

The user also asked that adding a new damage type (example: "holy") must be impossible without its resistance existing, even if nothing uses it yet, and that nothing is named "elemental", because future damage types need not be elements.

## Goals

1. Every effect is resisted by a percentage. No `Immune` / `Reduced` lists remain anywhere (code, specs, TECHNICAL, PLAYER_GUIDE, client demo texts).
2. Behaviour is exactly the same at today's numbers (immune = 100 %, reduced = 50 %). The fingerprint tests prove it (part A is done and verified before part B).
3. Adding a `DamageType` or `EffectKind` variant without everything that depends on it fails the build or a test, never silently at runtime.
4. "Element" naming is replaced by generic "damage-type effect" naming.
5. No HP scaling by party size (part B); the fingerprints are re-recorded once, deliberately.

## Non-goals

- No new damage type (the user's "holy" example and the Paladin's healing circle doing holy damage are a later feature, not 4b).
- No balancing. No new UI. No change to how much damage a resistance blocks.
- **Not touched:** the boss invulnerability phase (`BossBehaviour::can_be_damaged`, `Ev::Immune`, the "Immune" pop-up when a boss refuses a hit, `BossBar.immune`) is a fight mechanic, not a resistance. The "immune" damage number (`Dmg.imm`, a hit reduced to 0 by resistances) also stays: it is the result of the resistance system. (Agent's call, played back to the user without objection.)

## Part A: one resistance system

### The rule

There are two kinds of effects, decided by the effect's def:

- **Damage-type effects:** an effect whose def has a damage type (today `dot: Some((type, dps))`: Burning = Heat, Frozen = Cold, Poisoned = Poison). It is resisted **only by that type's damage resistance**, exactly as today: at 100 % or more the effect is not applied at all; a partial resistance lowers the damage of each tick (through `resolve`) and does **not** shorten the duration. The user confirmed this is intended ("the heat damage from burning should be countered by heat resistance. If resistance is 100%, the burning effect does not apply at all").
- **Every other effect** (Blind, Sleep, Petrified, Slowed, Accelerated, and any new one): resisted by its **effect resistance** `r` (a fraction, 0.5 = 50 %). Its duration, after the save formula (`scaled_secs`) where that applies, is multiplied by `(1 - r)`. At `r >= 1` the effect is refused. This replaces the response step in `run/effects.rs` `apply_effect` at the same place, so the order (cancel first, then resistance, then the water check, then the type check) is unchanged. As today it applies to positive effects too (the dragon's Accelerated is reduced).
- A negative effect resistance lengthens the effect; floor it at `MIN_RESISTANCE` (-1, so at most double), like damage. Nothing uses it yet. (Agent's call.)

A damage-type effect has no effect resistance of its own: there is exactly one number per thing. Enforce it with a test: no table (race, boss, sheet, adjustment) sets an effect resistance for an effect that has a damage type.

### Data

- A new per-effect table, `EffectResistances([f64; EffectKind::COUNT])` in `defs/effects.rs`, shaped like `Resistances` (`NONE`, `of`, `get`, `set`, `plus`). One slot per effect, so a new effect always has its resistance (0 unless set).
- It sits **next to the damage resistances** wherever they are held, replacing `responses`:
  - `RaceDef.responses` → `RaceDef.effect_res`; `races::responses(&[Race])` → `races::effect_res`, which **sums** over the races like the damage resistances do (`fold … plus`), instead of "strongest response wins". At today's data the result is identical.
  - `Adjust` gets an `effect_res` field (`NONE` by default), so an entity can adjust it like `res`.
  - `Sheet.responses` → `Sheet.effect_res` (`classes::responses` → `classes::effect_res`).
  - `Monster.responses` (`run/entities.rs`) → `Monster.effect_res`; the boss table `bosses::responses` → `bosses::effect_res`; `companions::wolf_responses` → `wolf_effect_res`; the generic monster spawn in `run/mod.rs` uses `EffectResistances::NONE`.
- A separate type next to `Resistances` rather than one merged struct is the agent's call (less churn in `resolve`); the builder may merge them if it turns out simpler, as long as there is one table per creature and one formula.
- **Effects that change effect resistances:** add `Stat::ResistEffect(EffectKind)`, the twin of `Stat::Resist(DamageType)`, resolved the same way in `Effects` (a `effect_res(base)` like `res(base)`). Nothing uses it yet; Purify's ward (spec §6.6) will. (Agent's call, from TODO "held in the same place as the damage-type resistances (race, the entity's own adjustment, items, tree nodes, effects)".)

### Today's values, converted

| Holder | Today | After |
|---|---|---|
| Lich | Sleep, Blind immune; Petrified reduced | Sleep 1.0, Blind 1.0, Petrified 0.5 |
| Dragon | Sleep immune; Blind, Petrified, Slowed, Accelerated reduced | Sleep 1.0; Blind, Petrified, Slowed, Accelerated 0.5 |
| Demon | Sleep immune | Sleep 1.0 |
| Elf, Magical Beast races | Sleep immune | Sleep 1.0 |

`EFFECT_REDUCED` and `EffectResponse` / `EffectResponses` are deleted.

### Generic naming (no "element")

Rename throughout code, comments and docs (agent's names, the user agreed to "damage-type effects"):

| Today | After |
|---|---|
| `ELEMENTS` | `TYPE_EFFECTS` |
| `element_effects(split)` | `type_effects(split)` |
| `ELEMENT_SHARE` | `TYPE_EFFECT_SHARE` |
| `ELEMENT_POWER` | `TYPE_EFFECT_POWER` |
| `Run::element_hit` | `Run::type_effect_hit` |
| "element effect(s)", "elemental" in comments, TECHNICAL, PLAYER_GUIDE, specs | "damage-type effect(s)" |

`TYPE_EFFECTS` (type → effect a hit applies) and the def's `dot` type (effect → type that resists it) describe the same link twice. Add a test that every `TYPE_EFFECTS` pair matches its effect's def type, so they cannot drift. (Agent's call; merging them into one source is fine too.)

### Hardening: new variants cannot be half-added

Today `DamageType::COUNT` / `ALL` and `EffectKind::COUNT` / `ALL` are maintained by hand. `COUNT` sizes every per-type array (resistances, splits, effect slots); `ALL` is the list loops walk, since Rust cannot iterate an enum. Adding a variant but forgetting `ALL` or `COUNT` compiles and then panics at runtime (index out of range) when it is first used.

Requirement: **adding a variant to either enum without it being in `ALL` must fail to compile, and `COUNT` must be derived (`ALL.len()`), not written.** Suggested way: a small `macro_rules!` that declares the enum and generates `ALL` and `COUNT` from the one variant list; a compile-time assert that `ALL[i] as usize == i` keeps the ids contiguous (the effect id is also its bit in the `u16` snapshot mask, so assert `COUNT <= 16` for effects). The builder may choose another way that gives the same guarantee. `name()` stays an exhaustive match (already compile-checked).

Client side: the server exports the damage types (`export.rs` → `client/src/generated/defs.ts`, `DMG_TYPE`). Add a client test that every exported damage type has a colour in `client/src/game/damage.ts`, and, if the client keeps a per-effect table (`client/src/game/status.ts`, HUD glyphs), that every exported effect has an entry. Check what `export.rs` already exports for effects; add it if missing.

Result, for the record (the user asked): adding a "holy" type later is the enum line + its name + a colour; its resistance slot exists automatically at 0 % on every creature.

### Docs to change (part A)

- **Progression spec** (`2026-10-18-progression-design.md`): §3 `RaceDef.responses` → effect resistances; §5 "Hard immunities … override the formula" → effect resistance multiplies after the save; §6.6 Purify's `Warded` → a magical-effect resistance (via `Stat::ResistEffect`; "magical" = the effects saved with WIL; the exact set is plan 3's to define); §8 `PropKind::EffectImmunity` → an effect-resistance property (e.g. `PropKind::EffectResist(kind, value)`); §9 keystones Unshaken (Sleep) and Juggernaut (Slowed) → 100 % resistances; §10 `Sheet.responses` → `Sheet.effect_res`; "element" wording → damage-type effect.
- **Effects spec** (`2026-10-15-effects-design.md`): where it defines responses; element wording.
- **TECHNICAL.md:** §5 "Status effects" and damage model, §11 "How to add an effect" (now: the effect's resistance exists automatically; a damage-type effect has none of its own), §11a sheet; add "How to add a damage type" (enum line, name, client colour; the build and tests catch the rest).
- **PLAYER_GUIDE.md:** lines saying bosses are "immune to sleep", demons and the dragon "immune to burning", undead "immune" to poison → "resist … completely" wording; element wording.
- **Client demo** (`client/src/uidemo/data.ts`): Purify "immune to hostile magical effects" → "resist hostile magical effects 100 %"; Lasting Ward "immunity" → "ward"; Unshaken "Immune to Sleep (a hard immunity)" → "Sleep resistance 100 %"; Juggernaut "immune to Slowed" → "Slowed resistance 100 %"; Girdle of Warding "Immune to Blind" → "Blind resistance 100 %".
- **TODO.md:** close "Resistances instead of immunities" and 4b; update "Effect system follow-ups" (the line about the elf's sleep immunity via `EffectResponses`, and the Petrified/Burning line's wording).

### Tests (part A)

- Convert every test that uses `EffectResponse(s)` to effect resistances with the same expectation: `responses_default_to_full`, `boss_responses_follow_the_table`, `responses_still_override_the_formula`, the Burning test at `run/effects.rs` ~674 (it sets a Burning response on a hero: Burning is a damage-type effect, so that test now sets heat resistance 1.0 instead), the race tests in `defs/races.rs`, the wolf test in `run/companion.rs`.
- New: 50 % halves the duration after the save; 100 % refuses; a value set for a damage-type effect is rejected by the "one number" test; `TYPE_EFFECTS` matches the defs; the hardening compile asserts.
- **Both fingerprint tests pass unchanged** at the end of part A. If they change, part A changed behaviour: find out why before going on.
- Server: no warnings. Client: tests, typecheck, build.

## Part B: no HP bonus from party size

- Delete `enemies::party_hp_scale` (×0.75 + 0.25 per hero) and `bosses::hp_scale` (×0.5 + 0.5 per hero) and their uses in `sheet.rs` (enemy and boss `max_hp`). HP no longer depends on the party; drop the now-unused `party` parameter where nothing else needs it.
- For a party of 4 this is deliberate: bosses have 2.5× less HP than today, normal enemies 1.75× less. A party of one is unchanged (both factors are 1.0 at one hero).
- Re-record both fingerprints once, with a dated comment next to them saying why (party-size HP removed, TODO 4b). Fix or remove tests that assert scaled HP.
- Docs: TECHNICAL, PLAYER_GUIDE (if it mentions bosses getting tougher with more heroes), TODO 18 already says any later scaling comes from the number of enemies or their Attributes, never HP.

## Order and finishing

1. Part A (data and rule, renames, hardening, client tests, docs), verified with unchanged fingerprints.
2. Part B, fingerprints re-recorded.
3. Update HANDOFF "Next session" (4b done, plan 2 next) and TODO; commit on `feature/skill-tree-design`.

## Left to the builder

Exact type and field names beyond those above, whether `EffectResistances` merges into `Resistances`, how the variant macro looks, and the commit split.
