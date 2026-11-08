import { describe, expect, it, vi } from 'vitest';

// Phaser needs a browser (window) on import; the helpers tested here do not use it.
vi.mock('phaser', () => ({ default: { Renderer: { WebGL: { Pipelines: { PostFXPipeline: class {} } } } } }));

import { DEFAULT_HAZE, hazeUniforms, maskTransform } from './unseenfx';

describe('maskTransform', () => {
  it('maps the camera window into the mask canvas', () => {
    // canvas at (160, 320), 800 x 480 px; window at (200, 340), 400 x 240
    expect(maskTransform({ x: 200, y: 340, width: 400, height: 240 }, { x: 160, y: 320, w: 800, h: 480 })).toEqual([0.05, 20 / 480, 0.5, 0.5]);
  });
  it('follows a grown canvas (a bigger window rebuilds it)', () => {
    const view = { x: 1000, y: 2000, width: 400, height: 240 };
    const a = maskTransform(view, { x: 936, y: 1936, w: 528, h: 368 });
    const b = maskTransform(view, { x: 936, y: 1936, w: 1056, h: 736 });
    expect(a[0]).toBeCloseTo(64 / 528, 9);
    expect(b[0]).toBeCloseTo(64 / 1056, 9);
    expect(b[2]).toBeCloseTo(400 / 1056, 9);
    expect(b[3]).toBeCloseTo(240 / 736, 9);
  });
});

describe('hazeUniforms', () => {
  it('splits the colour and scales the blur by zoom over the target size', () => {
    const u = hazeUniforms(DEFAULT_HAZE, 1280, 720, 2);
    expect(u.colour[0]).toBeCloseTo(0.722, 3);
    expect(u.colour[1]).toBeCloseTo(0.769, 3);
    expect(u.colour[2]).toBeCloseTo(0.8, 3);
    expect(u.blur[0]).toBeCloseTo(3 / 1280, 6);
    expect(u.blur[1]).toBeCloseTo(3 / 720, 6);
    expect(u.mix).toBe(0.45);
    expect(u.desat).toBe(0.6);
  });
});
