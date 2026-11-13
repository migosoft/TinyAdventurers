// Proof of concept (spike/3d-trees): turns the vegetation generator's recipe into one 3D mesh.
// Pure: no three.js, no DOM. World units are tiles (16 art px), x east, y up, z south.
import { drawPlant, drawTree, type PlantKind } from '../../game/vegetation';
import { rng, type Drawn, type Recipe } from '../../game/vegetation/canvas';

const U = 1 / 16;
/** The mesh sphere of a lobe is this much larger than the lobe; the fragment stage cuts the scalloped outline out of it. */
export const LOBE_PAD = 1.16;
/** Palette rows. */
export const RAMP = { leaf: 0, conifer: 1, bark: 2, dead: 3 } as const;
/** Sway amplitude in tiles at the top of the plant, as in the #300 design. */
const AMP: Record<Recipe['kind'], number> = { leafy: 0.11, conifer: 0.07, bush: 0.05, bare: 0.05 };

export interface PlantSpec { kind: PlantKind; seed: number; scalePct: number; x: number; z: number; /** spike/3d-willow: build this plant as a willow. */ willow?: boolean }
/** A crown lobe in the world: centre and radii in tiles, and the phases of its outline. */
export interface Lobe3 { x: number; y: number; z: number; rx: number; ry: number; rz: number; ph: number; ph2: number; k: number }
export interface Plant3 {
  spec: PlantSpec; drawn: Drawn; lobes: Lobe3[]; height: number; amp: number;
  /** The bare trunk as the card version casts it: half-width and top, in tiles. */
  trunkHalf: number; trunkTop: number;
}

/** Vertex streams of the merged mesh; `sway` = foot x, foot z, sway factor, anchor height; `part` = ramp, shape (0 lobe, 1 plain, 2 skirt, 3 leaf tuft), phases; `misc` = light lift, hem or shade, edge width, trunk flag (wood) or the leaf amount below which a lobe is gone (leaves). */
export class MeshData {
  pos: number[] = []; nrm: number[] = []; grad: number[] = []; sway: number[] = []; part: number[] = []; misc: number[] = []; idx: number[] = [];
  /** Leaf tufts: corner (-1..1), half-size in tiles, seed; zeros on everything else. */
  tuft: number[] = [];
  get verts() { return this.pos.length / 3; }
  get tris() { return this.idx.length / 3; }
}

// ---- unit icosphere: two subdivisions (162 vertices, 320 triangles) for a visible lobe, one (42, 80) for a core under leaf tufts
const ico = (subs: number) => {
  const t = (1 + Math.sqrt(5)) / 2;
  let v: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let f: number[][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const unit = (p: number[]) => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; };
  v = v.map(unit);
  for (let s = 0; s < subs; s++) {
    const mid = new Map<string, number>(), nf: number[][] = [];
    const m = (a: number, b: number) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let i = mid.get(key);
      if (i === undefined) { i = v.length; v.push(unit([v[a][0] + v[b][0], v[a][1] + v[b][1], v[a][2] + v[b][2]])); mid.set(key, i); }
      return i;
    };
    for (const [a, b, c] of f) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  return { v, f };
};
const ICO = ico(2), ICO_CORE = ico(1);

interface P3 { x: number; y: number; z: number; w: number }

function lobe(m: MeshData, foot: { x: number; z: number }, b: Lobe3, ramp: number, grad: (x: number, y: number, z: number) => [number, number, number, number], lift: number, edge: number, th = 0, ball = ICO): void {
  const base = m.verts;
  for (const d of ball.v) {
    m.pos.push(foot.x + b.x + d[0] * b.rx * LOBE_PAD, b.y + d[1] * b.ry * LOBE_PAD, foot.z + b.z + d[2] * b.rz * LOBE_PAD);
    m.nrm.push(d[0], d[1], d[2]);
    m.grad.push(...grad(b.x + d[0] * b.rx, b.y + d[1] * b.ry, b.z + d[2] * b.rz));
    m.sway.push(foot.x, foot.z, b.k, b.y);
    m.part.push(ramp, 0, b.ph, b.ph2);
    m.misc.push(lift, 0, edge, th);
    m.tuft.push(0, 0, 0, 0);
  }
  for (const [a, c, e] of ball.f) m.idx.push(base + a, base + c, base + e);
}

/**
 * A lobe as leaf tufts: a smaller core ball, and on the lobe's surface small camera-facing patches (shape 3) spread evenly
 * (a Fibonacci sphere, jittered). Each patch carries the ball's direction at its centre, so the lobe still shades as a round form.
 */
