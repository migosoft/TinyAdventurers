// The light pass: darkness everywhere except tiles in the viewer's sight
// that a light reaches, plus a warm colour tint per tile from every light
// (static ones from LightField, moving ones from the snapshot). The light is
// worked out per tile on the CPU and handed to GpuLight (gpulight.ts), which
// smooths it up to 2 px per tile in a fragment shader (lightshader.ts, #293). Redrawn every frame
// inside the camera window (cheap: about 60 x 34 tiles), and only that window
// is uploaded (texupload.ts, #292). What the viewer sees
// is its View (sim/view.ts: the tiles the visibility polygon covers, the same
// rule as the server's); the vision mask (visionmask.ts) draws its straight edge.
import type Phaser from 'phaser';
import { LIGHT, LIGHT_KIND } from '../generated/defs';
import type { MovingLight } from '../generated/MovingLight';
import { View } from '../sim/view';
import { TILE, type Blocker, type TileMap } from '../sim/map';
import { cloudAt, lookFor, sunLook } from './sunmath';
import { DV_DARK, type LightField } from './light';
import { GpuLight } from './gpulight';

/** How strongly a light's hue tints what it lights (MULTIPLY blend): at most this far from white towards the hue. */
export const WARM = 0.45;
/** A lit tile is at least this bright (about the falloff's edge), so it is never fully black but its rim really fades. */
const MIN_LIT = 0.08;
/** Tiles drawn beyond the camera window: the upsampling (Catmull-Rom over four taps) reads two tiles around each one. */
const MARGIN = 3;

/** Darkness over one tile: 1 = black. `r, g, b`: its summed light colour. */
export function darknessAlpha(visible: boolean, lit: boolean, r: number, g: number, b: number): number {
  if (!visible || !lit) return 1;
  const bright = Math.min(1, Math.max(r, g, b) / 255);
  return 1 - Math.max(bright, MIN_LIT);
}

/**
 * The tint pixel (0..255 per channel) of a tile whose summed light colour is `r, g, b`, multiplied over the scene:
 * the light's hue with its brightest channel at 1, by up to WARM and by how bright the light is. Warms the colours
 * and never makes them paler. White (no change) where the tile is not seen and lit.
 */
export function warmTint(r: number, g: number, b: number, lit: boolean): [number, number, number] {
  if (!lit) return [255, 255, 255];
  const m = Math.max(r, g, b, 1);
  const s = WARM * Math.min(1, m / 255);
  return [255 * (1 - s * (1 - r / m)), 255 * (1 - s * (1 - g / m)), 255 * (1 - s * (1 - b / m))];
}

/** Darkness over a tile seen only by darkvision (defined in light.ts so the 3D view can use it without Phaser). */
export { DV_DARK };

/** Mirror of the server's dark_reach: is the tile at (dx, dy) tiles from the viewer within darkvision `range` (tiles)? */
export function darkReach(dx: number, dy: number, range: number): boolean {
  return range > 0 && dx * dx + dy * dy <= range * range;
}

/** Darkness over one tile with darkvision: a seen tile in reach is never darker than DV_DARK (a dim light rim
 *  included, so lights get no dark ring), else as `darknessAlpha`. */
export function tileDark(visible: boolean, lit: boolean, inReach: boolean, r: number, g: number, b: number): number {
  const a = darknessAlpha(visible, lit, r, g, b);
  return visible && inReach ? Math.min(a, DV_DARK) : a;
}

/** Greyscale strength (0..1) for a tile in darkvision reach whose light alone gives darkness `lightDark`:
 *  1 where only darkvision shows it, fading to 0 where the light is at least as bright as darkvision. */
export function dvMask(inReach: boolean, lightDark: number): number {
  return inReach ? Math.min(1, Math.max(0, 1 - (1 - lightDark) / (1 - DV_DARK))) : 0;
}

export { nextDarkvision } from './darkvisionSteps';

/** A light's brightness factor at time `t` (s): a slight, per-light wobble by its kind. */
export function flicker(kind: number, id: number, t: number): number {
  const f = LIGHT[kind].flicker;
  return 1 + f * (0.6 * Math.sin(t * 7.3 + id * 1.7) + 0.4 * Math.sin(t * 13.1 + id * 0.9));
}

/** Catmull-Rom weights of the taps at tiles i-1, i, i+1, i+2 for a point `t` (0..1) of the way from tile i to i+1. */
export function catmullRom(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
}

/**
 * Does the darkness treat a tile as seen? On a daylight map every tile does (#258): what lies beyond sight is
 * only dimmed, by the vision mask, never blacked out here. `seenLit` (critters, sunbeams) still follows the real sight.
 */
export function seenForDark(visible: boolean, daylight: boolean): boolean {
  return visible || daylight;
}

/**
 * A tile counts as seen for the light pass when it is in view, or is open
 * and next to an open tile in view (8 around). A tile the polygon only grazes
 * (no sample point inside) then stays lit, so the darkness does not fade the
 * lit tile next to it into tile-shaped notches along the mask's straight edge.
 * Those extra tiles lie under the mask apart from slivers under 2 px.
 */
export function seenForLight(inView: (x: number, y: number) => boolean, opaque: (x: number, y: number) => boolean, x: number, y: number): boolean {
  if (inView(x, y)) return true;
  if (opaque(x, y)) return false;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && inView(x + dx, y + dy) && !opaque(x + dx, y + dy)) return true;
  return false;
}

