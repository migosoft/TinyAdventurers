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
export const DEFAULT_CLOUDS: CloudLook = { size: 360, speed: 38, dark: 0.46, cover: 0.35 };
/** The canvas pixel is this many screen pixels. */
export const CLOUD_SCALE = 4;
/** Phaser's `FilterMode.LINEAR` (a runtime import of Phaser would not load in unit tests). */
const LINEAR = 0;
const TEX = 'woodland-clouds';
/** The drift's slight +y, as a share of the speed. */
const DRIFT_Y = 0.2;

/** The baked texture's side in px (quarter resolution) and the world distance after which the pattern repeats. */
export const BAKE = 512;
export const PERIOD = BAKE * CLOUD_SCALE;

function hash(ix: number, iy: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Smooth value noise in 0..1, one lattice cell per unit, repeating every `p` cells. */
function vnoise(x: number, y: number, p: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let u = x - ix, v = y - iy;
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);
  const x0 = mod(ix, p), x1 = mod(ix + 1, p), y0 = mod(iy, p), y1 = mod(iy + 1, p);
  const a = hash(x0, y0), b = hash(x1, y0), c = hash(x0, y1), d = hash(x1, y1);
  const top = a + (b - a) * u, bot = c + (d - c) * u;
  return top + (bot - top) * v;
}

/** The cloud pattern's strength (0..1) at world point (x, y): periodic, repeating every PERIOD px, cells about `look.size` wide. */
export function cloudField(x: number, y: number, look: CloudLook): number {
  const p = Math.max(1, Math.round(PERIOD / look.size));
  const px = (x / PERIOD) * p, py = (y / PERIOD) * p;
  const n = 0.7 * vnoise(px, py, p) + 0.3 * vnoise(px * 3 + 17, py * 3 + 5, p * 3);
  const thr = 0.75 - 0.5 * look.cover;
  let k = (n - thr) / 0.2;
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  return k * k * (3 - 2 * k);
}

/** The shadow's alpha (0..look.dark) at world point (x, y) and time t (s): the periodic pattern drifting along +x with a slight +y. */
export function cloudAlpha(x: number, y: number, t: number, look: CloudLook): number {
  return look.dark * cloudField(x - look.speed * t, y - look.speed * DRIFT_Y * t, look);
}

/** Bakes the pattern at full strength (black, alpha 0..255) into `buf` (BAKE x BAKE pixels, one per CLOUD_SCALE px). */
export function bakeCloud(buf: Uint32Array, look: CloudLook): void {
  let i = 0;
  for (let j = 0; j < BAKE; j++) {
    const y = (j + 0.5) * CLOUD_SCALE;
    for (let k = 0; k < BAKE; k++) buf[i++] = (Math.round(cloudField((k + 0.5) * CLOUD_SCALE, y, look) * 255) << 24) >>> 0;
  }
}

export class Clouds {
  /** Tuned live (the demo's buttons change these): size and cover rebake the texture, speed and dark do not. */
  look: CloudLook = { ...DEFAULT_CLOUDS };
  private sprite: Phaser.GameObjects.TileSprite;
  private baked: { size: number; cover: number } | null = null;
  /** This client's own start in the drift (s), so players do not see the same clouds. */
  private offset = Math.random() * 100000;

  constructor(private scene: Phaser.Scene) {
    this.bake();
    this.sprite = scene.add.tileSprite(0, 0, 16, 16, TEX).setOrigin(0).setScale(CLOUD_SCALE).setDepth(DEPTH.cloud);
    this.smooth();
  }

  /**
   * A TileSprite does not sample the canvas texture: it copies the frame into its own pattern texture (`fillPattern`,
   * rebuilt by `setFrame`), which Phaser uploads as NEAREST under pixelArt. Make that one LINEAR, after every rebuild.
   */
  private smooth(): void {
    const r = this.scene.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const pattern = this.sprite.fillPattern as unknown;
    if (r.gl && pattern) r.setTextureFilter(pattern as Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper, LINEAR);
  }

  private bake(): void {
    const { size, cover } = this.look;
    if (this.baked && this.baked.size === size && this.baked.cover === cover) return;
    let tex = this.scene.textures.exists(TEX) ? (this.scene.textures.get(TEX) as Phaser.Textures.CanvasTexture) : null;
    if (!tex) tex = this.scene.textures.createCanvas(TEX, BAKE, BAKE)!;
    const data = new ImageData(BAKE, BAKE);
    bakeCloud(new Uint32Array(data.data.buffer), this.look);
    tex.getContext().putImageData(data, 0, 0);
    tex.refresh();
    tex.setFilter(LINEAR); // for canvas rendering; under WebGL the sprite's own pattern matters (smooth)
    this.baked = { size, cover };
    if (this.sprite) { this.sprite.setTexture(TEX); this.smooth(); } // the sprite rebuilds its pattern only from setFrame
  }

  /** Scrolls the shadow over the camera window `cam` at time `t` (s). */
  update(t: number, cam: Phaser.Geom.Rectangle): void {
    this.bake();
    const w = Math.ceil(cam.width / CLOUD_SCALE) + 3, h = Math.ceil(cam.height / CLOUD_SCALE) + 3;
    // snapped to the texel grid, so the shadow does not swim against the ground when the camera moves
    const x0 = Math.floor(cam.x / CLOUD_SCALE) * CLOUD_SCALE - CLOUD_SCALE, y0 = Math.floor(cam.y / CLOUD_SCALE) * CLOUD_SCALE - CLOUD_SCALE;
    const tt = t + this.offset, v = this.look.speed / CLOUD_SCALE;
    if (this.sprite.width !== w || this.sprite.height !== h) this.sprite.setSize(w, h);
    this.sprite.setPosition(x0, y0).setAlpha(this.look.dark);
    this.sprite.tilePositionX = mod(x0 / CLOUD_SCALE - v * tt, BAKE);
    this.sprite.tilePositionY = mod(y0 / CLOUD_SCALE - v * DRIFT_Y * tt, BAKE);
  }

  destroy(): void {
    this.sprite.destroy();
    if (this.scene.textures.exists(TEX)) this.scene.textures.remove(TEX);
  }
}
