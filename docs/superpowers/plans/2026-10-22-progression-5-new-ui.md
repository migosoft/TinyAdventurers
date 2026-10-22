# Progression 5: the New UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace everything before the dungeon (character select, lobby upgrades, the temporary "Character (temporary)" panel) with the screens of spec §13: roster, create, the character hub with four tabs (Sheet, Skill tree, Equipment, Loadout), and the runs list and waiting room with loadouts. Heroes are drawn in the run with their equipped weapons. The `?uidemo` spike is deleted.

**Architecture:** The server gets two additions. (1) Static texts for the screens are exported into `generated/progression.ts`: ability texts, categories and requirements, and item sprites, base numbers, properties and requirements. (2) Per-character data goes into `CharacterInfo.sheet.pool`: every ability the hero could pick, with its resolved numbers and why it is invalid. The client keeps no rules of its own beyond display. The DOM screens are plain TypeScript classes like today's `Lobby`. Pure helpers live in `ui/hub/model.ts` and carry the unit tests; the screens render from `CharacterInfo` and send `ClientMsg`s. `main.ts` routes roster → hub → runs list → waiting room → game.

**Tech Stack:** Rust (server, ts-rs, serde_json export), TypeScript + Vite + vitest (jsdom for DOM tests), Phaser 3 (in-run drawing), Playwright (`tools/e2e/smoke.mjs`).

**Spec:** [docs/superpowers/specs/2026-10-18-progression-design.md](../specs/2026-10-18-progression-design.md) §13 (with §12 for the protocol, §14 step 6, §15 "Client"). Screenshots of the spike: `docs/superpowers/specs/img/2026-10-18-progression/*.png`; the spike itself is `client/src/uidemo/` (read `index.ts` and `uidemo.css` before building a screen; they are deleted in Task 10).

## Global Constraints

