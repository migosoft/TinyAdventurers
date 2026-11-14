// Per-px cover height (#330): a signed distance to the cover's rim, then the spike's tapering, ragged height. Pure.
import type { CoverKind } from './kinds';

/** The spike's 3-argument integer hash, 0..1. */
const h2 = (x: number, y: number, k: number): number => {
  let n = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

/** The farthest distance the fields measure, px. */
const CAP = 16;
const DIAG = Math.SQRT2;
/** Px rows per build unit. */
const BAND = 16;

/** The two-pass chamfer fields, row by row so a builder can run them in bands. */
class DistanceField {
  /** Inside grow: distance to the nearest non-grow px (0 elsewhere). */
  readonly inside: Float32Array;
  /** Outside grow: distance to the nearest grow px (0 elsewhere). */
  readonly outside: Float32Array;
  constructor(readonly grow: Uint8Array, readonly w: number, readonly h: number, readonly cap: number) {
    this.inside = new Float32Array(w * h);
    this.outside = new Float32Array(w * h);
  }

  forward(z0: number, z1: number): void {
    const { grow, w, inside: a, outside: b, cap } = this;
    for (let z = z0; z < z1; z++) for (let x = 0; x < w; x++) {
      const i = z * w + x;
      let da: number, db: number;
      if (grow[i]) {
        da = cap; db = 0;
        // outside the image counts as non-grow
        if (x === 0 || z === 0) da = Math.min(da, 1);
        if (x > 0) da = Math.min(da, a[i - 1] + 1);
        if (z > 0) {
          da = Math.min(da, a[i - w] + 1);
          if (x > 0) da = Math.min(da, a[i - w - 1] + DIAG);
          if (x < w - 1) da = Math.min(da, a[i - w + 1] + DIAG);
        }
      } else {
        da = 0; db = cap;
        if (x > 0) db = Math.min(db, b[i - 1] + 1);
        if (z > 0) {
          db = Math.min(db, b[i - w] + 1);
          if (x > 0) db = Math.min(db, b[i - w - 1] + DIAG);
          if (x < w - 1) db = Math.min(db, b[i - w + 1] + DIAG);
        }
      }
      a[i] = da; b[i] = db;
    }
  }

  /** Rows z0..z1-1, visited from the bottom up. */
  backward(z0: number, z1: number): void {
    const { grow, w, h, inside: a, outside: b } = this;
    for (let z = z1 - 1; z >= z0; z--) for (let x = w - 1; x >= 0; x--) {
      const i = z * w + x;
      if (grow[i]) {
        let da = a[i];
        if (x === w - 1 || z === h - 1) da = Math.min(da, 1);
        if (x < w - 1) da = Math.min(da, a[i + 1] + 1);
        if (z < h - 1) {
          da = Math.min(da, a[i + w] + 1);
          if (x > 0) da = Math.min(da, a[i + w - 1] + DIAG);
          if (x < w - 1) da = Math.min(da, a[i + w + 1] + DIAG);
        }
        a[i] = da;
      } else {
        let db = b[i];
        if (x < w - 1) db = Math.min(db, b[i + 1] + 1);
        if (z < h - 1) {
          db = Math.min(db, b[i + w] + 1);
          if (x > 0) db = Math.min(db, b[i + w - 1] + DIAG);
          if (x < w - 1) db = Math.min(db, b[i + w + 1] + DIAG);
        }
        b[i] = db;
      }
    }
  }

  at(i: number): number { return this.grow[i] ? this.inside[i] : -this.outside[i]; }
}

/** Signed distance to the rim of `grow` (nonzero = cover), in px: positive inside, negative outside, clamped to +-cap. */
export function signedDistance(grow: Uint8Array, w: number, h: number, cap = CAP): Float32Array {
  const f = new DistanceField(grow, w, h, cap);
  f.forward(0, h);
  f.backward(0, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = f.at(i);
  return out;
}

/** The cover height (0 = bare) of the px (px, pz) at signed rim distance `sd`: over the first `taper` px from the rim the blades stand ever closer, and the height climbs a px every `climb` px. */
export function heightAt(sd: number, px: number, pz: number, m: CoverKind, seed: number): number {
  const edge = sd + m.creep + (h2(px >> 1, pz >> 1, seed + 1) - 0.5) * 5 * m.rough;
  const grows = edge >= 0.5 && h2(px, pz, seed + 4) < edge / m.taper;
  const h = Math.min(m.maxH - 1, 1 + Math.floor(edge / m.climb)) + (h2(px, pz, seed + 2) < 0.22 ? 1 : 0) - (h2(px, pz, seed + 3) < 0.2 ? 1 : 0);
  return grows ? Math.max(1, Math.min(m.maxH, h)) : 0;
}

/** Heights (art px) of the cover kind `m` over `grow`, 0 wherever `allow` is 0. */
export function coverHeights(grow: Uint8Array, allow: Uint8Array, w: number, h: number, m: CoverKind, seed: number): Uint8Array {
  const b = new HeightBuilder(grow, allow, w, h, m, seed);
  for (const u of b.units) u();
  return b.heights;
}

/** The same, in units of 16 px rows (forward pass bands, backward pass bands, height bands) a loader can spread over frames. */
export class HeightBuilder {
  readonly units: (() => void)[] = [];
  readonly heights: Uint8Array;
  constructor(grow: Uint8Array, readonly allow: Uint8Array, readonly w: number, readonly h: number, m: CoverKind, seed: number) {
    this.heights = new Uint8Array(w * h);
    const field = new DistanceField(grow, w, h, CAP);
    const bands = Math.ceil(h / BAND), range = (k: number): [number, number] => [k * BAND, Math.min(h, (k + 1) * BAND)];
    for (let k = 0; k < bands; k++) this.units.push(() => field.forward(...range(k)));
    for (let k = bands - 1; k >= 0; k--) this.units.push(() => field.backward(...range(k)));
    for (let k = 0; k < bands; k++) this.units.push(() => {
      const [z0, z1] = range(k);
      for (let z = z0; z < z1; z++) for (let x = 0; x < w; x++) {
        const i = z * w + x;
        if (allow[i]) this.heights[i] = heightAt(field.at(i), x, z, m, seed);
      }
    });
  }
}
