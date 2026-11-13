import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TILE_ID } from '../generated/defs';
import { TILE, TileMap } from '../sim/map';
import { View } from '../sim/view';
import { blurField, canvasRes, extendPoints, extendRim, fillPolygon, rampLayers, shadeCovers } from './sightField';

describe('sightField.ts has no Phaser', () => {
  it('imports no phaser module and only relative modules that exist', () => {
    const file = join(__dirname, 'sightField.ts');
    expect(existsSync(file)).toBe(true);
    const src = readFileSync(file, 'utf8');
    const specs = [...src.matchAll(/(?:\bimport|\bexport)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? m[2]);
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) {
      expect(s.startsWith('phaser')).toBe(false);
      expect(s.startsWith('.')).toBe(true);
    }
  });
});

describe('extendPoints', () => {
  it('moves every point outward along its ray from the centre', () => {
    const out = extendPoints([10, 0, 0, -20, -3, -4], 0, 0, 5);
    expect(out[0]).toBeCloseTo(15);
    expect(out[1]).toBeCloseTo(0);
    expect(out[2]).toBeCloseTo(0);
    expect(out[3]).toBeCloseTo(-25);
    expect(out[4]).toBeCloseTo(-6);
    expect(out[5]).toBeCloseTo(-8);
  });
  it('works around an off-origin centre and keeps a point at the centre where it is', () => {
    expect(extendPoints([13, 4, 3, 4], 3, 4, 2)).toEqual([15, 4, 3, 4]);
  });
});

describe('extendRim', () => {
  it('moves only the points at the radius (within 1 px)', () => {
    const out = extendRim([40, 0, 39.5, 0, 38, 0, 0, 40.9], 0, 0, 40, 10);
    expect(out[0]).toBeCloseTo(50);
    expect(out[2]).toBeCloseTo(49.5);
    expect(out.slice(4, 6)).toEqual([38, 0]);
    expect(out[6]).toBeCloseTo(0);
    expect(out[7]).toBeCloseTo(50.9);
  });
});

describe('the wedge geometry', () => {
  it('a full polygon at radius r, rim-extended then grown by any depth, lies beyond r + ext (the ramp cannot touch the fog ring)', () => {
    const r = 232, ext = 72;
    const pts: number[] = [];
    for (let a = 0; a < 16; a++) pts.push(100 + r * Math.cos(a), 50 + r * Math.sin(a));
    for (const depth of [0, 6, 18]) {
      const grown = extendPoints(extendRim(pts, 100, 50, r, ext), 100, 50, depth);
      for (let i = 0; i < grown.length; i += 2) expect(Math.hypot(grown[i] - 100, grown[i + 1] - 50)).toBeGreaterThanOrEqual(r + ext - 1e-6);
    }
  });
  it('a blocked ray point grows by exactly the depth and a reused output array is overwritten', () => {
    const out: number[] = [9, 9, 9, 9, 9, 9];
    const g = extendPoints(extendRim([60, 0, 232, 0], 0, 0, 232, 72), 0, 0, 12, out);
    expect(g).toBe(out);
    expect(g.length).toBe(4);
    expect(g[0]).toBeCloseTo(72);
    expect(g[2]).toBeCloseTo(232 + 72 + 12);
  });
});

describe('rampLayers', () => {
  it('four layers from depth 0 to three quarters of the ramp, lightest first, the last at the soft grey', () => {
    const l = rampLayers(0, 24, 4);
    expect(l.map((x) => x.depth)).toEqual([0, 6, 12, 18]);
    expect(l.map((x) => x.grey)).toEqual([191, 128, 64, 0]);
  });
  it('ramp 0: one crisp layer at the full soft grey', () => {
    expect(rampLayers(77, 0, 4)).toEqual([{ depth: 0, grey: 77 }]);
  });
});

/** A w×h grey field whose values come from `f(x, y)`. */
const field = (w: number, h: number, f: (x: number, y: number) => number) => {
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = f(x, y);
  return d;
};

describe('blurField', () => {
  it('keeps a constant field constant', () => {
    const d = field(20, 12, () => 77);
    blurField(d, 20, 12, 3, new Float32Array(240));
    for (const v of d) expect(v).toBeCloseTo(77, 3);
  });
  it('turns a hard step into a monotonic ramp about 3 x radius wide', () => {
    const w = 60, r = 4;
    const d = field(w, 3, (x) => (x < 30 ? 0 : 255));
    blurField(d, w, 3, r, new Float32Array(w * 3));
    const row = Array.from({ length: w }, (_, x) => Math.round(d[x]));
    for (let x = 1; x < w; x++) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1]);
    expect(row[30 - 3 * r - 1]).toBe(0);
    expect(row[30 + 3 * r]).toBe(255);
    const mid = row.filter((v) => v > 0 && v < 255).length;
    expect(mid).toBeGreaterThan(2 * r);
    expect(mid).toBeLessThanOrEqual(6 * r);
  });
  it('blurs vertically too', () => {
    const d = field(8, 30, (_, y) => (y < 15 ? 0 : 255));
    blurField(d, 8, 30, 2, new Float32Array(240));
    expect(d[15 * 8]).toBeGreaterThan(0);
    expect(d[15 * 8]).toBeLessThan(255);
  });
  it('radius 0 leaves the field unchanged', () => {
    const d = field(10, 4, (x) => x * 20);
    const before = d.slice();
    blurField(d, 10, 4, 0, new Float32Array(40));
    expect(d).toEqual(before);
  });
});