function tuftLobe(m: MeshData, foot: { x: number; z: number }, b: Lobe3, grad: (x: number, y: number, z: number) => [number, number, number, number], lift: number, r: () => number, th = 0, ramp: number = RAMP.leaf): void {
  lobe(m, foot, { ...b, rx: b.rx * 0.74, ry: b.ry * 0.74, rz: b.rz * 0.74 }, ramp, grad, lift, 0, th, ICO_CORE);
  const rpx = b.rx / U, n = Math.max(14, Math.min(64, Math.round((rpx * rpx) / 3.2)));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, rad = Math.sqrt(1 - y * y), a = i * 2.39996 + (r() - 0.5) * 0.5;
    const d = [Math.cos(a) * rad, y, Math.sin(a) * rad], out = 0.92 + r() * 0.16, size = (3.2 + r() * 2.2) * U, seed = Math.floor(r() * 997);
    const px = b.x + d[0] * b.rx * out, py = b.y + d[1] * b.ry * out, pz = b.z + d[2] * b.rz * out, base = m.verts;
    for (const [ox, oy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      m.pos.push(foot.x + px, py, foot.z + pz);
      m.nrm.push(d[0], d[1], d[2]);
      m.grad.push(...grad(px, py, pz));
      m.sway.push(foot.x, foot.z, b.k, b.y);
      m.part.push(ramp, 3, 0, 0);
      m.misc.push(lift, 0, 0, th);
      m.tuft.push(ox, oy, size, seed);
    }
    m.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** A tube of `sides` along `pts` (plant space, tiles); `kOf` gives the sway factor at a height, `shade` the bark's standing shade (0..1). */
function tube(m: MeshData, foot: { x: number; z: number }, pts: P3[], sides: number, ramp: number, kOf: (y: number) => number, shade: (i: number) => number, trunk: number): void {
  if (pts.length < 2) return;
  const base = m.verts, n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], p = pts[i];
    let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    // b1 = t x z-axis (or the x-axis when the path runs along z), b2 = t x b1
    let b1x = ty, b1y = -tx, b1z = 0; let l = Math.hypot(b1x, b1y);
    if (l < 1e-4) { b1x = 1; b1y = 0; b1z = 0; l = 1; }
    b1x /= l; b1y /= l;
    const b2x = ty * b1z - tz * b1y, b2y = tz * b1x - tx * b1z, b2z = tx * b1y - ty * b1x;
    for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2, c = Math.cos(ang), sn = Math.sin(ang);
      const nx = b1x * c + b2x * sn, ny = b1y * c + b2y * sn, nz = b1z * c + b2z * sn;
      const y = p.y + ny * p.w;
      m.pos.push(foot.x + p.x + nx * p.w, y, foot.z + p.z + nz * p.w);
      m.nrm.push(nx, ny, nz);
      m.grad.push(0, 0, 0, 0);
      m.sway.push(foot.x, foot.z, kOf(Math.max(0, p.y)), Math.max(0, y));
      m.part.push(ramp, 1, 0, 0);
      m.misc.push(0, shade(i), 0, trunk);
      m.tuft.push(0, 0, 0, 0);
    }
  }
  for (let i = 0; i + 1 < n; i++) for (let s = 0; s < sides; s++) {
    const a = base + i * sides + s, b = base + i * sides + ((s + 1) % sides), c = a + sides, d = b + sides;
    m.idx.push(a, c, b, b, c, d);
  }
}

/** Every `step`-th point of a stroke, the last one always. */
function thin<T>(pts: T[], step: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[i]);
  if ((pts.length - 1) % step !== 0) out.push(pts[pts.length - 1]);
  return out;
}

