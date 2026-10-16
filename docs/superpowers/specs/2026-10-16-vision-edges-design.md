# Straight vision edges (visibility polygon mask)

User decisions (2026-10-16):
- **Straight shadow lines** from wall corners and pillars replace the tile-shaped edge of sight. The outer limit of sight is a circle.
- **Crisp, not blurred.** The first demo had a fade of 3/4 of a tile (approach A, blurred). It made the hidden cone behind a pillar flare out, so the edge is now sharp: only the canvas's own antialiasing at 8 px per tile.
- **Hidden areas stay pure black.** Two other looks were demoed and rejected: a dim, bluish map memory and a drifting fog.
- **Approach A** (approved): a mask image above the darkness, drawn by a small shader, and not a camera post effect. A camera effect would also darken the damage numbers and the lich's drain beams, which sit above the fog.
- **Pillars** from the demo went onto the TODO list as their own feature (with torch mounts). The `?lights` demo keeps its two pillars.

**Status:** designed in chat after a spike, approved by the user (2026-10-16). Spike: branch `spike/vision-edges` (reference only, not merged). Plan: to follow in `docs/superpowers/plans/`.

## Context
`LightView` (`client/src/game/lightview.ts`) works per tile. It computes darkness and light colour per tile, upsamples them to 2 px per tile with Catmull-Rom, and sets every tile outside the FOV (and every unlit tile) back to black (`blackenDarkTiles`). The FOV is a tile shadowcast (`sim/fov.ts`, a port of the server's). So the edge of sight follows the tile grid and looks like stair steps, worst in corridors and doorways. That was TODO priority 2, "Vision edges".

## Goal and non-goals
- **Goal:** the drawn edge of sight is the true line-of-sight boundary from the hero's pixel position, with straight shadow lines, a crisp antialiased edge and a circular limit.
- **Client only.** The server's per-tile visibility (`run/visibility.rs`), the snapshot filter and targeting do not change. No protocol change.
- **Not changed:** light colours, tint, the darkvision mask and greyscale, `SUB` (2 px per tile) for the light canvases.

## Design

### 1. The visibility polygon (`client/src/sim/vispoly.ts`, pure)
- `wallSegments(map, px, py, r)`: every edge between an opaque tile and an open tile within reach of (px, py) (a box of `r` px plus one tile). Runs along a row line or column line are merged into one segment while the opaque side stays on the same side. Units are world px.
- `visibilityPolygon(map, px, py, r, steps = 96)`: a flat `[x0, y0, x1, y1, ...]` list sorted by angle.
  - Ray angles: `steps` even angles (the circle), plus for every segment end within about `r`: its angle and that angle ± 1e-4 (rays that graze a corner and continue behind it).
  - Each ray stops at the nearest segment hit (`t > 0`, the segment parameter within [0, 1] with a small tolerance) or at `r`.
- "Opaque" is `TileMap.opaque`: walls, void, closed doors. Terrain is open. Off-map counts as void.
- The cost is small (around 100 segments × 300 rays near a hero), and it runs only when the viewer's position, the window or the map changes.

### 2. The vision mask (`client/src/game/visionmask.ts`)
- `VisionMask(scene, map)`: a `CanvasTexture` covering the camera window plus 2 tiles on each side, at **`RES` = 8 px per tile**, with LINEAR filtering. It's created on the first `update` and grown when the window gets bigger (a resize).
- Canvas content, white where the hero sees and black elsewhere:
  - the visibility polygon (canvas fill, antialiased);
  - **walls in sight** as whole tiles: every opaque tile in the tile FOV (`LightView.seen(x, y)`). The polygon stops at a wall's face, so without this the brick faces and rims would be cut off. Their edge follows the bricks, so it looks right.
- A Phaser `Shader` game object (`BaseShader` with `iChannel0` = the canvas) covers the same window at depth `DEPTH.fog + 0.5`. The fragment shader outputs black with alpha `1 - mask` (premultiplied). The canvas texture's y is flipped against the shader's `outTexCoord`, so the shader reads `vec2(u, 1 - v)`.
- `update(view, px, py, radiusPx, seen)`: positions the shader on the tile-aligned window origin. It redraws and uploads the canvas only when the window origin, the viewer's position (to 0.1 px) or the radius changed, or after `mapChanged()`.
- **Radius:** `(vision + 0.5) × TILE` px, so the circle covers the same tiles as the shadowcast (tile centres within `vision` tiles). A blind hero (vision 0) sees a circle of half a tile around itself (today: its own tile).
- **Depth:** above the darkness (`fog`) and below the drain beams (`beam`, fog + 1) and damage numbers. The darkvision greyscale is a camera post effect, so it still applies to the visible area; the mask's black is unaffected by it.

### 3. `LightView` changes
- A floor tile next to an FOV tile (8 neighbours, open tiles only) counts as visible for darkness, tint and darkvision. So the light continues under the mask's edge, and the old stair steps never show through the antialiased edge. Unlit tiles stay black as before (`blackenDarkTiles`), and walls outside the FOV stay black.
- `seen(x, y)`: the tile FOV, for the mask's walls.
- The FOV itself is unchanged (still from the viewer's tile, for the server's sake).

### 4. Wiring
- **`GameScene`:**
  - `VisionMask.update` runs right after `lightView.update`, with the same viewer (`camX`, `camY`: the own predicted position, or the spectated teammate) and the vision from the snapshot.
  - A `Tile` event calls `visionMask.mapChanged()` next to `lightView.mapChanged()`.
- **`?lights` (`LightsDemoScene`):**
  - keeps the two pillars and click-to-move for the viewer (`&at=x,y` in tiles);
  - **E** toggles old and new edges (`&edges=old`), for comparison and screenshots;
  - the caption lists the keys.
- **Removed from the spike:** the fade/blur, `&res`, the hidden-look modes (memory, fog), the explored map.

### 5. Accepted differences
- The drawn polygon is exact geometry, while the server's FOV is a tile shadowcast. They differ by up to a tile at the edges. A monster on a server-visible tile may stand partly in the drawn black, and a slanted look through a 1-tile gap shows a thin wedge where the server counts whole tiles. With the crisp edge the wedge stays visible (the blurred version swallowed it).
- The edge of a wall in sight is per tile.

## Testing
- **Unit tests (`sim/vispoly.test.ts`):**
  - an empty room: every point at distance `r` (a circle);
  - a pillar: points straight behind it are closer than `r`, and their angles span the pillar's shadow wedge;
  - a corridor: the view down it is bounded by its walls;
  - a closed door blocks, an open door does not;
  - `wallSegments` merges a straight wall into one segment.
- **Existing:** `npm test`, `npm run typecheck`, `npm run build`.
- **Look:**
  - `?lights` screenshots (`tools/e2e/lights-shot.mjs`): with the pillars, in the doorway, with darkvision 0 and 1, and E (old) for comparison;
  - the smoke test with two players (no browser errors), and a spectator check if practical.
- **Cost:** the frame time in a real dungeon, moving, compared with `main`. The polygon and the canvas upload must not add noticeable time.

## Docs
- **TECHNICAL:** §9 "Rendering (client)" (the mask, its depth, why a shader object and not a post effect), §7 (the drawn edge versus the server FOV), §13 known limitations (the differences above).
- **TODO:** remove "Vision edges" from priority 2 and the vision follow-ups. The pillars entry stays.
- **README:** the `?lights` keys (E, click).
- **HANDOFF:** the session notes.
