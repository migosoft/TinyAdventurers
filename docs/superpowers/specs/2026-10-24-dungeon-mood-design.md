# Dungeon mood: warm light, dust, smoke, embers, haze, drips

Issue: #148. Status: approved by the user on 2026-10-24 ("I like it all now ... Implement"), designed through a throwaway spike (`?mood` demo, branch `spike/148-mood`, deployed to the VPS for a phone check). Spin-offs: #156 (daylight rays through ceiling cracks), #157 (colour grading per dungeon).

## Why

The user finds the dungeons too clean and sterile ("a dungeon where the air isn't that clean"), and finds the torches too bright at their brightest: they wash out the colours. Enhanced pack art (#145) made no visible difference, so the answer is runtime mood effects and a change to how light tints the scene, not new sprites.

## What the user approved

The user tried every piece in the `?mood` demo on their phone, tuned it with me, and approved it. The approved look is the spike at commit `e105067`:

1. **Warm light instead of the additive tint.** The light canvas tints by *multiplying* with the light's hue instead of *adding* its colour. Near a torch, stone and figures keep their own colours and become warmer, never paler. The existing torch flicker stays as it is.
2. **Dust:** faint motes drifting in small, loose clouds, visible only where a tile is lit and seen, brighter where the light is brighter, and coloured by the light (its hue blended halfway to white, ADD blend). The user explicitly preferred this "lit" look to plain grey specks.
3. **Torch smoke** ("perfect now"): puffs from the flame's tip in uneven gusts with quiet gaps, some gusts guttering into dark soot among the grey.
4. **Lava smoke:** heavier, darker smoke rising from lava.
5. **Embers:** small orange sparks rising off lava; fire shots trail embers and fire explosions throw a short burst of them.
6. **Haze:** a thin, slowly drifting, cloudy layer over the whole map.
7. **Water drips:** now and then a drop falls into a water pool, leaving two flattened ripple rings and a tiny splash.

## Goals

- Bring all seven pieces into the real game (`GameScene`), looking like the approved spike.
- Keep the `?mood` demo as a permanent dev page for these effects (like `?lights`), with its room, fireball, pool and lava, and its on/off buttons for dust, smoke, embers, haze and drips; without the spike's comparison buttons (old/new light, grey dust).

## Non-goals

- No setting to switch the air off (the user, 2026-10-24: "No dungeon air switch").
- No colour grading or vignette (#157), no daylight rays (#156), no new light sources or changes to light radius/intensity/flicker (#105, #110 stay separate).
- No new sprite art (the art rule: runtime effect shapes only).
- No server change, no wire change, no new generated data.

## Anti-goals (failure even if it works)

- Anything that shows unseen tiles or enemies. Every effect sits under the darkness, so the darkness and the vision mask hide it exactly as they hide figures; the one exception is torch smoke (below), which only comes from torches in sight.
- Lit areas that look paler or more washed out than today.
- Enemy HP bars or damage numbers hidden by the air.
- Noticeable frame-rate cost ("no lag" is a standing priority).

## Decided by the user

- Warm (multiply) tint replaces the additive tint everywhere, for every light kind (torch, lava, fire, magic, blast, holy, radiant), in the game and in `?lights`.
- Dust is "lit" (light-coloured, ADD), not grey; peak opacity 0.55; in clusters.
- All pieces are on in every dungeon ("All of it"). Lava smoke and lava embers appear only where there is lava, drips only where there is water.
- **Depth:** the air draws over figures, projectiles, spells and effects, and under enemy HP bars and damage numbers, the tint and the darkness: new `DEPTH` entries between `DEPTH.fx` (6000) and `DEPTH.enemyBars` (6500), haze lowest, then dust, smoke, drips, embers. (The spike uses `enemyBars - 10` and up.)
- **Torch smoke over the darkness:** a torch's smoke rises at once into the dark wall top above it, where the darkness would swallow it. So torch smoke is drawn just above the darkness (`DEPTH.fog + 0.5`, under the lich beams at 7001), but only from a torch whose floor tile is seen and lit; its puffs fade out within about 0.25 s when that tile leaves the view. The torch itself is already visible, so this reveals nothing.
- Fire embers: moving lights of kind Fire trail embers; a moving light of kind Blast throws one burst when it first shows.
- No air setting (see Non-goals).

## Density (my call, after the builder check; the user agreed)

The user judged a phone view of about 15 × 16 tiles; a desktop view at 1080p shows about 3–4 times that area. Keep the approved *density*, not the counts:

- the number of dust clouds scales with the camera's world area: 7 clouds per 240 tiles, at least 4, at most 24;
- lava smoke and lava embers spawn per lava tile in view: on average a smoke puff every 4.2 s and an ember every 1.08 s per tile (the spike's rates over its 12-tile pool);
- drips are per water tile already (one every 7 s per tile in view, on average);
- torch smoke is per torch already;
- motes stay 1 world pixel (they scale with the pixel art);
- hard caps as safety limits: ≤ 24 clouds, ≤ 200 smoke puffs, ≤ 160 embers (lava and fire share them), ≤ 12 drips.

Effects spawn only for torches, lava and water tiles inside the camera window (plus a small margin), and fire embers only for moving lights in the window.

## Tuned values (from the spike, keep them)

- **Warm tint** strength `0.45`: per channel `255 * (1 - s * (1 - c / max))` with `s = 0.45 * min(1, max / 255)`, `c` the channel of the summed light colour and `max` its brightest channel; tint image blend MULTIPLY; tiles that are not seen-and-lit get white (no change). `blackenDarkTiles` keeps writing alpha 0 for dark tiles (with MULTIPLY in Phaser's WebGL blend that leaves the scene unchanged, and the darkness covers them anyway).
- **Dust:** cloud radius 6–16 px, 7 motes per cloud, cloud life 6–12 s with 1.5 s fade in/out (first lives staggered), cloud drift ≤ 2.5 px/s with a slight updraft, motes wander ≤ 1.5 px/s and are pulled back past the radius, 1-px dots (`dot` at scale 0.5), twinkle `0.6 + 0.4 sin`, alpha `0.55 * min(1, 1.3 * brightness) * fade * twinkle`; a cloud spawns at a random spot in view accepted with probability brightness² (up to 8 tries, else retry in 0.3 s).
- **Torch smoke:** per torch, alternating gusts (0.3–1.1 s, a puff every 0.07–0.19 s) and quiet gaps (0.5–1.9 s, a stray puff with chance 0.4 every 0.6–1.4 s); each gust is sooty with chance 0.3 (then 65 % of its puffs are soot, else 12 %). Origin: the flame tip, `flameTip()` in `torch.ts` (17 px above the sprite's foot, half a pixel right of centre, mirrored for side 2), jittered ±1 px across and up to 1.5 px up. Puff: rising 8–15 px/s and slowing (`vy *= 1 - 0.25 dt`), sideways drift ±1.5 px/s plus sway 3–6, scale 0.3 → 0.6–1.0 (soot 0.8–1.2), alpha up to 0.26 (soot 0.34), fade-in over the first 5 % of life, life 2.4–4 s, grey `0xb09a86`, soot `0x2e2824`, NORMAL blend, the generated soft 32 px puff texture (LINEAR).
- **Lava smoke:** rising 6–10 px/s, scale 0.4 → 1.4–1.9, alpha up to 0.28, life 3.5–5 s, tint `0x4a3c38`.
- **Lava embers:** rising 14–28 px/s with sideways wobble, life 1–2.4 s, `0xffb040` or `0xff6a20`, ADD.
- **Fire embers:** a fire shot trails one ember every 0.04 s, ±3 px around it, velocity ±8 px/s across and 6–20 px/s up, life 0.35–0.8 s; a blast throws 18 embers outward at 20–50 px/s (vertical squashed to 0.7, biased 10 px/s up), life 0.6–1.4 s. Same colours as lava embers.
- **Haze:** two tiling sprites of the generated 128 px cloud texture over the map, tile scales 1.6 and 1.1, alphas 0.10 and 0.07, tint `0x8a7c6c`, drifting at (2.2, 0.6) and (−1.4, 1.1) px/s.
- **Drips:** drop (a 1 × 2 px pale blue `0xd8ecff` dot) falls 18 px onto a random spot in the tile in 0.35 s (accelerating), then over 1 s two ellipse rings (height half the width) grow to 14 and 9 px wide, the second starting 0.2 later, alpha 0.7 → 0, and in the first 0.3 s two 1-px droplets hop up to 3 px and back.

## Left to the builder

- **Code shape:** turn the spike's `mood.ts` into a clean module (for example `Mood` with dust, smoke/embers, haze and drip parts) with unit tests for the pure parts (the warm tint formula, `flameTip`, cloud counts by view area, per-tile spawn rates, caps, the blast "burst once" rule). Remove the `MOOD` global, the old ADD path and the `setLook` switch from `lightview.ts`; replace `TINT_ALPHA` with the warm strength; keep the per-tile light and seen-lit data `Mood` needs as a small read-only accessor. Update `lightview.test.ts` where it assumes the ADD tint. Drop the spike's `window.mood` debug hook.
- **Game wiring:** `GameScene` creates the `Mood` after its `LightView` and updates it after `lightView.update` each frame, with the lit torches in the window (from the torch entities: `e.x`, `e.y`, `e.extra` side, `e.anim === 1`) and the snapshot's moving lights. Lava and water tile lists are collected at run start and again on `mapChanged` (terrain can change). Destroy everything on scene shutdown.
- **`?lights`:** keeps working and now shows the warm light; no air effects needed there.
- **Darkvision:** the greyscale post-effect applies on top as today; nothing special.
- **Docs:** TECHNICAL.md (rendering: warm tint, mood layers and their depths including the torch-smoke exception, density and caps) and PLAYER_GUIDE.md (a line about the dungeon air, if the guide describes the look of dungeons; otherwise say "no change" in the closing comment).

## Verification

- Client unit tests, `tsc`, build; the docker test suite runs as usual before merging (no server change expected).
- Screenshots of `?mood` and `?lights`; a smoke run (`smoke.mjs`) for both class pairs with no browser errors; in a real run, check that nothing shows in unseen areas (dust, lava smoke, embers, drips), that torch smoke only rises from torches in sight, and that enemy HP bars and numbers stay above the air.
- The user checks it in the browser (`play-test`), on the VPS like the spike.
