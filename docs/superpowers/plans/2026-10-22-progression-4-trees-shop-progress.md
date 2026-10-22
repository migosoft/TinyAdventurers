# Progression 4: Skill Trees, Attribute Shop, `Progress` v2, Respec, Protocol — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five XP stat upgrades with the character build of the spec: an Attribute shop, one skill tree per class (with its keystones), saved equipment, an inventory and a loadout in `Progress` v2, a coin respec, the new protocol messages, and a plain stopgap client panel to use all of it until plan 5's real UI.

**Architecture:** The trees are static data in a new `defs/trees.rs`; `sheet::hero_sheet` folds the owned nodes into a `Build` (Attribute points, proficiencies, resistances, unlocked abilities, improvements of the equipped abilities, static keystones). Run-time keystones (the ones that depend on the target or the hero's HP) live in a new `run/keystones.rs`, called from `hurt_monster`/`hurt_player` and the cooldown code, and show in the rules log as a `Mult`. `Progress` v2 is the stored source of the `Build`; every change goes through one `Progress::apply(class, Change)` under the existing row lock (`db::update_progress`).

**Tech Stack:** Rust (axum, sqlx/Postgres JSONB, serde, ts-rs), TypeScript client (Vite, vitest), MessagePack protocol.

**Spec:** [docs/superpowers/specs/2026-10-18-progression-design.md](../specs/2026-10-18-progression-design.md) — §2 (growth), §9 (trees), §10 (sheet, validation), §11 (`Progress` v2), §12 (protocol), §15 (tests), plus "Changes decided on 2026-10-21" (no chance; Deep Winter, Juggernaut, Deadeye read Chilled/Entangled; Biting Cold is +20 % damage). Carry-overs from [HANDOFF.md](../../../HANDOFF.md) ("Plan 3b … Carry-overs that still apply").

**Not in this plan** (plan 5 or later): the real UI (roster, create, hub tabs, tree graph, paper doll), drawing heroes with their equipped weapons, `PropKind::Aura`, deleting the `?uidemo` spike, item sources.

## Global Constraints

- Shop price of the next point: `(100 + 25 × max(0, current − 10)) × ATTR_WEIGHT[attr]`, rounded; `current` = class + race + shop + tree, **without items**. `ATTR_WEIGHT = [Str 1.0, Dex 1.25, Con 1.0, Int 1.0, Wil 0.8, Cha 1.0]` (`attributes::attr_price` already exists; remove its `#[allow(dead_code)]`).
- Tree nodes cost XP directly; no levels, no skill points. A node needs: its own class, not owned yet, at least one owned neighbour (links are undirected; the start node is always owned), its requirements met with **Attributes including items**, enough XP.
- Weapon requirements never block buying a node; they only block **using** the ability (loadout validation).
- Improvement nodes work only while that ability is equipped. Never on the melee-rule fallback strike.
- Respec costs `20 + floor(xp_spent / 50)` coins, refunds all XP spent on shop and tree (`xp_spent`), resets `bought` and `nodes`, sets the loadout to the class start; items stay.
- `CURRENT_VERSION = 2`. v1 → v2: `xp += Σ upgrade_cost(level)` over every bought level of every stat (`upgrade_cost(l) = 100 + 75 × l`, levels capped at the old `MAX_LEVEL` 10), `xp_spent` stays 0, `equipment` = class starters, `loadout` = class start. No SQL migration.
- `StatUpgrades`, `UpgradeStat`, `Modifiers`, `upgrade_cost`, `cost_table`, `MAX_LEVEL`, `Sheet.armor`, `Build.upgrades` and `ClientMsg::BuyUpgrade` are removed (the refund keeps a private copy of `upgrade_cost`).
- Messages the player reads are plain English sentences ending with a full stop, like the existing ones ("Not enough XP.").
- User's build rules: implementers and fixers on Sonnet, task reviews and the final review on Opus. Every task that changes an exported type regenerates `client/src/generated` with the docker suite (`docker compose -f docker-compose.test.yml run --rm test`) and commits the result.
- Verify commands: `cd server && cargo test -- --skip export_bindings` (focused: `cargo test --bin '*' <filter> -- --skip export_bindings`); client `cd client && bash -lic 'npx vitest run && npx tsc --noEmit && npm run build'`.
- The fingerprint tests (`level_setup_is_unchanged`, `simulation_is_unchanged_after_waking_the_boss`, `plan_3a_fight_is_pinned` and their `_with_the_log_on` twins) must pass **unchanged**: a start build with no nodes plays exactly as before.
- The rules log's boundary tests (counted hook lines, server and client) must stay green; if a task adds a `rules_log::` call it updates the count in the same commit and says so.

### Rulings made for this plan (the agent's calls; the user may veto any)

1. **Improvements apply to the equipped version from either source** (own pool or an item's version): the hero's training goes with the ability. They stack with the item's mods by the same add-then-multiply rule.
2. **Unbreakable** ("your CON counts +4 for every save"): +4 to CON whenever CON is the save; HP, speed and prices do not change.
3. **Run-time keystones count the hero's own hits**: every hit that is not from an effect tick and whose `why.by` is the hero's entity id (abilities, the fallback strike, the hero's hazards). The wolf's bites are not "you".
4. **Pyromancer and Deep Winter scale by the type's share**: "+20 % heat damage" = the hit × `(1 + 0.2 × heat share)`; Pyromancer's "−20 % cold" = × `(1 − 0.2 × cold share)` (both in one factor); Deep Winter = × `(1 + 0.2 × cold share)` on a Chilled or Frozen target.
5. **Berserker**: active while `hp < 0.5 × max_hp`; damage ×1.25; a cooldown started while berserk is divided by 1.25; every resistance −0.10 (also below 0). The client learns the cooldown factor from `SelfState.cd_mul`.
6. **Deadeye** "ranged hits": hits of an ability whose def has `ranged: true`; targets with Slowed, Chilled, Entangled or Sleep.
7. **Radiant**: "innate abilities" = abilities of category `Innate`; Undead or Demon = the target's races include `Race::Undead` or `Race::Demon`. Its light is a new `LightKind::Radiant` (radius 2, colour `0xffe890`, intensity 0.6, flicker 0.05).
8. **Build changes** (buy, respec, equip, loadout, grant) are refused during a run ("Not during a run.") and while Ready ("Not while ready."); allowed in the lobby and in a waiting room otherwise.
9. **`SetLoadout` stores any pick whose ability fits its slot** (wrong slot is refused at once); everything else (locked, missing weapon, requirement) is shown by `sheet.loadout_error` and refused on Ready and Start, as the spec's Loadout tab wants.
10. **Equip** moves items between the inventory and a slot: equipping takes one copy out of the inventory and puts the slot's old item back; `item: None` moves the slot's item to the inventory. Starters are ordinary items. An empty Melee slot still plays with the class starter (as today).
11. **Respec unequips** every item that no longer passes `check_equip` (a proficiency or Attribute from the tree is gone) into the inventory.
12. **Unknown ids in a stored document** (a renamed node or item) are dropped while reading, with a `tracing::warn!`; the rest of the document stays. A whole-document parse failure must never come from one stale id.
13. **The debug flag stays** (the user, 2026-10-22): `DebugLoadout` and `DebugEquip` keep today's behaviour (whole class pool, Attribute lift, a debug run banks nothing), now on top of the character's real build. `DebugGrantItem { item }` (debug servers only) puts a copy of a hero item into the inventory, saved.
14. **Admin statistics**: "upgrades bought" becomes "tree nodes bought" (`jsonb_array_length` of `progress->'nodes'`).

## Review Focus

1. **A stored document with one unknown node or item id** (a node renamed in a later plan) must keep the character's XP, coins and everything else; only the unknown id goes. → Task 5, `stale_ids_are_dropped_not_the_document`.
2. **Reading a v2 document twice never refunds twice**, and a v1 document with odd levels (missing stats, a level above 10, a string) refunds only valid levels and never panics. → Task 5, `v1_refund_is_exact_and_happens_once`, `odd_v1_documents_refund_what_they_can`.
3. **An item version in the loadout whose item was unequipped** shows `loadout_error` and is refused on Ready, without breaking the Character message or the party list. → Task 6, `unequipping_a_granting_item_reports_the_loadout`.
4. **Respec with tree-only proficiency in use** (a Barbarian in plate armor after Heavy Armor) leaves a valid, playable build. → Task 5, `respec_unequips_what_no_longer_fits`.
5. **Berserker at exactly half HP and the client's cooldown prediction**: at `hp == 0.5 × max_hp` not berserk; the predicted cooldown matches the server's while berserk (no rubber-banding of the cooldown bar). → Task 4, `berserker_starts_below_half_hp`, and the client test in Task 4.

---

## File map

- Create `server/src/defs/trees.rs`: `NodeId`, `NodeKind`, `NodeDef`, `Prof`, `Keystone`, `KeystoneSet`, `TreeGains`, the four trees, `gains`, `neighbours`, `check_buy`.
- Create `server/src/run/keystones.rs`: run-time keystone factors.
- Modify `server/src/defs/mod.rs` (declare `trees`), `defs/items.rs` (proficiency from nodes; `Equipment` serde), `defs/loadout.rs` (`Build`, `Loadout` serde), `defs/damage.rs` (`upgrade_mult` → `keystone_mult`, `Mult::Keystone`), `defs/lights.rs` (`Radiant`), `defs/classes.rs` (`prof_base`), `defs/progression.rs` (remove upgrades), `sheet.rs`, `progress.rs`, `protocol.rs`, `wire.rs`, `lobby.rs`, `main.rs`, `db.rs`, `stats.rs`, `export.rs`, `run/mod.rs`, `run/abilities.rs`, `run/effects.rs`, `run/companion.rs`, `run/entities.rs`, `run/rules_log/text.rs`.
- Client: `client/src/ui/lobby.ts`, new `client/src/ui/progressPanel.ts` (+ `progressPanel.test.ts`), `client/src/ui/text.ts`, `client/src/ui/hud.ts`, `client/src/net/unpack.ts` (or wherever `SelfW` is unpacked), `client/src/game/GameScene.ts` (`cd_mul`), `client/src/admin/main.ts`, generated files.
- Docs: `docs/TECHNICAL.md` §11a/§11d, `docs/PLAYER_GUIDE.md`, `docs/TODO.md`, `HANDOFF.md`.

---

### Task 1: The trees as data (`defs/trees.rs`)

**Files:**
- Create: `server/src/defs/trees.rs`
- Modify: `server/src/defs/mod.rs`

**Interfaces:**
- Consumes: `AbilityId`, `AbilityMod` (`defs/loadout.rs`), `Requirement`, `Attr`, `DamageType`, `WeaponKind`, `ArmorClass`, `OnHit`, `EffectKind`, `EffectLook`, `ClassId`, `listed_enum!`.
- Produces:
  - `listed_enum! NodeId: u16` — one variant per node, named from the spec id without underscores, upper case: `W0, WA1, WA2, WA3, WA4, WA5, WF1 … WF6, WR1 … WR5, WB1 … WB6, P0, PU1 … PU5, PL1 … PL5, PR1 … PR5, PD1 … PD4, B0, BU1 … BU5, BL1 … BL5, BR1 … BR5, BD1 … BD5, E0, EU1 … EU5, EL1 … EL5, ER1 … ER4, ED1 … ED4` (ids 0.. in that order). Derives `Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS` with `#[ts(export)]`.
  - `pub enum Prof { Weapon(WeaponKind), Armor(ArmorClass) }`
  - `listed_enum! Keystone: u8 { ArcaneOverflow, DeepWinter, Pyromancer, Radiant, Unshaken, Bulwark, Berserker, Juggernaut, Unbreakable, PackHunter, Deadeye, Venomancer }` (Serialize, TS export).
  - `#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)] pub struct KeystoneSet(u16)` with `insert(Keystone)`, `has(Keystone) -> bool`, `iter() -> impl Iterator<Item = Keystone>`.
  - `pub enum NodeKind { Start, Attr(Attr, i32), Unlock(AbilityId), Improve(AbilityId, AbilityMod), Proficiency(Prof), Resist(DamageType, f64), Keystone(Keystone) }`
  - `pub struct NodeDef { pub id: NodeId, pub class: ClassId, pub pos: (i8, i8), pub kind: NodeKind, pub name: &'static str, pub text: &'static str, pub cost: u32, pub req: &'static [Requirement], pub links: &'static [NodeId] }` — `text` is the spec's "Effect" column verbatim (without the "(2026-10-21…)" notes).
  - `pub fn def(id: NodeId) -> NodeDef`, `pub fn start(class: ClassId) -> NodeId`, `pub fn tree(class: ClassId) -> Vec<NodeDef>`, `pub fn neighbours(id: NodeId) -> Vec<NodeId>` (its own `links` plus every node linking to it).
  - `pub struct TreeGains { pub attrs: Attributes, pub profs: Vec<Prof>, pub res: Vec<(DamageType, f64)>, pub unlocks: Vec<AbilityId>, pub improves: Vec<(AbilityId, AbilityMod)>, pub keystones: KeystoneSet }` and `pub fn gains(nodes: &[NodeId]) -> TreeGains`.
  - `pub fn check_buy(class: ClassId, owned: &[NodeId], node: NodeId, attrs_with_items: &Attributes) -> Result<(), &'static str>` — errors, checked in this order: `"That node is not in your tree."`, `"You already have that node."` (also for the start node), `"Buy a neighbouring node first."`, `"A requirement of that node is not met."`. XP is checked by `Progress`.

Node data: exactly the four tables in spec §9 (id, x,y, kind, name, effect text, XP, requirements, links). Improvement mods (the agent's mapping, from the effect texts):

| Node | `Improve(ability, mod)` |
|---|---|
| WA2 Piercing Missiles | `MagicMissile, Pierce(1)` |
| WF2 Biting Cold | `FrostShard, DamageMul(1.2)` |
| WF5 Wide Nova | `FrostNova, RadiusMul(1.25)` |
| WR1 Bigger Bang | `Fireball, RadiusMul(1.2)` |
| WR3 Scorched Earth | `Fireball, AddOnHit(OnHit { kind: Burning, secs: 3.0, magical: false, power: 0, look: Plain })` |
| WB5 Lasting Haste | `Haste, DurationAdd(2.0)` |
| PU2 Greater Light | `HolyLight, DamageMul(1.25)` (the heal is its `damage`) |
| PL4 Lasting Ward | `Purify, DurationAdd(2.0)` |
| PR1 Honed Edge | `Strike, DamageMul(1.1)` |
| BU2 Wide Swings | `Strike, ArcMul(1.15)` |
| BL2 Thunderous | `WarCry, RadiusMul(1.3)` |
| BL4 Bowling Charge | `Charge, PushStr(4)` |
| BR5 Aftershock | `GroundSlam, RadiusMul(1.2)` |
| EU1 Thick Fur | `SummonWolf, CompanionHpMul(1.25)` |
| EU4 Swift Pounce | `SummonWolf, CompanionDashCooldownAdd(-2.0)` |
| EL2 Long Shot | `Shoot, RangeMul(1.15)` |
| ER2 Find the Gap | `FlankingThrust, BehindArc(PI / 6.0)` (60° → 90°) |
| ED2 Lingering Venom | `PoisonCoat, DurationAdd(3.0)` |

Proficiency nodes: WB3 `Armor(Light)`, PD3 `Weapon(Spear)`, BR1 `Armor(Heavy)`, BR3 `Weapon(Mace)`, EL3 `Weapon(Longbow)`, ER3 `Weapon(Katana)`. Resist values are fractions (`+20 %` = `0.2`). Juggernaut, Unshaken etc. are `Keystone(..)` nodes; their effects come in Tasks 3–4.

- [ ] **Step 1: Write the failing data tests** in `trees.rs`:

```rust
#[test] fn trees_have_the_spec_sizes_and_totals() {
    for (c, n, xp) in [(ClassId::Wizard, 22, 10360), (ClassId::Paladin, 19, 9060), (ClassId::Barbarian, 20, 9200), (ClassId::ElvenRanger, 18, 8600)] {
        let t = tree(c);
        assert_eq!(t.iter().filter(|d| d.kind != NodeKind::Start).count(), n, "{c:?}");
        assert_eq!(t.iter().map(|d| d.cost).sum::<u32>(), xp, "{c:?}");
        assert_eq!(def(start(c)).cost, 0);
    }
}
#[test] fn every_node_is_reachable_and_stays_in_its_class() { /* BFS over `neighbours` from `start(c)` reaches every node of `tree(c)`; every neighbour has the same class */ }
#[test] fn positions_are_unique_per_class_and_the_start_is_at_the_origin() { /* start pos (0,0); no two nodes of one class share a pos */ }
#[test] fn unlocks_and_improves_name_abilities_of_the_class() {
    // Unlock: def(a).classes contains the class and a is not the class's start primary/secondary.
    // Improve: def(a).classes contains the class.
}
#[test] fn ids_and_defs_agree() { for id in NodeId::ALL { assert_eq!(def(id).id, id); } }
#[test] fn gains_add_up() {
    let g = gains(&[NodeId::WA1, NodeId::WA4, NodeId::WF3, NodeId::WA3, NodeId::WA2, NodeId::WA5]);
    assert_eq!(g.attrs.get(Attr::Int), 2);
    assert_eq!(g.res, vec![(DamageType::Cold, 0.2)]);
    assert_eq!(g.unlocks, vec![AbilityId::ChainSpark]);
    assert_eq!(g.improves, vec![(AbilityId::MagicMissile, AbilityMod::Pierce(1))]);
    assert!(g.keystones.has(Keystone::ArcaneOverflow) && !g.keystones.has(Keystone::Pyromancer));
}
#[test] fn buying_needs_a_neighbour_and_the_requirements() {
    let int15 = Attributes::new(8, 14, 12, 15, 13, 10);
    assert_eq!(check_buy(ClassId::Wizard, &[], NodeId::WA1, &int15), Ok(()), "next to the start");
    assert!(check_buy(ClassId::Wizard, &[], NodeId::WA2, &int15).is_err(), "no owned neighbour");
    assert_eq!(check_buy(ClassId::Wizard, &[NodeId::WA1], NodeId::WA2, &int15), Ok(()));
    assert!(check_buy(ClassId::Wizard, &[NodeId::WA1, NodeId::WA2], NodeId::WA3, &int15).is_err(), "INT 18");
    assert!(check_buy(ClassId::Wizard, &[NodeId::WA1], NodeId::WA1, &int15).is_err(), "owned");
    assert!(check_buy(ClassId::Paladin, &[], NodeId::WA1, &int15).is_err(), "other class");
    assert!(check_buy(ClassId::Wizard, &[], NodeId::W0, &int15).is_err(), "the start is owned");
    // A weapon requirement never blocks buying: Hurl (needs throwing axes) with a Great Axe.
    let barb = Attributes::new(15, 13, 14, 8, 12, 10);
    assert_eq!(check_buy(ClassId::Barbarian, &[NodeId::BR1], NodeId::BR2, &barb), Ok(()));
}
```

- [ ] **Step 2: Run** `cd server && cargo test --bin '*' trees -- --skip export_bindings` — FAIL (module missing).
- [ ] **Step 3: Implement `trees.rs`** with the interfaces above. `def` is one `match` over `NodeId` (like `abilities::def`). `AbilityMod` must be usable in `const`/`static` data (it is `Copy`; `OnHit` is a plain struct).
- [ ] **Step 4: Run** the same command — PASS. Then `cargo test -- --skip export_bindings` — all pass.
- [ ] **Step 5: Commit** `git add server/src/defs/trees.rs server/src/defs/mod.rs && git commit -m "Progression 4: the skill trees as data"`

---

### Task 2: The sheet reads the tree; the old upgrades go

**Files:**
- Modify: `server/src/defs/loadout.rs`, `server/src/sheet.rs`, `server/src/defs/items.rs`, `server/src/defs/classes.rs`, `server/src/defs/damage.rs`, `server/src/run/rules_log/text.rs`, `server/src/run/mod.rs`, `server/src/run/abilities.rs`, `server/src/lobby.rs` (only `build_of`), every test using `Build { upgrades … }` or `StatUpgrades`.

**Interfaces:**
- Consumes: Task 1 (`gains`, `TreeGains`, `Prof`).
- Produces:
  - `pub struct Build { pub extra: Attributes /* shop points (+ the debug lift) */, pub nodes: Vec<NodeId>, pub equipment: Equipment, pub loadout: Loadout, pub own: Vec<AbilityId> /* debug pool only */ }` — `upgrades` removed; `Build::start(class)` has empty `nodes`.
  - `classes::prof_base(class) -> Vec<Prof>` (the class's `weapons` as `Prof::Weapon` plus `Prof::Armor(max_armor)`), and `items::check_equip(class, profs: &[Prof], slot, item, attrs)` / `items::check_equipment(class, profs: &[Prof], e, attrs)`: a weapon is proficient if `Prof::Weapon(k)` is listed; armor if its class `<=` the highest listed `Prof::Armor`.
  - `pub fn sheet::profs(class: ClassId, nodes: &[NodeId]) -> Vec<Prof>` (base + tree).
  - `pub fn sheet::attrs_without_items(class: ClassId, b: &Build) -> Attributes` (start + `extra` + tree Attribute nodes) and `pub fn sheet::attrs_with_items(class: ClassId, b: &Build) -> Attributes` (plus worn items' `PropKind::Attr`, ignoring the loadout so it works for any loadout).
  - `pick_version` treats `Source::Own` as pooled when the ability is the class start, in `gains(&b.nodes).unlocks`, or in `b.own`.
  - `Base.upgrade_mult` renamed `keystone_mult` (still 1.0 everywhere after this task); the rules log's text prints it as "keystones ×{f}" where it printed the upgrade factor.
  - `Sheet.armor` removed; `hurt_player` and `run/abilities.rs` stop reading it; `HitFacts.armor` is passed `0.0` (leave the rules-log field; Task 9 may remove it).

Order in `hero_sheet` (spec §10): class → race → shop (`extra`) → tree nodes (Attributes, resistances, proficiencies) → items; then derived numbers; then weapons; then the two picks with `apply_mods(r, version_mods ++ tree improves for that ability id)`. The fallback strike gets no improvements.

- [ ] **Step 1: Write failing tests** in `sheet.rs`:

```rust
#[test] fn tree_points_resistances_and_proficiencies_reach_the_sheet() {
    let c = ClassId::Wizard;
    let b = Build { nodes: vec![NodeId::WA1, NodeId::WF1, NodeId::WF3, NodeId::WB1, NodeId::WB3], ..Build::start(c) };
    let s = hero_sheet(c, &b).unwrap();
    let start = hero_sheet(c, &Build::start(c)).unwrap();
    assert_eq!(s.attrs.get(Attr::Int), start.attrs.get(Attr::Int) + 1);
    assert_eq!(s.max_hp, start.max_hp + 5.0, "CON +1");
    assert!((s.res.get(DamageType::Cold) - start.res.get(DamageType::Cold) - 0.2).abs() < 1e-12);
    // Light armor: refused without the node, fine with it.
    let robe = |nodes: Vec<NodeId>| Build { nodes, equipment: Equipment::starter(c).with(EquipSlot::Armor, ItemId::LeatherArmor), ..Build::start(c) };
    assert!(matches!(hero_sheet(c, &robe(vec![])), Err(LoadoutError::Equip(EquipSlot::Armor, EquipError::NotProficient))));
    assert!(hero_sheet(c, &robe(vec![NodeId::WB1, NodeId::WB3])).is_ok());
}
#[test] fn an_unlock_puts_the_ability_in_the_pool() {
    let c = ClassId::Wizard;
    let pick = Pick { ability: AbilityId::FrostShard, source: Source::Own };
    let mut b = Build::start(c);
    b.loadout.primary = pick;
    assert_eq!(hero_sheet(c, &b).err(), Some(LoadoutError::NotInPool(AbilityId::FrostShard)));
    b.nodes = vec![NodeId::WF1];
    assert_eq!(hero_sheet(c, &b).unwrap().primary.id, AbilityId::FrostShard);
}
#[test] fn improvements_apply_only_to_the_equipped_ability() {
    let c = ClassId::Paladin;
    let plain = hero_sheet(c, &Build::start(c)).unwrap();
    let honed = hero_sheet(c, &Build { nodes: vec![NodeId::PR1], ..Build::start(c) }).unwrap();
    assert!((honed.primary.damage - plain.primary.damage * 1.1).abs() < 1e-9, "Strike equipped");
    assert_eq!(honed.fallback.damage, plain.fallback.damage, "never on the fallback");
    // Greater Light (PU2) behind +1 CHA (PU1): compare with the same CHA bought in the shop.
    let cha = hero_sheet(c, &Build { extra: Attributes::new(0, 0, 0, 0, 0, 1), ..Build::start(c) }).unwrap();
    let greater = hero_sheet(c, &Build { nodes: vec![NodeId::PU1, NodeId::PU2], ..Build::start(c) }).unwrap();
    assert!((greater.secondary.damage - cha.secondary.damage * 1.25).abs() < 1e-9, "Holy Light equipped");
}
#[test] fn an_item_version_gets_the_tree_improvement_too() {
    // Ruling 1: a Wizard with Piercing Missiles (WA1, WA2) picking the Seeker's Band's Magic Missile pierces 2.
}
#[test] fn attrs_with_and_without_items() {
    let c = ClassId::Paladin;
    let b = Build { nodes: vec![NodeId::PU1], extra: Attributes::new(1, 0, 0, 0, 0, 0), equipment: Equipment::starter(c).with(EquipSlot::Ring1, ItemId::BandOfVigor), ..Build::start(c) };
    let without = attrs_without_items(c, &b);
    assert_eq!(without.get(Attr::Str), 16);
    assert_eq!(without.get(Attr::Cha), 15);
    assert!(attrs_with_items(c, &b).get(Attr::Con) > without.get(Attr::Con), "the band's CON counts with items only");
}
```

(Check `BandOfVigor`'s actual property in `items.rs` and adjust the asserted Attribute.)

Also, a handoff carry-over: **Charge's push reads the resolved `push_str`** (today it uses the hero's STR only), so Bowling Charge works. Test `bowling_charge_pushes_with_more_str`: a Barbarian with BL1, BL2, BL4 (+ shop STR to meet War Cry's STR 16) charging an orc pushes it further than without BL4, or at all where the plain push gives 0 (pick a target whose weight sits between STR and STR + 4).

- [ ] **Step 2: Run** `cargo test --bin '*' sheet -- --skip export_bindings` — FAIL (no `nodes` field).
- [ ] **Step 3: Implement.** Remove `StatUpgrades` from `Build`, `sheet.rs` and their tests (delete `upgrades_still_apply` and the upgrade cases of `every_allowed_ability`); replace the `m.life`/`m.move_speed`/`m.attack_speed`/`m.damage` factors by nothing. `lobby::build_of` builds from `Build::start` as before (Task 6 switches it to `Progress`). Keep `defs/progression.rs`'s upgrade types for `progress.rs` until Task 5.
- [ ] **Step 4: Run** `cargo test -- --skip export_bindings` — all pass, fingerprints unchanged.
- [ ] **Step 5: Commit** `"Progression 4: the sheet reads the tree; upgrades leave the sheet"`

---

### Task 3: Static keystones and the Radiant light

**Files:**
- Modify: `server/src/sheet.rs`, `server/src/defs/lights.rs`, `server/src/run/effects.rs` (save lookup), client light table if it lists kinds by id (`grep -rn "LightKind\|Holy" client/src/game/light*.ts client/src/generated/defs.ts`).

**Interfaces:**
- Consumes: Task 2 (`gains(..).keystones`).
- Produces: `Sheet.keystones: KeystoneSet`; `impl Sheet { pub fn save(&self, a: Attr) -> i32 }` (= `attrs.get(a)`, +4 for `Con` with Unbreakable); `run/effects.rs` reads `p.sheet.save(save_attr)` for heroes; `LightKind::Radiant = 6`.

Effects, all applied in `hero_sheet`:
- **Arcane Overflow:** every resolved ability (primary, secondary, fallback) whose def has `category == Spell`: `keystone_mult ×= 1.15`, `cooldown ×= 1.1`.
- **Pyromancer:** every resolved ability incl. the fallback: `keystone_mult ×= 1 + 0.2 × heat share − 0.2 × cold share` (Ruling 4).
- **Unshaken:** effect resistance Sleep `+1.0`.
- **Bulwark:** armor weight counts ×0.5; physical resistance `+0.1`.
- **Juggernaut:** weight `+4`; effect resistance Slowed, Chilled, Entangled `+1.0` each.
- **Unbreakable:** `Sheet::save`.
- **Radiant:** `sheet.light` = Radiant if no worn light has a larger radius (the existing "largest radius wins" rule).

- [ ] **Step 1: Failing tests** in `sheet.rs`:

```rust
fn with_nodes(c: ClassId, nodes: &[NodeId]) -> Sheet { hero_sheet(c, &Build { nodes: nodes.to_vec(), extra: Attributes::new(5, 5, 5, 5, 5, 5), ..Build::start(c) }).unwrap() }
#[test] fn arcane_overflow_and_pyromancer_change_spells() {
    let base = with_nodes(ClassId::Wizard, &[]);
    let arc = with_nodes(ClassId::Wizard, &[NodeId::WA1, NodeId::WA2, NodeId::WA4, NodeId::WA5]);
    // The +1 INT nodes move damage too: compare against a sheet with the same INT (extra INT +2 instead of the nodes).
    // Assert: arc.primary.base.keystone_mult == 1.15, cooldown == base cooldown × 1.1; fallback (Strike, a weapon attack) keystone_mult == 1.0.
    let pyro = with_nodes(ClassId::Wizard, &[NodeId::WR1, NodeId::WR2, NodeId::WR4, NodeId::WR5]);
    // Fireball (70 % heat): keystone_mult == 1 + 0.2 × 0.7; Magic Missile (no heat, no cold): 1.0.
}
#[test] fn defensive_keystones() {
    let p = with_nodes(ClassId::Paladin, &[NodeId::PL1, NodeId::PL2, NodeId::PL4, NodeId::PL5]);
    assert_eq!(p.effect_res.get(EffectKind::Sleep), 1.0 + with_nodes(ClassId::Paladin, &[]).effect_res.get(EffectKind::Sleep));
    let j = with_nodes(ClassId::Barbarian, &[NodeId::BL1, NodeId::BL2, NodeId::BL4, NodeId::BL5]);
    let b0 = with_nodes(ClassId::Barbarian, &[]);
    assert_eq!(j.weight, b0.weight + 4.0);
    for k in [EffectKind::Slowed, EffectKind::Chilled, EffectKind::Entangled] { assert_eq!(j.effect_res.get(k), b0.effect_res.get(k) + 1.0); }
    let u = with_nodes(ClassId::Barbarian, &[NodeId::BD1, NodeId::BD2, NodeId::BD4, NodeId::BD5]);
    assert_eq!(u.save(Attr::Con), u.attrs.get(Attr::Con) + 4);
    assert_eq!(u.save(Attr::Wil), u.attrs.get(Attr::Wil));
}
#[test] fn bulwark_halves_armor_weight() { /* Paladin in PlateArmor with PR1..PR5 (Bulwark): weight == class 12 + plate weight × 0.5; physical res +0.1 over the same build without PR5 */ }
#[test] fn radiant_sheds_light() { /* Paladin with PU1..PU5: light == Some(LightKind::Radiant); with the Golden Sword (Holy, radius 4) the light stays Holy */ }
```

Plus in `run/effects.rs` tests: `unbreakable_shortens_con_saves` — a Barbarian with Unbreakable gets a shorter non-magical effect (e.g. `Burning` from power 15) than without it.

- [ ] **Step 2: Run** `cargo test --bin '*' keystone -- --skip export_bindings` and the named tests — FAIL.
- [ ] **Step 3: Implement** as listed. Find where the client draws hero/item lights by `LightKind` id and add `Radiant` (same colour as Holy, smaller radius from `defs.ts` if it is exported there; otherwise a client constant). Check that the item light lookup (`lights::def(k).radius`) and `LightKind::ALL` include the new kind.
- [ ] **Step 4: Run** the full server tests and the docker suite (regenerates `defs.ts` if it lists light kinds); client `vitest`/`tsc`.
- [ ] **Step 5: Commit** `"Progression 4: static keystones and the Radiant light"`

---

### Task 4: Run-time keystones (`run/keystones.rs`) and Berserker's cooldowns

**Files:**
- Create: `server/src/run/keystones.rs`
- Modify: `server/src/run/mod.rs` (`hurt_monster`, `hurt_player`, monster tick), `server/src/run/abilities.rs` (cooldown start), `server/src/run/companion.rs` (bite marks), `server/src/run/entities.rs` (`Monster.wolf_bit: f64`), `server/src/defs/damage.rs` (`Mult::Keystone(Keystone, f64)`), `server/src/run/rules_log/text.rs` (print it), `server/src/protocol.rs` + `server/src/wire.rs` (`SelfState.cd_mul: f32`, appended last to `SelfW`), client `SelfW` unpack + `GameScene`/predictor cooldown.

**Interfaces:**
- Consumes: `Sheet.keystones` (Task 3).
- Produces:
  - `pub fn keystones::berserk(p: &Player) -> bool` — `p.sheet.keystones.has(Berserker) && p.hp < 0.5 * p.sheet.max_hp` (Ruling 5).
  - `pub fn keystones::outgoing(run: &Run, pi: usize, mi: usize, dmg: &Damage) -> Vec<(Keystone, f64)>` — the factors of hero `pi` hitting monster `mi`, in `Keystone` order:
    - DeepWinter: target has Chilled or Frozen → `1 + 0.2 × cold share`.
    - Radiant: `What::Ability(id)` with category Innate and target races contain Undead or Demon → 1.2.
    - Berserker: `berserk(p)` → 1.25.
    - PackHunter: `monster.wolf_bit > 0` → 1.2.
    - Deadeye: `What::Ability(id)` with `ab::def(id).ranged` and target has Slowed, Chilled, Entangled or Sleep → 2.0.
    - Venomancer: target has Poisoned → 1.15.
  - `hurt_monster` applies them before resistances when `!dmg.from_effect` and `dmg.why.by == Some(players[pi].id)` for some hero `pi` (Ruling 3): `amount ×= product`, and each factor goes into `why` via `with_mult(Mult::Keystone(k, f))`.
  - `hurt_player`: when `berserk(p)`, every resistance of that hit `−0.10`.
  - Cooldown start (`run/abilities.rs`, both slots and the fallback): divided by 1.25 while `berserk`.
  - `SelfState.cd_mul`: `0.8` while berserk, else `1.0`; the client multiplies its predicted cooldown by it at the moment of use.
  - The wolf's bite landing on monster `mi` sets `monsters[mi].wolf_bit = 2.0`; every monster tick counts it down to 0.

- [ ] **Step 1: Failing tests** in `keystones.rs` (use `Run::test_run_with` with a `Build` whose `nodes` own the keystone path, and `Run::spawn_enemy`):

```rust
#[test] fn venomancer_hits_poisoned_targets_harder() { /* ranger with ED1, ED3, ED4 (+ extra WIL to meet 16) strikes an orc; damage with Poisoned on the orc == damage without × 1.15; `last_hit.why.mults` contains Mult::Keystone(Venomancer, 1.15) */ }
#[test] fn deadeye_doubles_ranged_hits_on_held_targets_only() { /* Shoot on an Entangled goblin ×2; the melee fallback strike on the same goblin ×1 */ }
#[test] fn deep_winter_scales_with_the_cold_share() { /* Frost Shard (40 % cold) on a Chilled target: × 1.08 */ }
#[test] fn radiant_only_innate_against_undead_and_demons() { /* Judgement on a skeleton ×1.2; on an orc ×1; Strike on a skeleton ×1 */ }
#[test] fn pack_hunter_needs_a_recent_bite() { /* wolf_bit 2.0 → ×1.2; after 2.1 s of ticks → ×1 */ }
#[test] fn berserker_starts_below_half_hp() {
    // hp == 0.5 × max: not berserk; hp just below: berserk — damage ×1.25, cooldown ÷1.25, a hit on the hero uses resistances −0.10, SelfState.cd_mul == 0.8.
}
#[test] fn effect_ticks_and_the_wolf_get_no_keystone() { /* a Poisoned tick (from_effect) and a wolf bite (`why.by` = the wolf) on a Poisoned target: no Venomancer factor */ }
```

Client (`vitest`, next to the existing prediction tests): `cd_mul` 0.8 makes the predicted cooldown of a 0.5 s ability 0.4 s.

- [ ] **Step 2: Run** `cargo test --bin '*' keystones -- --skip export_bindings` — FAIL.
- [ ] **Step 3: Implement.** Keep every keystone rule inside `keystones.rs`; `hurt_monster`/`hurt_player`/the cooldown code each get one call. `Mult` has three slots in `Why`; keystones use the free ones (the existing `with_mult` rule keeps the first three). Check the rules log's "amount = base × mults" consistency check, if it has one, with a two-keystone hit.
- [ ] **Step 4: Run** server tests, docker suite (regenerates `SelfState`), client vitest/tsc/build. Fingerprints unchanged; rules-log boundary tests green.
- [ ] **Step 5: Commit** `"Progression 4: run-time keystones and Berserker cooldowns"`

---

### Task 5: `Progress` v2

**Files:**
- Modify: `server/src/progress.rs`, `server/src/defs/progression.rs` (remove `StatUpgrades`, `UpgradeStat`, `Modifiers`, `upgrade_cost`, `cost_table`, `MAX_LEVEL`; keep the XP and coin rewards), `server/src/defs/items.rs` (`Equipment`: `Serialize, Deserialize`), `server/src/defs/loadout.rs` (`Loadout`: `Serialize, Deserialize, TS` with `#[ts(export)]`), `server/src/db.rs` (class plumbing, tests).

**Interfaces:**
- Consumes: Tasks 1–2 (`check_buy`, `attrs_with_items`, `attrs_without_items`, `profs`, `check_equip`).
- Produces:

```rust
pub const CURRENT_VERSION: u32 = 2;
pub struct Progress {
    pub version: u32, pub rev: u64, pub xp: u32, pub total_xp: u32, pub coins: u32,
    pub bought: Attributes, pub nodes: Vec<NodeId> /* owned, sorted, no start node */, pub xp_spent: u32,
    pub equipment: Equipment, pub inventory: Vec<ItemId>, pub loadout: Loadout,
}
pub enum Change { BuyAttr(Attr), BuyNode(NodeId), Respec, Equip(EquipSlot, Option<ItemId>), SetLoadout(Loadout), GrantItem(ItemId) }
impl Progress {
    pub fn new(class: ClassId) -> Progress;                       // starters, start loadout
    pub fn from_json(value: serde_json::Value, class: ClassId) -> Progress;
    pub fn to_json(&self) -> serde_json::Value;
    pub fn bank(&mut self, xp: u32, coins: u32);                  // unchanged
    pub fn build(&self, class: ClassId) -> Build;                 // extra = bought, nodes, equipment, loadout, own = []
    pub fn attr_prices(&self, class: ClassId) -> [u32; 6];        // attr_price(a, attrs_without_items)
    pub fn respec_price(&self) -> u32;                            // 20 + xp_spent / 50
    pub fn buy_attr(&mut self, class: ClassId, a: Attr) -> Result<(), &'static str>;
    pub fn buy_node(&mut self, class: ClassId, n: NodeId) -> Result<(), &'static str>;
    pub fn respec(&mut self, class: ClassId) -> Result<(), &'static str>;
    pub fn equip(&mut self, class: ClassId, slot: EquipSlot, item: Option<ItemId>) -> Result<(), &'static str>;
    pub fn set_loadout(&mut self, l: Loadout) -> Result<(), &'static str>;
    pub fn grant_item(&mut self, class: ClassId, item: ItemId) -> Result<(), &'static str>;
    pub fn apply(&mut self, class: ClassId, c: Change) -> Result<(), &'static str>;
}
```

Messages: `"Not enough XP."`, `"Not enough coins."`, `"That item is not in your inventory."`, `"That item does not fit the {slot} slot."` style messages come from `LoadoutError::Equip(..).message()` — since `equip` returns `&'static str`, map `EquipError` to fixed strings: WrongSlot `"That item does not fit that slot."`, ClassNotListed `"Your class cannot use that item."`, NotProficient `"You are not trained in that item."`, Requirement `"You do not meet that item's requirements."`; `set_loadout` wrong slot `"That ability does not fit that slot."`; `grant_item` refuses items whose `classes` lack the class or whose base is a natural weapon: `"Your class cannot use that item."`.

Reading (`from_json`): parse `version`; deserialize the v2 fields leniently — `nodes` and `inventory` element by element, dropping unknown ids with `tracing::warn!` (Ruling 12); an unreadable `equipment` or `loadout` falls back to the class starters / start (logged). If `version < 2`: refund from `value["upgrades"]` (each of `damage`, `attack_speed`, `move_speed`, `life`, `armor` read as an integer when it is one, capped at 10, `Σ_{l < level} (100 + 75 l)`), set starters and the start loadout, `version = 2`. Anything else unreadable starts fresh (`Progress::new(class)`), as today. `buy_node` and `buy_attr` add the cost to `xp_spent`; `nodes` stays sorted.

- [ ] **Step 1: Failing tests** in `progress.rs` (replace the old ones):

```rust
#[test] fn v1_refund_is_exact_and_happens_once() {
    let v1 = json!({ "version": 1, "xp": 40, "total_xp": 2000, "coins": 7, "upgrades": { "damage": 2, "life": 1 } });
    let p = Progress::from_json(v1, ClassId::Paladin);
    assert_eq!(p.xp, 40 + (100 + 175) + 100);
    assert_eq!((p.version, p.xp_spent, p.coins, p.total_xp), (2, 0, 7, 2000));
    assert_eq!(p.equipment, Equipment::starter(ClassId::Paladin));
    assert_eq!(p.loadout, Loadout::start(ClassId::Paladin));
    assert_eq!(Progress::from_json(p.to_json(), ClassId::Paladin), p, "no second refund");
}
#[test] fn odd_v1_documents_refund_what_they_can() {
    let p = Progress::from_json(json!({ "upgrades": { "armor": 50, "damage": "lots", "speed": 3 } }), ClassId::Wizard);
    assert_eq!(p.xp, (0..10).map(|l| 100 + 75 * l).sum::<u32>(), "armor capped at 10; the rest ignored");
    assert_eq!(Progress::from_json(json!({}), ClassId::Wizard), Progress::new(ClassId::Wizard));
}
#[test] fn stale_ids_are_dropped_not_the_document() {
    let mut p = Progress::new(ClassId::Wizard);
    p.bank(5000, 30);
    p.buy_node(ClassId::Wizard, NodeId::WA1).unwrap();
    let mut v = p.to_json();
    v["nodes"].as_array_mut().unwrap().push(json!("NoSuchNode"));
    v["inventory"] = json!(["NoSuchItem", "Knife"]);
    let q = Progress::from_json(v, ClassId::Wizard);
    assert_eq!((q.xp, q.coins, q.nodes.clone(), q.inventory.clone()), (p.xp, 30, vec![NodeId::WA1], vec![ItemId::Knife]));
}
#[test] fn the_shop_charges_by_the_formula_and_ignores_items() {
    // Wizard INT 15: first point 225 XP, then 250; xp_spent follows; a ring adding INT does not change the next price.
    // Not enough XP → Err("Not enough XP.") and nothing changes.
}
#[test] fn buying_nodes() { /* neighbour, requirement (with items: an INT ring makes INT 18 reachable for WA3), XP, xp_spent, sorted nodes */ }
#[test] fn respec_refunds_resets_and_charges() {
    // after buying 2 shop points and 3 nodes: respec_price == 20 + xp_spent / 50; xp back in full; bought, nodes, xp_spent zero;
    // loadout == start; coins reduced; too few coins → Err("Not enough coins.") and nothing changes.
}
#[test] fn respec_unequips_what_no_longer_fits() {
    // Barbarian with BR1 (Heavy Armor) wearing PlateArmor (granted); after respec the plate is in the inventory, Armor slot empty,
    // and `hero_sheet(class, &p.build(class))` is Ok.
}
#[test] fn equip_moves_items_between_inventory_and_slots() {
    // grant Knife to a Wizard → inventory [Knife]; equip Melee Knife → slot Knife, inventory [RedStaff]; equip Melee None → slot empty, inventory [RedStaff, Knife];
    // equip an item not in the inventory → Err("That item is not in your inventory."); a Wizard granted LeatherArmor equipping it without WB3 → Err("You are not trained in that item.").
}
#[test] fn set_loadout_refuses_only_the_wrong_slot() {
    // Wizard: primary Fireball → Err; primary FrostShard (locked) → Ok (reported later by the sheet summary).
}
#[test] fn banking_saturates() { /* unchanged */ }
```

`db.rs` tests: update the concurrency test to `buy_attr` and the old-document test to the v1 refund (`{"xp": 300, "upgrades": {"armor": 1}}` → `xp == 400`, `version == 2`).

- [ ] **Step 2: Run** `cargo test --bin '*' progress -- --skip export_bindings` — FAIL.
- [ ] **Step 3: Implement.** `db::modify` selects `class, progress` and passes the class to `Progress::from_json`; `load_character` passes its row's class; character creation stores `Progress::new(class)`. Since the upgrade types are gone, `CharacterInfo` loses `upgrades, mods, costs` and gains `bought, nodes, xp_spent` here; Task 6 adds the rest. `ClientMsg::BuyUpgrade` and its `main.rs` arm go too. The client stops compiling against the regenerated types until Task 8; that is expected inside the branch (the reviewer checks the server only).
- [ ] **Step 4: Run** server tests and, with Postgres, the docker suite (db tests included); `client/src/generated` regenerates.
- [ ] **Step 5: Commit** `"Progression 4: Progress v2 with the v1 refund, shop, nodes, respec, equip"`

---

### Task 6: Protocol, lobby and the sheet summary

**Files:**
- Modify: `server/src/protocol.rs`, `server/src/sheet.rs` (`SheetSummary`, `summary`), `server/src/progress.rs` (`info`), `server/src/lobby.rs`, `server/src/main.rs`, `server/src/stats.rs`, `client/src/admin/main.ts` (labels only).

**Interfaces:**
- Consumes: Task 5 (`Progress`, `Change`, `apply`, `build`, prices).
- Produces:
  - `ClientMsg`: `BuyAttribute { attr: Attr }`, `BuyNode { node: NodeId }`, `Respec`, `Equip { slot: EquipSlot, item: Option<ItemId> }`, `SetLoadout { primary: Pick, secondary: Pick }`, `DebugGrantItem { item: ItemId }`. `DebugLoadout`, `DebugEquip` stay.
  - `#[ts(export)] pub struct AttrLine { pub attr: Attr, pub total: i32, pub class: i32, pub shop: i32, pub tree: i32, pub items: i32 }`
  - `#[ts(export)] pub struct SheetSummary { pub attrs: Vec<AttrLine>, pub hp: f64, pub speed: f64, pub weight: f64, pub push: i32, pub save_con: i32, pub save_wil: i32, pub res: Vec<(DamageType, f64)> /* non-zero */, pub effect_res: Vec<(EffectKind, f64)> /* non-zero */, pub profs: Vec<String> /* "Sword", …, "Light armor" */, pub keystones: Vec<Keystone>, pub loadout_error: Option<String> }`
  - `pub fn sheet::summary(class: ClassId, b: &Build) -> SheetSummary` — numbers from `hero_sheet` when it succeeds; when it fails, `loadout_error = Some(e.message())` and the numbers come from the same build with the start loadout (and, if the equipment is what fails, also the starter equipment).
  - `CharacterInfo { id, name, class, xp, total_xp, coins, bought: Attributes, nodes: Vec<NodeId>, equipment: Equipment, inventory: Vec<ItemId>, loadout: Loadout, xp_spent: u32, respec_price: u32, prices: [u32; 6], sheet: SheetSummary }` (`Equipment` gets `TS` with `slots: Array<ItemId | null>`).
  - `RoomPlayer { id, name, class, ready, loadout: Loadout, weapons: Vec<ItemId> }` — from the build that will play (the debug loadout/equipment when set).
  - `Lobby::can_change(id) -> Result<(i32, ClassId), &'static str>` replaces `can_shop` (Ruling 8: `"Not during a run."`, `"Not while ready."`, `"Choose a character first."`).
  - `Lobby::build_of(id)` starts from `ch.progress.build(ch.class)`; with the debug flag it overrides loadout and equipment, sets `own` to the class pool and `extra = progress.bought + debug_lift(..)` as today.
  - `Lobby::apply_progress` also re-sends the room of every connection whose character changed.
  - `main.rs`: one arm for `BuyAttribute | BuyNode | Respec | Equip | SetLoadout | DebugGrantItem` → `Change`, guarded by `can_change` (and `run::debug::allowed()` for `DebugGrantItem`, error `"Debug is off."`), applied with `db::update_progress(.., |p| p.apply(class, change))`, result handled like the old `BuyUpgrade` arm.
  - `stats.rs`: `UPGRADES` → nodes count (Ruling 14); `LevelBucket.upgrades` → `nodes`; the top-characters column the same; admin client labels "Tree nodes bought" / "Nodes".

- [ ] **Step 1: Failing tests:**
  - `protocol.rs` round-trips (existing style) for each new `ClientMsg`, e.g. `{"t":"BuyNode","node":"WA1"}`, `{"t":"Equip","slot":"Melee","item":null}`, `{"t":"SetLoadout","primary":{"ability":"Strike","source":"Own"},"secondary":{"ability":"Charge","source":{"Item":"Ring1"}}}`.
  - `sheet.rs`: `summary_lists_sources` (Paladin with 1 shop STR, PU1, a ring: the CHA line reads class 14, tree 1, items per ring; `total` = sum) and `unequipping_a_granting_item_reports_the_loadout` (Paladin whose primary is the Ring of the Magus's Magic Missile, ring removed: `loadout_error == Some("Magic Missile is not one of your abilities.")`, numbers present).
  - `lobby.rs`: `build_changes_are_refused_in_a_run_and_while_ready` (`can_change` in each state); `a_saved_loadout_reaches_the_run` (character progress with `nodes: [WF1]` and primary Frost Shard → `members_of` carries it); `ready_refuses_a_saved_invalid_loadout` (locked Frost Shard saved → `SetReady` sends the error); `the_party_list_shows_loadouts_and_weapons` (`RoomPlayer.loadout`/`weapons` from the progress, and from the debug picks when set); `the_debug_flag_starts_from_the_real_build` (a character with 2 bought STR keeps them under `DebugLoadout`).
  - `stats.rs` (Postgres test): a character with `nodes: ["WA1","WA2"]` lands in bucket 2.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** as listed.
- [ ] **Step 4: Run** server tests, docker suite (regenerates `CharacterInfo`, `ClientMsg`, `RoomPlayer`, `SheetSummary`, `AttrLine`, `NodeId`, `Keystone`, `Loadout`, `Equipment`); `git status client/src/generated` shows only the expected files.
- [ ] **Step 5: Commit** `"Progression 4: protocol, lobby and the sheet summary"`

---

### Task 7: Static progression data for the client (`generated/progression.ts`)

**Files:**
- Modify: `server/src/export.rs` (new test `export_progression`)
- Create (generated): `client/src/generated/progression.ts`

**Interfaces:**
- Produces `progression.ts` exporting, as `as const` objects like `defs.ts`:
  - `TREES: Record<ClassId, { start: NodeId; nodes: Record<NodeId, { pos: [number, number]; kind: 'Start' | 'Attr' | 'Unlock' | 'Improve' | 'Proficiency' | 'Resist' | 'Keystone'; ability?: AbilityId; attr?: Attr; name: string; text: string; cost: number; req: string[] /* "INT 15" */; links: NodeId[] /* undirected, both ways */ }> }>`
  - `ATTRS: Record<Attr, { short: string; weight: number; text: string }>` — `text` is the spec §1 table's effect line per Attribute.
  - `ITEMS: Record<ItemId, { name: string; slot: EquipSlot | 'Ring'; classes: ClassId[]; hero: boolean; grants: AbilityId[] }>` (`hero` false for natural/enemy-only items; `grants` from `PropKind::GrantAbility`).
  - `RESPEC: { base: 20, per: 50 }`.
- [ ] **Step 1: Write** `export_progression` and a client test `progression.test.ts`: every class tree has its start; every link target exists; `ITEMS.Knife.hero === true`; `ITEMS.MimicBite.hero === false`.
- [ ] **Step 2: Run** the docker suite (writes the file), then client vitest — PASS.
- [ ] **Step 3: Commit** `"Progression 4: export the static progression data"`

---

### Task 8: The stopgap client panel

**Files:**
- Create: `client/src/ui/progressPanel.ts`, `client/src/ui/progressPanel.test.ts`
- Modify: `client/src/ui/lobby.ts` (replace `upgradesPanel`/`bindUpgrades`; party rows), `client/src/ui/text.ts` (drop `STAT_TEXT`), `client/src/ui/hud.ts:271` (text: "Spend XP on Attributes and the skill tree in the lobby."), `client/src/ui/characters.ts:81` ("its own XP, coins, Attributes and skill tree"), the debug row (unchanged behaviour; it keeps working with `DebugLoadout`/`DebugEquip`).

**Interfaces:**
- Consumes: `CharacterInfo`, `TREES`, `ATTRS`, `ITEMS`, `ABILITIES`/`CLASSES` from `defs.ts`.
- Produces pure helpers (unit-tested) and one render function:
  - `nodeState(cls: ClassId, info: CharacterInfo, node: NodeId): 'owned' | 'buyable' | 'blocked' | 'locked'` — owned (start or in `info.nodes`), buyable (a neighbour owned, requirements met by `info.sheet.attrs` totals, enough XP), blocked (a neighbour owned but a requirement or XP missing), locked (no owned neighbour).
  - `loadoutPool(cls: ClassId, info: CharacterInfo, slot: 'Primary' | 'Secondary'): Pick[]` — the class start ability, every `Unlock` node owned, and one `{ source: { Item: slot } }` pick per worn item granting an ability of that slot.
  - `progressPanel(info: CharacterInfo, opts: { debug: boolean; ready: boolean }): string` and `bindProgressPanel(root: HTMLElement, send: (m: ClientMsg) => void)`.
- Look (plain, unstyled beyond the existing `.panel`): heading "Character (temporary)" with XP and coins; six Attribute rows (`STR 15 (class 15, shop 0, tree 0, items 0)` and a `+1 · 225 XP` button); "Skill tree": buyable nodes first, then blocked (with the reason), then owned; each with name, text, cost; a Buy button with `confirm()`; "Respec · N coins" with `confirm()`; two `<select>`s for primary and secondary from `loadoutPool` (sends `SetLoadout`); for each slot a `<select>` of the equipped item, "(empty)" and the inventory items that fit the slot (sends `Equip`); `info.sheet.loadout_error` in red; with `?debug`, a "Grant item" select of every `hero` item for the class (sends `DebugGrantItem`). While Ready or in a run the buttons are disabled.
- Party rows in the waiting room also show `primary / secondary` ability names and weapon names from `RoomPlayer`.

- [ ] **Step 1: Failing tests** in `progressPanel.test.ts`:

```ts
test('the start node is owned, its neighbours buyable with XP', () => {
  const info = fixtureInfo('Wizard', { xp: 1000 });
  expect(nodeState('Wizard', info, 'W0')).toBe('owned');
  expect(nodeState('Wizard', info, 'WA1')).toBe('buyable');
  expect(nodeState('Wizard', info, 'WA2')).toBe('locked');
});
test('a requirement or XP shortfall blocks', () => {
  const info = fixtureInfo('Wizard', { xp: 50, nodes: ['WA1', 'WA2'] });
  expect(nodeState('Wizard', info, 'WA3')).toBe('blocked'); // INT 18, and XP
});
test('the pool holds the start, unlocks and item versions', () => {
  const info = fixtureInfo('Paladin', { nodes: ['PL1'], ring1: 'RingOfTheMagus' });
  const prim = loadoutPool('Paladin', info, 'Primary');
  expect(prim).toContainEqual({ ability: 'Strike', source: 'Own' });
  expect(prim).toContainEqual({ ability: 'MagicMissile', source: { Item: 'Ring1' } });
  expect(loadoutPool('Paladin', info, 'Secondary')).toContainEqual({ ability: 'Purify', source: 'Own' });
});
```

(`fixtureInfo` builds a `CharacterInfo` from `CLASSES` start Attributes; keep it in the test file.)

- [ ] **Step 2: Run** `cd client && bash -lic 'npx vitest run src/ui/progressPanel.test.ts'` — FAIL.
- [ ] **Step 3: Implement**, then wire it into `lobby.ts` where `upgradesPanel()` was (home and room).
- [ ] **Step 4: Run** client vitest, `tsc --noEmit`, `npm run build`; then `docker compose up -d --build` and the smoke test for `ElvenRanger,Paladin` and `Wizard,Barbarian` (`cd tools/e2e && BROWSER=/usr/bin/brave-browser node smoke.mjs http://localhost:8080/ "" shots <classes>`): no browser errors, correction 0.00 px. Extend `smoke.mjs` with one step: the panel shows "Character (temporary)" and a `+1` button.
- [ ] **Step 5: Commit** `"Progression 4: stopgap character panel"`

---

### Task 9: Leftovers, docs and the final verification

**Files:**
- Modify: `server/src/run/rules_log/*` (drop `HitFacts.armor` and its text if nothing sets it any more; keep the boundary counts right), `docs/TECHNICAL.md` (§11a: Attribute shop, trees, keystones, `Progress` v2, the new messages, "How to add a tree node", "How to add a keystone"; §11d: `Mult::Keystone`), `docs/PLAYER_GUIDE.md` (Attributes, the tree, respec, the temporary panel), `docs/TODO.md` (close the "upgrades" items; add the plan-5 UI note and every ruling above as "check with the user"), `HANDOFF.md`.
- [ ] **Step 1:** Remove the leftovers named above; `grep -rn "upgrade\|Modifiers\|StatUpgrades\|BuyUpgrade" server/src client/src --include=*.rs --include=*.ts` returns only XP-reward wording and `version` upgrade code.
- [ ] **Step 2:** Full verification: `cargo test -- --skip export_bindings`, docker suite (`git status client/src/generated` clean afterwards), client vitest/tsc/build, `cargo build` warning count (21 at the branch start; note any change), smoke for both class pairs.
- [ ] **Step 3:** Docs as listed; HANDOFF gets the verification numbers, the rulings, and the browser checks for the user (buy a node, buy an Attribute, respec, equip a granted item, set a loadout, Ready refused with a locked pick, Berserker's cooldown bar).
- [ ] **Step 4: Commit** `"Progression 4: docs"`
