# Level Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate a run from the single level type "dungeon + boss" so future level types (escort, riddle, …) plug in as new files, with behaviour, maps and wire format unchanged.

**Architecture:** A `Level` enum on `Run` (one variant per level type, today only `Dungeon`) dispatches to a `LevelRules` trait whose hooks are *associated functions taking `&mut Run`* with default no-op bodies, so a level's state stays inside `run.level` while hooks run (bosses read `boss_ent` from it mid-tick). The boss fight becomes a reusable `BossEncounter`. `Run` only knows a shared `Layout` (map, spawns, chests, player spawns); the dungeon's rooms stay in `DungeonLevel`. Protocol, DB, stats and the client gain a `level` while `boss` becomes optional.

**Tech Stack:** Rust (axum, tokio, sqlx/PostgreSQL, ts-rs, rand_chacha), TypeScript client (Phaser, vitest).

**Spec:** `docs/superpowers/specs/2026-10-13-level-split-design.md`

## Global Constraints

- Pure refactor: every seed produces the same map, spawns, entity ids, boss and behaviour as before.
- Rng: the boss pick keeps using `ChaCha8Rng::seed_from_u64(seed ^ 0x5eed)` (the same rng then becomes `Run.rng`); `generate` and its rng streams are not touched.
- `client/src/generated/wire-fixtures.json` and `fixtures.json` must be byte-identical after `cargo test` (`git diff --exit-code` on them).
- Snapshot / `BossBar` / `SnapW` unchanged.
- `SelectBoss` stays; no `SelectLevel`, no lobby level picker.
- Licences: no new dependencies.
- Desktop only; no phone checks.
- Server tests: `MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test` (append `cargo test --release <filter>` to run a subset), then `docker compose -f docker-compose.test.yml down`. It regenerates `client/src/generated/*` — commit those.
- Client: `cd client && npm run build && npm test`.
- Name clash: `AdminStats.levels` already exists (upgrade histogram, `LevelBucket`). The per-level run table is therefore `AdminStats.level_runs: Vec<LevelRunStats>` (the spec's "`levels`" is renamed for this reason).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Entity ids and spawn order:** the boss must still be spawned last in `Run::new` (after enemies, chests, mimics) so `boss_ent` and every id match. Pinned by the fingerprint test (Task 1).
2. **Boss tick vs. hall check order inside `step`:** the boss behaviour tick stays where it was (before `separate_monsters`), the wake/seal check stays after `retain` and before `check_end`. Two hooks (`tick`, `post_tick`), not one. Pinned by the fingerprint-after-steps test (Task 1).
3. **Lich `spawn_extras` reads `boss_ent` during spawn:** `boss_ent` must be stored in `run.level` *before* `spawn_extras` runs. Pinned by existing lich tests + fingerprint.
4. **Old DB rows / NULL boss:** rows from before migration 0004 read as `Dungeon`; a run with `boss = NULL` must record and show in stats ("Dungeon" row without " – boss"). Pinned in Task 4.
5. **A level with no boss:** no boss bar, empty debug path (not a panic), defeat when all dead, `RunEnded.boss == null`, end screen uses level text. Pinned by the test level (Task 2) and the HUD test (Task 3).

---

### Task 1: Characterization fingerprint + `Layout` split

**Files:**
- Modify: `server/src/dungeon/mod.rs` (add `Layout`, `DungeonParts`, `Dungeon::split`)
- Modify: `server/src/run/mod.rs` (tests module: fingerprint tests)

**Interfaces:**
- Produces: `pub struct Layout { pub map: Map, pub spawns: Vec<Spawn>, pub chests: Vec<ChestSpawn>, pub player_spawns: Vec<Vec2> }` (derive `Debug, Clone`); `pub struct DungeonParts { pub rooms: Vec<Room>, pub start: usize, pub boss: usize, pub door: Vec<(i32, i32)> }` (derive `Debug, Clone`) with `pub fn boss_hall(&self) -> &Rect`; `impl Dungeon { pub fn split(self) -> (Layout, DungeonParts) }`.
- Produces (tests): `fn fingerprint(run: &Run) -> u64` in `run::tests`, and two tests with hard-coded values.

- [ ] **Step 1: Write the fingerprint tests on the OLD code** (in `run/mod.rs` `mod tests`):

```rust
    /// FNV-1a over everything a level setup decides, so the level refactor
    /// can prove it changed nothing.
    fn fingerprint(run: &Run) -> u64 {
        let mut h: u64 = 0xcbf29ce484222325;
        let mut eat = |v: u64| {
            for b in v.to_le_bytes() {
                h ^= b as u64;
                h = h.wrapping_mul(0x100000001b3);
            }
        };
        for &t in &run.dungeon.map.tiles {
            eat(t as u64);
        }
        for m in &run.monsters {
            eat(m.id as u64);
            eat(m.kind as u64);
            eat(m.pos.x.to_bits());
            eat(m.pos.y.to_bits());
            eat(m.hp.to_bits());
            eat(m.is_boss as u64);
            eat(m.asleep as u64);
        }
        for c in &run.chests {
            eat(c.id as u64);
            eat(c.pos.x.to_bits());
        }
        for p in &run.players {
            eat(p.id as u64);
            eat(p.mv.x.to_bits());
            eat(p.mv.y.to_bits());
            eat(p.hp.to_bits());
        }
        eat(run.next_id as u64);
        h
    }

    fn random_boss_run(seed: u64) -> Run {
        let (tx, _rx) = unbounded_channel();
        std::mem::forget(_rx);
        let members = vec![Member { conn: 1, name: "p0".into(), class: ClassId::Paladin, tx, account: None, character: None, upgrades: StatUpgrades::default() }];
        Run::new(1, members, seed, None)
    }

    #[test]
    fn level_setup_is_unchanged() {
        let got: Vec<u64> = (0..6).map(|s| fingerprint(&random_boss_run(s))).collect();
        assert_eq!(got, vec![/* filled in Step 2 */]);
    }

    #[test]
    fn simulation_is_unchanged_after_waking_the_boss() {
        let mut got = Vec::new();
        for boss in BossId::ALL {
            let mut run = test_run(&[ClassId::Paladin, ClassId::Wizard], boss);
            let hall = run.dungeon.boss_hall().center_px();
            for p in &mut run.players {
                p.mv.x = hall.x;
                p.mv.y = hall.y + 40.0;
            }
            for _ in 0..300 {
                run.step();
            }
            got.push(fingerprint(&run));
        }
        assert_eq!(got, vec![/* filled in Step 2 */]);
    }
```

- [ ] **Step 2: Record the values on the old code.** Run `MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test cargo test --release level_setup_is_unchanged simulation_is_unchanged -- --nocapture` (cargo takes one filter; run the two names separately if needed). Both fail with an `assert_eq` diff that prints `left: [..]`. Paste each `left` vector into its `vec![]`. Re-run: both PASS. Also add `assert_ne!(got[0], got[1])` to the first test so it proves the fingerprint varies.

- [ ] **Step 3: Write a failing split test** in `server/src/dungeon/generate.rs` tests:

```rust
    #[test]
    fn split_keeps_every_part() {
        for seed in 0..20u64 {
            let d = generate(seed, if seed % 2 == 0 { Theme::Water } else { Theme::Lava });
            let (hall, door, tiles) = (*d.boss_hall(), d.door.clone(), d.map.tiles.clone());
            let (n_sp, n_ch, ps) = (d.spawns.len(), d.chests.len(), d.player_spawns.clone());
            let (layout, parts) = d.split();
            assert_eq!(layout.map.tiles, tiles);
            assert_eq!((layout.spawns.len(), layout.chests.len(), layout.player_spawns.clone()), (n_sp, n_ch, ps));
            assert_eq!((*parts.boss_hall(), parts.door.clone()), (hall, door));
        }
    }
```
(`Rect` needs `PartialEq`; add it to its derive if missing.) Run it: FAIL (no `split`).

- [ ] **Step 4: Implement** in `dungeon/mod.rs`, below `impl Dungeon`:

```rust
/// The map data every level type shares; `Run` only knows this.
#[derive(Debug, Clone)]
pub struct Layout {
    pub map: Map,
    pub spawns: Vec<Spawn>,
    pub chests: Vec<ChestSpawn>,
    pub player_spawns: Vec<Vec2>,
}

/// What only the room-and-corridor dungeon has.
#[derive(Debug, Clone)]
pub struct DungeonParts {
    pub rooms: Vec<Room>,
    pub start: usize,
    pub boss: usize,
    /// Door tiles between the boss hall and its corridor.
    pub door: Vec<(i32, i32)>,
}

impl DungeonParts {
    pub fn boss_hall(&self) -> &Rect {
        &self.rooms[self.boss].rect
    }
}

impl Dungeon {
    pub fn split(self) -> (Layout, DungeonParts) {
        let Dungeon { map, rooms, start, boss, door, spawns, chests, player_spawns } = self;
        (Layout { map, spawns, chests, player_spawns }, DungeonParts { rooms, start, boss, door })
    }
}
```

- [ ] **Step 5:** Run `split_keeps_every_part`: PASS. Run the whole suite: 152 tests PASS.

- [ ] **Step 6: Commit** `git add server/src && git commit -m "Level split: fingerprint tests, Layout and Dungeon::split"` (+ Co-Authored-By line).

---

### Task 2: Server core — `Level`, `LevelRules`, `BossEncounter`, `DungeonLevel`

**Files:**
- Create: `server/src/run/levels/mod.rs`, `server/src/run/levels/boss.rs`, `server/src/run/levels/dungeon.rs`
- Modify: `server/src/protocol.rs` (add `LevelId`, `LevelChoice`)
- Modify: `server/src/run/mod.rs` (fields, `new`, `step`, `hurt_monster`, `kill_monster`, `check_end`, `end_msg`, `record`, `run_task` span, test helpers; remove `spawn_boss`, `check_boss_hall`)
- Modify: `server/src/run/bosses/mod.rs` (`boss_idx`), `bosses/lich.rs` (`boss_ent`, test `boss_awake`), `bosses/dragon.rs` (map path)
- Modify: `server/src/run/visibility.rs`, `server/src/run/debug.rs`, `server/src/run/ai.rs`, `server/src/run/abilities.rs` (mechanical `.dungeon.` → `.layout.` / encounter)
- Modify: `server/src/lobby.rs` (call site + log line only)

**Interfaces:**
- Consumes: `Layout`, `DungeonParts`, `Dungeon::split` (Task 1).
- Produces:
  - `protocol::LevelId { Dungeon }` — `#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)] #[ts(export)]`.
  - `protocol::LevelChoice { Dungeon { boss: Option<BossId> } }` — same derives minus `Copy`/`Hash`, `#[serde(tag = "level")]`.
  - `run::levels::{Level, LevelRules, BossEncounter, DungeonLevel}`; `Level::build(seed: u64, choice: &LevelChoice, rng: &mut ChaCha8Rng) -> (Layout, Level)`; `Level::id(&self) -> LevelId`; `Level::boss(&self) -> Option<&BossEncounter>`; `Level::boss_mut(&mut self) -> Option<&mut BossEncounter>`; `Level::boss_id(&self) -> Option<BossId>`; `Level::enemy_type(&self, t: EnemyType) -> EnemyType`; dispatchers `Level::populate/tick/post_tick/on_killed/on_monster_hurt/failed/debug_target/boss_bar` (associated fns taking `run`).
  - `Run { layout: Layout, level: Level, .. }` (no `dungeon`, `boss_id`, `boss_ent`, `boss`, `boss_awake`, `door_closed`); `Run::new(id, members, seed, choice: LevelChoice)`.
  - `RunRecord` unchanged in this task (still `boss: BossId`, filled with `run.level.boss_id().expect(..)`... see Step 6).

- [ ] **Step 1: Write the failing tests** in `run/levels/mod.rs` (module skeleton with `#[cfg(test)] mod tests`). The test level is a `#[cfg(test)]` enum variant using only defaults:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::dungeon::generate::{generate, Theme};
    use crate::protocol::{BossId, ClassId, LevelId, ServerMsg};
    use crate::run::tests::test_run;
    use rand::{Rng, SeedableRng};

    #[test]
    fn dungeon_build_matches_the_generator() {
        for seed in 0..12u64 {
            for boss in BossId::ALL {
                let mut rng = ChaCha8Rng::seed_from_u64(seed ^ 0x5eed);
                let (layout, level) = Level::build(seed, &LevelChoice::Dungeon { boss: Some(boss) }, &mut rng);
                let (want, parts) = generate(seed, Theme::for_boss(boss)).split();
                assert_eq!(layout.map.tiles, want.map.tiles);
                assert_eq!(layout.player_spawns, want.player_spawns);
                assert_eq!(level.boss().unwrap().arena, *parts.boss_hall());
                assert_eq!(level.boss_id(), Some(boss));
            }
        }
    }

    #[test]
    fn random_boss_uses_the_run_rng_like_before() {
        for seed in 0..12u64 {
            let mut rng = ChaCha8Rng::seed_from_u64(seed ^ 0x5eed);
            let want = BossId::ALL[ChaCha8Rng::seed_from_u64(seed ^ 0x5eed).gen_range(0..BossId::ALL.len())];
            let (_, level) = Level::build(seed, &LevelChoice::Dungeon { boss: None }, &mut rng);
            assert_eq!(level.boss_id(), Some(want));
        }
    }

    #[test]
    fn a_level_without_rules_uses_the_defaults() {
        let mut run = test_run(&[ClassId::Paladin, ClassId::Wizard], BossId::Demon);
        run.monsters.retain(|m| !m.is_boss);
        run.level = Level::Test;
        assert!(Level::boss_bar(&run).is_none());
        assert!(Level::debug_target(&run).is_none());
        assert!(crate::run::debug::boss_path(&run, 0).is_empty(), "no target, no path");
        assert!(run.level.boss().is_none());
        for _ in 0..10 {
            run.step();
        }
        assert!(run.ended.is_none());
        for p in &mut run.players {
            p.alive = false;
        }
        run.step();
        assert_eq!(run.ended.map(|e| e.0), Some(false), "everyone dead = defeat");
        let ServerMsg::RunEnded { boss, .. } = run.end_msg(false) else { panic!() };
        assert_eq!(boss, None);
    }
}
```
(`RunEnded.boss` becomes `Option` in Task 3; until then this last assertion is written as `assert!(run.level.boss_id().is_none())` and replaced in Task 3 Step 1.)

- [ ] **Step 2:** Run: FAIL (module/types missing).

- [ ] **Step 3: Protocol types** in `protocol.rs` after `BossId`:

```rust
/// Which kind of level a run plays.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum LevelId {
    Dungeon,
}

