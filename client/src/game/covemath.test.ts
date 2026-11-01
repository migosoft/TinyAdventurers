import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COVE_PLANTS, COVE_TREE_FOOT, TRUNK_CLEAR, coveGrass, paintCove, placeCovePlants } from './covemath';

const spec = { w: 18 * 16, h: 15 * 16, tree: { x: 144, y: 144 }, seed: 1 };
const MARGIN = 32;
const FLOWERS = [[0xfd, 0xf7, 0xed], [0xfa, 0xcb, 0x3e], [0xe8, 0xa0, 0xc8], [0xca, 0xe6, 0xf5], [0xda, 0x4e, 0x38]];

describe('coveGrass', () => {
  const grass = coveGrass(spec);
  const cells: boolean[] = [];
  for (let y = 0; y < spec.h; y++) for (let x = 0; x < spec.w; x++) cells.push(grass(x, y));
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < spec.w && y < spec.h && cells[y * spec.w + x];

  const EIGHT = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  // Flood fill over cells of one kind from a start cell; `edgeOpen` lets it leave the area.
  const fill = (sx: number, sy: number, kind: boolean, edgeOpen: boolean, steps = [[1, 0], [-1, 0], [0, 1], [0, -1]]) => {
    const seen = new Set<number>([sy * spec.w + sx]);
    const todo = [[sx, sy]];
    let reachedEdge = false;
    while (todo.length) {
      const [x, y] = todo.pop()!;
      for (const [dx, dy] of steps) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= spec.w || ny >= spec.h) { reachedEdge = edgeOpen; continue; }
        if (at(nx, ny) !== kind || seen.has(ny * spec.w + nx)) continue;
        seen.add(ny * spec.w + nx);
        todo.push([nx, ny]);
      }
    }
    return { size: seen.size, reachedEdge };
  };

  it('is one carpet inside the inset', () => {
    expect(grass(spec.w / 2, spec.h / 2)).toBe(true);
    // The carpet is inset 22 px and its edge wobbles by up to 7 px, so it never gets closer than 15 px.
    for (let y = 0; y < spec.h; y++) for (let x = 0; x < spec.w; x++)
      if (Math.min(x, y, spec.w - 1 - x, spec.h - 1 - y) < 15) expect(at(x, y)).toBe(false);
    const total = cells.filter(Boolean).length;
    expect(fill(spec.w / 2, spec.h / 2, true, false).size).toBe(total); // no islands
    // no enclosed holes, bar the odd single pixel where the two wobbles cancel (the approved look has three)
    expect(spec.w * spec.h - total - fill(0, 0, false, true, EIGHT).size).toBeLessThanOrEqual(4);
  });
});

describe('paintCove', () => {
  it('is deterministic per seed', () => {
    expect(paintCove(spec).data).toEqual(paintCove(spec).data);
    expect(paintCove({ ...spec, seed: 2 }).data).not.toEqual(paintCove(spec).data);
  });

  it('has a two tile margin on every side', () => {
    const p = paintCove(spec);
    expect(p.w).toBe(spec.w + 64);
    expect(p.h).toBe(spec.h + 64);
    expect(p.data.length).toBe(p.w * p.h * 4);
  });

  it('has border blades of 2 to 4 px', () => {
    const grass = coveGrass(spec);
    const p = paintCove(spec);
    let blades = 0;
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const i = (y * p.w + x) * 4;
      const fx = x - MARGIN, fy = y - MARGIN;
      if (p.data[i + 3] !== 255 || p.data[i + 1] <= p.data[i] || grass(fx, fy)) continue;
      blades++;
      let near = Infinity;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++)
        if (grass(fx + dx, fy + dy)) near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dy)));
      expect(near).toBeLessThanOrEqual(4);
    }
    expect(blades).toBeGreaterThan(100);
  });

  it('puts flowers on grass, denser near the tree', () => {
    const grass = coveGrass(spec);
    const p = paintCove(spec);
    let near = 0, far = 0, nearArea = 0, farArea = 0;
    for (let y = 0; y < spec.h; y++) for (let x = 0; x < spec.w; x++) {
      const d = Math.hypot(x - spec.tree.x, y - spec.tree.y);
      const i = ((y + MARGIN) * p.w + x + MARGIN) * 4;
      const flower = FLOWERS.some((c) => c[0] === p.data[i] && c[1] === p.data[i + 1] && c[2] === p.data[i + 2]) && p.data[i + 3] === 255;
      if (flower) expect(grass(x, y)).toBe(true);
      if (d < 60) { nearArea++; if (flower) near++; } else if (d > 100) { farArea++; if (flower) far++; }
    }
    expect(far).toBeGreaterThan(0);
    expect(near / nearArea).toBeGreaterThanOrEqual(2 * (far / farArea));
  });

  it('shades the stone below the grass with black at alpha 115', () => {
    const p = paintCove(spec);
    const shadow = [...Array(p.w * p.h).keys()].filter((k) => p.data[k * 4 + 3] === 115 && p.data[k * 4] === 0);
    expect(shadow.length).toBeGreaterThan(100);
  });
});

describe('placeCovePlants', () => {
  const grass = coveGrass(spec);
  const plants = placeCovePlants(spec);
  const isBush = (f: string) => f.startsWith('cove_bush');

  it('is deterministic per seed', () => {
    expect(placeCovePlants(spec)).toEqual(plants);
    expect(placeCovePlants({ ...spec, seed: 2 })).not.toEqual(plants);
  });

  it('places at most 30, some near the tree', () => {
    expect(plants.length).toBeLessThanOrEqual(30);
    expect(plants.filter((p) => Math.hypot(p.x - spec.tree.x, p.y - spec.tree.y) < 70).length).toBeGreaterThanOrEqual(4);
  });

  it('keeps off the trunk, off each other and on grass', () => {
    for (const p of plants) {
      const inTrunk = Math.abs(p.x - spec.tree.x) < TRUNK_CLEAR.dx && p.y > spec.tree.y - TRUNK_CLEAR.up && p.y < spec.tree.y + TRUNK_CLEAR.down;
      expect(inTrunk).toBe(false);
      expect(grass(p.x, p.y)).toBe(true);
      expect(COVE_PLANTS).toContain(p.frame);
    }
    for (const a of plants) for (const b of plants) {
      if (a === b) continue;
      // a bush keeps 24 px from what is already placed, a tuft only 15 px from a bush placed before it
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(isBush(a.frame) && isBush(b.frame) ? 24 : 15);
    }
  });
});

const atlasPath = join(__dirname, '../../public/assets/atlas.json');
// The atlas is generated by `npm run atlas` (untracked); in a checkout that has not built it yet there is nothing to check.
describe.skipIf(!existsSync(atlasPath))('atlas', () => {
  const frames = existsSync(atlasPath) ? JSON.parse(readFileSync(atlasPath, 'utf8')).frames : {};
  it('holds the cove tree at 96x100 with the mirrored trunk foot', () => {
    expect(frames.cove_tree.sourceSize).toEqual({ w: 96, h: 100 });
    expect(COVE_TREE_FOOT).toEqual({ x: 48, y: 79 });
  });
  it('holds every cove plant frame', () => {
    for (const f of COVE_PLANTS) expect(frames[f]).toBeDefined();
  });
});
