import { describe, expect, it } from 'vitest';
import { drawPlant, drawTree } from '../../game/vegetation';
import { leafyRecipe, plantRecipe, rng } from './recipe';

/** FNV-1a over the JSON text: every number of the recipe, to the last bit (JSON prints a double exactly). */
function hash(v: unknown): number {
  const s = JSON.stringify(v); let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const TREE_PCTS = [50, 60, 69, 70, 80, 100, 120, 130], BUSH_PCTS = [75, 87, 88, 100, 124, 125, 150], OLD_PCTS = [80, 100, 120];
const TREES = ['round', 'wide', 'tall', 'conifer'] as const;

/** The recipes as they were before the recipe got its own module (#334), recorded from the painters' generator (game/vegetation/*) at af89609. */
const PINNED = { round: 778112706, wide: 831311708, tall: 2477591384, conifer: 1831981634, bush: 636702037, old: 1918450829 };

describe('plant recipes', () => {
  it('are what the generator gave before #334', () => {
    const got: Record<string, number> = {};
    for (const kind of TREES) got[kind] = hash(SEEDS.map((seed) => TREE_PCTS.map((pct) => plantRecipe(kind, seed, pct))));
    got.bush = hash(SEEDS.map((seed) => BUSH_PCTS.map((pct) => plantRecipe('bush', seed, pct))));
    got.old = hash(SEEDS.map((seed) => OLD_PCTS.map((pct) => leafyRecipe({ seed, scale: pct / 100, shape: 'wide', old: true }))));
    expect(got).toEqual(PINNED);
  });

  // Until #333 removes the painters: a painter draws from the same stream, so its recipe must be the module's.
  it('are the recipes the pictures are painted from', () => {
    const got: Record<string, number> = {};
    for (const kind of TREES) got[kind] = hash(SEEDS.map((seed) => TREE_PCTS.map((pct) => drawPlant(kind, seed, pct).recipe)));
    got.bush = hash(SEEDS.map((seed) => BUSH_PCTS.map((pct) => drawPlant('bush', seed, pct).recipe)));
    got.old = hash(SEEDS.map((seed) => OLD_PCTS.map((pct) => drawTree({ seed, scale: pct / 100, shape: 'wide', old: true }).recipe)));
    expect(got).toEqual(PINNED);
  }, 30_000); // 1 680 pictures: over the default limit when the whole suite runs

  it('are deterministic and fresh objects', () => {
    for (const kind of [...TREES, 'bush'] as const) {
      const a = plantRecipe(kind, 7, 100), b = plantRecipe(kind, 7, 100);
      expect(a).toEqual(b);
      expect(a.trunk).not.toBe(b.trunk);
    }
  });
});

describe('rng', () => {
  it('skip(n) steps over exactly n draws', () => {
    for (const n of [0, 1, 7, 1000, 123457]) {
      const a = rng(42), b = rng(42);
      a(); b();
      for (let i = 0; i < n; i++) a();
      b.skip(n);
      expect([n, b(), b()]).toEqual([n, a(), a()]);
    }
  });
});
