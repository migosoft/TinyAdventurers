import { describe, expect, it } from 'vitest';
import { drawPlant, drawTree } from '../../game/vegetation';

/** FNV-1a over the JSON text: every number of the recipe, to the last bit (JSON prints a double exactly). */
function hash(v: unknown): number {
  const s = JSON.stringify(v); let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const TREE_PCTS = [50, 60, 69, 70, 80, 100, 120, 130], BUSH_PCTS = [75, 87, 88, 100, 124, 125, 150], OLD_PCTS = [80, 100, 120];

/** The recipes as they were before the recipe got its own module (#334), recorded from the 2D generator at af89609. */
const PINNED = { round: 778112706, wide: 831311708, tall: 2477591384, conifer: 1831981634, bush: 636702037, old: 1918450829 };

describe('plant recipes', () => {
  it('are what the 2D generator gave before #334', () => {
    const got: Record<string, number> = {};
    for (const kind of ['round', 'wide', 'tall', 'conifer'] as const) got[kind] = hash(SEEDS.map((seed) => TREE_PCTS.map((pct) => drawPlant(kind, seed, pct).recipe)));
    got.bush = hash(SEEDS.map((seed) => BUSH_PCTS.map((pct) => drawPlant('bush', seed, pct).recipe)));
    got.old = hash(SEEDS.map((seed) => OLD_PCTS.map((pct) => drawTree({ seed, scale: pct / 100, shape: 'wide', old: true }).recipe)));
    expect(got).toEqual(PINNED);
  });
});
