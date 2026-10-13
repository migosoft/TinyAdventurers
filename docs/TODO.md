# TODO

## Priority order
Ordered by technical complexity and by technical dependencies (what makes later items easier), not by quick wins. Items in the same tier can be done in either order unless noted.

**Tier 1: foundations**
1. **Push immunity** (see "Chained pushes"). The prediction corrections part is done (2026-10-13, TECHNICAL.md §8): they came from the `?lag` simulator delivering out of order, plus moves the predictor dropped while it predicted a fall. The user decided against push immunity on 2026-10-08 ("no push immunity for now"), so ask before building it.
2. **Separate the run from "dungeon + boss".** `Run` assumes one map type: the generator always makes a 140×140 square, and a run is always won by killing the boss (`boss_id`, `boss_ent`, `door_closed`). The escort level needs another map shape, another way to win and lose, and a level choice in the lobby and in `RunStartInfo`. This is the largest refactor in the list; do it before more boss-specific code builds up.
3. **Enemies that target objects, and world objects heroes can use.** `Ai.target` can only hold a player id; the carriage and the torch-extinguishing enemy need targets that are objects or places. The same work adds server-side objects with state and a client message for using them (click or stand nearby). That one system covers the carriage, torches and other light sources, the riddle creature, levers and buttons, and breakable crates.
4. **Light-source system** (see "Lighting"). It comes before every feature that adds something that glows (abilities, enemies, the escort level, room dressing), so none of them has to be retrofitted.
5. **Art and licences:** Enchanted Forest and Forest creatures licences (see "New enemies"), torch art, gnolls. Little code, but the shadow, ghost, gnolls, sphinx and torches all wait on it; it can run alongside 1–4.

**Tier 2: larger features on top of tier 1**

6. **New abilities, then loadouts, then a way to spend coins** (each depends on the one before). Abilities can be designed with their light from the start. If an ability pushes enemies, enemies need their own version of `Sink`/`kill_player` (see "Enemies in terrain").
7. **Riddle rooms:** special room types in the generator, a door lock for any room (today only the boss hall can be sealed), the objects from 3, a dialog panel. Answer the open design questions first.
8. **Woodland escort level:** needs 2 and 3, plus a road-map generator, a wave spawner and gnoll art. The carriage lantern is a moving light source; a night level needs lighting.

**Tier 3: content**

9. **Ghost and shadow.** The shadow needs lighting; it and the torch-extinguishing enemy act on any light source that can be switched off. The ghost needs a movement rule that passes through walls and a decision on how a monster inside a wall tile is handled by visibility filtering.
10. **Minions for the other bosses; more classes and bosses** (classes are easier after 6).
11. **More loot and room dressing:** item drops need a pickup system; levers and crates use 3; floor spikes work like hazard terrain; fountains, braziers and goo can be light sources.
12. **Terrain ideas:** bridges, lava in the dragon's dungeon, enemies that avoid shallow water.
13. **4-direction sprites, attack frames, sound effects.** Independent; best done once events and animations have settled.

**Tier 4: infrastructure (independent of gameplay work)**

14. **`X-Forwarded-For`:** one change for both the player and the admin login limiters. Needed before running behind a proxy in production.
15. **Password change, named admin accounts, `STATS_TZ`, monitoring stack** (plus `reqwest-rustls` for HTTPS).
16. **Several game servers** (shared presence and login limiter in Valkey). After 14; only when one server is not enough.

**Tier 5: last**

17. **Balancing pass:** every "Tune" item, including light radii and darkness. Lighting, new enemies, abilities and the escort level all change the balance, so tuning earlier would have to be redone.
18. **Delta snapshots, WebTransport:** only if measurements show they are needed.

## Progression follow-ups

Progression is live: accounts with up to 8 characters, per-character progress in PostgreSQL, XP banked at run end, lobby upgrade shop. See TECHNICAL.md §11a.
- **Tune** `upgrade_cost` and the per-level bonuses in `defs/progression.rs` as part of the balancing pass. A typical cleared run gives a few hundred XP plus 300 for the boss; maxing one stat costs 4,375 XP.
- **Password change** (old + new password) is not built yet; only deleting the account is.
- **Behind a reverse proxy**, read `X-Forwarded-For` (only from a trusted proxy) so the per-IP login limits apply per player again.
- **Several game servers** would need shared presence (one connection per account) and a shared login limiter, e.g. in Valkey. See "Scaling later" in TECHNICAL.md §11a.

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
  - **Tune** the push distances (`knock` in `defs/enemies.rs`, the demon's `DEMON_*_KNOCK` and the dragon's `DRAGON_*_KNOCK` in `defs/bosses.rs`) and `KNOCK_DECAY` in the balancing pass. The user approved the current ones in `?knockback`; the demon's were raised afterwards at the user's request (cleave 36 → 56, swoop 44 → 64).
  - **Enemies in terrain:** heroes never push enemies, so enemies still never fall or drown. If a hero ability ever pushes, enemies need a monster version of `Sink`/`kill_player`.
  - **Boss-hall chasms:** tune their count and size (`place_boss_chasms`), and check live that pushes into them feel fair.
