# Damage Types, World Objects and Exploding Barrels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typed damage with resistances from entity types, a general world-object system (chests moved into it), and exploding barrels as its first real use: lit by any hit, chain reactions, pushed with E, enemies blown into chasms, ranged enemies shooting barrels next to heroes.

**Architecture:**
- **Typed damage.** `defs/damage.rs` holds the value types: `DamageType`, `DamageSplit`, `Damage`, `Resistances`, and `resolve` as the only damage formula. `defs/entity_types.rs` maps entity types plus per-entity adjustments to a `Profile` (resistances and melee split), which is stored on every `Player`, `Monster` and `WorldObject` at spawn.
- **World objects.** `run/objects.rs` keeps a `Vec<WorldObject>` on `Run` with per-kind state (`ObjState::Chest`, `ObjState::Barrel`), one damage entry point (`hurt_object`) and one use entry point (`use_object`).
- **Solid objects.** These are squares in `collision::move_box`, mirrored in the TypeScript predictor and pinned by the shared fixtures.

**Tech Stack:** Rust (tokio, axum, ts-rs, rand_chacha, rmp-serde); TypeScript client (Phaser 3.90, vitest).

**Spec:** `docs/superpowers/specs/2026-10-14-damage-types-and-objects-design.md`

## Global Constraints

- **Server tests** run in Docker: `MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test`. Append `cargo test --release <filter>` to run a subset. Afterwards run `docker compose -f docker-compose.test.yml down`. `cargo test` regenerates `client/src/generated/*`; commit those files.
- **Client checks:** `cd client && npm run build && npm test`.
- **Commits.** Every message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Work on branch `feature/barrels` (it already exists and holds the spec). Commit after each task. Merge only when the user asks.
- **Numbers.** Every number is a first guess for the balancing pass. Use exactly these values:
  - **Entity types:**
    - human: no resistances, physical melee
    - undead: physical 10, heat −10, poison 100
    - monster: none
    - demon: magical 20, heat 100, cold −50; melee 80 % physical / 20 % heat
    - dragon: magical 50, physical 10
    - object: physical 50, poison 100
  - **Adjustments:**
    - lich: physical +40, magical +40
    - dragon: heat +100, melee 20 % heat
    - demon boss: magical +20
  - **Barrels:**
    - radius 6 (a 12 px square)
    - fuse 0.3 s
    - blast radius 40 px, 30 damage (50 % heat, 50 % physical), knock 40 px
    - push 48 px, use reach 6 px
- **Resistance floor:** −100 %, i.e. double damage at most. Above 100 % the hit heals.
- **Every object resists poison 100 %.** This comes from the `object` entity type.
- **Desktop only;** no phone layouts.
- **Art** comes only from the 0x72 pack or CC0 sets, with the licence file next to it. Ask the user before importing (Task 17).
- **Known deviations from the spec,** for good reasons:
  - The barrel explosion is `Boom` **k 7**, because k 6 is already the lich nova.
  - The damage-number colours live in the client (`game/damage.ts`). The server exports only the type ids.
  - The barrel an enemy aims at is stored in its `Windup` as `Some(Target::Object(id))`. Perception overwrites `ai.target` every tick, so it can't be kept there.
  - The dagger stays monsters-only. The crossbow bolt hits barrels.
  - There is no separate `run/damage.rs`; `resolve` lives in `defs/damage.rs`.
  - An object's kind is its `EntityKind`; there is no separate `ObjKind`.
  - Chests stay non-solid, as today.

## Review Focus

1. **Each barrel of a chain explodes exactly once.** It must not explode twice and must not re-light. Ten barrels in a row give exactly ten `Boom k 7` events. Pinned in Task 10.
2. **A figure that overlaps a solid can still walk out of it,** in every direction, and is never trapped. Pinned in Task 8 (Rust) and the shared fixtures.
3. **Barrels never cut off part of the dungeon.** Every safe tile reachable before is still reachable when barrel tiles count as walls, over many seeds. Pinned in Task 15.
4. **A chain lit by an enemy shot** (no igniter), or by a hero who has since left, still explodes. It gives no kill credit and does not panic. Pinned in Task 10.
5. **An enemy blown into a chasm** dies once and gives XP once. A boss caught in a blast is never pushed. Pinned in Task 11.

---

## Stage A: damage model and entity types

### Task 1: Damage value types and `resolve`

**Files:**
- Create: `server/src/defs/damage.rs`
- Modify: `server/src/defs/mod.rs` (add `pub mod damage;`)

**Interfaces:**
- Produces:
  - `DamageType` (`Physical=0, Cold=1, Heat=2, Magical=3, Poison=4`), with `COUNT`, `ALL` and `name()`.
  - `DamageSplit` (Copy), with `physical()`, `pure(t)`, `split(&[(t, share)])`, `share(t)` and `main_type()`.
  - `Resistances` (Copy), with `NONE`, `of(&[(t, frac)])`, `get(t)` and `plus(o)`.
  - `Damage { amount, split }` (Copy), with `new`, `physical` and `scaled(k)`.
  - `resolve(&Damage, &Resistances) -> f64`.
  - `kind_split(EntityKind) -> DamageSplit`.

- [ ] **Step 1: Write the failing tests** at the bottom of the new `server/src/defs/damage.rs` (with the module doc only, so it fails to compile):

```rust
#[cfg(test)]
mod tests {
    use super::DamageType::*;
    use super::*;

    #[test]
    fn a_partial_split_is_filled_up_with_physical() {
        let s = DamageSplit::split(&[(Heat, 0.3)]);
        assert!((s.share(Heat) - 0.3).abs() < 1e-12);
        assert!((s.share(Physical) - 0.7).abs() < 1e-12);
        let f = DamageSplit::split(&[(Heat, 0.7), (Magical, 0.2)]);
        assert!((f.share(Physical) - 0.1).abs() < 1e-12, "the fireball's rest is physical");
        assert_eq!(DamageSplit::physical().share(Physical), 1.0);
        assert_eq!(DamageSplit::pure(Cold).share(Cold), 1.0);
    }

    #[test]
    fn resolve_reduces_each_part_by_its_own_resistance() {
        let none = Resistances::NONE;
        assert_eq!(resolve(&Damage::physical(12.0), &none), 12.0, "no entry: full damage");
        let d = Damage::new(10.0, DamageSplit::split(&[(Heat, 0.5)]));
        let res = Resistances::of(&[(Heat, 1.0)]);
        assert!((resolve(&d, &res) - 5.0).abs() < 1e-9, "immune to heat: only the physical half");
        let half = Resistances::of(&[(Physical, 0.5)]);
        assert!((resolve(&Damage::physical(10.0), &half) - 5.0).abs() < 1e-9);
    }

    #[test]
    fn full_resistance_is_immunity_and_more_heals() {
        let d = Damage::new(10.0, DamageSplit::pure(Poison));
        assert_eq!(resolve(&d, &Resistances::of(&[(Poison, 1.0)])), 0.0);
        assert!((resolve(&d, &Resistances::of(&[(Poison, 1.5)])) + 5.0).abs() < 1e-9, "150 %: a 10-point part heals 5");
    }

    #[test]
    fn a_weakness_adds_damage_but_at_most_doubles_it() {
        let d = Damage::new(10.0, DamageSplit::pure(Cold));
        assert!((resolve(&d, &Resistances::of(&[(Cold, -0.5)])) - 15.0).abs() < 1e-9);
        assert!((resolve(&d, &Resistances::of(&[(Cold, -3.0)])) - 20.0).abs() < 1e-9, "floored at -100 %");
    }

    #[test]
    fn resistances_add_up_and_main_type_is_the_largest_share() {
        let r = Resistances::of(&[(Physical, 0.1)]).plus(Resistances::of(&[(Physical, 0.4), (Magical, 0.4)]));
        assert!((r.get(Physical) - 0.5).abs() < 1e-12);
        assert_eq!(DamageSplit::split(&[(Heat, 0.7), (Magical, 0.3)]).main_type(), Heat);
        assert_eq!(DamageSplit::split(&[(Heat, 0.2)]).main_type(), Physical);
    }

    #[test]
    fn attacks_by_kind_have_their_types() {
        use crate::defs::kinds::EntityKind as K;
        assert_eq!(kind_split(K::Arrow), DamageSplit::physical());
        assert_eq!(kind_split(K::Bolt), DamageSplit::physical());
        assert_eq!(kind_split(K::Missile), DamageSplit::pure(Magical));
        assert_eq!(kind_split(K::GloomBolt), DamageSplit::pure(Magical));
        assert!((kind_split(K::Fireball).share(Heat) - 0.7).abs() < 1e-12);
        assert!((kind_split(K::FireBolt).share(Magical) - 0.3).abs() < 1e-12);
        assert_eq!(kind_split(K::FirePatch), DamageSplit::pure(Heat));
        assert_eq!(kind_split(K::DragonFireball), DamageSplit::pure(Heat));
    }
}
```

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Add `pub mod damage;` to `server/src/defs/mod.rs`.
  - Run: `MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test cargo test --release defs::damage`
  - Expected: compile errors (`DamageSplit` etc. not found).

- [ ] **Step 3: Implement** above the tests in `server/src/defs/damage.rs`:

```rust
//! Damage types, typed damage and resistances. `resolve` is the only damage
//! formula: every hit on a hero, monster or object goes through it.

use super::kinds::EntityKind;

/// Open set: a new type is a new variant, and `COUNT` and `ALL` grow with it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum DamageType {
    Physical = 0,
    Cold = 1,
    Heat = 2,
    Magical = 3,
    Poison = 4,
}

impl DamageType {
    pub const COUNT: usize = 5;
    pub const ALL: [DamageType; DamageType::COUNT] = [DamageType::Physical, DamageType::Cold, DamageType::Heat, DamageType::Magical, DamageType::Poison];
    pub fn name(self) -> &'static str {
        match self {
            DamageType::Physical => "Physical",
            DamageType::Cold => "Cold",
            DamageType::Heat => "Heat",
            DamageType::Magical => "Magical",
            DamageType::Poison => "Poison",
        }
    }
}

/// How one hit splits by type. The shares always sum to 1.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DamageSplit([f64; DamageType::COUNT]);

impl DamageSplit {
    pub fn physical() -> Self {
        Self::pure(DamageType::Physical)
    }
    pub fn pure(t: DamageType) -> Self {
        let mut s = [0.0; DamageType::COUNT];
        s[t as usize] = 1.0;
        DamageSplit(s)
    }
    /// The listed shares; whatever is left up to 100 % is physical.
    pub fn split(parts: &[(DamageType, f64)]) -> Self {
        let mut s = [0.0; DamageType::COUNT];
        for &(t, share) in parts {
            s[t as usize] += share;
        }
        let listed: f64 = s.iter().sum();
        debug_assert!(listed <= 1.0 + 1e-9, "damage split over 100 %: {parts:?}");
        s[DamageType::Physical as usize] += (1.0 - listed).max(0.0);
        DamageSplit(s)
    }
    pub fn share(&self, t: DamageType) -> f64 {
        self.0[t as usize]
    }
    /// The type with the largest share (ties: the first in `ALL`); the damage number's colour.
    pub fn main_type(&self) -> DamageType {
        let mut best = DamageType::Physical;
        for t in DamageType::ALL {
            if self.share(t) > self.share(best) {
                best = t;
            }
        }
        best
    }
}

/// Resistance per type as a fraction (0.5 = 50 %). A missing type is 0. A
/// negative value is a weakness, floored at `MIN_RESISTANCE` in `resolve`;
/// above 1 the hit heals.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Resistances([f64; DamageType::COUNT]);

pub const MIN_RESISTANCE: f64 = -1.0;

impl Resistances {
    pub const NONE: Resistances = Resistances([0.0; DamageType::COUNT]);
    pub fn of(parts: &[(DamageType, f64)]) -> Self {
        let mut r = [0.0; DamageType::COUNT];
        for &(t, v) in parts {
            r[t as usize] += v;
        }
        Resistances(r)
    }
    pub fn get(&self, t: DamageType) -> f64 {
        self.0[t as usize]
    }
    pub fn plus(self, o: Resistances) -> Self {
        let mut r = self.0;
        for (a, b) in r.iter_mut().zip(o.0) {
            *a += b;
        }
        Resistances(r)
    }
}

/// One hit: an amount and how it splits by type.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Damage {
    pub amount: f64,
    pub split: DamageSplit,
}

impl Damage {
    pub fn new(amount: f64, split: DamageSplit) -> Self {
        Damage { amount, split }
    }
    pub fn physical(amount: f64) -> Self {
        Damage::new(amount, DamageSplit::physical())
    }
    pub fn scaled(self, k: f64) -> Self {
        Damage { amount: self.amount * k, ..self }
    }
}

/// Σ part × (1 − resistance) over the types. Negative = the hit heals.
pub fn resolve(d: &Damage, r: &Resistances) -> f64 {
    DamageType::ALL.iter().map(|&t| d.amount * d.split.share(t) * (1.0 - r.get(t).max(MIN_RESISTANCE))).sum()
}

/// The split of a shot, spell effect or hazard by its kind. Shots default to
/// physical, magic to magical.
pub fn kind_split(kind: EntityKind) -> DamageSplit {
    use DamageType::*;
    use EntityKind as K;
    match kind {
        K::Missile | K::ShadowBolt | K::GloomBolt => DamageSplit::pure(Magical),
        K::Fireball => DamageSplit::split(&[(Heat, 0.7), (Magical, 0.2)]),
        K::FireBolt | K::FireOrb => DamageSplit::split(&[(Heat, 0.7), (Magical, 0.3)]),
        K::FrostBolt => DamageSplit::pure(Cold),
        K::DragonFireball | K::FireBreath | K::FirePatch => DamageSplit::pure(Heat),
        _ => DamageSplit::physical(),
    }
}
```

- [ ] **Step 4: Run the tests and confirm they pass.**
  - Run: `MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test cargo test --release defs::damage`
  - Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add server/src/defs/damage.rs server/src/defs/mod.rs
git commit -m "Damage types, typed damage, resistances and resolve

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Entity types and profiles

**Files:**
- Create: `server/src/defs/entity_types.rs`
- Modify:
  - `server/src/defs/mod.rs` (`pub mod entity_types;`)
  - `server/src/defs/enemies.rs`
  - `server/src/defs/bosses.rs`
  - `server/src/defs/classes.rs`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `EntityType { Human, Undead, Monster, Demon, Dragon, Object }`
  - `Adjust { res: Resistances, melee: Option<DamageSplit> }`, with `Adjust::NONE`
  - `Profile { res: Resistances, melee: DamageSplit }` (Copy)
  - `profile(types: &[EntityType], adj: Adjust) -> Profile`
  - `enemies::profile(EnemyType) -> Profile`
  - `bosses::profile(BossId) -> Profile`
  - `classes::profile(ClassId) -> Profile`

