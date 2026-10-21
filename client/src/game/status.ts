// Status effects on a figure (blind, asleep, petrified, slowed, accelerated,
// burning, frozen, poisoned, chilled, singed, tainted, entangled, fear, warded, coated):
// pure pose helpers plus the small marks drawn around the figure. The body
// itself (lying down, grey stone, tints) is changed in EntityView.
import Phaser from 'phaser';
import { EFFECT, EFFECT_LOOK } from '../generated/defs';
import { DEPTH, GLOOM, SOUND_TEXT, type Effects } from './effects';

/** True when the effect `kind` is set in the bitmask `bits` (bit = 1 << EffectKind id). */
export function has(bits: number, kind: number): boolean {
  return (bits & (1 << kind)) !== 0;
}

/**
 * The look an effect has on an entity: the look sent in the snapshot's `looks`
 * (entity id, effect id, look id; only non-default ones), else `Plain`.
 */
export function lookOf(looks: readonly (readonly [number, number, number])[], id: number, effect: number): number {
  for (const [i, e, l] of looks) if (i === id && e === effect) return l;
  return EFFECT_LOOK.Plain;
}

type Look = (typeof EFFECT_LOOK)[keyof typeof EFFECT_LOOK];

/** How Entangled is drawn around the feet, by look (a later web is one more entry; the compiler lists the missing ones). */
const ENTANGLE: Record<Look, { color: number; vines: boolean }> = {
  [EFFECT_LOOK.Plain]: { color: 0xa8a8b0, vines: false },
  [EFFECT_LOOK.Vines]: { color: 0x4fa83a, vines: true },
};

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

/**
 * Opacity of a snowflake `age` s into its `life`: fades in over the first
 * quarter, holds, fades out over the last quarter (0 outside the life).
 */
export function snowflakeAlpha(age: number, life: number): number {
  if (life <= 0 || age <= 0 || age >= life) return 0;
  const k = age / life;
  return Math.min(1, k / 0.25, (1 - k) / 0.25);
}

/** Deterministic 0..1 from a seed and an index (a small integer hash). */
function hash01(seed: number, i: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 0x100000000;
}

/**
 * `n` points on a body `bodyW` x `bodyH` px (feet at y 0, upwards negative,
 * x centred), mostly on its lower two thirds: where the flames of a burning
 * figure sit. Deterministic for a `seed`.
 */
export function flameSpots(bodyW: number, bodyH: number, n: number, seed: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const u = hash01(seed, i * 2);
    const v = hash01(seed, i * 2 + 1);
    out.push([(u - 0.5) * bodyW * 0.8, -bodyH * (0.1 + 0.75 * v * v)]);
  }
  return out;
}

const Z_EVERY = 0.6;
const Z_LIFE = 1.2;
const Z_RISE = 10;
const GHOST_EVERY = 0.08;
const GHOST_LIFE = 0.2;
const GHOST_TINT = 0xffe680;
const PUFF_N = 3;
const FLAME_N = 3;
const FLAME_TEX = 'fx_flame';
const HAZE_TEX = 'fx_haze';
const HAZE_W = 24;
const HAZE_H = 32;
const HAZE_COLOR = 0x50b0ff;
const SNOW_N = 6;
const SNOW_REACH = 6;
const BUBBLE_EVERY = 0.35;
const BUBBLE_LIFE = 0.8;
const BUBBLE_RISE = 8;
const BUBBLE_COLOR = 0x7fd650;
const CHILL_EVERY = 0.55;
const CHILL_LIFE = 0.9;
const EMBER_EVERY = 0.35;
const EMBER_LIFE = 0.6;
const EMBER_RISE = 12;
const GLINT_EVERY = 0.45;
const GLINT_LIFE = 0.25;
const GLINT_COLOR = 0x7fe060;
const WARD_COLOR = 0xffd24a;

