import { describe, expect, it } from 'vitest';
import { COVE_TREE_FOOT, DEFAULT_LIGHT, PLANT_KINDS, type Drawn, type Rgba, coveTree, drawPlant, drawTree, lightVector } from './vegetation';

/** FNV-1a over the RGBA bytes. */
function fnv(img: Rgba): number {
  let h = 0x811c9dc5;
  for (const b of img.data) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
const alpha = (img: Rgba, x: number, y: number) => img.data[(y * img.w + x) * 4 + 3];
// dark green `1` of the leaf palette (40, 100, 62)
const isOutline = (img: Rgba, x: number, y: number) => { const i = (y * img.w + x) * 4; return img.data[i] === 34 && img.data[i + 1] === 34 && img.data[i + 2] === 34; };
const isDarkGreen = (img: Rgba, x: number, y: number) => { const i = (y * img.w + x) * 4; return img.data[i] === 40 && img.data[i + 1] === 100 && img.data[i + 2] === 62 && img.data[i + 3] === 255; };

const HASH = 2114400888;

describe('vegetation', () => {
  it('lightVector: left sun at ~51° is the old default, the right sun mirrors it', () => {
    const l = lightVector({ side: -1, elevation: 51 });
    expect(l.x).toBeCloseTo(-0.63, 1); expect(l.y).toBeCloseTo(-0.78, 1);
    const r = lightVector({ side: 1, elevation: 51 });
    expect(r.x).toBeCloseTo(-l.x, 5); expect(r.y).toBeCloseTo(l.y, 5);
    expect(Math.hypot(r.x, r.y)).toBeCloseTo(1, 5);
  });
  it('the light changes only the shading: size, foot and silhouette stay the same', () => {
    const lights = [lightVector({ side: 1, elevation: 51 }), lightVector({ side: -1, elevation: 35 })];
    for (const kind of PLANT_KINDS) for (const seed of [1, 2, 3, 7]) for (const scale of [60, 100]) {
      const a = drawPlant(kind, seed, scale, DEFAULT_LIGHT);
      const mask = (d: typeof a) => Array.from({ length: d.img.w * d.img.h }, (_, i) => d.img.data[i * 4 + 3]);
      for (const l of lights) {
        const b = drawPlant(kind, seed, scale, l);
        const what = `${kind} seed ${seed} @${scale}`;
        expect([what, b.img.w, b.img.h, b.foot]).toEqual([what, a.img.w, a.img.h, a.foot]);
        expect(mask(b)).toEqual(mask(a));
      }
    }
  });
  it('the light changes only the shading, over many seeds', () => {
    const lights = [lightVector({ side: 1, elevation: 51 }), lightVector({ side: -1, elevation: 35 }), lightVector({ side: 1, elevation: 70 })];
    const sameMask = (a: Drawn, b: Drawn) => { for (let i = 3; i < a.img.data.length; i += 4) if (a.img.data[i] !== b.img.data[i]) return false; return true; };
    for (const kind of PLANT_KINDS) for (let seed = 1; seed <= 12; seed++) for (const pct of [55, 100, 120]) {
      const a = drawPlant(kind, seed, pct);
      for (const l of lights) { const b = drawPlant(kind, seed, pct, l); const what = `${kind} ${seed} @${pct}`;
        expect([what, b.img.w, b.img.h, b.foot]).toEqual([what, a.img.w, a.img.h, a.foot]); expect([what, sameMask(a, b)]).toEqual([what, true]); }
    }
  }, 30_000);
  it('the light changes a plant, the default does not', () => {
    const a = drawPlant('round', 7, 100), b = drawPlant('round', 7, 100, DEFAULT_LIGHT), c = drawPlant('round', 7, 100, lightVector({ side: 1, elevation: 51 }));
    expect(b.img.data).toEqual(a.img.data);
    expect(c.img.data).not.toEqual(a.img.data);
    expect(c.foot).toEqual(a.foot);
  });
  it('the cove_tree frame is pinned (guards against drift)', () => {
    // FNV-1a of the 96x100 RGBA of coveTree(): the general round tree, seed 11, scale 1, foot at (48, 80).
    const img = coveTree();
    expect([img.w, img.h]).toEqual([96, 100]);
    expect(fnv(img)).toBe(HASH);
    expect(COVE_TREE_FOOT).toEqual({ x: 48, y: 80 });
  });

  it('drawPlant is deterministic', () => {
    for (const kind of PLANT_KINDS) {
      const a = drawPlant(kind, 7, 80), b = drawPlant(kind, 7, 80);
      expect(a.foot).toEqual(b.foot);
      expect(Array.from(a.img.data)).toEqual(Array.from(b.img.data));
    }
  });

  it('kinds differ', () => {
    const w = (shape: 'round' | 'wide' | 'tall') => drawTree({ seed: 3, scale: 1, shape }).img.w;
    expect(w('tall')).toBeLessThan(w('round'));
    expect(w('wide')).toBeGreaterThan(w('round'));
  });

  it('foot is inside the image and on wood', () => {
    for (const kind of PLANT_KINDS.filter((k) => k !== 'bush')) for (const pct of [50, 100, 120]) for (const seed of [1, 2, 3]) {
      const { img, foot } = drawPlant(kind, seed, pct);
      expect(foot.x).toBeGreaterThanOrEqual(0); expect(foot.x).toBeLessThan(img.w);
      expect(foot.y).toBeGreaterThanOrEqual(0); expect(foot.y).toBeLessThan(img.h);
      expect(alpha(img, foot.x, foot.y) || alpha(img, foot.x, foot.y - 1)).toBeGreaterThan(0);
    }
  });

  it('bush width', () => {
    for (let seed = 1; seed <= 30; seed++) expect(Math.abs(drawPlant('bush', seed, 100).img.w - 32)).toBeLessThanOrEqual(6);
    for (const seed of [1, 2, 3]) expect(drawPlant('bush', seed, 150).img.w).toBeGreaterThan(drawPlant('bush', seed, 100).img.w);
  });

  it('large trees are not clipped by the canvas', () => {
    // drawing throws if it reaches the canvas edge; the plan's biggest sizes must pass
    for (const shape of ['round', 'wide', 'tall', 'conifer'] as const) for (const seed of [1, 2, 3, 4, 5, 6]) {
      expect(() => drawTree({ seed, scale: 1.2, shape })).not.toThrow();
    }
    const { img, foot } = drawTree({ seed: 1, scale: 1.2, shape: 'wide' });
    expect(img.w).toBeGreaterThan(drawTree({ seed: 1, scale: 1, shape: 'wide' }).img.w);
    expect(foot.x).toBeGreaterThan(0);
  });

  it('small trees drop details', () => {
    // A vine is a free-hanging column of 3+ dark-green `1` pixels: outline or air on both sides.
    // (Canopy rows of `1` are always bordered by more leaf.) Big trees have them; at scale 0.5 there are none.
    const hasVine = (img: Rgba) => {
      const free = (x: number, y: number) => x < 0 || x >= img.w || alpha(img, x, y) === 0 || isOutline(img, x, y);
      for (let x = 0; x < img.w; x++) {
        let run = 0;
        for (let y = 0; y < img.h; y++) {
          run = isDarkGreen(img, x, y) && free(x - 1, y) && free(x + 1, y) ? run + 1 : 0;
          if (run >= 3) return true;
        }
      }
      return false;
    };
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seeds.some((seed) => hasVine(drawTree({ seed, scale: 1, shape: 'round' }).img))).toBe(true); // the detector sees vines
    for (const shape of ['round', 'wide', 'tall'] as const) for (const seed of seeds) {
      expect(hasVine(drawTree({ seed, scale: 0.5, shape }).img), `${shape} seed ${seed}`).toBe(false);
    }
  });

  it('cost', () => {
    drawPlant('round', 99, 100); // warm-up: the first draw pays for JIT
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) drawPlant(PLANT_KINDS[i % PLANT_KINDS.length], i, 50 + (i * 7) % 80);
    const ms = performance.now() - t0;
    // a generous guard against an order-of-magnitude regression (typically ~100 ms; a loaded parallel run is several times slower)
    expect(ms).toBeLessThan(1500);
  });
});
