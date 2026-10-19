import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildWolf } from './wolf-frames';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('buildWolf', () => {
  it('trims the eight wolf frames to one box with the feet on the bottom row', () => {
    const { img, frames } = buildWolf(path.join(root, 'assets-src/enchanted-forest/frames/Wolf'), 512);
    const names = Object.keys(frames);
    expect(names).toEqual([0, 1, 2, 3].map((i) => `dire_wolf_idle_anim_f${i}`).concat([0, 1, 2, 3].map((i) => `dire_wolf_run_anim_f${i}`)));
    const f = frames.dire_wolf_idle_anim_f0;
    expect(new Set(Object.values(frames).map((g) => `${g.w}x${g.h}`)).size).toBe(1);
    expect(f.w).toBeLessThanOrEqual(30); // the walk frames span 30 px (the spec guessed 26 x 17); the union of all eight is 30 x 19
    expect(f.h).toBeLessThanOrEqual(19);
    const bottomOpaque = [...Array(f.w).keys()].some((x) => img.data[((f.y + f.h - 1) * img.w + f.x + x) * 4 + 3] > 0);
    expect(bottomOpaque).toBe(true);
  });
});
