// Status effects on a figure (blind, asleep, petrified, slowed, accelerated):
// pure pose helpers plus the small marks drawn around the figure. The body
// itself (lying down, grey stone, tints) is changed in EntityView.
import Phaser from 'phaser';
import { EFFECT } from '../generated/defs';
import { DEPTH, GLOOM, type Effects } from './effects';

/** True when the effect `kind` is set in the bitmask `bits` (bit = 1 << EffectKind id). */
export function has(bits: number, kind: number): boolean {
  return (bits & (1 << kind)) !== 0;
}

/**
 * A prone figure (asleep) lies down towards its facing: rotated ±90° about
 * its feet, a little flattened, with the side that ends up on the floor
 * cropped (tall figures lose 2 px, small ones 1 px) so it does not float.
 */
export function lyingPose(figureH: number, left: boolean): { angle: number; cropBottom: number; squash: number } {
  return { angle: left ? -90 : 90, cropBottom: figureH >= 20 ? 2 : 1, squash: 0.92 };
}

/** Opaque part of a body frame: first and last columns, top row (frame pixels, unflipped). */
export interface Bounds {
  l: number;
  r: number;
  t: number;
}

/**
 * Where a lying body goes (in display space, after the flip): the crop of the
 * frame (`cut` px off the side that faces the floor after the ±90° turn: the
 * right edge falling right, the left edge falling left; counted from the
 * opaque edge, the pack frames have empty margins) and the body offset that
 * puts the cut edge on the floor line (y 1, where the feet stand) and centres
 * the lying figure on its shadow. `ox`: the body's origin column (px).
 */
export function lieLayout(b: Bounds, w: number, foot: number, ox: number, left: boolean, cut: number, squash: number): { cropX: number; cropW: number; x: number; y: number } {
  const l = left ? w - 1 - b.r : b.l;
  const r = left ? w - 1 - b.l : b.r;
  const len = foot - b.t;
  if (left) {
    const c0 = l + cut;
    return { cropX: c0, cropW: w - c0, x: Math.round(len / 2), y: 1 - Math.round((ox - c0) * squash) };
  }
  const c1 = r + 1 - cut;
  return { cropX: 0, cropW: c1, x: -Math.round(len / 2), y: 1 - Math.round((c1 - ox) * squash) };
}

const boundsCache = new Map<string, Bounds>();

/** Opaque bounds of an atlas frame (read once from the texture source, then cached). */
export function frameBounds(frame: Phaser.Textures.Frame): Bounds {
  const key = `${frame.texture.key}/${frame.name}`;
  let b = boundsCache.get(key);
  if (b) return b;
  b = { l: 0, r: frame.cutWidth - 1, t: 0 };
  const img = frame.source.image as CanvasImageSource;
  const c = document.createElement('canvas');
  c.width = frame.cutWidth;
  c.height = frame.cutHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (g) {
    g.drawImage(img, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, frame.cutWidth, frame.cutHeight);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let l = c.width, r = -1, t = c.height;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++)
        if (px[(y * c.width + x) * 4 + 3] > 0) {
          l = Math.min(l, x);
          r = Math.max(r, x);
          t = Math.min(t, y);
        }
    if (r >= 0) b = { l, r, t };
  }
  boundsCache.set(key, b);
  return b;
}

/**
 * The lich's stone gaze: a thin grey line, pulsing, from the lich's eyes
 * (14 px above its feet) to the middle of the hero it stares at. `t`: seconds.
 */
export function drawGazeBeam(g: Phaser.GameObjects.Graphics, lx: number, ly: number, tx: number, ty: number, t: number): void {
  g.lineStyle(1, 0xb0b0b0, 0.65 + 0.25 * Math.sin(t * 12));
  g.lineBetween(Math.round(lx), Math.round(ly - 14), Math.round(tx), Math.round(ty - 8));
}

const Z_EVERY = 0.6;
const Z_LIFE = 1.2;
const Z_RISE = 10;
const GHOST_EVERY = 0.08;
const GHOST_LIFE = 0.2;
const GHOST_TINT = 0xffe680;
const PUFF_N = 3;

