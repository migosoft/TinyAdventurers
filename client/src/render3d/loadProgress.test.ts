import { describe, expect, it } from 'vitest';
import { loadState, type LoadParts } from './loadProgress';

const none: LoadParts = { assets: false, cover: 0, stone: null, trees: null, warmFrames: 0, waiting: null };

describe('loadState', () => {
  it('starts at nothing', () => {
    expect(loadState(none)).toEqual({ fraction: 0, line: 'Loading assets…', ready: false });
  });

  it('woodland mid-cover drops the stone weight', () => {
    const s = loadState({ ...none, assets: true, cover: 0.5, trees: 0 });
    expect(s.line).toBe('Building the map…');
    expect(s.fraction).toBeCloseTo((0.1 + 0.3 * 0.5) / 0.7, 9);
  });

  it('names the trees once the cover is done', () => {
    expect(loadState({ ...none, assets: true, cover: 1, trees: 0.4 }).line).toBe('Growing the trees…');
  });

  it('warms the shaders, then waits for players', () => {
    const done = { ...none, assets: true, cover: 1, trees: 1 };
    const warming = loadState({ ...done, warmFrames: 1 });
    expect(warming.line).toBe('Preparing shaders…');
    expect(warming.ready).toBe(false);
    expect(loadState({ ...done, warmFrames: 2 })).toEqual({ fraction: 1, line: 'Waiting for players…', ready: true });
    expect(loadState({ ...done, warmFrames: 2, waiting: { ready: 1, total: 2 } }).line).toBe(
      'Waiting for players (1 of 2 ready)…',
    );
  });

  it('a dungeon without trees is ready', () => {
    expect(loadState({ ...none, assets: true, cover: 1, stone: 1, warmFrames: 2 }).ready).toBe(true);
  });
});
