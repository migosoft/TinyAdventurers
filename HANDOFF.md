# Handoff — Tiny Adventurers

For: the next agent or developer continuing this project. Read this first, then the linked docs.

## Read in this order

1. [README.md](README.md): what the game is, how to run it, dev helpers.
2. [docs/TECHNICAL.md](docs/TECHNICAL.md): architecture, protocol, simulation, netcode, rendering, how to extend, tests, known limitations.
3. [docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md): the game as players see it (classes, enemies, bosses). Keep it in sync when gameplay changes.
4. [docs/TODO.md](docs/TODO.md): open work and follow-ups (balancing pass, loadouts, art gaps).

## Next session

**TODO 4b is done (2026-10-19, `feature/skill-tree-design`, commits `c771651..` after the plan commit; plan [docs/superpowers/plans/2026-10-19-resistances.md](docs/superpowers/plans/2026-10-19-resistances.md)).** One resistance system: every effect without a damage type has an effect resistance in % (`EffectResistances` next to the damage resistances in each race and `Adjust`, folded into `Profile`; 100 % refuses, 50 % halves after the save, a negative value at most doubles; `Stat::ResistEffect` for future effects). `EffectResponse` is gone. "Damage-type effect" naming (`TYPE_EFFECTS`, `type_effect_hit`, …). `DamageType` and `EffectKind` are declared with `listed_enum!` (`ALL`/`COUNT` from one list, a compile error on a gap in the ids); TECHNICAL §11 has "How to add a damage type". Enemy and boss HP no longer scale with party size: `simulation_is_unchanged_after_waking_the_boss` was re-recorded once (two heroes in that run); `level_setup_is_unchanged` is unchanged. Part A left both fingerprints unchanged. **Verified:** server 366 tests pass with `cargo test -- --skip export_bindings` (the 55 ts-rs export tests cannot write `client/src/generated` inside the agent sandbox; run the full `cargo test` once outside it), no warnings; client 92 tests, typecheck and build pass.

**Progression plan 2 is done (2026-10-21, `feature/skill-tree-design`, commits `1509ded..47714d3` plus the "Progression plan 2: docs" commit; plan [docs/superpowers/plans/2026-10-21-progression-2-weapons-and-items.md](docs/superpowers/plans/2026-10-21-progression-2-weapons-and-items.md)).** Weapon kinds and categories, 36 item defs (`defs/weapons.rs`, `defs/items.rs`, `defs/requirements.rs`), class proficiencies and starter equipment, the sheet folding equipment in (`hero_sheet` takes an `Equipment`), weapon damage shares and on-hit effects riding only on that weapon's attacks, item lights, `Member.equipment` (starters from `lobby.rs`), enemy weapons and races' natural weapons. Technical description: TECHNICAL §11a ("Weapons, items and equipment", "How to add a weapon", "How to add an item"). Both fingerprint tests pass unchanged; nothing was re-recorded and the game plays as before with the starters. **Verified:** server 394 tests with `cargo test -- --skip export_bindings`, docker suite (`docker-compose.test.yml`) 449 pass including the export tests, `client/src/generated` unchanged; 19 build warnings, the same as at the start commit `76c84f5`, and 0 clippy warnings; client 92 tests and typecheck pass; e2e smoke (`tools/e2e/smoke.mjs`, rebuilt containers) for ElvenRanger,Paladin and Wizard,Barbarian: no browser errors, correction 0.00 px.

**Next: progression plan 3 (abilities, the melee rule, overkill piercing, the 16 new abilities; spec §6.3–6.6, §7 melee rule),** written with superpowers:writing-plans just before it is built. Items with effect properties use `PropKind::EffectResist(kind, value)` on the new system. **What plan 2 deferred (scope decision 2), for plans 3 and 4:**
- Plan 3: `PropKind::GrantAbility` and `AbilityMod` (they need the loadout pool); `Requirement::WeaponKind` (only abilities use it); the melee rule and the unarmed strike for archers, with the enemy staffs only the melee rule uses; Charge = weapon × 0.8 and the Great Axe's reach of 22 (the ability merge; it removes the empty-slot fallback to the starters).
- Plan 4: `PropKind::Aura` (needs a per-tick area layer and a rule for HP when you walk in or out of a max-HP aura); drawing heroes with their equipped weapons; `DebugGrantItem`; `Progress` v2 storing equipment.
- Not planned: boss weapons (their scripts keep their constants, spec §7).
- **Shields (pinned by the user, 2026-10-21):** an off-hand item characters can carry. The slot and `ItemBase::Shield` are reserved; no shield art exists yet. See TODO "Shields". Do not build them in plan 3.

**How to resume (next session):** the branch `feature/skill-tree-design` is at the "Progression plan 2" commits, **local only, not pushed** (push when the user says). Start with superpowers:writing-plans for plan 3, from the spec §6.3–6.6 and §7 (melee rule) and the carry-overs below. The ranger's tree draft (`?uidemo=tree-ranger`) still waits for the user's approval; it matters from plan 4 on. Verify with `cd server && cargo test -- --skip export_bindings` (the crate is bin-only: focused runs use `cargo test --bin '*' <filter> -- --skip export_bindings`).

**Carry-overs from plan 2's final review (for plan 3/4):**
- Plan 3 first step: build each enemy's `attack`/`alt` from its `melee_weapon`/`ranged_weapon` fields (today the id is written twice in `enemies::def`; drift risk), or test that they rebuild from the fields.
- Plan 3 Shoot: spawn the ranged weapon's `projectile` (`sheet.ranged.projectile`), not a hard-coded `EntityKind::Bolt`.
- Plan 3: make `hero_power` in `run/abilities.rs` exhaustive over `EquipSlot` (today `Some(_) => sheet.melee.power`).
- Plan 3: callers of `DamageSplit::with_shares` (AbilityMod shares) should `debug_assert!` no Physical entry.
- Plan 3 tests: a ranged-weapon property never reaches melee; the bolt takes `sheet.ranged` split/on-hit; the dash takes `sheet.melee.on_hit`.
- Plan 3: hero melee swings ignore `ResolvedWeapon.push` (decide in the ability merge); drop the exported `DAGGER_COOLDOWN` (client reads `info.fallback.cooldown`).
- Plan 4: `equip` must validate with `check_equipment` against the Attributes without items before saving (`hero_sheet` only debug-asserts; `arm` panics on a non-weapon in a weapon slot).
- Cosmetic leftovers: redundant `#[allow(dead_code)]` on `ItemBase::Shield`, mid-module `use` and redundant imports in items.rs tests, the comment on the `SummonWolf` arm in `abilities::scaling()`.

**Merge done (2026-10-19):** `origin/feature/elven-ranger` (Elven Ranger, Dire Wolf, breakable chests) was fast-forwarded into local `main` (`c5b3860`, **not pushed**), and `main` was merged into `feature/skill-tree-design`.

