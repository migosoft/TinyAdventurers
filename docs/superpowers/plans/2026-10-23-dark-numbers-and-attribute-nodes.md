# Damage Numbers in the Dark and Attributes Only on the Sheet: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Numbers and HP bars on heroes and allies show over the darkness, while those on enemies are hidden under it. (2) The 20 "+1 Attribute" skill-tree nodes and the node type are removed, and the trees are pulled together.

**Architecture:** Part 1 is client-only: it swaps the layers in the `DEPTH` table (`client/src/game/effects.ts`) and changes how `GameScene` picks a layer. Part 2 is data first: the server tree table (`server/src/defs/trees.rs`) drops the nodes, re-links and re-places the rest, and the generated TypeScript follows. After that, the `NodeKind::Attr` type is removed end to end: server, export, Sheet summary and client tree view.

**Tech Stack:** Rust (server, ts-rs exports), TypeScript + Phaser + vitest (client), Docker test suite.

**Spec:** none. This is a small change agreed in chat on 2026-10-23, and this plan carries the whole description. The background is in HANDOFF "Next session", items 1 and 2.

## Global Constraints

- The user's rule (part 1): everything about a **hero** (allies such as the Dire Wolf count as heroes) shows over the darkness: damage, crit, "immune" and heal numbers, plus the green HP bar. Everything about an **enemy** is hidden by the darkness: the same numbers, plus the red HP bar. "+N coins" is unchanged (it stays at `DEPTH.numbers`). Name tags, figures and shots are unchanged (they stay under the darkness).
- The user's rule (part 2): remove all 20 `NodeKind::Attr` nodes. Use layout "B, pulled together", exactly as in Task 2's table. Every other node keeps its id name, cost, requirements, kind, name and text. The node type itself is removed (the user approved this).
- Stored characters: no refund and no migration. The loader already drops unknown node ids with a warning. `xp_spent` stays as stored, so a respec returns that XP.
- Terminology: say "Attributes", never "ability scores". Never say "elemental"; say "damage-type".
- Verification commands: `cd server && cargo test -- --skip export_bindings` (locally, the 55 `export_bindings` tests fail with EACCES; that is expected). To rewrite `client/src/generated`: `MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test`, then `docker compose -f docker-compose.test.yml down`. Client: `cd client && npx vitest run && npx tsc --noEmit`. Node comes through nvm: wrap npm/npx in `bash -lic '…'`.
- `cargo build` currently prints 21 warning lines. Don't add any.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A stored character that owns a removed node (for example `"WA1"`) must load without a panic. The node is dropped, `xp_spent` is unchanged, and a respec returns all of it. Test: Task 2 `a_removed_node_is_dropped_and_its_xp_stays_spent`.
2. A stored character whose owned nodes are no longer connected after the removal (it owned `WA4`→`WA5` but not `WA3`) keeps `WA5`, and its sheet still builds. Test: Task 2, the same test, second half.
3. Allies (the Dire Wolf) follow the hero rule: `Dmg.p`/`Heal.p` are already set for allies, and their bar is drawn in `heroBars` (`isAllyKind`). Task 1 must not split them off.
4. The shorter trees must still centre and fit in the Skill tree tab. The tab draws from `progression.ts` positions. Check the smoke shot `0-hub-tree.png` in Task 3.
5. The Sheet's per-Attribute source line ("class · shop · items") must still add up to the total once the tree column is gone. Test: Task 3, `summary_lists_sources`.

---

### Task 1: Hero numbers and bars over the darkness, enemy ones under it

**Files:**
- Modify: `client/src/game/effects.ts` (`DEPTH` table, lines 7–27; the doc comment on `text()` around line 134)
- Modify: `client/src/game/GameScene.ts` (bars at lines 191–192; `Dmg`/`Heal` at lines 360–372)
- Create: `client/src/game/effects.test.ts`
- Modify docs: `docs/TECHNICAL.md` (lines 382, 488, 1223), `docs/PLAYER_GUIDE.md` ("Seeing in the dark", line 96), `docs/TODO.md` (line 44: mark it done, dated 2026-10-23)

