# Debug Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Issue: #151. Branch: `feature/151-debug-accounts`. Every commit ends with `(#151)`.

**Goal:** Debug mode only for accounts the admin marks as debug accounts, with debug and normal play fully separated, debug runs banking normally, unmarking wiping the account's progress, and `ALLOW_DEBUG` removed.

**Architecture:** A `debug` column on `accounts` is the single switch. The database is the authority for every saved change (free buys, grants, banking, wipe), checked inside the same transaction that writes. The lobby keeps a per-connection copy of the flag (read at WebSocket connect) to separate rooms and gate the UI. A room's kind is fixed by its creator, and a run's kind by its room.

**Tech Stack:** Rust (axum, sqlx/PostgreSQL, ts-rs), TypeScript client (Vite, Phaser, vitest), Playwright e2e.

**Spec:** [docs/superpowers/specs/2026-10-24-debug-accounts-design.md](../specs/2026-10-24-debug-accounts-design.md)

Reviewed before building by an Opus agent (2026-10-24); its findings are folded in.

## Global Constraints

- The account flag lives in `accounts.debug BOOLEAN NOT NULL DEFAULT false`. No other switch: `ALLOW_DEBUG` and `run::debug::allowed()` are deleted.
- Saved changes trust only the database's flag, read in the writing transaction. The in-memory flag (`Conn.debug`, `Room.debug`, `Run.debug`) only gates rooms, messages and UI.
- **Lock order in every transaction: the account row first, then character rows by ascending id.** This matches the existing `create_character` (account `FOR UPDATE`, then insert) and `delete_account` (account, then cascade).
- Which changes need a debug account is decided by the change itself (`Change::is_debug()`), never by a caller's flag.
- Debug runs bank XP and coins exactly like normal runs. A character's award is banked only if its account's flag at banking time equals the run's kind.
- Unmarking = flag off + every character of the account reset to `Progress::new(class)` (version current, `rev` bumped), in one transaction; the account's connections are kicked **after** commit. Marking keeps progress and kicks too.
- No client input (URL, message field) decides whether debug is allowed. The client reads neither `?debug` nor `?boss=` any more (the boss preselect is removed; the host picks the boss in the waiting room).
- Normal players never see, join or share a run with debug players, and the other way round.
- Debug accounts are excluded from the admin statistics that sum over characters; debug runs stay excluded as today (`NOT debug`).
- Server messages and docs follow CLAUDE.md: plain English, no "elemental".
- Verification commands are those in CLAUDE.md ("Verification after a change"). DB tests (`test_db()`) only run in the docker suite (`docker compose -f docker-compose.test.yml run --rm test`, then `... down`). **Any task that changes an exported Rust type runs the docker suite** so `client/src/generated` is regenerated, and keeps the client compiling (`npx tsc --noEmit`) in the same task.

## Review Focus

1. **Unmark while the account's debug run is still going** (players who left still bank when the run ends): no XP may land on the wiped characters. Pinned by `bank_skips_characters_whose_account_kind_differs` (Task 1).
2. **A connection that opens while the admin flips the flag** (flag read before the commit, character loaded after): the mismatch must close the connection, not let it play. Pinned by `a_character_whose_account_flag_changed_closes_the_connection` (Task 2).
3. **A normal player sending `JoinRun` with a debug room's id** (ids are sequential and guessable), and the reverse. Pinned by `rooms_of_the_other_kind_cannot_be_joined_or_seen` (Task 2).
4. **In-run debug messages (`DebugDarkvision`, `DebugEffect`, `DebugImmortal`) in a normal run**: ignored, the run stays normal. Pinned by `debug_messages_do_nothing_in_a_normal_run` (Task 3).
5. **The database is unreachable when the WebSocket connects:** the connection is refused, never treated as a normal account by default. Pinned by `connect_flag_refuses_on_error_and_unknown_accounts` (Task 2).

---

### Task 1: Database: the debug flag, debug-checked saves and banking, mark and unmark

