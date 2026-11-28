import { describe, expect, it } from 'vitest';
import { CUT_DEFAULTS, HIDE_MID, cellWeight, cutWeight, cutWeightAt, cutY, hiddenPoint, hides, torchHidden } from './cut';

const SLOPE = 1 / Math.tan((48.6 * Math.PI) / 180);
const L = CUT_DEFAULTS;
const ALL_SEEN = () => 1;

/** A map from rows of text: floor (0) where `.`, wall (2) elsewhere and outside; row z, column x. */
const mapOf = (rows: string[]) => (x: number, z: number) => (rows[z]?.[x] === '.' ? 0 : 2);
/** The camera direction `deg` degrees from +x toward +z. */
const ray = (deg: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)] as const;

describe('cut: the rule', () => {
  it('has the amended defaults and the band in the middle', () => {
    expect(L).toEqual({ on: true, stub: 0.25, line: -1.5, ramp: 0.1, edge: 0.1 });
    expect(HIDE_MID).toBe(0.5);
  });

  it('the hidden point lies behind the point, away from the camera, further for a higher point', () => {
    expect(hiddenPoint(3, 3, 0, 0, 0, 1, SLOPE)).toEqual({ x: 3, z: 3 });
    const a = hiddenPoint(3, 3, 1, 0, 0, 1, SLOPE), b = hiddenPoint(3, 3, 2, 0, 0, 1, SLOPE);
    expect(a.x).toBe(3);
    expect(a.z).toBeCloseTo(3 - SLOPE);
    expect(b.z).toBeCloseTo(3 - 2 * SLOPE);
    expect(hiddenPoint(3, 3, 3, 1, 0, 1, SLOPE).z).toBeCloseTo(3 - 2 * SLOPE); // from the floor level f
  });

  it('hides: the floor bilinear over tile centres, times seen', () => {
    const h = mapOf(['###', '#.#', '###']);
    expect(hides(1.5, 1.5, 0, L.stub, h, ALL_SEEN)).toBe(1);
    expect(hides(1, 1.5, 0, L.stub, h, ALL_SEEN)).toBeCloseTo(0.5);
    expect(hides(0.5, 1.5, 0, L.stub, h, ALL_SEEN)).toBe(0);
    expect(hides(1.5, 1.5, 0, L.stub, h, () => 0)).toBe(0);
  });

  it('the edge is steep and the line only keeps what lies behind it', () => {
    expect(cutWeight(0, 0.44, L)).toBe(0);
    expect(cutWeight(0, 0.56, L)).toBe(1);
    expect(cutWeight(0, 0.5, L)).toBeCloseTo(0.5);
    expect(cutWeight(-1.6, 1, L)).toBe(0);
    expect(cutWeight(-1.4, 1, L)).toBe(1);
  });

  it('does nothing when off', () => {
    expect(cutY(2, 5, 1, 0, { ...L, on: false })).toBe(2);
    expect(cellWeight(3, 4, 3, 2, 0, 0, 1, SLOPE, mapOf(['#######', '#.....#', '#.....#', '#.....#', '#######']), ALL_SEEN, { ...L, on: false })).toBe(0);
  });

  it('lowers a wall to the stub, whatever its height, and follows the floor', () => {
    expect(cutY(2, 0.5, 1, 0, L)).toBe(0.25);
    expect(cutY(3.5, 5, 1, 0, L)).toBe(0.25);
    expect(cutY(2, 5, 1, 1, L)).toBe(1.25);
  });

  it('keeps floors, basins and chasms', () => {
    expect(cutY(0.1, 5, 1, 0, L)).toBe(0.1);
    expect(cutY(-0.6, 5, 1, 0, L)).toBe(-0.6);
    expect(cutY(2, 5, 0, 0, L)).toBe(2);
  });
});