**Interfaces:**
- Produces: `DEPTH.enemyBars = 6500`, `DEPTH.enemyNumbers = 6501`, `DEPTH.heroBars = 7999`, `DEPTH.numbers = 8000` (unchanged value). `DEPTH.heroNumbers` is deleted. `export function numberDepth(onHero: boolean): number`.

- [ ] **Step 1: Write the failing test** `client/src/game/effects.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEPTH, numberDepth } from './effects';

describe('numbers and bars against the darkness', () => {
  it('draws hero numbers and bars over the darkness', () => {
    expect(numberDepth(true)).toBe(DEPTH.numbers);
    expect(numberDepth(true)).toBeGreaterThan(DEPTH.fog);
    expect(DEPTH.heroBars).toBeGreaterThan(DEPTH.fog);
    expect(DEPTH.heroBars).toBeLessThan(DEPTH.numbers);
  });
  it('draws enemy numbers and bars under the darkness, over figures and effects', () => {
    expect(numberDepth(false)).toBe(DEPTH.enemyNumbers);
    for (const d of [DEPTH.enemyBars, DEPTH.enemyNumbers]) {
      expect(d).toBeLessThan(DEPTH.tint);
      expect(d).toBeGreaterThan(DEPTH.fx);
    }
    expect(DEPTH.enemyBars).toBeLessThan(DEPTH.enemyNumbers);
  });
});
```

- [ ] **Step 2: Run it and check that it fails**: `bash -lic 'cd client && npx vitest run src/game/effects.test.ts'`. Expected: FAIL, because `numberDepth` is not exported.

- [ ] **Step 3: Implement.** In `DEPTH`: replace `heroBars: 6500` and `heroNumbers: 6501` with `enemyBars: 6500` and `enemyNumbers: 6501`, and add `heroBars: 7999`. Rewrite each comment to state the rule: enemy bars and numbers sit under the darkness and vanish where it is dark; hero and ally bars and numbers sit over it and show even when the hero is unlit. `numbers: 8000` gets a comment too: numbers on heroes and allies, coins, key caps and other top world text. Add `numberDepth(onHero)` next to `DEPTH`. In `GameScene`:
  - `this.bars` → `DEPTH.enemyBars`;
  - `this.heroBars` stays at `DEPTH.heroBars`;
  - `Dmg` and `Heal` use `numberDepth(ev.p)`;
  - update the comment above the `Dmg` case;
  - the `text()` doc comment names `numberDepth`.

  Don't change anything else that uses `DEPTH.numbers` (keycap, rules log tags, LightsDemoScene, coins).

- [ ] **Step 4: Run the tests**: `bash -lic 'cd client && npx vitest run && npx tsc --noEmit'`. Expected: all pass, tsc clean.

- [ ] **Step 5: Update the docs.**
  - TECHNICAL line 488 (draw order): name and number bars on heroes and allies are above the darkness (`DEPTH.heroBars` 7999, `DEPTH.numbers` 8000). Monster numbers and HP bars are under it (`DEPTH.enemyNumbers` 6501, `DEPTH.enemyBars` 6500), chosen by `numberDepth(Dmg.p / Heal.p)`. Add "(the user's decision, 2026-10-23)".
  - TECHNICAL line 382: allies' numbers and bar follow the hero rule.
  - TECHNICAL line 1223: rewrite the sentence about numbers on heroes and monsters.
  - PLAYER_GUIDE line 96: replace it with "Numbers and health bars on heroes and the wolf show even in the dark; numbers and health bars on enemies show only where you can see the enemy."

- [ ] **Step 6: Commit**: `git add client/src/game/effects.ts client/src/game/effects.test.ts client/src/game/GameScene.ts docs/TECHNICAL.md docs/PLAYER_GUIDE.md docs/TODO.md` and `git commit -m "Hero numbers and bars over the darkness, enemy ones under it"`.

---

### Task 2: Remove the 20 "+1 Attribute" nodes and pull the trees together

