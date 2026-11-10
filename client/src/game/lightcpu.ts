// The CPU light path: per-tile values collected into Float32 arrays, upsampled
// to SUB pixels per tile (`upsample`; dark tiles set back to black,
// `blackenDarkTiles`) into ImageData and drawn as two canvas textures with
// LINEAR filtering, scaled up by TILE / SUB: darkness at DEPTH.fog, the tint
// (MULTIPLY) at DEPTH.tint. Only the camera window is uploaded (texupload.ts, #292).
import type Phaser from 'phaser';
import { TILE } from '../sim/map';
import { DEPTH } from './effects';
import { blackenDarkTiles, SUB, upsample } from './lightview';
import type { LightOutput } from './lightshader';
import { WindowUpload } from './texupload';

// Phaser's FilterMode.LINEAR and BlendModes.MULTIPLY as numbers: a value import of
// Phaser needs a browser, and the unit tests run without one.
const LINEAR = 0;
const MULTIPLY = 2;

export class CpuLight implements LightOutput {
  private dark: Phaser.Textures.CanvasTexture;
  private tint: Phaser.Textures.CanvasTexture;
  /** Per-tile darkvision mask (R = 255 where darkvision shows the tile, A = 255), for the greyscale shader. Not added to the scene. */
  readonly mask: Phaser.Textures.CanvasTexture;
  private darkImg: ImageData;
  private tintImg: ImageData;
  private maskImg: ImageData;
  private darkUp: WindowUpload;
  private tintUp: WindowUpload;
  private maskUp: WindowUpload;
  /** Per tile: darkness alpha (0..255), and the tint as r, g, b, a (0..255). */
  private darkTile: Float32Array;
  private tintTile: Float32Array;
  private maskTile: Float32Array;
  private tmp: Float32Array;

  constructor(scene: Phaser.Scene, private w: number, private h: number) {
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
    // The one whole upload; afterwards only the window is uploaded. refresh() resets the filter to NEAREST
    // (pixelArt), so LINEAR is set after it (Phaser keeps it on the texture, a lost context restores it too).
    for (const tex of [this.dark, this.tint, this.mask]) {
      tex.refresh();
      tex.setFilter(LINEAR);
    }
    const gl = 'gl' in scene.renderer ? scene.renderer.gl : undefined;
    this.darkUp = new WindowUpload(gl, this.dark);
    this.tintUp = new WindowUpload(gl, this.tint);
    this.maskUp = new WindowUpload(gl, this.mask);
    this.darkTile = new Float32Array(w * h).fill(255);
    this.tintTile = new Float32Array(w * h * 4);
    this.maskTile = new Float32Array(w * h);
    this.tmp = new Float32Array(w * SUB * h * 4);
    scene.add.image(0, 0, 'tint').setOrigin(0, 0).setScale(TILE / SUB).setDepth(DEPTH.tint).setBlendMode(MULTIPLY);
    scene.add.image(0, 0, 'dark').setOrigin(0, 0).setScale(TILE / SUB).setDepth(DEPTH.fog);
  }

  put(i: number, dark: number, r: number, g: number, b: number, dv: number): void {
    this.darkTile[i] = dark;
    const tt = this.tintTile;
    tt[i * 4] = r;
    tt[i * 4 + 1] = g;
    tt[i * 4 + 2] = b;
    tt[i * 4 + 3] = 255;
    this.maskTile[i] = dv;
  }

  flush(x0: number, y0: number, x1: number, y1: number, dv: boolean): void {
    const { w, h } = this;
    const dt = this.darkTile;
    const tt = this.tintTile;
    const mt = this.maskTile;
    upsample(dt, 1, w, h, x0, y0, x1, y1, this.tmp, this.darkImg.data, 3);
    upsample(tt, 4, w, h, x0, y0, x1, y1, this.tmp, this.tintImg.data, 0);
    // Without darkvision the mask is not read (syncDarkvisionFX removes its effect), so it is neither drawn nor uploaded.
    if (dv) upsample(mt, 1, w, h, x0, y0, x1, y1, this.tmp, this.maskImg.data, 0);
    blackenDarkTiles(dt, w, x0, y0, x1, y1, this.darkImg.data, this.tintImg.data);
    // Only the window goes to the GPU; the camera never shows the texture outside it, so what lies there is stale.
    const [px, py, pw, ph] = [x0 * SUB, y0 * SUB, (x1 - x0) * SUB, (y1 - y0) * SUB];
    this.darkUp.upload(this.darkImg, px, py, pw, ph);
    this.tintUp.upload(this.tintImg, px, py, pw, ph);
    if (dv) this.maskUp.upload(this.maskImg, px, py, pw, ph);
  }
}
