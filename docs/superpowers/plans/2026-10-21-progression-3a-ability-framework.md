# Progression plan 3a: the ability framework

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abilities become data with a category, a weapon use and requirements. Today's seven abilities merge into Magic Missile, Fireball, **Strike**, **Holy Light**, **Charge**, **Shoot** and Summon Wolf. Every entity falls back to its melee weapon in melee (the melee rule), and ranged weapon shots pierce on overkill. A hero's two abilities come from a **loadout**, which is checked against a pool: the class start abilities plus the abilities granted by worn items, each item with its own version and `AbilityMod`s. If the server allows debug, a waiting-room message sets any ability of your class. The client predicts only from the `ResolvedAbility` numbers the server sends.

**Architecture:** `defs/abilities.rs` is rewritten as typed data (`AbilityDef` with `category`, `uses`, `ranged`, `req`, `shape`, `own`, `weapon_mult`, `classes`). `defs/loadout.rs` (new) holds `Loadout`, `Pick`, `Source`, `Build`, `AbilityMod` and the validation. `sheet::hero_sheet` takes a `Build` and returns `Result<Sheet, LoadoutError>`. Each `ResolvedAbility` carries every number of the attack, including split, on-hit, power, push and pierce, so `run/abilities.rs` reads one struct and no longer looks things up. Enemies get the melee rule through their existing `alt` attack. Projectiles carry a `Pierce` and the ids they already hit.

**Tech Stack:** Rust (axum server, `cargo test`), TypeScript client (Phaser, vitest), ts-rs generated types.

**Spec:** [docs/superpowers/specs/2026-10-18-progression-design.md](../specs/2026-10-18-progression-design.md) §6.3–§6.5, the loadout parts of §8 and §10, the melee rule for enemies in §7, and step 4 of §14 without the 16 new abilities. Plan 2: [2026-10-21-progression-2-weapons-and-items.md](2026-10-21-progression-2-weapons-and-items.md). Carry-overs: HANDOFF.md "Next session".

**Branch:** `feature/skill-tree-design`.

## Scope decisions

**Decided by the user (2026-10-21):**
1. **Step 4 is split.** This plan (3a) builds the framework. Plan 3b adds the 16 new abilities (spec §6.6) on top of it.
2. **Debug loadout.** If the server allows debug (`run::debug::allowed()`), the waiting-room message `DebugLoadout { primary, secondary }` sets any ability of your class. It skips the "unlocked" check but keeps the Attribute and weapon checks. A run with a debug loadout counts as a debug run (XP not banked). Plan 4's `SetLoadout` replaces the message.

**My calls, for the user's review:**

3. **The melee-rule strike hits the nearest target, and carries its overkill on** (the user, 2026-10-21). It hits the nearest target in reach, in any direction, like today's rapier thrust (`dagger_target`, renamed `melee_target`); it does not swing an arc. If the hit kills, the rest of the damage (§6.5's formula) goes to the next-nearest target in reach, and so on. It stops at a target it does not kill or an immune one. The Elven Ranger plays as today until a thrust kills. The Wizard now hits with his staff when an enemy is in reach.
4. **Secondaries are melee or ranged by `AbilityDef.ranged`, like primaries.** Only a ranged secondary (today only Fireball) is blocked in melee; Holy Light, Charge and Summon Wolf still work.
   **"In melee"** means `melee_target` finds something: a monster on the ground that is not an ally, or a closed chest, within `sheet.reach`. The same test blocks a ranged secondary.
5. **Reach.** `classes::HERO_REACH` = 17, so a hero's reach is `HERO_REACH + PLAYER_RADIUS` = 22. Strike and the fallback use it. The Barbarian's reach goes from 25 to 22 (spec exception). `DAGGER_RANGE` and the exported `DAGGER_COOLDOWN` are removed.
6. **Cooldown of a technique or weapon attack.** It is `own.cooldown` if that is above 0 (Charge: 5 s). Otherwise it is the weapon's interval × `weapon_mult.time`.
7. **Hero pushes.** Strike and Charge push with their weapon's `push` (resolved into `ResolvedAbility.push`), at `push_str` = the hero's STR plus `PushStr` mods. Every starter weapon has push 0, so nothing changes at the start. Bowling Charge (plan 4) adds STR only, so it matters only with a pushing weapon; plan 4 revisits it.
8. **Ability Attribute requirements count item points.** This is like tree nodes (spec call 17), and unlike equip requirements. A ring granting an ability is about access, so its own +INT may unlock it.
9. **The enemy melee rule uses `alt`.** Every enemy whose only attack is ranged gets `alt: Some(melee)`, and the existing AI rule (a melee `alt` is used when the target is in its reach) does the rest. Archers and the Disciple punch (`UnarmedStrike`). The Necromancer and the Summoner strike with their staffs, which are two new enemy items.
10. **Cosmetic piercing on the client predicts the kill** (the user, 2026-10-21). Each snapshot entity already carries its HP as a byte share of its max HP. `export.rs` adds each enemy kind's max HP and damage resistances, so the client estimates `hp = share × max_hp` and runs the same overkill formula. A cosmetic shot that predicts a kill flies on with the rest; otherwise it ends at the enemy, as today. When the guess is wrong, the shot must never jump back or blink:
    - Predicted a kill that did not happen: the shot flies on a few px until the server's shot is gone, then vanishes with its hit spark at the enemy where the server stopped it.
    - Predicted a stop, but the server's shot flies on: the client leaves the shot out of `endedShots`, so the server's projectile is drawn from the next snapshot. This is rare.

    Kinds shared by two enemy types (the skeleton and raised archer, the imp and summoned imp) use the normal type's max HP; a mismatch is only cosmetic.
11. **Pierce encoding:** `ResolvedAbility.pierce: u8` (overkill) and `pierce_through: u8`. For `pierce`, 0 = stops at the first enemy, n = up to n more enemies by overkill, and `u8::MAX` = no limit. Shoot and enemy weapon shots have `u8::MAX`. Spells have 0, and the `Pierce(n)` mod adds n.
    **Through-piercing** (the user, 2026-10-21): `pierce_through > 0` means the shot passes through up to that many enemies with **full damage**, killed or not, and then follows the overkill rule. It comes from a ranged weapon's `PropKind::Pierce(n)` or from `AbilityMod::PierceThrough(n)`. The sample item is `HuntersBow` (Bow, Elven Ranger, `Pierce(2)`, non-magical). Spells can get it only through a mod.