**Files:**
- Create: `server/migrations/0006_debug_accounts.sql`
- Modify: `server/src/db.rs` (`Account`, `Character`, `character_from`, `find_account`, `account`, `list_characters`, `load_character`, `modify`, `update_progress`, `bank_awards`; new `Modified`, `set_account_debug`; existing tests at ~387/393/418 for the new signatures)
- Modify: `server/src/progress.rs` (`Change::is_debug`)
- Modify: `server/src/lobby.rs` (`finish_run`; the test helpers `character()` and `character_with()` get `debug: false`)
- Modify: `server/src/main.rs` (`change_build`, the debug-change arm)
- Modify: `server/src/stats.rs` (test at ~537 calls `bank_awards`)
- Test: `server/src/db.rs` tests module

**Interfaces:**
- Produces:
  - `pub struct Account { pub id: i32, pub name: String, pub password_hash: String, pub debug: bool }`; `account()` and `find_account()` select `debug`.
  - `pub struct Character { .., pub debug: bool }`: the account's flag at load time. `list_characters` and `load_character` select it with `JOIN accounts a ON a.id = c.account_id` (`a.debug AS debug`). `create_character` sets `debug` from the account row it already locks (`SELECT debug FROM accounts WHERE id = $1 FOR UPDATE`: one column more in an existing query), so the struct is always filled truthfully.
  - `impl Change { pub fn is_debug(&self) -> bool }`: true for `GrantItem`, `FreeAttr`, `FreeNode`, `FreeRespec`.
  - `pub enum Modified<E> { Done(Progress), Refused(E), Missing, WrongKind }` (replaces the nested `Option<Result<..>>`).
  - `async fn modify<E>(conn: &mut PgConnection, id: i32, require: Option<bool>, f: impl FnOnce(&mut Progress) -> Result<(), E>) -> Result<Modified<E>, sqlx::Error>`. Order: `SELECT account_id FROM characters WHERE id = $1` (no lock; none → `Missing`); then `SELECT debug FROM accounts WHERE id = $acc FOR SHARE` (only when `require` is `Some`); then the character row `FOR UPDATE` (gone → `Missing`; its `account_id` changed → `Missing`); flag differs from `require` → `WrongKind`, nothing written.
  - `pub async fn update_progress(db: &Db, id: i32, change: Change, class: ClassId) -> Result<Modified<&'static str>, sqlx::Error>`: `require = change.is_debug().then_some(true)`; applies `p.apply(class, change)`. The callers that used a closure (tests) switch to `Change` values or to a test-only `update_progress_with(db, id, f)` that passes `None` and is `#[cfg(test)]`.
  - `pub async fn bank_awards(db: &Db, awards: &[Award], debug_run: bool) -> Result<Vec<(i32, Progress)>, sqlx::Error>`: first lock the distinct accounts of all award characters `FOR SHARE` in ascending account id (`SELECT a.id, a.debug FROM accounts a JOIN characters c ON c.account_id = a.id WHERE c.id = ANY($1) ORDER BY a.id FOR SHARE OF a`), then for each award in ascending character id call `modify(.., Some(debug_run), ..)` (the account lock is already held, re-locking `FOR SHARE` is fine). `WrongKind` → `tracing::warn!(character, debug_run, "award skipped: the account's kind changed")`; `Missing` → skipped silently as today.
  - `pub async fn set_account_debug(db: &Db, id: i32, on: bool) -> Result<Option<u32>, sqlx::Error>`: `None` if no such account; otherwise the number of characters wiped: 0 when marking, 0 when unmarking an account that was already normal, else the number of its characters.

- [ ] **Step 1: Migration `0006_debug_accounts.sql`**

```sql
-- Debug accounts (#151): only characters of these accounts may use debug mode, and they never play with others.
ALTER TABLE accounts ADD COLUMN debug BOOLEAN NOT NULL DEFAULT false;
```

Plus the one-time wipe the user decided (2026-10-24): characters changed by the old `?debug` cannot be told apart, so every existing character starts over.

```sql
-- One-time wipe (#151): the old ?debug let anyone buy and grant for free; nobody keeps progress from before debug accounts.
UPDATE characters SET progress = '{}';
```

An empty document reads as `Progress::new(class)` (`from_json` falls back when the number fields are missing); add the test `an_empty_progress_document_is_a_new_character` in `progress.rs`: `Progress::from_json(json!({}), c) == Progress::new(c)` for every class. (`test_db()` migrates an empty database, so the wipe itself is pinned by this unit test and the migration text.)