- [ ] **Step 1: Write the failing tests** in the new `server/src/defs/entity_types.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::damage::DamageType::*;
    use crate::defs::enemies::{self, EnemyType};
    use crate::defs::{bosses, classes};
    use crate::protocol::{BossId, ClassId};

    #[test]
    fn adjustments_add_to_the_entity_types() {
        let lich = bosses::profile(BossId::Lich);
        assert!((lich.res.get(Physical) - 0.5).abs() < 1e-12, "undead 10 + lich 40");
        assert!((lich.res.get(Magical) - 0.4).abs() < 1e-12);
        assert!((lich.res.get(Heat) + 0.1).abs() < 1e-12, "undead weakness to heat");
        assert_eq!(lich.res.get(Poison), 1.0);
        let dragon = bosses::profile(BossId::Dragon);
        assert_eq!(dragon.res.get(Heat), 1.0);
        assert!((dragon.melee.share(Heat) - 0.2).abs() < 1e-12, "the dragon's claws burn");
        let demon = bosses::profile(BossId::Demon);
        assert!((demon.res.get(Magical) - 0.4).abs() < 1e-12);
        assert!((demon.res.get(Cold) + 0.5).abs() < 1e-12);
    }

    #[test]
    fn every_enemy_has_its_entity_type() {
        let p = enemies::profile;
        assert!((p(EnemyType::SkeletonWarrior).res.get(Physical) - 0.1).abs() < 1e-12);
        assert_eq!(p(EnemyType::RaisedArcher).res.get(Poison), 1.0);
        assert_eq!(p(EnemyType::Imp).res.get(Heat), 1.0);
        assert!((p(EnemyType::Chort).melee.share(Heat) - 0.2).abs() < 1e-12, "demon claws burn");
        assert_eq!(p(EnemyType::Ogre), profile(&[EntityType::Monster], Adjust::NONE));
        assert_eq!(p(EnemyType::Necromancer), profile(&[EntityType::Human], Adjust::NONE));
        assert_eq!(p(EnemyType::Disciple).res, Resistances::NONE);
        for c in ClassId::ALL {
            assert_eq!(classes::profile(c), profile(&[EntityType::Human], Adjust::NONE));
        }
        let obj = profile(&[EntityType::Object], Adjust::NONE);
        assert_eq!((obj.res.get(Physical), obj.res.get(Poison)), (0.5, 1.0));
    }
}
```

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Add `pub mod entity_types;` to `defs/mod.rs`.
  - Run: `... cargo test --release entity_types`
  - Expected: compile errors.

- [ ] **Step 3: Implement** in `server/src/defs/entity_types.rs` (above the tests):

```rust
//! Entity types: the base forms of things in the game (templates). Each has
//! resistances and a melee damage split; an entity can have several, plus
//! its own adjustments (`Adjust`). Balancing edits only this data.

use super::damage::{DamageSplit, DamageType::*, Resistances};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityType {
    Human,
    Undead,
    Monster,
    Demon,
    Dragon,
    /// Inanimate objects (chests, barrels): every one resists poison fully.
    Object,
}

pub struct TypeDef {
    pub res: Resistances,
    pub melee: DamageSplit,
}

pub fn type_def(t: EntityType) -> TypeDef {
    match t {
        EntityType::Human | EntityType::Monster => TypeDef { res: Resistances::NONE, melee: DamageSplit::physical() },
        EntityType::Undead => TypeDef { res: Resistances::of(&[(Physical, 0.1), (Heat, -0.1), (Poison, 1.0)]), melee: DamageSplit::physical() },
        EntityType::Demon => TypeDef { res: Resistances::of(&[(Magical, 0.2), (Heat, 1.0), (Cold, -0.5)]), melee: DamageSplit::split(&[(Heat, 0.2)]) },
        EntityType::Dragon => TypeDef { res: Resistances::of(&[(Magical, 0.5), (Physical, 0.1)]), melee: DamageSplit::physical() },
        EntityType::Object => TypeDef { res: Resistances::of(&[(Physical, 0.5), (Poison, 1.0)]), melee: DamageSplit::physical() },
    }
}

/// One entity's own changes on top of its entity types.
#[derive(Debug, Clone, Copy)]
pub struct Adjust {
    pub res: Resistances,
    /// Replaces the melee split of the entity types.
    pub melee: Option<DamageSplit>,
}

impl Adjust {
    pub const NONE: Adjust = Adjust { res: Resistances::NONE, melee: None };
}

/// What an entity takes and deals: stored on it at spawn.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Profile {
    pub res: Resistances,
    pub melee: DamageSplit,
}

/// Resistances of all its types plus the adjustment; the adjustment's melee
/// split, else the first type's.
pub fn profile(types: &[EntityType], adj: Adjust) -> Profile {
    let res = types.iter().fold(Resistances::NONE, |r, &t| r.plus(type_def(t).res)).plus(adj.res);
    let melee = adj.melee.unwrap_or_else(|| types.first().map_or(DamageSplit::physical(), |&t| type_def(t).melee));
    Profile { res, melee }
}
```

Append to `server/src/defs/enemies.rs`:

```rust
/// Entity type of each enemy (see `entity_types`).
pub fn profile(t: EnemyType) -> Profile {
    use EnemyType::*;
    let ty = match t {
        Necromancer | Summoner | Disciple => EntityType::Human,
        SkeletonWarrior | SkeletonArcher | RaisedSkeleton | RaisedArcher => EntityType::Undead,
        GoblinArcher | OrcWarrior | OrcArcher | Mimic | Ogre => EntityType::Monster,
        Imp | Chort | SummonedImp => EntityType::Demon,
    };
    entity_types::profile(&[ty], Adjust::NONE)
}
```
with `use super::entity_types::{self, Adjust, EntityType, Profile};` at the top.

Append to `server/src/defs/bosses.rs`:

```rust
/// Entity type plus each boss's own adjustments.
pub fn profile(id: BossId) -> Profile {
    use super::damage::{DamageSplit, DamageType::*, Resistances};
    let (ty, adj) = match id {
        BossId::Demon => (EntityType::Demon, Adjust { res: Resistances::of(&[(Magical, 0.2)]), melee: None }),
        BossId::Lich => (EntityType::Undead, Adjust { res: Resistances::of(&[(Physical, 0.4), (Magical, 0.4)]), melee: None }),
        BossId::Dragon => (EntityType::Dragon, Adjust { res: Resistances::of(&[(Heat, 1.0)]), melee: Some(DamageSplit::split(&[(Heat, 0.2)])) }),
    };
    entity_types::profile(&[ty], adj)
}
```
with `use super::entity_types::{self, Adjust, EntityType, Profile};`.

Append to `server/src/defs/classes.rs`:

```rust
/// Every hero is human; armour items will add resistances later.
pub fn profile(_class: ClassId) -> Profile {
    entity_types::profile(&[EntityType::Human], Adjust::NONE)
}
```
with `use super::entity_types::{self, Adjust, EntityType, Profile};`.

- [ ] **Step 4: Run the tests and confirm they pass.**
  - Run: `... cargo test --release entity_types`
  - Expected: 2 passed.

- [ ] **Step 5: Commit** with the message "Entity types with resistances, melee splits and per-entity adjustments".

### Task 3: Migrate every damage call to `Damage`, with neutral values

The migration must not change the simulation yet. Every call site passes `Damage::physical(x)`, and `res`/`melee` are set to `NONE`/physical. The fingerprint tests in `run/mod.rs` therefore keep their numbers, which proves the migration changed nothing.

**Files:**
- Modify:
  - `server/src/run/entities.rs`: `Player` and `Monster` gain `res` and `melee`; `Projectile.damage` and `Hazard.damage` become `Damage`.
  - `server/src/run/mod.rs`:
    - the `Player` construction in `Run::new`
    - `spawn_enemy`
    - `hurt_player`
    - `hurt_monster`
    - `tick_hazards`
    - `spawn_hazard`
    - lava in `terrain_player`
  - `server/src/run/levels/boss.rs`: the `Monster` construction.
  - `server/src/run/abilities.rs`:
    - `try_use`
    - `melee_arc`
    - `dash_contact`
    - `spawn_player_projectile`
    - `spawn_monster_projectile`
    - `impact`
    - `explode`
    - tests
  - `server/src/run/ai.rs`: `perform_attack`.
  - `server/src/run/bosses/{demon,dragon,lich}.rs`: every `hurt_player` and `spawn_hazard` call.
- Test: the existing fingerprint tests in `server/src/run/mod.rs`.

**Interfaces:**
- Consumes: `Damage`, `DamageSplit`, `Resistances` (Task 1).
- Produces:
  - `Run::hurt_player(&mut self, pi: usize, dmg: Damage)`
  - `Run::hurt_monster(&mut self, mi: usize, dmg: Damage, crit: bool, src_player: Option<usize>) -> bool`
  - `explode(run, pos, r, damage: Damage, from_player, src, k, crit, knock)`
  - `Run::spawn_hazard(kind, pos, radius, life, damage: f64)`. It still takes the amount and builds the `Damage` inside.
  - Fields `Player.res`, `Player.melee`, `Monster.res`, `Monster.melee`.
  - `Projectile.damage: Damage`, `Hazard.damage: Damage`.
  - `spawn_player_projectile` and `spawn_monster_projectile` keep their `damage: f64` parameter and build the `Damage` inside, so their callers don't change.

- [ ] **Step 1: Confirm the guard tests pass before the change.**
  - Run: `... cargo test --release level_setup_is_unchanged simulation_is_unchanged`
  - Expected: both pass. These are the guards for this task.

- [ ] **Step 2: Add the fields.**
  - In `entities.rs`:
    - Add `use crate::defs::damage::{Damage, DamageSplit, Resistances};`.
    - To `Player`, add:

```rust
    /// Resistances (entity types plus adjustments) and the split of its melee hits.
    pub res: Resistances,
    pub melee: DamageSplit,
```
    - Add the same two fields to `Monster`.
    - Change `Projectile.damage` and `Hazard.damage` to `pub damage: Damage,`.
  - In `Run::new`, set `res: Resistances::NONE, melee: DamageSplit::physical(),` on the player.
  - In `spawn_enemy` and `levels/boss.rs::spawn`, set the same neutral values on the monster.

- [ ] **Step 3: Change `hurt_player`.** Replace its signature and first lines:

```rust
    pub fn hurt_player(&mut self, pi: usize, dmg: Damage) {
        let p = &mut self.players[pi];
        if !p.alive {
            return;
        }
        let dmg = resolve(&dmg, &p.res) * (1.0 - p.mods.armor);
```
  Keep the rest unchanged. Add `use crate::defs::damage::{resolve, Damage, DamageSplit, DamageType, Resistances};` at the top of `run/mod.rs`.

- [ ] **Step 4: Change `hurt_monster`.**

```rust
    pub fn hurt_monster(&mut self, mi: usize, dmg: Damage, crit: bool, src_player: Option<usize>) -> bool {
        if !self.monsters[mi].alive {
            return false;
        }
        let pos = self.monsters[mi].pos;
        if self.monsters[mi].is_boss && !Level::on_boss_hurt(self, mi) {
            return false;
        }
        let dmg = resolve(&dmg, &self.monsters[mi].res);
        let m = &mut self.monsters[mi];
        m.hp -= dmg;
```
  Keep the rest unchanged.

- [ ] **Step 5: Change the hazards and lava.**
  - `spawn_hazard` stores `damage: Damage::physical(damage)`.
  - `tick_hazards` reads `let (pos, r, dmg) = (h.pos, h.radius, h.damage);`, then calls `self.hurt_player(pi, dmg)`.
  - Lava: `self.hurt_player(pi, Damage::physical(dungeon::LAVA_DAMAGE));`.

- [ ] **Step 6: Change `abilities.rs`.**
  - `use crate::defs::damage::Damage;`
  - Dagger: `run.hurt_monster(mi, Damage::new(ab::DAGGER_DAMAGE * mult, run.players[pi].melee), crit, Some(pi));`
  - In `melee_arc`, keep the parameter `damage: f64` and build `let dmg = Damage::new(damage, run.players[pi].melee);` before the hit loop. Then call `run.hurt_monster(mi, dmg, crit, Some(pi))`.
  - In `dash_contact`: `let dmg = Damage::new(ab::def(AbilityId::Dash).damage * run.players[pi].mods.damage, run.players[pi].melee);`
  - In both `spawn_*_projectile` functions, store `damage: Damage::physical(damage),`. (Task 4 switches this to `kind_split(kind)`.)
  - In `impact`, the tuple's `damage` is now a `Damage`. Pass it on unchanged.
  - Change `explode` to take `damage: Damage` and pass it unchanged to `hurt_monster` and `hurt_player`.
  - In the tests, wrap every literal amount passed to `explode` or `hurt_monster` in `Damage::physical(..)`. Example: `explode(&mut run, at, 30.0, Damage::physical(5.0), false, None, 4, false, 20.0);`.

- [ ] **Step 7: Change `ai.rs` `perform_attack`.**
  - Melee: `let dmg = Damage::new(damage, run.monsters[mi].melee); ... run.hurt_player(pi, dmg);`
  - Slam: build the same `dmg` once before its loop.

- [ ] **Step 8: Change the bosses.**
  - Demon cleave and swoop: `run.hurt_player(pi, Damage::new(25.0, run.monsters[bi].melee));` (30.0 for the swoop).
  - Dragon: wrap the smash, tail, claw and bite amounts the same way, with `run.monsters[bi].melee`. The breath becomes `Damage::physical(6.0)` for now.
  - Lich nova: `Damage::physical(LICH_NOVA_DAMAGE)`.
  - Lich tests: `run.hurt_monster(bi, Damage::physical(100.0), false, Some(0))`.
  - Every file needs `use crate::defs::damage::Damage;`.

- [ ] **Step 9: Build and run all server tests.**
  - Run: `MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test`
  - Expected: everything passes, **including `level_setup_is_unchanged` and `simulation_is_unchanged_after_waking_the_boss` with their old numbers.** Fix any compile error the same way: a literal amount becomes `Damage::physical(x)`, and a melee hit uses the attacker's `.melee`.

- [ ] **Step 10: Commit** with the message "Every damage call passes typed Damage (neutral values, simulation unchanged)".

### Task 4: Turn on the types: profiles at spawn, splits per attack

**Files:**
- Modify:
  - `server/src/run/mod.rs`: `Run::new` players, `spawn_enemy`, `spawn_hazard`, lava
  - `server/src/run/levels/boss.rs`
  - `server/src/run/abilities.rs`: both `spawn_*_projectile`
  - `server/src/run/bosses/dragon.rs` (breath)
  - `server/src/run/bosses/lich.rs` (nova)
- Test: `server/src/run/abilities.rs` tests; the fingerprint numbers in `server/src/run/mod.rs`.

**Interfaces:**
- Consumes: `enemies::profile`, `bosses::profile`, `classes::profile` (Task 2); `kind_split` (Task 1).

- [ ] **Step 1: Write the failing tests** in the `abilities.rs` test module:

```rust
    #[test]
    fn a_fireball_only_singes_a_demon_and_burns_a_skeleton() {
        use crate::defs::damage::kind_split;
        let blast = |t: EnemyType| {
            let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
            run.monsters.retain(|m| m.is_boss || m.owner.is_some());
            let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
            let id = run.spawn_enemy(t, at, None, 1);
            let mi = run.monster_idx(id).unwrap();
            run.monsters[mi].hp = 1000.0;
            explode(&mut run, at, 20.0, Damage::new(10.0, kind_split(EntityKind::Fireball)), true, Some(0), 0, false, 0.0);
            1000.0 - run.monsters[run.monster_idx(id).unwrap()].hp
        };
        // 70 % heat (demons: immune), 20 % magical (demons: 20 %), 10 % physical.
        assert!((blast(EnemyType::Imp) - (2.0 * 0.8 + 1.0)).abs() < 1e-9);
        // Skeletons: heat -10 %, physical 10 %.
        assert!((blast(EnemyType::SkeletonWarrior) - (7.0 * 1.1 + 2.0 + 1.0 * 0.9)).abs() < 1e-9);
        assert!((blast(EnemyType::OrcWarrior) - 10.0).abs() < 1e-9, "no resistances");
    }

    #[test]
    fn shots_carry_the_type_of_their_kind() {
        let mut run = test_run(&[ClassId::Wizard], BossId::Demon);
        try_use(&mut run, 0, AbilityId::MagicMissile, 1, true);
        assert_eq!(run.projectiles[0].damage.split, crate::defs::damage::DamageSplit::pure(crate::defs::damage::DamageType::Magical));
    }
```

- [ ] **Step 2: Run them and confirm they fail.**
  - Run: `... cargo test --release singes shots_carry`
  - Expected: FAIL (all damage is still neutral).

