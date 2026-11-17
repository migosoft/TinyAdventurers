// Shared shapes of the effects (#308), ported from the approved try-out (`magicStage.ts`, branch spike/308-magic-fx) to the scalar,
// allocation-free form: every shape writes into an `FxTris`; the scratch arrays below are reused.
import type { Cam } from '../camera';
import { hash3, noise3 } from './rand';
import type { FxTris } from './tris';

export type V3 = readonly [number, number, number];
export type MV3 = [number, number, number];
export interface Axes { right: V3; up: V3 }
export interface MAxes { right: MV3; up: MV3 }

export const PX = 1 / 16;
export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
export const easeOut = (v: number): number => 1 - (1 - clamp01(v)) ** 3;

/** The camera's screen-right and screen-up, for the small squares that face it. */
export function screenAxes(cam: Cam, out: MAxes): MAxes {
  const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
  out.right[0] = c; out.right[1] = 0; out.right[2] = s;
  out.up[0] = s * sp; out.up[1] = cp; out.up[2] = -c * sp;
  return out;
}

/** A square facing the camera, `size` tiles across, centred on (x, y, z). */
export function dot(T: FxTris, ax: Axes, x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number): void {
  const h = size / 2, rx = ax.right[0] * h, ry = ax.right[1] * h, rz = ax.right[2] * h, ux = ax.up[0] * h, uy = ax.up[1] * h, uz = ax.up[2] * h;
  const x0 = x - rx - ux, y0 = y - ry - uy, z0 = z - rz - uz;
  const x1 = x + rx - ux, y1 = y + ry - uy, z1 = z + rz - uz;
  const x2 = x + rx + ux, y2 = y + ry + uy, z2 = z + rz + uz;
  const x3 = x - rx + ux, y3 = y - ry + uy, z3 = z - rz + uz;
  T.tri(x0, y0, z0, x1, y1, z1, x2, y2, z2, r, g, b, a);
  T.tri(x0, y0, z0, x2, y2, z2, x3, y3, z3, r, g, b, a);
}

/** A line from `a` to `b`, `w` tiles wide, turned to the camera; alpha `a0` at `a`, `a1` at `b`. */
export function streak(T: FxTris, ax: Axes, a: V3, b: V3, w: number, rgb: V3, a0: number, a1: number): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const sr = dx * ax.right[0] + dy * ax.right[1] + dz * ax.right[2], su = dx * ax.up[0] + dy * ax.up[1] + dz * ax.up[2];
  const l = Math.hypot(sr, su) || 1, nr = (-su / l) * w / 2, nu = (sr / l) * w / 2;
  const ox = ax.right[0] * nr + ax.up[0] * nu, oy = ax.right[1] * nr + ax.up[1] * nu, oz = ax.right[2] * nr + ax.up[2] * nu;
  const p0x = a[0] - ox, p0y = a[1] - oy, p0z = a[2] - oz, p1x = a[0] + ox, p1y = a[1] + oy, p1z = a[2] + oz;
  const p2x = b[0] + ox, p2y = b[1] + oy, p2z = b[2] + oz, p3x = b[0] - ox, p3y = b[1] - oy, p3z = b[2] - oz;
  T.tri(p0x, p0y, p0z, p1x, p1y, p1z, p2x, p2y, p2z, rgb[0], rgb[1], rgb[2], a0, a0, a1);
  T.tri(p0x, p0y, p0z, p2x, p2y, p2z, p3x, p3y, p3z, rgb[0], rgb[1], rgb[2], a0, a1, a1);
}

/** A flat ring on the ground at height `y`, from `r0` (alpha `aIn`) to `r1` (alpha `aOut`). */
export function groundRing(T: FxTris, x: number, z: number, y: number, r0: number, r1: number, rgb: V3, aIn: number, aOut: number, steps = 32): void {
  const R = rgb[0], G = rgb[1], B = rgb[2];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2, b = ((i + 1) / steps) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    const i0x = x + ca * r0, i0z = z + sa * r0, o0x = x + ca * r1, o0z = z + sa * r1;
    const i1x = x + cb * r0, i1z = z + sb * r0, o1x = x + cb * r1, o1z = z + sb * r1;
    T.tri(i0x, y, i0z, o0x, y, o0z, o1x, y, o1z, R, G, B, aIn, aOut, aOut);
    T.tri(i0x, y, i0z, o1x, y, o1z, i1x, y, i1z, R, G, B, aIn, aOut, aIn);
  }
}