/** Builds one plant into `m` and returns what the page needs of it. */
export function buildPlant(m: MeshData, spec: PlantSpec, tufts = false): Plant3 {
  const drawn = drawPlant(spec.kind, spec.seed, spec.scalePct);
  const rc = drawn.recipe;
  if (!rc) throw new Error('trees: the generator returned no recipe');
  const foot = { x: spec.x, z: spec.z }, r3 = rng((spec.seed * 7919 + 13) >>> 0);
  const X = (x: number) => (x - rc.foot.x) * U, Y = (y: number) => (rc.foot.y - y) * U;
  const amp = AMP[rc.kind];
  let top = 0;
  for (const b of rc.lobes) top = Math.max(top, Y(b.y - b.ry));
  for (const s of rc.skirts) top = Math.max(top, Y(s.yTop));
  for (const l of rc.limbs) for (const p of l) top = Math.max(top, Y(p.y));
  for (const p of rc.trunk) top = Math.max(top, Y(p.y));
  const height = Math.max(top, 0.5), kOf = (y: number) => amp * (y / height) ** 2;
  const wood = rc.kind === 'bare' ? RAMP.dead : RAMP.bark;
  const minW = 0.6 * U;

  // ---- trunk: the picture's path, bent a little in depth as well
  const bz = (r3() - 0.5) * 4 * rc.s * U, nT = rc.trunk.length;
  const trunkZ = (i: number) => bz * Math.sin((Math.PI * i) / Math.max(1, nT - 1));
  const trunk: P3[] = rc.trunk.map((p, i) => ({ x: X(p.x), y: Y(p.y), z: trunkZ(i), w: Math.max(minW, p.w * U) }));
  const tPts = thin(trunk, Math.max(1, Math.floor(nT / 12)));
  tube(m, foot, tPts, rc.kind === 'bush' ? 5 : 10, wood, kOf, (i) => (rc.kind === 'leafy' || rc.kind === 'conifer') && i >= tPts.length - 3 ? 1 : 0, 1);
  const fork = trunk[nT - 1];

  // ---- limbs
  if (rc.kind === 'bare') {
    // The picture's limbs are flat; each one is turned about the vertical through its start, children on top of their parent's turn.
    const done: { src: Recipe['limbs'][number]; out: P3[]; az: number }[] = [];
    for (const src of rc.limbs) {
      // a child starts one step past its parent's last point, a side twig on one of its points: take the nearest earlier point
      let start: P3 = fork, az = 0, best = 2.5;
      for (const d of done) d.src.forEach((q, k) => {
        const dist = Math.hypot(q.x - src[0].x, q.y - src[0].y);
        if (dist < best) { best = dist; start = d.out[k]; az = d.az + (r3() - 0.5) * 2.6; }
      });
      const c = Math.cos(az), s = Math.sin(az);
      const out: P3[] = src.map((p) => { const dx = (p.x - src[0].x) * U; return { x: start.x + dx * c, y: start.y + (src[0].y - p.y) * U, z: start.z + dx * s, w: Math.max(minW, p.w * U) }; });
      done.push({ src, out, az });
      tube(m, foot, thin(out, Math.max(1, Math.floor(out.length / 6))), out[0].w > 1.5 * U ? 6 : 4, wood, kOf, () => 0, 0);
    }
  } else {
    rc.limbs.forEach((src, li) => {
      const zEnd = rc.kind === 'bush' ? (r3() - 0.5) * 6 * rc.s * U : (li === 2 ? (r3() < 0.5 ? -1 : 1) : r3() - 0.5) * 9 * rc.s * U;
      const out: P3[] = src.map((p, i) => { const t = i / Math.max(1, src.length - 1); return { x: X(p.x), y: Y(p.y), z: fork.z + zEnd * t * t, w: Math.max(minW, p.w * U) }; });
      tube(m, foot, thin(out, Math.max(1, Math.floor(out.length / 6))), 6, wood, kOf, () => 1, 0);
    });
  }

  // ---- roots: the picture's roots laid on the ground (picture-down is toward the viewer), one more to the back
  rc.roots.forEach((src, ri) => {
    const lay = (flip: boolean): P3[] => src.map((p) => {
      const dx = X(p.x) * 0.65, dz = (p.y - rc.foot.y) * U * 1.6, w = Math.max(minW, p.w * U * 0.8);
      return flip ? { x: dx * 0.45, y: 0, z: -Math.abs(dx) * 0.8 - dz * 0.3, w } : { x: dx, y: 0, z: dz, w };
    });
    tube(m, foot, thin(lay(false), 3), 6, wood, () => 0, () => 1, 0);
    if (ri === 0 || ri === rc.roots.length - 1) tube(m, foot, thin(lay(true), 3), 6, wood, () => 0, () => 1, 0);
  });

  // ---- crown lobes: the picture's lobes, placed in depth, plus one in front or behind for every side lobe so the crown is round from above
  const lobes: Lobe3[] = [];
  if (rc.lobes.length) {
    let x0 = Infinity, x1 = -Infinity;
    for (const b of rc.lobes) { x0 = Math.min(x0, X(b.x) - b.rx * U); x1 = Math.max(x1, X(b.x) + b.rx * U); }
    const ccx = (x0 + x1) / 2;
    for (const b of rc.lobes) {
      const x = X(b.x), y = Y(b.y), rx = b.rx * U, ry = b.ry * U, dx = x - ccx, k = kOf(y);
      if (Math.abs(dx) < 0.45 * rx) { lobes.push({ x, y, z: (r3() - 0.5) * 0.3 * rx, rx, ry, rz: rx, ph: b.ph, ph2: b.ph2, k }); continue; }
      lobes.push({ x, y, z: (r3() - 0.5) * 0.8 * rx, rx, ry, rz: rx, ph: b.ph, ph2: b.ph2, k });
      const ez = (dx < 0 ? 1 : -1) * Math.abs(dx) * 0.6;
      lobes.push({ x: ccx + (r3() - 0.5) * 0.5 * rx, y: y + (r3() - 0.5) * 0.3 * ry + Math.max(0, ez) * 0.45, z: ez, rx, ry, rz: rx, ph: b.ph + 2, ph2: b.ph2 + 4, k });
    }
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const b of lobes) {
      bx0 = Math.min(bx0, b.x - b.rx); bx1 = Math.max(bx1, b.x + b.rx); by0 = Math.min(by0, b.y - b.ry); by1 = Math.max(by1, b.y + b.ry);
      bz0 = Math.min(bz0, b.z - b.rz); bz1 = Math.max(bz1, b.z + b.rz);
    }
    const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, cz = (bz0 + bz1) / 2, crx = (bx1 - bx0) / 2, cry = (by1 - by0) / 2, crz = (bz1 - bz0) / 2, span = by1 - by0;
    // the generator's crown gradient and its darkening toward the bottom
    const grad = (x: number, y: number, z: number): [number, number, number, number] => [(x - cx) / crx, (y - cy) / cry, (z - cz) / crz, 0.25 - (0.7 * (by1 - y)) / span];
    const lift = rc.kind === 'bush' ? 0.3 : 0;
    const rt = rng((spec.seed * 31 + 7) >>> 0);
    for (const b of lobes) { if (tufts) tuftLobe(m, foot, b, grad, lift, rt); else lobe(m, foot, b, RAMP.leaf, grad, lift, 1.4 / (Math.min(b.rx, b.ry) / U)); }
  }

  // ---- conifer skirts: cones with a zigzag hem
  rc.skirts.forEach((s, si) => {
    const t = rc.skirts.length > 2 ? Math.min(1, si / (rc.skirts.length - 2)) : 1, c0 = 0.05 - 0.3 * (1 - t);
    const W = s.W * U, teeth = Math.max(5, Math.min(18, Math.round((2 * Math.PI * s.W) / 5.5))), n = teeth * 2;
    const yTop = Y(s.yTop), h = s.h * U, jag = 3.2 * rc.s * U, droop = 2.6 * rc.s * U, k = kOf(Math.max(0, yTop - h));
    const rings: [number, number, number][] = [[0.06, 0, 0], [0.5, 0.9 * 0.5 ** 1.1, 0.45], [1, 1, 1]]; // radius share, drop share, v
    const base = m.verts;
    rings.forEach(([rs, ds, v], ri) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        const y = yTop - h * ds - (ri === 2 ? droop - (i % 2 ? jag : 0) : 0);
        const tooth = ri === 2 && i % 2 ? 0.8 : 1;
        m.pos.push(foot.x + c * W * rs * tooth, y, foot.z + sn * W * rs * tooth);
        m.nrm.push(c * rs, 0, sn * rs);
        m.grad.push(0, 0, 0, 0.9 * (0.75 - Math.max(0, (v - 0.35) / 0.65)) + c0);
        m.sway.push(foot.x, foot.z, k, Math.max(0, yTop - h));
        m.part.push(RAMP.conifer, 2, 0, 0);
        m.misc.push(0, v, 0, 0);
        m.tuft.push(0, 0, 0, 0);
      }
    });
    for (let ri = 0; ri < 2; ri++) for (let i = 0; i < n; i++) {
      const a = base + ri * n + i, b = base + ri * n + ((i + 1) % n), c = a + n, d = b + n;
      m.idx.push(a, c, b, b, c, d);
    }
  });

  // ---- what the card version casts: the bare trunk below the crown
  let crownBottom = height;
  for (const b of lobes) crownBottom = Math.min(crownBottom, b.y - b.ry * 0.3);
  if (rc.skirts.length) crownBottom = Y(rc.skirts[0].yTop + rc.skirts[0].h);
  if (rc.kind === 'bare') crownBottom = height;
  let half = 0;
  for (const p of trunk) if (p.y > 0.25 && p.y < crownBottom) half = Math.max(half, Math.abs(p.x) + p.w);
  return { spec, drawn, lobes, height, amp, trunkHalf: Math.max(half, 1.5 * U), trunkTop: Math.max(0.3, crownBottom) };
}

