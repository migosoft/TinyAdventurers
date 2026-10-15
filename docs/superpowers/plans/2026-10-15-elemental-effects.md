# Elemental Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Burning, Frozen and Poisoned: effects that deal damage over time, applied automatically by hits that are mostly heat, cold or poison (lava included). They are ignored by creatures immune to that damage, fire and ice cancel each other, and water puts out fire.

**Architecture:**
- **Data:** `defs/effects.rs` gains the three kinds, three `EffectDef` fields (`dot`, `cancels`, `ends_in_water`) and an element table.
- **Runtime:** `run/effects.rs` ticks the damage over time inside `tick_effects` as *effect damage* (`Damage.from_effect`), which never applies effects. `apply_effect` refuses an effect when the creature is immune to its damage type, and resolves the cancels. The hurt functions apply the element table after a normal hit.
- **Client:** the client adds three visuals in `game/status.ts` and three HUD letters. The wire format is unchanged.

**Tech Stack:** Rust server (tokio, rmp-serde, ts-rs), TypeScript + Phaser 3.90.0 client (vitest).

**Spec:** [docs/superpowers/specs/2026-10-15-effects-design.md](../specs/2026-10-15-effects-design.md), section "Addendum: elemental effects" (approved by the user 2026-10-15). It builds on the five effects already on branch `feature/effects`.

## Global Constraints
- **New ids:** `Burning = 5`, `Frozen = 6`, `Poisoned = 7` (`EffectKind::COUNT` = 8).
- **Values:**
  - Burning: 6 heat/s, 3 s, ends in water and when Frozen is applied.
  - Frozen: 4 cold/s, 2 s, `no_move`, `no_act`, `no_turn`, ends when Burning is applied.
  - Poisoned: 4 poison/s, 4 s.
- **Ticks:** `DOT_TICK = 0.5` s, each dealing `dps × DOT_TICK`. Burning deals 3 per tick and 18 over its full 3 s.
- **Element table:** `ELEMENT_SHARE = 0.5`, `ELEMENTS = [(Heat, Burning), (Cold, Frozen), (Poison, Poisoned)]`. A hit whose share of the type is at least 0.5 applies the effect (default duration).
- **Only an initial hit applies effects.** Damage with `from_effect == true` never applies any effect: not the element rule, not `on_hit`, not wake-on-damage.
- **Immunity:** if the creature's current resistance to the effect's `dot` type, through its effects, is at least 1.0, `apply_effect` refuses the effect. The per-creature response table still applies on top.
- **Cancel:**
  - applying Burning to a frozen creature removes Frozen and does not add Burning;
  - applying Frozen to a burning creature removes Burning and does not add Frozen;
  - the hit's own damage still applies.
- **Water:** a creature whose centre is on `ShallowWater` or `DeepWater` loses its `ends_in_water` effects.
- **Kill credit:** a monster killed by effect damage credits its `last_hit_by` hero with the kill.
- **Wire format unchanged.** HUD letters: Burning **F**, Frozen **I**, Poisoned **X**, all negative (red).
- **Visuals:**
  - Burning: small flames on the figure itself, no tint.
  - Frozen: a translucent blue haze and tiny snowflakes shimmering in and out of existence around the figure; the animation frame frozen; no tint fill.
  - Poisoned: a green tint pulse and small rising green bubbles.
- **Fingerprints:**
  - `level_setup_is_unchanged` must not change.
  - In `simulation_is_unchanged_after_waking_the_boss`, only the demon and dragon values may change, and only in Task 3 (the element rule). Re-record them with a dated comment naming the cause.
  - The lich value may change only if a barrel blast hits a hero during that test; confirm the cause before re-recording.
  - Tasks 1, 2 and 4 must not change any fingerprint.

