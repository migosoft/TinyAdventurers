import { describe, expect, it } from 'vitest';
import { fangTris, newFxBuf, swirlTris, swooshTris } from './fx';

const cam = { x: 0, z: 0, pitch: Math.PI / 4, yaw: 0 };
const WHITE = 0xfff8e0;

/** The corners of the buffer: x, y, z of every vertex. */
const corners = (b: { position: number[] }): Array<[number, number, number]> => {
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < b.position.length; i += 3) out.push([b.position[i], b.position[i + 1], b.position[i + 2]]);
  return out;
};

describe('swooshTris', () => {
  it('adds nothing before the sweep starts or once the swoosh has faded', () => {
    for (const k of [0, 1.7, 3]) {
      const b = newFxBuf();
      swooshTris(b, 0, 0, 1, 0, 28, 1.75, WHITE, k);
      expect(b.n).toBe(0);
      expect(b.position.length).toBe(0);
    }
  });

  it('keeps its position and colour arrays in step with the triangle count', () => {
    const b = newFxBuf();
    swooshTris(b, 0, 0, 1, 0, 28, 1.75, WHITE, 0.6);
    expect(b.n).toBeGreaterThan(0);
    expect(b.position.length).toBe(b.n * 9);
    expect(b.rgba.length).toBe(b.n * 12);
  });

  it('lies at the given height, its outer edge `reach / 16` tiles from the foot and within the arc', () => {
    const arc = 1.75, reach = 28, yaw = 0.7, x = 3, z = 4;
    const b = newFxBuf();
    swooshTris(b, x, z, 1.1, yaw, reach, arc, WHITE, 0.8);
    let outer = 0;
    for (const [px, py, pz] of corners(b)) {
      expect(py).toBeCloseTo(1.1, 6);
      const d = Math.hypot(px - x, pz - z);
      expect(d).toBeLessThanOrEqual(reach / 16 + 1e-6);
      if (d > reach / 16 - 1e-6) {
        outer++;
        const a = Math.atan2(pz - z, px - x) - yaw;
        expect(Math.abs(Math.atan2(Math.sin(a), Math.cos(a)))).toBeLessThanOrEqual(arc / 2 + 1e-6);
      }
    }
    expect(outer).toBeGreaterThan(0);
  });

  it('grows along the arc as the swing goes on', () => {
    const span = (k: number) => {
      const b = newFxBuf();
      swooshTris(b, 0, 0, 1, 0, 28, 1.75, WHITE, k);
      let lit = 0;
      for (let i = 0; i < b.n * 3; i++) if (b.rgba[i * 4 + 3] > 0.05) lit++;
      return lit;
    };
    expect(span(0.9)).toBeGreaterThan(span(0.2));
  });
});

describe('fangTris', () => {
  const rows = (k: number): number => {
    const b = newFxBuf();
    fangTris(b, [0, 1, 0], cam, k);
    const ys = corners(b).map((c) => c[1]);
    return b.n === 0 ? 0 : Math.max(...ys) - Math.min(...ys);
  };

  it('adds nothing before 0.16 and after 0.92', () => {
    for (const k of [0, 0.1, 0.16, 0.92, 0.99]) {
      const b = newFxBuf();
      fangTris(b, [0, 1, 0], cam, k);
      expect(b.n).toBe(0);
    }
    const b = newFxBuf();
    fangTris(b, [0, 1, 0], cam, 0.4);
    expect(b.n).toBeGreaterThan(0);
    expect(b.rgba.length).toBe(b.n * 12);
  });

  it('closes: the two rows are closer at 0.46 than at 0.2', () => {
    expect(rows(0.46)).toBeLessThan(rows(0.2));
  });

  it('faces the camera: every corner is in the plane through the middle across the view', () => {
    for (const yaw of [0, 1.1, -2]) {
      const c = { ...cam, yaw };
      const b = newFxBuf();
      fangTris(b, [2, 1, 3], c, 0.3);
      // the direction from the target toward the camera is perpendicular to the plane
      const v: [number, number, number] = [-Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch)];
      for (const [px, py, pz] of corners(b)) {
        expect(Math.abs((px - 2) * v[0] + (py - 1) * v[1] + (pz - 3) * v[2])).toBeLessThan(1e-6);
      }
    }
  });
});

describe('swirlTris', () => {
  it('adds arcs round the figure at three heights in the figure\'s colour, and turns with time', () => {
    const a = newFxBuf(), c = newFxBuf();
    swirlTris(a, 2, 3, 0, 0x4a7aff, 1, 0.5);
    swirlTris(c, 2, 3, 0.4, 0x4a7aff, 1, 0.5);
    expect(a.n).toBeGreaterThan(0);
    expect(a.position.length).toBe(a.n * 9);
    expect(a.rgba.slice(0, 3)).toEqual([0x4a / 255, 0x7a / 255, 1].map((v) => expect.closeTo(v, 5)));
    const heights = new Set(corners(a).map((p) => Math.round(p[1] * 100)));
    expect(heights.size).toBeGreaterThanOrEqual(3);
    // a thin band (under 0.06) round the circle of radius 0.5
    for (const [px, , pz] of corners(a)) expect(Math.abs(Math.hypot(px - 2, pz - 3) - 0.5)).toBeLessThanOrEqual(0.06);
    expect(c.position).not.toEqual(a.position);
  });
});
