# Effect system (status effects)

**Status:** spec, settled with the user on 2026-10-15 (brainstorming of the earlier draft). Next: user review, then an implementation plan (superpowers:writing-plans).

**Builds on:** [vision and darkvision](2026-10-15-vision-darkvision-design.md). Vision and darkvision are stats that effects change (blindness).

## Goal
Every creature (heroes, monsters, bosses; not objects) can carry effects. An effect changes stats (speed, vision, resistances, knockback taken) and can forbid moving, acting or turning. The system is extensible: a new effect is a new enum member plus a data entry and a client visual. Effects can be negative or positive.

The first build has five effects. The lich casts three of them; two are defined but have no source yet.

| Effect | Positive | Source in this build |
|---|---|---|
| Blind | no | lich: blinding curse |
| Sleep | no | lich: sleep mist |
| Petrified | no | lich: stone gaze |
| Slowed | no | none (defined, tested, debug key) |
| Accelerated | yes | none (defined, tested, debug key) |

Darkness is not an effect: it is the environment, handled by the perception rule. Effects change the creature's own senses.

## Decisions (from the user)
1. **Sources:** enemy spells first, only the lich for now. Each lich spell is one entry in its attack table, so removing one for balancing is a one-line change. Effects can also ride on any hit (weapons, arrows: "a sleep poison arrow"), so the hit carries the effect, not a special projectile.
2. **Creature response per effect:** immune, reduced (50 % duration) or full; full is the default.
   - Lich: immune to Sleep and Blind, Petrified reduced (Slowed and Accelerated full).
   - Dragon: immune to Sleep, everything else reduced.
   - Demon: immune to Sleep, everything else full.
   - Ogre and every other creature: full.
3. **Stacking:** refresh. A second application sets the remaining time to the longer of the remaining and the new duration.
4. **Sleep:** damage does not wake. Only the timer or a teammate pressing E next to the sleeper does. The sleeper's own view is strongly dimmed with a hint to ask a teammate.
5. **Petrified:** strong resistance (75 % less physical, 50 % less of every other type). Knockback still applies, at a shorter distance.
6. **Blind:** the hero sees nothing: vision 0 and darkvision 0 (darkvision does not help against blindness). They can still use abilities and aim freely.
7. **HUD:** icons with timers for the own hero; the same icons without timers in the party list.
8. **Fold-ins:** none. The monsters' `asleep` (bosses waiting for the party, the lich's idle disciples, closed mimics) is not an effect: it has no source and no timer and ends by proximity. It is renamed to **`dormant`** (behaviour unchanged). The rogue's `hidden` stays as it is; it may become an `Invisible` effect later.

## Data: `server/src/defs/effects.rs`
Data only, like `defs/lights.rs`.

- **`EffectKind`:** `Blind = 0`, `Sleep = 1`, `Petrified = 2`, `Slowed = 3`, `Accelerated = 4`. The id is the bit in the wire bitmask (up to 16 kinds).
- **`EffectDef`** per kind:
  - `duration: f64`: default seconds (a source may pass its own);
  - `positive: bool`: HUD frame colour;
  - `mods: &'static [StatMod]`;
  - `no_move`, `no_act`, `no_turn`, `prone: bool`;
  - `wakes_on_damage: bool`: off for all five (kept for a future monster sleep);
  - `wakes_on_use: bool`: a teammate's E ends it (Sleep only).
- **`StatMod { stat: Stat, op: Op, value: f64 }`**
  - `Stat`: `MoveSpeed`, `Vision`, `Darkvision`, `Resist(DamageType)`, `KnockTaken`. New stats are added when an effect needs them.
  - `Op`: `Add`, `Mul`, `Set`. Resolution: base, then every `Add`, then every `Mul`, then the lowest `Set` wins (so a petrified creature stays at 0 whatever else applies).