- Login stays as it is (`ui/auth.ts` untouched).
- "Ability icons are placeholders (two letters on the main damage colour); the art rule stands: no self-made art without the user's go-ahead." Item icons are the item's atlas frame (`ItemDef.sprite`), or letters in a box when the sprite is `""` (armor, rings, shoes, belts).
- "An invalid choice shows red with the reason and a hint; 'To the dungeon' and Ready stay possible to click, the server refuses with the same reason (the client shows it)." The client never blocks a pick or Ready by its own rules.
- Build changes go over the WebSocket (`BuyAttribute`, `BuyNode`, `Respec`, `Equip`, `SetLoadout`, `DebugGrantItem`); the answer is a `Character` message (or an `Error`). The client keeps no optimistic state.
- `?debug` stays the only way to see debug controls (the Grant select, the waiting room's debug loadout row).
- No backwards compatibility on the client screens: `ui/characters.ts` and `ui/progressPanel.ts` are deleted, not kept beside the new ones.
- The run fingerprints (`level_setup_is_unchanged`, `simulation_is_unchanged_after_waking_the_boss`, `plan_3a_fight_is_pinned`) must pass unchanged. Nothing in this plan changes simulation numbers.
- Every task that changes exported data regenerates `client/src/generated` with the docker suite (`docker compose -f docker-compose.test.yml run --rm test`); `cargo test export_bindings` cannot write `client/src/generated` inside the agent sandbox.
- Verify commands (from HANDOFF): server `cd server && cargo test -- --skip export_bindings`; client `cd client && bash -lic 'npx vitest run && npx tsc --noEmit && npm run build'`; smoke `cd tools/e2e && BROWSER=/usr/bin/brave-browser node smoke.mjs http://localhost:8080/ "" shots ElvenRanger,Paladin` (and `Wizard,Barbarian`) after `docker compose up -d --build`.
- `cargo build` warning lines stay at 21 (the branch start).

## Rulings made for this plan (the agent's calls; listed for the user)

1. **The server sends the loadout pool** (`SheetSummary.pool: Vec<PoolCard>`), with each pick's numbers resolved for this hero and its error message. This replaces the client's `loadoutPool`. Locked tree abilities come as cards with `locked: true`, so the tree tooltip and the Loadout tab show real numbers for them too.
2. **Ability descriptions live on the server** (`abilities::text(id)`, exported to `progression.ts` as `ABILITY_INFO`), next to the category, the weapon use and the requirement texts. `ui/text.ts` `CLASS_TEXT` keeps only `title` and `blurb`.
3. **Item text comes from the server** (`items::base_text`, `items::prop_text`, exported to `ITEMS`). The client only lays it out.
4. **The flow:** clicking a roster card connects the WebSocket (once), selects the character and opens its hub on the Sheet tab. Create opens the new character's hub. "To the dungeon" opens the runs list. The runs list has "< Character" (back to the hub) in place of "Change character", and the hub has "< Roster".
5. **Equipment interactions:** clicking an inventory item equips it into its slot (a ring goes to the first empty ring slot, else Ring1). Clicking a worn item takes it off. Dragging an inventory item onto a slot equips it there, and dragging a worn item onto the inventory takes it off. The server decides; red items can still be tried, and the server's error is shown.
6. **The inventory grid** shows at least 20 cells and grows in rows of 5 to fit every item. Duplicates are separate cells.
7. **The waiting room's own-loadout picker** is two `<select>`s (primary and secondary) in your own party row. They list the non-locked pool cards of the slot, and an invalid one reads "Frost Nova (needs INT 17.)". They are shown while you are not Ready (the host: until the run starts).
8. **In the run:** `PlayerInfo` gets `melee: ItemId` (the worn melee weapon, or the class starter) and `ranged: ItemId | null`. Ranger-style figures (`attack: 'ranged'` in `anim/defs.ts`) hold the ranged weapon's sprite and thrust with the melee one. A ranger without a ranged weapon holds the melee sprite for both. Other classes hold the melee weapon's sprite, and their ranged weapon is not drawn on the figure (Hurl's projectile already is the throwing-axe frame). The mount (`blade`, `staff`, `bow`) stays the class's.
9. **Roster and hub figures** hold the equipped weapon by the same rule (`figureWeapon(info)`).

## Review Focus

1. **A late `Character` message for another character:** you open A's hub, go back to the roster and open B. A `Character` message for A that arrives now must not draw under B's header. `Hub.setCharacter` ignores an id other than the selected one (test in Task 4).
2. **An unrelated `Error` must not wipe typed input:** a server error while the run name or a select is half-filled. `Lobby.error` redraws only for a refused build change (leftover (b)). `Hub.error` never redraws, it only writes the line (tests in Tasks 4 and 8).
3. **Stale tooltips:** a `Character` message (or a tab switch) re-renders while a tooltip is open. Every render removes all `.ui-tip` elements from `document.body` first (test in Task 5).
4. **Many or duplicate items:** two Bands of Vigor, or 23 items, all show and each is clickable. The second ring equips to Ring2 while Ring1 is taken (test in Task 6, `slotForItem`).
5. **Connection lost while in the hub:** `net.onClose` must show its message on the hub too, not only in the lobby and the HUD (test-free; wired in Task 4 and checked in the smoke step, which closes nothing, so the reviewer checks the code path).

---

### Task 1: Server: texts for the screens in `progression.ts`

**Files:**
- Modify: `server/src/defs/abilities.rs` (add `pub fn text(id: AbilityId) -> &'static str`)
- Modify: `server/src/defs/items.rs` (add `pub fn base_text(b: &ItemBase) -> String`, `pub fn prop_text(p: &ItemProperty) -> String`; drop the `#[allow(dead_code)]` on `ItemDef` if `id`/`sprite` are now read)
- Modify: `server/src/sheet.rs` (make `prof_name` `pub`; add `pub fn item_prof(b: &ItemBase) -> Option<String>`)
- Modify: `server/src/export.rs` (`export_progression`: add `ABILITY_INFO`, extend `ITEMS`)
- Regenerate: `client/src/generated/progression.ts`

**Interfaces:**
- Produces in `progression.ts`:
  - `ABILITY_INFO: Record<AbilityId, { category: 'WeaponAttack'|'Technique'|'Spell'|'Innate'; uses: 'Melee'|'Ranged'|'Nothing'; req: string[]; text: string; tint: string | null }>`. `req` comes from `requirement_text`. `tint` is a `DamageType` name such as `"Heat"`, or null.
  - `ITEMS[id]` gains `sprite: string`, `kind: string` (`"Sword"`, `"Light armor"`, `"Ring"`, `"Shoes"`, `"Belt"`, `"Shield"`; weapon kinds spaced like `prof_name`), `prof: string | null` (the proficiency it needs, spelled exactly like `SheetSummary.profs`; null for rings, shoes, belts), `base: string`, `props: { text: string; magical: boolean }[]`, `req: string[]`.

- [ ] **Step 1: Write the failing tests** (in `items.rs` and `abilities.rs` test modules)

```rust
#[test]
fn item_texts_read_like_the_tooltip() {
    assert_eq!(base_text(&def(ItemId::KnightSword).base), "20 damage · every 0.45 s · arc 1.75");
    assert_eq!(base_text(&def(ItemId::WarHammer).base), "26 damage · every 1 s · arc 1.8 · push 24");
    assert_eq!(base_text(&def(ItemId::ElvenBow).base), "16 damage · every 0.7 s · range 260");
    assert_eq!(base_text(&def(ItemId::ChainMail).base), "Medium armor · +15 % physical resistance · weight 4");
    assert_eq!(base_text(&def(ItemId::BandOfVigor).base), "");
    let t = |id| def(id).props.iter().map(prop_text).collect::<Vec<_>>();
    assert_eq!(t(ItemId::EmberStaff), ["+25 % heat share", "Gives light (Fire)"]);
    assert_eq!(t(ItemId::BandOfVigor), ["+1 CON"]);
    assert_eq!(t(ItemId::IronBoots), ["Weight +3", "Move speed −5 %"]);
    assert_eq!(t(ItemId::GirdleOfWarding), ["Blind resistance +100 %", "+10 HP"]);
    assert_eq!(t(ItemId::RingOfEmbers), ["+15 % heat resistance"]);
    assert_eq!(t(ItemId::HuntersBow), ["Shots pass 2 enemies"]);
    assert_eq!(t(ItemId::RingOfTheMagus)[0], "Grants Magic Missile");
}

#[test]
fn every_ability_has_a_text() {
    for &id in AbilityId::ALL.iter() {
        assert!(!text(id).is_empty() && text(id).ends_with('.'), "{id:?}");
    }
}
```

Plus in `sheet.rs`: `assert_eq!(item_prof(&items::def(ItemId::Rapier).base).as_deref(), Some("Duelling Sword")); assert_eq!(item_prof(&items::def(ItemId::SilkRobe).base).as_deref(), Some("Cloth armor")); assert_eq!(item_prof(&items::def(ItemId::BandOfVigor).base), None);`

- [ ] **Step 2: Run them, expect compile errors** (`base_text`, `prop_text`, `text`, `item_prof` not defined): `cd server && cargo test --bin '*' texts -- --skip export_bindings`

- [ ] **Step 3: Implement**
  - Numbers print with Rust's shortest `{}` form for f64 (`1`, `0.45`). Percentages are rounded to whole numbers. The minus sign is `−` (U+2212), as in the spike.
  - `prop_text`:
    - `DamageShare(t, v)` → `"+{v%} % {type lowercase} share"`
    - `OnHit(h)` → `"On hit: {effect name}"`
    - `Light(k)` → `"Gives light ({k:?})"`
    - `Resist(t, v)` → `"+{v%} % {type lowercase} resistance"` (`−` when negative)
    - `Attr(a, n)` → `"+{n} {SHORT}"`
    - `EffectResist(k, v)` → `"{k:?} resistance +{v%} %"`
    - `Weight(w)` → `"Weight +{w}"`
    - `MoveSpeed(f)` → `"Move speed ±{f%} %"`
    - `MaxHp(hp)` → `"+{hp} HP"`
    - `GrantAbility { id, waive_attrs, .. }` → `"Grants {name}"`, plus `" (ignores its Attribute needs)"` when `waive_attrs`
    - `Pierce(n)` → `"Shots pass {n} enemies"`
  - `item_prof`: `ItemBase::Melee(k, _) | Ranged(k, _)` → `prof_name(Prof::Weapon(k))`; `Armor(a)` → `prof_name(Prof::Armor(a.class))`; others `None`.
  - `abilities::text`, one sentence each, matching PLAYER_GUIDE:

| Id | Text |
|---|---|
| MagicMissile | Fast arcane bolts. |
| Fireball | Explodes where it lands, hurting everything nearby. |
| Strike | A sweeping blow with your melee weapon. |
| HolyLight | Heals you and the allies close to you. |
| Charge | Dash toward the cursor, hitting everything in the way. |
| Shoot | Shoot your ranged weapon. In melee you strike with your melee weapon instead. |
| SummonWolf | Calls your Dire Wolf, or heals it while it lives. |
| FrostShard | A quick bolt, mostly cold, that chills what it hits. |
| ChainSpark | A bolt that jumps to up to two more enemies close by, weaker each time. |
| Judgement | A bolt of holy light. In melee you strike with your weapon instead. |
| Hurl | Throw an axe that spins as it flies. |
| Volley | Three arrows in a fan, each weaker. |
| Smite | A slow, hard swing with a holy part. |
| Whirl | A swing all the way around you, weaker and slower than a strike. |
| FlankingThrust | A thrust that does double damage from behind. |
| PoisonCoat | For a while your weapon attacks add poison and poison what they hit. |
| FrostNova | A ring of cold around you that hurts and freezes every enemy in sight. |
| WarCry | A shout that frightens the enemies close to you and speeds up you and your allies. |
| GroundSlam | Slam the ground after a short wind-up, hitting and pushing everything around you. |
| Haste | You and the allies close to you run faster for a while. |
| Purify | Clears bad effects from you and the allies close to you and wards you against curses for a moment. |
| Consecrate | Holy ground under your feet that hurts enemies standing in it. |
| Entangle | Vines grow where you aim and root the enemies in them. |

  - `export_progression`: `ABILITY_INFO` uses `serde_json` names (`format!("{:?}")`) for category and uses. Its `tint` follows three rules:
    - `"Physical"` when `uses != Nothing`;
    - else, when `own.damage > 0`, the `main_type()` name of `own.split.unwrap_or(kind_split(own.kind?))`;
    - else null.
  - `ITEMS` gets the new fields. `kind` is `item_prof(..)` for weapons and armor; for the rest it is the base's name: `"Ring"`, `"Shoes"`, `"Belt"` or `"Shield"`.

- [ ] **Step 4: Run** `cd server && cargo test -- --skip export_bindings`. Expect all to pass (617 + the new ones), fingerprints unchanged.
- [ ] **Step 5: Regenerate** with the docker suite. Expect all to pass, and `git diff --stat client/src/generated` to show only `progression.ts`. Then run client `npx tsc --noEmit` (still clean).
- [ ] **Step 6: Commit** `git commit -m "Progression 5: ability and item texts in progression.ts"`

---

### Task 2: Server: the loadout pool in the sheet, weapons in `PlayerInfo`

**Files:**
- Modify: `server/src/sheet.rs` (extract the `ability` closure of `hero_sheet` into a private fn; add `PoolCard`, `pool_cards`, `SheetSummary.pool`)
- Modify: `server/src/protocol.rs` (`PlayerInfo` gains `melee`, `ranged`)
- Modify: `server/src/run/mod.rs:338` (fill them from `q.build.equipment`, melee falling back to `classes::def(class).starter.0` as `lobby.rs:614` does)
- Regenerate: `client/src/generated/{SheetSummary,PoolCard,PlayerInfo}.ts`

**Interfaces:**
- Produces (Rust, ts-rs exported):

```rust
/// One ability the hero could put in a slot, for the Loadout tab and the tree tooltips.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct PoolCard {
    pub pick: Pick,
    /// Its numbers for this build (version mods and tree improvements applied); None when the weapon it uses is missing.
    pub ability: Option<ResolvedAbility>,
    /// Why it cannot play in its slot now (`LoadoutError::message`); None when it can.
    pub error: Option<String>,
    /// A tree unlock the hero does not own yet.
    pub locked: bool,
}
pub fn pool_cards(class: ClassId, b: &Build) -> Vec<PoolCard>;
```

- `SheetSummary.pool: Vec<PoolCard>`. Order: the class start primary, the class start secondary, `b.own`, owned tree unlocks in node order, item versions in `EquipSlot` order, then locked tree unlocks in node order. No duplicate `(ability, source)`.
- `PlayerInfo { ent, name, class, melee: ItemId, ranged: Option<ItemId> }` (TS: `melee: ItemId, ranged: ItemId | null`).

- [ ] **Step 1: Write the failing tests** (`sheet.rs` tests)

```rust
#[test]
fn the_start_pool_is_the_two_start_abilities() {
    let cards = pool_cards(ClassId::Wizard, &Build::start(ClassId::Wizard));
    let own: Vec<_> = cards.iter().filter(|c| !c.locked).map(|c| c.pick.ability).collect();
    assert_eq!(own, [AbilityId::MagicMissile, AbilityId::Fireball]);
    assert!(cards.iter().filter(|c| !c.locked).all(|c| c.error.is_none() && c.ability.is_some()));
    let mm = cards[0].ability.unwrap();
    assert_eq!(mm, hero_sheet(ClassId::Wizard, &Build::start(ClassId::Wizard)).unwrap().primary);
}

#[test]
fn locked_unlocks_come_with_numbers_and_a_reason() {
    let cards = pool_cards(ClassId::Wizard, &Build::start(ClassId::Wizard));
    let nova = cards.iter().find(|c| c.pick.ability == AbilityId::FrostNova).unwrap();
    assert!(nova.locked && nova.ability.is_some());
    assert_eq!(nova.error.as_deref(), Some("Frost Nova is not one of your abilities."));
}

#[test]
fn an_owned_unlock_with_a_missing_attribute_says_so() {
    // The Wizard node that unlocks Frost Nova, owned without INT 17.
    let mut b = Build::start(ClassId::Wizard);
    b.nodes = vec![NodeId::WF1, NodeId::WF2, NodeId::WF4]; // W0 → Frost Shard → its improvement → Frost Nova
    let nova = pool_cards(ClassId::Wizard, &b).into_iter().find(|c| c.pick.ability == AbilityId::FrostNova).unwrap();
    assert!(!nova.locked);
    assert_eq!(nova.error.as_deref(), Some("Frost Nova needs INT 17."));
}

#[test]
fn a_worn_granting_item_adds_its_version() {
    let mut b = Build::start(ClassId::Paladin);
    b.equipment.set(EquipSlot::Ring1, Some(ItemId::RingOfTheMagus));
    let cards = pool_cards(ClassId::Paladin, &b);
    assert!(cards.iter().any(|c| c.pick == Pick { ability: AbilityId::MagicMissile, source: Source::Item(EquipSlot::Ring1) } && !c.locked));
}

#[test]
fn shoot_without_a_ranged_weapon_has_no_numbers() {
    let mut b = Build::start(ClassId::ElvenRanger);
    b.equipment.set(EquipSlot::Ranged, None);
    let shoot = pool_cards(ClassId::ElvenRanger, &b).into_iter().find(|c| c.pick.ability == AbilityId::Shoot).unwrap();
    assert!(shoot.ability.is_none() && shoot.error.is_some());
}
```

`WF4` has its own `INT 17` requirement. `buy_node` would refuse it at INT 15, but the test sets `Build.nodes` directly, so the test stands. In `run/mod.rs` tests: a run started with `build_with(ClassId::Paladin, EquipSlot::Melee, ItemId::WarHammer)` sends `PlayerInfo.melee == WarHammer` and `ranged == None`; the Ranger's start gives `(Rapier, Some(ElvenBow))`.

- [ ] **Step 2: Run, expect compile errors** (`pool_cards`, `PoolCard`, `PlayerInfo.melee`).
- [ ] **Step 3: Implement.**
  - Extract the closure into `fn resolve_pick(class, b, slot, p, cx: &PickCx) -> Result<(ResolvedAbility, Vec<AbilityMod>), LoadoutError>`. `PickCx` holds `attrs`, `melee`, `ranged`, the tree gains, the keystones and `reach`.
  - `hero_sheet` calls it exactly as before, so the fingerprints stay unchanged.
  - `pool_cards` builds the `PickCx` the same way, from the build that `summary` falls back to (`used`). For each candidate it calls `resolve_pick`:
    - `Ok` → `ability: Some`, `error: None`.
    - `Err` → `error: Some(e.message())`, and `ability` from `resolve_ability` with the version's mods, ignoring the requirement check (`None` when that returns `None`).
    - Locked candidates take `pick_version`'s `NotInPool` error and resolve without mods.
  - `summary` sets `pool: pool_cards(class, &used)`.
- [ ] **Step 4: Run** the server suite (all pass, fingerprints unchanged).
- [ ] **Step 5: Regenerate** with the docker suite. The client then fails `tsc` where it builds `CharacterInfo` fixtures (`progressPanel.test.ts`, `lobby.test.ts`). Add `pool: []` to them and confirm `npx vitest run && npx tsc --noEmit` pass.
- [ ] **Step 6: Commit** `"Progression 5: the loadout pool in the sheet, weapons in PlayerInfo"`

---

### Task 3: Client: model helpers and icons

**Files:**
- Create: `client/src/ui/hub/model.ts`, `client/src/ui/hub/model.test.ts`
- Create: `client/src/ui/icons.ts`, `client/src/ui/icons.test.ts` (jsdom)
- Create: `client/src/ui/screens.css` (the spike's `uidemo.css` rules the real screens use, with the prefix `.ud-` renamed `.ui-`; imported once from `main.ts`)
- Modify: `client/src/ui/classes.ts` (`classFigure(atlas, c, scale, weapon?: string)`, `figureWeapon(info)`)

**Interfaces:**
- Produces (`ui/hub/model.ts`):
  - `type NodeState = 'owned' | 'buyable' | 'blocked' | 'locked'`
  - `nodeState(info: CharacterInfo, node: NodeId): NodeState` and `blockReason(info, node): string | null`. Move these from `progressPanel.ts`, with the class taken from `info.class`.
  - `unmetRequirements(info: CharacterInfo, req: readonly string[], withItems: boolean): { text: string; have: number }[]`. For `"INT 18"` with INT at 15 it gives `{ text: 'INT 18', have: 15 }`. With `withItems = false` it compares `total - items`. Requirements that are not Attribute requirements (`"a weapon of kind …"`) are never reported here.
  - `poolFor(info: CharacterInfo, slot: 'Primary' | 'Secondary'): PoolCard[]`: the cards of `info.sheet.pool` whose ability's `ABILITIES[..].slot` is `slot`, in pool order.
  - `samePick(a: Pick, b: Pick): boolean`
  - `pickLabel(p: Pick, info: CharacterInfo): string`: the ability name, plus `" (Ring of the Magus)"` for an item version (the item worn in that slot).
  - `fitsSlot(item: ItemId, slot: EquipSlot): boolean` (moved)
  - `slotForItem(info: CharacterInfo, item: ItemId): EquipSlot | null`: the slot a click equips into. A ring goes to the first empty of Ring1/Ring2, else Ring1. Null for an OffHand item.
  - `itemProblem(info: CharacterInfo, item: ItemId): string | null`, which returns the first problem found:
    - the class is not listed → `"Your class cannot use it."`
    - `prof` is not in `sheet.profs` → `"Not trained in {prof}."`
    - a requirement is unmet (without items) → `"Needs INT 14 (you have 12)."`
  - `attrEffect(attr: Attr, v: number): string`. The spike's `attrEffect` keyed by `Attr` (`'Str'`…).
  - `abilityNumbers(r: ResolvedAbility, uses: string): string`. Joined with `" · "`:
    - damage `"12 magical"`, or `"45: 70 % heat, 20 % magical, 10 % physical"` for a mixed split (shares by size, rounded %), or `"heal 35"` for Holy Light (`id === 'HolyLight'`); left out when 0;
    - `"cd 0.35 s"` when cooldown > 0;
    - `"range 220"` when ranged;
    - `"radius 38"` when > 0;
    - `"4 s"` when duration > 0;
    - `"pierces 2"` when pierce_through > 0.
  - `monogram(name: string): string`: `"Magic Missile"` → `"MM"`, `"Strike"` → `"ST"`.
- Produces (`ui/icons.ts`):
  - `itemIcon(atlas: Atlas, item: ItemId, box: number): HTMLElement`: the sprite frame scaled by the largest integer that fits `box`, else `<span class="ui-letter">` with the item's first two letters.
  - `abilityIcon(id: AbilityId, big?: boolean): string` (HTML `<span class="ui-ab t-{tint lowercase or none}">MM</span>`)
  - `figureWeapon(info: CharacterInfo): string`, in `classes.ts`. It is the sprite the figure holds (Ruling 8): for `ElvenRanger` the ranged item's sprite, else the melee sprite (the class starter when the slot is empty); `FIG[class][1]` when the sprite is `""`.

- [ ] **Step 1: Write the failing tests** in `model.test.ts`. Reuse and extend `fixtureInfo` from `progressPanel.test.ts`: move it to `ui/hub/fixture.ts` as `fixtureInfo(cls, o)`, with the options `id`, `name`, `xp`, `coins`, `respec_price`, `xp_spent`, `prices`, `nodes`, `slots` (a partial `EquipSlot → ItemId` map), `inventory`, `pool`, `profs`, `attrs` (partial `Attr → { total, items }`) and `loadout_error`. The `nodeState` tests keep their expectations, with the new `(info, node)` call.
  - `nodeState` cases (moved from `progressPanel.test.ts`, unchanged expectations).
  - `unmetRequirements(info, ['INT 18'], true)` gives `[{ text: 'INT 18', have: 15 }]` for a start Wizard. With a Ring of Insight worn (`items: 1`, total 16), `withItems: false` gives `have: 15` and `withItems: true` gives `have: 16`.
  - `slotForItem`: a Wizard with Ring1 empty gets `'Ring1'` for BandOfVigor. With Ring1 taken it gets `'Ring2'`; with both taken, `'Ring1'`. `'ChainMail'` gives `'Armor'`.
  - `itemProblem`: a Wizard and `'StaffOfRot'` (INT 14 needed, INT 15) give null; a Wizard and `'BoneStaff'` give `'Needs INT 18 (you have 15).'`; a Wizard and `'PlateArmor'` give `'Not trained in Heavy armor.'` (when `sheet.profs` lacks it); a Paladin and `'ElvenBow'` give `'Your class cannot use it.'`.
  - `abilityNumbers`: a Magic Missile-like `{ damage: 12, cooldown: 0.35, range: 220, ranged: true, radius: 3, split: { Magical: 1 } }` gives `'12 magical · cd 0.35 s · range 220 · radius 3'`. A Fireball split `{ Heat: 0.7, Magical: 0.2, Physical: 0.1 }`, damage 45, gives a string starting with `'45: 70 % heat, 20 % magical, 10 % physical'`.
  - `monogram`: `'Magic Missile'`→`'MM'`, `'Strike'`→`'ST'`, `'Flanking Thrust'`→`'FT'`.
  - `icons.test.ts` (jsdom, a fake atlas `{ img: new Image(), frames: { weapon_knight_sword: { frame: { x: 0, y: 0, w: 10, h: 21 } } } }`):
    - `itemIcon(atlas, 'KnightSword', 40)` is a canvas 10×1 by 21×1 (scale 1, since 21×2 > 40);
    - `itemIcon(atlas, 'ChainMail', 40).textContent === 'CH'`;
    - `abilityIcon('Fireball')` contains `t-heat`;
    - `figureWeapon` of a start Ranger is `'weapon_bow'`; for a Paladin with `WarHammer` worn it is `'weapon_hammer'`.
- [ ] **Step 2: Run** `cd client && npx vitest run src/ui/hub src/ui/icons.test.ts`. Expect FAIL: modules not found.
- [ ] **Step 3: Implement** the signatures above. `progressPanel.ts` imports `nodeState` and `fitsSlot` from `model.ts` until Task 8 deletes it. Its `loadoutPool` and its test are removed now in favour of `poolFor` (the panel's selects read `poolFor`).
- [ ] **Step 4: Run** the client suite (`vitest`, `tsc`, build). Expect all to pass.
- [ ] **Step 5: Commit** `"Progression 5: UI model helpers and icons"`

---

### Task 4: Client: roster, create, the hub shell with the Sheet tab, and the new flow

**Files:**
- Create: `client/src/ui/roster.ts`, `client/src/ui/create.ts`, `client/src/ui/hub/hub.ts`, `client/src/ui/hub/sheet.ts`, `client/src/ui/hub/tip.ts`, `client/src/ui/hub/hub.test.ts` (jsdom)
- Delete: `client/src/ui/characters.ts`
- Modify: `client/src/main.ts` (routing), `client/src/ui/classes.ts` (`classCard` reads `ABILITIES`/`ABILITY_INFO`), `client/src/ui/text.ts` (`CLASS_TEXT` keeps `title`, `blurb` only), `client/src/ui/lobby.ts` (the home's "Change character" becomes `< Character`, `id="to-hub"`, same callback renamed `onBackToHub`), `tools/e2e/smoke.mjs` (new selectors)

**Interfaces:**
- Consumes: Task 3's helpers and icons; `PoolCard`; `ABILITY_INFO`, `ATTRS`, `RESPEC` from `generated/progression`.
- Produces:
  - `class Roster { constructor(host, atlas, onOpen: (c: CharacterInfo) => void, onNew: () => void); show(me?: Me): Promise<void>; hide(): void }`. It has the account actions as today's `Characters`. Cards are `<button class="ui-char c-{class}" data-open="{name}">` with the figure (`figureWeapon`), name, class, `xp` and `total_xp`, and coins. The card `<button class="ui-char ui-new" id="new-char">` is shown while there is room (it reads "{n} slots left"). A "Delete" button sits on each card, outside the card button: the delete control is `<button class="danger" data-delete="{name}">`, using the same confirm and REST call as today.
  - `class Create { constructor(host, atlas, onCreated: (c: CharacterInfo) => void, onBack: () => void); show(): void; hide(): void }`. It has class cards `.ui-class.c-{class}` like the spike. Each shows the start Attributes (highest `hi`, lowest `lo`), HP, weight, speed, the starter weapons with icons, both start abilities with `abilityIcon` and `<kbd>LMB/RMB</kbd>`, and "Proficient with" (`CLASSES[c].weapons`, spaced). Below is `#char-name`, then `#char-create` reading "Create {Class}", then an `.error` line. All class data comes from `generated/defs` `CLASSES` and `progression` `ITEMS`/`ABILITY_INFO`.
  - `type HubTab = 'sheet' | 'tree' | 'equipment' | 'loadout'`
  - `type TabCtx = { info: CharacterInfo; atlas: Atlas; send: (m: ClientMsg) => void; debug: boolean }`
  - `class Hub { constructor(host, atlas, send: (m: ClientMsg) => void, onRoster: () => void, onDungeon: () => void); open(id: number): void /* shows "Loading…" until that id's Character message */; setCharacter(c: CharacterInfo): void; error(msg: string): void; show(): void; hide(): void; tab: HubTab }`
    - The header is `.ui-bar`: `#to-roster` "< Roster", the figure, name and class, `.ui-purse` with XP and coins, and `#to-dungeon` "To the dungeon".
    - The tabs are `.ui-tabs [data-tab]`, followed by one `.error` line under the tabs.
  - `renderSheet(ctx: TabCtx): HTMLElement` (`ui/hub/sheet.ts`). Every Attribute row has `data-attr` on its `+1 · {price} XP` button, disabled when `xp < price`. A click sends `BuyAttribute`. The panels are Derived, Resistances (`res` and `effect_res` as `%`), Proficiencies, Keystones (names spaced), and Respec. The Respec button is `#respec`, reading "Respec for {coin}{price}"; it is disabled when `coins < respec_price` or `xp_spent === 0`, and after a `confirm` it sends `Respec`.
  - `showTip(anchor: HTMLElement, html: string, place: 'left' | 'right' | 'below'): void` and `clearTips(): void` (`ui/hub/tip.ts`), the spike's `tip()` as a hover tooltip with the class `ui-tip`.
  - `main.ts`:
    - It creates `Roster`, `Create`, `Hub` and the session (`Net`, `Lobby`, Phaser) lazily on the first open.
    - `Character` messages go to both `hub.setCharacter` and `lobby.setCharacter`.
    - `Error` goes to whichever of hub and lobby is visible.
    - `net.onClose` also calls `hub.error(msg)`.

- [ ] **Step 1: Write the failing tests** (`hub.test.ts`, jsdom; fake atlas as in Task 3; a `send` spy)
  - `open(1)` then `setCharacter(fixtureInfo('Wizard', { id: 2 }))` still shows "Loading…". Then `setCharacter(fixtureInfo('Wizard', { id: 1, name: 'Merlin' }))` shows `Merlin` in `.ui-bar` (Review Focus 1).
  - On the Sheet tab, a Wizard with `xp: 300` and prices of 225 gets six enabled `[data-attr]` buttons; clicking DEX's sends `{ t: 'BuyAttribute', attr: 'Dex' }`. With `xp: 100` all six are disabled.
  - `#respec` is disabled with `coins: 10, respec_price: 20`.
  - `hub.error('Not enough XP.')` writes `.error` and keeps the same `.ui-body` element (no re-render; Review Focus 2).
  - Switching to `[data-tab="tree"]` keeps the tab after a new `setCharacter`.
  - `attrEffect` appears in the Attribute rows: the STR row of a start Paladin (STR 15) contains `"+25 %"`.
- [ ] **Step 2: Run** `npx vitest run src/ui/hub/hub.test.ts`. Expect FAIL: modules not found.
- [ ] **Step 3: Implement.**
  - The tree, Equipment and Loadout tabs render a `.panel` reading "Coming in this plan" until Tasks 5–7 replace them. The lobby keeps the temporary panel until Task 8.
  - Wire `main.ts` with this flow:
    1. login → `roster.show(me)`;
    2. a card → `ensureSession()`, `send SelectCharacter`, `hub.open(id)`;
    3. `#new-char` → `create.show()`;
    4. created → refresh `me`, then open it like a card;
    5. `#to-dungeon` → `hub.hide(); lobby.show()`;
    6. lobby `#to-hub` → `lobby.hide(); hub.show()`;
    7. `#to-roster` → `hub.hide(); roster.show()`.
  - Keep `session.net.connected` handling as today (reload when the socket died).
- [ ] **Step 4: Update `tools/e2e/smoke.mjs`:** `login` waits for `.ui-roster`. `player()` does these steps:
  1. click `#new-char`;
  2. fill `#char-name`;
  3. click `.ui-class.c-{cls}`;
  4. click `#char-create`;
  5. wait for `.ui-bar`, and screenshot `0-hub-sheet.png` for the first player;
  6. click `#to-dungeon` and wait for `#runname`.

  The third player (`p3`, the re-login) clicks `[data-open]` then `#to-dungeon`. Keep the `Character (temporary)` panel check (the panel is still on the lobby).
- [ ] **Step 5: Run** the client suite, then `docker compose up -d --build` and both smoke runs. Expect them to pass with no browser errors.
- [ ] **Step 6: Commit** `"Progression 5: roster, create, hub shell and Sheet tab"`

---

### Task 5: Client: the Skill tree tab

**Files:**
- Create: `client/src/ui/hub/tree.ts`, `client/src/ui/hub/tree.test.ts` (jsdom)
- Modify: `client/src/ui/hub/hub.ts` (route `tree`)

**Interfaces:**
- Consumes: `nodeState`, `blockReason`, `unmetRequirements`, `abilityNumbers`, `abilityIcon`, `showTip`/`clearTips`, `TREES`, `ABILITY_INFO`, `info.sheet.pool`.
- Produces:
  - `renderTree(ctx: TabCtx): HTMLElement`. The layout comes from the spike's `tree()`: the `pos` grid with `SPACE_X` 84 and `SPACE_Y` 58, `NODE_SIZE` per kind, SVG links with `lit` and `half`, and labels under Unlock and Keystone nodes. The legend panel and the small Attributes panel come from the spike too.
  - Each node is `<div class="ui-node k-{kind lowercase} {state}" data-node="{id}">`. The kinds are `start | attr | unlock | improve | proficiency | resist | keystone`, and `state` is the `NodeState`. A blocked node gets the class `unmet` when its reason is a requirement.
  - Unlock and Improve nodes show `monogram` of the ability. Attr nodes show the Attribute short. Resist nodes show `%`. Proficiency nodes show `P`. The start node shows the class figure.
  - Hover (`mouseenter`) shows the tooltip, which contains:
    - the name;
    - the kind line: `"New {slot} ability · {category}"` or `"Improves {ability name}"`, else the kind;
    - for an Unlock, the ability's `text` plus `abilityNumbers` of its pool card (`pick.ability === node.ability && source === 'Own'`);
    - for others, the node `text`;
    - one `li.ok`/`li.bad` per requirement, `"Needs INT 18"` plus `"(you have 15)"`, counting items;
    - `"Next to an owned node"` as ok/bad by the state;
    - the cost as `"{cost} XP"`, with the class `bad` when `xp < cost`.

    `mouseleave` calls `clearTips()`.
  - A click on a `buyable` node opens `confirm("Buy {name} for {cost} XP?")` and then sends `{ t: 'BuyNode', node }`. A click on another state does nothing.

- [ ] **Step 1: Write the failing tests**
  - A start Wizard with `xp: 1000` has `[data-node="W0"].owned`, and its neighbours are `.buyable`.
  - With `xp: 0`, those neighbours are `.blocked`.
  - Clicking a buyable node with `confirm` stubbed to `true` sends `BuyNode` with that id; stubbed to `false`, it sends nothing.
  - Clicking a `locked` node sends nothing.
  - `mouseenter` on the Frost Nova Unlock node (`WF4`), given a pool card with `ability: { damage: 22, split: { Cold: 1 }, … }`, puts a `.ui-tip` in `document.body`. The tip contains `"22 cold"` and `"Needs INT 17"`.
  - Rendering again (a new `setCharacter`) leaves zero `.ui-tip` elements (Review Focus 3).
  - Every one of the four classes renders without throwing, with one `.ui-node` per `TREES[c].nodes` entry.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `Hub.render` calls `clearTips()` first, for every tab.
- [ ] **Step 4: Run** the client suite. Expect it to pass.
- [ ] **Step 5: Commit** `"Progression 5: Skill tree tab"`

---

### Task 6: Client: the Equipment tab

**Files:**
- Create: `client/src/ui/hub/equipment.ts`, `client/src/ui/hub/equipment.test.ts` (jsdom)
- Modify: `client/src/ui/hub/hub.ts`

**Interfaces:**
- Consumes: `slotForItem`, `itemProblem`, `fitsSlot`, `itemIcon`, `showTip`, `ITEMS`.
- Produces:
  - `renderEquipment(ctx: TabCtx): HTMLElement`, laid out like the spike's `equipment()`:
    - **The paper doll:** the figure at scale 6 with `figureWeapon`, and the eight slots as `.ui-slot[data-slot="{EquipSlot}"]` in the spike's places. OffHand is `.reserved` and reads "shields later".
    - **The items line:** `"From items: …"`, which lists the `AttrLine.items` points (`+1 CON`) and the `props` texts of every worn non-weapon item, joined with `" · "`. It is left out when the list is empty.
    - **The inventory:** `.ui-cell[data-item="{id}"][data-index="{i}"]`, one per `info.inventory` entry. The grid fills to at least 20 cells and adds rows of 5 to fit. A cell gets `.bad` when `itemProblem` returns a reason.
  - **The tooltip** (hover on a worn slot or a cell) shows:
    - the name, and `kind` with `"· proficient"`, or the problem in red;
    - the `base` text;
    - each prop, with a `magical`/`non-magical` tag;
    - each requirement, as `ok`/`bad` without items, with `"(you have n)"`;
    - for a weapon that has a prop, the line "Weapon effects ride only on attacks that use the weapon."
  - **Clicks:**
    - a cell → `{ t: 'Equip', slot: slotForItem(info, id), item: id }`; nothing when `slotForItem` is null;
    - a filled slot → `{ t: 'Equip', slot, item: null }`.
  - **Drag:** cells and filled slots are `draggable`, with `dataTransfer` `"text/plain"` set to `item:{id}` or `slot:{EquipSlot}`.
    - Dropping `item:` on a slot sends `Equip(slot, id)`.
    - Dropping `slot:` on the inventory panel sends `Equip(slot, null)`.
    - Dropping `slot:` on another slot does nothing.
  - **Debug** (`ctx.debug`): a row `<select data-grant>` with every `ITEMS` entry that is `hero` and lists the class, plus `<button data-grant-go>`, which sends `DebugGrantItem`.

- [ ] **Step 1: Write the failing tests**
  - A Wizard with `inventory: ['BandOfVigor', 'BandOfVigor', 'BoneStaff']` and both rings empty:
    - shows three `[data-item]` cells and 20 `.ui-cell`;
    - the BoneStaff cell is `.bad`;
    - clicking the first band sends `Equip Ring1 BandOfVigor`.
  - With Ring1 filled, clicking a band sends `Ring2`.
  - With 23 inventory items there are 25 cells, and the 23rd is clickable (Review Focus 4).
  - Clicking `[data-slot="Melee"]` with the Red Staff worn sends `Equip Melee null`.
  - A synthetic `drop` event (`new Event('drop')` with a stub `dataTransfer.getData` returning `'item:RingOfEmbers'`) on `[data-slot="Ring2"]` sends `Equip Ring2 RingOfEmbers`.
  - `debug: false` shows no `[data-grant]`; with `debug: true`, Grant sends `DebugGrantItem`.
  - The tooltip of `StaffOfRot` contains `"+50 % poison share"` and `"non-magical"`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the client suite. Expect it to pass.
- [ ] **Step 5: Commit** `"Progression 5: Equipment tab"`

---

### Task 7: Client: the Loadout tab

**Files:**
- Create: `client/src/ui/hub/loadout.ts`, `client/src/ui/hub/loadout.test.ts` (jsdom)
- Modify: `client/src/ui/hub/hub.ts`

**Interfaces:**
- Consumes: `poolFor`, `samePick`, `pickLabel`, `abilityNumbers`, `abilityIcon`, `ABILITY_INFO`.
- Produces:
  - `renderLoadout(ctx: TabCtx): HTMLElement`: two columns, `<kbd>LMB</kbd> Primary ability` and `<kbd>RMB</kbd> Secondary ability`.
  - Each column has one `<button class="ui-abcard" data-pick='{JSON of pick}'>` per `poolFor` card. The classes are `selected` when it is the saved pick, `invalid` when `error` is set and the card is not locked, and `locked`.
  - The card body shows:
    - the icon and `pickLabel`;
    - `"{category} · {uses: 'melee weapon' | 'ranged weapon' | 'no weapon'}{ · ranged}"`;
    - the text and `abilityNumbers` (or "—" when `ability` is null);
    - a closing line: `"Unlock it in the skill tree"` (locked), the `error` in `.bad` (invalid), or `"Requires: {req joined}"`/`"Requires: none"`.
  - When the saved pick is not in the pool (Ruling 9 of plan 4), the column shows it first as `.selected.invalid`, reading "(unavailable)".
  - A click on a non-locked card sends `{ t: 'SetLoadout', primary, secondary }` with the other slot's saved pick.
  - Under the columns, when `sheet.loadout_error` is set, a `.ui-warn` panel reads `"Loadout invalid: {error}"` and gives the hint that matches the error:
    - `"needs XXX n"` → "Buy XXX on the Sheet, or wear an item that gives it.";
    - `"needs a … weapon"` or `"a weapon of kind"` → "Change the weapon on the Equipment tab.";
    - else nothing.

    It ends with "You cannot be Ready until it is fixed."
- [ ] **Step 1: Write the failing tests**
  - With a pool of `[MM Own ok, FB Own ok, FrostShard Own error "Frost Shard needs INT 14.", FrostNova locked]`:
    - the primary column has MM `.selected` and Frost Shard `.invalid`, containing "Frost Shard needs INT 14.";
    - the secondary column has Frost Nova `.locked`;
    - clicking Frost Shard sends `SetLoadout` with `primary: FrostShard Own` and `secondary: Fireball Own`;
    - clicking Frost Nova sends nothing.
  - With `loadout_error: 'Frost Shard needs INT 14.'`, `.ui-warn` contains "Buy INT on the Sheet".
  - An item version card (`source: { Item: 'Ring1' }`, Ring of the Magus worn) reads "Magic Missile (Ring of the Magus)".
  - A saved pick missing from the pool shows "(unavailable)".
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the client suite. Expect it to pass.
- [ ] **Step 5: Commit** `"Progression 5: Loadout tab"`

---

### Task 8: Client: runs list and waiting room; the temporary panel goes

**Files:**
- Modify: `client/src/ui/lobby.ts`, `client/src/ui/lobby.test.ts`
- Delete: `client/src/ui/progressPanel.ts`, `client/src/ui/progressPanel.test.ts`
- Modify: `tools/e2e/smoke.mjs` (drop the `Character (temporary)` check; add a waiting-room check)

**Interfaces:**
- Consumes: `poolFor`, `samePick`, `pickLabel`, `itemIcon`, `abilityIcon`.
- Produces:
  - **Home:** the hero panel keeps the figure (`figureWeapon`) and has `#to-hub` "< Character". No progress panel.
  - **Room rows:** `<li class="c-{class}{ me}">` holds the name (★ host), the class, `.wp` with an `itemIcon(…, 28)` per `p.weapons`, and the two abilities as `abilityIcon` + `<kbd>LMB/RMB</kbd>` + name, then the status.
    - In your own row, while you are not Ready (the host: always), the abilities are `<select data-own="Primary|Secondary">`. Their options are the non-locked `poolFor` cards, with the value set to the JSON pick and the label `pickLabel` plus `" (needs …)"` from `error`. A change sends `SetLoadout` with the other select's value.
    - `partyBuild` is deleted (the row shows icons and names instead).
  - **Leftover (a):** after the client sends `SetLoadout`, `debugPick` (when set) takes the new primary and secondary and `touched.loadout = false`. A new `debugPick` starts from `this.character.loadout`, not from `CLASSES[cls]` (weapons keep the starter default).
  - **Leftover (b):** `error(msg)` re-renders only when `isBuildRefusal(msg)` is true. `isBuildRefusal` is exported and true for `isDebugGuardError(msg)` or `BUILD_ERROR.test(msg)`. Otherwise it only writes `.error`.
- [ ] **Step 1: Write the failing tests** (`lobby.test.ts`, jsdom where DOM is needed)
  - `isBuildRefusal('Frost Shard needs INT 14.') === true`, `isBuildRefusal('Not while ready.') === true`, `isBuildRefusal('That run is full.') === false`.
  - A lobby on the home screen with `#runname` filled with "abc", after `error('That run is full.')`, still has "abc" in `#runname` (Review Focus 2).
  - A room with you not Ready shows two `[data-own]` selects. Changing primary sends `SetLoadout` with the secondary's saved pick. With you Ready there are no selects.
  - After a `SetLoadout` with `?debug`, the debug row's primary select shows the new primary.
  - The other rows show one `.wp canvas` or `.ui-letter` per weapon.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement**, and delete `progressPanel.*`. `fixtureInfo` already lives in `ui/hub/fixture.ts` (Task 3).
- [ ] **Step 4: Update the smoke test.** Remove the temporary-panel check. In the room, check that `p2` sees `[data-own="Primary"]` before `#ready` and none after. Print `waiting room: own loadout picker shown`.
- [ ] **Step 5: Run** the client suite, rebuild the containers, and run both smoke runs. Expect them to pass, with correction 0.00 px and no browser errors.
- [ ] **Step 6: Commit** `"Progression 5: waiting room with loadouts, temporary panel removed"`

---

### Task 9: Client: heroes drawn with their equipped weapons

**Files:**
- Modify: `client/src/game/anim/defs.ts` (add `heroWeapons`), `client/src/game/anim/EntityView.ts` (optional override), `client/src/game/GameScene.ts:820` (pass it)
- Test: `client/src/game/anim/defs.test.ts` (create, or add to an existing anim test)

**Interfaces:**
- Consumes: `PlayerInfo.melee`, `PlayerInfo.ranged` (Task 2), `ITEMS[..].sprite` (Task 1).
- Produces:
  - `heroWeapons(d: FigureDef, melee: ItemId, ranged: ItemId | null): Pick<FigureDef, 'weapon' | 'meleeWeapon'>` (Ruling 8). A sprite `""` keeps the def's frame.
  - `EntityView` constructor gains a last optional parameter, `weapons?: Pick<FigureDef, 'weapon' | 'meleeWeapon'>`, merged over the kind's def for this view only (`{ ...FIGURES[kind], ...weapons }`; the shared `FIGURES` entry is never mutated).
  - `GameScene` passes `heroWeapons(FIGURES[e.kind], p.melee, p.ranged)` for player kinds, using the `PlayerInfo` found by `ent`. Other kinds pass nothing.
- [ ] **Step 1: Write the failing tests**
  - `heroWeapons(FIGURES[KIND.Paladin], 'WarHammer', null)` gives `{ weapon: 'weapon_hammer', meleeWeapon: undefined }`.
  - The Ranger with `('Knife', 'HuntersBow')` gives `{ weapon: 'weapon_bow', meleeWeapon: 'weapon_knife' }`; with `('Rapier', null)` it gives `{ weapon: 'weapon_duel_sword', meleeWeapon: 'weapon_duel_sword' }`.
  - `heroWeapons(FIGURES[KIND.Wizard], 'RedStaff', null).weapon === 'weapon_red_magic_staff'`.
  - After every call, `FIGURES[KIND.Paladin].weapon` is still `'weapon_knight_sword'`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the client suite and both smoke runs. Expect them to pass. Add a smoke screenshot `3-weapons.png` of the start; it needs no assertion beyond no errors, and the browser check is the user's.
- [ ] **Step 5: Commit** `"Progression 5: heroes hold their equipped weapons"`

---

### Task 10: Delete the spike; e2e shots of the real screens; docs

**Files:**
- Delete: `client/src/uidemo/` (all four files), `tools/e2e/ui-shots.mjs`
- Modify: `client/src/main.ts` (remove the `?uidemo` hook and its comment)
- Modify: `tools/e2e/smoke.mjs`: for the first player, after the Sheet shot, click each `[data-tab]` and save `0-hub-tree.png`, `0-hub-equipment.png` and `0-hub-loadout.png`. Also add a check that `.ui-node.owned` exists on the tree tab, printing `hub: four tabs shown`.
- Modify: `docs/TECHNICAL.md` (§11a: "The character screens" with the flow, the files, `PoolCard`, the export of texts; the "Debug" part says a real `SetLoadout` replaces the debug picks, which is leftover (c)), `server/src/lobby.rs` (the `Conn.loadout` doc comment says the same), `docs/PLAYER_GUIDE.md` ("XP, coins and the character": the roster, the hub tabs, how to equip by click or drag, the waiting-room picker), `docs/TODO.md` (close the "Plan 5, the new UI" follow-up, keeping leftover (d) as its own line; add "Plan 5 follow-ups" for anything the reviews leave), `README.md` (if it mentions the character screen), the spec's line 7 (a dated note: the spike was deleted in plan 5 and the tables stay as printed), `HANDOFF.md` ("Next session")

- [ ] **Step 1: Delete the spike.** Then `grep -rn "uidemo\|ui-shots" client/src tools docs README.md` must find only the spec and plan history.
- [ ] **Step 2: Run** the client suite (`vitest`, `tsc`, build), the server suite, and the docker suite. `git status client/src/generated` must be clean afterwards.
- [ ] **Step 3: Rebuild** the containers and run both smoke runs. Expect them to pass with the four hub shots, correction 0.00 px and no browser errors.
- [ ] **Step 4: Write the docs.**
- [ ] **Step 5: Commit** `"Progression 5: spike removed, docs"`

**Browser checks for the user** (put these in HANDOFF; the smoke test only sees that the screens appear):
- the roster cards and figures;
- creating a character and landing in its hub;
- every Attribute button and its rising price;
- buying a node after its confirm, and the tooltip's red "you have";
- equipping by click and by drag, plus taking an item off;
- a red inventory item's tooltip reason;
- an invalid loadout card and the warning hint;
- the waiting-room picker before and after Ready;
- your own and others' heroes holding their equipped weapons in the run.
