// The pond's free shape (#360): the client's exact port of `server/src/dungeon/water_shapes.rs` (`inside`, with its lattice hash and
// value noise). The server makes a pond from overlapping ellipses with a wobbled edge and turns it into tiles (a tile is water when
// its centre is inside); the view draws the shore from the shape itself, so it has no steps. Parity: pondShape.test.ts against
// generated/pond-shape-fixture.json. Tile coordinates.

/** An ellipse of the pond: `[cx, cy, rx, ry]` in tiles (`PondInfo.blobs`). */
export type Blob = readonly [number, number, number, number] | number[];

const WOBBLE_AMP = 0.6, WOBBLE_WAVE = 4; // as the server's // balancing

/** The lattice value in -1..1: the server's wrapping u32 hash. */
export function lattice(seed: number, ix: number, iy: number): number {
  let h = (seed ^ Math.imul(ix, 0x9e3779b1) ^ Math.imul(iy, 0x85ebca77)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

function wobble(seed: number, x: number, y: number): number {
  const u = x / WOBBLE_WAVE, v = y / WOBBLE_WAVE;
  const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = lattice(seed, ix, iy) * (1 - sx) + lattice(seed, ix + 1, iy) * sx;
  const bottom = lattice(seed, ix, iy + 1) * (1 - sx) + lattice(seed, ix + 1, iy + 1) * sx;
  return (top * (1 - sy) + bottom * sy) * WOBBLE_AMP;
}

/** > 0 inside the union of the blobs, about "tiles inside", with the wobbled edge (`seed`: `PondInfo.seed`). -Infinity without blobs. */
export function inside(blobs: readonly Blob[], seed: number, x: number, y: number): number {
  let best = -Infinity;
  for (const [cx, cy, rx, ry] of blobs) {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    best = Math.max(best, (1 - Math.sqrt(dx * dx + dy * dy)) * Math.min(rx, ry));
  }
  return best + wobble(seed, x, y);
}