describe('fillPolygon', () => {
  const scratch = () => ({ xs: [] as number[][], row: new Float32Array(0) });
  it('a pixel-aligned rectangle is white inside and leaves the grey outside', () => {
    const d = field(10, 8, () => 40);
    // world rectangle 8..24 × 4..20 at origin (4, 0), 0.25 canvas px per world px: canvas px 1..5 × 1..5
    fillPolygon(d, 10, 8, [8, 4, 24, 4, 24, 20, 8, 20], 4, 0, 0.25, scratch());
    for (let y = 0; y < 8; y++) for (let x = 0; x < 10; x++) expect(d[y * 10 + x]).toBeCloseTo(x >= 1 && x < 5 && y >= 1 && y < 5 ? 255 : 40);
  });
  it('a half-covered pixel goes half way to white, horizontally and vertically', () => {
    const d = field(6, 6, () => 0);
    fillPolygon(d, 6, 6, [1.5, 1, 4, 1, 4, 2.5, 1.5, 2.5], 0, 0, 1, scratch());
    expect(d[1 * 6 + 1]).toBeCloseTo(127.5); // left edge at x 1.5
    expect(d[1 * 6 + 2]).toBeCloseTo(255);
    expect(d[2 * 6 + 2]).toBeCloseTo(127.5); // bottom edge at y 2.5 (2 of 4 sub-scanlines)
    expect(d[3 * 6 + 2]).toBe(0);
  });
  it('a triangle adds its area, in either winding, and clips to the field', () => {
    for (const pts of [[0, 0, 12, 0, 0, 12], [0, 0, 0, 12, 12, 0], [-6, -6, 20, -6, -6, 20]]) {
      const d = field(8, 8, () => 0);
      fillPolygon(d, 8, 8, pts, 0, 0, 1, scratch());
      const area = d.reduce((a, v) => a + v / 255, 0);
      // each misses the field's corner beyond its long side: x + y = 12 (a 4 x 4 half square) or x + y = 14 (2 x 2)
      const inField = pts[0] < 0 ? 64 - (2 * 2) / 2 : 64 - (4 * 4) / 2;
      expect(area).toBeCloseTo(inField, 0);
    }
  });
  it('a reused scratch gives the same field', () => {
    const s = scratch();
    const poly = [1, 1, 7.3, 2, 5, 6.6, 2.2, 5];
    const a = field(9, 9, () => 10), b = field(9, 9, () => 10);
    fillPolygon(a, 9, 9, [0, 0, 9, 0, 9, 9], 0, 0, 1, s);
    a.fill(10);
    fillPolygon(a, 9, 9, poly, 0, 0, 1, s);
    fillPolygon(b, 9, 9, poly, 0, 0, 1, scratch());
    expect(a).toEqual(b);
  });
});

describe('canvasRes', () => {
  it('draws the haze mask at half the resolution of the dark mask (#280)', () => {
    expect(canvasRes(false)).toBe(8);
    expect(canvasRes(true)).toBe(4);
  });
});

/** A 20x20 map ringed by walls, `extra` placed on top. */
function map(extra: [number, number, number][]): TileMap {
  const m = new TileMap(20, 20, new Uint8Array(400).fill(TILE_ID.Floor));
  for (let i = 0; i < 20; i++) for (const [x, y] of [[i, 0], [i, 19], [0, i], [19, i]]) m.set(x, y, TILE_ID.Wall);
  for (const [x, y, t] of extra) m.set(x, y, t);
  return m;
}

function views(m: TileMap, px: number, py: number): [View, View] {
  const hard = new View(m.w, m.h);
  const all = new View(m.w, m.h);
  hard.compute(m, px, py, 12, 'hard');
  all.compute(m, px, py, 12, 'all');
  return [hard, all];
}

describe('the soft shadow', () => {
  it('the ground behind a trunk is shaded, the rest is not', () => {
    const m = map([[10, 10, TILE_ID.Trunk]]);
    const [hard, all] = views(m, 10.5 * TILE, 14.5 * TILE);
    expect(shadeCovers(hard, all, 10.5 * TILE, 6.5 * TILE)).toBe(true);
    expect(shadeCovers(hard, all, 10.5 * TILE, 12.5 * TILE)).toBe(false);
    expect(shadeCovers(hard, all, 4.5 * TILE, 14.5 * TILE)).toBe(false);
  });
  it('no soft blockers, no shade', () => {
    const m = map([]);
    const [hard, all] = views(m, 10.5 * TILE, 14.5 * TILE);
    for (let y = 1; y < 19; y++) for (let x = 1; x < 19; x++) expect(shadeCovers(hard, all, (x + 0.5) * TILE, (y + 0.5) * TILE)).toBe(false);
  });
  it('walls stay black', () => {
    const m = map([[10, 10, TILE_ID.Wall]]);
    const [hard, all] = views(m, 10.5 * TILE, 14.5 * TILE);
    expect(shadeCovers(hard, all, 10.5 * TILE, 6.5 * TILE)).toBe(false);
  });
});
