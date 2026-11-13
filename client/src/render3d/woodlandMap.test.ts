import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { PLANT_KINDS } from '../game/vegetation';
import { KNIGHT_START, ROAD_ROWS, WOODLAND_H, WOODLAND_STAGE_PLANTS, WOODLAND_W, woodlandStageMap } from './woodlandMap';

describe('the woodland stage map', () => {
  const map = woodlandStageMap();

  it('is 40 x 26 tiles with Void beyond the edge rows', () => {
    expect([map.w, map.h]).toEqual([40, 26]);
    expect([WOODLAND_W, WOODLAND_H]).toEqual([40, 26]);
    for (let x = 0; x < map.w; x++) {
      expect(map.get(x, 0)).toBe(TILE_ID.Void);
      expect(map.get(x, map.h - 1)).toBe(TILE_ID.Void);
    }
  });

  it('puts every plant on a tile of the right kind: trees on Trunk, bushes on Thicket', () => {
    for (const [kind, x, y] of WOODLAND_STAGE_PLANTS) {
      const tile = map.get(Math.floor(x / 16), Math.floor(y / 16));
      expect(tile, `${PLANT_KINDS[kind]} at ${x},${y}`).toBe(PLANT_KINDS[kind] === 'bush' ? TILE_ID.Thicket : TILE_ID.Trunk);
    }
  });

  it('lists every plant kind', () => {
    expect(new Set(WOODLAND_STAGE_PLANTS.map((p) => p[0]))).toEqual(new Set(PLANT_KINDS.map((_, i) => i)));
  });

  it('has a walkable road across, a forest edge of trunks and thickets, and the knight on grass', () => {
    for (const z of ROAD_ROWS) for (let x = 0; x < map.w; x++) {
      expect(map.get(x, z)).toBe(TILE_ID.Road);
      expect(map.blocks(x, z, 'hero')).toBe(false);
    }
    expect(map.get(Math.floor(KNIGHT_START.x), Math.floor(KNIGHT_START.z))).toBe(TILE_ID.Floor);
    const tiles = Array.from(map.tiles);
    expect(tiles).toContain(TILE_ID.Trunk);
    expect(tiles).toContain(TILE_ID.Thicket);
  });
});
