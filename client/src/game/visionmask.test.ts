import { describe, expect, it, vi } from 'vitest';

// Phaser needs a browser (window) on import; the helpers tested here do not use it.
vi.mock('phaser', () => ({ default: { Renderer: { WebGL: { Pipelines: { PostFXPipeline: class {} } } } } }));

import { fillPlan, levels } from './visionmask';

describe('fillPlan', () => {
  it('haze: the hard view at the soft level, then the full view in white', () => {
    expect(fillPlan(true, levels(1, 0.7))).toEqual([
      { poly: 'hard', grey: 77 },
      { poly: 'full', grey: 255 },
    ]);
  });
  it('haze with soft 0 fills the hard view white: no haze behind blockers', () => {
    expect(fillPlan(true, levels(1, 0))[0]).toEqual({ poly: 'hard', grey: 255 });
  });
  it('no haze: the view in white only', () => {
    expect(fillPlan(false, levels(0.3, 0))).toEqual([{ poly: 'hard', grey: 255 }]);
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