/** A flat disc on the ground, alpha `aMid` at the centre and `aEdge` at the rim. */
export function groundDisc(T: FxTris, x: number, z: number, y: number, r: number, rgb: V3, aMid: number, aEdge: number, steps = 24): void {
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2, b = ((i + 1) / steps) * Math.PI * 2;
    T.tri(x, y, z, x + Math.cos(a) * r, y, z + Math.sin(a) * r, x + Math.cos(b) * r, y, z + Math.sin(b) * r, rgb[0], rgb[1], rgb[2], aMid, aEdge, aEdge);
  }
}

// ---- colours ----
const FIRE_T = [0, 0.28, 0.55, 0.8, 1];
const FIRE_C: V3[] = [[0.1, 0.085, 0.08], [0.5, 0.09, 0.02], [1, 0.45, 0.06], [1, 0.82, 0.3], [1, 0.97, 0.8]];
/** The fire ramp (dark, red, orange, yellow, white-hot) at heat `h`, written into `out`. */
export function fireColour(h: number, out: MV3): MV3 {
  h = clamp01(h);
  for (let i = 1; i < FIRE_T.length; i++) {
    if (h <= FIRE_T[i]) {
      const k = (h - FIRE_T[i - 1]) / (FIRE_T[i] - FIRE_T[i - 1]), c0 = FIRE_C[i - 1], c1 = FIRE_C[i];
      out[0] = lerp(c0[0], c1[0], k); out[1] = lerp(c0[1], c1[1], k); out[2] = lerp(c0[2], c1[2], k);
      return out;
    }
  }
  const c = FIRE_C[FIRE_C.length - 1];
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  return out;
}