/// A level and its options, as the lobby starts it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "level")]
#[ts(export)]
pub enum LevelChoice {
    /// `boss: None` = random end boss.
    Dungeon { boss: Option<BossId> },
}
```

- [ ] **Step 4: `run/levels/mod.rs`:**

```rust
//! Level types. A level decides the map, what spawns besides the shared
//! enemies and chests, and how the run is won or lost. Adding one: a new file
//! implementing `LevelRules` (only the hooks it needs), a `Level` variant, a
//! `LevelId`/`LevelChoice` entry, and one arm in each `match` below.

pub mod boss;
pub mod dungeon;

pub use boss::BossEncounter;
pub use dungeon::DungeonLevel;

use super::Run;
use crate::defs::enemies::EnemyType;
use crate::dungeon::Layout;
use crate::math::Vec2;
use crate::protocol::{BossBar, BossId, LevelChoice, LevelId};
use rand_chacha::ChaCha8Rng;

/// Hooks are associated functions on the whole run, so a level's state stays
/// in `run.level` while they run (boss behaviours read `boss_ent` from it).
pub trait LevelRules {
    /// Spawns the level's own monsters after the shared enemies and chests.
    fn populate(_run: &mut Run, _party: usize) {}
    /// Before monster separation, where boss behaviours act.
    fn tick(_run: &mut Run, _dt: f64) {}
    /// After the step's clean-up, before the end check (wake-ups, doors).
    fn post_tick(_run: &mut Run) {}
    /// A monster died; may end the run (`run.ended`).
    fn on_killed(_run: &mut Run, _id: u32) {}
    /// A boss monster is about to take damage; false = immune.
    fn on_boss_hurt(_run: &mut Run, _mi: usize) -> bool {
        true
    }
    fn failed(run: &Run) -> bool {
        !run.players.iter().any(|p| p.alive)
    }
    /// Where the debug path leads.
    fn debug_target(_run: &Run) -> Option<Vec2> {
        None
    }
    fn boss_bar(_run: &Run) -> Option<BossBar> {
        None
    }
}

