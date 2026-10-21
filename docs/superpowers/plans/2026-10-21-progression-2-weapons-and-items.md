# Progression plan 2: weapons and items

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Weapons and items become data. A hero's melee and ranged attacks take their damage, speed, arc, range, damage split and on-hit effect from the equipped weapon, scaled by its key Attribute. Armor, rings, shoes and belts add resistances, Attribute points, weight, speed, HP and light. Enemies attack with their own weapons and natural attacks. At the starter equipment the game plays exactly as today.

**Architecture:** New data modules `defs/weapons.rs` (kinds, categories, stats, resolution), `defs/requirements.rs` and `defs/items.rs` (item defs, slots, `Equipment`, equip rules). `sheet::hero_sheet` folds the equipment into the sheet. Each weapon's numbers are stored at a reference STR/DEX (`At`), so calibration is bit-exact as in plan 1. The four weapon-using abilities of today (Sword, Axe, CrossbowDagger with its rapier thrust, and Dash's split) read the resolved weapons; plan 3 replaces them with Strike, Shoot and Charge. Heroes always wear their class starters here; `Progress`, equipping and the protocol come in plan 4.

**Tech Stack:** Rust (axum server, `cargo test`). No client changes.

**Spec:** [docs/superpowers/specs/2026-10-18-progression-design.md](../specs/2026-10-18-progression-design.md) §6.1, §6.2, §8, the weapon parts of §3 (natural attacks) and §7 (enemy weapons), and step 3 of §14. Plan 1: [2026-10-18-progression-1-attributes-and-sheet.md](2026-10-18-progression-1-attributes-and-sheet.md). Effect resistances: [2026-10-19-resistances.md](2026-10-19-resistances.md).

**Branch:** `feature/skill-tree-design`.

## Scope decisions (my calls, for the user's review)

1. **Equipment source:** `Progress` stays v1 until plan 4. `Member` carries an `Equipment`, and `lobby.rs` fills it with `Equipment::starter(class)`. Tests build heroes with other items.
2. **Not in this plan:**
   - `PropKind::GrantAbility` and `AbilityMod` go to plan 3 (they need the loadout pool).
   - `PropKind::Aura` goes to plan 4. An aura needs a per-tick area layer, and a max-HP aura needs a rule for HP when you walk in or out.
   - `Requirement::WeaponKind` goes to plan 3 (only abilities use it).
   - The melee rule and the unarmed strike for archers go to plan 3, together with the enemy staffs that only the melee rule uses.
   - Charge = weapon × 0.8 and the Great Axe's reach of 22 go to plan 3 (the ability merge), so this plan changes no numbers.
   - Drawing heroes with their equipped weapons and `DebugGrantItem` go to plan 4 (until then nobody can wear anything else).
   - Boss weapons are left out: their scripts keep their constants (spec §7).
3. **The weapon interval is stored in seconds** (`cooldown`), not attacks per second, so that calibration stays bit-exact. The UI shows `1 / cooldown`.
4. **`DamageShare` and `OnHit` are weapon-only properties.** They affect only that weapon's attacks (spec §6.2), and a data test refuses them on other items. Each item has at most one `OnHit`, because `Damage` carries one.
5. **Item requirements are checked against the Attributes without items** (class + race + shop + tree). This stops a ring that unlocks a staff that unlocks the ring, and it matches "a ring never raises prices".
6. **Armor proficiency is a maximum class:** Cloth < Light < Medium < Heavy, and a class can wear its maximum and everything lighter. Maximums: Wizard Cloth, Paladin Heavy, Barbarian Medium, Elven Ranger Light.
7. **Natural weapons are part of the body.** They never go into an equipment slot.
8. **When a slot is empty, the class starter is used:** an empty melee slot gives the starter melee weapon, and an empty ranged slot gives the Elven Ranger her starter bow. Today's CrossbowDagger needs both; plan 3 removes this.
9. **A hero carries the light of the item with the largest light radius**, if any item has one.

## Global Constraints

- Weapon kinds exactly as spec §6.1 (no `ThrowingKnives`). `category()` and `key_attr()` are exhaustive `match`es **with no `_ =>` arm** (the user requires this).
- Scaling per category:
  - Damage: Melee, Thrown and Natural by STR (`STR_DMG`); Finesse and Ranged by DEX (`DEX_DMG`).
  - Interval: always DEX (`DEX_SPEED`, via `Scaled::per`).
  - Arc: always DEX (`DEX_ARC`).
  - Range and projectile speed: STR (`STR_RANGE`).
  - Push and projectile radius do not scale.
