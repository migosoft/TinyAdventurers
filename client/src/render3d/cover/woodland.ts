// The woodland's cover source (#330): the painted ground split in two. The bare picture is the ground with every
// grass tile turned to road (what shows under the cover); the cover picture is the ground with roads turned to grass.
import { TILE_ID } from '../../generated/defs';
import { BANK, GRASS, GroundPainter, kindRows, NONE, THICKET, type Shore } from '../../game/woodland/ground';
import { pondFieldOf } from '../dips/shape';
import { bandOrder } from '../../game/woodland/settle';
import { TILE, TileMap } from '../../sim/map';
import { COVER } from './kinds';
import type { CoverSource } from './source';

/** The cover may not reach over the bank nearer the drawn water than this (px): the wet line. */
const WET_LINE = 2;

/** A copy of the map with the tiles `from` turned into `to`. */
function remapped(map: TileMap, from: number[], to: number): TileMap {
  const tiles = map.tiles.slice();
  for (let i = 0; i < tiles.length; i++) if (from.includes(tiles[i])) tiles[i] = to;
  return new TileMap(map.w, map.h, tiles);
}

/** `shore`: the pond's drawn shore (#360), by default the field of `map` (the view's map); the painters' map copies carry none, so it is handed on. */
export function woodlandSource(map: TileMap, seed: number, spawnRow: number, shore: Shore | undefined = pondFieldOf(map)): CoverSource {
  const bare = new GroundPainter(remapped(map, [TILE_ID.Floor, TILE_ID.Trunk, TILE_ID.Thicket], TILE_ID.Road), seed, shore);
  const cover = new GroundPainter(remapped(map, [TILE_ID.Road], TILE_ID.Floor), seed, shore);
  const rowKinds = kindRows(map, seed, shore);
  const w = map.w * TILE, h = map.h * TILE;
  const grow = new Uint8Array(w * h), allow = new Uint8Array(w * h);
  const row = new Uint8Array(w * TILE);
  // nothing grows through a bridge's deck (#360): the decks of the view map's own pond
  const deckAt = pondFieldOf(map)?.deckAt;
  const prep: (() => void)[] = [];
  for (const ty of bandOrder(map.h, spawnRow)) {
    prep.push(() => {
      bare.band(ty);
      cover.band(ty);
      rowKinds(ty, row);
      const o = ty * TILE * w;
      for (let i = 0; i < row.length; i++) {
        const k = row[i];
        grow[o + i] = k === GRASS || k === THICKET ? 1 : 0;
        // nothing grows on a bank (#360), and nothing reaches out over the drawn water and the wet line beside it
        allow[o + i] = k !== NONE && !(k === BANK && shore!.bankAt(((i % w) + 0.5) / TILE, (ty * TILE + Math.floor(i / w) + 0.5) / TILE) * TILE < WET_LINE) ? 1 : 0;
        if (deckAt && deckAt(((i % w) + 0.5) / TILE, (ty * TILE + Math.floor(i / w) + 0.5) / TILE) !== null) grow[o + i] = allow[o + i] = 0;
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
