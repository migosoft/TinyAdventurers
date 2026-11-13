// The sky of a woodland run: the sun and moon, ambient light and haze for an hour of the day, and the run's clock.
// Pure maths (no Phaser, no three): x east, y up, z south.
import type { SunInfo } from '../generated/SunInfo';
import type { Cam } from './camera';
import type { Footprint } from './lights';
import type { Quality } from './quality';

export type Vec3 = [number, number, number];

export interface Sky {
  /** Unit vector toward the light (sun, or the moon at night). */
  dir: Vec3;
  colour: Vec3;
  ambient: Vec3;
  /** 0 by day, 1 at full night. */
  night: number;
  /** 0 at night, 1 by day. */
  day: number;
  haze: Vec3;
  /** Sun elevation in degrees (negative below the horizon). */
  elevation: number;
  moon: boolean;
}

/** One game hour per 720 real seconds (first guess). */
export const HOUR_RATE = 1 / 720;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix3 = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const wrap24 = (h: number): number => ((h % 24) + 24) % 24;

export function sky(hour: number): Sky {
  const h = wrap24(hour);
  // The sun rises in the west of the screen, passes behind the forest (north) at noon and sets in the east; a moon takes over at night.
  const s = (h - 6) / 14;
  const sc = Math.min(1, Math.max(0, s));
  const el = s < 0 ? s * 40 : s > 1 ? (1 - s) * 40 : 62 * Math.sin(Math.PI * s);
  const e = Math.max((el * Math.PI) / 180, 0.05);
  const hx = -Math.cos(Math.PI * s);
  const hz = -0.8 * Math.sin(Math.PI * sc) - 0.15;
  const hl = Math.hypot(hx, hz);
  let dir: Vec3 = [(hx / hl) * Math.cos(e), Math.sin(e), (hz / hl) * Math.cos(e)];
  const warm = smooth(2, 32, el);
  const up = smooth(-1.5, 6, el);
  let colour = mix3([1.05, 0.48, 0.24], [1.0, 0.93, 0.8], warm).map((c) => c * up) as Vec3;
  const day = smooth(-7, 18, el);
  const dusk = smooth(-8, 2, el) * (1 - smooth(4, 22, el));
  const base = mix3([0.035, 0.045, 0.09], [0.3, 0.34, 0.44], day);
  const ambient: Vec3 = [base[0] + dusk * 0.16, base[1] + dusk * 0.07, base[2] + dusk * 0.06];
  const moon = el < -1.5;
  if (moon) {
    const m = smooth(-1.5, -9, el);
    const l = Math.hypot(0.35, 0.85, -0.45);
    dir = [0.35 / l, 0.85 / l, -0.45 / l];
    colour = [0.17 * m, 0.23 * m, 0.38 * m];
  }
  const night = 1 - smooth(-9, 0, el);
  const haze = mix3([0.1, 0.12, 0.17], [0.74, 0.79, 0.82], day);
  return { dir, colour, ambient, night, day, haze, elevation: el, moon };
}

const lum = (v: Vec3): number => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
let noonLight = 0;
/** The mist's light: luminance of ambient + colour over its value at 13:00, clamped 0..1. */
export function mistLightOf(s: Sky): Vec3 {
  if (noonLight === 0) {
    const n = sky(13);
    noonLight = lum([n.ambient[0] + n.colour[0], n.ambient[1] + n.colour[1], n.ambient[2] + n.colour[2]]);
  }
  const k = Math.min(1, Math.max(0, lum([s.ambient[0] + s.colour[0], s.ambient[1] + s.colour[1], s.ambient[2] + s.colour[2]]) / noonLight));
  return [k, k, k];
}

/** The hour at which the sun stands at the level's elevation (clamped to the curve's 62 degrees) on its side. */
export function startHour(sun: SunInfo): number {
  const s = Math.asin(Math.min(sun.elevation, 62) / 62) / Math.PI;
  return sun.side < 0 ? 6 + 14 * s : 6 + 14 * (1 - s);
}

/** How strongly the sun lights an upright card facing the camera. */
export function cardSunGain(dir: Vec3): number {
  return 0.62 + 0.3 * Math.min(1, Math.max(0, dir[2] + 0.3)) + 0.15 * dir[1];
}

