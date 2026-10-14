# Damage types, entity types, world objects and exploding barrels (TODO priorities 1 and 2)

User decisions (2026-10-14): exploding barrels are the first object; any hit lights a short fuse; ranged enemies aim at barrels near heroes; E pushes a barrel within hand reach; explosions push enemies too, and enemies fall, drown and burn like heroes; barrels are solid for everyone; groups in rooms and the boss hall; chests move into the object system; damage types and entity types (with per-entity adjustments) as below; every object resists poison 100 %; negative resistance is a weakness, floored at -100 %; a damage split always sums to 100 %, the rest is physical.

## Context
TODO.md tier 1 items 1 and 2 are now planned together, at the user's request (2026-10-14):
- **Object system (priority 1).** Server-side world objects with state, a hero "use" input, and enemies that can target objects or places, not only player ids. Later the carriage, torches, levers, crates and the riddle creature build on it.
- **Damage-type system (priority 2).** Typed damage and resistances on heroes, enemies and objects. Damageable objects must use the same damage path.

**First real use: exploding barrels.**
- Any hit lights a short fuse. The blast damages and pushes heroes and enemies, and lights other barrels, so they explode in a chain.
- Heroes push barrels with E.
- Ranged enemies shoot barrels that stand next to heroes.
- Explosions can push enemies into chasms, deep water or lava.
- Chests move into the new object system.

Branch: `feature/barrels` from `main`. Every number below is a first guess for the balancing pass (TODO "Tune").

## Delivery steps
1. This spec (committed on the branch), reviewed by the user.
2. Write the implementation plan with **superpowers:writing-plans**. The user picks how it is carried out.
3. Build it in three stages, each one tested and committed:
   - **A.** Damage model and entity types, with every damage call migrated.
   - **B.** The object system, with chests moved into it.
   - **C.** Barrels, monster knockback and terrain deaths, enemies that target barrels, and the client.

## A. Damage model (new `server/src/defs/damage.rs`, `server/src/run/damage.rs`)
- **`DamageType`** is an open enum: `Physical, Cold, Heat, Magical, Poison`. New types are new variants.
- **`DamageSplit`** is a list of `(type, share)` that always sums to 1.0.
  - The only constructors are `physical()`, `pure(t)` and `split(&[(t, share)])`.
  - With a partial list, `split` fills the rest with Physical. It panics in debug builds if the shares go over 1.
- **`Damage { amount, split }`** describes one hit.
  - Every source builds one: melee, shots, explosions, the burn ticks of lava and fire patches, and barrels.
  - Damage over time builds one per tick.
- **`Resistances`** is a list of `(type, percent)`.
  - A missing type counts as 0.
  - The final value is clamped to at least −100 %, i.e. no more than double damage.
  - Values above 100 % are allowed: the hit heals.
- **`resolve(&Damage, &Resistances) -> f64`** returns Σ part × (1 − res). This is the only formula in the game. A negative result means healing.
- **Entity types** (`EntityType` enum plus a defs table, so balancing edits only data):

  | Type | Resistances | Melee split |
  |---|---|---|
  | human | none | physical |
  | undead | physical 10, heat −10, poison 100 | physical |
  | monster | none | physical |
  | demon | magical 20, heat 100, cold −50 | 80 % physical, 20 % heat |
  | dragon | magical 50, physical 10 | physical |
  | object | physical 50, poison 100 | physical |

- **Who has which entity type:**

  | Type | Entities |
  |---|---|
  | human | the four hero classes; necromancer, summoner, disciple |
  | undead | skeleton warrior, skeleton archer, raised skeleton, raised archer, lich |
  | monster | goblin archer, orc warrior, orc archer, mimic, ogre |
  | demon | imp, chort, summoned imp, demon boss |
  | dragon | dragon boss |
  | object | chest, barrel |

  - Each def (class, `EnemyType`, boss, object kind) lists one or more entity types plus **adjustments**: extra resistances added on top, and a melee split that overrides the type's.
  - The final resistances are the sum of all entity types plus the adjustments, computed once at spawn and stored on the entity.
- **Per-entity adjustments:**
  - **Lich:** physical +40, magical +40.
  - **Dragon:** heat +100, melee 20 % heat.
  - **Demon boss:** magical +20.
- **Attack splits.** Melee uses the attacker's melee split. Shots default to physical, magic to magical.

  | Attack | Split |
  |---|---|
  | Sword, axe, dagger, barbarian dash contact | human melee (physical) |
  | Crossbow bolt, arrows | physical |
  | Wizard magic missile | magical |
  | Wizard fireball | 70 % heat, 20 % magical, 10 % physical |
  | Necromancer and disciple shadow bolt | magical |
  | Lich gloom bolt and nova | magical |
  | Fire bolt (imp, chort, summoner) | 70 % heat, 30 % magical |
  | Demon fire orbs | 70 % heat, 30 % magical (same as fire bolt) |
  | Demon cleave and swoop | demon melee |
  | Dragon breath, dragon fireball, fire patches | heat |
  | Dragon bite, smash, tail | dragon melee |
  | Ogre club and slam | monster melee |
  | Lava | heat, per tick |
  | Barrel blast | 50 % heat, 50 % physical |