/**
 * A View computed on demand: `request` notes where the viewer stands (cheap), `get` computes it the first time
 * it is read for that request. Dungeon runs, which never read the full view, pay nothing for it.
 */
export class LazyView {
  readonly view: View;
  private pending?: [TileMap, number, number, number];
  constructor(w: number, h: number, private blocker: Blocker) {
    this.view = new View(w, h);
  }
  request(map: TileMap, vx: number, vy: number, vision: number): void {
    this.pending = [map, vx, vy, vision];
  }
  get(): View {
    if (this.pending) {
      const [map, vx, vy, vision] = this.pending;
      this.pending = undefined;
      this.view.compute(map, vx, vy, vision, this.blocker);
    }
    return this.view;
  }
}

export class LightView {
  /** What the viewer sees past walls only (trunks and thickets do not stop it): darkness, tint, `seenLit` and the vision mask. */
  readonly view: View;
  /** What the server lets the viewer see (trunks stop it too): the soft shadow is the ground between the two. */
  get sight(): View { return this.full.get(); }
  private full: LazyView;
  /** The viewer and vision the view was computed for; empty: recompute. */
  private viewKey = '';
  private out: GpuLight;
  /** What DarkvisionFX samples: the per-tile darkvision mask (2 px per tile, red = strength, LINEAR). */
  get mask(): Phaser.Textures.Texture { return this.out.mask; }
  private rgb: Float32Array;
  private movingLit: Uint8Array;
  /** Per tile: the summed light colour (r, g, b; 0..255 and over). */
  get light(): Float32Array { return this.rgb; }
  /** Per tile: 1 where it is seen and lit this frame. */
  readonly seenLit: Uint8Array;
  /** Map width in tiles (the row length of `seenLit` and `light`). */
  get w(): number { return this.map.w; }
  /** Light what the view covers (false: the tile FOV only, the old tile edges, ?lights E). */
  wide = true;
  private inView = (x: number, y: number) => this.view.isVisible(x, y);
  private opaque = (x: number, y: number) => this.map.hardOpaque(x, y);

  constructor(scene: Phaser.Scene, private map: TileMap, private field: LightField) {
    const { w, h } = map;
    this.view = new View(w, h);
    this.full = new LazyView(w, h, 'all');
    this.out = new GpuLight(scene, w, h);
    this.rgb = new Float32Array(w * h * 3);
    this.movingLit = new Uint8Array(w * h);
    this.seenLit = new Uint8Array(w * h);
  }

  /** A tile changed: the viewer's sight is recomputed on the next update. */
  mapChanged(): void {
    this.viewKey = '';
  }

  update(view: Phaser.Geom.Rectangle, vx: number, vy: number, moving: MovingLight[], t: number, darkvision: number, vision: number): void {
    const { w, h } = this.map;
    const tx = Math.floor(vx / TILE);
    const ty = Math.floor(vy / TILE);
    const sight = Math.round(vision);
    const key = `${vx.toFixed(1)},${vy.toFixed(1)},${sight}`;
    if (key !== this.viewKey) {
      this.viewKey = key;
      this.view.compute(this.map, vx, vy, sight, 'hard');
      this.full.request(this.map, vx, vy, sight);
    }
    const x0 = Math.max(0, Math.floor(view.x / TILE) - MARGIN);
    const y0 = Math.max(0, Math.floor(view.y / TILE) - MARGIN);
    const x1 = Math.min(w, Math.ceil(view.right / TILE) + MARGIN);
    const y1 = Math.min(h, Math.ceil(view.bottom / TILE) + MARGIN);
    for (let y = y0; y < y1; y++) {
      this.rgb.fill(0, (y * w + x0) * 3, (y * w + x1) * 3);
      this.movingLit.fill(0, y * w + x0, y * w + x1);
    }
    this.field.accumulate(this.rgb, x0, y0, x1, y1, (l) => flicker(l.kind, l.id, t), (l) => (l.kind === LIGHT_KIND.Daylight ? cloudAt(l.id, t, lookFor(l.id, sunLook)) : 1));
    moving.forEach(([mx, my, kind, colour], n) =>
      this.field.addMoving(this.rgb, this.movingLit, mx, my, kind, colour ?? LIGHT[kind].colour, flicker(kind, 1000 + n, t), TILE));
    const range = sight * darkvision;
    // The mask value is 0 while darkvision is off (syncDarkvisionFX removes its effect then).
    const dv = darkvision > 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const [r, g, b] = [this.rgb[i * 3], this.rgb[i * 3 + 1], this.rgb[i * 3 + 2]];
        const visible = this.wide ? seenForLight(this.inView, this.opaque, x, y) : this.view.fov.isVisible(x, y);
        const lit = this.field.isLit(x, y) || this.movingLit[i] === 1;
        const reach = visible && darkReach(x - tx, y - ty, range);
        const shown = seenForDark(visible, this.field.daylight);
        const sl = visible && lit;
        this.seenLit[i] = sl ? 1 : 0;
        const [tr, tg, tb] = warmTint(r, g, b, sl);
        this.out.put(i, tileDark(shown, lit, reach, r, g, b) * 255, tr, tg, tb, dv ? dvMask(reach, darknessAlpha(shown, lit, r, g, b)) * 255 : 0);
      }
    this.out.flush(x0, y0, x1, y1, dv);
  }
}
