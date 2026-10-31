# Daylight rays through ceiling cracks

Issue: #156 (follow-up of #148, dungeon mood). Status: description approved by the user in chat on 2026-10-31; this document awaits their review.

## Why

The user wants some rooms to feel like sunlight is getting in through a crack or a hole in the ceiling: a pale, slanted beam with dust glinting in it, landing on a bright patch of floor. It adds variety and a quiet, beautiful moment to the dark dungeons. It is also the seed of a later "sunlit cove" riddle room (grass, flowers, a tree, a nymph; recorded in #9), which is **not** part of this work.

## What it looks like

- **The light:** a real light that the server knows about. It is cooler and whiter than torchlight and never flickers. It lights a round patch of floor and the area around it, the way a wall torch lights its surroundings. Anyone standing in it can be seen, enemies included.
- **The beam:** a pale band slanting down from the ceiling to a round bright patch on the floor. The ceiling gap itself is not drawn; the beam **fades in from above**, the way the water drops come out of nowhere. Dust drifts and glints in the beam, thicker and brighter than the torchlight dust from #148.
- **Clouds:** now and then the light slowly dims and comes back, as if a cloud passed. Each sunlit spot keeps its own timing. This **only changes the look**: the server's lit area never changes size.

## Goals

1. A new light kind for sunlight (working name `Daylight`) on the server, with the shadowcast and the client in parity like every other light.
2. Sunlight as a **piece that can be placed on any tile**: level generation places it now, and designed rooms (#9, the cove) can place it exactly later.
3. Random placement: **0–2 sunlit rooms per level**, in **every dungeon** (the demon's lava dungeon too), with the same daylight colour everywhere.
4. The beam, patch, beam dust and cloud dimming on the client, drawn for every static light of kind `Daylight`.
5. **Demo first:** a `?sunlight` dev page (like `?mood`, no server), deployed to the VPS so the user can judge it on their phone. It has switches for the beam shape (straight vs. widening toward the floor), patch size, slant and cloud strength. The game build uses whatever the user picks there.

## Non-goals

- The sunlit cove riddle room, grass, flowers, nymph (#9).
- Different daylight colours per dungeon theme, colour grading (#157).
- Drawing the ceiling crack or hole.
- A time of day, or daylight changing over a run.
- Any gameplay effect of sunlight beyond what light already does (no healing, no undead burning, no damage).
- New sprite art (the art rule: runtime effect shapes only).

## Anti-goals (failure even if it works)

- **The client draws a tile lit that the server counts as dark.** Lit tiles decide which enemies are sent, so a client-only patch, or a beam that lights tiles itself, is not allowed. The beam, patch and dust are drawn under the darkness and the vision mask, exactly like the #148 air, so they never reveal unseen tiles or enemies.
- The cloud dimming taking a lit tile to black (see the `light.ts` rule: a tile the server counts as lit is never drawn fully black).
- The beam looking like a lamp or a spell (warm, coloured or flickering) instead of daylight.
- A noticeable frame-rate cost ("no lag" is a standing priority).

## Decided by the user

- Sunlight is a real server light, not a client-only effect (2026-10-24).
- Cloud dimming is look only; the lit area never changes size (2026-10-31).
- The same daylight colour in every dungeon, the demon dungeon included (2026-10-31).
- 0–2 sunlit rooms per level, chosen at random (2026-10-31).
- **Never in the boss room; the start room is allowed** (2026-10-31).
- **A sunlit room's torches are out** (2026-10-31: "no need for torches so why should someone light them?"). The sunbeam is the room's light, so its colour isn't washed out by warm torchlight.
- The beam fades in from above like the water drops; the ceiling gap is not drawn (2026-10-31).
- Sunlight can be placed on any tile, so designed rooms can use it later (2026-10-31).
- Demo page on the VPS first; into the game only after the user picks (2026-10-24).

## My calls (not confirmed by the user)

- **Starting values for the demo** (the user tunes them there): patch about 2 tiles across; light radius 7 tiles (a wall torch's reach); beam slanting 1–2 tiles sideways; beam widening toward the floor as the default shape.
- **Colour:** a cool white, around `0xdce8ff`; intensity around 0.9; flicker 0 (the cloud dimming replaces it).
- **Cloud dimming numbers:** the centre drops to about 55–70 % at its lowest; a cloud takes 3–6 s to pass; 8–25 s of full sun between clouds; timing seeded from the light id so each spot differs and every client sees roughly the same thing.
- **How a cloud dims:** the centre darkens and the rim stays where it is: brightness `EDGE + (b − EDGE) · k` with `k` the cloud factor, not a plain `b · k`. A plain scale through `flicker()` would push rim tiles below `EDGE` (0.1 × 0.55 = 0.055). This needs a small change in `LightField.accumulate` (or a dedicated path for this kind), not only a `flicker()` factor. The demo's cloud-strength switch shows the same formula.
- **Slant direction:** one direction for the whole game, so the dungeon reads as having one "outside". The demo has a **direction switch too** (left/right), and the user's pick is recorded with the other values.
- **Out torches, not missing ones:** torches are placed as today (same positions, so torch placement and its tests stay unchanged), and every torch whose floor tile lies in a sunlit room **starts unlit**. Players can already light and put out torches (`run/objects.rs`, the torch toggle), so they can still light one if they want. `spawn_torch` needs a "start unlit" option. In the start room, the sun counts as the light that `place_torches` guarantees there. Sun rooms are chosen independently of `DARK_SHARE`: a dark room may get a sun, which lights it.
- **How many suns:** 0, 1 or 2 per level with weights 25 % / 50 % / 25 %, so most levels have one and few have none.
- **`LightKind` is a plain enum with a hand-kept `ALL` list.** The project rule says a new variant must be impossible to half-add, so the builder either moves it to `listed_enum!` or makes sure every match and the `ALL` list fail to compile/test without the new row.
- **Placement rules:** the sun tile is plain floor (not water, lava, chasm or a wall) and at least 1 tile away from the room's walls, so the patch lands inside the room. At most one sun per room. Its own random stream in level generation (like torches use stream 12), so adding it does not move anything else that is generated.

## Constraints from the code

- `LightKind` in `server/src/defs/lights.rs` is a plain `#[repr(u8)]` enum with a `def()` table and an `ALL` list; the client gets it through the generated `LIGHT` defs. A new light source is "a new row here plus an `add_light` call, never new core code".
- Static lights reach the client as `LightInfo` `[id, kind, colour, x, y, on]` at run start. The client's `LightField` (`client/src/game/light.ts`) runs the same shadowcast as the server (checked by fixtures). The client knows the light's kind, so it can draw the beam for every `Daylight` light without any wire change.
- Brightness per light per frame goes through `flicker(kind, id, t)` in `client/src/game/lightview.ts`; the cloud dimming fits there (a per-kind factor), keeping the lit tile set unchanged.
- Level generation (`server/src/dungeon/generate.rs`) knows rooms, the start room and the boss room; `Layout` is what `Run` sees (`torches` is the model to follow: a list on `Layout`, turned into lights in `Run::new`).
- Dust: the #148 `Mood` (`client/src/game/mood.ts`, `moodmath.ts`) spawns dust clouds where light is bright; denser dust in the beam builds on it.
- Fingerprint tests in `server/src/run/mod.rs` will change when lights are added: re-record them once and say so in the commit.

## Left to the builder

- Code shape on both sides: where the "sun spots" list lives (on `Layout`, like `torches`), the helper that places one sun spot on a tile (the reusable piece), and how the client module for beams is split from `Mood`.
- How the beam and patch are drawn (runtime gradient shapes, ADD blend, under `DEPTH.fog`), and how the "fades in from above" gradient is done.
- How dust is made denser in the beam (more clouds spawned along the beam, or a dedicated set of motes).
- The demo page's layout and controls, following `?mood` (buttons at the bottom, URL parameters, zoomed to fit a phone).
- Tests: server unit tests for placement (count 0–2, never the boss room, floor only, deterministic per seed), the new kind in the light parity fixtures, client unit tests for the pure parts (cloud dimming curve stays above `EDGE`, beam geometry).
- Docs: TECHNICAL.md (the new light kind, placement, the beam layer) and PLAYER_GUIDE.md if it describes the look of dungeons.

## Order of work

1. The `?sunlight` demo page, deployed to the VPS; the user picks shape, size, slant and cloud strength.
2. Record the picked values in this document and on #156.
3. Server: light kind, placement, tests, fixtures, fingerprints.
4. Client: beam, patch, dust, cloud dimming in `GameScene`.

## Verification

- Server tests in Docker, client unit tests, `tsc`, build.
- Screenshots of `?sunlight`, and of a real run with a sunlit room; a smoke run (`smoke.mjs`) without browser errors.
- In a real run: nothing of the beam shows in unseen tiles; an enemy standing in the patch is visible; the lit area does not change while a cloud passes.
- The user checks it on their phone on the VPS (`play-test`).
