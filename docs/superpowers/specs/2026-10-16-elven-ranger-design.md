# Elven Ranger and the Dire Wolf companion

**Status:** spec, settled with the user on 2026-10-16 (brainstorming). Next: implementation plan (superpowers:writing-plans).

**Replaces:** TODO priority 4a "Assassin restyle and thrown knives". The user changed the plan: the Assassin's art is an elf, so the class becomes an elf instead of getting new art. The restyle (dark clothes, hood, thrown knives) is dropped. The Elven Ranger **is** the "elven archer" of TODO item 8 (the user, 2026-10-16): no second elf class comes later, so item 8 keeps only the bandit and the dark elf. The wood-elf art from Enchanted Forest is not needed for it.

## Why

The Assassin's figure is the pack's `elf_m` with a bow and does not look like an assassin. Rather than find new art, the user turns the class into what the art already shows: an **Elven Ranger**. The user wants the class settled before planning more abilities (TODO priority 4), and its new secondary is the first one: a summoned companion. It is also the first allied creature in the game, so it lays the base for later summons (bear, forest guardian, several companions) through progression.

## Goals

1. The **Assassin class becomes the Elven Ranger**: new name everywhere (server, client, lobby, docs), the same figure art, the same primary ability.
2. The ranger is of the new **entity type Elf** (already specified in TODO "Elves and bandits").
3. The secondary **Hide is removed completely** and replaced by **Summon Companion: Dire Wolf**.
4. A new **entity type Magical Beast**; the Dire Wolf is one, with a cold resistance of its own.
5. The wolf is the **first allied creature**: it follows the ranger, guards them, bites enemies near them, and enemies can fight and kill it.
6. The wolf **growls** at enemies it detects, which shows as a step toward the enemy, "grrrr" above it and a shake.
7. A new **rule for sounds in the dark**: text that stands for a sound shows above the darkness.
8. A new monster state **hiding** (the mimic), split from **dormant**: the wolf growls at hiding things, never at dormant ones.

## Non-goals

- New art. The ranger keeps `elf_m`; the wolf uses existing CC0 art.
- Other companions (bear, forest guardian), several companions at once, or companion upgrades. The design must make them easy later, but this build has only the wolf.
- An invisibility effect. Hide may come back later as an "invisibility" effect (the user, 2026-10-16); nothing of it is kept now.
- Commands for the wolf (attack this, stay, come). It acts on its own.
- Balancing beyond the numbers below (TODO priority 18).

## Anti-goals (a failure even if it works)

- **Friendly fire:** a hero's attack (melee, shot, explosion, dash) hurting the wolf.
- **A kill that pays twice, or a wolf death that pays:** the wolf dying must not give XP or coins.
- **A wolf locked out:** the wolf stuck behind the sealed boss door, or behind a wall, while the ranger fights on.
- **A wolf that drags the ranger's view or the enemies around:** it must not reveal enemies to the party (the growl gives a direction, not a position on screen).
- A growl that spams (stepping out and back every tick, or a "grrrr" every second in a busy room).

## The Elven Ranger (class)

| | Elven Ranger | (Assassin before) |
|---|---|---|
| Name | **Elven Ranger** (`ClassId::ElvenRanger`, shown as "Elven Ranger") | Assassin |
| Figure | `elf_m` with the bow (unchanged) | same |
| HP, speed | 90, 80 (unchanged) | same |
| Entity type | **Elf** | Human |
| Primary | `CrossbowDagger`, unchanged (bow shots, automatic dagger stab in melee) | same |
| Secondary | **Summon Companion: Dire Wolf** (`AbilityId::SummonWolf`, builder may name it) | Hide |

