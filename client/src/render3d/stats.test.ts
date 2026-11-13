import { describe, expect, it } from 'vitest';
import { R3D_SYSTEMS, statsText3d, type R3dStats } from './stats';

const base: R3dStats = {
  fps: 59.6,
  frameMs: 4.5,
  renderMs: 3.25,
  systems: [['sim', 0.1], ['cards', 0.2], ['lights', 0.3], ['upload', 0.4], ['scene', 2.5], ['present', 0.05]],
  drawCalls: 6,
  canvas: [1920, 1080],
  render: [960, 540],
  zoom: 4,
  quality: 'balanced',
  backend: 'WebGPU',
};

describe('statsText3d', () => {
  it('lists the lines in the game panel layout', () => {
    expect(statsText3d(base).split('\n')).toEqual([
      'FPS        60',
      'frame      4.50 ms',
      'render     3.25 ms',
      'update     0.60 ms',
      '  sim      0.10',
      '  cards    0.20',
      '  lights   0.30',
      '  upload   0.40',
      '  scene    2.50',
      '  present  0.05',
      'draw calls 6',
      'canvas     1920x1080',
      'render     960x540 (balanced)',
      'zoom       4',
      'backend    WebGPU',
    ]);
  });

  it('prints the light lines after the systems', () => {
    const t = statsText3d({ ...base, lines: ['lights     5 of 9 (cap 16)', 'shadows    2 cards (cap 16)'] }).split('\n');
    expect(t.slice(10, 13)).toEqual(['lights     5 of 9 (cap 16)', 'shadows    2 cards (cap 16)', 'draw calls 6']);
  });

  it('names the systems in order', () => {
    expect(R3D_SYSTEMS).toEqual(['sim', 'cards', 'lights', 'sight', 'sun', 'upload', 'scene', 'present', 'hud']);
  });
});