## Review Focus
1. **A burning hero stands still on the lava edge, half in, half out:** the burn refreshes only while their centre is on lava, so leaving runs out after exactly 3 s, with no self-refresh. Test in Task 2 (`burning_runs_out_after_its_duration_without_refreshing_itself`).
2. **Frozen and Burning arrive in the same step, from a fire hit on a frozen hero:** the hero ends up with neither effect and takes only the hit's damage. Test in Task 2 (`fire_thaws_ice_and_ice_puts_out_fire`).
3. **A burning hero dashes into deep water and drowns, or walks into shallow water:** shallow water ends Burning at once. A drowning (sinking) hero already loses every effect. Test in Task 2 (`shallow_water_puts_out_fire`).
4. **A monster dies of burn damage after the hero who lit it has left or died:** the kill counter goes to `last_hit_by` if that index is still a player, with no panic. Test in Task 2 (`a_burn_kill_credits_the_last_hero_who_hit`).
5. **The lich, immune while its disciples live, is hit by a fireball:** `on_boss_hurt` refuses the hit, so no Burning lands on an immune boss and no burn ticks hurt it. Test in Task 3 (`an_immune_lich_is_not_set_on_fire`).

## Files
- **Server:**
  - `defs/effects.rs` (kinds, fields, element table);
  - `defs/damage.rs` (`Damage.from_effect`, `Damage::effect_tick`);
  - `run/effects.rs` (dot ticks, immunity, cancels, water, `element_hit`);
  - `run/mod.rs` (`hurt_player`, `hurt_monster`; fingerprint comment).
- **Client:** `ui/text.ts` (glyphs), `ui/text.test.ts` or wherever `effectGlyph` is tested, `game/status.ts`, `game/anim/EntityView.ts` (frozen frame), `game/status.test.ts`.
- **Docs:** `docs/TECHNICAL.md`, `docs/PLAYER_GUIDE.md`, `docs/TODO.md`, `HANDOFF.md`.

**Commands** (Git Bash, from the repo root; there is no local Rust):
- Server focused: `docker compose -f docker-compose.test.yml run --rm test cargo test --release <filter> 2>&1 | tail -40`
- Server full: `docker compose -f docker-compose.test.yml run --rm test 2>&1 | grep -E "^test result|FAILED|panicked|^error|^warning|left:|right:"`. The full run regenerates `client/src/generated/*`; commit those files.
- Client: `cd client && npm test && npm run typecheck`

---

### Task 1: Data — kinds, fields, element table, HUD letters

**Files:** `server/src/defs/effects.rs`, `client/src/ui/text.ts` and its existing glyph test.

**Interfaces:**
- Produces:
  - `EffectKind::{Burning, Frozen, Poisoned}`, `COUNT = 8`;
  - `EffectDef.dot: Option<(DamageType, f64)>`, `EffectDef.cancels: &'static [EffectKind]`, `EffectDef.ends_in_water: bool`;
  - `DOT_TICK: f64 = 0.5`, `ELEMENT_SHARE: f64 = 0.5`, `ELEMENTS: [(DamageType, EffectKind); 3]`;
  - `fn element_effects(split: &DamageSplit) -> Vec<EffectKind>`;
  - client glyphs `F`, `I`, `X`.

- [ ] **Step 1: Write the failing tests** (`defs/effects.rs` tests module):
```rust
    #[test]
    fn elemental_effects_match_the_spec() {
        let b = def(EffectKind::Burning);
        assert_eq!((b.dot, b.duration, b.ends_in_water), (Some((Heat, 6.0)), 3.0, true));
        assert_eq!(b.cancels, &[EffectKind::Frozen]);
        assert!(!b.no_move && !b.positive);
        let f = def(EffectKind::Frozen);
        assert_eq!((f.dot, f.duration, f.ends_in_water), (Some((Cold, 4.0)), 2.0, false));
        assert_eq!(f.cancels, &[EffectKind::Burning]);
        assert!(f.no_move && f.no_act && f.no_turn && !f.prone);
        let p = def(EffectKind::Poisoned);
        assert_eq!((p.dot, p.duration), (Some((Poison, 4.0)), 4.0));
        assert!(p.cancels.is_empty() && !p.ends_in_water && !p.no_move);
        for k in [EffectKind::Blind, EffectKind::Sleep, EffectKind::Petrified, EffectKind::Slowed, EffectKind::Accelerated] {
            assert!(def(k).dot.is_none() && def(k).cancels.is_empty() && !def(k).ends_in_water, "{k:?}");
        }
        assert_eq!((EffectKind::Burning as u8, EffectKind::Frozen as u8, EffectKind::Poisoned as u8), (5, 6, 7));
        assert_eq!(EffectKind::COUNT, 8);
    }

    #[test]
    fn a_hit_applies_the_effect_of_each_element_making_up_half_of_it() {
        use crate::defs::damage::DamageSplit;
        assert_eq!(element_effects(&DamageSplit::pure(Heat)), vec![EffectKind::Burning]);
        assert_eq!(element_effects(&DamageSplit::split(&[(Heat, 0.7), (Magical, 0.2)])), vec![EffectKind::Burning], "fireball");
        assert_eq!(element_effects(&DamageSplit::split(&[(Heat, 0.5)])), vec![EffectKind::Burning], "barrel blast: exactly half");
        assert!(element_effects(&DamageSplit::split(&[(Heat, 0.2)])).is_empty(), "claws");
        assert_eq!(element_effects(&DamageSplit::pure(Cold)), vec![EffectKind::Frozen]);
        assert_eq!(element_effects(&DamageSplit::pure(Poison)), vec![EffectKind::Poisoned]);
        assert!(element_effects(&DamageSplit::physical()).is_empty());
        assert_eq!(element_effects(&DamageSplit::split(&[(Heat, 0.5), (Cold, 0.5)])), vec![EffectKind::Burning, EffectKind::Frozen]);
    }
```
  Also extend the existing `flags_and_defaults_match_the_spec` loop if it enumerates `ALL`; it already iterates `EffectKind::ALL`, so it covers the new ids.