**Files:**
- Modify: `server/src/defs/trees.rs` (the `NodeId` enum, `def` arms, tests)
- Modify tests: `server/src/progress.rs`, `server/src/protocol.rs:448`, `server/src/stats.rs:653`, `server/src/sheet.rs` (tests at ~842–921 and ~1226)
- Regenerate: `client/src/generated/NodeId.ts`, `client/src/generated/progression.ts`
- Modify tests: `client/src/ui/hub/model.test.ts`, `client/src/ui/hub/tree.test.ts`

**Interfaces:**
- Produces: `NodeId` without `WA1 WA4 WR4 WB1 WB2 WB6 PU1 PU4 PL2 PR2 PD1 PD4 BU1 BU4 BL3 BD1 BD4 EU2 EL1 ER4`, the rest renumbered `0..=62` in today's order (`listed_enum!` checks that the ids are contiguous). `NodeKind::Attr` still exists after this task (Task 3 removes it), but no node uses it.

The new layout. Only the changed fields are listed; everything else stays as it is today.

| Node | New `pos` | New `links` |
|---|---|---|
| `W0` | | `WA2, WF1, WR1, WB3` |
| `WA2` | (0, -1) | `WA3` |
| `WA3` | (0, -2) | |
| `WA5` | (0, -3) | |
| `WR2`, `WR3` | | `WR5` |
| `WR5` | (3, 0) | |
| `WB3` | (0, 1) | |
| `WB4` | (0, 2) | `WB5` |
| `WB5` | (0, 3) | |
| `P0` | | `PU2, PL1, PR1, PD2, PD3` |
| `PU2` | (0, -1) | `PU3` |
| `PU3` | (0, -2) | |
| `PU5` | (0, -3) | |
| `PL1` | | `PL3` |
| `PL3` | (-2, 0) | |
| `PR1` | | `PR3` |
| `PR3` | (2, 0) | |
| `PD2` | (-1, 1) | none |
| `PD3` | (1, 1) | none |
| `B0` | | `BU2, BL1, BR1, BD2, BD3` |
| `BU2` | (0, -1) | `BU3` |
| `BU3` | (0, -2) | |
| `BU5` | (0, -3) | |
| `BL1` | | `BL2` |
| `BL2` | (-2, 0) | |
| `BD2` | (-1, 1) | `BD5` |
| `BD3` | (1, 1) | `BD5` |
| `BD5` | (0, 2) | |
| `E0` | | `EU1, EL2, EL3, ER1, ED1` |
| `EU1` | | `EU3, EU4` |
| `EU3` | (-1, -2) | |
| `EU4` | (1, -2) | |
| `EU5` | (0, -3) | |
| `EL2` | (-1, -1) | |
| `EL3` | (-1, 1) | |
| `EL4` | (-2, 0) | |
| `EL5` | (-3, 0) | |
| `ER2`, `ER3` | | none |

- [ ] **Step 1: Update the tree tests in `trees.rs` so they fail.**
  - `trees_have_the_spec_sizes_and_totals` gets `(Wizard, 16, 8950), (Paladin, 13, 7650), (Barbarian, 15, 7950), (ElvenRanger, 15, 7800)`.
  - New test `the_start_nodes_lead_to_the_pulled_together_branches`: `neighbours(start(c))`, sorted, equals the sorted `W0`/`P0`/`B0`/`E0` link lists from the table, and `def(NodeId::WA5).pos == (0, -3)`, `def(NodeId::BD5).pos == (0, 2)`, `def(NodeId::EL5).pos == (-3, 0)`.
  - `gains_add_up` uses `[WF3, WA3, WA2, WA5]` and drops the `attrs` line.
  - In `buying_needs_a_neighbour_and_the_requirements`, `WA2` is "next to the start" and `WA3` is "no owned neighbour" with `&[]`. `WA3` with `&[WA2]` and INT 15 fails on "INT 18". "owned" is `WA2` with `&[WA2]`. "other class" is `WA2` for the Paladin.

  Run `cd server && cargo test --lib defs::trees`. Expected: compile errors or failures.

- [ ] **Step 2: Implement the table.** Delete the 20 variants and their `def` arms, and renumber the rest `0..=62` in order. Apply the `pos`/`links` changes above. Fix the compile errors in other tests (next step).