pub enum Level {
    Dungeon(DungeonLevel),
    /// Only default hooks: proves a level without a boss works.
    #[cfg(test)]
    Test,
}

#[cfg(test)]
pub struct TestLevel;
#[cfg(test)]
impl LevelRules for TestLevel {}

macro_rules! dispatch {
    ($level:expr, $f:ident($($a:expr),*)) => {
        match $level {
            Level::Dungeon(_) => DungeonLevel::$f($($a),*),
            #[cfg(test)]
            Level::Test => TestLevel::$f($($a),*),
        }
    };
}

impl Level {
    pub fn build(seed: u64, choice: &LevelChoice, rng: &mut ChaCha8Rng) -> (Layout, Level) {
        match choice {
            LevelChoice::Dungeon { boss } => {
                let (layout, d) = DungeonLevel::build(seed, *boss, rng);
                (layout, Level::Dungeon(d))
            }
        }
    }

    pub fn id(&self) -> LevelId {
        match self {
            Level::Dungeon(_) => LevelId::Dungeon,
            // The test level is not a protocol level (ts-rs exports in test builds).
            #[cfg(test)]
            Level::Test => LevelId::Dungeon,
        }
    }

    pub fn boss(&self) -> Option<&BossEncounter> {
        match self {
            Level::Dungeon(d) => Some(&d.boss),
            #[cfg(test)]
            Level::Test => None,
        }
    }

