import { describe, expect, it } from 'vitest';
import { COVE_TREE_FOOT, COVE_TREE_SCALE, DEFAULT_LIGHT, PLANT_KINDS, type Drawn, type Rgba, coveTree, drawPlant, drawTree, lightVector } from './vegetation';

/** FNV-1a over the RGBA bytes. */
function fnv(img: Rgba): number {
  let h = 0x811c9dc5;
  for (const b of img.data) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
const alpha = (img: Rgba, x: number, y: number) => img.data[(y * img.w + x) * 4 + 3];
const isOutline = (img: Rgba, x: number, y: number) => { const i = (y * img.w + x) * 4; return img.data[i] === 34 && img.data[i + 1] === 34 && img.data[i + 2] === 34; };
// dark green `1` of the leaf palette (40, 100, 62)
const isDarkGreen = (img: Rgba, x: number, y: number) => { const i = (y * img.w + x) * 4; return img.data[i] === 40 && img.data[i + 1] === 100 && img.data[i + 2] === 62 && img.data[i + 3] === 255; };

const LEAF_RGB = [[28, 58, 50], [40, 100, 62], [62, 138, 67], [106, 174, 79], [156, 207, 98], [22, 48, 52], [30, 74, 70], [44, 104, 88], [74, 140, 104], [118, 176, 124]];
const HASH = 2230737650;

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
  it('the cove_tree frame at COVE_TREE_SCALE is pinned (guards against drift)', () => {
    // FNV-1a of the 96x100 RGBA of coveTree(): the general round tree, seed 11, `old: true`, COVE_TREE_SCALE, foot at (48, 80). Re-recorded in #279 tuning round 1 (old, thicker, more bent trunk).
    expect(COVE_TREE_SCALE).toBeGreaterThan(0.85); expect(COVE_TREE_SCALE).toBeLessThanOrEqual(1);
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

  /** A per-pixel classifier of an image: 'leaf', 'bark' or '' (transparent or anything else). */
  const bushPixels = (img: Rgba) => {
    const kind = (x: number, y: number) => {
      const i = (y * img.w + x) * 4; if (img.data[i + 3] === 0) return '';
      const rgb = [img.data[i], img.data[i + 1], img.data[i + 2]];
      if (LEAF_RGB.some((c) => c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2])) return 'leaf';
      return [[58, 35, 40], [98, 53, 43], [143, 64, 41], [176, 112, 74]].some((c) => c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2]) ? 'bark' : '';
    };
    return kind;
  };

  it('a bush stands on one thin stem that touches the ground in 1 px (2 px from 40 px wide)', () => {
    for (const pct of [60, 100, 150]) for (let seed = 1; seed <= 20; seed++) {
      const d = drawPlant('bush', seed, pct), img = d.img, kind = bushPixels(img), at = `seed ${seed} ${pct}%`;
      expect(d.parts!.stems, at).toBe(1);
      let low = -1; for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (kind(x, y) === 'bark') low = Math.max(low, y);
      let width = 0; for (let x = 0; x < img.w; x++) if (kind(x, low) === 'bark') width++;
      expect([at, width]).toEqual([at, (32 * pct) / 100 < 40 ? 1 : 2]);
    }
  });

  it('a bush stem forks into branches above the ground', () => {
    // the bark rows above the stem's foot row hold more than one bark pixel somewhere (the fork), at 150 % where it can be seen
    let forked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const img = drawPlant('bush', seed, 150).img, kind = bushPixels(img);
      for (let y = 0; y < img.h; y++) { let n = 0; for (let x = 0; x < img.w; x++) if (kind(x, y) === 'bark') n++; if (n >= 3) { forked++; break; } }
    }
    expect(forked).toBe(20);
  });

  it('a bush has bark below its crown', () => {
    for (const pct of [75, 100, 150]) for (let seed = 1; seed <= 20; seed++) {
      const d = drawPlant('bush', seed, pct), img = d.img, kind = bushPixels(img), at = `seed ${seed} ${pct}%`;
      let lowLeaf = -1, lowBark = -1;
      for (let x = 0; x < img.w; x++) {
        let topLeaf = Infinity, bottomLeaf = -1, topBark = Infinity;
        for (let y = 0; y < img.h; y++) {
          const k = kind(x, y);
          if (k === 'leaf') { bottomLeaf = y; topLeaf = Math.min(topLeaf, y); } else if (k === 'bark') { topBark = Math.min(topBark, y); lowBark = Math.max(lowBark, y); }
        }
        lowLeaf = Math.max(lowLeaf, bottomLeaf);
        if (topBark !== Infinity) expect(topBark, `${at} column ${x}`).toBeGreaterThan(bottomLeaf);
      }
      expect(lowBark, at).toBeGreaterThan(lowLeaf);
    }
  });

  it("the bush's foot is the ground under the crown", () => {
    for (const pct of [75, 100, 150]) for (let seed = 1; seed <= 20; seed++) {
      const { img, foot } = drawPlant('bush', seed, pct), kind = bushPixels(img), at = `seed ${seed} ${pct}%`;
      let minX = Infinity, maxX = -1, lowBark = -1;
      for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) { const k = kind(x, y); if (k === 'leaf') { minX = Math.min(minX, x); maxX = Math.max(maxX, x); } else if (k === 'bark') lowBark = Math.max(lowBark, y); }
      expect(Math.abs(foot.x - (minX + maxX) / 2), at).toBeLessThanOrEqual(3);
      expect([lowBark, lowBark + 1], at).toContain(foot.y);
    }
  });

  it('bush width holds over many seeds', () => {
    for (const pct of [75, 100, 150]) for (let seed = 1; seed <= 200; seed++) expect(Math.abs(drawPlant('bush', seed, pct).img.w - (32 * pct) / 100), `seed ${seed} ${pct}%`).toBeLessThanOrEqual(6);
  });

  it('large trees are not clipped by the canvas', () => {
    // drawing throws if it reaches the canvas edge; the plan's biggest sizes must pass
    for (const shape of ['round', 'wide', 'tall', 'conifer', 'bare'] as const) for (const seed of [1, 2, 3, 4, 5, 6]) {
      expect(() => drawTree({ seed, scale: 1.2, shape })).not.toThrow();
    }
    for (let seed = 1; seed <= 20; seed++) expect(() => drawPlant('bush', seed, 150)).not.toThrow();
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

  it('a leafy tree at 100 % has a pocket and a vine', () => {
    for (const shape of ['round', 'wide', 'tall'] as const) for (let seed = 1; seed <= 6; seed++) {
      const d = drawTree({ seed, scale: 1, shape });
      expect([`${shape} ${seed}`, d.parts!.pockets >= 1, d.parts!.vines >= 1]).toEqual([`${shape} ${seed}`, true, true]);
    }
  });

  it('the crown is one mass', () => {
    // Leaf pixels (palette 0-4) above the row foot.y - 15 * scale form one 4-connected region; root moss below is left out.
    const LEAF = [[28, 58, 50], [40, 100, 62], [62, 138, 67], [106, 174, 79], [156, 207, 98]];
    for (const shape of ['round', 'wide', 'tall'] as const) for (let seed = 1; seed <= 6; seed++) {
      const { img, foot } = drawTree({ seed, scale: 1, shape });
      const limit = foot.y - 15;
      const leaf = (x: number, y: number) => { if (x < 0 || y < 0 || x >= img.w || y >= limit) return false; const i = (y * img.w + x) * 4; return img.data[i + 3] === 255 && LEAF.some((c) => c[0] === img.data[i] && c[1] === img.data[i + 1] && c[2] === img.data[i + 2]); };
      const seen = new Set<number>(); let regions = 0;
      for (let y = 0; y < limit; y++) for (let x = 0; x < img.w; x++) {
        if (!leaf(x, y) || seen.has(y * img.w + x)) continue;
        regions++; const stack = [[x, y]]; seen.add(y * img.w + x);
        while (stack.length) { const [px, py] = stack.pop()!; for (const [qx, qy] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) if (leaf(qx, qy) && !seen.has(qy * img.w + qx)) { seen.add(qy * img.w + qx); stack.push([qx, qy]); } }
      }
      expect([`${shape} ${seed}`, regions]).toEqual([`${shape} ${seed}`, 1]);
    }
  });

  it('leafy trunks are slim and stand on few roots', () => {
    const BARK = [[58, 35, 40], [98, 53, 43], [143, 64, 41], [176, 112, 74]];
    const isBark = (img: Rgba, x: number, y: number) => { const i = (y * img.w + x) * 4; return img.data[i + 3] === 255 && BARK.some((b) => b[0] === img.data[i] && b[1] === img.data[i + 1] && b[2] === img.data[i + 2]); };
    /** The distance from the first to the last bark pixel of a row, plus one (0 when there is none). */
    const extent = (img: Rgba, y: number) => { let a = -1, b = -1; for (let x = 0; x < img.w; x++) if (isBark(img, x, y)) { if (a < 0) a = x; b = x; } return a < 0 ? 0 : b - a + 1; };
    const limits = { round: [12, 46], wide: [13, 54], tall: [7, 26] } as const;
    for (const shape of ['round', 'wide', 'tall'] as const) for (let seed = 1; seed <= 6; seed++) {
      const { img, foot } = drawTree({ seed, scale: 1, shape });
      const what = `${shape} seed ${seed}`;
      expect(extent(img, foot.y - 20), `${what} trunk`).toBeLessThanOrEqual(limits[shape][0]);
      let roots = 0; for (let y = foot.y - 3; y <= foot.y + 3; y++) roots = Math.max(roots, extent(img, y));
      expect(roots, `${what} roots`).toBeLessThanOrEqual(limits[shape][1]);
    }
  });

  it("a conifer's hem is jagged", () => {
    // Per column the lowest leaf pixel (palette 5-9) above the row foot.y - 8; walking left to right its height changes direction at least 12 times.
    const LEAF = [[22, 48, 52], [30, 74, 70], [44, 104, 88], [74, 140, 104], [118, 176, 124]];
    for (let seed = 1; seed <= 6; seed++) {
      const { img, foot } = drawTree({ seed, scale: 1, shape: 'conifer' });
      const leaf = (x: number, y: number) => { const i = (y * img.w + x) * 4; return img.data[i + 3] === 255 && LEAF.some((c) => c[0] === img.data[i] && c[1] === img.data[i + 1] && c[2] === img.data[i + 2]); };
      const low: number[] = [];
      for (let x = 0; x < img.w; x++) for (let y = foot.y - 9; y >= 0; y--) if (leaf(x, y)) { low.push(y); break; }
      let turns = 0, dir = 0;
      for (let i = 1; i < low.length; i++) { const d = Math.sign(low[i] - low[i - 1]); if (d === 0) continue; if (dir !== 0 && d !== dir) turns++; dir = d; }
      expect([`conifer ${seed}`, turns >= 12], `${turns} turns`).toEqual([`conifer ${seed}`, true]);
    }
  });

  it('a conifer is solid from its tip down to the foot', () => {
    for (let seed = 1; seed <= 30; seed++) for (const pct of [50, 51, 60, 70, 80, 90, 100, 110, 120]) {
      const { img, foot } = drawPlant('conifer', seed, pct);
      let y = 0; while (y < img.h && (alpha(img, foot.x, y) === 0 || isOutline(img, foot.x, y))) y++; // the outline above the tip
      let bad = -1; for (; y <= foot.y; y++) if (alpha(img, foot.x, y) === 0 || isOutline(img, foot.x, y)) { bad = y; break; }
      expect([`conifer ${seed} @${pct}`, bad]).toEqual([`conifer ${seed} @${pct}`, -1]);
    }
  });

  it('a conifer is about 46 x 90 at seed 11', () => {
    const { img } = drawTree({ seed: 11, scale: 1, shape: 'conifer' });
    expect(Math.abs(img.w - 46)).toBeLessThanOrEqual(8); expect(Math.abs(img.h - 90)).toBeLessThanOrEqual(8);
  });

  it('PLANT_KINDS matches the server', () => {
    // The wire id is the index; the server's `PlantKind` in woodland.rs has the same six, pinned by its test `plant_kind_ids_match_the_client`.
    expect(PLANT_KINDS).toEqual(['round', 'wide', 'tall', 'conifer', 'bush', 'bare']);
  });

  it('a bare tree has no leaves', () => {
    for (const pct of [60, 100]) for (let seed = 1; seed <= 6; seed++) {
      const { img, foot } = drawPlant('bare', seed, pct), limit = foot.y - 6 * (pct / 100);
      for (let y = 0; y < Math.min(img.h, limit); y++) for (let x = 0; x < img.w; x++) {
        const i = (y * img.w + x) * 4;
        if (img.data[i + 3] === 0) continue;
        const rgb = [img.data[i], img.data[i + 1], img.data[i + 2]];
        expect(LEAF_RGB.some((c) => c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2]), `seed ${seed} ${pct}% at ${x},${y}`).toBe(false);
      }
    }
  });

  it('a bare tree is dead wood: no live-brown pixels, only the greyer ramp', () => {
    const LIVE = [[58, 35, 40], [98, 53, 43], [143, 64, 41], [176, 112, 74]], DEAD = [[40, 32, 34], [64, 50, 47], [90, 73, 64], [118, 99, 84]];
    const has = (img: Rgba, set: number[][]) => { for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] === 255 && set.some((c) => c[0] === img.data[i] && c[1] === img.data[i + 1] && c[2] === img.data[i + 2])) return true; return false; };
    for (const pct of [60, 100, 120]) for (let seed = 1; seed <= 6; seed++) {
      const { img } = drawPlant('bare', seed, pct);
      expect([`seed ${seed} ${pct}% live`, has(img, LIVE)]).toEqual([`seed ${seed} ${pct}% live`, false]);
      expect([`seed ${seed} ${pct}% dead`, has(img, DEAD)]).toEqual([`seed ${seed} ${pct}% dead`, true]);
    }
    // a leafy tree keeps its live bark
    expect(has(drawPlant('round', 1, 100).img, LIVE)).toBe(true);
  });

  it('an old tree has a thicker trunk than the same seed without `old`', () => {
    const BARK = [[58, 35, 40], [98, 53, 43], [143, 64, 41], [176, 112, 74]];
    const isBark = (img: Rgba, x: number, y: number) => { const i = (y * img.w + x) * 4; return img.data[i + 3] === 255 && BARK.some((b) => b[0] === img.data[i] && b[1] === img.data[i + 1] && b[2] === img.data[i + 2]); };
    const extent = (img: Rgba, y: number) => { let a = -1, b = -1; for (let x = 0; x < img.w; x++) if (isBark(img, x, y)) { if (a < 0) a = x; b = x; } return a < 0 ? 0 : b - a + 1; };
    const widest = (d: Drawn) => { let m = 0; for (let y = d.foot.y - 24; y <= d.foot.y - 10; y++) m = Math.max(m, extent(d.img, y)); return m; }; // the trunk's middle, above the roots
    for (const shape of ['round', 'wide', 'tall'] as const) for (let seed = 1; seed <= 6; seed++) {
      const a = drawTree({ seed, scale: 1, shape }), b = drawTree({ seed, scale: 1, shape, old: true });
      expect([`${shape} ${seed}`, widest(b) > widest(a)]).toEqual([`${shape} ${seed}`, true]);
    }
    // ignored by the other shapes
    expect(drawTree({ seed: 3, scale: 1, shape: 'conifer', old: true }).img.data).toEqual(drawTree({ seed: 3, scale: 1, shape: 'conifer' }).img.data);
    expect(drawTree({ seed: 3, scale: 1, shape: 'bare', old: true }).img.data).toEqual(drawTree({ seed: 3, scale: 1, shape: 'bare' }).img.data);
  });

  it("a bare tree fills a crown's box", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { img } = drawPlant('bare', seed, 100);
      expect([seed, img.w >= 45 && img.h >= 75]).toEqual([seed, true]);
    }
  });

  it('a leafy tree below 70 % has at most one pocket', () => {
    for (const kind of ['round', 'wide', 'tall'] as const) for (let seed = 1; seed <= 6; seed++) expect(drawPlant(kind, seed, 60).parts!.pockets, `${kind} ${seed}`).toBeLessThanOrEqual(1);
  });

  it('a bare tree below 70 % has fewer limbs (depth 3 instead of 4)', () => {
    for (let seed = 1; seed <= 6; seed++) expect(drawPlant('bare', seed, 60).parts!.limbs, `seed ${seed}`).toBeLessThan(drawPlant('bare', seed, 100).parts!.limbs);
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
