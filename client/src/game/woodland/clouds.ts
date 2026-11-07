// Cloud shadows (#203): soft, darker patches drifting across the woodland. Cosmetic and client-only; every client starts
// at its own random spot, so players do not see the same clouds. The shadow is black with a per-pixel alpha in a canvas
// of a quarter of the screen's resolution, stretched over the camera window (LINEAR, so it stays soft).
import type Phaser from 'phaser';
import { DEPTH } from '../effects';

export interface CloudLook {
  /** Size of a cloud (px). */
  size: number;
  /** Drift speed (px/s). */
  speed: number;
  /** Alpha of the darkest part (0..1). */
  dark: number;
  /** Share of the map under cloud (0..1). */
  cover: number;
}
export const DEFAULT_CLOUDS: CloudLook = { size: 360, speed: 14, dark: 0.22, cover: 0.35 };
/** The canvas pixel is this many screen pixels. */
export const CLOUD_SCALE = 4;
/** Phaser's `FilterMode.LINEAR` (a runtime import of Phaser would not load in unit tests). */
const LINEAR = 0;
const TEX = 'woodland-clouds';
/** The drift's slight +y, as a share of the speed. */
const DRIFT_Y = 0.2;

function hash(ix: number, iy: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1, one lattice cell per unit. */
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let u = x - ix, v = y - iy;
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  const top = a + (b - a) * u, bot = c + (d - c) * u;
  return top + (bot - top) * v;
}

/** The shadow's alpha (0..look.dark) at world point (x, y) and time t (s): noise drifting along +x with a slight +y. */
export function cloudAlpha(x: number, y: number, t: number, look: CloudLook): number {
  const px = (x - look.speed * t) / look.size, py = (y - look.speed * DRIFT_Y * t) / look.size;
  const n = 0.7 * vnoise(px, py) + 0.3 * vnoise(px * 2.3 + 17.1, py * 2.3 + 5.7);
  const thr = 0.75 - 0.5 * look.cover;
  let k = (n - thr) / 0.2;
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  return look.dark * k * k * (3 - 2 * k);
}

/** Fills `buf` (w×h pixels, black with alpha) with the shadow over the world window whose top-left is (x0, y0). */
export function fillCloud(buf: Uint32Array, w: number, h: number, x0: number, y0: number, t: number, look: CloudLook): void {
  let i = 0;
  for (let j = 0; j < h; j++) {
    const y = y0 + (j + 0.5) * CLOUD_SCALE;
    for (let k = 0; k < w; k++) buf[i++] = (Math.round(cloudAlpha(x0 + (k + 0.5) * CLOUD_SCALE, y, t, look) * 255) << 24) >>> 0;
  }
}

export class Clouds {
  /** Tuned live (the demo's buttons change these). */
  look: CloudLook = { ...DEFAULT_CLOUDS };
  private img: Phaser.GameObjects.Image;
  private tex: Phaser.Textures.CanvasTexture | null = null;
  private data: ImageData | null = null;
  private buf: Uint32Array | null = null;
  private w = 0;
  private h = 0;
  /** This client's own start in the drift (s), so players do not see the same clouds. */
  private offset = Math.random() * 100000;

  constructor(private scene: Phaser.Scene) {
    this.img = scene.add.image(0, 0, '__DEFAULT').setOrigin(0).setDepth(DEPTH.cloud).setVisible(false);
  }

  /** Redraws the shadow over the camera window `cam` at time `t` (s). */
  update(t: number, cam: Phaser.Geom.Rectangle): void {
    const w = Math.ceil(cam.width / CLOUD_SCALE) + 3, h = Math.ceil(cam.height / CLOUD_SCALE) + 3;
    if (!this.tex || w !== this.w || h !== this.h) this.resize(w, h);
    // snapped to the canvas grid, so the shadow does not swim against the ground when the camera moves
    const x0 = Math.floor(cam.x / CLOUD_SCALE) * CLOUD_SCALE - CLOUD_SCALE, y0 = Math.floor(cam.y / CLOUD_SCALE) * CLOUD_SCALE - CLOUD_SCALE;
    fillCloud(this.buf!, w, h, x0, y0, t + this.offset, this.look);
    this.tex!.getContext().putImageData(this.data!, 0, 0);
    this.tex!.refresh();
    this.tex!.setFilter(LINEAR); // refresh() resets it to NEAREST under pixelArt
    this.img.setPosition(x0, y0).setScale(CLOUD_SCALE).setVisible(true);
  }

  private resize(w: number, h: number): void {
    if (this.scene.textures.exists(TEX)) this.scene.textures.remove(TEX);
    this.tex = this.scene.textures.createCanvas(TEX, w, h)!;
    this.data = new ImageData(w, h);
    this.buf = new Uint32Array(this.data.data.buffer);
    this.w = w;
    this.h = h;
    this.img.setTexture(TEX);
  }

  destroy(): void {
    this.img.destroy();
    if (this.scene.textures.exists(TEX)) this.scene.textures.remove(TEX);
  }
}
