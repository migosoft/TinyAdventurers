// Vertex streams of a tree mesh and the primitives that fill them. Pure data: no three.js, no randomness but the
// `rnd` passed in. Plant-local tiles: x east, y up, z south, the foot at the origin.

/** Palette rows of the ramp texture. */
export const RAMP = { leaf: 0, conifer: 1, bark: 2, dead: 3 } as const;
/** Shape codes the fragment stage switches on. */
export const SHAPE = { wood: 1, skirt: 2, tuft: 3, core: 4 } as const;

/** A point of a tube path with its radius in `w`. */
export interface P3 { x: number; y: number; z: number; w: number }
/** A crown lobe: centre and radii in tiles, `k` the sway factor at its centre. */
export interface Lobe3 { x: number; y: number; z: number; rx: number; ry: number; rz: number; k: number }
/** How far a leaf patch flutters in a gust (art pixels, along the wind and across it). */
export const FLUTTER_PX = 0.6; // first guess
/** The crown gradient at a point of the plant: xyz in -1..1, w the height darkening. */
export type GradFn = (x: number, y: number, z: number) => [number, number, number, number];

const U = 1 / 16;

/**
 * One array per vertex stream.
 * position, normal: 3 each. grad: crown gradient xyz and height darkening. sway: sway factor, anchor height.
 * part: ramp row, shape, own warm shift, own bright shift. misc: light lift; wood: standing shade, skirt: hem v,
 * tuft: 1 = casts no shadow; 1 on the trunk; leaf threshold (0 for wood). tuft: corner x, y, half-size, seed.
 */
export class TreeMesh {
  position: number[] = [];
  normal: number[] = [];
  grad: number[] = [];
  sway: number[] = [];
  part: number[] = [];
  misc: number[] = [];
  tuft: number[] = [];
  index: number[] = [];
  get verts(): number { return this.position.length / 3; }
  get tris(): number { return this.index.length / 3; }
}

interface Vertex {
  p: [number, number, number]; n: [number, number, number]; grad: [number, number, number, number];
  sway: [number, number]; part: [number, number, number, number]; misc: [number, number, number, number];
  tuft?: [number, number, number, number];
}

function push(m: TreeMesh, v: Vertex): void {
  m.position.push(...v.p);
  m.normal.push(...v.n);
  m.grad.push(...v.grad);
  m.sway.push(...v.sway);
  m.part.push(...v.part);
  m.misc.push(...v.misc);
  m.tuft.push(...(v.tuft ?? [0, 0, 0, 0]));
}

/** Unit icosphere with `subs` subdivisions. */
function ico(subs: number): { v: number[][]; f: number[][] } {
  const t = (1 + Math.sqrt(5)) / 2;
  let v: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let f: number[][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const unit = (p: number[]) => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; };
  v = v.map(unit);
  for (let s = 0; s < subs; s++) {
    const mid = new Map<string, number>(), nf: number[][] = [];
    const mp = (a: number, b: number) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let i = mid.get(key);
      if (i === undefined) { i = v.length; v.push(unit([v[a][0] + v[b][0], v[a][1] + v[b][1], v[a][2] + v[b][2]])); mid.set(key, i); }
      return i;
    };
    for (const [a, b, c] of f) { const ab = mp(a, b), bc = mp(b, c), ca = mp(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  return { v, f };
}
const ICO_CORE = ico(1);
/** Vertices of one tuft patch and of one core ball. */
export const TUFT_VERTS = 4;
export const CORE_VERTS = ICO_CORE.v.length;

/** A tube of `sides` along `pts`; `kOf` gives the sway factor at a height, `shade` the bark's standing shade (0..1). */
export function tube(m: TreeMesh, pts: P3[], sides: number, ramp: number, kOf: (y: number) => number, shade: (i: number) => number, trunk: boolean): void {
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
      push(m, {
        p: [p.x + nx * p.w, y, p.z + nz * p.w], n: [nx, ny, nz], grad: [0, 0, 0, 0],
        sway: [kOf(Math.max(0, p.y)), Math.max(0, y)],
        part: [ramp, SHAPE.wood, 0, 0], misc: [0, shade(i), trunk ? 1 : 0, 0],
      });
    }
  }
  for (let i = 0; i + 1 < n; i++) for (let s = 0; s < sides; s++) {
    const a = base + i * sides + s, b = base + i * sides + ((s + 1) % sides), c = a + sides, d = b + sides;
    m.index.push(a, c, b, b, c, d);
  }
}

/** The solid ball under a lobe's leaf tufts: an icosphere (42 vertices, 80 triangles) of 0.74 of the lobe. */
export function coreBall(m: TreeMesh, b: Lobe3, ramp: number, grad: GradFn, th: number, lift = 0): void {
  const base = m.verts;
  for (const d of ICO_CORE.v) {
    push(m, {
      p: [b.x + d[0] * b.rx * 0.74, b.y + d[1] * b.ry * 0.74, b.z + d[2] * b.rz * 0.74], n: [d[0], d[1], d[2]],
      grad: grad(b.x + d[0] * b.rx * 0.74, b.y + d[1] * b.ry * 0.74, b.z + d[2] * b.rz * 0.74),
      sway: [b.k, b.y], part: [ramp, SHAPE.core, 0, 0], misc: [lift, 0, 0, th],
    });
  }
  for (const [a, c, e] of ICO_CORE.f) m.index.push(base + a, base + c, base + e);
}

