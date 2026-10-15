# Effect system (status effects) — DRAFT

**Status:** a draft for the next session. The user asked for an extensible effect system (2026-10-15). Its brainstorming is **not finished**: the "Open questions" below must be settled with the user. After that, this becomes the spec (rename it without `-draft`), gets the user's review, and then a plan (superpowers:writing-plans).

**Order:** after [vision and darkvision](2026-10-15-vision-darkvision-design.md). Vision and darkvision become ordinary stats that effects can change (blindness).

## What the user asked for
- Every creature (heroes, monsters, bosses; not objects) can be subject to effects.
- An effect **modifies any stat**: speed, damage, vision, whether it can move or act, and so on.
- It must be **extensible**: more effects will come.
- Sample effects:
  - **Blindness:** cannot see (vision 0).
  - **Sleep:** the creature falls down and cannot move. Maybe "zzz" rises from the lying body.
  - **Petrified:** cannot move. The sprite is completely greyed out, like a stone statue.
- Darkness is **not** an effect on a creature. It is the environment, handled by the perception rule (vision spec). Effects change the creature's own senses (blindness, or a darkvision potion later).

## Proposed design (to be confirmed)

### Data: `server/src/defs/effects.rs` (data only, like `defs/lights.rs`)
- **`EffectKind`:** an open enum; its first members are `Blind`, `Sleep` and `Petrified`. Later candidates: `Slow`, `Stun`, `Haste`, `Poisoned`/`Burning` (damage over time), `Frozen`, `Darkvision` (potion), `Invisible`.
- **`EffectDef`:**
  - `duration` (default seconds);
  - `stacking` (`Refresh` | `Extend` | `Strongest` | `Stack(max)`);
  - `mods: &[StatMod]`;
  - `flags` (`no_move`, `no_act`, `no_turn`, `prone`);
  - `breaks_on` (`Damage` for sleep, `None`);
  - `visual` (the client's effect id).
- **`StatMod { stat: Stat, op: Op, value: f64 }`:**
  - `Stat`: `MoveSpeed`, `AttackSpeed`, `Damage`, `Armor`, `Vision`, `Darkvision`, `Resist(DamageType)`;
  - `Op`: `Add`, `Mul` or `Set`.
  - Order: all `Add`s, then all `Mul`s, then the strongest `Set` wins (so petrified's speed 0 beats a haste).
- **First values (guesses):**

  | Effect | Mods / flags | Breaks on | Visual |
  |---|---|---|---|
  | Blind | `Vision Set 0` | — | a dark cloud or blindfold over the head |
  | Sleep | `no_move`, `no_act`, `prone` | damage | lying pose, "zzz" particles rising |
  | Petrified | `no_move`, `no_act`, `no_turn`; `Resist(Physical) Add 0.5`? | — (time) | sprite fully greyscale, animation frozen |

### Runtime: `server/src/run/effects.rs`
- **Every creature carries `effects: Effects`** (a small `Vec<ActiveEffect { kind, until, strength, source: Option<u32> }>`) on `Player` and `Monster`.
- **API, the only way features touch effects:**
  - `run.apply_effect(target: Creature, kind, secs: Option<f64>, source)`;
  - `run.remove_effect(target, kind)`;
  - `run.has_effect(target, kind)`;
  - `run.stats(target) -> Stats`.
  - `Creature` is `Player(idx)` or `Monster(idx)`, or by entity id.
- **Resolved stats:**
  - `Stats` = base (`Profile`, `Modifiers`, `Sight`, speed) + the effects' mods.
  - It is resolved when effects change and cached on the creature (`stats_dirty`).
  - Every existing read of speed, damage multiplier, armour, sight and so on goes through `stats` instead of the raw fields: movement, `try_use`, `hurt_*`, perception.
- **Flags are enforced in one place each:**
  - `no_move`: movement (players' input moves, AI movement, but knockback still applies?);
  - `no_act`: abilities and AI attacks and wind-ups (an ongoing wind-up is cancelled);
  - `no_turn`: aim.
- **Ticking:** each step, expired effects are removed (like the light sweep), and damage-over-time effects apply their damage through `hurt_*` with their `DamageType`.
- **Breaking:** `hurt_player` and `hurt_monster` remove effects whose `breaks_on` is `Damage`.
- **Events:** `Ev::Effect { id: entity, kind, on: bool }`, sent like other positioned events (seen + lit).

### Protocol and client
- **Snapshot:** each `EntSnap` carries the active effect kinds as a **bitmask** (`flags` already exists; add a `u16 effects` field, or use the spare bits). The own hero's `SelfW` gets the same, plus remaining times for a HUD icon row (later).
- **Client `game/effects-view.ts`, one visual per effect id, data-driven:**
  - **Sleep:** the figure rotated to lying (90°), a slow "z" particle every 0.6 s rising and fading.
  - **Petrified:** a greyscale per-sprite post-effect (Phaser `preFX` ColorMatrix `grayscale`, or the darkvision greyscale pipeline reused) and a frozen animation frame.
  - **Blind:** a small dark puff over the head.
- **Prediction:** the own hero's `no_move` and `no_act` must also stop client-side prediction (`sim/`), or the hero jitters back.

### Existing ad-hoc states to fold in (to confirm)
- **The mimic's `asleep`:** becomes `Sleep` (woken by damage or proximity).
- **The rogue's `hidden`:** could become `Invisible` (perception ignores it). It breaks on attack.
- **Knockback** (`knock`): stays physics, not an effect.
- **The demon dungeon's lava burn timer:** stays terrain.

## Open questions for the next session (ask the user one at a time)
1. **Sources:** what applies effects first? Enemy spells (a lich blinds, a necromancer's sleep), hero abilities (a wizard's sleep spell), items or potions, terrain (a petrifying basilisk gaze)? This decides what is built in step 1 versus left as API only.
2. **Bosses:** immune to some or all effects (common in games), or reduced duration?
3. **Stacking:** what happens when a second sleep or blind lands: refresh, extend or ignore?
4. **Sleep:** what wakes a creature: any damage, or only damage above a threshold? Do sleeping enemies notice heroes (sleep ⇒ vision 0)? Can heroes be put to sleep (a party member wakes them with E)?
5. **Petrified:** extra damage resistance, or immune to damage? Can it be pushed (into lava or a chasm)? Does it break early on a big hit (shatter)?
6. **A blind hero:** what do they see: nothing (full black around them), or only a 1-tile radius? Blind enemies: wander or stand?
7. **HUD:** effect icons with timers for the own hero (and teammates in the party list)?
8. **Fold-ins:** migrate the mimic's `asleep` and the rogue's `hidden` into effects now, or later?

## Tests (outline)
- **Stat resolution:** `Add`, then `Mul`, then `Set`; several effects; expiry restores the base.
- **Each flag** stops what it should: movement, abilities and AI attacks, aim; knockback still works (or not, per question 5).
- **Sleep** breaks on damage; **blind** makes the perception rule fail; **petrified** greys out on the client (gallery screenshot).
- **Wire:** the bitmask round-trips (wire fixtures). Snapshot size stays small.
- **Fingerprints:** unchanged as long as no content applies effects.