- [ ] **Step 2:** Run `... cargo test --release defs::effects`. Expect a compile failure.
- [ ] **Step 3: Implement** in `defs/effects.rs`:
  - **The enum:** add `Burning = 5, Frozen = 6, Poisoned = 7`, then set `COUNT = 8` and append them to `ALL`.
  - **`EffectDef`:** add the fields with doc comments:
    ```rust
    /// Damage over time: its type and damage per second, dealt every `DOT_TICK`
    /// as effect damage. A creature fully resistant to the type never takes the effect.
    pub dot: Option<(DamageType, f64)>,
    /// Applying this effect ends these instead (fire thaws ice, ice puts out fire).
    pub cancels: &'static [EffectKind],
    /// Standing in shallow or deep water ends it.
    pub ends_in_water: bool,
    ```
  - **`NONE`:** add `dot: None, cancels: &[], ends_in_water: false`.
  - **`def`:** add
    ```rust
    EffectKind::Burning => EffectDef { dot: Some((Heat, 6.0)), cancels: &[EffectKind::Frozen], ends_in_water: true, ..NONE },
    EffectKind::Frozen => EffectDef { duration: 2.0, dot: Some((Cold, 4.0)), cancels: &[EffectKind::Burning], no_move: true, no_act: true, no_turn: true, ..NONE },
    EffectKind::Poisoned => EffectDef { duration: 4.0, dot: Some((Poison, 4.0)), ..NONE },
    ```
    If `&[EffectKind::Frozen]` in a `match` arm is rejected as non-`'static` (a slice of a unit enum normally promotes fine), use module consts like the mod lists.
  - **Element table:**
    ```rust
    /// Damage over time ticks this often (s).
    pub const DOT_TICK: f64 = 0.5;
    /// A hit whose share of an element is at least this applies the element's effect.
    pub const ELEMENT_SHARE: f64 = 0.5;
    /// Element → the effect its hits apply. A new elemental effect is one line here.
    pub const ELEMENTS: [(DamageType, EffectKind); 3] = [(Heat, EffectKind::Burning), (Cold, EffectKind::Frozen), (Poison, EffectKind::Poisoned)];

    /// The effects a hit with this split applies (in `ELEMENTS` order).
    pub fn element_effects(split: &super::damage::DamageSplit) -> Vec<EffectKind> {
        ELEMENTS.iter().filter(|(t, _)| split.share(*t) >= ELEMENT_SHARE - 1e-9).map(|&(_, k)| k).collect()
    }
    ```
  - **Client `ui/text.ts`:** add to the glyph map `[EFFECT.Burning]: 'F', [EFFECT.Frozen]: 'I', [EFFECT.Poisoned]: 'X'`, and extend the test that ties names to letters with these three.
- [ ] **Step 4:** Run the full server suite. Expect a pass with no fingerprint change and no warnings. If `dot`, `cancels`, `ends_in_water`, `DOT_TICK` or `ELEMENTS` warn as unused, put a narrow `#[allow(dead_code)] // used by run/effects.rs (Task 2)` on just those items. Then run `cd client && npm test && npm run typecheck`, which should pass (the gallery adds three rows automatically).
- [ ] **Step 5:** Commit `Effects: burning, frozen, poisoned data and element table` (with the regenerated `client/src/generated/defs.ts`).

