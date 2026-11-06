import { describe, expect, it } from 'vitest';
import { KIND } from '../generated/defs';
import { barName } from './barName';

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