- **`EFFECT_REDUCED = 0.5`:** the duration factor for a "reduced" response.
- **Starting values (tuned in the balancing pass):**

  | Effect | Mods | Flags | Duration |
  |---|---|---|---|
  | Blind | `Vision Set 0`, `Darkvision Set 0` | — | 3 s |
  | Sleep | `Vision Mul 0.15` | `no_move`, `no_act`, `prone`, `wakes_on_use` | 4 s |
  | Petrified | `Resist(Physical) Add 0.75`, every other type `Add 0.5`, `KnockTaken Mul 0.4` | `no_move`, `no_act`, `no_turn` | 3 s |
  | Slowed | `MoveSpeed Mul 0.5` | — | 3 s |
  | Accelerated | `MoveSpeed Mul 1.5` | — | 3 s |

  Slowed and Accelerated together give ×0.75.
- **Responses:** `EffectResponse { Immune, Reduced, Full }`. A creature carries an `EffectResponses` table (default all `Full`), filled like its resistances: from the entity type plus the boss's `Adjust` in `defs/bosses.rs` (lich, dragon, demon as above).

## Effects on hits
- `Damage` gains `on_hit: Option<OnHit { kind: EffectKind, secs: f64, chance: f64 }>`. `Damage` already travels through every hit: projectiles, melee, explosions, hazards, the nova.
- `hurt_player` and `hurt_monster` apply it after the damage: if the target is still alive, roll `chance` (on the run's seeded rng), then `apply_effect`.
- Damage resistance and effect response are independent: a hit fully resisted as damage still applies its effect; only the response table stops an effect.
- A hit with `amount: 0` and an `on_hit` is a pure effect hit (no damage number).
- **Defs:** `EnemyDef` gets `on_hit` for its `attack` and `alt_on_hit` for its `alt`; hero `AbilityDef` gets `on_hit`. Nothing current sets them, so run fingerprints stay unchanged.

## Runtime: `server/src/run/effects.rs`
- **Storage:** `Player` and `Monster` each get `effects: Effects`, a small `Vec<ActiveEffect { kind, left: f64 }>`.
- **API** (the only way other code touches effects):
  - `run.apply_effect(target: Creature, kind, secs: Option<f64>)`: looks up the response (immune → nothing; reduced → `secs × EFFECT_REDUCED`), refreshes or adds, sends `Ev::Effect { on: true }` when newly added. Dead or sinking creatures are ignored.
  - `run.remove_effect(target, kind)`, `run.has_effect(target, kind)`.
  - `Creature::Player(idx)` or `Creature::Monster(idx)`.
- **Resolved stats:** `run.stats(target) -> Stats { move_speed, sight: Sight, res: Resistances, knock_taken, no_move, no_act, no_turn }`, computed on each read from the base fields and the active mods (a handful of effects, no cache). The existing reads go through it:
  - **Speed:** hero input moves (`p.def.speed * p.mods.move_speed`) and monster movement (`m.speed`, AI and boss behaviours).
  - **Sight:** `sight_now()` users (perception and the hero snapshot filter).
  - **Resistances:** `hurt_player`, `hurt_monster`.
  - **Knockback:** `knock_player` and `knock_monster` scale `dist` by `knock_taken`.
- **Flags, each enforced in one place:**
  - `no_move`: hero input moves are ignored (speed 0); the AI does not move the monster. Knockback still slides.
  - `no_act`: hero E, primary and secondary are ignored; a monster starts no attack, and a running wind-up is cancelled. Boss behaviours check it before choosing an action.
  - `no_turn`: hero aim and monster aim stay as they are.
- **Ticking:** every step, `left -= DT`; at 0 the effect is removed with `Ev::Effect { on: false }`. A hero who dies loses every effect.
- **Waking (E):** in `use_object`, before objects, a living hero within `USE_REACH` of a teammate with a `wakes_on_use` effect removes those effects. Waking beats a barrel or torch in reach. The sleeper's own E is blocked by `no_act`.
- **Events:** `Ev::Effect { id, kind, on }`, sent like other positioned events (seen and lit), used for sounds and short bursts. The lasting state travels in the snapshot, so late joiners see it.

## The lich's spells
Three new entries in the lich's action table (`run/bosses/lich.rs`), taking turns with volley, summon and nova. Numbers live in `defs/bosses.rs` (`LICH_BLIND_*`, `LICH_SLEEP_*`, `LICH_GAZE_*`). The first cooldowns are staggered, so they do not all land early in the fight.

| Spell | Delivery | Hit | Cooldown |
|---|---|---|---|
| Blinding curse | 0.6 s wind-up, then a slow dark orb at one hero | 6 magical damage + Blind 3 s (chance 1) | 10 s |
| Sleep mist | 0.8 s wind-up, then a slow purple orb | 0 damage + Sleep 4 s | 14 s |
| Stone gaze | 1.0 s wind-up, a grey beam locked on one hero; then an instant hit if the hero is still in line of sight | 0 damage + Petrified 3 s | 18 s |

- Blind and sleep skip a hero who already has that effect.
- The orbs are new `EntityKind`s (or `GloomBolt` variants) with their own client look; they carry the effect through `Damage::on_hit`.
- The gaze's beam is sent like the drain beams or as an event pair (start with target id, end); the plan picks the cheaper of the two.

## Protocol
- **`EntSnap`:** a new trailing `u16` effects bitmask (bit = `EffectKind` id). `flags` (`u8`) has one bit left, so effects get their own field. Heroes are always in the party's snapshot, so teammates' effects arrive everywhere.
- **`SelfState`:** `effects: Vec<(u8, f32)>` (kind, seconds left) for the HUD; `speed_mul: f32` (the resolved move-speed factor, 0 while `no_move`) for prediction; `no_act: bool`.
- **Codegen:** `EffectKind` and the client's per-effect data (`positive`, `prone`, `no_turn`) are exported to `generated/defs`.
- **Debug:** a `DebugEffect` client message (debug mode only, like `DebugDarkvision`) applies an effect to the own hero.
- Wire fixtures updated.

## Client
- **Prediction (`sim/`, `GameScene`):** move speed × `speed_mul`; `no_act` stops local ability use (no predicted cast animations or cooldowns); `no_turn` freezes the sent aim.
- **Visuals: new `client/src/game/status.ts`** (`effects.ts` is the particle and decal pool), one data-driven entry per effect:

  | Effect | In-world look |
  |---|---|
  | Blind | A small dark puff circling over the head |
  | Sleep | The figure rotated 90° (its facing picks the side it falls to), the ground side cropped flat by 1 to 2 px (`setCrop`) and squashed to about 92 % height, so the soft body seems pressed against the floor; the shadow stretched wide; a "z" rising and fading every 0.6 s. The crop is checked per figure in the gallery. |
  | Petrified | The sprite greyscale (Phaser `preFX` ColorMatrix) and the animation frozen on its current frame |
  | Slowed | A faint blue tint, slower walk animation |
  | Accelerated | A faint yellow afterimage trail, faster walk animation |

- **Own hero's view:** blind = vision 0 and darkvision 0, so the existing `LightView` darkens everything but the own figure. Asleep = vision × 0.15 and a centred hint: "Asleep. A teammate can wake you (E)."
- **Teammates** see an "E Wake" hint over a sleeping hero in reach, like the existing E hint.
- **HUD (`ui/hud.ts`):** an icon row with a countdown under the own HP bar; the same icons without timers in each teammate's party-list row. Red frame for negative, green for positive. Small drawn glyphs (eye crossed out, "z", stone, snail, arrow), no new art.
- **Debug key F8** (debug mode only, alive): applies the next effect in the cycle Blind → Sleep → Petrified → Slowed → Accelerated to the own hero, for its default duration. F3 and F4 are taken; F5 and F6 are browser keys.
- **Gallery:** heroes and some monsters in each of the five effects. **`LichDemoScene`:** the three spells' telegraphs.

## Rename: `asleep` → `dormant`
Done first, in its own commit, behaviour unchanged: `Monster::asleep` → `dormant` (about 24 places), `flags::ASLEEP` → `flags::DORMANT` (`FLAG.DORMANT` through codegen), the client's mimic code (`asleep`, `wasAsleep`) and comments that mean dormancy.

## Tests
**Server:**
- Stat resolution: `Add`, then `Mul`, then the lowest `Set`; Slowed + Accelerated = ×0.75; expiry restores the base.
- Responses: immune does nothing, reduced is ×0.5, full is full; the lich, dragon, demon and ogre tables.
- Refresh keeps the longer timer.
- `no_move` blocks input and AI moves, knockback still slides (×0.4 when petrified); `no_act` blocks E and abilities and cancels a monster's wind-up; `no_turn` freezes aim.
- Sleep: damage does not wake; a teammate's E in reach does, and wins over a barrel; the sleeper's own E does nothing.
- Blind: `perception::sees` is false at any distance, the snapshot filter sends no enemies, darkvision does not help.
- Petrified: physical ×0.25, other types ×0.5.
- On-hit: chance 0 never applies, chance 1 always; damage immunity does not block the effect; a dead target gets nothing.
- Lich: each spell lands its effect; a hero behind a wall avoids the gaze.
- Effects expire on time; a dying hero loses them.
- Wire: the bitmask and the new `SelfState` fields round-trip. Fingerprints unchanged.

**Client:** prediction with `speed_mul` 0, 0.5 and 1.5 matches the server step (like `sim.test.ts`); `no_act` blocks the local ability.

**Visual check:** the gallery (sleep crop per figure, greyscale), `?debug` with F8, `LichDemoScene`.

## Docs (wrap-up)
TECHNICAL.md: an effects section and "How to add an effect". HANDOFF.md. TODO.md: item 1 done; follow-ups (tune the durations and the lich cooldowns, sources for Slowed and Accelerated, the rogue's hide as `Invisible`, monster sleep with `wakes_on_damage`). PLAYER_GUIDE.md: the lich's spells, waking a teammate.

## Out of scope
Items and potions, hero abilities that apply effects (the `on_hit` field is ready for them), effect sounds. (Damage over time and resistance-based immunity were added later: see "Addendum: elemental effects".)

## Addendum: elemental effects (Burning, Frozen, Poisoned)
**Status:** settled with the user on 2026-10-15, after the first five effects were built on `feature/effects`. It extends the system above. Where this addendum and the sections above disagree, the addendum wins.

### Decisions (from the user)
1. **Three new effects with damage over time:**
   - **Burning:** heat damage over time.
   - **Frozen:** cannot move, act or turn, plus cold damage over time.
   - **Poisoned:** poison damage over time.
   - The over-time damage lasts as long as the effect is on.
2. **Hits apply them by element:** a hit that is **at least 50 %** heat applies Burning, at least 50 % cold applies Frozen, and at least 50 % poison applies Poisoned.
   - Burning: fireball, fire bolts and orbs, dragon fire, fire patches, the barrel blast and lava. Claws with a 20 % heat part do not burn.
   - **Lava** applies Burning on every tick, so standing in lava keeps it refreshed. It runs on after the creature leaves the lava.
3. **Only an initial hit applies effects.** Damage dealt by an effect never applies an effect: not its own (no endless refresh) and not any other.
4. **Immunity from resistance:** a creature whose current resistance to an effect's damage type is 100 % or more does not take that effect. Examples:
   - demons and the dragon are never burned, and walk through lava unharmed;
   - undead and objects are never poisoned;
   - a petrified creature whose heat resistance reaches 100 % is not burned while petrified.
   The per-creature response table (immune, reduced, full) still applies on top.
5. **Fire and ice cancel each other:**
   - Burning applied to a frozen creature ends Frozen and does not burn it (it thaws).
   - Frozen applied to a burning creature ends Burning and does not freeze it.
   - The hit's own damage applies either way.
6. **Water puts out fire:** standing on shallow or deep water ends Burning.
7. **Sources:** only fire has sources today. Nothing deals cold or poison damage yet, so Frozen and Poisoned are built, tested and reachable with F8, and any future cold or poison hit applies them automatically.

### Data
- **New `EffectKind`s:** `Burning = 5`, `Frozen = 6`, `Poisoned = 7`.
- **Starting values** (tuned in the balancing pass):

  | Effect | Damage over time | Flags | Duration | Ends early |
  |---|---|---|---|---|
  | Burning | 6 heat/s | — | 3 s | in water; when Frozen is applied |
  | Frozen | 4 cold/s | `no_move`, `no_act`, `no_turn` | 2 s | when Burning is applied |
  | Poisoned | 4 poison/s | — | 4 s | — |

- **Ticks:** over-time damage ticks every `DOT_TICK = 0.5` s, for `dps × DOT_TICK` per tick. Burning deals 3 per tick, 18 over its full 3 s.
- **`EffectDef` gains:**
  - `dot: Option<(DamageType, f64)>` (type and damage per second), which also drives the immunity rule;
  - `cancels: &'static [EffectKind]`;
  - `ends_in_water: bool`.
- **The element table** (`defs/effects.rs`): `ELEMENT_SHARE = 0.5` and `ELEMENTS: [(DamageType, EffectKind)] = [(Heat, Burning), (Cold, Frozen), (Poison, Poisoned)]`. A new elemental effect is one line here.

### Runtime
- **`Damage` gains `from_effect: bool`** (false from `Damage::new`). When it is true, `hurt_player` and `hurt_monster` skip every effect step: the element rule, `on_hit` and wake-on-damage. Resistances, armour, damage numbers, death and the boss immunity check work as usual.
- **Element rule:** after a normal hit's damage, if the target lives, every element whose share of the hit is at least `ELEMENT_SHARE` applies its effect (default duration).
- **`apply_effect`** checks the resistance immunity (the creature's current resistances, effects included) and the cancels, so they hold for every source (element rule, `on_hit`, F8).
- **Ticking:** each `ActiveEffect` with a `dot` carries a tick timer. Every `DOT_TICK` it deals its damage as effect damage.
- **Water:** a creature whose centre is on shallow or deep water loses its `ends_in_water` effects.
- **Kill credit:** a monster killed by effect damage credits `last_hit_by` with the kill, like a lava death.
- **Frozen's flags** reuse the existing enforcement (movement, actions, aim; client prediction through `speed_mul`, `no_act` and `EFFECTS[id].no_turn`).

### Protocol
No format change. The new ids fit the `u16` bitmask and the own hero's effect list. The generated `EFFECT` and `EFFECTS` include them, and F8 cycles through all eight effects.

### Client
- **Burning:** a few small flames on the figure itself, spread over its body and flickering. No tint.
- **Frozen:** a soft, translucent blue haze around the figure, and tiny snowflakes that shimmer into and out of existence around it (each fades in at a random nearby spot, holds briefly and fades out). The animation freezes on its current frame. No tint fill.
- **Poisoned:** a green tint pulse and small green bubbles rising.
- **HUD letters:** F (Burning), I (Frozen), X (Poisoned), all in red frames.
- **Gallery:** a row for each new effect.

### Tests
- Burning deals 3 heat every 0.5 s for 3 s (18 in total) and ends. Partial heat resistance reduces each tick.
- No loop: a burning hero is not re-burned by their own ticks and burns out after exactly 3 s.
- Trigger: a 70 % heat hit burns, a 20 % heat claw does not, and a lava tick burns.
- Immunity:
  - a demon in lava takes no damage and gets no Burning;
  - undead are never poisoned;
  - a petrified creature whose heat resistance reaches 100 % is not burned.
- Cancel: Burning on a frozen creature thaws it and does not burn it, and the reverse.
- Water ends Burning.
- Frozen blocks moving, acting and turning, and ticks cold damage.
- Effect damage that kills a monster credits `last_hit_by`.
- Client: glyphs for the new ids.
- Visual: gallery screenshots and a live F8 run.
- **Fingerprints:**
  - `level_setup_is_unchanged` must not change.
  - In `simulation_is_unchanged_after_waking_the_boss`, the demon and dragon hall values may change (their fire hits now burn heroes). Re-record them with a dated comment naming the cause.
  - The lich value should not change, since the lich has no fire. It may change only if a barrel blast (50 % heat) hits a hero during the test, and that cause must be confirmed.

### Docs
- TECHNICAL: damage over time, the element table, the rule that effect damage applies no effects, and how to add an elemental effect.
- PLAYER_GUIDE: burning, freezing, poison, water puts out fire.
- TODO: sources for Frozen and Poisoned, tuning the new values.
