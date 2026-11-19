// SPIKE (#358), throwaway: the new red dragon as a real 3D figure, to judge its size and whether a long neck, tail and wings can bend
// believably. One skinned-on-the-CPU mesh: the spine (tail tip to head) is one continuous tube along a spline, the limbs are jointed
// tubes (two-bone IK), the wings are ruled membranes between finger bones with a painted texture (ragged edge, rips, holes).
// The scales are painted (a small tiling texture), not modelled. Nothing here is meant to be kept as code.
import {
  BufferAttribute, BufferGeometry, DataTexture, DoubleSide, DynamicDrawUsage, Group, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshBasicNodeMaterial,
  NoColorSpace, PlaneGeometry, RepeatWrapping, RGBAFormat, Vector3, type Scene,
} from 'three/webgpu';
import { acos, attribute, clamp, dot, float, fract, length, mix, normalize, pow, smoothstep, step, texture, uniform, uv, vec3, vec4 } from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
type V = [number, number, number];

const PX = 1 / 16;
/** The model is drawn in its own px; this brings its length (nose to tail tip, 69) to the old sprite's drawn width (59 px) at scale 1. */
const NORM = 59 / 73;
export const DRAGON_DIMS = { length: 82 * NORM, span: 134 * NORM, shoulder: 18 * NORM, head: 34.5 * NORM, hit: 17 };

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const mad = (a: V, b: V, k: number): V => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dotv = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V): number => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mixn = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (i: number): number => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- colours (display values)
/** Everything that tells one dragon from another: colours, proportions and the random seed of its wing damage. */
export interface DragonLook {
  name: string;
  /** Against the red dragon. */
  size: number;
  SKIN: V; BONE: V; SPINE: V; THORN: V; THORN_TIP: V; HORN: V; CLAW: V; TOOTH: V; MOUTH: V; GLOW: V;
  belly: V; seamGlow: V; backShade: V; eyeIn: V; eyeOut: V; wingMid: V; wingEdge: V;
  /** Which colour channels the scales' brightness drift goes to. */
  drift: V;
  /** Length and girth factors. */
  neck: number; tail: number; girth: number; wing: number;
  /** `web`: thin rays joined by skin (a sail), not thorns. */
  thorn: { height: number; hook: number; rows: 1 | 2; web: boolean };
  /** `extra`: a third pair on top of the head. */
  horn: { main: number; cheek: number; extra: boolean };
  /** A large webbed comb on the head; webbed fins on the cheeks in place of the horns. */
  comb: boolean; gills: boolean;
  /** The skin of combs, fins and spine webs. */
  web: V;
  /** 0: matt skin; 1: a metal sheen (a highlight and a pale rim). */
  metal: number;
  wingSeed: number; holes: number; notches: number;
}
export const RED_DRAGON: DragonLook = {
  name: 'Red', size: 1,
  SKIN: [0.72, 0.13, 0.08], BONE: [0.52, 0.09, 0.07], SPINE: [0.3, 0.06, 0.06], THORN: [0.66, 0.3, 0.15], THORN_TIP: [0.2, 0.08, 0.06],
  HORN: [0.25, 0.14, 0.1], CLAW: [0.15, 0.1, 0.09], TOOTH: [0.93, 0.87, 0.7], MOUTH: [0.3, 0.05, 0.04], GLOW: [1, 0.58, 0.14],
  belly: [0.8, 0.54, 0.22], seamGlow: [1, 0.3, 0.06], backShade: [0.6, 0.6, 0.6], eyeIn: [1, 0.86, 0.36], eyeOut: [0.74, 0.1, 0.04],
  wingMid: [0.9, 0.34, 0.13], wingEdge: [0.5, 0.08, 0.07], drift: [1, 1.6, 0],
  neck: 1, tail: 1.28, girth: 1, wing: 1, thorn: { height: 1, hook: 1, rows: 2, web: false }, horn: { main: 1, cheek: 1, extra: false }, comb: false, gills: false, web: [0.8, 0.3, 0.12], metal: 0, wingSeed: 0, holes: 12, notches: 11,
};
/** The white (ice) dragon: smaller, a shorter neck, smaller wings with less damage, one row of straighter, icicle-like spines, shorter main horns and a wider cheek frill. */
export const WHITE_DRAGON: DragonLook = {
  name: 'White', size: 0.8,
  SKIN: [0.88, 0.91, 0.95], BONE: [0.66, 0.74, 0.84], SPINE: [0.46, 0.55, 0.7], THORN: [0.88, 0.95, 1], THORN_TIP: [0.42, 0.62, 0.86],
  HORN: [0.66, 0.75, 0.87], CLAW: [0.28, 0.34, 0.44], TOOTH: [0.96, 0.97, 0.99], MOUTH: [0.2, 0.26, 0.42], GLOW: [0.6, 0.92, 1],
  belly: [0.62, 0.71, 0.83], seamGlow: [0.3, 0.85, 1], backShade: [0.72, 0.8, 0.93], eyeIn: [0.88, 0.98, 1], eyeOut: [0.12, 0.4, 0.8],
  wingMid: [0.78, 0.87, 0.96], wingEdge: [0.27, 0.4, 0.6], drift: [0, 0.7, 1.5],
  neck: 0.88, tail: 1.2, girth: 1.06, wing: 0.9, thorn: { height: 1.15, hook: 0.4, rows: 1, web: false }, horn: { main: 0.72, cheek: 1.6, extra: false }, comb: false, gills: false, web: [0.7, 0.8, 0.92], metal: 0, wingSeed: 500, holes: 5, notches: 7,
};
/** The silver dragon: a little larger than the white one, a metal sheen, a large webbed comb on the head, webbed fins where the horns would be, one row of thin webbed spines. */
export const SILVER_DRAGON: DragonLook = {
  name: 'Silver', size: 0.86,
  SKIN: [0.6, 0.64, 0.71], BONE: [0.46, 0.5, 0.6], SPINE: [0.36, 0.4, 0.5], THORN: [0.72, 0.76, 0.84], THORN_TIP: [0.4, 0.44, 0.56],
  HORN: [0.5, 0.54, 0.64], CLAW: [0.2, 0.22, 0.28], TOOTH: [0.95, 0.95, 0.92], MOUTH: [0.3, 0.2, 0.3], GLOW: [0.85, 0.9, 1],
  belly: [0.52, 0.56, 0.64], seamGlow: [0.75, 0.86, 1], backShade: [0.7, 0.72, 0.8], eyeIn: [0.97, 0.82, 1], eyeOut: [0.5, 0.18, 0.75],
  wingMid: [0.68, 0.62, 0.8], wingEdge: [0.3, 0.29, 0.44], drift: [0.6, 0.7, 1.2],
  neck: 1.05, tail: 1.25, girth: 0.97, wing: 0.95, thorn: { height: 1.55, hook: 0.55, rows: 1, web: true }, horn: { main: 1, cheek: 1, extra: false }, comb: true, gills: true,
  web: [0.62, 0.58, 0.78], metal: 1, wingSeed: 900, holes: 4, notches: 6,
};
/** The gold dragon: larger than the red one, a metal sheen, no comb but more horns, one row of thin webbed spines. */
export const GOLD_DRAGON: DragonLook = {
  name: 'Gold', size: 1.15,
  SKIN: [0.8, 0.58, 0.14], BONE: [0.62, 0.42, 0.1], SPINE: [0.5, 0.32, 0.08], THORN: [0.9, 0.72, 0.3], THORN_TIP: [0.5, 0.3, 0.08],
  HORN: [0.5, 0.36, 0.14], CLAW: [0.26, 0.18, 0.08], TOOTH: [0.96, 0.92, 0.8], MOUTH: [0.36, 0.14, 0.05], GLOW: [1, 0.8, 0.3],
  belly: [0.9, 0.76, 0.4], seamGlow: [1, 0.86, 0.4], backShade: [0.72, 0.66, 0.56], eyeIn: [1, 0.96, 0.62], eyeOut: [0.8, 0.38, 0.04],
  wingMid: [0.92, 0.7, 0.26], wingEdge: [0.5, 0.3, 0.08], drift: [1, 1.2, 0],
  neck: 1.08, tail: 1.3, girth: 1.03, wing: 1.05, thorn: { height: 1.45, hook: 0.6, rows: 1, web: true }, horn: { main: 1.1, cheek: 1.15, extra: true }, comb: false, gills: false,
  web: [0.9, 0.62, 0.2], metal: 1, wingSeed: 1300, holes: 3, notches: 5,
};

