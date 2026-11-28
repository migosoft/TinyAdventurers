import { describe, expect, it } from 'vitest';
import { CUT_DEFAULTS, columnTop, cutWeight, cutWeightAt, cutY, torchHidden, hiddenPoint, hides } from './cut';

const SLOPE = 1 / Math.tan((48.6 * Math.PI) / 180);
const L = CUT_DEFAULTS;

/** A room: floor (0) where `.`, wall (2) where `#`; row z, column x. */
const ROOM = ['#######', '#.....#', '#.....#', '#.....#', '#######'];
const cellH = (x: number, z: number) => (ROOM[z]?.[x] === '.' ? 0 : 2);
const hidesAt = (px: number, pz: number, y: number, rx: number, rz: number, seen = (_x: number, _z: number) => 1) => hides(px, pz, y, 0, rx, rz, SLOPE, L.stub, cellH, seen);

describe('cut', () => {
  it('has the amended defaults', () => {
    expect(L).toEqual({ on: true, stub: 0.25, line: -1.5, ramp: 0.1, edge: 0.1 });
  });

  it('the hidden point lies behind the point, away from the camera, further for a higher point', () => {
    expect(hiddenPoint(3, 3, 0, 0, 0, 1, SLOPE)).toEqual({ x: 3, z: 3 });
    const a = hiddenPoint(3, 3, 1, 0, 0, 1, SLOPE), b = hiddenPoint(3, 3, 2, 0, 0, 1, SLOPE);
    expect(a.x).toBe(3);
    expect(a.z).toBeCloseTo(3 - SLOPE);
    expect(b.z).toBeCloseTo(3 - 2 * SLOPE);
    expect(hiddenPoint(3, 3, 3, 1, 0, 1, SLOPE).z).toBeCloseTo(3 - 2 * SLOPE); // from the floor level f
  });

  it('a near wall beside the hero hides seen floor and is cut (45 degrees)', () => {
    const r = Math.SQRT1_2;
    // A point on the south wall's top at (3, 4.2), 2 high; the camera is toward +x +z, so the floor it covers lies at -x -z.
    const h = hidesAt(3, 4.2, 2, r, r);
    expect(h).toBeGreaterThan(0.95);
    expect(cutWeight(-0.2, h, L)).toBe(1);
  });

  it('a far wall whose point hides only wall or unseen ground stays full', () => {
    // The north wall, camera at +z: behind its top lies more wall.
    expect(hidesAt(3.5, 0.9, 2, 0, 1)).toBeLessThan(0.05);
    expect(cutWeight(-3, 0, L)).toBe(0);
    // Seen only nearer: floor behind a wall top exists, but the hero does not see it.
    expect(hidesAt(3.5, 4.2, 2, 0, 1, () => 0)).toBe(0);
  });

  it('a side wall seen edge-on (the ray parallel to it) stays full at its room edge', () => {
    // The east wall's room-edge top point (x = 6, any z), the camera straight along z: Q moves along the wall only, the bilinear mix is half wall, half floor.
    for (const z of [3.5, 4.2, 4.5]) {
      const h = hidesAt(6, z, 2, 0, 1);
      expect(h).toBeCloseTo(0.5, 1);
      expect(cutWeight(0, h, L)).toBe(0);
    }
    // and the same for the west wall and for the camera along x
    expect(cutWeight(0, hidesAt(1, 4.2, 2, 0, 1), L)).toBe(0);
    expect(cutWeight(0, hidesAt(3.5, 1, 2, 1, 0), L)).toBe(0);
  });

  it('a taller wall hides floor further back', () => {
    const near = hiddenPoint(3, 4, 2, 0, 0, 1, SLOPE), tall = hiddenPoint(3, 4, 4, 0, 0, 1, SLOPE);
    expect(tall.z).toBeLessThan(near.z);
  });

  it('the edge is steep and the line only keeps what lies behind it', () => {
    expect(cutWeight(0, 0.55, L)).toBe(0);
    expect(cutWeight(0, 0.7, L)).toBe(1);
    expect(cutWeight(0, 0.62, L)).toBeCloseTo(0.5);
    expect(cutWeight(-1.6, 1, L)).toBe(0);
    expect(cutWeight(-1.4, 1, L)).toBe(1);
  });

  it('does nothing when off', () => {
    expect(cutY(2, 5, 1, 0, { ...L, on: false })).toBe(2);
  });

  it('lowers a wall to the stub, whatever its height, and follows the floor', () => {
    expect(cutY(2, 0.5, 1, 0, L)).toBe(0.25);
    expect(cutY(3.5, 5, 1, 0, L)).toBe(0.25);
    expect(cutY(2, 5, 1, 1, L)).toBe(1.25);
  });

  it('keeps floors, basins and chasms', () => {
    expect(cutY(0.1, 5, 1, 0, L)).toBe(0.1);
    expect(cutY(-0.6, 5, 1, 0, L)).toBe(-0.6);
  });

  it('leaves everything alone where nothing is hidden', () => {
    expect(cutY(2, 5, 0, 0, L)).toBe(2);
  });
});