**Progression: designed and approved, plan 1 built (branch `feature/skill-tree-design`):**
- Attributes, races, weapons and items, class skill trees, loadouts and a new pre-run UI.
- **Spec:** [docs/superpowers/specs/2026-10-18-progression-design.md](docs/superpowers/specs/2026-10-18-progression-design.md), with screenshots in `docs/superpowers/specs/img/2026-10-18-progression/`. **Updated 2026-10-19 for the Elven Ranger** (section "Changes for the Elven Ranger" at its end): the user chose class DEX 13 + Elf race DEX +2, a stat block for the Dire Wolf, and asked the agent to draft the ranger's tree. **The ranger's tree and her four new abilities (Volley, Flanking Thrust, Entangle, Poison Coat) are a draft awaiting the user's approval** (`?uidemo=tree-ranger`); it only matters from plan 3 on.
- **Plan 1 of 5:** [docs/superpowers/plans/2026-10-18-progression-1-attributes-and-sheet.md](docs/superpowers/plans/2026-10-18-progression-1-attributes-and-sheet.md). **Re-checked against the merged code on 2026-10-19** (races take over `responses`, the wolf's stat block and push power, the 60 s wait without `mods`, the Sleep test on the Paladin).
- **Mock screens (throwaway spike):** `?uidemo=roster|create|sheet|tree|tree-barbarian|tree-ranger|equipment|loadout|room` (`client/src/uidemo/`); shots with `tools/e2e/ui-shots.mjs`.
- **Plan 1 of 5 is built** (2026-10-19, commits `906774f..b895198` on `feature/skill-tree-design`; `b895198` is the "Progression plan 1: re-recorded fingerprints, docs" commit, and a final-review fix wave follows it). Attributes, races, stat blocks, the character sheet, pushes by STR against weight and effect durations by power against save; no new UI. Technical description: TECHNICAL §11a ("The character sheet and Attributes"). Both fingerprint tests pass unchanged (see the dated comment next to `simulation_is_unchanged_after_waking_the_boss`); nothing was re-recorded. Verification numbers are in `.superpowers/sdd/2026-10-18-progression-1-attributes-and-sheet/task-9-report.md`. `attr_price` and `ATTR_WEIGHT` wait for plan 4.
- **Next, in this order:**
  1. The user approves (or changes) the drafted ranger tree; not needed before plan 2.
  2. Write and build each next plan with superpowers:writing-plans, **one at a time, just before building it**: plan 2 weapons and items (spec §6.1–6.2, §8), next; plan 3 abilities, the melee rule, overkill piercing, the 16 new abilities (§6.3–6.6, §7 enemy melee rule); plan 4 skill trees, Attribute shop, `Progress` v2, respec, protocol (§2, §9, §11, §12); plan 5 the new UI, deleting the spike (§13).
- **What a play-test will notice** (all intended, from the weight and save rules):
  - The lich's effects last about 1.4 to 1.5 times longer on the heroes.
  - The Wizard's E pushes a barrel half as far (24 px).
  - Barrels and the wolf no longer move the ogre (weight 20).
  - Enemy hits push the Paladin and Barbarian less.
  - Element burns and freezes are a bit shorter on high-CON targets.
  - Fireball and fire-boss burns last longer (the user's ruling, 2026-10-19: element effects use the source's governing Attribute, at least 10; spec §5).
  - A resisted fire hit still thaws ice (the user's ruling, 2026-10-19: a cancel runs before the resistance check).

**Other open items:**
- **The user's play-test of the ranger** (see "Last feature (2026-10-16): Elven Ranger and the Dire Wolf", "Still to play"); follow-ups in TODO "Elven Ranger follow-ups".
- **Push `main`** when the user asks (local `main` is ahead of `origin/main` by the ranger and the breakable chests).
- **Pillars** (TODO section): free-standing wall tiles in large rooms, also as torch mounts.
- **Breakable chests** are built (see below). The user is still thinking about bodies blocking movement; do not build that.
- **Server load** (TODO priority 16): measure, then cache each hero's view while nothing changed and share it with spectators. The ranger's 18-tile vision makes each view dearer. Before any public launch.
- Still to do with the user from before: a real play-test of the lich fight (orbs, stone gaze) and of fire in the demon and dragon dungeons.

## Breakable chests (built 2026-10-16)

**Branch:** `feature/breakable-chests` (from `main` at `5857780`), worked in the worktree `.claude/worktrees/breakable-chests` while another agent built the Elven Ranger in the main checkout. **Merged** into `feature/elven-ranger` (`29cd62a`); `main` was fast-forwarded to it (`5eab088`), local only, not pushed. Decided with the user in chat (small change, no spec); the decisions are in TODO "Chests, mimics and coins follow-ups".
- **Why:** hitting every chest once was a free mimic test.
- **What:** any hit that gets through smashes a closed chest (`objects::break_chest`): `Boom k 8` splinters, a third of a `CHEST_COINS` roll for the party (`BROKEN_CHEST_SHARE`). A closed chest stops shots (`WorldObject::stops_shots`) and is a dagger target (`DaggerTarget`), like a hidden mimic. Client: the cosmetic shot stops at closed chests (`HITBOX` now has the chest), the dagger prediction counts them, `Effects.splinters`.
- **Merge with the ranger:** both branches touch `run/abilities.rs` (`dagger_target`: the ranger adds an ally skip there; keep both), `GameScene.ts` (dagger prediction) and the docs. The TODO/handoff commit `a898f22` landed on `feature/elven-ranger` by accident (the other agent had switched the main checkout); this branch has the same change cherry-picked.
- **Verified:** server **331 tests** (324 before, 7 new in `run/objects.rs`), no warnings, fingerprints unchanged; client **84 tests** (one hitbox test changed: a chest now stops shots exactly like a mimic), typecheck and build pass. **Not looked at live:** the splinter burst and breaking chests in a real run.
- **Test isolation:** the test compose file has a fixed project name and shared cargo target volume; the parallel runs used `-p ta-chests-test` and an override mounting the volume `ta-target-chests`.

## Last feature (2026-10-16): Elven Ranger and the Dire Wolf

**Branch:** `feature/elven-ranger` (from `main` at `5857780`), `git log --oneline main..feature/elven-ranger`. Built task by task with subagent-driven development (12 tasks, each reviewed, then a final whole-branch review). **The full technical description with every decision and its reason:** [docs/superpowers/reports/2026-10-16-elven-ranger-implementation.md](docs/superpowers/reports/2026-10-16-elven-ranger-implementation.md) (the working ledger was deleted after the final review; the report replaces it). **Pushed to `origin/feature/elven-ranger`, not merged into `main`**; another agent takes over the merge. Local `main` is at `5eab088` (breakable chests), which is not pushed yet. `main` (breakable chests) was merged into it (`29cd62a`). Spec: [docs/superpowers/specs/2026-10-16-elven-ranger-design.md](docs/superpowers/specs/2026-10-16-elven-ranger-design.md); plan: [docs/superpowers/plans/2026-10-16-elven-ranger.md](docs/superpowers/plans/2026-10-16-elven-ranger.md). Docs: PLAYER_GUIDE (the ranger and her wolf), TECHNICAL §5 ("Hiding and dormant", "Companions", entity types), §4 (`Growl`, `Boom k 9`), §7 (sound text rule, next to the draw order), TODO (4a done, "Elven Ranger follow-ups").

**How it came about:** the Assassin's art is an elf, so the user turned the class into the **Elven Ranger** and dropped the restyle (TODO item 9). The ranger is the "elven archer" of TODO item 8. All settled with the user; the decisions are in the spec.

**What was built:**
- **The class:** `ClassId::ElvenRanger` (`EntityKind::ElvenRanger` stays id 3), same `elf_m` art, 90 HP, speed 80, primary `CrossbowDagger` ("Bow / Rapier": the melee thrust is drawn with the rapier `weapon_duel_sword`). Entity type **Elf**: 10 % poison, vision 18 tiles, darkvision 1/3, immune to Sleep. Migration `0005_elven_ranger.sql` wipes characters and statistics (the user approved; accounts stay) and changes the class CHECK.
- **Hide is gone** everywhere (`AbilityId::Hide`, `Player.hidden`, `flags::HIDDEN`, `SelfState.hidden`, the client shimmer and predictor, text). It may return later as an invisibility effect.
- **Entity types carry effect responses** (`entity_types::responses`): Elf and the new **Magical Beast** (10 % poison, 10 % magical, 80/20 physical/magical melee, vision 18, darkvision 100 %, immune to Sleep).
- **`hiding` split from `dormant`** (`Monster.hiding`, `FLAG.HIDING` 1): the mimic is hiding; the boss before its fight and the lich's disciples stay dormant.
- **The Dire Wolf** (secondary, `AbilityId::SummonWolf`, 8 s; 60 s after its death): summon with a green puff (`Ev::Boom { k: 9 }`; k 8 is the chest splinters from the breakable-chests feature), or heal 20 %. 80 HP, bite 10 per 0.9 s, speed 88. It follows, guards (enemies within 3 tiles of the ranger), fights back, dashes at prey (4 tiles, 20 damage, 5 s; it jumps chasms, and an attack dash that would end over a chasm carries on to solid ground), reappears beside the ranger when far or locked out, vanishes when she falls, and **growls** (`Ev::Growl { id }`, wire code 14) at awake and hiding enemies it detects. Art: Superdark's Enchanted Forest `Wolf` (CC0), trimmed in the atlas as `dire_wolf_idle_anim_f0-3` and `dire_wolf_run_anim_f0-3`; its union box is 30×19 px.
- **First allied creature:** an ordinary `Monster` with `ally: Some(Ally)`. Hero attacks never hurt it (a safety net in `hurt_monster`, plus a skip and a test per attack). Enemies and area attacks target heroes and allies through `Creature`, `foes_in` and `foes_touching`. Its kills count as the ranger's; its death pays nothing.
- **Sound text above the darkness:** `SOUND_TEXT` (dark fill `#1a1020`, light outline `#d8d0e0`) at `DEPTH.sound` 7500, for the growl and the sleeper's Z. The plan's pale fill vanished inside the pale outline, so the fill is dark.

**Code map (real code):**
- Server: `run/companion.rs` (`spawn_wolf`, `use_ability`, `vanish_orphans`, `tick_wolf`, `tick_growl`, `tick_dash`, `find_prey`, `reappear`, `dash_back`, `wolf_died`), `defs/companions.rs` (the `WOLF_*` numbers, `wolf_profile`, `wolf_responses`), `defs/entity_types.rs` (Elf, Magical Beast, `responses`), `run/entities.rs` (`Ally`, `WolfDash`), `run/mod.rs` (`foes_in`, `foes_touching`, `hurt_creature`, `heal_monster`; `kill_monster` calls `wolf_died`), `run/ai.rs` (`find_visible_foe`, `Target::Ally`), `run/visibility.rs` (`snapshot_ents`, `flags::HIDING`).
- Client: `game/anim/defs.ts` (`isAllyKind`, `FIGURES[DireWolf]`), `game/GameScene.ts` (`Growl` handler and shake, `Boom k 9`, `SummonWolf` prediction, the dagger prediction skips allies), `game/effects.ts` (`DEPTH.sound`, `SOUND_TEXT`, `natureSparkles`), `game/status.ts` (the Z), `ui/hud.ts` (`secondaryLabel`), `scripts/wolf-frames.ts`.

**Verified (2026-10-16):**
- Server: **364 tests pass** in Docker, no warnings.
- Client: `tsc --noEmit`, **89 tests** and `npm run build` pass.
- `docker compose up --build -d` and `/health` are OK.
- Smoke test `cd tools/e2e && node smoke.mjs http://localhost:8080/ "" shots ElvenRanger,Paladin` (the class argument is the wire name; the script lowercases it for the card `c-elvenranger`): "no browser errors". The screenshots show the ranger card with the wolf's ability, the elf with her wolf in the run, the HUD box reading "Heal Wolf", and F3 darkvision 33 %.
- Seen earlier by the controller: the gallery (the wolf next to the heroes, dash afterimages), the growl and the sleeping Z in the dark.

**Still to play (the user; these could not be scripted):**
- The wolf's health bar **hidden under the fog in the dark** (it should vanish with the wolf on unlit tiles).
- The **18-tile light and mask seam in a large room** (the ranger's vision reaches beyond the screen; the polygon, the mask canvas and the camera window were checked only in small cases).
- The wolf's **death message and the 60 s fill in the HUD**.
- An **archer shooting the wolf from range** (the wolf fights back only against enemies within 1.5 tiles of itself, or within 3 tiles of the ranger), and a look at `?mimic`.
- A **real play of the ranger with the wolf**: the feel of follow, guard, dash and growl, and whether the `WOLF_*` numbers are right.

**Rulings worth knowing:**
- The wolf's union box is 30×19 px, not the spec's 26×17 (a scale factor in `FIGURES` if it looks wrong).
- The puff is `Boom k 9`.
- A ranger who is sinking but still alive keeps her wolf until she dies.
- The UI shows the class as "Elven Ranger" (`className()` in `ui/text.ts`); the wire value "ElvenRanger" stays for CSS classes and keys.

**Follow-ups** (details in TODO "Elven Ranger follow-ups"): a non-attack dash stopped over a chasm can still sink; a wolf frozen mid-dash hovers over a chasm; `run/companion.rs` is about 1300 lines with its tests inline (split them); no vispoly parity fixture at radius 18; several tests are thin (listed there).

## Art and idea notes (2026-10-16)

**Art sources (TODO priority 3, done 2026-10-16, on `main`, commits `7767778..62b53f3`):** three packs checked, imported and credited; no figure is built into the atlas yet, each goes in with the feature that uses it.
- **Licences** (quoted in each `LICENSE.txt` and in TODO "New enemies"): "16x16 Enchanted Forest Characters" by Superdark is CC0 (gnolls Brute, Overseer, Scout, Shaman; bandit; elves; the elf princess). "16x16 Fantasy RPG Characters" by Superdark (free NPC pack, registered at the user's request) has no formal licence but allows free and commercial use and changes. "Forest creatures" by LYASeeK is free to use, not to resell.
- **Files:** `client/assets-src/enchanted-forest/` (`sheet.png` + `frames/<figure>/`), `fantasy-npcs/` (`knights.png` + `frames/<figure>/`, from the per-figure folders because the pack's "All" folder misses the male townsfolk), `forest-animals/` (`Outline/`, `Without outline/`, `aseprite/`). Superdark frames are 32×32 canvases (golem 64×64), idle and walk only; `build-atlas.ts` needs a loader that trims them. The forest animals are softer than the 0x72 look: preview them next to the heroes first.
- **Inbox:** the user's downloads are in the untracked `downloaded-assets/` (like `images/`); every file used has a committed copy. Do not commit or delete it.
- **Credits:** the README "Art" section has a "Credits" list for every third-party source; the user wants every source credited even where no credit is required.
- **Postponed by the user (2026-10-16):** the ghost and the shadow (no free art source; options in TODO "New enemies"). The sphinx has no free source either; Enchanted Forest's hermit wizard or forest guardian could be the riddle-giver.

**Explosion art (2026-10-15):** the user supplied two ChatGPT explosion sheets, stored in `client/assets-src/explosion/`: `explosion_source.png` (barrel blast) and `fireball_source.png` (the wizard's Fireball, violet). Every file the user dropped in `images/` (these two and the barrel source) has an identical committed copy in `client/assets-src/`, so the user may delete `images/` (they asked, 2026-10-15). Neither sheet is built in; both are on the TODO list with low priority ("Barrels and world objects follow-ups"). Credit them as "AI-generated with ChatGPT for this game".

**Healing circle (2026-10-15):** the user wants a better healing-wave effect: many more sparkles, maybe runes on the circle's edge that spread with it. On the TODO list ("Other follow-ups", tier 3 item 13). The runes need art; ask the user where it comes from.

**Ideas the user liked** (not yet in TODO; ask before adding): ways to bring light. Early on, carry a wall torch, light braziers, find glow items (mushrooms, flares). Later, class gear and spells: the paladin's glowing shield, the wizard's light orb, a wisp companion, the ranger's flare arrows, and the rogue who prefers the dark. Before any hero light: a dead hero's light must switch off and come back on a revive (the registry drops it today).

## Feature before (2026-10-16): straight vision edges

**Branch:** `feature/vision-edges` (from `main` at `3555d68`), commits `git log --oneline main..feature/vision-edges`: part 1 (spec, plan, polygon, mask, demo, docs), then part 2 after the final review (spec addendum, plan part 2, the `View` rule in TypeScript, the Rust port in the snapshot filter, the shared fixture and the client switch, docs). Built inline with superpowers:executing-plans, reviewed twice by a fresh reviewer (part 1, then part 2; the second review's edge-shading finding is fixed). **Merged into `main` and pushed (2026-10-16).** Deferred minors: a torch on a wall in the polygon's shadow can vanish while its light stays (the server decides by the floor tile in front of the wall); the server cost per snapshot is not measured (TODO priority 16). Spec: [docs/superpowers/specs/2026-10-16-vision-edges-design.md](docs/superpowers/specs/2026-10-16-vision-edges-design.md); plan: [docs/superpowers/plans/2026-10-16-vision-edges.md](docs/superpowers/plans/2026-10-16-vision-edges.md). Docs: TECHNICAL §7 "The vision mask", draw order, §12, §13; TODO (priority 2 done, "Vision edges follow-ups", "Pillars"); README (`?lights`).

**How it came about:** a throwaway spike first (branch `spike/vision-edges`, deleted after the merge at the user's request). The user looked at the demo and decided:
- **Crisp edges, no blur.** A 3/4-tile fade made the shadow behind a pillar flare out.
- **Out of sight stays pure black.** A dim map memory and a drifting fog were demoed and rejected.
- **Pillars** go onto the TODO list as their own feature, with torch mounts.

**What was built:**
- `sim/vispoly.ts` (pure, tested): `wallSegments` merges wall edges facing open tiles; `visibilityPolygon(map, px, py, r)` casts rays to every segment end (± 1e-4 rad) and at 96 even angles, each stopping at the nearest segment or at `sightRadius(vision)` = `(vision + 0.5) × TILE` px.
- **One "seen tiles" rule on both sides (part 2):**
  - `View` (`sim/view.ts`, `server/src/vispoly.rs`): open tiles count when any of 16 sample points lies inside the polygon; walls count by the tile FOV.
  - The server's snapshot filter uses it (`Player.view` replaced `Player.fov`), computed from the viewed hero's pixel position.
  - The client lights exactly those tiles.
  - The shared fixture (`view` cases, 5 pixel positions) pins the TypeScript port to the Rust one. The tiles and points match exactly.
  - Enemy perception and darkvision are unchanged.
- `game/visionmask.ts`: a canvas over the camera window (+2 tiles) at 8 px per tile, with the view's polygon plus its walls in white. A Phaser `Shader` game object at `DEPTH.fog + 0.5` draws black where it is not white. It redraws when the window or the view's version changes.
- `LightView`: `LightView.view`, recomputed when the viewer moves (0.1 px), the vision changes or the map changes. The light canvases use `seenForLight` (the view plus open tiles next to it, so grazed tiles do not shade the edge into notches; a second-review fix). `wide` off means the old FOV edges.
- `GameScene`: the view follows `camX`, `camY` (the own figure, or the spectated teammate) with the snapshot's vision; `Ev::Tile` calls `mapChanged` on both.
- `?lights`: two pillars, click moves the viewer (`&at=x,y`), E toggles old and new edges (`&edges=old`). `tools/e2e/lights-shot.mjs` takes an extra query and a file prefix.

**Why part 2:** the first final review found black floor inside the drawn polygon. The client lit only the tile FOV plus one ring, cast from the tile centre, while the polygon is cast from the pixel position. Behind a near corner the two drift apart, which left a black wedge with tile steps (up to about 7 tiles in a doorway). The user chose to move the server to the same polygon.

**Verified (2026-10-16):**
- Server: **324 tests pass** (317 before; 7 new in `vispoly.rs`), no warnings. Fingerprints, the spectator test and the torch test are unchanged.
- Client: `npm test` **83 tests pass** (65 before the feature); `npm run typecheck` clean; `npm run build` passes.
- The polygon costs **0.051 ms** (Node, every floor tile of the fixture map, vision 9).
- `?lights` screenshots (pillars, doorway, beside the corridor mouth `&at=10.9,8.4`, darkvision 1): no black wedges.
- Smoke test with two players (Wizard, Paladin) against the rebuilt Docker game: no browser errors, straight edges in the game.

**Not checked live:** a window resize in the game (the mask only grows; code reading and the reviewer agree) and the spectator view after death (the existing spectator test passes on the server). The frame time while walking was not measured (the mask redraws and uploads nearly every frame then).

**Open (for the user):** look at it in a real run, then decide on the merge.

## Feature before (2026-10-15): the effect system

**Branch:** `feature/effects` (from `main` at `12acb8f`), its commits are `git log --oneline 12acb8f..main` (the first five effects, then the elemental effects, each with docs and final-review fixes). All tasks built and reviewed one by one; both final whole-branch reviews (first five effects, then the elemental part) done and fixed. **Merged into `main` and pushed (2026-10-15).** Spec: [docs/superpowers/specs/2026-10-15-effects-design.md](docs/superpowers/specs/2026-10-15-effects-design.md). Docs: TECHNICAL §4 (protocol), §5 "Status effects", §10 (F8), §11 "How to add an effect", §12, §13; PLAYER_GUIDE ("Status effects", the lich, controls, tips); TODO ("Effect system follow-ups").

**What was built:**
- **Data and runtime:** `defs/effects.rs` (Blind, Sleep, Petrified, Slowed, Accelerated, Burning, Frozen, Poisoned as an open `EffectKind`; stat mods resolved add, then multiply, then the lowest set; the resistance cap keeps immunity; flags; `EffectResponses` Immune/Reduced/Full) and `run/effects.rs` (`Effects` on every `Player` and `Monster`, `apply_effect`, `remove_effect`, `has_effect`, `hit_effect`, `tick_effects`, `damage_wakes`, `wake_teammate`).
- **Hits carry effects:** `Damage::on_hit` and `with_effect`; `enemies::on_hit` and `abilities::on_hit` are stubs returning `None`.
- **Bosses:** `defs/bosses.rs` `responses` (all immune to Sleep; lich also immune to Blind, Petrified reduced; dragon reduced to Blind, Petrified, Slowed, Accelerated). The lich casts a blinding curse (dark orb, `BlindOrb` 61), a sleep mist (purple orb, `SleepOrb` 62) and a stone gaze (`Anim::Gaze` 14, a beam the hero can break by line of sight) from its `SPELLS` table; the numbers are `LICH_*` constants.
- **Wire:** `EntSnap` trailing `u16` bitmask, `SelfW` 14 to 17 (vision, effects, speed_mul, no_act), `Ev::Effect` code 13, `ClientMsg::DebugEffect` (F8 in `?debug`).
- **Client:** `game/status.ts` (`StatusView`, `lyingPose`, `lieLayout`, `frameBounds`), `EntityView` (stone, slowed, lying), predictor speed, no-act and no-turn, `LightView` vision from the server, gaze beam, "E Wake" and asleep hints, HUD icons (letters B, Z, P, S, A, F, I, X), gallery rows, `LichDemoScene` spell phases.
- **Rename:** the mimic's `asleep` is now `dormant` (`FLAG.DORMANT`), no behaviour change, so "asleep" only means the effect.
- **Elemental effects (built after the first review, same branch):** `Burning` 5 (heat 6/s, 3 s, ends in water, cancels Frozen), `Frozen` 6 (cold 4/s, 2 s, rooted, cancels Burning), `Poisoned` 7 (poison 4/s, 4 s). Damage over time in `tick_effects` every `DOT_TICK` (0.5 s) as `Damage::effect_tick` (`from_effect`: it applies no effects); a hit that is at least `ELEMENT_SHARE` (0.5) of an element applies its effect (`ELEMENTS`, `element_hit`); `apply_effect` refuses a creature that resists the dot type at 1.0 (demons and the dragon do not burn, undead are not poisoned) and resolves the cancels; water puts out fire; burn kills credit `last_hit_by`; lava burns via the same rule. Client: flames, frozen haze with snowflakes, poison tint and bubbles in `game/status.ts`, HUD letters F, I, X, F8 cycles all 8. Fingerprints: dragon and lich values re-recorded (the dragon's fire burns heroes, a barrel blast burns a monster in the lich hall), demon and `level_setup` unchanged. Spec: addendum "elemental effects" in the effects design. Final review done, fixes in. The status marks follow the figure's alpha (hidden rogue) and vanish with the effects on falling or drowning; burn damage counts in the hero's damage total; water refuses Burning in `apply_effect`. Follow-ups in TODO: no source yet for Frozen and Poisoned, tune the new values and `DOT_TICK`, petrified with half heat resistance becomes immune to Burning.

**Verified (2026-10-15, after the elemental effects):** server **317 tests pass** (Docker: `docker compose -f docker-compose.test.yml run --rm test`), no warnings; client `npm test` **65 tests pass**, `npm run typecheck` clean. Fingerprints: `level_setup_is_unchanged` unchanged; the lich hall value of `simulation_is_unchanged_after_waking_the_boss` was re-recorded (4898485541812238644 to 15325243260565646054) and the dragon value (7060935872596498876 to 17290353229492298409); the demon is unchanged.

**Open (for the user and the next agent):**
- The final whole-branch review, then the user's decision to merge.
- Play-test the lich's three spells and the HUD icons live; nothing was played in a real fight yet (F8 shows each effect alone).
- The HUD glyphs are ASCII letters because the pixel font has no symbols; drawn icons would be nicer.
- Every number (durations, cooldowns, `EFFECT_REDUCED`) is a first guess for the balancing pass. Full list in TODO "Effect system follow-ups".

## Session before (2026-10-15, vision and darkvision)

**Branch:** `feature/vision` (from `main` after `feature/lighting` was merged). **Merged into `main` (fast-forward) and pushed** at the user's request (2026-10-15). Commits: `git log --oneline 752c7c5..ba4790a` and the docs commit after it (tasks 1 to 7, the final-review fixes, the light-rim fix). Spec: [docs/superpowers/specs/2026-10-15-vision-darkvision-design.md](docs/superpowers/specs/2026-10-15-vision-darkvision-design.md); plan (7 tasks, run with superpowers:subagent-driven-development): [docs/superpowers/plans/2026-10-15-vision-darkvision.md](docs/superpowers/plans/2026-10-15-vision-darkvision.md). It was TODO priority 1 (now only the effect system remains there; new section "Vision and darkvision follow-ups").

**What was built:**
- **Sight on entity types** (TECHNICAL §5 "Sight"): `Sight { vision (tiles), darkvision (share of vision) }` on `TypeDef`, `Adjust` and `Profile` (`defs/entity_types.rs`): Human 9 / 0, Monster 8 / 1/3, Undead 8 / 1.0, Demon 9 / 1.0, Dragon 25 / 1.0, Object none. Enemy `vision` is in tiles in `defs/enemies.rs` (old pixel range / 16; every enemy overrides it, so only the darkness rule changed behaviour); bosses see 25 tiles.
- **One perception rule** (`run/perception.rs`, `sees`): within vision, in line of sight, and lit or within vision × darkvision. `ai::find_visible_player` and `bosses::target` use it. `Run::refresh_lights` runs once per tick before the AI and again in `send_snapshots`; test helper `Lights::fill`.
- **Heroes** run on the same numbers: `Player.sight`, `Player.darkvision: Option<f64>` (debug override), `sight_now()`. The snapshot filter is "in FOV and (lit or `dark_reach`)" with the viewed hero's sight (a spectator gets the teammate's); `on_hero` events need the FOV only. The shared fixture `fixtures.json` has a `darkvision` key, so the TypeScript side is pinned to the Rust one.
- **Protocol:** `SelfW` element 13 = darkvision as a u8 percentage (the viewed hero); `ClientMsg::DebugDarkvision { ratio }`, honoured only when debug is allowed, and it marks the run as debug (no XP).
- **Client:** `LightView` builds a darkvision mask (`dvmask`) and draws every tile in darkvision reach at most `DV_DARK` 0.45 dark (lit or not; no tint on unlit ones), and the mask fades out as a light gets brighter than darkvision (`dvMask`); `DarkvisionFX` (`game/darkvisionfx.ts`), a post pipeline that greys the masked area, attached to the main camera only while darkvision > 0 and registered in `BootScene`. F4 (debug mode only, alive only) cycles the own darkvision 0 / 50 / 100 %; F3 shows `darkvision NN%`; `?lights` has the V key and `&dv=`; `tools/e2e/lights-shot.mjs` takes a dv argument; `tools/e2e/smoke.mjs` presses F4 only with a debug query.
- **Docs:** TECHNICAL (§4 protocol, §5 "Sight", perception and light refresh, §7 filter, §10 F3/F4/`?lights`, §11 "How to give a creature darkvision or longer sight", §12 tests, §13 limitations), PLAYER_GUIDE ("Seeing in the dark", tips), README (F4, `?lights`), TODO (priority 1 now the effect system, "Enemies affected by darkness" removed, "Vision and darkvision follow-ups" added).

**Behaviour change (to play-test):** Human enemies (necromancer, summoner, lich disciples) do not see heroes in the dark. Monster types (goblin archer, orcs, mimic, ogre) see only within a third of their vision (about 2.5 to 3 tiles). Undead, demons and bosses see fully in the dark. `simulation_is_unchanged_after_waking_the_boss` was re-recorded: in the lich hall the disciples stay idle in the dark and one orc loses the hero. `level_setup_is_unchanged` is unchanged.

**Deviations and rulings:**
- Lights are refreshed both per tick (before the AI) and per snapshot: perception needs this tick's lights, the snapshot filter needs the final positions.
- The debug darkvision toggle marks the run as debug (no XP), like `Debug`.
- F4 works only in debug mode and only while alive, so a stray press cannot turn a normal run into a debug run; the smoke F4 step runs only with `?debug`.
- The greyscale is camera-wide, so inside the darkvision range it also greys world-space damage numbers, HP bars and the E hint (TECHNICAL §13).
- Phaser 3.90 differs from the plan's API: the pipeline reads its camera through `this.gameObject` (no `camera` property); the mask texture is `mask.source[0].glTexture` (a `CanvasTexture` has no `glTexture`); the pipeline is registered with `addPostPipeline` in `BootScene` (the game config's `pipeline` option fails `tsc`) and attached by its registered name, because the minified class name differs.

**Verified (2026-10-15):**
- Server: **274 tests pass** (253 on `feature/lighting`), no warnings. Fingerprint `level_setup_is_unchanged` unchanged; the other was re-recorded as above.
- Client: `npm test` **54 tests pass** (48 on `feature/lighting`; 52 before the light-rim fix), `npm run build` passes.
- `?lights` screenshots at dv 0, 0.5 and 1: 0 and 1 show the effect; 0.5 shows no difference in the demo (no unlit tile within 4.5 tiles of its viewer).
- Smoke test with two players, default query (F4 step skipped) and `?debug` (F4: 0 -> 50 -> 100 %): no browser errors.

**Final whole-branch review (2026-10-15), all fixed:** the shared darkvision fixture was nearly vacuous (viewers on torch tiles); it now has viewers (12,5) r3, (18,4) r4.5, (3,14) r3, (11,7) r4.5 on unlit floor, plus a full-range (20,3) and a range-0 (20,17) case, and `export.rs` asserts every partial case has an unlit tile seen only by darkvision and an unlit FOV tile outside the range (the client test adds the exact boundary `darkReach(3, 4, 5)` true, `4.99` false). The server filter range now uses the same quantised percentage as `SelfW` (`dark_range`/`darkvision_pct` in `visibility.rs`); `set_darkvision_if` ignores a NaN ratio; `set_debug(pi, false)` resets the darkvision override. TECHNICAL wording fixed (`Lights::lit`, light refresh once per tick plus once per snapshot); TODO has the per-tick light cost note. Tests now: server **274**, client **52** (assertions added to existing tests).

**Light-rim fix (user report, 2026-10-15):** inside darkvision, every light had a dark ring: its fading rim (about 90 % dark) was darker than the unlit darkvision tiles around it (`DV_DARK` 45 %). Now a tile in darkvision reach is never darker than `DV_DARK`, lit or not (`tileDark`), and the greyscale mask fades from 1 to 0 as the light gets brighter than darkvision (`dvMask`), so the rim blends from grey to colour. Commit `ba4790a`. **Confirmed by the user in the game:** "it works so good".

**Open (for the user):**
- **Live check of the AI:** sneak past humans in an unlit corridor, see skeletons and demons notice you in the dark, orcs only up close. (The F4 greyscale look is approved.)
- **Is the easier lich fight OK?** The disciples stay idle in the dark.
- All vision and darkvision numbers are first guesses for the balancing pass.
- Deferred minor review findings: the `dvmask` is not primed at construction; each attach of `DarkvisionFX` compiles a new pipeline; boss vision is `vision: Some(25.0)` repeated in each boss's `Adjust` in `defs/bosses.rs` (it could become one shared constant). (TODO "Vision and darkvision follow-ups".)
- Next: the effect system draft's eight open questions (TODO priority 1).

## Session before (2026-10-15, light sources)

**Branch:** `feature/lighting` (from `main`, after `feature/barrels` was merged and pushed). **Pushed to `origin` at the user's request (2026-10-15), not merged**; merge only when the user asks. Commits: `git log --oneline 171793a..HEAD` (tasks 1 to 12). Spec: [docs/superpowers/specs/2026-10-15-light-sources-design.md](docs/superpowers/specs/2026-10-15-light-sources-design.md); plan (12 tasks, run with superpowers:subagent-driven-development, three stages A server core, B client core, C torches and docs): [docs/superpowers/plans/2026-10-15-light-sources.md](docs/superpowers/plans/2026-10-15-light-sources.md). It was TODO priority 1 (removed; the list is renumbered; new section "Lighting follow-ups").

**What was built:**
- **Server core** (stage A; TECHNICAL §5 "Light sources", §7): `defs/lights.rs` (`LightKind` Torch/Lava/Fire/Magic as data: radius, colour, intensity, flicker; `kind_light` says which entity kinds glow); `run/light.rs` (registry `Lights`, `Anchor::Tile` static or `Anchor::Entity` moving, the static light map rebuilt lazily by shadowcasting, `is_lit`, the API `add_light`/`set_light`/`set_light_colour`/`remove_light`, `attach_kind_light`, the per-step sweep, `add_lava_lights`, `Run::set_tile` that keeps lava lights and the map in step). **Visibility is now "in sight and lit"** (`seen`); hurt and heal numbers on a hero need sight only (`on_hero`); torches are sent when in sight (lit or not); `Snapshot.lights` lists the moving lights near the viewer. Protocol: `RunStartInfo.lights`, `Ev::Light`/`LightAdd`/`LightRemove` (wire codes 10 to 12), `Snapshot.lights` as `SnapW` field 9.
- **Client core** (stage B): `game/light.ts` (`LightField`: the same static map as the server, pinned by a shared fixture, additive colour mixing), `game/lightview.ts` (darkness and additive tint canvases replacing the fog: `MIN_LIT` 0.35, `TINT_ALPHA` 0.35, flicker, redrawn every frame inside the camera window), heroes, teammates and the party's shots drawn above the darkness (`DEPTH.heroes` 7000.5; `MIN_LIT` and the draw order changed in the look check below), the `?lights` demo page (`LightsDemoScene`, `tools/e2e/lights-shot.mjs`).
- **Torches** (stage C): world objects (`ObjState::Torch`, `TorchSide` Face/West/East, `spawn_torch`, `set_torch`): E toggles, a heat share lights, any other hit puts out, a plain shot into the torch's wall tile hits it, area attacks and blasts reach it by distance. `place_torches` (stream 12, after the rotation, `TORCH_SPACING` 6, `DARK_SHARE` 0.2, runs under 3 get none). Art: CC0 "Simple Torch Animation 16x16" by Natural_Privateer (`assets-src/torch/`, `scripts/torch-frames.ts`, `game/torch.ts`), the burnt-out frame is the first frame without its flame; the E hint also shows over torches.
- **Lava and shots:** every lava tile carries a `Lava` light; fire shots and fire patches glow orange, `Missile` violet, `FrostBolt` ice blue, `ShadowBolt`/`GloomBolt` purple; arrows and bolts carry none.
- **Docs:** TECHNICAL (§2 layout, §4 protocol, §5 "Light sources" and torches under "World objects", §6 torches, §7 rewritten as "Field of vision and light", §9 torch frames, §10 `?lights`, §11 "How to add a light source", §12 tests, §13 limitations), PLAYER_GUIDE ("Seeing in the dark", controls, tips), README (art credit, `?lights`), TODO (priority 1 and "Lighting" removed, "Lighting follow-ups" added, list renumbered).

**Deviations** (also the plan's Global Constraints and the controller's rulings during the build):
- The light demo is its own dev page `?lights`, not part of `?gallery`.
- The light canvas is redrawn every frame inside the camera window instead of only on changes (simpler, cheap, and the flicker needs it anyway).
- Events on a hero need sight only (the spec's "hits on you still show"), through `Run.on_hero`.
- **R1:** `TorchSide` is `Face`/`West`/`East` (the plan's names), not the spec's `Face`/`Left`/`Right`; same meaning.
- **R3:** the moving-light list uses a distance test (FOV radius + 1 tile + the light's reach) instead of the spec's "reaches a tile in FOV": cheaper, slightly over-sends (glows from behind walls; TECHNICAL §13).
- The start room and the boss hall always get a torch (the spec's "never dark"): where the normal rules give them none, a fallback puts one in the middle of their longest candidate run, of any length. (The implementer's loosened test, up to two unlit start rooms over the seeds, was rejected.)
- **Doorway jambs:** a `Face` candidate must also have no floor to its left or right, so a torch never hangs on a jamb beside a door (the spec forbids corners); this overrides the plan's code and gives a few fewer torches at room-top doorways.
- **Unbiased run offset:** the first torch of a run starts at `gen_range(0..TORCH_SPACING.min(len))`, not the plan's `gen_range(0..6).min(len-1)` (which was biased towards the end of short runs). It changes only torch positions (own rng stream).
- **Torches are sent when in the viewer's FOV (light not required)**, not always as the spec says. The client draws static lights from `RunStartInfo.lights` and the light events, not from torch entities (`object_sent` in `visibility.rs`). Cost: a torch sprite can pop in at the FOV edge, under darkness.
- **F1 (final review): moving lights use the per-tile shadowcast on the server too**, not distance + line of sight as the spec words it. A moving light lights exactly the radius-r shadowcast from its tile (`light_tile`: the tile of its position as sent on the wire), like a static light; the server keeps a second per-tile layer for them (`Lights::cast_moving`, once per snapshot) and `seen` and `is_lit` test the tile. Reason: one rule on both sides, so a lit tile is never drawn dark and a sent monster never sits under black. Pinned by moving-light cases in the shared fixture (`addMoving`).
- **Torch state lives in the registry only:** `ObjState::Torch` has no `lit` field any more; `torch_on` reads the light's `on` (final review).
- **LINEAR filter re-applied after every refresh:** Phaser resets a canvas texture to NEAREST on every `refresh()` under `pixelArt`, so the plan's one-time LINEAR setting did nothing; `LightView` sets it again after each upload (found in review of task 8; commit `59c926e`).

**Verified (2026-10-15):**
- `docker compose -f docker-compose.test.yml run --rm test`: **249 server tests pass** (214 on `main`; 236 after stage A; 245 before the final fix wave), no warnings. The fingerprints `level_setup_is_unchanged` and `simulation_is_unchanged_after_waking_the_boss` are unchanged (torches and their ids are left out of the first; torches come after every other id).
- Client: `npm test` **44 tests pass** (34 on `main`), `npm run build` and `tsc` pass. The Rust and TypeScript light maps agree on the shared fixture, static and moving.
- Every task passed its review (tasks 8 and 10 after one fix round each); the final whole-branch review's findings are fixed. `?lights` screenshots and a smoke test with two players: no browser errors.
- **Measured against `main`** with `tools/e2e/smoke.mjs` (default query, two players, the F3 numbers after moving and attacking at the start; three runs each, the stack on `main` came from a temporary worktree and was removed afterwards):

  | | `main` | `feature/lighting` |
  |---|---|---|
  | server tick (F3 `server`) | 0.12, 0.15, 0.14 ms | 0.14, 0.12, 0.15 ms |
  | snapshot (F3 `snapshot`) | 128 B, 128 B, 128 B | 201 B, 162 B, 180 B |
  | entities in the snapshot | 2, 2, 2 | 6, 4, 5 |

  The tick time is the same within the spread of the runs. The snapshot grows only by the few torches in sight and the moving-light list (the first build always sent every torch: 2 to 2.5 KB and 110 to 140 entities at the start; changed after the coordinator's ruling so torches need sight only, `object_sent` in `visibility.rs`). The numbers are from the headless smoke test at the start room, not from a long run with fights.

**Look check (2026-10-15).** The user looked at `?lights` and the game, **approved the overall look** and asked for three changes, all built (5 commits after `c7f0862`):
- **Heroes vanish in the dark.** Heroes, teammates, their name labels and HP bars, the party's shots and the own predicted shots are drawn under the darkness like every other figure (`DEPTH.heroes` and `EntityView.aboveDark` are gone; heroes' HP bars have their own graphics at `DEPTH.heroBars` 6500). Glowing shots still show by their own light. Numbers on heroes (damage, heal, immune) also go under the darkness (`DEPTH.heroNumbers` 6501; `Ev::Heal` got a `p` flag like `Dmg`, wire `EvW::Heal` field 5); numbers on monsters, the HUD, the monsters' HP bars and the E hint stay above it. The `on_hero` rule is unchanged.
- **A longer, smoother fade inside bigger radii.** `falloff` is a smoothstep from 1 at the centre to `EDGE` 0.1 at the radius edge (was `1 − 0.55k²`, 0.45 at the edge); `MIN_LIT` 0.08 (was 0.35): a lit tile is never fully black, but the rim really fades, always inside the tiles the server counts as lit (the shared fixtures still pass). Radii: torch 7, fire 4, magic 3, lava 2 (were 5, 3, 2, 1); colours and intensities unchanged. The light canvases now have **2 px per tile**, upsampled with Catmull-Rom: with 1 px per tile, the bilinear filter showed creases along the tile grid in the long fade (screenshots); sampling the same bilinear at more pixels would not have changed anything, so the upsampling is cubic. Dark tiles are then set back to black in every sub-pixel (`blackenDarkTiles`; review fix: the cubic taps lit the centre of a dark tile next to a bright one by 10 to 13 %). About 0.5 ms per frame (Node measurement, 66×40 tiles).
- **Explosions flash.** New light kind `Blast` (id 4: radius 4, 0xffb060, intensity 1.0, flicker 0.3) and a generic short-lived light: `Run::add_flash(kind, pos, secs)` adds an `Anchor::Point` light with an `expires` time that the per-step sweep removes. It is a moving light (cast per snapshot, sent in `Snapshot.lights`): no protocol change. `abilities::explode` (the hero's fireball, the dragon's fireballs) and `explode_barrel` add one for `BLAST_FLASH` 0.4 s. The flash is flat, not fading (a fade would need a scale on the wire). Only `Point` lights expire (the sweep ignores `expires` on other anchors). A targeted shot whose aim point lies inside a wall goes off at its last open position, so its flash does not light both sides of the wall (review fix). The paladin's **healing wave** flashes as well (user request after the look check): light kind `Holy` (id 5: radius 4, 0xffe890, intensity 0.9, flicker 0.1) for `HOLY_FLASH` 0.6 s, as long as its ring; test `a_healing_wave_flashes_light_for_a_moment`. Other `Boom`s (shockwaves, lich nova, the demon's ring burst) get none. `?lights` shows an explosion flash in the dark room's doorway.
- Verified: **253 server tests** (4 new: the healing wave flashes for 0.6 s, the explosion flash lights a spot three tiles from the impact for 0.4 s and is swept, a barrel blast adds a flash, a blast aimed into a wall goes off in front of it), **48 client tests** (4 new for the upsampling and dark tiles), `npm run build`, `?lights` and two-player smoke screenshots without browser errors; the fingerprint tests keep their constants. Smoke F3: server 0.16 ms per tick, snapshot 161 B, 4 entities.

**Open (the user has not seen or approved these yet):**
- **Look details** (the overall look is approved): the **tint strength** (blue and purple read weak, and mixed areas wash to grey), the **burnt-out torch frame** (a bare stick) and the **side-sconce look**; and whether the new numbers (radii, fade, flash) feel right in a real run. Every knob is a constant: `defs/lights.rs` (radius, colour, intensity, flicker, `BLAST_FLASH`, `HOLY_FLASH`), `light.ts` (`falloff`, `EDGE`), `lightview.ts` (`MIN_LIT`, `TINT_ALPHA`, `SUB`), `torch.ts` (offsets), `TORCH_SPACING` and `DARK_SHARE` in `dungeon/generate.rs`.
- **The live test has not been done by the user:** E on a torch (toggle and the E hint), a fireball lighting a dark corridor, lava glow, the boss hall (torches, door sealing), and a **sword swing, dash or arrow next to a torch putting it out: watch whether that is annoying.** If it is, the rule can change (for example only a hit on the torch itself, or physical damage only on a direct hit).
- **A look decision:** the brown band at the top of the screen near the map edge is the table frame plus the camera background `#2b1a10` (`GameScene`, the camera is not bounded to the map); both are older than this branch but stand out more against the black. Options: a black camera background, or camera bounds.
- Deferred minor review findings (small): `LightKind::ALL` is hand-maintained (a new kind could miss the export); a dead hero's light is dropped for good (matters for future hero lights with revives); all torches flicker in phase; E picks the nearest barrel or torch, so standing next to both may toggle the torch instead of pushing the barrel; `place_torches` splits runs and decodes sides twice (a helper would be cleaner). The build ledger was deleted after the final review, as the process says; every ruling is listed under Deviations above.
- All numbers (radii, intensities, spacing, dark share, tint) are first guesses for the balancing pass.

## Session before (2026-10-14, damage types, world objects and exploding barrels)

**Branch:** `feature/barrels` (from `main`), pushed to `origin` at the user's request (2026-10-14; again 2026-10-15 with the barrel art). **Merged into `main` (fast-forward) and pushed** at the user's request (2026-10-15). Commits: `git log --oneline main..HEAD`. Spec: [docs/superpowers/specs/2026-10-14-damage-types-and-objects-design.md](docs/superpowers/specs/2026-10-14-damage-types-and-objects-design.md); plan (18 tasks, run with superpowers:subagent-driven-development, three stages A, B, C): [docs/superpowers/plans/2026-10-14-damage-types-and-objects.md](docs/superpowers/plans/2026-10-14-damage-types-and-objects.md). It was TODO priorities 1 and 2, planned and built together (both removed from the list; it is renumbered).

**What was built:**
- **Damage model** (stage A; TECHNICAL §5 "Damage model"): `defs/damage.rs` (`DamageType` Physical/Cold/Heat/Magical/Poison, `DamageSplit`, `Damage`, `Resistances`, `resolve`, `kind_split`) and `defs/entity_types.rs` (Human, Undead, Monster, Demon, Dragon, Object, plus per-entity `Adjust`: lich, dragon, demon boss). The profile is computed at spawn and stored on every hero, monster and object. All damage calls take a `Damage`; `resolve` is the only formula, floored at -100 % (double damage at most); above 100 % a hit heals. The `Dmg` event carries `ty` and `imm`; the client colours the numbers (`game/damage.ts`) and shows "immune". The XP armour upgrade is **still there**, applied after `resolve`; removing it waits for items (open question in TODO).
- **World objects** (stage B; "World objects"): `run/objects.rs` with `WorldObject`, `ObjState::{Chest, Barrel}`, `hurt_object`, `use_object`, snapshot anims. Chests moved into it with unchanged behaviour. `Ai.target` is now `Option<Target>` (`Player`, `Object`, `Place`). New input field `act` (E). Solid objects are squares in `collision::move_box`, mirrored in `client/src/sim/collision.ts` and the predictor and pinned by the shared fixtures.
- **Barrels** (stage C): lit by any hit, 0.3 s fuse, blast radius 40 px, 30 damage (50 % heat, 50 % physical), 40 px push, chain reactions (each barrel explodes once), E pushes a barrel 48 px, barrels fall into chasms, sink in deep water and explode in lava. Blasts hurt and push heroes and non-boss monsters; bosses take damage but are not pushed. Monsters are now pushable and **fall, drown and burn** (`knock_monster`, `terrain_monster`, `Ev::Sink` for monsters). Ranged non-boss enemies shoot a barrel next to a hero (`Windup.at`). `place_barrels` (stream 11): groups of 2 to 4 in about a quarter of the rooms, 3 to 5 in the boss hall. Client: `game/barrel.ts`, the `Boom k 7` effect with a camera shake, the E hint, solids in prediction.
- **Docs:** TECHNICAL (layout, §4 protocol, §5 damage model, world objects, solids, monster knockback, AI, §6 barrels, §8 prediction, §12 tests, §13), PLAYER_GUIDE (E, "Explosive barrels", "Damage types and resistances"), TODO (items 1 and 2 removed, new follow-up sections).

**Deviations from the spec** (also listed in the plan's Global Constraints):
- The barrel explosion is `Boom` **k 7**, because k 6 is already the lich nova.
- The damage-number colours live in the client (`game/damage.ts`); the server exports only the type ids (`DMG_TYPE`).
- The barrel an enemy aims at is stored in its `Windup` (`Some(Target::Object(id))`), because perception overwrites `ai.target` every tick.
- The dagger stays monsters-only; the crossbow bolt hits barrels.
- No separate `run/damage.rs`: `resolve` is in `defs/damage.rs`. An object's kind is its `EntityKind` (no `ObjKind`). Chests stay non-solid.
- **Pathing went beyond the plan:** big bosses got stuck on barrels, so monster pathing got `object_free_line` (no straight walk past a barrel), an A* "squeeze" cost next to barrels, and boss-hall barrels need a 7x7 plain-floor area and keep 3 tiles apart. A chaser therefore switches to A* (refreshed every 0.6 s) whenever a hero stands next to a barrel; that is a little CPU and can make chasers slightly late there. Without barrels the change does nothing.

**Verified (2026-10-14):** `cargo test` 201 pass (159 before the branch), client `npm run build` and 34 tests (27 before), the Rust and TypeScript collision fixtures agree with barrels in them, `level_setup_is_unchanged` keeps its original constants (the fingerprint leaves barrels and their ids out), `simulation_is_unchanged_after_waking_the_boss` was re-recorded because barrels in the boss halls change the fight; each task passed its review.

**Final review fixes (2026-10-14):** pushed barrels rest on the 1/16 px wire grid (prediction parity); enemy and boss area attacks (ogre slam, dragon breath/smash/tail/claw/bite, demon cleave/swoop, lich nova, fire patches) light barrels; one `WorldObject::blocks()` predicate for solids, shot stops, A* tiles and straight lines (sinking barrels block nothing); square body test for sliding barrels; no empty monster `Heal` event; E ignores key repeat; `Damage::scaled` removed (no warnings). `cargo test` 214 pass, client build and 34 tests pass.

**Confirmed live by the user (2026-10-14):** "so far it works as intended".

**Open (not done yet):**
- **Further live checks** worth doing while playing: a chain reaction; an E push into a chasm, into water and into lava; an enemy blown into a chasm (dies, XP once); an archer shooting a barrel next to a hero; barrels in the boss hall (big bosses must not get stuck); coloured damage numbers and "immune"; no prediction snaps when walking along barrels.
- **Final whole-branch review** done; its findings are fixed (see above).
- **Barrel art:** done 2026-10-15 (see "Barrel art" below).
- **Merging:** done (2026-10-15).
- **Deferred minor review findings** (small): listed in [docs/TODO.md](docs/TODO.md) under "Barrels and world objects follow-ups". Fixed in the final wave: the shared `blocks()` predicate, the empty monster `Heal`, E key repeat, `Damage::scaled`. Still worth doing: the squeeze cost only for wide monsters; no credit for a departed igniter.
- All numbers (resistances, splits, barrel values) are first guesses for the balancing pass.

## Barrel art (2026-10-15, on `feature/barrels`)

The user disliked the crate stand-in. A first reference image they posted was under a strict licence, so it was **not used** (do not copy it). They then supplied a barrel made with ChatGPT (`images/Pixel Art Wooden Barrel Icon.png`, copied to `client/assets-src/barrel/barrel_source.png`).
- Its 20×27 pixel grid was read and snapped to pack colours. At that size it is taller than a hero, so it was redrawn by hand at **16×22** (the user's choice from a preview sheet) in `client/scripts/barrel-frames.ts`, built into the atlas as `barrel` (plain wood) and `barrel_explosive` (red wood lid plus a red band; the user picked this "C" variant over a red lid alone and a red centre stave).
- `game/barrel.ts` draws `barrel_explosive` (`BarrelView` takes the frame as an optional argument). `?gallery` shows the plain one, the explosive one, and one cycling through fuse, fall and sink.
- **Plain barrels** (blocking, not exploding) are wanted by the user but not built; the art is ready (TODO, "Barrels and world objects follow-ups").
- Credit: "AI-generated with ChatGPT for this game" (README Art, TECHNICAL §9 "Barrel frames"), not the user's own art.
- Verified: atlas build (2 barrel frames), client `tsc` and 34 tests, `?gallery` screenshot with no browser errors. **Confirmed in the game by the user (2026-10-15):** "It works and looks good now".

## Bug fixes (2026-10-14, after the level split)

Branch `fix/hitboxes-and-dark-shots`, merged into `main` (fast-forward) and pushed at the user's request (2026-10-14); the branch is deleted. Four bugs the user reported:
- **Tall enemies were only hit on their lower half** (e.g. the demon). Cause: the server tested player shots against a circle around the monster's *feet*, while the sprite stands up to 58 px above them and shots are drawn 8 px above their ground point. Fix: `Monster::shot_dist` (capsule up to `EntityKind::body_height`, heights measured from the atlas), used in `tick_projectiles`. Movement, melee and explosions are unchanged. Enemy shots against heroes still use the round footprint (heroes are small; not reported).
- **Enemies out of view seemed not to take damage.** The server did damage them (checked with a probe test: an orc 180 px away, out of view, lost 12 HP), but it stopped sending the shot once it left the view, so the client's own cosmetic copy ended at the edge as if it had hit something, and the `Dmg` number was filtered out. Fix: the party's projectiles are always sent, and `Dmg` from heroes' hits and `Boom` from their explosions are sent without a position (to the whole party).
- **Shots seemed to pass through several enemies.** The server always damaged only the first enemy, but: (a) a shot that hit within the first ticks died before any snapshot carried it, so the client's cosmetic copy (which only ended when the server copy disappeared) flew on through everyone behind; (b) the RTT/2 fast-forward jumped the shot ahead without hit checks, so with high ping it skipped the nearest enemy and hit the next. Fix: `advance_projectile` (the per-tick 4 px stepping, also used for the fast-forward), and on the client `sim/hitbox.ts` (port of `shot_dist`, exported `HITBOX`, `SHOT_HEIGHT`, `DRAGON_LIFT`) ends the cosmetic copy at the first enemy it touches; `endedShots` keeps the server copy hidden afterwards. The user plans piercing shots as a later upgrade (2, 3, 4 enemies): noted in TODO "Progression follow-ups".
- **Two arrows per shot when the mouse moved while firing** (seen with the assassin; every class was affected). The client fired twice per click: `Predictor.reconcile` reset the local cooldown to the server's (still 0, from before the server saw the shot, minus the unacked time), and the button, still held while dragging, fired again. The server ignored the second shot (its cooldown ran), so the extra arrow was a cosmetic ghost. Reproduced in the browser (debug logs: shot ids 1+2, 3+4, ... per click). Fix: `step(..., used)` records the cooldown each input starts and `reconcile` replays them on top of the server value; the cooldown is now set after the tick like on the server. Test in `world.test.ts`. After the fix: one shot per click, normal and with `?lag=150&jitter=40`. The same flaw in the hide time (a fresh Hide flickered off for about RTT, ~220 ms under `?lag=150`) was fixed afterwards on branch `fix/hide-flicker` (merged into `main` and pushed at the user's request, 2026-10-14; branch deleted): `Pending.hide`, set via `Predictor.useHide`, is replayed in `reconcile`; test in `world.test.ts`; checked in the browser with the old correction (flicker) and the new one (none).
- Docs: TECHNICAL §5 (shot hitboxes, fast-forward), §7, §8 (cosmetic shots, cooldown replay), events and tests; PLAYER_GUIDE "The heroes" and "Seeing in the dark"; TODO (piercing shots).
- Verified: `cargo test` 163 pass (3 new tests, each failing on the old code first; the fingerprint tests unchanged), client `tsc` and 32 tests (4 new hitbox tests, 1 new predictor test), `docker compose up --build -d`, `/health` OK, smoke test normal and with `?lag=150&jitter=40&loss=2`: no browser errors. **The user tested all four fixes in the game successfully (2026-10-14).**

## Session before (2026-10-14, level split)

**Branch:** `feature/level-split` is merged into `main` (fast-forward) and pushed, at the user's request (2026-10-14); the branch is deleted. It was priority item 1 of `docs/TODO.md` (now removed; the list is renumbered). Spec: [docs/superpowers/specs/2026-10-13-level-split-design.md](docs/superpowers/specs/2026-10-13-level-split-design.md); plan (5 tasks, run with superpowers:subagent-driven-development): [docs/superpowers/plans/2026-10-13-level-split.md](docs/superpowers/plans/2026-10-13-level-split.md).

**What changed (a pure refactor: same map, spawns, entity ids, boss and behaviour per seed; the wire fixtures are byte-identical):**
- **Server core:** a run no longer assumes "dungeon + boss". `Run { layout, level }` replaces `Run.dungeon` and the five boss fields. `Layout` (`dungeon/mod.rs`: map, spawns, chests, player spawns) is what every level fills; `Dungeon::split` cuts the generator's result into the layout and the dungeon's own parts. `run/levels/`: `mod.rs` holds the `LevelRules` trait (hooks with default bodies: `populate`, `tick`, `post_tick`, `on_killed`, `on_boss_hurt`, `failed`, `debug_target`, `boss_bar`) and `enum Level` with the `dispatch!` macro; `boss.rs` holds `BossEncounter`, the boss fight any level can include; `dungeon.rs` holds `DungeonLevel`. `Run::new(id, members, seed, LevelChoice)`.
- **Protocol:** `LevelId { Dungeon }`, `LevelChoice { Dungeon { boss } }` (tag `level`), `RunStartInfo.level`, `RunEnded { level, boss: Option }`, `ServerMsg::Room.level`. The lobby room is always the dungeon; `SelectBoss` is unchanged.
- **Client:** `LEVEL_TEXT` in `ui/text.ts`, `ui/endText.ts` (`endText()`, the end screen's first line; the HUD uses it).
- **Database and statistics:** migration `0004_runs_level.sql` (`runs.level` text, default `'Dungeon'`; `boss` nullable); `RunRecord { level, boss: Option }`; `AdminStats.level_runs` (`LevelRunStats`; the old `AdminStats.levels` stays the upgrades histogram); `PlayerRun.level`/`boss`. Telemetry: a `level` attribute, `boss` only when the level has one.
- **Migration 0004 is forward-only:** a server binary from before this branch refuses to start against a migrated DB (`sqlx::migrate!` sees the unknown migration 4), so a rollback needs the migration reverted by hand.
- **Admin page:** the "Levels (last 30 days)" table with rows like "Dungeon – Demon", and a "Level" column in a player's runs.
- **Docs:** TECHNICAL §5 "Levels", §11 "How to add a level type", protocol, statistics, telemetry and tests; TODO renumbered. PLAYER_GUIDE is unchanged (nothing changed for players).

**Verified (2026-10-14):**
- `cargo test`: 159 tests pass (149 before the branch), among them the fingerprint tests `level_setup_is_unchanged` and `simulation_is_unchanged_after_waking_the_boss`, recorded on the old code first. Client build and 27 tests pass.
- `docker compose up --build -d`, `/health` OK, migration 0004 applied (`_sqlx_migrations` row 4 "runs level"; `runs.level` NOT NULL DEFAULT 'Dungeon', `boss` nullable).
- Smoke test normal and under `?lag=150&jitter=40&loss=2` (with the admin pass): no browser errors, correction 0.00 px.
- A throwaway bot (session scratchpad, not kept; one debug wizard per boss, accounts deleted afterwards) walked the debug path with `?debug&boss=<b>` and killed each boss: the wake message, the sealed force field, the boss bar (IMMUNE for the lich until its disciples died), `RunEnded {victory, level: "Dungeon", boss}` and the end screen line "<boss name> has been slain."; the player's runs in the admin page show "Dungeon – <Boss>". The "Levels (last 30 days)" table lists "Dungeon – Demon/Dragon/Lich" rows (debug runs are left out of the statistics by design, so the rows come from the non-debug runs). No browser errors. The runs were stored as `level = Dungeon`, `boss = Demon/Dragon/Lich`, `debug = true`. (A first lich bot did not aim at the disciples and gave up after 10 min, an abandoned debug run; the registration limit, 10 per IP and hour, then needed a `docker compose restart game` for the second try.)
- The containers are left running.

**Still open:**
- **Lobby level picker and `SelectLevel`:** not built (one level only). `Room.level` is always `LevelId::Dungeon`; `lobby.rs` `start` maps it to the `LevelChoice`.
- **The escort level's XP rule** (kills and boss bonus, or a fixed reward for arriving): to decide with the escort item (TODO priority 5).
- **Docker healthcheck (found this session, older than the branch):** the `HEALTHCHECK` in the `Dockerfile` uses bash's `/dev/tcp` under `/bin/sh` (dash), so `docker compose ps` shows the game container as "unhealthy" although `/health` answers OK. Nothing depends on it; fix it with a tool that exists in the runtime image.

## Session before (2026-10-13, prediction corrections under lag)

**Branch:** `feature/prediction-corrections` is merged into `main` (fast-forward) and pushed, at the user's request (2026-10-13). Start the next feature on a new branch from `main`. It was priority item 1 of `docs/TODO.md` (now removed; the list is renumbered).

**Cause found (with a throwaway bot that walked the debug path to the demon under `?lag=150&jitter=40&loss=2` and logged every correction with the server state, deleted afterwards):**
- **Main cause, the dev simulator:** `DelayLine` in `client/src/net.ts` used one `setTimeout` per message. Browsers round timer delays down to whole milliseconds, so messages a fraction of a millisecond apart fired out of order. The server then applied inputs out of order (its `ack` went backwards 218 times in one minute), and the predictor saw positions that did not match their `ack`. Real WebSocket traffic (TCP) never reorders, so real players never had this.
- **Small real bug:** while the predictor thought the hero was falling, `Predictor.step` stored the input as (0, 0) in its replay list but the real keys were sent. After a debug climb-out the server applied them and the replay did not.

**Fixed:**
- `DelayLine` is one FIFO queue with one timer (delay rounded up), so it delivers in order.
- `Predictor.step` keeps each input as sent; the replay applies the sinking rule itself, as before.

**Measured (same bot, 90 s):** corrections over 0.5 px dropped from 375 (one run) and 894 (another) to 36 of 2,760 snapshots. What is left is expected: pushes (the client learns of them about RTT/2 late) and once the force field closing during a dash. Push corrections are mostly over the 24 px blend limit, so they snap; an idea to blend them is in TODO.md (Network).

**Checked:** `net.test.ts` and `game/world.test.ts` (new; both fail on the old code), client typecheck and 24 tests, `docker compose up --build -d` + health, smoke test normal and under `?lag=150&jitter=40&loss=2` (no browser errors, correction 0.00 px). No server change, so `cargo test` was not run.

**Push immunity removed from TODO.md** at the user's request (2026-10-13): the priority item and the "Chained pushes" note are gone, the list is renumbered. The user will add it again if chained pushes become a problem.

## Session before (2026-10-13, demon rework: own AI-generated art, harder pushes, lava in its hall, new walk)

**Branch:** `feature/demon-art` is merged into `main` (fast-forward) and pushed, at the user's request (2026-10-13). Start the next feature on a new branch from `main`. **Afterwards:** the walk fix (below) was made on `feature/demon-walk` (from `main`) and is merged into `main` (fast-forward) and pushed as well, at the user's request (2026-10-13).

**Also this session:** `docs/TODO.md` got a tiered **priority order** at the top (by technical complexity and dependencies; quick wins don't count, the user's rule) and the user's new ideas (ghost and shadow, woodland escort level, lighting, riddle rooms). Lighting is planned as a general light-source system (static and moving sources), not only torches, at the user's request.

**User decisions:**
- **New demon look:** the user supplied `images/demon.jpg`, a front-view pixel demon (horns, yellow eyes, loincloth, tail). The game draws figures from the side, so the user had an image generation AI (prompts written by Claude) draw a side view and then one sheet per action: idle, walk, cleave, charge, cast (`images/demon_*.jpg`).
- **Cleave frames:** the AI's cleave sheet had 7 poses; Claude picked 5 (wind-up, swing, impact, follow-through, recovery) and dropped the two upright resting poses. The user agreed ("perfect").
- **No wings:** the swoop is now a charge on foot with the horns first. Its gameplay is unchanged.
- Credit: AI-generated art made for this game from the user's reference image (README Art, TECHNICAL §9 "Demon frames").

**Done:**
- Import (one-off scripts in the session scratchpad, not kept; the method is in TECHNICAL §9 "Demon frames"): pixel grid fitted per figure, colours snapped to one 16-colour palette, frames aligned on the hips (loincloth) and feet. Result: `client/assets-src/demon/demon_{idle,walk,cleave,charge,cast}.png`, cells 82×63, hips at x 33, feet on row 62 (78×63 / x 29 before the 8-frame walk).
- Client: `anim/demonFrames.ts` (layout), `scripts/demon-frames.ts` (atlas strip below the lich's); `FigureDef` gained `hipX` (the body's horizontal origin, mirrored when facing left) and `pace` (enraged wind-ups shortened, from `FLAG.ENRAGED`); `pickFrame.ts` picks the demon's frames (cleave: wind-up with telegraph, the swing frame 0.08 s before the hit, impact, follow-through, recovery; charge: crouch, two looping frames, the stop; cast: gathering, rising, burst at the ring of fire, recovery); `EntityView` skips the pack-figure squash/bob for own frames; the lobby boss card shows the new demon; the blurb says "charges". New `?demon` dev page (`DemonDemoScene.ts`); the terrain demos' swoop plays the charge frames.
- Server: `demon.rs` now starts `Melee`/`Dash`/`Cast` at the wind-up (was `Windup` first) and adds a short recovery after each attack (0.3 / 0.25 / 0.35 s) so the strike frames play out, like the dragon. Timings are `DEMON_*` in `defs/bosses.rs`, exported to the client (a second `json!` object in `export.rs`: one big one hits the macro recursion limit).
- Docs: README (Art, `?demon`), TECHNICAL (§9 Demon frames, FigureDef, boss table, dev pages, tests, known limitations), PLAYER_GUIDE (swoop wording), TODO (art gaps).

**Verified:**
- `cargo test` (Docker): 149 tests (4 new demon tests). Client `npm run build` (atlas, tsc, vite) and `npm test` (22, 5 new demon frame tests).
- `?demon` screenshots (idle, walk both ways, cleave both ways, charge, ring of fire, enraged cleave), no browser errors.
- `docker compose up --build -d` (2026-10-13), then a throwaway bot (debug wizard, account deleted afterwards) walked the debug path to the demon on the live server and fought it for 45 s: cleave, charge, ring of fire, the lobby boss card. No browser errors. The containers are left running.

**Follow-up (same session), user decisions:**
- **Size: keep the original** (×1, about 62 px tall): "It looks by far the best". Claude had shown 85 / 75 / 65 % versions next to the heroes. They were resampled from the source sheets, because a non-integer `scale` in the game breaks pixel art (the game renders at 1 game pixel, then zooms by an integer).
- **Demon melee pushes hard** ("significant knockback"): cleave 36 → **56 px**, swoop 44 → **64 px** (as far as the lich's nova). Now `DEMON_CLEAVE_KNOCK` / `DEMON_SWOOP_KNOCK` in `defs/bosses.rs`, exported; `?knockback` and `?demon` use them.
- **Lava pool in the demon's boss hall** (it had only chasms): `place_boss_lava` in `dungeon/generate.rs`, lava theme only. The demon already crossed lava unharmed and at full speed (`Mover::Demon`, lava burns only heroes); unchanged. Heroes knocked in burn and slow down.
- Verified: `cargo test` 149 (the generation test now requires the pool in every lava-theme hall over 100 seeds and allows no lava elsewhere), client build and 22 tests; containers rebuilt and a bot fight on the live server, no browser errors. A few halls were printed as text from the generator to check where the pool lands.

- **Walk looked like limping** (user): the first AI walk sheet was no clean cycle (frames 1 and 3 the same wide stance, only frame 4 lifts a foot). Reordering to 1, 4, 3, 4 did not help ("it still limps"). Claude wrote a precise prompt for an 8-frame cycle (contact, down, passing, up per leg, near leg brighter, far leg darker); the user supplied `images/demon_walk_improved.png`, now imported as the 8-frame `demon_walk` (12 fps, the same stride time as before). All demon cells grew from 78 to 82 px wide (hips at x 33) for its longer tail. The user still saw no proper walk: the legs should **cross** when seen from the side. They had the AI make `images/demon_walk_improved_cross_walk.png` (8 frames, same layout), now the `demon_walk` strip, imported the same way. Then the user chose the order: sheet images 1, 2, 3, 8, then back (the strip is 1, 2, 3, 8, 3, 2 at 9 fps; the ends are not repeated, so it does not pause). The user approved it in `?demon`: "now it is much better" (2026-10-13). The sheet's images 4 to 7 are unused.

**Open:**
- Done: the user played the demon fight (new pushes, lava pool): "It works as intended" (2026-10-13).
- The added recoveries make the demon slightly slower between attacks; part of the balancing pass.
- Redoing a demon sheet: the import scripts were throwaway (session scratchpad); the source sheets in `images/` were deleted at the user's request (2026-10-13; the whole inbox was emptied, the lich references too), so a redo needs a new sheet from the image AI; TECHNICAL §9 "Demon frames" describes every step (grid or fixed pitch, palette snap, cleanup, hip/eye anchor, 82×63 cells). Strips must stay 82×63 per cell; `build-atlas.ts` checks the size.
- Containers rebuilt after the merge (`docker compose up --build -d`, 2026-10-13); they serve the 6-frame walk and are left running.

## Session before (2026-10-13, new lich art, then the lich fight rework)

**Branch:** `feature/lich-art` is merged into `main` (fast-forward) and pushed, at the user's request (2026-10-13). Start the next feature on a new branch from `main`. Two commits: the art, then the fight changes below.

### Part 2: lich fight rework

**User decisions:**
- **Drain beams** must show even when the lich or a disciple is outside the player's field of view.
- **Nova:** "regularly … a devastating area effect (explosion-like)" that pushes heroes "a longer distance than from melee attacks of normal enemies". Agreed numbers (first guesses, for the balancing pass): every 10–12 s regardless of distance, 1.2 s wind-up with a telegraph ring, 56 px radius, 24 damage, 64 px push (ogre club 28, dragon tail 44). It can push heroes into chasms (offered as an option to drop; the user went ahead with it).
- **All the lich's magic looks like dark purple, gloomy, shimmering energy:** the volley, the nova, its telegraph and the summon. The red drain beams stay red (the disciples' life force, not an attack; the user did not object).
- **Summon:** 5 melee + 5 ranged skeletons at once (top-up, cooldown 12 s unchanged).

**Done:**
- Server: `lich.rs` rewritten (nova, top-up summon, `GloomBolt` volley); `LICH_NOVA_*`, `LICH_SKELETONS`, `LICH_ARCHERS` in `defs/bosses.rs` (nova consts exported); `EnemyType::RaisedArcher` (kind `SkeletonArcher`, 20 HP, 2 XP); `EntityKind::GloomBolt` (60); `Ev::Raise.fire` → `Ev::Raise.k` (0 green, 1 fire, 2 gloom); `Ev::Boom{k: 6}` nova; `Snapshot.drain` (+ 8th `SnapW` field, `visibility.rs` `drain_points`/`drain_for`).
- Client: `wire.ts` unpacks `drain`; beams drawn from it above the fog (`DEPTH.beam` 7001); `GLOOM` colours, `Effects.nova`, `gloomWisp`, `raise(k)`; `PROJECTILES` `gloom` flag (flicker + smoke trail); `FigureDef.slam` gained `color`/`gloom` (purple ring with wisps drawn in, pale purple wind-up flash, staff held high). New `?lich` demo (`LichDemoScene.ts`; the terrain demo's `slam` step gained `nova`). Lobby blurb updated.
- Docs: PLAYER_GUIDE (lich, knockback table, boss halls), TECHNICAL (boss table, rendering, dev pages, tests), compact-snapshots.md, README dev pages.

**Verified:**
- `cargo test` (Docker): 145 tests (5 new: nova wind-up/damage/push, nova radius, summon 5 + 5 with top-up, gloom volley, drain sent out of view). Client `tsc` + `vitest` (17, the wire fixture now carries `drain`).
- `?lich` screenshots: volley, summon ring, nova telegraph, burst, pushes (one into the chasm), no browser errors.
- `docker compose up --build -d`, then the throwaway lich bot (debug wizard, account deleted) fought the lich on the live server: purple telegraph ring, gloom bolts, ten skeletons, drain beams to disciples in unseen parts of the hall; no browser errors.

**User check:** "It works" (2026-10-13), after the `?lich` demo and the fight.

**Open:** the nova, summon and volley numbers are first guesses for the balancing pass. `docs/TODO.md` has uncommitted notes that are not from this session (woodland escort level, lighting, riddle rooms); they were left as they are.

### Part 1: new lich art

**User decisions this session:**
- **New lich look:** the user put two reference images in `images/` (`lich_high_res.webp`, a crowned lich in a crimson robe with an orb staff and a book; `lich_pixel_art.jpg`, a horned pixel lich in a teal robe with green flames) and asked for assets "that match the art style of the game", about **hero size**.
- **Blend both:** the high-res lich's crown, skull, crimson robe, gold trim and orb staff, in the pixel sample's style (dark outline, glowing eyes, ragged hem, floating). No book (it would not read at 16 px).
- After a first version: **leaner, with more pronounced shoulder clothing** like the high-res image. The user approved the result ("perfect") in `?gallery` and the preview sheet.
- Credit: drawn for this game with Claude Code (README Art, TECHNICAL §9 "Lich frames").

**Done:**
- `client/scripts/lich-frames.ts`: pixel grids in pack colours → `lich_idle_anim_f0-3`, `lich_run_anim_f0-3` (16×28, like the heroes) and `weapon_lich_staff` (8×30); `build-atlas.ts` adds them in a strip below the dragon.
- `anim/defs.ts`: the lich uses its own frames at ×1 (was the necromancer ×1.75 with a pale tint), the new staff at `weaponScale` 1.3, `handX` 7 (so the staff does not cover the right pauldron), `handY` 11, `baseR` 7. The lobby's boss card shows the new sprite (`lobby.ts`, preview ×3).
- No server change: the lich's radius (8) already fits a hero-sized body.
- Docs: README Art, TECHNICAL (file list, §9 Lich frames, pack stand-ins, known limitations), TODO (art gaps).

**Verified:**
- client `npm run build` (atlas, tsc, vite) and `npm test` (17 tests).
- `?gallery` screenshots (idle, move, cast), no browser errors.
- `docker compose up --build -d` (2026-10-13), then a throwaway bot (debug wizard, account deleted afterwards) walked the debug path to the lich on the live server and fought it for 40 s: the new sprite in the hall, the drain beams, frost bolt volleys and raised skeletons; the lobby boss card. No browser errors. The containers are left running.

**User check:** covered by the fight check in part 2.

**Open:** nothing for the lich art.

## Session before (2026-10-12 to 10-13, title logo, desktop only)

**Branch:** `feature/title-logo` is merged into `main` (fast-forward) and pushed, at the user's request. Start the next feature on a new branch from `main`.

**User decisions this session:**
- **Logo:** `images/logo.png` becomes the game's title art. It was **made with Google's image generation AI**; credit it that way ("made for this game with Google's image generation AI"), **not as the user's art**.
- **Where:** large on the login screen; a small emblem header and the darkened wall as background on character select and lobby; a favicon. The admin page stays as it is.
- **Desktop only:** phones are not a concern of this game (README.md intro and "The user's decisions" below).

**Done:**
- `client/assets-src/logo/logo.png`: the source, with the generator's ✦ watermark (bottom right) painted over once with wall from its left (one-off script, not kept).
- `client/scripts/build-logo.ts` (part of `npm run atlas`) writes `logo.png`, `logo-emblem.png` and `favicon.png` into the generated `public/assets/`. Details in TECHNICAL.md §9 "Title logo".
- `client/src/ui/logo.ts` (`logoHero`, `logoHeader`) replaces the gold text `<h1>` in `auth.ts`, `characters.ts`, `lobby.ts` and `fatal()` in `main.ts`; the room view keeps its text heading. CSS in the lobby section of `style.css`. Note: `.hero` was already taken (the lobby's character panel), so the large logo is `h1.logo.splash`.
- Credits in README.md (Art) and TECHNICAL.md.
- Review fix: the header emblem's edge fade was so tight that it faded the "A" and "S" of ADVENTURERS; it now starts at 70% (`#000 70%, transparent 85%`), checked with a headless Chrome screenshot.

**Verified:**
- client `npm run build` (atlas + logo, tsc, vite) and `npm test` (17 tests).
- Docker: `docker compose up --build -d` (2026-10-13); `/`, `/assets/logo.png`, `/assets/logo-emblem.png` and `/assets/favicon.png` answer 200 on port 8080. The containers are left running.
- Screenshots (throwaway Playwright script against the dev server, test account deleted) of login, character select and lobby at 1280×720 and 390×844: no horizontal scroll, favicon served, no browser errors.
- The user looked at the logo screens in the browser: "The logo screens are nice" (2026-10-13).

**Open:** nothing for the logo.

## Session before (2026-10-09 to 10-12, dragon rework: own art, flight, bite)

**Branch:** `feature/dragon-rework` is merged into `main` (fast-forward) and pushed, at the user's request. Start the next feature on a new branch from `main`.

**User decisions this session:**
- **Dragon art:** the user supplied an AI-generated dragon and then AI-generated animation strips (walk, claw, bite, tail whip, flight) made from it, on a magenta background. The source JPGs were deleted afterwards at the user's request; the imported PNGs in `client/assets-src/dragon/` are now the only sources. They replace the hue-shifted pack lizard. Credit: "AI-generated for this game" only; **do not credit the user as the artist**.
  - The frames the strips don't cover (idle, breath with the mouth opening, take-off, landing) are generated from the base sprite at atlas build time; the user asked for them and approved them in `?dragon`.
  - The user asked for a `?dragon` demo before every gameplay step and approved it ("Ok") before the server work.
- **Flight phases on a timer:** every 10–12 s it takes off (0.5 s, standing still), hovers after the party for 3.5 s and lands (0.6 s). Pathing stays on the ground (visual flight). While airborne: **melee can't hit it** (sword/axe arc, dagger, dash), projectiles and spells still do, and its **only attack is the breath**.
- **Landing = ground smash** with a shockwave and a ring telegraph.
- **Every dragon attack but the breath pushes:** claw 32, bite 24, tail 44, smash 36, fireball explosion 20 (this overrides "ranged never pushes" for the dragon's fireballs only).
- **Bite as an extra front attack** ("bite straight ahead"): narrow arc (±0.35 rad), 46 px reach, 28 damage, own 3 s cooldown; used before the claw when ready; the claw (wide arc, 40 px, 20 damage) stays.

**Done:**
- **Art pipeline:** `client/assets-src/dragon/` holds `dragon_base.png` and the aligned strips; `client/scripts/dragon-frames.ts` builds the 45 dragon frames into the atlas; poses, strip layouts and the breath points are in `client/src/game/anim/dragonRig.ts` (shared). See TECHNICAL.md §8 "Dragon frames" for how the strips were imported (one-off scripts; redo the same for new strips).
- **Client:** `anim/pickFrame.ts` (frame choice for figures with own frames, with tests); `FigureDef` gained `frames`, `windups`, `lift`, `footY`, `bite`, and `slam` became `{r, anim, t}`; the hue option is gone. `EntityView`: body lift over the shadow, the wind-up flash for attack anims that include their wind-up, the landing ring, the bite effect, anchoring on `footY`. `?dragon` demo (`DragonDemoScene.ts`). Gallery states `bite`, `takeoff`, `land`. The knockback demo plays the dragon's wind-up frames. Lobby preview uses the dragon frames (`walk` when a figure has no `run`). The client's dagger prediction ignores an airborne dragon.
- **Server:** `Anim::TakeOff/Land/Bite` (11–13), `flags::AIRBORNE` (64), `Monster.airborne`, `Projectile.knock` (+ a `knock` parameter on `spawn_monster_projectile` and `explode`), `DRAGON_*` consts in `defs/bosses.rs` (exported). `run/bosses/dragon.rs` rewritten: flight state machine, attack anims start at the wind-up, a short recovery after each strike, bite/claw choice, landing smash.
- **Tests:** 140 server tests (6 new: bite before claw, bite arc, flight cycle with smash, smash radius, melee/dagger/dash vs airborne, explosion push); 17 client tests (pickFrame with bite).

**Verified:**
- `cargo test` (Docker), client `tsc` + `vitest`, `npm run atlas`.
- `?dragon` screenshots of every action, no browser errors.
- `docker compose up --build -d` + health, then a throwaway bot (debug paladin, deleted) walked the debug path to the dragon and fought it for 60 s on the live server: the snapshots showed Bite, claw, Tail, Breath, volley, TakeOff, Land and the AIRBORNE flag; screenshots of take-off, hovering, the landing ring and the attacks; no browser errors.

**Not yet verified:** the user playing the dragon fight live.

**Open:**
- In flight the dragon looks a little bigger than standing (the flight strip is drawn ~10% larger).
- The bite's numbers are first guesses; balancing is the planned combined pass.

## Session before (2026-10-09, admin area, statistics, OpenTelemetry)

**Branch:** `feature/admin` is merged into `main` (fast-forward) and pushed.

**User decisions this session:**
- **Admin login:** a username and password from environment variables (`ADMIN_USER`, `ADMIN_PASSWORD`), not a game account.
- **Admin session:** ends after **10 minutes without an admin action**, configurable with `ADMIN_SESSION_MINUTES`. Every admin action restarts the clock; the dashboard auto-refresh does not. 
- **Player sessions:** also an idle timeout now: **7 days without activity** by default, configurable with `PLAYER_SESSION_MINUTES`. API requests, connecting to the game and leaving it count as activity; token and cookie have a 1-year hard limit.
- **Metrics:** all four groups (player activity, runs, characters, trend charts), on a **separate `/admin` page**.
- **Actions:** delete players, change passwords and delete characters, all recorded in an **audit log**.
- **Monitoring:** the user first asked for ClickStack in separate containers, then changed it: **keep everything in the admin area**, but make the server **ready to send OTEL metrics, logs and traces** for a later collector such as ClickStack. No monitoring containers were added.
  - Note for later: ClickStack's multi-container setup stores HyperDX's metadata in **MongoDB (SSPL)**, which the user's OSI-only rule excludes. Raise this before setting it up (alternatives: HyperDX local mode, FerretDB, or an exception).

**Done:**
- **Server, new modules:**
  - `admin.rs`: admin routes, `AdminState` with in-memory sessions, and the `AdminSession` extractor.
  - `stats.rs`: read-only statistics, player and audit queries, with their ts-rs types.
  - `telemetry.rs`: console log, OTLP export and the `Metrics` instruments.
- **Migrations:**
  - `0002_admin_stats.sql`: `activity_days`, `runs`, `run_players`, `admin_actions`, with no foreign keys so history outlives deleted accounts anonymously.
  - `0003_run_players_left.sql`: `left_run`.
- **Run recording:** `Run::record(outcome)`, then `lobby::finish_run(…, record)`, then `db::record_run`. Activity is noted at login, registration and WebSocket connect.
- **New player and member fields:** `Player.account`/`Member.account`, and `Player.left`, because leaving a dungeon sets `alive = false` in the game but must not count as a death in the statistics.
- **Auth:** `auth::AdminLogin` (constant-time digests, password at least 12 characters), the `ta_admin` cookie scoped to `/api/admin`, and `cookie_value`.
- **`main.rs`:**
  - `/admin` serves `admin.html`.
  - `TraceLayer` adds one span per request, named by route.
  - Ctrl-C or SIGTERM stops the server and flushes telemetry.
  - All Vite hashed bundles (not only `index-*`) are cached immutable.
- **New dependencies** (all Apache-2.0 or MIT):
  - `opentelemetry`, `opentelemetry_sdk` and `opentelemetry-otlp` 0.33 (HTTP/protobuf, no TLS);
  - `opentelemetry-appender-tracing` 0.33 and `tracing-opentelemetry` 0.34;
  - the `tower-http` `trace` feature and the `tracing-subscriber` `env-filter` feature.
- **Client:**
  - `admin.html` plus `src/admin/` (main, api, charts, dom, admin.css), a second Vite entry.
  - Views: dashboard (live tiles, who is online, today/7/30-day table, totals, bosses, classes, upgrades histogram, top 10, three 30-day SVG charts), players (search, sort, paging), player detail (characters with Delete, recent runs, change password, delete player with name confirmation) and the audit log.
  - Light and dark mode. Chart palette slots 1–2 were validated with the dataviz validator.
- **Config:**
  - `.env.example` and `docker-compose.yml` gained `ADMIN_USER`, `ADMIN_PASSWORD` and the `OTEL_*` variables.
  - **The user's `.env` was not changed:** they need to add `ADMIN_USER` and `ADMIN_PASSWORD` themselves.
- **Smoke test:** an admin pass runs when `ADMIN_USER` and `ADMIN_PASSWORD` are set (TECHNICAL.md §12).
- **Docs:** TECHNICAL.md (§2, §3, §11a banking, new §11b admin and §11c OpenTelemetry, §12, §13), README and TODO.

**Checked:**
- 130 server tests against Postgres. They cover statistics windows, anonymous history, search and paging, admin writes, admin auth, the run record and telemetry with the in-memory exporter.
- Client typecheck, 11 tests and the build (it outputs `admin.html`).
- `docker compose up --build`: migrations 0002 and 0003 applied to the existing local database.
- curl checks:
  - 401 without a cookie and with a player cookie;
  - 401 for a wrong login, 429 on the 6th;
  - 415 without JSON;
  - a password change revokes the old session, and the old password fails while the new one works;
  - deleting twice gives 404;
  - the audit rows are written;
  - logout works;
  - with no admin variables every `/api/admin/*` route gives 404.
- Smoke test with the admin pass, no browser errors. Screenshots of the dashboard (light and dark), player page and audit log were checked.
- OTLP against a throwaway `otel/opentelemetry-collector` (debug exporter): traces, logs and all metrics arrived with `service.name=tiny-adventurers-server`, and no player names or passwords appeared in the exported data.

**Found on the way:**
- **Leavers counted as deaths:** the first dashboard showed hero deaths for runs that were only left. That led to `Player.left` and migration 0003.
- **Migration fixed in a new file:** 0002 had already been applied to the local database by the test run, so the fix is a new migration (0003). Dropping the tables to edit 0002 was refused by the permission check.
- **Old test rows remain:** the local database still holds a few test runs from before the fix, whose leavers count as deaths. They are test data only.
- **Throttle test locks out the IP:** the admin throttle check locks out the test IP for 5 minutes. Restart the game container before the smoke test if you run both.

**Confirmed live by the user:** the admin login works (with the test credentials in `.env`).

**Local setup left behind:**
- The user's `.env` now has **test** admin values (`ADMIN_USER=admin`, `ADMIN_PASSWORD=tiny-admin-test-2026`), added at their request. They must be changed before the game is public.
- `ADMIN_SESSION_MINUTES` and `PLAYER_SESSION_MINUTES` are not in `.env`, so the defaults apply (10 minutes and 7 days).

**Next steps (suggestions):**
- A monitoring stack for the OTLP export (see the MongoDB note above for ClickStack).
- Read `X-Forwarded-For` behind a proxy (TODO.md).
- The balancing pass and loadouts stay open (TODO.md).

**Not yet verified:**
- The user did not report trying every admin action (deletions, password change) live; the smoke test covers them.
- A won or lost run through the browser was not recorded live. Only abandoned runs were; won and lost runs are covered by tests.

## Session before (2026-10-09, accounts, characters and PostgreSQL)

**Branch:** `feature/accounts` is merged into `main` (fast-forward) and pushed. Start the next feature on a new branch from `main`.

**User decisions this session:**
- **Characters:** progress is tracked per character, not per player. An account has up to **8 characters** of any class, two Wizards included. Each character has a name, a class that never changes, and its own XP, coins and upgrades. Character names are unique across all accounts.
- **Accounts:** register, login, logout and delete only. **No e-mail and no personal data** (GDPR), so there is no password recovery. **Login is required** to play. Old `profiles.json` data was discarded (test data only).
- **Database:**
  - The user requires an **OSI open-source license**. MongoDB was rejected (SSPL).
  - The user questioned document databases, then chose **PostgreSQL 17** (PostgreSQL License, MIT-like) in its own container, with a **hybrid model**: relational accounts/sessions/characters, and all progression in **one versioned JSONB document** per character, so progression can change later without SQL migrations.
- **Tamper protection:** the server is authoritative. The client only displays progress and never sends any. Sessions are **HMAC-SHA256-signed** cookies backed by the database, so they can be revoked.
- **No Valkey/memcached cache** (asked about for heavy use): the database is only touched at login, connect, select, purchase and run end. An in-memory store only makes sense later for several game servers (presence, run list); see TECHNICAL.md §11a "Scaling later".

**Done:**
- **Server, new modules:** `auth.rs`, `db.rs`, `api.rs`, `progress.rs`, plus `migrations/0001_accounts.sql`. `profiles.rs` is deleted.
  - New dependencies: `sqlx` (runtime queries, so the build needs no database), `argon2`, `hmac`, `sha2`, `base64`.
- **Protocol:**
  - `Hello`, `SelectClass`, `Profile` and `ProfileInfo` are gone.
  - New: `SelectCharacter{id}`, `Character(CharacterInfo)`, and the JSON API `/api/*` (TECHNICAL.md §4).
- **Lobby:**
  - Keyed by account, one connection per account (a second login closes the first).
  - Caches the selected character. Never queries the database itself: `main.rs` does the query and then applies the result.
  - `Award` and `Member` carry `character` instead of the token. `finish_run` banks in one transaction.
- **Client:**
  - `api.ts`, `ui/auth.ts` (login/register), `ui/characters.ts` (list, create with the class cards, delete, logout, delete account) and `ui/classes.ts` (shared figures and class card).
  - The lobby shows the played character with "Change character". The room has no class picker any more.
  - `localStorage` is no longer used.
- **Docker:**
  - A `db` service (`postgres:17-alpine`, `ta-db` volume, healthcheck, not published). Secrets live in `.env` (gitignored; `.env.example` committed).
  - `docker-compose.test.yml` runs `cargo test` against a throwaway Postgres.
  - The old `ta-data` volume is unused; the user may remove it (`docker volume rm tinyadventurers_ta-data`).
- **Smoke test:** registers two throwaway accounts, creates characters, plays, checks that a second login closes the first window, and deletes the accounts.

**Checked:**
- 101 server tests, run against Postgres. They cover the parallel bank/buy race, the 8-character cap, case-insensitive names, session revocation, cascades, old JSON documents, tampered and expired tokens, and lobby banking end to end.
- Client typecheck and tests.
- `docker compose up --build`, health, and migrations at start-up.
- curl checks:
  - duplicate name 409, short password 400;
  - identical 401 for a wrong password and an unknown name;
  - 415 without JSON;
  - the 9th character gets 409;
  - a tampered cookie gets 401;
  - `/ws` gives 401 without a cookie and 403 from a foreign origin;
  - the limiter gives 429 after 5 failed logins.
- The smoke test passed with no browser errors. Screenshots of login, characters and lobby were checked.

**Bug found by the user and fixed (commit `663ccbd`):**
- **Symptom:** after a run, W, A, S, D, Q and E could not be typed into DOM inputs, such as the delete-account password box and the run name.
- **Cause:** Phaser's `addKeys` captures keys by default, which calls `preventDefault` page-wide and outlives the scene.
- **Fix:** `GameScene` passes `false` for the capture.
- **Regression check:** the smoke test now leaves a run, types the password (it contains w/a/s/d/e) and deletes Bob's account through the form. It failed on the old build (`mok-tt-por`) and passes now.

**Not yet verified:**
- The user has only tried account deletion live; the rest of the flow they have not tried yet.
- A real run that ends was not banked through the browser. It is covered by `lobby::tests::a_finished_run_banks_on_the_played_character_only`.

**Open questions for the user:**
- **Asset pack:** the user asked whether "the new asset pack" was registered. Nothing new was added. The only approved but unused pack is superdark's "Enchanted Forest Characters" (TODO.md). When it is used: check its license, put it in `client/assets-src/superdark/` with the license file, and add it to the README credits and TECHNICAL.md.
- **`images/`:** answered 2026-10-13, see "The user's decisions" (inbox for new assets, keep it).

## Session before (2026-10-08, ogre mini-boss)

**Branch:** `feature/ogre` is merged into `main` (fast-forward) and pushed.

**User decisions this session:**
- **Look:** the user approved an enlarged sprite preview (pack `ogre_*` with `weapon_baton_with_spikes`). The club is held **out at its side and lower** (`handX: 12`, `handY: 14`) and is **1.4x** the usual weapon size, because at the demon's hand height it covered the face.
- **Attacks:** a **club** that pushes (28 px, the strongest normal-enemy push) plus a **ground slam** with a **telegraph ring on the floor** that hits and pushes every hero inside it.
- **HP display:** a **wide bar over its head**, always visible (no boss bar, no protocol change).
- **Every dungeon** gets one ogre, the demon's included.
- **Debug mode:** the user asked for a **blue path to the ogre** next to the yellow boss path.
- Numbers are placeholders for the combined balancing pass (TODO.md, New enemies).

**Done:**
- **Server:**
  - `EnemyType::Ogre` (`KIND.Ogre` 22): 260 HP, speed 40, radius 10, club `Melee{knock: 28}`.
  - New `AttackStyle::Slam` as its alt: radius `OGRE_SLAM_RADIUS` 34 px (hero centres), 0.9 s wind-up, 24 px push, 5 s cooldown. It is used when two heroes are near, or one while the club recovers.
  - New `Anim::Slam` (10) for the slam wind-up. `Ev::Boom{k: 5}` marks the impact.
  - 60 XP and 30 coins.
  - A wide enemy (radius > 8) chases with `path_toward` (A* with clearance) instead of a straight line.
- **Spawn:** `place_ogre` runs on **rng stream 10**, after the terrain. It picks a deeper room or hall and a tile with safe ground all around and no chest. Existing seeds keep their maps, spawns and chests.
- **Client:**
  - `FIGURES[KIND.Ogre]` with the new `FigureDef.handX` (default 3; the swoosh uses it too) and `slam` (radius).
  - `EntityView.slamFx` draws the floor ring: it fills from the centre over the wind-up and blinks at the end. The club rises over the head.
  - `Effects.shockwave` is the dust ring, debris and screen shake for `Boom k=5`.
  - The wide HP bar is in `GameScene.drawBarsAndBeams`.
- **Demo `?ogre`** (`OgreDemoScene.ts`): the orc's 20 px push next to the club's 28 px (only the club knocks the hero into the chasm), and the slam with four heroes (three pushed, one into a chasm, one spared outside the ring). The terrain demo base got a `slam` step and an optional `windup` on `hit`. The user approved it.
- **Debug path to the ogre:** `DebugPath` has a new field `ogre` (the path to the living ogre, empty once it is dead), drawn in blue. The badge and the message name both colours.

**Checked:**
- 80 server tests. 2 are new: the ogre's attack choice, and the slam hitting and pushing everyone in its radius while sparing those outside. Extended: club and slam push; exactly one ogre per seed on safe ground, outside the boss hall, in the 200-seed test; the debug path leads to the ogre and disappears when it dies.
- Client typecheck and tests.
- `docker compose up --build` + health, smoke test under `?lag=150&jitter=40&loss=2` (no browser errors, correction 0.00 px), and `?debug` smoke.
- `?ogre` screenshot series.
- A throwaway bot (deleted) walked the blue path to the ogre in a real run. Screenshots show the ogre, its wide bar and the blue marker on it, with no browser errors.

**Found on the way:** the user first couldn't find the ogre because the container on 8080 was still the old build. Rebuild the container (`docker compose up --build -d`) before the user tests a server change.

**Confirmed live by the user:** the ogre works, and so does the blue debug path.

**Not added:** a test that the other spawns and chests stay the same with the ogre. That holds by construction: stream 10 is a clone and never advances the main rng.

## Session before (2026-10-08, knockback and boss-hall chasms)

**Branch:** `feature/knockback` is merged into `main` (fast-forward) and pushed. Start the next feature on a new branch from `main`.

**User decisions this session:**
- **Only strong melee pushes:** orc warriors (20 px) and chorts (14 px; imps do not). The demon's **cleave (36 px) and swoop (44 px)**. The dragon's **tail swipe (44 px)** and a **new front claw (32 px)**, both asked for by the user. **No ranged attack pushes.**
- Distances approved in the `?knockback` demo. **A pushed hero has no control for the whole slide**, and **a dash cannot escape a push**.
- **Every boss hall gets chasms** (all three bosses), mixed: wall-side drop-offs plus pits. The user's reasoning: knockback only matters in boss fights if there is something to be knocked into.
- **The ogre waits for the next session.** It will be one per run, roaming like other enemies, with a spiked club (`weapon_baton_with_spikes`). The user wants to **see the sprite first** (pack `ogre_*`, 32x36).
- **New art source:** the user approved "Enchanted Forest Characters" by superdark (https://superdark.itch.io/enchanted-forest-characters) for future monsters.

**Done (commits on the branch):**
- **Demo `?knockback`** (`KnockbackDemoScene.ts` on the terrain demo base, which now has decaying pushes, tail swipes and a swoop step).
- **Knockback in the game:**
  - `MoveState` gets `knock_vx/vy`. `step_move` (Rust and TS) slides along it with `Mover::Dash`: only walls stop it. It decays by `KNOCK_DECAY` per step, and input is ignored.
  - `apply_input` skips abilities while knocked. `Run::knock_player` starts a push, but not for dead, sinking or dashing heroes.
  - `me` carries the knock (nil on the wire when not pushed; snapshot 127 B). The predictor replays it, and the parity fixtures inject pushes.
  - Pushes into a chasm or deep water use the existing fall/drown deaths.
- **Attacks:** `AttackStyle::Melee { knock }`, the demon's cleave and swoop, and the dragon's tail swipe. The dragon's new front claw (0.4 s wind-up, 20 damage) uses `Anim::Melee`; the tail swipe now has its own `Anim::Tail`, and `FigureDef.tail` draws its swoosh behind the dragon.
- **Boss halls:** `place_boss_chasms` (rng stream 9, so the rest of each seed's map is unchanged) places 1–2 wall strips and 1–2 pits. It keeps the entrance and the boss's start clear, leaves wide gaps, and never cuts off floor.
- **Boss pathing:** bosses chase via `path_toward` (A*). Wide figures (demon, dragon) prefer paths clear of edges, skip waypoints they cannot get closer to, and walk straight when no path exists.

**Checked:**
- 78 server tests (5 new: push movement, push into a chasm with no control, short push, only strong melee pushes, wide bosses reach every spot of their hall over 24 seeds, plus boss-hall checks in the 200-seed test).
- Client typecheck and tests.
- `docker compose up --build` + health, smoke test normal and under `?lag=150&jitter=40&loss=2` (no browser errors, correction 0.00 px).
- `?knockback` screenshots.
- A throwaway bot (deleted) walked the debug path to the dragon. Screenshots show the hall with a wall strip and a pit, the force field and the fight with pushes, and there were no browser errors.

**Found on the way:** the reachability test first failed because a wide boss was sent to tile centres it cannot reach (next to walls). That is fixed by skipping such waypoints and making clearance a cost.

**Confirmed live by the user:** "Everything works as intended": pushes in real runs and boss fights, and the boss-hall chasms. No push immunity for now. Chained pushes by orc mobs stay a TODO item in case they become a problem.

## Session before (2026-10-08, bugfix: coin icon)

**Bug:** the coin icon before the coin count (lobby and HUD) showed as a blank blue box. The CSS sprite in `client/src/style.css` (`.coin-icon`) scaled the atlas to 1536x1536 px, but the atlas is 512x736, so the icon sampled the wrong region. **Fix:** `background-size: 1536px auto` keeps the aspect ratio. Committed directly on `main` (small bugfix).

**Confirmed by the user:** the coin icon looks right, and a run after the compact snapshots change plays as before.

## Session before (2026-10-08, compact snapshots and inputs)

**Branch:** `feature/compact-snapshots` is merged into `main` (fast-forward) and pushed. Start the next feature on a new branch from `main`.

**Live confirmations by the user (start of this session):**
- **Terrain:** a normal water run, falling into a chasm and drowning work.
- **Chests and mimics** work in a real run.
- **Rewards:** XP and coins are banked after a real run and visible in the lobby.

**Why:** the user wanted smaller network messages as a tidy-up and asked whether binary compressed messages are a good way. Answer given: the messages were already binary (MessagePack). General compression (deflate) gains little on 250-byte messages and costs CPU per player. The user chose the simple option: compact encoding, no delta snapshots.

**Plan and spec:** [docs/compact-snapshots.md](docs/compact-snapshots.md) (spec) and [docs/compact-snapshots-plan.md](docs/compact-snapshots-plan.md) (the executed plan).

**Done:**
- **Snapshots are a bare MessagePack array** (`SnapW`, `server/src/wire.rs`):
  - no field names
  - entity and event positions in 1/16 px as whole numbers (`POS_SCALE`; fine for maps far beyond today's 2,240 px)
  - entity aim as one byte
  - events with number codes (`EV`)
  - `me` and all hp/damage values stay exact, so prediction is unchanged
- **The client unpacks** it into the old `Snapshot` (`client/src/wire.ts`, called in `net.ts`). Nothing after `net.ts` changed.
- **Inputs are a bare array** (`InputW`). The server recognizes the array marker.
- **Fixture test:** `cargo test` writes `wire-fixtures.json`, and `wire.test.ts` checks that the client unpacks what Rust packed.

**Measured** (F3 and a throwaway bot script that walks the debug path to the demon):

| Scene | Before | After |
|---|---|---|
| 2 players | 248 B | 126 B |
| fight, 14 entities in view | about 570 B | about 350 B |
| average in the busy run | 255–298 B | 174–183 B |

Each entity costs about 19 B instead of about 27 B.

**Checked:**
- 73 server tests (12 new: 5 wire tests, the wire fixture export and 6 ts-rs export tests for the new types), and the client typecheck and tests (4 new). The client test catches a broken aim range and a wrong position scale; both were tried on purpose.
- `docker compose up --build` + health, and the smoke test with no browser errors, also under `?lag=150&jitter=40&loss=2` (correction 0.00 px).
- The busy bot run under lag with no browser errors. Screenshots look as before: enemies face correctly, projectiles point the right way, events show up where they happen.

**Finding, not caused by this change:**
- In the busy bot run under lag, F3 showed prediction corrections of up to about 10–23 px in about a third of the samples.
- The **old** format showed the same (18 of 83 samples, max 9.6 px).
- The predictor reads only `me`, `ack` and its own inputs, which are identical in both formats.
- Listed in TODO.md (Network) for a later look.

## Session before (2026-10-08, terrain steps 2–6: terrain in real runs)

**Branch:** `feature/terrain-rules` is merged into `main` (fast-forward) and pushed.

**User decisions this session:**
- **Knockback is its own feature, later.** It is not part of terrain. So in real runs drowning only happens when a dash ends in deep water, and enemies never end up in terrain.
- All remaining terrain steps (2–6) on one branch.

**Done:**
- **Tile rules (server and client, prediction parity):**
  - New tiles `ShallowWater=5`, `DeepWater=6`, `Chasm=7`, `Lava=8`.
  - `Map::solid` is gone. It is replaced by `opaque` (sight and projectiles; terrain never blocks them), `blocks(x, y, mover)` with `Mover::{Hero, Enemy, Demon, Dash}`, `speed_factor` and `safe`.
  - The client ports are `sim/map.ts` and `sim/collision.ts`. The parity fixtures include every terrain kind (10 walks with dashes).
- **Gameplay** (`Run::terrain_player`, `kill_player`):
  - A chasm or the end of a dash over deep water starts a fall (0.7 s) or a drowning (0.9 s), sent as `Ev::Sink`, then death ("X fell into the abyss" / "X drowned").
  - Lava burns 10 every 0.5 s through `hurt_player`.
  - Debug heroes climb back out onto the centre of their last safe tile.
  - The predictor applies the same sinking rule, so a fall needs no round trip.
- **AI:** each monster has a `mover`. Demon types (imps, chorts, summoners, summoned imps, the demon boss) cross lava at full speed; other enemies avoid lava. No enemy enters a chasm or deep water. The straight-line shortcut uses `walk_line`, and the debug path avoids all terrain.
- **Generator:** `generate(seed, Theme)`, with the boss picked first in `Run::new`. `place_terrain` runs on rng stream 8:
  - It places oval pools (water: deep centre inside a shallow rim; lava: all lava) and wall-to-wall chasm strips at most 3 tiles wide, each with a floor bridge.
  - It keeps away from corridor mouths and chests, and undoes a feature that cuts off safe ground or brings a room as far as the boss hall.
  - Covered enemy spawns move to the nearest free floor tile.
  - About 4 % of the floor becomes terrain; the start room and boss hall stay clear.
- **Rendering:**
  - `TerrainLayer` runs in `GameScene`, and walls treat terrain as floor-like.
  - Figures wade, splash, ripple and get embers in lava; heroes fall or drown with the demo animations and leave no skull.
  - The shared helpers (`WadeFx`, `sinkStartFx`, `bubbleFx`) are used by the demos too. The temporary `TERRAIN` constants now come from `TILE_ID`.
- **Docs:** PLAYER_GUIDE (new terrain section and a tip), TECHNICAL (§4–§9, tests), TODO (terrain follow-ups and tuning values), README, terrain-plan status.

**Checked:**
- 61 server tests (13 new: the rule matrix, slowing, dash over terrain, chasm fall with the debug rescue, drowning, lava burn, demon movers, A* per mover, terrain-safe generation over 200 seeds for both themes).
- Client typecheck and parity tests.
- `docker compose up --build` + health, and two smoke runs (normal, and `?debug&boss=demon`) without browser errors.
- The three demos still load.
- **Real runs, screenshots** (throwaway scripts, deleted afterwards):
  - lava pools, water pools and chasm strips render with correct walls
  - a hero walked into lava: slowed, burning numbers, embers
  - a hero walked into a chasm in debug mode: predicted fall, then back on safe ground
  - correction stayed at 0.00 px under `?lag=150&jitter=40&loss=2`

**Live test by the user (after the session's fixes):**
- First report: in normal mode lava showed as dark cells, hurt, and made the hero glitch. The cause was a stale cached client for `/`, not the terrain code: the server sent no `Cache-Control`. Fixed by `cache_headers` in `main.rs` (see Gotchas).
- After a hard reload, the user confirmed that it works in normal mode.

**Later confirmed by the user (2026-10-08):** a normal water run, a chasm fall and drowning work in the browser.

## Earlier session (2026-10-07, terrain step 1: tiles and demos)

**Branch:** `feature/terrain` is merged into `main` (fast-forward) and pushed.

**Plan:** [docs/terrain-plan.md](docs/terrain-plan.md) has the full step plan and all of the user's terrain decisions. All of its steps are done now.

**Why:** this is the terrain sub-project the user asked for (water, chasms, lava).
- **Art:** no CC0 set fit the 0x72 style. Rejected: Puny Dungeon (grey stone), Ogrebane (plain textures, no edges), Dawngeon (other perspective), cave_ by Kevin's Mom's House (flat cartoon look), and Niji's Extended pack (no water or lava). 0x72's own Sewers set costs money, and the user doesn't like it anyway.
- So the user allowed **self-made terrain tiles**, for terrain only. They are generated by a script from pack colours, never self-drawn figures.

**Done:**
- **Tile generator** `client/scripts/terrain-tiles.ts`, run by `build-atlas.ts`, so no image is committed. It uses only 0x72 colours plus the pack's `floor_1` and the pack's 3/4 view.
  - Seamless animated base textures: shallow water, deep water, lava and the chasm void. The pieces are picked by tile position (`TERRAIN_PERIOD`).
  - 47 edge overlays per edge set (`shore`, `deep`, `lava`, `chasm`): north bank faces (masonry on the chasm cliff), rims and rounded corners. They are keyed by a 4-digit quarter code from the 8 neighbours (`terrain-codes.ts`, shared with the client).
- **`client/src/game/terrain.ts`:** `TerrainLayer` draws and animates the terrain cells and adds a red lava glow and embers. Also `speedFactor` and `sinkDepth`.
  - The terrain tile ids are temporary local constants (`TERRAIN`, 5–8). Replace them with `TILE_ID` once the server has the tiles.
- **`EntityView` hooks:** `sink` (wading: the feet are cut off), `fall` (shrinks 20 % and darkens into the dark) and `drown` (sinks below the surface, turning blue).
- **Demos** (`TerrainDemoScene.ts`, `?water`, `?chasm`, `?lava`): scripted figures only, with no game rules on the server yet.

**User decisions made in the demos (all in the plan):**
- Shallow water slows everyone. Enemies walk in too.
- Deep water blocks walking, but a figure knocked in, or ending a dash in it, **drowns** ("X drowned").
- A chasm is **instant death** ("X fell into the abyss"). The dash jumps it, and only where the dash ends counts.
- Lava is walkable for heroes, **slows a lot** and burns for **at least 15 damage/s** (the demo uses 20/s). Demon-type enemies are immune and walk straight through. Other enemies avoid lava.
- The theme follows the boss: lava mainly in the demon's dungeon, water elsewhere, chasms everywhere.

**Later answered:** knockback became its own feature (2026-10-08). Only the **Barbarian** has a dash (54 px, about 3 tiles), so chasms are at most 3 tiles wide.

**Checked:**
- Client typecheck.
- The three demos load without browser errors.
- Slow-motion screenshot series of wading, the dash over the stream, the drowning, the chasm fall (walking in and being knocked in) and the burning.
- The user reviewed and approved the demos after two rounds of changes: the fall animation, a stronger lava glow and more lava damage, drowning, and enemies wading.

Steps 2–6 followed in the next session.

## Earlier session (2026-10-07, demon dungeon: imps, chorts, summoners)

**Branch:** `feature/demon-minions` is merged into `main` (fast-forward) and pushed.

**Why:** the user wanted more variety and asked about chasms and water. The 0x72 pack has none (only `hole`, `edge_down`, wall fountains and goo), so **the user allowed other CC0 tilesets that fit well, for terrain and for enemies**. The user also pointed out the pack's small demons and asked for them in place of skeletons when the demon is the boss, with melee and fire bolts. Terrain (water, chasms) is the next sub-project; nothing has been done for it yet.

**Done:**
- **Demo first:** `?daemons` (`DaemonDemoScene.ts`). The user picked **imps (ranged) + chorts (melee)** from it.
- **Imp** (`EnemyType::Imp`): fire bolts from range and keeps its distance; claws when a hero gets close. **Chort**: closes in and claws; throws a fire bolt now and then from at least 40 px. Both use the new optional second attack (`EnemyDef.alt`, own cooldown `Ai.alt_cd`, `Windup.alt`). New projectile `FireBolt`.
- **Summoner** (the user's name for it): the necromancer's demon-dungeon counterpart. It shoots fire bolts and summons imps (`SummonedImp`, a fiery summon ring). Its sprite is the pack necromancer with a **red robe**, recolored with pack colors at atlas build time (`RECOLORS` in `client/scripts/build-atlas.ts`, codec in `scripts/png.ts`). The user asked for this asset change.
- **Swap at run start** (`enemies::for_boss`): with the demon as boss, skeleton archers → imps, skeleton warriors → chorts, necromancers → summoners. Maps and spawn spots stay the same for every seed.
- **Minions are no longer tinted** (user's request): raised skeletons lost their green tint; summoned imps look like normal imps.
- Stats start close to the skeletons they replace, with the same XP (summoner 25, summoned imp 2). Tuning waits for the balancing pass.

**Checked:** 53 server tests (5 new: demon swap with same spawns, imp and chort attack choice by distance, the alt attack's own cooldown and fire bolt, summoned imps), client typecheck and tests, `docker compose up --build` + health, smoke tests (normal and `?debug&boss=demon`, no browser errors), `?daemons` screenshots (all four lanes, red-robed summoner, untinted summoned imps).

**Live test (by the user, after the merge):** the user played a demon run; imps, chorts and summoners "work well". No problems found. Balancing still waits for the combined pass.

## Earlier session (2026-10-07, chests, mimics and coins)

**Branch:** `feature/chests` is merged into `main` (fast-forward) and pushed.

**Why:** the user found the dungeons empty apart from enemies and asked what else the pack offers. Answer given: chests (full/empty/mimic opening animations) and coins, plus spikes, buttons/levers, columns, wall fountains, goo, crates, flasks, bombs, ladder/stairs; only a single `hole` tile and `edge_down` (no real chasms, no bridges), and no water or lava floor tiles. The user chose chests + mimics + coins.

**Done:**
- **Mimic demo first, as the user asked:** `?mimic` (`MimicDemoScene.ts`). The user picked the **hopping chaser** over a stationary biter and liked the reveal. The demo now shows the chaser, a treasure chest and the reveal.
- **Figure bases removed (user's request):** every figure stands on a soft ground shadow instead of a coloured miniature base. `FigureDef.base` stays as the accent colour for particles; `baseR` sizes the shadow. The player guide no longer names heroes by ring colour.
- **Chests:** `place_chests` (generator, own rng stream so old seeds keep their maps): ~1 in 3 rooms/halls, on the top row against the wall, 25 % mimics. Touching opens a chest; 8–15 coins to every living party member (`Ev::Coins`, party-wide).
- **Mimic** (`EnemyType::Mimic`, `KIND.Mimic`): a sleeping monster drawn as a closed chest. Wakes when touched or hit, holds 0.6 s for the reveal, then chases with a hop gait (`ai::gait`: moves only in the airborne part of the hop cycle; the timings are exported in `CONST` so the client draws the same phases). Bites in melee. Rattles now and then when a hero is close. The boss waking does not wake mimics. Worth 15 XP and 25 coins.
- **Coins** are a second currency: `Player.coins`, `Profile.coins` (serde default), banked with XP at run end (`Run::awards` → `Award{token, xp, coins}`), shown in the HUD (pack coin icon), the end table and the lobby. Nothing to buy yet: meant for loadouts. Boss kill gives 50.

**Checked:** 48 server tests (3 new: chest opening pays the party once; mimic sleep/wake/hold and boss-wake exception; mimic moves only while airborne; plus chest guarantees over 200 seeds), client typecheck and tests, `docker compose up --build` + health, two-player smoke test (no browser errors; HUD coin counter and lobby coins visible), `?mimic` screenshots (hop, bite, chest coin burst, reveal).

**User feedback:** the user likes the mimics a lot. Coin amounts, chest rate, mimic share and mimic stats are left for the combined balancing pass later (listed in TODO.md); don't tune them piecemeal.

**Later confirmed by the user (2026-10-08):** chests, mimics and banked coins work in a real run.

## Earlier session (2026-10-07, wall corners and boss force field)

**Branches:** `fix/wall-corners` and `feature/force-field` are merged into `main` (fast-forward) and pushed.

**Done:**
- **Walls hug the floor, junctions are corners.** Side-wall strips moved from the outer edge to the floor side, and south walls draw their rim at the top of the cell (`TileDraw.dy`) (`client/src/game/autotile.ts`). The cells behind walls are usually `Void`, not `Wall`; neighbour checks must not require `isWall` there.
- **One-tile wall stubs filled in the generator.** Overlapping carves left wall cells with floor on three sides; they always draw as a T, whatever the tiles. `remove_stubs` in `server/src/dungeon/generate.rs` fills them (only where floor already wraps around, so no new path opens). The 200-seed test asserts none remain; it failed on seed 0 without the fix. Same seeds now give slightly different maps.
- **Boss hall entrance:** no door any more; the entrance tiles draw as floor, so the corridor leads straight in. When the party is inside, a shimmering blue force field seals it (`client/src/game/forcefield.ts`, a runtime effect: the pack has no such sprite). It works on horizontal and vertical entrances and for late joiners/spectators. Server logic is unchanged (DoorClosed tiles still block movement and sight). Both orientations are in the gallery.
- **Spark texture fixed:** `spark` was generated black (`Graphics.clear()` resets the fill), so hit sparks were black crosses; they now take their tint.

**Checked:** 45 server tests, client typecheck and tests, `docker compose up --build` + health, two-player smoke test (no browser errors), gallery screenshots of the force field, and rendered test maps of the wall rules.

**Live boss test (by the user, after the merge):** all three bosses (demon, lich, dragon) played in the browser; the force field appeared when the party entered the hall; no T-shaped wall junctions seen any more (confirms the stub fix); no problems found. Balancing was deliberately not judged: the user wants one combined balancing pass later (progression, classes, boss fights).


## Earliest session (2026-10-07, boss selection and progression)

- **Done:** lobby boss selection, and permanent progression (profiles, XP banking, upgrade shop). Details: TECHNICAL.md §4 and §11a, PLAYER_GUIDE.md "XP and upgrades".
- **Workflow set up:** the first commits are on `main` and pushed. The user wants one feature per session with a handoff, doc updates and a commit at the end (see "Git and session workflow").
- **Not done in that session:** the live boss test and loadouts (loadouts need new abilities first; the user chose to defer them).

## Current state

**Working end to end in Docker (`docker compose up --build`, port 8080):**
- accounts (name + password, no e-mail) with up to 8 characters each, in PostgreSQL (`db` service, `ta-db` volume); signed HttpOnly session cookies
- lobby, 4 classes (Wizard, Paladin, Barbarian, Elven Ranger with her Dire Wolf; fixed per character), host-chosen or random end boss, random dungeon, light and darkness (torches, lava, glowing shots; heroes carry no light), vision and darkvision by entity type (humans do not see heroes in the dark, monsters only close)
- level types behind `LevelRules` (`run/levels/`); the boss dungeon is the only one so far, there is no level picker yet
- per-character progression: XP and coins banked after each run, permanent upgrades bought in the lobby
- 11 enemy types (including the mimic and the ogre mini-boss, one per run; imps, chorts and summoners only in the demon's dungeon), 3 bosses
- terrain in every dungeon: chasms everywhere, water pools (lich, dragon) or lava pools (demon), plus a lava pool in the demon's boss hall; falling, drowning, lava burns, demons immune to lava; demos `?water`, `?chasm`, `?lava`
- treasure chests and mimics; coins banked as a second currency
- permadeath with spectating, victory/defeat screens
- client prediction and interpolation, F3 stats
- compact snapshots and inputs (MessagePack arrays, `wire.rs`/`wire.ts`): about 125 B per snapshot with 2 players and nothing else in view; 160 to 200 B at the start of a run with the lighting (measured, see "Last feature")
- light sources (`run/light.rs`, `game/lightview.ts`): wall torches (E toggles, heat lights, other hits put out), lava and glowing shots; the look is not approved yet; demo `?lights`
- debug mode (paths to the boss and the ogre), sprite gallery
- the red dragon with its own AI-generated frames, flight phases (melee-immune in the air), bite, landing smash; demo `?dragon`
- the red demon with its own AI-generated frames (walk, cleave, charge, ring of fire); demo `?demon`

**Verified:**
- 245 server tests (against PostgreSQL) and 43 client tests (collision/FOV ports with terrain, the light map, wire unpacking, dragon and demon frame choice, the end screen line, the predictor) pass (2026-10-15).
- Accounts and characters: API checks with curl and the browser smoke test (2026-10-09); not yet tried live by the user.
- Two-player browser smoke tests (`tools/e2e/smoke.mjs`) run without browser errors.
- Live boss fights against all three bosses, including the force field at the hall entrance (played by the user, no problems).
- Demon dungeon enemies (imps, chorts, summoners) in a real run (played by the user, "work well").
- The ogre and the blue debug path to it (confirmed by the user, 2026-10-08).
- Compact snapshots: a real run plays as before; the coin icon in lobby and HUD (confirmed by the user, 2026-10-08).
- Terrain in a normal water run (chasm fall, drowning), chests and mimics, and XP and coins banked after a real run (confirmed by the user, 2026-10-08).
- The gallery was checked visually: animations, melee swooshes, dragon breath from the mouth and nostrils.
- The dragon's frames in `?dragon` (approved by the user, 2026-10-12); the live fight only by a bot so far.
- The demon: its new frames and walk in `?demon`, then the fight with the harder pushes (56 / 64 px) and the lava pool in its hall, played by the user: "It works as intended" (2026-10-13).

**Not yet verified:**
- The light system by the user: the look and the live test (see "Last feature, Open").
- Behaviour with real (non-headless) players over a real network.

**Git and session workflow (the user's standing instructions):**
- One feature per session. When a feature is done: update this file and the docs, run the verification checklist below, then commit.
- Branches: `main` holds the finished work. Start each feature on a `feature/<name>` branch from `main` and commit there. Ask before merging into `main` or pushing.
- Remote: `origin` = https://github.com/migosoft/TinyAdventurers.git. `main` tracks `origin/main`.
- The repo-local author is `Goll Michael <m.goll@schig.com>`. `.gitattributes` keeps LF line endings.

## The user's decisions and preferences (keep them)

- **Art:** sprites from the 0x72 "16x16 DungeonTileset II" pack, plus other CC0 tilesets that fit its style (allowed 2026-10-07 for terrain and enemies; keep their license file next to them).
  - **Terrain tiles** (water, lava, chasm) may be self-made: generated by `client/scripts/terrain-tiles.ts` from pack colours, because no CC0 set fit. The user allowed this after the search.
  - The user rejected self-drawn or procedural sprite art in general; self-drawn figures only when they ask for one (the lich, below).
  - Small recolors of pack frames with pack colors are fine when the user asks (the summoner's red robe).
  - Missing figures are pack sprites scaled or tinted.
  - **Exception, the lich** (2026-10-13): the user asked for a new lich "matching the art style of the game", about hero size, from two reference images (high-res and pixel art). It is hand-placed pixel art in pack colours (`client/scripts/lich-frames.ts`), approved in `?gallery`. Credit: "drawn for this game with Claude Code". Show changes to it in `?gallery` first.
  - **Exception, the red dragon** (2026-10-09 to 10-12): the user supplied AI-generated art and asked for animation frames built from it. Credit it as AI-generated, not as the user's work. New dragon frames: ask the user for a strip (they generate them with an image AI from the dragon picture; `client/assets-src/dragon/dragon_base.png` scaled up 16× with nearest neighbour can serve as the reference; a prompt pattern that worked: same dragon, same pixel scale and palette, N frames in a row, flat #ff00ff background, no effects).
  - Attacks are approximated by animating pack weapon sprites.
  - Runtime effect shapes (particles, glows, swooshes, rings) are fine.
- **`images/` is the user's inbox for new assets** (2026-10-13): they drop files there (untracked) that they want brought into the game. Leave the folder and its files alone, don't delete it or ask about deleting it. To use a file, copy it into `client/assets-src/<name>/` (like the logo, `images/logo.png` → `client/assets-src/logo/`) and credit it as the user says.
- **Desktop only** (2026-10-12): keyboard and mouse in a desktop browser. Phones and tablets are not a concern; don't spend effort on phone layouts or touch controls (also stated in README.md).
- **Minions are never tinted:** raised skeletons and summoned imps look like the ordinary ones.
- **Demon dungeon:** imps (ranged, claw up close) and chorts (melee, a bolt from afar) replace skeletons, summoners (red robe, summon imps) replace necromancers. The user chose this from the `?daemons` demo and named the summoner.
- **No miniature bases under figures** (the user asked to remove them); figures stand on a soft ground shadow.
- **Mimics hop after the players** (chosen from a demo over a stationary biter), and their reveal animation stays.
- **Knockback** (2026-10-08, from the `?knockback` demo):
  - only strong melee pushes: orc warrior 20 px, chort claw 14 px, demon cleave 56 / swoop 64 (raised at the user's request, 2026-10-13), dragon front claw 32 / bite 24 / tail 44 / landing smash 36
  - imps, skeletons, mimics and ranged attacks never push, except the dragon's fireball explosions (20 px, the user's request 2026-10-09)
  - no control during the slide, and a dash can't escape it
- **Boss halls have chasms** (all three bosses; wall strips plus pits).
- **Ogre mini-boss** (2026-10-08): one per run in every dungeon, roaming a deeper room; club held out at its side (1.4x size), club push 28 px, ground slam with a floor ring at the real radius; a wide HP bar instead of a boss bar; a blue debug path to it.
- **Coins are a second currency** meant for buying loadouts later.
- **Weapons** are drawn small (0.6×).
- **Melee reach is unchanged on the server:** a swoosh at the real damage reach replaces the visible full swing, and the weapon fades out and back in.
- **Walls** follow the pack's 3/4 autotiling with its corner and rim pieces (`client/src/game/autotile.ts`). Strips and rims sit on the floor side so junctions are corners: the user rejected T-shaped junctions (four rounds of feedback). Check wall changes against corridor junctions, room corners and corridor mouths before calling them done.
- **Boss hall entrance:** no door; a shimmering, semi-transparent blue force field appears when the party is inside (the user's request).
- **Debug mode is URL-only:** `?debug`, optionally `&boss=demon|lich|dragon` on the host's page (preselects the lobby's boss picker). Debug runs bank no XP. The F4 toggle was removed at the user's request; don't add an in-game toggle back.
- **Facing is left/right only:** the pack has no up/down frames. The user originally wanted 4 directions and accepted left/right for the pack. The code keeps a `Dir` hook.
- **Stack:**
  - Rust backend in a Docker container (required by the user)
  - TypeScript + Phaser client
  - dedicated server with a lobby; joining only before a run starts; permadeath with spectating
- **Responsiveness is a priority** ("no lag"): keep prediction, interpolation and lag compensation working. Check with `?lag=150&jitter=40&loss=2` and F3.
- **Planned features** (structure exists, details in TODO.md):
  - selectable primary/secondary loadouts (needs new abilities first)
  - more classes and bosses
- **Balancing is one combined pass later** (progression, classes, boss fights, ...), not piecemeal tuning; the user decided this after the live boss test.
- **Progression is permanent** (meta-progression across runs, not per run), confirmed by the user, and **per character** (2026-10-09).
- **Accounts** (2026-10-09):
  - No e-mail or other personal data, so there is no password recovery. Login is required.
  - Up to 8 characters of any class per account; character names are globally unique.
  - Delete account and delete character exist and are final.
- **Licenses:** the user wants OSI open-source licenses for infrastructure (MongoDB's SSPL was rejected).
- **Database:**
  - PostgreSQL in its own container.
  - Relational identity, progression as one versioned JSONB document per character: change the `Progress` struct, not the schema.
  - No cache layer (Valkey etc.) until there are several game servers.
- **Security:**
  - The server is authoritative; never accept progress values from the client.
  - Sessions are HMAC-signed cookies backed by the database.

## Environment notes (this machine)

- **Shells:** Windows 11 with Git Bash and PowerShell. Python is **not** installed; use Node scripts or perl/sed for text edits.
- **No local Rust toolchain.** Build and test the server in Docker, as in TECHNICAL.md §3. This includes a throwaway Postgres for the database tests:
  ```sh
  MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test
  docker compose -f docker-compose.test.yml down
  ```
  The `ta-cargo` and `ta-target` volumes (external) cache builds.
- **`.env`** (gitignored) holds `POSTGRES_PASSWORD` and `SESSION_SECRET` for the local stack. It was generated with `openssl rand -hex`. Without it, `docker compose up` refuses to start.
- **Database shell:** `docker compose exec db psql -U tiny -d tiny`.
- **Docker Desktop** must be running. Start it with `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"` if `docker info` fails.
- **Browser tests** use the installed Edge (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`) through `playwright-core`; no browser download is needed. Set `BROWSER` to use another executable.
  - Headless rendering is software (SwiftShader), so FPS in tests (~28) does not reflect real performance.
- **Fast client iteration:** run `cd client && npx vite --port 5173` against the running container, then test `http://localhost:5173/...`. Stop the Vite process afterwards.
- **The sprite pack** is already in `client/assets-src/0x72/`. If it ever needs re-downloading from itch.io, the free direct-download endpoint is `POST https://0x72.itch.io/dungeontileset-ii/file/<upload_id>?source=view_game&as_props=1&after_download_lightbox=true` with the page's `csrf_token` and cookies. The zip's upload id is 9911410.

## Verification checklist after a change

1. Server changes: run `cargo test`, in Docker as above (with the test Postgres). It also regenerates `client/src/generated/`.
2. Client changes: `cd client && npx tsc --noEmit && npm test`.
3. `docker compose up --build -d`, then `curl localhost:8080/health` should print `OK`.
4. `cd tools/e2e && node smoke.mjs http://localhost:8080/ "" shots Wizard,Paladin`. It should print "no browser errors"; look at the screenshots in `shots/`.
5. Visual changes to figures or effects: `node gallery-shots.mjs http://localhost:8080/ shots melee,breath`, or open `?gallery&state=<state>&slow=10` in a browser. Chests and mimics: `?mimic&slow=3`. Ogre: `?ogre&slow=3`. Demons: `?daemons&slow=3`. Lights: `?lights` (`node lights-shot.mjs`). Terrain: `?water`, `?chasm`, `?lava` (`&slow=3`). Terrain tile changes: edit `client/scripts/terrain-tiles.ts`, then `npm run atlas`.
6. Gameplay changes: update [docs/PLAYER_GUIDE.md](docs/PLAYER_GUIDE.md). Architecture changes: update [docs/TECHNICAL.md](docs/TECHNICAL.md).

## Gotchas

- **Checking wall tiles without playing:** a throwaway `client/src/__dump.ts` that builds a `TileMap` from an ASCII map (`#` wall, `.` floor, space void) and prints `tileDraws` per cell, plus a PowerShell `System.Drawing` script that composes the frames from the pack PNG using `tile_list_v1.7`, gives exact renders. Use void cells behind walls like the real generator, and delete the dump script afterwards.
- **Phaser key capture:** `addKeys`/`addKey` capture by default, which calls `preventDefault` page-wide and outlives the scene, so DOM inputs lose those letters after a run (the user found it in the delete-account password box). Always pass `false` (`GameScene` does); the smoke test types a password with w/a/s/d/e after a run.
- **Phaser `Graphics.clear()`** resets fill and line styles; set `fillStyle` again after it (see the `spark` texture in `main.ts`).

- **Stale client after a rebuild:** before 2026-10-08 the server sent no `Cache-Control`, so browsers could keep the old `index.html` and bundle for `/` while `/?debug…` (a different URL) loaded fresh. The user saw lava only in debug mode: the old client drew terrain as dark cells and its prediction fought the server. `cache_headers` in `main.rs` fixes it. If a client ever looks older than the server, hard-reload (Ctrl+F5) first.
- **Canvas textures under `pixelArt`:** Phaser resets a canvas texture to NEAREST filtering on every `refresh()`, so set LINEAR again after each upload (`LightView.upload`), or the light looks blocky.
- **Generated client files:** never edit `client/src/generated/*` by hand. Change Rust and run `cargo test`.
- **Snapshots and inputs are arrays on the wire** (`wire.rs`, `wire.ts`). When you add a field to `Snapshot`, `SelfState`, `EntSnap`, `BossBar`, `Ev` or `InputMsg`, add it to the wire type, both converters and `sample_snapshots`; the fixture test fails otherwise. Raw snapshot bytes are no longer `{t: 'Snap'}` maps, so test scripts that read the WebSocket must decode arrays (`m[3][3]` is the own x).
- **Message tag:** MessagePack enums are tagged with the field `t`, so no variant may have a field named `t`. That is why `Ping`/`Pong` use `time`.
- **Prediction parity:** client prediction relies on `client/src/sim/collision.ts` matching `server/src/collision.rs` exactly, and on the order *move, then abilities* in `Run::apply_input`. If you change movement, change both and keep `sim.test.ts` green.
- **Cooldowns** tick per processed input on both sides. Don't switch the server to wall-clock cooldowns without updating `Predictor`.
- **Boss behaviours** are taken out of the level's `BossEncounter.behaviour` during their tick (`Option::take`), so `hurt_monster`'s immunity check cannot see the boss during its own tick. That is harmless today; keep it in mind.
- **Pack frame names** are used verbatim (`knight_m_run_anim_f2`). `necromancer` only has `necromancer_anim_f0-3`, used for both idle and run.
- **Dragon breath points** come from `dragonPoints()` in `anim/dragonRig.ts` (base mouth/nostril plus each frame's pose or strip head offset). If a strip is re-imported, update its `head` offsets in `DRAGON_SHEETS`. The jaw only opens on frames whose head sits where the base head is (generated frames, hover).
- **Dragon attack anims include the wind-up:** the server sets `Melee`/`Bite`/`Tail`/`Breath` when the wind-up starts and the client shows the wind-up frame for `DRAGON_*_WINDUP` s. Other monsters still use `Anim::Windup` then the attack anim.
- **Shell quoting:** Git Bash mangles backticks in `node -e "..."` and some heredocs; for text edits with backticks write a script file (or use the editor) instead.
- **Characters:** the client must send `SelectCharacter` after connecting (the character screen's Play does). Without it, rooms are refused, nothing is banked and no upgrades apply.
- **Seeding test XP:** `docker compose exec db psql -U tiny -d tiny -c "update characters set progress = jsonb_set(progress, '{xp}', '1000') where name = 'Hero'"`. The lobby caches the character, so press "Change character" and Play again to reload it.
- **The lobby lock is a std `Mutex`:** never hold it across an `.await`. Do database work first (`main.rs` `select_character`, `BuyUpgrade`, `lobby::finish_run`), then lock and apply.
- **Test accounts:** the smoke test deletes its `e2e_*` accounts. If it crashes midway, remove leftovers with `delete from accounts where name like 'e2e\_%'`.
- **Lobby screenshots:** the lobby scrolls inside `.lobby`, so Playwright `fullPage` shots are cut off. Screenshot elements instead (`page.locator('.bosses').screenshot()`).
- **Boss previews in the lobby** (`BOSS_FIG` in `ui/lobby.ts`) use the atlas frames and CSS filters to imitate the in-game tint from `anim/defs.ts`. If a boss figure changes, update both.

## Suggested next steps

1. **The Elven Ranger play-test and merge** (see "Next session"); then TODO priority 4. The effect system, the vision edges and the Elven Ranger are built; the light look and the vision rules are approved, their numbers wait for the balancing pass.
2. **One combined balancing pass** when the user asks for it (they want everything balanced together): progression (`defs/progression.rs`), classes (`defs/classes.rs`), bosses (`server/src/run/bosses/*.rs`, `defs/bosses.rs`) and enemies.
3. Loadouts: design new abilities, then add the lobby picker, paid with coins.
4. More from the pack for the environment (the user asked for a less empty dungeon): floor spikes, levers/buttons, breakable crates, flasks as pickups, wall fountains, columns. See TODO.md.
5. Optional polish: sound, better boss sprites if the user approves a source (the dragon now has AI-generated art the user supplied), blending push corrections under lag (TODO.md, Network).
6. Let the user play the dragon fight live and collect feedback (flight timing, bite, smash).