### Task 2: Runtime — damage over time, immunity, cancels, water, kill credit

**Files:** `server/src/defs/damage.rs`, `server/src/run/effects.rs`, `server/src/run/mod.rs` (`hurt_player`, `hurt_monster`).

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `Damage.from_effect: bool`, `Damage::effect_tick(amount: f64, t: DamageType) -> Damage`;
  - `ActiveEffect.dot_t: f64`;
  - `Run::tick_effects()` (now deals the over-time damage and puts out fire in water);
  - `apply_effect` refuses immune creatures and resolves cancels;
  - the hurt functions skip every effect step for `from_effect` damage and credit burn kills.

- [ ] **Step 1: Write the failing tests** (`run/effects.rs` tests module; reuse its helpers `open`, `walk`, `boss`, and its imports):
```rust
    use crate::defs::damage::{DamageType, Resistances};

    fn hp_loss_over(run: &mut crate::run::Run, steps: usize) -> f64 {
        let hp = run.players[0].hp;
        for _ in 0..steps {
            run.tick_effects();
        }
        hp - run.players[0].hp
    }

    #[test]
    fn burning_runs_out_after_its_duration_without_refreshing_itself() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        open(&mut run);
        run.apply_effect(Creature::Player(0), EffectKind::Burning, None);
        let steps = (3.0 / DT).round() as usize;
        assert!((hp_loss_over(&mut run, steps) - 18.0).abs() < 1e-6, "3 heat every 0.5 s for 3 s");
        assert!(!run.has_effect(Creature::Player(0), EffectKind::Burning), "its own ticks never refresh it");
        assert_eq!(hp_loss_over(&mut run, 60), 0.0);
    }

    #[test]
    fn partial_resistance_reduces_each_tick_and_full_resistance_refuses_the_effect() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        open(&mut run);
        run.players[0].res = Resistances::of(&[(DamageType::Heat, 0.5)]);
        run.apply_effect(Creature::Player(0), EffectKind::Burning, None);
        assert!((hp_loss_over(&mut run, 30) - 1.5).abs() < 1e-6);
        run.remove_effect(Creature::Player(0), EffectKind::Burning);
        run.apply_effect(Creature::Player(0), EffectKind::Petrified, None);
        assert!(!run.apply_effect(Creature::Player(0), EffectKind::Burning, None), "petrified: heat 0.5 + 0.5 = immune");
        run.players[0].res = Resistances::of(&[(DamageType::Poison, 1.0)]);
        assert!(!run.apply_effect(Creature::Player(0), EffectKind::Poisoned, None));
    }

    #[test]
    fn effect_damage_applies_no_effects() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        run.hurt_player(0, Damage::effect_tick(5.0, DamageType::Heat));
        assert!(run.players[0].effects.list().is_empty());
        run.hurt_player(0, Damage::effect_tick(5.0, DamageType::Heat).with_effect(OnHit { kind: EffectKind::Slowed, secs: 1.0, chance: 1.0 }));
        assert!(run.players[0].effects.list().is_empty(), "not even an on_hit");
    }

    #[test]
    fn fire_thaws_ice_and_ice_puts_out_fire() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        let me = Creature::Player(0);
        run.apply_effect(me, EffectKind::Frozen, None);
        assert!(!run.apply_effect(me, EffectKind::Burning, None));
        assert!(!run.has_effect(me, EffectKind::Frozen) && !run.has_effect(me, EffectKind::Burning), "thawed, not burning");
        run.apply_effect(me, EffectKind::Burning, None);
        assert!(!run.apply_effect(me, EffectKind::Frozen, None));
        assert!(!run.has_effect(me, EffectKind::Frozen) && !run.has_effect(me, EffectKind::Burning), "put out, not frozen");
    }

    #[test]
    fn shallow_water_puts_out_fire() {
        use crate::dungeon::Tile;
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        open(&mut run);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        run.set_tile(tx, ty, Tile::ShallowWater);
        run.apply_effect(Creature::Player(0), EffectKind::Burning, None);
        run.apply_effect(Creature::Player(0), EffectKind::Poisoned, None);
        run.tick_effects();
        assert!(!run.has_effect(Creature::Player(0), EffectKind::Burning));
        assert!(run.has_effect(Creature::Player(0), EffectKind::Poisoned), "water only puts out fire");
    }

    #[test]
    fn frozen_roots_and_ticks_cold() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        open(&mut run);
        run.apply_effect(Creature::Player(0), EffectKind::Frozen, None);
        let fx = &run.players[0].effects;
        assert!(fx.no_move() && fx.no_act() && fx.no_turn());
        assert!((hp_loss_over(&mut run, (2.0 / DT).round() as usize) - 8.0).abs() < 1e-6, "2 cold every 0.5 s for 2 s");
    }

    #[test]
    fn a_burn_kill_credits_the_last_hero_who_hit() {
        use crate::defs::enemies::EnemyType;
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        open(&mut run);
        let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, at, None, 1);
        let mi = run.monster_idx(id).unwrap();
        run.hurt_monster(mi, Damage::physical(1.0), false, Some(0));
        run.monsters[mi].hp = 2.0;
        run.apply_effect(Creature::Monster(mi), EffectKind::Burning, None);
        for _ in 0..40 {
            run.tick_effects();
        }
        assert!(!run.monsters[mi].alive);
        assert_eq!(run.players[0].kills, 1);
    }
```
  If `set_tile` takes a different signature, adapt the water test (check `run/mod.rs`; it is used by the boss door).
