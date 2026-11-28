import { describe, expect, it } from 'vitest';
import { CUT_DEFAULTS, cutWeight, cutY, hiddenPoint } from './cut';

const SLOPE = 1 / Math.tan((48.6 * Math.PI) / 180);
const L = CUT_DEFAULTS;

/** A room: floor (0) where `.`, wall (2) where `#`; row z, column x. `seen` marks the floor columns the hero sees. */
const ROOM = ['#######', '#.....#', '#.....#', '#.....#', '#######'];
const floorAtCell = (x: number, z: number) => (ROOM[Math.floor(z)]?.[Math.floor(x)] === '.' ? 1 : 0);
const hidesAt = (px: number, pz: number, y: number, rx: number, rz: number, seen = (_x: number, _z: number) => 1) => {
  const q = hiddenPoint(px, pz, y, 0, rx, rz, SLOPE);
  return floorAtCell(q.x, q.z) * seen(q.x, q.z);
};

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
    const hides = hidesAt(3, 4.2, 2, r, r);
    expect(hides).toBe(1);
    expect(cutWeight(-0.2, hides, L)).toBe(1);
  });

  it('a far wall whose point hides only wall or unseen ground stays full', () => {
    // The north wall, camera at +z: behind its top lies more wall.
    expect(hidesAt(3.5, 0.9, 2, 0, 1)).toBe(0);
    expect(cutWeight(-3, 0, L)).toBe(0);
    // Seen only nearer: floor behind a wall top exists, but the hero does not see it.
    expect(hidesAt(3.5, 4.2, 2, 0, 1, () => 0)).toBe(0);
  });

  it('a taller wall hides floor further back', () => {
    const near = hiddenPoint(3, 4, 2, 0, 0, 1, SLOPE), tall = hiddenPoint(3, 4, 4, 0, 0, 1, SLOPE);
    expect(tall.z).toBeLessThan(near.z);
  });

  it('the edge is steep and the line only keeps what lies behind it', () => {
    expect(cutWeight(0, 0.4, L)).toBe(0);
    expect(cutWeight(0, 0.6, L)).toBe(1);
    expect(cutWeight(0, 0.5, L)).toBeCloseTo(0.5);
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