- [ ] **Step 3: Rewrite the other server tests that name a removed node, keeping what each one tests.**
  - `progress.rs` `stale_ids_are_dropped_not_the_document`: buy `WA2` instead of `WA1`.
  - `nodes_of_another_class_or_the_start_are_dropped`: input `["WA3","B0","W0","BU2","WA2","WA2","WA1"]` gives `[WA2, WA3]`.
  - `buying_nodes`:
    - `WA3` gives "Buy a neighbouring node first.";
    - `WA2` costs 300 (`xp_spent` 300);
    - buying it twice gives "already have";
    - then buy `WB3`, so `p.nodes == [WA2, WB3]`;
    - `WA3` needs INT 18: class 15 plus two shop points is 17, so it is refused and nothing changes; a Ring of Insight makes 18, so it is bought;
    - "Not enough XP" on `WA5`.
  - `respec_refunds_resets_and_charges`: nodes `WA2, WB3` (600 XP), so `xp_spent == 475 + 600` and the price is `20 + 1075 / 50`. Buy `WA2` again in the "too few coins" part.
  - `apply_dispatches`: `BuyNode(WA2)`.
  - New test `a_removed_node_is_dropped_and_its_xp_stays_spent`:
    - take `Progress::new(W).to_json()`, set `nodes = ["WA1","WA2"]`, `xp_spent = 500`, `xp = 0`;
    - `from_json` gives `nodes == [WA2]` and `xp_spent == 500`;
    - give it 100 coins, then `respec(W)` gives `xp == 500`;
    - second half: `nodes = ["WA4","WA5"]` gives `[WA5]`, and `sheet::hero_sheet(W, &q.build(W))` is `Ok`.
  - `protocol.rs:448`: `"WA2"` and `NodeId::WA2`.
  - `stats.rs:653`: `["WA2","WA3"]` (still 2 nodes).
  - `sheet.rs`:
    - rename `tree_points_resistances_and_proficiencies_reach_the_sheet` to `tree_resistances_and_proficiencies_reach_the_sheet`, with nodes `[WF1, WF3, WB3]`. It asserts INT and max HP are equal to the start, keeps the cold resistance check, and the robe uses `[WB3]`;
    - `improvements_apply_only_to_the_equipped_ability`: Greater Light is `nodes: [PU2]`, compared with `plain.secondary.damage * 1.25` (drop the `cha` build);
    - `an_item_version_gets_the_tree_improvement_too`: `[WA2]` (fix its comment);
    - `attrs_with_and_without_items` and `summary_lists_sources`: `nodes: vec![]`, so CHA is the class 14. In `summary_lists_sources`, `cha` gives `(14, 0, 0, 0, 14)`.

- [ ] **Step 4: Run the server tests**: `cd server && cargo test -- --skip export_bindings`. Expected: all pass, and the fingerprint tests are unchanged.

- [ ] **Step 5: Regenerate and fix the client tests.** Run the docker suite (Global Constraints). Expected: all pass, and `git status client/src/generated` shows only `NodeId.ts` and `progression.ts` changed. In the client tests:
  - `model.test.ts`: `'WA2'` is buyable and `'WA3'` locked. The blocked case uses `nodes: ['WA2']` and keeps `WA3` blocked with `'needs INT 18'`.
  - `tree.test.ts`: hover `'WA2'`.

  Run `bash -lic 'cd client && npx vitest run && npx tsc --noEmit'`. Expected: pass.

- [ ] **Step 6: Commit** the server, generated and client test files: `git commit -m "Skill trees: remove the +1 Attribute nodes, pull the branches together"`.

---

### Task 3: Remove the Attribute node type end to end, plus the docs

