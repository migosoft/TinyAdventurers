import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildFigure, buildSheetFigure } from './figure-frames';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('buildFigure', () => {
  it('trims the eight wolf frames to one box with the feet on the bottom row', () => {
    const { img, frames } = buildFigure(path.join(root, 'assets-src/enchanted-forest/frames/Wolf'), 'Wolf', 'dire_wolf', 512);
    const names = Object.keys(frames);
    expect(names).toEqual([0, 1, 2, 3].map((i) => `dire_wolf_idle_anim_f${i}`).concat([0, 1, 2, 3].map((i) => `dire_wolf_run_anim_f${i}`)));
    const f = frames.dire_wolf_idle_anim_f0;
    expect(new Set(Object.values(frames).map((g) => `${g.w}x${g.h}`)).size).toBe(1);
    expect(f.w).toBeLessThanOrEqual(30); // the walk frames span 30 px (the spec guessed 26 x 17); the union of all eight is 30 x 19
    expect(f.h).toBeLessThanOrEqual(19);
    const bottomOpaque = [...Array(f.w).keys()].some((x) => img.data[((f.y + f.h - 1) * img.w + f.x + x) * 4 + 3] > 0);
    expect(bottomOpaque).toBe(true);
  });

  it('packs the knight as npc_knight idle and run frames in one box', () => {
    const { img, frames } = buildFigure(path.join(root, 'assets-src/fantasy-npcs/frames/Knight - Standard'), 'Knight', 'npc_knight', 512);
    expect(Object.keys(frames)).toEqual([0, 1, 2, 3].map((i) => `npc_knight_idle_anim_f${i}`).concat([0, 1, 2, 3].map((i) => `npc_knight_run_anim_f${i}`)));
    expect(new Set(Object.values(frames).map((g) => `${g.w}x${g.h}`)).size).toBe(1);
    const f = frames.npc_knight_idle_anim_f0;
    expect([...Array(f.w).keys()].some((x) => img.data[((f.y + f.h - 1) * img.w + f.x + x) * 4 + 3] > 0)).toBe(true);
  });

  it('cuts the idle and move rows of an animal sheet into one box with the feet on the bottom row', () => {
    const { img, frames } = buildSheetFigure(path.join(root, 'assets-src/forest-animals/Outline/MiniBoar.png'), 'boar', 512);
    expect(Object.keys(frames)).toEqual([0, 1, 2, 3].map((i) => `boar_idle_anim_f${i}`).concat([0, 1, 2, 3].map((i) => `boar_run_anim_f${i}`)));
    expect(new Set(Object.values(frames).map((g) => `${g.w}x${g.h}`)).size).toBe(1);
    const f = frames.boar_idle_anim_f0;
    expect(f.w).toBeLessThan(32);
    expect([...Array(f.w).keys()].some((x) => img.data[((f.y + f.h - 1) * img.w + f.x + x) * 4 + 3] > 0)).toBe(true);
  });
});
