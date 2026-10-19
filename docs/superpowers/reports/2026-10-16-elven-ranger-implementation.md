# Elven Ranger and Dire Wolf: implementation report

**For:** the agent taking over `feature/elven-ranger`, to merge it and to work on it.

**Read first:**
- [the spec](../specs/2026-10-16-elven-ranger-design.md): what the user decided; it is the authority;
- [the plan](../plans/2026-10-16-elven-ranger.md): how the work was split into 12 tasks.

This report covers what the code does now, where it differs from the spec and the plan, and why.

## State of the branches

| Ref | Commit | Notes |
|---|---|---|
| `origin/feature/elven-ranger` | `deaea19` plus this report | Pushed. No pull request (the user's choice). |
| local `main` | `5eab088` | Fast-forwarded to `feature/breakable-chests` with the user's approval. **Not pushed:** `origin/main` does not have the breakable chests yet. |
| `feature/breakable-chests` | `5eab088` | Its worktree (`.claude/worktrees/breakable-chests`) was removed after the merge. |

`main` was merged into the ranger branch at `29cd62a`. Merging the ranger branch into `main` therefore brings the breakable chests with it, and should be a fast-forward from local `main`.

**Commits on the branch that are not ranger work:**
- `a898f22` and `4663649` are TODO/HANDOFF notes committed by other sessions while this branch was checked out.
- `cf87186` is the same note as `a898f22`, cherry-picked on the chests branch. The merge resolved the duplicate.

**Verification at `deaea19`:**
- server: `cargo test` in Docker, 366 passed; both fingerprint tests unchanged;
- client: `tsc --noEmit` clean, vitest 90 passed, `npm run build` clean;
- the e2e smoke test (`node smoke.mjs http://localhost:8080/ "" shots ElvenRanger,Paladin`) printed "no browser errors".

## How it was built

Each plan task was done by a fresh implementer subagent and then reviewed: spec compliance and code quality, with fix rounds until clean. A final whole-branch review on the most capable model followed, then one fix wave (`deaea19`) and its re-review. The commit for each task:

| Task | Commit(s) | What |
|---|---|---|
| 1 | `2731b07` | Rename Assassin → Elven Ranger; migration wipes game data |
| 2 | `6928e8f` | Remove Hide completely (server, wire, client); `SummonWolf` placeholder |
| 3 | `d266f90` | Monster state `hiding` (mimics) split from `dormant` |
| 4 | `0ff2260`, `0d4dfa1` | Entity types Elf and Magical Beast; effect responses per entity type |
| 5 | `adeea5a` | The wolf as an ally `Monster`; no friendly fire; death rules; always in snapshots |
| 6 | `44583bf` | Foe layer: enemies and area attacks hit the wolf; Holy Light heals it |
| — | `29cd62a` | Merge `main` (breakable chests) |
| 7 | `e345a59` | The ability: summon, heal, 60 s wait; the wolf vanishes with its ranger |
| 8 | `f702851`, `04b4fe2` | Wolf behaviour: follow, guard, dash, bite, leash, reappear, chasm escape |
| 9 | `7bcda50` | The growl (`Ev::Growl`, wire code 14) |
| 10 | `ff8d45e` | Wolf atlas frames, figure, lunge, gallery; the ranger's rapier |
| 11 | `cdc3563`, `7af07ab` | Client: bars, puff, growl text and shake, HUD label, sound text above the darkness |
| 12 | `94403be`, `aa22364` | Docs: README, PLAYER_GUIDE, TECHNICAL, TODO, HANDOFF |
| Final | `deaea19` | Review fixes: "Elven Ranger" with a space in the UI; the wolf never reappears onto lava or a chasm |

## What changed, by area

### 1. Class rename and data wipe

- **Server:**
  - `ClassId::Assassin` → `ClassId::ElvenRanger` (`protocol.rs`);
  - `EntityKind::Assassin = 3` → `ElvenRanger = 3`; the numeric id is kept, so old fixtures still line up;
  - `defs/classes.rs`: HP 90 and speed 80 are unchanged; the secondary is now `AbilityId::SummonWolf`.
- **Migration `server/migrations/0005_elven_ranger.sql`:** deletes all `run_players`, `runs` and `characters`, then replaces the `characters_class_check` constraint. That is the name Postgres gave the inline CHECK in `0001`.
  - **Why:** the user said "wipe everything" (test data only). Accounts, sessions, `activity_days` and `admin_actions` stay, because logins and the admin log are not game data. That was my reading of "everything".
  - The statistics are wiped too, so no stored row still reads "Assassin". The user chose this over keeping them.
- **Client:** `KIND.ElvenRanger`, `ui/classes.ts`, `ui/text.ts` (title "Elven Ranger", primary "Bow / Rapier"), the demo scenes, and the CSS class `.c-elvenranger` (built from `class.toLowerCase()`).
- **Display name:** `className(cls)` in `client/src/ui/text.ts` returns `CLASS_TEXT[cls].title`. It is used in the lobby ("Playing as", party row), the character list and the end-of-run table. CSS classes, keys and admin pages keep the raw wire value.
  - **Why:** the spec says the class is "shown as Elven Ranger". The other class names are single words, so the raw value happened to work for them. The final review caught this.

### 2. Hide removed

Removed everywhere:
- `AbilityId::Hide`, `HIDDEN_CRIT_MULT`, `Player.hidden`;
- the hidden filters in the AI and the lich;
- `flags::HIDDEN` and the export key;
- `SelfState.hidden`, which also drops wire `SelfW` field 10;
- the client shimmer, and `Predictor.useHide` / `hidden` / `Pending.hide`.

**Wire:** `SelfW` now has 17 fields, `[alive, hp, max_hp, x, y, dash_t, dash_dx, dash_dy, cd1, cd2, spectating, knock, darkvision, vision, effects, speed_mul, no_act]`. The server and client converters, the fixtures and the tests that read `snap[3][N]` were all shifted together.

**Why remove the field instead of leaving it at 0:** the user wanted Hide gone completely. Hide may come back later as an "invisibility" effect, which would be built differently.

`try_use` keeps its `crit` plumbing (always `false` now), because projectile and event code carries it.

### 3. `hiding` versus `dormant`

`Monster.hiding: bool` is new. Mimics in disguise are `hiding`; `dormant` now means only "waiting in plain sight": the boss before the party enters, and the lich's channelling disciples.

- `flags::HIDING = 1` reuses the bit Hide freed; the client's `mimic.ts` reads `FLAG.HIDING`.
- `touch_chests`, `wake_mimic` and `hurt_monster` use `hiding`.
- `check_arena` clears `dormant` on every monster. The mimic filter it had is gone, because mimics are no longer dormant.
- The AI tick and monster separation skip `dormant || hiding`.
- The fingerprint hashes `dormant || hiding`, so the recorded values did not change.
- **Why:** the user wants the wolf to growl at hidden things (finding mimics is one of its jobs) but never at dormant ones.

### 4. Entity types and effect responses

- `defs/entity_types.rs` adds two types:
  - `Elf`: poison 0.1, vision 18, darkvision 1/3;
  - `MagicalBeast`: poison 0.1, magical 0.1, melee 80 % physical / 20 % magical, vision 18, darkvision 1.0.
- `entity_types::responses(&[EntityType]) -> EffectResponses`: Sleep is `Immune` for both new types. Over several types the strongest response wins per effect.
- `classes::profile` and `classes::responses` are now per class: the ranger is `[Elf]`, the other classes stay Human.
- `Player.responses` is new, and `apply_effect` uses it for players. Before, players always got `Full`.
- An existing test asserted that every class sees 9 tiles. Its loop was limited to the Human classes, and new tests cover the ranger: the 18-tile test asserts on the real snapshot the ranger receives.

### 5. The Dire Wolf on the server

**Shape.** The wolf is a `Monster` with `ally: Option<Ally>` and `Monster::is_ally()`. Its `etype` is `None`, `is_boss` is false and its `mover` is `Mover::Enemy`.
- **Why a monster:** it reuses movement, collision, terrain, knockback, sinking, effects (`Creature::Monster`), snapshots and lights for free. The alternative was a separate companion list with a third `Creature` variant. That is cleaner against friendly fire but needs new paths everywhere; the spec suggested both and this one touches fewer lines.
- `Ally` lives in `run/entities.rs`. It holds `owner` (the ranger's player id), the growl state (`growled`, `growl_cd`, `growl_to`, `hold`), `prey`, `following`, `reach_t`, `dash: Option<WolfDash>`, `dash_cd` and `last_safe`.
- `Player.wolf: Option<u32>` holds the wolf's monster id.

**Numbers.** All are in `server/src/defs/companions.rs`:
- body: `WOLF_HP` 80, `WOLF_SPEED` 88;
- bite: 10 damage every 0.9 s, push 8, range 14, wind-up 0.2;
- distances: follow above 32 px and stop below 20 px, guard 48, defend 24, leash 96, reappear 192, reach check every 0.5 s;
- growl: every 4 s, step 24;
- heal 20 % of max HP; death cooldown 60 s;
- dash: range 64, speed 300 (`DASH_SPEED`), damage 20, push 12, cooldown 5.

`wolf_profile()` is Magical Beast plus 0.2 cold resistance (its fur). `wolf_responses()` makes it immune to Sleep. The numbers are fixed: they do not scale with the ranger's upgrades or the party size (spec call 6).

**Code: `server/src/run/companion.rs`** (about 1,400 lines, most of them tests):
- `spawn_wolf(run, pi) -> u32`:
  - placed by `summon_spot`: first `spot_beside` (8 points 12 px around the ranger that are not blocked and not on a solid object), else the nearest walkable tile centre within 2 tiles, else the ranger's position;
  - sends `Ev::Boom { k: 9, r: 10 }` party-wide.
- `use_ability(run, pi)`: summons when there is no living wolf, otherwise heals it through `Run::heal_monster`. `try_use` applies the 8 s cooldown, divided by `mods.attack_speed`. A heal at full health still uses the ability (spec call 3).
- `wolf_died(run, mi)`:
  - `kill_monster` calls it first for allies;
  - sends a party-wide `Ev::Died` and the message `"{name}'s wolf has fallen"`;
  - clears `Player.wolf` and sets the ranger's `cd2 = 60 / attack_speed`;
  - pays no XP or coins and does not call `Level::on_killed`.
- `vanish_orphans(run)`: runs right after the `step_player` loop. Any ally whose owner is not a living hero is removed, with a `Boom k 9` puff and no `Died`, message or cooldown.
- `tick_wolf(run, mi, dt)` replaces the enemy AI for allies in `Run::step`'s monster loop. It runs after the `no_act` (asleep or stone), sinking and knock handling, so a frozen wolf idles like any monster. The order each tick:
  1. **Find the owner.** If they are missing or dead, return; `vanish_orphans` removes the wolf.
  2. **Reappear** when farther than 192 px from the ranger, or every 0.5 s when the ranger cannot be reached (`walk_line` or a 2,500-node A*).
     - The reach check is skipped while dashing, because a dash may be over a chasm where no path starts.
     - It is also skipped while the ranger stands on ground that blocks `Mover::Enemy` (lava, falling into a chasm).
     - `reappear` uses `spot_beside`; with no free spot the wolf stays where it is.
     - This rule also covers the sealed boss hall: `DoorClosed` blocks the path, so a wolf outside reappears inside.
  3. **Timers** count down. Ids of dead monsters are dropped from `growled`.
     - 3a. A **dash in progress** runs `tick_dash` (below).
     - A wolf blown into lava walks out with `ai::escape_terrain`, like any monster.
  4. **Bite wind-up end:** if the prey is still in reach, `hurt_monster(prey, 10, Some(ranger_pi))` and `knock_monster(prey, 8)`.
  5. **Prey:** `find_prey` picks the living enemy nearest the ranger. The enemy must not be an ally, `dormant`, `hiding`, airborne or sinking, and the wolf must `sees` it.
     - It counts if it is within 48 px + its radius of the ranger, or within 24 px + its radius of the wolf. The second rule is "it fights back".
     - It must also be within the 96 px leash of the ranger.
     - With prey:
       - start an attack dash when the prey is more than 8 px beyond bite reach, within dash range, the dash is ready, there is line of sight, and the dash line ends on walkable ground;
       - otherwise wind up a bite when in reach and off cooldown;
       - otherwise stand (in reach, on cooldown) or path toward the prey.
  6. **Growl** (`tick_growl`):
     - It only runs with no prey and no wind-up.
     - It finishes a step in progress; otherwise, with `growl_cd ≤ 0`, it targets the nearest living enemy the wolf sees and has not growled at before. Allies and `dormant` enemies are excluded; `hiding` ones count.
     - It records the id, sets `growl_cd = 4`, sends `Ev::Growl { id: wolf }` party-wide (no position), and steps up to 24 px toward the enemy if the step stays inside the leash, on walkable ground and on a `walk_line`. It then holds about 0.6 s.
  7. **Follow** with hysteresis (start beyond 32 px, stop under 20 px) through `ai::path_toward`. Standing still, it faces the side the ranger aims at.
- `tick_dash`:
  - moves with `move_box(..., Mover::Dash)` at 300 px/s, so it crosses chasms;
  - an attack dash that touches its prey hits once (20 damage, push 12, credited to the ranger) and sets `ai.cd` to the bite cooldown;
  - if an attack dash would end over ground the wolf cannot stand on, `overrun` carries it on along the same line, without more damage, to the first walkable ground within the dash range, stopping at walls; if none is found it falls back to `dash_back`.
- `dash_back(run, mi)`: a non-attack dash to `ally.last_safe` that sets `dash_cd = 5`.

**Changes in `run/mod.rs`:**
- `terrain_monster`:
  - an ally mid-dash skips the whole terrain check, since it is in the air like a dashing hero;
  - an ally over a chasm with `dash_cd ≤ 0` clears its knock and calls `dash_back` instead of sinking;
  - with the dash on cooldown it sinks and dies like any monster;
  - deep water drowns it and lava burns it as usual;
  - on a safe tile it stores the tile centre in `last_safe`.
- `knock_monster`: an ally mid-dash is not pushed.
- `hurt_monster`:
  - refuses damage from a hero source on an ally before anything changes, including effects, knock, `last_hit_by` and aggro;
  - its `Dmg` and `Heal` events and its effect events go through `event_on_hero` with `p: true`, so the numbers show and vanish like a hero's.
- Hero attacks skip allies: `dagger_target` (monster side), `melee_arc`, `dash_contact`, hero shots in `advance_projectile`, and the hero branch of `explode`. The check in `hurt_monster` above is a second line of defence.

**Snapshots** (`run/visibility.rs`):
- The per-player entity list is factored into `snapshot_ents(run, pi, view, dark)` (`monster_snap` builds one monster entry).
- Allies are sent to every player every snapshot, right after the heroes, with `extra = ally.owner`. The monster loop skips them.
- **Why:** the spec says the wolf is drawn like a hero, visible only where it is lit. Sending it always means the party never loses track of it; the darkness on the client hides it in the dark.

### 6. The foe layer: enemies fight the wolf

Enemy code used to work with player indices everywhere. Methods on `Run`, built on `effects::Creature` (`Player(i)` or `Monster(i)`), now cover "heroes and allies":

| Method | What it does |
|---|---|
| `foes_in(at, r, cone)` | Heroes and allies within `r` of `at`, optionally inside a cone. |
| `foes_touching(at, r, los)` | Heroes and allies whose body touches a circle of radius `r`, optionally with line of sight. |
| `creature_pos(c)`, `creature_id(c)`, `creature_radius(c)` | Position, id and radius of a hero or ally. |
| `hurt_creature(c, dmg)` | An enemy hit on a hero or ally (no hero source). |
| `knock_creature(c, from, fallback, dist)` | A push on a hero or ally. |
| `heal_monster(mi, amount)` | Heals a monster up to its maximum. |

Both list methods put heroes first, then allies. Sinking allies are left out.

**Enemy AI** (`run/ai.rs`):
- `find_visible_foe` (enemy AI) and `find_visible_hero` (bosses) replace `find_visible_player`.
- `Target::Ally(id)` is new.
- `perform_attack` takes a `Creature`, and the slam counts and hits `foes_in`.

**Which attacks now use the foe helpers:**
- every enemy projectile hits heroes first, then allies; `impact` takes `Option<Creature>`;
- `explode` (enemy branch), `tick_hazards` and `objects::explode_barrel`; heroes and allies are hurt with no source;
- the demon's swoop and cleave (the swoop's hit-once list stores creature ids, which is safe because players and monsters share `alloc_id`);
- the dragon's smash, breath, tail, claw and bite;
- the lich's nova.

**Still heroes only, by design (spec call 7):**
- `bosses::target`;
- the lich's `ready_spell` curses and its gaze;
- the dragon's fireball targets (their explosions still hit the wolf).

**Holy Light** heals allies in range through `heal_monster`, and the amount counts as the Paladin's healing.

**Fingerprints unchanged:** with no allies the behaviour is identical. Heroes come first, `min_by` keeps the first of equal minimums so ties go to the hero, and every comparison (`<=` / `<`) was kept.

### 7. Growl on the wire

- `Ev::Growl { id }` is code 14 in `EV_CODES`, encoded as `EvW::Growl(14, id)`; `sample_snapshots` carries one.
- The client decodes it to `{ t: 'Growl', id }`.
- It is sent party-wide because it is a sound: it never carries the enemy's position, and the enemy is not added to anyone's snapshot.

### 8. Client

- **Atlas:**
  - `client/scripts/wolf-frames.ts` (`buildWolf`) trims Superdark's eight 32×32 Wolf frames (Enchanted Forest, CC0) to one shared box, so the frames do not wobble;
  - it emits `dire_wolf_idle_anim_f0..3` and `dire_wolf_run_anim_f0..3`;
  - the source already faces right, so it is not mirrored;
  - the strip sits under the torches in `build-atlas.ts`; the test is `scripts/wolf-frames.test.ts`.
- **Figure** (`anim/defs.ts`):
  - `FIGURES[KIND.DireWolf]` has a short swoosh and `lunge: 4`; `EntityView` darts the figure 4 px toward its aim over the first 0.15 s of a Melee anim;
  - `isAllyKind(k)` is new;
  - the dash afterimages already worked for every figure.
- **The rapier:** the ranger's `meleeWeapon` is `weapon_duel_sword` (the 0x72 pack's rapier) at `meleeWeaponScale` 0.6. `FigureDef.meleeWeaponScale` is new and falls back to `weaponScale`.
- **In game** (`GameScene.ts`, `effects.ts`, `EntityView.ts`, `hud.ts`, `status.ts`):
  - **Puff:** `Boom k === 9` → `Effects.natureSparkles`, 18 clear-green sparks (`0x60f070` / `0xc0ffb0`), not the poison tint.
  - **Growl:** "grrrr" at `DEPTH.sound` plus `EntityView.shake(0.4)`.
  - **Bars:** the wolf's bar goes on `heroBars`, under the fog.
  - **Dagger prediction:** it never counts an ally as close. Main's rule that a closed chest counts as close is kept.
  - **HUD:** the secondary box label comes from `secondaryLabel`: "Summon Wolf" or "Heal Wolf", from whether the client holds a living `DireWolf` whose `extra` is its own id. The 60 s wait shows as the normal cooldown fill, because the HUD follows cooldown jumps.
