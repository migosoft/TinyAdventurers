// The Shade's looks that are not a sprite (#170, #200): a veil of black strands that wraps it and streams behind, the flat silhouette
// that warns of an ambush, and the cloud it dies in. The maths is pure (tested); `ShadeVeil` only draws it.
import type Phaser from 'phaser';
import { CONST } from '../generated/defs';

/** Server wind-up of the ambush (`AMBUSH_WARNING` in run/ambush.rs). */
export const AMBUSH_WARNING = CONST.AMBUSH_WARNING;
/** The flat fill of the silhouette during the wind-up. */
export const SILHOUETTE_FILL = 0x120c18;
const SILHOUETTE_ALPHA_FROM = 0.2;
const SILHOUETTE_ALPHA_TO = 0.9;

/** The silhouette's alpha `t` seconds into the ambush wind-up: 0.2 rising to 0.9 over `AMBUSH_WARNING`. */
export function silhouetteAlpha(t: number): number {
  const k = Math.min(Math.max(t / AMBUSH_WARNING, 0), 1);
  return SILHOUETTE_ALPHA_FROM + (SILHOUETTE_ALPHA_TO - SILHOUETTE_ALPHA_FROM) * k;
}

/** Death cloud colour: dark grey with a hint of violet, light enough to read on a dark floor. */
export const HAZE_COLOR = 0x2a2433;
/** Squash of the death cloud: a ring seen from a little above. */
const ORBIT_FLAT = 0.75;

/** The veil's colour: pure darkness. */
export const VEIL_COLOR = 0x000000;
/** Strand px per segment. */
const VEIL_SEG = 3;

/**
 * One strand of the veil, facing right (mirrored when the Shade faces left): its root on the body (px from the feet),
 * the way it hangs at rest, how many segments, and whether it is drawn in front of the figure (wrapping it).
 */
interface StrandDef { root: [number, number]; dir: [number, number]; segs: number; front: boolean }

// The back strands fan out top to bottom (the cloth fills between neighbours), so keep them in that order.
const STRANDS: StrandDef[] = [
  { root: [-2, -11], dir: [-1, -0.15], segs: 6, front: false }, // over the head, the top of the cape
  { root: [-4, -8], dir: [-1, 0.15], segs: 7, front: false }, // back shoulder, the longest
  { root: [-5, -5], dir: [-1, 0.4], segs: 6, front: false }, // back side
  { root: [-4, -1], dir: [-1, 0.7], segs: 5, front: false }, // hem, low to the floor
  { root: [2, -10], dir: [-1, 0.9], segs: 4, front: true }, // across the body, wrapping it
  { root: [3, -2], dir: [-0.8, 0.3], segs: 3, front: true }, // across the hem
];

export interface VeilStrand {
  /** Points from the root (on the body) to the tip, in world px. */
  pts: { x: number; y: number }[];
  front: boolean;
}

interface StrandState extends VeilStrand { def: StrandDef; phase: number }

type Rng = () => number;

/**
 * The veil's state: strands rooted on the Shade's body. Each point eases toward where it would hang behind the one
 * before it, slower toward the tip, so a move leaves the strands streaming behind; a slow wave runs down each one.
 */
export class VeilStrands {
  private strands: StrandState[] = [];
  private t = 0;

  constructor(private rnd: Rng = Math.random) {}

  get lines(): readonly VeilStrand[] {
    return this.strands;
  }

  /** Moves the veil `dt` seconds on. `feet` is the Shade's feet; null (dead, invisible) clears it. */
  step(feet: { x: number; y: number } | null, face: 1 | -1, dt: number): void {
    if (!feet) {
      this.strands = [];
      return;
    }
    this.t += dt;
    if (this.strands.length === 0)
      this.strands = STRANDS.map((def) => {
        const root = { x: feet.x + def.root[0] * face, y: feet.y + def.root[1] };
        const pts = Array.from({ length: def.segs + 1 }, (_, i) => ({ x: root.x + def.dir[0] * face * VEIL_SEG * i, y: root.y + def.dir[1] * VEIL_SEG * i }));
        return { def, pts, front: def.front, phase: this.rnd() * Math.PI * 2 };
      });
    for (const s of this.strands) {
      const { def, pts } = s;
      const len = Math.hypot(def.dir[0], def.dir[1]);
      const [dx, dy] = [(def.dir[0] * face) / len, def.dir[1] / len];
      pts[0] = { x: feet.x + def.root[0] * face, y: feet.y + def.root[1] };
      for (let i = 1; i < pts.length; i++) {
        const wave = Math.sin(this.t * 2.4 + s.phase - i * 0.9) * 0.5 * i;
        const gx = pts[i - 1].x + dx * VEIL_SEG - dy * wave;
        const gy = pts[i - 1].y + dy * VEIL_SEG + dx * wave;
        const k = 1 - Math.exp(-dt / (0.03 + 0.035 * i));
        let { x, y } = pts[i];
        x += (gx - x) * k;
        y += (gy - y) * k;
        // Never stretched past twice its length: a fast move drags the strand along.
        const ox = x - pts[i - 1].x;
        const oy = y - pts[i - 1].y;
        const d = Math.hypot(ox, oy);
        if (d > VEIL_SEG * 2) [x, y] = [pts[i - 1].x + (ox / d) * VEIL_SEG * 2, pts[i - 1].y + (oy / d) * VEIL_SEG * 2];
        pts[i] = { x, y };
      }
    }
  }
}

