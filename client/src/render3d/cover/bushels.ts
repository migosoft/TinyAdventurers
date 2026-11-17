// Where the tall-grass bushels stand (#330): clusters on thick cover, as in the spike, plus the source's spots.
// Pure and deterministic from the seed (no Math.random). No three.js.
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

  // Tiles that hold thick cover (height >= 2), each weighted by its thick px count times the density there
  // (called once per tile). The weights give the cluster count (area in tiles²) and where the centres go.
  const tilesW = Math.ceil(w / TILE_PX), tilesH = Math.ceil(h / TILE_PX);
  const tileX: number[] = [], tileZ: number[] = [], cum: number[] = [];
  let total = 0;
  for (let tz = 0; tz < tilesH; tz++) for (let tx = 0; tx < tilesW; tx++) {
    let n = 0;
    for (let py = tz * TILE_PX; py < Math.min(h, (tz + 1) * TILE_PX); py++)
      for (let px = tx * TILE_PX; px < Math.min(w, (tx + 1) * TILE_PX); px++) if (heights[py * w + px] >= 2) n++;
    if (n === 0) continue;
    const weight = n * density(tx, tz);
    if (!(weight > 0)) continue;
    total += weight; tileX.push(tx); tileZ.push(tz); cum.push(total);
  }

  const clusters = Math.round(total / (TILE_PX * TILE_PX) / look.perArea);
  for (let c = 0; c < clusters; c++) {
    // The tile by weighted choice (binary search over the cumulative weights), then a thick px inside it.
    const r = rnd() * total;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] > r) hi = mid; else lo = mid + 1; }
    const x0 = tileX[lo] * TILE_PX, y0 = tileZ[lo] * TILE_PX, tw = Math.min(TILE_PX, w - x0), th = Math.min(TILE_PX, h - y0);
    let px = -1, py = -1;
    for (let t = 0; t < 20 && px < 0; t++) {
      const x = x0 + Math.floor(rnd() * tw), y = y0 + Math.floor(rnd() * th);
      if (heights[y * w + x] >= 2) { px = x; py = y; }
    }
    for (let i = 0; i < tw * th && px < 0; i++) { // a sparse tile: the first thick px
      const x = x0 + (i % tw), y = y0 + Math.floor(i / tw);
      if (heights[y * w + x] >= 2) { px = x; py = y; }
    }
    const n = range(look.cluster);
    for (let i = 0; i < n; i++) add((px + 0.5) / TILE_PX, (py + 0.5) / TILE_PX, 1.2, 0.9, false);
  }
  for (const sp of spots) for (let i = 0; i < sp.count; i++) add(sp.x, sp.z, 5 / TILE_PX, 5 / TILE_PX, sp.fern);
  return out;
}