- **Sound rule:**
  - `DEPTH.sound = 7500` sits above the darkness (`fog` 7000) and below damage numbers (8000);
  - `SOUND_TEXT = { fill: '#1a1020', stroke: '#d8d0e0' }` is used by the growl and by the sleeping "Z";
  - damage numbers keep their old rule;
  - the rule is written in TECHNICAL §7.
- **Prediction:**
  - `SummonWolf` predicts `Anim::Cast` and the 8 s cooldown;
  - when the wolf dies the server sends `cd2 = 60`, and `reconcile` already adopts any cooldown difference above 0.15 s;
  - the wolf itself is not predicted.

## Decisions I made, with reasons

The user approved the spec's "Calls I made" on 2026-10-16. During the build the user also decided:
- the dash attack;
- "escape a chasm only with the dash ready, otherwise fall; it can drown";
- the rapier replacing only the dagger;
- the merge of the breakable chests.

These are the further decisions taken while building:

1. **Separate test runs per attack** in `no_hero_attack_hurts_the_wolf`. Each attack needs a different class in the party.
2. **The wolf vanishes only when its ranger is dead**, not while the ranger is falling: a debug hero can climb back out of a chasm. If this is wrong, the wolf lingers for at most the fall time.
3. **The puff is `Boom k 9`.** `main` took k 8 for the chest splinters in parallel, and the plan's text was updated to match.
4. **The wolf keeps its real 30×19 px box.** The spec guessed about 26×17, but the walk frames bob. In the gallery it reads dog-sized next to the heroes and smaller than the ogre. If it is wrong, change the scale in `FIGURES`.
5. **Sound text is a dark fill inside a light outline.** The plan's pale fill vanished inside the pale outline: "grrrr" became an unreadable blob in a screenshot. The fix was checked visually.
6. **"It fights back" means "enemies within 24 px of the wolf are prey too."** The server does not record who hit a monster, so this stands in. The cost: an archer shooting the wolf from range, away from the ranger, gets no answer. It is on the play-test list.
7. **An attack dash that would stop over a chasm carries on to solid ground.** Refusing such dashes would forbid exactly the dash across a chasm toward an enemy at the far edge. Before this fix, the wolf could stop over the chasm with its dash on cooldown and die without being pushed.
8. **Only start an attack dash whose line ends on walkable ground.** Overshooting the prey must not take the wolf into terrain.
9. **The reach check is skipped while the ranger stands on lava or over a chasm**, and a reappear with no free spot leaves the wolf in place. Before this fix the wolf was dropped onto the lava every 0.5 s while the ranger crossed it.
10. **The wolf stands still in bite reach while its bite cools down**, as enemy melee does, instead of pushing into the enemy.
11. **Lava:** a wolf on lava walks out with the monsters' `escape_terrain`; there is no special case.
12. **Characters and statistics are wiped; accounts, sessions and the admin log stay.** This is my reading of the user's "wipe everything".
13. **`SelfW.hidden` is removed rather than kept at 0.** The user asked for Hide to go completely.

