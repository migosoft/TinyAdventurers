# Elven Ranger and Dire Wolf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Assassin becomes the Elven Ranger: entity type Elf, Hide removed, and a new secondary that summons and heals a Dire Wolf. The wolf is the first allied creature: it follows the ranger and guards them. It opens a fight with a dash and then bites, growls at enemies it detects, and escapes a chasm with its dash when the dash is ready. Enemies can kill it. The ranger's melee stab becomes a rapier.

**Architecture:** The wolf is a `Monster` with an ally marker (`Monster.ally: Option<Ally>`). That way it reuses movement, terrain, knockback, effects (`Creature::Monster`) and snapshots. Its own behaviour lives in a new `server/src/run/companion.rs`, and its numbers in a new `server/src/defs/companions.rs`. Enemies pick their targets and deal area damage through a "foe" layer on `effects::Creature`: a foe is a hero (`Creature::Player`) or an ally (`Creature::Monster` with `ally`). Every hero attack skips allies. Mimics move from `dormant` to a new `hiding` state.

**Tech Stack:** Rust (tokio, axum, serde, ts-rs, rmp-serde, sqlx/PostgreSQL), TypeScript + Phaser 3.90, vitest, Docker.

**Spec:** [docs/superpowers/specs/2026-10-16-elven-ranger-design.md](../specs/2026-10-16-elven-ranger-design.md). Read it first. Its "Calls I made" were all approved by the user, except that the statistics are wiped as well. Do not reopen decisions the spec records as the user's.

## Global Constraints

- No local Rust toolchain. Server tests run in Docker: `MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test` (all tests), or append `cargo test --release <filter>` to run a subset. Afterwards run `docker compose -f docker-compose.test.yml down`. Docker Desktop must be running.
- `cargo test` regenerates `client/src/generated/*` (ts-rs types, `defs.ts`, `fixtures.json`, `wire-fixtures.json`). Never edit those files by hand; commit them with the Rust change that produced them.
- Client checks: `cd client && npx tsc --noEmit && npm test`.
- Wire changes: when a field changes in `Snapshot`, `SelfState`, `EntSnap`, `Ev` or `InputMsg`, change the wire type, both converters (`server/src/wire.rs`, `client/src/wire.ts`) and `sample_snapshots` together.
- Prediction parity: `client/src/sim/collision.ts` must match `server/src/collision.rs`, and both sides keep the order "move, then abilities". Cooldowns tick per processed input.
- Fingerprints (`level_setup_is_unchanged`, `simulation_is_unchanged_after_waking_the_boss`) must stay the same unless a task says why they change. Re-record a fingerprint only with a dated comment that explains the change, as the existing comments do.
- Python is not installed. Use Node, perl or sed for scripted edits. Git Bash mangles backticks in `node -e`, so write a script file instead.
- Desktop only (keyboard and mouse). Do no phone layout work.
- Art: the wolf is Superdark's "16x16 Enchanted Forest Characters" (CC0), `client/assets-src/enchanted-forest/frames/Wolf/`. Draw no new figure art.
- Spec numbers:
  - Ranger: HP 90, speed 80.
  - Elf: 10 % poison resistance, vision 18 tiles, darkvision 1/3, immune to Sleep.
  - Magical Beast: 10 % poison and 10 % magical resistance, melee 80 % physical / 20 % magical, immune to Sleep, vision 18, darkvision 1.0.
  - Wolf:
    - extra 20 % cold resistance, HP 80, speed 88
    - bite 10 every 0.9 s, push 8 px
    - follows within about 2 tiles, guards about 3 tiles from the ranger, leash about 6 tiles, reappears beyond about 12 tiles
    - growls at most once every 4 s, with a step of 1 to 2 tiles
    - dash attack (the user, 2026-10-16): from up to 4 tiles (64 px) at 300 px/s, 20 damage, push 12 px, cooldown 5 s; it opens a fight, then the wolf bites
    - chasms (the user, 2026-10-16): its dash jumps chasms. A push that leaves it over a chasm makes it dash back to its last safe tile **only if the dash is ready**. That escape uses the dash and starts its 5 s cooldown, like the Barbarian's. With the dash on cooldown it falls and dies. Deep water drowns it and lava burns it, as for any monster.
  - Ranger primary: same numbers, but the melee stab is drawn with the rapier `weapon_duel_sword` instead of `weapon_knife`; the lobby name is "Bow / Rapier".
  - Summon and heal cooldown 8 s, death cooldown 60 s, both divided by `mods.attack_speed`. A heal restores 20 % of the wolf's HP (16), never above its maximum.