/** A seeded clearing: `trees` trees and `bushes` bushes on `w` by `h` tiles, dense toward the north and the sides, open in the middle. */
export function layout(seed: number, w: number, h: number, trees: number, bushes: number): PlantSpec[] {
  const r = rng(seed), out: PlantSpec[] = [];
  const kinds: PlantKind[] = ['round', 'round', 'round', 'wide', 'tall', 'tall', 'conifer', 'conifer', 'round', 'bare'];
  const cx = w / 2, cz = h * 0.58;
  const place = (minD: number, clear: number): { x: number; z: number } | null => {
    for (let tries = 0; tries < 400; tries++) {
      const x = 1.5 + r() * (w - 3), z = 2.5 + r() * (h - 3.5);
      const d = Math.hypot((x - cx) / 1.5, z - cz);
      if (d < clear) continue;
      if (out.some((p) => Math.hypot(p.x - x, p.z - z) < (p.kind === 'bush' ? 1.1 : minD))) continue;
      return { x: Math.round(x * 16) / 16, z: Math.round(z * 16) / 16 };
    }
    return null;
  };
  for (let i = 0; i < trees; i++) {
    const p = place(2.6, 4.2); if (!p) break;
    const kind = kinds[Math.floor(r() * kinds.length)];
    out.push({ kind, seed: 100 + Math.floor(r() * 9000), scalePct: 70 + Math.floor(r() * 46), ...p });
  }
  for (let i = 0; i < bushes; i++) {
    const p = place(1.4, 3); if (!p) break;
    out.push({ kind: 'bush', seed: 100 + Math.floor(r() * 9000), scalePct: 75 + Math.floor(r() * 76), ...p });
  }
  return out;
}

