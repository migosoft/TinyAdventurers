// The skeletons of the trees. A leafy tree (round, wide, tall): the recipe's trunk (recipe.ts) with a root flare, limbs that fork twice in
// space, a leader, and a crown lobe at the branch ends. The willow: heavy limbs under curtains of hanging leaf tufts. A conifer or
// a bush: the recipe's trunk, twigs, lobes and skirts placed in depth. Pure geometry in plant-local tiles; no mesh here.
// "The picture" below is the recipe's flat frame (px, y down): the one the plant painters (game/vegetation/*) paint in.
import { type Recipe, leafyRecipe, plantRecipe, rng } from './recipe';
import { SWAY } from '../wind';
import { RAMP, type Lobe3, type P3, type SkirtOpts, type TuftPatch } from './mesh';
import type { TreeForm, TreeSpec } from './spec';

const U = 1 / 16;

/** A spot where a falling leaf may start: a crown lobe, or the end of a limb under a willow's curtains. */
export interface FallLobe { x: number; y: number; z: number; r: number; th: number; /** The sway factor at the spot. */ k: number }

export interface Skeleton {
  trunk: P3[];
  branches: { pts: P3[]; sides: number }[];
  /** Crown lobes (a core ball and tufts each); `th` is the leaf amount below which a lobe is gone. */
  lobes: (Lobe3 & { th: number })[];
  /** Root ridges, from the flare outward and down into the ground. */
  roots: P3[][];
  /** Conifer cones. */
  skirts: SkirtOpts[];
  /** A willow's hanging leaf tufts, strand by strand, top down. */
  curtain: TuftPatch[];
  /** Where leaves may fall from. */
  falls: FallLobe[];
  height: number;
  /** The most any vertex swings, tiles (0 for a dead plant). */
  amp: number;
  trunkSides: number;
  rootSides: number;
  /** The bark's standing shade on the trunk's top. */
  trunkShaded: boolean;
  /** Light lift of the crown lobes. */
  lift: number;
}

/** The sway factor (tiles) of a point at height `y` of a plant `height` tall whose top swings `amp`. */
export const swayK = (amp: number, y: number, height: number): number => amp * (Math.max(0, y) / height) ** 2;

/** How far the top of a plant of this form swings; a dead plant does not sway, except a bush: its brush factor stays (the wind is zeroed in the shader). */
function ampOf(form: TreeForm, dead: boolean): number {
  if (dead && form !== 'bush') return 0;
  return form === 'conifer' ? SWAY.conifer : form === 'bush' ? SWAY.small : SWAY.leafy;
}

/** Every `step`-th point of a stroke, the last one always. */
function thin<T>(pts: T[], step: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
  if ((pts.length - 1) % step !== 0) out.push(pts[pts.length - 1]);
  return out;
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
  const rc = plantRecipe(form, spec.seed, spec.scalePct);
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
  for (const b of lobes) b.k = swayK(ampOf(form, spec.dead), b.y, height);
  return {
    trunk, branches, lobes, roots, skirts: [], curtain: [], height, amp: ampOf(form, spec.dead), trunkSides: 10, rootSides: 5, trunkShaded: true, lift: 0,
    falls: spec.dead ? [] : lobes.map((b) => ({ x: b.x, y: b.y, z: b.z, r: b.rx, th: b.th, k: b.k })),
  };
}

/** The generator's roots laid on the ground (picture-down is toward the viewer), and one more to the back for the first and last. */
function layRoots(rc: Recipe, X: (x: number) => number, minW: number): P3[][] {
  const out: P3[][] = [];
  rc.roots.forEach((src, ri) => {
    const lay = (flip: boolean): P3[] => src.map((p) => {
      const dx = X(p.x) * 0.65, dz = (p.y - rc.foot.y) * U * 1.6, w = Math.max(minW, p.w * U * 0.8);
      return flip ? { x: dx * 0.45, y: 0, z: -Math.abs(dx) * 0.8 - dz * 0.3, w } : { x: dx, y: 0, z: dz, w };
    });
    out.push(thin(lay(false), 3));
    if (ri === 0 || ri === rc.roots.length - 1) out.push(thin(lay(true), 3));
  });
  return out;
}

