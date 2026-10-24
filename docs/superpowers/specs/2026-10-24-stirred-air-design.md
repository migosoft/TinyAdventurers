# Stirred air: dust and smoke react to movement (#158)

Issue: #158. Builds on #148 (`client/src/game/mood.ts`, the dungeon air), which is not merged yet: this work branches off `feature/148-dungeon-mood` as `feature/158-stirred-air`.

## Why

The user, 2026-10-24: dust and smoke should swirl "as if there's real air", reacting to the creatures, characters and projectiles moving through it. "If you manage that, it would increase immersion a lot." Today the #148 air drifts on its own and ignores everything that moves.

## What the player sees

- **A pocket of air** (the user, 2026-10-24: "influenced before an actual touch … as if there's a pocket of air pushed around by things"): every moving thing carries a cushion of air reaching well beyond its body. Specks ahead of it start to move before it arrives, pushed forward and aside like a bow wave; specks beside it slide outward; behind it the air is drawn along into the wake. The push fades smoothly with distance, so far specks only stir a little.
- **Figures** (heroes, allies, enemies, bosses) that move push the air along their direction and a little outward, more strongly the faster they move. The dust curls into a swirl behind them, not just a straight shove. Standing still pushes nothing. A dash or charge makes a strong swirl. Bigger figures (bosses, the ogre) stir a wider area.
- **Projectiles** (arrows, bolts, fireballs, magic missiles) cut a narrow wake: specks along the path are pushed aside and along the flight direction.
- **Explosions** (the snapshot's `LIGHT_KIND.Blast`) push the air outward in a ring.
- **A gentle background draft** (the user, 2026-10-24): even with nothing moving, the air is never quite still. A faint current wanders slowly; its direction and strength change over tens of seconds and differ a little from place to place, so neighbouring clouds do not move in lockstep. It is far too weak to break up a cloud. Dust clouds drift with it (it **replaces** #148's random drift of the whole cloud; the small wander of each speck inside its cloud stays, and so does the slight upward float), and smoke leans with it.
- **Torch and lava smoke** bends the same way: a passing figure or shot sways the plume for a moment, then it rises straight again as the air calms.
- **Embers** drift with the air too.
- **Disturbed dust clouds dissipate** (decided with the user in the issue): once a cloud is stirred, its specks are released from the cloud's pull, drift on with the air, slow down and fade out over about 1–2 s, and the cloud then respawns at a new lit spot. A busy fight visibly clears the air; the dust settles back afterwards.

## The approach: one shared wind field

Agreed with the user: one invisible, coarse wind map over the view, so everything reacts as one body of air rather than through separate tricks.

- A **grid of air velocities** (cells about half a tile, 8 px) covering the camera view plus a margin, **anchored to the world** so camera movement does not move the air. It is a new pure module (e.g. `client/src/game/wind.ts`) with no Phaser dependency, so it is unit-tested directly.
- **Movers push air into it** each frame: position, velocity and a size. A moving figure adds air in a soft pocket that reaches about twice its size around it and leans forward (so the air ahead moves first): forward and outward ahead, outward at the sides, along with it behind, plus a weak counter-rotating pair behind it so a wake curls. A projectile adds a narrow push along its path. A blast adds an outward ring once, when it first shows (the existing `BurstOnce`).
- **The air spreads and calms:** each frame the velocities blur into neighbouring cells and decay, so a gust lives about a second and fades. Cells inside walls (opaque tiles) hold no air, so wind does not pass through walls.
- **The draft** is not stored in the grid: it is a smooth, slowly changing function of position and time (low-frequency noise), added to the grid's value wherever the air is sampled. Inside walls it is zero like the rest.
- **Everything samples it:** each dust speck, smoke puff and ember adds the wind at its position (smoothly interpolated between cells) to its own drift. Smoke and embers react less strongly than loose dust (they are heavier / have their own rise), the builder tunes how much.
- **A stirred cloud:** the gentle edge of a pocket only nudges a cloud's specks (they sway and drift back). When the wind at any of a cloud's specks passes a threshold, the **whole cloud** lets go of all its specks (the issue: "once a dust cloud is disturbed, it dissipates"). Its specks keep their world positions, move with the wind plus their own momentum and drag, fade out over about 1–2 s, and when all have faded the cloud respawns. Specks the gust did not reach just drift and fade where they are.

## Respawn after stirring (to try in the demo)

From the issue comment: try an **instant** respawn versus a **short delay** (a few seconds) for stirred clouds. The demo gets a button to switch between them; the user picks one on their phone, and the game uses that. Undisturbed clouds keep #148's behaviour (live 6–12 s, respawn at once).

## Where the movers come from (game)

- Figures: `GameScene`'s interpolated entities (`this.ents` after `interp.sample`) and the own hero from prediction (`pred.renderPos`). Velocity is the change since the last frame per entity id. A jump larger than a dash can make in one frame (spawn, teleport, a lagged correction) pushes nothing.
- Projectiles: the projectile entities as drawn, plus the local cosmetic shots (own shots whose server copy is hidden must not push twice).
- Blasts: the snapshot's moving lights with `LIGHT_KIND.Blast`, as #148 already reads them.

## Constraints

- **Reveals nothing.** The server only sends enemies the player can see; still, only movers on a seen tile push air (the same `seenAt` rule #148 uses for shots), and dust only shows on seen, lit tiles. Torch smoke, which draws over the darkness, must therefore only react to things the player can see.
- **Cheap.** Only movers in the camera window (plus the existing margin) count. The grid is small (a few thousand cells for a desktop view); specks (≤ 168), puffs (≤ 200) and embers (≤ 160) each take one grid sample per frame. No per-frame allocations in the hot path beyond what #148 already does.
- **Client-only and cosmetic.** No server or protocol change; the simulation fingerprint tests are untouched.
- **Responsiveness** stays a priority: nothing here may cost the frame rate noticeably; check with F3 in a real run.
- Follows the #148 drawing order and visibility rules unchanged.

## Demo first

`?mood` (MoodDemoScene) gets, on top of what #148 shows:
- a figure walking a loop through the lit part of the room,
- a dash now and then (a short fast burst along its path),
- an arrow crossing the room,
- the existing fireball and its explosion (now pushing the air).

New buttons: **Stir: on/off** (to compare with #148) and **Respawn: instant/delayed** (delayed = 3 s, Claude's call; a URL parameter may override it for trying other values).

**Two phases with a checkpoint:** phase 1 builds the wind field, the reactions and the demo, and deploys the demo to the VPS (bundle, like #148). The work then stops for the user's verdict on their phone (respawn mode and overall strength). Phase 2 applies that verdict and wires the air into `GameScene`.

## Goals

- Dust, smoke and embers visibly swirl around moving figures and projectiles, and burst outward from explosions, as one consistent body of air.
- It looks natural on the user's phone in `?mood`, and in a real run.

## Non-goals

- The haze does not react (builder's call, see below).
- No server simulation of air, no gameplay effect (air never affects movement or hits).
- No new art: specks, puffs and embers stay the #148 textures.
- No reaction to things the player cannot see.

## Anti-goals

- Air that leaks information: smoke over the darkness twitching because of an unseen enemy.
- Jitter: dust snapping or teleporting when the camera moves, an entity is corrected or a figure respawns.
- Dust that never comes back: the room must not stay empty after a fight.
- A frame-rate cost players notice.

## Calls made by Claude (not discussed with the user)

- The draft is room-wide noise, not flowing along corridors and through doorways (that version was offered as noticeably more work; a possible follow-up). The demo's **Stir** button switches the draft too; a separate **Draft: on/off** button lets the user judge it alone.
- The haze stays as it is: it is one world-anchored tiled texture, and bending it locally would need a shader. Can be a follow-up if the user misses it.
- The method: a coarse velocity grid with blur and decay, plus a small vortex pair behind movers for the curl, rather than a full fluid solver (no pressure solve).
- Cell size about 8 px; a gust lasts about a second.
- Embers react to the wind, more weakly than dust.
- A stirred cloud releases all its specks at once, not only those the gust reached.
- The delayed respawn waits 3 s; the work pauses after the demo for the user's verdict.

## Left to the builder

Exact strengths, decay rate, blur, vortex size, thresholds for stirring a cloud, how strongly smoke and embers follow the wind, the grid margin, and how the grid follows the camera (re-anchoring while keeping cells world-aligned).