**Files:**
- Modify: `server/src/defs/trees.rs` (`NodeKind::Attr`, `TreeGains.attrs`, `gains`, and the unused `Attr`/`Attributes` imports if any)
- Modify: `server/src/sheet.rs` (line 260 `attrs_without_items`/start attrs; line 628 summary; `AttrLine.tree` at line 466 and its use)
- Modify: `server/src/export.rs:244` (the `"Attr"` arm, the `attr` field of tree nodes)
- Regenerate: `client/src/generated/` (`AttrLine.ts`, `progression.ts`)
- Modify: `client/src/ui/hub/model.ts:14,16` (`TreeKind` without `'Attr'`, `TreeNode` without `attr`)
- Modify: `client/src/ui/hub/tree.ts` (`NODE_SIZE`, `label` `case 'Attr'`, `KIND_LABEL`, the legend line 122, the `ATTR_ORDER`/`Attr` imports if they become unused)
- Modify: `client/src/ui/screens.css` (`.k-attr` rules around 567–640)
- Modify: `client/src/ui/hub/sheet.ts:26` (drop `tree +N`), `client/src/ui/hub/fixture.ts:55` (drop `tree: 0`)
- Docs: `docs/TECHNICAL.md` (§11a line 801 "Attribute nodes", line 879 "83 nodes" → 63, line 919 "How to add a tree node" if it lists kinds), `docs/PLAYER_GUIDE.md:308` (the Sheet line's sources: class and race, XP you bought, your items), `docs/TODO.md:45` (done, 2026-10-23, 20 nodes), `HANDOFF.md` "Next session" (short "done" note, with the ruling from Review Focus 2)

**Interfaces:**
- Consumes: Task 2's trees (no node uses `NodeKind::Attr`).
- Produces: `NodeKind { Start, Unlock, Improve, Proficiency, Resist, Keystone }`; `TreeGains` without `attrs`; `AttrLine { attr, total, class, shop, items }` (where `items = total - class - shop`); the exported tree node has no `attr` field; `TreeKind = 'Start' | 'Unlock' | 'Improve' | 'Proficiency' | 'Resist' | 'Keystone'`.

- [ ] **Step 1: Write the failing assertion.** In `sheet.rs` `summary_lists_sources`, change the tuple checks to `(cha.class, cha.shop, cha.items, cha.total) == (14, 0, 0, 14)`, `(str_.shop, str_.items) == (1, 0)`, `(con.shop, con.items) == (0, 1)`, and the sum loop to `l.total == l.class + l.shop + l.items`. Run `cargo test --lib sheet::`. Expected: it does not compile while `AttrLine.tree` still exists, or it fails on the sum.

- [ ] **Step 2: Implement the server side.**
  - Remove `NodeKind::Attr`, `TreeGains.attrs` and its `gains` arm.
  - In `sheet.rs`, the attrs are `start_attrs(class).plus(b.extra)` (the doc comment says the tree no longer adds Attributes); drop the `tree` column from `AttrLine` and the summary.
  - Remove the export arm and the `attr` field.

  Then run `cargo build` (expect 21 warning lines) and `cargo test -- --skip export_bindings` (expect pass).

- [ ] **Step 3: Regenerate.** Run the docker suite. Expected: pass, and `AttrLine.ts` and `progression.ts` have changed.

- [ ] **Step 4: Implement the client side** from the Files list. Then run `bash -lic 'cd client && npx vitest run && npx tsc --noEmit && npm run build'`. Expected: all pass. Also run `grep -rn "k-attr\|'Attr'\|\.tree\b" client/src --include=*.ts --include=*.css | grep -v generated`. Expected: no hit that refers to the removed node type. `'tree'` as a hub tab name is fine.

- [ ] **Step 5: Smoke test**:
  1. `docker compose up -d --build`;
  2. `bash -lic 'cd tools/e2e && BROWSER=/usr/bin/brave-browser node smoke.mjs http://localhost:8080/ "" <outdir> ElvenRanger,Paladin'`, then again with `Wizard,Barbarian` (argv: base, query, output dir, classes);
  3. open `0-hub-tree.png` and check that the Wizard's tree is centred and shows no grey Attribute nodes;
  4. check: no browser errors, and correction 0.00 px.

- [ ] **Step 6: Update the docs** listed under Files.

- [ ] **Step 7: Commit**: `git commit -m "Remove the Attribute node type; docs"`.
