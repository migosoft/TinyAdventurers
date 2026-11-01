import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodePng } from './png';
import { buildSpectres, cutSpectre, SPECTRE_SIZE } from './spectre-frames';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets-src');

const opaque = (f: { data: Uint8Array }) => {
  let n = 0;
  for (let i = 3; i < f.data.length; i += 4) if (f.data[i] > 0) n++;
  return n;
};

describe.each([['ghost'], ['shade']])('cutSpectre %s', (name) => {
  const frames = cutSpectre(decodePng(fs.readFileSync(path.join(assets, name, `${name}_sheet.png`))));

  it('cuts 8 frames of 24x24 with a limited palette and no magenta', () => {
    expect(frames).toHaveLength(8);
    const colors = new Set<string>();
    for (const f of frames) {
      expect([f.w, f.h]).toEqual([SPECTRE_SIZE, SPECTRE_SIZE]);
      for (let i = 0; i < f.data.length; i += 4) {
        if (f.data[i + 3] === 0) continue;
        expect(f.data[i + 3]).toBe(255);
        const [r, g, b] = [f.data[i], f.data[i + 1], f.data[i + 2]];
        expect(Math.hypot(r - 255, g, b - 255)).toBeGreaterThan(50) // the Shade's violet eyes are ~70 from magenta;
        colors.add(`${r},${g},${b}`);
      }
    }
    expect(colors.size).toBeLessThanOrEqual(7);
  });

  it('puts the lowest opaque row on y = 23', () => {
    for (const f of frames) {
      let low = -1;
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (f.data[(y * f.w + x) * 4 + 3] > 0) low = y;
      expect(low).toBe(23);
    }
  });

  it('keeps the figure steady within the idle row and within the move row', () => {
    for (const set of [frames.slice(0, 4), frames.slice(4)]) {
      const n0 = opaque(set[0]);
      for (const f of set) expect(Math.abs(opaque(f) - n0)).toBeLessThanOrEqual(n0 * 0.15);
    }
  });
});

describe('buildSpectres', () => {
  it('names the 16 frames like the client mob() animations', () => {
    const { frames } = buildSpectres(assets, 512);
    const want = ['ghost', 'shade'].flatMap((c) => ['idle', 'run'].flatMap((s) => [0, 1, 2, 3].map((i) => `${c}_${s}_anim_f${i}`)));
    expect(Object.keys(frames)).toEqual(want);
  });
});