- [ ] **Step 3: Implement.**
  - **Run::new players:** `let prof = classes::profile(m.class);` then `res: prof.res, melee: prof.melee,`.
  - **spawn_enemy:** `let prof = enemies::profile(t);` then `res: prof.res, melee: prof.melee,`.
  - **levels/boss.rs spawn:** `let prof = boss_defs::profile(boss_id);` then `res: prof.res, melee: prof.melee,`.
  - **spawn_player_projectile / spawn_monster_projectile:** `damage: Damage::new(damage, kind_split(kind)),` (import `crate::defs::damage::kind_split`).
  - **spawn_hazard:** `damage: Damage::new(damage, kind_split(kind)),`.
  - **Lava:** `Damage::new(dungeon::LAVA_DAMAGE, DamageSplit::pure(DamageType::Heat))`.
  - **Dragon breath:** `Damage::new(6.0, DamageSplit::pure(DamageType::Heat))`.
  - **Lich nova:** `Damage::new(LICH_NOVA_DAMAGE, DamageSplit::pure(DamageType::Magical))`.

- [ ] **Step 4: Run the new tests and confirm they pass.** Run: `... cargo test --release singes shots_carry`.

- [ ] **Step 5: Update the simulation fingerprint.**
  - Run the full suite. `simulation_is_unchanged_after_waking_the_boss` now fails: monsters with resistances take less damage, and the dragon's claws and the demon's fire orbs are typed. `level_setup_is_unchanged` must still pass, because nothing at setup changed.
  - Replace the expected vector in `simulation_is_unchanged_after_waking_the_boss` with the values the failure message prints.
  - Add a comment above it: `// Updated with typed damage (2026-10-14): resistances change the fight.`
  - Run again. Expected: all pass.

- [ ] **Step 6: Commit** with the message "Typed damage on: entity type resistances and per-attack splits".

### Task 5: Damage numbers: type, "immune", and healing above 100 %

**Files:**
- Modify:
  - `server/src/protocol.rs` (`Ev::Dmg`)
  - `server/src/wire.rs` (`EvW::Dmg`, `ev_w`, `sample_snapshots`)
  - `server/src/run/mod.rs` (`hurt_player`, `hurt_monster`)
  - `server/src/export.rs` (`DMG_TYPE` export)
  - `client/src/wire.ts` (`DmgW`)
  - `client/src/game/GameScene.ts` (`onEvent` `'Dmg'`)
- Create:
  - `client/src/game/damage.ts` (colours)
  - `client/src/game/damage.test.ts`
- Test: `run/mod.rs` tests, `wire.rs` tests, `client/src/wire.test.ts` (fixtures), `damage.test.ts`.

**Interfaces:**
- Produces:
  - `Ev::Dmg { x, y, v, crit, p, ty: u8, imm: bool }`
  - `EvW::Dmg(u8, u32, u32, f32, bool, bool, u8, bool)`
  - In TS, `DMG_TYPE` in `generated/defs.ts`, and `dmgColor(ty: number, toHero: boolean): string` in `game/damage.ts`.

- [ ] **Step 1: Write the failing server tests** in `run/mod.rs` tests:

```rust
    #[test]
    fn a_resisted_hit_is_shown_as_immune_and_over_100_percent_heals() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let at = run.players[0].pos() + Vec2::new(30.0, 0.0);
        let id = run.spawn_enemy(EnemyType::SkeletonWarrior, at, None, 1);
        let mi = run.monster_idx(id).unwrap();
        let hp = run.monsters[mi].hp;
        run.events.clear();
        run.hurt_monster(mi, Damage::new(10.0, DamageSplit::pure(DamageType::Poison)), false, Some(0));
        assert_eq!(run.monsters[mi].hp, hp, "undead resist poison fully");
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Dmg { imm: true, .. })));
        // Above 100 %: the hit heals.
        run.monsters[mi].hp = hp - 20.0;
        run.monsters[mi].res = Resistances::of(&[(DamageType::Poison, 1.5)]);
        run.events.clear();
        run.hurt_monster(mi, Damage::new(10.0, DamageSplit::pure(DamageType::Poison)), false, Some(0));
        assert!((run.monsters[mi].hp - (hp - 15.0)).abs() < 1e-9);
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Heal { .. })));
        // The number carries the main type.
        run.events.clear();
        run.hurt_monster(mi, Damage::new(10.0, DamageSplit::split(&[(DamageType::Heat, 0.7)])), false, Some(0));
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Dmg { ty, imm: false, .. } if *ty == DamageType::Heat as u8)));
    }
```

- [ ] **Step 2: Run it and confirm it fails.** Run: `... cargo test --release resisted_hit`. Expected: compile errors (no field `imm`).

- [ ] **Step 3: Implement on the server.**
  - **`protocol.rs`:** change `Dmg` to

```rust
    /// Damage number. `p` = the victim is a player. `ty`: the hit's main
    /// `DamageType` (colour); `imm`: fully resisted (shown as "immune").
    Dmg { x: f32, y: f32, v: f32, crit: bool, p: bool, ty: u8, imm: bool },
```

  - **`wire.rs`:**
    - `Dmg(u8, u32, u32, f32, bool, bool, u8, bool),`
    - `Ev::Dmg { x, y, v, crit, p, ty, imm } => EvW::Dmg(0, q(*x), q(*y), *v, *crit, *p, *ty, *imm),`
    - In `sample_snapshots`: `Ev::Dmg { x: 10.3, y: 20.7, v: 12.5, crit: true, p: false, ty: 2, imm: false },`

  - **`hurt_player`:**

```rust
    pub fn hurt_player(&mut self, pi: usize, dmg: Damage) {
        if !self.players[pi].alive {
            return;
        }
        let raw = resolve(&dmg, &self.players[pi].res);
        if raw < 0.0 {
            self.heal_player(pi, -raw);
            return;
        }
        let p = &mut self.players[pi];
        let v = raw * (1.0 - p.mods.armor);
        let imm = raw == 0.0 && dmg.amount > 0.0;
        // Debug mode: hits still show, but nothing is subtracted.
        if !p.debug {
            p.hp -= v;
        }
        if !imm {
            p.hurt_t = 0.15;
        }
        let pos = p.pos();
        let ty = dmg.split.main_type() as u8;
        self.event(Ev::Dmg { x: pos.x as f32, y: pos.y as f32 - 10.0, v: v as f32, crit: false, p: true, ty, imm }, Some(pos));
```
  Keep the death check that follows.

  - **`hurt_monster`:** after the boss check:

```rust
        let raw = resolve(&dmg, &self.monsters[mi].res);
        let ty = dmg.split.main_type() as u8;
        let seen_by = src_player.is_none().then_some(pos);
        if raw < 0.0 {
            let m = &mut self.monsters[mi];
            let healed = (-raw).min(m.max_hp - m.hp);
            m.hp += healed;
            self.event(Ev::Heal { x: pos.x as f32, y: pos.y as f32 - 10.0, v: healed as f32 }, seen_by);
            return true;
        }
        let imm = raw == 0.0 && dmg.amount > 0.0;
        let m = &mut self.monsters[mi];
        m.hp -= raw;
        if !imm {
            m.hurt_t = 0.15;
        }
        let applied = raw.min(m.hp + raw);
        self.event(Ev::Dmg { x: pos.x as f32, y: pos.y as f32 - 10.0, v: raw as f32, crit, p: false, ty, imm }, seen_by);
```
  Keep the rest (credit, search, mimic, kill) unchanged.

  - **`export.rs` `export_defs`:**
    - Add `let dmg_types: serde_json::Map<_, _> = crate::defs::damage::DamageType::ALL.iter().map(|t| (t.name().to_string(), json!(*t as u8))).collect();`
    - Add the line `export const DMG_TYPE = {} as const;\n` to the format string, with `p(&json!(dmg_types))`.

- [ ] **Step 4: Run the server tests and confirm they pass.**
  - Run: `MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test`
  - Expected: all pass, and the fixtures plus `generated/Ev.ts`, `EvW.ts` and `defs.ts` are regenerated.

- [ ] **Step 5: Write the failing client test** `client/src/game/damage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DMG_TYPE } from '../generated/defs';
import { dmgColor } from './damage';

describe('damage colours', () => {
  it('keeps physical white on enemies and red on heroes, colours other types', () => {
    expect(dmgColor(DMG_TYPE.Physical, false)).toBe('#ffffff');
    expect(dmgColor(DMG_TYPE.Physical, true)).toBe('#ff5050');
    expect(dmgColor(DMG_TYPE.Heat, false)).toBe('#ff9030');
    expect(dmgColor(DMG_TYPE.Cold, true)).toBe('#80d0ff');
  });
});
```
  Run: `cd client && npx vitest run src/game/damage.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 6: Implement the client.**
  - Create `client/src/game/damage.ts`:

```ts
// Damage number colours per damage type (`DMG_TYPE`, server/src/defs/damage.rs).
// Physical keeps the old look: white on enemies, red on heroes.
import { DMG_TYPE } from '../generated/defs';

const COLORS: Record<number, string> = {
  [DMG_TYPE.Cold]: '#80d0ff',
  [DMG_TYPE.Heat]: '#ff9030',
  [DMG_TYPE.Magical]: '#c080ff',
  [DMG_TYPE.Poison]: '#80e040',
};

export function dmgColor(ty: number, toHero: boolean): string {
  if (ty === DMG_TYPE.Physical) return toHero ? '#ff5050' : '#ffffff';
  return COLORS[ty] ?? '#ffffff';
}
```

  - In `client/src/wire.ts`:
    - `type DmgW = [number, number, number, number, boolean, boolean, number, boolean];`
    - The `EV.Dmg` case becomes: `const [, x, y, v, crit, p, ty, imm] = e as DmgW; return { t: 'Dmg', x: pos(x), y: pos(y), v, crit, p, ty, imm };`

  - In `GameScene.ts` `onEvent`, the `'Dmg'` case becomes:

```ts
      case 'Dmg':
        if (ev.imm) this.fx.text(ev.x, ev.y, 'immune', '#a0a0a0');
        else if (ev.crit) this.fx.text(ev.x, ev.y, `CRIT ${Math.round(ev.v)}`, '#ffe040', true);
        else this.fx.text(ev.x, ev.y, `${Math.round(ev.v)}`, dmgColor(ev.ty, ev.p));
        if (!ev.imm) this.fx.hitSpark(ev.x, ev.y + 4, ev.p ? 0xff4040 : 0xffffff);
        if (ev.p && !ev.imm && Math.hypot(ev.x - this.pred.state.x, ev.y + 10 - this.pred.state.y) < 4) this.cameras.main.shake(90, 0.003);
        break;
```
  with `import { dmgColor } from './damage';`.

- [ ] **Step 7: Run the client checks.**
  - Run: `cd client && npm run build && npm test`
  - Expected: the build is clean and all tests pass, including `wire.test.ts` with the new fixture.

- [ ] **Step 8: Commit** with the message "Damage numbers: type colour, immune text, healing above 100 %".

---

## Stage B: the object system

### Task 6: `WorldObject`, with chests moved into it

**Files:**
- Create:
  - `server/src/defs/objects.rs`
  - `server/src/run/objects.rs`
- Modify:
  - `server/src/defs/mod.rs` and `server/src/run/mod.rs` (module declarations)
  - `server/src/run/entities.rs` (remove `Chest`)
  - `server/src/run/mod.rs`:
    - `Run.chests` becomes `Run.objects`
    - `Run::new`
    - `touch_chests`
    - `step` (retain)
    - fingerprint
    - the chest test
  - `server/src/run/visibility.rs` (the chest loop)

**Interfaces:**
- Consumes: `Profile` and `profile` (Task 2), `Damage` and `resolve` (Task 1).
- Produces:
  - `pub struct WorldObject { pub id: u32, pub kind: EntityKind, pub pos: Vec2, pub radius: f64, pub solid: bool, pub res: Resistances, pub state: ObjState, pub gone: bool }`
  - `pub enum ObjState { Chest { opened: Option<f64> } }`. Task 10 adds `Barrel`.
  - `Run::spawn_object(&mut self, kind: EntityKind, pos: Vec2, state: ObjState) -> u32`
  - `objects::hurt_object(run: &mut Run, oi: usize, dmg: Damage, by: Option<u32>)`, where `by` is the player **id**.
  - `objects::snap(o: &WorldObject, time: f64) -> EntSnap`
  - `defs::objects::{ObjDef, def(kind) -> ObjDef, profile(kind) -> Profile}`

- [ ] **Step 1: Rewrite the chest test** in `run/mod.rs` so it uses the new API (it fails to compile until the code exists):

```rust
    #[test]
    fn touching_a_chest_opens_it_once_and_pays_the_party() {
        let mut run = test_run(&[ClassId::Wizard, ClassId::Paladin], BossId::Demon);
        run.monsters.clear(); // keep the test about the chest
        let pos = run.layout.player_spawns[0] + Vec2::new(40.0, 0.0);
        let id = run.spawn_object(EntityKind::Chest, pos, objects::ObjState::Chest { opened: None });
        stand_at(&mut run, pos);
        let o = run.objects.iter().find(|o| o.id == id).unwrap();
        assert!(matches!(o.state, objects::ObjState::Chest { opened: Some(_) }));
        let coins = run.players[0].coins;
        assert!(progression::CHEST_COINS.contains(&coins));
        assert_eq!(run.players[1].coins, coins, "the whole party gets the coins");
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Coins { .. })));
        stand_at(&mut run, pos);
        assert_eq!(run.players[0].coins, coins, "a chest pays only once");
    }

    #[test]
    fn every_object_resists_poison_fully() {
        let p = crate::defs::objects::profile(EntityKind::Chest);
        assert_eq!(p.res.get(DamageType::Poison), 1.0);
        assert_eq!(p.res.get(DamageType::Physical), 0.5);
    }
```

- [ ] **Step 2: Run them and confirm they fail.** Run: `... cargo test --release chest resists_poison`. Expected: compile errors.

- [ ] **Step 3: Implement.**

  `server/src/defs/objects.rs`:

```rust
//! World object definitions (see `run/objects.rs`).

use super::entity_types::{self, Adjust, EntityType, Profile};
use super::kinds::EntityKind;

#[derive(Debug, Clone, Copy)]
pub struct ObjDef {
    /// Footprint: a circle for touching and shots, a square of this half size when solid.
    pub radius: f64,
    /// Blocks movement and shots.
    pub solid: bool,
}

pub fn def(kind: EntityKind) -> ObjDef {
    match kind {
        EntityKind::Chest => ObjDef { radius: 6.0, solid: false },
        _ => panic!("{kind:?} is not an object"),
    }
}

/// Every object is of entity type `Object` (so it resists poison fully).
pub fn profile(_kind: EntityKind) -> Profile {
    entity_types::profile(&[EntityType::Object], Adjust::NONE)
}
```

  `server/src/run/objects.rs`:

```rust
//! World objects: things on the map with state that are neither heroes nor
//! monsters (chests, barrels; later torches, levers, the carriage). One list,
//! one snapshot encoding, one damage path (`hurt_object`) and one use path.

use super::Run;
use crate::defs::damage::{resolve, Damage, Resistances};
use crate::defs::kinds::EntityKind;
use crate::math::Vec2;
use crate::protocol::EntSnap;

pub struct WorldObject {
    pub id: u32,
    pub kind: EntityKind,
    pub pos: Vec2,
    pub radius: f64,
    pub solid: bool,
    pub res: Resistances,
    pub state: ObjState,
    /// Removed at the end of the step (exploded, fallen, sunk).
    pub gone: bool,
}

pub enum ObjState {
    Chest { opened: Option<f64> },
}

impl Run {
    pub fn spawn_object(&mut self, kind: EntityKind, pos: Vec2, state: ObjState) -> u32 {
        let d = crate::defs::objects::def(kind);
        let id = self.alloc_id();
        let res = crate::defs::objects::profile(kind).res;
        self.objects.push(WorldObject { id, kind, pos, radius: d.radius, solid: d.solid, res, state, gone: false });
        id
    }
}

