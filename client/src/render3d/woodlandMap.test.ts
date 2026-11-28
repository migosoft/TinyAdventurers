import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { PLANT_KINDS } from './trees/kinds';
import { BRUSH_LANE, BRUSH_LANE_PLANTS, brushWalk, DEAD_TREE, KNIGHT_START, LEAF_ROW, ROAD_ROWS, SHAPE_ROW, WILLOW, WOODLAND_H, WOODLAND_STAGE_PLANTS, WOODLAND_W, woodlandStageMap } from './woodlandMap';

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

  it('has one dead tree of its own and one living willow', () => {
    expect(at(DEAD_TREE.x, DEAD_TREE.z)![7]).toBe(true);
    const willows = WOODLAND_STAGE_PLANTS.filter((p) => PLANT_KINDS[p[0]] === 'willow');
    expect(willows).toEqual([at(WILLOW.x, WILLOW.z)]);
    expect(willows[0][7]).toBe(false);
  });
});

describe('the brush lane (#331)', () => {
  const map = woodlandStageMap(true);
  it('has a bush and a small round tree beside it, on the lane, with the lane walkable', () => {
    expect(BRUSH_LANE.bush.z).toBeCloseTo(BRUSH_LANE.z + 0.5, 1);
    expect(map.get(Math.floor(BRUSH_LANE.bush.x), Math.floor(BRUSH_LANE.bush.z))).toBe(TILE_ID.Floor);
    expect(map.get(BRUSH_LANE.tree.tx, BRUSH_LANE.tree.tz)).toBe(TILE_ID.Trunk);
    for (let x = BRUSH_LANE.bush.x - 4; x <= BRUSH_LANE.bush.x + 4; x++) expect(map.blocks(Math.floor(x), BRUSH_LANE.z, 'hero')).toBe(false);
    expect(BRUSH_LANE_PLANTS.map((s) => s.form)).toEqual(['bush', 'round']);
    expect(BRUSH_LANE_PLANTS[1].scalePct).toBe(60);
    expect(woodlandStageMap().get(BRUSH_LANE.tree.tx, BRUSH_LANE.tree.tz)).toBe(TILE_ID.Floor);
  });

  it('brushWalk is periodic, stays on the lane within 3 tiles of the bush and passes the bush', () => {
    for (let t = 0; t < 12; t += 0.37) {
      const w = brushWalk(t);
      expect(brushWalk(t + BRUSH_LANE.period).x).toBeCloseTo(w.x, 6);
      expect(w.z).toBe(BRUSH_LANE.z + 0.5);
      expect(Math.abs(w.x - BRUSH_LANE.bush.x)).toBeLessThanOrEqual(3 + 1e-9);
    }
    const xs = Array.from({ length: 600 }, (_, i) => brushWalk(i * 0.02).x);
    expect(Math.min(...xs)).toBeLessThan(BRUSH_LANE.bush.x - 2.9);
    expect(Math.max(...xs)).toBeGreaterThan(BRUSH_LANE.bush.x + 2.9);
  });
});
