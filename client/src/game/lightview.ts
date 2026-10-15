// The light canvas: darkness everywhere except tiles in the viewer's sight
// that a light reaches, plus an additive colour tint per tile from every light
// (static ones from LightField, moving ones from the snapshot). The light is
// worked out per tile, then upsampled to SUB pixels per tile (`upsample`) and
// drawn with LINEAR filtering, scaled up by TILE / SUB. Redrawn every frame
// inside the camera window (cheap: about 60 x 34 tiles).
import type Phaser from 'phaser';
import { CONST, LIGHT } from '../generated/defs';
import type { MovingLight } from '../generated/MovingLight';
import { Fov } from '../sim/fov';
import { TILE, type TileMap } from '../sim/map';
import { DEPTH } from './effects';
import type { LightField } from './light';

// Phaser's FilterMode.LINEAR and BlendModes.ADD as numbers: a value import of
// Phaser needs a browser, and the pure functions below are unit-tested.
const LINEAR = 0;
const ADD = 1;

/** How strongly the light colour tints what it lights (ADD blend). */
const TINT_ALPHA = 0.35;
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
  const cx = (x: number) => (x < 0 ? 0 : x >= w ? w - 1 : x);
  const cy = (y: number) => (y < 0 ? 0 : y >= h ? h - 1 : y);
  // Across: every row the second pass reads.
  for (let y = Math.max(0, y0 - 2); y <= Math.min(h - 1, y1 + 1); y++)
    for (let x = x0; x < x1; x++)
      for (let k = 0; k < SUB; k++) {
        const { first, w: wt } = TAPS[k];
        const o = (y * pw + x * SUB + k) * ch;
        for (let c = 0; c < ch; c++) {
          let v = 0;
          for (let j = 0; j < 4; j++) v += wt[j] * src[(y * w + cx(x + first + j)) * ch + c];
          tmp[o + c] = v;
        }
      }
  // Down.
  for (let y = y0; y < y1; y++)
    for (let k = 0; k < SUB; k++) {
      const { first, w: wt } = TAPS[k];
      const rows = [0, 1, 2, 3].map((j) => cy(y + first + j) * pw);
      const py = y * SUB + k;
      for (let px = x0 * SUB; px < x1 * SUB; px++)
        for (let c = 0; c < ch; c++) {
          let v = 0;
          for (let j = 0; j < 4; j++) v += wt[j] * tmp[(rows[j] + px) * ch + c];
          dst[(py * pw + px) * 4 + at + c] = v;
        }
    }
}

export class LightView {
  private fov: Fov;
  private origin = [-1, -1];
  private dark: Phaser.Textures.CanvasTexture;
  private tint: Phaser.Textures.CanvasTexture;
  private darkImg: ImageData;
  private tintImg: ImageData;
  private rgb: Float32Array;
  private movingLit: Uint8Array;
  /** Per tile: darkness alpha (0..255), and the tint as r, g, b, a (0..255). */
  private darkTile: Float32Array;
  private tintTile: Float32Array;
  private tmp: Float32Array;

  constructor(scene: Phaser.Scene, private map: TileMap, private field: LightField) {
    const { w, h } = map;
    this.fov = new Fov(w, h);
    for (const k of ['dark', 'tint']) if (scene.textures.exists(k)) scene.textures.remove(k);
    this.dark = scene.textures.createCanvas('dark', w * SUB, h * SUB)!;
    this.tint = scene.textures.createCanvas('tint', w * SUB, h * SUB)!;
    this.darkImg = this.dark.getContext().createImageData(w * SUB, h * SUB);
    this.tintImg = this.tint.getContext().createImageData(w * SUB, h * SUB);
    // Black, fully opaque until drawn.
    for (let i = 0; i < w * SUB * h * SUB; i++) this.darkImg.data.set([0, 0, 0, 255], i * 4);
    this.dark.getContext().putImageData(this.darkImg, 0, 0);
    this.upload();
    this.rgb = new Float32Array(w * h * 3);
    this.movingLit = new Uint8Array(w * h);
    this.darkTile = new Float32Array(w * h).fill(255);
    this.tintTile = new Float32Array(w * h * 4);
    this.tmp = new Float32Array(w * SUB * h * 4);
    scene.add.image(0, 0, 'tint').setOrigin(0, 0).setScale(TILE / SUB).setDepth(DEPTH.tint).setBlendMode(ADD);
    scene.add.image(0, 0, 'dark').setOrigin(0, 0).setScale(TILE / SUB).setDepth(DEPTH.fog);
  }

  /** Uploads both canvases. refresh() resets the filter to NEAREST (pixelArt), so LINEAR is set again after it. */
  private upload(): void {
    for (const tex of [this.dark, this.tint]) {
      tex.refresh();
      tex.setFilter(LINEAR);
    }
  }

  /** A tile changed: the viewer's sight is recomputed on the next update. */
  mapChanged(): void {
    this.origin = [-1, -1];
  }

  update(view: Phaser.Geom.Rectangle, vx: number, vy: number, moving: MovingLight[], t: number): void {
    const { w, h } = this.map;
    const tx = Math.floor(vx / TILE);
    const ty = Math.floor(vy / TILE);
    if (tx !== this.origin[0] || ty !== this.origin[1]) {
      this.origin = [tx, ty];
      this.fov.compute(this.map, tx, ty, CONST.FOV_RADIUS);
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
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const [r, g, b] = [this.rgb[i * 3], this.rgb[i * 3 + 1], this.rgb[i * 3 + 2]];
        const visible = this.fov.isVisible(x, y);
        const lit = this.field.isLit(x, y) || this.movingLit[i] === 1;
        dt[i] = darknessAlpha(visible, lit, r, g, b) * 255;
        tt[i * 4] = Math.min(255, r);
        tt[i * 4 + 1] = Math.min(255, g);
        tt[i * 4 + 2] = Math.min(255, b);
        tt[i * 4 + 3] = visible && lit ? TINT_ALPHA * 255 : 0;
      }
    upsample(dt, 1, w, h, x0, y0, x1, y1, this.tmp, this.darkImg.data, 3);
    upsample(tt, 4, w, h, x0, y0, x1, y1, this.tmp, this.tintImg.data, 0);
    const [px, py, pw, ph] = [x0 * SUB, y0 * SUB, (x1 - x0) * SUB, (y1 - y0) * SUB];
    this.dark.getContext().putImageData(this.darkImg, 0, 0, px, py, pw, ph);
    this.tint.getContext().putImageData(this.tintImg, 0, 0, px, py, pw, ph);
    this.upload();
  }
}