- [ ] **Step 2:** Run `... cargo test --release run::effects`. Expect a compile failure (no `effect_tick`), then failures.
- [ ] **Step 3: Implement:**
  - **`defs/damage.rs`:**
    - `Damage` gains `/// Dealt by an effect over time: applies no effects (no loops).` `pub from_effect: bool`;
    - `new` sets it to `false`;
    - add
      ```rust
      pub fn effect_tick(amount: f64, t: DamageType) -> Self {
          Damage { from_effect: true, ..Damage::new(amount, DamageSplit::pure(t)) }
      }
      ```
  - **`run/effects.rs`, `ActiveEffect`:** gains `/// Time since the last damage-over-time tick.` `pub dot_t: f64`. `Effects::add` pushes with `dot_t: 0.0`. A refresh keeps `dot_t`.
  - **`run/effects.rs`, `Effects::tick`:** returns the damage to deal too.
    ```rust
    /// Counts down; returns the kinds that ran out (removed) and the
    /// damage-over-time ticks due this step.
    fn tick(&mut self, dt: f64) -> (Vec<EffectKind>, Vec<(DamageType, f64)>) {
        let mut hits = Vec::new();
        for a in &mut self.0 {
            if let Some((t, dps)) = def(a.kind).dot {
                a.dot_t += dt;
                if a.dot_t >= DOT_TICK - 1e-9 {
                    a.dot_t -= DOT_TICK;
                    hits.push((t, dps * DOT_TICK));
                }
            }
            a.left -= dt;
        }
        let gone: Vec<EffectKind> = self.0.iter().filter(|a| a.left <= 1e-9).map(|a| a.kind).collect();
        self.0.retain(|a| a.left > 1e-9);
        (gone, hits)
    }
    ```
    The epsilon makes a 3 s effect expire on step 180 together with its sixth tick. `take_all` is unchanged.
  - **`run/effects.rs`, `tick_effects`:** for each creature (still skipping creatures with no effects first, so runs without effects behave exactly as before):
    - when not `ok`, take all (as today);
    - otherwise, first put out fire: if `self.layout.map.tile_at(pos)` is `Tile::ShallowWater` or `Tile::DeepWater` (compare `as u8`, as `terrain_monster` does), call `remove_effect` for each active kind with `ends_in_water`;
    - then run `tick`, send the off events, and for each due hit call
      ```rust
      match c {
          Creature::Player(i) => self.hurt_player(i, Damage::effect_tick(amount, t)),
          Creature::Monster(i) => { self.hurt_monster(i, Damage::effect_tick(amount, t), false, None); }
      }
      ```
      after the borrow of the effects ends (collect first).
    - A creature that dies from a tick is handled by the hurt functions.
    - Monsters are only removed from `run.monsters` at the end of `step`, so indices stay valid during the loop.
  - **`run/effects.rs`, `apply_effect`:** after the response check and before adding:
    ```rust
    if let Some((t, _)) = def(kind).dot {
        let res = match c {
            Creature::Player(i) => self.players.get(i).map(|p| p.effects.res(p.res).get(t)),
            Creature::Monster(i) => self.monsters.get(i).map(|m| m.effects.res(m.res).get(t)),
        };
        if res.is_some_and(|r| r >= 1.0) {
            return false; // immune to its damage: no effect at all
        }
    }
    let cancelled: Vec<EffectKind> = def(kind).cancels.iter().copied().filter(|&k| self.has_effect(c, k)).collect();
    if !cancelled.is_empty() {
        for k in cancelled {
            self.remove_effect(c, k);
        }
        return false; // fire thaws ice / ice puts out fire
    }
    ```
    Keep the dead and sinking check (`ok`) before the cancels, so the dead change nothing.
  - **`run/mod.rs` `hurt_player`:** gate the final effect block on `!dmg.from_effect`:
    ```rust
    if self.players[pi].alive && !dmg.from_effect {
        if v > 0.0 { self.damage_wakes(..) }
        if let Some(h) = dmg.on_hit { self.hit_effect(..) }
    }
    ```
    Also gate the pure-effect early return: `if let (0.0, Some(h), false) = (dmg.amount, dmg.on_hit, dmg.from_effect)`.
  - **`run/mod.rs` `hurt_monster`:**
    - the same gating;
    - **kill credit:** where `src_player` gets the kill, add the effect case:
      ```rust
      if self.monsters[mi].hp <= 0.0 {
          if let Some(pi) = src_player {
              self.players[pi].kills += 1;
          } else if dmg.from_effect {
              if let Some(pi) = self.monsters[mi].last_hit_by.filter(|&pi| pi < self.players.len()) {
                  self.players[pi].kills += 1;
              }
          }
          self.kill_monster(mi);
      }
      ```
