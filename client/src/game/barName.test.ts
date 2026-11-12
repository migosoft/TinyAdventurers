import { describe, expect, it } from 'vitest';
import { FLAG, KIND, SIDE } from '../generated/defs';
import { barName, barOf, showsBar } from './barName';

describe('barOf', () => {
  const names = new Map([[1, 'Ayla']]);
  const e = (kind: number, side: number, o: { flags?: number; hp?: number; extra?: number } = {}) => ({ kind, side, flags: o.flags ?? 0, hp: o.hp ?? 0.5, extra: o.extra ?? 0 });
  it('has none for shots, hazards, chests, barrels, bosses and the dead', () => {
    for (const k of [KIND.Missile, KIND.FirePatch, KIND.Chest, KIND.Barrel, KIND.Dragon, KIND.Lich]) expect(barOf(e(k, SIDE.Hostile), names), `kind ${k}`).toBeNull();
    expect(barOf(e(KIND.SkeletonWarrior, SIDE.Hostile, { flags: FLAG.DEAD }), names)).toBeNull();
    expect(barOf(e(KIND.SkeletonWarrior, SIDE.Hostile, { hp: 1 }), names)).toBeNull();
  });
  it('an enemy is red 12 wide without a name, the ogre 28 wide even at full health', () => {
    expect(barOf(e(KIND.SkeletonWarrior, SIDE.Hostile), names)).toEqual({ w: 12, fill: 'enemy', label: null });
    expect(barOf(e(KIND.Ogre, SIDE.Hostile, { hp: 1 }), names)?.w).toBe(28);
  });
  it('a Friendly knight is green with a green name, a Neutral one grey-blue with a pale name, a wolf names its owner', () => {
    expect(barOf(e(KIND.Knight, SIDE.Friendly, { hp: 1 }), names)).toEqual({ w: 12, fill: 'hero', label: { text: 'Knight', color: '#7fe08a' } });
    expect(barOf(e(KIND.Knight, SIDE.Neutral, { hp: 1 }), names)).toEqual({ w: 12, fill: 'neutral', label: { text: 'Knight', color: '#b8c4d8' } });
    expect(barOf(e(KIND.DireWolf, SIDE.Friendly, { hp: 1, extra: 1 }), names)?.label?.text).toBe("Ayla's wolf");
  });
  it('a hero is green, a charmed (Hostile) hero red; heroes carry no name', () => {
    expect(barOf(e(KIND.Wizard, SIDE.Friendly), names)).toEqual({ w: 12, fill: 'hero', label: null });
    expect(barOf(e(KIND.Wizard, SIDE.Hostile), names)?.fill).toBe('enemy');
  });
});

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