    pub fn boss_mut(&mut self) -> Option<&mut BossEncounter> {
        match self {
            Level::Dungeon(d) => Some(&mut d.boss),
            #[cfg(test)]
            Level::Test => None,
        }
    }

    pub fn boss_id(&self) -> Option<BossId> {
        self.boss().map(|b| b.boss_id)
    }

    /// The level's version of a generic enemy (demon dungeon: imps for archers, …).
    pub fn enemy_type(&self, t: EnemyType) -> EnemyType {
        self.boss_id().map_or(t, |b| crate::defs::enemies::for_boss(t, b))
    }

    pub fn populate(run: &mut Run, party: usize) { dispatch!(run.level, populate(run, party)) }
    pub fn tick(run: &mut Run, dt: f64) { dispatch!(run.level, tick(run, dt)) }
    pub fn post_tick(run: &mut Run) { dispatch!(run.level, post_tick(run)) }
    pub fn on_killed(run: &mut Run, id: u32) { dispatch!(run.level, on_killed(run, id)) }
    pub fn on_boss_hurt(run: &mut Run, mi: usize) -> bool { dispatch!(run.level, on_boss_hurt(run, mi)) }
    pub fn failed(run: &Run) -> bool { dispatch!(run.level, failed(run)) }
    pub fn debug_target(run: &Run) -> Option<Vec2> { dispatch!(run.level, debug_target(run)) }
    pub fn boss_bar(run: &Run) -> Option<BossBar> { dispatch!(run.level, boss_bar(run)) }
}
```
Note: `match run.level { Level::Dungeon(_) => DungeonLevel::tick(run, dt) }` borrows `run.level` only for the discriminant check; if the borrow checker complains, match on `&run.level` with `Level::Dungeon(_)` patterns — the binding is unused so the borrow ends before the arm. Run `rustfmt` style per surrounding code (one-line fns are fine there).

- [ ] **Step 5: `run/levels/boss.rs`** — code moved from `Run::spawn_boss`, the boss part of `step`, `hurt_monster`, `kill_monster`, `check_boss_hall`, `visibility.rs` and `debug.rs`, unchanged in behaviour:

```rust
//! A boss fight in a sealable arena. Any level can include one.

use crate::defs::bosses as boss_defs;
use crate::defs::enemies::EnemyType;
use crate::defs::kinds::Anim;
use crate::dungeon::{Mover, Rect, Tile};
use crate::math::Vec2;
use crate::protocol::{BossBar, BossId, Ev};
use crate::run::bosses::{self, BossBehaviour};
use crate::run::entities::*;
use crate::run::{Run, END_DELAY};
use std::collections::VecDeque;

pub struct BossEncounter {
    pub boss_id: BossId,
    /// Entity id of the boss monster (0 until spawned).
    pub boss_ent: u32,
    /// Taken out while it ticks, like before.
    pub behaviour: Option<Box<dyn BossBehaviour>>,
    pub awake: bool,
    /// The hall: entering wakes the boss, all heroes inside seals the door.
    pub arena: Rect,
    pub door: Vec<(i32, i32)>,
    pub door_closed: bool,
}

impl BossEncounter {
    pub fn new(boss_id: BossId, arena: Rect, door: Vec<(i32, i32)>) -> Self {
        BossEncounter { boss_id, boss_ent: 0, behaviour: None, awake: false, arena, door, door_closed: false }
    }
}

fn enc(run: &Run) -> &BossEncounter {
    run.level.boss().expect("level has a boss encounter")
}
fn enc_mut(run: &mut Run) -> &mut BossEncounter {
    run.level.boss_mut().expect("level has a boss encounter")
}

/// Spawns the sleeping boss in the arena centre, then its extras.
pub fn spawn(run: &mut Run, party: usize) {
    let boss_id = enc(run).boss_id;
    let d = boss_defs::def(boss_id);
    let pos = enc(run).arena.center_px();
    let id = run.alloc_id();
    let hp = d.hp * boss_defs::hp_scale(party);
    run.monsters.push(Monster {
        // fields exactly as in today's `Run::spawn_boss`, with
        // `mover: if boss_id == BossId::Demon { Mover::Demon } else { Mover::Enemy }`
        ..
    });
    enc_mut(run).boss_ent = id;
    let mut behaviour = bosses::create(boss_id);
    behaviour.spawn_extras(run, pos, party);
    enc_mut(run).behaviour = Some(behaviour);
}
```
(Copy the full `Monster { .. }` literal from `run/mod.rs:276-298` verbatim — the `..` above is only to keep the plan short; the struct has no `Default`.)

```rust
pub fn tick(run: &mut Run, dt: f64) {
    if enc(run).awake {
        if let Some(mut b) = enc_mut(run).behaviour.take() {
            b.tick(run, dt);
            enc_mut(run).behaviour = Some(b);
        }
    }
}

/// Wake on entry, seal the door once every living hero is inside.
pub fn check_arena(run: &mut Run) {
    let hall = enc(run).arena;
    let alive: Vec<Vec2> = run.players.iter().filter(|p| p.alive).map(|p| p.pos()).collect();
    if !enc(run).awake && alive.iter().any(|p| hall.contains(*p)) {
        enc_mut(run).awake = true;
        // Mimics elsewhere keep their disguise.
        for m in run.monsters.iter_mut().filter(|m| m.etype != Some(EnemyType::Mimic)) {
            m.asleep = false;
        }
        let text = match enc(run).boss_id {
            BossId::Demon => "A demon awakens!",
            BossId::Lich => "The lich rises - slay its disciples!",
            BossId::Dragon => "The dragon awakens!",
        };
        run.event(Ev::Msg { text: text.into() }, None);
    }
    if enc(run).awake && !enc(run).door_closed && !alive.is_empty() && alive.iter().all(|p| hall.contains(*p)) {
        enc_mut(run).door_closed = true;
        for (x, y) in enc(run).door.clone() {
            run.layout.map.set(x, y, Tile::DoorClosed);
            run.event(Ev::Tile { x: x as u16, y: y as u16, v: Tile::DoorClosed as u8 }, None);
        }
    }
}

