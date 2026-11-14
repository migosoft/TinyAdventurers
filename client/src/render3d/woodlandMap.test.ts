import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { PLANT_KINDS } from '../game/vegetation';
import { DEAD_TREE, KNIGHT_START, LEAF_ROW, ROAD_ROWS, SHAPE_ROW, WOODLAND_H, WOODLAND_STAGE_EXTRA, WOODLAND_STAGE_PLANTS, WOODLAND_W, woodlandStageMap } from './woodlandMap';

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

describe('the line-ups on the woodland stage', () => {
  const map = woodlandStageMap();
  const at = (x: number, z: number) => WOODLAND_STAGE_PLANTS.find((p) => Math.floor(p[1] / 16) === x && Math.floor(p[2] / 16) === z);

  it('has a row of five round trees, one seed and scale, leaf 0, 25, 50, 75 and 100', () => {
    expect(LEAF_ROW.xs).toHaveLength(5);
    const row = LEAF_ROW.xs.map((x) => at(x, LEAF_ROW.z)!);
    expect(row.every((p) => p !== undefined && PLANT_KINDS[p[0]] === 'round')).toBe(true);
    expect(new Set(row.map((p) => p[3])).size).toBe(1);
    expect(new Set(row.map((p) => p[4])).size).toBe(1);
    expect(row.map((p) => p[6])).toEqual([0, 25, 50, 75, 100]);
    expect(row.every((p) => !p[7])).toBe(true);
  });

  it('has round, wide and tall trees at three seeds each, living and full of leaves', () => {
    const row = SHAPE_ROW.xs.map((x) => at(x, SHAPE_ROW.z)!);
    expect(row.map((p) => PLANT_KINDS[p[0]])).toEqual(['round', 'round', 'round', 'wide', 'wide', 'wide', 'tall', 'tall', 'tall']);
    for (const form of ['round', 'wide', 'tall']) {
      expect(new Set(row.filter((p) => PLANT_KINDS[p[0]] === form).map((p) => p[3])).size).toBe(3);
    }
    expect(row.every((p) => p[6] === 100 && !p[7])).toBe(true);
  });

  it('stands every line-up tree on a Trunk tile', () => {
    for (const x of LEAF_ROW.xs) expect(map.get(x, LEAF_ROW.z)).toBe(TILE_ID.Trunk);
    for (const x of SHAPE_ROW.xs) expect(map.get(x, SHAPE_ROW.z)).toBe(TILE_ID.Trunk);
    expect(map.get(DEAD_TREE.x, DEAD_TREE.z)).toBe(TILE_ID.Trunk);
  });

  it('has one dead tree of its own and a willow apart from the server kinds', () => {
    expect(at(DEAD_TREE.x, DEAD_TREE.z)![7]).toBe(true);
    expect(WOODLAND_STAGE_EXTRA).toHaveLength(1);
    const w = WOODLAND_STAGE_EXTRA[0];
    expect(w.form).toBe('willow');
    expect(w.dead).toBe(false);
    expect(map.get(Math.floor(w.x), Math.floor(w.z))).toBe(TILE_ID.Trunk);
    expect(PLANT_KINDS as readonly string[]).not.toContain('willow');
  });
});