- [ ] **Step 4:** Run the full server suite. Expect a pass, no warnings, no fingerprint change (nothing applies these effects yet).
- [ ] **Step 5:** Commit `Effects: damage over time, immunity by resistance, fire and ice cancel, water`.

### Task 3: The element rule (hits and lava apply effects)

**Files:** `server/src/run/effects.rs` (`element_hit`), `server/src/run/mod.rs` (hurt functions, fingerprint comment).

**Interfaces:**
- Consumes: Task 1 `element_effects`, Task 2 `apply_effect` and `from_effect`.
- Produces: `Run::element_hit(c: Creature, dmg: &Damage)`.

- [ ] **Step 1: Write the failing tests** (`run/effects.rs` tests):
```rust
    #[test]
    fn mostly_heat_hits_and_lava_set_heroes_on_fire() {
        use crate::defs::damage::{kind_split, DamageType};
        use crate::defs::kinds::EntityKind;
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        open(&mut run);
        run.hurt_player(0, Damage::new(4.0, DamageSplit::split(&[(DamageType::Heat, 0.2)])));
        assert!(!run.has_effect(Creature::Player(0), EffectKind::Burning), "a claw with a fifth of heat does not burn");
        run.hurt_player(0, Damage::new(4.0, kind_split(EntityKind::Fireball)));
        assert!(run.has_effect(Creature::Player(0), EffectKind::Burning));
        run.remove_effect(Creature::Player(0), EffectKind::Burning);
        // Lava: one tick burns.
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        run.set_tile(tx, ty, crate::dungeon::Tile::Lava);
        run.step();
        assert!(run.has_effect(Creature::Player(0), EffectKind::Burning));
    }

    #[test]
    fn heat_immune_creatures_are_never_set_on_fire() {
        use crate::defs::damage::DamageType;
        use crate::defs::enemies::EnemyType;
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        open(&mut run);
        let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
        let id = run.spawn_enemy(EnemyType::Imp, at, None, 1);
        let mi = run.monster_idx(id).unwrap();
        let hp = run.monsters[mi].hp;
        run.hurt_monster(mi, Damage::new(10.0, DamageSplit::pure(DamageType::Heat)), false, None);
        assert_eq!(run.monsters[mi].hp, hp);
        assert!(!run.has_effect(Creature::Monster(mi), EffectKind::Burning));
        let id = run.spawn_enemy(EnemyType::SkeletonWarrior, at, None, 1);
        let si = run.monster_idx(id).unwrap();
        run.hurt_monster(si, Damage::new(10.0, DamageSplit::pure(DamageType::Poison)), false, None);
        assert!(!run.has_effect(Creature::Monster(si), EffectKind::Poisoned), "undead are never poisoned");
    }

    #[test]
    fn an_immune_lich_is_not_set_on_fire() {
        use crate::defs::damage::{kind_split, DamageType};
        use crate::defs::kinds::EntityKind;
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        let bi = boss(&run);
        assert!(!run.hurt_monster(bi, Damage::new(10.0, kind_split(EntityKind::Fireball)), false, Some(0)), "disciples alive: refused");
        assert!(!run.has_effect(Creature::Monster(bi), EffectKind::Burning));
        let _ = DamageType::Heat;
    }
```
  Drop the trailing `let _ = DamageType::Heat;` if `DamageType` is unused in that test.
