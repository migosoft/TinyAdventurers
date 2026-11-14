// The nymph's cove cover source (#330): the grass carpet of the 2D cove (covemath.ts) as a cover source, so the 3D view grows
// its cover over the carpet's shape and keeps its colours. The tufts and ferns come in as bushel spots.
import type { CoveInfo } from '../../generated/CoveInfo';
import { TILE_ID } from '../../generated/defs';
import { BASE, coveGrass, coveLayout, paintCove } from '../../game/covemath';
import { TILE, type TileMap } from '../../sim/map';
import { COVER } from './kinds';
import type { BushelSpot, CoverSource } from './source';

/** paintCove's transparent margin around the floor area (px). */
const MARGIN = 32;

export function coveSource(map: TileMap, c: CoveInfo, spots: BushelSpot[]): CoverSource {
  const { spec, origin } = coveLayout(c);
  const w = map.w * TILE, h = map.h * TILE;
  const grow = new Uint8Array(w * h), allow = new Uint8Array(w * h);
  const colour = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { colour[i * 4] = BASE[0]; colour[i * 4 + 1] = BASE[1]; colour[i * 4 + 2] = BASE[2]; colour[i * 4 + 3] = 255; }
  const grass = coveGrass(spec);
  for (let y = 0; y < spec.h; y++) for (let x = 0; x < spec.w; x++) {
    const wx = origin.x + x, wy = origin.y + y;
    if (wx < 0 || wy < 0 || wx >= w || wy >= h) continue;
    if (map.get(Math.floor(wx / TILE), Math.floor(wy / TILE)) !== TILE_ID.Floor) continue;
    allow[wy * w + wx] = 1;
    if (grass(x, y)) grow[wy * w + wx] = 1;
  }
  const art = paintCove(spec);
  for (let y = 0; y < art.h; y++) for (let x = 0; x < art.w; x++) {
    const a = (y * art.w + x) * 4;
    if (art.data[a + 3] === 0) continue;
    const wx = origin.x + x - MARGIN, wy = origin.y + y - MARGIN;
    if (wx < 0 || wy < 0 || wx >= w || wy >= h) continue;
    const o = (wy * w + wx) * 4;
    colour[o] = art.data[a]; colour[o + 1] = art.data[a + 1]; colour[o + 2] = art.data[a + 2];
  }
  return { kind: COVER.grass, w, h, grow, allow, colour, prep: [], spots };
}