describe('cut: per column', () => {
  const ROOM = mapOf(['#########', '#.......#', '#.......#', '#.......#', '#.......#', '#.......#', '#########']);

  it('a floor cell never weighs', () => {
    expect(cellWeight(3, 3, 3.5, 3.5, 0, 0, 1, SLOPE, ROOM, ALL_SEEN, L)).toBe(0);
  });

  it('near wall cut, far wall kept with the hero hugging it, pillar beyond the line kept', () => {
    // the camera at +z, the hero at (4.5, 1.2) against the north wall
    const w = (cx: number, cz: number, map = ROOM, tz = 1.2) => cellWeight(cx, cz, 4.5, tz, 0, 0, 1, SLOPE, map, ALL_SEEN, L);
    expect(w(4, 6)).toBe(1); // the south wall: its top covers seen floor
    expect(w(4, 0)).toBe(0); // the north wall: behind it only wall
    const PILLAR = mapOf(['#########', '#.......#', '#.......#', '#...#...#', '#.......#', '#.......#', '#########']);
    expect(w(4, 3, PILLAR, 5.4)).toBe(0); // the pillar's centre (z 3.5) lies 1.9 tiles behind the hero's line, though it covers seen floor ...
    expect(w(4, 3, PILLAR, 4.5)).toBe(1); // ... and is cut once the hero stands only a tile beyond it
  });

  it('a wall that covers only unseen ground is kept', () => {
    expect(cellWeight(4, 6, 4.5, 3, 0, 0, 1, SLOPE, ROOM, () => 0, L)).toBe(0);
  });

  it('every point of a column gets the weight of its cell: the probe cells decide, not the height or the edge', () => {
    for (const [rx, rz] of [ray(90), ray(60), ray(45)]) {
      const v = cellWeight(4, 6, 4.5, 3, 0, rx, rz, SLOPE, ROOM, ALL_SEEN, L);
      // the top's middle, the back face's mid-edge (beside the void, all wall) and a frieze 0.05 out of the room face
      for (const [px, pz] of [[4.5, 6.5], [4.5, 7], [4.5, 5.95], [4.5, 6]]) expect(cutWeightAt(px, pz, 4.5, 3, 0, rx, rz, SLOPE, ROOM, ALL_SEEN, L)).toBe(Math.max(v, pz === 7 ? cellWeight(4, 7, 4.5, 3, 0, rx, rz, SLOPE, ROOM, ALL_SEEN, L) : 0));
    }
  });

  it('a side wall seen edge-on and up to 10 degrees off does not fold: every column stays full', () => {
    // the east wall (x = 8), the camera along z, turned up to 10 degrees either way
    for (const off of [0, 2, 5, 10, -2, -5, -10]) {
      const [rx, rz] = ray(90 + off);
      for (let z = 1; z <= 5; z++) {
        expect(cellWeight(8, z, 4.5, 3, 0, rx, rz, SLOPE, ROOM, ALL_SEEN, L)).toBe(0);
        for (const px of [8, 8.5, 9]) expect(cutWeightAt(px, z + 0.5, 4.5, 3, 0, rx, rz, SLOPE, ROOM, ALL_SEEN, L)).toBe(0);
      }
    }
  });

  describe('a thin wall between two rooms (column 4), turned from its normal', () => {
    const rows = Array.from({ length: 14 }, (_, z) => (z === 0 || z === 13 ? '#########' : '#...#...#'));
    const THIN = mapOf(rows);
    // the hero in the left room beside the wall; the camera toward +x, turned by `deg` toward +z: the wall's +x face would hide the left room
    const T = [2.5, 7] as const;
    const at = (px: number, pz: number, deg: number) => cutWeightAt(px, pz, T[0], T[1], 0, ...ray(deg), SLOPE, THIN, ALL_SEEN, L);
    const centreHides = (deg: number) => {
      const [rx, rz] = ray(deg), q = hiddenPoint(4.5, 7.5, 2, 0, rx, rz, SLOPE);
      return hides(q.x, q.z, 0, L.stub, THIN, ALL_SEEN);
    };

    it('its centre reads 1 at 45 degrees and falls to 0 edge-on', () => {
      expect(centreHides(45)).toBeCloseTo(1, 2);
      expect(centreHides(60)).toBeCloseTo(0.88, 1);
      expect(centreHides(70)).toBeCloseTo(0.6, 1);
      expect(centreHides(80)).toBeCloseTo(0.31, 1);
      expect(centreHides(90)).toBeCloseTo(0, 5);
    });

    it('both edges of every column weigh the same, at every turn', () => {
      for (const deg of [30, 45, 60, 70, 80, 90]) for (let z = 3; z <= 10; z++) for (const pz of [z, z + 0.5]) {
        const west = at(4, pz, deg), east = at(5, pz, deg);
        expect(east, `deg ${deg} z ${pz}`).toBe(west);
        for (const px of [3.95, 4.5, 5.05]) expect(at(px, pz, deg), `deg ${deg} x ${px} z ${pz}`).toBe(west);
      }
    });

    it('the column beside the hero switches once as the camera turns', () => {
      const ws = [30, 45, 60, 70, 80, 90].map((deg) => at(4.5, 7.5, deg));
      expect(ws.slice(0, 4)).toEqual([1, 1, 1, 1]);
      expect(ws.slice(4)).toEqual([0, 0]);
      for (let deg = 30, last = 1, flips = 0; deg <= 90; deg += 0.5) {
        const w = at(4.5, 7.5, deg) > 0.5 ? 1 : 0;
        if (w !== last) flips++;
        last = w;
        expect(flips).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('torches: hidden with their own column', () => {
    const THIN = mapOf(['#######', '#..#..#', '#..#..#', '#..#..#', '#######']);
    // the hero at (2, 2.5) in the left room; wall points and normals into the room as `wallOf` gives them
    const hidden = (wx: number, wz: number, nx: number, nz: number, deg: number) => torchHidden(wx, wz, nx, nz, 2, 2.5, 0, ...ray(deg), SLOPE, THIN, ALL_SEEN, L);

    it('a torch on a thin near wall is hidden, on either face', () => {
      // the camera at +x: the thin wall (column 3) stands between it and the hero and hides the left room
      expect(hidden(4, 2.5, 1, 0, 0)).toBe(true); // the right room's west wall, facing the camera
      expect(hidden(3, 2.5, -1, 0, 0)).toBe(true);
    });

    it('a far-wall torch is kept, an edge-on torch is kept', () => {
      expect(hidden(1, 2.5, 1, 0, 0)).toBe(false); // the west wall behind the hero
      expect(hidden(6, 2.5, -1, 0, 90)).toBe(false); // the east wall, the camera along z
    });
  });
});