/// A hit on an object; `by` is the hero's entity id. What it does depends on the kind.
pub fn hurt_object(run: &mut Run, oi: usize, dmg: Damage, _by: Option<u32>) {
    let o = &run.objects[oi];
    if o.gone || resolve(&dmg, &o.res) <= 0.0 {
        return;
    }
    match o.state {
        ObjState::Chest { .. } => {}
    }
}

fn ms_since(time: f64, t: f64) -> u16 {
    ((time - t) * 1000.0).clamp(0.0, 65535.0) as u16
}

/// Snapshot entry. Chests: anim 1 once opened, with the time since.
pub fn snap(o: &WorldObject, time: f64) -> EntSnap {
    let (anim, since) = match o.state {
        ObjState::Chest { opened } => opened.map_or((0, 0), |t| (1, ms_since(time, t))),
    };
    EntSnap(o.id, o.kind as u8, o.pos.x as f32, o.pos.y as f32, 255, anim, 0.0, since, 0, 0)
}
```

  In `run/mod.rs`:
  - Add `pub mod objects;`.
  - Replace the field `pub chests: Vec<Chest>` with `pub objects: Vec<objects::WorldObject>`, and the initialiser with `objects: Vec::new()`.
  - In `Run::new`, the non-mimic branch becomes `run.spawn_object(EntityKind::Chest, c.pos, objects::ObjState::Chest { opened: None });`. It allocates one id at the same point as before.
  - In `step`, after `self.hazards.retain(..)`, add `self.objects.retain(|o| !o.gone);`.
  - `touch_chests` loops over the objects:

```rust
        for oi in 0..self.objects.len() {
            let o = &self.objects[oi];
            let objects::ObjState::Chest { opened: None } = o.state else { continue };
            if !near(o.pos) {
                continue;
            }
            let pos = o.pos;
            self.objects[oi].state = objects::ObjState::Chest { opened: Some(self.time) };
            let coins = self.rng.gen_range(progression::CHEST_COINS);
            self.give_coins(pos, coins);
        }
```

  - In the fingerprint, replace the chest loop with the same hashing: `for o in &run.objects { eat(o.id as u64); eat(o.pos.x.to_bits() as u64); }`.
  - Delete the `Chest` struct from `entities.rs`.

  In `visibility.rs`, replace the chest loop:

```rust
        for o in &run.objects {
            if o.gone || !visible(&fov, o.pos, 0.0) {
                continue;
            }
            ents.push(super::objects::snap(o, run.time));
        }
```

  Add `pub mod objects;` to `defs/mod.rs`. `run/mod.rs` needs `EntityKind` imported (it already is).

- [ ] **Step 4: Run all server tests.**
  - Run: `MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test`
  - Expected: all pass, **with both fingerprint tests unchanged** (chests got the same ids and positions).

- [ ] **Step 5: Commit** with the message "World objects: one list with per-kind state; chests moved in".

### Task 7: AI targets can be players, objects or places

**Files:**
- Modify:
  - `server/src/run/entities.rs` (`Target`, `Ai.target`, `Windup`)
  - `server/src/run/ai.rs`
  - `server/src/run/abilities.rs` (Hide)
  - `server/src/run/mod.rs` (`hurt_monster` reads `is_none()`, which is unchanged)

**Interfaces:**
- Produces:
  - `#[derive(Debug, Clone, Copy, PartialEq)] pub enum Target { Player(u32), Object(u32), Place(Vec2) }`
  - `Ai.target: Option<Target>`
  - `Windup { t, aim, alt, at: Option<Target> }`

- [ ] **Step 1: Write the failing test** in the `ai.rs` tests:

```rust
    #[test]
    fn a_seen_hero_becomes_the_target_and_hiding_drops_it() {
        let mut run = test_run(&[ClassId::Assassin], BossId::Lich);
        open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, run.players[0].pos() + Vec2::new(60.0, 0.0), None, 1);
        let mi = run.monster_idx(id).unwrap();
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert_eq!(run.monsters[mi].ai.target, Some(crate::run::entities::Target::Player(run.players[0].id)));
        crate::run::abilities::try_use(&mut run, 0, crate::defs::abilities::AbilityId::Hide, 1, false);
        assert_eq!(run.monsters[mi].ai.target, None);
    }
```
  Run: `... cargo test --release seen_hero_becomes`. Expected: compile error (no `Target`).

- [ ] **Step 2: Implement.**
  - In `entities.rs`:

```rust
/// What a monster is after: a hero, an object (a barrel to shoot; later a
/// torch or the carriage) or a place.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Target {
    Player(u32),
    Object(u32),
    #[allow(dead_code)] // for torches and the carriage
    Place(Vec2),
}
```
    - Change `Ai.target` to `pub target: Option<Target>`.
    - Add `pub at: Option<Target>` to `Windup`. It names what the attack aims at when that is not the seen hero.
  - In `ai.rs`:
    - `ai.target = Some(Target::Player(pid));`
    - Every `Windup { t, aim, alt }` literal gets `at: None`. Where a windup is re-created (`Windup { t, aim: w.aim, alt: w.alt }`), use `Windup { t, ..w }`.
  - In `abilities.rs` (Hide): `if m.ai.target == Some(Target::Player(pid)) {`.

- [ ] **Step 3: Run all server tests.** Expected: all pass, fingerprints unchanged.

- [ ] **Step 4: Commit** with the message "AI targets: players, objects or places".

---

## Stage C: barrels and what they need

### Task 8: Solid squares in shared collision (Rust, TypeScript and fixtures)

**Files:**
- Modify:
  - `server/src/collision.rs` (`Solid`, `move_box`, `step_move`)
  - `server/src/run/ai.rs` (`move_toward`, `separate_monsters`)
  - `server/src/run/mod.rs` (`Run::solids`, `apply_input`)
  - `server/src/export.rs` (fixtures with solids)
  - `client/src/sim/collision.ts`
  - `client/src/sim/sim.test.ts`
  - `client/src/game/world.ts` (`Predictor.solids`)
- Test: `collision.rs` tests, `sim.test.ts`.

**Interfaces:**
- Produces:
  - Rust: `#[derive(Debug, Clone, Copy, PartialEq)] pub struct Solid { pub x: f64, pub y: f64, pub half: f64 }`
  - `move_box(map, x, y, dx, dy, r, mover, solids: &[Solid])`
  - `step_move(map, s, mx, my, speed, dash_speed, r, dt, solids: &[Solid])`
  - `Run::solids(&self, except: Option<u32>) -> Vec<Solid>`. It lists solid, not-gone objects; Task 12 also leaves out sinking barrels.
  - TS: `interface Solid { x: number; y: number; half: number }`
  - `moveBox(map, x, y, dx, dy, r, mover, solids: Solid[] = [])`
  - `stepMove(map, s, mx, my, speed, dashSpeed, r, dt, solids: Solid[] = [])`
  - `Predictor.solids: Solid[]`

- [ ] **Step 1: Write the failing Rust tests** in `collision.rs` tests:

```rust
    #[test]
    fn a_solid_stops_a_figure_like_a_wall() {
        let map = open_map();
        let s = [Solid { x: 80.0, y: 40.0, half: 6.0 }];
        // Walking east into it: stops with the box touching its west edge.
        let (x, _) = move_box(&map, 60.0, 40.0, 10.0, 0.0, 5.0, Mover::Hero, &s);
        assert!((x - (80.0 - 6.0 - 5.0)).abs() < 1e-9);
        // Passing above it: no contact.
        let (x, _) = move_box(&map, 60.0, 20.0, 10.0, 0.0, 5.0, Mover::Hero, &s);
        assert_eq!(x, 70.0);
        // Moving south into it from above.
        let (_, y) = move_box(&map, 80.0, 20.0, 0.0, 12.0, 5.0, Mover::Hero, &s);
        assert!((y - (40.0 - 6.0 - 5.0)).abs() < 1e-9);
    }

    #[test]
    fn a_figure_overlapping_a_solid_can_walk_out_any_way() {
        let map = open_map();
        let s = [Solid { x: 80.0, y: 40.0, half: 6.0 }];
        for (dx, dy) in [(1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0)] {
            let (x, y) = move_box(&map, 78.0, 41.0, dx, dy, 5.0, Mover::Hero, &s);
            assert_eq!((x, y), (78.0 + dx, 41.0 + dy), "stuck moving {dx},{dy}");
        }
    }
```
  If no `open_map()` helper exists in the module, add one: a 12×8 map of floor inside walls, built like `fixture_map` (a `Map::new` plus a `set` loop).

  Run: `... cargo test --release collision::tests`. Expected: compile errors.

- [ ] **Step 2: Implement in Rust** (`collision.rs`):

```rust
/// A solid object's footprint: a square (centre, half size) that blocks
/// movement like a wall tile. A figure already overlapping one is never held
/// by it, so it can always walk out. Mirrored in `client/src/sim/collision.ts`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Solid {
    pub x: f64,
    pub y: f64,
    pub half: f64,
}
```
  In `move_box` (new last parameter `solids: &[Solid]`), insert this after the x-axis tile check (still inside `if dx != 0.0`):

```rust
        for s in solids {
            if y + r <= s.y - s.half || y - r >= s.y + s.half {
                continue;
            }
            if dx > 0.0 {
                let edge = s.x - s.half;
                if x + r <= edge + EPS && nx + r > edge {
                    nx = edge - r;
                }
            } else {
                let edge = s.x + s.half;
                if x - r >= edge - EPS && nx - r < edge {
                    nx = edge + r;
                }
            }
        }
```
  Insert the y-axis equivalent after the y tile check, inside `if dy != 0.0`. It uses `nx` for the horizontal overlap test and `y`/`ny` for the edges:

```rust
        for s in solids {
            if nx + r <= s.x - s.half || nx - r >= s.x + s.half {
                continue;
            }
            if dy > 0.0 {
                let edge = s.y - s.half;
                if y + r <= edge + EPS && ny + r > edge {
                    ny = edge - r;
                }
            } else {
                let edge = s.y + s.half;
                if y - r >= edge - EPS && ny - r < edge {
                    ny = edge + r;
                }
            }
        }
```
  - `step_move` gets `solids: &[Solid]` as its last parameter and passes it to `move_box`.
  - Other callers:
    - `ai::move_toward`: add `let solids = run.solids(None);` before the borrow, then pass `&solids`.
    - `separate_monsters`: compute `let solids = run.solids(None);` once at the top.
    - `apply_input`: add `let solids = self.solids(None);` before `let map = &self.layout.map;` and pass `&solids`.
    - Any other `move_box` call that `cargo build` reports: pass `&[]` if it moves no figure through objects, otherwise `&run.solids(None)`.
  - In `run/objects.rs`:

```rust
impl Run {
    /// Footprints of the solid objects, except `except` (an object's own id).
    pub fn solids(&self, except: Option<u32>) -> Vec<crate::collision::Solid> {
        self.objects
            .iter()
            .filter(|o| o.solid && !o.gone && Some(o.id) != except)
            .map(|o| crate::collision::Solid { x: o.pos.x, y: o.pos.y, half: o.radius })
            .collect()
    }
}
```

- [ ] **Step 3: Add solids to the fixtures.**
  - In `export.rs`, add

```rust
/// Barrels in the fixture room (floor tiles), so the port is checked against solids too.
fn fixture_solids() -> Vec<Solid> {
    vec![Solid { x: 4.5 * TILE, y: 8.5 * TILE, half: 6.0 }, Solid { x: 8.5 * TILE, y: 12.5 * TILE, half: 6.0 }, Solid { x: 13.5 * TILE, y: 4.5 * TILE, half: 6.0 }]
}
```
  - Pass `&solids` to `step_move` in `export_fixtures`.
  - Add `"solids": solids.iter().map(|s| json!([s.x, s.y, s.half])).collect::<Vec<_>>()` to the doc.
  - Check that the three positions are floor in `fixture_map`: (4,8), (8,12) and (13,4) are floor there.

- [ ] **Step 4: Port it to TypeScript** in `client/src/sim/collision.ts`:
  - `export interface Solid { x: number; y: number; half: number }`
  - `moveBox(..., mover: Mover, solids: readonly Solid[] = [])`
  - Mirror both loops operation for operation (the same `<=`, `>=`, `+ EPS`, `- EPS`).
  - `stepMove(..., dt: number, solids: readonly Solid[] = [])` passes `solids` on.
  - In `sim.test.ts`, build `const solids = fixtures.solids.map(([x, y, half]) => ({ x, y, half }));` and pass it as the last argument to `stepMove`.
  - In `world.ts` `Predictor`:
    - Add `solids: Solid[] = [];`.
    - Pass `this.solids` to both `stepMove` calls (in `step` and in `reconcile`).

- [ ] **Step 5: Run both sides.**
  - Server: `MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test` (all pass; fixtures regenerated).
  - Client: `cd client && npm run build && npm test` (the collision port matches step for step).

- [ ] **Step 6: Commit** with the message "Solid squares in shared collision (server, predictor, fixtures)".

### Task 9: The barrel object, lit by any hit

**Files:**
- Modify:
  - `server/src/defs/kinds.rs` (`Barrel = 81`, `ALL`)
  - `server/src/defs/objects.rs` (barrel def and constants)
  - `server/src/run/objects.rs` (`ObjState::Barrel`, `Barrel`, lighting, `snap`)
  - `server/src/export.rs` (consts)

**Interfaces:**
- Produces:
  - `EntityKind::Barrel = 81`
  - The constants `BARREL_RADIUS`, `BARREL_FUSE`, `BARREL_BLAST_R`, `BARREL_BLAST_DAMAGE`, `BARREL_BLAST_KNOCK`, `BARREL_PUSH` and `USE_REACH`
  - `barrel_blast() -> Damage`
  - `pub struct Barrel { pub fuse: Option<f64>, pub lit_at: f64, pub igniter: Option<u32>, pub vel: Vec2, pub sinking: Option<(f64, Sink, f64)> }` with `Barrel::new()`
  - `ObjState::Barrel(Barrel)`
  - Snapshot `anim`: 0 at rest, 1 lit (`anim_ms` = time since lit), 2 falling, 3 sinking (`anim_ms` = time since it started)

- [ ] **Step 1: Write the failing tests** in `run/objects.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::damage::{DamageSplit, DamageType};
    use crate::defs::objects::*;
    use crate::protocol::{BossId, ClassId};
    use crate::run::tests::test_run;

    pub fn barrel_at(run: &mut Run, off: Vec2) -> (u32, usize) {
        let pos = run.players[0].pos() + off;
        let id = run.spawn_object(EntityKind::Barrel, pos, ObjState::Barrel(Barrel::new()));
        (id, run.objects.len() - 1)
    }

    fn lit(run: &Run, oi: usize) -> bool {
        matches!(&run.objects[oi].state, ObjState::Barrel(b) if b.fuse.is_some())
    }

    #[test]
    fn any_hit_lights_a_barrel_but_poison_does_not() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        let (_, oi) = barrel_at(&mut run, Vec2::new(40.0, 0.0));
        hurt_object(&mut run, oi, Damage::new(5.0, DamageSplit::pure(DamageType::Poison)), None);
        assert!(!lit(&run, oi), "objects resist poison fully");
        let pid = run.players[0].id;
        hurt_object(&mut run, oi, Damage::physical(1.0), Some(pid));
        assert!(lit(&run, oi));
        let ObjState::Barrel(b) = &run.objects[oi].state else { panic!() };
        assert_eq!((b.fuse, b.igniter), (Some(BARREL_FUSE), Some(pid)));
        assert_eq!(snap(&run.objects[oi], run.time).5, 1, "anim 1 while the fuse burns");
    }
}
```
  Run: `... cargo test --release run::objects`. Expected: compile errors.

