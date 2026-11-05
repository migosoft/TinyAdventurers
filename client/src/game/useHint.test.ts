import { describe, expect, it } from 'vitest';
import { EFFECT, FLAG, KIND, SIDE } from '../generated/defs';
import { pickUseHint } from './useHint';
import type { EntState } from './world';

const ent = (over: Partial<EntState>): EntState => ({
  id: 1, kind: KIND.Knight, x: 0, y: 0, hp: 1, anim: 0, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0, entangled: 0, side: SIDE.Neutral, ...over,
});
const sleeper = ent({ id: 2, kind: KIND.Wizard, x: 10, side: SIDE.Friendly, effects: 1 << EFFECT.Sleep });
const knight = ent({ id: 3, x: 12 });
const barrel = ent({ id: 4, kind: KIND.Barrel, x: 8, side: SIDE.Neutral });
const ME = 1;

describe('pickUseHint', () => {
  it('a sleeping teammate in reach is woken before a neutral knight', () => {
    expect(pickUseHint([knight, sleeper], ME, 0, 0)).toEqual({ ent: sleeper, label: 'Wake' });
  });
  it('only a neutral knight: Recruit', () => {
    expect(pickUseHint([knight], ME, 0, 0)).toEqual({ ent: knight, label: 'Recruit' });
  });
  it('a recruited (Friendly) knight gets no hint', () => {
    expect(pickUseHint([{ ...knight, side: SIDE.Friendly }], ME, 0, 0)).toBeNull();
  });
  it('a dead neutral knight and one out of reach get no hint', () => {
    expect(pickUseHint([{ ...knight, flags: FLAG.DEAD }], ME, 0, 0)).toBeNull();
    expect(pickUseHint([{ ...knight, x: 200 }], ME, 0, 0)).toBeNull();
  });
  it('the knight comes before a nearer barrel', () => {
    expect(pickUseHint([barrel, knight], ME, 0, 0)).toEqual({ ent: knight, label: 'Recruit' });
  });
  it('only a barrel: the barrel with no label', () => {
    expect(pickUseHint([barrel], ME, 0, 0)).toEqual({ ent: barrel, label: null });
  });
});
