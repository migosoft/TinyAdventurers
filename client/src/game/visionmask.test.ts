import { describe, expect, it, vi } from 'vitest';

// Phaser needs a browser (window) on import; the helpers tested here do not use it.
vi.mock('phaser', () => ({ default: { Renderer: { WebGL: { Pipelines: { PostFXPipeline: class {} } } } } }));

import { levels } from './visionmask';

describe('levels', () => {
  it('turns unseen strengths into canvas greys', () => {
    expect(levels(1, 0.7)).toEqual({ outside: 0, soft: 77 });
    expect(levels(0.3, 0)).toEqual({ outside: 179, soft: 255 });
  });
  it('clamps out-of-range strengths', () => {
    expect(levels(2, -1)).toEqual({ outside: 0, soft: 255 });
  });
});
