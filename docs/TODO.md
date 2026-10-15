# TODO

## Priority order
Ordered by technical complexity and by technical dependencies (what makes later items easier), not by quick wins. Items in the same tier can be done in either order unless noted.

**Tier 1: foundations**
1. **Art and licences:** Enchanted Forest and Forest creatures licences (see "New enemies"), gnolls. Little code, but the shadow, ghost, gnolls and sphinx wait on it.

**Tier 2: larger features on top of tier 1**

2. **New abilities, then loadouts, then a way to spend coins** (each depends on the one before). Abilities can be designed with their light and damage types from the start. Enemies now fall, drown and burn when pushed (built for barrel blasts), so a pushing ability needs nothing more.
3. **Riddle rooms:** special room types in the generator, a door lock for any room (today only the boss hall can be sealed), the world objects (done: `run/objects.rs`), a dialog panel. Answer the open design questions first.
4. **Woodland escort level:** needs the world objects and the object targets (done), plus its own level type (the run is already split from "dungeon + boss", see TECHNICAL.md "How to add a level type"), a road-map generator, a wave spawner and gnoll art. The carriage lantern is a moving light source; a night level needs lighting.

**Tier 3: content**

5. **Ghost and shadow.** The shadow and the torch-extinguishing enemy use the light system (`is_lit`, `set_light`; see "Lighting follow-ups"). The ghost needs a movement rule that passes through walls and a decision on how a monster inside a wall tile is handled by visibility filtering.
6. **Minions for the other bosses; more classes and bosses** (classes are easier after 2).
7. **More loot and room dressing:** item drops need a pickup system; levers and crates are new object kinds on `use_object` (done for barrels); floor spikes work like hazard terrain; fountains, braziers and goo can be light sources.
8. **Terrain ideas:** bridges, lava in the dragon's dungeon, enemies that avoid shallow water.
9. **4-direction sprites, attack frames, sound effects.** Independent; best done once events and animations have settled.

**Tier 4: infrastructure (independent of gameplay work)**

10. **`X-Forwarded-For`:** one change for both the player and the admin login limiters. Needed before running behind a proxy in production.
11. **Password change, named admin accounts, `STATS_TZ`, monitoring stack** (plus `reqwest-rustls` for HTTPS).
12. **Several game servers** (shared presence and login limiter in Valkey). After 10; only when one server is not enough.

**Tier 5: last**

13. **Balancing pass:** every "Tune" item, including resistances, light radii and darkness. Lighting, new enemies, abilities and the escort level all change the balance, so tuning earlier would have to be redone. It includes the damage-type numbers (resistances, splits) and the barrel numbers.
14. **Delta snapshots, WebTransport:** only if measurements show they are needed.

## Progression follow-ups

