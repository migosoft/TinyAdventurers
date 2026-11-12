import { describe, expect, it } from 'vitest';
import { project } from './camera';
import type { Opener } from './figures';
import { SEE_DEFAULTS, bayer4, discQuads, discStrength, nearOf, discTowards, wallKeep, wallOpens, SEE_DEPTH_BIAS } from './seeThrough';

const look = SEE_DEFAULTS;
const cam = { x: 10, z: 10, pitch: (48.6 * Math.PI) / 180, yaw: 0 };
const op = (id: number, x: number, z: number, mid = 0.5): Opener => ({ id, x, z, mid, who: 'hero' });

describe('discStrength', () => {
  it('is 1 in the centre and out to the edge of the full zone', () => {
    expect(discStrength(0, look)).toBe(1);
    expect(discStrength(0.6 * 1.3, look)).toBe(1);
  });
  it('fades between the full zone and the radius, monotone, and is 0 at the radius and beyond', () => {
    expect(0 < discStrength(0.7 * 1.3, look) && discStrength(0.7 * 1.3, look) < 1).toBe(true);
    expect(discStrength(1.3, look)).toBe(0);
    expect(discStrength(2, look)).toBe(0);
    let prev = 1;
    for (let d = 0.78; d <= 1.3; d += 0.02) {
      const s = discStrength(d, look);
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      prev = s;
    }
  });
});

describe('wallKeep', () => {
  it('keeps all of the wall at strength 0 and `keep` at strength 1', () => {
    expect(wallKeep(0, look)).toBe(1);
    expect(wallKeep(1, look)).toBeCloseTo(0.15, 12);
    expect(wallKeep(0.5, look)).toBeCloseTo(0.575);
  });
});

describe('bayer4', () => {
  it('takes the 16 values k / 16 once each over a 4x4 block', () => {
    const v: number[] = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) v.push(bayer4(x, y) * 16);
    expect(v.sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, k) => k));
  });
  it('repeats every 4 px', () => {
    expect(bayer4(5, 6)).toBe(bayer4(1, 2));
    expect(bayer4(-3, 0)).toBe(bayer4(1, 0));
  });
});

describe('discQuads', () => {
  it('centres a quad on the projected mid point with half-size radius', () => {
    const q = discQuads([op(1, 12, 11)], cam, look);
    expect(q.count).toBe(1);
    expect(q.position.length).toBe(18);
    const c = project(cam, 12, 0.5, 11);
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < 6; i++) {
      const p = project(cam, q.position[i * 3], q.position[i * 3 + 1], q.position[i * 3 + 2]);
      xs.push(p.sx - c.sx);
      ys.push(p.sy - c.sy);
      expect(p.depth).toBeCloseTo(c.depth, 5); // camera-facing: one depth
    }
    expect(Math.max(...xs)).toBeCloseTo(1.3, 5);
    expect(Math.min(...xs)).toBeCloseTo(-1.3, 5);
    expect(Math.max(...ys)).toBeCloseTo(1.3, 5);
    expect(Math.min(...ys)).toBeCloseTo(-1.3, 5);
    expect(Math.max(...q.uv)).toBe(1);
    expect(Math.min(...q.uv)).toBe(-1);
  });
  it('gives a farther opener a smaller near', () => {
    const q = discQuads([op(1, 10, 8), op(2, 10, 12)], cam, look);
    expect(q.count).toBe(2);
    expect(q.near[0]).toBeLessThan(q.near[6]);
    expect(q.near[0]).toBe(q.near[5]); // one value for the whole disc
  });
  it('six openers 0.5 tiles apart overlap (the merge the max blend relies on)', () => {
    const list = [0, 1, 2, 3, 4, 5].map((i) => op(i, 10 + i * 0.5, 10));
    const q = discQuads(list, cam, look);
    expect(q.count).toBe(6);
    const cx = (i: number) => {
      let s = 0;
      for (let k = 0; k < 6; k++) s += project(cam, q.position[(i * 6 + k) * 3], q.position[(i * 6 + k) * 3 + 1], q.position[(i * 6 + k) * 3 + 2]).sx;
      return s / 6;
    };
    for (let i = 0; i < 5; i++) expect(cx(i + 1) - cx(i)).toBeLessThan(2 * 1.3);
  });
});

describe('wallOpens (the rule the shader implements)', () => {
  const near = 3;
  const green = SEE_DEPTH_BIAS - near;
  it('opens a wall nearer the camera than the thing, only where a disc is', () => {
    expect(wallOpens(1, green, near + 1)).toBe(true);
    expect(wallOpens(0, green, near + 1)).toBe(false);
  });
  it('leaves walls behind or level with the thing solid', () => {
    expect(wallOpens(1, green, near - 1)).toBe(false);
    expect(wallOpens(1, green, near + 0.02)).toBe(false);
  });
});

describe('horizontal depth (walls behind a figure stay solid at every height)', () => {
  // A wall point opens if the mask's red is on and it is nearer than the figure, measured along the ground direction toward the camera.
  const opens = (c: { x: number; z: number; pitch: number; yaw: number }, fig: { x: number; z: number }, w: { x: number; z: number }) =>
    wallOpens(1, SEE_DEPTH_BIAS - nearOf(fig.x, fig.z, c), nearOf(w.x, w.z, c));
  const fig = { x: 5.5, z: 5.5 };
  it('yaw 0: the north wall behind keeps its face and top solid; the wall south opens', () => {
    const c = { ...cam, x: 5.5, z: 5.5, yaw: 0 };
    // North wall tile z 4..5: its south face at z = 5, top spanning z 4..5 (height does not enter).
    for (const z of [5, 4.5, 4]) expect(opens(c, fig, { x: 5.5, z })).toBe(false);
    // South wall tile z 6..7: face at z = 6, top 6..7.
    for (const z of [6, 6.5, 7]) expect(opens(c, fig, { x: 5.5, z })).toBe(true);
  });
  it('yaw 90: the walls on the far side stay solid, the ones toward the camera open', () => {
    const c = { ...cam, x: 5.5, z: 5.5, yaw: Math.PI / 2 };
    const toward = discTowards(c);
    for (const d of [0.5, 1, 1.5]) expect(opens(c, fig, { x: fig.x + toward.x * d, z: fig.z + toward.z * d })).toBe(true);
    for (const d of [0.5, 1, 1.5]) expect(opens(c, fig, { x: fig.x - toward.x * d, z: fig.z - toward.z * d })).toBe(false);
    // yaw 90 turns the camera to the +x or -x side: the toward vector is axis-aligned.
    expect(Math.abs(toward.x) + Math.abs(toward.z)).toBeCloseTo(1, 9);
    expect(Math.abs(toward.x)).toBeCloseTo(1, 9);
  });
  it('discQuads near ignores the figure height', () => {
    const a = discQuads([op(1, 10, 11, 0.2)], cam, look).near[0];
    const b = discQuads([op(1, 10, 11, 1.4)], cam, look).near[0];
    expect(a).toBe(b);
  });
  it('near is clamped so that the stored depth stays positive', () => {
    const q = discQuads([op(1, 400, 400)], cam, look);
    expect(q.near[0]).toBeLessThan(SEE_DEPTH_BIAS);
  });
});