// ---------------------------------------------------------------- the grown tree: one skeleton for leafy and dead trees
const GROWN: Record<'round' | 'wide' | 'tall', { limbs: number; tilt: [number, number]; len: number; lead: number }> = {
  round: { limbs: 3, tilt: [0.55, 0.9], len: 17, lead: 15 },
  wide: { limbs: 4, tilt: [0.9, 1.2], len: 19, lead: 9 },
  tall: { limbs: 3, tilt: [0.3, 0.5], len: 15, lead: 22 },
};

/**
 * A tree grown from branches: the generator's trunk and roots, then limbs that fork twice in space, a leader up the middle,
 * and a leaf lobe at every branch end. A lobe carries the leaf amount below which it is gone, so the same tree is full,
 * sparse or dead by one number; a `bare` plant is this tree with no leaves and dead wood. Conifers and bushes stay as they are.
 */
export function buildGrown(m: MeshData, spec: PlantSpec, tufts = false): Plant3 {
  if (spec.kind === 'conifer' || spec.kind === 'bush') return buildPlant(m, spec, tufts);
  const dead = spec.kind === 'bare', shape = spec.kind === 'bare' ? 'round' : spec.kind, sh = GROWN[shape];
  const drawn = drawPlant(shape, spec.seed, spec.scalePct), rc = drawn.recipe;
  if (!rc) throw new Error('trees: the generator returned no recipe');
  const foot = { x: spec.x, z: spec.z }, r = rng((spec.seed * 104729 + 71) >>> 0), du = rc.s * U;
  const X = (x: number) => (x - rc.foot.x) * U, Y = (y: number) => (rc.foot.y - y) * U;
  const wood = dead ? RAMP.dead : RAMP.bark, minW = 0.6 * U;
  // some trees are sparse on their own; the page's slider scales every tree
  const full = dead ? 0 : r() < 0.3 ? 0.45 + r() * 0.35 : 1;
  const bz = (r() - 0.5) * 4 * du, nT = rc.trunk.length;
  const trunk: P3[] = rc.trunk.map((p, i) => ({ x: X(p.x), y: Y(p.y), z: bz * Math.sin((Math.PI * i) / Math.max(1, nT - 1)), w: Math.max(minW, p.w * U) }));
  const fork = trunk[nT - 1];
  const branches: { pts: P3[]; sides: number }[] = [], lobes: (Lobe3 & { th: number })[] = [];
  const norm = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const leaf = (p: P3, rad: number, th: number) => { if (full > 0) lobes.push({ x: p.x, y: p.y, z: p.z, rx: rad * du, ry: rad * du * 0.86, rz: rad * du, ph: r() * 6, ph2: r() * 6, k: 0, th: th / full }); };
  const grow = (start: P3, dir0: number[], len: number, w0: number, depth: number, last: number, twig: boolean): void => {
    let d = dir0; const n = 6, pts: P3[] = [{ ...start, w: w0 }]; let p = start;
    for (let i = 1; i <= n; i++) {
      d = norm([d[0] + (r() - 0.5) * 0.12, d[1] + 0.07, d[2] + (r() - 0.5) * 0.12]); // limbs turn upward as they go
      p = { x: p.x + d[0] * (len / n), y: p.y + d[1] * (len / n), z: p.z + d[2] * (len / n), w: Math.max(minW, w0 * (1 - 0.32 * (i / n))) };
      pts.push(p);
    }
    branches.push({ pts, sides: w0 > 1.5 * U ? 6 : 4 });
    if (twig) return;
    if (depth >= last) { leaf(p, 9.5 + r() * 3, 0.25 + r() * 0.75); return; }
    if (depth === last - 1) leaf(p, 11 + r() * 2.5, 0.1 + r() * 0.5); // the inner lobes are the last to go
    const kids = depth === 0 && r() < 0.4 ? 3 : 2, axis = norm([d[1] * (r() - 0.5) - d[2] * (r() - 0.5), d[2] * (r() - 0.5) - d[0] * (r() - 0.5), d[0] * (r() - 0.5) - d[1] * (r() - 0.5)]);
    const side = norm([d[1] * axis[2] - d[2] * axis[1], d[2] * axis[0] - d[0] * axis[2], d[0] * axis[1] - d[1] * axis[0]]);
    for (let k = 0; k < kids; k++) {
      const sp = kids === 3 && k === 1 ? (r() - 0.5) * 0.3 : (k === 0 ? -1 : 1) * (0.45 + r() * 0.3), q = kids === 3 && k === 1 ? axis : side;
      grow(p, norm([d[0] * Math.cos(sp) + q[0] * Math.sin(sp), d[1] * Math.cos(sp) + q[1] * Math.sin(sp), d[2] * Math.cos(sp) + q[2] * Math.sin(sp)]), len * (0.66 + r() * 0.12), p.w, depth + 1, last, false);
    }
    if (depth >= 1 && r() < 0.35) { const at = pts[2 + Math.floor(r() * 3)], sg = r() < 0.5 ? -1 : 1; grow(at, norm([d[0] + side[0] * sg * 0.8, d[1], d[2] + side[2] * sg * 0.8]), len * 0.4, w0 * 0.45, last, last, true); }
  };
  const az0 = r() * Math.PI * 2;
  for (let i = 0; i < sh.limbs; i++) {
    const az = az0 + (i / sh.limbs) * Math.PI * 2 + (r() - 0.5) * 0.5, tilt = sh.tilt[0] + r() * (sh.tilt[1] - sh.tilt[0]);
    grow(fork, [Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt)], (sh.len + (r() - 0.5) * 3) * du, fork.w * 0.62, 0, 2, false);
  }
  grow(fork, norm([(r() - 0.5) * 0.25, 1, (r() - 0.5) * 0.25]), sh.lead * du, fork.w * 0.7, 1, 2, false); // the leader carries the top of the crown

  let top = fork.y;
  for (const b of branches) for (const p of b.pts) top = Math.max(top, p.y);
  for (const b of lobes) top = Math.max(top, b.y + b.ry);
  const height = Math.max(top, 0.5), amp = dead ? AMP.bare : AMP.leafy, kOf = (y: number) => amp * (y / height) ** 2;
  const tPts = thin(trunk, Math.max(1, Math.floor(nT / 12)));
  tube(m, foot, tPts, 10, wood, kOf, (i) => (!dead && i >= tPts.length - 3 ? 1 : 0), 1);
  for (const b of branches) tube(m, foot, b.pts, b.sides, wood, kOf, () => (dead ? 0 : 1), 0);
  rc.roots.forEach((src, ri) => {
    const lay = (flip: boolean): P3[] => src.map((p) => {
      const dx = X(p.x) * 0.65, dz = (p.y - rc.foot.y) * U * 1.6, w = Math.max(minW, p.w * U * 0.8);
      return flip ? { x: dx * 0.45, y: 0, z: -Math.abs(dx) * 0.8 - dz * 0.3, w } : { x: dx, y: 0, z: dz, w };
    });
    tube(m, foot, thin(lay(false), 3), 6, wood, () => 0, () => 1, 0);
    if (ri === 0 || ri === rc.roots.length - 1) tube(m, foot, thin(lay(true), 3), 6, wood, () => 0, () => 1, 0);
  });
  if (lobes.length) {
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const b of lobes) {
      b.k = kOf(b.y);
      bx0 = Math.min(bx0, b.x - b.rx); bx1 = Math.max(bx1, b.x + b.rx); by0 = Math.min(by0, b.y - b.ry); by1 = Math.max(by1, b.y + b.ry); bz0 = Math.min(bz0, b.z - b.rz); bz1 = Math.max(bz1, b.z + b.rz);
    }
    const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, cz = (bz0 + bz1) / 2, crx = (bx1 - bx0) / 2, cry = (by1 - by0) / 2, crz = (bz1 - bz0) / 2, span = by1 - by0;
    const grad = (x: number, y: number, z: number): [number, number, number, number] => [(x - cx) / crx, (y - cy) / cry, (z - cz) / crz, 0.25 - (0.7 * (by1 - y)) / span];
    const rt = rng((spec.seed * 31 + 7) >>> 0);
    for (const b of lobes) { if (tufts) tuftLobe(m, foot, b, grad, 0, rt, b.th); else lobe(m, foot, b, RAMP.leaf, grad, 0, 1.4 / (Math.min(b.rx, b.ry) / U), b.th); }
  }
  return { spec, drawn, lobes, height, amp, trunkHalf: fork.w, trunkTop: fork.y };
}