- [ ] **Step 2:** Run the tests. Expect them to fail (nothing burns yet).
- [ ] **Step 3: Implement** in `run/effects.rs`:
```rust
    /// After a normal hit: each element making up at least half of it applies its effect.
    pub fn element_hit(&mut self, c: Creature, dmg: &crate::defs::damage::Damage) {
        if dmg.from_effect {
            return;
        }
        for k in crate::defs::effects::element_effects(&dmg.split) {
            self.apply_effect(c, k, None);
        }
    }
```
  In `hurt_player` and `hurt_monster`, call `self.element_hit(Creature::…, &dmg)` inside the gated "still alive and not effect damage" block, **before** the `on_hit` call. Also call it on the heal path (`raw < 0.0`)? **No:** a creature healed by a hit resists it by more than 100 %, so immunity would refuse the effect anyway. Leave that path untouched. Lava ticks are plain `Damage::new(.., pure(Heat))`, so they burn through this rule with no lava-specific code.
- [ ] **Step 4:** Run the full server suite.
  - `simulation_is_unchanged_after_waking_the_boss` may now fail on the **demon and/or dragon** values only.
  - Confirm the cause (their heat hits now burn the heroes; burn ticks change hero HP), re-record those values, and extend the test's comment: `// 2026-10-15, elemental effects: heat hits (demon, dragon) now set heroes on fire; the burn damage changes their hp.`
  - If the **lich** value changes, find out whether a barrel blast hit a hero (print the events in a scratch run). Re-record only with that cause confirmed and named in the comment; otherwise it is a bug.
  - `level_setup_is_unchanged` must not change.
- [ ] **Step 5:** Commit `Effects: heat, cold and poison hits apply their effects (lava burns)`.

### Task 4: Client visuals (burning, frozen, poisoned)

**Files:** `client/src/game/status.ts`, `client/src/game/status.test.ts`, `client/src/game/anim/EntityView.ts`.

**Interfaces:**
- Consumes: `EFFECT.Burning/Frozen/Poisoned` (generated), `has(bits, k)`, the existing `StatusView` (`update(bits, dt)`, `StatusAnchor`, pooled particles via `Effects`), and the petrified frame-freeze in `EntityView`.
- Produces: the visuals. Exported pure helpers for tests:
  - `snowflakeAlpha(age: number, life: number): number` (0 → fade in → 1 → hold → fade out → 0);
  - `flameSpots(bodyW: number, bodyH: number, n: number, seed: number): Array<[number, number]>` (points on the body, inside its bounds).

