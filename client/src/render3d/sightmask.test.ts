import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { DEFAULT_HAZE } from '../game/sightField';
import { TILE, TileMap } from '../sim/map';
import { View } from '../sim/view';
import { footSight, SightMask, type SightLook } from './sightmask';

const DARK: SightLook = { daylight: false, feather: 0, ramp: 0 };
const DAY: SightLook = { daylight: true, feather: DEFAULT_HAZE.feather, ramp: DEFAULT_HAZE.ramp };

/** An open room w×h tiles inside a ring of walls; `extra` maps "x,y" to a tile id placed inside. */
function room(w: number, h: number, extra: Record<string, number> = {}): TileMap {
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) tiles[y * w + x] = x === 0 || y === 0 || x === w - 1 || y === h - 1 ? TILE_ID.Wall : (extra[`${x},${y}`] ?? TILE_ID.Floor);
  return new TileMap(w, h, tiles);
}

/** The hard and the full view from (px, py) px. */
function views(map: TileMap, px: number, py: number, vision: number): { hard: View; all: View } {
  const hard = new View(map.w, map.h), all = new View(map.w, map.h);
  hard.compute(map, px, py, vision, 'hard');
  all.compute(map, px, py, vision, 'all');
  return { hard, all };
}

/** A mask filled from a viewer at the centre of tile (cx, cy). */
function filled(map: TileMap, cx: number, cy: number, vision: number, look: SightLook, withAll = true): SightMask {
  const { hard, all } = views(map, (cx + 0.5) * TILE, (cy + 0.5) * TILE, vision);
  const m = new SightMask(map, look);
  m.update(hard, withAll ? all : null, 0);
  return m;
}

