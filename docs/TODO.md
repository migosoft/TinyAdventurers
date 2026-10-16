# TODO

## Priority order
Ordered by technical complexity and by technical dependencies (what makes later items easier), not by quick wins. Items in the same tier can be done in either order unless noted.

**Tier 1: foundations**
1. **Effect system** (done, built 2026-10-15 on `feature/effects`; follow-ups in "Effect system follow-ups"). Blind, sleep, petrified, slowed, accelerated and the elemental burning, frozen, poisoned; extensible, every creature, effects modify any stat. Spec: [docs/superpowers/specs/2026-10-15-effects-design.md](superpowers/specs/2026-10-15-effects-design.md); TECHNICAL §5 "Status effects", §11 "How to add an effect". The lich casts three effect spells.
2. **Vision edges:** done (2026-10-16, branch `feature/vision-edges`): straight, crisp shadow edges from a visibility polygon (TECHNICAL §7 "The vision mask").
3. **Art and licences:** licences checked (2026-10-16, see "New enemies"): both packs may be used, and Enchanted Forest has the gnolls, the bandit and the elves. Left: the user downloads both packs into `images/`, then import them with a licence note. The ghost, shadow and sphinx still have no free source.

**Tier 2: larger features on top of tier 1**

4. **New abilities, then loadouts, then a way to spend coins** (each depends on the one before). Abilities can be designed with their light and damage types from the start. Enemies now fall, drown and burn when pushed (built for barrel blasts), so a pushing ability needs nothing more.
5. **Riddle rooms:** special room types in the generator, a door lock for any room (today only the boss hall can be sealed), the world objects (done: `run/objects.rs`), a dialog panel. Answer the open design questions first.
6. **Woodland escort level:** needs the world objects and the object targets (done), plus its own level type (the run is already split from "dungeon + boss", see TECHNICAL.md "How to add a level type"), a road-map generator, a wave spawner and gnoll art. The carriage lantern is a moving light source; a night level needs lighting.

**Tier 3: content**

7. **Ghost and shadow.** The shadow and the torch-extinguishing enemy use the light system (`is_lit`, `set_light`; see "Lighting follow-ups"). The ghost needs a movement rule that passes through walls and a decision on how a monster inside a wall tile is handled by visibility filtering.
8. **Elves and bandits** (see "Elves and bandits"): the Elf entity type and the elven archer (a new playable hero class), then the dark elf. The effect system is built (1), so the elf's sleep immunity is one `EffectResponses` entry (see "Effect system follow-ups"); it still needs the Enchanted Forest licence (3). The bandit (Human) needs only the licence; the dark elf also waits for its art.
9. **Assassin restyle and thrown knives** (see "Assassin restyle"): dark clothes and hair (maybe a hood), knives instead of arrows with a shorter range. Independent of the items above; vision is built, so the range can be set now.
10. **Minions for the other bosses; more classes and bosses** (classes are easier after 4).
11. **More loot and room dressing:** item drops need a pickup system; levers and crates are new object kinds on `use_object` (done for barrels); floor spikes work like hazard terrain; fountains, braziers and goo can be light sources. Pillars (see "Pillars") also carry torches; the vision edges give them their shadows.
12. **Terrain ideas:** bridges, lava in the dragon's dungeon, enemies that avoid shallow water.
13. **4-direction sprites, attack frames, sound effects, better spell effects.** Independent; best done once events and animations have settled. Better spell effects means the paladin's healing circle (see "Other follow-ups"). The explosion sheets for barrel blasts and the wizard's Fireball (see "Barrels and world objects follow-ups") is low priority and fits here.

**Tier 4: infrastructure (independent of gameplay work)**

14. **`X-Forwarded-For`:** one change for both the player and the admin login limiters. Needed before running behind a proxy in production.
15. **Password change, named admin accounts, `STATS_TZ`, monitoring stack** (plus `reqwest-rustls` for HTTPS).
16. **Server load: measure, then cache the hero views** (see "Server performance follow-ups"). Before any public launch, and before 17: a cheaper server comes before spreading runs over several. Not urgent while play is private.
17. **Several game servers** (shared presence and login limiter in Valkey). After 14 and 16; only when one server is not enough.

