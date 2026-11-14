// The skeleton of a leafy tree (round, wide, tall): the 2D generator's trunk with a root flare, limbs that fork twice in
// space, a leader, and a crown lobe at the branch ends. Pure geometry in plant-local tiles; no mesh here.
import { rng } from '../../game/vegetation/canvas';
import { drawPlant } from '../../game/vegetation';
import { SWAY } from '../wind';
import type { Lobe3, P3 } from './mesh';
import type { TreeSpec } from './spec';

const U = 1 / 16;

export interface Skeleton {
  trunk: P3[];
  branches: { pts: P3[]; sides: number }[];
  /** Crown lobes; `th` is the leaf amount below which a lobe is gone. */
  lobes: (Lobe3 & { th: number })[];
  /** Root ridges, from the flare outward and down into the ground. */
  roots: P3[][];
  height: number;
}

/** The branching table, per form. Lengths and radii in design units (16 per tile at scale 100). */
interface Table {
  limbs: number;
  /** Tilt of a limb from the vertical, radians. */
  tilt: [number, number];
  /** Length of a limb, and of the leader. */
  len: number;
  lead: number;
  /** Where along the leader the limbs leave it, as shares of its length. */
  start: [number, number];
  /** How far a fork's children spread from the parent's direction, radians. */
  spread: number;
  /** How much each step of a limb turns toward the sky. */
  up: number;
  /** A child limb is this much shorter than its parent. */
  taper: number;
  /** Lobe radii at the branch ends and where the leader forks. */
  outer: number;
  inner: number;
}
const TABLE: Record<'round' | 'wide' | 'tall', Table> = { // first guess
  round: { limbs: 4, tilt: [0.15, 1.1], len: 9, lead: 24, start: [0, 0.3], spread: 0.5, up: 0.08, taper: 0.7, outer: 6.5, inner: 6.5 },
  wide: { limbs: 4, tilt: [0.8, 1.2], len: 9.5, lead: 8, start: [0, 0.2], spread: 0.55, up: 0.04, taper: 0.7, outer: 6.5, inner: 6.5 },
  tall: { limbs: 4, tilt: [0.3, 0.6], len: 10, lead: 34, start: [0, 0.75], spread: 0.4, up: 0.1, taper: 0.7, outer: 4, inner: 4.5 },
};

/** Lobes overlap, so one more lobe adds less than its share: the share of lobes still there at leaf amount a is a^LEAF_CURVE. */
const LEAF_CURVE = 2.1; // first guess
/** Root flare: the trunk's radius grows by up to FLARE at the foot, over FLARE_H tiles. */
const FLARE = 0.35; // first guess
const FLARE_H = 0.55; // first guess

type V = [number, number, number];
const norm = (v: V): V => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

interface Rec { lobe: Lobe3; inner: boolean; key: number }

