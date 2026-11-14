// Each plant's own colour: a deterministic hash of its foot picks four values, uniformly spread inside the ranges.

/** Half-ranges: leaf brightness (factor around 1), leaf warmth (shift around 0), bark brightness (factor), bark grey (shift; negative: more colour). */
const RANGE = [0.245, 0.28, 0.19, 0.38] as const;

function mix(a: number, b: number): number {
  let t = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x7feb352d);
  t = Math.imul(t ^ (t >>> 15), 0x846ca68b);
  return (t ^ (t >>> 16)) >>> 0;
}

/** [leafBright, leafWarm, barkLight, barkGrey] for a foot in tiles. */
export function plantVariation(x: number, z: number): [number, number, number, number] {
  // Feet lie on the 1/16 tile grid; the quantised pair is hashed once per value.
  const a = Math.round(x * 16), b = Math.round(z * 16);
  const u = (k: number) => (mix(mix(a, b), k + 1) / 4294967296) * 2 - 1;
  return [1 + u(0) * RANGE[0], u(1) * RANGE[1], 1 + u(2) * RANGE[2], u(3) * RANGE[3]];
}