- [ ] **Step 2: Implement.**
  - **`kinds.rs`:** add `Barrel = 81,` after `Chest = 80,`, and add it to `ALL` (the size becomes 34).
  - **`defs/objects.rs`:**

```rust
/// Barrels (first guesses for the balancing pass).
pub const BARREL_RADIUS: f64 = 6.0;
/// Seconds from the first hit to the explosion; also the delay per link of a chain.
pub const BARREL_FUSE: f64 = 0.3;
pub const BARREL_BLAST_R: f64 = 40.0;
pub const BARREL_BLAST_DAMAGE: f64 = 30.0;
pub const BARREL_BLAST_KNOCK: f64 = 40.0;
/// How far a push with E slides a barrel (px).
pub const BARREL_PUSH: f64 = 48.0;
/// Hand reach for using an object: gap (px) between the hero's and the object's footprints.
pub const USE_REACH: f64 = 6.0;

pub fn barrel_blast() -> Damage {
    Damage::new(BARREL_BLAST_DAMAGE, DamageSplit::split(&[(DamageType::Heat, 0.5)]))
}
```
    - Add `EntityKind::Barrel => ObjDef { radius: BARREL_RADIUS, solid: true },` to `def`.
    - Imports: `use super::damage::{Damage, DamageSplit, DamageType};`.
  - **`run/objects.rs`:**

```rust
pub struct Barrel {
    /// Seconds until it explodes, once lit.
    pub fuse: Option<f64>,
    pub lit_at: f64,
    /// Hero (entity id) who lit the first barrel of the chain: damage and kills go to them.
    pub igniter: Option<u32>,
    /// Slide velocity (px/s) after a push, decaying like knockback.
    pub vel: Vec2,
    /// Falling into a chasm or sinking in deep water: seconds left, how, start time.
    pub sinking: Option<(f64, Sink, f64)>,
}

impl Barrel {
    pub fn new() -> Self {
        Barrel { fuse: None, lit_at: 0.0, igniter: None, vel: Vec2::ZERO, sinking: None }
    }
}
```
    - Add `Barrel(Barrel)` to `ObjState`.
    - In `hurt_object`, add the arm:

```rust
        ObjState::Barrel(_) => {
            let time = run.time;
            if let ObjState::Barrel(b) = &mut run.objects[oi].state {
                if b.fuse.is_none() && b.sinking.is_none() {
                    b.fuse = Some(BARREL_FUSE);
                    b.lit_at = time;
                    b.igniter = by;
                }
            }
        }
```
      Change `match o.state` to `match &o.state` and use `_by` as `by`.
    - Add the arm to `snap`:

```rust
        ObjState::Barrel(b) => match (b.sinking, b.fuse) {
            (Some((_, how, t0)), _) => (if how == Sink::Fall { 2 } else { 3 }, ms_since(time, t0)),
            (None, Some(_)) => (1, ms_since(time, b.lit_at)),
            _ => (0, 0),
        },
```
      Import `crate::run::entities::Sink`.
  - **`export.rs` consts:** add `"BARREL_RADIUS"`, `"BARREL_FUSE"`, `"BARREL_BLAST_R"` and `"USE_REACH"` (from `crate::defs::objects`) in a third small `json!` object merged like `shots`.

- [ ] **Step 3: Run the tests and confirm they pass.** Run: `... cargo test --release run::objects`.

- [ ] **Step 4: Commit** with the message "Barrel object: lit by any hit, fuse state in snapshots".

### Task 10: Barrel explosions and chain reactions

**Files:**
- Modify:
  - `server/src/run/objects.rs` (`tick_objects`, `explode_barrel`)
  - `server/src/run/mod.rs` (`step` calls `objects::tick_objects`)
  - `server/src/protocol.rs` (the `Boom` doc: `7 barrel explosion`)

**Interfaces:**
- Produces:
  - `objects::tick_objects(run: &mut Run, dt: f64)`. It runs after `tick_hazards` and before the retains.
  - `objects::explode_barrel(run: &mut Run, oi: usize)`
  - `pub const BOOM_BARREL: u8 = 7;` in `run/objects.rs`.

- [ ] **Step 1: Write the failing tests** (in the `run::objects` tests):

```rust
    fn booms(run: &Run) -> usize {
        run.events.iter().filter(|(e, _)| matches!(e, crate::protocol::Ev::Boom { k: BOOM_BARREL, .. })).count()
    }

    fn step_for(run: &mut Run, secs: f64) {
        for _ in 0..(secs / crate::run::DT).round() as usize {
            run.step();
        }
    }

    #[test]
    fn a_lit_barrel_explodes_after_the_fuse_and_hurts_and_pushes_heroes() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let (_, oi) = barrel_at(&mut run, Vec2::new(20.0, 0.0));
        let hp = run.players[0].hp;
        hurt_object(&mut run, oi, Damage::physical(1.0), None);
        run.events.clear();
        step_for(&mut run, BARREL_FUSE - 0.05);
        assert_eq!(booms(&run), 0, "not yet");
        step_for(&mut run, 0.1);
        assert_eq!(booms(&run), 1);
        assert!(run.players[0].hp < hp, "the blast hurts heroes too");
        assert!(run.players[0].mv.knock_vx < 0.0, "and pushes them away (west)");
        assert!(run.objects.iter().all(|o| o.kind != EntityKind::Barrel), "the barrel is gone");
    }

    #[test]
    fn a_chain_of_ten_barrels_explodes_each_exactly_once() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        run.players[0].debug = true; // the hero stands in the middle of it
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        for x in tx - 1..=tx + 12 {
            for y in ty - 2..=ty + 2 {
                run.layout.map.set(x, y, crate::dungeon::Tile::Floor);
            }
        }
        for k in 0..10 {
            barrel_at(&mut run, Vec2::new(20.0 + 16.0 * k as f64, 0.0));
        }
        let first = run.objects.iter().position(|o| o.kind == EntityKind::Barrel).unwrap();
        hurt_object(&mut run, first, Damage::physical(1.0), None);
        run.events.clear();
        step_for(&mut run, 10.0 * BARREL_FUSE + 0.5);
        assert_eq!(booms(&run), 10);
    }

    #[test]
    fn a_chain_without_an_igniter_or_whose_igniter_left_still_explodes() {
        let mut run = test_run(&[ClassId::Paladin, ClassId::Wizard], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let (_, oi) = barrel_at(&mut run, Vec2::new(30.0, 0.0));
        let wiz = run.players[1].id;
        hurt_object(&mut run, oi, Damage::physical(1.0), Some(wiz));
        run.handle(crate::run::RunCmd::Leave { conn: 2 });
        run.events.clear();
        step_for(&mut run, BARREL_FUSE + 0.1);
        assert_eq!(booms(&run), 1);
    }
```
  Run: `... cargo test --release run::objects`. Expected: compile errors (`BOOM_BARREL`), then failing assertions.

- [ ] **Step 2: Implement** in `run/objects.rs`:

```rust
/// `Ev::Boom` kind of a barrel explosion.
pub const BOOM_BARREL: u8 = 7;

/// Fuses burn down; a burnt-out fuse explodes the barrel.
pub fn tick_objects(run: &mut Run, dt: f64) {
    for oi in 0..run.objects.len() {
        if run.objects[oi].gone {
            continue;
        }
        let time = run.time;
        let ObjState::Barrel(b) = &mut run.objects[oi].state else { continue };
        let Some(f) = b.fuse else { continue };
        // Lit during this step (by a blast earlier in this loop): the fuse starts next step.
        let f = if b.lit_at < time { f - dt } else { f };
        b.fuse = Some(f);
        if f <= 0.0 {
            explode_barrel(run, oi);
        }
    }
}

/// The blast: hurts heroes, monsters and bosses with line of sight to it,
/// pushes heroes and (non-boss) monsters away, and lights every barrel in
/// reach. Damage and kills go to the hero who lit the chain.
pub fn explode_barrel(run: &mut Run, oi: usize) {
    let o = &mut run.objects[oi];
    if o.gone {
        return;
    }
    o.gone = true;
    let pos = o.pos;
    let by = match &o.state {
        ObjState::Barrel(b) => b.igniter,
        _ => None,
    };
    let src = by.and_then(|id| run.player_idx(id));
    let (r, dmg, knock) = (BARREL_BLAST_R, barrel_blast(), BARREL_BLAST_KNOCK);
    run.event(Ev::Boom { x: pos.x as f32, y: pos.y as f32, r: r as f32, k: BOOM_BARREL }, Some(pos));
    let map = &run.layout.map;
    let heroes: Vec<usize> = (0..run.players.len())
        .filter(|&i| {
            let p = &run.players[i];
            p.alive && p.pos().dist(pos) < r + PLAYER_RADIUS && line_of_sight(map, pos, p.pos())
        })
        .collect();
    let monsters: Vec<usize> = (0..run.monsters.len())
        .filter(|&i| {
            let m = &run.monsters[i];
            m.alive && m.pos.dist(pos) < r + m.radius && line_of_sight(map, pos, m.pos)
        })
        .collect();
    let barrels: Vec<usize> = (0..run.objects.len())
        .filter(|&i| {
            let q = &run.objects[i];
            i != oi && !q.gone && q.pos.dist(pos) < r + q.radius && line_of_sight(map, pos, q.pos)
        })
        .collect();
    for qi in heroes {
        run.hurt_player(qi, dmg);
        run.knock_player(qi, pos, 0.0, knock);
    }
    for mi in monsters {
        run.hurt_monster(mi, dmg, false, src);
    }
    for qi in barrels {
        hurt_object(run, qi, dmg, by);
    }
}
```
  Imports: `crate::collision::line_of_sight`, `crate::defs::classes::PLAYER_RADIUS`, `crate::protocol::Ev`, `crate::defs::objects::*`.
  - In `Run::step`, call `objects::tick_objects(self, DT);` right after `self.tick_hazards(DT);`.
  - Update the `Boom` doc comment in `protocol.rs` to end with `6 lich nova (dark purple burst), 7 barrel explosion`.

- [ ] **Step 3: Run the tests and confirm they pass.** Run: `... cargo test --release run::objects`.

- [ ] **Step 4: Commit** with the message "Barrel explosions and chain reactions".

### Task 11: Monster knockback, and deaths in chasms, water and lava

**Files:**
- Modify:
  - `server/src/run/entities.rs` (`Monster` fields)
  - `server/src/run/mod.rs`:
    - `spawn_enemy`
    - `knock_monster`
    - `slide_monster`
    - `terrain_monster`
    - the AI loop in `step`
    - `hurt_monster` (`last_hit_by`)
  - `server/src/run/levels/boss.rs` (the new fields)
  - `server/src/run/ai.rs` (`escape_terrain`)
  - `server/src/run/objects.rs` (the explosion pushes monsters)

**Interfaces:**
- Produces:
  - `Monster.knock: Vec2` (px/s)
  - `Monster.sinking: Option<(f64, Sink)>`
  - `Monster.burn_t: f64`
  - `Monster.last_hit_by: Option<usize>`
  - `Run::knock_monster(&mut self, mi: usize, from: Vec2, dist: f64)`
  - `ai::escape_terrain(run, mi, dt)`
  - `Ev::Sink` for monsters, with their id and `Some(pos)` for line of sight.

- [ ] **Step 1: Write the failing tests** in `run/mod.rs` tests:

```rust
    /// A lone orc east of player 0 next to fresh terrain `t` two tiles further east.
    fn orc_by(t: Tile) -> (Run, u32, Vec2) {
        let (mut run, at) = terrain_run(t);
        let orc = at - Vec2::new(16.0, 0.0);
        let id = run.spawn_enemy(EnemyType::OrcWarrior, orc, None, 1);
        run.players[0].debug = true;
        (run, id, at)
    }

    #[test]
    fn an_enemy_blown_into_a_chasm_falls_and_gives_xp_once() {
        let (mut run, id, _) = orc_by(Tile::Chasm);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].last_hit_by = Some(0);
        let from = run.monsters[mi].pos - Vec2::new(10.0, 0.0);
        run.knock_monster(mi, from, 40.0);
        for _ in 0..30 {
            run.step();
        }
        assert!(run.events.iter().any(|(e, _)| matches!(e, Ev::Sink { id: i, how: 0, .. } if *i == id)));
        for _ in 0..=(dungeon::FALL_TIME / DT) as usize {
            run.step();
        }
        assert!(run.monster_idx(id).is_none(), "fell");
        let xp = run.players[0].xp;
        assert!(xp > 0 && run.players[0].kills == 1);
        for _ in 0..30 {
            run.step();
        }
        assert_eq!(run.players[0].xp, xp, "XP only once");
    }

    #[test]
    fn an_enemy_blown_into_deep_water_drowns() {
        let (mut run, id, _) = orc_by(Tile::DeepWater);
        let mi = run.monster_idx(id).unwrap();
        let from = run.monsters[mi].pos - Vec2::new(10.0, 0.0);
        run.knock_monster(mi, from, 40.0);
        for _ in 0..30 + (dungeon::DROWN_TIME / DT) as usize {
            run.step();
        }
        assert!(run.monster_idx(id).is_none());
    }

    #[test]
    fn an_enemy_in_lava_burns_and_walks_out() {
        let (mut run, id, at) = orc_by(Tile::Lava);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].pos = at;
        let hp = run.monsters[mi].hp;
        for _ in 0..90 {
            run.step();
        }
        let mi = run.monster_idx(id).unwrap();
        assert!(run.monsters[mi].hp < hp, "burned");
        assert!(!run.layout.map.blocks_at(run.monsters[mi].pos, Mover::Enemy), "out of the lava");
    }

    #[test]
    fn bosses_are_never_pushed() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Demon);
        let bi = run.monsters.iter().position(|m| m.is_boss).unwrap();
        let from = run.monsters[bi].pos - Vec2::new(10.0, 0.0);
        run.knock_monster(bi, from, 40.0);
        assert_eq!(run.monsters[bi].knock, Vec2::ZERO);
    }
```
  Run: `... cargo test --release blown_into enemy_in_lava never_pushed`. Expected: compile errors.

- [ ] **Step 2: Implement.**
  - **New `Monster` fields** (initialise in `spawn_enemy` and in `levels/boss.rs`: `knock: Vec2::ZERO, sinking: None, burn_t: dungeon::LAVA_TICK, last_hit_by: None`):

```rust
    /// Knockback velocity (px/s) from a blast; the AI does not move it meanwhile.
    pub knock: Vec2,
    /// Falling into a chasm or drowning: seconds left, and how.
    pub sinking: Option<(f64, Sink)>,
    /// Time since the last lava burn.
    pub burn_t: f64,
    /// Last hero who hurt it: credited for a death by terrain.
    pub last_hit_by: Option<usize>,
```
  - **`hurt_monster`:** inside `if let Some(pi) = src_player {`, add `self.monsters[mi].last_hit_by = Some(pi);`.
  - **`run/mod.rs`:**