- [ ] **Step 1: Write the failing tests** (`status.test.ts`):
```ts
import { flameSpots, snowflakeAlpha } from './status';

describe('elemental visuals', () => {
  it('snowflakes shimmer in, hold, and out', () => {
    expect(snowflakeAlpha(0, 1)).toBe(0);
    expect(snowflakeAlpha(0.5, 1)).toBe(1);
    expect(snowflakeAlpha(1, 1)).toBe(0);
    expect(snowflakeAlpha(0.1, 1)).toBeGreaterThan(0);
    expect(snowflakeAlpha(0.1, 1)).toBeLessThan(1);
  });

  it('flames sit on the body', () => {
    for (const [x, y] of flameSpots(12, 20, 3, 7)) {
      expect(Math.abs(x)).toBeLessThanOrEqual(6);
      expect(y).toBeLessThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(-20);
    }
    expect(flameSpots(12, 20, 3, 7)).toHaveLength(3);
  });
});
```
- [ ] **Step 2:** Run `npm test`. Expect a failure.
- [ ] **Step 3: Implement:**
  - **`snowflakeAlpha(age, life)`:** a trapezoid with 25 % fade-in, 50 % hold and 25 % fade-out, clamped to 0 outside `[0, life]`.
  - **`flameSpots(w, h, n, seed)`:** `n` deterministic points (a small hash of `seed` and the index) with `x` in `[-w/2, w/2]` and `y` in `[-h, 0]` (feet at 0, upwards negative), biased to the lower two thirds of the body.
  - **`StatusView`:**
    - **Burning:**
      - 3 small flame sprites (a drawn texture made once with `Graphics` and `generateTexture`: a 3×5 px orange-to-yellow teardrop, like the shadow texture in `EntityView`) placed at `flameSpots` on the figure (anchor body size);
      - each flickers in scale (0.8–1.2) and alpha (0.7–1) at about 10 Hz with its own phase, and occasionally re-seeds its spot;
      - depth just in front of the figure (`DEPTH.entityBase + y + 1`), below the fog;
      - no tint on the body.
    - **Frozen:**
      - a soft blue haze: one ellipse image (drawn once, about `0x9fd8ff` at alpha 0.35, slightly larger than the figure's body), behind or around the figure at the figure's depth − 0.5, breathing in alpha (0.25–0.4);
      - plus up to 6 tiny snowflakes (1–2 px white or very light-blue images or `+`-shaped 3 px textures);
      - each snowflake spawns at a random spot within about 10 px of the body, lives 0.6–1.0 s with `snowflakeAlpha`, then respawns elsewhere;
      - pool the images (no per-frame allocation);
      - depth like the flames.
    - **Poisoned:**
      - a green tint pulse on the body (`0x9be37a` blended in and out at about 1.5 Hz; it gives way to hurt and wind-up tints like the slowed tint does);
      - small rising green bubbles (1–2 px circles, `0x7fd650`), about one every 0.35 s, rising 8 px and fading over 0.8 s, through the existing pooled particles in `Effects` if a fitting particle exists, else pooled images.
    - Every mark hides when its effect ends, and when the figure is dead (the existing `update(0)` path).
  - **`EntityView`:**
    - freeze the animation frame for **Frozen** too: extend the petrified frame-freeze condition to `stone || frozen`, without the greyscale, which stays petrified only;
    - frozen figures skip the attack moves and the shiver, like stone;
    - if the weapon follows the aim, keep the own hero's weapon frozen too (`noTurn` is already handled in `GameScene` for Frozen through `EFFECTS.no_turn`).
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Then check visually:
  - `cd client && npm run dev` (port 5173), then `cd tools/e2e && node gallery-shots.mjs http://localhost:5173/ shots idle`. The gallery rows for Burning, Frozen and Poisoned appear automatically.
  - Read the PNGs: flames sit on the bodies, the haze and snowflakes are around frozen figures, the green tint and bubbles show, and the tool reports no browser errors.
  - Keep 2–3 representative screenshots uncommitted in `tools/e2e/shots` and name them in the report. Stop the dev server.
- [ ] **Step 5:** Commit `Effects: burning flames, frozen haze and snowflakes, poison bubbles`.

### Task 5: Docs

- [ ] **`docs/TECHNICAL.md`:** in "Status effects", add damage over time (`dot`, `DOT_TICK`), the element table (`ELEMENTS`, `ELEMENT_SHARE`), the rule that effect damage (`Damage.from_effect`) applies no effects, immunity by resistance, the cancels, water, and burn-kill credit. In "How to add an effect", add "an elemental effect is one line in `ELEMENTS` plus its `dot`". Add the HUD letters F, I and X.
- [ ] **`docs/PLAYER_GUIDE.md`:**
  - Burning: from fire hits and lava; water puts it out; demons and the dragon are immune.
  - Frozen: rooted, cannot act; fire thaws it.
  - Poisoned: undead are immune.
  - The status-effect table (F, I, X).
- [ ] **`docs/TODO.md`:** in "Effect system follow-ups", add sources for Frozen and Poisoned (none yet), tuning the new values, and a note that petrified creatures with half heat resistance become immune to Burning.
- [ ] **`HANDOFF.md`:** the elemental effects are built on `feature/effects`, final review pending, not merged.
- [ ] Run all suites once more, then commit `Docs: elemental effects`.