- **Migration.**
  - `hurt_player(pi, Damage)`, `hurt_monster(mi, Damage, crit, src)` and the new `hurt_object` all call `resolve`. There are about 25 call sites in `run/abilities.rs`, `run/ai.rs`, `run/bosses/{demon,dragon,lich}.rs` and `run/mod.rs` (lava, hazards).
  - The `Projectile` carries its `Damage`, and `explode` takes a `Damage`.
  - The XP armour upgrade (`mods.armor` in `hurt_player`) stays for now. It is applied after `resolve`. Removing it waits for items (an open point in the TODO).
  - The lich's immunity (`Level::on_boss_hurt`) is unchanged.
- **Healing above 100 %.** A negative result heals, capped at max HP, and sends a `Heal` event.
- **`Dmg` event.**
  - It gets a byte `ty`, the type with the largest share, which the client uses for the number's colour.
  - It also gets a flag `imm`, set when the result is 0 for a non-zero hit. The client shows "immune" for it.
  - These change the protocol, wire (`EV_CODES`/`wire.rs`, `client/src/wire.ts`) and wire fixtures. `export.rs` exports the damage-type names and colours.
- **Not in scope:** items and equipment, and new damage types.

## B. Object system (new `server/src/run/objects.rs`)
- **`WorldObject { id, kind: ObjKind, pos, radius, solid, res: Resistances, state: ObjState }`**
  - `ObjState::Chest { opened: Option<f64> }`
  - `ObjState::Barrel { fuse: Option<f64>, igniter: Option<usize>, slide: (vx, vy), sinking: Option<(f64, Sink)> }`
- `Run.objects` replaces `Run.chests`.
  - `touch_chests` loops over the chest objects. Its behaviour is unchanged: coins on touch, and mimics still wake nearby.
  - Mimics stay monsters.
- **Snapshots and visibility.** One encoder per kind, in the existing `EntW` format, filtered by line of sight like chests are today (`run/visibility.rs`).
  - Chest encoding is unchanged.
  - Barrel `anim` values: 0 at rest, 1 while the fuse burns, 2 when falling, 3 when sinking.
  - New `EntityKind::Barrel = 81`.
- **`hurt_object(oi, Damage, src)`** calls `resolve`. For a barrel, any result above 0 lights the fuse and remembers the first igniter. Chests ignore damage.
- **`AI target`** becomes `ai.target: Option<Target>`, where `Target::Player(u32) | Object(u32) | Place(Vec2)`.
  - Existing logic sets and reads `Player`.
  - `Place` is ready for torches and the carriage but has no use yet.
- **Hero use input.**
  - New field `act: bool` in `InputMsg`/`InputW`, with the generated TS types and wire fixtures.
  - The client sets it once per E press while alive. While dead, E still spectates (`GameScene.ts:148`).
  - The server: `use_object(pi)` finds the nearest usable object within reach and dispatches on its kind. Reach is `PLAYER_RADIUS + obj.radius + USE_REACH` (6 px).
  - Nothing happens while the hero is dead, knocked back or sinking.

## C. Barrels and what they need
- **Placement.** A new generator stage `place_barrels` in `dungeon/generate.rs` with its own RNG stream (11), so existing seeds stay the same.
  - About 25 % of Room/Hall rooms get a group of 2–4 barrels on dry floor. Not next to doorways or chests, and room connectivity must stay intact.
  - The boss hall gets 3–5 barrels, outside `hall_keep_clear` and away from the chasms.
  - The `Layout` gets `barrels: Vec<Vec2>`.
- **Constants** (in `defs/objects.rs`):
  - barrel radius 6 (a solid 12 px square)
  - `BARREL_FUSE` 0.3 s
  - `BARREL_BLAST_R` 40
  - `BARREL_BLAST_DMG` 30, split 50 % heat / 50 % physical
  - `BARREL_BLAST_KNOCK` 40 px
  - `BARREL_PUSH` 48 px
- **Explosion** (`objects::explode_barrel`).
  - It sends `Boom` with a new k (6).
  - It hits heroes, monsters and bosses within the radius, if they have line of sight to the blast. Damage and kill stats go to the igniter.
  - It pushes heroes (`knock_player`) and non-boss monsters (`knock_monster`).
  - It lights every barrel within the radius, which gives the chain.
- **Push.** `use_object` on a barrel sets `slide = knock_speed(BARREL_PUSH)` along the line from the hero to the barrel.
  - Barrels move each step with the knockback decay. Walls and other solids stop them.
  - Over a chasm: falls (sinking, `Sink::Fall`), then removed.
  - In deep water: sinks without exploding.
  - In lava: the fuse is set to 0, so it explodes.