- A weapon's numbers are its values at `At { str, dex }`: `Scaled { value, attr, pct, at: at.str or at.dex }`. A starter weapon's `At` is its class's start STR/DEX. An enemy weapon's `At` is its stat block's. A sample item's is `At::BASE` (10, 10).
- Every number at the starter equipment equals today's to the bit. **Both fingerprint tests stay unchanged**; nothing is re-recorded in this plan.
- Rings, shoes and belts carry only magical properties. `ItemDef.classes` is never empty.
- Never say "elemental"; say "damage-type effect". Never say "ability score".
- No new art and no client changes.
- Verify with `cd server && cargo test -- --skip export_bindings` inside the agent sandbox (the 55 ts-rs export tests cannot write `client/src/generated` there). Run the full `docker compose -f docker-compose.test.yml run --rm test` once at the end.

## Review Focus

1. **The game plays exactly like today with the starters.** This covers every hero ability number, every enemy attack, the melee splits, and both fingerprints. Pinned by `hero_sheet_reproduces_today` (Task 4), `enemy_attacks_reproduce_today` (Task 6) and Task 7's full run.
2. **A weapon's effect leaks onto an attack that does not use the weapon:** a flaming sword's heat on Holy Light, a Fireball, or the wolf's bite. Pinned by `weapon_effects_ride_only_on_weapon_attacks` (Task 5).
3. **Added damage shares push a split over 100 %** (a demon's claws with 20 % heat plus a +90 % heat share) and trip `DamageSplit::split`'s `debug_assert`. Pinned by `added_shares_are_scaled_down_to_fit` (Task 1).
4. **An item meets its own requirement through another item** (Ring of Insight +1 INT takes a Wizard from INT 13 to 14 for the Staff of Rot's INT 14). Pinned by `item_requirements_ignore_item_points` (Task 3).
5. **An empty or default `Equipment`** (old callers, `Equipment::default()`) panics, or leaves the Elven Ranger without a bow. Pinned by `empty_slots_fall_back_to_the_starters` (Task 4).

---

### Task 1: Weapon kinds, stats and resolution

**Files:**
- Create: `server/src/defs/weapons.rs`; add `pub mod weapons;` to `server/src/defs/mod.rs`
- Modify: `server/src/defs/damage.rs` (`DamageSplit::with_shares`)

**Interfaces:**
- Produces:
  - `listed_enum! { #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)] pub enum WeaponKind: u8 { Sword = 0, Axe, Hammer, Mace, Club, Spear, Staff, Dagger, DuellingSword, Katana, Machete, Bow, Longbow, Crossbow, ThrowingAxe, Unarmed, Bite, Claws, Tail } }`, with explicit ids 0..=18.
  - `#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum WeaponCategory { Melee, Finesse, Ranged, Thrown, Natural }`.
  - `pub fn category(k: WeaponKind) -> WeaponCategory`, mapped as in the spec §6.1 table.
  - `pub fn key_attr(c: WeaponCategory) -> Attr`.
  - `#[derive(Debug, Clone, Copy, PartialEq)] pub struct At { pub str: i32, pub dex: i32 }` with `pub const BASE: At = At { str: 10, dex: 10 }`.
  - `#[derive(Debug, Clone, Copy)] pub struct MeleeStats { pub damage: f64, pub cooldown: f64, pub arc: f64, pub push: f64, pub split: DamageSplit, pub at: At }`.
  - `#[derive(Debug, Clone, Copy)] pub struct RangedStats { pub damage: f64, pub cooldown: f64, pub range: f64, pub projectile_speed: f64, pub radius: f64, pub projectile: EntityKind, pub split: DamageSplit, pub at: At }`.
  - `#[derive(Debug, Clone, Copy, PartialEq)] pub struct ResolvedWeapon { pub kind: WeaponKind, pub damage: f64, pub cooldown: f64, pub arc: f64, pub push: f64, pub range: f64, pub projectile_speed: f64, pub radius: f64, pub projectile: Option<EntityKind>, pub split: DamageSplit, pub on_hit: Option<OnHit>, pub power: i32 }`. `power` is the wielder's key Attribute value. Fields that do not apply are 0 or `None`.
  - `pub fn resolve_melee(kind: WeaponKind, s: &MeleeStats, attrs: &Attributes) -> ResolvedWeapon` and `pub fn resolve_ranged(kind: WeaponKind, s: &RangedStats, attrs: &Attributes) -> ResolvedWeapon`. Both use the scaling rules from Global Constraints and return `on_hit: None`; the sheet adds properties.
  - In `damage.rs`: `pub fn with_shares(&self, add: &[(DamageType, f64)]) -> DamageSplit`. It keeps the non-physical base shares, adds `add`, and lets physical take whatever is left. If base non-physical plus added comes to more than 1, it scales only the added shares down until the total is exactly 1. It never calls `split` with more than 100 %.

- [ ] **Step 1: Write the failing tests** in `weapons.rs`:
  - `every_kind_has_its_category`: a table of all 19 `(kind, category)` pairs from spec §6.1, with `len == WeaponKind::COUNT`. `key_attr` is Str for Melee, Thrown and Natural, and Dex for Finesse and Ranged.
  - `a_weapon_is_exact_at_its_reference`: for `MeleeStats { damage: 20.0, cooldown: 0.45, arc: 1.75, push: 0.0, split: physical, at: At { str: 15, dex: 8 } }` at Attributes (15, 8, …), `damage == 20.0`, `cooldown == 0.45` and `arc == 1.75`, all with `assert_eq!`.
  - `strength_and_dexterity_move_the_right_numbers`:
    - The same sword at STR 17 has damage `20 × 1.35 / 1.25`. At DEX 10 it has cooldown `0.45 / (1.00 / 0.96)` and arc `1.75 × 1.00 / 0.94`.
    - A Finesse kind (`DuellingSword`) scales damage by DEX, not STR.
    - `RangedStats { damage 16, cooldown 0.7, range 260, projectile_speed 290, at (10, 15) }` at STR 12 has range `260 × 1.04` and projectile speed `290 × 1.04`, with damage unchanged.
    - `power` is the key Attribute value: 15 for the sword at STR 15, 15 for the bow at DEX 15.
  In `damage.rs`:
  - `shares_take_from_physical`: `physical().with_shares(&[(Heat, 0.25)])` gives Heat 0.25 and Physical 0.75.
  - `added_shares_are_scaled_down_to_fit`: `split(&[(Heat, 0.2)]).with_shares(&[(Heat, 0.9)])` sums to 1.0 within 1e-12, with Heat 1.0 and Physical 0.0. `split(&[(Magical, 0.6)]).with_shares(&[(Heat, 0.8)])` gives Magical 0.6 (the base is kept), Heat 0.4 and Physical 0.0.
- [ ] **Step 2: Run** `cargo test --lib weapons damage -- --skip export_bindings`. Expected: FAIL (the module is missing).
- [ ] **Step 3: Implement** what Produces lists.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** "Progression 2: weapon kinds, categories, stats and resolution"

### Task 2: Items

**Files:**
- Create: `server/src/defs/requirements.rs` and `server/src/defs/items.rs`; register both in `defs/mod.rs`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `requirements.rs`:
    - `#[derive(Debug, Clone, Copy, PartialEq)] pub enum Requirement { Attr(Attr, i32) }`. Plan 3 adds `WeaponKind`.
    - `pub fn met(&self, attrs: &Attributes) -> bool`.
  - `items.rs`:
    - `listed_enum! { … pub enum EquipSlot: u8 { Melee = 0, Ranged, OffHand, Armor, Ring1, Ring2, Shoes, Belt } }`.
    - `#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)] pub struct Equipment { pub slots: [Option<ItemId>; EquipSlot::COUNT] }` with `get(EquipSlot) -> Option<ItemId>`, and `with(EquipSlot, ItemId) -> Equipment`. (`Equipment::starter` comes in Task 3, with `ClassDef.starter`.)
    - `listed_enum! { #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)] pub enum ItemId: u16 { … } }`, with the ids in the table below.
    - `#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)] pub enum ArmorClass { Cloth, Light, Medium, Heavy }`.
    - `pub struct ArmorStats { pub class: ArmorClass, pub physical: f64, pub weight: f64 }`.
    - `pub enum ItemBase { Melee(WeaponKind, MeleeStats), Ranged(WeaponKind, RangedStats), Armor(ArmorStats), Ring, Shoes, Belt, Shield }`. `Shield` is reserved, and no item uses it.
    - `pub struct ItemProperty { pub kind: PropKind, pub magical: bool }`.
    - `pub enum PropKind { DamageShare(DamageType, f64), OnHit(OnHit), Light(LightKind), Resist(DamageType, f64), Attr(Attr, i32), EffectResist(EffectKind, f64), Weight(f64), MoveSpeed(f64), MaxHp(f64) }`. `MoveSpeed` is a fraction (0.05 = +5 %). `OnHit`'s `magical` and `power` are filled when the sheet is built, so the data writes `power: 0`.
    - `pub struct ItemDef { pub id: ItemId, pub name: &'static str, pub sprite: &'static str, pub base: ItemBase, pub classes: &'static [ClassId], pub req: &'static [Requirement], pub props: &'static [ItemProperty] }`. `sprite` is the atlas frame. It is `""` for armor, rings, shoes, belts and natural weapons.
    - `pub fn def(id: ItemId) -> ItemDef`, a `match` like the other `defs`.

**Item data.** All numbers are (my call), except the starters and enemy weapons, which copy today's numbers. Times are in seconds. `cls` means `ClassId::ALL` unless a class is named.

| Id | Base (kind) | Numbers at `At` | `At` | Sprite | Props · req · classes |
|---|---|---|---|---|---|
| RedStaff | Melee (Staff) | 6, 1.0, arc 1.6, push 0 | (8, 14) | weapon_red_magic_staff | · · Wizard |
| KnightSword | Melee (Sword) | 20, 0.45, 1.75, 0 | (15, 8) | weapon_knight_sword | · · all |
| GreatAxe | Melee (Axe) | 32, 0.8, 2.45, 0 | (15, 13) | weapon_double_axe | · · all |
| Rapier | Melee (DuellingSword) | 18, 0.35, 1.0, 0 | (10, 15) | weapon_duel_sword | · · all |
| ElvenBow | Ranged (Bow) | 16, 0.7, range 260, speed 290, radius 2, Bolt | (10, 15) | weapon_bow | · · ElvenRanger |
| EmberStaff | Melee (Staff) | 6, 1.0, 1.6, 0 | BASE | weapon_red_magic_staff | DamageShare(Heat, 0.25) mag, Light(Fire) mag · · Wizard |
| StaffOfRot | Melee (Staff) | 6, 1.0, 1.6, 0 | BASE | weapon_green_magic_staff | DamageShare(Poison, 0.3), OnHit(Poisoned, 3 s, 0.15) non-mag · INT 14 · Wizard |
| BoneStaff | Melee (Staff) | 7, 1.0, 1.6, 0 | BASE | weapon_lich_staff | Light(Magic) mag · INT 18 · Wizard |
| Knife | Melee (Dagger) | 14, 0.45, 1.2, 0 | BASE | weapon_knife | · · all |
| GoldenSword | Melee (Sword) | 22, 0.5, 1.8, 0 | BASE | weapon_golden_sword | Light(Holy) mag · · all |
| FlameTongue | Melee (Sword) | 18, 0.5, 1.75, 0 | BASE | weapon_red_gem_sword | DamageShare(Heat, 0.5) mag · STR 13 · all |
| ShortBow | Ranged (Bow) | 12, 0.77, 220, 260, 2, Bolt | BASE | weapon_bow | · · all |
| SilkRobe | Armor (Cloth, 0.05, weight 1) | | | "" | Resist(Magical, 0.10) mag |
| LeatherArmor | Armor (Light, 0.08, 2) | | | "" | |
| ChainMail | Armor (Medium, 0.15, 4) | | | "" | |
| PlateArmor | Armor (Heavy, 0.25, 7) | | | "" | |
| RingOfEmbers | Ring | | | "" | Resist(Heat, 0.15) mag |
| BandOfVigor | Ring | | | "" | Attr(Con, 1) mag |
| RingOfInsight | Ring | | | "" | Attr(Int, 1) mag |
| BootsOfHaste | Shoes | | | "" | MoveSpeed(0.05) mag |
| IronBoots | Shoes | | | "" | Weight(3.0) mag, MoveSpeed(−0.05) mag |
| GirdleOfWarding | Belt | | | "" | EffectResist(Blind, 1.0) mag, MaxHp(10) mag |
| GoblinBow | Ranged (Bow) | 6, 1.4, 140, 170, 3, Arrow | (8, 15) | weapon_bow | |
| RustySword | Melee (Sword) | 9, 1.0, 1.6, 0 | (12, 12) | weapon_rusty_sword | |
| SkeletonLongbow | Ranged (Longbow) | 7, 1.6, 150, 180, 3, Arrow | (10, 15) | weapon_bow_2 | |
| Cleaver | Melee (Axe) | 14, 1.2, 1.8, push 20 | (16, 12) | weapon_cleaver | |
| OrcBow | Ranged (Bow) | 10, 1.7, 150, 190, 3, Arrow | (14, 14) | weapon_bow | |
| SpikedClub | Melee (Club) | 18, 1.6, 2.0, push 28 | (19, 8) | weapon_baton_with_spikes | |
| MimicBite | Melee (Bite) | 13, 1.0, 1.0, 0 | (17, 12) | "" | |
| ImpClaws | Melee (Claws) | 6, 0.9, 1.6, 0, Heat 0.2 | (6, 17) | "" | |
| ChortClaws | Melee (Claws) | 9, 1.0, 1.6, push 14, Heat 0.2 | (14, 13) | "" | |
| UnarmedStrike | Melee (Unarmed) | 3, 1.0, 1.4, 0 | BASE | "" | |
| Bite | Melee (Bite) | 8, 1.0, 1.0, 0 | BASE | "" | |
| Claws | Melee (Claws) | 6, 0.8, 1.6, 0, Heat 0.2 | BASE | "" | |
| BeastBite | Melee (Bite) | 10, 0.9, 1.0, 0, Magical 0.2 | BASE | "" | |
| Tail | Melee (Tail) | 10, 1.25, 2.4, push 10 | BASE | "" | |

Enemy and natural items list `ClassId::ALL` in `classes`, so that the data test holds. The equip rules (Task 3) still refuse natural weapons. A hero can wield a Cleaver or Rusty Sword if proficient.

- [ ] **Step 1: Write the failing data tests** in `items.rs`:
  - `item_data_follows_the_rules`. For every `ItemId::ALL`:
    - `classes` is not empty.
    - A `Ring`, `Shoes` or `Belt` has only `magical: true` properties.
    - `DamageShare` and `OnHit` appear only on `Melee` or `Ranged` bases.
    - There is at most one `OnHit`.
    - No `DamageShare(Physical, _)` exists.
    - A `Melee` base has a kind whose category is Melee, Finesse or Natural, and a `Ranged` base has a kind whose category is Ranged or Thrown.
    - Every non-natural weapon has a non-empty sprite.
    - No item uses `Shield`.
  - `every_item_sprite_is_in_the_atlas`: read `CARGO_MANIFEST_DIR/../client/public/assets/atlas.json` (as `export.rs` finds its paths), and check that every non-empty `sprite` is a frame name in it.
  - `items_carry_the_listed_numbers`: spot checks `def(GreatAxe)` = `Melee(Axe, { 32.0, 0.8, 2.45, 0.0, physical, At { 15, 13 } })`, ImpClaws' heat share 0.2, and BeastBite's magical share 0.2.
  - `requirements_compare_the_attribute`: `Requirement::Attr(Int, 14).met(&(…INT 14…))` is true, and at INT 13 it is false.
- [ ] **Step 2: Run** `cargo test --lib items requirements -- --skip export_bindings`. Expected: FAIL.
- [ ] **Step 3: Implement** the types and the data.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** "Progression 2: item defs, slots and requirements"

### Task 3: Proficiencies, starters and the equip rules

**Files:**
- Modify: `server/src/defs/classes.rs` and `server/src/defs/items.rs`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - In `ClassDef`:
    - `pub weapons: &'static [WeaponKind]` (the proficient kinds, spec §6.3).
    - `pub max_armor: ArmorClass`.
    - `pub starter: (ItemId, Option<ItemId>)`: Wizard `(RedStaff, None)`, Paladin `(KnightSword, None)`, Barbarian `(GreatAxe, None)`, Elven Ranger `(Rapier, Some(ElvenBow))`.
    - Proficient weapons:
      - Wizard: Staff, Dagger.
      - Paladin: Sword, Mace, Hammer.
      - Barbarian: Axe, Hammer, Club, Sword, Spear, ThrowingAxe.
      - Elven Ranger: Dagger, DuellingSword, Machete, Bow, Crossbow.
  - `#[derive(Debug, Clone, Copy, PartialEq)] pub enum EquipError { WrongSlot, ClassNotListed, NotProficient, Requirement(Requirement) }`.
  - `pub fn check_equip(class: ClassId, slot: EquipSlot, item: ItemId, attrs: &Attributes) -> Result<(), EquipError>`. `attrs` is the Attributes **without item points** (scope decision 5). The slot rules:
    - Melee takes `Melee` bases, except natural kinds (WrongSlot).
    - Ranged takes `Ranged`.
    - Armor takes `Armor`.
    - Ring1 and Ring2 take `Ring`.
    - Shoes takes `Shoes`, and Belt takes `Belt`.
    - OffHand takes nothing yet.
    The checks run in this order: slot, class, proficiency (weapon kind, or armor class ≤ `max_armor`), then requirements.
  - `pub fn check_equipment(class: ClassId, e: &Equipment, attrs: &Attributes) -> Result<(), (EquipSlot, EquipError)>` checks every filled slot. Plan 4's `equip` reuses it.
  - `Equipment::starter(class)` fills Melee and, if the class has one, Ranged.

- [ ] **Step 1: Write the failing tests** in `items.rs`:
  - `starters_are_valid`: for every class, `check_equipment(c, &Equipment::starter(c), &start_attrs(c))` is Ok. The Elven Ranger's starter holds `ElvenBow` in Ranged.
  - `proficiency_gates_weapons_and_armor`:
    - The Wizard gets `NotProficient` for KnightSword and Ok for Knife.
    - The Paladin is Ok with PlateArmor. The Barbarian gets `NotProficient` for PlateArmor and Ok for ChainMail. The Elven Ranger gets `NotProficient` for ChainMail and Ok for LeatherArmor and SilkRobe.
    - The Barbarian is Ok with the Cleaver (Axe).
  - `slots_take_their_own_bases`:
    - A ring goes in Ring1 or Ring2, and in Shoes it gives `WrongSlot`.
    - `Claws` in Melee gives `WrongSlot` (natural weapons are part of the body).
    - Anything in OffHand gives `WrongSlot`.
    - ElvenBow in Melee gives `WrongSlot`.
  - `classes_restrict_items`: the Paladin gets `ClassNotListed` for StaffOfRot, and the Barbarian gets `ClassNotListed` for ElvenBow.
  - `item_requirements_ignore_item_points`: a Wizard at INT 13 (start 15, so pass `start_attrs` with INT −2 through `plus`) gets `Requirement(Attr(Int, 14))` for StaffOfRot, even when the equipment also holds RingOfInsight. `check_equipment` reports `(Melee, Requirement(..))`. At INT 14 it is Ok.
- [ ] **Step 2: Run** `cargo test --lib items classes -- --skip export_bindings`. Expected: FAIL.
- [ ] **Step 3: Implement** what Produces lists.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** "Progression 2: proficiencies, starter equipment, equip rules"

### Task 4: The sheet reads the equipment

**Files:**
- Modify: `server/src/sheet.rs` and `server/src/defs/abilities.rs`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `pub fn hero_sheet(class: ClassId, extra: Attributes, equip: &Equipment, up: &StatUpgrades) -> Sheet`.
  - `Sheet` changes:
    - `melee: DamageSplit` becomes `melee: ResolvedWeapon`.
    - New `ranged: Option<ResolvedWeapon>` and `light: Option<LightKind>`.
    - `attrs` = class + race + `extra` + item `Attr` points.
  - The order of the fold (spec §10), one exhaustive `match` over `PropKind` with no wildcard:
    1. `Attr` adds points.
    2. The armor base adds Physical resistance and weight.
    3. `Resist` and `EffectResist` add.
    4. `Weight` adds.
    5. `MoveSpeed` fractions are summed, and speed = CON-scaled speed × (1 + Σ) × the upgrade multiplier.
    6. `MaxHp` adds after the CON HP and before the upgrade's life multiplier.
    7. `Light`: the largest `lights::def(k).radius` wins.
    8. `DamageShare` and `OnHit` go only to their own weapon: the split is `stats.split.with_shares(shares)`, and the on-hit is `OnHit { magical: prop.magical, power: weapon.power, ..data }`.
  - Weapons:
    - `melee` = the Melee slot, or the class starter if the slot is empty.
    - `ranged` = the Ranged slot, else the class's starter ranged weapon (`None` for the three classes without one).
  - Abilities that read weapons (interim until plan 3):
    - `Sword` and `Axe` take `damage`, `cooldown` and `arc` from `melee`. Their range stays `ab::def(id).range`.
    - `CrossbowDagger` takes `damage`, `cooldown`, `range`, `speed` (= `projectile_speed`) and `radius` from `ranged`.
    - `fallback` (the rapier thrust) takes `damage` and `cooldown` from `melee`, with range `DAGGER_RANGE` and arc 0.
    - Dash keeps its own damage.
    - The old upgrades multiply after this, as today.
  - `abilities.rs`:
    - `scaling()` loses the Sword, Axe and CrossbowDagger rows, and `DAGGER_SCALING` is deleted. The `DAGGER_DAMAGE` and `DAGGER_COOLDOWN` constants are deleted (the Rapier holds them). `DAGGER_RANGE` stays.
    - New `pub fn uses_weapon(id: AbilityId) -> Option<EquipSlot>`: Sword, Axe and Dash give `Some(Melee)`, CrossbowDagger gives `Some(Ranged)`, and the others give `None`.
    - `governing(id)` returns `None` for the weapon abilities; their power is the weapon's `power`.

- [ ] **Step 1: Write the failing tests** in `sheet.rs`. Update the existing ones to pass `&Equipment::starter(c)`.
  - `hero_sheet_reproduces_today`:
    - It is unchanged and stays bit-exact.
    - The Elven Ranger's `fallback` equals the old literal, with `18.0` and `0.35` written out.
    - Add: `melee.split == DamageSplit::physical()` for every class, `light == None`, `res == classes::profile(c).res`, and the Elven Ranger's `ranged.unwrap().projectile == Some(EntityKind::Bolt)`.
  - `empty_slots_fall_back_to_the_starters`: `hero_sheet(c, default, &Equipment::default(), &default)` equals the starter sheet's primary, secondary, fallback and melee for every class.
  - `another_weapon_changes_the_strike`:
    - A Paladin with GoldenSword has primary damage `22 × factor(15, STR_DMG) / factor(10, STR_DMG)` = 27.5, cooldown `0.5 / (0.96 / 1.0)` and arc `1.8 × 0.94`, and `light == Some(Holy)`.
    - A Barbarian with KnightSword has damage 20.0 (same STR 15) and cooldown `0.45 / (1.06 / 0.96)`.
  - `armor_and_trinkets_fold_in`: a Paladin with PlateArmor, BandOfVigor, BootsOfHaste and GirdleOfWarding has:
    - `res.get(Physical) == 0.25`
    - `weight == 12 + 7`
    - `attrs.get(Con) == 14`
    - `max_hp == 125 + 10`
    - `speed == 66 × 1.04 / 1.03 × 1.05` within 1e-12
    - `effect_res.get(Blind) == 1.0`
    The same Paladin with IronBoots instead of BootsOfHaste has `weight == 12 + 7 + 3` and `speed == 66 × 1.04 / 1.03 × 0.95` within 1e-12 (one Shoes slot).
  - `weapon_properties_fill_split_and_on_hit`:
    - A Wizard with EmberStaff has melee split Heat 0.25 and `light == Some(Fire)`.
    - A Wizard at start with StaffOfRot (pass `extra` INT 0; the start INT 15 meets INT 14) has `melee.on_hit == Some(OnHit { kind: Poisoned, secs: 3.0, chance: 0.15, magical: false, power: 8 })`, where 8 is its STR (a Staff is a Melee weapon).
    - The Wizard's `primary` (Magic Missile) is unchanged by either staff.
- [ ] **Step 2: Run** `cargo test --lib sheet -- --skip export_bindings`. Expected: FAIL to compile.
- [ ] **Step 3: Implement**, and update every `hero_sheet` caller (`grep -rn hero_sheet server/src`) to pass `&Equipment::starter(class)` for now. Task 5 replaces that in `Run::new`.
- [ ] **Step 4: Run** the full suite. Expected: all pass, and both fingerprints are unchanged.
- [ ] **Step 5: Commit** "Progression 2: the sheet resolves weapons and folds in items"

### Task 5: Weapon effects ride on their attacks in the run

**Files:**
- Modify:
  - `server/src/run/mod.rs`: `Member` gains `equipment: Equipment`. `Run::new` passes it to `hero_sheet` and, if `sheet.light` is set, adds `run.add_light(k, Anchor::Entity(id), None)`. `Player.melee` is removed.
  - `server/src/run/entities.rs`: remove `Player.melee`.
  - `server/src/run/abilities.rs`:
    - `melee_arc`, `dash_contact` and the rapier thrust use `sheet.melee.split`, `.on_hit` and `.power`.
    - The bolt uses `sheet.ranged`'s split, on-hit and power.
    - `spawn_player_projectile` takes `split: DamageSplit` (spells pass `kind_split(kind)`).
    - `hero_power` reads the weapon for weapon abilities (`ab::uses_weapon`), and `ab::governing` otherwise.
  - `server/src/lobby.rs`: `equipment: Equipment::starter(ch.class)`.
  - The test helpers that build a `Member`.

**Interfaces:**
- Consumes: `Sheet.melee`, `Sheet.ranged`, `Sheet.light` and `ab::uses_weapon` (Task 4).
- Produces: `crate::run::test_run_with(classes: &[(ClassId, Equipment)], boss: BossId) -> Run` for tests. `test_run` calls it with the starters.

- [ ] **Step 1: Write the failing tests** in `run/abilities.rs`:
  - `weapon_effects_ride_only_on_weapon_attacks`:
    - A Paladin with FlameTongue (STR 15 meets STR 13) strikes an orc warrior (no resistances), which burns for `scaled_secs(def(Burning).duration, 15, 16)`.
    - The same Paladin's Holy Light, with an orc inside its radius, leaves the orc without effects.
    - A Barbarian with FlameTongue dashes through an orc warrior, and it burns.
    - A Wizard with EmberStaff casts Magic Missile: the projectile's split equals `kind_split(Missile)`.
    - An Elven Ranger whose `sheet.melee.split` is overridden to pure Heat in the test summons her wolf. The wolf's `melee` stays its race's (Magical 0.2), because the wolf never reads her weapon.
  - `a_flaming_sword_lights_a_torch`: a torch set off, and a FlameTongue Paladin swinging at it, so the torch turns on. A KnightSword swing turns a lit torch off (today's rule, `heat > 0`, unchanged).
  - `a_poisoned_blade_poisons_at_the_wielders_power`: a Wizard with StaffOfRot, its on-hit made certain by a test-only override (set `run.players[0].sheet.melee.on_hit` to `chance: 1.0`), hits a goblin with `melee_arc`. The goblin is Poisoned for `scaled_secs(3.0, 8, goblin CON 10)` (non-magical, so CON saves).
  - `an_items_light_follows_the_hero`: a Paladin with GoldenSword has a light anchored to their entity id in `run.lights`, and a starter Paladin has none.
  - `heavy_armor_is_pushed_less_and_resists`: a Paladin with PlateArmor takes `14 × 0.75` from an orc warrior's hit (compare HP before and after; no upgrades). It is also pushed `push_dist(20, 16, 19.0) == 0` px, while a starter Paladin is pushed `push_dist(20, 16, 12.0) == 20`.
- [ ] **Step 2: Run** `cargo test --lib weapon_effects a_flaming a_poisoned an_items_light heavy_armor -- --skip export_bindings`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite. Expected: all pass, and both fingerprints are unchanged.
- [ ] **Step 5: Commit** "Progression 2: weapon splits and effects only on that weapon's attacks; item lights; heroes run with their equipment"

### Task 6: Enemy weapons and natural attacks

**Files:**
- Modify:
  - `server/src/defs/races.rs`: `RaceDef.melee` becomes `natural: &'static [ItemId]`.
  - `server/src/defs/enemies.rs`: weapon ids, and attacks built from them.
  - `server/src/run/mod.rs`: `spawn_enemy` sets `melee` from the enemy's melee weapon.

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `RaceDef.natural`:
    - Human, Goblin, Orc, Ogre, Undead and Elf: `[UnarmedStrike]`.
    - Mimic: `[Bite]`. Demon: `[Claws]`. Dragon: `[Bite, Claws, Tail]`. Magical Beast: `[BeastBite]`. Object: `[]`.
  - `profile()`'s melee is the adjustment's, else the first race's first natural weapon's split, else physical. Boss `Adjust.melee` is unchanged.
  - `EnemyDef` gains `melee_weapon: Option<ItemId>` and `ranged_weapon: Option<ItemId>`:
    - Goblin archer: (None, GoblinBow).
    - Skeleton warrior and raised skeleton: (RustySword, None).
    - Skeleton archer and raised archer: (None, SkeletonLongbow).
    - Orc warrior: (Cleaver, None). Orc archer: (None, OrcBow).
    - Mimic: (MimicBite, None). Imp and summoned imp: (ImpClaws, None). Chort: (ChortClaws, None). Ogre: (SpikedClub, None).
    - Necromancer, summoner and disciple: (None, None). Their staffs come with the melee rule in plan 3.
  - `pub fn weapon_melee(id: ItemId, attrs: &Attributes, range: f64, windup: f64) -> AttackStyle`. It builds `Melee { range, damage, cooldown, windup, knock: push }` from `resolve_melee` at `attrs`. `range` and `windup` are body values from the stat block.
  - `pub fn weapon_ranged(id: ItemId, attrs: &Attributes, preferred: f64, windup: f64) -> AttackStyle` builds `Ranged { projectile, speed: projectile_speed, damage, cooldown, range, preferred, windup }`.
  - `enemies::def` builds each weapon `attack` and `alt` with these. The spell and innate bolts (necromancer, summoner, disciple, the imp's and chort's fire bolt) and the ogre's slam keep their literals.
  - `pub fn melee_split(t: EnemyType) -> DamageSplit` = the melee weapon's split, else `profile(t).melee`. `spawn_enemy` stores it in `Monster.melee`.

- [ ] **Step 1: Write the failing tests**:
  - In `enemies.rs`, `enemy_attacks_reproduce_today`: for every enemy, `def(t).attack` and `def(t).alt` equal today's literals, field by field with `assert_eq!`. Copy the literals into the test from the current `def` before changing it. Also, for every enemy with a ranged weapon, the weapon's split equals `kind_split(its projectile)`, because enemy shots still take `kind_split`.
  - In `enemies.rs`, `enemy_weapons_fit_their_proficiencies`: each `melee_weapon` and `ranged_weapon` kind is in the spec §7 proficiency list, or is natural. Write that list as a test table.
  - In `races.rs`:
    - `race_melee_comes_from_natural_weapons`: Demon's profile melee has Heat 0.2. Magical Beast's has Magical 0.2 and Physical 0.8. Human's is physical. Object's is physical (no natural weapon). The dragon boss still has Heat 0.2 through its `Adjust`.
    - Keep the existing melee assertions.
  - In `run/mod.rs`, `enemy_melee_splits_are_unchanged`: for every `EnemyType::ALL`, a spawned monster's `melee == profile(t).melee` as it is today. Record today's values in the test: Imp and Chort have Heat 0.2, and every other enemy is physical.
- [ ] **Step 2: Run** `cargo test --lib enemies races enemy_melee -- --skip export_bindings`. Expected: the new tests FAIL (missing functions).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite. Expected: all pass, and both fingerprints are unchanged.
- [ ] **Step 5: Commit** "Progression 2: enemies attack with their weapons; races carry natural attacks"

### Task 7: Docs, full verification

**Files:**
- Modify:
  - `docs/TECHNICAL.md`: in §11a, the weapons, items, equipment and the sheet fold. Add "How to add a weapon" and "How to add an item", each one `ItemDef` row, plus a new `WeaponKind` in `category()`.
  - `HANDOFF.md`: "Next session" says plan 2 is done, gives its commits, and says next is plan 3.
  - `docs/TODO.md`: priority 4 progress.
  - The spec's §14 step 3: a dated note that Aura, GrantAbility and the hero weapon drawing moved (scope decision 2).

- [ ] **Step 1: Run** `cd server && cargo test -- --skip export_bindings` and `cargo clippy --all-targets 2>&1 | grep -c warning`. Expected: all pass, and 0 new warnings compared with the plan's start commit.
- [ ] **Step 2: Run** `docker compose -f docker-compose.test.yml run --rm test` once outside the sandbox, if available. Expected: all pass, including the export tests. `git status` shows no changes in `client/src/generated`, because no exported type changed.
- [ ] **Step 3: Run** `cd client && npm run typecheck && npm test`. Expected: pass (no client changes; this guards the generated files).
- [ ] **Step 4: Smoke test**: run `docker compose up --build -d`, then play one class each briefly. Expected: attacks, the ranger's thrust and bolt, and the Barbarian's dash feel like before, with no browser errors.
- [ ] **Step 5: Commit** "Progression plan 2: docs" and push `feature/skill-tree-design`.
