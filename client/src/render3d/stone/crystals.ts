// The crystals of the caves as geometry (#380 part 2): clusters of six-sided shards with pointed tips at the wall's foot, one mesh per
// chunk (view.ts) with its own material (crystalNodes.ts). A big cluster stands where the server's crystal light is and is whole while
// that light is on; broken it is stumps and splinters. Small ones are decoration. Pure numbers; every one a first guess.
import { CHUNK } from './grid';
import type { Marks } from './place';

/** The tallest shard of a big and of a small cluster, in tiles. */
export const BIG_SIZE = 0.95, SMALL_SIZE = 0.25;
/** A broken cluster has no vertex above this share of its size. */
export const BROKEN_TOP = 0.24;
/** A big cluster's foot and its light stand this far in front of the wall, the light at this height (tiles). */
export const CRYSTAL_STAND = 0.26, CRYSTAL_Y = 0.45;
/** The slow pulse: its rate (rad/s), shared by the light and the gem's glow. */
export const CRYSTAL_RATE = 1.3;
/** The glow of a small or broken cluster against a whole big one's: a glimmer on the crystal itself. */
const GLIMMER = 0.3;
/** A shard's radius and reach from the cluster's middle, as shares of the size: the main shard, then the others (from, range). */
const MAIN_R = 0.1, SIDE_R = [0.045, 0.045], SIDE_OFF = [0.1, 0.13], SIDE_H = [0.3, 0.42], SIDE_LEAN = [0.28, 0.4];
/** The tip's length in radii, the shaft's taper to its top ring, and how deep a shard's base lies under the floor (share of the size). */
const TIP = 2.4, TAPER = 0.82, SUNK = 0.05;
/** The glow weight (0..1) at a shard's base ring, at a face's middle, at the top ring and at the tip: bright edges and tips, a darker body. */
const GLOW = { base: 0.22, face: 0.12, top: 0.7, tip: 1 } as const;

export interface CrystalArrays { position: Float32Array; normal: Float32Array; /** glow weight, tint 0..1, pulse phase */ gem: Float32Array; /** the ground point the sight is read at */ foot: Float32Array; index: Uint32Array }

type V = [x: number, y: number, z: number, glow: number];

/**
 * A cluster of six-sided shards with pointed tips round the origin, y up, fanning toward +x (the room; the wall is behind it); the
 * tallest is `size` high. `broken`: the same shards as short stumps with slanted break faces, and splinters lying round them.
 * Every shard is a closed body with flat faces. Position, normal and a glow weight per vertex.
 */
export function crystalCluster(seed: number, size: number, broken: boolean): { position: Float32Array; normal: Float32Array; glow: Float32Array; index: Uint32Array } {
  const position: number[] = [], normal: number[] = [], glow: number[] = [];
  let s = (seed * 7919) | 0;
  const r = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const tri = (a: V, b: V, c: V): void => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const v of [a, b, c]) {
      position.push(v[0], v[1], v[2]);
      normal.push(n[0] / l, n[1] / l, n[2] / l);
      glow.push(v[3]);
    }
  };
  /**
   * One shard from `base` along the unit `axis`: a six-sided shaft of `len` and `rad`, each side four triangles round its middle (the
   * middle glows less than the edges), a bottom, and a tip `tip` long; `tip` 0: a break face instead, slanted by `slant` radii.
   */
  const shard = (base: number[], axis: number[], len: number, rad: number, turn: number, tip: number, slant: number, g: number): void => {
    const ref = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = [axis[1] * ref[2] - axis[2] * ref[1], axis[2] * ref[0] - axis[0] * ref[2], axis[0] * ref[1] - axis[1] * ref[0]];
    const ul = Math.hypot(u[0], u[1], u[2]);
    u = [u[0] / ul, u[1] / ul, u[2] / ul];
    const v = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]]; // u x v = axis
    /** The ring at `along` the axis; `sl` tilts it (the break face). */
    const ring = (along: number, rr: number, gl: number, sl: number): V[] => Array.from({ length: 6 }, (_, k) => {
      const a = turn + (k * Math.PI) / 3, c = Math.cos(a) * rr, sn = Math.sin(a) * rr, h = along + sl * rad * Math.cos(a - turn * 3);
      return [base[0] + axis[0] * h + u[0] * c + v[0] * sn, base[1] + axis[1] * h + u[1] * c + v[1] * sn, base[2] + axis[2] * h + u[2] * c + v[2] * sn, gl * g];
    });
    const on = (along: number, gl: number): V => [base[0] + axis[0] * along, base[1] + axis[1] * along, base[2] + axis[2] * along, gl * g];
    const lo = ring(0, rad, GLOW.base, 0), hi = ring(len, rad * (tip ? TAPER : 1), GLOW.top, tip ? 0 : slant);
    const foot = on(0, 0), end = tip ? on(len + tip, GLOW.tip) : on(len, GLOW.tip);
    for (let k = 0; k < 6; k++) {
      const k2 = (k + 1) % 6;
      const m: V = [0, 1, 2, 3].map((i) => (i < 3 ? (lo[k][i] + lo[k2][i] + hi[k][i] + hi[k2][i]) / 4 : GLOW.face * g)) as V;
      tri(lo[k], lo[k2], m);
      tri(lo[k2], hi[k2], m);
      tri(hi[k2], hi[k], m);
      tri(hi[k], lo[k], m);
      tri(hi[k], hi[k2], end);
      tri(lo[k2], lo[k], foot);
    }
  };
  const n = 5 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    // the same numbers whole and broken: a stump stands where its shard stood
    const ang = i === 0 ? (r() - 0.5) * 0.6 : ((i - 1) / (n - 2) - 0.5) * 2.7 + (r() - 0.5) * 0.5;
    const off = i === 0 ? 0 : (SIDE_OFF[0] + r() * SIDE_OFF[1]) * size;
    const rad = (i === 0 ? MAIN_R : SIDE_R[0] + r() * SIDE_R[1]) * size;
    const h = i === 0 ? size : (SIDE_H[0] + r() * SIDE_H[1]) * size;
    const lean = i === 0 ? 0.04 + r() * 0.08 : SIDE_LEAN[0] + r() * SIDE_LEAN[1];
    const turn = r() * 1.05, cut = 0.05 + r() * 0.07, slant = (r() - 0.5) * 1.6;
    const axis = [Math.cos(ang) * Math.sin(lean), Math.cos(lean), Math.sin(ang) * Math.sin(lean)];
    // sunk so far that the leaning base ring stays under the floor
    const base = [Math.cos(ang) * off, -(SUNK * size + rad * Math.sin(lean)), Math.sin(ang) * off];
    if (broken) shard(base, axis, cut * size + (SUNK * size + rad * Math.sin(lean)), rad, turn, 0, slant, 1);
    else {
      // the tip ends at height `h`: the shaft is what is left of the way there
      const whole = (h - base[1]) / axis[1];
      shard(base, axis, whole - rad * TIP, rad, turn, rad * TIP, 0, 1);
    }
  }
  if (broken) {
    const lying = 3 + Math.floor(r() * 3);
    for (let i = 0; i < lying; i++) {
      const ang = (r() - 0.5) * 2.8, off = (0.2 + r() * 0.3) * size, dir = r() * Math.PI * 2, rad = (0.02 + r() * 0.02) * size, len = (0.07 + r() * 0.1) * size;
      const up = 0.06, flat = Math.sqrt(1 - up * up);
      shard([Math.cos(ang) * off, rad * 0.55, Math.sin(ang) * off], [Math.cos(dir) * flat, up, Math.sin(dir) * flat], len, rad, r(), rad * TIP, 0, 0.8);
    }
  }
  const count = position.length / 3;
  return { position: new Float32Array(position), normal: new Float32Array(normal), glow: new Float32Array(glow), index: Uint32Array.from({ length: count }, (_, i) => i) };
}