// ---- icospheres, built once ----
export interface Ball { n: number; v: Float32Array; f: Uint16Array }
function icosphere(split: number): Ball {
  const p = (1 + Math.sqrt(5)) / 2;
  let v: number[][] = [[-1, p, 0], [1, p, 0], [-1, -p, 0], [1, -p, 0], [0, -1, p], [0, 1, p], [0, -1, -p], [0, 1, -p], [p, 0, -1], [p, 0, 1], [-p, 0, -1], [-p, 0, 1]];
  let f: number[][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const norm = (a: number[]): number[] => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
  v = v.map(norm);
  for (let k = 0; k < split; k++) {
    const mid = new Map<string, number>();
    const m = (a: number, b: number): number => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      let i = mid.get(key);
      if (i === undefined) { i = v.length; v.push(norm([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2])); mid.set(key, i); }
      return i;
    };
    const nf: number[][] = [];
    for (const [a, b, c] of f) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  return { n: v.length, v: Float32Array.from(v.flat()), f: Uint16Array.from(f.flat()) };
}
export const BALL1 = icosphere(1);
export const BALL2 = icosphere(2);

const bx = new Float32Array(BALL2.n), by = new Float32Array(BALL2.n), bz = new Float32Array(BALL2.n);
const bh = new Float32Array(BALL2.n), ba = new Float32Array(BALL2.n);
const fc0: MV3 = [0, 0, 0], fc1: MV3 = [0, 0, 0], fc2: MV3 = [0, 0, 0];

/** A lumpy ball of fire of mean radius `r` at (cx, cy, cz) at time `t`: `heat` shifts the ramp, `hole` eats it away, `floor` keeps it above the ground. */
export function fireBall(T: FxTris, ball: Ball, cx: number, cy: number, cz: number, r: number, t: number, seed: number, heat: number, hole: number, floor: boolean): void {
  const n = ball.n, v = ball.v;
  for (let i = 0; i < n; i++) {
    const dx = v[i * 3], dy = v[i * 3 + 1], dz = v[i * 3 + 2];
    const nz = noise3(dx * 2.1 + seed, dy * 2.1 - t * 1.6, dz * 2.1 + seed * 0.7) * 0.65 + noise3(dx * 4.7 - seed, dy * 4.7 - t * 2.9, dz * 4.7) * 0.35;
    const rr = r * (0.7 + 0.55 * nz);
    bx[i] = cx + dx * rr; by[i] = floor ? Math.max(0.03, cy + dy * rr) : cy + dy * rr; bz[i] = cz + dz * rr;
    bh[i] = heat + (nz - 0.5) * 1.1 + dy * -0.08;
    ba[i] = clamp01((1 - hole) * 1.6 + (nz - 0.5) * 2.4 - hole * 0.6);
  }
  const f = ball.f;
  for (let k = 0; k < f.length; k += 3) {
    const a = f[k], b = f[k + 1], c = f[k + 2];
    fireColour(bh[a], fc0); fireColour(bh[b], fc1); fireColour(bh[c], fc2);
    T.tri3(bx[a], by[a], bz[a], bx[b], by[b], bz[b], bx[c], by[c], bz[c],
      fc0[0], fc0[1], fc0[2], fc1[0], fc1[1], fc1[2], fc2[0], fc2[1], fc2[2],
      ba[a] * (bh[a] < 0.3 ? 0.75 : 0.96), ba[b] * (bh[b] < 0.3 ? 0.75 : 0.96), ba[c] * (bh[c] < 0.3 ? 0.75 : 0.96));
  }
}

const ICE_SUN: V3 = [-0.45, 0.8, -0.4];
const cr = new Float64Array(12);
/** A crystal from `base` along the unit `dir`, `len` long and `w` wide: a four-sided spike with a short back end, shaded per face. */
export function crystal(T: FxTris, base: V3, dir: V3, len: number, w: number, alpha: number): void {
  const upx = Math.abs(dir[1]) > 0.9 ? 1 : 0, upy = upx ? 0 : 1;
  // s = dir x up, normalised; u = s x dir
  let sx = dir[1] * 0 - dir[2] * upy, sy = dir[2] * upx - dir[0] * 0, sz = dir[0] * upy - dir[1] * upx;
  const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
  const ux = sy * dir[2] - sz * dir[1], uy = sz * dir[0] - sx * dir[2], uz = sx * dir[1] - sy * dir[0];
  const mid = 0.28 * len;
  const mx = base[0] + dir[0] * mid, my = base[1] + dir[1] * mid, mz = base[2] + dir[2] * mid;
  for (let i = 0; i < 4; i++) {
    const a = i === 0 ? 1 : i === 2 ? -1 : 0, b = i === 1 ? 1 : i === 3 ? -1 : 0;
    cr[i * 3] = mx + (sx * a + ux * b) * w; cr[i * 3 + 1] = my + (sy * a + uy * b) * w; cr[i * 3 + 2] = mz + (sz * a + uz * b) * w;
  }
  const tx = base[0] + dir[0] * len, ty = base[1] + dir[1] * len, tz = base[2] + dir[2] * len;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    face(T, cr[i * 3], cr[i * 3 + 1], cr[i * 3 + 2], cr[j * 3], cr[j * 3 + 1], cr[j * 3 + 2], tx, ty, tz, alpha);
    face(T, cr[j * 3], cr[j * 3 + 1], cr[j * 3 + 2], cr[i * 3], cr[i * 3 + 1], cr[i * 3 + 2], base[0], base[1], base[2], alpha);
  }
}
function face(T: FxTris, ax: number, ay: number, az: number, bx_: number, by_: number, bz_: number, cx: number, cy: number, cz: number, alpha: number): void {
  const e1x = bx_ - ax, e1y = by_ - ay, e1z = bz_ - az, e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x, nl = Math.hypot(nx, ny, nz) || 1;
  const d = nx * ICE_SUN[0] + ny * ICE_SUN[1] + nz * ICE_SUN[2];
  const k = clamp01(0.5 + 0.6 * Math.abs(d / nl) * Math.sign(d || 1));
  T.tri(ax, ay, az, bx_, by_, bz_, cx, cy, cz, lerp(0.2, 0.93, k), lerp(0.45, 0.98, k), lerp(0.85, 1, k), alpha);
}

