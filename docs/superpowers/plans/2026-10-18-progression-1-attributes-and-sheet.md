# Progression plan 1: Attributes, races, weights and the character sheet

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Heroes, enemies and bosses get Attributes, races and weights. One character sheet, built at run start, becomes the only source of hero numbers in the simulation. At the start Attributes it reproduces today's game exactly; pushes and effect durations switch to their new formulas.

**Architecture:** New pure data modules `defs/attributes.rs` and `defs/races.rs` (renamed from `entity_types.rs`). A new `server/src/sheet.rs` resolves a hero's numbers (HP, speed, weight, both abilities, the Elven Ranger's rapier fallback) from class data, Attributes and, for now, the old `StatUpgrades` (removed in plan 4). The run stores the sheet on `Player`; the client predicts from the resolved numbers sent in `RunStartInfo`. Enemy, boss and Dire Wolf stat blocks carry Attributes and weight; their attacks keep today's numbers (weapons come in plan 3).

**Re-checked 2026-10-19** against `main` after the Elven Ranger merge (`c5b3860`) and the spec's "Changes for the Elven Ranger": the Assassin is the Elven Ranger (race Elf, DEX +2), Hide and `HIDDEN_CRIT_MULT` are gone, entity types carry `responses`, `Player.responses` exists, and the Dire Wolf is an ally `Monster` (`run/companion.rs`, numbers in `defs/companions.rs`) that gets a stat block here.

**Tech Stack:** Rust (axum server, ts-rs exports, `cargo test`), TypeScript client (Vite, vitest).

**Spec:** [docs/superpowers/specs/2026-10-18-progression-design.md](../specs/2026-10-18-progression-design.md), sections 1, 3, 4, 5, 7, 10 and step 1–2 of §14. Later plans: 2 = weapons and items (§6.1–6.2, §8), 3 = abilities and the melee rule (§6.3–6.6), 4 = trees, shop, `Progress` v2 (§2, §9, §11, §12), 5 = the new UI (§13).

## Global Constraints

- Attributes: STR, DEX, CON, INT, WIL, CHA (`Attr::{Str, Dex, Con, Int, Wil, Cha}`). Code, comments and UI never say "ability score".
- `factor(v, pct) = max(0.1, 1 + pct × (v − 10))`; `hp(base, con) = base + 5 × (con − 10)`.
- Per point: STR damage 5 %, ranged range and projectile speed 2 %; DEX finesse/ranged damage 5 %, arc 3 %, attack/firing speed 2 %; CON HP 5 and move speed 1 %; INT spell damage 5 %; CHA innate damage and heals 5 %; WIL magical save.
- Class start Attributes and weights exactly as in spec §1 (Wizard 8/14/12/15/13/10, 9; Paladin 15/8/13/10/12/14, 12; Barbarian 15/13/14/8/12/10, 13; Elven Ranger **class** 10/13/12/8/14/13 + Elf race DEX +2 = 10/15/12/8/14/13, 10). Base HP 60 / 105 / 120 / 80. Only the Elf has a race Attribute bonus.
- Enemy Attributes and weights exactly as in spec §7; bosses weight 40; barrel weight 6, blast STR 18; chests weight 40; the Dire Wolf 17/15/15/3/12/7, weight 10, race Magical Beast (+20 % cold as its `Adjust`), its `WOLF_*` HP, speed, bite and dash unchanged and never party-scaled.
- **Calibration is bit-exact:** a scaled number is stored as its value **at a reference Attribute value** (`Scaled { value, attr, pct, at }`) and resolved as `value × factor(cur, pct) / factor(at, pct)`. At the start Attributes the ratio is exactly 1.0, so today's numbers come out unchanged to the bit (the spec's "base = today / start factor" is the same rule written so that floats do not drift).
- Push: no push unless pusher STR > target weight; distance `base × min(1, (STR − weight) / 4)`.
- Effect duration: `base × max(0, 1 + (power − save) / 20)`; save WIL for magical, CON for non-magical; positive effects never scaled; `EffectResponse` still applies after.
- No new art; no UI changes beyond what prediction needs.

