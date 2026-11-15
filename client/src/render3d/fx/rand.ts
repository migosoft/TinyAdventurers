// Seeded randomness for the effects (#308): every effect is a pure function of (seconds since start, seed, numbers), so a frozen clock
// shows the same picture. No Math.random() in fx/.

/** A small deterministic generator: numbers in [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hash of three integers, 0..1. Allocation-free: the per-frame shapes draw their random numbers from it instead of an `rng` closure. */
export function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Value noise, 0..1. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  return lerp(
    lerp(lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), sx), lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), sx), sy),
    lerp(lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), sx), lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), sx), sy), sz);
}
