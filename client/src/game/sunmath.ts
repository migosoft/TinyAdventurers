/** Daylight look: how the sun patch is drawn and how clouds dim it. Pure; the demo switches `sunLook`. */

import { TILE } from '../sim/map';

export interface SunLook {
  widen: boolean;
  /** Tiles across. */
  patch: number;
  /** Tiles sideways at the floor, ceiling to floor. */
  slant: number;
  /** -1: the light comes from the upper left. */
  dir: -1 | 1;
  /** Deepest dip, 0..1. */
  clouds: number;
  /** Seconds of full sun between clouds. */
  gap: [number, number];
  /** Tiles from ceiling to floor. */
  height: number;
  /** Sub-beams side by side, as if the crack had several parts. */
  rays: 1 | 2 | 3;
  /** Brightness of the beam and the patch (their alphas are multiplied by it, capped at 1). */
  glow: number;
}

export const sunLook: SunLook = { widen: true, patch: 2, slant: 2, dir: -1, clouds: 0.3, gap: [8, 25], glow: 1, height: 4, rays: 1 };

/** Uniform [0,1) from a hash of (id, cloud index, salt). */
function rnd(id: number, n: number, salt: number): number {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(n + 1, 0xc2b2ae35) ^ Math.imul(salt + 1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

interface Cloud {
  start: number;
  dur: number;
  depth: number;
}

const schedules = new Map<string, Cloud[]>();

/** Clouds of light `id` up to the one covering `t`, for the gap range `gap` (depth is scaled by `look.clouds` at lookup). */
function scheduleTo(id: number, t: number, gap: [number, number]): Cloud[] {
  const key = `${id}:${gap[0]}:${gap[1]}`;
  let list = schedules.get(key);
  if (!list) schedules.set(key, (list = []));
  while (list.length === 0 || list[list.length - 1].start + list[list.length - 1].dur <= t) {
    const n = list.length;
    const prev = n ? list[n - 1].start + list[n - 1].dur : 0;
    list.push({
      start: prev + gap[0] + (gap[1] - gap[0]) * rnd(id, n, 0),
      dur: 3 + 3 * rnd(id, n, 1),
      depth: 0.67 + 0.33 * rnd(id, n, 2),
    });
  }
  return list;
}

/** Cloud cover of light `id` at time `t` (s): 1 is full sun, down to `1 - look.clouds` in the middle of a cloud. */
export function cloudAt(id: number, t: number, look: SunLook): number {
  if (look.clouds <= 0 || t < 0) return 1;
  const list = scheduleTo(id, t, look.gap);
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start + list[mid].dur <= t) lo = mid + 1;
    else hi = mid;
  }
  const c = list[lo];
  if (t < c.start) return 1;
  const u = (t - c.start) / c.dur;
  return 1 - look.clouds * c.depth * 0.5 * (1 - Math.cos(2 * Math.PI * u));
}

/** The beam of a skylight at tile (tx, ty) and its floor patch, in px. Edges run [left, right]; the top is on the side the light comes from. */
export function beamShape(
  tx: number,
  ty: number,
  look: SunLook,
): { top: [number, number][]; bottom: [number, number][]; patch: { x: number; y: number; w: number; h: number } } {
  const cx = (tx + 0.5) * TILE;
  const cy = (ty + 0.5) * TILE;
  const w = look.patch * TILE;
  const topHalf = (look.widen ? 0.25 : 0.5) * w;
  const topX = cx + look.dir * look.slant * TILE;
  const topY = cy - look.height * TILE;
  return {
    top: [[topX - topHalf, topY], [topX + topHalf, topY]],
    bottom: [[cx - w / 2, cy], [cx + w / 2, cy]],
    patch: { x: cx, y: cy, w, h: 0.6 * w },
  };
}

export interface Ray {
  top: [number, number][];
  bottom: [number, number][];
}

/**
 * The beam of light `id` as `look.rays` narrower rays that start near the same spot and fan out a little:
 * each ray's top centre is within +-0.3 of the beam's top width of its centre, and each ray's bottom lies
 * inside the beam's bottom span; widths are 0.4..0.8 of the beam's. All hashed from (id, ray index), so they
 * never change; they overlap, mostly near the top. One ray is the whole beam.
 */
export function rayShapes(shape: { top: [number, number][]; bottom: [number, number][] }, id: number, look: SunLook): Ray[] {
  const n = look.rays;
  if (n <= 1) return [{ top: shape.top, bottom: shape.bottom }];
  const [tl, tr] = [shape.top[0][0], shape.top[1][0]];
  const [bl, br] = [shape.bottom[0][0], shape.bottom[1][0]];
  const topW = tr - tl;
  const botW = br - bl;
  const rays: Ray[] = [];
  for (let i = 0; i < n; i++) {
    const tc = (tl + tr) / 2 + (rnd(id, i, 3) - 0.5) * 0.6 * topW;
    const th = 0.5 * topW * (0.4 + 0.4 * rnd(id, i, 4));
    const bw = botW * (0.4 + 0.4 * rnd(id, i, 5));
    const bc = (bl + br) / 2 + (rnd(id, i, 6) * 2 - 1) * 0.5 * (botW - bw);
    rays.push({
      top: [[tc - th, shape.top[0][1]], [tc + th, shape.top[0][1]]],
      bottom: [[bc - bw / 2, shape.bottom[0][1]], [bc + bw / 2, shape.bottom[0][1]]],
    });
  }
  return rays;
}