- [ ] **Step 2: Write the failing DB tests** (in `db.rs` tests, each starts `let Some(db) = test_db().await else { return };`)

```rust
#[tokio::test]
async fn debug_changes_need_a_debug_account_at_save_time() {
    // account a normal, character c: update_progress(GrantItem(x)) -> WrongKind; stored progress unchanged (rev, inventory).
    // A normal change (BuyAttr with enough XP banked) -> Done.
    // set_account_debug(a, true) -> Some(0); GrantItem(x) -> Done(p) and p.inventory contains x.
    // update_progress on a deleted character -> Missing.
}

#[tokio::test]
async fn bank_skips_characters_whose_account_kind_differs() {
    // normal account n with character cn, debug account d with character cd.
    // bank_awards(&[Award{cn,10,1}, Award{cd,20,2}], true) -> result has only cd; cn's xp unchanged, cd's xp == 20, coins == 2.
    // bank_awards(same, false) -> result has only cn; cn's xp == 10.
}

#[tokio::test]
async fn unmarking_wipes_every_character_and_marking_keeps_progress() {
    // account a with two characters, both banked 50 XP and granted an item while marked.
    // set_account_debug(a, true) -> Some(0); progress kept; account(a).debug == true.
    // set_account_debug(a, false) -> Some(2); account(a).debug == false;
    // each character: xp 0, total_xp 0, coins/inventory/nodes/bought == Progress::new(class)'s, rev greater than before.
    // set_account_debug(a, false) again -> Some(0).
    // set_account_debug(9999, true) -> None.
}

#[tokio::test]
async fn loaded_characters_carry_the_account_flag() {
    // load_character and list_characters return debug == false, then true after set_account_debug(a, true).
}
```

Adapt the existing tests (`progress_changes_are_never_lost` etc.) to the new signatures; the "banking to a deleted character is skipped" assertion stays.

- [ ] **Step 3: Run them to see them fail**

Run: the docker suite. Expected: compile errors (`Modified`, `set_account_debug`, `bank_awards` arity, `Character.debug`).

- [ ] **Step 4: Implement** `Account`/`Character` fields, `Change::is_debug`, `Modified`, `modify`, `update_progress`, `bank_awards` as in Interfaces. `update_progress` commits only on `Done`.

- [ ] **Step 5: Implement `set_account_debug`**

One transaction:
1. `SELECT debug FROM accounts WHERE id = $1 FOR UPDATE`; no row → `Ok(None)`.
2. `UPDATE accounts SET debug = $2 WHERE id = $1`.
3. Only when `on == false` **and the old flag was true**: for each `SELECT id, class FROM characters WHERE account_id = $1 ORDER BY id`, call `modify(&mut tx, id, None, |p| { let rev = p.rev; *p = Progress::new(class); p.rev = rev; Ok::<_, ()>(()) })` (`modify` bumps `rev` and sets the version). Count the `Done`s.
4. Commit; return `Some(count)`.

Because the account row is locked first, a concurrent `create_character` (which locks the account first) either finishes before step 1 (its character is wiped) or waits until after the commit (it reads `debug = false`). A concurrent debug change waits on the account `FOR SHARE` and then sees `false` → `WrongKind`.

- [ ] **Step 6: Wire the callers**

- `lobby::finish_run`: `db::bank_awards(&db, &awards, record.debug)` (`RunRecord.debug` is still `debug_used` until Task 3).
- `main.rs::change_build(state, conn, change)`: calls `db::update_progress(&state.db, character, change, class)`; `Done(p)` → `apply_progress`; `Refused(e)` → error `e`; `Missing` → "No such character."; `WrongKind` → "Debug is off.".
- `main.rs` debug-change arm: keep the `run::debug::allowed()` check for now (Task 2 replaces it with the connection check); build the `Change` and call `change_build` (no separate function).

- [ ] **Step 7: Run the tests**