describe('whole columns and torches', () => {
  // A thin wall (column 3) between two rooms, the hero at (2, 2.5) in the left one; `rx` -1: the camera is toward -x, so the wall's -x face hides the right room.
  const GRID = ['#######', '#..#..#', '#..#..#', '#..#..#', '#######'];
  const h = (x: number, z: number) => (GRID[z]?.[x] === '.' ? 0 : 2);
  const w = (px: number, pz: number, y: number, rx = 1, rz = 0) => cutWeightAt(px, pz, y, 2, 2.5, 0, rx, rz, SLOPE, h, () => 1, L);

  it('the column top: a wall edge point reads the wall height, a floor point its own', () => {
    expect(columnTop(3, 2.5, 0, h)).toBe(2);
    expect(columnTop(2.5, 2.5, 0.3, h)).toBe(0.3);
  });

  it('every vertex of the camera-facing face of a cut thin wall has the weight of its top', () => {
    // Without the column top the vertex at 1.28 reads under the band (0.63) and the face would stand there.
    const top = w(3, 2.5, 2, -1, 0);
    expect(top).toBe(1);
    for (const y of [0, 0.31, 0.66, 0.91, 1.28, 1.63, 2]) expect(w(3, 2.5, y, -1, 0)).toBe(top);
  });

  it('a frieze vertex standing 0.05 out of the wall gets the weight of the wall top', () => {
    for (const y of [0, 0.31, 1.28, 1.63, 2]) expect(w(2.95, 2.5, y, -1, 0)).toBe(w(3, 2.5, 2, -1, 0));
  });

  it('at 45 degrees both edges of a thin near wall are cut (the south edge covers floor a quarter tile from the wall)', () => {
    const rows = ['#########', ...Array(4).fill('#.......#'), '#########', ...Array(3).fill('#.......#'), '#########'];
    const hh = (x: number, z: number) => (rows[z]?.[x] === '.' ? 0 : 2);
    const r = Math.SQRT1_2;
    for (const z of [5, 6]) for (const x of [3, 3.5, 4]) for (const y of [0, 1.28, 2]) expect(cutWeightAt(x, z, y, 4.5, 2.5, 0, -r, r, SLOPE, hh, () => 1, L)).toBe(1);
  });

  it('a torch on a thin near wall is hidden when its wall is cut, on a far wall kept, edge-on kept', () => {
    const hidden = (wx: number, wz: number, nx: number, nz: number, rx: number, rz: number) => torchHidden(wx, wz, nx, nz, 1.14, 2, 2.5, 0, rx, rz, SLOPE, h, () => 1, L);
    expect(hidden(3, 2.5, 1, 0, -1, 0)).toBe(true); // the thin wall's right-room face (normal +x), camera toward -x: the wall hides the right room
    expect(hidden(1, 2.5, 1, 0, 1, 0)).toBe(false); // the west wall behind the hero, camera at +x: nothing to hide
    expect(hidden(6, 2.5, -1, 0, 0, 1)).toBe(false); // the east wall seen edge-on
  });
});
