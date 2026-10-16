import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { TILE, TileMap } from './map';
import { sightRadius, visibilityPolygon, wallSegments } from './vispoly';

/** A map from rows of characters: '#' wall, 'D' closed door, 'd' open door, anything else floor. */
function grid(rows: string[]): TileMap {
  const w = rows[0].length;
  const h = rows.length;
  const tiles = new Uint8Array(w * h);
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      tiles[y * w + x] = c === '#' ? TILE_ID.Wall : c === 'D' ? TILE_ID.DoorClosed : c === 'd' ? TILE_ID.DoorOpen : TILE_ID.Floor;
    }),
  );
  return new TileMap(w, h, tiles);
}

/** An open room w×h tiles inside a ring of walls, with optional extra walls. */
function room(w: number, h: number, walls: [number, number][] = []): TileMap {
  const rows = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 || walls.some(([a, b]) => a === x && b === y) ? '#' : '.')).join(''),
  );
  return grid(rows);
}

/** The polygon's points as [x, y, distance from (px, py), angle]. */
function points(poly: number[], px: number, py: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < poly.length; i += 2) out.push([poly[i], poly[i + 1], Math.hypot(poly[i] - px, poly[i + 1] - py), Math.atan2(poly[i + 1] - py, poly[i] - px)]);
  return out;
}

describe('wallSegments', () => {
  it('merges each straight wall into one segment', () => {
    const map = grid(['#######', '#.....#', '#.....#', '#.....#', '#######']);
    const segs = wallSegments(map, 3.5 * TILE, 2.5 * TILE, 100);
    expect(segs).toHaveLength(4);
    expect(segs).toEqual(
      expect.arrayContaining([
        [16, 16, 96, 16], // top
        [16, 64, 96, 64], // bottom
        [16, 16, 16, 64], // left
        [96, 16, 96, 64], // right
      ]),
    );
  });
});

describe('visibilityPolygon', () => {
  it('is a circle of radius r in an open room', () => {
    const map = room(21, 21);
    for (const [px, py] of [
      [10.5 * TILE, 10.5 * TILE],
      [10 * TILE, 10 * TILE], // exactly on a tile corner
    ]) {
      const pts = points(visibilityPolygon(map, px, py, 5 * TILE), px, py);
      expect(pts.length).toBeGreaterThanOrEqual(96);
      for (const [, , d] of pts) expect(d).toBeCloseTo(5 * TILE, 6);
    }
  });

  it('is a small circle for a blind hero (vision 0)', () => {
    expect(sightRadius(0)).toBe(8);
    expect(sightRadius(9)).toBe(9.5 * TILE);
    const map = room(5, 5);
    const pts = points(visibilityPolygon(map, 2.5 * TILE, 2.5 * TILE, sightRadius(0)), 2.5 * TILE, 2.5 * TILE);
    expect(pts.length).toBeGreaterThanOrEqual(96);
    for (const [, , d] of pts) expect(d).toBeCloseTo(8, 6);
  });

  it('casts a straight shadow wedge behind a pillar', () => {
    // Viewer at (168, 168), the middle of tile (10, 10); pillar at tile (13, 10): its near face is x = 208, y 160..176.
    const map = room(21, 21, [[13, 10]]);
    const [px, py] = [168, 168];
    const r = 8 * TILE;
    const pts = points(visibilityPolygon(map, px, py, r), px, py);
    const half = Math.atan2(8, 40); // the wedge's half angle, 0.197
    const inWedge = pts.filter(([, , , a]) => Math.abs(a) < half - 0.01);
    const beside = pts.filter(([, , , a]) => Math.abs(a) > half + 0.05 && Math.abs(a) < 0.6);
    expect(inWedge.length).toBeGreaterThan(0);
    expect(beside.length).toBeGreaterThan(0);
    // In the wedge every ray stops on the pillar's near face.
    for (const [x] of inWedge) expect(x).toBeCloseTo(208, 6);
    // Just beside it the view is open to the radius (the room's walls are 9.5 tiles away).
    for (const [, , d] of beside) expect(d).toBeCloseTo(r, 6);
  });

  it('stays inside a corridor', () => {
    const map = grid(['###########', '#.........#', '###########']);
    const [px, py] = [1.5 * TILE, 1.5 * TILE];
    const pts = points(visibilityPolygon(map, px, py, 8 * TILE), px, py);
    for (const [x, y] of pts) {
      expect(y).toBeGreaterThanOrEqual(16 - 1e-6);
      expect(y).toBeLessThanOrEqual(32 + 1e-6);
      expect(x).toBeGreaterThanOrEqual(16 - 1e-6);
    }
    expect(Math.max(...pts.map(([x]) => x))).toBeCloseTo(px + 8 * TILE, 6);
  });

  it('is blocked by a closed door, not by an open one', () => {
    const [px, py] = [1.5 * TILE, 1.5 * TILE];
    const far = (rows: string[]) => Math.max(...points(visibilityPolygon(grid(rows), px, py, 10 * TILE), px, py).map(([x]) => x));
    expect(far(['#########', '#...D...#', '#########'])).toBeCloseTo(4 * TILE, 6);
    expect(far(['#########', '#...d...#', '#########'])).toBeCloseTo(8 * TILE, 6);
  });

  it('stops at the map edge where a room has no walls', () => {
    const map = grid(['.....', '.....', '.....', '.....', '.....']);
    const pts = points(visibilityPolygon(map, 2.5 * TILE, 2.5 * TILE, 10 * TILE), 2.5 * TILE, 2.5 * TILE);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeGreaterThanOrEqual(-1e-6);
      expect(x).toBeLessThanOrEqual(5 * TILE + 1e-6);
      expect(y).toBeLessThanOrEqual(5 * TILE + 1e-6);
    }
    expect(Math.max(...pts.map(([x]) => x))).toBeCloseTo(5 * TILE, 6);
  });
});
