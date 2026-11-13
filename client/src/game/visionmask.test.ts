import { describe, expect, it, vi } from 'vitest';

// Phaser needs a browser (window) on import; the helpers tested here do not use it.
vi.mock('phaser', () => ({ default: { Renderer: { WebGL: { Pipelines: { PostFXPipeline: class {} } } } } }));

import { fieldToRgba, levels, maskSteps } from './visionmask';

describe('fieldToRgba', () => {
  it('writes the rounded grey into red, green and blue with full alpha', () => {
    const data = new Uint8ClampedArray(8);
    fieldToRgba(new Float32Array([12.4, 200.6]), data, 2);
    expect(Array.from(data)).toEqual([12, 12, 12, 255, 201, 201, 201, 255]);
  });
});

describe('maskSteps', () => {
  it('haze: the sight edge is feathered, then the wedge and the seen plants (no whole-tile blockers)', () => {
    expect(maskSteps(true, levels(0.8, 0.7))).toEqual([
      { step: 'sight' },
      { step: 'walls' },
      { step: 'feather' },
      { step: 'wedge', grey: 77 },
      { step: 'seen' },
    ]);
  });
  it('haze with soft 0 draws a white wedge: no haze behind blockers', () => {
    expect(maskSteps(true, levels(1, 0)).find((s) => s.step === 'wedge')).toEqual({ step: 'wedge', grey: 255 });
  });
  it('no haze: the view and its walls in white only', () => {
    expect(maskSteps(false, levels(0.3, 0))).toEqual([{ step: 'sight' }, { step: 'walls' }]);
  });
});

describe('levels', () => {
  it('turns unseen strengths into canvas greys', () => {
    expect(levels(1, 0.7)).toEqual({ outside: 0, soft: 77 });
    expect(levels(0.3, 0)).toEqual({ outside: 179, soft: 255 });
  });
  it('clamps out-of-range strengths', () => {
    expect(levels(2, -1)).toEqual({ outside: 0, soft: 255 });
  });
});
