// The wall torch as geometry (#391): an iron holder (plate, arm, a leaning wooden shaft with bands, a basket with a crown of spikes) and
// a flame with volume, built per chunk like the crystals (stone/crystals.ts). The flame's motion and both materials are the view's
// business; the `flame` attribute is what the motion reads. Pure numbers; every one a first guess until the look is judged.
import { faceNormal, outOfWall } from '../stone/crystals';
import { CHUNK } from '../stone/grid';

/** Tiles. The flame's axis stands this far in front of the wall cell's edge; its foot is at FLAME_BASE_Y, it is FLAME_H high and FLAME_R wide at size 1. */
export const FLAME_STAND = 0.3, FLAME_BASE_Y = 1.14, FLAME_H = 0.44, FLAME_R = 0.115;
/** The plate: its middle's height, width along the wall, height, and how deep it is set into the stone. */
export const PLATE_Y = 0.95, PLATE_W = 0.22, PLATE_H = 0.34, PLATE_SINK = 0.03;
/** The plate stands this far out of the wall, and its front is this much smaller on every side (a bevel). */
const PLATE_OUT = 0.02, PLATE_BEVEL = 0.02;
/** Colours (pack palette): iron, its lighter edges (bands, hoop, spikes), wood, the fuel in the basket out and burning. */
const IRON = 0x2a2326, IRON_EDGE = 0x4a4048, WOOD = 0x8a5a34, CHARRED = 0x151213, EMBER = 0x8a3516;
/** The torch leans this far out of the wall (rad from upright). */
const LEAN = 0.32;
/** Along the torch's axis, down from the flame's foot: the fuel the cage holds, the iron dish under it, the shaft. */
const CAGE_H = 0.06, DISH_H = 0.05, SHAFT_L = 0.46;
/** Half-widths: the shaft, its bands, the dish's rim, the fuel's top. All six-sided. */
const SHAFT_R = 0.026, BAND_R = 0.036, DISH_R = 0.065, FUEL_R = 0.052, SIDES = 6;
/** The two bands: their middles along the shaft from its foot, and their length. The arm grips the upper one. */
const BANDS = [0.07, 0.27], BAND_L = 0.035;
/** The arm from the plate to the upper band: its half-widths along the wall and upright. */
const ARM = [0.018, 0.022];
/** The strut from the plate above the arm down to it: its half-width, where it starts above the arm, and where along the arm it lands (share). */
const STRUT = [0.013, 0.013], STRUT_UP = 0.19, STRUT_REACH = 0.7;
/** The cage: a bar at each corner of the dish, leaning out to CAGE_R at the hoop, which lies RIM above the fuel's top; half-widths of bar and hoop. */
const CAGE_R = 0.085, RIM = 0.015, BAR = [0.012, 0.012], HOOP = [0.01, 0.012];
/** The crown: a spike on every bar, this long along the axis, leaning this much further out, this wide at its base. */
const SPIKE_L = 0.1, SPIKE_FLARE = 0.025, SPIKE = [0.017, 0.017];

/** The flame's body, a twisted six-sided teardrop: per ring from the foot up its height share, its radius and its middle's shift off the axis (shares of FLAME_R), its heat. */
const BODY = [
  [0, 0.4, 0, 0.85],
  [0.1, 0.62, 0.03, 1],
  [0.22, 0.66, 0.06, 1],
  [0.4, 0.52, 0.1, 0.75],
  [0.56, 0.36, 0.1, 0.5],
  [0.76, 0.18, 0.12, 0.25],
];
/** Each ring's shift points this much further round than the one below (rad), so the body winds; the tip's own shift (share of FLAME_R). */
const SHIFT_TURN = 2.4, TIP_SHIFT = 0.1;
/** The tongues that lick out of the body: where round the axis (rad) and how high the tip reaches (height share). */
const TONGUES = [[0.5, 0.84], [2.7, 0.7], [4.7, 0.58]];
/** A tongue's root and middle ring: how far under its tip (height share), how far out and how wide (shares of FLAME_R), its heat. Four-sided. */
const TONGUE_ROOT = [0.45, 0.4, 0.3, 0.7], TONGUE_MID = [0.18, 0.7, 0.2, 0.4], TONGUE_SIDES = 4;
/** How far out a tongue's tip is (share of FLAME_R). */
const TONGUE_TIP = 0.82;

