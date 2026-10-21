# Rules log — design (2026-10-21)

For: the agent who writes the implementation plan (superpowers:writing-plans) in a separate session, and the agent who builds it in yet another session. Decided with the user on 2026-10-21. It comes **before progression plan 4** (the user: "inject a feature before anything else is done").

## Intent

Players should be told, transparently, what the rules are doing. Today a number floats up from a goblin and nobody can say why it was 9 and not 12, or why the War Cry did nothing to the skeleton. The log answers exactly two questions (the user's words):

1. **"Why has that enemy received that amount of damage?"**
2. **"Why is this enemy not affected by my ability?"**

It is a plain **text log** the player can **toggle on and off**. While the log is on, every creature on screen shows a **short tag** (for example "Goblin 3"), and the log uses the same tags, so a line can be matched to a figure. (The user noticed that "the enemy is difficult to identify" — the tags are part of the feature, not a nicety.)

## Goals

- Every damage calculation shown step by step: who hit whom, with what, the base number, the Attribute scaling, the split by damage type, each resistance, every multiplier (from behind ×2, Poison Coat share, Chain Spark falloff, overkill carried on), and the result with the target's HP before and after.
- Every effect outcome shown with its reason: applied (with the duration formula: base × (1 + (power − save) / 20), the save Attribute named), refreshed, **refused** (which rule: resistance %, stronger tier already on, cancelled by its opposite, saved down to 0 s, water), **replaced** (stronger tier replaced the weaker), **cancelled** (fire ends cold and the other way round), ended or expired.
- **Non-events with a reason**, where the rules decided something did not happen: Chain Spark did not jump (no line of sight, out of reach, already hit, an ally), an area ability skipped a target (hidden, dormant, behind a wall), a secondary was blocked in melee ("Too close").
- Enemies hitting the player use the same lines, so players see their own resistances and saves at work.
- Heals (amount and source), effect ticks (damage over time: one short line per tick), deaths and kills (who killed whom).
- Two toggles: **log on/off**, and **details on/off** (off: one headline line per event; on: the headline plus its detail lines).

## The shape of a line (approved by the user)

A headline per event, then detail lines, each one step in the order the server computes it. Numbers rounded to one decimal.

```
12.4s  Ayla ▸ Frost Shard ▸ Goblin 3: 9 damage (HP 14 → 5)
       base 10 (given at INT 14), your INT 16: ×1.06 → 10.6
       cold 40 %     4.2 × (1 − 0 % resist)  = 4.2
       physical 30 % 3.2 × (1 − 20 % resist) = 2.6
       magical 30 %  3.2 × (1 − 25 % resist) = 2.4
       Chilled: applied, 2.0 s × (1 + (power 10 − CON 8) / 20) = 2.2 s
```

(The numbers in this example are made up; the real ones come from the formulas in the code.) Other lines in the same shape:

- `Fear ▸ Skeleton 2: refused (undead resist Fear 100 %)`
- `Frozen ▸ Goblin 1: replaced Chilled` · `Singed ▸ Goblin 1: cancelled Frozen`
- `Chain Spark did not jump to Goblin 4: no line of sight`
- `from behind ×2` · `Poison Coat +30 % poison` · `overkill: 6 carried on to Goblin 4` · `Chain Spark jump 2: ×0.49`

## Non-goals

- **No chat.** A chat window is a separate, much later TODO (docs/TODO.md "Chat window"). The log panel may later share a panel with chat, but nothing in this design builds chat.
- No combat statistics, DPS meters, history across runs, or export/download of the log.
- No new rules. The log describes the rules; it never changes a number.
- No new art. Tags and the panel use the existing pixel font and UI style.

## Anti-goals (what makes it a failure even if it "works")

- **A log that lies.** If a line ever disagrees with what actually happened, the feature does harm. The lines must be built **from the same computation** that produced the result (the server records the steps as it computes them), never recomputed separately on the client or in a parallel function that can drift. A test must pin that the logged final number equals the damage actually dealt / the duration actually applied.
- **A log that changes the game.** Building the log must not change the simulation: the three fingerprint tests (`level_setup_is_unchanged`, `simulation_is_unchanged_after_waking_the_boss`, `plan_3a_fight_is_pinned`) pass unchanged with the log on and with it off.
- **A log that costs the game.** With nobody's log on, the server does no extra work worth measuring and sends nothing extra. With it on, a busy fight must not cause lag (no correction jumps in the e2e smoke; bandwidth bounded).
- **A log that leaks.** It must not reveal what the player cannot see (monsters in the dark or behind walls, a hidden mimic's true nature before it is revealed). See "Who sees which lines".
- A flood: details off must keep a big fight readable.

## Constraints from the project (binding)

- Terminology: "Attributes" (never "ability scores"); "ability" means only the LMB primary and RMB secondary; never "elemental", say "damage-type effect". No chance anywhere (nothing to log about rolls). No `_ =>` wildcard arms over the game's enums (`AbilityId`, `Shape`, `EffectKind`, `EffectLook`, `AbilityMod`, `PropKind`, `WeaponKind`, `EquipSlot`, `DamageType`); a new log-reason enum should be declared so that adding a variant without its text does not compile.
- The server is authoritative; the client predicts. Log lines come from the server only (predicted cosmetic hits produce no log lines).
- Wire format: msgpack (`server/src/wire.rs`, `client/src/wire.ts`), bindings by ts-rs (`client/src/generated`, regenerated with the docker suite `docker compose -f docker-compose.test.yml run --rm test`). Events already carry an optional position (`Run::event(ev, at)`) for visibility filtering.
- One apply path for effects already exists (`Run::apply` in `server/src/run/effects.rs`, ordered: cancel → stronger tier → save → resistance → water → add → remove weaker). Damage goes through `defs/damage.rs::resolve` and the hurt paths in `run/abilities.rs` / `run/mod.rs`. These are where the steps get recorded.
- Verification as for every plan: `cd server && cargo test -- --skip export_bindings`, the docker suite, client `cd client && bash -lic 'npx vitest run && npx tsc --noEmit && npm run build'`, the e2e smoke for ElvenRanger,Paladin and Wizard,Barbarian (see HANDOFF "Verify").
- Build rules (the user): implementers and fixers on Sonnet, task reviews and the final review on Opus; merge and push only when the user says.

## Decided by the user

- A text log, toggled on and off by the player.
- While the log is on, creatures show identifiers, and the log uses them.
- The line shape above (headline + calculation steps), including refusals and non-events with their reason.

## The agent's calls (approved in principle with the line shape; the planning session may refine them)

- **Details toggle:** a second toggle hides the detail lines (one headline per event).
- **Rounding:** one decimal everywhere in the log.
- **Tags:** heroes by their character name; the wolf as "<name>'s wolf"; monsters as "<Kind> <n>", numbered per kind in the order they spawn in this run (Goblin 1, Goblin 2, …), stable for the run; objects (barrels, chests) as "Barrel 2", "Chest 1" when they take part (a barrel blast). A hidden mimic is tagged as a chest until it is revealed. Tags are drawn small above each tagged figure only while the log is on.
- **Who sees which lines** (decided by the user, 2026-10-21, after the builder check; the log has **its own visibility rule**, stricter than today's events — today a hero's hit is sent to the whole party even out of view, `hurt_monster`'s `seen_by`):
  - **Your own side in full:** every line you (or your own wolf) take part in, wherever it happened, shows your side completely: your damage and its calculation, your resistances, your saves.
  - **The other creature only if you can see it:** it is named (tag) and its numbers (HP, resistances, Attributes, save) are shown only if it is in your view at that moment; otherwise it appears as "something unseen" (as attacker: "an unseen attacker hit you for 7", followed by your own resistance steps).
  - **Teammates' events:** if you can see the event, you get it in full like your own. A teammate's hit on a monster nobody in your view can see gives you only a short headline ("Bran hit something unseen"), no calculation.
  - **No revealing non-events:** a skip reason is sent only if it reveals nothing you cannot see: no "did not jump to Goblin 4: no line of sight" for an unseen goblin, and never "hidden" for a disguised mimic (a hidden mimic is a chest in every line until it is revealed).
  - A spectator gets what the spectated hero gets.
  - Each rule gets a leak test (an unseen monster's tag, HP or resistances never reach a player who cannot see it; a hidden mimic is never named a mimic).
- **Opt-in on the wire:** the client tells the server when its log is on (a small `ClientMsg`), so the server records and sends log lines only to players who want them; with no log on anywhere, the recording is skipped.
- **Panel and keys:** a semi-transparent panel at a screen edge, newest at the bottom, scrollable, limited to the last few hundred lines; `L` toggles the log, a second key or a small button toggles details. The on/off and details choices are remembered per browser (localStorage, with the usual try/catch).
- **Time stamp:** run time in seconds at the start of each headline.

## Left to the builder (planning session)

- The data shape of a log record on the wire: structured (ids, numbers, reason codes, the client formats the text) or pre-formatted text from the server. Structured is preferred if it keeps text and numbers testable on both sides; either way the numbers come from the server's computation.
- How the steps are captured inside the damage and apply paths without slowing them down when nobody listens (for example an optional recorder passed in or held on `Run`), and how lines are grouped (one headline record carrying its steps).
- Exact panel size, position, colours, font size, scroll behaviour, the details key, and how tags avoid overlapping health bars and effect marks.
- Which secondary events beyond the goals get lines (pushes by STR against weight, knockback, coins) — include them only if cheap; damage and effects come first.
- How to split the work into tasks; where to put the formatting code; the tests.

- **The Attribute step** (builder check note, the agent's call): a hit's Attribute scaling is computed when the character sheet is built (`sheet.rs::resolve_ability`), not at the hit. Record that breakdown when the sheet is built (for example on `ResolvedAbility`) and log it from there; do not recompute it for the log.
- Where effect lines sit when details are off (their own headline or a detail of the hit), which skipped targets get a line (within the visibility rule), and the bandwidth cap.

## Open questions the planning session should ask the user (only if they change the plan)

None known. The builder check (2026-10-21) raised only the visibility questions, which the user settled ("Who sees which lines").