## Known gaps and follow-ups

**Not verified in play** (listed in HANDOFF "Still to play"; they could not be scripted reliably):
- the wolf's bar hidden under the fog in the dark;
- the 18-tile light and mask seam in a large room;
- the wolf's death message and the 60 s fill on the ability box;
- an archer shooting the wolf from range;
- a look at `?mimic`;
- the feel of follow, guard, dash and growl in a real run.

**Confirmed by scripted screenshots:**
- the summon puff, and the "Heal Wolf" label;
- the growl, readable in the dark;
- the sleep Z in the dark;
- the wolf and the rapier in `?gallery`.

**Smaller follow-ups** are in `docs/TODO.md`, "Elven Ranger follow-ups". In short:
- tune the `WOLF_*` numbers in the balancing pass;
- two dash edge cases over a chasm:
  - a non-attack dash stopped by a wall can still sink;
  - a wolf frozen mid-dash hovers;
- move the companion tests into their own file;
- `snapshot_ents` has an unused `_pi` and rebuilds the player entries per viewer;
- name the inline growl constants;
- tests to add:
  - a vispoly parity fixture at radius 18;
  - a bolt passing through the wolf;
  - enemy exploding projectiles and the demon's and dragon's area attacks on the wolf;
  - client tests for the shake, the growl handler and the ally exclusion in the dagger prediction.

