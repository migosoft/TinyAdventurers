import { describe, expect, it } from 'vitest';
import { buildSpectres, PALETTES, SPECTRE_SIZE, spectreGrids } from './spectre-frames';

describe('spectreGrids', () => {
  const grids = spectreGrids();
  const rows = (g: string[]) => g.flatMap((r, y) => (/[^.]/.test(r) ? [y] : []));

  it('draws 8 frames of 16x16', () => {
    expect(grids).toHaveLength(8);
    for (const g of grids) {
      expect(g).toHaveLength(SPECTRE_SIZE);
      for (const r of g) expect(r).toHaveLength(SPECTRE_SIZE);
    }
  });

  it('stands on the bottom row at rest and while running, 12 rows tall', () => {
    for (const k of [0, 2, 4, 5, 6, 7]) {
      expect(rows(grids[k]).at(-1)).toBe(SPECTRE_SIZE - 1);
      expect(rows(grids[k])).toHaveLength(12);
    }
  });

  it('bobs 1 px up on idle f1 and 1 px down on idle f3', () => {
    expect(rows(grids[1])[0]).toBe(rows(grids[0])[0] - 1);
    expect(rows(grids[3])[0]).toBe(rows(grids[0])[0] + 1);
  });
});

describe('buildSpectres', () => {
  const { img, frames } = buildSpectres(512);

  it('names the 16 frames like the client mob() animations', () => {
    const want = ['ghost', 'shade'].flatMap((c) => ['idle', 'run'].flatMap((s) => [0, 1, 2, 3].map((i) => `${c}_${s}_anim_f${i}`)));
    expect(Object.keys(frames)).toEqual(want);
    for (const f of Object.values(frames)) expect([f.w, f.h]).toEqual([SPECTRE_SIZE, SPECTRE_SIZE]);
  });

  it('uses only palette colours, and the Shade has the Ghost shape', () => {
    const colors = Object.fromEntries(
      Object.entries(PALETTES).map(([c, p]) => [c, new Set(Object.values(p).map((h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join()))]),
    );
    for (const k of ['idle_anim_f0', 'idle_anim_f1', 'run_anim_f2']) {
      const [g, s] = [frames[`ghost_${k}`], frames[`shade_${k}`]];
      for (let y = 0; y < SPECTRE_SIZE; y++)
        for (let x = 0; x < SPECTRE_SIZE; x++) {
          const gi = (y * img.w + g.x + x) * 4;
          const si = (y * img.w + s.x + x) * 4;
          expect(img.data[gi + 3]).toBe(img.data[si + 3]);
          if (!img.data[gi + 3]) continue;
          expect(colors.ghost.has(Array.from(img.data.subarray(gi, gi + 3)).join())).toBe(true);
          expect(colors.shade.has(Array.from(img.data.subarray(si, si + 3)).join())).toBe(true);
        }
    }
  });
});
