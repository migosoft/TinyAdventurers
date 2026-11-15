// Colours, looks and small pure functions the 2D effects and the 3D effects (#308) both use. Phaser-free: `render3d/` may import it.
import { EFFECT_LOOK, KIND } from '../generated/defs';

/** The lich's gloom colours. */
export const GLOOM = { dark: 0x2a0a3a, mid: 0x5a1a8a, light: 0xa060f0, spark: 0xe0c0ff };

/** Figures that leave bone, not blood, when they die. */
export const SKELETAL = new Set<number>([KIND.SkeletonWarrior, KIND.SkeletonArcher, KIND.RaisedSkeleton, KIND.Lich]);

/** The ring and motes of a minion that appears, by the Raise event's `k`: 0 green (raised skeleton), 1 fiery (summoned imp), 2 dark purple (the lich's). */
export const RAISE_LOOKS: Readonly<Record<number, { ring: number; motes: readonly number[] }>> = {
  0: { ring: 0x3ad04a, motes: [0x3ad04a] },
  1: { ring: 0xff7020, motes: [0xff7020, 0xffd040] },
  2: { ring: GLOOM.mid, motes: [GLOOM.dark, GLOOM.spark] },
};

/** The ground hazards' looks: tint of the glow, default radius (px), its squash (x, y), strength, the rising sparks (chance per frame at 60 Hz, rise px/s, colours). */
export const HAZARD_LOOKS: Record<number, { tint: number; r: number; sx: number; sy: number; alpha: number; sparks: number; rise: number; colors: number[] }> = {
  [KIND.FirePatch]: { tint: 0xff5010, r: 10, sx: 1.75, sy: 0.98, alpha: 1, sparks: 0.5, rise: 25, colors: [0xff7020, 0xffd040] },
  [KIND.HolyGround]: { tint: 0xffd040, r: 40, sx: 1, sy: 0.7, alpha: 0.45, sparks: 0.15, rise: 15, colors: [0xffd040, 0xfff0a0] },
  [KIND.Roots]: { tint: 0x40a040, r: 36, sx: 1, sy: 0.7, alpha: 0.5, sparks: 0.2, rise: 10, colors: [0x60c050, 0x90e070] },
};

/** How Entangled is drawn around the feet, by look (a later web is one more entry; the compiler lists the missing ones). */
export const ENTANGLE_LOOKS: Record<(typeof EFFECT_LOOK)[keyof typeof EFFECT_LOOK], { color: number; vines: boolean }> = {
  [EFFECT_LOOK.Plain]: { color: 0xa8a8b0, vines: false },
  [EFFECT_LOOK.Vines]: { color: 0x4fa83a, vines: true },
};

/** Opacity of a snowflake `age` s into its `life`: fades in over the first quarter, holds, fades out over the last quarter (0 outside the life). */
export function snowflakeAlpha(age: number, life: number): number {
  if (life <= 0 || age <= 0 || age >= life) return 0;
  const k = age / life;
  return Math.min(1, k / 0.25, (1 - k) / 0.25);
}

/** Deterministic 0..1 from a seed and an index (a small integer hash). */
function hash01(seed: number, i: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 0x100000000;
}

/** Point `i` of `flameSpots(bodyW, bodyH, n, seed)` written into `out` (allocation-free: the 3D view draws from it each frame). */
export function flameSpotAt(bodyW: number, bodyH: number, i: number, seed: number, out: [number, number]): void {
  const u = hash01(seed, i * 2);
  const v = hash01(seed, i * 2 + 1);
  out[0] = (u - 0.5) * bodyW * 0.8;
  out[1] = -bodyH * (0.1 + 0.75 * v * v);
}

/** `n` points on a body `bodyW` x `bodyH` px (feet at y 0, upwards negative, x centred), mostly on its lower two thirds: where the flames of a burning figure sit. Deterministic for a `seed`. */
export function flameSpots(bodyW: number, bodyH: number, n: number, seed: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const p: [number, number] = [0, 0];
    flameSpotAt(bodyW, bodyH, i, seed, p);
    out.push(p);
  }
  return out;
}

/** The golden afterimage of an Accelerated figure. */
export const ACCEL_TINT = 0xffe680;

/** The lich's stone gaze: the beam's opacity at time `t` (seconds), pulsing between 0.4 and 0.9. */
export function gazePulse(t: number): number {
  return 0.65 + 0.25 * Math.sin(t * 12);
}