**Tier 5: last**

18. **Balancing pass:** every "Tune" item, including resistances, light radii, darkness and the vision and darkness values (see "Vision and darkvision follow-ups"). Lighting, new enemies, abilities and the escort level all change the balance, so tuning earlier would have to be redone. It includes the damage-type numbers (resistances, splits) and the barrel numbers.
19. **Delta snapshots, WebTransport:** only if measurements show they are needed.

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

## Pillars
User request (2026-10-16), from the vision-edges demo: `?lights` has two free-standing pillars in room 1.
- **What:** single wall tiles (maybe 2×2 in large halls) standing free inside larger rooms. They block sight, walking and shots like any wall. With the vision edges (built 2026-10-16) they cast straight shadow wedges, which gives cover and hiding places (the rogue, sneaking past humans in the dark).
- **Generator** (`dungeon/generate.rs`): only in large rooms, never in the start room, not next to a door or on the straight line between two doors, so every door stays reachable (check it with a flood fill). Boss halls only if the fight is designed for it. Use a new RNG stream and re-record the `level_setup_is_unchanged` fingerprint.
- **Torch mounts:** a pillar is a mounting point for torches, so the middle of a large room (today dark between the wall torches) can be lit. `place_torches` gives runs under 3 tiles no torch, so a pillar needs its own rule, e.g. one torch on its brick face (south side) or a side sconce, at most one per pillar, and still `DARK_SHARE` for the room.
- **Look:** the autotiler already draws a free wall tile as a brick face with a top rim (as in the demo). The pack's columns (see "More room dressing") could look better; check whether their footprint fits one tile.
- **Order:** independent of other work (the vision edges are built).

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
- **More monster art:** the user approved "Enchanted Forest Characters" by superdark (https://superdark.itch.io/enchanted-forest-characters) as a source for future monsters. Also approved (2026-10-13): "Forest creatures" by lyaseek (https://lyaseek.itch.io/miniffanimals). Keep a licence note next to the imported art (the pages ship no licence file, so write `LICENSE.txt` with the quotes below and the page URL).
  - **Licences checked (2026-10-16, from the itch.io pages):**
    - **Enchanted Forest Characters:** CC0, an add-on to the 0x72 pack in the same size and animations. The page says "completely free ... you can use them however you like ... in free or commercial projects", "you can modify the sprites and no credit is required"; the author confirms "cc-0" in a comment. Name your own price (0 is fine). Contents: forest bandit, dire wolf, bear, mushroom folk (3 sizes), troll brute, centaurs (m/f), forest guardian, wood elves (m/f), high elven princess, Elvenking, ent, forest ranger, old hermit wizard, high elf knight, travelling clerics (3 sizes), fairy, golem, and four gnolls (overseer, shaman, brute, grunt). So the gnolls (shaman for ranged, brute or grunt for melee), the bandit, the wood elf and the escort's princess are covered. No ghost, shadow or sphinx.
    - **Forest creatures (lyaseek):** not CC0, but free: "You can use this asset as you like, just don't resell it"; the author confirms commercial use in a comment; credit not required but appreciated (credit it anyway). Name your own price. Contents: 8 animals (bird, bunny, fox, wolf, boar, two deer, bear), with and without outline. Check that its size and outline fit the 0x72 look before using it.
  - **Ghost, shadow and sphinx:** no free 0x72-style source found (2026-10-16). Superdark's free NPC pack has none. Paid 16×16 options exist (QuillGrafit "Fantasy Enemy - Ghosts 16x16 px", KrinJL "Ghost"); ask the user before buying anything. Other ways: a recoloured, half-transparent pack figure for the ghost or shadow (a runtime effect, no new art), or self-made art on request.

## Elves and bandits
New entity type and figures, from the user (2026-10-15). Priority item 8. The vision fields are the ones from the vision and darkvision work (vision in tiles, darkvision as a share of vision; Human is 9 tiles, 0).
- **Elf (new entity type):** damage resistance poison 10 %; vision 200 % of Human (18 tiles); darkvision 1/3; **immune to the sleep effect**, so it waits for the effect system (priority 1).
- **Elven archer (new hero class, playable):** an Elf with the default attack damage type. As a class it needs a `defs/classes.rs` entry (HP, speed, primary and secondary ability), a visual entry in `client/src/game/anim/defs.ts` and a lobby entry; the heroes are Human today, so the class must carry its entity type (Elf) into the hero's resistances and vision. Its abilities are still to design (a bow primary fits; see "New abilities", priority 4). Art: the male wood elf from "Enchanted Forest Characters" by superdark (https://superdark.itch.io/enchanted-forest-characters; licence check first, priority 3).
- **Bandit (new enemy):** entity type Human, no adjustments. Art from the same pack. Needs only the licence, not the effect system.
- **Dark elf (new enemy):** entity type Elf, with a per-entity adjustment: darkvision 100 % of its vision range. The user will provide the art later.

## Assassin restyle
From the user (2026-10-15). Priority item 9. Today the Assassin is the pack's `elf_m` with a bow (`anim/defs.ts`, `ui/classes.ts`) and the `CrossbowDagger` primary (`defs/abilities.rs`: 260 px range, 290 px/s, with an automatic dagger stab in melee).
- **Look:** dark clothes (black, grey or purple) and dark hair. A palette recolour at atlas build time works like the summoner's (`RECOLORS` in `client/scripts/build-atlas.ts`). A **hood** needs pixel edits to the frames, so ask the user first (art rule: self-made art only on request), or find a hooded figure in the pack, a CC0 set or Enchanted Forest.
- **Elf look:** the elven archer (priority 8) will be the real elf, so the Assassin moving away from the `elf_m` look also keeps the two classes apart.
- **Thrown knives instead of arrows:** the projectile is drawn as a spinning knife (`weapon_knife` is already the melee weapon), with no bow in hand. The range drops to between half and 2/3 of the Assassin's vision: with Human vision (9 tiles, 144 px) that is 72 to 96 px, against 260 px today. Change the ability's range on the server; the client's prediction and the cosmetic shot follow it. A shorter range is a big nerf, so look at damage and cooldown in the balancing pass.

## Damage-type system
Built 2026-10-14 (TECHNICAL §5, "Damage model"): five types (physical, cold, heat, magical, poison), a split per attack, resistances from entity types plus per-entity adjustments, one formula (`resolve`), coloured damage numbers and "immune". What is left:
- **More types** (pick only what abilities and enemies will actually use):
  - **lightning:** could jump to a nearby second target, or stun for a moment;
  - **holy:** strong against the undead (lich, skeletons) and demons;
  - **necrotic/shadow:** the lich and a future shadow enemy; undead resist it;
  - **acid:** could lower the target's resistances for a while.
- **Damage over time (decided, built):** it has one of the damage types, and resistances apply to every tick. Burning, frozen and poisoned deal it (TECHNICAL §5): each tick is one `Damage::effect_tick` with its type. Lava still hurts through its own tick (`LAVA_TICK`) and now also sets creatures burning.
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
- **Explosion art (low priority):** the blast is a runtime effect (`Boom k 7`). The user supplied an explosion sheet made with ChatGPT (2026-10-15), stored in `client/assets-src/explosion/explosion_source.png`, not built in yet. It has six labelled stages (initial flash, fireball grows, peak, cooling, smoke expands, dissipates) at about 1536×1024 on a dark glowing background, so the frames must be read as pixel grids (like the barrel), snapped to pack colours and redrawn at game size (peak about the blast radius, 40 px). Show a preview before wiring it in. Credit: "AI-generated with ChatGPT for this game".
- **Fireball explosion art (low priority):** a second ChatGPT sheet (2026-10-15) for the wizard's Fireball impact (today the runtime `Boom` effect, k 0; blast radius 38 px in `defs/abilities.rs`), stored in `client/assets-src/explosion/fireball_source.png`, not built in yet. The same six labelled stages as the barrel sheet, in magical orange and violet with violet smoke, at about 1536×1024 on a painted checkerboard (not real transparency). Import it the same way as the barrel explosion; both can share one importer script. Same credit.
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
- **Enemy types:** orcs, goblins, and gnolls from "Enchanted Forest Characters" (CC0, see "New enemies"), in a ranged (shaman) and a melee (brute or grunt) version.

## Lighting follow-ups
Built 2026-10-15 on branch `feature/lighting` (TECHNICAL §5 "Light sources", §7, §11 "How to add a light source"): a light-kind table, a registry with tile or entity anchors, `is_lit`, visibility by sight and light, a coloured light canvas, wall torches (world objects), lava and glowing shots. Heroes have no light of their own.
- **Own hero light:** through abilities or equipment: `add_light(kind, Anchor::Entity(hero), colour)`. The registry and the renderer already handle it.
- **More sources:** braziers, glowing mushrooms, goo, fountains, the carriage lantern. Each is a new `LightKind` row plus an `add_light` call, with no core change.
- **Remembered (explored) tiles:** darkness is fully black today; a dimmed memory of where the hero has been would need a per-hero explored map.
- **The extinguishing enemy and the shadow:** they act on lights through `is_lit` and `set_light` (a torch is switched with `objects::set_torch`). Should heroes relight torches by standing next to them? Today they press E or use fire.
- **Moving-light list through walls:** it uses a distance test, so the glow of a shot behind a wall within range is sent (TECHNICAL §13). A line-of-sight test per light would fix it.
- **Weapon effects under the darkness:** swooshes, rings and particles are drawn below it. They could be drawn above it, or only the effects of the party.
- **Look details** (the user approved the overall look on 2026-10-15): tint strength (blue and purple read weak, mixed areas wash to grey), the burnt-out torch frame and the side-sconce look, if they bother anyone in play. A flash could fade out over its life (needs a scale in `MovingLight`).
- **Tune** in the balancing pass: the radius and intensity per kind (`defs/lights.rs`: torch 7, fire 4, magic 3, lava 2), the `Blast` flash (radius 4, 0xffb060, intensity 1.0, flicker 0.3) and its time `BLAST_FLASH` (0.4 s, `defs/lights.rs`), the `Holy` flash of the healing wave (radius 4, 0xffe890, intensity 0.9, flicker 0.1, `HOLY_FLASH` 0.6 s), `TORCH_SPACING` (6) and `DARK_SHARE` (0.2, `dungeon/generate.rs`), the falloff curve and its `EDGE` (0.1, `client/src/game/light.ts`), `MIN_LIT` (0.08), `TINT_ALPHA` (0.35), `SUB` (2 px per tile) and the flicker (`client/src/game/lightview.ts`).

## Vision and darkvision follow-ups
Built 2026-10-15 on branch `feature/vision` (TECHNICAL §5 "Sight", §7, §11 "How to give a creature darkvision"): vision in tiles and darkvision as a share of vision on the entity types, one perception rule for enemies and heroes (`run/perception.rs`), the hero snapshot filter with darkvision, the greyscale client effect and a debug toggle (F4).
- **Tune** in the balancing pass: the enemy vision ranges (`defs/enemies.rs`, tiles), the boss range (25 tiles), the darkvision shares per entity type (`defs/entity_types.rs`: Human 0, Monster 1/3, Undead, Demon and Dragon 1.0) and the client `DV_DARK` (0.45, `client/src/game/lightview.ts`). Check by play that sneaking past humans in the dark works and that the lich fight (disciples idle in the dark) is not too easy.
- **Greyscale also greys world-space labels:** the effect is camera-wide, so damage numbers, HP bars and the E hint inside the darkvision range are grey too (TECHNICAL §13).
- **Deferred minor review findings:** the `dvmask` is not primed at `LightView` construction; each attach of `DarkvisionFX` compiles a new pipeline; boss vision is `vision: Some(25.0)` repeated in each boss's `Adjust` in `defs/bosses.rs` and could become one shared constant.
- **Per-tick light cost:** `moving_lights()` now runs every tick (60 Hz) and again on snapshot ticks, scanning the entity lists once per entity-anchored light. Watch `srv_ms` in projectile-heavy boss fights and cache the per-tick list for `send_snapshots` if it shows up.
- **Heroes with darkvision for real:** a class or item with darkvision (the Elf type, see "Elves and bandits") needs only its `Sight` entry; the debug F4 toggle already shows the result.
- **Vision edges follow-ups** (built 2026-10-16; server and client share the polygon view): walls count per tile by the tile FOV, so a wall can show whole in the polygon's shadow or stay black where the polygon reaches its face outside the FOV (TECHNICAL §13). The mask redraws and uploads nearly every frame while walking; measure the frame time in a real dungeon if it ever matters.

## Server performance follow-ups
Priority item 16. Since the vision edges (2026-10-16) every snapshot computes one `View` per player (`vispoly.rs`: the tile FOV, the visibility polygon, up to 16 inside tests per open tile in the polygon's box). That is estimated at 0.15 to 0.3 ms per player, 30 snapshots a second, so about 24 ms of CPU per second for a 4-player run, against about 7 ms for the rest of the simulation (`srv_ms` ≈ 0.11 ms per tick). The views would be most of a run's cost. Runs are separate Tokio tasks on all cores, so roughly 100+ simultaneous runs fit on 4 cores before the CPU runs out. All numbers are estimates, not measured on the server.
- **Measure first:** a timing span around `View::compute` and a **tick lateness** metric (how far behind schedule a tick starts), both in OpenTelemetry, so the admin area can show how close to full the server is.
- **Cache the view while nothing changed:** keep each player's last view and recompute it only when the viewer's position, the rounded vision or the map (a door) changes. A hero standing still then costs nothing. Exact, and server only: the shared rule and its fixture do not change.
- **One view per viewed hero:** a dead player spectating a teammate gets their own copy of the teammate's view today. Compute each hero's view once per snapshot and share it.
- **Reuse buffers:** keep the segment, angle and point lists between computes, and drop the empty `View::new(0, 0)` that `send_snapshots` allocates per player per snapshot (`mem::replace`).
- **Wall segments per map:** merge the wall edges once per map and refresh them on `Ev::Tile`, instead of rescanning the area around the hero on every compute.
- **Later, only if measurements ask for it:**
  - a cheaper tile test: skip tiles beyond the circle; per tile, compare with the polygon's nearest and farthest edge in its angle range, so only tiles that straddle an edge need the 16 samples. This changes the shared rule, so Rust and TypeScript must change together;
  - admission control (refuse new runs when ticks run late);
  - `MissedTickBehavior::Delay` instead of `Burst`;
  - a lower snapshot rate under load.

## Effect system follow-ups
Built 2026-10-15 on branch `feature/effects` (TECHNICAL §5 "Status effects", §11 "How to add an effect"): eight effects (five plus the elemental burning, frozen and poisoned), resistances and responses, hit effects, the lich's three spells, wake-up with E, HUD icons, F8 debug.
- **Play-test (user):** the lich's blinding curse, sleep mist and stone gaze in a real fight (orb speed, how readable the wind-ups are, whether the gaze beam is easy to break), the HUD icons, the lying pose and the stone look.
- **Tune** in the balancing pass: the durations in `defs/effects.rs` (blind 3 s, sleep 4 s, petrified 3 s, slowed and accelerated 3 s, burning 3 s, frozen 2 s, poisoned 4 s), the damage over time (burning heat 6 per second, frozen cold 4, poisoned poison 4), `DOT_TICK` (0.5 s), `ELEMENT_SHARE` (0.5), `EFFECT_REDUCED` (0.5), the `LICH_*` numbers in `defs/bosses.rs` (windups, cooldowns 10, 14 and 18 s, first casts at 4, 7 and 9 s, the blind orb's damage), and the petrified resistances.
- **Sources for Frozen and Poisoned:** nothing cold or poisonous hits yet (heat hits burn: fire, barrels, lava, the dragon). Cold and poison attacks (a frost spell, a spider or snake, a poison arrow) come with new enemies or hero abilities; the element table applies the effect by itself once the hit is at least half cold or poison.
- **Sources for Slowed and Accelerated:** nothing applies them yet (only F8). Hero abilities, tier 2 (priority 4), e.g. a slowing shot or a haste spell; `Damage::with_effect` or `apply_effect` is all they need.
- **The rogue's hide as `Invisible`:** `Player.hidden` is still its own timer. Folding it in as an effect would let items and enemies share it.
- **Monster sleep with `wakes_on_damage`:** the flag exists and `damage_wakes` is called, but no effect uses it. A sleep for monsters (a hero ability) needs it on a new kind or on `Sleep` with a per-target rule, and the AI already skips a monster with `no_act`.
- **The elf's sleep immunity via `EffectResponses`:** per entity type or `Adjust` (today only bosses have a response table, `defs/bosses.rs`); give `Adjust` a `responses` field when the Elf type arrives.
- **Effect sounds:** `Ev::Effect` is sent on every start and end and the client ignores it; it is the hook.
- **Petrified and Burning:** a petrified creature has heat resistance 0.5 from the stone, so one with half heat resistance already (no creature today) becomes immune to Burning (resistance 1.0 refuses the effect). Decide whether stone should protect from fire that way.
- **Poisoned tint overrides the enraged and variant tints:** the green pulse in `EntityView.ts` (~228) wins over them. Revisit when a poison source arrives.
- **HUD glyphs are letters (B, Z, P, S, A, F, I, X):** the pixel font has no symbols. Drawn icons (small sprites, so art or the user's go-ahead) would read better.
- **A frozen boss's running action is paused, not cancelled:** `levels/boss.rs` skips the behaviour tick, while the spec says a running wind-up is cancelled. Decide, or add a `cancel()` hook on `BossBehaviour`, before a hero ability gives bosses effects.
- **Sleeping or petrified monsters can still be pushed** by `separate_monsters`.
- **`Ev::Effect` drives no client burst yet** (start and end of an effect could play a puff).
- **Final whole-branch review:** done for both parts (first five effects, then burning, frozen and poisoned); the fixes are in. Merged into `main` 2026-10-15.

## Riddle rooms
Special rooms with a creature that asks the heroes a riddle. If they solve it, they get a reward. If they fail, they fight the creature, or enemies spawn.
- **Creature art:** the 0x72 pack has unused figures that fit: `doc` (a plague doctor in a mask, which suits a mysterious riddle-giver), `angel`, `wogol` and `pumpkin_dude`. A classic sphinx is not in the pack nor in "Enchanted Forest Characters" (checked 2026-10-16); its old hermit wizard or forest guardian could be the riddle-giver instead.
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
- **Better healing circle (user request, 2026-10-15):** the paladin's healing wave looks too plain. Today `Effects.healRing` (`client/src/game/effects.ts`, played for `Boom` k 1) draws one gold ring and 18 sparks rising inside it. The user wants many more sparkles, and maybe runes on the edge of the circle that move outward as it spreads. The runes need art: from the 0x72 pack, a CC0 set, or user-supplied AI art (ask first; small pixel glyphs drawn for this game also need the user's go-ahead). It is client only; the gold `Holy` light flash already exists.
- **Network:**
  - delta snapshots if bandwidth ever matters (snapshots are compact arrays, about 125 B with 2 players and nothing else in view, 160 to 200 B at the start of a run with the lighting)
  - pushes still snap the hero under lag: the client learns of a push about RTT/2 late, and most push corrections are over the 24 px blend limit (median about 55 px in a demon fight under `?lag=150&jitter=40&loss=2`). Blending corrections that start a push over about 100 ms, whatever their size, would show them as a fast slide instead of a jump.
  - optional WebTransport transport for lossy connections