Run: the docker suite, and locally `cd server && cargo test -- --skip export_bindings`. Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add server/migrations/0006_debug_accounts.sql server/src/db.rs server/src/progress.rs server/src/lobby.rs server/src/main.rs server/src/stats.rs
git commit -m "Debug accounts: flag on accounts, debug-checked saves and banking, mark and unmark (#151)"
```

---

### Task 2: Lobby and connection: per-connection flag, room kinds, no mixing

**Files:**
- Modify: `server/src/main.rs` (`ws_handler`, `handle_socket`, debug-change arm; new `connect_flag`)
- Modify: `server/src/lobby.rs` (`Conn`, `Room`, `connect`, `set_character`, `handle` (`CreateRun`, `JoinRun`), `debug_loadout_if`, `debug_equip_if`, `debug_allowed`, `start`, new `new_run`, `summaries` → `summaries_for`, `send_lobby_to`, `broadcast_lobby`, new `is_debug`; tests)
- Modify: `server/src/protocol.rs` (`ServerMsg::Welcome`)
- Modify: `server/src/run/mod.rs` (`Run.debug: bool`, default false, set by the lobby)
- Test: `server/src/lobby.rs` tests, `server/src/main.rs` tests

**Interfaces:**
- Consumes: `db::Account.debug`, `db::Character.debug` (Task 1).
- Produces:
  - `ServerMsg::Welcome { id: u32, debug: bool }`.
  - `Lobby::connect(&mut self, account: i32, debug: bool, tx: UnboundedSender<Message>) -> u32`.
  - `Conn.debug: bool`, `Room.debug: bool` (fixed at `CreateRun` from the creator's `Conn.debug`).
  - `pub fn is_debug(&self, id: u32) -> bool` (the connection's flag; false if gone).
  - `fn new_run(&self, rid: u32, seed: u64) -> Option<Run>`: `members_of` + `Run::new` + `run.debug = room.debug`; `start` uses it, tests call it.
  - `Run.debug: bool` (pub, default false). Task 3 removes `debug_used` and makes `debug` drive everything.
  - `fn connect_flag(r: Result<Option<db::Account>, sqlx::Error>) -> Result<bool, StatusCode>` in `main.rs`: `Ok(Some(a))` → `Ok(a.debug)`; `Ok(None)` → `Err(UNAUTHORIZED)`; `Err(_)` → `Err(INTERNAL_SERVER_ERROR)` (logged).

- [ ] **Step 1: Write the failing tests** (lobby tests: add `join_kind(l, account, class, debug)`, with `join` = `join_kind(.., false)`; `character()`/`character_with()` take the kind.)

```rust
#[tokio::test]
async fn rooms_of_the_other_kind_cannot_be_joined_or_seen() {
    // d = debug conn, n = normal conn. d creates room rd, n creates rn.
    // summaries_for(false) lists only rn; summaries_for(true) only rd.
    // n sends LeaveRun, then JoinRun{rd} -> n.room stays None; rooms[rd].members == [d].
    // d sends LeaveRun, then JoinRun{rn} -> refused the same way.
    // The refusal text equals the one for a missing room ("That dungeon is full or has already started.").
}

#[tokio::test]
async fn debug_waiting_room_messages_need_a_debug_connection() {
    // normal conn in a normal room: debug_loadout_if / debug_equip_if leave loadout None, debug_loadout false ("Debug is off.").
    // debug conn in a debug room: they apply.
}

#[tokio::test]
async fn a_character_whose_account_flag_changed_closes_the_connection() {
    // conn connected with debug=false; set_character with a Character whose debug == true
    // -> the connection is removed from conns (kicked) and no character was set.
    // Same with conn debug=true and Character.debug == false.
}

#[tokio::test]
async fn a_debug_room_starts_a_debug_run_and_a_normal_room_a_normal_one() {
    // new_run(rd, 1).unwrap().debug == true; new_run(rn, 1).unwrap().debug == false.
}