- **Solid objects in movement.**
  - `move_box` gets a list `solids: &[(x, y, half)]` of squares, checked axis by axis like tiles. This applies to heroes, monsters (`ai::move_toward`, `separate_monsters`) and sliding barrels.
  - The same change goes into `client/src/sim/collision.ts`. The predictor (`client/src/game/world.ts`) uses the barrel positions from the latest snapshot.
  - `export.rs` fixtures get runs with barrels, so `sim.test.ts` still checks that Rust and TypeScript give the same results.
- **A* and shots.**
  - A* (`ai::astar_clear`) treats tiles under a resting barrel as blocked.
  - Player and monster shots stop at a solid object and hurt it (`advance_projectile`). `melee_arc`, `dash_contact`, `dagger_target` and `explode` also hit objects.
  - The client's local shot copy stops at barrels: a `HITBOX` entry for the barrel, used by `GameScene.shotTouchesEnemy`.
  - Barrels do not block sight.
- **Monster knockback and terrain deaths.**
  - `Monster` gets `knock: (vx, vy)`, `sinking: Option<(f64, Sink)>`, a `burn_t` and a `last_hit_by` field.
  - **`knock_monster(mi, from, dist)`:** bosses are never pushed. While a monster is pushed, its AI does not move it. It slides like a knocked-back hero, using the Dash mover, so only walls and solids stop it.
  - **`terrain_monster`** runs after the AI step:
    - Over a chasm: falls (`FALL_TIME`). In deep water: drowns (`DROWN_TIME`). Then `kill_monster`, with the kill credited to the last hitter.
    - In lava: burns with the heat `LAVA_DAMAGE` every `LAVA_TICK`.
    - `astar_clear` may start on a blocked tile, so a monster can find its way out of the lava.
  - `Ev::Sink` is sent with the monster's id. The client reuses the fall and drown animations for monster figures.
- **Enemies that target barrels** (`ai.rs`, the Chase branch, ranged non-boss enemies).
  - Before an attack, the enemy looks for an unlit barrel that it can see and reach, that lies within the blast radius of its target hero, and whose blast would not reach the enemy itself.
  - If it finds one, it aims the attack at it (`Target::Object`) and the shot goes toward the barrel.
  - When the wind-up ends, it uses the barrel if that is still there, and otherwise fires at the hero.
- **Client.**
  - `client/src/game/barrel.ts` (`BarrelView`): the sprite, flashing and a spark while the fuse burns, the fall and sink animations.
  - The k 6 explosion effect.
  - A small "E" hint above the nearest barrel within reach.
  - Damage numbers coloured by type, with "immune" text.
  - The kind dispatch in `GameScene` (around line 578).
- **Art.**
  - Find CC0 16 px barrel art (and possibly an explosion sheet) in the 0x72 style, and show the user candidates before importing.
  - Store it in `client/assets-src/<set>/` with its licence and add it to the README credits.
  - Until then the pack's `crate` stands in.

## Tests (TDD; `server/src/run/*` inline test modules, `test_run` helpers in `run/mod.rs`)
- **`resolve`:**
  - single and multiple types
  - a missing resistance
  - 100 % (immune)
  - above 100 % (heals)
  - negative resistance, and its −100 % floor
  - partial splits filled up with Physical
- **Entity types:** sums of type and adjustment resistances (lich physical 50 %, dragon heat 100 %+), and each def's melee split.
- **Migrated attacks:**
  - a demon takes no heat damage from the fireball's heat part
  - a skeleton takes more heat damage
  - the existing combat tests still pass
- **Objects:**
  - a chest still opens and gives coins
  - mimics still wake on touch
  - objects resist poison 100 %
- **Barrels:**
  - the fuse explodes after 0.3 s
  - chain timing
  - blast damage and knockback on a hero, a monster and a boss (the boss takes damage but is not pushed)
  - the E push and its reach
  - a pushed barrel stops at a wall and at another barrel
  - a barrel in a chasm, in water and in lava
- **Monsters:** blown into a chasm (dies, XP to the party), into water, and into lava (burns, then walks out).
- **Ranged AI:** shoots a barrel next to a hero, and does not shoot one it would be caught by itself.
- **Generator:** barrel counts, and room and boss-hall connectivity.
- **Shared Rust/TS:** collision fixtures with barrels (`sim.test.ts`), and wire fixtures for `act` and `Dmg` (`wire.test.ts`).

## Verification
- `cargo test` in `server/`. This also regenerates `client/src/generated/*`.
- `npm test` and the type check in `client/`.
- **Live check with the user:**
  - a chain reaction
  - an E push into a chasm, into water and into lava
  - an enemy blown into a chasm
  - an archer shooting a barrel next to a hero
  - barrels in the boss hall
  - coloured damage numbers and "immune"
  - no prediction snaps when walking along barrels

## Docs and wrap-up
- **Docs to update:**
  - TECHNICAL: damage model, entity types, objects, collision with solids, protocol
  - PLAYER_GUIDE: barrels, the E key, damage types
  - TODO: remove items 1–2, add follow-ups (thrown or pushed objects dealing damage, more object kinds)
  - HANDOFF
- Commit after each stage. Merge only when the user asks.