- Messages and labels: the class shows as "Elven Ranger". The death message is `"{name}'s wolf has fallen"`.
- Commits: work on a feature branch (`feature/elven-ranger`), not `main`. Each commit step means: `git add` the files the task touched, including the regenerated `client/src/generated/*`, then commit with the given message. End every message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Do not push unless the user asks.
- After the feature: update HANDOFF.md and the docs, then commit (the user's standing rule).

## Review Focus

These failure modes are implied by the spec but no headline test covers them. Each line names the task whose tests pin it.

1. **Two rangers in one party:** each wolf follows, guards and is healed only by its own ranger. One ranger's ability never summons or heals the other's wolf. Task 7: `two_rangers_each_keep_their_own_wolf`.
2. **The ranger leaves the dungeon or falls:** their wolf vanishes at once. There is no "wolf has fallen" message and no XP. A ranger who left never gets a wolf back. Task 7: `the_wolf_vanishes_when_its_ranger_falls_or_leaves`.
3. **The wolf meets terrain:** a barrel blast pushes it over a chasm. With its dash ready, it dashes back to safe ground, lives, and its dash goes on cooldown. Right after an attack dash, it falls, pays nothing and starts the 60 s wait (Task 8: `a_wolf_blown_over_a_chasm_escapes_only_with_its_dash_ready`). A blast into deep water drowns it: nobody gets XP, coins or a kill, and the ranger's 60 s wait starts (Task 6: `a_wolf_blown_into_deep_water_drowns_without_paying_and_starts_the_wait`).
4. **The wolf goes where only heroes count:** the wolf alone in the boss hall wakes nothing and seals nothing. The wolf on a chest opens nothing. The wolf next to a hiding mimic does not wake it. Task 8: `only_heroes_wake_the_boss_open_chests_and_reveal_mimics`.
5. **Growl spam:** an enemy that steps in and out of the wolf's sight is growled at once. Two new enemies within 4 s give one growl, not two. Task 9: `each_enemy_is_growled_at_once_and_growls_are_4_s_apart`.

---

### Task 1: Rename the Assassin to the Elven Ranger and wipe the game data

**Files:**
- Modify:
  - `server/src/protocol.rs:13-21` (`ClassId::Assassin` → `ElvenRanger`, `ALL`)
  - `server/src/defs/kinds.rs` (`EntityKind::Assassin = 3` → `ElvenRanger = 3`, `ALL`)
  - `server/src/defs/classes.rs:26-28`
  - `server/src/db.rs:374`, `server/src/lobby.rs:546`, `server/src/stats.rs:616` (tests)
  - `server/src/run/ai.rs` and `server/src/run/abilities.rs` (tests that build `ClassId::Assassin` runs; rename `assassin_uses_dagger_…` to `ranger_uses_dagger_in_melee_range_and_crossbow_otherwise`)
- Create: `server/migrations/0005_elven_ranger.sql`
- Modify:
  - `client/src/ui/classes.ts`, `client/src/ui/text.ts` (title and blurb only; the abilities follow in Tasks 2 and 7)
  - `client/src/game/anim/defs.ts` (`KIND.Assassin` → `KIND.ElvenRanger`, `label: 'Elven Ranger'`, `isPlayerKind` uses `KIND.ElvenRanger`)
  - `client/src/game/GalleryScene.ts:31`, `KnockbackDemoScene.ts`, `LichDemoScene.ts`, `OgreDemoScene.ts`
  - `client/src/game/world.test.ts`
  - `client/src/style.css:503` (`.c-assassin` → `.c-elvenranger`; the class is `p.class.toLowerCase()`)

**Interfaces:**
- Produces: `ClassId::ElvenRanger` (wire string `"ElvenRanger"`, stored in `characters.class` as `"ElvenRanger"` through `db::class_name`) and `EntityKind::ElvenRanger = 3` / `KIND.ElvenRanger`.

- [ ] **Step 1: Write the failing database test** in `server/src/db.rs` tests (the test Postgres runs every migration):

```rust
#[tokio::test]
async fn the_class_check_takes_the_ranger_and_refuses_the_assassin() {
    let db = test_db().await; // the helper the other db tests use
    let a = /* create an account as the neighbouring tests do */;
    let c = create_character(&db, a, "Ranger", ClassId::ElvenRanger).await.unwrap();
    assert_eq!(c.class, ClassId::ElvenRanger);
    let old = sqlx::query("INSERT INTO characters (account_id, name, class) VALUES ($1, 'Old', 'Assassin')").bind(a).execute(&db).await;
    assert!(old.is_err(), "the CHECK constraint no longer allows Assassin");
}
```

- [ ] **Step 2: Run it and check that it fails.** Run `MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test cargo test --release class_check`. Expected: it does not compile (`ElvenRanger` is unknown).

- [ ] **Step 3: Write `0005_elven_ranger.sql`.** It deletes every row of `run_players`, `runs` and `characters`, in that order. Then it drops `characters_class_check` and re-adds it as `CHECK (class IN ('Wizard', 'Paladin', 'Barbarian', 'ElvenRanger'))`. Postgres names an inline column CHECK `<table>_<column>_check`. If the drop fails, look the name up with `\d characters` in the test database. Leave accounts, sessions, `activity_days` and `admin_actions` alone.

- [ ] **Step 4: Rename everywhere.** Do it with `grep -rn "Assassin\|assassin" server/src client/src client/scripts --include=*.rs --include=*.ts --include=*.css`. Leave `client/src/generated` to `cargo test`. Ranger text in `ui/text.ts`: `title: 'Elven Ranger'`, `blurb: 'Keen-eyed elf of the deep woods, never alone.'`. Rename the primary to `'Bow / Rapier'` with `text: 'Shoots arrows; thrusts with the rapier automatically when an enemy is close.'` (the user, 2026-10-16). The rapier art comes in Task 10. Leave the secondary entry until Task 2.

- [ ] **Step 5: Run every check.** First `MSYS_NO_PATHCONV=1 docker compose -f docker-compose.test.yml run --rm test`. Then `cd client && npx tsc --noEmit && npm test`. Expected: all pass, and `client/src/generated/ClassId.ts` and `defs.ts` now say `ElvenRanger`.

- [ ] **Step 6: Commit**

```bash
git add server client/src docs
git commit -m "Elven Ranger: rename the Assassin, wipe characters and statistics"
```

---

### Task 2: Remove Hide completely

**Files:**
- Modify (server):
  - `server/src/defs/abilities.rs`: remove `AbilityId::Hide`, `HIDDEN_CRIT_MULT` and the `Hide` arm in `def`. Add `AbilityId::SummonWolf` in its place, with `def(SummonWolf) = d(id, 8.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)`, in `ALL`, and make it the ranger's secondary in `classes.rs`. In `try_use` its arm does nothing yet and returns `Anim::Cast` (`// Task 7: summon or heal the wolf`). In `GameScene.predictAbility` add `case 'SummonWolf': anim = ANIM.Cast; break;`.
  - `server/src/run/entities.rs`: remove `Player.hidden`.
  - `server/src/run/mod.rs`: the `hidden` init, and its tick in `apply_input` (lines 491-495).
  - `server/src/run/abilities.rs`: the Hide arm; the `hidden`/`crit`/`mult` crit logic becomes `let mult = run.players[pi].mods.damage;` with `crit = false`. Keep the `crit` parameters, since the projectile and event plumbing carry them.
  - `server/src/run/ai.rs:21-29` (`p.hidden <= 0.0` filter)
  - `server/src/run/bosses/lich.rs:113,230`
  - `server/src/defs/kinds.rs` `flags::HIDDEN` (delete; Task 3 reuses bit 1)
  - `server/src/export.rs` (`HIDDEN_CRIT_MULT`, `"HIDDEN"` flag)
  - `server/src/protocol.rs` `SelfState.hidden`
  - `server/src/wire.rs` (`SelfW` field 10 and its doc comment, `encode_snap`, `sample_snapshots`)
  - `server/src/run/visibility.rs` (the `HIDDEN` flag and `hidden:`)
- Delete tests:
  - `hidden_attack_crits_times_four_and_breaks_stealth` (abilities.rs)
  - `a_hidden_hero_is_never_seen_even_by_darkvision` and `a_seen_hero_becomes_the_target_and_hiding_drops_it` (ai.rs; keep that test's first half, "a seen hero becomes the target", if it stands alone)
  - `a_hero_who_hides_during_the_gaze_windup_is_not_petrified` (lich.rs)
  - In `enemy_ignores_player_without_line_of_sight_or_hidden`, drop the hidden half and rename the test to `enemy_ignores_player_without_line_of_sight`.
- Modify (client):
  - `client/src/wire.ts` (`SelfW` decode: every index after 10 moves down by one)
  - `client/src/game/world.ts`: remove `hidden`, `hideNext`, `useHide`, `Pending.hide` and the `sh` reconcile lines.
  - `client/src/game/GameScene.ts:490-492,512,710-711` (the `Hide` case, `ATTACKS…useHide(0)`, the `FLAG.HIDDEN` override)
  - `client/src/game/anim/EntityView.ts:273-274` (the shimmer: alpha is always 1)
  - `client/src/game/status.ts:198` (comment)
  - `client/src/game/world.test.ts` (delete `keeps the hide time of a Hide…`; drop `hidden: 0` from the `me` fixture)
  - `client/src/ui/text.ts` (the ranger's secondary entry becomes a placeholder `{ name: 'Dire Wolf', text: '' }`; Task 7 writes the text)

**Interfaces:**
- Produces: `SelfW` with 17 fields: `[alive, hp, max_hp, x, y, dash_t, dash_dx, dash_dy, cd1, cd2, spectating, knock, darkvision, vision, effects, speed_mul, no_act]`. Bit 1 of the entity flags is free.

- [ ] **Step 1: Make the removals** listed above, server first.
- [ ] **Step 2: Check that nothing is left.** `grep -rn "hidden\|Hide\b\|HIDDEN" server/src client/src --include=*.rs --include=*.ts | grep -v generated` should list only unrelated DOM uses (`'hidden'` CSS classes, `aria-hidden`).
- [ ] **Step 3: Run every check.** Run the full server tests in Docker, then `cd client && npx tsc --noEmit && npm test`. Expected: all pass. `wire.test.ts` checks the regenerated `wire-fixtures.json` against the new indices, and both fingerprint tests stay unchanged (no test party has a ranger).
- [ ] **Step 4: Commit** with `git commit -m "Elven Ranger: remove Hide completely"`.

---

### Task 3: Split "hiding" from "dormant" (mimics)

**Files:**
- Modify:
  - `server/src/run/entities.rs`: add `pub hiding: bool` next to `dormant`, documented "Concealed from the heroes (a mimic disguised as a chest); ends as the mimic's dormant did. The wolf growls at hiding things, never at dormant ones." Narrow `dormant`'s doc to "bosses before the party enters the hall, the lich's channelling disciples".
  - `server/src/run/mod.rs`:
    - `Run::new` mimic spawn sets `hiding = true`.
    - `spawn_enemy` sets `hiding: false`.
    - `touch_chests` checks `m.hiding`.
    - `wake_mimic` clears `hiding`.
    - `hurt_monster:904-907`: `if m.hiding { wake_mimic }`, and `dormant = false` stays for everything.
    - The fingerprint eats `(m.dormant || m.hiding) as u64`, so recorded values stay the same.
    - The test `mimic_sleeps_until_touched_then_waits_before_hunting` uses `hiding`.
  - `server/src/run/levels/boss.rs`: the `Monster` literal gets `hiding: false`. `check_arena` clears `dormant` on every monster; the mimic filter goes, because mimics are `hiding`, not `dormant`. Keep the comment "Mimics elsewhere keep their disguise (they are hiding, not dormant)".
  - `server/src/run/ai.rs:146`: `if dormant || hiding { return }`. Line 473 (`separate_monsters`) skips `dormant || hiding`.
  - `server/src/defs/kinds.rs`: `pub const HIDING: u8 = 1;` with the doc "Concealed (a mimic as a chest)".
  - `server/src/export.rs` exports `"HIDING"`.
  - `server/src/run/visibility.rs` sets `flags::HIDING` from `m.hiding`.
  - `client/src/game/mimic.ts`: `FLAG.DORMANT` → `FLAG.HIDING`. Rename `dormant` → `hiding` in its state interface and in `MimicDemoScene.ts`.

**Interfaces:**
- Produces: `Monster.hiding: bool` and `flags::HIDING = 1` / `FLAG.HIDING`. Task 9 (growl) and Task 8 (guard) read `hiding` and `dormant`.

- [ ] **Step 1: Write the failing test** in `run/mod.rs` tests:

```rust
#[test]
fn a_mimic_is_hiding_not_dormant_and_the_boss_is_dormant_not_hiding() {
    let run = test_run(&[ClassId::Paladin], BossId::Demon);
    let mimics: Vec<&Monster> = run.monsters.iter().filter(|m| m.etype == Some(EnemyType::Mimic)).collect();
    assert!(!mimics.is_empty(), "seed 7 has a mimic"); // pick another seed via test_run_seed if not
    assert!(mimics.iter().all(|m| m.hiding && !m.dormant));
    let boss = run.monsters.iter().find(|m| m.is_boss).unwrap();
    assert!(boss.dormant && !boss.hiding);
}
```

- [ ] **Step 2: Run it** with `… cargo test --release hiding_not_dormant`. Expected: it does not compile (`hiding` is unknown).
- [ ] **Step 3: Implement** the field and every change listed under Files.
- [ ] **Step 4: Run every check.** Run the full server tests (both fingerprints unchanged) and `cd client && npx tsc --noEmit && npm test`. Then check `?mimic&slow=3` in the browser (Vite against the container, see HANDOFF "Fast client iteration"): the closed chest, the rattle and the reveal look as before.
- [ ] **Step 5: Commit** with `git commit -m "Monsters: a hiding state for mimics, split from dormant"`.

---

### Task 4: Entity types Elf and Magical Beast, effect responses per entity type

**Files:**
- Modify:
  - `server/src/defs/entity_types.rs`: add `EntityType::Elf` and `EntityType::MagicalBeast` with their `type_def` rows. Add `pub fn responses(types: &[EntityType]) -> EffectResponses`.
  - `server/src/defs/classes.rs`: `profile(class)` becomes per class. Add `pub fn responses(class: ClassId) -> EffectResponses`.
  - `server/src/run/entities.rs`: add `Player.responses: EffectResponses`.
  - `server/src/run/mod.rs` (`Run::new` fills it)
  - `server/src/run/effects.rs:147` (`Creature::Player(i)` uses `players[i].responses`)

**Interfaces:**
- Produces:
  - `type_def(EntityType::Elf) = TypeDef { res: Resistances::of(&[(Poison, 0.1)]), melee: DamageSplit::physical(), vision: 18.0, darkvision: 1.0 / 3.0 }`
  - `type_def(EntityType::MagicalBeast) = TypeDef { res: Resistances::of(&[(Poison, 0.1), (Magical, 0.1)]), melee: DamageSplit::split(&[(Magical, 0.2)]), vision: 18.0, darkvision: 1.0 }`. `split` puts the rest into physical; check with `DamageSplit::split`'s doc.
  - `entity_types::responses(types)` gives `Sleep: Immune` for Elf and MagicalBeast and `FULL` otherwise. Over several types the strongest response wins per effect (Immune > Reduced > Full).
  - `classes::profile(ElvenRanger)` = `profile(&[Elf], Adjust::NONE)`; the other classes stay Human. `classes::responses(c) = entity_types::responses(&[type of c])`.

- [ ] **Step 1: Write the failing tests** in `entity_types.rs` tests. Replace the `for c in ClassId::ALL` loop in `every_enemy_has_its_entity_type` with a loop over the three Human classes plus these tests:

```rust
#[test]
fn the_ranger_is_an_elf_and_elves_and_magical_beasts_sleep_never() {
    let r = classes::profile(ClassId::ElvenRanger);
    assert!((r.res.get(Poison) - 0.1).abs() < 1e-12);
    assert_eq!(r.sight, Sight { vision: 18.0, darkvision: 1.0 / 3.0 });
    assert_eq!(r.melee, DamageSplit::physical());
    assert_eq!(classes::responses(ClassId::ElvenRanger).get(EffectKind::Sleep), EffectResponse::Immune);
    assert_eq!(classes::responses(ClassId::Wizard), EffectResponses::FULL);
    let b = profile(&[EntityType::MagicalBeast], Adjust::NONE);
    assert_eq!((b.res.get(Poison), b.res.get(Magical)), (0.1, 0.1));
    assert!((b.melee.share(Magical) - 0.2).abs() < 1e-12 && (b.melee.share(Physical) - 0.8).abs() < 1e-12);
    assert_eq!(b.sight, Sight { vision: 18.0, darkvision: 1.0 });
    assert_eq!(responses(&[EntityType::Human, EntityType::MagicalBeast]).get(EffectKind::Sleep), EffectResponse::Immune);
}
```

  In `run/effects.rs` tests add `a_sleeping_curse_does_not_take_on_a_ranger`: `assert!(!run.apply_effect(Creature::Player(0), EffectKind::Sleep, None))` on a `test_run(&[ClassId::ElvenRanger], …)`, and `assert!(run.apply_effect(Creature::Player(0), EffectKind::Blind, Some(1.0)))`.

  In `run/visibility.rs` tests add `an_elf_sees_eighteen_tiles_far`:
  - floor a 40×5 strip with `dark_view`'s pattern;
  - put a torch so a monster 16 tiles east of the ranger is lit;
  - assert `sees(&mut run, p, 5.0)`;
  - assert the same spot 20 tiles east is not seen;
  - call `send_snapshots(&mut run)` once so the 18-tile `View::compute` runs without a panic.
- [ ] **Step 2: Run them** with `… cargo test --release elf`, then `… cargo test --release ranger`. Expected: they do not compile.
- [ ] **Step 3: Implement** the code above.
- [ ] **Step 4: Run every check.** Run the full server tests (fingerprints unchanged; their parties are Paladin and Wizard) and the client checks.
- [ ] **Step 5: Commit** with `git commit -m "Entity types Elf and Magical Beast; effect responses per entity type"`.

---

### Task 5: The wolf as an ally monster (data, spawn, no friendly fire, death, snapshots)

**Files:**
- Create: `server/src/defs/companions.rs` (registered in `defs/mod.rs`)
- Create: `server/src/run/companion.rs` (registered in `run/mod.rs`; this task adds spawn and death only)
- Modify:
  - `server/src/defs/kinds.rs`: `DireWolf = 23` in `ALL` (38 entries); `body_height` gives `DireWolf => 12.0`.
  - `server/src/run/entities.rs`: add `Ally`, `Monster.ally`, `Monster::is_ally()` and `Player.wolf`.
  - `server/src/run/mod.rs`:
    - `spawn_enemy` and the boss `Monster` literal set `ally: None`.
    - `hurt_monster`: refuse hero damage on allies, and send an ally's numbers like a hero's.
    - `kill_monster`: allies take the companion death path.
    - the monster loop in `step` skips allies for the enemy AI.
  - `server/src/run/abilities.rs`: `dagger_target`, `melee_arc`, `dash_contact`, `advance_projectile` (player shots) and `explode` (`from_player` branch) skip `m.is_ally()`.
  - `server/src/run/visibility.rs`: allies are sent to everyone, like heroes.

**Interfaces:**
- Produces:
  - In `defs/companions.rs`:

    ```rust
    pub const WOLF_HP: f64 = 80.0;
    pub const WOLF_SPEED: f64 = 88.0;
    pub const WOLF_RADIUS: f64 = 5.0;
    pub const WOLF_BITE_DAMAGE: f64 = 10.0;
    pub const WOLF_BITE_COOLDOWN: f64 = 0.9;
    pub const WOLF_BITE_KNOCK: f64 = 8.0;
    pub const WOLF_BITE_RANGE: f64 = 14.0;
    pub const WOLF_BITE_WINDUP: f64 = 0.2;
    pub const WOLF_FOLLOW: f64 = 32.0;   // starts following beyond 2 tiles, stops inside 20 px
    pub const WOLF_GUARD: f64 = 48.0;    // enemies this close to the ranger are bitten
    pub const WOLF_DEFEND: f64 = 24.0;   // ...and enemies this close to the wolf (it fights back)
    pub const WOLF_LEASH: f64 = 96.0;    // never chases farther than this from the ranger
    pub const WOLF_REAPPEAR: f64 = 192.0;
    pub const WOLF_GROWL_EVERY: f64 = 4.0;
    pub const WOLF_GROWL_STEP: f64 = 24.0;
    pub const WOLF_HEAL_SHARE: f64 = 0.2;
    pub const WOLF_DEAD_COOLDOWN: f64 = 60.0;
    pub const WOLF_DASH_RANGE: f64 = 64.0;
    pub const WOLF_DASH_SPEED: f64 = crate::defs::abilities::DASH_SPEED; // 300, the Barbarian's
    pub const WOLF_DASH_DAMAGE: f64 = 20.0;
    pub const WOLF_DASH_KNOCK: f64 = 12.0;
    pub const WOLF_DASH_COOLDOWN: f64 = 5.0;
    pub fn wolf_profile() -> Profile // [MagicalBeast] + Adjust { res: Cold 0.2, ..NONE }
    pub fn wolf_responses() -> EffectResponses // entity_types::responses(&[MagicalBeast])
    ```

  - In `run/entities.rs`: `pub struct Ally { pub owner: u32 /* ranger's player id */, pub growled: Vec<u32>, pub growl_cd: f64, pub growl_to: Option<Vec2>, pub hold: f64, pub prey: Option<u32>, pub following: bool, pub reach_t: f64, pub dash: Option<WolfDash>, pub dash_cd: f64, pub last_safe: Vec2 }` and `pub struct WolfDash { pub dir: Vec2, pub left: f64 /* s */, pub attack: bool /* false: the dash back from a chasm */ }`. `last_safe` starts at the spawn tile's centre., `Monster.ally: Option<Ally>`, `Monster::is_ally(&self) -> bool`, and `Player.wolf: Option<u32>` (the wolf's monster id).
  - `companion::spawn_wolf(run: &mut Run, pi: usize) -> u32`:
    - a `Monster` with `etype: None`, `is_boss: false`, `kind: DireWolf`, `mover: Mover::Enemy` and the numbers above;
    - its HP does not scale with the party;
    - placed by `companion::spot_beside(run, pos) -> Vec2`, the first of 8 points 12 px around `pos` (east first, then clockwise) that is not `blocks_at(_, Mover::Enemy)` and is clear of solid objects, else `pos`;
    - sets `players[pi].wolf`;
    - sends `Ev::Boom { k: 8, r: 10 }` (the green puff) party-wide.
  - `companion::wolf_died(run: &mut Run, mi: usize)`:
    - `alive = false`, then `Ev::Died` party-wide (`None`);
    - `Ev::Msg "{name}'s wolf has fallen"`;
    - clears the ranger's `wolf`;
    - sets the ranger's `cd2 = WOLF_DEAD_COOLDOWN / mods.attack_speed`;
    - pays no XP or coins and skips `Level::on_killed`.
  - `kill_monster` calls it first when `is_ally()`.
  - Hurting an ally:
    - `hurt_monster(mi, _, _, Some(_))` on an ally returns `false` and changes nothing (the safety net).
    - `Dmg` and `Heal` events on an ally go through `event_on_hero` with `p: true`.
    - Effect events on an ally go through `event_on_hero` (`effects.rs effect_event`).
  - In `send_snapshots`, ally `EntSnap`s join `player_snaps` and are sent every snapshot: `extra = ally.owner`, the same flags as monsters plus `HURT`. The monster loop skips allies.

- [ ] **Step 1: Write the failing tests** in a `#[cfg(test)] mod tests` in `run/companion.rs`. The helper `ranger_with_wolf()` builds `test_run(&[ClassId::ElvenRanger], BossId::Demon)`, runs `monsters.retain(|m| m.is_boss)`, calls `spawn_wolf(&mut run, 0)` and returns `(run, wolf_id)`. Tests:
  - `a_summoned_wolf_has_its_numbers`:
    - HP 80;
    - `res.get(Cold) == 0.2`, `res.get(Poison) == 0.1`, `res.get(Magical) == 0.1`;
    - `responses.get(Sleep) == Immune`;
    - `ally.owner == run.players[0].id` and `run.players[0].wolf == Some(id)`;
    - a `Boom { k: 8, .. }` event exists.
  - `no_hero_attack_hurts_the_wolf`: one block per attack, each with a fresh run, the wolf placed 10 px east of the hero:
    - the dagger (`try_use(CrossbowDagger)`): `dagger_target` is `None` and a bolt is fired;
    - a bolt fired straight through the wolf;
    - a Sword swing and an Axe swing (Paladin and Barbarian heroes added with `test_run(&[ElvenRanger, Paladin, Barbarian], …)`);
    - a Barbarian dash through it;
    - a Wizard fireball exploding on it;
    - a direct `hurt_monster(wolf, dmg, false, Some(0))`.

    Each block asserts the wolf's HP is still 80 and `knock == Vec2::ZERO`.
  - `the_wolf_dies_without_paying_and_starts_the_wait`:
    - `run.hurt_monster(wolf_mi, Damage::physical(200.0), false, None)`;
    - assert `players[0].xp == 0 && players[0].coins == 0 && players[0].kills == 0`;
    - `players[0].wolf == None`;
    - `(players[0].cd2 - 60.0).abs() < 1e-9`;
    - the message `"p0's wolf has fallen"` was sent;
    - the run did not end.
  - `the_wolf_is_sent_to_the_party_even_in_the_dark`: put the wolf in an unlit spot out of the hero's view. Build the snapshot entities the way `send_snapshots` does: refactor the per-player entity list into a `fn snapshot_ents(run, pi, view, dark) -> Vec<EntSnap>` that the test can call. Assert the wolf's id is in the list with `extra == players[0].id`.
  - `damage_on_the_wolf_is_shown_like_damage_on_a_hero`: `hurt_monster(wolf, 5 physical, false, None)` gives a `Dmg { p: true }` whose index is in `run.on_hero`.
- [ ] **Step 2: Run them** with `… cargo test --release companion`. Expected: they do not compile.
- [ ] **Step 3: Implement** the code above. In `Run::step`'s monster loop, put `if m.is_ally() { continue; }` (Task 8 replaces it with `companion::tick_wolf`) after the `no_act`, sinking and knock handling, so a frozen wolf idles like a frozen monster.
- [ ] **Step 4: Run every check.** Full server tests: the fingerprints are unchanged (no allies in them). Then the client checks; `generated/defs.ts` gains `KIND.DireWolf`.
- [ ] **Step 5: Commit** with `git commit -m "Dire Wolf: an ally monster that hero attacks never hurt"`.

---

### Task 6: Enemies fight the wolf (foes), Holy Light heals it

**Files:**
- Modify:
  - `server/src/run/mod.rs`: the foe helpers below; `tick_hazards` uses `foes_touching`; add `heal_monster`.
  - `server/src/run/entities.rs`: `Target::Ally(u32)`.
  - `server/src/run/ai.rs`:
    - `find_visible_player` splits into `find_visible_foe` (enemy AI) and `find_visible_hero` (bosses).
    - `tick_monster` and `perform_attack` take a `Creature`.
    - the Slam counts and hits `foes_in`.
  - `server/src/run/bosses/mod.rs`: `target()` uses `find_visible_hero`; `players_in` becomes `foes_in` on `Run`.
  - Area attacks that switch to `foes_in` with `hurt_creature`/`knock_creature`:
    - `demon.rs`: swoop and cleave. The swoop's hit-once list holds creature ids: `run.creature_id(c)`.
    - `dragon.rs`: smash, breath (keep its line-of-sight check, using `creature_pos`), tail, claw and bite.
    - `lich.rs`: the nova.
  - Unchanged on purpose: the lich's `ready_spell`, its gaze and the dragon's fireball `targets` stay heroes-only (spec call 7).
  - `server/src/run/abilities.rs`: enemy shots hit heroes and then allies; `impact` takes `Option<Creature>`; `explode`'s enemy branch uses `foes_touching` with line of sight; Holy Light heals allies in range too.
  - `server/src/run/objects.rs` `explode_barrel`: the `monsters` list skips allies, the hero list becomes `foes_touching` (hurt with no source, as heroes are).

**Interfaces:**
- Produces (methods on `Run`, using `effects::Creature`):

  ```rust
  /// Living heroes and living allies (not sinking) whose centre is within `r` of `at`, optionally inside a cone (dir, half-angle).
  pub fn foes_in(&self, at: Vec2, r: f64, cone: Option<(f64, f64)>) -> Vec<Creature>
  /// Living heroes within r + PLAYER_RADIUS and allies within r + radius of `at`; with `los`, only those in line of sight.
  pub fn foes_touching(&self, at: Vec2, r: f64, los: bool) -> Vec<Creature>
  pub fn creature_pos(&self, c: Creature) -> Vec2
  pub fn creature_id(&self, c: Creature) -> u32
  pub fn hurt_creature(&mut self, c: Creature, dmg: Damage)          // Player → hurt_player; Monster → hurt_monster(mi, dmg, false, None)
  pub fn knock_creature(&mut self, c: Creature, from: Vec2, fallback: f64, dist: f64) // knock_player / knock_monster
  pub fn heal_monster(&mut self, mi: usize, amount: f64) -> f64      // capped at max_hp; Heal event like hurt_monster's (on_hero for allies)
  ```

  ```rust
  pub fn find_visible_foe(run: &Run, from: Vec2, sight: Sight) -> Option<Creature>  // nearest living hero or ally it sees
  pub fn find_visible_hero(run: &Run, from: Vec2, sight: Sight) -> Option<usize>    // today's find_visible_player without `hidden`
  fn perform_attack(run: &mut Run, mi: usize, foe: Creature, attack: AttackStyle, alt: bool, at: Option<Vec2>)
  ```

- `tick_monster` stores `Target::Player(id)` for heroes and `Target::Ally(id)` for allies.

- [ ] **Step 1: Write the failing tests** in `run/companion.rs` tests (reuse `ranger_with_wolf`). Each puts the hero in debug mode so only the wolf matters, far from the action:
  - `an_orc_attacks_the_wolf_when_it_is_the_nearest_foe`: an orc warrior 20 px from the wolf, the ranger 120 px away and out of its sight. Step 120 ticks with a lit floor (`dark_floor`-style setup plus a torch, or `run.players[0].darkvision = Some(1.0)` is not enough: light the spot with `add_light`). Assert the wolf's HP is below 80 and the orc's `ai.target == Some(Target::Ally(wolf_id))`.
  - `an_enemy_arrow_hits_the_wolf`: `spawn_monster_projectile` aimed through the wolf; after stepping, the wolf has lost the arrow's damage.
  - `area_attacks_hit_the_wolf`:
    - an ogre slam (`perform_attack` via the existing `ogre_among` pattern) with the wolf within `OGRE_SLAM_RADIUS` loses HP and is pushed;
    - a fire patch (`spawn_hazard(FirePatch, wolf_pos, 10.0, 2.0, 5.0)`) hurts it within 0.5 s;
    - a barrel blast (`explode_barrel`) next to it hurts and pushes it.
  - `a_bosses_area_attack_hits_the_wolf_but_the_boss_targets_heroes`: run the lich nova on a wolf within `LICH_NOVA_RADIUS` (the `lich_with` pattern). Assert the wolf lost `LICH_NOVA_DAMAGE × (1 − 0.1)` HP (its 10 % magical resistance) and that `bosses::target(&run, bi)` returns the hero, never the wolf.
  - `holy_light_heals_the_wolf_and_counts_as_healing`: a Paladin next to a hurt wolf (HP 40) uses `Heal`. The wolf is at `40 + 35`, and the Paladin's `healing` includes those 35.
  - `a_wolf_blown_into_deep_water_drowns_without_paying_and_starts_the_wait` (Review Focus 3): set deep water two tiles east (`terrain_run` pattern) and blow the wolf in with `explode_barrel`. Step until it drowns. Assert the wolf is gone, `xp`, `coins` and `kills` are all 0, `cd2 ≈ 60`, and the message was sent.
- [ ] **Step 2: Run them** with `… cargo test --release companion`. Expected: they fail (enemies ignore the wolf), or do not compile where the new names are used.
- [ ] **Step 3: Implement** the helpers and every call-site change above.
- [ ] **Step 4: Run every check.** Run the full server tests. Expected: all pass with **unchanged** fingerprints (no allies; heroes are found in the same order, nearest first). If a fingerprint changes, find the difference before re-recording: it must come from a behaviour change you can explain.
- [ ] **Step 5: Commit** with `git commit -m "Enemies and area attacks hit the wolf; Holy Light heals it"`.

---

### Task 7: The ability "Summon Companion: Dire Wolf"

**Files:**
- Modify:
  - `server/src/run/abilities.rs` `try_use`: Task 2's empty `SummonWolf` arm now calls `companion::use_ability(run, pi)`, `Anim::Cast`, cooldown `def.cooldown` (8 s, divided by `attack_speed` as for every ability).
  - `server/src/run/companion.rs`: `use_ability` and `vanish_orphans`.
  - `server/src/run/mod.rs` `step`: call `companion::vanish_orphans(self)` right after the `step_player` loop.
  - `client/src/ui/text.ts`: the ranger's secondary is `{ name: 'Dire Wolf', text: 'Summons your dire wolf companion. While it lives, heals it for 20 %. If it falls, it can be summoned again after 60 s.' }`.

**Interfaces:**
- Produces:
  - `companion::use_ability(run: &mut Run, pi: usize)`: with no wolf, `spawn_wolf`; with a wolf alive, `heal_monster(wolf, WOLF_HP × WOLF_HEAL_SHARE)`. A heal at full HP still uses the ability and its cooldown. `try_use` already refuses while `cd2` runs, which covers the 60 s wait.
  - `companion::vanish_orphans(run: &mut Run)`: every ally whose owner is not a living hero (fallen, sinking to death, or left) is removed at once: `alive = false`, an `Ev::Boom { k: 8 }` puff party-wide, the owner's `wolf = None`. No `Died` event, no message, no cooldown.

- [ ] **Step 1: Write the failing tests** in `run/companion.rs` tests. One input per step, as the existing `walk` helper sends them: push `InputMsg { seq, secondary: Some(n), .. }`.
  - `right_click_summons_then_heals_and_the_wolf_never_doubles`:
    1. Press: one wolf, `cd2 ≈ 8.0`.
    2. Press again at once: still one wolf (refused by the cooldown).
    3. Hurt the wolf to 50, set `cd2 = 0`, press: HP 66.
    4. Set `cd2 = 0` at full HP, press: HP 80, `cd2 ≈ 8.0` (the heal still counts).
  - `the_cooldowns_follow_attack_speed`: set `mods.attack_speed = 2.0`. A summon gives `cd2 ≈ 4.0`; a wolf death gives `cd2 ≈ 30.0`.
  - `after_the_wolf_falls_the_button_waits_60_s_then_summons`: kill the wolf, press: no wolf. Step `60 × 60` ticks and press: a new wolf.
  - `two_rangers_each_keep_their_own_wolf` (Review Focus 1): use `test_run(&[ElvenRanger, ElvenRanger], …)`. Both press: two wolves with owners `players[0].id` and `players[1].id`. Hurt wolf A; ranger B presses (after `cd2 = 0`): wolf A's HP is unchanged and B's wolf is healed (it was full: unchanged, but B's `cd2 ≈ 8`).
  - `the_wolf_vanishes_when_its_ranger_falls_or_leaves` (Review Focus 2):
    - ranger 1 falls (`hurt_player` with 999 damage): after one `step`, its wolf is gone, a `Boom { k: 8 }` was sent, no `"wolf has fallen"` message, `xp == 0`;
    - ranger 2 sends `RunCmd::Leave`: same result;
    - a dead ranger's secondary input is ignored (no wolf comes back).
- [ ] **Step 2: Run them** with `… cargo test --release companion`. Expected: they do not compile (`SummonWolf` is unknown).
- [ ] **Step 3: Implement** the code above.
- [ ] **Step 4: Run every check.** Run the full server tests, then the client checks.
- [ ] **Step 5: Commit** with `git commit -m "Elven Ranger: the summon, heal and wait of the Dire Wolf"`.

---

### Task 8: Wolf behaviour (follow, guard, dash, bite, leash, reappear, chasm escape)

**Files:**
- Modify: `server/src/run/companion.rs` (`tick_wolf` and its helpers), `server/src/run/mod.rs`:
  - `step`: replace Task 5's `if m.is_ally() { continue; }` with `companion::tick_wolf(self, mi, DT); continue;`.
  - `terrain_monster`: an ally mid-dash skips the whole terrain check (it is in the air, like a dashing hero). An ally whose centre is over a chasm with `ally.dash_cd ≤ 0` does not sink: it clears `knock` and calls `companion::dash_back(self, mi)`. With the dash on cooldown it sinks and dies like any monster (`kill_monster` → `wolf_died`). On a `safe` tile it stores the tile centre in `ally.last_safe`.
  - `knock_monster`: an ally mid-dash is not pushed.

**Interfaces:**
- Consumes: `ai::path_toward`, `ai::move_toward`, `ai::astar`, `collision::walk_line`, `perception::sees`, `Run::knock_monster`, and `Run::hurt_monster(prey, Damage::new(WOLF_BITE_DAMAGE, wolf.melee), false, Some(ranger_pi))`. The bite credits the ranger with damage, kills and `last_hit_by`, so a wolf kill pays like any kill.
- Produces: `companion::tick_wolf(run: &mut Run, mi: usize, dt: f64)`. It does these steps in order, every tick:
  1. **Ranger.** Find the owner; if they are missing, return (`vanish_orphans` handles it next tick).
  2. **Reappear.**
     - Every 0.5 s (`ally.reach_t`), check that the ranger can be reached: `walk_line(map, wolf, ranger, Mover::Enemy) || astar(map, wolf, ranger, 2500, Mover::Enemy).is_some()`.
     - If the wolf is farther than `WOLF_REAPPEAR` from the ranger, or cannot reach them, it moves to `spot_beside(ranger)`. It clears its path, wind-up, prey, growl step and knockback, and sends a `Boom { k: 8 }` puff party-wide.
     - This covers the sealed boss door: `DoorClosed` blocks the path.
  3. **Timers.** Count down `ai.cd`, `ally.dash_cd`, `ally.growl_cd` and `ally.hold`.
  3a. **Dash in progress.** While `ally.dash` is set, move along `dir` at `WOLF_DASH_SPEED` with `collision::move_box(…, Mover::Dash, &solids)` (it crosses chasms), `Anim::Dash`, and count down `left`.
     - An attack dash that touches its prey (`dist < radii + 4`) hits it once: `hurt_monster(prey, Damage::new(WOLF_DASH_DAMAGE, wolf.melee), false, Some(ranger_pi))`, then `knock_monster(prey, wolf.pos, WOLF_DASH_KNOCK)`. The dash ends and `ai.cd = WOLF_BITE_COOLDOWN`.
     - When `left` runs out, the dash ends. If it ended over a chasm, `terrain_monster` sends the wolf back with `dash_back` on the same tick.
     - Return while dashing.
  - `companion::dash_back(run, mi)`: a non-attack dash straight to `ally.last_safe`, with `left = dist / WOLF_DASH_SPEED`. It sets `ally.dash_cd = WOLF_DASH_COOLDOWN`, the same cooldown as the attack dash.
  - An attack dash that ends over a chasm has just set `dash_cd`, so the wolf falls. Only start an attack dash whose straight line ends on walkable ground (`!blocks_at(end, Mover::Enemy)`), so it never jumps to its death on its own.
  4. **Bite wind-up.** If one is running, count it down. When it ends, bite the prey if it is still alive and within `WOLF_BITE_RANGE + radii + 4`:
     - damage as above, then `knock_monster(prey, wolf.pos, WOLF_BITE_KNOCK)`;
     - `ai.cd = WOLF_BITE_COOLDOWN`, `Anim::Melee`;
     - return.
  5. **Prey.** Choose the living enemy (not an ally, not `dormant`, not `hiding`, not `airborne`) that the wolf `sees`, with `dist(e, ranger) ≤ WOLF_GUARD + e.radius` or `dist(e, wolf) ≤ WOLF_DEFEND + e.radius`, and `dist(e, ranger) ≤ WOLF_LEASH`. Take the one nearest the ranger and store it in `ally.prey`. With prey:
     - out of bite reach by more than 8 px but within `WOLF_DASH_RANGE + radii`, `ally.dash_cd ≤ 0` and in line of sight: start an attack dash at the prey (`left = dist / WOLF_DASH_SPEED + 0.05`), `dash_cd = WOLF_DASH_COOLDOWN`;
    - in reach and `ai.cd ≤ 0`: start the wind-up (`WOLF_BITE_WINDUP`, `Anim::Windup`, aim at the prey);
     - otherwise path toward it at `WOLF_SPEED`, `Anim::Move`;
     - return.
  6. **Growl.** This step comes from Task 9 and is a no-op until then.
  7. **Follow.**
     - If `ally.following` and the wolf is within 20 px of the ranger, stop following.
     - If it is beyond `WOLF_FOLLOW`, start following.
     - While following, `path_toward(ranger)` at `WOLF_SPEED` with `Anim::Move`. Otherwise `Anim::Idle`, facing the ranger's aim side.

- [ ] **Step 1: Write the failing tests** in `run/companion.rs` tests. Open floor around the hero comes from the `open_floor` pattern in ai.rs tests; light it, or give the test monsters `darkvision`, so `sees` works.
  - `the_wolf_follows_and_stands_still_with_the_ranger`: move the ranger 80 px east by teleporting `mv`, then step 90 ticks. The wolf is within `WOLF_FOLLOW` of the ranger. Step 60 more ticks without moving: its position changes by less than 0.5 px and its anim is `Idle`.
  - `the_wolf_bites_an_enemy_near_the_ranger_and_the_kill_pays_the_ranger`:
    - an orc warrior with `hp = 15`, 30 px from the ranger (the ranger in debug mode);
    - step until the orc is dead (at most 180 ticks);
    - `players[0].kills == 1`, `players[0].xp > 0`, `players[0].damage ≥ 15`.
  - `the_wolf_opens_with_a_dash_and_then_bites`:
    - an orc (AI held) 40 px from the ranger and 50 px from the wolf;
    - within 30 ticks the wolf's anim was `Dash` and the orc lost exactly 20 HP;
    - a bite of 10 follows within 1.5 s;
    - no second dash hit before 5 s have passed (count the orc's 20-point hits).
  - `the_wolf_dash_jumps_a_chasm`: a one-tile chasm strip between the wolf and an orc next to the ranger. The wolf dashes across, ends on floor, and is alive with `sinking == None`.
  - `a_wolf_blown_over_a_chasm_escapes_only_with_its_dash_ready` (Review Focus 3):
    - **Dash ready:** a chasm two tiles east (`terrain_run` pattern), and a barrel blast pushes the wolf onto it. Within 1 s the wolf stands on a safe tile, alive and never `sinking`. No `Ev::Sink` was sent for its id, `players[0].wolf` is unchanged, and `ally.dash_cd ≈ 5`.
    - **Dash on cooldown:** blast it again at once. It sinks (`Ev::Sink { how: 0 }` for its id). After `FALL_TIME` it is gone, `xp`, `coins` and `kills` are 0, `cd2 ≈ 60`, and the message was sent.
  - `the_wolf_ignores_enemies_far_from_the_ranger_and_never_leaves_the_leash`: an orc 80 px from the ranger whose AI is held (`ai.hold = 99`). After 120 ticks its HP is unchanged and the wolf stayed within `WOLF_LEASH` of the ranger.
  - `the_wolf_fights_back`: an orc 16 px from the wolf and 60 px from the ranger. Within 120 ticks the orc has lost HP.
  - `the_wolf_never_bites_dormant_or_hiding_monsters`: a dormant boss (the lich's hall, `lich_with` pattern) and a hiding mimic, each 20 px from the ranger. After 120 ticks both have full HP and keep their state.
  - `the_wolf_reappears_beside_the_ranger_when_far_or_locked_out`:
    - teleport the ranger 250 px away: within one tick the wolf is within 16 px of them and a `Boom { k: 8 }` was sent;
    - then, inside the boss hall, close the door (`check_arena` with the ranger inside and the wolf outside the door): within 0.5 s + 1 tick the wolf is inside the hall (`arena.contains`).
  - `only_heroes_wake_the_boss_open_chests_and_reveal_mimics` (Review Focus 4): the wolf alone in the boss hall (the ranger outside) for 60 ticks leaves the boss `dormant` and the door open. The wolf standing on a chest leaves it `opened: None`. The wolf next to a hiding mimic leaves it `hiding`.
  - `a_frozen_wolf_does_nothing_and_a_sleep_never_takes`: `apply_effect(Creature::Monster(wolf), Frozen, Some(1.0))` stops it from moving for 1 s; `apply_effect(…, Sleep, …)` returns `false`.
- [ ] **Step 2: Run them** with `… cargo test --release companion`. Expected: they fail, because the wolf stands still.
- [ ] **Step 3: Implement** `tick_wolf`.
- [ ] **Step 4: Run every check.** Run the full server tests: the fingerprints are unchanged, and `run_simulates_without_panicking` now runs a ranger without a wolf.
- [ ] **Step 5: Commit** with `git commit -m "Dire Wolf: follow, guard, dash, bite, leash, reappear; its dash escapes a chasm"`.

---

### Task 9: The growl

**Files:**
- Modify:
  - `server/src/protocol.rs`: `Ev::Growl { id: u32 }`, documented "the wolf `id` growls at an enemy it detected (a sound: sent to the whole party, drawn above the darkness)".
  - `server/src/wire.rs`: `EV_CODES` gains `"Growl"` (code 14); `EvW::Growl(u8, u32)`; `ev_w`; `sample_snapshots` gets an `Ev::Growl { id: 2 }`.
  - `client/src/wire.ts`: decode code 14 into `{ t: 'Growl', id }`.
  - `server/src/run/companion.rs`: step 6 of `tick_wolf`.

**Interfaces:**
- Produces, in step 6 of `tick_wolf` (it only runs with no prey and no wind-up):
  - **Finishing a step.** If `ally.growl_to` is set, walk to it; arrival or `hold` ending clears it, and the wolf goes back to following.
  - **Starting a growl.** It needs `growl_cd ≤ 0`. Find the nearest living enemy (not an ally, not `dormant`; `hiding` counts) that the wolf `sees` and whose id is not in `ally.growled`. Then:
    - push its id and set `growl_cd = WOLF_GROWL_EVERY`;
    - send `Ev::Growl { id: wolf.id }` party-wide (`None`). It is not a position event and never reveals the enemy.
    - Step target: `wolf + dir × min(WOLF_GROWL_STEP, dist − 8)`. Use it only if it is within `WOLF_LEASH` of the ranger, not `blocks_at(_, Mover::Enemy)`, and `walk_line` from the wolf; otherwise there is no step, but the growl still happens.
    - `ally.hold = 0.6`.
  - Drop ids of dead monsters from `ally.growled` every tick (retain the ones still alive).

- [ ] **Step 1: Write the failing tests** in `run/companion.rs` tests:
  - `the_wolf_growls_at_an_enemy_in_the_dark_and_steps_toward_it`:
    - an orc 10 tiles east in an unlit room, outside the ranger's darkvision and inside the wolf's (full darkvision, 18 tiles), with its AI held;
    - after a few ticks there is exactly one `Ev::Growl { id: wolf }` and it is in `run.events` with position `None`;
    - the wolf moved 16 to 24 px toward the orc and comes back within 2 s;
    - after `send_snapshots`, the ranger's snapshot entities do not contain the orc (refactor helper from Task 5).
  - `the_wolf_growls_at_a_hiding_mimic_but_not_at_a_dormant_boss`: a hiding mimic 5 tiles away gives one growl. In the lich hall the dormant lich and its idle disciples give none.
  - `each_enemy_is_growled_at_once_and_growls_are_4_s_apart` (Review Focus 5):
    - two orcs come into sight at the same tick: one growl now, the second after 4 s, not before;
    - move one orc out of sight and back: no third growl.
- [ ] **Step 2: Run them** with `… cargo test --release growl`. Expected: they do not compile.
- [ ] **Step 3: Implement** the code above.
- [ ] **Step 4: Run every check.** Run the full server tests (the wire fixture now includes the growl), then `cd client && npx tsc --noEmit && npm test` (`wire.test.ts` decodes it).
- [ ] **Step 5: Commit** with `git commit -m "Dire Wolf: the growl"`.

---

### Task 10: Wolf art in the atlas and the gallery; the ranger's rapier

**Files:**
- Create: `client/scripts/wolf-frames.ts`
- Modify:
  - `client/scripts/build-atlas.ts`: place the wolf strip below the torches, following the pattern of the other strips, and add it to the header comment and the log line.
  - `client/src/game/anim/defs.ts`: `FIGURES[KIND.DireWolf]` and `isAllyKind`. The ranger's `meleeWeapon` becomes `'weapon_duel_sword'` (the pack's rapier, 9×30 px; the user, 2026-10-16). Add `meleeWeaponScale?: number` to `FigureDef` (it falls back to `weaponScale`) and pick a value so the blade reads as a rapier, not a greatsword (about 0.6, like other weapons). Check the stab in `EntityView` (line ~399): a thrust along the aim, not a swing. Update the comment on `meleeWeapon` ("ranger rapier").
  - `client/src/game/GalleryScene.ts`: show the wolf with the heroes.
  - `README.md` "Credits": the Enchanted Forest wolf is now built into the atlas.

**Interfaces:**
- Produces:
  - `buildWolf(dir: string, width: number): { img: Image; frames: Record<string, Frame> }`. It reads `Wolf_Idle_1..4.png` and `Wolf_Walk_1..4.png` (32×32 canvases) and trims all eight to one shared bounding box, the union of the opaque pixels, so the frames do not wobble. It emits `dire_wolf_idle_anim_f0..3` and `dire_wolf_run_anim_f0..3` with the feet on the bottom row. If the source faces left, mirror it so it faces right like the pack figures (`EntityView` flips by aim).
  - `FIGURES[KIND.DireWolf] = { ...mob('dire_wolf'), swing: { reach: 18, arc: 1.4, color: 0xf0f0f0 }, lunge: 4, handY: 6, attack: 'melee', base: 0x6a6a7a, baseR: 6, label: 'Dire Wolf' }`. Add `lunge?: number` to `FigureDef` ("px the figure darts toward its aim at the start of a Melee anim"). `EntityView` applies it over the first 0.15 s of `ANIM.Melee`, out and back.
  - `export function isAllyKind(k: number): boolean { return k === KIND.DireWolf; }`

- [ ] **Step 1: Write the failing test** in `client/scripts/wolf-frames.test.ts`:

```ts
it('trims the eight wolf frames to one box with the feet on the bottom row', () => {
  const { img, frames } = buildWolf(path.join(root, 'assets-src/enchanted-forest/frames/Wolf'), 512);
  const names = Object.keys(frames);
  expect(names).toEqual([0, 1, 2, 3].map((i) => `dire_wolf_idle_anim_f${i}`).concat([0, 1, 2, 3].map((i) => `dire_wolf_run_anim_f${i}`)));
  const f = frames.dire_wolf_idle_anim_f0;
  expect(new Set(Object.values(frames).map((g) => `${g.w}x${g.h}`)).size).toBe(1);
  expect(f.w).toBeLessThanOrEqual(28); // the spec: about 26 x 17 px
  expect(f.h).toBeLessThanOrEqual(19);
  const bottomOpaque = [...Array(f.w).keys()].some((x) => img.data[((f.y + f.h - 1) * img.w + f.x + x) * 4 + 3] > 0);
  expect(bottomOpaque).toBe(true);
});
```

  Make sure vitest picks up `scripts/*.test.ts`; check `vite.config.ts` `test.include` and widen it if needed.
- [ ] **Step 2: Run it** with `cd client && npx vitest run scripts/wolf-frames.test.ts`. Expected: FAIL (the module is missing).
- [ ] **Step 3: Implement** `buildWolf`, the atlas placement, `FIGURES`, `isAllyKind` and `lunge`.
- [ ] **Step 4: Check it in the browser.** Run `cd client && npm run atlas && npx tsc --noEmit && npm test`. Then open `?gallery` (Vite against the container): the wolf idles and walks next to the Elven Ranger, faces both ways, and its lunge and swoosh show in `?gallery&state=melee&slow=8`. Its dash shows in `?gallery&state=dash&slow=8` (afterimages like the Barbarian's charge; if `EntityView` draws those only for heroes, enable them for `isAllyKind` too). The ranger's melee shows the rapier thrust. Take screenshots with `cd tools/e2e && node gallery-shots.mjs http://localhost:5173/ shots melee` and look at them.
- [ ] **Step 5: Commit** with `git commit -m "Dire Wolf art: trimmed Enchanted Forest frames in the atlas and the gallery"`.

---

### Task 11: The wolf in the game client (bars, numbers, puff, growl, HUD, sound rule)

**Files:**
- Modify:
  - `client/src/game/effects.ts`:
    - `DEPTH.sound = 7500` ("sound text: above the darkness, under the damage numbers");
    - `text()` takes an optional `stroke` colour;
    - `natureSparkles(x, y, r)`: about 18 clear-green sparks, `0x60f070` / `0xc0ffb0`, rising and fading over 0.6 s. This is not the poison tint.
  - `client/src/game/GameScene.ts`:
    - `Boom k === 8` → `natureSparkles`;
    - `case 'Growl'`: `fx.text(wolf.x, wolf.y - 14, 'grrrr', '#e8e0d0', false, DEPTH.sound, '#d8d0e0')` and `views.get(id)?.shake(0.4)`;
    - wolf bars on `heroBars`: `const hero = isPlayerKind(e.kind) || isAllyKind(e.kind)`;
    - the dagger-prediction filter excludes `isAllyKind`;
    - `FrameStats` gets `wolf: boolean | null`: `null` for other classes, else whether the client has a living `KIND.DireWolf` with `extra === info.you`.
  - `client/src/game/anim/EntityView.ts`: `shake(secs)`, a ±1 px horizontal jitter at 30 Hz on the figure for `secs`.
  - `client/src/ui/hud.ts` `frame()`: when `f.wolf !== null`, the secondary slot's `.name` reads `'Heal Wolf'` if `f.wolf`, else `'Summon Wolf'`. The cooldown sweep is unchanged; the 60 s wait shows as a fill because `cdMax` follows a cooldown jump.
  - `client/src/game/status.ts` `sleep()`: the "Z" moves to `DEPTH.sound` with stroke `'#d8d0e0'`. The sound rule covers sleeping sounds.

**Interfaces:**
- Consumes: `KIND.DireWolf`, `isAllyKind`, `FIGURES[KIND.DireWolf]` (Task 10), `{ t: 'Growl', id }` (Task 9), `Boom k: 8` (Task 5).

- [ ] **Step 1: Write the failing tests:**
  - `client/src/game/status.test.ts`: `it('draws the sleep Z above the darkness with a light outline')`. Drive `sleep(true, …)` past `Z_EVERY` with the existing test scene stub and assert the Z text's depth is `DEPTH.sound` and its stroke is `'#d8d0e0'`.
  - `client/src/ui/hud.test.ts` (create it if missing; use jsdom the way other DOM tests do, else test a pure helper `secondaryLabel(wolf: boolean | null, base: string): string` exported from `hud.ts`):
    - `secondaryLabel(true, 'Dire Wolf') === 'Heal Wolf'`;
    - `secondaryLabel(false, 'Dire Wolf') === 'Summon Wolf'`;
    - `secondaryLabel(null, 'Charge') === 'Charge'`.
  - `client/src/game/world.test.ts`: `it('takes the 60 s wait from the server when the wolf falls')`. A `Predictor` for `'ElvenRanger'` with `cd2 = 0` reconciles a snapshot with `me.cd2 = 60`, after which `pred.cd2 ≈ 60`.
- [ ] **Step 2: Run them** with `cd client && npm test`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the code above.
- [ ] **Step 4: Run it in the browser.**
  1. Run `cd client && npx tsc --noEmit && npm test`.
  2. Run `docker compose up --build -d`; `curl localhost:8080/health` should print `OK`.
  3. Play an Elven Ranger with `?debug`. Check:
     - right click gives a green puff and the wolf;
     - the box reads "Heal Wolf";
     - a "grrrr" shows in total darkness;
     - the wolf vanishes under the darkness but its bar does not float alone (the bars are under the fog);
     - the 18-tile sight: the light and the mask reach the screen edge without a seam, and the camera window shows it;
     - the "Z" of a sleeping hero shows in the dark (the lich's sleep mist on a Paladin teammate).
- [ ] **Step 5: Commit** with `git commit -m "Dire Wolf in the client: bars, puff, growl, HUD state; sound text above the darkness"`.

---

### Task 12: Docs, smoke test, handoff

**Files:**
- Modify:
  - `docs/PLAYER_GUIDE.md`: the Elven Ranger, Elf, the wolf and its rules, mimics found by growls.
  - `docs/TECHNICAL.md`:
    - companions (`Monster.ally`, `run/companion.rs`, the foe layer);
    - entity types and responses;
    - `hiding` versus `dormant`;
    - §9 draw order: the new rule "sound text shows above the darkness (`DEPTH.sound`) with a light outline; damage numbers keep their rule";
    - remove Hide.
  - `README.md` (the class list)
  - `docs/TODO.md`: 4a done; item 8 keeps only the bandit and the dark elf; note "Hide may return as an invisibility effect".
  - `HANDOFF.md` ("Next session", a "Last feature" section for the ranger, the code map moved into it)

- [ ] **Step 1: Write the docs.** Check them against the code with `grep -rn "Assassin\|Hide\b\|hidden" README.md docs/PLAYER_GUIDE.md docs/TECHNICAL.md`. Expected: no hits, except a history note in TODO.
- [ ] **Step 2: Run the full verification.**
  - Run the full server tests in Docker, then `docker compose -f docker-compose.test.yml down`.
  - Run `cd client && npx tsc --noEmit && npm test && npm run build`.
  - Run `docker compose up --build -d` and `curl localhost:8080/health`.
  - Run `cd tools/e2e && node smoke.mjs http://localhost:8080/ "" shots ElvenRanger,Paladin`. Expected: "no browser errors". Look at the screenshots in `shots/`. If `smoke.mjs` names classes by display text, pass what it expects.
- [ ] **Step 3: Commit and report.** Commit with `git commit -m "Elven Ranger: docs and handoff"`. Report the results to the user with the test output. Do not push unless asked.
