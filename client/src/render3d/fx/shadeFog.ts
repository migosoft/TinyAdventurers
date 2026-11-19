// The black fog that clings to a figure with `spectre.fog` (#359): soft dark round patches that hang round the body and lie flat over the
// floor under it, churn slowly and follow the body a little late. Nothing rises, nothing streams, no strand or tentacle. Each patch is two
// rings of triangles (a single fan's straight falloff shows the patches as cones), so no single block shows. Lengths here are px (`PX` of a
// tile); positions are world tiles. The look is the approved spike's `fogCloud`; the state is kept per figure by `status.ts`.
import { PX, type Axes } from './shapes';
import type { FxTris } from './tris';

/** The look, first values for the user's eye. `alpha`: the centre's alpha of a flat and of an upright patch; `lag`: the farthest a patch may trail its place (px); `churn`: the ring's wobble (px); `spread`: px/s while dying; `fade`: s a fog whose figure left the frame takes to fade; `segs` round a patch; `mid`: the middle ring's share of the radius. */
export const FOG = { patches: 40, floor: 11, lag: 4, churn: 1.1, rgb: [0, 0, 0.012], alpha: [0.26, 0.3], spread: 6, fade: 0.3, segs: 10, mid: 0.55 } as const;

/** How the constructor draws a patch (px, rad/s, 1/s): [low, high] ranges; the first `FOG.floor` (times detail) patches lie flat over the floor. */
export const FOG_MAKE = {
  flat: { r: [3, 9], hy: [0, 2], size: [5.5, 8] },
  upright: { r: [2.5, 6], hy: [2, 12.5], size: [3.6, 6.2] },
  rate: [5, 10],
  spin: [0.1, 0.25],
  /** The chance that a patch turns the negative way round. */
  spinBack: 0.5,
} as const;

/** How a patch moves and looks over time. `ring`: the ring's share while forming (a pool) to formed; `bob` the height wobble (px); the periods are rad/s of the clock; `breathe` the size's pulse. */
export const FOG_MOVE = {
  ring: [0.55, 0.45],
  churnRate: 0.7, bob: 0.9, bobRate: 0.9,
  ringForm: [0.1, 1], heightForm: [0.15, 1],
  breathe: 0.12, breatheRate: 0.8, sizeBase: 0.9,
  /** Multiples of a patch's phase `ph` for the height wobble and the size pulse, so the patches do not beat together. */
  bobPhase: 2, breathePhase: 3,
  /** Share of the mid ring's alpha (a gaussian-like falloff sampled at `FOG.mid`), and of the rim: 0. */
  midAlpha: 0.49,
  /** The flat patch's height above the floor (tiles) and the spread between patches (z-fighting). */
  floorY: 0.03, floorSpread: 0.002,
  /** The upright patch's lowest point is kept this far above the floor (tiles). */
  clear: 0.03,
} as const;

/**
 * The fog of a figure in a frame (used by `status.ts`): the gap (s) and the jump (tiles) after which the fog restarts at the figure; the
 * longest step (s); the alpha under which a figure shows no fog; the dying fog's growth per second; `rewind`: a clock that went back by
 * more than this (s) is a new run's, and the fog starts again.
 */
export const FOG_FRAME = { gap: 3, jump: 1, maxStep: 0.1, minAlpha: 0.05, formAlpha: 0.45, grow: 0.6, rewind: 1 } as const;

export interface FogPatch { a: number; r: number; hy: number; size: number; rate: number; ph: number; spin: number; x: number; y: number; z: number; flat: boolean }

export const smooth = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const place_: [number, number, number] = [0, 0, 0];

export class ShadeFog {
  readonly patches: FogPatch[] = [];

  constructor(rnd: () => number, detail: number) {
    const n = Math.round(FOG.patches * detail), flat = Math.round(FOG.floor * detail);
    const span = (r: readonly [number, number] | readonly number[]): number => r[0] + rnd() * (r[1] - r[0]);
    for (let i = 0; i < n; i++) {
      const low = i < flat, m = low ? FOG_MAKE.flat : FOG_MAKE.upright;
      const a = rnd() * Math.PI * 2;
      this.patches.push({
        a, r: span(m.r), hy: span(m.hy), size: span(m.size),
        rate: span(FOG_MAKE.rate), ph: rnd() * Math.PI * 2, spin: (rnd() < FOG_MAKE.spinBack ? -1 : 1) * span(FOG_MAKE.spin), x: 0, y: 0, z: 0, flat: low,
      });
    }
  }

  /** The place of a patch at clock `t` round the spot (x, z) tiles, as [x, y, z] tiles (a scratch array: copy it to keep it). */
  place(p: FogPatch, t: number, x: number, z: number, form: number, stretch: number): readonly [number, number, number] {
    const ang = p.a + p.spin * t;
    const ring = (p.r + FOG.churn * Math.sin(FOG_MOVE.churnRate * t + p.ph)) * (FOG_MOVE.ring[0] + FOG_MOVE.ring[1] * smooth(FOG_MOVE.ringForm[0], FOG_MOVE.ringForm[1], form)) * PX;
    place_[0] = x + Math.sin(ang) * ring;
    place_[2] = z + Math.cos(ang) * ring;
    place_[1] = p.flat
      ? FOG_MOVE.floorY + FOG_MOVE.floorSpread * (p.ph % 1)
      : (p.hy * stretch * smooth(FOG_MOVE.heightForm[0], FOG_MOVE.heightForm[1], form) + FOG_MOVE.bob * Math.sin(FOG_MOVE.bobRate * t + FOG_MOVE.bobPhase * p.ph)) * PX;
    return place_;
  }