## Review Focus

1. **A hero at its start Attributes plays exactly like today:** every speed, cooldown, damage, arc, range, HP; pinned by `hero_sheet_reproduces_today` (Task 4) and the unchanged `level_setup_is_unchanged` fingerprint (Task 9).
2. **Client prediction disagrees with the server** (rubber-banding, cooldown flicker) when an upgrade or Attribute changes a number: pinned by `predictor_uses_resolved_numbers` (Task 6) with non-default numbers.
3. **Very low Attributes** (an enemy STR 5, CON 5) must not give zero or negative damage, HP or speed: pinned by `factor_floors_at_a_tenth` (Task 1) and `low_con_enemy_still_moves` (Task 4).
4. **Bosses must never be pushed** by any source, including a barrel next to them: pinned by `bosses_and_chests_never_move` (Task 7).
5. **An immune creature stays immune** even when the duration formula would give time (a lich at WIL 18 vs a weak caster; the Elven Ranger and her wolf against Sleep): pinned by `responses_still_override_the_formula` and `elves_and_the_wolf_stay_immune_to_sleep` (Task 8).
6. **The wolf keeps behaving like today** (HP, bite, dash, the 60 s wait after its death, which today divides by `mods.attack_speed`): pinned by the existing `run/companion.rs` tests, which must pass unchanged apart from the one that sets `mods.attack_speed` (Task 5).

---

### Task 1: Attributes

**Files:**
- Create: `server/src/defs/attributes.rs`
- Modify: `server/src/defs/mod.rs` (add `pub mod attributes;`)

**Interfaces:**
- Produces:
  - `#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)] pub enum Attr { Str, Dex, Con, Int, Wil, Cha }` with `Attr::COUNT = 6`, `Attr::ALL`.
  - `#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)] pub struct Attributes([i32; 6])` with `const fn new(str, dex, con, int, wil, cha) -> Self`, `get(Attr) -> i32`, `add(Attr, i32)`, `plus(Attributes) -> Attributes`.
  - `pub const BASELINE: i32 = 10;`
  - `pub fn factor(v: i32, pct: f64) -> f64` (floor 0.1), `pub fn hp(base: f64, con: i32) -> f64`.
  - `#[derive(Debug, Clone, Copy, PartialEq)] pub struct Scaled { pub value: f64, pub attr: Attr, pub pct: f64, pub at: i32 }` with `pub fn get(&self, a: &Attributes) -> f64` (= `value × factor(a.get(attr), pct) / factor(at, pct)`) and `pub fn per(&self, a: &Attributes) -> f64` for times (cooldowns: `value / (factor(cur)/factor(at))`).
  - Per-point constants: `STR_DMG = 0.05`, `STR_RANGE = 0.02`, `DEX_DMG = 0.05`, `DEX_ARC = 0.03`, `DEX_SPEED = 0.02`, `CON_HP = 5.0`, `CON_MOVE = 0.01`, `INT_DMG = 0.05`, `CHA_DMG = 0.05`.
  - `pub const ATTR_WEIGHT: [f64; 6] = [1.0, 1.25, 1.0, 1.0, 0.8, 1.0];` and `pub fn attr_price(a: Attr, current: i32) -> u32` (`round((100 + 25 × max(0, current − 10)) × weight)`; used in plan 4, tested now).

- [ ] **Step 1: Write the failing tests** in `attributes.rs`'s test module:
  - `factor_is_linear_around_ten`: `factor(10, 0.05) == 1.0`, `factor(15, 0.05) == 1.25`, `factor(8, 0.03) == 0.94`.
  - `factor_floors_at_a_tenth`: `factor(-20, 0.05) == 0.1`, `factor(0, 0.1) == 0.1`.
  - `hp_adds_five_per_con_point`: `hp(60.0, 12) == 70.0`, `hp(120.0, 14) == 140.0`, `hp(80.0, 8) == 70.0`.
  - `scaled_is_exact_at_its_reference`: `Scaled { value: 12.0, attr: Int, pct: 0.05, at: 15 }.get(&wizard) == 12.0` bit-exact (`assert_eq!`), and at INT 17 equals `12.0 × 1.35 / 1.25`; `per` at DEX 13 vs `at: 13` returns the value unchanged, at DEX 15 returns `value / (1.10/1.06)`.
  - `attr_price_uses_the_weights`: `attr_price(Int, 15) == 225`, `attr_price(Dex, 14) == 250`, `attr_price(Wil, 13) == 140`, `attr_price(Str, 8) == 100`.

