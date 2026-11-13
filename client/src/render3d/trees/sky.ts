// Time of day of the proof of concept: the reference demo's `sky` (#300 design, "Wind, clouds, time of day").
type V3 = [number, number, number];
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

export interface Sky { dir: V3; col: V3; amb: V3; el: number; moon: number }

/** The sun rises on the left, passes behind the forest (north) and sets on the right; below -1.5 degrees a moon takes over. `dir` points toward the light. */
export function sky(h: number): Sky {
  const s = (h - 6) / 14, c = Math.min(1, Math.max(0, s));
  const el = 62 * Math.sin(Math.PI * c) * (s < 0 || s > 1 ? 0 : 1) + (s < 0 ? s * 40 : s > 1 ? (1 - s) * 40 : 0);
  const e = Math.max((el * Math.PI) / 180, 0.05), hx = -Math.cos(Math.PI * s), hz = -0.8 * Math.sin(Math.PI * c) - 0.15, hl = Math.hypot(hx, hz);
  let dir: V3 = [(hx / hl) * Math.cos(e), Math.sin(e), (hz / hl) * Math.cos(e)];
  const warm = smooth(2, 32, el), up = smooth(-1.5, 6, el);
  let col = mix3([1.05, 0.48, 0.24], [1.0, 0.93, 0.8], warm).map((v) => v * up) as V3;
  const day = smooth(-7, 18, el), dusk = smooth(-8, 2, el) * (1 - smooth(4, 22, el));
  const a = mix3([0.035, 0.045, 0.09], [0.3, 0.34, 0.44], day);
  const amb: V3 = [a[0] + dusk * 0.16, a[1] + dusk * 0.07, a[2] + dusk * 0.06];
  let moon = 0;
  if (el < -1.5) { moon = smooth(-1.5, -9, el); dir = norm([0.35, 0.85, -0.45]); col = [0.17 * moon, 0.23 * moon, 0.38 * moon]; }
  return { dir, col, amb, el, moon };
}

/** The slider's hour as a clock time. */
export function clock(h: number): string {
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