  /** Moves every patch toward its place round (x, z) tiles at its rate, then pulls any patch more than `FOG.lag` px behind onto that distance. `form` 0..1 (a pool, then rising); `stretch` = 1 / cos(pitch). A step of 0 s moves nothing. */
  step(dt: number, t: number, x: number, z: number, form: number, stretch: number): void {
    if (!(dt > 0)) return;
    const lim = FOG.lag * PX;
    for (const p of this.patches) {
      const q = this.place(p, t, x, z, form, stretch), k = 1 - Math.exp(-dt * p.rate);
      p.x += (q[0] - p.x) * k; p.y += (q[1] - p.y) * k; p.z += (q[2] - p.z) * k;
      const dx = q[0] - p.x, dy = q[1] - p.y, dz = q[2] - p.z, d = Math.hypot(dx, dy, dz);
      if (d > lim) { const s = lim / d; p.x = q[0] - dx * s; p.y = q[1] - dy * s; p.z = q[2] - dz * s; }
    }
  }

  /** Dying: every patch drifts outward from (x, z) at `FOG.spread` px/s. */
  spread(dt: number, x: number, z: number): void {
    if (!(dt > 0)) return;
    for (const p of this.patches) {
      const ex = p.x - x, ez = p.z - z, el = Math.hypot(ex, ez);
      if (el === 0) continue;
      const d = FOG.spread * PX * dt;
      p.x += (ex / el) * d; p.z += (ez / el) * d;
    }
  }

  /** Puts every patch at its place at once (a first frame, a jump). */
  settle(t: number, x: number, z: number, form: number, stretch: number): void {
    for (const p of this.patches) {
      const q = this.place(p, t, x, z, form, stretch);
      p.x = q[0]; p.y = q[1]; p.z = q[2];
    }
  }
}

/**
 * Writes the fog: per patch a centre vertex (alpha `FOG.alpha` times `alpha`), a ring at `FOG.mid` of the radius (`midAlpha` of it) and a rim (0),
 * `FOG.segs` segments, so `patches * segs * 3` triangles. `alpha` 0..1 over all patches, `grow` a factor on their size. Upright patches face the
 * camera (`ax`) and stay clear of the floor; flat ones lie in the floor plane.
 */
export function fogTris(T: FxTris, ax: Axes, fog: ShadeFog, t: number, alpha: number, grow: number): void {
  if (alpha <= 0) return;
  const [cr, cg, cb] = FOG.rgb, N = FOG.segs, upY = Math.abs(ax.up[1]);
  for (const p of fog.patches) {
    const size = p.size * (FOG_MOVE.sizeBase + FOG_MOVE.breathe * Math.sin(FOG_MOVE.breatheRate * t + FOG_MOVE.breathePhase * p.ph)) * grow * PX;
    const a0 = FOG.alpha[p.flat ? 0 : 1] * alpha, a1 = a0 * FOG_MOVE.midAlpha;
    const cy = p.flat ? p.y : Math.max(p.y, size * upY + FOG_MOVE.clear);
    // the two rings (the middle one and the rim), flat on the floor or in the camera's plane
    for (let i = 0; i <= N; i++) {
      const c = COS[i], s = SIN[i];
      for (let r = 0; r < 2; r++) {
        const k = (r === 0 ? FOG.mid : 1) * size, o = (r * (N + 1) + i) * 3;
        if (p.flat) { ring[o] = p.x + c * k; ring[o + 1] = cy; ring[o + 2] = p.z + s * k; }
        else {
          ring[o] = p.x + (ax.right[0] * c + ax.up[0] * s) * k;
          ring[o + 1] = cy + (ax.right[1] * c + ax.up[1] * s) * k;
          ring[o + 2] = p.z + (ax.right[2] * c + ax.up[2] * s) * k;
        }
      }
    }
    const R = (N + 1) * 3;
    for (let i = 0; i < N; i++) {
      const m0 = i * 3, m1 = m0 + 3, r0 = R + m0, r1 = r0 + 3;
      T.tri(p.x, cy, p.z, ring[m0], ring[m0 + 1], ring[m0 + 2], ring[m1], ring[m1 + 1], ring[m1 + 2], cr, cg, cb, a0, a1, a1);
      T.tri(ring[m0], ring[m0 + 1], ring[m0 + 2], ring[r0], ring[r0 + 1], ring[r0 + 2], ring[r1], ring[r1 + 1], ring[r1 + 2], cr, cg, cb, a1, 0, 0);
      T.tri(ring[m0], ring[m0 + 1], ring[m0 + 2], ring[r1], ring[r1 + 1], ring[r1 + 2], ring[m1], ring[m1 + 1], ring[m1 + 2], cr, cg, cb, a1, 0, a1);
    }
  }
}

/** The unit circle's points for the rings, and the scratch the two rings of a patch are built in (x, y, z per point). */
const COS = Array.from({ length: FOG.segs + 1 }, (_, i) => Math.cos((i / FOG.segs) * Math.PI * 2));
const SIN = Array.from({ length: FOG.segs + 1 }, (_, i) => Math.sin((i / FOG.segs) * Math.PI * 2));
const ring = new Float64Array(2 * (FOG.segs + 1) * 3);
