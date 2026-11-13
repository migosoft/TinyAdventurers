// Proof of concept (spike/3d-trees): turns the vegetation generator's recipe into one 3D mesh.
// Pure: no three.js, no DOM. World units are tiles (16 art px), x east, y up, z south.
import { drawPlant, type PlantKind } from '../../game/vegetation';
import { rng, type Drawn, type Recipe } from '../../game/vegetation/canvas';

const U = 1 / 16;
/** The mesh sphere of a lobe is this much larger than the lobe; the fragment stage cuts the scalloped outline out of it. */
export const LOBE_PAD = 1.16;
/** Palette rows. */
export const RAMP = { leaf: 0, conifer: 1, bark: 2, dead: 3 } as const;
/** Sway amplitude in tiles at the top of the plant, as in the #300 design. */
const AMP: Record<Recipe['kind'], number> = { leafy: 0.11, conifer: 0.07, bush: 0.05, bare: 0.05 };

export interface PlantSpec { kind: PlantKind; seed: number; scalePct: number; x: number; z: number }
/** A crown lobe in the world: centre and radii in tiles, and the phases of its outline. */
export interface Lobe3 { x: number; y: number; z: number; rx: number; ry: number; rz: number; ph: number; ph2: number; k: number }
export interface Plant3 {
  spec: PlantSpec; drawn: Drawn; lobes: Lobe3[]; height: number; amp: number;
  /** The bare trunk as the card version casts it: half-width and top, in tiles. */
  trunkHalf: number; trunkTop: number;
}

/** Vertex streams of the merged mesh; `sway` = foot x, foot z, sway factor, anchor height; `part` = ramp, shape (0 lobe, 1 plain, 2 skirt, 3 leaf tuft), phases; `misc` = light lift, hem or shade, edge width, trunk flag. */
export class MeshData {
  pos: number[] = []; nrm: number[] = []; grad: number[] = []; sway: number[] = []; part: number[] = []; misc: number[] = []; idx: number[] = [];
  /** Leaf tufts: corner (-1..1), half-size in tiles, seed; zeros on everything else. */
  tuft: number[] = [];
  get verts() { return this.pos.length / 3; }
  get tris() { return this.idx.length / 3; }
}

// ---- unit icosphere, two subdivisions (162 vertices, 320 triangles)
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  let v: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let f: number[][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const unit = (p: number[]) => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; };
  v = v.map(unit);
  for (let s = 0; s < 2; s++) {
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
})();

interface P3 { x: number; y: number; z: number; w: number }

function lobe(m: MeshData, foot: { x: number; z: number }, b: Lobe3, ramp: number, grad: (x: number, y: number, z: number) => [number, number, number, number], lift: number, edge: number): void {
  const base = m.verts;
  for (const d of ICO.v) {
    m.pos.push(foot.x + b.x + d[0] * b.rx * LOBE_PAD, b.y + d[1] * b.ry * LOBE_PAD, foot.z + b.z + d[2] * b.rz * LOBE_PAD);
    m.nrm.push(d[0], d[1], d[2]);
    m.grad.push(...grad(b.x + d[0] * b.rx, b.y + d[1] * b.ry, b.z + d[2] * b.rz));
    m.sway.push(foot.x, foot.z, b.k, b.y);
    m.part.push(ramp, 0, b.ph, b.ph2);
    m.misc.push(lift, 0, edge, 0);
    m.tuft.push(0, 0, 0, 0);
  }
  for (const [a, c, e] of ICO.f) m.idx.push(base + a, base + c, base + e);
}

/**
 * A lobe as leaf tufts: a smaller core ball, and on the lobe's surface small camera-facing patches (shape 3) spread evenly
 * (a Fibonacci sphere, jittered). Each patch carries the ball's direction at its centre, so the lobe still shades as a round form.
 */
function tuftLobe(m: MeshData, foot: { x: number; z: number }, b: Lobe3, grad: (x: number, y: number, z: number) => [number, number, number, number], lift: number, r: () => number): void {
  lobe(m, foot, { ...b, rx: b.rx * 0.74, ry: b.ry * 0.74, rz: b.rz * 0.74 }, RAMP.leaf, grad, lift, 0);
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
      m.part.push(RAMP.leaf, 3, 0, 0);
      m.misc.push(lift, 0, 0, 0);
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
