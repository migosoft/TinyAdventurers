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
Damage over time (poison, burning), items and potions, hero abilities that apply effects (the `on_hit` field is ready for them), effect sounds, resistance-based immunity beyond the per-creature table.
