# TODO

## Progression follow-ups

Progression is live (profiles by token, XP banked at run end, lobby upgrade shop). See TECHNICAL.md §11a.
- **Tune** `upgrade_cost` and the per-level bonuses in `defs/progression.rs` as part of the balancing pass. A typical cleared run gives a few hundred XP plus 300 for the boss; maxing one stat costs 4,375 XP.
- **Identity is a browser token.** If players want their profile on several devices, add accounts or a "show/enter my token" field in the lobby.
- The same token can be in one run twice (two tabs), which banks its XP twice. Reject a second join with the same token if that becomes a problem.

## Chests, mimics and coins follow-ups
- **Spend coins:** they are banked but buy nothing yet. Intended for loadouts (see below); a coin column in the lobby shop would also work.
- **Tune** `CHEST_COINS`, `coins_for_kill`, the chest rate (35 % of rooms) and the mimic share (25 %) in the balancing pass. Mimic stats are in `defs/enemies.rs`.
- **More loot:** the pack also has flasks (8 colours/sizes), bombs and coins that could drop as pickups; crates (`crate`) could be breakable.
- **More room dressing from the pack (unused so far):** floor spikes (animated), buttons and levers, columns, wall fountains (red/blue, animated), wall goo, floor ladder/stairs.

## Demon dungeon follow-ups
- **Tune** imp, chort and summoner stats (`defs/enemies.rs`) in the balancing pass. They start close to the skeletons they replace.
- **Other bosses could get their own minions** the same way (`enemies::for_boss`), e.g. ice or undead variants for the lich and lizards for the dragon.

## Terrain follow-ups
Terrain is live (water, lava, chasms; TECHNICAL.md §5, §6 and §9).
- **Knockback is live** (TECHNICAL.md §5, §8). Follow-ups:
  - **Chained pushes:** several orc warriors can push a hero again and again, and a pushed hero has no control. A scripted bot mobbed by orcs in a corridor was pushed in about 10 % of its snapshots. If it feels unfair in play, add a short push immunity after a push (server rule plus predictor).
  - **Tune** the push distances (`knock` in `defs/enemies.rs`, `CLEAVE_KNOCK`/`SWOOP_KNOCK` in `run/bosses/demon.rs`, `CLAW_KNOCK`/`TAIL_KNOCK` in `run/bosses/dragon.rs`) and `KNOCK_DECAY` in the balancing pass. The user approved the current ones in `?knockback`.
  - **Enemies in terrain:** heroes never push enemies, so enemies still never fall or drown. If a hero ability ever pushes, enemies need a monster version of `Sink`/`kill_player`.
  - **Boss-hall chasms:** tune their count and size (`place_boss_chasms`), and check live that pushes into them feel fair.
- **Tune** in the balancing pass: `SHALLOW_SPEED` 0.7, `LAVA_SPEED` 0.4, `LAVA_DAMAGE`/`LAVA_TICK` (20/s; the user wants at least 15/s), `FALL_TIME` 0.7 s, `DROWN_TIME` 0.9 s (all in `dungeon/mod.rs`), and the feature rates and sizes in `place_terrain` (about 4 % of the floor).
- **Confirmed live by the user (2026-10-08):** a normal water run, chasm falls and drowning. Lava damage with armour upgrades has not been looked at specifically.
- **Ideas:** bridges drawn as planks over chasms, lava in the dragon's dungeon too, enemies that avoid shallow water when a dry path exists.

## New enemies
- **Ogre (done 2026-10-08):** tune its numbers in the balancing pass (`EnemyType::Ogre` in `defs/enemies.rs`: 260 HP, club 18 dmg / 28 px push, slam radius 34 px, 14 dmg, 24 px push, 5 s cooldown, 0.9 s wind-up; 60 XP, 30 coins). Ideas: a hit frame (the pack has none), more than one ogre in big dungeons.
- **More monster art:** the user approved "Enchanted Forest Characters" by superdark (https://superdark.itch.io/enchanted-forest-characters) as a source for future monsters. Check its license and keep the license file next to it.

## Other follow-ups
- **Balancing pass (later, all at once):** progression, classes, enemies and boss fights together. All three bosses were played live without problems; their numbers are in `server/src/run/bosses/*.rs` and `defs/bosses.rs`.
- **Loadouts:** choose primary/secondary per class. Each class has only its one pair today, so new abilities (server executor, client prediction, pack-sprite visuals) are needed first. The picker and a field on `Member` are the easy part.
- **More classes and bosses:** add to `defs/classes.rs` / `defs/bosses.rs` plus a `BossBehaviour` file, and add the visual entry in `client/src/game/anim/defs.ts`.
- **Art gaps in the 0x72 pack:**
  - The red dragon is the pack lizard, scaled and hue-shifted.
  - The lich is a scaled, tinted necromancer.
  - The summoner is the necromancer with a recolored (red) robe, made at atlas build time (`RECOLORS` in `build-atlas.ts`).
  - The demon has no bat wings.
  - There are no attack animation frames.
  - Dedicated sprite sheets can be added to `client/assets-src/` and referenced in `anim/defs.ts`.
- **4-direction sprites:** the animation code keeps a `Dir` value. Up/down frames can be added there once sheets exist.
- **Sound effects.**
- **Network:**
  - delta snapshots if bandwidth ever matters (snapshots are compact arrays now, about 125 B with 2 players, about 350 B with 14 entities in view)
  - prediction corrections under `?lag=150&jitter=40&loss=2` in busy debug runs: a scripted bot walking the debug path to the demon saw corrections of up to 10–23 px in about a third of the F3 samples, with the old and the new snapshot form alike (the calm smoke test stays at 0.00 px). Cause not investigated yet; suspects are debug climb-outs after chasm falls on cut corners and server-side effects the predictor does not know.
  - optional WebTransport transport for lossy connections