/** A burning figure's flame: its spot on the body, re-seeded now and then. */
interface Flame {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  /** Seconds until it moves to a new spot. */
  move: number;
  phase: number;
}

/** A frozen figure's snowflake: shimmers in and out, then appears elsewhere. */
interface Flake {
  img: Phaser.GameObjects.Image;
  age: number;
  life: number;
  x: number;
  y: number;
}

/** The 3 x 5 px flame: an orange teardrop with a yellow core (made once). */
function ensureFlameTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(FLAME_TEX)) return FLAME_TEX;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0xff5a10, 1).fillRect(1, 0, 1, 1).fillRect(0, 2, 3, 2).fillRect(1, 4, 1, 1);
  g.fillStyle(0xff9a20, 1).fillRect(1, 1, 1, 1);
  g.fillStyle(0xffe060, 1).fillRect(1, 2, 1, 2);
  g.generateTexture(FLAME_TEX, 3, 5);
  g.destroy();
  return FLAME_TEX;
}

/** The frost haze: a soft blue ellipse, densest in the middle (made once). */
function ensureHazeTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(HAZE_TEX)) return HAZE_TEX;
  const g = scene.make.graphics({}, false);
  for (let i = 0; i < 5; i++) g.fillStyle(HAZE_COLOR, 0.35).fillEllipse(HAZE_W / 2, HAZE_H / 2, HAZE_W - i * 3, HAZE_H - i * 4);
  g.generateTexture(HAZE_TEX, HAZE_W, HAZE_H);
  g.destroy();
  return HAZE_TEX;
}

/** Where the marks go, read from the owning figure each frame. */
export interface StatusAnchor {
  /** Feet position in the world. */
  x: number;
  y: number;
  /** Top of the head above the feet (px, positive). */
  head: number;
  /** Width of the opaque body (px, world scale). */
  w: number;
  /** Middle of the opaque body from the feet (px, world scale; the origin may sit off centre). */
  cx: number;
  /** The body sprite, copied for afterimages. */
  body: Phaser.GameObjects.Sprite;
  /** World scale of the body. */
  scale: number;
  /** Where the weapon is held, from the feet (x already towards the facing, y up; px, world scale). */
  hand: { x: number; y: number };
  /** The figure's own alpha; every mark multiplies it in. */
  alpha: number;
}

interface Z {
  t: Phaser.GameObjects.Text;
  age: number;
  x: number;
  y: number;
  /** Depth: the sound layer, above the darkness. */
  d: number;
}

/** The marks of the effects on one figure, owned by its `EntityView`. */
export class StatusView {
  private clock = 0;
  private zT = 0;
  private ghostT = 0;
  private zs: Z[] = [];
  private freeZ: Phaser.GameObjects.Text[] = [];
  private puff: Phaser.GameObjects.Image[] = [];
  private flames: Flame[] = [];
  private haze?: Phaser.GameObjects.Image;
  private flakes: Flake[] = [];
  private bubbleT = 0;
  private chillT = 0;
  private emberT = 0;
  private glintT = 0;
  private seeds = 0;
  private fearMark?: Phaser.GameObjects.Text;
  /** Entangled bands and the Warded outline, redrawn each frame. */
  private g?: Phaser.GameObjects.Graphics;

  constructor(
    private scene: Phaser.Scene,
    private fx: Effects,
    private anchor: () => StatusAnchor,
  ) {}