```rust
    /// A blast pushes a monster `dist` px straight away from `from`. Bosses
    /// and flying monsters are never pushed; only walls and solids stop the
    /// slide, so it can end in a chasm, deep water or lava.
    pub fn knock_monster(&mut self, mi: usize, from: Vec2, dist: f64) {
        let m = &mut self.monsters[mi];
        if !m.alive || m.is_boss || m.airborne || m.sinking.is_some() || dist <= 0.0 {
            return;
        }
        let d = m.pos - from;
        let dir = if d.len() > 0.01 { d.norm() } else { Vec2::new(1.0, 0.0) };
        m.knock = dir * crate::collision::knock_speed(dist, DT);
    }

    fn slide_monster(&mut self, mi: usize) {
        let v = self.monsters[mi].knock;
        if v == Vec2::ZERO {
            return;
        }
        let solids = self.solids(None);
        let m = &mut self.monsters[mi];
        let (x, y) = crate::collision::move_box(&self.layout.map, m.pos.x, m.pos.y, v.x * DT, v.y * DT, m.radius, Mover::Dash, &solids);
        m.pos = Vec2::new(x, y);
        m.knock = v * crate::defs::abilities::KNOCK_DECAY;
        if m.knock.len() < crate::defs::abilities::KNOCK_MIN_SPEED {
            m.knock = Vec2::ZERO;
        }
    }

    /// The ground under a monster's centre, like `terrain_player`: chasms and
    /// deep water take it (kill credit to the last hero who hurt it), lava
    /// burns monsters that are not lava walkers.
    fn terrain_monster(&mut self, mi: usize) {
        let m = &mut self.monsters[mi];
        if !m.alive || m.is_boss || m.airborne {
            return;
        }
        if let Some((t, how)) = m.sinking {
            if t - DT > 0.0 {
                m.sinking = Some((t - DT, how));
            } else {
                m.sinking = None;
                if let Some(pi) = m.last_hit_by {
                    self.players[pi].kills += 1;
                }
                self.kill_monster(mi);
            }
            return;
        }
        let pos = m.pos;
        let tile = self.layout.map.tile_at(pos);
        let how = if tile == Tile::Chasm as u8 {
            Some((dungeon::FALL_TIME, Sink::Fall))
        } else if tile == Tile::DeepWater as u8 {
            Some((dungeon::DROWN_TIME, Sink::Drown))
        } else {
            None
        };
        if let Some((t, how)) = how {
            m.sinking = Some((t, how));
            m.knock = Vec2::ZERO;
            m.ai.windup = None;
            m.anim = Anim::Idle;
            m.anim_start = self.time;
            let id = m.id;
            self.event(Ev::Sink { id, x: pos.x as f32, y: pos.y as f32, how: how as u8 }, Some(pos));
            return;
        }
        if tile == Tile::Lava as u8 && m.mover != Mover::Demon {
            m.burn_t += DT;
            if m.burn_t >= dungeon::LAVA_TICK {
                m.burn_t -= dungeon::LAVA_TICK;
                self.hurt_monster(mi, Damage::new(dungeon::LAVA_DAMAGE, DamageSplit::pure(DamageType::Heat)), false, None);
            }
        } else {
            m.burn_t = dungeon::LAVA_TICK;
        }
    }
```
  - **In `step`'s AI loop**, before the `active` check:

```rust
            if m.sinking.is_some() || m.knock != Vec2::ZERO {
                continue; // slid and sunk below
            }
            if self.layout.map.blocks_at(m.pos, m.mover) {
                ai::escape_terrain(self, mi, DT);
                continue;
            }
```
  - **After `ai::separate_monsters(self);`:**

```rust
        for mi in 0..self.monsters.len() {
            if self.monsters[mi].alive && !self.monsters[mi].is_boss {
                self.slide_monster(mi);
                self.terrain_monster(mi);
            }
        }
```
  - **`ai.rs`:**

```rust
/// A monster on ground it cannot walk (blown into lava): it walks straight
/// to the nearest tile it can, ignoring heroes until it is out.
pub fn escape_terrain(run: &mut Run, mi: usize, dt: f64) {
    let (pos, mover, speed) = (run.monsters[mi].pos, run.monsters[mi].mover, run.monsters[mi].speed);
    let (tx, ty) = Map::tile_of(pos);
    let mut best: Option<(f64, Vec2)> = None;
    for dy in -3..=3 {
        for dx in -3..=3 {
            let c = Map::center_of(tx + dx, ty + dy);
            if !run.layout.map.blocks(tx + dx, ty + dy, mover) && best.map_or(true, |(d, _)| c.dist(pos) < d) {
                best = Some((c.dist(pos), c));
            }
        }
    }
    if let Some((_, to)) = best {
        let solids = run.solids(None);
        let m = &run.monsters[mi];
        let v = (to - pos).norm() * (speed.max(20.0) * dt).min(to.dist(pos));
        // Out of the lava: the Dash mover lets it cross the blocked tiles it stands on.
        let (x, y) = move_box(&run.layout.map, pos.x, pos.y, v.x, v.y, m.radius, Mover::Dash, &solids);
        run.monsters[mi].pos = Vec2::new(x, y);
        set_anim(run, mi, Anim::Move);
    }
}
```
  - **`objects::explode_barrel`:** inside the monsters loop, after `hurt_monster`, add `run.knock_monster(mi, pos, knock);`.

- [ ] **Step 3: Run the tests and confirm they pass.** Run: `... cargo test --release blown_into enemy_in_lava never_pushed run::objects`, then the full suite. The fingerprints must be unchanged, because nothing pushes monsters without barrels.

- [ ] **Step 4: Commit** with the message "Monsters can be pushed; they fall, drown and burn like heroes".

### Task 12: Pushing barrels with E, and barrels in terrain

**Files:**
- Modify:
  - `server/src/protocol.rs` (`InputMsg.act`)
  - `server/src/wire.rs` (`InputW` 10th field, `From`, test)
  - `server/src/run/mod.rs` (`apply_input` calls `use_object`)
  - `server/src/run/objects.rs`:
    - `use_object`
    - the barrel slide and terrain in `tick_objects`
    - `solids` leaves out sinking barrels
  - `client/src/wire.ts` (`packInput`)
  - `client/src/game/GameScene.ts` (the E key and the `act` field)

**Interfaces:**
- Produces:
  - `InputMsg.act: bool` (serde default `false`)
  - `InputW(..., rtt, act)`
  - `objects::use_object(run: &mut Run, pi: usize)`
  - `objects::push_barrel(run, oi, from: Vec2)`

- [ ] **Step 1: Write the failing tests** (in `run::objects` tests):

```rust
    fn push(run: &mut Run) {
        let seq = run.players[0].ack + 1;
        run.players[0].inputs.push_back(crate::protocol::InputMsg { seq, act: true, ..Default::default() });
        run.step();
    }

    #[test]
    fn e_pushes_a_barrel_in_hand_reach_away_from_the_hero() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        for x in tx - 1..=tx + 8 {
            run.layout.map.set(x, ty, crate::dungeon::Tile::Floor);
        }
        let start = run.players[0].pos();
        let (id, _) = barrel_at(&mut run, Vec2::new(PLAYER_RADIUS + BARREL_RADIUS + 4.0, 0.0));
        push(&mut run);
        for _ in 0..60 {
            run.step();
        }
        let o = run.objects.iter().find(|o| o.id == id).unwrap();
        let moved = o.pos.x - (start.x + PLAYER_RADIUS + BARREL_RADIUS + 4.0);
        assert!((moved - BARREL_PUSH).abs() < 2.0, "slid {moved} px east");
    }

    #[test]
    fn a_barrel_out_of_reach_does_not_move() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        let (id, _) = barrel_at(&mut run, Vec2::new(PLAYER_RADIUS + BARREL_RADIUS + USE_REACH + 2.0, 0.0));
        let before = run.objects.iter().find(|o| o.id == id).unwrap().pos;
        push(&mut run);
        assert_eq!(run.objects.iter().find(|o| o.id == id).unwrap().pos, before);
    }

    #[test]
    fn a_pushed_barrel_stops_at_a_wall_and_at_another_barrel() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        for x in tx - 1..=tx + 2 {
            run.layout.map.set(x, ty, crate::dungeon::Tile::Floor);
        }
        run.layout.map.set(tx + 3, ty, crate::dungeon::Tile::Wall);
        let (id, oi) = barrel_at(&mut run, Vec2::new(PLAYER_RADIUS + BARREL_RADIUS + 2.0, 0.0));
        push_barrel(&mut run, oi, run.players[0].pos());
        for _ in 0..60 {
            run.step();
        }
        let o = run.objects.iter().find(|o| o.id == id).unwrap();
        assert!(o.pos.x + BARREL_RADIUS <= (tx + 3) as f64 * crate::dungeon::TILE + 1e-6, "stopped at the wall");
    }

    /// A barrel pushed east into fresh terrain `t` two tiles from the hero.
    fn pushed_into(t: crate::dungeon::Tile) -> (Run, u32) {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        run.monsters.retain(|m| m.is_boss);
        run.players[0].debug = true;
        let (tx, ty) = crate::dungeon::Map::tile_of(run.players[0].pos());
        run.layout.map.set(tx + 1, ty, crate::dungeon::Tile::Floor);
        run.layout.map.set(tx + 2, ty, crate::dungeon::Tile::Floor);
        run.layout.map.set(tx + 3, ty, t);
        let (id, oi) = barrel_at(&mut run, Vec2::new(PLAYER_RADIUS + BARREL_RADIUS + 2.0, 0.0));
        push_barrel(&mut run, oi, run.players[0].pos());
        run.events.clear();
        (run, id)
    }

    #[test]
    fn barrels_fall_into_chasms_sink_in_water_and_explode_in_lava() {
        use crate::dungeon::Tile;
        let (mut run, id) = pushed_into(Tile::Chasm);
        step_for(&mut run, 1.0 + crate::dungeon::FALL_TIME);
        assert!(run.objects.iter().all(|o| o.id != id) && booms(&run) == 0, "fell without a bang");
        let (mut run, id) = pushed_into(Tile::DeepWater);
        step_for(&mut run, 1.0 + crate::dungeon::DROWN_TIME);
        assert!(run.objects.iter().all(|o| o.id != id) && booms(&run) == 0, "sank without a bang");
        let (mut run, _) = pushed_into(Tile::Lava);
        step_for(&mut run, 1.0);
        assert_eq!(booms(&run), 1, "lava sets it off");
    }
```
  Also update the existing wire test `input_array_decodes_to_input_msg` to the 10-field form `InputW(7, 1, -1, 0.5, 30.0, Some(3), None, 80, 40, true)` and assert `i.act`.

  Run: `... cargo test --release run::objects wire`. Expected: compile errors.

- [ ] **Step 2: Implement.**
  - **`protocol.rs` `InputMsg`:**

```rust
    /// Use the nearest object in hand reach (E): push a barrel.
    #[serde(default)]
    pub act: bool,
```
  - **`wire.rs`:**
    - `InputW(pub u32, pub i8, pub i8, pub f32, pub f32, pub Option<u16>, pub Option<u16>, pub u16, pub u16, #[serde(default)] pub bool)`
    - Update its doc to `[..., view_lag, rtt, act]`.
    - Update the `From` impl to destructure and set `act`.
  - **`apply_input`:** after `if knocked { return; }` and before the abilities:

```rust
        if input.act {
            objects::use_object(self, pi);
        }
```
  - **`run/objects.rs`:**

```rust
/// E: the hero uses the nearest object within hand reach (touching distance
/// plus `USE_REACH`). Dead, pushed or sinking heroes can't (the caller
/// checks the push; this checks the rest).
pub fn use_object(run: &mut Run, pi: usize) {
    let p = &run.players[pi];
    if !p.alive || p.sinking.is_some() {
        return;
    }
    let at = p.pos();
    let near = run
        .objects
        .iter()
        .enumerate()
        .filter(|(_, o)| !o.gone && matches!(&o.state, ObjState::Barrel(b) if b.sinking.is_none()))
        .map(|(i, o)| (i, o.pos.dist(at) - o.radius - PLAYER_RADIUS))
        .filter(|&(_, gap)| gap <= USE_REACH)
        .min_by(|a, b| a.1.total_cmp(&b.1));
    if let Some((oi, _)) = near {
        match run.objects[oi].state {
            ObjState::Barrel(_) => push_barrel(run, oi, at),
            ObjState::Chest { .. } => {}
        }
    }
}

/// Slides a barrel `BARREL_PUSH` px straight away from `from`.
pub fn push_barrel(run: &mut Run, oi: usize, from: Vec2) {
    let o = &mut run.objects[oi];
    let d = o.pos - from;
    let dir = if d.len() > 0.01 { d.norm() } else { Vec2::new(1.0, 0.0) };
    if let ObjState::Barrel(b) = &mut o.state {
        b.vel = dir * crate::collision::knock_speed(BARREL_PUSH, crate::run::DT);
    }
}
```
  - In `tick_objects`, before the fuse code, handle the slide, the sinking and the terrain:

```rust
        // Sinking: gone when it is under; no explosion.
        if let ObjState::Barrel(b) = &mut run.objects[oi].state {
            if let Some((t, how, t0)) = b.sinking {
                if t - dt > 0.0 {
                    b.sinking = Some((t - dt, how, t0));
                } else {
                    run.objects[oi].gone = true;
                }
                continue;
            }
        }
        slide_barrel(run, oi, dt);
        barrel_terrain(run, oi);
```
  with:

```rust
fn slide_barrel(run: &mut Run, oi: usize, dt: f64) {
    let ObjState::Barrel(b) = &run.objects[oi].state else { return };
    let v = b.vel;
    if v == Vec2::ZERO {
        return;
    }
    let (id, pos, r) = (run.objects[oi].id, run.objects[oi].pos, run.objects[oi].radius);
    let solids = run.solids(Some(id));
    let (x, y) = crate::collision::move_box(&run.layout.map, pos.x, pos.y, v.x * dt, v.y * dt, r, crate::dungeon::Mover::Dash, &solids);
    let to = Vec2::new(x, y);
    // A hero or monster in the way stops it (they are not shoved).
    let blocked = run.players.iter().any(|p| p.alive && p.pos().dist(to) < PLAYER_RADIUS + r && p.pos().dist(to) < p.pos().dist(pos))
        || run.monsters.iter().any(|m| m.alive && m.pos.dist(to) < m.radius + r && m.pos.dist(to) < m.pos.dist(pos));
    let ObjState::Barrel(b) = &mut run.objects[oi].state else { return };
    if blocked {
        b.vel = Vec2::ZERO;
        return;
    }
    run.objects[oi].pos = to;
    let ObjState::Barrel(b) = &mut run.objects[oi].state else { return };
    b.vel = if to == pos { Vec2::ZERO } else { v * KNOCK_DECAY };
    if b.vel.len() < KNOCK_MIN_SPEED {
        b.vel = Vec2::ZERO;
    }
}

/// A barrel over a chasm falls, in deep water it sinks (no explosion), in lava it goes off.
fn barrel_terrain(run: &mut Run, oi: usize) {
    use crate::dungeon::{Tile, DROWN_TIME, FALL_TIME};
    let (pos, time) = (run.objects[oi].pos, run.time);
    let tile = run.layout.map.tile_at(pos);
    let ObjState::Barrel(b) = &mut run.objects[oi].state else { return };
    if tile == Tile::Chasm as u8 {
        b.sinking = Some((FALL_TIME, Sink::Fall, time));
    } else if tile == Tile::DeepWater as u8 {
        b.sinking = Some((DROWN_TIME, Sink::Drown, time));
    } else if tile == Tile::Lava as u8 {
        b.fuse = Some(0.0);
        b.lit_at = time - 1.0;
        return;
    } else {
        return;
    }
    b.vel = Vec2::ZERO;
    b.fuse = None;
}
```
    Imports: `crate::defs::abilities::{KNOCK_DECAY, KNOCK_MIN_SPEED}`.
  - `Run::solids` leaves sinking barrels out: add `&& !matches!(&o.state, ObjState::Barrel(b) if b.sinking.is_some())` to the filter.
  - **`client/src/wire.ts` `packInput`:** add `i.act ?? false` as the last element.
  - **`GameScene.ts`:**
    - Add a field `private actPressed = false;`.
    - Replace the E handler with `kb.on('keydown-E', () => { if (this.alive) this.actPressed = true; else this.net.send({ t: 'Spectate', dir: 1 }); });`.
    - In `fixedStep`, compute `const act = this.actPressed && free; this.actPressed = false;`, and add `act` to the `Input` message.
    - In the `!this.alive` early return, also set `this.actPressed = false`.
    - Update the death hint text: `'You have fallen. Q / E to watch your party.'` stays as it is (E still spectates while dead).