**Performance:** the wolf's reach check runs every 0.5 s, with `walk_line` first and an A* capped at 2,500 nodes. The ranger's 18-tile view makes snapshots costlier; that is TODO priority 16, already planned.

## Where to look first

| Topic | File |
|---|---|
| Wolf behaviour | `server/src/run/companion.rs` (`tick_wolf` and its helpers; tests at the bottom) |
| Wolf numbers | `server/src/defs/companions.rs` |
| Foe layer | `server/src/run/mod.rs` (`foes_in` … `heal_monster`), `server/src/run/ai.rs` (`find_visible_foe`, `perform_attack`) |
| Ally rules in damage and death | `server/src/run/mod.rs` (`hurt_monster`, `kill_monster`, `terrain_monster`, `knock_monster`) |
| Snapshots | `server/src/run/visibility.rs` (`snapshot_ents`, `monster_snap`) |
| Entity types | `server/src/defs/entity_types.rs`, `server/src/defs/classes.rs` |
| Client | `client/src/game/GameScene.ts` (Growl, Boom 9, bars, wolf flag), `client/src/game/effects.ts` (`DEPTH.sound`, `SOUND_TEXT`, `natureSparkles`), `client/src/ui/hud.ts` (`secondaryLabel`), `client/src/ui/text.ts` (`className`) |
| Docs | `docs/TECHNICAL.md` §5 "Companions" and §7 (the sound rule); `docs/PLAYER_GUIDE.md` (Elven Ranger, "Your wolf"); `HANDOFF.md` ("Last feature") |
