import { describe, expect, it, vi } from 'vitest';

// Phaser needs a browser (window) on import; the helpers tested here do not use it.
vi.mock('phaser', () => ({ default: { Renderer: { WebGL: { Pipelines: { PostFXPipeline: class {} } } } } }));

import { DEFAULT_HAZE, hazeUniforms } from './unseenfx';

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