  /** `entangled`: the look of the Entangled effect on this figure (`lookOf`). */
  update(bits: number, dt: number, entangled: number = EFFECT_LOOK.Plain): void {
    this.clock += dt;
    const a = this.anchor();
    this.blind(has(bits, EFFECT.Blind), a);
    this.sleep(has(bits, EFFECT.Sleep), a, dt);
    this.burning(has(bits, EFFECT.Burning), a, dt);
    this.frozen(has(bits, EFFECT.Frozen), a, dt);
    this.poisoned(has(bits, EFFECT.Poisoned), a, dt);
    this.chilled(has(bits, EFFECT.Chilled), a, dt);
    this.singed(has(bits, EFFECT.Singed), a, dt);
    this.fear(has(bits, EFFECT.Fear), a);
    this.coated(has(bits, EFFECT.Coated), a, dt);
    this.drawings(has(bits, EFFECT.Entangled) ? entangled : undefined, has(bits, EFFECT.Warded), a);
    if (has(bits, EFFECT.Accelerated)) {
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostT = GHOST_EVERY;
        const b = a.body;
        // Feet-anchored copy of the body frame (the particle origin is the centre).
        const h = b.frame.height * a.scale;
        this.fx.particle(a.x + b.x * a.scale, a.y + (b.y - b.originY * b.frame.height) * a.scale + h / 2, 0, 0, GHOST_LIFE, GHOST_TINT, {
          frame: b.frame.name,
          alpha: 0.35 * a.alpha,
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
        .setAlpha(0.85 * a.alpha)
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
            .text(0, 0, 'Z', { fontFamily: '"Press Start 2P", monospace', fontSize: '8px', resolution: 4, color: SOUND_TEXT.fill })
            .setFontSize(5)
            .setOrigin(0.5, 1)
            .setStroke(SOUND_TEXT.stroke, 2)
            .setPadding(1);
        this.zs.push({ t: t.setVisible(true), age: 0, x: a.x + 3, y: a.y - a.head, d: DEPTH.sound });
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
        .setAlpha((1 - k) * a.alpha)
        .setDepth(z.d);
    }
  }

  /** Burning: three small flames on the body, flickering, hopping to new spots now and then. */
  private burning(on: boolean, a: StatusAnchor, dt: number): void {
    if (!on) {
      for (const f of this.flames) f.img.setVisible(false);
      return;
    }
    if (this.flames.length === 0) {
      const tex = ensureFlameTexture(this.scene);
      for (let i = 0; i < FLAME_N; i++)
        this.flames.push({ img: this.scene.add.image(0, 0, tex).setOrigin(0.5, 1), x: 0, y: 0, move: 0, phase: i * 2.1 });
    }
    const d = DEPTH.entityBase + a.y + 1;
    this.flames.forEach((f, i) => {
      f.move -= dt;
      if (f.move <= 0) {
        f.move = 0.4 + Math.random() * 0.6;
        [f.x, f.y] = flameSpots(a.w, a.head, FLAME_N, ++this.seeds)[i];
      }
      // About 10 Hz, each flame on its own phase.
      f.img
        .setVisible(true)
        .setPosition(Math.round(a.x + a.cx + f.x), Math.round(a.y + f.y))
        .setScale(1 + 0.2 * Math.sin(this.clock * 63 + f.phase))
        .setAlpha((0.85 + 0.15 * Math.sin(this.clock * 59 + f.phase * 1.7)) * a.alpha)
        .setDepth(d);
    });
  }

  /** Frozen: a soft blue haze around the body and tiny snowflakes shimmering in and out. */
  private frozen(on: boolean, a: StatusAnchor, dt: number): void {
    if (!on) {
      this.haze?.setVisible(false);
      for (const f of this.flakes) f.img.setVisible(false);
      return;
    }
    // Added light: a blue glow, not a grey film over the floor ('ADD' by name: a runtime Phaser import breaks the node tests).
    this.haze ??= this.scene.add.image(0, 0, ensureHazeTexture(this.scene)).setBlendMode('ADD');
    this.haze
      .setVisible(true)
      .setPosition(Math.round(a.x + a.cx), Math.round(a.y - a.head / 2))
      .setScale((a.w + 10) / HAZE_W, (a.head + 10) / HAZE_H)
      .setAlpha((0.45 + 0.1 * Math.sin(this.clock * 3)) * a.alpha)
      .setDepth(DEPTH.entityBase + a.y - 0.5);
    // Staggered start: a new flake waits (negative age) before it first appears.
    while (this.flakes.length < SNOW_N)
      this.flakes.push({ img: this.scene.add.image(0, 0, 'spark'), age: -Math.random() * 0.8, life: 0, x: 0, y: 0 });
    for (const f of this.flakes) {
      f.age += dt;
      if (f.life === 0 || f.age >= f.life) {
        if (f.life !== 0) f.age = 0;
        f.life = 0.6 + Math.random() * 0.4;
        f.x = (Math.random() - 0.5) * (a.w + SNOW_REACH * 2);
        f.y = 2 - Math.random() * (a.head + SNOW_REACH);
        f.img.setTint(Math.random() < 0.5 ? 0xffffff : 0xd8f0ff);
      }
      f.img
        .setVisible(true)
        .setPosition(Math.round(a.x + a.cx + f.x), Math.round(a.y + f.y))
        .setAlpha(snowflakeAlpha(f.age, f.life) * a.alpha)
        .setDepth(DEPTH.entityBase + a.y + 1);
    }
  }

  /** Poisoned: small green bubbles rise off the body (the green tint pulse is on the body, in EntityView). */
  private poisoned(on: boolean, a: StatusAnchor, dt: number): void {
    if (!on) {
      this.bubbleT = 0;
      return;
    }
    this.bubbleT -= dt;
    if (this.bubbleT > 0) return;
    this.bubbleT = BUBBLE_EVERY;
    const x = a.x + a.cx + (Math.random() - 0.5) * a.w * 0.8;
    const y = a.y - a.head * (0.3 + Math.random() * 0.6);
    this.fx.particle(Math.round(x), Math.round(y), 0, -BUBBLE_RISE / BUBBLE_LIFE, BUBBLE_LIFE, BUBBLE_COLOR, {
      depth: DEPTH.entityBase + a.y + 1,
      alpha: a.alpha,
    });
  }

  /** Chilled: an occasional single snowflake drifting down (lighter than Frozen; the pale tint is on the body). */
  private chilled(on: boolean, a: StatusAnchor, dt: number): void {
    if (!on) {
      this.chillT = 0;
      return;
    }
    this.chillT -= dt;
    if (this.chillT > 0) return;
    this.chillT = CHILL_EVERY * (0.6 + Math.random() * 0.8);
    const x = a.x + a.cx + (Math.random() - 0.5) * (a.w + 6);
    const y = a.y - a.head * (0.4 + Math.random() * 0.7);
    this.fx.particle(Math.round(x), Math.round(y), 0, 6 / CHILL_LIFE, CHILL_LIFE, Math.random() < 0.5 ? 0xffffff : 0xd8f0ff, {
      frame: 'spark',
      depth: DEPTH.entityBase + a.y + 1,
      alpha: 0.8 * a.alpha,
    });
  }

  /** Singed: a few small embers lifting off the body (fewer and smaller than Burning's flames). */
  private singed(on: boolean, a: StatusAnchor, dt: number): void {
    if (!on) {
      this.emberT = 0;
      return;
    }
    this.emberT -= dt;
    if (this.emberT > 0) return;
    this.emberT = EMBER_EVERY * (0.6 + Math.random() * 0.8);
    const x = a.x + a.cx + (Math.random() - 0.5) * a.w * 0.8;
    const y = a.y - a.head * (0.2 + Math.random() * 0.5);
    this.fx.particle(Math.round(x), Math.round(y), (Math.random() - 0.5) * 6, -EMBER_RISE / EMBER_LIFE, EMBER_LIFE, Math.random() < 0.5 ? 0xff7a20 : 0xffb040, {
      depth: DEPTH.entityBase + a.y + 1,
      alpha: a.alpha,
    });
  }

  /** Fear: a small "!" above the head, bobbing (the wolf's growl text style). */
  private fear(on: boolean, a: StatusAnchor): void {
    if (!on) {
      this.fearMark?.setVisible(false);
      return;
    }
    this.fearMark ??= this.scene.add
      .text(0, 0, '!', { fontFamily: '"Press Start 2P", monospace', fontSize: '8px', resolution: 4, color: SOUND_TEXT.fill })
      .setFontSize(6)
      .setOrigin(0.5, 1)
      .setStroke(SOUND_TEXT.stroke, 2)
      .setPadding(1);
    this.fearMark
      .setVisible(true)
      .setPosition(Math.round(a.x + a.cx), Math.round(a.y - a.head - 3 - Math.abs(Math.sin(this.clock * 9)) * 1.5))
      .setAlpha(a.alpha)
      .setDepth(DEPTH.sound);
  }

  /** Coated: a green glint twinkling on the weapon hand (the weapon was dipped in poison). */
  private coated(on: boolean, a: StatusAnchor, dt: number): void {
    if (!on) {
      this.glintT = 0;
      return;
    }
    this.glintT -= dt;
    if (this.glintT > 0) return;
    this.glintT = GLINT_EVERY * (0.7 + Math.random() * 0.6);
    this.fx.particle(Math.round(a.x + a.hand.x + (Math.random() - 0.5) * 4), Math.round(a.y - a.hand.y + (Math.random() - 0.5) * 6), 0, 0, GLINT_LIFE, GLINT_COLOR, {
      frame: 'spark',
      depth: DEPTH.entityBase + a.y + 1,
      alpha: a.alpha,
    });
  }

  /**
   * The marks drawn as lines: the Entangled bands (grey, or green vines, by `look`;
   * undefined: not entangled) around the feet and the thin Warded outline pulsing around the body.
   */
  private drawings(look: number | undefined, warded: boolean, a: StatusAnchor): void {
    if (look === undefined && !warded) {
      this.g?.clear().setVisible(false);
      return;
    }
    const g = (this.g ??= this.scene.add.graphics());
    g.clear().setVisible(true).setDepth(DEPTH.entityBase + a.y + 1).setAlpha(a.alpha);
    const cx = Math.round(a.x + a.cx);
    if (look !== undefined) {
      // `?? Plain`: a newer server may send a look id this client does not know.
      const { color, vines } = ENTANGLE[look as Look] ?? ENTANGLE[EFFECT_LOOK.Plain];
      const rx = Math.round(a.w / 2) + 1;
      const fy = Math.round(a.y);
      // Two bands one above the other, round the ankles.
      g.lineStyle(1, color, 0.95);
      g.strokeEllipse(cx, fy - 1, rx * 2, 4);
      g.strokeEllipse(cx, fy - 4, rx * 2 - 2, 4);
      if (vines) {
        // Short tendrils and leaves sticking out of the bands.
        g.fillStyle(0x8fe05a, 1);
        for (const k of [-1, 1]) {
          g.lineBetween(cx + k * rx, fy - 1, cx + k * (rx + 2), fy - 4);
          g.fillRect(cx + k * (rx + 2) - (k < 0 ? 1 : 0), fy - 5, 2, 1);
        }
      }
    }
    if (warded) {
      const k = 0.5 + 0.5 * Math.sin(this.clock * 4);
      g.lineStyle(1, WARD_COLOR, 0.35 + 0.5 * k);
      g.strokeEllipse(cx, Math.round(a.y - a.head / 2), a.w + 5, a.head + 5);
    }
  }

  destroy(): void {
    this.g?.destroy();
    this.fearMark?.destroy();
    this.g = undefined;
    this.fearMark = undefined;
    for (const f of this.flames) f.img.destroy();
    for (const f of this.flakes) f.img.destroy();
    this.haze?.destroy();
    this.flames = [];
    this.flakes = [];
    this.haze = undefined;
    for (const z of this.zs) z.t.destroy();
    for (const t of this.freeZ) t.destroy();
    for (const p of this.puff) p.destroy();
    this.zs = [];
    this.freeZ = [];
    this.puff = [];
  }
}