- [ ] **Step 3: Run all checks.**
  - Server: `MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test`.
  - Client: `cd client && npm run build && npm test`.
  - Expected: all pass.

- [ ] **Step 4: Commit** with the message "Push barrels with E; barrels fall, sink or explode in terrain".

### Task 13: Shots, melee, dashes and blasts hit objects; monsters walk around barrels

**Files:**
- Modify:
  - `server/src/run/abilities.rs`:
    - `advance_projectile`
    - `impact`
    - `melee_arc`
    - `dash_contact`
    - `explode`
  - `server/src/run/ai.rs`:
    - `astar_clear` (blocked tiles)
    - `astar`
    - `path_toward`
  - `server/src/run/objects.rs` (`Run::object_tiles`)
  - `server/src/export.rs` (`HITBOX` entry for the barrel)

**Interfaces:**
- Produces:
  - `Run::object_tiles(&self) -> HashSet<(i32, i32)>`: the tiles under resting solid objects.
  - `astar_clear(map, from, to, max_nodes, mover, clear, blocked: &HashSet<(i32,i32)>)`.
  - `HITBOX[KIND.Barrel] = { r: 6, h: 0 }`.

- [ ] **Step 1: Write the failing tests** (in `abilities.rs` tests):

```rust
    #[test]
    fn shots_stop_at_a_barrel_and_light_it() {
        for from_player in [true, false] {
            let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
            run.monsters.retain(|m| m.is_boss);
            let p = run.players[0].pos();
            let id = run.spawn_object(EntityKind::Barrel, p + Vec2::new(30.0, 0.0), crate::run::objects::ObjState::Barrel(crate::run::objects::Barrel::new()));
            run.spawn_enemy(EnemyType::OrcWarrior, p + Vec2::new(50.0, 0.0), None, 1);
            let hp = run.monsters.last().unwrap().hp;
            if from_player {
                run.players[0].aim = 0.0;
                try_use(&mut run, 0, AbilityId::MagicMissile, 1, true);
            } else {
                spawn_monster_projectile(&mut run, 999, EntityKind::Arrow, p + Vec2::new(10.0, 0.0), Vec2::new(1.0, 0.0), 180.0, 5.0, 2.0, 0.0, 0, 0.0);
            }
            for _ in 0..30 {
                tick_projectiles(&mut run, 1.0 / TICK_HZ);
            }
            let o = run.objects.iter().find(|o| o.id == id).unwrap();
            assert!(matches!(&o.state, crate::run::objects::ObjState::Barrel(b) if b.fuse.is_some()), "lit (player shot: {from_player})");
            assert_eq!(run.monsters.last().unwrap().hp, hp, "the orc behind it is spared");
        }
    }

    #[test]
    fn a_sword_swing_and_a_fireball_light_barrels() {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        let p = run.players[0].pos();
        let id = run.spawn_object(EntityKind::Barrel, p + Vec2::new(14.0, 0.0), crate::run::objects::ObjState::Barrel(crate::run::objects::Barrel::new()));
        run.players[0].aim = 0.0;
        try_use(&mut run, 0, AbilityId::Sword, 1, true);
        let lit = |run: &Run| matches!(&run.objects.iter().find(|o| o.id == id).unwrap().state, crate::run::objects::ObjState::Barrel(b) if b.fuse.is_some());
        assert!(lit(&run));
        let mut run = test_run(&[ClassId::Wizard], BossId::Lich);
        let at = run.players[0].pos() + Vec2::new(40.0, 0.0);
        let id2 = run.spawn_object(EntityKind::Barrel, at, crate::run::objects::ObjState::Barrel(crate::run::objects::Barrel::new()));
        explode(&mut run, at + Vec2::new(10.0, 0.0), 20.0, Damage::physical(5.0), true, Some(0), 0, false, 0.0);
        assert!(matches!(&run.objects.iter().find(|o| o.id == id2).unwrap().state, crate::run::objects::ObjState::Barrel(b) if b.fuse.is_some()));
    }
```
  In the `ai.rs` tests:

```rust
    #[test]
    fn astar_goes_around_tiles_under_barrels() {
        let mut m = Map::new(12, 12);
        for y in 1..11 {
            for x in 1..11 {
                m.set(x, y, Tile::Floor);
            }
        }
        let blocked: std::collections::HashSet<(i32, i32)> = (1..10).map(|y| (5, y)).collect();
        let p = astar_clear(&m, Map::center_of(2, 2), Map::center_of(8, 2), 1000, Mover::Enemy, false, &blocked).unwrap();
        assert!(p.iter().any(|w| Map::tile_of(*w).1 >= 10));
    }
```
  Run: `... cargo test --release barrel astar_goes_around`. Expected: compile errors, then failures.

- [ ] **Step 2: Implement.**
  - **`advance_projectile`:** right after the `opaque_at` check:

```rust
        let r = run.projectiles[i].radius;
        if let Some(oi) = run.objects.iter().position(|o| o.solid && !o.gone && o.pos.dist(pos) < o.radius + r) {
            impact_object(run, i, pos, oi);
            break;
        }
```
    with

```rust
/// Projectile `i` hits a solid object: an explosion goes off there, a plain shot hurts the object.
fn impact_object(run: &mut Run, i: usize, pos: Vec2, oi: usize) {
    let pr = &mut run.projectiles[i];
    pr.dead = true;
    let (from_player, owner, damage, crit, explode_r, k, knock) = (pr.from_player, pr.owner, pr.damage, pr.crit, pr.explode_r, pr.explode_k, pr.knock);
    if explode_r > 0.0 {
        let src = if from_player { run.player_idx(owner) } else { None };
        explode(run, pos, explode_r, damage, from_player, src, k, crit, knock);
    } else {
        crate::run::objects::hurt_object(run, oi, damage, from_player.then_some(owner));
    }
}
```
  - **`explode`:** at the end, for both teams:

```rust
    let by = src.map(|pi| run.players[pi].id);
    let objs: Vec<usize> = (0..run.objects.len())
        .filter(|&i| {
            let o = &run.objects[i];
            !o.gone && o.pos.dist(pos) < r + o.radius && line_of_sight(&run.layout.map, pos, o.pos)
        })
        .collect();
    for oi in objs {
        crate::run::objects::hurt_object(run, oi, damage, by);
    }
```
  - **`melee_arc`:** after the monster hits, do the same for objects in reach, in the arc and in line of sight (using `o.pos` and `o.radius`). Call `hurt_object(run, oi, dmg, Some(run.players[pi].id))`.
  - **`dash_contact`:** objects not yet in `dash_hit` within `PLAYER_RADIUS + o.radius + 4.0`: push `o.id` into `dash_hit` and call `hurt_object`.
  - **`run/objects.rs`:**