Progression is live: accounts with up to 8 characters, per-character progress in PostgreSQL, XP banked at run end, lobby upgrade shop. See TECHNICAL.md §11a.
- **Tune** `upgrade_cost` and the per-level bonuses in `defs/progression.rs` as part of the balancing pass. A typical cleared run gives a few hundred XP plus 300 for the boss; maxing one stat costs 4,375 XP.
- **Password change** (old + new password) is not built yet; only deleting the account is.
- **Behind a reverse proxy**, read `X-Forwarded-For` (only from a trusted proxy) so the per-IP login limits apply per player again.
- **Several game servers** would need shared presence (one connection per account) and a shared login limiter, e.g. in Valkey. See "Scaling later" in TECHNICAL.md §11a.
- **Piercing shots (idea from the user, 2026-10-14):** an unlockable upgrade for ranged attacks so a shot passes through a limited number of enemies (first 2, later 3, maybe 4). Today every hero shot ends at the first enemy (`advance_projectile` in `run/abilities.rs`; the client's cosmetic copy stops there too, `GameScene.shotTouchesEnemy`). A pierce count would go on `Projectile` (plus the ids already hit), with the cosmetic copy taking the same count.

## Chests, mimics and coins follow-ups
- **Spend coins:** they are banked but buy nothing yet. Intended for loadouts (see below); a coin column in the lobby shop would also work.
- **Tune** `CHEST_COINS`, `coins_for_kill`, the chest rate (35 % of rooms) and the mimic share (25 %) in the balancing pass. Mimic stats are in `defs/enemies.rs`.
- **More loot:** the pack also has flasks (8 colours/sizes), bombs and coins that could drop as pickups; crates (`crate`) could be breakable objects (see "Barrels and world objects follow-ups").
- **More room dressing from the pack (unused so far):** floor spikes (animated), buttons and levers, columns, wall fountains (red/blue, animated), wall goo, floor ladder/stairs.

## Demon dungeon follow-ups
- **Tune** imp, chort and summoner stats (`defs/enemies.rs`) in the balancing pass. They start close to the skeletons they replace.
- **Other bosses could get their own minions** the same way (`enemies::for_boss`), e.g. ice or undead variants for the lich and lizards for the dragon.

## Terrain follow-ups
Terrain is live (water, lava, chasms; TECHNICAL.md §5, §6 and §9).
- **Knockback is live** (TECHNICAL.md §5, §8). Follow-ups:
  - **Tune** the push distances (`knock` in `defs/enemies.rs`, the demon's `DEMON_*_KNOCK` and the dragon's `DRAGON_*_KNOCK` in `defs/bosses.rs`) and `KNOCK_DECAY` in the balancing pass. The user approved the current ones in `?knockback`; the demon's were raised afterwards at the user's request (cleave 36 → 56, swoop 44 → 64).
  - **Enemies in terrain (done for blasts, 2026-10-14):** a barrel blast pushes non-boss monsters (`knock_monster`), and monsters fall, drown and burn like heroes (`terrain_monster`, TECHNICAL §5). Still open: heroes' own attacks never push, bosses are never pushed, and a lava death gives no kill credit.
  - **Boss-hall chasms:** tune their count and size (`place_boss_chasms`), and check live that pushes into them feel fair.
- **Tune** in the balancing pass: `SHALLOW_SPEED` 0.7, `LAVA_SPEED` 0.4, `LAVA_DAMAGE`/`LAVA_TICK` (20/s; the user wants at least 15/s), `FALL_TIME` 0.7 s, `DROWN_TIME` 0.9 s (all in `dungeon/mod.rs`), and the feature rates and sizes in `place_terrain` (about 4 % of the floor).
- **Confirmed live by the user (2026-10-08):** a normal water run, chasm falls and drowning. Lava damage with armour upgrades has not been looked at specifically.
- **Ideas:** bridges drawn as planks over chasms, lava in the dragon's dungeon too, enemies that avoid shallow water when a dry path exists.

## New enemies
- **Ogre (done 2026-10-08):** tune its numbers in the balancing pass (`EnemyType::Ogre` in `defs/enemies.rs`: 260 HP, club 18 dmg / 28 px push, slam radius 34 px, 14 dmg, 24 px push, 5 s cooldown, 0.9 s wind-up; 60 XP, 30 coins). Ideas: a hit frame (the pack has none), more than one ogre in big dungeons.
- **Ghost and shadow (new):** two new enemy types. The 0x72 pack has neither, so the art has to come from another pack or a CC0 set.
  - Ideas for the ghost: drifts through walls, or turns half transparent and can't be hit for a moment.
  - Ideas for the shadow: hard to see in the dark. It could be the enemy that puts out torches (see "Lighting follow-ups").
- **More monster art:** the user approved "Enchanted Forest Characters" by superdark (https://superdark.itch.io/enchanted-forest-characters) as a source for future monsters. Also approved (2026-10-13): "Forest creatures" by lyaseek (https://lyaseek.itch.io/miniffanimals). For both, check the license and keep the license file next to the imported art.

## Damage-type system
Built 2026-10-14 (TECHNICAL §5, "Damage model"): five types (physical, cold, heat, magical, poison), a split per attack, resistances from entity types plus per-entity adjustments, one formula (`resolve`), coloured damage numbers and "immune". What is left:
- **More types** (pick only what abilities and enemies will actually use):
  - **lightning:** could jump to a nearby second target, or stun for a moment;
  - **holy:** strong against the undead (lich, skeletons) and demons;
  - **necrotic/shadow:** the lich and a future shadow enemy; undead resist it;
  - **acid:** could lower the target's resistances for a while.
- **Damage over time (decided):** it has one of the damage types, and resistances apply to every tick. Nothing but lava deals damage over time yet; poison or burning would build one `Damage` per tick.
- **Armour and items (decided):** armour stops being a stat raised with XP. Items give armour, and so resistances. An armour piece gives at least physical resistance, and any item can give resistances to other types.
  - **The XP armour upgrade still exists** (`Modifiers.armor`): `hurt_player` applies it after `resolve`. Removing it waits for items.
  - Remove `Armor` from the lobby upgrade shop (`UpgradeStat`, `StatUpgrades.armor`, `Modifiers.armor` in `defs/progression.rs`) and the `mods.armor` reduction in `hurt_player`.
  - Items need an equipment system: item slots per character, stored with the character's progress in PostgreSQL, and a way to get items (drops, the lobby, or coins; see "Spend coins").
- **Open questions (armour):**
  - Characters that already bought armour levels: refund the XP they spent, or keep the levels as a fixed physical resistance? `progress.rs` needs a version bump either way.
  - Removing armour before items exist leaves heroes with no damage reduction. Should both ship together?
- **Tune** every resistance, split and the −100 % floor in the balancing pass (`defs/entity_types.rs`, `defs/damage.rs`).

## Barrels and world objects follow-ups
Built 2026-10-14 on branch `feature/barrels` (TECHNICAL §5, "World objects"): chests moved into `run/objects.rs`, exploding barrels as the first new kind, enemies that can target objects or places (`Target`).
- **Thrown or pushed objects dealing damage:** today a pushed barrel only slides and a blocked slide stops it. A barrel (or crate) that hits a hero or enemy could hurt and push them.
- **More object kinds** on `hurt_object` and `use_object`: crates (breakable, may hold coins), levers and buttons, the carriage, the riddle creature. `use_object` already dispatches on the kind; E is the use key.
- **Tune** in the balancing pass: barrel blast radius 40, damage 30 (50 % heat, 50 % physical), push 40 px, fuse 0.3 s, hand push 48 px, how many rooms get barrels (25 %), 3–5 in a boss hall (`defs/objects.rs`, `place_barrels`).
- **Plain barrels as obstacles:** the user wants barrels that do not explode and only block. The art exists (atlas frame `barrel`, see TECHNICAL §9 "Barrel frames"); the object kind (or a flag on `ObjState::Barrel`), its placement and the client view (`BarrelView` takes the frame) do not.
- **Explosion art:** the blast is a runtime effect (`Boom k 7`); an explosion sheet would help (candidate: BitingChaos "16x16 Explosion", CC0, OpenGameArt).
- **Deferred review findings** (small, none blocks anything):
  - the A* squeeze cost applies to every monster, not only wide ones; a chaser repaths every 0.6 s while a hero stands next to a barrel;
  - an igniter who has left still gets credited with damage and kills; a lava death gives no credit;
  - `knock_monster` does not clear a wind-up; `escape_terrain` has no fallback when no walkable tile is within 3 tiles;
  - an enemy's fire-time check for its barrel does not test "sinking"; no tests for boss exclusion or a stale barrel;
  - the camera shakes on every visible barrel blast; the E hint uses the interpolated position;
  - `DamageSplit::split` only debug-asserts shares over 100 %;
  - a boss hall can get fewer than 3 barrels on a seed with no valid spot.

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

## Lighting follow-ups
Built 2026-10-15 on branch `feature/lighting` (TECHNICAL §5 "Light sources", §7, §11 "How to add a light source"): a light-kind table, a registry with tile or entity anchors, `is_lit`, visibility by sight and light, a coloured light canvas, wall torches (world objects), lava and glowing shots. Heroes have no light of their own.
- **Own hero light:** through abilities or equipment: `add_light(kind, Anchor::Entity(hero), colour)`. The registry and the renderer already handle it.
- **More sources:** braziers, glowing mushrooms, goo, fountains, the carriage lantern. Each is a new `LightKind` row plus an `add_light` call, with no core change.
- **Remembered (explored) tiles:** darkness is fully black today; a dimmed memory of where the hero has been would need a per-hero explored map.
- **Enemies affected by darkness:** they see in the dark today; their perception could use `is_lit` for the target.
- **The extinguishing enemy and the shadow:** they act on lights through `is_lit` and `set_light` (a torch is switched with `objects::set_torch`). Should heroes relight torches by standing next to them? Today they press E or use fire.
- **Moving-light list through walls:** it uses a distance test, so the glow of a shot behind a wall within range is sent (TECHNICAL §13). A line-of-sight test per light would fix it.
- **Light at a shot's impact** (if the user wants it after the live test): a fire shot's light ends with the shot, so its explosion in the dark is not seen. A short-lived point light at the impact needs a time-limited anchor in the registry.
- **Weapon effects under the darkness:** swooshes, rings and particles are drawn below it. They could be drawn above it, or only the effects of the party.
- **Look, pending the user:** falloff, tint strength (blue and purple read weak, mixed areas wash to grey), flicker, the 1 px per tile canvas (light bleeds about half a tile past walls; 2 or 4 px per tile would be sharper), the burnt-out torch frame and the side-sconce look. See HANDOFF.
- **Tune** in the balancing pass: the radius and intensity per kind (`defs/lights.rs`), `TORCH_SPACING` (6) and `DARK_SHARE` (0.2, `dungeon/generate.rs`), the falloff curve (`client/src/game/light.ts`), `MIN_LIT` (0.35), `TINT_ALPHA` (0.35) and the flicker (`client/src/game/lightview.ts`).

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
  - delta snapshots if bandwidth ever matters (snapshots are compact arrays, about 125 B with 2 players and nothing else in view, 160 to 200 B at the start of a run with the lighting)
  - pushes still snap the hero under lag: the client learns of a push about RTT/2 late, and most push corrections are over the 24 px blend limit (median about 55 px in a demon fight under `?lag=150&jitter=40&loss=2`). Blending corrections that start a push over about 100 ms, whatever their size, would show them as a fast slide instead of a jump.
  - optional WebTransport transport for lossy connections
