// Where the tall-grass bushels stand (#330): clusters on thick cover, as in the spike, plus the source's spots.
// Pure and deterministic from the seed (no Math.random). No three.js, no Phaser.
import type { BushelLook } from './kinds';
import type { Bushel, BushelSpot } from './source';

const TILE_PX = 16;

/** Bushels for a height image (`heights`, w x h map px, 16 px a tile). `density` scales the cluster count per tile. */
export function placeBushels(
  heights: Uint8Array, w: number, h: number, look: BushelLook, seed: number,
  density: (tx: number, tz: number) => number = () => 1, spots: readonly BushelSpot[] = [],
): Bushel[] {
  let s = (Math.floor(seed) % 2147483646 + 2147483646) % 2147483646 + 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const heightAt = (x: number, z: number) => {
    const px = Math.floor(x * TILE_PX), py = Math.floor(z * TILE_PX);
    return px < 0 || py < 0 || px >= w || py >= h ? 0 : heights[py * w + px];
  };
  const out: Bushel[] = [];
  const range = (r: [number, number]) => r[0] + Math.floor(rnd() * (r[1] - r[0] + 1));
  /** One bushel around (cx, cz) with the given spread in tiles, if its foot passes the rule. */
  const add = (cx: number, cz: number, sx: number, sz: number, fern: boolean) => {
    const x = Math.round((cx + (rnd() - 0.5) * 2 * sx) * TILE_PX) / TILE_PX, z = Math.round((cz + (rnd() - 0.5) * 2 * sz) * TILE_PX) / TILE_PX;
    const bw = fern ? range(look.fernW) : range(look.w), bh = fern ? range(look.fernH) : range(look.h), sd = Math.floor(rnd() * 997);
    if (heightAt(x, z) < 2 || heightAt(x - 0.4, z) < 1 || heightAt(x + 0.4, z) < 1) return;
    out.push({ x, z, w: bw, h: bh, seed: sd, fern });
  };

  // Area in tiles² of thick cover (height >= 2), each px weighted by the density at its tile.
  let area = 0;
  for (let py = 0; py < h; py++) {
    const tz = Math.floor(py / TILE_PX);
    for (let px = 0; px < w; px++) if (heights[py * w + px] >= 2) area += density(Math.floor(px / TILE_PX), tz);
  }
  area /= TILE_PX * TILE_PX;

  const clusters = Math.round(area / look.perArea);
  for (let c = 0; c < clusters; c++) {
    let px = -1, py = -1;
    for (let t = 0; t < 20; t++) {
      const x = Math.floor(rnd() * w), y = Math.floor(rnd() * h);
      if (heights[y * w + x] >= 2) { px = x; py = y; break; }
    }
    if (px < 0) continue;
    const n = range(look.cluster);
    for (let i = 0; i < n; i++) add((px + 0.5) / TILE_PX, (py + 0.5) / TILE_PX, 1.2, 0.9, false);
  }
  for (const sp of spots) for (let i = 0; i < sp.count; i++) add(sp.x, sp.z, 5 / TILE_PX, 5 / TILE_PX, sp.fern);
  return out;
}