```rust
impl Run {
    /// Tiles under resting solid objects: pathfinding goes around them.
    pub fn object_tiles(&self) -> std::collections::HashSet<(i32, i32)> {
        let mut out = std::collections::HashSet::new();
        for o in self.objects.iter().filter(|o| o.solid && !o.gone) {
            let (x0, y0) = crate::dungeon::Map::tile_of(o.pos - Vec2::new(o.radius, o.radius));
            let (x1, y1) = crate::dungeon::Map::tile_of(o.pos + Vec2::new(o.radius - 0.001, o.radius - 0.001));
            for y in y0..=y1 {
                for x in x0..=x1 {
                    out.insert((x, y));
                }
            }
        }
        out
    }
}
```
  - **`ai.rs`:**
    - `astar_clear` gets `blocked: &HashSet<(i32, i32)>`. The neighbour test becomes `if map.blocks(nb.0, nb.1, mover) || blocked.contains(&nb) && nb != goal { continue; }`.
    - `astar` passes `&HashSet::new()`.
    - `path_toward` computes `let blocked = run.object_tiles();` before calling `astar_clear(..., &blocked)`.
  - **`export.rs` hitbox:** after the loop, add `hitbox.insert((EntityKind::Barrel as u8).to_string(), json!({ "r": crate::defs::objects::BARREL_RADIUS, "h": 0.0 }));`. (A height of 0 gives a plain circle, the same as the server's `o.pos.dist(pos) < o.radius + r`.)

- [ ] **Step 3: Run all checks.**
  - Server: the full suite. Expected: all pass. The fingerprints are unchanged, because there are no barrels yet.
  - Client: `cd client && npm run build && npm test`.

- [ ] **Step 4: Commit** with the message "Every attack hits objects; shots stop at barrels; paths avoid them".

### Task 14: Ranged enemies shoot barrels next to heroes

**Files:**
- Modify: `server/src/run/ai.rs` (the Chase branch, windup resolution, `perform_attack`).

**Interfaces:**
- Consumes: `Windup.at`, `Target::Object` (Task 7); `BARREL_BLAST_R` (Task 9).
- Produces:
  - `fn barrel_near(run: &Run, mi: usize, hero: Vec2, range: f64) -> Option<u32>`
  - `perform_attack(run, mi, pi, attack, alt, at: Option<Vec2>)`

- [ ] **Step 1: Write the failing tests** (in `ai.rs` tests):

```rust
    /// An orc archer 100 px west of the hero, a barrel `barrel_off` from the hero.
    fn archer_and_barrel(barrel_off: Vec2) -> (Run, usize, u32) {
        let mut run = test_run(&[ClassId::Paladin], BossId::Lich);
        open_floor(&mut run);
        run.monsters.retain(|m| m.is_boss);
        let p = run.players[0].pos();
        let id = run.spawn_enemy(EnemyType::OrcArcher, p - Vec2::new(100.0, 0.0), None, 1);
        let mi = run.monster_idx(id).unwrap();
        run.monsters[mi].ai.cd = 0.0;
        let b = run.spawn_object(EntityKind::Barrel, p + barrel_off, crate::run::objects::ObjState::Barrel(crate::run::objects::Barrel::new()));
        (run, mi, b)
    }

    #[test]
    fn an_archer_shoots_a_barrel_next_to_the_hero() {
        let (mut run, mi, b) = archer_and_barrel(Vec2::new(-16.0, 12.0));
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert_eq!(run.monsters[mi].ai.windup.and_then(|w| w.at), Some(crate::run::entities::Target::Object(b)));
        for _ in 0..90 {
            tick_monster(&mut run, mi, 1.0 / 60.0);
            crate::run::abilities::tick_projectiles(&mut run, 1.0 / 60.0);
        }
        let o = run.objects.iter().find(|o| o.id == b).unwrap();
        assert!(matches!(&o.state, crate::run::objects::ObjState::Barrel(x) if x.fuse.is_some()), "the barrel was shot");
    }

    #[test]
    fn an_archer_does_not_shoot_a_barrel_that_would_catch_it() {
        // Barrel 60 px east of the archer... then the hero steps 20 px west:
        // the barrel is 40 px from both, so the blast would catch the archer too.
        let (mut run, mi, _) = archer_and_barrel(Vec2::new(-60.0, 0.0));
        run.players[0].mv.x -= 20.0;
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert!(run.monsters[mi].ai.windup.is_some(), "it still attacks");
        assert_eq!(run.monsters[mi].ai.windup.and_then(|w| w.at), None, "but shoots the hero");
    }

    #[test]
    fn a_far_barrel_is_ignored() {
        let (mut run, mi, _) = archer_and_barrel(Vec2::new(0.0, 60.0));
        tick_monster(&mut run, mi, 1.0 / 60.0);
        assert_eq!(run.monsters[mi].ai.windup.and_then(|w| w.at), None);
    }
```
- [ ] **Step 2: Implement** in `ai.rs`:

```rust
/// A barrel worth shooting instead of the hero: unlit, solid, in range and
/// sight of the shooter, close enough to the hero for the blast to catch
/// them, and far enough that the blast spares the shooter. The one closest
/// to the hero.
fn barrel_near(run: &Run, mi: usize, hero: Vec2, range: f64) -> Option<u32> {
    use crate::defs::objects::BARREL_BLAST_R;
    let m = &run.monsters[mi];
    run.objects
        .iter()
        .filter(|o| !o.gone && matches!(&o.state, crate::run::objects::ObjState::Barrel(b) if b.fuse.is_none() && b.sinking.is_none()))
        .filter(|o| o.pos.dist(hero) < BARREL_BLAST_R + PLAYER_RADIUS)
        .filter(|o| o.pos.dist(m.pos) > BARREL_BLAST_R + m.radius + 8.0 && o.pos.dist(m.pos) <= range)
        .filter(|o| line_of_sight(&run.layout.map, m.pos, o.pos))
        .min_by(|a, b| a.pos.dist(hero).total_cmp(&b.pos.dist(hero)))
        .map(|o| o.id)
}
```
  - **In the Chase branch,** at `if d <= range && run.monsters[mi].ai.cd <= 0.0 {`, for a `Ranged` main attack:

```rust
                let at = match def.attack {
                    AttackStyle::Ranged { range, .. } if !run.monsters[mi].is_boss => barrel_near(run, mi, ppos, range).map(Target::Object),
                    _ => None,
                };
                let aim = match at {
                    Some(Target::Object(id)) => run.objects.iter().find(|o| o.id == id).map_or(aim, |o| pos.angle_to(o.pos)),
                    _ => aim,
                };
                run.monsters[mi].ai.windup = Some(Windup { t: windup, aim, alt: false, at });
```
  - **At the windup resolution:**

```rust
        run.monsters[mi].ai.windup = None;
        // A barrel aimed at that is still there and unlit; otherwise the seen hero.
        let barrel = match w.at {
            Some(Target::Object(id)) => run
                .objects
                .iter()
                .find(|o| o.id == id && !o.gone && matches!(&o.state, crate::run::objects::ObjState::Barrel(b) if b.fuse.is_none()))
                .map(|o| o.pos),
            _ => None,
        };
        if let Some(pi) = seen {
            let attack = if w.alt { def.alt.unwrap_or(def.attack) } else { def.attack };
            perform_attack(run, mi, pi, attack, w.alt, barrel);
        }
        return;
```
  - **`perform_attack`** gets `at: Option<Vec2>`. It computes `let aim = pos.angle_to(at.unwrap_or(ppos));`. Melee and Slam ignore `at`. Update every existing call (tests pass `None`).

- [ ] **Step 3: Run the tests and confirm they pass.** Run: `... cargo test --release archer`, then the full suite (fingerprints unchanged).

- [ ] **Step 4: Commit** with the message "Ranged enemies shoot barrels next to heroes".

### Task 15: Barrels in the dungeon (generator and spawning)

**Files:**
- Modify:
  - `server/src/dungeon/generate.rs` (`place_barrels`, `rotate`, tests)
  - `server/src/dungeon/mod.rs` (`Dungeon.barrels`, `Layout.barrels`, `split`)
  - `server/src/run/mod.rs` (spawning in `Run::new`; fingerprint values)

**Interfaces:**
- Produces:
  - `Layout.barrels: Vec<Vec2>` (tile centres)
  - `fn place_barrels(rng, map, rooms, spawns, chests) -> Vec<Vec2>` (RNG stream 11)

- [ ] **Step 1: Write the failing tests** in the `generate.rs` tests:

```rust
    #[test]
    fn barrels_stand_on_dry_floor_and_never_cut_anything_off() {
        let mut total = 0;
        for seed in 0..40u64 {
            let d = generate(seed, if seed % 2 == 0 { Theme::Water } else { Theme::Lava });
            let tiles: Vec<(i32, i32)> = d.barrels.iter().map(|&p| Map::tile_of(p)).collect();
            total += tiles.len();
            let chests: Vec<(i32, i32)> = d.chests.iter().map(|c| Map::tile_of(c.pos)).collect();
            let start = d.rooms[d.start].rect;
            for &(x, y) in &tiles {
                assert_eq!(d.map.get(x, y), Tile::Floor as u8, "seed {seed}: barrel on {x},{y}");
                assert!(!chests.contains(&(x, y)) && !start.contains_tile(x, y));
            }
            assert!(d.spawns.iter().all(|s| !tiles.contains(&Map::tile_of(s.pos))), "seed {seed}: barrel on a spawn");
            let hall = *d.boss_hall();
            let in_hall = tiles.iter().filter(|&&(x, y)| hall.contains_tile(x, y)).count();
            assert!((3..=5).contains(&in_hall), "seed {seed}: {in_hall} barrels in the boss hall");
            // Barrels as walls: every safe tile still reachable from the start.
            let mut walled = d.map.clone();
            for &(x, y) in &tiles {
                walled.set(x, y, Tile::Wall);
            }
            let (sx, sy) = start.center();
            let dist = bfs(&walled, sx, sy);
            for y in 0..walled.h {
                for x in 0..walled.w {
                    assert!(!walled.safe(x, y) || dist[(y * walled.w + x) as usize] >= 0, "seed {seed}: {x},{y} cut off");
                }
            }
        }
        assert!(total > 40 * 4, "barrels in normal rooms too ({total})");
    }
```
  Also extend `split_keeps_every_part` with `d.barrels.len()` against `layout.barrels.len()`.

  Run: `... cargo test --release dungeon::generate`. Expected: compile errors.

- [ ] **Step 2: Implement.**
  - **`dungeon/mod.rs`:** add `pub barrels: Vec<Vec2>,` to `Dungeon` and `Layout` (doc: `/// Explosive barrels (tile centres).`), and carry it through `split`.
  - **`generate.rs`:** after the ogre placement:

```rust
    // Barrels (stream 11), last, so they avoid every spawn, chest and the terrain.
    let mut barrel_rng = rng.clone();
    barrel_rng.set_stream(11);
    let barrels = place_barrels(&mut barrel_rng, &map, &rooms, &spawns, &chests);
```
    - Set `barrels` in the `Dungeon` literal.
    - In `rotate`: `for b in &mut d.barrels { *b = rot_px(*b); }`.
    - The function:

```rust
/// Explosive barrels: about one ordinary room or hall in four gets a group of
/// two to four on dry floor, away from the walls (so never in a doorway),
/// chests and enemy spawns; the boss hall gets three to five single ones
/// away from its entrance, the boss's start and its chasms and lava. A group
/// that would cut any floor off from the start is not placed.
fn place_barrels(rng: &mut ChaCha8Rng, map: &Map, rooms: &[Room], spawns: &[Spawn], chests: &[ChestSpawn]) -> Vec<Vec2> {
    let start = rooms[0].rect.center();
    let taken: Vec<(i32, i32)> = spawns.iter().map(|s| Map::tile_of(s.pos)).chain(chests.iter().map(|c| Map::tile_of(c.pos))).collect();
    let near = |list: &[(i32, i32)], x: i32, y: i32| list.iter().any(|&(tx, ty)| (tx - x).abs() <= 1 && (ty - y).abs() <= 1);
    // Plain floor all around (no wall, door, water, chasm or lava next to it).
    let dry = |x: i32, y: i32| (-1..=1).all(|dy| (-1..=1).all(|dx| map.get(x + dx, y + dy) == Tile::Floor as u8));
    let mut walled = map.clone();
    let mut out: Vec<(i32, i32)> = Vec::new();
    let unreached = |m: &Map| {
        let d = bfs(m, start.0, start.1);
        (0..m.w * m.h).filter(|&i| d[i as usize] < 0 && m.safe(i % m.w, i / m.w)).count()
    };
    let base = unreached(&walled);
    let try_place = |cells: &[(i32, i32)], walled: &mut Map, out: &mut Vec<(i32, i32)>| -> bool {
        // Groups keep a tile of floor to other groups, chests and spawns.
        if cells.iter().any(|&(x, y)| !dry(x, y) || near(&taken, x, y) || near(out, x, y)) {
            return false;
        }
        for &(x, y) in cells {
            walled.set(x, y, Tile::Wall);
        }
        if unreached(walled) > base {
            for &(x, y) in cells {
                walled.set(x, y, Tile::Floor);
            }
            return false;
        }
        out.extend_from_slice(cells);
        true
    };
    for room in rooms {
        let r = &room.rect;
        match room.kind {
            RoomKind::Room | RoomKind::Hall if rng.gen_bool(0.25) && r.w >= 6 && r.h >= 6 => {
                let n = rng.gen_range(2..=4);
                for _ in 0..12 {
                    let x = rng.gen_range(r.x + 2..r.x + r.w - 3);
                    let y = rng.gen_range(r.y + 2..r.y + r.h - 3);
                    let cells: Vec<(i32, i32)> = [(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)].into_iter().take(n).collect();
                    if try_place(&cells, &mut walled, &mut out) {
                        break;
                    }
                }
            }
            RoomKind::Boss => {
                let n = rng.gen_range(3..=5);
                let mut placed = 0;
                for _ in 0..200 {
                    if placed == n {
                        break;
                    }
                    let x = rng.gen_range(r.x + 2..r.x + r.w - 2);
                    let y = rng.gen_range(r.y + 2..r.y + r.h - 2);
                    if hall_keep_clear(r, x, y) || out.iter().any(|&(bx, by)| (bx - x).abs() <= 2 && (by - y).abs() <= 2) {
                        continue;
                    }
                    if try_place(&[(x, y)], &mut walled, &mut out) {
                        placed += 1;
                    }
                }
            }
            _ => {}
        }
    }
    out.into_iter().map(|(x, y)| Map::center_of(x, y)).collect()
}
```
    `out` holds only barrels already placed, so the cells of the group being tried never reject each other.
  - **`Run::new`:** after `Level::populate(&mut run, n);`:

```rust
        // Barrels last, so every other entity keeps its id.
        for b in run.layout.barrels.clone() {
            run.spawn_object(EntityKind::Barrel, b, objects::ObjState::Barrel(objects::Barrel::new()));
        }
```

- [ ] **Step 3: Check that nothing else changed.**
  - Temporarily make `place_barrels` return `Vec::new()` on its first line.
  - Run `... cargo test --release level_setup_is_unchanged simulation_is_unchanged`.
  - Expected: PASS. This proves the map, spawns and ids are otherwise untouched.
  - Remove the temporary line.

- [ ] **Step 4: Run the generator tests, then update the fingerprints.**
  - Run: `... cargo test --release dungeon::generate`. Expected: PASS.
  - Run the full suite. Both fingerprint tests now fail, because of the barrel ids and positions and the solids in the fight. Replace their expected vectors with the printed values.
  - Add the comment `// Updated with barrels (2026-10-14).`.
  - Run again. Expected: all pass, including `run_simulates_without_panicking` and `wide_bosses_reach_every_spot_of_their_hall_around_the_chasms`. If the wide-boss test now fails because a barrel blocks a spot, keep barrels 3 tiles apart in the hall and away from the pits (raise the `<= 2` gap to `<= 3`), then rerun.

- [ ] **Step 5: Commit** with the message "Barrels in the dungeon: groups in rooms, a few in the boss hall".

### Task 16: Client: the barrel view, explosion, E hint and predictor solids

**Files:**
- Create: `client/src/game/barrel.ts`
- Modify: `client/src/game/GameScene.ts`:
  - draw dispatch
  - `barrelViews`
  - Boom k 7
  - E hint
  - predictor solids in `onSnapshot`
  - bar skip

**Interfaces:**
- Consumes: `KIND.Barrel`, `CONST.BARREL_RADIUS`, `CONST.BARREL_FUSE`, `CONST.USE_REACH`, `CONST.FALL_TIME`, `CONST.DROWN_TIME`, `CONST.PLAYER_RADIUS`.
- Produces: `class BarrelView { root; update(x, y, anim, animMs, dt): void; destroy(): void }`.

- [ ] **Step 1: Create `client/src/game/barrel.ts`:**

```ts
// An explosive barrel. Until CC0 barrel art is chosen, the pack's crate stands in.
// Server anim: 0 resting, 1 fuse burning (anim_ms since lit), 2 falling into a
// chasm, 3 sinking in deep water (anim_ms since it started).
import Phaser from 'phaser';
import { CONST } from '../generated/defs';
import { DEPTH } from './effects';

const FRAME = 'crate';

export class BarrelView {
  readonly root: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Sprite;
  private shadow: Phaser.GameObjects.Ellipse;

  constructor(scene: Phaser.Scene) {
    this.shadow = scene.add.ellipse(0, 0, 13, 5, 0x000000, 0.4);
    this.body = scene.add.sprite(0, 1, 'atlas', FRAME).setOrigin(0.5, 1);
    this.root = scene.add.container(0, 0, [this.shadow, this.body]);
  }

  update(x: number, y: number, anim: number, animMs: number): void {
    const t = animMs / 1000;
    this.root.setPosition(Math.round(x), Math.round(y)).setDepth(DEPTH.entityBase + y);
    this.body.clearTint().setScale(1).setAlpha(1).setY(1);
    this.shadow.setVisible(true);
    if (anim === 1) {
      // The fuse: flashes faster as it burns down.
      const rate = 6 + (t / CONST.BARREL_FUSE) * 18;
      if (Math.floor(t * rate) % 2 === 0) this.body.setTintFill(0xfff0c0);
      this.root.x += Math.round(Math.sin(t * 90));
    } else if (anim === 2) {
      const k = Math.min(1, t / CONST.FALL_TIME);
      this.body.setScale(1 - 0.8 * k).setAlpha(1 - k);
      this.shadow.setVisible(false);
    } else if (anim === 3) {
      const k = Math.min(1, t / CONST.DROWN_TIME);
      this.body.setY(1 + 10 * k).setAlpha(1 - k);
      this.shadow.setVisible(false);
    }
  }

  destroy(): void {
    this.root.destroy();
  }
}
```

- [ ] **Step 2: Wire it into `GameScene.ts`.**
  - Add the field `private barrelViews = new Map<number, BarrelView>();`, the destroy loop `for (const [id, v] of this.barrelViews) if (!seen.has(id)) (v.destroy(), this.barrelViews.delete(id));`, and the dispatch `else if (e.kind === KIND.Barrel) this.drawBarrel(e);` next to the chest.
  - The method:

```ts
  private drawBarrel(e: EntState): void {
    let view = this.barrelViews.get(e.id);
    if (!view) {
      view = new BarrelView(this);
      this.barrelViews.set(e.id, view);
    }
    view.update(e.x, e.y, e.anim, e.animMs);
  }
```
  - In `drawBarsAndBeams`, skip `e.kind === KIND.Barrel` (no health bar).
  - In `onEvent` `'Boom'`, add before the final `else`: `else if (ev.k === 7) { this.fx.explosion(ev.x, ev.y, ev.r, 0xffa030); this.fx.burst(ev.x, ev.y, 18, 0x8a5a2a, 70); this.cameras.main.shake(120, 0.004); }`. If `explosion` has no colour parameter, check `effects.ts` for its signature; the boss death already passes `0xffe060`, so it takes one.
  - **Predictor solids**, in `onSnapshot` before `reconcile`:

```ts
    this.pred.solids = s.ents.filter((e) => e[1] === KIND.Barrel && e[5] < 2).map((e) => ({ x: e[2], y: e[3], half: CONST.BARREL_RADIUS }));
```
  - **E hint:** add a field `private useHint!: Phaser.GameObjects.Text;`. Create it in `create()` with `this.add.text(0, 0, 'E', { fontFamily: 'monospace', fontSize: '8px', color: '#ffffff', stroke: '#000000', strokeThickness: 2 }).setOrigin(0.5, 1).setVisible(false).setDepth(DEPTH.ui ?? 10000)`. Use whatever top depth `effects.ts` `DEPTH` offers for floating text. Then in `update` after the draw loop:

```ts
    let hint: EntState | null = null;
    if (this.alive) {
      let best = Infinity;
      for (const e of this.ents.values()) {
        if (e.kind !== KIND.Barrel || e.anim >= 2) continue;
        const gap = Math.hypot(e.x - px, e.y - py) - CONST.BARREL_RADIUS - CONST.PLAYER_RADIUS;
        if (gap <= CONST.USE_REACH && gap < best) (best = gap), (hint = e);
      }
    }
    this.useHint.setVisible(hint !== null);
    if (hint) this.useHint.setPosition(Math.round(hint.x), Math.round(hint.y - 26));
```

- [ ] **Step 3: Run the client checks.** Run: `cd client && npm run build && npm test`. Expected: clean.

- [ ] **Step 4: Run the game and look.** Use the **run** skill, or `npm run dev` plus the server per README.
  - Open a run, find a barrel group, and check each of these:
    - The E hint shows within reach.
    - E pushes the barrel.
    - A shot lights the barrel and it flashes.
    - A chain explodes in sequence.
    - An enemy is blown into a chasm.
    - Walking along barrels shows no visible snaps (F3 debug shows corrections).
  - Take a screenshot for the user.

- [ ] **Step 5: Commit** with the message "Client: barrels, their explosion, the E hint and solids in prediction".

### Task 17: Barrel art (CC0), with the user's choice

**Files:**
- Create: `client/assets-src/<set>/` (art plus licence), only if the user approves.
- Modify:
  - `client/scripts/build-atlas.ts`, if new sheets need registering
  - `client/src/game/barrel.ts` (`FRAME`)
  - `README.md` (credits)

- [ ] **Step 1: Search** for CC0 16 px dungeon barrels (and optionally an explosion sheet) in the 0x72 style, for example on OpenGameArt and itch.io with a CC0 filter. Collect 2–4 candidates, each with its URL, licence text and a preview.
- [ ] **Step 2: Show the candidates to the user** and stop until they pick one (or keep the crate stand-in).
- [ ] **Step 3: If approved,** do the following:
  - Copy the art and its licence file into `client/assets-src/<set>/`. If the user drops files into `images/`, copy from there and leave `images/` as it is.
  - Register it in the atlas build like the other sets.
  - Set `FRAME` in `barrel.ts`.
  - Add the credit to the README Art section.
  - Then run `npm run build && npm test`.
- [ ] **Step 4: Commit** with the message "Barrel art: <set> (CC0)".

### Task 18: Docs, TODO and handoff

**Files:**
- Modify:
  - `docs/TECHNICAL.md`
  - `docs/PLAYER_GUIDE.md`
  - `docs/TODO.md`
  - `HANDOFF.md`

- [ ] **Step 1: Update `TECHNICAL.md`:**
  - The damage model: types, splits, resistances, `resolve`, the floor, healing.
  - The entity-type table with its adjustments.
  - World objects (`run/objects.rs`): state per kind, `hurt_object`, `use_object`, snapshot anims.
  - Solids in collision and prediction.
  - Monster knockback and terrain deaths.
  - Barrel placement (stream 11).
  - Protocol: `Dmg.ty/imm`, `InputW.act`, `Boom k 7`, monster `Sink`.
  - Tests.
- [ ] **Step 2: Update `PLAYER_GUIDE.md`:**
  - Barrels: what lights them, the chain, pushing them with E, terrain.
  - Damage types and resistances (what the colours mean, "immune").
  - That enemies shoot barrels next to you.
- [ ] **Step 3: Update `TODO.md`:**
  - Remove priorities 1 and 2 and renumber the list.
  - Add follow-ups: thrown or pushed objects dealing damage; more object kinds (crates, levers, torches use `use_object`); tuning barrel numbers and resistances in the balancing pass; the open armour questions.
  - Update "Enemies in terrain" (now done for blasts).
- [ ] **Step 4: Update `HANDOFF.md`.** Write a "Next item" section for the light-source system (now the top of the list), then a section for this feature: branch, what was built, the deviations from the spec, what the user confirmed live, and the open points.
- [ ] **Step 5: Run the full checks one last time.**
  - Server: `MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test`, then `docker compose -f docker-compose.test.yml down`.
  - Client: `cd client && npm run build && npm test`.
- [ ] **Step 6: Commit** with the message "Docs and handoff: damage types, world objects, barrels".
