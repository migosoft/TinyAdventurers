import { describe, expect, it } from 'vitest';
import { KIND } from '../generated/defs';
import { tagText } from './tags';

const names = new Map([[1, 'Ayla'], [2, 'Bo']]);
const tags = new Map<number, [number, number]>([[50, [KIND.GoblinArcher, 3]], [51, [KIND.Chest, 2]]]);
const ent = (id: number, kind: number, extra = 0) => ({ id, kind, extra });

describe('tagText', () => {
  it('a monster reads its kind name and number', () => {
    expect(tagText(ent(50, KIND.GoblinArcher), tags, names, 1)).toBe('Goblin Archer 3');
  });
  it('a hidden mimic reads as a chest because the server sends the chest kind', () => {
    expect(tagText(ent(51, KIND.Mimic), tags, names, 1)).toBe('Chest 2');
  });
  it('the own hero reads its name', () => {
    expect(tagText(ent(1, KIND.ElvenRanger), tags, names, 1)).toBe('Ayla');
  });
  it("the wolf reads its owner's name", () => {
    expect(tagText(ent(60, KIND.DireWolf, 1), tags, names, 1)).toBe("Ayla's wolf");
    expect(tagText(ent(61, KIND.DireWolf, 2), tags, names, 1)).toBe("Bo's wolf");
  });
  it('a teammate and an untagged entity read null', () => {
    expect(tagText(ent(2, KIND.ElvenRanger), tags, names, 1)).toBeNull();
    expect(tagText(ent(99, KIND.GoblinArcher), tags, names, 1)).toBeNull();
  });
});
