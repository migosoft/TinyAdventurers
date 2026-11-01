// Pixies (#202): a few tiny glowing balls of light drifting around the cove's tree. Each is a 1-2 px
// bright core with a soft additive glow and a pale wing pixel on each side that flips every frame (a
// hummingbird buzz). Client-only: no light of their own, no game effect. The path is pure and seeded.
import type Phaser from 'phaser';
import { DEPTH } from './effects';

const GLOW_TEX = 'pixie-glow';
const GLOW_SIZE = 9;
const ADD = 1;
/** Half-axes of the ellipse a pixie wanders in (px). */
const RX = 56;
const RY = 32;
/** Vertical bob: peak-to-peak 2.5 px, once every 1.6-2.4 s. */
const BOB_AMP = 1.25;
const GLOW_ALPHA = 0.6;
const WING_ALPHA = 0.7;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-pixie path: two sines per axis (angular speed in rad/s, phase), plus the bob. */
function pathFor(i: number, seed: number) {
  const r = rng((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
  // 0.25-0.5 loops per 10 s
  const w = () => 2 * Math.PI * (0.025 + r() * 0.025);
  const ph = () => r() * 2 * Math.PI;
  return { wx1: w(), wx2: w() * 1.7, px1: ph(), px2: ph(), wy1: w(), wy2: w() * 1.3, py1: ph(), py2: ph(), bobW: 2 * Math.PI / (1.6 + r() * 0.8), bobP: ph() };
}

/** Whether the wings of pixie `i` are up on rendered frame `frame`: flips every frame, phase per pixie. */
export function wingUp(i: number, frame: number): boolean {
  return ((frame + i) & 1) === 0;
}

/** Position of pixie `i` at time `t` (s) around `centre`; stays inside the RX x RY ellipse. */
export function pixieAt(i: number, t: number, centre: { x: number; y: number }, seed: number): { x: number; y: number; wingUp: boolean } {
  const p = pathFor(i, seed);
  // each axis is in [-1, 1]; scaled by 1/sqrt(2) the pair stays inside the unit circle
  const u = (0.6 * Math.sin(p.wx1 * t + p.px1) + 0.4 * Math.sin(p.wx2 * t + p.px2)) * Math.SQRT1_2;
  const v = (0.6 * Math.sin(p.wy1 * t + p.py1) + 0.4 * Math.sin(p.wy2 * t + p.py2)) * Math.SQRT1_2;
  const bob = BOB_AMP * Math.sin(p.bobW * t + p.bobP);
  return { x: centre.x + u * RX, y: centre.y + v * (RY - BOB_AMP) + bob, wingUp: wingUp(i, Math.floor(t * 60)) };
}

/** A 9x9 soft round glow, white, to be tinted. */
function ensureTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(GLOW_TEX)) return;
  const c = scene.textures.createCanvas(GLOW_TEX, GLOW_SIZE, GLOW_SIZE)!;
  const ctx = c.getContext();
  const m = GLOW_SIZE / 2;
  const g = ctx.createRadialGradient(m, m, 0, m, m, m);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
  c.refresh();
}

interface Pixie {
  glow: Phaser.GameObjects.Image;
  core: Phaser.GameObjects.Rectangle;
  /** The second core pixel below, on half the pixies. */
  core2?: Phaser.GameObjects.Rectangle;
  wingL: Phaser.GameObjects.Rectangle;
  wingR: Phaser.GameObjects.Rectangle;
}

export class Pixies {
  /** Hidden and not updated while false. */
  on = true;
  private pixies: Pixie[] = [];

  constructor(scene: Phaser.Scene, private centre: { x: number; y: number }, count = 7, private seed = 0) {
    ensureTexture(scene);
    const px = (color: number, alpha = 1) => scene.add.rectangle(0, 0, 1, 1, color, alpha).setOrigin(0).setDepth(DEPTH.fx);
    for (let i = 0; i < count; i++) {
      const glow = scene.add.image(0, 0, GLOW_TEX).setTint(0xd8ffb0).setAlpha(GLOW_ALPHA).setBlendMode(ADD).setDepth(DEPTH.fx);
      const core = px(0xfffbe0);
      const core2 = i % 2 === 0 ? px(0xe8ffb0) : undefined;
      this.pixies.push({ glow, core, core2, wingL: px(0xffffff, WING_ALPHA), wingR: px(0xffffff, WING_ALPHA) });
    }
  }

  update(t: number, frame: number): void {
    for (const [i, p] of this.pixies.entries()) {
      for (const o of [p.glow, p.core, p.core2, p.wingL, p.wingR]) o?.setVisible(this.on);
      if (!this.on) continue;
      const at = pixieAt(i, t, this.centre, this.seed);
      const x = Math.round(at.x);
      const y = Math.round(at.y);
      const wy = wingUp(i, frame) ? y - 1 : y;
      p.glow.setPosition(x + 0.5, y + 0.5);
      p.core.setPosition(x, y);
      p.core2?.setPosition(x, y + 1);
      p.wingL.setPosition(x - 1, wy);
      p.wingR.setPosition(x + 1, wy);
    }
  }

  destroy(): void {
    for (const p of this.pixies) for (const o of [p.glow, p.core, p.core2, p.wingL, p.wingR]) o?.destroy();
    this.pixies = [];
  }
}