#[test]
fn connect_flag_refuses_on_error_and_unknown_accounts() {
    // Ok(Some(Account{debug:true,..})) -> Ok(true); Ok(Some(..false)) -> Ok(false);
    // Ok(None) -> Err(StatusCode::UNAUTHORIZED); Err(sqlx::Error::PoolTimedOut) -> Err(StatusCode::INTERNAL_SERVER_ERROR).
}
```

Rewrite the existing debug tests (`debug_loadout_is_refused_when_it_must_be`, `debug_equip_*`, `the_debug_flag_starts_from_the_real_build`, `a_real_set_loadout_replaces_the_debug_picks`, `debug_loadout_alone_keeps_the_saved_weapons_and_debug_equip_overrides`, …) to use debug connections instead of the removed `allowed` parameter; the "debug off" cases use a normal connection.

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && cargo test --bin '*' lobby -- --skip export_bindings`. Expected: compile errors.

- [ ] **Step 3: Implement the lobby changes**

- `connect` stores `debug` in `Conn` and sends `Welcome { id, debug }`.
- `set_character`: if `character.debug != c.debug`, `kick_account(c.account, "Your account was changed. Please log in again.")` and return without setting the character.
- `CreateRun`: `Room { debug: conn.debug, .. }`.
- `JoinRun`: the existing `ok` check also requires `room.debug == conn.debug`; same error text.
- `debug_loadout_if(&mut self, id, ..)` and `debug_equip_if(&mut self, id, ..)` lose the `allowed` parameter; `debug_allowed(&self, id)` starts with: not `c.debug` → `"Debug is off."`.
- `start`: refuse (`"Mixed party."`, nothing started) if any member's `Conn.debug != room.debug` (defence in depth). Build the run with `new_run`.
- `summaries_for(&self, debug: bool)`: only rooms with `room.debug == debug`. `send_lobby_to` uses the connection's kind; `broadcast_lobby` sends each lobby connection the list of its own kind.

- [ ] **Step 4: Implement the connection changes in `main.rs`**

- `ws_handler`: after `same_origin` and `touch_activity`, `let debug = match connect_flag(db::account(&state.db, session.account).await) { Ok(d) => d, Err(s) => return s.into_response() };` and pass `debug` through `handle_socket` to `lobby.connect(account, debug, tx)`.
- Debug-change arm: replace the `run::debug::allowed()` check with `if !lobby.lock().unwrap().is_debug(id) { error "Debug is off."; continue }` (the database check from Task 1 stays the authority).

- [ ] **Step 5: Run the tests**