// ---------------------------------------------------------------- buffers
class Buf {
  pos: Float32Array; nor: Float32Array; uv: Float32Array; aux: Float32Array; col: Float32Array; idx: Uint32Array;
  /** The angle from the tube's underside (radians) of the next vertices; it is linear round the tube, so it interpolates exactly. */
  lat: Float32Array; latNext = 0;
  nv = 0; ni = 0;
  constructor(maxV: number, maxI: number) {
    this.lat = new Float32Array(maxV);
    this.pos = new Float32Array(maxV * 3); this.nor = new Float32Array(maxV * 3); this.uv = new Float32Array(maxV * 2);
    this.aux = new Float32Array(maxV * 4); this.col = new Float32Array(maxV * 3); this.idx = new Uint32Array(maxI);
  }
  reset(): void { this.nv = 0; this.ni = 0; }
  /** aux: [sin of the angle round the tube (1 on top), the belly's threshold, how much scale texture, how much unlit]. */
  vert(p: V, n: V, u: number, v: number, sa: number, belly: number, tex: number, emis: number, c: V): number {
    const i = this.nv++;
    this.pos.set(p, i * 3); this.nor.set(n, i * 3); this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
    this.aux.set([sa, belly, tex, emis], i * 4); this.col.set(c, i * 3); this.lat[i] = this.latNext;
    return i;
  }
  tri(a: number, b: number, c: number): void { this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
}

interface Paint { col: V; tex: number; emis: number }
interface TubeOpt {
  seg?: number; side?: V; col: V; belly?: number[] | number; tex?: number; emis?: number; caps?: [boolean, boolean]; v0?: number;
  /** The cross-section's height factor above and below the centre line. */
  flat?: [number, number];
  paint?: (i: number, sa: number) => Paint | null;
  /** Fixed texture coordinates per ring: the place along the tube and the mean radius the arc is measured with (so the paint never slides). */
  vs?: number[]; rs?: number[];
  /** The ring whose frame is upright (`side` holds there); the frames are carried outward from it both ways, so a swaying end never rolls the rest. */
  anchor?: number;
  /** The side the last ring should arrive at, blended in from ring `from` on (the head's own side, so neck and head meet without a twist). */
  endSide?: { side: V; from: number };
}
interface Frame { c: V; t: V; s: V; u: V; ry: number; rz: number }

/** A tube through `pts` with an elliptical cross-section (`rad`: half height, half width); the frames are carried along, so it never twists. */
function tube(b: Buf, pts: V[], rad: [number, number][], o: TubeOpt): Frame[] {
  const seg = o.seg ?? 12, n = pts.length, frames: Frame[] = [];
  const flat = o.flat ?? [1, 1], tex = o.tex ?? 1, emis = o.emis ?? 0;
  let side: V = o.side ?? [0, 0, 1], v = o.v0 ?? 0;
  const first = b.nv;
  const tans = pts.map((_, i) => norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
  const sides: V[] = [];
  const anchor = o.anchor ?? 0;
  let run = side;
  for (let i = anchor; i < n; i++) { run = norm(mad(run, tans[i], -dotv(run, tans[i]))); sides[i] = run; }
  run = sides[anchor];
  for (let i = anchor - 1; i >= 0; i--) { run = norm(mad(run, tans[i], -dotv(run, tans[i]))); sides[i] = run; }
  if (o.endSide) for (let i = o.endSide.from + 1; i < n; i++) {
    const w = smooth(0, 1, (i - o.endSide.from) / (n - 1 - o.endSide.from)), m = lerp(sides[i], o.endSide.side, w);
    sides[i] = norm(mad(m, tans[i], -dotv(m, tans[i])));
  }
  for (let i = 0; i < n; i++) {
    const t = tans[i];
    side = sides[i];
    const up = cross(side, t);
    if (i > 0) v += len(sub(pts[i], pts[i - 1]));
    const ry = Math.max(0.02, rad[i][0]), rz = Math.max(0.02, rad[i][1]);
    frames.push({ c: pts[i], t, s: side, u: up, ry, rz });
    const belly = typeof o.belly === 'number' ? o.belly : o.belly ? o.belly[i] : 9;
    for (let j = 0; j <= seg; j++) {
      const a = Math.PI / 2 + (j / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), f = sa > 0 ? flat[0] : flat[1];
      const p = mad(mad(pts[i], side, rz * ca), up, ry * sa * f);
      const nn = norm(mad(mul(side, ca / rz), up, sa / (ry * f)));
      const arc = (Math.min(j, seg - j) / seg) * Math.PI * 2 * (o.rs ? o.rs[i] : (ry + rz) * 0.5);
      const pt = o.paint?.(i, sa) ?? null;
      b.latNext = Math.abs(j / seg - 0.5) * Math.PI * 2;
      b.vert(p, nn, arc, o.vs ? o.vs[i] : v, sa, pt ? 9 : belly, pt ? pt.tex : tex, pt ? pt.emis : emis, pt ? pt.col : o.col);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = first + i * (seg + 1) + j, c = a + seg + 1;
    b.tri(a, c, a + 1); b.tri(a + 1, c, c + 1);
  }
  const cap = (at: number, dir: number): void => {
    const f = frames[at], nn = mul(f.t, dir);
    const c = b.vert(mad(f.c, f.t, dir * 0.45 * Math.min(f.ry, f.rz)), nn, 0, 0, 0, 9, tex, emis, o.col);
    for (let j = 0; j < seg; j++) b.tri(c, first + at * (seg + 1) + j, first + at * (seg + 1) + j + 1);
  };
  if (o.caps?.[0]) cap(0, -1);
  if (o.caps?.[1]) cap(n - 1, 1);
  return frames;
}

/** A spike: an elliptical base (half axes `ax`, `bx`) drawn to a point. */
function cone(b: Buf, base: V, ax: V, bx: V, apex: V, col: V, tex = 0, seg = 6): void {
  const first = b.nv, axis = norm(sub(apex, base));
  for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * Math.PI * 2, off = mad(mul(ax, Math.cos(a)), bx, Math.sin(a));
    b.vert(add(base, off), norm(mad(norm(off), axis, 0.35)), j * 0.3, 0, 0, 9, tex, 0, col);
  }
  const tip = b.vert(apex, axis, 0, 1, 0, 9, tex, 0, col);
  for (let j = 0; j < seg; j++) b.tri(first + j, tip, first + j + 1);
}

/** Catmull-Rom through rows of numbers, `subdiv` samples per span. */
function spline(ctrl: number[][], subdiv: number): number[][] {
  const out: number[][] = [], n = ctrl.length;
  for (let i = 0; i < n - 1; i++) {
    const a = ctrl[Math.max(0, i - 1)], b = ctrl[i], c = ctrl[i + 1], d = ctrl[Math.min(n - 1, i + 2)];
    for (let s = 0; s < subdiv; s++) {
      const t = s / subdiv;
      out.push(b.map((_, k) => 0.5 * (2 * b[k] + (c[k] - a[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * t * t * t)));
    }
  }
  out.push(ctrl[n - 1].slice());
  return out;
}
const prof = (xs: number[], vs: number[], x: number): number => {
  for (let i = 0; i < xs.length - 1; i++) if (x <= xs[i + 1]) return mixn(vs[i], vs[i + 1], Math.min(1, Math.max(0, (x - xs[i]) / (xs[i + 1] - xs[i]))));
  return vs[vs.length - 1];
};
/** The middle joint of a two-bone limb from `a` to `c`, bent toward `pole`. */
function ik(a: V, c: V, l1: number, l2: number, pole: V): V {
  const d0 = sub(c, a), d = Math.min(len(d0), (l1 + l2) * 0.999), dir = norm(d0);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  return mad(mad(a, dir, x), norm(mad(pole, dir, -dotv(pole, dir))), h);
}
/** A limb segment: a tube from `a` to `b` that swells a little behind its start. */
function limb(b: Buf, a: V, c: V, r0: number, r1: number, side: V, col: V, wide = 1, tex = 1): void {
  const pts = [a, lerp(a, c, 0.3), lerp(a, c, 0.7), c];
  const rr = [r0 * 0.9, r0 * 1.06, mixn(r0, r1, 0.75), r1];
  tube(b, pts, rr.map((r) => [r, r * wide] as [number, number]), { seg: 10, side, col, tex, caps: [true, true] });
}

// ---------------------------------------------------------------- the painted textures
function dataTex(data: Uint8Array, w: number, h: number, repeat: boolean): DataTexture {
  const t = new DataTexture(data, w, h, RGBAFormat);
  t.colorSpace = NoColorSpace;
  if (repeat) { t.wrapS = RepeatWrapping; t.wrapT = RepeatWrapping; }
  t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
/** 8 x 8 overlapping scales in offset rows, as a brightness (value / 200) with a little colour drift; tiles. */
function scaleTexture(look: DragonLook): DataTexture {
  const S = 128, C = 16, d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const row = Math.floor(y / C), xo = x + (row % 2) * (C / 2), cell = Math.floor(xo / C) % 8 + row * 8;
    const cx = (xo % C) / C - 0.5 + 0.5 / C, cy = (y % C) / C - 0.5 + 0.5 / C;
    const r = Math.hypot(cx, (cy + 0.12) * 0.92);
    const body = 1 - smooth(0.24, 0.56, r);
    const m = 0.5 + 0.5 * body + 0.14 * Math.max(0, -cx * 0.7 - cy) * body + (hash(cell) - 0.5) * 0.16;
    const warm = hash(cell + 77) * 0.12 * body;
    const i = (y * S + x) * 4;
    d[i] = Math.min(255, 200 * (m + warm * look.drift[0])); d[i + 1] = Math.min(255, 200 * (m + warm * look.drift[1] - 0.02)); d[i + 2] = Math.min(255, 200 * (m + warm * look.drift[2])); d[i + 3] = 255;
  }
  return dataTex(d, S, S, true);
}
function noise2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number): number => hash(a * 57 + b * 131 + 9);
  return mixn(mixn(h(xi, yi), h(xi + 1, yi), sx), mixn(h(xi, yi + 1), h(xi + 1, yi + 1), sx), sy);
}
/** Where the finger bones lie across the wing's texture (u); the last stretch is the membrane between the last finger and the body. */
const WING_U = [0, 0.2, 0.4, 0.6, 1];
/**
 * The wing's skin, u across the fingers (leading edge 0, body 1), v from the wrist (0) to the trailing edge (1): orange-red in the middle,
 * dark toward the edge and along the bones, creases, a ragged torn edge with deep notches, a few rips and small holes (alpha 0).
 */
function wingTexture(look: DragonLook): DataTexture {
  const sd = look.wingSeed;
  const W = 1024, H = 512, d = new Uint8Array(W * H * 4);
  const notches = [...Array(look.notches).keys()].map((i) => ({ u: 0.04 + 0.92 * hash(i * 3 + 1 + sd), d: 0.07 + 0.2 * hash(i * 3 + 2 + sd), w: 0.008 + 0.02 * hash(i * 3 + 3 + sd) }));
  const holes = [...Array(look.holes).keys()].map((i) => ({ u: 0.05 + 0.9 * hash(i * 5 + 40 + sd), v: 0.38 + 0.5 * hash(i * 5 + 41 + sd), ru: 0.0035 + 0.007 * hash(i * 5 + 42 + sd), rv: 0.012 + 0.03 * hash(i * 5 + 43 + sd) }));
  const rips = [...Array(4).keys()].map((i) => ({ u: 0.1 + 0.8 * hash(i * 7 + 90 + sd), from: 0.5 + 0.25 * hash(i * 7 + 91 + sd), w: 0.003 + 0.004 * hash(i * 7 + 92 + sd), lean: (hash(i * 7 + 93 + sd) - 0.5) * 0.06 }));
  const creases = [...Array(26).keys()].map((i) => 0.02 + 0.96 * hash(i * 11 + 200));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W, v = (y + 0.5) / H;
    // how far (in u) to the nearest bone
    let bone = 1;
    for (const bu of WING_U) bone = Math.min(bone, Math.abs(u - bu));
    // the torn edge
    let e = 0.02 + 0.035 * noise2(u * 46, 3) + 0.025 * noise2(u * 140, 9) * noise2(u * 23, 5);
    for (const nt of notches) e = Math.max(e, nt.d * Math.max(0, 1 - Math.abs(u - nt.u) / nt.w) ** 0.7);
    e *= smooth(0, 0.012, bone) * 0.85 + 0.15; // the bones reach the edge whole
    let gap = 1 - e - v; // > 0 inside the skin
    for (const h of holes) gap = Math.min(gap, (Math.hypot((u - h.u) / h.ru, (v - h.v) / h.rv) - 1) * 0.03);
    for (const r of rips) if (v > r.from) {
      const k = (v - r.from) / (1 - r.from), c = r.u + r.lean * k + 0.004 * Math.sin(v * 60 + r.u * 50);
      gap = Math.min(gap, (Math.abs(u - c) - r.w * (0.25 + k)) * 2);
    }
    const blot = noise2(u * 9, v * 5) * 0.6 + noise2(u * 31, v * 17) * 0.4;
    const edge = smooth(0.5, 0.97, v + (blot - 0.5) * 0.25);
    let cr = mixn(look.wingMid[0], look.wingEdge[0], edge), cg = mixn(look.wingMid[1], look.wingEdge[1], edge), cb = mixn(look.wingMid[2], look.wingEdge[2], edge);
    const tone = 0.86 + 0.28 * blot;
    cr *= tone; cg *= tone * tone; cb *= tone;
    // dark along the bones, a little light through the middle of each panel
    const nb = 0.62 + 0.38 * smooth(0, 0.05, bone);
    // creases: lines running out from the wrist, and faint arcs across
    let crease = 1;
    for (const cu of creases) crease -= 0.1 * Math.max(0, 1 - Math.abs(u - cu - 0.004 * Math.sin(v * 9 + cu * 40)) / 0.0025) * smooth(0.05, 0.5, v);
    crease -= 0.05 * Math.max(0, Math.sin(v * 95 + blot * 5) - 0.75) * 4;
    // a burnt rim round every tear
    const rim = 0.28 + 0.72 * smooth(0, 0.035, gap);
    const k = nb * crease * rim * (0.75 + 0.25 * smooth(0, 0.14, v));
    const i = (y * W + x) * 4;
    d[i] = 255 * Math.min(1, cr * k); d[i + 1] = 255 * Math.min(1, cg * k); d[i + 2] = 255 * Math.min(1, cb * k);
    d[i + 3] = 255 * Math.min(1, Math.max(0, 0.5 + gap * 60));
  }
  return dataTex(d, W, H, false);
}

// ---------------------------------------------------------------- materials
interface Mats { body: MeshBasicNodeMaterial; wing: MeshBasicNodeMaterial; shadow: MeshBasicNodeMaterial; light: { value: Vector3 }; shade: { value: number }; glow: { value: number }; time: { value: number }; view: { value: Vector3 } }
function materials(look: DragonLook): Mats {
  const L: N = uniform(new Vector3(0, 1, 0)), shadeU: N = uniform(0.4), glowU: N = uniform(0.8), timeU: N = uniform(0);
  const n: N = normalize(attribute('normal', 'vec3')), uvA: N = attribute('uv', 'vec2'), aux: N = attribute('aux', 'vec4'), col: N = attribute('color', 'vec3');
  const lam: N = clamp(dot(n, L), 0, 1);
  const viewU: N = uniform(new Vector3(0, 0.75, 0.66));
  const sheen: N = pow(clamp(dot(n, normalize(L.add(viewU))), 0, 1), 26).mul(0.85 * look.metal).add(pow(float(1).sub(clamp(dot(n, viewU), 0, 1)), 3).mul(0.22 * look.metal));
  const sheenCol: N = vec3(...look.SKIN.map((c) => 0.45 * c + 0.55) as V);
  const lit: N = float(0.36).add(n.y.mul(0.5).add(0.5).mul(0.2)).add(lam.mul(0.62));

  // scales 0.5 px wide (the texture holds 8 across); darker along the back
  const sc: N = texture(scaleTexture(look), uvA.div(4)).rgb.mul(1.275);
  const back: N = mix(vec3(1, 1, 1), vec3(...look.backShade), smoothstep(0.35, 0.95, aux.x));
  const skin: N = col.mul(mix(vec3(1, 1, 1), sc.mul(back), aux.z));
  // the belly: plates across, each lighter toward its rear edge, a dark seam between them, darker toward the flanks
  // the belly: chevron plates pointing along the body, each lighter toward its rear edge and darker toward the flanks; the seams are
  // dark, and only their middle glows red
  const under: N = aux.x.negate();
  const isBelly: N = step(aux.y, under);
  const lat: N = (attribute('lat', 'float') as N).div(acos(aux.y.clamp(-1, 1)).max(0.05)).clamp(0, 1); // 0 on the middle line, 1 at the plates' ends
  const band: N = fract(uvA.y.div(2.3).add(lat.mul(1.25)));
  const seam: N = step(band, float(0.16));
  const ochre: N = vec3(...look.belly);
  const plate: N = ochre.mul(float(0.62).add(band.mul(0.42))).mul(float(1).sub(seam.mul(0.72))).mul(mix(float(1), float(0.5), smoothstep(0.55, 1, lat)));
  const core: N = float(1).sub(band.sub(0.08).abs().div(0.08)).clamp(0, 1);
  const glow: N = core.mul(float(1).sub(smoothstep(0.08, 0.62, lat))).mul(isBelly).mul(glowU)
    .mul(float(0.18).add(uvA.y.mul(0.42).sub(timeU.mul(2.6)).sin().mul(0.5).add(0.5).pow(2.5).mul(0.95)));
  const albedo: N = mix(skin, plate, isBelly);
  const shaded: N = mix(mix(albedo.mul(lit).add(sheenCol.mul(sheen)), col, aux.w), vec3(...look.seamGlow), glow);
  const body = new MeshBasicNodeMaterial();
  body.colorNode = vec4(shaded, float(1));
  body.side = DoubleSide;

  // the membrane: lit from either side, a little light coming through
  const t: N = texture(wingTexture(look), uv());
  const wl: N = float(0.62).add((dot(n, L) as N).abs().mul(0.5));
  const wing = new MeshBasicNodeMaterial();
  wing.colorNode = vec4(t.rgb.mul(wl), t.a);
  wing.alphaTest = 0.5;
  wing.side = DoubleSide;

  const shadow = new MeshBasicNodeMaterial();
  const fade: N = float(1).sub(smoothstep(0.35, 1, (length(uv().sub(0.5)) as N).mul(2))).mul(shadeU);
  shadow.colorNode = vec4(vec3(0, 0, 0), fade);
  shadow.transparent = true; shadow.depthWrite = false;
  return { body, wing, shadow, light: L, shade: shadeU, glow: glowU, time: timeU, view: viewU };
}

function geometry(b: Buf, withAux: boolean): BufferGeometry {
  const g = new BufferGeometry();
  const dyn = (a: Float32Array, n: number): BufferAttribute => { const at = new BufferAttribute(a, n); at.setUsage(DynamicDrawUsage); return at; };
  g.setAttribute('position', dyn(b.pos, 3)); g.setAttribute('normal', dyn(b.nor, 3)); g.setAttribute('uv', dyn(b.uv, 2));
  if (withAux) { g.setAttribute('aux', dyn(b.aux, 4)); g.setAttribute('color', dyn(b.col, 3)); g.setAttribute('lat', dyn(b.lat, 1)); }
  g.setIndex(new BufferAttribute(b.idx, 1));
  return g;
}

// ---------------------------------------------------------------- the body's shape (model px: front +x, up +y, the dragon's right +z)
/** The spine from the tail's tip to the head's base: [x, y, half height, half width, belly threshold (9: none), spine height]. */
const TAIL: number[][] = [
  [-43.6, 4.0, 0.1, 0.1, 9, 0],
  [-40.4, 2.9, 0.34, 0.32, 9, 0.6],
  [-37.0, 1.7, 0.66, 0.6, 0.86, 0.95],
  [-32.5, 1.7, 1.05, 0.95, 0.8, 1.3],
  [-27.5, 2.5, 1.5, 1.35, 0.74, 1.7],
  [-22.5, 4.0, 2.05, 1.85, 0.7, 2.1],
  [-17.5, 6.1, 2.75, 2.45, 0.66, 2.5],
  [-13.0, 8.3, 3.5, 3.2, 0.62, 2.9],
];
const TRUNK: number[][] = [
  [-8.0, 10.3, 4.4, 4.2, 0.58, 3.4],
  [-2.0, 10.7, 5.0, 4.6, 0.56, 3.9],
  [4.0, 11.4, 5.6, 4.9, 0.56, 4.3],
  [8.5, 13.6, 4.5, 3.9, 0.56, 4.4],
];
const NECK: number[][] = [
  [11.8, 17.2, 3.4, 2.9, 0.56, 4.0],
  [14.0, 21.2, 2.8, 2.4, 0.56, 3.5],
  [15.0, 25.4, 2.4, 2.1, 0.56, 3.0],
  [15.8, 29.2, 2.15, 1.9, 0.56, 2.7],
  [18.0, 31.8, 2.0, 1.8, 0.58, 2.4],
  [21.5, 32.6, 1.9, 1.75, 0.6, 1.9],
];
const REST: number[][] = [...TAIL, ...TRUNK, ...NECK];
const SUB = 4;
/** The rest length of each stretch of the spine (control i to i + 1), with the look's tail and neck factors. */
function restLengths(look: DragonLook): number[] {
  return REST.slice(0, -1).map((c, i) => Math.hypot(REST[i + 1][0] - c[0], REST[i + 1][1] - c[1]) * (i < TAIL.length ? look.tail : i >= TAIL.length + TRUNK.length - 1 ? look.neck : 1));
}
/** The fixed texture place of every ring along the spine. */
function restV(restLen: number[]): number[] {
  const out: number[] = [];
  let at = 0;
  for (let i = 0; i < REST.length - 1; i++) { for (let k = 0; k < SUB; k++) out.push(at + (restLen[i] * k) / SUB); at += restLen[i]; }
  out.push(at);
  return out;
}
const REST_R: number[] = spline(REST, SUB).map((q) => (Math.max(0.02, q[2]) + Math.max(0.02, q[3])) * 0.5);
const HEAD_REST: V = [21.5, 32.6, 0];
const PIVOT: [number, number] = [-2, 11];

// the wing's flat layout (px): bone lengths, and the fingers' angles from the first one
const HUMERUS0 = 11, FOREARM0 = 13;
const FINGER_LEN0 = [38, 35, 31, 26], FINGER_ANG = [0, -27, -57, -88], FINGER_CURVE = [15, 11, 9, 7];
const FINGER_K = 5;

export interface DragonPose {
  /** Tiles. */
  x: number; z: number;
  /** Where it faces (radians, 0: east). */
  face: number;
  /** The size factor against the old sprite. */
  scale: number;
  /** 0..1 targets: flying, roaring, wings spread on the ground. */
  air: number; roar: number; spread: number;
  /** What the head looks at (tiles), or null. */
  look: { x: number; z: number } | null;
  /** 1 / cos(pitch): heights are stretched so a figure stands its full height on the screen. */
  stretch: number;
  /** The unit vector toward the camera (world). */
  view: V;
}

export interface DragonSpike {
  attach(scene: Scene): void;
  step(dt: number, t: number, p: DragonPose): void;
  dispose(): void;
}

export function createDragonSpike(look: DragonLook = RED_DRAGON): DragonSpike {
  const mats = materials(look);
  const { SKIN, BONE, SPINE, THORN, THORN_TIP, HORN, CLAW, TOOTH, MOUTH, GLOW } = look;
  const REST_LEN = restLengths(look), REST_V = restV(REST_LEN);
  const HUMERUS = HUMERUS0 * look.wing, FOREARM = FOREARM0 * look.wing, FINGER_LEN = FINGER_LEN0.map((l) => l * look.wing);
  const body = new Buf(14000, 80000), wing = new Buf(2400, 14000);
  const group = new Group();
  const bodyGeo = geometry(body, true), wingGeo = geometry(wing, false);
  const bodyMesh = new Mesh(bodyGeo, mats.body), wingMesh = new Mesh(wingGeo, mats.wing);
  bodyMesh.frustumCulled = false; wingMesh.frustumCulled = false;
  group.add(bodyMesh, wingMesh);
  const shadow = new Mesh(new PlaneGeometry(1, 1), mats.shadow);
  shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 1; shadow.frustumCulled = false;
  let first = true;
  // smoothed state
  let air = 0, roar = 0, spread = 0, az = 0, el = -0.2, started = false;

  return {
    attach(scene) { scene.add(shadow, group); first = true; },
    dispose() { group.removeFromParent(); shadow.removeFromParent(); bodyGeo.dispose(); wingGeo.dispose(); },
    step(dt, t, p) {
      const ease = (cur: number, to: number, rate: number): number => (started ? cur + (to - cur) * (1 - Math.exp(-dt * rate)) : to);
      air = ease(air, p.air, 2.2); roar = ease(roar, p.roar, 5); spread = ease(spread, Math.max(p.spread, p.roar), 3);
      const k = PX * p.scale * NORM * look.size;
      group.position.set(p.x, 0, p.z);
      group.rotation.set(0, -p.face, 0);
      group.scale.set(k, k * p.stretch, k);
      const cf = Math.cos(p.face), sf = Math.sin(p.face);
      // the light, from the upper left in front, in the dragon's own space
      const lw = norm([-0.45, 0.8, 0.55]);
      mats.light.value.set(lw[0] * cf + lw[2] * sf, lw[1], -lw[0] * sf + lw[2] * cf);
      mats.view.value.set(p.view[0] * cf + p.view[2] * sf, p.view[1], -p.view[0] * sf + p.view[2] * cf);

      const breath = Math.sin(t * 1.5);
      const flap = t * Math.PI * 2 * 0.72;
      const pitch = air * 0.36 + roar * (1 - air) * 0.05;
      const lift = air * (17 + 2.4 * Math.sin(flap - 1.9)) + (1 - air) * 0.25 * breath;
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      /** Body space to the dragon's own space: the trunk pitches about its middle and rises. */
      const M = (q: V): V => [PIVOT[0] + (q[0] - PIVOT[0]) * cp - (q[1] - PIVOT[1]) * sp, PIVOT[1] + (q[0] - PIVOT[0]) * sp + (q[1] - PIVOT[1]) * cp + lift, q[2]];
      const Mdir = (q: V): V => [q[0] * cp - q[1] * sp, q[0] * sp + q[1] * cp, q[2]];

      body.reset(); wing.reset();

      // ---- the head's place and direction
      const headRest = M(HEAD_REST);
      let wantAz = 0.25 * Math.sin(t * 0.37), wantEl = -0.28 + 0.08 * Math.sin(t * 0.53), reach = 0;
      if (p.look) {
        const dx = p.look.x - p.x, dz = p.look.z - p.z;
        const d: V = sub([(dx * cf + dz * sf) / k, 0.5 / k, (-dx * sf + dz * cf) / k], headRest);
        wantAz = Math.min(1.3, Math.max(-1.3, Math.atan2(d[2], d[0])));
        wantEl = Math.min(0.4, Math.max(-0.8, Math.atan2(d[1], Math.hypot(d[0], d[2]))));
        reach = Math.min(8.5, len(d) * 0.22) * Math.max(0, Math.cos(wantAz)) * (d[0] > 0 ? 1 : 0.3);
      }
      wantEl = mixn(wantEl, 0.42, roar); reach = mixn(reach, 5, roar);
      az = ease(az, wantAz, 2.4); el = ease(el, wantEl, 2.4);
      const fwd: V = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
      const off: V = add(mul(fwd, reach), [0.5 * Math.sin(t * 0.7), 0.5 * breath + 2.5 * roar, 0.9 * Math.sin(t * 0.45)]);
      let headPos = add(headRest, off);
      const hz = norm(cross(fwd, [0, 1, 0])), hy = cross(hz, fwd);
      const H = (q: V): V => mad(mad(mad(headPos, fwd, q[0]), hy, q[1]), hz, q[2]);
      const Hd = (q: V): V => mad(mad(mul(fwd, q[0]), hy, q[1]), hz, q[2]);

      // ---- the spine: one tube from the tail's tip to the head
      const ctrl: number[][] = [];
      TAIL.forEach((c, i) => {
        const u = 1 - i / TAIL.length; // 1 at the tip
        const zz = 6 * Math.sin(u * Math.PI * 1.05) * Math.pow(u, 0.8) + (1 + 3.2 * u) * u * Math.sin(0.9 * t - 2.6 * u);
        const q = M([c[0], c[1] + air * 5 * u + 1.2 * u * u * Math.sin(0.6 * t + 2), zz]);
        ctrl.push([q[0], Math.max(q[1], c[2] * 0.95), q[2], c[2] * look.girth, c[3] * look.girth, c[4], c[5]]);
      });
      TRUNK.forEach((c, i) => {
        const q = M([c[0], c[1], 0]), swell = (i === 1 || i === 2 ? 1 + 0.03 * breath : 1) * look.girth;
        ctrl.push([q[0], q[1], q[2], c[2] * swell, c[3] * swell, c[4], c[5]]);
      });
      NECK.forEach((c, i) => {
        const w = Math.pow((i + 1) / NECK.length, 1.7);
        let q = add(M([c[0], c[1], 0]), mul(off, w));
        if (i === NECK.length - 2) q = lerp(q, mad(headPos, fwd, -3.4), 0.55);
        if (i === NECK.length - 1) q = headPos;
        ctrl.push([q[0], q[1], q[2], c[2], c[3], c[4], c[5]]);
      });
      // every stretch keeps its rest length (outward from the hips and from the shoulders), so nothing stretches when the tail sways or the head reaches
      const posed = ctrl.map((c) => [c[0], c[1], c[2]]);
      const fix = (i: number, from: number, L: number): void => {
        // the direction of the posed stretch, not toward the point that was already moved
        const d = norm([posed[i][0] - posed[from][0], posed[i][1] - posed[from][1], posed[i][2] - posed[from][2]]);
        for (let k = 0; k < 3; k++) ctrl[i][k] = ctrl[from][k] + d[k] * L;
      };
      for (let i = TAIL.length - 1; i >= 0; i--) { fix(i, i + 1, REST_LEN[i]); ctrl[i][1] = Math.max(ctrl[i][1], ctrl[i][3] * 0.95); }
      for (let i = TAIL.length + TRUNK.length; i < ctrl.length; i++) fix(i, i - 1, REST_LEN[i - 1]);
      const last = ctrl[ctrl.length - 1];
      headPos = [last[0], last[1], last[2]];
      const rings = spline(ctrl, SUB);
      const frames = tube(body, rings.map((r) => [r[0], r[1], r[2]] as V), rings.map((r) => [r[3], r[4]] as [number, number]), {
        seg: 16, col: SKIN, belly: rings.map((r) => r[5]), vs: REST_V, rs: REST_R,
        anchor: (TAIL.length + 1) * SUB, endSide: { side: hz, from: (TAIL.length + TRUNK.length - 1) * SUB },
      });
      // the row of spines along the back, leaning backward (the spine runs tail to head, so backward is against the tangent)
      /** Thin rays from `bases` to `tips` with skin between neighbours (a comb, a fin, a sail); the skin's free edge hangs in an arc. */
      const fan = (bases: V[], tips: V[], nrms: V[], reach = 0.86): void => {
        bases.forEach((b0, j) => {
          const r = Math.max(0.1, len(sub(tips[j], b0)) * 0.05);
          tube(body, [b0, lerp(b0, tips[j], 0.5), tips[j]], [[r, r], [r * 0.7, r * 0.7], [r * 0.12, r * 0.12]], { seg: 5, side: nrms[j], col: THORN, tex: 0, paint: (q) => ({ col: lerp(THORN, THORN_TIP, q / 2), tex: 0.2, emis: 0 }) });
        });
        for (let j = 0; j < bases.length - 1; j++) {
          const w0 = lerp(bases[j], tips[j], reach), w1 = lerp(bases[j + 1], tips[j + 1], reach), mb = lerp(bases[j], bases[j + 1], 0.5), mw = lerp(lerp(w0, w1, 0.5), mb, 0.3);
          const dark: V = mul(look.web, 0.6);
          const v = (q: V, c: V): number => body.vert(q, nrms[j], 0, 0, 0, 9, 0, 0.3, c);
          const a = v(bases[j], dark), b2 = v(w0, look.web), c = v(mb, dark), d = v(mw, look.web), e = v(bases[j + 1], dark), g = v(w1, look.web);
          body.tri(a, b2, c); body.tri(b2, d, c); body.tri(c, d, e); body.tri(d, g, e);
        }
      };
      // one row on the neck and the tail; over the back it splits into two (from the bottom of the neck to the start of the tail)
      const sail: { b: V[]; t: V[]; n: V[] } = { b: [], t: [], n: [] };
      const splitA = TAIL.length * SUB - 3, splitB = (TAIL.length + TRUNK.length - 1) * SUB + 3;
      for (let i = 3; i < frames.length - 2; i += 2) {
        const f = frames[i], h = rings[i][6] * (0.75 + 0.5 * hash(i)) * look.thorn.height;
        if (h < 0.25) continue;
        const k2 = (i - splitA) / (splitB - splitA), split = k2 > 0 && k2 < 1 ? Math.pow(Math.sin(Math.PI * k2), 0.55) : 0;
        const ang = look.thorn.rows === 2 ? 0.62 * split : 0;
        for (const sd of ang > 0.12 ? [-1, 1] : [0]) {
          const out = norm(mad(mul(f.u, Math.cos(ang)), f.s, sd * Math.sin(ang))), across = norm(cross(f.t, out));
          // a rose thorn: broad along the body at its base, thin seen from the front, hooked backward to a point
          const hh = h * (sd === 0 ? 1 : 0.9), lean = (0.75 + 0.3 * hash(i + 50 + sd)) * look.thorn.hook;
          const base = mad(mad(f.c, f.u, f.ry * 0.88 * Math.cos(ang)), f.s, sd * f.rz * 0.88 * Math.sin(ang));
          if (look.thorn.web) { sail.b.push(base); sail.t.push(mad(mad(base, out, hh), f.t, -hh * 0.75 * lean)); sail.n.push(across); continue; }
          const UP = [-0.12, 0.3, 0.6, 0.84, 1], BACK = [0, 0.03, 0.2, 0.52, 0.95], WIDE = [0.56, 0.42, 0.25, 0.11, 0.012], THIN = [0.15, 0.12, 0.075, 0.04, 0.01];
          tube(body, UP.map((u2, q) => mad(mad(base, out, hh * u2), f.t, -hh * (BACK[q] * lean + 0.1))), UP.map((_, q) => [hh * WIDE[q], hh * THIN[q]] as [number, number]), {
            seg: 6, side: across, col: THORN, tex: 0, paint: (q) => ({ col: lerp(THORN, THORN_TIP, q / 4), tex: 0.25, emis: 0 }),
          });
        }
      }
      if (sail.b.length) fan(sail.b, sail.t, sail.n);

      // ---- the head
      const open = 0.07 + 0.03 * breath + 0.55 * roar;
      const hx = [-1.8, 0, 1.6, 3.6, 5.6, 7.6, 9.0, 9.7];
      const skullY = [0.2, 0.5, 0.7, 0.5, 0.2, 0.0, -0.1, -0.2], skullRy = [1.7, 2.0, 2.3, 1.9, 1.45, 1.2, 1.0, 0.45], skullRz = [1.7, 2.1, 2.5, 2.1, 1.7, 1.5, 1.3, 0.7];
      const mouth = (x: number): Paint => { const g = 0.75 * (1 - smooth(1.5, 6.5, x)); return { col: lerp(MOUTH, GLOW, g), tex: 0, emis: 0.25 + 0.75 * g }; };
      tube(body, hx.map((x, i) => H([x, skullY[i], 0])), hx.map((_, i) => [skullRy[i], skullRz[i]] as [number, number]), {
        seg: 14, side: hz, col: SKIN, flat: [1, 0.32], caps: [true, true], v0: 3,
        paint: (i, sa) => (sa < -0.3 && i >= 3 ? mouth(hx[i]) : null),
      });
      const co = Math.cos(open), so = Math.sin(open);
      const J = (q: V): V => [1 + (q[0] - 1) * co + (q[1] + 0.6) * so, -0.6 - (q[0] - 1) * so + (q[1] + 0.6) * co, q[2]];
      const jx = [0.2, 2, 4, 6, 7.8, 8.7], jawY = [-1.2, -1.4, -1.35, -1.3, -1.25, -1.15], jawRy = [1.1, 1.15, 1.0, 0.85, 0.75, 0.4], jawRz = [1.9, 2.0, 1.75, 1.45, 1.2, 0.6];
      tube(body, jx.map((x, i) => H(J([x, jawY[i], 0]))), jx.map((_, i) => [jawRy[i], jawRz[i]] as [number, number]), {
        seg: 14, side: hz, col: SKIN, flat: [0.3, 1], caps: [true, true], belly: 0.45, v0: 5,
        paint: (i, sa) => (sa > 0.3 && i >= 2 ? mouth(jx[i]) : null),
      });
      // teeth: upper ones point down, lower ones up; a pair of fangs in front
      for (let x = 4.9; x < 9.2; x += 0.75) for (const s of [-1, 1]) {
        const fang = Math.abs(x - 7.9) < 0.4 || Math.abs(x - 5.65) < 0.4, h = fang ? 1.5 : 0.55 + 0.4 * hash(x * 9 + s);
        const uy = prof(hx, skullY, x) - prof(hx, skullRy, x) * 0.3, uz = s * prof(hx, skullRz, x) * 0.82;
        cone(body, H([x, uy, uz]), Hd([0.26, 0, 0]), Hd([0, 0, 0.2]), H([x - 0.1, uy - h, uz]), TOOTH, 0, 5);
        if (x > 8.2) continue;
        const ly = prof(jx, jawY, x) + prof(jx, jawRy, x) * 0.28, lz = s * prof(jx, jawRz, x) * 0.8, lh = fang ? 1.1 : 0.45 + 0.3 * hash(x * 5 + s);
        cone(body, H(J([x + 0.35, ly, lz])), Hd([0.24, 0, 0]), Hd([0, 0, 0.18]), H(J([x + 0.35, ly + lh, lz])), TOOTH, 0, 5);
      }
      // cheeks: skin from the upper lip to the jaw's edge over the back of the mouth; its front edge hangs in an arc when the jaw opens
      for (const s of [-1, 1]) {
        const C = 6, at = body.nv, x1 = 5.3;
        for (let i = 0; i <= C; i++) {
          const x = -0.6 + (x1 + 0.6) * (i / C);
          const top: V = [x, prof(hx, skullY, x) + 0.2, s * prof(hx, skullRz, x) * 0.95];
          const bot = J([x, prof(jx, jawY, x) - 0.2, s * prof(jx, jawRz, x) * 0.95]);
          for (let r = 0; r <= 2; r++) {
            const q = lerp(top, bot, r / 2);
            if (r === 1) { q[0] -= (i / C) ** 3 * (1.1 + 3.2 * open); q[2] = s * (Math.max(Math.abs(top[2]), Math.abs(bot[2])) / 0.95 + 0.1); }
            body.vert(H(q), Hd([0.1, 0, s]), x * 0.9 + 3, q[1] + 4, 0.2, 9, 1, 0, [SKIN[0] * 0.8, SKIN[1] * 0.8, SKIN[2] * 0.8]);
          }
        }
        for (let i = 0; i < C; i++) for (let r = 0; r < 2; r++) { const a = at + i * 3 + r, c = a + 3; body.tri(a, c, a + 1); body.tri(a + 1, c, c + 1); }
      }
      for (const s of [-1, 1]) {
        // eye, brow
        // the eye: an almond with a black slit, yellow round it running out to deep red, a dark rim (colours per vertex, nearly unlit)
        {
          const US = [-1, -0.72, -0.44, -0.22, -0.09, 0, 0.09, 0.22, 0.44, 0.72, 1], VS = [-1, -0.6, -0.25, 0, 0.25, 0.6, 1], at = body.nv;
          for (const u of US) for (const v of VS) {
            const hgt = Math.sqrt(Math.max(0, 1 - u * u)), r = Math.hypot(u, v * hgt);
            let c: V = lerp(look.eyeIn, look.eyeOut, smooth(0.12, 0.78, r));
            if (r > 0.9) c = [0.1, 0.02, 0.02];
            if (Math.abs(u) < 0.1 && Math.abs(v) < 0.95) c = [0.02, 0.01, 0.01];
            const q: V = [2.9 + u * 1.0, 1.3 + v * hgt * 0.58 - 0.14 * u, s * (2.02 + 0.2 * (1 - r * r) - 0.1 * u)];
            body.vert(H(q), Hd([0, 0.2, s]), 0, 0, 0, 9, 0, 0.88, c);
          }
          for (let i = 0; i < US.length - 1; i++) for (let j = 0; j < VS.length - 1; j++) { const a = at + i * VS.length + j, c2 = a + VS.length; body.tri(a, c2, a + 1); body.tri(a + 1, c2, c2 + 1); }
        }
        // the brow lies on the skull's surface (a point at 38 degrees above the widest line), half sunk in
        const onSkull = (x: number, lift: number): V => H([x, prof(hx, skullY, x) + prof(hx, skullRy, x) * 0.62 + lift, s * (prof(hx, skullRz, x) * 0.785 + lift * 0.6)]);
        tube(body, [onSkull(0.8, 0), onSkull(2.6, 0.12), onSkull(4.4, 0)], [[0.3, 0.3], [0.52, 0.5], [0.25, 0.25]], { seg: 8, side: hz, col: SPINE, tex: 0.4, caps: [true, true] });
        // horns: a long pair sweeping back and up, a shorter pair from the cheeks, a jaw spike
        const horn = (pts0: number[][], len: number, seg = 8): void => {
          const pts = pts0.map((q) => [pts0[0][0] + (q[0] - pts0[0][0]) * len, pts0[0][1] + (q[1] - pts0[0][1]) * len, pts0[0][2] + (q[2] - pts0[0][2]) * len, q[3]]);
          const r = spline(pts, 3);
          tube(body, r.map((q) => H([q[0], q[1], s * q[2]])), r.map((q) => [q[3], q[3]] as [number, number]), { seg, side: hz, col: HORN, tex: 0, caps: [true, false] });
        };
        if (!look.gills) {
          horn([[0.9, 2.2, 1.5, 0.85], [-2.6, 3.5, 2.5, 0.7], [-6.2, 5.3, 3.1, 0.42], [-9.2, 7.4, 2.9, 0.05]], look.horn.main);
          horn([[0.4, 0.3, 2.2, 0.6], [-2.4, 0.5, 3.3, 0.42], [-5.0, 1.5, 3.7, 0.04]], look.horn.cheek);
          horn([[-0.6, 1.7, 1.9, 0.5], [-3.0, 2.2, 3.0, 0.3], [-5.2, 3.2, 3.5, 0.04]], look.horn.cheek, 6);
          if (look.horn.extra) horn([[-0.8, 2.3, 0.9, 0.6], [-3.6, 4.3, 1.3, 0.42], [-6.6, 6.8, 1.5, 0.04]], look.horn.main * 0.85, 6);
        } else {
          // fins in place of the horns: rays fanning back and outward from the rear edge of the cheek, skin between them
          const gb: V[] = [], gt: V[] = [], gn: V[] = [];
          for (let j = 0; j < 5; j++) {
            const bq: V = [0.3 - 0.35 * j, 2.0 - 0.8 * j, s * (1.75 + 0.12 * j)], L = 6.0 + 1.4 * (2 - Math.abs(j - 2));
            gb.push(H(bq)); gt.push(H([bq[0] - L * 0.82, bq[1] + L * (0.5 - 0.27 * j), bq[2] + s * L * 0.42])); gn.push(Hd([0.45, 0, s]));
          }
          fan(gb, gt, gn);
        }
        cone(body, H(J([1.2, -1.9, s * 1.8])), Hd([0.45, 0, 0]), Hd([0, 0, 0.3]), H(J([-0.9, -3.1, s * 2.1])), HORN);
        cone(body, H([8.6, 0.55, s * 0.6]), Hd([0.2, 0, 0]), Hd([0, 0, 0.2]), H([8.3, 1.25, s * 0.65]), HORN, 0, 5);
      }
      if (look.comb) {
        // the comb: rays along the top of the skull, upright in front and swept back behind, skin between them
        const LEN = [3.4, 6.0, 8.2, 9.8, 10.4, 9.8, 8.4, 6.6], cb: V[] = [], ct: V[] = [];
        LEN.forEach((L, j) => {
          const x = 4.2 - 1.0 * j, th = (18 + 8 * j) * DEG, by = prof(hx, skullY, x) + prof(hx, skullRy, x) * 0.92;
          cb.push(H([x, by, 0])); ct.push(H([x - L * Math.sin(th), by + L * Math.cos(th), 0]));
        });
        fan(cb, ct, cb.map(() => hz));
      }
      cone(body, H(J([7.2, -1.9, 0])), Hd([0.5, 0, 0]), Hd([0, 0, 0.35]), H(J([6.3, -3.2, 0])), HORN);

      // ---- legs
      for (const s of [-1, 1]) {
        const out: V = [0, 0, s];
        // fore: shoulder, elbow (bent backward), wrist, paw
        const sh = M([5.0, 10.0, s * 4.0]);
        const tucked: V = s > 0 ? [10.5, 3.5, 6.0] : [7.0, 4.0, -4.4];
        const ankleF = lerp([6.6, 1.15, s * 6.1], M(tucked), air);
        const elbow = ik(sh, ankleF, 6.2, 6.0, [-1, 0.25, s * 0.55]);
        limb(body, sh, elbow, 2.15, 1.55, out, SKIN);
        limb(body, elbow, ankleF, 1.5, 1.0, out, SKIN);
        // hind: hip, knee (forward), hock (raised behind the foot), foot
        const hip = M([-7.5, 9.5, s * 3.8]);
        const ankleH = lerp([-6.0, 1.15, s * 6.4], M([-12.5, 3.0, s * 4.6]), air);
        const hock = add(ankleH, lerp([-2.6, 3.4, 0], Mdir([-3.6, 1.6, 0]), air));
        const knee = ik(hip, hock, 6.0, 5.6, [1, 0.15, s * 0.7]);
        limb(body, hip, knee, 3.1, 2.0, out, SKIN, 0.82);
        limb(body, knee, hock, 1.85, 1.15, out, SKIN);
        limb(body, hock, ankleH, 1.1, 0.95, out, SKIN);
        for (const [ank, big] of [[ankleF, 1], [ankleH, 1.12]] as [V, number][]) {
          // in the air the feet hang: the toes point down and forward
          const fd: V = norm(lerp([1, -0.12, s * 0.12], Mdir([0.75, -0.65, s * 0.1]), air));
          const fs: V = norm(cross(fd, [0, 1, 0])), fu = cross(fs, fd);
          const foot = (q: V): V => mad(mad(mad(ank, fd, q[0] * big), fu, q[1] * big), fs, q[2] * big);
          tube(body, [foot([-0.9, 0.1, 0]), foot([0.8, -0.1, 0]), foot([2.3, -0.45, 0])], [[0.85, 1.0], [0.85, 1.35], [0.55, 1.4]].map(([a, c]) => [a * big, c * big] as [number, number]), { seg: 10, side: fs, col: SKIN, caps: [true, true] });
          for (const o of [-1, 0, 1]) {
            const a = o * 0.42, td: V = [Math.cos(a), -0.1, Math.sin(a)];
            const b0 = foot([2.0, -0.45, o * 0.8]), b1 = foot([2.0 + 1.9 * td[0], -0.62, o * 0.8 + 1.9 * td[2]]);
            tube(body, [b0, b1], [[0.52 * big, 0.5 * big], [0.42 * big, 0.4 * big]], { seg: 8, side: fs, col: SKIN, caps: [false, true] });
            cone(body, b1, mul(fu, 0.36 * big), mul(fs, 0.3 * big), foot([2.0 + 3.5 * td[0], -0.95 - 0.5 * air, o * 0.8 + 3.5 * td[2]]), CLAW);
          }
          cone(body, foot([-0.6, 0, -s * 0.9 * (ank === ankleF ? 1 : 0)]), mul(fu, 0.3), mul(fd, 0.3), foot([-1.6, -0.5, -s * 1.6 * (ank === ankleF ? 1 : 0)]), CLAW);
        }
      }

      // ---- wings
      for (const s of [-1, 1]) {
        const beat = Math.sin(flap), late = Math.sin(flap - 0.95), vel = Math.cos(flap - 0.6);
        const fold = mixn(mixn(0.5, 0.04, spread), 0, air);
        const dih = mixn(mixn(0.5, 0.24, spread) + 0.03 * breath + 0.04 * Math.sin(t * 0.8 + s), 0.12 + 0.5 * beat, air);
        const dihHand = mixn(dih - 0.12, 0.1 + 0.68 * late, air);
        const bend = mixn(-0.03, -0.2 * vel, air); // the finger tips trail the stroke
        const sag = mixn(-0.06, 0.1 + 0.1 * vel, air) * (1 - 0.6 * fold);
        const S: V = [5.5, 15.4, s * 3.0];
        /** Wing space (span outward, forward, off the wing's plane) to body space, for a dihedral angle. */
        const wv = (sp2: number, f: number, n: number, d: number): V => [f, sp2 * Math.sin(d) + n * Math.cos(d), s * (sp2 * Math.cos(d) - n * Math.sin(d))];
        const a1 = mixn(-8, -58, fold) * DEG, a2 = mixn(22, 78, fold) * DEG, th0 = mixn(-12, -80, fold) * DEG, fan = mixn(1, 0.32, fold);
        const elbowW: [number, number] = [HUMERUS * Math.cos(a1), HUMERUS * Math.sin(a1)];
        const wristW: [number, number] = [elbowW[0] + FOREARM * Math.cos(a2), elbowW[1] + FOREARM * Math.sin(a2)];
        const shoulder = M(S), elbow = M(add(S, wv(elbowW[0], elbowW[1], 0, dih))), wristB = add(S, wv(wristW[0], wristW[1], 0, dih)), wrist = M(wristB);
        const nrm = Mdir(wv(0, 0, 1, dihHand));
        const fingers: V[][] = FINGER_LEN.map((L, i) => {
          const pts: V[] = [wrist];
          let ps = 0, pf = 0;
          for (let j = 1; j <= FINGER_K; j++) {
            const th = th0 + FINGER_ANG[i] * fan * DEG - FINGER_CURVE[i] * DEG * ((j - 0.5) / FINGER_K);
            ps += (L / FINGER_K) * Math.cos(th); pf += (L / FINGER_K) * Math.sin(th);
            pts.push(M(add(wristB, wv(ps, pf, bend * L * (j / FINGER_K) ** 2 * (1 + 0.25 * i), dihHand))));
          }
          return pts;
        });
        const attach = M([-8.5, 13.6, s * 3.3]);
        const side: V = [0, 0, s];
        limb(body, shoulder, elbow, 1.9, 1.3, side, SKIN);
        limb(body, elbow, wrist, 1.3, 0.85, side, SKIN);
        fingers.forEach((f) => tube(body, f, f.map((_, j) => { const r = mixn(0.62, 0.12, j / FINGER_K); return [r, r] as [number, number]; }), { seg: 6, side: nrm, col: BONE, tex: 0.35, caps: [false, true] }));
        cone(body, wrist, mul(nrm, 0.5), Mdir(wv(0.5, 0, 0, dihHand)), M(add(wristB, wv(1.4, 3.0, 0.5, dihHand))), CLAW);

        const along = (pts: V[], q: number): V => { const x = Math.min(0.9999, Math.max(0, q)) * (pts.length - 1), i = Math.floor(x); return lerp(pts[i], pts[i + 1], x - i); };
        const stops = (pts: V[], at: number[]) => (q: number): V => {
          for (let i = 0; i < at.length - 1; i++) if (q <= at[i + 1]) return lerp(pts[i], pts[i + 1], (q - at[i]) / (at[i + 1] - at[i]));
          return pts[pts.length - 1];
        };
        /** A stretch of membrane between two edges `A` and `B` that share their start; the far edge hangs in an arc between their ends. */
        const panel = (A: (q: number) => V, B: (q: number) => V, u0: number, u1: number, scallop: number, sagK: number, v0 = 0, v1 = 1): void => {
          const T = 12, W = 8, at = wing.nv;
          for (let i = 0; i <= T; i++) for (let j = 0; j <= W; j++) {
            const q = i / T, w = j / W, qe = q * (1 - scallop * Math.sin(Math.PI * w));
            const a = A(qe), b2 = B(qe);
            const pnt = mad(lerp(a, b2, w), nrm, sagK * Math.sin(Math.PI * w) * qe * len(sub(b2, a)));
            wing.vert(pnt, nrm, mixn(u0, u1, w), mixn(v0, v1, q), 0, 9, 0, 0, SKIN);
          }
          const P = (i: number, j: number): V => { const o = (at + i * (W + 1) + j) * 3; return [wing.pos[o], wing.pos[o + 1], wing.pos[o + 2]]; };
          for (let i = 0; i <= T; i++) for (let j = 0; j <= W; j++) {
            const i0 = Math.max(1, i);
            let n2 = norm(cross(sub(P(Math.min(T, i0 + 1), j), P(i0 - 1, j)), sub(P(i0, Math.min(W, j + 1)), P(i0, Math.max(0, j - 1)))));
            if (dotv(n2, nrm) < 0) n2 = mul(n2, -1);
            wing.nor.set(n2, (at + i * (W + 1) + j) * 3);
          }
          for (let i = 0; i < T; i++) for (let j = 0; j < W; j++) {
            const a = at + i * (W + 1) + j, c = a + W + 1;
            wing.tri(a, c, a + 1); wing.tri(a + 1, c, c + 1);
          }
        };
        for (let i = 0; i < 3; i++) panel((q) => along(fingers[i], q), (q) => along(fingers[i + 1], q), WING_U[i], WING_U[i + 1], 0.17, sag);
        panel((q) => along(fingers[3], q), stops([wrist, elbow, shoulder, attach], [0, 0.3, 0.52, 1]), WING_U[3], WING_U[4], 0.1, sag * 0.6);
        // the small skin in front of the elbow
        const lead = M(add(S, [2.2, 0.6, 0]));
        panel((q) => lerp(wrist, lead, q), stops([wrist, elbow, shoulder], [0, 0.55, 1]), 0.24, 0.36, 0, -0.08, 0.25, 0.6);
      }

      // ---- upload
      for (const [g, b] of [[bodyGeo, body], [wingGeo, wing]] as [BufferGeometry, Buf][]) {
        for (const name of Object.keys(g.attributes)) (g.attributes[name] as BufferAttribute).needsUpdate = true;
        if (first) g.index!.needsUpdate = true;
        g.setDrawRange(0, b.ni);
      }
      first = false; started = true;

      // the ground shadow: under the trunk, wider and paler in the air
      const sw = (22 + 80 * Math.max(air, spread * 0.4)) * k, sl = (44 + 10 * air) * k;
      shadow.position.set(p.x - 6 * k * cf, 0.03, p.z - 6 * k * sf);
      shadow.rotation.set(-Math.PI / 2, 0, p.face);
      shadow.scale.set(sl, sw, 1);
      mats.shade.value = 0.5 - 0.22 * air;
      mats.glow.value = 0.85 + 0.3 * roar;
      mats.time.value = t;
    },
  };
}
