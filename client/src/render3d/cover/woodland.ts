// The woodland's cover source (#330): the painted ground split in two. The bare picture is the ground with every
// grass tile turned to road (what shows under the cover); the cover picture is the ground with roads turned to grass.
import { TILE_ID } from '../../generated/defs';
import { GRASS, GroundPainter, kindRow, NONE, THICKET } from '../../game/woodland/ground';
import { bandOrder } from '../../game/woodland/settle';
import { TILE, TileMap } from '../../sim/map';
import { COVER } from './kinds';
import type { CoverSource } from './source';

/** A copy of the map with the tiles `from` turned into `to`. */
function remapped(map: TileMap, from: number[], to: number): TileMap {
  const tiles = map.tiles.slice();
  for (let i = 0; i < tiles.length; i++) if (from.includes(tiles[i])) tiles[i] = to;
  return new TileMap(map.w, map.h, tiles);
}

export function woodlandSource(map: TileMap, seed: number, spawnRow: number): CoverSource {
  const bare = new GroundPainter(remapped(map, [TILE_ID.Floor, TILE_ID.Trunk, TILE_ID.Thicket], TILE_ID.Road), seed);
  const cover = new GroundPainter(remapped(map, [TILE_ID.Road], TILE_ID.Floor), seed);
  const w = map.w * TILE, h = map.h * TILE;
  const grow = new Uint8Array(w * h), allow = new Uint8Array(w * h);
  const row = new Uint8Array(w * TILE);
  const prep: (() => void)[] = [];
  for (const ty of bandOrder(map.h, spawnRow)) {
    prep.push(() => {
      bare.band(ty);
      cover.band(ty);
      kindRow(map, seed, ty, row);
      const o = ty * TILE * w;
      for (let i = 0; i < row.length; i++) {
        const k = row[i];
        grow[o + i] = k === GRASS || k === THICKET ? 1 : 0;
        allow[o + i] = k !== NONE ? 1 : 0;
      }
    });
  }
  prep.push(() => { bare.blades(); cover.blades(); }, () => { bare.flowers(); cover.flowers(); });
  return {
    kind: COVER.grass,
    w, h, grow, allow,
    colour: cover.data,
    prep,
    density: (tx, tz) => (map.get(tx, tz) === TILE_ID.Thicket ? 4 : 1),
    bare: { image: { w, h, data: bare.data } },
  };
}