/** How much further a willow strand swings at its tip than at its root, tiles. */
const CURTAIN_SWING = 0.2; // first guess
/** A willow leaf's own shift: warmer and lighter than the other trees', a yellow-green. */
/** The willow leaves' own shift on top of the plant's colour: warmer by `warm`, lighter by `bright`. */
export const WILLOW_SHIFT = { warm: 0.09, bright: 0.08 };

/**
 * A weeping willow: the generator's old, thick, bent trunk; a few heavy limbs that go up and out and fork; and the crown is
 * the curtains themselves: dense strands (chains of small leaf tufts) that start all along the limbs, from the very top,
 * arch outward a little and hang down in overlapping tiers. Strands at the outside reach nearly to the ground, those near the
 * trunk end higher, so the trunk shows under the middle; one sector of the curtain is parted toward the camera. A strand swings
 * more the further down it hangs and carries a leaf amount like a leafy tree's lobes. There are no leaf lobes.
 * All numbers are first guesses (the look was judged as it is).
 */
export function growWillow(spec: TreeSpec): Skeleton {
  const rc = leafyRecipe({ seed: spec.seed, scale: spec.scalePct / 100, shape: 'wide', old: true });
  const r = rng((spec.seed * 15485863 + 5) >>> 0), du = rc.s * U;
  const X = (x: number) => (x - rc.foot.x) * U, Y = (y: number) => (rc.foot.y - y) * U, minW = 0.6 * U;
  const bz = (r() - 0.5) * 6 * du, nT = rc.trunk.length;
  const full: P3[] = rc.trunk.map((p, i) => ({ x: X(p.x), y: Y(p.y), z: bz * Math.sin((Math.PI * i) / Math.max(1, nT - 1)), w: Math.max(minW, p.w * U) }));
  const fork = full[nT - 1];
  const norm = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const branches: Skeleton['branches'] = [], hangs: { x: number; y: number; z: number; th: number }[] = [], ends: FallLobe[] = [];
  const limb = (start: P3, dir0: number[], len: number, w0: number, depth: number): void => {
    let d = dir0, p = start, minTh = 1;
    const n = 8, pts: P3[] = [{ ...start, w: w0 }];
    for (let i = 1; i <= n; i++) {
      d = norm([d[0] + (r() - 0.5) * 0.22, d[1] - (i <= 3 ? 0.02 : 0.1), d[2] + (r() - 0.5) * 0.22]); // gnarled; goes up and out, only its end levels off
      p = { x: p.x + d[0] * (len / n), y: p.y + d[1] * (len / n), z: p.z + d[2] * (len / n), w: Math.max(minW, w0 * (1 - 0.6 * (i / n))) };
      pts.push(p);
      if (i >= (depth === 0 ? 3 : 2)) for (let k = 0; k < 9; k++) {
        const h = { x: p.x + (r() - 0.5) * 11 * du, y: p.y + (1 + r() * 3) * du, z: p.z + (r() - 0.5) * 11 * du, th: 0.1 + r() * 0.9 };
        hangs.push(h);
        minTh = Math.min(minTh, h.th);
      }
    }
    branches.push({ pts, sides: w0 > 1.5 * U ? 6 : 4 });
    ends.push({ x: p.x, y: p.y, z: p.z, r: 9 * du, th: minTh, k: 0 });
    if (depth === 0) for (const sg of [-1, 1]) {
      const from = pts[sg < 0 ? 3 : 4], a = sg * (0.55 + r() * 0.4), c = Math.cos(a), sn = Math.sin(a);
      limb(from, norm([dir0[0] * c - dir0[2] * sn, 0.5, dir0[0] * sn + dir0[2] * c]), len * 0.66, from.w * 0.75, 1);
    }
  };
  const limbs = 4 + Math.floor(r() * 2), az0 = r() * Math.PI * 2;
  for (let i = 0; i < limbs; i++) {
    const az = az0 + (i / limbs) * Math.PI * 2 + (r() - 0.5) * 0.5, tilt = 0.6 + r() * 0.3;
    limb(fork, [Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt)], (30 + (r() - 0.5) * 6) * du, fork.w * 0.62, 0);
  }
  limb(fork, norm([(r() - 0.5) * 0.4, 1, (r() - 0.5) * 0.4]), 15 * du, fork.w * 0.5, 1); // a short leader: the top of the mop

  let top = fork.y, R = 0;
  for (const b of branches) for (const p of b.pts) top = Math.max(top, p.y);
  for (const h of hangs) R = Math.max(R, Math.hypot(h.x - fork.x, h.z - fork.z));
  const height = Math.max(top + 2 * du, 0.5), amp = ampOf('willow', spec.dead), swing = spec.dead ? 0 : CURTAIN_SWING;
  for (const e of ends) e.k = swayK(amp, e.y, height);

  // the curtains
  const curtain: TuftPatch[] = [];
  const gapAz = Math.PI / 2 + (r() - 0.5) * 1.2, gapW = 0.4, step = 1.7 * U; // the parted sector faces roughly south, toward the game's camera
  for (const h of hangs) {
    let ox = h.x - fork.x, oz = h.z - fork.z;
    const ol = Math.hypot(ox, oz);
    if (ol < 1.5 * du) { const a = r() * Math.PI * 2; ox = Math.cos(a); oz = Math.sin(a); } else { ox /= ol; oz /= ol; }
    const q = Math.min(1, ol / R), reach = (4 + r() * 6 + 4 * q) * du, arc = (8 + r() * 5) * du;
    const s = Math.min(1, Math.max(0, (q - 0.25) / 0.5)), ss = s * s * (3 - 2 * s);
    let end = fork.y * 0.85 * (1 - ss) + 3 * du * ss + r() * 7 * du; // outside nearly to the ground, near the trunk only to the fork
    if (r() < 0.2) end += (6 + r() * 10) * du; // a ragged rim
    let da = Math.abs(Math.atan2(oz, ox) - gapAz);
    if (da > Math.PI) da = 2 * Math.PI - da;
    if (da < gapW && q > 0.35) end = Math.max(end, fork.y * (0.75 + r() * 0.4));
    const n = Math.floor((h.y - end) / step);
    if (n < 3) continue;
    const k0 = swayK(amp, h.y, height), wob = r() * 6, tone = (r() - 0.5) * 0.5; // strands differ in tone, so the curtain reads as streaks
    for (let j = 0; j < n; j++) {
      const t = j / n, uu = Math.min(1, (j * step) / arc), out = reach * (1 - (1 - uu) * (1 - uu));
      const px = h.x + ox * out + Math.sin(j * 0.9 + wob) * 0.6 * U, py = h.y - j * step, pz = h.z + oz * out + Math.cos(j * 0.7 + wob) * 0.6 * U;
      const size = (1.15 + r() * 0.5 - 0.3 * t) * U, seed = Math.floor(r() * 997);
      curtain.push({
        p: [px, py, pz],
        n: [ox * (0.3 + 0.6 * t), 0.9 - 0.6 * t, oz * (0.3 + 0.6 * t)], // the top of a strand faces the sky, its length faces outward
        grad: [ox * 0.5 * q, 0.2, oz * 0.5 * q, 0.5 + tone * 2.8 - 0.5 * t - 0.5 * (1 - q)], // brighter at the top and outside, darker inside and below
        sway: [k0 + swing * t * t, py], // a strand swings more the further down it hangs
        ramp: RAMP.leaf, shift: [WILLOW_SHIFT.warm, WILLOW_SHIFT.bright],
        noShadow: t > 0.25 && j % 2 === 1, // a curtain lets light through: below its top, every other tuft casts no shadow
        th: h.th, size, seed,
      });
    }
  }
  return {
    trunk: thin(full, Math.max(1, Math.floor(nT / 12))), branches, lobes: [], roots: layRoots(rc, X, minW), skirts: [], curtain, falls: spec.dead ? [] : ends,
    height, amp: amp + swing, trunkSides: 10, rootSides: 6, trunkShaded: true, lift: 0,
  };
}

