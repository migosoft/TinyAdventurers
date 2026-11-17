import { describe, expect, it } from 'vitest';
import { CEILING_LAYER, WATER_LAYER, mirrorPose, picturePasses, poolInView } from './passes';

const WATER = { water: true, lava: false, reflect: true, heat: true };

describe('the picture passes', () => {
  it('needs nothing without a pool in view', () => {
    expect(picturePasses({ water: false, lava: false, reflect: true, heat: true }, 800, 600)).toEqual({ copy: false, mirror: null, shimmer: false });
  });

  it('copies for water as before, and mirrors at half size', () => {
    expect(picturePasses(WATER, 801, 601)).toEqual({ copy: true, mirror: { w: 401, h: 301 }, shimmer: false });
    expect(picturePasses({ ...WATER, reflect: false }, 800, 600)).toEqual({ copy: true, mirror: null, shimmer: false });
  });

  it('never makes a 0 px target', () => {
    expect(picturePasses(WATER, 1, 1).mirror).toEqual({ w: 1, h: 1 });
    expect(picturePasses(WATER, 0, 0).mirror).toEqual({ w: 1, h: 1 });
  });

  it('copies for lava only while the shimmer is on', () => {
    expect(picturePasses({ water: false, lava: true, reflect: true, heat: true }, 800, 600)).toEqual({ copy: true, mirror: null, shimmer: true });
    expect(picturePasses({ water: false, lava: true, reflect: true, heat: false }, 800, 600)).toEqual({ copy: false, mirror: null, shimmer: false });
  });

  it('never mirrors for lava', () => {
    expect(picturePasses({ water: true, lava: true, reflect: true, heat: false }, 800, 600).mirror).toEqual({ w: 400, h: 300 });
    expect(picturePasses({ water: false, lava: true, reflect: true, heat: true }, 800, 600).mirror).toBeNull();
  });

  it('sees a pool at the screen edge', () => {
    const fp = { x0: 10, z0: 10, x1: 30, z1: 20 };
    expect(poolInView([], fp)).toBe(false);
    // Half a tile outside each side: in view.
    expect(poolInView([{ x0: 5, z0: 12, x1: 9.5, z1: 14 }], fp)).toBe(true);
    expect(poolInView([{ x0: 30.5, z0: 12, x1: 33, z1: 14 }], fp)).toBe(true);
    expect(poolInView([{ x0: 12, z0: 5, x1: 14, z1: 9.5 }], fp)).toBe(true);
    expect(poolInView([{ x0: 12, z0: 20.5, x1: 14, z1: 25 }], fp)).toBe(true);
    // Three tiles outside: not.
    expect(poolInView([{ x0: 2, z0: 12, x1: 7, z1: 14 }], fp)).toBe(false);
    expect(poolInView([{ x0: 12, z0: 23, x1: 14, z1: 25 }], fp)).toBe(false);
    // One far pool and one in view.
    expect(poolInView([{ x0: 60, z0: 60, x1: 62, z1: 62 }, { x0: 15, z0: 15, x1: 16, z1: 16 }], fp)).toBe(true);
  });

  it('mirrors the camera in the water plane', () => {
    const m = mirrorPose([3, 40, 9], [3, 0, 2], -0.08);
    expect(m.pos[0]).toBe(3);
    expect(m.pos[2]).toBe(9);
    expect(m.pos[1]).toBeCloseTo(-40.16, 10);
    expect(m.target[0]).toBe(3);
    expect(m.target[2]).toBe(2);
    expect(m.target[1]).toBeCloseTo(-0.16, 10);
  });

  it('keeps its layers apart from the scene (0) and the air (1, AIR_SKIP_LAYER of view.ts)', () => {
    expect(new Set([0, 1, WATER_LAYER, CEILING_LAYER]).size).toBe(4);
  });
});
