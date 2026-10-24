// The light canvas: darkness everywhere except tiles in the viewer's sight
// that a light reaches, plus a warm colour tint per tile from every light
// (static ones from LightField, moving ones from the snapshot). The light is
// worked out per tile, then upsampled to SUB pixels per tile (`upsample`; dark
// tiles are set back to black, `blackenDarkTiles`) and drawn with LINEAR filtering, scaled up by TILE / SUB. Redrawn every frame
// inside the camera window (cheap: about 60 x 34 tiles). What the viewer sees
// is its View (sim/view.ts: the tiles the visibility polygon covers, the same
// rule as the server's); the vision mask (visionmask.ts) draws its straight edge.
import type Phaser from 'phaser';
import { LIGHT } from '../generated/defs';
import type { MovingLight } from '../generated/MovingLight';
import { View } from '../sim/view';
import { TILE, type TileMap } from '../sim/map';
import { DEPTH } from './effects';
import type { LightField } from './light';

// Phaser's FilterMode.LINEAR and BlendModes.MULTIPLY as numbers: a value import of
// Phaser needs a browser, and the pure functions below are unit-tested.
const LINEAR = 0;
const MULTIPLY = 2;

/** How strongly a light's hue tints what it lights (MULTIPLY blend): at most this far from white towards the hue. */
export const WARM = 0.45;
/** A lit tile is at least this bright (about the falloff's edge), so it is never fully black but its rim really fades. */
const MIN_LIT = 0.08;
/** Canvas pixels per tile. One pixel per tile with LINEAR filtering is plain bilinear, which shows creases along the tile grid in a long fade. */
export const SUB = 2;
/** Tiles drawn beyond the camera window: the upsampling reads two tiles around each one. */
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

/** Darkness over a tile seen only by darkvision: dim, not black. */
export const DV_DARK = 0.45;

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

/** The debug darkvision steps (F4, and V in ?lights): the next one above `current`, after 1 back to 0. */
export function nextDarkvision(current: number): number {
  return current < 0.5 - 1e-6 ? 0.5 : current < 1 - 1e-6 ? 1 : 0;
}

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

/** Per sub-pixel k of a tile: the first of its four taps (relative to the tile) and their weights. */
const TAPS = Array.from({ length: SUB }, (_, k) => {
  const u = (k + 0.5) / SUB - 0.5;
  const base = Math.floor(u);
  return { first: base - 1, w: catmullRom(u - base) };
});

/**
 * Upsamples per-tile values (`ch` channels, w*h*ch) in the tile window
 * [x0,x1)×[y0,y1) to SUB pixels per tile, into RGBA image data w*SUB wide
 * from channel `at` on. Catmull-Rom: smooth, exact on straight ramps, and
 * the image data clamps its overshoot at hard edges. `tmp`: w*SUB*h*ch.
 */
export function upsample(src: Float32Array, ch: number, w: number, h: number, x0: number, y0: number, x1: number, y1: number, tmp: Float32Array, dst: Uint8ClampedArray, at: number): void {
  const pw = w * SUB;
  // Across: every row the second pass reads.
  for (let y = Math.max(0, y0 - 2); y <= Math.min(h - 1, y1 + 1); y++)
    for (let x = x0; x < x1; x++)
      for (let k = 0; k < SUB; k++) {
        const { first, w: wt } = TAPS[k];
        const o = (y * pw + x * SUB + k) * ch;
        // The four tap tiles, clamped to the map.
        const t0 = (y * w + Math.min(w - 1, Math.max(0, x + first))) * ch;
        const t1 = (y * w + Math.min(w - 1, Math.max(0, x + first + 1))) * ch;
        const t2 = (y * w + Math.min(w - 1, Math.max(0, x + first + 2))) * ch;
        const t3 = (y * w + Math.min(w - 1, Math.max(0, x + first + 3))) * ch;
        for (let c = 0; c < ch; c++) tmp[o + c] = wt[0] * src[t0 + c] + wt[1] * src[t1 + c] + wt[2] * src[t2 + c] + wt[3] * src[t3 + c];
      }
  // Down.
  for (let y = y0; y < y1; y++)
    for (let k = 0; k < SUB; k++) {
      const { first, w: wt } = TAPS[k];
      const r0 = Math.min(h - 1, Math.max(0, y + first)) * pw;
      const r1 = Math.min(h - 1, Math.max(0, y + first + 1)) * pw;
      const r2 = Math.min(h - 1, Math.max(0, y + first + 2)) * pw;
      const r3 = Math.min(h - 1, Math.max(0, y + first + 3)) * pw;
      const py = y * SUB + k;
      for (let px = x0 * SUB; px < x1 * SUB; px++)
        for (let c = 0; c < ch; c++)
          dst[(py * pw + px) * 4 + at + c] = wt[0] * tmp[(r0 + px) * ch + c] + wt[1] * tmp[(r1 + px) * ch + c] + wt[2] * tmp[(r2 + px) * ch + c] + wt[3] * tmp[(r3 + px) * ch + c];
    }
}