export function hourLabel(hour: number): string {
  const total = Math.floor(wrap24(hour) * 60 + 1e-6);
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** The hour of day as a function of the run's seconds, re-anchorable. */
export class HourClock {
  private hour: number;
  private at = 0;
  constructor(start: number) { this.hour = start; }
  /** The hour at `runSeconds` (null: no snapshot yet, so the anchor's hour), wrapped to 0..24. */
  hourAt(runSeconds: number | null, rate: number): number {
    if (runSeconds === null) return wrap24(this.hour);
    return wrap24(this.hour + (runSeconds - this.at) * rate * HOUR_RATE);
  }
  /** Re-anchors: from `runSeconds` on, time runs from `hour`. */
  anchor(hour: number, runSeconds: number): void { this.hour = hour; this.at = runSeconds; }
}

/**
 * Light space: R right, U up, F along the light (from the light into the scene, F = -dir), C its centre; ext the half sizes (tiles);
 * texel = 2 * ext[0] / size.
 * Convention (the three.js orthographic camera of Task 6 must match it): the camera sits at C - F * ext[2] looking along F, with
 * right R, up U; u = 0.5 + dot(P - C, R) / (2 ext[0]), v = 0.5 + dot(P - C, U) / (2 ext[1]) (v grows with U), and
 * depth = 0.5 + dot(P - C, F) / (2 ext[2]): 0 on the near plane (C - F * ext[2]), 1 on the far plane (C + F * ext[2]).
 */
export interface SunFit { R: Vec3; U: Vec3; F: Vec3; C: Vec3; ext: Vec3; size: number; texel: number }

/** Tiles: above the tallest plant the generator draws (220 px canvas at 130 %). */
export const SUN_TOP = 10;
export const SUN_MAP: Record<Quality, number> = { high: 4096, balanced: 2048, fast: 1024 };

const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The demo's basis: F against `dir`, R level and across it, U = R x F. R = (1, 0, 0) when the light is vertical. */
export function sunBasis(dir: Vec3): { R: Vec3; U: Vec3; F: Vec3 } {
  const F: Vec3 = [-dir[0], -dir[1], -dir[2]];
  const rl = Math.hypot(F[2], F[0]);
  const R: Vec3 = rl < 1e-9 ? [1, 0, 0] : [F[2] / rl, 0, -F[0] / rl];
  const U: Vec3 = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
  return { R, U, F };
}

/**
 * The ground the sun's map must cover: the screen's footprint plus what stands up to `SUN_TOP` on it and shows above the bottom
 * edge. A tall thing whose crown is at the bottom of the screen stands SUN_TOP / tan(pitch) nearer the camera than the edge, so the
 * footprint grows that far toward the camera (and only there, to keep texels small); the result is the axis-aligned box around
 * the footprint and its copy shifted that way.
 */
export function sunView(fp: Footprint, cam: Cam): Footprint {
  const k = SUN_TOP / Math.tan(cam.pitch);
  const dx = -Math.sin(cam.yaw) * k;
  const dz = Math.cos(cam.yaw) * k;
  return { x0: Math.min(fp.x0, fp.x0 + dx), x1: Math.max(fp.x1, fp.x1 + dx), z0: Math.min(fp.z0, fp.z0 + dz), z1: Math.max(fp.z1, fp.z1 + dz) };
}

const boxCorners =(x0: number, x1: number, z0: number, z1: number): Vec3[] => {
  const out: Vec3[] = [];
  for (const x of [x0, x1]) for (const y of [0, SUN_TOP]) for (const z of [z0, z1]) out.push([x, y, z]);
  return out;
};

/**
 * Fits a square shadow map of `size` texels around the footprint (ground to `SUN_TOP`) in light space, its centre snapped to whole
 * texels so shadows do not shimmer; F's range covers the whole map box plus one tile.
 */
export function fitSunMap(dir: Vec3, fp: Footprint, map: { w: number; h: number }, size: number): SunFit {
  const { R, U, F } = sunBasis(dir);
  const range = (pts: Vec3[], axis: Vec3): [number, number] => {
    const d = pts.map((p) => dot3(p, axis));
    return [Math.min(...d), Math.max(...d)];
  };
  const view = boxCorners(fp.x0, fp.x1, fp.z0, fp.z1);
  const [r0, r1] = range(view, R);
  const [u0, u1] = range(view, U);
  // The snapped centre moves by up to half a texel (= ext / size), and 2 texels stay free at the edge for filtering and the card
  // receiver nudge, so grow the square: e = half + 2.5 texels = half + 5 e / size.
  const half = Math.max(r1 - r0, u1 - u0) / 2;
  const e = half / (1 - 5 / size);
  const texel = (2 * e) / size;
  const cR = Math.round((r0 + r1) / 2 / texel) * texel;
  const cU = Math.round((u0 + u1) / 2 / texel) * texel;
  const [f0, f1] = range(boxCorners(0, map.w, 0, map.h), F);
  const cF = (f0 + f1) / 2;
  const C: Vec3 = [R[0] * cR + U[0] * cU + F[0] * cF, R[1] * cR + U[1] * cU + F[1] * cF, R[2] * cR + U[2] * cU + F[2] * cF];
  return { R, U, F, C, ext: [e, e, (f1 - f0) / 2 + 1], size, texel };
}

/** P in light space: u, v in 0..1 across the map, depth 0..1 from the near to the far plane (the TSL lookup uses the same formula). */
export function sunCoord(fit: SunFit, P: Vec3): { u: number; v: number; depth: number } {
  const d: Vec3 = [P[0] - fit.C[0], P[1] - fit.C[1], P[2] - fit.C[2]];
  return {
    u: 0.5 + dot3(d, fit.R) / (2 * fit.ext[0]),
    v: 0.5 + dot3(d, fit.U) / (2 * fit.ext[1]),
    depth: 0.5 + dot3(d, fit.F) / (2 * fit.ext[2]),
  };
}