/** A strand pixel's alpha `f` of the way from root to tip: solid, then two see-through steps; 0 where the dither leaves a gap. */
export function veilAlpha(f: number, x: number, y: number): number {
  if (f < 0.45) return 1;
  if (f < 0.75) return 0.6;
  return (x + y) % 2 === 0 ? 0.3 : 0;
}

/** The cloth between two back strands: dark at the body, thinning out to a dithered edge. */
export function sheetAlpha(f: number, x: number, y: number): number {
  if (f < 0.4) return 0.55;
  if (f < 0.7) return 0.35;
  return (x + y) % 2 === 0 ? 0.2 : 0;
}

type Pt = { x: number; y: number };

/** Every whole pixel of a strand, root to tip, with how far along it lies (0 to 1). About 3 px wide at the root, 1 at the tip. */
export function strandPixels(pts: readonly Pt[]): { x: number; y: number; f: number }[] {
  const out: { x: number; y: number; f: number }[] = [];
  const seen = new Set<string>();
  const add = (x: number, y: number, f: number) => {
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ x, y, f });
  };
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))));
    for (let k = 0; k < steps; k++) {
      const u = k / steps;
      const f = (i + u) / n;
      const x = Math.round(a.x + (b.x - a.x) * u);
      const y = Math.round(a.y + (b.y - a.y) * u);
      add(x, y, f);
      if (f < 0.6) add(x, y + 1, f);
      if (f < 0.3) add(x, y - 1, f);
    }
  }
  const tip = pts[n];
  add(Math.round(tip.x), Math.round(tip.y), 1);
  return out;
}

/** Is (x, y) inside the polygon (even-odd)? */
function inside(poly: readonly Pt[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[i], poly[j]];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/**
 * The veil as whole pixels and their alpha, one map per layer (`x,y` keys; a pixel covered twice keeps the darker):
 * behind the figure the cloth between neighbouring back strands and the strands over it, in front the wrapping strands.
 */
export function veilPixels(lines: readonly VeilStrand[]): { back: Map<string, number>; front: Map<string, number> } {
  const back = new Map<string, number>();
  const front = new Map<string, number>();
  const put = (m: Map<string, number>, x: number, y: number, a: number) => {
    if (a <= 0) return;
    const key = `${x},${y}`;
    if ((m.get(key) ?? 0) < a) m.set(key, a);
  };
  const backs = lines.filter((l) => !l.front);
  for (let s = 0; s + 1 < backs.length; s++) {
    const [A, B] = [backs[s].pts, backs[s + 1].pts];
    const n = Math.min(A.length, B.length) - 1;
    for (let i = 0; i < n; i++) {
      const quad = [A[i], A[i + 1], B[i + 1], B[i]];
      const xs = quad.map((p) => p.x);
      const ys = quad.map((p) => p.y);
      for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
        for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++)
          if (inside(quad, x + 0.5, y + 0.5)) put(back, x, y, sheetAlpha((i + 0.5) / n, x, y));
    }
  }
  for (const l of lines) for (const p of strandPixels(l.pts)) put(l.front ? front : back, p.x, p.y, veilAlpha(p.f, p.x, p.y));
  return { back, front };
}

const CLOUD_COUNT = 20;
const CLOUD_SPREAD = 14;
const CLOUD_LIFE = 0.8;

/** The dark cloud a Shade dies in: about 20 particles (velocities in px/s) that spread to at most 14 px and fade over 0.8 s. */
export function deathCloud(rnd: Rng = Math.random): { life: number; particles: { vx: number; vy: number; scale: number }[] } {
  const particles = [];
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const a = rnd() * Math.PI * 2;
    const speed = (CLOUD_SPREAD / CLOUD_LIFE) * (0.3 + rnd() * 0.7);
    particles.push({ vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * ORBIT_FLAT, scale: 1.6 + rnd() * 0.9 });
  }
  return { life: CLOUD_LIFE, particles };
}

/** Front strands are fainter, so the Shade shows through where the veil wraps across it. */
const FRONT_ALPHA = 0.55;

/** Draws the `VeilStrands` as black pixels (`veilPixels`): cloth and back strands just under the figure, the wrapping ones just over it. */
export class ShadeVeil {
  private veil = new VeilStrands();
  private back: Phaser.GameObjects.Graphics;
  private front: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.back = scene.add.graphics();
    this.front = scene.add.graphics();
  }

  /** Follows the Shade's `feet`, or clears the veil when null. `alpha` scales it (fading in, the ambush warning). */
  update(feet: { x: number; y: number } | null, face: 1 | -1, depth: number, alpha: number, dt: number): void {
    this.veil.step(feet, face, dt);
    this.back.clear().setDepth(depth - 0.5);
    this.front.clear().setDepth(depth + 0.5);
    const { back, front } = veilPixels(this.veil.lines);
    for (const [g, px, k] of [[this.back, back, alpha], [this.front, front, alpha * FRONT_ALPHA]] as const)
      for (const [key, a] of px) {
        const [x, y] = key.split(',').map(Number);
        g.fillStyle(VEIL_COLOR, a * k).fillRect(x, y, 1, 1);
      }
  }

  destroy(): void {
    this.back.destroy();
    this.front.destroy();
  }
}
