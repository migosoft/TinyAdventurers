import { describe, expect, it } from 'vitest';
import { FLAG, KIND, SIDE } from '../generated/defs';
import { barName, showsBar } from './barName';

const names = new Map([[1, 'Ayla'], [2, 'Bo']]);
const ent = (kind: number, extra = 0) => ({ kind, extra });

describe('barName', () => {
  it("the knight reads 'Knight', the wolf \"{leader}'s wolf\", a hero nothing", () => {
    expect(barName(ent(KIND.Knight, 2), names)).toBe('Knight');
    expect(barName(ent(KIND.DireWolf, 1), names)).toBe("Ayla's wolf");
    expect(barName(ent(KIND.DireWolf, 2), names)).toBe("Bo's wolf");
    expect(barName(ent(KIND.ElvenRanger), names)).toBeUndefined();
  });
  it('a wolf with an unknown leader falls back to its figure label', () => {
    expect(barName(ent(KIND.DireWolf, 9), names)).toBe('Dire Wolf');
  });
});

describe('showsBar', () => {
  const e = (kind: number, side: number, flags: number, hp: number) => ({ kind, side, flags, hp });
  it('a calm animal shows its bar only when hurt, and has no name', () => {
    expect(showsBar(e(KIND.Bunny, SIDE.Neutral, FLAG.WILD, 1))).toBe(false);
    expect(showsBar(e(KIND.Bunny, SIDE.Neutral, FLAG.WILD, 0.5))).toBe(true);
    expect(barName({ kind: KIND.Bunny, extra: 0 }, names)).toBeUndefined();
  });
  it('the knight and the wolf always show a bar; an enemy only when hurt', () => {
    expect(showsBar(e(KIND.Knight, SIDE.Neutral, 0, 1))).toBe(true);
    expect(showsBar(e(KIND.DireWolf, SIDE.Friendly, 0, 1))).toBe(true);
    expect(showsBar(e(KIND.OrcWarrior, SIDE.Hostile, 0, 1))).toBe(false);
    expect(showsBar(e(KIND.OrcWarrior, SIDE.Hostile, 0, 0.5))).toBe(true);
  });
});