/// Immunity and wake-on-hit; false = the hit is refused.
pub fn on_hurt(run: &mut Run, mi: usize) -> bool {
    let immune = enc(run).behaviour.as_ref().map_or(false, |b| !b.can_be_damaged(run));
    if immune {
        let pos = run.monsters[mi].pos;
        run.event(Ev::Immune { x: pos.x as f32, y: pos.y as f32 }, Some(pos));
        return false;
    }
    enc_mut(run).awake = true;
    run.monsters[mi].asleep = false;
    true
}

/// Killing the boss wins the run.
pub fn on_killed(run: &mut Run, id: u32) {
    if id == enc(run).boss_ent && run.ended.is_none() {
        run.ended = Some((true, run.time + END_DELAY));
        run.event(Ev::Msg { text: "The boss is defeated!".into() }, None);
    }
}

/// The boss while it lives, else the arena centre.
pub fn debug_target(run: &Run) -> Vec2 {
    let e = enc(run);
    run.monsters.iter().find(|m| m.id == e.boss_ent && m.alive).map_or_else(|| e.arena.center_px(), |m| m.pos)
}

pub fn bar(run: &Run) -> Option<BossBar> {
    let e = enc(run);
    if !e.awake {
        return None;
    }
    let immune = e.behaviour.as_ref().map_or(false, |b| !b.can_be_damaged(run));
    let enraged = e.behaviour.as_ref().map_or(false, |b| b.enraged());
    let (hp, max) = run.monsters.iter().find(|m| m.id == e.boss_ent).map_or((0.0, 1.0), |m| (m.hp, m.max_hp));
    Some(BossBar { kind: e.boss_id, hp: hp as f32, max_hp: max as f32, immune, enraged })
}
```
Make `END_DELAY` `pub(crate)` in `run/mod.rs`. Check the unused imports (`Anim`, `VecDeque`, `Mover`) are used by the copied `Monster` literal.

- [ ] **Step 6: `run/levels/dungeon.rs`:**

```rust
//! The room-and-corridor dungeon with an end boss in its hall.

use super::{boss, BossEncounter, LevelRules};
use crate::dungeon::generate::{generate, Theme};
use crate::dungeon::{Layout, Room};
use crate::math::Vec2;
use crate::protocol::{BossBar, BossId};
use crate::run::Run;
use rand::Rng;
use rand_chacha::ChaCha8Rng;

pub struct DungeonLevel {
    pub rooms: Vec<Room>,
    pub start: usize,
    pub boss: BossEncounter,
}

impl DungeonLevel {
    /// Picks the boss first (random from the run's rng, as before), then generates its dungeon.
    pub fn build(seed: u64, boss: Option<BossId>, rng: &mut ChaCha8Rng) -> (Layout, DungeonLevel) {
        let boss_id = boss.unwrap_or_else(|| BossId::ALL[rng.gen_range(0..BossId::ALL.len())]);
        let (layout, parts) = generate(seed, Theme::for_boss(boss_id)).split();
        let encounter = BossEncounter::new(boss_id, *parts.boss_hall(), parts.door);
        (layout, DungeonLevel { rooms: parts.rooms, start: parts.start, boss: encounter })
    }
}