/** Where the marks go, read from the owning figure each frame. */
export interface StatusAnchor {
  /** Feet position in the world. */
  x: number;
  y: number;
  /** Top of the head above the feet (px, positive). */
  head: number;
  /** The body sprite, copied for afterimages. */
  body: Phaser.GameObjects.Sprite;
  /** World scale of the body. */
  scale: number;
}

interface Z {
  t: Phaser.GameObjects.Text;
  age: number;
  x: number;
  y: number;
}

/** The marks of the effects on one figure, owned by its `EntityView`. */
export class StatusView {
  private clock = 0;
  private zT = 0;
  private ghostT = 0;
  private zs: Z[] = [];
  private freeZ: Phaser.GameObjects.Text[] = [];
  private puff: Phaser.GameObjects.Image[] = [];

  constructor(
    private scene: Phaser.Scene,
    private fx: Effects,
    private anchor: () => StatusAnchor,
  ) {}

  update(bits: number, dt: number): void {
    this.clock += dt;
    const a = this.anchor();
    this.blind(has(bits, EFFECT.Blind), a);
    this.sleep(has(bits, EFFECT.Sleep), a, dt);
    if (has(bits, EFFECT.Accelerated)) {
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostT = GHOST_EVERY;
        const b = a.body;
        // Feet-anchored copy of the body frame (the particle origin is the centre).
        const h = b.frame.height * a.scale;
        this.fx.particle(a.x + b.x * a.scale, a.y + (b.y - b.originY * b.frame.height) * a.scale + h / 2, 0, 0, GHOST_LIFE, GHOST_TINT, {
          frame: b.frame.name,
          alpha: 0.35,
          flipX: b.flipX,
          scale: a.scale,
          depth: DEPTH.entityBase + a.y - 1,
        });
      }
    } else this.ghostT = 0;
  }

  /** Blind: a dark puff of three gloom motes circling just above the head. */
  private blind(on: boolean, a: StatusAnchor): void {
    if (!on) {
      for (const p of this.puff) p.setVisible(false);
      return;
    }
    while (this.puff.length < PUFF_N) this.puff.push(this.scene.add.image(0, 0, 'dot').setTint(GLOOM.dark).setScale(1.6));
    const cy = a.y - a.head - 4;
    this.puff.forEach((p, i) => {
      const ang = this.clock * 4 + (i * Math.PI * 2) / PUFF_N;
      const front = Math.sin(ang) > 0;
      p.setVisible(true)
        .setPosition(Math.round(a.x + Math.cos(ang) * 4), Math.round(cy + Math.sin(ang) * 1.5))
        .setAlpha(0.85)
        .setDepth(DEPTH.entityBase + a.y + (front ? 1 : -1));
    });
  }

  /** Asleep: a small "z" every 0.6 s that rises 10 px and fades out over 1.2 s. */
  private sleep(on: boolean, a: StatusAnchor, dt: number): void {
    if (on) {
      this.zT -= dt;
      if (this.zT <= 0) {
        this.zT = Z_EVERY;
        const t =
          this.freeZ.pop() ??
          this.scene.add
            .text(0, 0, 'Z', { fontFamily: '"Press Start 2P", monospace', fontSize: '8px', resolution: 4, color: '#ffffff' })
            .setFontSize(5)
            .setOrigin(0.5, 1)
            .setStroke('#140c1a', 2)
            .setPadding(1);
        this.zs.push({ t: t.setVisible(true), age: 0, x: a.x + 3, y: a.y - a.head });
      }
    } else this.zT = 0;
    for (let i = this.zs.length - 1; i >= 0; i--) {
      const z = this.zs[i];
      z.age += dt;
      if (z.age >= Z_LIFE) {
        z.t.setVisible(false);
        this.freeZ.push(z.t);
        this.zs.splice(i, 1);
        continue;
      }
      const k = z.age / Z_LIFE;
      z.t
        .setPosition(Math.round(z.x + Math.sin(z.age * 5) * 1.5), Math.round(z.y - k * Z_RISE))
        .setAlpha(1 - k)
        .setDepth(DEPTH.numbers - 1);
    }
  }

  destroy(): void {
    for (const z of this.zs) z.t.destroy();
    for (const t of this.freeZ) t.destroy();
    for (const p of this.puff) p.destroy();
    this.zs = [];
    this.freeZ = [];
    this.puff = [];
  }
}
