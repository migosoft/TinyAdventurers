import { describe, expect, it } from 'vitest';
import { CRACK_Z_TILT, type Crack } from './cracks';
import type { Light } from '../light';
import { LIGHT_MARGIN } from '../lights';
import { airLightAt } from './airLight';

const torch = (x: number, z: number): Light => ({ x, y: 1, z, radius: 4, r: 1.2, g: 0.76, b: 0.4, shadow: true, skip: -1 });
const crack: Crack = { id: 1, fx: 10.5, fz: 10.5, ceil: 6, dir: [0, 1, CRACK_Z_TILT], rx: 1.2, rz: 0.8, rot: 0, widen: 1, rgb: [1, 1, 1], main: 0, rays: [[-1, 1, -1, 1]], wave: 0 };
const bright = (c: readonly number[]) => Math.max(...c);

describe('airLightAt', () => {
  it('is bright under a torch light and dark beyond its radius', () => {
    const l = [torch(5, 5)];
    expect(bright(airLightAt(5, 1, 5, l, []))).toBeGreaterThan(0.9);
    expect(bright(airLightAt(5 + 4 + LIGHT_MARGIN + 0.1, 1, 5, l, []))).toBe(0);
  });
  it('falls off with the horizontal distance, and is the colour of the light', () => {
    const l = [torch(5, 5)];
    const near = airLightAt(5.5, 1, 5, l, []);
    const far = airLightAt(7.5, 1, 5, l, []);
    expect(far[0]).toBeLessThan(near[0]);
    expect(near[0]).toBeGreaterThan(near[2]);
  });
  it('adds up the lights', () => {
    const one = airLightAt(5, 1, 5, [torch(5, 5)], []);
    const two = airLightAt(5, 1, 5, [torch(5, 5), torch(5, 5)], []);
    expect(two[0]).toBeCloseTo(2 * one[0], 9);
  });
  it('is bright in a crack patch and dark beside it', () => {
    expect(bright(airLightAt(10.5, 0.5, 10.5 + 0.1, [], [crack]))).toBeGreaterThan(0.3);
    expect(bright(airLightAt(14, 0.5, 10.5, [], [crack]))).toBe(0);
  });
  it('is black without lights', () => {
    expect(airLightAt(1, 1, 1, [], [])).toEqual([0, 0, 0]);
  });
});