/** The height (tiles) a mote rests at above the ground (y 0): just over the floor so it does not sink into it. A drawer whose floor is
 *  elsewhere (the water's surface, below 0) passes its own `floor`; a mote must start at or above its floor. */
export const MOTE_FLOOR = 0.03;

/** A point thrown from `p0` with velocity `v` under gravity `g`, bouncing once on the floor (y `floor`, default 0.03); written into `out`. */
export function thrown(p0: V3, v: V3, g: number, t: number, out: MV3, floor = MOTE_FLOOR): MV3 {
  let y = p0[1] + v[1] * t - 0.5 * g * t * t;
  if (y < floor && g <= 0) y = floor;   // no gravity: no bounce, it only rests on the floor
  else if (y < floor) {
    const tl = (v[1] + Math.sqrt(Math.max(0, v[1] * v[1] + 2 * g * (p0[1] - floor)))) / g, t2 = t - tl, vy = (g * tl - v[1]) * 0.35;
    y = Math.max(floor, floor + vy * t2 - 0.5 * g * t2 * t2);
  }
  out[0] = p0[0] + v[0] * t; out[1] = y; out[2] = p0[2] + v[2] * t;
  return out;
}

/** The generic burst of motes or streaks (the burst rows of the design's §6). */
export interface BurstSpec {
  x: number; y: number; z: number; n: number;
  speed: readonly [number, number];
  /** Elevation range in radians. */
  up: readonly [number, number];
  life: readonly [number, number];
  g: number; drag: number; size: number;
  /** 0xrrggbb colours; a mote takes one by its seed. */
  colours: readonly number[];
  streak: boolean;
  /** The height the motes bounce on and never sink below; default `MOTE_FLOOR`. `y` must not be below it. */
  floor?: number;
}
const bv: MV3 = [0, 0, 0], bp: MV3 = [0, 0, 0], bq: MV3 = [0, 0, 0], bo: MV3 = [0, 0, 0], bc: MV3 = [0, 0, 0];
/** Position of a mote `t` seconds old: thrown under gravity, with drag slowing the launch velocity (no bounce then, only the floor). */
function mote(spec: BurstSpec, v: V3, t: number, out: MV3): MV3 {
  bo[0] = spec.x; bo[1] = spec.y; bo[2] = spec.z;
  const floor = spec.floor ?? MOTE_FLOOR;
  if (spec.drag <= 0) return thrown(bo, v, spec.g, t, out, floor);
  const s = (1 - Math.exp(-spec.drag * t)) / spec.drag;
  out[0] = spec.x + v[0] * s; out[2] = spec.z + v[2] * s;
  out[1] = Math.max(floor, spec.y + v[1] * s - 0.5 * spec.g * t * t);
  return out;
}
/** `b.n` motes at `age` seconds after the start, each a pure function of (`seed`, its index). Nothing is drawn after the longest life. */
export function burst(T: FxTris, ax: Axes, b: BurstSpec, age: number, seed: number): void {
  if (age < 0 || age > b.life[1]) return;
  const sd = seed | 0;
  for (let i = 0; i < b.n; i++) {
    const life = lerp(b.life[0], b.life[1], hash3(sd, i, 3));
    if (age > life) continue;
    const az = hash3(sd, i, 0) * Math.PI * 2, el = lerp(b.up[0], b.up[1], hash3(sd, i, 1)), sp = lerp(b.speed[0], b.speed[1], hash3(sd, i, 2));
    bv[0] = Math.cos(az) * Math.cos(el) * sp; bv[1] = Math.sin(el) * sp; bv[2] = Math.sin(az) * Math.cos(el) * sp;
    const col = b.colours[Math.floor(hash3(sd, i, 4) * b.colours.length) % b.colours.length];
    bc[0] = (col >> 16) / 255; bc[1] = ((col >> 8) & 255) / 255; bc[2] = (col & 255) / 255;
    const k = age / life, a = 1 - k * k;
    mote(b, bv, age, bp);
    if (b.streak) {
      mote(b, bv, Math.max(0, age - 0.045), bq);
      streak(T, ax, bq, bp, b.size, bc, 0, a * 0.95);
    } else dot(T, ax, bp[0], bp[1], bp[2], b.size, bc[0], bc[1], bc[2], a);
  }
}