**Entity type Elf** (from TODO "Elves and bandits", 2026-10-15): 10 % poison resistance; vision **18 tiles** (twice a Human's 9); darkvision **1/3** of vision; **immune to Sleep**. Its melee split is the default (physical).
- Sleep immunity is a per-entity-type effect response. Today `EffectResponses` only come from `defs/bosses.rs`; the entity type needs a way to carry them (heroes and companions take their responses from their types). Builder's choice how.
- The 18-tile vision is a real change for that hero: the server's `View`, the visibility polygon, the snapshot filter and the client's light and mask all run with the hero's vision from the snapshot already, so it should just work, but it costs more per snapshot (TODO priority 16). Check that the mask canvas and the camera window handle a radius this large (the polygon may reach beyond the screen).

**Removals (Hide):** `AbilityId::Hide`, `HIDDEN_CRIT_MULT`, `Player.hidden`, the hidden checks in the AI and the lich (`find_visible_player`, lich spell targets), `flags::HIDDEN`, `SelfState.hidden` (wire `SelfW` field), the client's hidden shimmer (`EntityView`), `Predictor.useHide`/`hidden`, its tests and the text in `ui/text.ts`, PLAYER_GUIDE and TECHNICAL. Wire fields may be removed or left at 0; if removed, both sides and the wire fixtures change together.

**Characters and statistics:** the user wipes all saved game data (2026-10-16: only test data, "wipe everything"). A new migration deletes every row of `characters`, `runs` and `run_players` (the statistics, so no old class text "Assassin" stays), and replaces `'Assassin'` with `'ElvenRanger'` in the `characters.class` CHECK constraint. Accounts, sessions, `activity_days` and `admin_actions` stay (logins and the admin log are not game data; my reading of "everything", check with the user if unsure).

## The entity type Magical Beast

| | Magical Beast |
|---|---|
| Resistances | **10 % poison, 10 % magical** |
| Attack (melee split) | **80 % physical, 20 % magical** |
| Sleep | **immune** |
| Vision | **18 tiles** (as the Elf) |
| Darkvision | **100 %** of vision (sees as far in the dark as in light) |

## The Dire Wolf

**Art:** Superdark's "16x16 Enchanted Forest Characters" (CC0), `client/assets-src/enchanted-forest/frames/Wolf/` (`Wolf_Idle_1..4`, `Wolf_Walk_1..4`; a 32×32 canvas, the wolf about 26×17 px). The user chose this wolf over LYASeeK's MiniWolf. It has idle and walk frames only: the bite is a lunge or flash in the style the client already uses for pack enemies. The atlas needs a loader that trims Superdark's 32×32 frames (noted in HANDOFF "Art sources"). README "Credits" already lists the pack; mention that the wolf is now built in.

**Stats** (accepted by the user):

| | Dire Wolf |
|---|---|
| Entity type | Magical Beast, plus its own adjustment: **20 % cold** resistance (its fur) |
| Health | **80** |
| Bite | **10 damage every 0.9 s** (melee split 80 % physical, 20 % magical), small push **8 px** |
| Speed | **88** px/s (the ranger runs at 80, so it keeps up) |

The bite's reach and wind-up are the builder's call, in line with the enemies' melee (`range` about 14 to 16 px, a short wind-up, for example 0.2 s). Its damage uses the ranger's progression damage modifier? **No** (my call): the wolf has fixed numbers in this build; scaling with the ranger's upgrades is a later progression item. Its health does not scale with the party size either.

### The secondary ability (summon, heal, wait)

| State when the button is pressed | What happens | Cooldown |
|---|---|---|
| No wolf | **Summon:** the wolf appears beside the ranger with a short puff of **green sparkles** (a clear, fresh nature green, not the poison tint) | **8 s** (my call: the summon starts the normal cooldown, so the first heal waits) |
| Wolf alive | **Heal the wolf for 20 % of its health** (16 of 80), never above its maximum | **8 s** |
| Wolf dead | Nothing; the button waits | **60 s**, started at the wolf's death |

- "The same cooldown as now for the other secondaries" (the user): 8 s, Hide's old cooldown. Like every cooldown it is divided by the ranger's attack-speed modifier (`mods.attack_speed`); my call, it keeps the rule for every ability.
- The death cooldown is 60 s regardless of what was left on the heal cooldown. Builder: is 60 s also divided by attack speed? My call: yes, same rule.
- A heal on a wolf at full health still triggers and starts the cooldown (my call: simple and predictable; the client may skip sending it, but then the server and the prediction must agree).
- There is never more than one wolf per ranger. Two rangers in a party each have their own wolf.
- **HUD:** the secondary box shows the state: "summon", "heal" or the 60-second wait (as a normal cooldown fill). The client knows the state from the snapshot (its wolf is an entity with its owner) and the cooldown.
- The ability needs client prediction like every ability (`GameScene.predictAbility`): at least the cooldown, so the box reacts at once. The wolf itself is not predicted.

### Behaviour: guard

The user: the wolf **stays close and bites whatever comes near the ranger**; it does not run to what the ranger shoots at.

- **Follow:** it keeps near the ranger (within about 2 tiles), walking with the enemies' walking rules (it avoids chasms, deep water and lava; it paths around walls and barrels). It stands still when the ranger stands still.
- **Guard:** it attacks an enemy that comes within about **3 tiles of the ranger** (my number), and an enemy that attacks the wolf itself (my call: it fights back). It picks the one nearest to the ranger. Dormant and hiding enemies are never bitten (see below).
- **Leash:** it does not chase farther than about **6 tiles from the ranger** (my number); beyond that it turns back.
- **Reappear:** if it is far from the ranger (about **12 tiles**, my number), or cannot reach them (no path), it reappears beside the ranger with the green puff. This covers the sealed boss hall: when the door closes with the wolf outside, the wolf appears next to the ranger inside (the user: "nobody gets locked out").
- It cannot be pushed through walls; it can be pushed (knockback, blasts) into a chasm or deep water and die there like any monster.
- While the ranger is asleep or stone, the wolf keeps guarding.

### Growl

The user: the wolf **growls at nearby enemies it sees**. It moves **one or two tiles toward the nearest enemy** it detected within its vision, **"grrrr" appears above it**, and the figure **shakes slightly**.

- **Detection:** the wolf's own perception (`perception::sees` with its sight: 18 tiles, full darkvision, walls block). So it sees enemies in dark rooms long before the party: an early warning.
- **Which:** awake enemies and **hiding** ones (mimics), never **dormant** ones (see "Dormant and hiding enemies").
- **When:** when it detects an enemy it has not growled at yet, and it is not fighting. At most one growl every few seconds (my number: 4 s), so a busy room does not spam it. After the growl it goes back to following.
- **The step:** 1 to 2 tiles toward the enemy, never beyond the leash, only on walkable ground.
- **Not a reveal:** the enemy is not sent to the party because of the growl; only the wolf's step shows the direction.
- **Wire:** a new event (for example `Ev::Growl { id }` or with the wolf's position) sent to the whole party (no position filter: a sound is heard, see the rule below). The client draws the text and the shake.

### Dormant and hiding enemies (new state "hiding")

The user (2026-10-16): the wolf ignores **dormant** enemies, but **growls at hidden ones**. Detecting mimics is one of the wolf's jobs, on purpose.

Today `Monster.dormant` mixes two ideas. It splits into two states:

| State | Who | Ends | The wolf |
|---|---|---|---|
| **Dormant** (waiting, in plain sight) | the boss before the party enters its hall, the lich's channelling disciples | as today | **ignores** them completely: no growl, no bite, never wakes them |
| **Hiding** (new: disguised or concealed) | mimics while they look like a closed chest | as the mimic's dormant ends today: a hero comes close (`touch_chests`) or hits it | **growls** at them, but does not bite them (it only bites what it guards against, see "Guard"; a hiding mimic is not an attacker) |

- The mimic moves from `dormant` to the new `hiding` (field and wire flag, for example `flags::HIDING`; the client draws a hiding mimic as the closed chest, as it draws a dormant one today). Every `dormant && etype == Mimic` check becomes `hiding`. Behaviour of the mimic for the heroes is unchanged.
- Only heroes wake the boss and seal the hall door, as today (`check_arena` looks at hero positions only). The wolf entering the hall changes nothing.
- "Hiding" is the general state for things concealed from the heroes; later concealed creatures (ghost, shadow, ambushers, an invisibility effect) can use it, and each decides then whether the wolf senses it.

### The wolf in the fight

- **Enemies attack it.** Monster AI picks its target among the heroes **and** the wolf (the nearest seen foe). Every enemy attack that hits a hero can hit the wolf: melee, shots, slams, explosions, fire patches and other hazards, barrel blasts.
- **Bosses:** their area attacks (cleave, breath, smash, tail, nova, fire rings, exploding fireballs) hit the wolf too. Their **choice of target** stays the heroes, and the lich's curses and gaze aim only at heroes (my call: the curses are about the heroes; the wolf is immune to Sleep anyway). The builder may let bosses target the wolf if it falls out naturally.
- **Effects** apply to the wolf as to any creature (Burning, Frozen, Poisoned, Slowed, Blind, Petrified; Sleep immune). The elemental rule applies (a hit at least half heat burns it).
- **Heroes cannot hurt it** (no friendly fire): no hero ability, shot, blast or dash damages or pushes it. Barrel blasts hurt it, as they hurt heroes.
- **Holy Light heals it** like a hero in range; the healing counts in the Paladin's statistics.
- **Kills:** the wolf's hits count as the ranger's: their kill count and damage statistic, and `last_hit_by` for deaths by terrain. XP and coins work as for every kill today (every living hero gets them). Confirmed by the user (2026-10-16): a wolf kill pays exactly like the ranger's own kill.
- **Its death** gives no XP or coins and does not count as a kill for anyone. It shows a death like a monster's, a message ("<name>'s wolf has fallen", my wording) and starts the 60 s cooldown.
- **The ranger falls:** the wolf **vanishes** (the user). Fallen heroes are not revived, so it is gone for the run. A ranger who leaves the dungeon loses the wolf too.
- **Debug mode** (immortal ranger): the wolf is not immortal (my call).

### Drawing

- The wolf is drawn **like a hero**: visible only where there is light (under the darkness, `DEPTH` below `fog`), and sent to the whole party in every snapshot regardless of view, like the heroes (the user: "only visible where there is light"; my call that it is always sent, like heroes, so the party never loses track of it on the server side).
- **Health bar:** a small bar over the wolf like the heroes' (`DEPTH.heroBars`, under the darkness).
- **Damage and heal numbers** on the wolf follow the hero rule: they vanish with it in the dark.
- Bite: a short lunge toward the target plus the usual hit flash.
- Gallery (`?gallery`) and the demo scenes that show the Assassin switch to the Elven Ranger; the gallery shows the wolf.

## Rule: sounds show above the darkness

From the user (2026-10-16): **everything that can be considered "sound" is drawn above the darkness**, so it can be seen even in total darkness: the wolf's growl, spoken words shown as text, the sleeping "Z"s (sleeping sounds).

- Sound text gets a **light outline** so it does not vanish on black (today's float text uses `#140c1a`, nearly black). A pale outline, builder's colour, for example a light grey.
- Applies now to: the wolf's "grrrr" and the asleep "Z" in `game/status.ts` (today it sits with the hero, under the darkness).
- Damage and heal numbers are **not** sounds: they keep today's rule (on heroes and the wolf under the darkness, on enemies above it).
- A sound only shows for an entity the client has. Heroes and the wolf are always sent. An enemy in the dark is not sent, so enemy sounds (none exist yet) would need their own rule later; my note, not part of this build.
- Write the rule into TECHNICAL §9 (Rendering, draw order) so later features follow it.

## How it fits the code (pointers for the builder)

These are observations, not decisions; the plan decides.

- **Where the wolf lives.** Two shapes:
  1. A `Monster` with an ally marker (for example `ally_of: Option<u32>`, the ranger's id). It reuses movement, collision, terrain, knockback, sinking, effects (`Creature::Monster`), snapshots and lights. Every hero attack that loops over `run.monsters` must then skip allies (`dagger_target`, `melee_arc`, `dash_contact`, `advance_projectile`, `explode`, the client's cosmetic `shotTouchesEnemy`), `kill_monster` must pay nothing for an ally, enemy separation and the AI's target search must treat it as a foe, and level code that counts monsters must ignore it.
  2. A separate `companions` list with a third `Creature` variant. Clean against friendly fire, but movement, terrain, effects, snapshots and lights all need new paths.
  The first shape probably touches fewer lines; whichever is chosen, add one test per hero attack that it does not hurt the wolf.
- **Enemy targeting.** `find_visible_player`, `Target::Player`, `perform_attack(run, mi, pi, …)`, `hurt_player`/`knock_player` and the boss helpers (`bosses::players_in`, the lich's `nova`, dragon and demon attacks, `explode`, `tick_hazards`, `objects::explode_barrel`) take player indices. The wolf needs a target kind (for example `Target::Ally(id)`) and the area attacks a "heroes and allies in range" helper.
- **Classes carry their entity type:** `classes::profile` makes every hero Human today; it becomes per class. The test `every_enemy_has_its_entity_type` asserts all classes are Human and changes.
- **Rename:** `ClassId::Assassin` → `ElvenRanger`, `EntityKind::Assassin` (id 3) → `ElvenRanger` (keep id 3), generated `client/src/generated/*`, `ui/classes.ts`, `ui/text.ts`, `anim/defs.ts`, the demo scenes, `world.test.ts`, the stats and lobby tests, README, PLAYER_GUIDE, TECHNICAL. A new `EntityKind` for the wolf (for example `DireWolf = 23`) and `body_height` for it.
- **Fingerprints:** a change to every class or to the AI target search may change recorded fingerprints. Re-record only with an explanation (the effects work did the same).

## What success looks like

- In the lobby the fourth class is the Elven Ranger, with its description and the wolf ability.
- In a run: right click summons the wolf with green sparkles; it follows, guards, bites enemies near the ranger, growls at enemies in the dark with "grrrr" visible in total darkness; right click heals it by 16; it can die, and the box then waits 60 s; it vanishes when the ranger falls; it reappears beside the ranger inside a sealed boss hall.
- No hero attack hurts it; the Paladin heals it; enemies and bosses' area attacks hurt it.
- `cargo test`, `npm test`, `npm run typecheck`, `npm run build` pass; a two-player smoke test against the Docker build shows no browser errors.

## Left to the builder

The ability's id name, the event's shape, the wolf's bite reach and wind-up, the growl's exact timing and distance within the numbers above, the guard and leash radii within the numbers above, the sound outline colour, the green of the puff, the death message wording, where the wolf lives in the code (see the pointers), how entity types carry effect responses.

## Calls I made (for the user to check)

1. The summon starts the 8 s cooldown too.
2. Cooldowns (8 s and 60 s) are divided by the attack-speed upgrade, like every cooldown.
3. A heal on a full-health wolf still uses the ability.
4. Guard radius about 3 tiles from the ranger, leash about 6 tiles, reappear beyond about 12 tiles or when unreachable; it fights back when attacked.
5. At most one growl every 4 s.
6. The wolf's numbers are fixed (no scaling with the ranger's upgrades or the party size).
7. Bosses' area attacks hit the wolf, but bosses and the lich's curses still choose heroes as targets.
8. The wolf is always sent to the party (like heroes), drawn only where lit.
9. The wolf is not immortal in debug mode.
10. (Replaced by the user: characters and statistics are both wiped.)
11. A hiding mimic is growled at but not bitten.