- [ ] **Step 2: Run** `cd server && cargo test --lib attributes` — expected: FAIL (module missing).
- [ ] **Step 3: Implement** the items listed under Produces.
- [ ] **Step 4: Run** `cargo test --lib attributes` — expected: 5 passed.
- [ ] **Step 5: Commit** `git add server/src/defs/attributes.rs server/src/defs/mod.rs && git commit -m "Progression: Attributes, factor, Scaled"`

### Task 2: Races (rename `EntityType`, split `Monster`)

**Files:**
- Rename: `server/src/defs/entity_types.rs` → `server/src/defs/races.rs` (`EntityType` → `Race`, `TypeDef` → `RaceDef`, `type_def` → `race_def`)
- Modify: every `use …entity_types…` (`defs/bosses.rs`, `defs/objects.rs`, `defs/enemies.rs`, `defs/classes.rs`, `defs/companions.rs`, `run/perception.rs`, `run/entities.rs`, `run/ai.rs`, `run/effects.rs`; check with `grep -rn entity_types server/src`), `defs/mod.rs`

**Interfaces:**
- Produces: `pub enum Race { Human, Goblin, Orc, Ogre, Mimic, Undead, Demon, Dragon, Elf, MagicalBeast, Object }`; `RaceDef { res, melee, vision, darkvision, attrs: Attributes, responses: EffectResponses }` (attrs 0 for every race except Elf DEX +2, spec §3; `responses` takes over today's `entity_types::responses`: Sleep `Immune` for Elf and Magical Beast); `pub fn race_attrs(&[Race]) -> Attributes` (sum); `responses(&[Race])` keeps its behaviour (strongest response wins) and reads `RaceDef.responses`; `profile(&[Race], Adjust) -> Profile` unchanged in behaviour. `Sight`, `Adjust`, `Profile` keep their names, now in `races.rs`. the private `classes::types` (today `[Elf]` for the ranger, `[Human]` otherwise) is renamed `classes::races` and made `pub`.
- Consumes: `Attributes` (Task 1).

- [ ] **Step 1: Update the tests** moved with the file: `every_type_has_a_sight…` checks Goblin, Orc, Ogre and Mimic each equal `Sight { vision: 8.0, darkvision: 1.0 / 3.0 }` with `Resistances::NONE` and a physical melee; `every_enemy_has_its_entity_type` maps GoblinArcher → Goblin, OrcWarrior/OrcArcher → Orc, Ogre → Ogre, Mimic → Mimic (via `enemies::race(t)`, Task 3 adds it; for now assert on `enemies::profile`); keep the Elf and Magical Beast tests that exist today (sight, resistances, Sleep immunity); add `only_the_elf_has_an_attribute_bonus`: `race_def(Elf).attrs == Attributes::new(0, 2, 0, 0, 0, 0)` and every other `race_def(r).attrs == Attributes::default()`.
- [ ] **Step 2: Run** `cargo test --lib races` — expected: FAIL to compile.
- [ ] **Step 3: Rename and split.** `enemies::profile` maps GoblinArcher → Goblin, OrcWarrior | OrcArcher → Orc, Ogre → Ogre, Mimic → Mimic.
- [ ] **Step 4: Run** the full suite (`docker compose -f docker-compose.test.yml run --rm test`) — expected: all pass, both fingerprint tests unchanged.
- [ ] **Step 5: Commit** "Progression: entity types become races; Monster splits into Goblin, Orc, Ogre, Mimic"

### Task 3: Stat blocks (classes, enemies, bosses, objects)

**Files:**
- Modify: `server/src/defs/classes.rs`, `server/src/defs/enemies.rs`, `server/src/defs/bosses.rs`, `server/src/defs/objects.rs`, `server/src/defs/companions.rs`

**Interfaces:**
- Produces:
  - `ClassDef` gains `attrs: Attributes` (the class's own points, **without** the race bonus: the ranger's is 10/13/12/8/14/13), `base_hp: f64`, `weight: f64`; `pub fn start_attrs(c) -> Attributes` = `attrs.plus(races::race_attrs(races(c)))`. `hp` and `speed` stay as the start values (references for calibration and the client's demo scenes; removed in plan 5).
  - `EnemyDef` gains `attrs: Attributes`, `weight: f64`; new `pub fn race(t: EnemyType) -> Race`; new `pub fn base_hp(t) -> f64 = def(t).hp − 5 × (con − 10)`.
  - `BossDef` gains `attrs: Attributes`, `weight: f64` (40.0).
  - `objects.rs`: `pub fn weight(kind: EntityKind) -> f64` (Barrel 6.0, Chest 40.0), `pub const BARREL_BLAST_STR: i32 = 18;`.
  - `companions.rs`: `pub const WOLF_ATTRS: Attributes = Attributes::new(17, 15, 15, 3, 12, 7);`, `pub const WOLF_WEIGHT: f64 = 10.0;`, `pub fn wolf_base_hp() -> f64` (= `WOLF_HP − 5 × (15 − 10)` = 55); `wolf_profile` and `wolf_responses` read the `MagicalBeast` race.
  - Raised skeleton = skeleton warrior with CON 12; raised archer = skeleton archer with CON 12; summoned imp = imp with CON 10.

- [ ] **Step 1: Write the failing tests** in `classes.rs` and `enemies.rs`:
  - `class_hp_comes_from_base_and_con`: for every `ClassId::ALL`, `attributes::hp(d.base_hp, start_attrs(c).get(Con)) == d.hp`.
  - `classes_use_the_standard_array`: each class's `start_attrs` (class + race) sorted equal `[8, 10, 12, 13, 14, 15]`; the ranger's class DEX alone is 13.
  - `wolf_stat_block_keeps_todays_hp`: `hp(wolf_base_hp(), 15) == WOLF_HP`; `WOLF_WEIGHT == 10.0`.
  - `enemy_stat_blocks_match_the_spec`: spot checks — Ogre `(19, 8, 16, 5, 7, 7)` weight 20; Imp `(6, 17, 13, 11, 12, 14)` weight 4; RaisedSkeleton CON 12; SummonedImp CON 10; Disciple weight 10.
  - `enemy_base_hp_keeps_todays_hp`: `base_hp(t) + 5 × (con − 10) == def(t).hp` for every `EnemyType::ALL`.
  - `bosses_weigh_forty`: every `BossId::ALL` weight 40.0, Lich INT 22.
- [ ] **Step 2: Run** `cargo test --lib classes enemies bosses companions` — expected: FAIL.
- [ ] **Step 3: Add the fields and data** from spec §1, §4 and §7.
- [ ] **Step 4: Run** the same — expected: PASS.
- [ ] **Step 5: Commit** "Progression: Attributes and weights for classes, enemies, bosses and objects"

### Task 4: The sheet

**Files:**
- Create: `server/src/sheet.rs` (and `mod sheet;` in `main.rs`)
- Modify: `server/src/defs/abilities.rs` (scaling table)

**Interfaces:**
- Consumes: Tasks 1–3; `StatUpgrades::modifiers()` (unchanged until plan 4).
- Produces:
  - `#[derive(Debug, Clone, Copy, PartialEq, Serialize, TS)] #[ts(export)] pub struct ResolvedAbility { pub id: AbilityId, pub cooldown: f64, pub damage: f64, pub range: f64, pub arc: f64, pub speed: f64, pub radius: f64, pub duration: f64 }` (`AbilityId` gains `TS` export).
  - `pub struct Sheet { pub attrs: Attributes, pub max_hp: f64, pub speed: f64, pub weight: f64, pub res: Resistances, pub responses: EffectResponses, pub melee: DamageSplit, pub sight: Sight, pub primary: ResolvedAbility, pub secondary: ResolvedAbility, pub fallback: Option<ResolvedAbility>, pub armor: f64 }` — `attrs` = class + race + `extra`; `res`, `melee`, `sight` from `classes::profile`, `responses` from `classes::responses`; `fallback` is the Elven Ranger's rapier thrust (id `CrossbowDagger`, `DAGGER_*` numbers), `None` for others until plan 3; `armor` is the old upgrade's blocked fraction (temporary, removed in plan 4).
  - `pub fn hero_sheet(class: ClassId, extra: Attributes, up: &StatUpgrades) -> Sheet` — `extra` = shop + tree + item points (all zero until plan 4).
  - `pub struct MonsterStats { pub attrs: Attributes, pub weight: f64, pub max_hp: f64, pub speed: f64 }`; `pub fn enemy_stats(t: EnemyType, party: usize) -> MonsterStats`, `pub fn boss_stats(b: BossId, party: usize) -> MonsterStats`, `pub fn wolf_stats() -> MonsterStats` (no party scaling).
  - In `abilities.rs`: `pub fn scaling(id: AbilityId) -> Scaling` where `pub struct Scaling { pub damage: Option<(Attr, f64)>, pub speed: Option<(Attr, f64)>, pub arc: Option<(Attr, f64)>, pub reach: Option<(Attr, f64)> }`, and `pub fn owner(id) -> ClassId` (the class whose start Attributes are the reference). Table: MagicMissile, Fireball damage (Int, INT_DMG); Sword, Axe damage (Str, STR_DMG), speed (Dex, DEX_SPEED), arc (Dex, DEX_ARC); Heal damage (Cha, CHA_DMG); Dash damage (Str, STR_DMG); CrossbowDagger damage and speed (Dex, DEX_DMG / DEX_SPEED), range and projectile speed (Str, STR_RANGE); dagger (rapier) fallback damage and speed (Dex). SummonWolf: none (its cooldown still scales with the old attack-speed upgrade, as today). This table is interim; plan 3 replaces it with weapons.

- [ ] **Step 1: Write the failing tests** in `sheet.rs`:
  - `hero_sheet_reproduces_today`: for every class with `extra = default`, `up = default`: `max_hp == def.hp`, `speed == def.speed`, and `primary`/`secondary` equal `ab::def(id)` field by field with `assert_eq!` (bit-exact); the Elven Ranger's `attrs.get(Dex) == 15` and `fallback == Some(ResolvedAbility { id: CrossbowDagger, cooldown: DAGGER_COOLDOWN, damage: DAGGER_DAMAGE, range: DAGGER_RANGE, .. zero })`.
  - `attributes_move_the_numbers`: Wizard with `extra` INT +2 → Magic Missile damage `12 × 1.35 / 1.25`; Barbarian with DEX +2 → Axe cooldown `0.8 / (1.10/1.06)` and arc `2.45 × 1.15 / 1.09`; Paladin CON +2 → `max_hp == 130.0`, speed `66 × 1.05 / 1.03`.
  - `upgrades_still_apply`: Paladin with `StatUpgrades { damage: 2, attack_speed: 1, move_speed: 1, life: 1, armor: 1, .. }` gives today's `Modifiers` effect (damage ×1.16, cooldown / 1.06, speed ×1.04, HP ×1.10, `armor == 0.04`).
  - `enemy_stats_reproduce_today`: for every `EnemyType::ALL` and party 1..=4, `max_hp == def.hp × (0.75 + 0.25 × party)` and `speed == def.speed` bit-exact; same for every boss with `hp_scale`.
  - `wolf_stats_reproduce_today`: `max_hp == WOLF_HP`, `speed == WOLF_SPEED` bit-exact, `weight == 10.0`.
  - `low_con_enemy_still_moves`: an enemy block with CON −200 resolves `speed > 0.0`.
- [ ] **Step 2: Run** `cargo test --lib sheet` — expected: FAIL.
- [ ] **Step 3: Implement** `hero_sheet`, `enemy_stats`, `boss_stats`. Speed is `Scaled { value: def.speed, attr: Con, pct: CON_MOVE, at: start CON }`; enemy speed the same with the enemy's CON as `at`; upgrades multiply after the Attribute scaling (damage, HP, move speed) and divide cooldowns.
- [ ] **Step 4: Run** `cargo test --lib sheet` — expected: PASS.
- [ ] **Step 5: Commit** "Progression: the character sheet, calibrated bit-exact to today"

### Task 5: The run reads the sheet

**Files:**
- Modify: `server/src/run/entities.rs` (`Player`: replace `def: ClassDef`, `mods: Modifiers` and `responses` with `sheet: Sheet` and `kind: EntityKind`; `Monster`: add `attrs: Attributes`, `weight: f64`), `server/src/run/companion.rs` (`spawn_wolf` sets the wolf's `attrs`/`weight` from `wolf_stats()`; `wolf_died`'s `WOLF_DEAD_COOLDOWN / p.mods.attack_speed` becomes `WOLF_DEAD_COOLDOWN × sheet.secondary.cooldown / ab::def(SummonWolf).cooldown`, the same ratio; the test that sets `mods.attack_speed = 2.0` sets `sheet.secondary.cooldown = 4.0` instead), `server/src/run/effects.rs` (`apply_effect` reads `p.sheet.responses` for players), `server/src/run/mod.rs` (`Run::new`, `spawn_enemy`, the move step at the `p.def.speed * p.mods.move_speed` line, `hurt_player`'s armor line, the primary/secondary dispatch), `server/src/run/abilities.rs` (`try_use`, `dash_contact`), `server/src/run/levels/boss.rs` (`spawn`), `server/src/run/mod.rs` `Member` (add `extra: Attributes`, default zero; `lobby.rs` and test helpers pass zero)

**Interfaces:**
- Consumes: `hero_sheet`, `enemy_stats`, `boss_stats`, `ResolvedAbility` (Task 4).
- Produces: `Player.sheet: Sheet`; `Monster.attrs`, `Monster.weight` (read by Tasks 7 and 8). `try_use(run, pi, primary: bool, shot)` takes the slot and reads `run.players[pi].sheet.primary`/`.secondary`; the dagger branch reads `sheet.fallback`.

- [ ] **Step 1: Write the failing test** in `run/mod.rs` tests: `players_carry_their_sheet`: `test_run(&[ClassId::Barbarian], Lich)`; `players[0].sheet == hero_sheet(Barbarian, default, &default)` (compare `max_hp`, `speed`, `primary`); every monster's `weight` equals its stat block's; with `test_run(&[ClassId::ElvenRanger], Lich)` and a summoned wolf, the wolf's `weight == WOLF_WEIGHT` and `attrs == WOLF_ATTRS`.
- [ ] **Step 2: Run** `cargo test --lib players_carry_their_sheet` — expected: FAIL to compile.
- [ ] **Step 3: Switch the reads.** Damage multipliers come from the resolved damage (no more `mods.damage`); cooldowns are the resolved cooldown (no `/ attack_speed`). `try_use`'s `crit` plumbing stays (always `false` since Hide was removed).
- [ ] **Step 4: Run** the full suite — expected: all pass, **both fingerprint tests unchanged** (calibration is exact).
- [ ] **Step 5: Commit** "Progression: the simulation reads heroes from the sheet"

### Task 6: Resolved numbers to the client

**Files:**
- Modify: `server/src/protocol.rs` (`RunStartInfo`: remove `mods`, add `speed: f64`, `abilities: [ResolvedAbility; 2]`, `fallback: Option<ResolvedAbility>`), `server/src/run/mod.rs` (`start_info`), `client/src/game/world.ts` (`Predictor`), `client/src/game/GameScene.ts` (`predictAbility`, constructor), `client/src/ui/hud.ts` (cooldown max), `client/src/game/world.test.ts`, regenerated `client/src/generated/*`

**Interfaces:**
- Consumes: `ResolvedAbility` (TS type generated by ts-rs).
- Produces: `new Predictor(map, speed: number, abilities: ResolvedAbility[], fallback: ResolvedAbility | null, x, y)`; `cooldownOf(slot: 0 | 1, fallback = false): number`; dash duration from the secondary when its `id === 'Dash'`. `predictAbility(slot, …)` reads `this.info.abilities[slot]` instead of `ABILITIES[name]`. The HUD's `cdMax[i] = info.abilities[i].cooldown`. `ABILITIES` stays for visual constants only (`anim/defs.ts` swing reach).

- [ ] **Step 1: Write the failing test** in `world.test.ts`: `predictor_uses_resolved_numbers`: a Predictor built with speed 90 and a primary cooldown 0.5 moves 90 × DT per step and `cooldownOf(0) === 0.5`; with a fallback cooldown 0.3, `cooldownOf(0, true) === 0.3`; a secondary `{ id: 'Dash', duration: 0.25 }` gives `dashT === 0.25` after a dash step.
- [ ] **Step 2: Run** `cd client && npm test -- world` — expected: FAIL.
- [ ] **Step 3: Implement** server and client changes; regenerate types with `cd server && cargo test --lib export` (writes `client/src/generated/`).
- [ ] **Step 4: Run** `npm run typecheck && npm test` and the server suite — expected: all pass; then `docker compose up --build -d` and play one class briefly: no correction jitter (`?debug` overlay shows correction 0.00 px).
- [ ] **Step 5: Commit** "Progression: the client predicts from the sheet's resolved numbers"

### Task 7: Pushes by STR against weight

**Files:**
- Modify: `server/src/run/mod.rs` (`knock_player(pi, from, fallback, dist, str: i32)`, `knock_monster(mi, from, dist, str: i32)`, `knock_creature(c, from, fallback, dist, str: i32)`; an ally mid-dash is still never pushed), callers in `run/ai.rs` (attacker's `Monster.attrs` STR), `run/companion.rs` (the wolf's bite and dash pass `WOLF_ATTRS` STR 17), `run/objects.rs` (`BARREL_BLAST_STR`), `run/abilities.rs` (`explode`: enemy explosions pass the source monster's STR, or `BOSS_KNOCK_STR` if it is a boss), `run/bosses/{demon,dragon,lich}.rs` (`BOSS_KNOCK_STR`)
- Modify: `server/src/defs/bosses.rs`: `pub const BOSS_KNOCK_STR: i32 = 30;` (my call within the spec's "bosses keep their scripted pushes": 30 exceeds every hero weight + 4, so boss pushes stay full)

**Interfaces:**
- Consumes: `Player.sheet.weight`, `Monster.weight`, `Monster.attrs`.
- Produces: `pub fn push_dist(base: f64, str: i32, weight: f64) -> f64` in `defs/attributes.rs` (`0` if `str as f64 <= weight`, else `base × min(1, (str − weight) / 4)`).

- [ ] **Step 1: Write the failing tests**: in `attributes.rs` `push_needs_str_above_weight`: `push_dist(20.0, 9, 9.0) == 0.0`, `push_dist(20.0, 16, 13.0) == 15.0`, `push_dist(20.0, 19, 13.0) == 20.0`. In `run/mod.rs` tests `bosses_and_chests_never_move`: a barrel blast next to the boss and a chest leaves both positions unchanged; `the_wizard_pushes_a_barrel`: Wizard E on a barrel moves it (STR 8 > weight 6); `orc_pushes_the_barbarian_less`: an orc warrior's hit pushes a Wizard 20 px and a Barbarian 15 px (measure the knock speed set: `knock_speed(15.0, DT)`); in `run/companion.rs` tests `wolf_bite_pushes_an_orc_not_an_ogre`: the wolf's bite (STR 17) knocks an orc warrior (weight 13) the full `WOLF_BITE_KNOCK` and leaves an ogre (weight 20) in place.
- [ ] **Step 2: Run** `cargo test --lib push bosses_and_chests the_wizard orc_pushes wolf_bite_pushes` — expected: FAIL.
- [ ] **Step 3: Implement**; the Wizard's E on barrels already exists in `objects::use_object`: give it the hero's STR.
- [ ] **Step 4: Run** the full suite — expected: all pass except possibly `simulation_is_unchanged_after_waking_the_boss` (left for Task 9).
- [ ] **Step 5: Commit** "Progression: pushes need STR above the target's weight"

### Task 8: Effect durations by power against save

**Files:**
- Modify: `server/src/defs/effects.rs` (`OnHit` gains `magical: bool`, `power: i32`; `pub fn scaled_secs(base: f64, power: i32, save: i32) -> f64`), `server/src/run/effects.rs` (`apply_effect_from(c, kind, secs: Option<f64>, power: i32, magical: bool) -> bool`; `hit_effect` and `element_hit` call it), `server/src/run/bosses/lich.rs` (its `OnHit`s: `magical: true, power: 22` from the lich's stat block), every other `OnHit {` literal (tests, enemies comment)

**Interfaces:**
- Consumes: `Player.sheet.attrs`, `Monster.attrs`.
- Produces: `apply_effect` keeps its signature and **does not scale** (debug key, tests, direct calls); `apply_effect_from` scales then calls it. Positive effects (`def(kind).positive`) are never scaled. `element_hit` uses power 10, non-magical (my call: elemental effects from a hit's split are physical consequences, the "fixed 10" of spec §5).

- [ ] **Step 1: Write the failing tests** in `run/effects.rs`:
  - `duration_follows_power_against_save`: `scaled_secs(3.0, 15, 8) == 3.0 × 1.35`; `scaled_secs(3.0, 22, 14) == 3.0 × 1.4`; `scaled_secs(3.0, 10, 30) == 0.0`.
  - `lich_sleep_lasts_longer_on_the_paladin`: an `OnHit { kind: Sleep, secs: 2.0, chance: 1.0, magical: true, power: 22 }` on a Paladin (WIL 12) leaves 3.0 s.
  - `elves_and_the_wolf_stay_immune_to_sleep`: the same hit on an Elven Ranger and on her summoned wolf leaves no Sleep.
  - `burning_is_shorter_on_a_tough_hero`: `element_hit` with a heat split on a Barbarian (CON 14) gives `def(Burning).duration × 0.8`.
  - `responses_still_override_the_formula`: a monster with `responses` Immune to Sleep takes no Sleep from power 40.
  - `buffs_are_never_shortened`: Accelerated via `apply_effect_from(.., power 0, magical true)` on a WIL 18 target keeps its full duration.
- [ ] **Step 2: Run** `cargo test --lib effects` — expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite — expected: all pass except `simulation_is_unchanged_after_waking_the_boss` (Task 9).
- [ ] **Step 5: Commit** "Progression: effect durations from power against save"

### Task 9: Fingerprints, export, docs

**Files:**
- Modify: `server/src/run/mod.rs` (`simulation_is_unchanged_after_waking_the_boss` values and comment), `server/src/export.rs` (`CLASSES` gains `attrs`, `weight`, `base_hp`), `docs/TECHNICAL.md` (§11a: the sheet; how pushes and effect durations work), `HANDOFF.md`, `docs/TODO.md` (priority 4: plan 1 done)

- [ ] **Step 1: Confirm why the fingerprint changed:** run it on the Task 6 commit (passes) and on Task 7 and Task 8 (fails); write down which boss halls changed (expected: halls where heroes are pushed or take an effect).
- [ ] **Step 2: Re-record** the changed values with a dated comment naming the cause (pushes by weight; durations by save), in the style of the existing comments. `level_setup_is_unchanged` must **not** change.
- [ ] **Step 3: Update the export and the docs.**
- [ ] **Step 4: Run** the full server suite, `npm run typecheck && npm test`, and a short play of each class on `docker compose up --build -d` — expected: all green, no browser errors.
- [ ] **Step 5: Commit** "Progression plan 1: re-recorded fingerprints, docs"