- **Tune** in the balancing pass: `SHALLOW_SPEED` 0.7, `LAVA_SPEED` 0.4, `LAVA_DAMAGE`/`LAVA_TICK` (20/s; the user wants at least 15/s), `FALL_TIME` 0.7 s, `DROWN_TIME` 0.9 s (all in `dungeon/mod.rs`), and the feature rates and sizes in `place_terrain` (about 4 % of the floor).
- **Confirmed live by the user (2026-10-08):** a normal water run, chasm falls and drowning. Lava damage with armour upgrades has not been looked at specifically.
- **Ideas:** bridges drawn as planks over chasms, lava in the dragon's dungeon too, enemies that avoid shallow water when a dry path exists.

## New enemies
- **Ogre (done 2026-10-08):** tune its numbers in the balancing pass (`EnemyType::Ogre` in `defs/enemies.rs`: 260 HP, club 18 dmg / 28 px push, slam radius 34 px, 14 dmg, 24 px push, 5 s cooldown, 0.9 s wind-up; 60 XP, 30 coins). Ideas: a hit frame (the pack has none), more than one ogre in big dungeons.
- **Ghost and shadow (new):** two new enemy types. The 0x72 pack has neither, so the art has to come from another pack or a CC0 set.
  - Ideas for the ghost: drifts through walls, or turns half transparent and can't be hit for a moment.
  - Ideas for the shadow: hard to see in the dark. It could be the enemy that puts out torches (see "Lighting").