12. **Sample granting items** (my numbers): `RingOfTheMagus` (Magic Missile, `DamageMul(0.75)`, waives Attributes) and `SeekersBand` (Magic Missile, `Pierce(1)`, does not waive). These two let the tests and the debug player see two independent versions.
13. **`AbilityMod` in 3a:** `Pierce(u8)`, `PierceThrough(u8)`, `RadiusMul(f64)`, `RangeMul(f64)`, `DurationAdd(f64)`, `CooldownAdd(f64)`, `DamageMul(f64)`, `ArcMul(f64)`, `AddShare(DamageType, f64)`, `PushStr(i32)`, `CompanionHpMul(f64)`, `CompanionDashCooldownAdd(f64)`. Plan 3b adds `OnHitChance`, `AddOnHit` and `BehindArc` together with the abilities they act on.

## Global Constraints

- Terms: "Attribute" (never "ability score"); "ability" means only the primary (LMB) or secondary (RMB). Never say "elemental"; say "damage-type effect".
- Every `match` over `AbilityId`, `AbilityCategory`, `Uses`, `Shape`, `AbilityMod`, `Source`, `EquipSlot` and `PropKind` is exhaustive, **with no `_ =>` arm**.
- `AbilityId` is declared with `listed_enum!` (ids 0..=6 in this order: `MagicMissile, Fireball, Strike, HolyLight, Charge, Shoot, SummonWolf`). It derives `Serialize, Deserialize, TS` and is serialized by name, as today.
- **Numbers at the class start equal today's**, except these, which are deliberate: Charge damage 25.6 (was 25), Barbarian Strike reach 22 (was 25), the ranger's fallback `arc` (now the rapier's 1.0; unused by the single-target strike). Behaviour changes, also deliberate: the Wizard's staff in melee, Fireball blocked in melee, enemies with only ranged attacks strike in melee, and ranged weapon shots pierce on overkill.
- **Fingerprints:** Task 1 marks `simulation_is_unchanged_after_waking_the_boss` and `level_setup_is_unchanged` with `#[ignore = "re-recorded in plan 3a Task 8"]`. Task 8 re-records them once, with a dated comment that names the reasons listed above.
- Overkill (shots and the melee-rule strike): `used = hp_left / Σ(share_t × (1 − res_t))`, with the target's current resistances (the ones `hurt_monster` and `hurt_creature` use). The rest (`damage − used`) flies on. A non-kill stops the shot. An immune target (sum ≤ 0) stops it.
- Old upgrades (`StatUpgrades`/`Modifiers`) still multiply after everything else, as in plan 2 (damage not on Holy Light). Plan 4 removes them.
- Tasks 1–6 change only the server; the client does not typecheck against the new generated types until Task 7 (expected).
- No new art. The debug picker is plain DOM in the waiting room.
- Verify the server with `cd server && cargo test -- --skip export_bindings` inside the agent sandbox. Run the full `docker compose -f docker-compose.test.yml run --rm test` once in Task 8, so `client/src/generated` is regenerated. Verify the client with `cd client && bash -lic 'npx vitest run && npx tsc --noEmit'`.

## Review Focus

1. **The game plays like today at the start, apart from the listed exceptions.** This covers every class's primary, secondary and fallback numbers, the enemies' main attacks, and the wolf. Pinned by `hero_sheet_reproduces_today` (Task 1) and `enemy_attacks_rebuild_from_their_weapons` (Task 4).
2. **A blocked secondary desyncs the cooldown.** The server must neither fire nor start the cooldown, and the client must neither predict a cooldown nor send the input. Pinned by `a_ranged_secondary_in_melee_does_nothing` (Task 3) and the client's `abilityChoice` tests (Task 7).
3. **A piercing shot or a melee overkill hits the same enemy twice**, for example on the fast-forward in `spawn_player_projectile` or in the next substep. Or an immune or resistant enemy lets it through. Pinned by `overkill_never_hits_the_same_enemy_twice` and `an_immune_target_stops_the_shot` (Task 5).
4. **A loadout whose granting item was taken off** (a `Source::Item` pick with an empty slot, or with another item in that slot) panics instead of returning `NotInPool`. Pinned by `an_item_version_leaves_with_its_item` (Task 2).
5. **`DebugLoadout` gets through when it must not:** debug off, while Ready, during a run, or with an ability of another class. And an invalid loadout reaches `Run::new`. Pinned by `debug_loadout_is_refused_when_it_must_be` and `ready_and_start_refuse_an_invalid_loadout` (Task 6).

---

### Task 1: Ability data and resolution; the four merges

**Files:**
- Rewrite: `server/src/defs/abilities.rs`
- Modify: `server/src/defs/requirements.rs`, `server/src/defs/classes.rs`, `server/src/sheet.rs`, `server/src/run/abilities.rs`, `server/src/run/objects.rs` (test helper), `server/src/export.rs`, `server/src/run/mod.rs` (fingerprint `#[ignore]`), and every other `AbilityId::` use (`grep -rn "AbilityId::" server/src`)

**Interfaces:**
- Produces:
  - `requirements.rs`: `Requirement::WeaponKind(&'static [WeaponKind])`. `pub fn met(&self, attrs: &Attributes, weapon: Option<WeaponKind>) -> bool`: `Attr` compares the Attribute; `WeaponKind` is true iff `weapon` is in the list. Item code passes `None`. A data test in `items.rs` refuses `WeaponKind` in any `ItemDef.req`.
  - `abilities.rs`:
    - `listed_enum! { #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)] pub enum AbilityId: u8 { MagicMissile = 0, Fireball = 1, Strike = 2, HolyLight = 3, Charge = 4, Shoot = 5, SummonWolf = 6 } }`
    - `pub enum AbilitySlot { Primary, Secondary }`, `pub enum AbilityCategory { WeaponAttack, Technique, Spell, Innate }`, `pub enum Uses { Melee, Ranged, Nothing }`, `pub enum Shape { Swing, Projectile, Blast, Dash, SelfArea, Summon }`. All derive `Debug, Clone, Copy, PartialEq, Eq, Serialize`.
    - `pub struct OwnStats { pub damage: f64, pub cooldown: f64, pub range: f64, pub speed: f64, pub radius: f64, pub duration: f64, pub kind: Option<EntityKind>, pub at: i32 }`. `kind` is the spell's projectile; its split is `kind_split(kind)`. `at` is the governing Attribute's value at which `damage` is given.
    - `pub struct WeaponMult { pub damage: f64, pub time: f64, pub arc: Option<f64> }` with `pub const ONE: WeaponMult = { 1.0, 1.0, None }`.
    - `pub struct AbilityDef { pub id, pub name: &'static str, pub slot: AbilitySlot, pub category, pub uses, pub ranged: bool, pub req: &'static [Requirement], pub shape, pub own: OwnStats, pub weapon_mult: WeaponMult, pub classes: &'static [ClassId] }`. `classes` lists the classes whose own pool can hold it: the class start now, and the tree in plan 4.
    - `pub fn def(id: AbilityId) -> AbilityDef`; `pub fn governing(c: AbilityCategory) -> Option<Attr>` (Spell → Int, Innate → Cha, the others → None); `pub const DASH_SPEED`, `KNOCK_DECAY`, `KNOCK_MIN_SPEED` stay. `scaling`, `uses_weapon`, `owner`, `on_hit`, `ALL`, `DAGGER_RANGE` and `Scaling` are deleted.
  - `classes.rs`: `pub const HERO_REACH: f64 = 17.0`. Starts: Paladin `Strike`/`HolyLight`, Barbarian `Strike`/`Charge`, Elven Ranger `Shoot`/`SummonWolf`.
  - `sheet.rs`:
    - `ResolvedAbility` gains `pierce: u8`, `pierce_through: u8`, `ranged: bool` and `#[ts(type = "number | null")] projectile: Option<u8>` (the `EntityKind` id). It gains `split: DamageSplit`, sent to the client (for its cosmetic overkill, Task 7) as an object of the non-zero shares by damage-type name (`#[serde(serialize_with = …)]`, `#[ts(type = "Partial<Record<DamageType, number>>")]`; a test checks `{"Physical":1.0}` for the Paladin's Strike). It also gains server-only fields, each `#[serde(skip)] #[ts(skip)]`: `on_hit: Option<OnHit>`, `power: i32`, `push: f64`, `push_str: i32`.
    - `Sheet` gains `reach: f64`. `fallback` becomes `ResolvedAbility` (always present: Strike with the melee weapon).
    - `fn resolve_ability(d: &AbilityDef, attrs: &Attributes, melee: &ResolvedWeapon, ranged: Option<&ResolvedWeapon>, reach: f64) -> Option<ResolvedAbility>`. It returns `None` only for `Uses::Ranged` without a ranged weapon (Task 2 turns this into `LoadoutError::NoWeapon`). Rules:
      - `Uses::Melee`: damage = weapon × `mult.damage`; cooldown per call 6; arc = `mult.arc` or the weapon's; range = `reach`. Split, on-hit, power and push come from the weapon. `speed`, `radius` and `duration` come from `own`.
      - `Uses::Ranged`: damage, cooldown (call 6), range, speed (`projectile_speed`), radius, `projectile`, split, on-hit and power from the weapon; `pierce = u8::MAX`.
      - `Uses::Nothing`: `own` numbers. Damage is scaled by `governing(category)` with `Scaled { at: own.at, pct: INT_DMG or CHA_DMG }`. The split is `kind.map_or(physical, kind_split)`, and power is the governing Attribute's value (0 for Summon Wolf, which deals no damage). `pierce = 0`.
      - Always: `ranged = d.ranged`, `push_str = attrs.get(Str)`, `id = d.id`.
- Ability data (today's numbers; `ranged` true only for Magic Missile, Fireball and Shoot; `req` empty for all seven):

| Id | Name | Slot | Category | Uses | Shape | Own (dmg, cd, range, speed, radius, dur, kind, at) | Mult | Classes |
|---|---|---|---|---|---|---|---|---|
| MagicMissile | Magic Missile | P | Spell | Nothing | Projectile | 12, 0.35, 220, 230, 3, 0, Missile, 15 | ONE | Wizard |
| Fireball | Fireball | S | Spell | Nothing | Blast | 45, 6, 260, 140, 38, 0, Fireball, 15 | ONE | Wizard |
| Strike | Strike | P | WeaponAttack | Melee | Swing | all 0, None, 0 | ONE | Paladin, Barbarian |
| HolyLight | Holy Light | S | Innate | Nothing | SelfArea | 35, 10, 64, 0, 64, 0, None, 14 | ONE | Paladin |
| Charge | Charge | S | Technique | Melee | Dash | 0, 5, 0, `DASH_SPEED`, 10, 0.18, None, 0 | damage 0.8 | Barbarian |
| Shoot | Shoot | P | WeaponAttack | Ranged | Projectile | all 0, None, 0 | ONE | Elven Ranger |
| SummonWolf | Summon Wolf | S | Innate | Nothing | Summon | 0, 8, 0, 0, 0, 0, None, 13 | ONE | Elven Ranger |

- [ ] **Step 1: Write the failing tests.**
  - In `abilities.rs`, `ability_data_is_consistent`: for every `AbilityId::ALL`, `def(id).id == id` and `classes` is not empty. `Uses::Nothing` ⇔ category Spell or Innate. Each class's start primary and secondary have the matching `slot` and list the class in `classes`.
  - In `requirements.rs`, `a_weapon_kind_requirement_reads_the_weapon`: `WeaponKind(&[Hammer, Club])` is met with `Some(Club)`, and not met with `Some(Axe)` or `None`.
  - In `sheet.rs`, rewrite `hero_sheet_reproduces_today`. Compare against a table of today's numbers written in the test (the old `ab::def` rows above, plus Sword 0.45/20/22/1.75 and Axe 0.8/32/25/2.45, CrossbowDagger 0.7/16/260/290/2), with these asserted exceptions: Barbarian Strike `range == 22.0`; Charge `damage == 32.0 * 0.8`. Also: every class's `fallback.id == Strike` with `range == 22.0` and the melee weapon's damage and cooldown (the ranger's `(18.0, 0.35)`); `Shoot.projectile == Some(EntityKind::Bolt as u8)` and `pierce == u8::MAX`; `MagicMissile.pierce == 0`; every `power` (Wizard spells 15, Holy Light 14, Paladin Strike 15, ranger Shoot 15).
  - In `items.rs`, extend `item_data_follows_the_rules`: no item `req` holds `Requirement::WeaponKind`.
- [ ] **Step 2: Run** `cargo test --bin '*' abilities requirements sheet items -- --skip export_bindings`. Expected: FAIL (compile errors on the new names).
- [ ] **Step 3: Implement** what Produces lists. In `run/abilities.rs`, rename the arms and change nothing else in behaviour yet. `Strike` swings `melee_arc` with the resolved numbers. `Charge` is today's dash, and `dash_contact` reads `sheet.secondary` (split, on-hit and power from the `ResolvedAbility`). `Shoot` keeps today's dagger-or-bolt branch, using `sheet.fallback` and `sheet.ranged`. `HolyLight` is today's heal. Every `Damage` is built from the ability's `split`, `on_hit` and `power`. Delete `hero_power`. In `export.rs`, drop `DAGGER_RANGE` and `DAGGER_COOLDOWN` from the consts and export each ability as `{ name, slot, ranged, classes }`. Also export `ENEMY_KINDS`: for each `EntityKind` of an enemy type (the first `EnemyType::ALL` entry per kind), `{ max_hp, res: { <DamageType>: f64 } }` from `sheet::enemy_stats` and `enemies::profile`. A test in `export.rs` checks that each kind's entry is that of its first enemy type. Add the two `#[ignore]`s.
- [ ] **Step 4: Run** `cargo test -- --skip export_bindings`. Expected: PASS (the two fingerprint tests ignored), no new warnings.
- [ ] **Step 5: Commit** "Progression 3a: abilities as data; Strike, Shoot, Charge and Holy Light"

### Task 2: Loadout, item-granted abilities and AbilityMod

**Files:**
- Create: `server/src/defs/loadout.rs` (register in `defs/mod.rs`)
- Modify: `server/src/defs/items.rs`, `server/src/sheet.rs`, `server/src/run/mod.rs` (`Member`, test helpers), `server/src/run/companion.rs`, `server/src/lobby.rs` (build `Member` from `Build::start`), `server/src/export.rs`, `server/src/run/objects.rs`

**Interfaces:**
- Consumes: Task 1.
- Produces (`loadout.rs`):
  - `#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)] pub enum Source { Own, Item(EquipSlot) }` (`EquipSlot` gains the same serde/TS derives), `pub struct Pick { pub ability: AbilityId, pub source: Source }`, `pub struct Loadout { pub primary: Pick, pub secondary: Pick }`, with `Loadout::start(class: ClassId) -> Loadout` (the two `Own` class starts).
  - `#[derive(Debug, Clone, Copy, PartialEq)] pub enum AbilityMod { Pierce(u8), PierceThrough(u8), RadiusMul(f64), RangeMul(f64), DurationAdd(f64), CooldownAdd(f64), DamageMul(f64), ArcMul(f64), AddShare(DamageType, f64), PushStr(i32), CompanionHpMul(f64), CompanionDashCooldownAdd(f64) }`.
  - `pub fn apply_mods(r: ResolvedAbility, mods: &[AbilityMod]) -> ResolvedAbility`. Additions are summed and multipliers multiplied, so the order never matters. Shares go through `split.with_shares`, with a `debug_assert!` that no `AddShare` names `Physical` (carry-over). `Pierce(n)` and `PierceThrough(n)` saturate at `u8::MAX`. The companion mods do nothing here (`Sheet.wolf` reads them).
  - `#[derive(Debug, Clone, PartialEq)] pub struct Build { pub extra: Attributes, pub equipment: Equipment, pub loadout: Loadout, pub own: Vec<AbilityId>, pub upgrades: StatUpgrades }`. `own` lists the abilities unlocked beyond the class start: empty now, the debug pool in Task 6, tree unlocks in plan 4. `Build::start(class)` returns the starters, `Loadout::start`, an empty `own`, and default upgrades and extra.
  - `#[derive(Debug, Clone, Copy, PartialEq)] pub enum LoadoutError { Equip(EquipSlot, EquipError), NotInPool(AbilityId), WrongSlot(AbilityId), Requirement(AbilityId, Requirement), NoWeapon(AbilityId, EquipSlot) }` with `pub fn message(&self) -> String` (e.g. "Shoot needs a ranged weapon.", "Fireball cannot go in the primary slot.", "Magic Missile needs INT 18.").
  - `pub fn pick_version(class: ClassId, b: &Build, slot: AbilitySlot, p: Pick) -> Result<(&'static [AbilityMod], bool /*waive_attrs*/), LoadoutError>`. Order: the def's slot (`WrongSlot`); then the source (`Own`: a class start or in `b.own`, and the class is in `def.classes`; `Item(s)`: the item in `s` has a `GrantAbility` with this id), else `NotInPool`.
  - `pub fn check_pick(d: &AbilityDef, waive_attrs: bool, attrs: &Attributes, weapon: Option<WeaponKind>) -> Result<(), LoadoutError>`. `Attr` requirements are checked against `attrs` (with item points, call 8) unless `waive_attrs`. `WeaponKind` requirements are always checked, against the kind in the slot the ability uses.
- `items.rs`: `PropKind::GrantAbility { id: AbilityId, mods: &'static [AbilityMod], waive_attrs: bool }`. Items `RingOfTheMagus = 36` ("Ring of the Magus", Ring, `ALL`, `GrantAbility { MagicMissile, &[DamageMul(0.75)], true }`) and `SeekersBand = 37` ("Seeker's Band", Ring, `ALL`, `GrantAbility { MagicMissile, &[Pierce(1)], false }`), both magical. The data test requires `GrantAbility` to be magical. (Task 4 adds 38 and 39; `listed_enum!` refuses gaps.)
- `sheet.rs`: `pub fn hero_sheet(class: ClassId, b: &Build) -> Result<Sheet, LoadoutError>`. Equipment is checked first, with `check_equipment` against the Attributes without items: an `Err` instead of today's `debug_assert`, which fixes plan 2's carry-over for `equip`. An empty Melee slot still means the starter. **An empty Ranged slot now means no ranged weapon.** Each pick: `pick_version` → `check_pick` → `resolve_ability` (`None` → `NoWeapon(id, Ranged)`) → `apply_mods`. `Sheet` gains `wolf: WolfMods { hp_mul: f64, dash_cooldown_add: f64 }` (1.0 and 0.0 unless the Summon Wolf version's mods set them). `spawn_wolf` multiplies the wolf's max HP, and the wolf's dash uses `WOLF_DASH_COOLDOWN + dash_cooldown_add`.
- `run/mod.rs`: `Member` replaces `upgrades`, `extra` and `equipment` with `build: Build`. `Run::new` calls `hero_sheet(...).expect("validated in the lobby")`. `test_run_with(&[(ClassId, Build)], BossId)`, plus a helper `build_with(class, slot, item) -> Build` (the existing `armed` test helper in `run/abilities.rs` keeps its name and calls it).

- [ ] **Step 1: Write the failing tests** in `loadout.rs`:
  - `mods_stack_in_any_order`: for `[DamageMul(1.1), DamageMul(0.5), CooldownAdd(-1.0), RadiusMul(1.2), CooldownAdd(0.5)]` and its reverse, the same result. Damage is ×0.55, cooldown −0.5, radius ×1.2.
  - `pierce_saturates`: `Pierce(200)` twice on Shoot gives `u8::MAX`.
  - `the_start_loadout_is_valid`: `hero_sheet(c, &Build::start(c))` is `Ok` for every class.
  - `item_versions_are_independent`: a Paladin wearing `RingOfTheMagus` (Ring1) and `SeekersBand` (Ring2) with primary `Pick { MagicMissile, Item(Ring1) }` has damage `missile × 0.75` and pierce 0. With `Item(Ring2)`, the damage is unscaled and pierce is 1. `Pick { MagicMissile, Own }` gives `NotInPool(MagicMissile)`.
  - `an_item_version_leaves_with_its_item`: a `Pick { MagicMissile, Item(Ring1) }` with Ring1 empty, and the same pick with `BandOfVigor` in Ring1, both give `Err(NotInPool(MagicMissile))`, without a panic.
  - `a_waiver_is_per_version`: build a `AbilityDef { req: &[Requirement::Attr(Int, 18)], ..def(MagicMissile) }` in the test. `check_pick(&d, false, INT 15, None)` gives `Err(Requirement(MagicMissile, Attr(Int, 18)))`, and `check_pick(&d, true, INT 15, None)` is `Ok`. A `WeaponKind(&[Hammer])` requirement fails with `Some(Axe)` even when waived.
  - `wrong_slot_and_no_weapon`: a Wizard with primary `Fireball` gives `WrongSlot(Fireball)`. A ranger with `Equipment::starter(..)` minus the bow gives `NoWeapon(Shoot, Ranged)`. Each `message()` is not empty and names the ability.
  - In `sheet.rs`, replace `empty_slots_fall_back_to_the_starters` with `an_empty_melee_slot_is_the_starter`: `Equipment::default()` gives the same Strike and fallback as the starters for the Paladin, and `NoWeapon(Shoot, Ranged)` for the ranger.
  - In `companion.rs`, `wolf_mods_change_the_wolf`: a ranger `Build` whose secondary version has `CompanionHpMul(1.25)` and `CompanionDashCooldownAdd(-2.0)` (set `Sheet.wolf` directly on the test run) spawns a wolf with max HP `WOLF_HP × 1.25`, and the wolf's dash cooldown is 3.0.
- [ ] **Step 2: Run** `cargo test --bin '*' loadout sheet companion -- --skip export_bindings`. Expected: FAIL.
- [ ] **Step 3: Implement** what Produces lists, and update every caller of `hero_sheet` and `Member`.
- [ ] **Step 4: Run** `cargo test -- --skip export_bindings`. Expected: PASS.
- [ ] **Step 5: Commit** "Progression 3a: loadout, item-granted abilities and ability mods"

### Task 3: The melee rule for heroes; Shoot and Strike from the resolved numbers

**Files:**
- Modify: `server/src/run/abilities.rs`, `server/src/defs/damage.rs`

**Interfaces:**
- Consumes: `ResolvedAbility` fields (Task 1), `Sheet.reach` and `Sheet.fallback`.
- Produces: `pub enum MeleeTarget { Monster(usize), Object(usize) }` and `pub fn melee_target(run: &Run, pi: usize) -> Option<MeleeTarget>`. These are `DaggerTarget` and `dagger_target`, renamed, with reach `sheet.reach`. `try_use` follows the rule below for every ability, by `def.ranged`, not by id.
  - **Primary, `ranged`, a target in melee:** strike that target with `sheet.fallback` (damage, split, on-hit, power, push at `push_str`). Use the fallback's cooldown, `Anim::Melee`, and no projectile.
  - **Melee overkill** (call 3): `pub fn melee_targets(run: &Run, pi: usize) -> Vec<MeleeTarget>`, every target in reach sorted nearest first (`melee_target` is its first entry). The strike hurts them in order; after a kill, `overkill_rest` (Task 5's function; this task adds it to `damage.rs` and Task 5 reuses it) gives the damage for the next one. It stops at a target it does not kill or an immune one. A chest is broken by any hit and has no HP to overflow, so the strike stops there.
  - **Secondary, `ranged`, a target in melee:** return at once. No cooldown, no anim, no event.
  - **Shoot:** spawn `sheet.primary.projectile` (the weapon's kind; carry-over: no hard-coded `Bolt`). Carry the ability's split, on-hit and power.
  - **Strike and Charge:** push each monster they hit, `run.knock_creature(Creature::Monster(mi), pos, aim, ability.push, ability.push_str)`, only when `push > 0`. This settles plan 2's "hero swings ignore `push`".

- [ ] **Step 1: Write the failing tests** (rename `ranger_uses_dagger_in_melee_range_and_crossbow_otherwise` to `a_ranged_primary_strikes_in_melee` and extend it):
  - `a_ranged_primary_strikes_in_melee`:
    - Ranger with an orc at 10 px: the orc loses HP, there are no projectiles, and `cd1 == 0.35`.
    - Wizard with an orc at 10 px: the orc loses `6 × (1 − its physical resistance)` HP (the Red Staff at STR 8), there are no projectiles, and `cd1 == 1.0`.
    - Wizard with the orc at 60 px: one `Missile`.
  - `a_ranged_secondary_in_melee_does_nothing`: Wizard, orc at 10 px, `try_use(.., false, ..)`. There are no projectiles, `cd2 == 0.0`, and the orc is unhurt. At 60 px a fireball flies and `cd2 == 6.0`.
  - `area_and_self_abilities_still_fire_in_melee`: Paladin Holy Light with an orc at 10 px sets `cd2 == 10.0`. Barbarian Charge with an orc at 10 px sets `mv.dash_t > 0.0`.
  - `shoot_fires_its_weapons_projectile`: a ranger whose `sheet.primary.projectile` is set to `EntityKind::Arrow as u8` fires an `Arrow`.
  - Carry-over tests: `ranged_properties_stay_off_melee`: a ranger whose `sheet.ranged`/`sheet.primary` split is pure Heat strikes in melee with a physical split. Her bolt carries `sheet.primary.split`. Charge contact carries `sheet.secondary.on_hit` (set to a 1.0-chance Slowed).
  - `a_melee_kill_carries_on`: a ranger with three goblins at 8, 12 and 16 px (HP 5, 5 and 24). The thrust (18) kills the first two and hits the third for `18 − 5 − 5 = 8`. With the first goblin at full HP (24), only it is hurt.
  - In `damage.rs`, `overkill_after_resistances` (moved here from Task 5): `overkill_rest(30, physical, 10, none) == Some(20)`. With physical resistance 0.5: `eff 0.5`, so used is 20 and the rest is `Some(10)`. `overkill_rest(10, physical, 30, none) == None`. Immune (`res 1.0`) gives `None`.
  - `a_pushing_weapon_pushes_on_strike`: a Paladin whose `sheet.primary.push` is set to 20 hits a goblin (weight 6, STR 15): `knock_vx > 0`. With push 0: no knock.
- [ ] **Step 2: Run** `cargo test --bin '*' run::abilities damage -- --skip export_bindings`. Expected: FAIL.
- [ ] **Step 3: Implement** `overkill_rest` (its interface is in Task 5), the rule in `try_use`, plus pushes in `melee_arc` and `dash_contact`. Update `melee_cannot_reach_a_flying_monster` to use `melee_target`.
- [ ] **Step 4: Run** `cargo test -- --skip export_bindings`. Expected: PASS.
- [ ] **Step 5: Commit** "Progression 3a: the melee rule for heroes"

### Task 4: The melee rule for enemies

**Files:**
- Modify: `server/src/defs/enemies.rs`, `server/src/defs/items.rs`

**Interfaces:**
- Consumes: `weapon_melee` and `UnarmedStrike` (plan 2).
- Produces:
  - Items `NecromancerStaff = 38` ("Necromancer Staff", `weapon_green_magic_staff`, `melee(Staff, 5.0, 1.2, 1.6, 0.0, phys(), at(9, 14))`, `ALL`) and `SummonerStaff = 39` ("Summoner Staff", `weapon_red_magic_staff`, same numbers).
  - `pub fn melee_item(t: EnemyType) -> ItemId`: `melee_weapon`, else the race's first natural weapon.
  - `alt: Some(weapon_melee(melee_item(t), &attrs, 12.0, 0.25))` for GoblinArcher, SkeletonArcher, RaisedArcher, OrcArcher and Disciple (all unarmed), and for Necromancer and Summoner (their staffs, `melee_weapon` set). `ranged_weapon` loses its `#[allow(dead_code)]`.
  - `AttackStyle::Ranged` gains `pierce: bool`. `weapon_ranged` sets it true. Spells, fire bolts and every boss `Ranged` set it false (`grep -rn "AttackStyle::Ranged\|Ranged {" server/src`). Task 5 reads it.
- [ ] **Step 1: Write the failing tests** in `enemies.rs`:
  - `enemy_attacks_rebuild_from_their_weapons` (carry-over): for every `EnemyType::ALL`, each `Melee` in `attack`/`alt` equals `weapon_melee(melee_item(t), &attrs, its range, its windup)`. Each `Ranged` with `pierce == true` equals `weapon_ranged(ranged_weapon.unwrap(), &attrs, its preferred, its windup)`.
  - `every_enemy_has_a_melee_attack`: every type except the Ogre (whose main attack is melee) has a `Melee` in `attack` or `alt`.
  - In `run/ai.rs`, `an_archer_punches_a_hero_in_reach`: a goblin archer with the Paladin at 10 px, both cooldowns 0. Its first wind-up is `alt == true`, and when it lands the Paladin loses HP while no projectile exists.
- [ ] **Step 2: Run** `cargo test --bin '*' enemies ai -- --skip export_bindings`. Expected: FAIL.
- [ ] **Step 3: Implement** what Produces lists.
- [ ] **Step 4: Run** `cargo test -- --skip export_bindings`. Expected: PASS.
- [ ] **Step 5: Commit** "Progression 3a: enemies strike in melee"

### Task 5: Overkill piercing

**Files:**
- Modify: `server/src/run/entities.rs` (`Projectile`), `server/src/run/abilities.rs`, `server/src/run/ai.rs`, `server/src/defs/items.rs`, `server/src/sheet.rs`

**Interfaces:**
- Consumes: `ResolvedAbility.pierce` (Task 1), `AttackStyle::Ranged.pierce` (Task 4).
- Produces:
  - `damage.rs` (written in Task 3): `pub fn overkill_rest(amount: f64, split: &DamageSplit, hp_left: f64, res: &Resistances) -> Option<f64>`. It returns `Some(amount − hp_left / eff)` when `eff = Σ share_t × (1 − res_t) > 0` and `amount × eff ≥ hp_left`, and `None` otherwise. Use the same per-type multiplier as the damage code (the `MIN_RESISTANCE` floor included), so a kill here is a kill there.
  - `entities.rs`: `pub enum Pierce { Never, Overkill { left: u8 }, Through { left: u8, then: u8 } }` (`u8::MAX` = no limit). `Through` passes `left` enemies with full damage, then becomes `Pierce::from_u8(then)`. `Projectile` gains `pierce: Pierce` and `hit: Vec<u32>`. `Pierce::new(overkill: u8, through: u8)` gives `Through { left: through, then: overkill }` if `through > 0`, else `Never` for 0 and `Overkill { left }` for the rest.
  - `items.rs`: `PropKind::Pierce(u8)`, allowed only on `ItemBase::Ranged` (data test). Item `HuntersBow = 40` ("Hunter's Bow", `weapon_bow`, `ranged(Bow, 15.0, 0.75, 250.0, 280.0, 2.0, Bolt, At::BASE)`, `RANGER`, plain `Pierce(2)`). `ResolvedWeapon` gains `pierce_through: u8` (sum of its `Pierce` properties), and `resolve_ability` copies it to `ResolvedAbility.pierce_through` for `Uses::Ranged`.
  - `abilities.rs`: player shots take `Pierce::new(ability.pierce, ability.pierce_through)`. Monster shots are `Never`, except that `perform_attack` sets `Overkill { left: u8::MAX }` after spawning when `pierce` is true (the same pattern as its on-hit). `advance_projectile` skips creatures whose id is in `hit`. In `impact`, on a creature with `Overkill { left > 0 }`: read its HP and current resistances, hurt it, On `Through { left > 0 }`, push its id, decrement `left` (switch to `then` at 0) and keep the shot alive with unchanged damage, killed or not. If it died and `overkill_rest` is `Some(rest)`, push its id, set `damage.amount = rest`, decrement `left` (not when it is `u8::MAX`), and keep the shot alive. Otherwise end the shot as today. Explosions never pierce.
- [ ] **Step 1: Write the failing tests:**
  - In `abilities.rs`:
    - `a_killing_bolt_flies_on`: ranger, three goblins at 30/40/50 px on a line (goblin HP 24, so set the first two to 5 HP). The bolt (16) kills the first two and hits the third with `16 − 5 − 5 = 6`.
    - `a_bolt_that_does_not_kill_stops`: the existing `a_shot_stops_at_the_first_enemy_even_when_fast_forwarded` (orcs at 70 HP) still passes for `Shoot` at every rtt.
    - `spells_stop_at_the_first_enemy`: Magic Missile kills a 1-HP goblin, and the goblin behind it is untouched. A Wizard with `SeekersBand`'s version (pierce 1) kills two 1-HP goblins and leaves a third untouched.
    - `an_immune_target_stops_the_shot`: a bolt whose split is pure Poison at a 1-HP skeleton (poison immune) leaves the goblin behind it untouched.
    - `overkill_never_hits_the_same_enemy_twice`: with rtt 0.3 (fast-forward) and one 5-HP goblin at 30 px, the goblin's `hurt` count is 1. Count the `Ev::Dmg` events with its id.
    - `through_piercing_ignores_hp`: a ranger with `HuntersBow` and three orcs (70 HP) in a line: the first two each lose a full bolt, and the third is hit too only if the second died. With 1-HP third orc: killed by the overkill rule after the two passes. `item_data_follows_the_rules` refuses `Pierce` on a non-ranged item.
    - `a_through_mod_works_on_a_spell`: Magic Missile with `PierceThrough(1)` hits two orcs at full damage and stops at the third.
    - `an_enemy_arrow_can_pierce`: an orc archer's arrow (via `perform_attack`) kills a 1-HP Wizard and hits the Paladin behind him.
- [ ] **Step 2: Run** `cargo test --bin '*' run::abilities items -- --skip export_bindings`. Expected: FAIL.
- [ ] **Step 3: Implement** what Produces lists.
- [ ] **Step 4: Run** `cargo test -- --skip export_bindings`. Expected: PASS.
- [ ] **Step 5: Commit** "Progression 3a: overkill piercing"

### Task 6: The lobby: debug loadout, validation on Ready and Start

**Files:**
- Modify: `server/src/protocol.rs`, `server/src/lobby.rs`, `server/src/run/mod.rs`

**Interfaces:**
- Consumes: `Build`, `Loadout`, `Pick`, `hero_sheet`, `LoadoutError::message` (Task 2); `run::debug::allowed()`.
- Produces:
  - `ClientMsg::DebugLoadout { primary: Pick, secondary: Pick }`. It is accepted only when `allowed()`, in a room, not Ready, and no run is going on. Otherwise the reply is `Error` ("Debug is off." / "Not while ready." / "Not during a run."). On accept, `Conn.loadout = Some(Loadout { primary, secondary })` and `Conn.debug_loadout = true`. The pool for that connection's `Build.own` is every `AbilityId::ALL` whose `def.classes` holds the class. Both reset when the character changes.
  - `fn build_of(&self, id: u32) -> Option<Build>`: the character's start `Build` with the connection's loadout and debug pool.
  - **Ready** (`SetReady { ready: true }`) and **Start** call `hero_sheet(class, &build)`. On `Err(e)`, they send `Error { msg: e.message() }` and leave the state unchanged (not Ready, no run). The host's own loadout is checked on Start too.
  - `Member.debug_loadout: bool`. `Run::new` sets `debug_used = true` if any member has it.
- [ ] **Step 1: Write the failing tests:**
  - In `protocol.rs`, a round trip of `DebugLoadout` in the existing test style, e.g. `{"t":"DebugLoadout","primary":{"ability":"Strike","source":"Own"},"secondary":{"ability":"Charge","source":{"Item":"Ring1"}}}`. Match the existing serde tagging of `ClientMsg`.
  - In `lobby.rs`:
    - `debug_loadout_is_refused_when_it_must_be`: refused while Ready, refused outside a room, and refused with debug off. Test through a `debug_loadout_if(allowed: bool, ..)` seam, like `debug_effect_if`.
    - `a_debug_loadout_reaches_the_run`: a Barbarian sets `Strike`/`Charge` from `Own`, and the run's hero 0 has that secondary. `run.debug_used` is true.
    - `ready_and_start_refuse_an_invalid_loadout`: a Wizard sets primary `Fireball` (WrongSlot). `SetReady { true }` leaves the connection not Ready and sends an `Error` naming Fireball. A host with the same loadout cannot start.
- [ ] **Step 2: Run** `cargo test --bin '*' lobby protocol -- --skip export_bindings`. Expected: FAIL.
- [ ] **Step 3: Implement** what Produces lists.
- [ ] **Step 4: Run** `cargo test -- --skip export_bindings`. Expected: PASS.
- [ ] **Step 5: Commit** "Progression 3a: debug loadout; Ready and Start check the loadout"

### Task 7: The client

**Files:**
- Modify: `client/src/game/world.ts`, `client/src/game/GameScene.ts`, `client/src/ui/hud.ts`, `client/src/ui/lobby.ts`, `client/src/game/world.test.ts`, `client/src/generated/*` (only through the export; inside the sandbox, edit the generated `ResolvedAbility.ts`, `AbilityId.ts` and `ClientMsg.ts` by hand to match. Task 8's docker run regenerates them and the diff must be empty.)

**Interfaces:**
- Consumes: `RunStartInfo.abilities` and `fallback` (now never null), the new `ResolvedAbility` fields, `ClientMsg.DebugLoadout`, and the exported abilities `{ name, slot, ranged, classes }`.
- Produces:
  - `world.ts`: `export function abilityChoice(a: ResolvedAbility, slot: 0 | 1, inMelee: boolean): 'use' | 'fallback' | 'blocked'`. It returns `'fallback'` for a ranged primary in melee, `'blocked'` for a ranged secondary in melee, and `'use'` otherwise. `Predictor` takes `fallback: ResolvedAbility` (not null), and its dash duration comes from the secondary when its id is `'Charge'`.
  - `GameScene.predictAbility` switches on the new ids (`'Strike'`, `'Charge'`, `'HolyLight'`, `'Shoot'`). It computes `inMelee` once (today's `close` test, at `info.fallback.range`; no `CONST.DAGGER_RANGE`) and uses `abilityChoice`. A `'blocked'` secondary returns `null`, the input's `secondary` is `null`, and `hud.tooClose(1)` is called. A `'fallback'` primary uses `ANIM.Melee` and the fallback's cooldown. Shoot spawns `a.projectile` (no hard-coded `KIND.Bolt`).
  - `world.ts` (pure, testable): `export function cosmeticPierce(state: { pierce: number; through: number; damage: number }, hpShare: number, maxHp: number | undefined, split: Record<string, number>, res: Record<string, number> | undefined): 'stop' | { pierce: number; through: number; damage: number }`. Through first (full damage, `through − 1`), then overkill with the server's formula on `hp = hpShare / 255 × maxHp` (unknown kind or immune → `'stop'`).
  - `Cosmetic` gains `{ pierce, through, damage, split, hit: Set<number> }`, filled from the `ResolvedAbility` (its `split` is sent since Task 1). `shotTouchesEnemy` returns the touched entity; `updateCosmetics` asks `cosmeticPierce`, and on a predicted pass adds the id to `hit` and flies on.
  - **No blinking** (call 10): when the server's shot ends (`goneOnServer`) while ours flew on, ours vanishes with its hit spark at the last enemy it passed; a shot whose prediction stopped but whose server shot is still alive is not put in `endedShots`, so the server's projectile is drawn.
  - `hud.ts`: `tooClose(slot: 0 | 1)` shows "Too close" on that slot for 0.8 s. The slot labels show the equipped abilities' exported `name`s. `secondaryLabel` keeps the wolf wording.
  - `lobby.ts`: in the waiting room, while not Ready, add a small "Debug loadout" row with two `<select>`s: primaries and secondaries whose `classes` contain your class. A change sends `DebugLoadout` with `source: 'Own'`. The server's `Error` is shown as other errors are.
- [ ] **Step 1: Write the failing tests** in `world.test.ts`:
  - `abilityChoice`: a ranged primary in melee gives `'fallback'`, a ranged secondary in melee `'blocked'`, a non-ranged ability in melee `'use'`, and anything out of melee `'use'`.
  - `cosmeticPierce`: an overkill shot of 16 at a 5-HP enemy (share 255, max 5, no resistance) flies on with 11; at a 24-HP enemy it stops; with resistance 1.0 it stops; `through 1` passes a 70-HP enemy with 16 and `through 0` afterwards; unknown max HP stops.
  - Update the `Predictor` fixtures to the new ids, with a non-null fallback. Keep the existing dash-duration test, with `'Charge'`.
- [ ] **Step 2: Run** `cd client && bash -lic 'npx vitest run src/game/world.test.ts'`. Expected: FAIL.
- [ ] **Step 3: Implement** what Produces lists.
- [ ] **Step 4: Run** `cd client && bash -lic 'npx vitest run && npx tsc --noEmit'`. Expected: PASS.
- [ ] **Step 5: Commit** "Progression 3a: the client predicts from the resolved abilities"

### Task 8: Fingerprints, docs and full verification

**Files:**
- Modify: `server/src/run/mod.rs` (fingerprints), `TECHNICAL.md`, `PLAYER_GUIDE.md`, `TODO.md`, `HANDOFF.md`

- [ ] **Step 1: Re-record the fingerprints.** Remove both `#[ignore]`s and run them. Check which values changed. Put the new values in, with a dated comment ("2026-10-2x, plan 3a: Charge 25.6, reach 22, staffs and punches in melee, overkill piercing"). `level_setup_is_unchanged` should not change: if it does, find out why before you re-record it.
- [ ] **Step 2: Docs.**
  - TECHNICAL §11a: replace the interim ability text with "Abilities" (categories, uses, `ranged`, resolution rules, call 6), "The melee rule", "Overkill piercing", "Loadouts and item-granted abilities" (pool, versions, `AbilityMod` stacking, `LoadoutError`, `DebugLoadout`), and "How to add an ability".
  - PLAYER_GUIDE: Strike, Shoot, Charge, Holy Light; the melee rule; piercing shots.
  - TODO: close the "Piercing shots" idea; drop the cosmetic leftovers from HANDOFF if fixed.
  - HANDOFF "Next session": plan 3a done, plan 3b next.
  - Fix plan 2's cosmetic leftovers while here: the redundant `#[allow(dead_code)]` on `ItemBase::Shield`, the mid-module `use` and the redundant imports in the items.rs tests, and the stale comment on the `SummonWolf` arm (now gone with `scaling()`).
- [ ] **Step 3: Verify.**
  - `cd server && cargo test -- --skip export_bindings`: all pass, no new warnings.
  - `cargo clippy`: 0 warnings.
  - `docker compose -f docker-compose.test.yml run --rm test`: all pass, and `git status client/src/generated` shows only the expected changes (the hand edits from Task 7 match exactly).
  - `cd client && bash -lic 'npx vitest run && npx tsc --noEmit && npm run build'`: pass.
  - e2e smoke (`tools/e2e/smoke.mjs`, containers rebuilt) for `ElvenRanger,Paladin` and `Wizard,Barbarian`: no browser errors, correction 0.00 px.
- [ ] **Step 4: Commit** "Progression plan 3a: re-recorded fingerprints, docs"