/** A conifer or a bush from the recipe: its trunk and twigs bent a little in depth, its lobes spread around the crown, its skirts as cones. */
export function growPlant(spec: TreeSpec): Skeleton {
  const form = spec.form;
  if (form !== 'conifer' && form !== 'bush') throw new Error(`trees: ${form} is not a conifer or a bush`);
  const bush = form === 'bush', rc = plantRecipe(form, spec.seed, spec.scalePct);
  const r = rng((spec.seed * 7919 + 13) >>> 0), du = rc.s * U, amp = ampOf(form, spec.dead);
  const X = (x: number) => (x - rc.foot.x) * U, Y = (y: number) => (rc.foot.y - y) * U, minW = 0.6 * U;
  const picLobes = rc.lobes ?? [], picSkirts = rc.skirts ?? [], picLimbs = rc.limbs ?? [];
  let top = 0;
  for (const b of picLobes) top = Math.max(top, Y(b.y - b.ry));
  for (const s of picSkirts) top = Math.max(top, Y(s.yTop));
  for (const l of picLimbs) for (const p of l) top = Math.max(top, Y(p.y));
  for (const p of rc.trunk) top = Math.max(top, Y(p.y));

  // ---- trunk: the picture's path, bent a little in depth as well
  const bz = (r() - 0.5) * 4 * du, nT = rc.trunk.length;
  const trunk: P3[] = rc.trunk.map((p, i) => ({ x: X(p.x), y: Y(p.y), z: bz * Math.sin((Math.PI * i) / Math.max(1, nT - 1)), w: Math.max(minW, p.w * U) }));
  const fork = trunk[nT - 1];

  // ---- twigs: the picture's, spread in depth from the fork
  const branches: Skeleton['branches'] = picLimbs.map((src) => {
    const zEnd = (r() - 0.5) * 6 * du;
    const out: P3[] = src.map((p, i) => { const t = i / Math.max(1, src.length - 1); return { x: X(p.x), y: Y(p.y), z: fork.z + zEnd * t * t, w: Math.max(minW, p.w * U) }; });
    return { pts: thin(out, Math.max(1, Math.floor(out.length / 6))), sides: 6 };
  });

  // ---- crown lobes: the picture's, placed in depth, plus one in front or behind for every side lobe so the crown is round from above
  const lobes: Skeleton['lobes'] = [];
  if (picLobes.length) {
    let x0 = Infinity, x1 = -Infinity;
    for (const b of picLobes) { x0 = Math.min(x0, X(b.x) - b.rx * U); x1 = Math.max(x1, X(b.x) + b.rx * U); }
    const ccx = (x0 + x1) / 2;
    for (const b of picLobes) {
      const x = X(b.x), y = Y(b.y), rx = b.rx * U, ry = b.ry * U, dx = x - ccx;
      if (Math.abs(dx) < 0.45 * rx) { lobes.push({ x, y, z: (r() - 0.5) * 0.3 * rx, rx, ry, rz: rx, k: 0, th: 0 }); continue; }
      lobes.push({ x, y, z: (r() - 0.5) * 0.8 * rx, rx, ry, rz: rx, k: 0, th: 0 });
      const ez = (dx < 0 ? 1 : -1) * Math.abs(dx) * 0.6;
      lobes.push({ x: ccx + (r() - 0.5) * 0.5 * rx, y: y + (r() - 0.5) * 0.3 * ry + Math.max(0, ez) * 0.45, z: ez, rx, ry, rz: rx, k: 0, th: 0 });
    }
  }
  for (const b of lobes) top = Math.max(top, b.y + b.ry * 1.08);
  const height = Math.max(top, 0.5);
  for (const b of lobes) b.k = swayK(amp, b.y, height);

  // ---- conifer skirts: cones with a zigzag hem
  const skirts: SkirtOpts[] = picSkirts.map((s, si) => {
    const t = picSkirts.length > 2 ? Math.min(1, si / (picSkirts.length - 2)) : 1, anchor = Math.max(0, Y(s.yTop) - s.h * U);
    return {
      radius: s.W * U, top: Y(s.yTop), height: s.h * U, jag: 3.2 * du, droop: 2.6 * du, k: swayK(amp, anchor, height), anchor,
      dark: 0.05 - 0.3 * (1 - t), teeth: Math.max(5, Math.min(18, Math.round((2 * Math.PI * s.W) / 5.5))),
    };
  });
  return {
    trunk: thin(trunk, Math.max(1, Math.floor(nT / 12))), branches, lobes, roots: layRoots(rc, X, minW), skirts, curtain: [], height, amp,
    trunkSides: bush ? 5 : 10, rootSides: 6, trunkShaded: !bush, lift: bush ? 0.3 : 0,
    falls: lobes.map((b) => ({ x: b.x, y: b.y, z: b.z, r: b.rx, th: 0, k: b.k })),
  };
}