Run: the docker suite (regenerates `Welcome`'s TS; the client only reads `m.id`, so it compiles), then `cd server && cargo test -- --skip export_bindings` and `cd client && bash -lic 'npx tsc --noEmit'`. Expected: PASS, fingerprint tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add server/src client/src/generated
git commit -m "Debug accounts: per-connection flag, debug and normal rooms never mix (#151)"
```

---

### Task 3: Run: the run's kind replaces `debug_used`, every hero of a debug run starts in debug mode, debug runs bank

**Files:**
- Modify: `server/src/run/mod.rs` (`Member` without `debug_loadout`, delete `debug_used`, `Run::new`, `handle`, `start_info`/`RunStartInfo`, `end_msg`, `record`, `awards`, `run_task`, tests that build `Member` (~1344, ~1357, ~1462) or call `set_debug` (~1633, ~1658, ~1851))
- Modify: `server/src/run/debug.rs` (delete `allowed()`, `set_darkvision_if`, `debug_effect_if`; guard on `self.debug`; module doc; rewrite its tests with `run.debug = true` / `false`)
- Modify: `server/src/protocol.rs` (remove `ClientMsg::Debug`; `ServerMsg::RunEnded` loses `banked`; `RunStartInfo.debug: bool`; doc comments that say "if the server allows debug")
- Modify: `server/src/lobby.rs` (`members_of`; tests at ~859, ~874, ~1080, ~1092 that read `members[0].debug_loadout` / `run.debug_used`)
- Modify: `server/src/main.rs` (routing arm: drop `ClientMsg::Debug { .. }`)
- Modify: `client/src/game/GameScene.ts` (delete the `Debug` send at ~252; set `debugOn` from `RunStartInfo.debug` when the scene starts), `client/src/ui/hud.ts` (`showEnd` without `banked`; always the banked note)
- Test: `server/src/run/mod.rs`, `server/src/run/debug.rs`, `client/src/ui/hud.test.ts`

**Interfaces:**
- Consumes: `Run.debug` set by `Lobby::new_run` (Task 2).
- Produces:
  - `Run.debug` doc: "A debug run (its room was a debug room): every hero is in debug mode and the debug messages work. Recorded as `runs.debug`."
  - `pub fn set_debug(&mut self, pi: usize, on: bool)`: `on && self.debug`.
  - `set_darkvision`, `debug_effect`: return unless `self.debug`; they set no run flag.
  - `awards()` returns awards in both kinds of run; `record().debug == self.debug`.
  - `RunStartInfo.debug: bool` (= `run.debug`), so the client shows the badge and enables F4/F8/F9 from the first frame.
  - `run_task`: right after sending every player's start info, `if run.debug { for pi in 0..run.players.len() { run.set_debug(pi, true) } }`.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn debug_messages_do_nothing_in_a_normal_run() {
    // run.debug == false: handle DebugDarkvision{1.0}, DebugEffect{0}, DebugImmortal{false}
    // -> players[0].darkvision None, no effect on the hero, players[0].debug false, record(Some(true)).debug false.
}

#[test]
fn a_debug_run_puts_every_hero_in_debug_mode_and_still_banks() {
    // run.debug = true, two heroes with characters; set_debug(pi, true) for both
    // -> both players debug && immortal(); give xp/coins; awards() has both entries; record(..).debug == true;
    // start_info(&players[0]).debug == true.
}
```

Replace `awards_go_to_characters_unless_debug_was_used` with `awards_go_to_characters_in_both_kinds_of_run`. Tests that call `run.set_debug(i, true)` to make a hero immortal set `run.debug = true` first. Tests in `objects.rs`/`companion.rs` that set `players[0].debug = true` directly stay. `hud.test.ts`: the end screen always shows "Your XP and coins were added to your profile."

- [ ] **Step 2: Run them to see them fail**

Run: `cd server && cargo test --bin '*' debug -- --skip export_bindings`. Expected: FAIL / compile errors.

- [ ] **Step 3: Implement** the interfaces above, server and the two client files.

- [ ] **Step 4: Run all checks**

Run: `cd server && cargo test -- --skip export_bindings`; the docker suite (regenerates `ClientMsg`, `RunEnded`, `RunStartInfo`); `cd client && bash -lic 'npx vitest run && npx tsc --noEmit'`.
Expected: PASS, fingerprint tests unchanged (`level_setup_is_unchanged`, `simulation_is_unchanged_after_waking_the_boss`, `plan_3a_fight_is_pinned`).

- [ ] **Step 5: Commit**

```bash
git add server/src client/src
git commit -m "Debug accounts: debug runs come from debug rooms and bank normally (#151)"
```

---

### Task 4: Admin area: mark and unmark, debug tags, statistics without debug accounts

**Files:**
- Modify: `server/src/admin.rs` (route `/api/admin/players/{id}/debug`, handler `set_debug`)
- Modify: `server/src/stats.rs` (`PlayerRow.debug`, `PLAYER_COLUMNS`, `player_row`, `totals`, `classes`, `levels`, `top`, `PlayerRun.debug` and the recent-runs query)
- Modify: `client/src/admin/api.ts` (`setDebug`), `client/src/admin/main.ts` (list tag, player page card, recent-runs tag, audit labels)
- Test: `server/src/stats.rs` tests

**Interfaces:**
- Consumes: `db::set_account_debug` (Task 1), `Lobby::kick_account`.
- Produces:
  - `POST /api/admin/players/{id}/debug` with JSON `{ "debug": bool }` (struct `SetDebug { debug: bool }`). 404 "No such player." when `set_account_debug` returns `None`. On success: `kick_account(id, "Your account was changed by an admin. Please log in again.")` **after** the DB call returned, then audit `set_debug` (detail `"on"`) or `clear_debug` (detail `"N character(s) wiped"`), then `204`.
  - `PlayerRow.debug: bool`, `PlayerRun.debug: bool` (generated TS through the docker suite).
  - `adminApi.setDebug(id: number, debug: boolean): Promise<void>`.

- [ ] **Step 1: Write the failing stats test**

```rust
#[tokio::test]
async fn debug_accounts_are_left_out_of_the_character_statistics() {
    // normal account with one Wizard (total_xp 100), debug account with one Paladin (900 banked with bank_awards(.., true)).
    // totals: characters == 1, total_xp == 100.0; classes: Paladin.characters == 0; top: only the Wizard;
    // levels: one character in total; players(): the debug account's row has debug == true, the other false.
    // player(debug account).recent_runs: a recorded debug run shows debug == true.
}
```

- [ ] **Step 2: Run it to see it fail** (docker suite). Expected: compile error on `PlayerRow.debug`.

- [ ] **Step 3: Implement**

- `PLAYER_COLUMNS` gains `, a.debug` (index 5); `player_row` reads it.
- `totals`: characters/xp/coins over `characters c JOIN accounts a ON a.id = c.account_id WHERE NOT a.debug`. `classes` (owned), `levels`, `top`: the same join and filter. `totals.accounts` and the activity windows keep counting all accounts (they count logins; the spec's call).
- Recent runs select `r.debug`.
- The `set_debug` handler as in Interfaces.

- [ ] **Step 4: Admin page**

- Player list: a `badge` "Debug" next to debug accounts' names.
- Player page: a card "Debug account" before "Change password":
  - normal account: "Only characters of a debug account can use debug mode, and they only play with other debug accounts. Their progress is kept. The player is logged out." and a button "Make debug account" (`confirm()` first).
  - debug account: a `badge` "Debug" in the page head, the text "Removing the mark wipes all progress (XP, coins, tree, items) of every character of this account, so nothing from debug reaches normal games. The player is logged out." and a `danger` button "Remove debug mark and wipe" behind a type-the-name confirmation like "Delete player".
  - After either: `flash(..)` and reload the page.
- Recent runs: "(debug)" after the result for debug runs.
- Audit labels: `set_debug: 'Made debug account'`, `clear_debug: 'Removed debug mark (wiped)'`.

- [ ] **Step 5: Run the tests**

Run: the docker suite, then `cd client && bash -lic 'npx vitest run && npx tsc --noEmit && npm run build'`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/admin.rs server/src/stats.rs client/src/admin client/src/generated
git commit -m "Admin: mark and unmark debug accounts; statistics leave them out (#151)"
```

---

### Task 5: Game client: the flag from `Welcome` replaces `?debug`; the URL boss preselect goes

**Files:**
- Modify: `client/src/main.ts` (`Welcome` case), `client/src/ui/lobby.ts` (`debugOn`; delete `debugBoss`, the `preselected` field and the preselect in `setRoom`; lobby heading), `client/src/ui/hub/hub.ts` (`debugOn`), `client/src/ui/hud.ts` and `client/src/game/GameScene.ts` (comments that say `?debug`)
- Test: `client/src/ui/lobby.test.ts`, `client/src/ui/hub/*.test.ts` where they build a hub context

**Interfaces:**
- Consumes: `Welcome { id, debug }` (Task 2).
- Produces:
  - `Lobby.debug: boolean` (public, set from `Welcome`).
  - `Hub.setDebug(on: boolean): void`; the hub's `TabCtx.debug` comes from it.

- [ ] **Step 1: Write the failing test** (`lobby.test.ts`, with the existing Lobby test setup)

```ts
describe('debug UI', () => {
  it('follows the account flag, not the URL', () => {
    // history.replaceState(null, '', '/?debug&boss=dragon'); a Lobby in a waiting room as host:
    // lobby.debug = false -> no `.debug-loadout` row, and no SelectBoss was sent;
    // lobby.debug = true  -> the `.debug-loadout` row is rendered, and still no SelectBoss was sent.
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd client && bash -lic 'npx vitest run src/ui/lobby.test.ts'`. Expected: FAIL.

- [ ] **Step 3: Implement**

- `main.ts`: `case 'Welcome': lobby.myId = m.id; lobby.debug = m.debug; hub.setDebug(m.debug); break;`
- `lobby.ts`: every `debugOn()` becomes `this.debug`; the room list heading reads "Debug dungeons" when `this.debug`.
- `hub.ts`: no URL lookup; re-render on `setDebug`.
- `grep -rn "URLSearchParams" client/src/ui client/src/main.ts` shows no `debug` or `boss` lookup.

- [ ] **Step 4: Run the client checks**

Run: `cd client && bash -lic 'npx vitest run && npx tsc --noEmit && npm run build'`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src
git commit -m "Client: debug UI follows the account's flag, not ?debug (#151)"
```

---

### Task 6: Config, smoke test, docs, full verification

**Files:**
- Modify: `docker-compose.yml` (remove `ALLOW_DEBUG` and its comment)
- Modify: `tools/e2e/smoke.mjs` (debug runs mark the throwaway accounts)
- Modify: `README.md`, `docs/TECHNICAL.md`, `docs/PLAYER_GUIDE.md`, `CLAUDE.md` (standing decision "Debug mode is URL-only" and Ruling 13)

- [ ] **Step 1: `docker-compose.yml`:** delete the `ALLOW_DEBUG` lines. `grep -rn ALLOW_DEBUG --exclude-dir=node_modules --exclude-dir=superpowers .` is empty afterwards (old plans under `docs/` may keep history).

- [ ] **Step 2: `smoke.mjs`:** the usage line becomes `"?debug"` (no `&boss=`). When the query contains `debug` (kept as the script's own switch), mark both throwaway accounts as debug accounts after registering and before opening a character (no WebSocket exists yet, so no reload is needed). Use the admin API when `ADMIN_USER`/`ADMIN_PASSWORD` are in the environment, else `docker compose exec -T db psql -U tiny -d tiny -c "update accounts set debug = true where name = '<name>'"` (only the script's own `e2e_*` names). Print which way was used.

- [ ] **Step 3: Docs**

- `CLAUDE.md`: replace the "Debug mode is URL-only" bullet with: "**Debug accounts** (2026-10-24, #151): only accounts the admin marks in `/admin` can use debug; they play only with each other; debug runs bank; unmarking wipes the account's progress. No `ALLOW_DEBUG`, no `?debug`, no URL boss preselect. Inside a debug run F9 switches only immortality." Ruling 13 becomes "The debug flag stays (whole class pool, Attribute lift), on top of the real build; `DebugGrantItem`. Debug runs bank (#151)."
- `TECHNICAL.md`: environment table (drop `ALLOW_DEBUG`), protocol (`Welcome.debug`, `RunStartInfo.debug`, no `Debug`, `RunEnded` without `banked`, debug messages need a debug account), the safety model (DB authority, `Change::is_debug`, lock order account → characters, bank kind check, unmark transaction), lobby room kinds, admin endpoint, statistics exclusion, the URL table (the `?debug` and `?debug&boss=` rows are gone).
- `README.md`: the debug section and the F4 row describe debug accounts.
- `PLAYER_GUIDE.md`: the "Debug games" line becomes a short note that debug mode is a developer tool on marked test accounts and never mixes with normal games (players cannot turn it on).

- [ ] **Step 4: Full verification** (CLAUDE.md list)

1. `cd server && cargo test -- --skip export_bindings` → PASS.
2. `cd client && bash -lic 'npx vitest run && npx tsc --noEmit && npm run build'` → PASS.
3. Docker suite → PASS; `git status` shows no unexpected changes in `client/src/generated`.
4. `docker compose up --build -d`; `curl localhost:8080/health` → `OK`.
5. Smoke: `BROWSER=/usr/bin/brave-browser node smoke.mjs http://localhost:8080/ "" shots ElvenRanger,Paladin` and `Wizard,Barbarian` → "no browser errors".
6. Debug smoke: `node smoke.mjs http://localhost:8080/ "?debug" shots Paladin,Wizard` → debug badge shows, F4/F9 steps pass, end screen says XP was added.
7. Manual (two browser windows): a normal account does not see a debug account's room; with `?debug` in the URL the normal account shows no debug UI; unmarking in `/admin` logs the debug account out and its characters show 0 XP.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml tools/e2e/smoke.mjs README.md docs/TECHNICAL.md docs/PLAYER_GUIDE.md CLAUDE.md
git commit -m "Debug accounts: docs, compose and smoke test (#151)"
```

Deploy note (main session, with the user): production's override file may still set `ALLOW_DEBUG`; it is ignored now and can be removed. The migration runs on start and wipes every existing character's progress once (the user's decision). After deploy, mark the user's test account in `/admin`.
