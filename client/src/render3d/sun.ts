// The sky of a woodland run: the sun and moon, ambient light and haze for an hour of the day, and the run's clock.
// Pure maths (no Phaser, no three): x east, y up, z south.
import type { SunInfo } from '../generated/SunInfo';

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