/**
 * Keeps every dark tile (darkness 255: out of sight or unlit) black inside:
 * its SUB×SUB darkness pixels back to 255 and its tint pixels to 0, so the
 * upsampled fade stays on the lit side of the boundary and a dark tile never
 * looks lit (no monster is sent there).
 */
export function blackenDarkTiles(darkTile: Float32Array, w: number, x0: number, y0: number, x1: number, y1: number, dark: Uint8ClampedArray, tint: Uint8ClampedArray): void {
  const pw = w * SUB;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (darkTile[y * w + x] < 255) continue;
      for (let ky = 0; ky < SUB; ky++)
        for (let kx = 0; kx < SUB; kx++) {
          const p = ((y * SUB + ky) * pw + x * SUB + kx) * 4;
          dark[p + 3] = 255;
          tint[p] = tint[p + 1] = tint[p + 2] = tint[p + 3] = 0;
        }
    }
}

/**
 * A tile counts as seen for the light canvases when it is in view, or is open
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

export class LightView {
  /** What the viewer sees (polygon coverage, walls by FOV). */
  readonly view: View;
  /** The viewer and vision the view was computed for; empty: recompute. */
  private viewKey = '';
  private dark: Phaser.Textures.CanvasTexture;
  private tint: Phaser.Textures.CanvasTexture;
  /** Per-tile darkvision mask (R = 255 where darkvision shows the tile, A = 255), for the greyscale shader. Not added to the scene. */
  readonly mask: Phaser.Textures.CanvasTexture;
  private darkImg: ImageData;
  private tintImg: ImageData;
  private maskImg: ImageData;
  private rgb: Float32Array;
  private movingLit: Uint8Array;
  /** Per tile: darkness alpha (0..255), and the tint as r, g, b, a (0..255). */
  private darkTile: Float32Array;
  private tintTile: Float32Array;
  private maskTile: Float32Array;
  private tmp: Float32Array;
  /** Per tile: the summed light colour (r, g, b; 0..255 and over). */
  get light(): Float32Array { return this.rgb; }
  /** Per tile: 1 where it is seen and lit this frame. */
  readonly seenLit: Uint8Array;
  /** Light what the view covers (false: the tile FOV only, the old tile edges, ?lights E). */
  wide = true;
  private inView = (x: number, y: number) => this.view.isVisible(x, y);
  private opaque = (x: number, y: number) => this.map.opaque(x, y);

  constructor(scene: Phaser.Scene, private map: TileMap, private field: LightField) {
    const { w, h } = map;
    this.view = new View(w, h);
    for (const k of ['dark', 'tint', 'dvmask']) if (scene.textures.exists(k)) scene.textures.remove(k);
    this.dark = scene.textures.createCanvas('dark', w * SUB, h * SUB)!;
    this.tint = scene.textures.createCanvas('tint', w * SUB, h * SUB)!;
    this.mask = scene.textures.createCanvas('dvmask', w * SUB, h * SUB)!;
    this.darkImg = this.dark.getContext().createImageData(w * SUB, h * SUB);
    this.tintImg = this.tint.getContext().createImageData(w * SUB, h * SUB);
    this.maskImg = this.mask.getContext().createImageData(w * SUB, h * SUB);
    for (let i = 0; i < w * SUB * h * SUB; i++) this.maskImg.data[i * 4 + 3] = 255;
    // Black, fully opaque until drawn.
    for (let i = 0; i < w * SUB * h * SUB; i++) this.darkImg.data.set([0, 0, 0, 255], i * 4);
    this.dark.getContext().putImageData(this.darkImg, 0, 0);
    this.upload();
    this.rgb = new Float32Array(w * h * 3);
    this.movingLit = new Uint8Array(w * h);
    this.darkTile = new Float32Array(w * h).fill(255);
    this.tintTile = new Float32Array(w * h * 4);
    this.maskTile = new Float32Array(w * h);
    this.seenLit = new Uint8Array(w * h);
    this.tmp = new Float32Array(w * SUB * h * 4);
    scene.add.image(0, 0, 'tint').setOrigin(0, 0).setScale(TILE / SUB).setDepth(DEPTH.tint).setBlendMode(MULTIPLY);
    scene.add.image(0, 0, 'dark').setOrigin(0, 0).setScale(TILE / SUB).setDepth(DEPTH.fog);
  }

  /** Uploads the canvases. refresh() resets the filter to NEAREST (pixelArt), so LINEAR is set again after it. */
  private upload(): void {
    for (const tex of [this.dark, this.tint, this.mask]) {
      tex.refresh();
      tex.setFilter(LINEAR);
    }
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
      this.view.compute(this.map, vx, vy, sight);
    }
    const x0 = Math.max(0, Math.floor(view.x / TILE) - MARGIN);
    const y0 = Math.max(0, Math.floor(view.y / TILE) - MARGIN);
    const x1 = Math.min(w, Math.ceil(view.right / TILE) + MARGIN);
    const y1 = Math.min(h, Math.ceil(view.bottom / TILE) + MARGIN);
    for (let y = y0; y < y1; y++) {
      this.rgb.fill(0, (y * w + x0) * 3, (y * w + x1) * 3);
      this.movingLit.fill(0, y * w + x0, y * w + x1);
    }
    this.field.accumulate(this.rgb, x0, y0, x1, y1, (l) => flicker(l.kind, l.id, t));
    moving.forEach(([mx, my, kind, colour], n) =>
      this.field.addMoving(this.rgb, this.movingLit, mx, my, kind, colour ?? LIGHT[kind].colour, flicker(kind, 1000 + n, t), TILE));
    const dt = this.darkTile;
    const tt = this.tintTile;
    const mt = this.maskTile;
    const range = sight * darkvision;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const [r, g, b] = [this.rgb[i * 3], this.rgb[i * 3 + 1], this.rgb[i * 3 + 2]];
        const visible = this.wide ? seenForLight(this.inView, this.opaque, x, y) : this.view.fov.isVisible(x, y);
        const lit = this.field.isLit(x, y) || this.movingLit[i] === 1;
        const reach = visible && darkReach(x - tx, y - ty, range);
        dt[i] = tileDark(visible, lit, reach, r, g, b) * 255;
        mt[i] = dvMask(reach, darknessAlpha(visible, lit, r, g, b)) * 255;
        const sl = visible && lit;
        this.seenLit[i] = sl ? 1 : 0;
        [tt[i * 4], tt[i * 4 + 1], tt[i * 4 + 2]] = warmTint(r, g, b, sl);
        tt[i * 4 + 3] = 255;
      }
    upsample(dt, 1, w, h, x0, y0, x1, y1, this.tmp, this.darkImg.data, 3);
    upsample(tt, 4, w, h, x0, y0, x1, y1, this.tmp, this.tintImg.data, 0);
    upsample(mt, 1, w, h, x0, y0, x1, y1, this.tmp, this.maskImg.data, 0);
    blackenDarkTiles(dt, w, x0, y0, x1, y1, this.darkImg.data, this.tintImg.data);
    const [px, py, pw, ph] = [x0 * SUB, y0 * SUB, (x1 - x0) * SUB, (y1 - y0) * SUB];
    this.dark.getContext().putImageData(this.darkImg, 0, 0, px, py, pw, ph);
    this.tint.getContext().putImageData(this.tintImg, 0, 0, px, py, pw, ph);
    this.mask.getContext().putImageData(this.maskImg, 0, 0, px, py, pw, ph);
    this.upload();
  }
}