- **More monster art:** the user approved "Enchanted Forest Characters" by superdark (https://superdark.itch.io/enchanted-forest-characters) as a source for future monsters. Also approved (2026-10-13): "Forest creatures" by lyaseek (https://lyaseek.itch.io/miniffanimals). For both, check the license and keep the license file next to the imported art.

## Woodland escort level
An outdoor level where the heroes escort a carriage carrying the elven princess.
- **Map:** a long forest road with trees on both sides. Open question: should the road run left to right or bottom to top? Left to right suits a wide desktop screen, because the camera shows more road ahead.
- **Win:** the carriage reaches the far end of the map with HP left. The run then gives a lot of XP. If the carriage is destroyed, the run is lost.
- **Carriage:** moves slowly along the road. A player clicks it to:
  1. stop it,
  2. start it again if it is stopped,
  3. repair it slowly while it is stopped.
- **Enemies:** attack the carriage in waves. An enemy that a hero hits turns on the heroes, so the heroes can draw attacks away from the carriage.
- **Enemy types:** orcs, goblins, and a new type from the woodland asset pack: gnolls, in a ranged and a melee version.

## Lighting
Darkness limits what the heroes can see. Dungeon walls have torches at regular intervals that light the area around them. Some enemies can put torches out, which leaves that part of the dungeon dark. Lava pools glow red.
Torches are only the first kind of light source. More will follow: lava, braziers, glowing mushrooms or goo, hero spells and projectiles (a fireball lighting the corridor it flies through), light-emitting enemies, a carriage lantern. So build a general light-source system, not a torch feature (priority 4).
- **Feasible:** yes, at tile resolution. The fog of war already works this way (TECHNICAL.md §7).
- **Light sources:** each has a position, radius, colour, intensity and an on/off state. Two kinds:
  - **static** (torches, braziers, lava): fixed on the map, can be switched off and on.
  - **moving** (projectiles, glowing enemies, the carriage lantern): follow an entity.
- **Server (needed, so dark tiles don't leak monsters):** two layers.
  - A static light map per tile: each lit static source lights the tiles its shadowcast (`fov.rs`) reaches within its radius; lava lights its neighbouring tiles. It only needs recomputing when a static source goes out or is relit.
  - Moving sources are checked during visibility filtering, each as a radius test around the source. A shadowcast per moving source each tick would be too expensive.
  - A tile counts as visible if it is in the hero's line of sight *and* is lit by either layer or within a small radius around the hero (their own light). Snapshot filtering in `run/visibility.rs` then uses the combined result.
- **Client:** extend the fog canvas into a light canvas: darkness everywhere, with a radial gradient cut out for each source and hero, coloured per source kind from a table (e.g. red around lava). It stays one cheap canvas texture with linear filtering, plus a slight flicker. Phaser's Light2D pipeline is not needed. It wants normal maps and has a low light limit.
- **Protocol:** static sources and their state (lit or out) go in the map data at run start, plus an event when one changes. Moving sources need no new data: the client attaches lights to entities by their kind (e.g. `KIND.Fireball` glows).
- **Enemies:** an extinguishing enemy (it walks to a lit source that can be switched off and puts it out). Should the heroes be able to relight sources, e.g. by standing next to one?
- **Art:** the 0x72 pack has no wall torches. Find a CC0 animated torch or wall sconce.
- **Tune:** torch spacing, the light radius of each source kind, the heroes' own light radius, and how dark unlit areas are.

## Riddle rooms
Special rooms with a creature that asks the heroes a riddle. If they solve it, they get a reward. If they fail, they fight the creature, or enemies spawn.
- **Creature art:** the 0x72 pack has unused figures that fit: `doc` (a plague doctor in a mask, which suits a mysterious riddle-giver), `angel`, `wogol` and `pumpkin_dude`. A classic sphinx is not in the pack; one might be in "Enchanted Forest Characters" (see "New enemies") or in a CC0 set.
- **Questions to settle:**
  - How do players answer? Multiple choice (each player clicks an answer, the majority wins or the first answer counts) or typed text? Multiple choice is easier to check and works without exact spelling.
  - Riddles in German, English, or both? This sets how the riddle list is stored.
  - Reward for a correct answer: XP, coins, a buff for the rest of the run?
  - On failure: the creature fights itself (it needs stats and an attack), or it spawns a wave of enemies and disappears?
  - Is there a time limit? Can the heroes refuse the riddle and simply walk past?
- **Server:** pick the riddle and check the answer on the server, so the client never sees the correct answer. Lock the room's doors while the riddle is open, like the boss force field.
- **Client:** a dialog panel with the riddle and its answer buttons, shown to every player in the room.

## Admin and monitoring follow-ups
- **Time zone of the statistics:** days are UTC. A `STATS_TZ` setting could count local days if UTC boundaries are confusing.
- **Several admins:** there is one admin login from the environment, so the audit log names that login, not a person. Named admin accounts would need a table and a way to create them.
- **Monitoring stack:** OTLP export is ready (TECHNICAL.md §11c); ClickStack or another collector is not set up yet. HTTPS endpoints need the `reqwest-rustls` feature of `opentelemetry-otlp`.
- **`X-Forwarded-For`** is not read, so behind a proxy the admin login limiter (like the player one) sees one IP for everyone.

## Other follow-ups
- **Balancing pass (later, all at once):** progression, classes, enemies and boss fights together. All three bosses were played live without problems; their numbers are in `server/src/run/bosses/*.rs` and `defs/bosses.rs`.
- **Loadouts:** choose primary/secondary per class. Each class has only its one pair today, so new abilities (server executor, client prediction, pack-sprite visuals) are needed first. The picker and a field on `Member` are the easy part.
- **More classes and bosses:** add to `defs/classes.rs` / `defs/bosses.rs` plus a `BossBehaviour` file, and add the visual entry in `client/src/game/anim/defs.ts`.
- **Art gaps in the 0x72 pack:**
  - The summoner is the necromancer with a recolored (red) robe, made at atlas build time (`RECOLORS` in `build-atlas.ts`).
  - There are no attack animation frames.
  - Dedicated sprite sheets can be added to `client/assets-src/` and referenced in `anim/defs.ts`.
- **4-direction sprites:** the animation code keeps a `Dir` value. Up/down frames can be added there once sheets exist.
- **Sound effects.**
- **Network:**
  - delta snapshots if bandwidth ever matters (snapshots are compact arrays now, about 125 B with 2 players, about 350 B with 14 entities in view)
  - pushes still snap the hero under lag: the client learns of a push about RTT/2 late, and most push corrections are over the 24 px blend limit (median about 55 px in a demon fight under `?lag=150&jitter=40&loss=2`). Blending corrections that start a push over about 100 ms, whatever their size, would show them as a fast slide instead of a jump.
  - optional WebTransport transport for lossy connections
