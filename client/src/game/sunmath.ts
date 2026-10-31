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
  /** How the rays of one crack are laid out: 'fan' (tops near one spot, widening apart) or 'parallel' (narrow shafts parallel to the beam's edges). */
  style: 'fan' | 'parallel';
  /** Draw the whole beam as a faint wide main ray under the rays. */
  main: boolean;
  /** Sub-beams side by side, as if the crack had several parts. */
  rays: 1 | 2 | 3;
  /** Range of a ray's width as a share of the beam's (rays > 1). */
  rayWidth: [number, number];
  /** Each sun gets its own random look (`sunVariant`); only slant, dir and gap come from here. */
  vary: boolean;
  /** Brightness of the beam and the patch (their alphas are multiplied by it, capped at 1). */
  glow: number;
}

export const sunLook: SunLook = { widen: true, patch: 2, slant: 2, dir: -1, clouds: 0.3, gap: [8, 25], glow: 1, height: 6, rays: 2, rayWidth: [0.5, 0.8], style: 'fan', main: false, vary: true };

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
 * The beam of light `id` as `look.rays` narrower rays of differing widths (`look.rayWidth`, shares of the
 * beam's width). At the floor they lie left to right, the first starting at the beam's left edge and the last
 * ending at its right edge, and neighbours always touch or overlap (a ray whose hashed spot would leave a gap
 * is moved back, and the last ray is widened to reach the edge). At the top they all start near one spot:
 * each top centre is within +-0.2 of the beam's top width of its centre and each top is 0.45..0.58 of it
 * wide, so any two overlap and all stay inside the top span (the rays fan out from one crack). Hashed from
 * (id, ray index), so they never change. One ray is the whole beam. With `look.style === 'parallel'` the
 * rays are instead narrow shafts parallel to the beam's edges (see `parallelRays`; the fan rules above do not apply).
 */
export function rayShapes(shape: { top: [number, number][]; bottom: [number, number][] }, id: number, look: SunLook): Ray[] {
  const n = look.rays;
  if (n <= 1) return [{ top: shape.top, bottom: shape.bottom }];
  if (look.style === 'parallel') return parallelRays(shape, id, n);
  const [tl, tr] = [shape.top[0][0], shape.top[1][0]];
  const [bl, br] = [shape.bottom[0][0], shape.bottom[1][0]];
  const topW = tr - tl;
  const botW = br - bl;
  // Floor spans as shares of the beam's width.
  const spans = Array.from({ length: n }, (_, i) => {
    const w = look.rayWidth[0] + (look.rayWidth[1] - look.rayWidth[0]) * rnd(id, i, 5);
    const left = i === 0 ? 0 : i === n - 1 ? 1 - w : (1 - w) * (0.25 + 0.5 * rnd(id, i, 6));
    return { left, w, i };
  }).sort((a, b) => a.left - b.left);
  spans[0].left = 0;
  let right = spans[0].w;
  for (let k = 1; k < n; k++) {
    spans[k].left = Math.min(spans[k].left, right);
    right = Math.max(right, spans[k].left + spans[k].w);
  }
  // The last (rightmost) end reaches the beam's edge.
  if (right < 1) {
    const last = spans.reduce((a, b) => (b.left + b.w > a.left + a.w ? b : a));
    last.w += 1 - right;
  }
  const rays: Ray[] = [];
  for (const { left, w, i } of spans.sort((a, b) => a.i - b.i)) {
    const tc = (tl + tr) / 2 + (rnd(id, i, 3) - 0.5) * 0.4 * topW;
    const th = 0.5 * topW * (0.45 + 0.13 * rnd(id, i, 4)) * 2;
    rays.push({
      top: [[tc - th / 2, shape.top[0][1]], [tc + th / 2, shape.top[0][1]]],
      bottom: [[bl + left * botW, shape.bottom[0][1]], [bl + (left + w) * botW, shape.bottom[0][1]]],
    });
  }
  return rays;
}

/** Narrow shafts parallel to the beam's edges: one per equal slot of the width, placed at random in its slot (top and floor at the same share u). */
function parallelRays(shape: { top: [number, number][]; bottom: [number, number][] }, id: number, n: number): Ray[] {
  const [tl, tr] = [shape.top[0][0], shape.top[1][0]];
  const [bl, br] = [shape.bottom[0][0], shape.bottom[1][0]];
  const rays: Ray[] = [];
  for (let i = 0; i < n; i++) {
    const w = Math.min(1 / n, 0.15 + 0.25 * rnd(id, i, 8));
    const u0 = i / n + rnd(id, i, 9) * (1 / n - w);
    const u1 = u0 + w;
    rays.push({
      top: [[tl + u0 * (tr - tl), shape.top[0][1]], [tl + u1 * (tr - tl), shape.top[0][1]]],
      bottom: [[bl + u0 * (br - bl), shape.bottom[0][1]], [bl + u1 * (br - bl), shape.bottom[0][1]]],
    });
  }
  return rays;
}

/** Brightness factor of each of `rays` overlapping rays, so that together they stay near one beam's brightness. */
export function rayGlow(glow: number, rays: number): number {
  return glow / Math.sqrt(Math.max(1, rays));
}

/** Tallest and shortest beam of a random sun spot, in tiles. */
export const HEIGHT_RANGE: [number, number] = [5, 7];

/** The look of sun spot `id`: random but the same for everyone (a hash of the id). Slant, direction and cloud gap stay those of `base`. */
export function sunVariant(id: number, base: SunLook): SunLook {
  const r = (salt: number) => rnd(id, 0, 20 + salt);
  const rays = r(4);
  return {
    ...base,
    widen: r(0) < 0.65,
    patch: 1.5 + 1.5 * r(1),
    height: HEIGHT_RANGE[0] + (HEIGHT_RANGE[1] - HEIGHT_RANGE[0]) * r(2),
    rays: rays < 0.55 ? 2 : 3,
    style: r(7) < 0.5 ? 'fan' : 'parallel',
    main: true,
    rayWidth: [0.25, 0.9],
    glow: 0.8 + 0.5 * r(5),
    clouds: 0.45 * r(6),
  };
}

const variants = new Map<number, SunLook>();

/** The look sun spot `id` is drawn and dimmed with: `base` itself unless `base.vary`; else `sunVariant`, cached until slant, dir or gap change. */
export function lookFor(id: number, base: SunLook): SunLook {
  if (!base.vary) return base;
  let v = variants.get(id);
  if (!v || v.slant !== base.slant || v.dir !== base.dir || v.gap !== base.gap) {
    v = sunVariant(id, base);
    variants.set(id, v);
  }
  return v;
}
