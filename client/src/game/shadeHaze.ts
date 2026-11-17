// The Shade's looks that are not a sprite (#170, #200): a veil of black strands that wraps it and streams behind, the flat silhouette
// that warns of an ambush, and the veil drifting apart when it dies. The maths is pure (tested); the 3D view draws it.
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

/** Strand px per segment: short while the Shade stands (a cloud), long while it moves (streaming). */
const SEG_IDLE = 1.6;
const SEG_MOVE = 3;
/** Speed (px/s) at which the veil fully streams behind, and how fast (s) it changes between cloud and stream. */
const STREAM_SPEED = 25;
const STREAM_TAU = 0.25;
/** How far a segment may stretch past its length. */
const MAX_STRETCH = 1.3;

/**
 * One strand of the veil, facing right (mirrored when the Shade faces left): its root on the body (px from the feet),
 * the way it hangs when the Shade stands (`idle`, out from the body, so together they make a cloud around it) and
 * when it moves (`move`, behind it), how many segments, and whether it is drawn in front of the figure (wrapping it).
 */
interface StrandDef { root: [number, number]; idle: [number, number]; move: [number, number]; segs: number; front: boolean }

/** A strand rooted inside the body toward `deg` (0 = front, 90 = down), so it grows out of it; it puffs straight out when idle. */
const around = (deg: number, move: [number, number], segs = 4, front = false): StrandDef => {
  const a = (deg * Math.PI) / 180;
  return { root: [Math.round(Math.cos(a) * 2.5), Math.round(-6 + Math.sin(a) * 3.5)], idle: [Math.cos(a), Math.sin(a) * 0.8], move, segs, front };
};

// The back strands go round the body in order (the cloth fills between neighbours, closing the ring), so keep them so.
const STRANDS: StrandDef[] = [
  around(-90, [-1, -0.3], 5), // top
  around(-140, [-1, -0.1], 6), // back of the head
  around(180, [-1, 0.15], 6), // back
  around(140, [-1, 0.4], 5), // back of the hem
  around(90, [-1, 0.7], 4), // under it
  around(40, [-0.6, 0.8], 3), // front of the hem
  around(0, [-0.3, 0.5], 3), // front
  around(-40, [-0.5, -0.4], 4), // front of the head
  // Wrapping across the lower body and the hem (below the eyes, so they keep glowing).
  around(120, [-1, 0.2], 4, true),
  around(60, [-0.8, 0.5], 3, true),
];

export interface VeilStrand {
  /** Points from the root (on the body) to the tip, in world px. */
  pts: { x: number; y: number }[];
  front: boolean;
}

interface StrandState extends VeilStrand { def: StrandDef; phase: number }

type Rng = () => number;

/**
 * The veil's state: strands rooted round the Shade's body. Standing, they puff out round it like a cloud; moving, they
 * turn to stream behind. Each point eases toward where it would hang off the one before it, slower toward the tip, so
 * a move (or the attack dash) drags them along; a slow wave runs down each one.
 */
export class VeilStrands {
  private strands: StrandState[] = [];
  private t = 0;
  private last: { x: number; y: number } | null = null;
  /** 0 standing (cloud) to 1 moving (streaming), eased. */
  private stream = 0;

  constructor(private rnd: Rng = Math.random) {}

  get lines(): readonly VeilStrand[] {
    return this.strands;
  }