impl LevelRules for DungeonLevel {
    fn populate(run: &mut Run, party: usize) {
        boss::spawn(run, party);
    }
    fn tick(run: &mut Run, dt: f64) {
        boss::tick(run, dt);
    }
    fn post_tick(run: &mut Run) {
        boss::check_arena(run);
    }
    fn on_killed(run: &mut Run, id: u32) {
        boss::on_killed(run, id);
    }
    fn on_boss_hurt(run: &mut Run, mi: usize) -> bool {
        boss::on_hurt(run, mi)
    }
    fn debug_target(run: &Run) -> Option<Vec2> {
        Some(boss::debug_target(run))
    }
    fn boss_bar(run: &Run) -> Option<BossBar> {
        boss::bar(run)
    }
}
```
Note `parts.boss_hall()` borrows before `parts.door` moves — take the `Rect` copy first (as written: `*parts.boss_hall()` is evaluated as an argument before `parts.door`; if the borrow checker objects, bind `let hall = *parts.boss_hall();` first).

- [ ] **Step 7: Rewire `run/mod.rs`:**
  - `pub mod levels;` and `use levels::Level;`; imports: drop `generate, Theme`, `bosses::BossBehaviour`; add `crate::dungeon::Layout`, `LevelChoice`.
  - Struct: replace `pub dungeon: Dungeon` with `pub layout: Layout` and `pub level: Level`; delete the five boss fields.
  - `Run::new(id, members, seed, choice: LevelChoice)`:
    ```rust
    let mut rng = ChaCha8Rng::seed_from_u64(seed ^ 0x5eed);
    let (layout, level) = Level::build(seed, &choice, &mut rng);
    let (w, h) = (layout.map.w, layout.map.h);
    ```
    struct literal: `layout, level,` instead of the dungeon/boss fields; every `run.dungeon.X` → `run.layout.X`; enemy spawns: `let t = run.level.enemy_type(s.enemy);`; replace `run.spawn_boss(n);` with `Level::populate(&mut run, n);` (same position: last).
  - Delete `spawn_boss` and `check_boss_hall`.
  - `step`: replace the `if self.boss_awake { … }` block with `Level::tick(self, DT);` and `self.check_boss_hall();` with `Level::post_tick(self);`.
  - `hurt_monster`: replace the `if self.monsters[mi].is_boss { … }` body with
    ```rust
    if self.monsters[mi].is_boss && !Level::on_boss_hurt(self, mi) {
        return false;
    }
    ```
  - `kill_monster`: replace the `if id == self.boss_ent …` block with `Level::on_killed(self, id);`.
  - `check_end`: `if self.ended.is_none() && Level::failed(self) {`.
  - `end_msg` / `record`: `boss: self.level.boss_id().expect("dungeon runs have a boss")` for now (Task 3/4 make them `Option`).
  - `run_task` span: `fields(run = run.id, level = ?run.level.id(), boss = ?run.level.boss_id(), …)`.
  - Test helper `test_run_seed`: `Run::new(1, members, seed, LevelChoice::Dungeon { boss: Some(boss) })`; `random_boss_run`: `LevelChoice::Dungeon { boss: None }`; `fingerprint`: `run.layout.map.tiles`.
  - Tests in this file: `run.dungeon.boss_hall()` → `run.level.boss().unwrap().arena`; `run.boss_awake` → `run.level.boss().unwrap().awake`; `run.dungeon.` → `run.layout.`.
- [ ] **Step 8: Rewire the other users:**
  - `bosses/mod.rs` `boss_idx`: `let ent = run.level.boss().map_or(0, |b| b.boss_ent); run.monsters.iter().position(|m| m.id == ent && m.alive)` (ids start at 1, so 0 never matches).
  - `bosses/lich.rs:80`: `let owner = run.level.boss().unwrap().boss_ent;`; test line 197: `run.level.boss_mut().unwrap().awake = true;`.
  - `visibility.rs`: `boss_immune`/`boss_enraged` are still needed for monster flags (lines 113/116): compute them from `run.level.boss().and_then(|b| b.behaviour.as_ref())`; `boss_bar = Level::boss_bar(run)`; `drain_for(&fov, run.level.boss().map_or(false, |b| b.awake), &drain)`.
  - `debug.rs`: delete `boss_target`; `boss_path` becomes `Level::debug_target(run).map_or_else(Vec::new, |to| shortest_path(run, pi, to))`; `run.dungeon.map` → `run.layout.map`.
  - `ai.rs` test 473: `let r = run.level.boss().unwrap().arena;`. Everywhere in `run/`: `sed -i 's/\.dungeon\.\(map\|spawns\|chests\|player_spawns\)/.layout.\1/g'` over `server/src/run/**/*.rs` (36 `map`, 6 `player_spawns`, 3 `spawns`, 1 `chests` today).
  - `lobby.rs:341-343`: `let run = Run::new(rid, members, seed, LevelChoice::Dungeon { boss });` and the log `"run {rid} started: {} player(s), {:?} boss {:?}{}", run.players.len(), run.level.id(), run.level.boss_id(), …`.
  - Check: `grep -rn "boss_awake\|boss_ent\|door_closed\|\.dungeon\.\|spawn_boss\|check_boss_hall" server/src` only hits `levels/` and `dungeon/`.
- [ ] **Step 9:** Run the full server suite: all PASS, including `level_setup_is_unchanged`, `simulation_is_unchanged_after_waking_the_boss` and the 3 new level tests (155 tests). Then `git diff --exit-code client/src/generated/wire-fixtures.json client/src/generated/fixtures.json` → no diff. New generated files `LevelId.ts`, `LevelChoice.ts` appear: add them.
- [ ] **Step 10: Commit** `"Level split: Level enum, LevelRules hooks, BossEncounter, DungeonLevel"`.

---

### Task 3: Protocol plumbing and client end screen

**Files:**
- Modify: `server/src/protocol.rs` (`RunStartInfo.level`, `RunEnded`, `ServerMsg::Room.level`), `server/src/run/mod.rs` (`start_info`, `end_msg`), `server/src/lobby.rs` (`Room.level`, `send_room`)
- Modify: `client/src/ui/text.ts` (`LEVEL_TEXT`), `client/src/ui/hud.ts` (`showEnd`), `client/src/ui/lobby.ts` (local `Room` type)
- Create: `client/src/ui/endText.ts` + `client/src/ui/endText.test.ts`

**Interfaces:**
- Consumes: `LevelId`, `Run.level.id()`, `Run.level.boss_id()` (Task 2).
- Produces: `RunStartInfo { level: LevelId, .. }`; `ServerMsg::RunEnded { victory, level: LevelId, boss: Option<BossId>, time, stats, banked }`; `ServerMsg::Room { .., level: LevelId, boss }`; `lobby::Room.level: LevelId`; client `LEVEL_TEXT: Record<LevelId, { name: string; victory: string; defeat: string }>`, `endText(victory: boolean, level: LevelId, boss: BossId | null): string`.

- [ ] **Step 1: Failing tests.** Server, in `run/levels/mod.rs` test `a_level_without_rules_uses_the_defaults`, replace the temporary boss assertion with:
```rust
        let ServerMsg::RunEnded { boss, level, .. } = run.end_msg(false) else { panic!() };
        assert_eq!((boss, level), (None, LevelId::Dungeon));
```
And in `run/mod.rs` tests:
```rust
    #[test]
    fn start_and_end_messages_name_the_level_and_boss() {
        let run = test_run(&[ClassId::Wizard], BossId::Lich);
        let ServerMsg::RunStarted(info) = run.start_info(&run.players[0]) else { panic!() };
        assert_eq!(info.level, LevelId::Dungeon);
        let ServerMsg::RunEnded { level, boss, .. } = run.end_msg(true) else { panic!() };
        assert_eq!((level, boss), (LevelId::Dungeon, Some(BossId::Lich)));
    }
```
Client `client/src/ui/endText.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { endText } from './endText';

describe('endText', () => {
  it('names the slain boss on a dungeon win', () => {
    expect(endText(true, 'Dungeon', 'Lich')).toBe('Vael, the Undying Lich has been slain.');
  });
  it('keeps the dungeon defeat line', () => {
    expect(endText(false, 'Dungeon', 'Demon')).toBe('The dungeon claims another party.');
  });
  it('falls back to the level text when there is no boss', () => {
    expect(endText(true, 'Dungeon', null)).toBe('The dungeon is cleared.');
  });
});
```
- [ ] **Step 2:** Run the server filter `start_and_end_messages` and `npx vitest run src/ui/endText.test.ts`: both FAIL.
- [ ] **Step 3: Server.**
  - `RunStartInfo`: add `/// The level type (decides how the client reads the map later).` `pub level: LevelId,`; `start_info` sets `level: self.level.id()`.
  - `ServerMsg::RunEnded { victory: bool, level: LevelId, boss: Option<BossId>, time: f32, stats: Vec<PlayerStats>, banked: bool }` (doc: "`boss`: the level's end boss, if it has one"); `end_msg`: `level: self.level.id(), boss: self.level.boss_id()`.
  - `ServerMsg::Room { run_id, name, host, players, level: LevelId, boss: Option<BossId> }` (doc: "`level`: the level the run will play; `boss`: the host's choice of end boss for the dungeon, `None` = random").
  - `lobby::Room`: add `/// Always the dungeon until there is a level picker.` `pub level: LevelId,`; construct with `level: LevelId::Dungeon`; `send_room`: `level: room.level`; `start_run`: build the choice from the room: `let choice = match room.level { LevelId::Dungeon => LevelChoice::Dungeon { boss: room.boss } };` (bind `boss` for the log as before).
- [ ] **Step 4: Client.**
  - `ui/text.ts`, after `BOSS_TEXT` (import `LevelId` from `../generated/LevelId`):
```ts
export const LEVEL_TEXT: Record<LevelId, { name: string; victory: string; defeat: string }> = {
  Dungeon: { name: 'Dungeon', victory: 'The dungeon is cleared.', defeat: 'The dungeon claims another party.' },
};
```
  - `ui/endText.ts`:
```ts
import type { BossId } from '../generated/BossId';
import type { LevelId } from '../generated/LevelId';
import { BOSS_TEXT, LEVEL_TEXT } from './text';

/** The end screen's first line: the slain boss on a win if the level has one, else the level's own line. */
export function endText(victory: boolean, level: LevelId, boss: BossId | null): string {
  if (!victory) return LEVEL_TEXT[level].defeat;
  return boss ? `${BOSS_TEXT[boss].name} has been slain.` : LEVEL_TEXT[level].victory;
}
```
  - `ui/hud.ts` `showEnd(m: { victory: boolean; level: LevelId; boss: BossId | null; time: number; stats: PlayerStats[]; banked: boolean })` and the `<p>` line: `<p>${endText(m.victory, m.level, m.boss)} Time ${mins}:${secs}</p>`; drop `BOSS_TEXT` import if now unused there (the boss bar still uses it — keep).
  - `ui/lobby.ts` local `type Room`: add `level: LevelId` (import the type).
- [ ] **Step 5:** Run the full server suite (regenerates `RunStartInfo.ts`, `ServerMsg.ts`) and `cd client && npm run build && npm test`: all PASS. Fixture JSONs unchanged (`git diff --exit-code` on both).
- [ ] **Step 6: Commit** `"Level split: level in the protocol, lobby room and end screen"`.

---

### Task 4: Database, statistics, telemetry, admin page

**Files:**
- Create: `server/migrations/0004_runs_level.sql`
- Modify: `server/src/run/mod.rs` (`RunRecord`, `record`), `server/src/db.rs` (`record_run`), `server/src/stats.rs` (`LevelRunStats`, `AdminStats.level_runs`, `PlayerRun`, queries, tests), `server/src/telemetry.rs` (`run_finished`, test), `server/src/lobby.rs` (tests `test_record`, `SELECT r.boss`)
- Modify: `client/src/admin/main.ts` (Levels table, player runs column)

**Interfaces:**
- Consumes: `LevelId`, `Run.level` (Task 2).
- Produces: `RunRecord { level: LevelId, boss: Option<BossId>, outcome, duration_s, debug, players }`; `stats::LevelRunStats { level: String, boss: Option<String>, runs: u32, victories: u32, defeats: u32, avg_duration_s: f64 }`; `AdminStats.level_runs: Vec<LevelRunStats>` (replaces `bosses`); `PlayerRun { .., level: String, boss: Option<String>, .. }`; client `levelLabel(level: string, boss: string | null): string`.

- [ ] **Step 1: Failing tests.**
  - `stats.rs` tests: give `record(...)` the fields `level: LevelId::Dungeon, boss: Some(BossId::Demon)`; in `windows_count_the_right_days_and_skip_debug_runs` replace the `s.bosses` lines with:
```rust
        let demon = s.level_runs.iter().find(|b| b.level == "Dungeon" && b.boss.as_deref() == Some("Demon")).unwrap();
        assert_eq!((demon.runs, demon.victories, demon.defeats), (3, 1, 1));
```
  - New test in `stats.rs`:
```rust
    #[tokio::test]
    async fn runs_are_grouped_by_level_and_boss_and_may_have_no_boss() {
        let Some(db) = test_db().await else { return };
        let a = db::create_account(&db, "Leveler", "h").await.unwrap();
        let c = db::create_character(&db, a, "Lev", ClassId::Wizard).await.unwrap();
        db::record_run(&db, &record(a, c.id, Outcome::Victory, false)).await.unwrap();
        let mut no_boss = record(a, c.id, Outcome::Defeat, false);
        no_boss.boss = None;
        db::record_run(&db, &no_boss).await.unwrap();
        // A row from before migration 0004 has no level given: it defaults to the dungeon.
        sqlx::query("INSERT INTO runs (started_at, boss, outcome, duration_s, players, debug) VALUES (now(), 'Lich', 'victory', 60, 1, false)").execute(&db).await.unwrap();
        let s = overview(&db, Live::default()).await.unwrap();
        let find = |boss: Option<&str>| s.level_runs.iter().find(|r| r.level == "Dungeon" && r.boss.as_deref() == boss).map(|r| r.runs);
        assert_eq!((find(Some("Demon")), find(None), find(Some("Lich"))), (Some(1), Some(1), Some(1)));
        let d = player_detail(&db, a, false).await.unwrap().unwrap();
        assert!(d.recent_runs.iter().any(|r| r.level == "Dungeon" && r.boss.is_none()));
    }
```
  (Use the actual name/signature of the player-detail function in `stats.rs` around line 420; adjust the call to match.) Note: the test DB is shared between tests in one run; assertions use `find` on distinct groups and counts that other tests do not produce in a fresh `test_db()` — check how `test_db()` isolates (it likely truncates); if it does not, assert `>= 1` instead.
  - `telemetry.rs` test: `record()` gets `level: LevelId::Dungeon, boss: Some(BossId::Lich)`; the first assertion adds `("level", "Dungeon")`.
  - `lobby.rs`: `test_record` gets `level: LevelId::Dungeon, boss: Some(BossId::Dragon)`; the banking test selects `r.level, r.boss` and asserts `("Dungeon", Some("Dragon"), "victory", 12)` with type `(String, Option<String>, String, i32)`.
- [ ] **Step 2:** Run: compile FAIL (fields missing).
- [ ] **Step 3: Migration** `server/migrations/0004_runs_level.sql`:
```sql
-- Runs can play other level types than the boss dungeon; not every level has a boss.
ALTER TABLE runs ADD COLUMN level TEXT NOT NULL DEFAULT 'Dungeon';
ALTER TABLE runs ALTER COLUMN boss DROP NOT NULL;
```
- [ ] **Step 4: Server code.**
  - `RunRecord`: `pub level: LevelId, pub boss: Option<BossId>,`; `record()`: `level: self.level.id(), boss: self.level.boss_id(),`; remove the `expect` from Task 2.
  - `db::record_run`: `INSERT INTO runs (started_at, level, boss, outcome, duration_s, players, debug) VALUES (now() - make_interval(secs => $1), $2, $3, $4, $5, $6, $7)`, binds `.bind(format!("{:?}", r.level)).bind(r.boss.map(|b| format!("{b:?}")))` then the rest in order.
  - `stats.rs`: rename `BossStats` → `LevelRunStats { pub level: String, pub boss: Option<String>, runs, victories, defeats, avg_duration_s }` (doc: "Runs per level and end boss (`None`: the level has no boss)"); `AdminStats.bosses` → `/// Last 30 days, per level and boss.` `pub level_runs: Vec<LevelRunStats>`; fn `bosses` → `level_runs`, SQL `SELECT level, boss, count(*), … FROM r GROUP BY level, boss ORDER BY level, boss NULLS FIRST`, mapping shifted by one column. Check that the `WINDOW` CTE (`r`) selects `*` or add `level` to it. `PlayerRun`: add `pub level: String,` and `pub boss: Option<String>,`; query selects `r.level, r.boss` (shift following indices by one).
  - `telemetry.rs` `run_finished`:
```rust
        let mut attrs = vec![KeyValue::new("level", format!("{:?}", r.level))];
        if let Some(b) = r.boss {
            attrs.push(KeyValue::new("boss", format!("{b:?}")));
        }
        attrs.push(KeyValue::new("outcome", r.outcome.as_str()));
        let mut counted = attrs.clone();
        counted.push(KeyValue::new("debug", r.debug));
        self.runs_finished.add(1, &counted);
        if r.debug {
            return; // kept out of the gameplay numbers, like in the admin stats
        }
        self.run_duration.record(r.duration_s, &attrs);
```
- [ ] **Step 5: Admin client** `client/src/admin/main.ts`:
```ts
/** "Dungeon – Demon", or only the level when it has no boss. */
function levelLabel(level: string, boss: string | null): string {
  return boss ? `${level} – ${boss}` : level;
}
```
  Levels section: title `'Levels (last 30 days)'`, first column `'Level'`, rows from `s.level_runs.map((b) => [levelLabel(b.level, b.boss), …same as before…])`; rename the `bosses` const to `levelRuns` and its use where sections are appended. Player runs table: header `'Level'`, cell `levelLabel(r.level, r.boss)`.
- [ ] **Step 6:** Full server suite and client `npm run build && npm test`: PASS. Fixture JSONs unchanged.
- [ ] **Step 7: Commit** `"Level split: level in run statistics, telemetry and the admin page"`.

---

### Task 5: End-to-end verification, docs, handoff

**Files:**
- Modify: `docs/TECHNICAL.md` (architecture: `run/levels/`, `Layout`; protocol fields; DB 0004; admin "Levels"; tests count; new "How to add a level type" under "how to extend"), `docs/TODO.md` (remove priority 1, renumber, item 7 references), `HANDOFF.md` (new "Last session" section, next item), `README.md` only if it lists the server layout.

- [ ] **Step 1:** `docker compose up --build -d`, then health (`curl -s localhost:8080/` 200) and check the server log shows migration 0004 applied.
- [ ] **Step 2:** Smoke test: `cd tools/e2e && node smoke.mjs http://localhost:8080/ "" shots Wizard,Paladin`, then with `?lag=150&jitter=40&loss=2` as in TECHNICAL §12. Expected: pass, no browser errors, correction 0.00 px.
- [ ] **Step 3:** Throwaway bot (scratchpad, not committed; account deleted afterwards) per boss with `?debug&boss=<b>`: walk the debug path, check the wake message, sealed door, boss bar, and (killing the boss in debug mode) the end screen line "<boss name> has been slain."; then the admin page "Levels (last 30 days)" shows "Dungeon – <Boss>" rows. No browser errors.
- [ ] **Step 4:** Docs: TECHNICAL "How to add a level type": (1) `LevelId`/`LevelChoice` variants in `protocol.rs`, (2) `run/levels/<name>.rs` with a struct, `build(seed, …, rng) -> (Layout, Self)` and `impl LevelRules` overriding only needed hooks, (3) `Level` variant + one arm in `build`, `id`, `boss`, `boss_mut`, `dispatch!`, (4) a `BossEncounter` field if it has a boss, (5) `LEVEL_TEXT` entry, (6) lobby: map the room's choice. Update test counts.
- [ ] **Step 5:** TODO.md: drop priority 1, renumber, fix "needs 1 and 2" style references. HANDOFF.md: new top section (branch, what changed, verified, open: lobby picker/`SelectLevel` and XP rule for escort still open).
- [ ] **Step 6: Commit** `"Level split: docs and handoff"`; ask the user before merging/pushing.