/** A shard's foot: a big one stands in front of its wall, a small one where it was placed. */
const footOf = (b: Marks['shards'][number]): [number, number] => (b.big ? [b.x + b.nx * CRYSTAL_STAND, b.z + b.nz * CRYSTAL_STAND] : [b.x, b.z]);

/** The chunk a shard's cluster belongs to (its foot's). */
export function crystalChunkOf(b: Marks['shards'][number]): [cx: number, cz: number] {
  const [x, z] = footOf(b);
  return [Math.floor(x / CHUNK), Math.floor(z / CHUNK)];
}

/**
 * The clusters of the shards whose foot lies in chunk (cx, cz), turned out of their wall; null without one. `broken` is asked for each
 * big shard's light: whole it glows, broken (and every small one) it only glimmers.
 */
export function buildCrystalChunk(marks: Marks, broken: (lightId: number) => boolean, cx: number, cz: number): CrystalArrays | null {
  const position: number[] = [], normal: number[] = [], gem: number[] = [], foot: number[] = [];
  for (const b of marks.shards) {
    const [ccx, ccz] = crystalChunkOf(b);
    if (ccx !== cx || ccz !== cz) continue;
    const [fx, fz] = footOf(b), seed = Math.imul(Math.floor(b.x * 64), 73856093) ^ Math.imul(Math.floor(b.z * 64), 19349663);
    const off = b.big && b.lightId !== undefined && broken(b.lightId);
    const c = crystalCluster(seed, b.big ? BIG_SIZE : SMALL_SIZE, off);
    // out of the wall is the cluster's +x; a shard without a wall keeps the builder's frame
    const nx = b.nx || b.nz ? b.nx : 1, nz = b.nx || b.nz ? b.nz : 0;
    const tint = ((seed >>> 8) & 255) / 255, power = (b.big && !off ? 1 : GLIMMER) * (0.8 + 0.2 * (((seed >>> 16) & 255) / 255));
    const phase = b.lightId !== undefined ? b.lightId * 1.7 : tint * 6.28;
    // the sight is read on the floor in front of the wall, not at the wall's own cell
    const sx = fx + nx * (b.big ? 0.5 - CRYSTAL_STAND : 0.3), sz = fz + nz * (b.big ? 0.5 - CRYSTAL_STAND : 0.3);
    for (let i = 0; i < c.glow.length; i++) {
      const [x, y, z] = [c.position[i * 3], c.position[i * 3 + 1], c.position[i * 3 + 2]];
      position.push(fx + x * nx - z * nz, y, fz + x * nz + z * nx);
      normal.push(c.normal[i * 3] * nx - c.normal[i * 3 + 2] * nz, c.normal[i * 3 + 1], c.normal[i * 3] * nz + c.normal[i * 3 + 2] * nx);
      gem.push(c.glow[i] * power, tint, phase);
      foot.push(sx, sz);
    }
  }
  if (!position.length) return null;
  return { position: new Float32Array(position), normal: new Float32Array(normal), gem: new Float32Array(gem), foot: new Float32Array(foot), index: Uint32Array.from({ length: position.length / 3 }, (_, i) => i) };
}
