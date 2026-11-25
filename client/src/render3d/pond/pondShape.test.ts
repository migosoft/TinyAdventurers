import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import demo from '../../generated/pond-demo.json';
import fixture from '../../generated/pond-shape-fixture.json';
import { inside } from './pondShape';

describe('the pond shape (#360)', () => {
  it('is the server\'s `inside`, to 1e-9 on every sample of the fixture', () => {
    expect(fixture).toHaveLength(4);
    for (const p of fixture) {
      expect(p.samples.length).toBe(300);
      for (const [x, y, v] of p.samples) expect(Math.abs(inside(p.blobs, p.seed, x, y) - v)).toBeLessThan(1e-9);
    }
  });

  it('the fixture straddles the shore', () => {
    for (const p of fixture) {
      expect(p.samples.some((s) => s[2] > 1)).toBe(true);
      expect(p.samples.some((s) => s[2] < -1)).toBe(true);
    }
  });

  it('a tile centre inside the shape is a water tile or a pond bridge\'s, and DeepWater lies inside', () => {
    demo.forEach((l) => {
      const pond = l.woodland.pond!;
      const bridge = (x: number, y: number) => pond.bridges.some((b) => x >= b.rect[0] && x < b.rect[0] + b.rect[2] && y >= b.rect[1] && y < b.rect[1] + b.rect[3]);
      for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) {
        const t = l.tiles[y * l.w + x], v = inside(pond.blobs, pond.seed, x + 0.5, y + 0.5);
        if (v > 0) expect(t === TILE_ID.ShallowWater || t === TILE_ID.DeepWater || bridge(x, y)).toBe(true);
        if (t === TILE_ID.DeepWater) expect(v).toBeGreaterThan(0);
      }
    });
  });
});
