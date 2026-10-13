# Level split: separate the run from "dungeon + boss" (TODO priority 1)

## Context
`Run` assumes one level type: it always generates the 140×140 room dungeon and is always won by killing the boss (`boss_id`, `boss_ent`, `boss`, `boss_awake`, `door_closed` on `Run`; victory in `kill_monster`; `check_boss_hall`). The woodland escort level (TODO priority 7) and other future level types (riddle levels, outdoor maps, …) need other map shapes, win/loss rules and a level identity in the protocol, lobby and statistics. This is a **pure refactor**: behaviour, maps per seed, wire format and all 149 tests stay the same; no new level is added.

User decisions (2026-10-13): scope = server core + plumbing (protocol, DB, stats), no lobby level picker yet; admin stats grouped per level with the boss inside; enum-based shape; design must accommodate further level types beyond escort.

## Design

### 1. Server core
- **`server/src/run/levels/mod.rs`**
  - `trait LevelRules` with **default no-op hooks**: `populate(run, party)`, `tick(run, dt)`, `on_killed(run, id)`, `on_monster_hurt(run, mi) -> bool` (false = immune), `failed(run) -> bool` (default: no living player), `debug_target(run) -> Option<Vec2>`, `boss_bar(run) -> Option<BossBar>`, `boss_id() -> Option<BossId>`, `enemy_theme` (for `enemies::for_boss`).
  - `enum Level { Dungeon(DungeonLevel) }` forwards each hook with one `match`; `Level::id() -> LevelId`; accessors `boss()` / `boss_mut()` → `Option<&BossEncounter>`.
  - Hooks that need `&mut Run` use the take-and-restore pattern already used for `BossBehaviour` (`std::mem::replace` with a cheap placeholder or `Option<Level>`), decided in the plan.
  - `Level::build(seed, &LevelChoice) -> (Layout, Level)`: each level owns its generator and rng streams.
- **`run/levels/boss.rs` — `BossEncounter`** (reusable by any level): `boss_id, boss_ent, behaviour: Option<Box<dyn BossBehaviour>>, awake, arena: Rect, door: Vec<(i32,i32)>, door_closed`; `spawn` (today's `spawn_boss`), `tick` (behaviour tick + today's `check_boss_hall`: wake, message, seal), `is_boss(id)`. Code moved unchanged.
- **`run/levels/dungeon.rs` — `DungeonLevel`** = dungeon parts (`rooms`, `start`) + `BossEncounter`. Build: boss pick from `ChaCha8Rng(seed ^ 0x5eed)` exactly as today, then `generate(seed, Theme::for_boss)`, then `Dungeon::split()`.
- **`Layout { map, spawns, chests, player_spawns }`** in `dungeon/` is the only map data `Run` knows (`run.dungeon` → `run.layout`). `generate` and its tests are untouched; `Dungeon::split() -> (Layout, DungeonParts)` added.
- **`Run`**: drops the five boss fields, gains `level: Level`, `layout: Layout`. `Run::new(id, members, seed, LevelChoice)`. `kill_monster` → `level.on_killed`; `hurt_monster` boss branch → `level.on_monster_hurt`; `step` → `level.tick` (replaces boss tick + `check_boss_hall`); `check_end` uses `level.failed`.
- Users updated: `bosses/*` (`boss_idx`, lich disciples' owner) via `run.level.boss()`; `visibility.rs` boss bar / drain via level; `debug.rs` boss target via `level.debug_target`; ai.rs only uses `m.is_boss` (unchanged).
- Test helpers `test_run(classes, boss)` / `test_run_seed` keep their signatures.

### 2. Plumbing
- **Protocol** (`protocol.rs`, ts-rs): new `LevelId { Dungeon }`, `LevelChoice { Dungeon { boss: Option<BossId> } }`; `RunStartInfo.level: LevelId`; `RunEnded { victory, level, boss: Option<BossId>, time, stats, banked }`; `ServerMsg::Room.level`. `SelectBoss` stays; no `SelectLevel` yet. Snapshot/`BossBar`/wire unchanged.
- **Lobby** (`lobby.rs`): `Room.level: LevelId` (always Dungeon); `start_run` builds `LevelChoice::Dungeon { boss: room.boss }`; log names the level.
- **DB**: migration `0004_runs_level.sql` — `ADD COLUMN level TEXT NOT NULL DEFAULT 'Dungeon'`, `boss DROP NOT NULL`. `RunRecord { level, boss: Option<BossId>, … }`; `db::record_run` binds both.
- **Stats** (`stats.rs`): `BossStats` → `LevelStats { level, boss: Option<String>, … }`, `GROUP BY level, boss`; `AdminStats.bosses` → `levels`; `PlayerRun.level`.
- **Admin** (`client/src/admin/main.ts`): "Bosses" table → "Levels", rows "Dungeon – Demon" (level name only when no boss); player runs column "Boss" → "Level".
- **Telemetry** (`telemetry.rs`): `level` attribute; `boss` only when present.
- **Client**: `ui/text.ts` `LEVEL_TEXT: Record<LevelId, {name, victory, defeat}>`; `ui/hud.ts` end screen uses boss text when `boss` set, else level texts (dungeon defeat text unchanged). Lobby picker, `?debug&boss=`, boss bar unchanged.

### 3. Testing and verification
- All 149 existing tests pass with only mechanical edits; `client/src/generated/wire-fixtures.json` and `fixtures.json` byte-identical after `cargo test` (`git diff`).
- New tests: `Level::build` layout equals `generate`+`split` over many seeds and both themes; `boss: None` with a fixed seed picks today's boss; a test-only minimal level proves the default hooks (defeat when all dead, no boss bar, no debug path, `RunEnded.boss == None`); DB: old rows read as Dungeon, `record_run` with NULL boss, stats grouped by level+boss.
- Client `npm run build` (tsc) + `npm test`.
- `docker compose up --build -d` + health; smoke test normal and `?lag=150&jitter=40&loss=2`; throwaway bot debug run per boss (wake, door seal, boss bar, victory text), admin "Levels" table; no browser errors.

## Next steps after approval
1. Branch `feature/level-split` from `main`.
2. Save this spec to `docs/superpowers/specs/2026-10-13-level-split-design.md`, commit.
3. superpowers:writing-plans → implementation plan for user review and execution choice.
4. After implementation: HANDOFF.md, TECHNICAL.md (architecture + "how to add a level"), TODO.md (remove priority 1, renumber), PLAYER_GUIDE untouched; commit.
