// The nymph's cove cover source (#330): the grass carpet of the cove (covemath.ts) as a cover source, so the 3D view grows
// its cover over the carpet's shape and keeps its colours. The tufts and ferns come in as bushel spots.
import type { CoveInfo } from '../../generated/CoveInfo';
import { TILE_ID } from '../../generated/defs';
import { BASE, coveGrass, coveLayout, MARGIN, paintCove } from '../../game/covemath';
import { TILE, type TileMap } from '../../sim/map';
import { COVER } from './kinds';
import type { BushelSpot, CoverSource } from './source';

/** Rows of the cove rectangle per prep unit. */
const BAND = 16;

/** The masks and colours exist over the whole map (the job's image is map sized), but only the cove rectangle is worked, in bands of rows
 * run as `prep` units: the colour is read only where cover has height, which lies inside `allow`, inside the rectangle. */
export function coveSource(map: TileMap, c: CoveInfo, spots: BushelSpot[]): CoverSource {
  const { spec, origin } = coveLayout(c);
  const w = map.w * TILE, h = map.h * TILE;
  const grow = new Uint8Array(w * h), allow = new Uint8Array(w * h);
  const colour = new Uint8ClampedArray(w * h * 4);
  const grass = coveGrass(spec);
  let art: { w: number; h: number; data: Uint8ClampedArray } | null = null;
  const x0 = Math.max(0, origin.x), x1 = Math.min(w, origin.x + spec.w);
  const prep: (() => void)[] = [];
  for (let b0 = 0; b0 < spec.h; b0 += BAND) {
    const b1 = Math.min(spec.h, b0 + BAND);
    prep.push(() => {
      art ??= paintCove(spec);
      for (let y = b0; y < b1; y++) {
        const wy = origin.y + y;
        if (wy < 0 || wy >= h) continue;
        for (let wx = x0; wx < x1; wx++) {
          const o = wy * w + wx;
          colour[o * 4] = BASE[0]; colour[o * 4 + 1] = BASE[1]; colour[o * 4 + 2] = BASE[2]; colour[o * 4 + 3] = 255;
          if (map.get(Math.floor(wx / TILE), Math.floor(wy / TILE)) !== TILE_ID.Floor) continue;
          allow[o] = 1;
          if (grass(wx - origin.x, y)) grow[o] = 1;
        }
      }
      // paintCove's picture has MARGIN px all round; the rows and columns of the rectangle are the ones read
      for (let y = b0; y < b1; y++) {
        const wy = origin.y + y;
        if (wy < 0 || wy >= h) continue;
        for (let wx = x0; wx < x1; wx++) {
          const a = ((y + MARGIN) * art.w + (wx - origin.x + MARGIN)) * 4;
          if (art.data[a + 3] !== 255) continue; // the carpet's stone shadows are partly transparent: the 3D view casts its own
          const o = (wy * w + wx) * 4;
          colour[o] = art.data[a]; colour[o + 1] = art.data[a + 1]; colour[o + 2] = art.data[a + 2];
        }
      }
    });
  }
  return { kind: COVER.grass, w, h, grow, allow, colour, prep, spots };
}