/**
 * Leaf tufts on a lobe's surface: camera-facing patches spread evenly (a Fibonacci sphere, jittered), 14..64 by size.
 * Each patch carries the ball's direction at its centre as its normal, so the lobe still shades as a round form.
 * `lift` is the light lift of the lobe's leaves.
 */
export function tufts(m: TreeMesh, b: Lobe3, grad: GradFn, th: number, rnd: () => number, ramp: number, shift: [number, number] = [0, 0], lift = 0): void {
  const rpx = b.rx / U, n = Math.max(14, Math.min(64, Math.round((rpx * rpx) / 3.2)));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, rad = Math.sqrt(1 - y * y), a = i * 2.39996 + (rnd() - 0.5) * 0.5;
    const d = [Math.cos(a) * rad, y, Math.sin(a) * rad], out = 0.92 + rnd() * 0.16, size = (3.2 + rnd() * 2.2) * U, seed = Math.floor(rnd() * 997);
    const px = b.x + d[0] * b.rx * out, py = b.y + d[1] * b.ry * out, pz = b.z + d[2] * b.rz * out;
    tuftPatch(m, { p: [px, py, pz], n: [d[0], d[1], d[2]], grad: grad(px, py, pz), sway: [b.k, b.y], ramp, shift, lift, th, size, seed });
  }
}

/** One camera-facing leaf patch with its own normal, crown gradient, sway and shift. */
export interface TuftPatch {
  p: [number, number, number]; n: [number, number, number]; grad: [number, number, number, number]; sway: [number, number];
  ramp: number; th: number; size: number; seed: number;
  /** Own warm and bright shift. */
  shift?: [number, number];
  /** Light lift. */
  lift?: number;
  /** The patch lets light through: it casts no shadow. */
  noShadow?: boolean;
}
export function tuftPatch(m: TreeMesh, o: TuftPatch): void {
  const base = m.verts, shift = o.shift ?? [0, 0];
  for (const [ox, oy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    push(m, {
      p: o.p, n: o.n, grad: o.grad, sway: o.sway,
      part: [o.ramp, SHAPE.tuft, shift[0], shift[1]], misc: [o.lift ?? 0, o.noShadow ? 1 : 0, 0, o.th],
      tuft: [ox, oy, o.size, o.seed],
    });
  }
  m.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** A conifer skirt: a cone with a zigzag hem. Sizes in tiles; `radius` is the hem radius, `top` the apex height. */
export interface SkirtOpts {
  radius: number; top: number; height: number; jag: number; droop: number;
  /** Sway factor at the hem and the anchor height the stretch lifts by. */
  k: number; anchor: number;
  /** Added to the height darkening of every vertex. */
  dark: number;
  /** Number of hem teeth. */
  teeth: number;
}
export function skirt(m: TreeMesh, o: SkirtOpts): void {
  const n = o.teeth * 2;
  const rings: [number, number, number][] = [[0.06, 0, 0], [0.5, 0.9 * 0.5 ** 1.1, 0.45], [1, 1, 1]]; // radius share, drop share, v
  const base = m.verts;
  rings.forEach(([rs, ds, v], ri) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const y = o.top - o.height * ds - (ri === 2 ? o.droop - (i % 2 ? o.jag : 0) : 0);
      const tooth = ri === 2 && i % 2 ? 0.8 : 1;
      push(m, {
        p: [c * o.radius * rs * tooth, y, sn * o.radius * rs * tooth], n: [c * rs, 0, sn * rs],
        grad: [0, 0, 0, 0.9 * (0.75 - Math.max(0, (v - 0.35) / 0.65)) + o.dark],
        sway: [o.k, o.anchor], part: [RAMP.conifer, SHAPE.skirt, 0, 0], misc: [0, v, 0, 0],
      });
    }
  });
  for (let ri = 0; ri < 2; ri++) for (let i = 0; i < n; i++) {
    const a = base + ri * n + i, b = base + ri * n + ((i + 1) % n), c = a + n, d = b + n;
    m.index.push(a, c, b, b, c, d);
  }
}

/** A mirrored copy: x negated in position, normal and grad, the winding flipped. */
export function mirrorX(m: TreeMesh): TreeMesh {
  const o = new TreeMesh();
  o.position = m.position.map((v, i) => (i % 3 === 0 ? -v : v));
  o.normal = m.normal.map((v, i) => (i % 3 === 0 ? -v : v));
  o.grad = m.grad.map((v, i) => (i % 4 === 0 ? -v : v));
  o.sway = m.sway.slice(); o.part = m.part.slice(); o.misc = m.misc.slice(); o.tuft = m.tuft.slice();
  o.index = m.index.slice();
  for (let i = 0; i + 2 < o.index.length; i += 3) { const t = o.index[i + 1]; o.index[i + 1] = o.index[i + 2]; o.index[i + 2] = t; }
  return o;
}

/** Copies `m` into `out`, moved to the foot (x, z). */
export function appendAt(out: TreeMesh, m: TreeMesh, x: number, z: number): void {
  const base = out.verts;
  for (let i = 0; i < m.position.length; i += 3) out.position.push(m.position[i] + x, m.position[i + 1], m.position[i + 2] + z);
  for (const k of ['normal', 'grad', 'sway', 'part', 'misc', 'tuft'] as const) for (const v of m[k]) out[k].push(v);
  for (const i of m.index) out.index.push(base + i);
}
