import { describe, expect, it } from 'vitest';
import { KIND } from '../generated/defs';
import { arcHits, hitRadius, shotHits } from './hitbox';

// The rows of the server test `the_hit_cylinder_matches_the_parity_table` (server/src/run/arc.rs); shot radius 3.
// [kind, airborne, [px, py], shot height (null: a flat shot), hit]
const ROWS: [number, boolean, [number, number], number | null, boolean][] = [
  [KIND.GoblinArcher, false, [8.9, 0], null, true],
  [KIND.GoblinArcher, false, [9.1, 0], null, false],
  [KIND.GoblinArcher, false, [0, -8.9], null, true],
  [KIND.GoblinArcher, false, [0, -9.1], null, false],
  [KIND.Ogre, false, [0, -12.9], null, true],
  [KIND.Ogre, false, [0, -18], null, false],
  [KIND.FireDemon, false, [0, -45], null, false],
  [KIND.Dragon, true, [0, -19.9], null, true],
  [KIND.Dragon, true, [0, -50], null, false],
  [KIND.GoblinArcher, false, [5, 0], 9.9, true],
  [KIND.GoblinArcher, false, [5, 0], 10, false],
  [KIND.Dragon, true, [19.9, 0], 67.9, true],
  [KIND.Dragon, true, [19.9, 0], 68, false],
];

describe('the hit cylinder', () => {
  it.each(ROWS.map((r, i) => [i, ...r] as const))('matches the server parity table, row %i', (_i, kind, air, [px, py], z, hit) => {
    const got = z === null ? shotHits(kind, 0, 0, px, py, 3) : arcHits(kind, 0, 0, air, px, py, z, 3);
    expect(got).toBe(hit);
  });

  it('is at least SHOT_MIN_RADIUS wide', () => {
    expect(hitRadius(KIND.GoblinArcher)).toBe(6);
    expect(hitRadius(KIND.Wizard)).toBeNull();
  });

  it('ignores heroes', () => {
    expect(shotHits(KIND.Wizard, 0, 0, 0, 0, 3)).toBe(false);
  });

  it('treats a chest exactly like a hidden mimic', () => {
    for (const dx of [0, 5, 8.9, 9.1, 12]) {
      expect(shotHits(KIND.Chest, 0, 0, dx, 0, 3)).toBe(shotHits(KIND.Mimic, 0, 0, dx, 0, 3));
      expect(shotHits(KIND.Chest, 0, 0, 0, -dx, 3)).toBe(shotHits(KIND.Mimic, 0, 0, 0, -dx, 3));
    }
    expect(shotHits(KIND.Chest, 0, 0, 8, 0, 3)).toBe(true);
  });
});