// ---------------------------------------------------------------- the willow (spike/3d-willow, for #299 and #329)
/**
 * A willow: the generator's old, thick, bent trunk; limbs that rise, arch over and droop; a wide dome of leaf lobes on them;
 * and curtains of hanging strands (chains of small leaf tufts) from the outer limbs almost to the ground. A strand swings
 * more the further down it hangs. Blue-green leaves. Lobes and strands carry a leaf amount like the grown tree's.
 */
export function buildWillow(m: MeshData, spec: PlantSpec, tufts = false): Plant3 {
  const drawn = drawTree({ seed: spec.seed, scale: spec.scalePct / 100, shape: 'wide', old: true }), rc = drawn.recipe;
  if (!rc) throw new Error('trees: the generator returned no recipe');
  const foot = { x: spec.x, z: spec.z }, r = rng((spec.seed * 15485863 + 5) >>> 0), du = rc.s * U, ramp = RAMP.conifer;
  const X = (x: number) => (x - rc.foot.x) * U, Y = (y: number) => (rc.foot.y - y) * U, minW = 0.6 * U;
  const bz = (r() - 0.5) * 6 * du, nT = rc.trunk.length;
  const trunk: P3[] = rc.trunk.map((p, i) => ({ x: X(p.x), y: Y(p.y), z: bz * Math.sin((Math.PI * i) / Math.max(1, nT - 1)), w: Math.max(minW, p.w * U) }));
  const fork = trunk[nT - 1];
  const norm = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const branches: { pts: P3[]; sides: number }[] = [], lobes: (Lobe3 & { th: number })[] = [], hangs: { x: number; y: number; z: number; th: number }[] = [];
  const leaf = (p: P3, rad: number, th: number) => lobes.push({ x: p.x, y: p.y, z: p.z, rx: rad * du, ry: rad * du * 0.7, rz: rad * du, ph: r() * 6, ph2: r() * 6, k: 0, th });
  const limb = (start: P3, dir0: number[], len: number, w0: number, depth: number): void => {
    let d = dir0, p = start; const n = 8, pts: P3[] = [{ ...start, w: w0 }];
    for (let i = 1; i <= n; i++) {
      d = norm([d[0] + (r() - 0.5) * 0.1, d[1] - 0.105, d[2] + (r() - 0.5) * 0.1]); // rises, arches over, droops
      p = { x: p.x + d[0] * (len / n), y: p.y + d[1] * (len / n), z: p.z + d[2] * (len / n), w: Math.max(minW, w0 * (1 - 0.5 * (i / n))) };
      pts.push(p);
      if (i >= 5 && r() < 0.65) hangs.push({ x: p.x + (r() - 0.5) * 7 * du, y: p.y - 1.5 * du, z: p.z + (r() - 0.5) * 7 * du, th: 0.15 + r() * 0.85 });
    }
    branches.push({ pts, sides: w0 > 1.5 * U ? 6 : 4 });
    leaf(pts[4], 8.5 + r() * 2, 0.1 + r() * 0.4);
    leaf(p, 6.5 + r() * 2, 0.2 + r() * 0.6);
    for (let k = 0; k < 6; k++) { const a = r() * Math.PI * 2; hangs.push({ x: p.x + Math.cos(a) * 8 * du, y: p.y - 1 * du, z: p.z + Math.sin(a) * 8 * du, th: 0.15 + r() * 0.85 }); }
    if (depth === 0) for (const sg of [-1, 1]) {
      const from = pts[4], a = sg * (0.5 + r() * 0.35), c = Math.cos(a), sn = Math.sin(a);
      limb(from, norm([dir0[0] * c - dir0[2] * sn, 0.2, dir0[0] * sn + dir0[2] * c]), len * 0.7, from.w * 0.7, 1);
    }
  };
  const limbs = 5 + Math.floor(r() * 2), az0 = r() * Math.PI * 2;
  for (let i = 0; i < limbs; i++) {
    if (limbs > 5 && i === 0 && r() < 0.5) continue; // a gap in the crown, where the trunk shows through
    const az = az0 + (i / limbs) * Math.PI * 2 + (r() - 0.5) * 0.4, tilt = 0.5 + r() * 0.25;
    limb(fork, [Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt)], (25 + (r() - 0.5) * 4) * du, fork.w * 0.6, 0);
  }
  const tip: P3 = { x: fork.x + (r() - 0.5) * 3 * du, y: fork.y + 9 * du, z: fork.z + (r() - 0.5) * 3 * du, w: fork.w * 0.4 };
  branches.push({ pts: [{ ...fork, w: fork.w * 0.7 }, tip], sides: 6 });
  leaf(tip, 13 + r() * 2, 0.05 + r() * 0.2);

  let top = fork.y;
  for (const b of lobes) top = Math.max(top, b.y + b.ry);
  const height = Math.max(top, 0.5), amp = AMP.leafy, kOf = (y: number) => amp * (y / height) ** 2;
  const tPts = thin(trunk, Math.max(1, Math.floor(nT / 12)));
  tube(m, foot, tPts, 10, RAMP.bark, kOf, (i) => (i >= tPts.length - 3 ? 1 : 0), 1);
  for (const b of branches) tube(m, foot, b.pts, b.sides, RAMP.bark, kOf, () => 1, 0);
  rc.roots.forEach((src, ri) => {
    const lay = (flip: boolean): P3[] => src.map((p) => {
      const dx = X(p.x) * 0.65, dz = (p.y - rc.foot.y) * U * 1.6, w = Math.max(minW, p.w * U * 0.8);
      return flip ? { x: dx * 0.45, y: 0, z: -Math.abs(dx) * 0.8 - dz * 0.3, w } : { x: dx, y: 0, z: dz, w };
    });
    tube(m, foot, thin(lay(false), 3), 6, RAMP.bark, () => 0, () => 1, 0);
    if (ri === 0 || ri === rc.roots.length - 1) tube(m, foot, thin(lay(true), 3), 6, RAMP.bark, () => 0, () => 1, 0);
  });
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (const b of lobes) {
    b.k = kOf(b.y);
    bx0 = Math.min(bx0, b.x - b.rx); bx1 = Math.max(bx1, b.x + b.rx); by0 = Math.min(by0, b.y - b.ry); by1 = Math.max(by1, b.y + b.ry); bz0 = Math.min(bz0, b.z - b.rz); bz1 = Math.max(bz1, b.z + b.rz);
  }
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, cz = (bz0 + bz1) / 2, crx = (bx1 - bx0) / 2, cry = (by1 - by0) / 2, crz = (bz1 - bz0) / 2, span = by1 - by0;
  const grad = (x: number, y: number, z: number): [number, number, number, number] => [(x - cx) / crx, (y - cy) / cry, (z - cz) / crz, 0.25 - (0.7 * (by1 - y)) / span];
  const rt = rng((spec.seed * 31 + 7) >>> 0);
  for (const b of lobes) { if (tufts) tuftLobe(m, foot, b, grad, 0, rt, b.th, ramp); else lobe(m, foot, b, ramp, grad, 0, 1.4 / (Math.min(b.rx, b.ry) / U), b.th); }
  // the curtains: every strand hangs straight down to a few px above the ground, a chain of small tufts
  for (const h of hangs) {
    const ground = (2 + r() * 5) * du, len = (h.y - ground) * (r() < 0.25 ? 0.55 + r() * 0.3 : 1), step = 1.9 * U, n = Math.floor(len / step);
    if (n < 3) continue;
    const ox = h.x - cx, oz = h.z - cz, ol = Math.hypot(ox, oz) || 1, nx = (ox / ol) * 0.9, nz = (oz / ol) * 0.9, k0 = kOf(h.y), wob = r() * 6, tone = 0.15 + (r() - 0.5) * 0.7; // strands differ in tone, so the curtain reads as streaks
    for (let j = 0; j < n; j++) {
      const t = j / n, px = h.x + Math.sin(j * 0.9 + wob) * 0.6 * U, py = h.y - j * step, pz = h.z + Math.cos(j * 0.7 + wob) * 0.6 * U;
      const size = (1.25 + r() * 0.5 - 0.3 * t) * U, seed = Math.floor(r() * 997), base = m.verts;
      for (const [qx, qy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        m.pos.push(foot.x + px, py, foot.z + pz);
        m.nrm.push(nx, 0.35, nz);
        m.grad.push(nx * 0.5, 0.2, nz * 0.5, 0.2 + tone - 0.25 * t);
        m.sway.push(foot.x, foot.z, k0 + 0.2 * t * t, py); // a strand swings more the further down it hangs
        m.part.push(ramp, 3, 0, 0);
        m.misc.push(0, 0, 0, h.th);
        m.tuft.push(qx, qy, size, seed);
      }
      m.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { spec, drawn, lobes, height, amp, trunkHalf: fork.w, trunkTop: fork.y };
}