/** A torch of the level's marks: the point on the wall cell's edge, the wall's normal into the room, its light. */
export interface TorchMark { x: number; z: number; nx: number; nz: number; lightId: number }
export interface HolderArrays { position: Float32Array; normal: Float32Array; /** rgb 0..1 */ colour: Float32Array; /** the floor point the sight is read at */ foot: Float32Array; index: Uint32Array }
export interface FlameArrays { position: Float32Array; /** height share 0..1, heat 0 (rim) .. 1 (core), phase */ flame: Float32Array; foot: Float32Array; index: Uint32Array }

/** x, y, z and what the builder carries (the holder a colour, the flame its heat). */
type V = number[];
type Tri = (a: V, b: V, c: V) => void;

const along = (p: V, a: V, s: number): V => [p[0] + a[0] * s, p[1] + a[1] * s, p[2] + a[2] * s];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => along([0, 0, 0], a, 1 / Math.hypot(a[0], a[1], a[2]));
/** Two unit vectors across `axis` with u x v = axis: for an axis along +x, u is along the wall and v is down. */
const across = (axis: V): [V, V] => {
  const u = unit(cross(axis, Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  return [u, cross(axis, u)];
};
/** `n` points round `c`, going from u to v, each with `tail` behind its x, y, z. */
const ring = (c: V, u: V, v: V, ru: number, rv: number, n: number, turn: number, tail: number): V[] => Array.from({ length: n }, (_, k) => {
  const a = turn + (k * 2 * Math.PI) / n;
  return [...along(along(c, u, Math.cos(a) * ru), v, Math.sin(a) * rv), tail];
});
/** The skin between two rings of one count, `hi` further along the axis: two triangles a side, facing out. */
const band = (lo: V[], hi: V[], tri: Tri): void => lo.forEach((p, k) => {
  const k2 = (k + 1) % lo.length;
  tri(p, lo[k2], hi[k]);
  tri(lo[k2], hi[k2], hi[k]);
});
/** A ring closed to the point `p`: `top` at the axis' far end, else at its near end. */
const fan = (r: V[], p: V, top: boolean, tri: Tri): void => r.forEach((q, k) => (top ? tri(q, r[(k + 1) % r.length], p) : tri(r[(k + 1) % r.length], q, p)));

const arrays = (a: number[]): Float32Array => new Float32Array(a);
const inOrder = (count: number): Uint32Array => Uint32Array.from({ length: count }, (_, i) => i);

/** The holder round the origin: +x out of the wall, y up, x 0 the wall cell's edge, y 0 the floor. Plate, arm, shaft with two iron bands, basket with a crown of spikes. Out: the basket's inside is charred. */
export function torchHolder(lit: boolean): { position: Float32Array; normal: Float32Array; colour: Float32Array; index: Uint32Array } {
  const position: number[] = [], normal: number[] = [], colour: number[] = [];
  const tri: Tri = (a, b, c) => {
    const n = faceNormal(a, b, c);
    for (const v of [a, b, c]) {
      position.push(v[0], v[1], v[2]);
      normal.push(n[0], n[1], n[2]);
      colour.push((v[3] >> 16) / 255, ((v[3] >> 8) & 255) / 255, (v[3] & 255) / 255);
    }
  };
  /** A straight piece from p to q with `n` flat sides: its half-widths (see `across`) at p and at q; no `r1`: it ends in a point. Capped where asked. */
  const piece = (p: V, q: V, r0: number[], r1: number[] | null, n: number, col: number, capP = false, capQ = false): void => {
    const [u, v] = across(unit(along(q, p, -1))), k = 1 / Math.cos(Math.PI / n);
    const lo = ring(p, u, v, r0[0] * k, r0[1] * k, n, Math.PI / n, col);
    if (r1) {
      const hi = ring(q, u, v, r1[0] * k, r1[1] * k, n, Math.PI / n, col);
      band(lo, hi, tri);
      if (capQ) fan(hi, [...q, col], true, tri);
    } else fan(lo, [...q, col], true, tri);
    if (capP) fan(lo, [...p, col], false, tri);
  };
  // the torch's axis, and its stations down from the flame's foot
  const axis = [Math.sin(LEAN), Math.cos(LEAN), 0], top = [FLAME_STAND, FLAME_BASE_Y, 0];
  const dishTop = along(top, axis, -CAGE_H), shaftTop = along(dishTop, axis, -DISH_H), foot = along(shaftTop, axis, -SHAFT_L);
  const grip = along(foot, axis, BANDS[1]);

  // the plate's back lies in the stone, so it has no back face
  piece([-PLATE_SINK, PLATE_Y, 0], [PLATE_OUT, PLATE_Y, 0], [PLATE_W / 2, PLATE_H / 2], [PLATE_W / 2 - PLATE_BEVEL, PLATE_H / 2 - PLATE_BEVEL], 4, IRON, false, true);
  piece([0, grip[1], 0], grip, ARM, ARM, 4, IRON);
  piece([0, grip[1] + STRUT_UP, 0], [grip[0] * STRUT_REACH, grip[1], 0], STRUT, STRUT, 4, IRON);
  piece(foot, shaftTop, [SHAFT_R, SHAFT_R], [SHAFT_R, SHAFT_R], SIDES, WOOD, true);
  for (const s of BANDS) piece(along(foot, axis, s - BAND_L / 2), along(foot, axis, s + BAND_L / 2), [BAND_R, BAND_R], [BAND_R, BAND_R], SIDES, IRON_EDGE, true, true);
  piece(shaftTop, dishTop, [BAND_R, BAND_R], [DISH_R, DISH_R], SIDES, IRON);
  // the fuel fills the cage: it is what shows between the bars, glowing or charred
  piece(dishTop, top, [DISH_R, DISH_R], [FUEL_R, FUEL_R], SIDES, lit ? EMBER : CHARRED, false, true);
  const [u, v] = across(axis), corner = 1 / Math.cos(Math.PI / SIDES);
  const out = (p: V, k: number, r: number): V => {
    const a = ((k + 0.5) * 2 * Math.PI) / SIDES;
    return along(along(p, u, Math.cos(a) * r), v, Math.sin(a) * r);
  };
  const rim = along(top, axis, RIM);
  for (let k = 0; k < SIDES; k++) {
    const hi = out(rim, k, CAGE_R);
    piece(out(dishTop, k, DISH_R * corner), hi, BAR, BAR, 4, IRON);
    piece(hi, out(along(rim, axis, SPIKE_L), k, CAGE_R + SPIKE_FLARE), SPIKE, null, 4, IRON_EDGE);
    piece(hi, out(rim, k + 1, CAGE_R), HOOP, HOOP, 4, IRON_EDGE);
  }
  return { position: arrays(position), normal: arrays(normal), colour: arrays(colour), index: inOrder(position.length / 3) };
}

/**
 * A flame standing on the origin, `size` 1 the torch's (a candle is smaller, #382): a body with volume and several tongues, round its
 * axis. `flame` is three wide as the chunk's (height share, heat, phase 0): the builder of a chunk sets the phase.
 */
export function flameMesh(size: number): { position: Float32Array; flame: Float32Array; index: Uint32Array } {
  const position: number[] = [], flame: number[] = [], h = FLAME_H * size, r = FLAME_R * size;
  const tri: Tri = (a, b, c) => {
    for (const v of [a, b, c]) {
      position.push(v[0], v[1], v[2]);
      flame.push(Math.min(1, v[1] / h), v[3], 0);
    }
  };
  /** The point at a height share, `out` from the axis toward `dir`. */
  const at = (share: number, out: number, dir: number): V => [Math.sin(dir) * out * r, share * h, Math.cos(dir) * out * r];
  /** A level ring round that point (z to x: its skin faces out with y as the axis). */
  const level = (share: number, out: number, dir: number, rad: number, n: number, turn: number, heat: number): V[] =>
    ring(at(share, out, dir), [0, 0, 1], [1, 0, 0], rad * r, rad * r, n, turn, heat);
  // every ring is turned half a side against the one below: the facets zigzag as licks do
  const body = BODY.map(([share, rad, shift, heat], k) => level(share, shift, k * SHIFT_TURN, rad, SIDES, (k * Math.PI) / SIDES, heat));
  for (let k = 0; k + 1 < body.length; k++) band(body[k], body[k + 1], tri);
  fan(body[0], [0, 0, 0, BODY[0][3]], false, tri);
  fan(body[body.length - 1], [...at(1, TIP_SHIFT, BODY.length * SHIFT_TURN), 0], true, tri);
  for (const [dir, tip] of TONGUES) {
    // rooted inside the body, so it has no bottom
    const [root, mid] = [TONGUE_ROOT, TONGUE_MID].map(([down, out, rad, heat]) => level(tip - down, out, dir, rad, TONGUE_SIDES, dir, heat));
    band(root, mid, tri);
    fan(mid, [...at(tip, TONGUE_TIP, dir), 0], true, tri);
  }
  return { position: arrays(position), flame: arrays(flame), index: inOrder(position.length / 3) };
}

/** The chunk a torch belongs to (its wall point's). */
export function torchChunkOf(t: TorchMark): [cx: number, cz: number] {
  return [Math.floor(t.x / CHUNK), Math.floor(t.z / CHUNK)];
}

/** The holders of the torches in chunk (cx, cz) and the flames of those whose light is not `off`, turned out of their wall, in world tiles; null for an empty part. */
export function buildTorchChunk(torches: readonly TorchMark[], off: (lightId: number) => boolean, cx: number, cz: number): { holder: HolderArrays | null; flame: FlameArrays | null } {
  const hp: number[] = [], hn: number[] = [], hc: number[] = [], hf: number[] = [], fp: number[] = [], fa: number[] = [], ff: number[] = [];
  for (const t of torches) {
    const [tx, tz] = torchChunkOf(t);
    if (tx !== cx || tz !== cz) continue;
    // the sight is read on the floor tile in front of the wall, not at the wall's own cell
    const out = off(t.lightId), sx = t.x + t.nx * 0.5, sz = t.z + t.nz * 0.5;
    const m = torchHolder(!out);
    for (let i = 0; i < m.position.length; i += 3) {
      const [px, pz] = outOfWall(m.position[i], m.position[i + 2], t.nx, t.nz), [qx, qz] = outOfWall(m.normal[i], m.normal[i + 2], t.nx, t.nz);
      hp.push(t.x + px, m.position[i + 1], t.z + pz);
      hn.push(qx, m.normal[i + 1], qz);
      hc.push(m.colour[i], m.colour[i + 1], m.colour[i + 2]);
      hf.push(sx, sz);
    }
    if (out) continue;
    const f = flameMesh(1), [ax, , az] = flameTip(t);
    for (let i = 0; i < f.position.length; i += 3) {
      const [px, pz] = outOfWall(f.position[i], f.position[i + 2], t.nx, t.nz);
      fp.push(ax + px, FLAME_BASE_Y + f.position[i + 1], az + pz);
      // the phase of the light's flicker and the crystals' pulse
      fa.push(f.flame[i], f.flame[i + 1], t.lightId * 1.7);
      ff.push(sx, sz);
    }
  }
  return {
    holder: hp.length ? { position: arrays(hp), normal: arrays(hn), colour: arrays(hc), foot: arrays(hf), index: inOrder(hp.length / 3) } : null,
    flame: fp.length ? { position: arrays(fp), flame: arrays(fa), foot: arrays(ff), index: inOrder(fp.length / 3) } : null,
  };
}

/** The flame's middle (where its light sits) and its tip (where its smoke starts), in world tiles. */
export function flameMid(t: { x: number; z: number; nx: number; nz: number }): [x: number, y: number, z: number] {
  return [t.x + t.nx * FLAME_STAND, FLAME_BASE_Y + 0.4 * FLAME_H, t.z + t.nz * FLAME_STAND];
}
export function flameTip(t: { x: number; z: number; nx: number; nz: number }): [x: number, y: number, z: number] {
  return [t.x + t.nx * FLAME_STAND, FLAME_BASE_Y + FLAME_H, t.z + t.nz * FLAME_STAND];
}
