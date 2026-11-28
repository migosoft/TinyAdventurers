import { describe, expect, it } from 'vitest';
import { CONST, KIND } from '../generated/defs';
import type { EntSnap } from '../generated/EntSnap';
import { predictedSolids } from './solids';

const ent = (kind: number, x: number, y: number, anim: number): EntSnap => [1, kind, x, y, 255, anim, 0, 0, 0, 0, 0, 0, 0, 128, 0];

describe('predictedSolids (#274)', () => {
  it('takes the sent barrels at rest and the near solids the server did not send', () => {
    const half = CONST.SOLID_OBJECTS[KIND.Barrel];
    const got = predictedSolids({ ents: [ent(KIND.Barrel, 40, 50, 0), ent(KIND.Barrel, 60, 50, 2), ent(KIND.GoblinArcher, 70, 50, 0)], solids: [[100, 110, 6]] });
    expect(got).toEqual([{ x: 40, y: 50, half }, { x: 100, y: 110, half: 6 }]);
  });
});
