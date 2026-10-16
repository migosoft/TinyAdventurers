import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { TILE, TileMap } from './map';
import { View } from './view';
import { inside, sightPolygon } from './vispoly';

/** A map from rows of characters: '#' wall, anything else floor. */
function grid(rows: string[]): TileMap {
  const w = rows[0].length;
  const tiles = new Uint8Array(w * rows.length);
  rows.forEach((row, y) => [...row].forEach((c, x) => (tiles[y * w + x] = c === '#' ? TILE_ID.Wall : TILE_ID.Floor)));
  return new TileMap(w, rows.length, tiles);
}

/** An open room w×h tiles inside a ring of walls, with optional extra walls. */
function room(w: number, h: number, walls: [number, number][] = []): TileMap {
  const rows = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 || walls.some(([a, b]) => a === x && b === y) ? '#' : '.')).join(''),
  );
  return grid(rows);
}

describe('inside', () => {
  it('finds points in an open room by distance, across ±π too', () => {
    const s = sightPolygon(room(21, 21), 168, 168, 80);
    expect(inside(s, 168, 168, 168 + 79, 168)).toBe(true);
    expect(inside(s, 168, 168, 168 + 81, 168)).toBe(false);
    expect(inside(s, 168, 168, 168 - 79, 168)).toBe(true); // angle π: the closing edge
    expect(inside(s, 168, 168, 168 - 81, 168.001)).toBe(false);
  });

  it('is false behind a pillar, true beside it', () => {
    const s = sightPolygon(room(21, 21, [[13, 10]]), 168, 168, 128);
    expect(inside(s, 168, 168, 240, 168)).toBe(false);
    expect(inside(s, 168, 168, 240, 200)).toBe(true);
  });
});

describe('View', () => {
  it('sees the floor tiles the polygon reaches behind a doorway, beyond the tile FOV', () => {
    // The final review's case: a wall at column 10 with a doorway at (10, 5); the hero in the lower left of tile (9, 4).
    const rows = Array.from({ length: 11 }, (_, y) =>
      Array.from({ length: 21 }, (_, x) => (x === 0 || y === 0 || x === 20 || y === 10 || (x === 10 && y !== 5) ? '#' : '.')).join(''),
    );
    const map = grid(rows);
    const v = new View(map.w, map.h);
    v.compute(map, 144.8, 79.2, 9);
    expect(v.fov.isVisible(15, 5)).toBe(false);
    expect(v.isVisible(15, 5)).toBe(true);
    expect(v.isVisible(15, 2)).toBe(false); // behind the wall
  });

  it('shows walls by the tile FOV and nothing off the map', () => {
    const map = room(9, 9);
    const v = new View(map.w, map.h);
    v.compute(map, 4.5 * TILE, 4.5 * TILE, 9);
    expect(v.fov.isVisible(0, 4)).toBe(true);
    expect(v.isVisible(0, 4)).toBe(true);
    expect(v.isVisible(-1, 4)).toBe(false);
  });

  it('lets a blind viewer see its own tile only', () => {
    const map = room(9, 9);
    const v = new View(map.w, map.h);
    v.compute(map, 4.5 * TILE, 4.5 * TILE, 0);
    expect(v.isVisible(4, 4)).toBe(true);
    expect(v.isVisible(6, 4)).toBe(false);
  });

  it('bumps its version on every compute', () => {
    const map = room(9, 9);
    const v = new View(map.w, map.h);
    v.compute(map, 70, 70, 9);
    const first = v.version;
    v.compute(map, 70, 70, 9);
    expect(v.version).toBe(first + 1);
  });
});