  /** Moves the veil `dt` seconds on. `feet` is the Shade's body at its feet; null (dead, invisible) clears it. */
  step(feet: { x: number; y: number } | null, face: 1 | -1, dt: number): void {
    if (!feet) {
      this.strands = [];
      this.last = null;
      this.stream = 0;
      return;
    }
    this.t += dt;
    const speed = this.last && dt > 0 ? Math.hypot(feet.x - this.last.x, feet.y - this.last.y) / dt : 0;
    this.last = { ...feet };
    this.stream += (Math.min(speed / STREAM_SPEED, 1) - this.stream) * (1 - Math.exp(-dt / STREAM_TAU));
    const m = this.stream;
    const seg = SEG_IDLE + (SEG_MOVE - SEG_IDLE) * m;
    if (this.strands.length === 0)
      this.strands = STRANDS.map((def) => {
        const root = { x: feet.x + def.root[0] * face, y: feet.y + def.root[1] };
        const [dx, dy] = [def.idle[0] * face, def.idle[1]];
        const pts = Array.from({ length: def.segs + 1 }, (_, i) => ({ x: root.x + dx * seg * i, y: root.y + dy * seg * i }));
        return { def, pts, front: def.front, phase: this.rnd() * Math.PI * 2 };
      });
    for (const s of this.strands) {
      const { def, pts } = s;
      let [dx, dy] = [def.idle[0] + (def.move[0] - def.idle[0]) * m, def.idle[1] + (def.move[1] - def.idle[1]) * m];
      const len = Math.hypot(dx, dy) || 1;
      [dx, dy] = [(dx * face) / len, dy / len];
      pts[0] = { x: feet.x + def.root[0] * face, y: feet.y + def.root[1] };
      for (let i = 1; i < pts.length; i++) {
        // Standing, the wave billows (slower, wider); moving, it ripples.
        const wave = Math.sin(this.t * (1.6 + 0.8 * m) + s.phase - i * 0.9) * (0.7 - 0.2 * m) * i;
        const gx = pts[i - 1].x + dx * seg - dy * wave;
        const gy = pts[i - 1].y + dy * seg + dx * wave;
        const k = 1 - Math.exp(-dt / (0.02 + 0.012 * i));
        let { x, y } = pts[i];
        x += (gx - x) * k;
        y += (gy - y) * k;
        // Never stretched past 1.3 times its length: a fast move drags the strand along instead of thinning it out.
        const ox = x - pts[i - 1].x;
        const oy = y - pts[i - 1].y;
        const d = Math.hypot(ox, oy);
        const max = seg * MAX_STRETCH;
        if (d > max) [x, y] = [pts[i - 1].x + (ox / d) * max, pts[i - 1].y + (oy / d) * max];
        pts[i] = { x, y };
      }
    }
  }
}

type Pt = { x: number; y: number };

/** Seconds the veil takes to drift apart after the Shade dies, and how much it spreads (1 = twice its size). */
export const VEIL_DEATH_LIFE = 1;
const VEIL_DEATH_SPREAD = 0.7;
/** Px it rises while it drifts apart. */
const VEIL_DEATH_RISE = 4;

/**
 * The veil `k` (0 to 1) of the way through the Shade's death: nothing holds it together any more, so every point
 * moves out from `centre` (fast at first, then slowing) and rises a little, while the whole veil fades to nothing.
 */
export function dissolveVeil(lines: readonly VeilStrand[], centre: Pt, k: number): { lines: VeilStrand[]; alpha: number } {
  const t = Math.min(Math.max(k, 0), 1);
  const ease = 1 - (1 - t) * (1 - t);
  const grow = 1 + VEIL_DEATH_SPREAD * ease;
  const rise = VEIL_DEATH_RISE * ease;
  return {
    lines: lines.map((l) => ({ front: l.front, pts: l.pts.map((p) => ({ x: centre.x + (p.x - centre.x) * grow, y: centre.y + (p.y - centre.y) * grow - rise })) })),
    alpha: Math.pow(1 - t, 1.5),
  };
}

/** A veil at rest round `feet` (a cloud), for a Shade that died where its own veil was not drawn. */
export function restingVeil(feet: Pt, face: 1 | -1, rnd: Rng = Math.random): VeilStrand[] {
  const v = new VeilStrands(rnd);
  for (let i = 0; i < 60; i++) v.step(feet, face, 1 / 30);
  return [...v.lines];
}