describe('SightMask', () => {
  it('centres the square on the viewer and snaps it to texels', () => {
    const map = room(41, 41);
    const { hard } = views(map, 100.3, 80.7, 8);
    const m = new SightMask(map, DARK);
    m.update(hard, null, 0);
    expect(m.size).toBe(21);
    expect(Number.isInteger(m.ox * m.res)).toBe(true);
    expect(Number.isInteger(m.oz * m.res)).toBe(true);
    expect(Math.abs(m.ox + m.size / 2 - 100.3 / TILE)).toBeLessThanOrEqual(1 / m.res);
    expect(Math.abs(m.oz + m.size / 2 - 80.7 / TILE)).toBeLessThanOrEqual(1 / m.res);
  });

  it('resizes when the vision changes', () => {
    const map = room(41, 41);
    const m = new SightMask(map, DARK);
    const hard = new View(map.w, map.h);
    hard.compute(map, 320, 320, 8, 'hard');
    m.update(hard, null, 0);
    const n = m.n, data = m.data, version = m.version;
    hard.compute(map, 320, 320, 10, 'hard');
    m.update(hard, null, 0);
    expect(m.n).toBeGreaterThan(n);
    expect(m.data).not.toBe(data);
    expect(m.data.length).toBe(m.n * m.n * 2);
    expect(m.version).toBeGreaterThan(version);
  });

  it('outside the square is unseen', () => {
    const m = filled(room(41, 41), 20, 20, 8, DARK);
    expect(m.sample(50, 20)).toEqual({ hard: 1, soft: 0 });
    expect(m.sample(20, -10)).toEqual({ hard: 1, soft: 0 });
  });

  it('seen floor is 0, floor behind a pillar is 1, a visible wall tile is 0 whole, an unseen wall tile is 1', () => {
    const m = filled(room(21, 21, { '13,10': TILE_ID.Wall }), 10, 10, 8, DARK);
    expect(m.sample(10.5, 12.5).hard).toBe(0); // seen floor
    expect(m.sample(15.5, 10.5).hard).toBe(1); // behind the pillar
    for (const [x, z] of [[13.1, 10.1], [13.5, 10.5], [13.9, 10.9]]) expect(m.sample(x, z).hard).toBe(0); // the pillar, whole
    expect(m.sample(0.5, 10.5).hard).toBe(1); // a ring wall beyond sight
  });

  it('dark maps keep a crisp edge', () => {
    const m = filled(room(21, 21), 10, 10, 8, DARK);
    // the edge of sight along +x lies 8.5 tiles from the viewer
    const hards: number[] = [];
    for (let x = 18; x < 20; x += 1 / m.res) hards.push(m.sample(x, 10.5).hard);
    const last0 = hards.map((h) => h <= 0.05).lastIndexOf(true);
    const first1 = hards.findIndex((h) => h >= 0.95);
    expect(last0).toBeGreaterThanOrEqual(0);
    expect(first1).toBeGreaterThan(last0);
    expect(first1 - last0).toBeLessThanOrEqual(2);
  });

  it('daylight feathers the edge', () => {
    const m = filled(room(31, 31), 15, 15, 8, DAY);
    const hards: number[] = [];
    for (let x = 18; x < 26; x += 1 / m.res) hards.push(m.sample(x, 15.5).hard);
    const first = hards.findIndex((h) => h >= 0.1);
    const last = hards.map((h) => h <= 0.9).lastIndexOf(true);
    expect(last - first).toBeGreaterThanOrEqual(4);
    expect(m.sample(15.5, 15.5).hard).toBe(0);
    // beyond sight and beyond the blur's reach, fully unseen (the square's far side: the corner)
    const far = m.ox + m.n / m.res - 0.01;
    expect(m.sample(far, m.oz + m.n / m.res - 0.01).hard).toBe(1);
    for (let t = 0; t < m.n / m.res; t += 0.5) {
      expect(m.sample(m.ox + t, m.oz + 0.01).hard).toBe(1); // along the border
      expect(m.sample(far, m.oz + t).hard).toBe(1);
    }
  });

  it('soft is the share behind a trunk', () => {
    const map = room(31, 31, { '18,15': TILE_ID.Trunk });
    const dark = filled(map, 15, 15, 8, DARK);
    expect(dark.sample(20.5, 15.5).soft).toBeGreaterThanOrEqual(0.95); // two tiles behind
    expect(dark.sample(18.5, 17.5).soft).toBe(0); // beside it
    expect(dark.sample(25.5, 15.5)).toEqual({ hard: 1, soft: 0 }); // beyond sight
    expect(dark.sample(18.5, 15.5).hard).toBe(0); // light passes the trunk

    const day = filled(map, 15, 15, 8, DAY);
    const softs: number[] = [];
    // the ramp starts at the trunk's front face (x 18, where the sight polygon ends) and lasts 24 px = 1.5 tiles
    for (let x = 17.9; x <= 19.6; x += 1 / day.res) softs.push(day.sample(x, 15.5).soft);
    expect(softs[0]).toBeLessThan(0.3);
    expect(softs[softs.length - 1]).toBeGreaterThan(0.9);
    for (let i = 1; i < softs.length; i++) expect(softs[i]).toBeGreaterThanOrEqual(softs[i - 1] - 1e-6);
  });

  it('no all view, no soft', () => {
    const m = filled(room(31, 31, { '18,15': TILE_ID.Trunk }), 15, 15, 8, DARK, false);
    for (let k = 0; k < m.n * m.n; k++) expect(m.data[2 * k + 1]).toBe(0);
  });

  it('refills only when something changed', () => {
    const map = room(21, 21);
    const { hard, all } = views(map, 168, 168, 8);
    const m = new SightMask(map, DARK);
    expect(m.update(hard, all, 0)).toBe(true);
    const v = m.version;
    expect(m.update(hard, all, 0)).toBe(false);
    expect(m.version).toBe(v);
    expect(m.update(hard, all, 1)).toBe(true);
    hard.compute(map, 168, 168, 8, 'hard');
    expect(m.update(hard, all, 1)).toBe(true);
    expect(m.version).toBe(v + 2);
  });
});

describe('footSight', () => {
  it('takes the least value of a wide figure', () => {
    const m = filled(room(21, 21, { '13,10': TILE_ID.Wall }), 10, 10, 8, DARK);
    // centre behind the pillar's shadow edge: x 14.2, z 10.5 is hidden; the corner 0.8 tile toward -x lies in the pillar (seen whole)
    expect(m.sample(14.2, 10.5).hard).toBe(1);
    expect(footSight(m, 14.2, 10.5, 1).hard).toBe(0);
    expect(footSight(m, 14.2, 10.5, 0.4).hard).toBe(1);
  });

  it('probes the four diagonal corners, as the server does', () => {
    // a pillar diagonal from the viewer: the figure's centre and its four axis points (0.64 tile) are hidden, only the corner toward the pillar is seen
    const m = filled(room(21, 21, { '13,13': TILE_ID.Wall }), 10, 10, 8, DARK);
    const d = 0.64;
    for (const [dx, dz] of [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d]]) expect(m.sample(14.2 + dx, 14.2 + dz).hard).toBeCloseTo(1, 9);
    expect(m.sample(14.2 - d, 14.2 - d).hard).toBe(0);
    expect(footSight(m, 14.2, 14.2, 0.8).hard).toBe(0);
  });
});