export function growLeafy(spec: TreeSpec): Skeleton {
  const form = spec.form;
  if (form !== 'round' && form !== 'wide' && form !== 'tall') throw new Error(`trees: ${form} is not a leafy tree`);
  const tb = TABLE[form];
  const rc = drawPlant(form, spec.seed, spec.scalePct).recipe;
  if (!rc) throw new Error('trees: the generator returned no recipe');
  const r = rng((spec.seed * 104729 + 71) >>> 0), du = rc.s * U, minW = 0.6 * U;
  const X = (x: number) => (x - rc.foot.x) * U, Y = (y: number) => (rc.foot.y - y) * U;

  // ---- trunk: the picture's path, bent a little in depth, with a flare at the foot
  const bz = (r() - 0.5) * 4 * du, nT = rc.trunk.length;
  const seg = rc.trunk.map((p, i) => ({ x: X(p.x), y: Y(p.y), z: bz * Math.sin((Math.PI * i) / Math.max(1, nT - 1)), w: Math.max(minW, p.w * U) }));
  const trunk: P3[] = [];
  for (const t of [0, 0.02, 0.05, 0.1, 0.16, 0.24, 0.35, 0.5, 0.65, 0.8, 0.9, 1]) {
    const f = t * (nT - 1), i = Math.min(nT - 2, Math.floor(f)), k = f - i, a = seg[i], b = seg[i + 1];
    const y = a.y + (b.y - a.y) * k, flare = 1 + FLARE * Math.max(0, 1 - y / FLARE_H) ** 2;
    trunk.push({ x: a.x + (b.x - a.x) * k, y, z: a.z + (b.z - a.z) * k, w: (a.w + (b.w - a.w) * k) * flare });
  }
  const fork = trunk[trunk.length - 1];

  // ---- limbs
  const branches: Skeleton['branches'] = [], recs: Rec[] = [];
  const lobeAt = (p: P3, rad: number, inner: boolean, key: number) =>
    recs.push({ lobe: { x: p.x, y: p.y, z: p.z, rx: rad * du, ry: rad * du * 0.86, rz: rad * du, k: 0 }, inner, key });
  const grow = (start: P3, dir0: V, len: number, w0: number, depth: number, band: number, sub: number, twig: boolean): P3[] => {
    let d = dir0, p = start;
    const n = 6, pts: P3[] = [{ ...start, w: w0 }];
    for (let i = 1; i <= n; i++) {
      d = norm([d[0] + (r() - 0.5) * 0.12, d[1] + tb.up, d[2] + (r() - 0.5) * 0.12]);
      p = { x: p.x + d[0] * (len / n), y: p.y + d[1] * (len / n), z: p.z + d[2] * (len / n), w: Math.max(minW, w0 * (1 - 0.32 * (i / n))) };
      pts.push(p);
    }
    branches.push({ pts, sides: w0 > 1.5 * U ? 6 : 4 });
    if (twig) return pts;
    // a branch's lobes share its band, so whole branches go together as the leaf amount falls
    // the lobe where the leader forks is the inner one, the last to go; the leader's other lobes go with a random branch
    const lead = band === tb.limbs;
    if (depth >= 2) { lobeAt(p, tb.outer + r() * 1.5, false, (lead ? Math.floor(r() * tb.limbs) : band) + sub * 0.12 + r() * 0.1); return pts; }
    if (depth === 1 && lead) lobeAt(p, tb.inner + r() * 1.5, true, r());
    const kids = r() < (depth === 0 ? 0.5 : 0.3) ? 3 : 2;
    const axis = norm([r() - 0.5, r() - 0.5, r() - 0.5]), side = norm(cross(d, axis));
    for (let k = 0; k < kids; k++) {
      const mid = kids === 3 && k === 1, sp = mid ? (r() - 0.5) * 0.3 : (k === 0 ? -1 : 1) * (tb.spread * (0.75 + r() * 0.5)), q = mid ? norm(axis) : side;
      grow(p, norm([d[0] * Math.cos(sp) + q[0] * Math.sin(sp), d[1] * Math.cos(sp) + q[1] * Math.sin(sp), d[2] * Math.cos(sp) + q[2] * Math.sin(sp)]),
        len * (tb.taper + r() * 0.1), p.w, depth + 1, band, sub * 2 + k, false);
    }
    if (depth >= 1 && r() < 0.35) {
      const at = pts[2 + Math.floor(r() * 3)], sg = r() < 0.5 ? -1 : 1;
      grow(at, norm([d[0] + side[0] * sg * 0.8, d[1], d[2] + side[2] * sg * 0.8]), len * 0.4, w0 * 0.45, 2, band, 0, true);
    }
    return pts;
  };
  // the leader carries the top of the crown; the limbs leave it at different heights
  const lead = grow(fork, norm([(r() - 0.5) * 0.25, 1, (r() - 0.5) * 0.25]), tb.lead * du, fork.w * 0.7, 1, tb.limbs, 0, false);
  const shuffled = () => {
    const a = Array.from({ length: tb.limbs }, (_, i) => i);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const order = shuffled(), tilts = shuffled(), heights = shuffled(), az0 = r() * Math.PI * 2;
  const share = (rank: number) => (rank + r() * 0.5) / (tb.limbs - 0.5);
  for (let i = 0; i < tb.limbs; i++) {
    const az = az0 + (i / tb.limbs) * Math.PI * 2 + (r() - 0.5) * 0.5, tilt = tb.tilt[0] + (tb.tilt[1] - tb.tilt[0]) * share(tilts[i]);
    const f = tb.start[0] + (tb.start[1] - tb.start[0]) * share(heights[i]), at = lead[Math.min(lead.length - 1, Math.round(f * (lead.length - 1)))];
    grow(at, [Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt)], (tb.len + (r() - 0.5) * 3) * du * (1 - 0.35 * f), at.w * 0.9, 0, order[i], 0, false);
  }

  // ---- root ridges: short tubes from the flare outward that sink into the ground
  const count = 3 + (spec.seed % 3), foot = trunk[0], roots: P3[][] = [];
  const a0 = r() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = a0 + (i / count) * Math.PI * 2 + (r() - 0.5) * 0.5, r0 = foot.w * 0.55;
    const len = Math.min(1.1 - r0, (0.45 + r() * 0.35) * Math.max(0.7, du * 16)); // the tip stays within 1.2 tiles of the foot
    const c = Math.cos(a), s = Math.sin(a), w = foot.w * (0.3 + r() * 0.1);
    const pts: P3[] = [];
    for (let k = 0; k <= 3; k++) {
      const t = k / 3;
      pts.push({ x: foot.x + c * (r0 + len * t), y: 0.3 * (1 - t) ** 1.5 - 0.06 * t, z: foot.z + s * (r0 + len * t), w: Math.max(minW, w * (1 - 0.7 * t)) });
    }
    roots.push(pts);
  }

  // ---- thresholds: inner lobes (and the leader's) are the last to go; the outer ones go first, a branch at a time.
  // The k-th of N lobes in that order is gone below (k / N)^(1 / LEAF_CURVE).
  const order2 = [...recs.filter((q) => q.inner).sort((a, b) => a.key - b.key), ...recs.filter((q) => !q.inner).sort((a, b) => b.key - a.key)];
  const lobes: Skeleton['lobes'] = order2.map((q, i) => ({ ...q.lobe, th: ((i + 1) / order2.length) ** (1 / LEAF_CURVE) }));

  let top = fork.y;
  for (const b of branches) for (const p of b.pts) top = Math.max(top, p.y);
  for (const b of lobes) top = Math.max(top, b.y + b.ry * 1.08);
  const height = Math.max(top, 0.5);
  for (const b of lobes) b.k = SWAY.leafy * (Math.max(0, b.y) / height) ** 2;
  return { trunk, branches, lobes, roots, height };
}
