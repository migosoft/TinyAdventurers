// The light canvas: darkness everywhere except tiles in the viewer's sight
// that a light reaches, plus an additive colour tint per tile from every light
// (static ones from LightField, moving ones from the snapshot). Both canvases
// have one pixel per tile with LINEAR filtering, scaled up by TILE. Redrawn
// every frame inside the camera window (cheap: about 60 x 34 tiles).
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
/** A lit tile is at least this bright, so it is never drawn dark. */
const MIN_LIT = 0.35;

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

export class LightView {
  private fov: Fov;
  private origin = [-1, -1];
  private dark: Phaser.Textures.CanvasTexture;
  private tint: Phaser.Textures.CanvasTexture;
  private darkImg: ImageData;
  private tintImg: ImageData;
  private rgb: Float32Array;
  private movingLit: Uint8Array;

  constructor(scene: Phaser.Scene, private map: TileMap, private field: LightField) {
    this.fov = new Fov(map.w, map.h);
    for (const k of ['dark', 'tint']) if (scene.textures.exists(k)) scene.textures.remove(k);
    this.dark = scene.textures.createCanvas('dark', map.w, map.h)!;
    this.tint = scene.textures.createCanvas('tint', map.w, map.h)!;
    this.dark.setFilter(LINEAR);
    this.tint.setFilter(LINEAR);
    this.darkImg = this.dark.getContext().createImageData(map.w, map.h);
    this.tintImg = this.tint.getContext().createImageData(map.w, map.h);
    // Black, fully opaque until drawn.
    for (let i = 0; i < map.w * map.h; i++) this.darkImg.data.set([0, 0, 0, 255], i * 4);
    this.dark.getContext().putImageData(this.darkImg, 0, 0);
    this.dark.refresh();
    this.rgb = new Float32Array(map.w * map.h * 3);
    this.movingLit = new Uint8Array(map.w * map.h);
    scene.add.image(0, 0, 'tint').setOrigin(0, 0).setScale(TILE).setDepth(DEPTH.tint).setBlendMode(ADD);
    scene.add.image(0, 0, 'dark').setOrigin(0, 0).setScale(TILE).setDepth(DEPTH.fog);
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
    const x0 = Math.max(0, Math.floor(view.x / TILE) - 1);
    const y0 = Math.max(0, Math.floor(view.y / TILE) - 1);
    const x1 = Math.min(w, Math.ceil(view.right / TILE) + 1);
    const y1 = Math.min(h, Math.ceil(view.bottom / TILE) + 1);
    for (let y = y0; y < y1; y++) {
      this.rgb.fill(0, (y * w + x0) * 3, (y * w + x1) * 3);
      this.movingLit.fill(0, y * w + x0, y * w + x1);
    }
    this.field.accumulate(this.rgb, x0, y0, x1, y1, (l) => flicker(l.kind, l.id, t));
    moving.forEach(([mx, my, kind, colour], n) =>
      this.field.addMoving(this.rgb, this.movingLit, mx, my, kind, colour ?? LIGHT[kind].colour, flicker(kind, 1000 + n, t), TILE));
    const dd = this.darkImg.data;
    const td = this.tintImg.data;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        const [r, g, b] = [this.rgb[i * 3], this.rgb[i * 3 + 1], this.rgb[i * 3 + 2]];
        const visible = this.fov.isVisible(x, y);
        const lit = this.field.isLit(x, y) || this.movingLit[i] === 1;
        dd[i * 4 + 3] = Math.round(darknessAlpha(visible, lit, r, g, b) * 255);
        td[i * 4] = Math.min(255, r);
        td[i * 4 + 1] = Math.min(255, g);
        td[i * 4 + 2] = Math.min(255, b);
        td[i * 4 + 3] = visible && lit ? Math.round(TINT_ALPHA * 255) : 0;
      }
    this.dark.getContext().putImageData(this.darkImg, 0, 0, x0, y0, x1 - x0, y1 - y0);
    this.tint.getContext().putImageData(this.tintImg, 0, 0, x0, y0, x1 - x0, y1 - y0);
    this.dark.refresh();
    this.tint.refresh();
  }
}
