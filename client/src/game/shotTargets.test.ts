import { describe, expect, it } from 'vitest';
import { FLAG, KIND, SIDE } from '../generated/defs';
import { shotPassesThrough } from './shotTargets';

describe('shotPassesThrough', () => {
  it('a neutral and a recruited knight let a shot fly on', () => {
    expect(shotPassesThrough({ kind: KIND.Knight, side: SIDE.Neutral, flags: 0 })).toBe(true);
    expect(shotPassesThrough({ kind: KIND.Knight, side: SIDE.Friendly, flags: 0 })).toBe(true);
  });
  it('a hostile orc and a barrel stop it', () => {
    expect(shotPassesThrough({ kind: KIND.OrcWarrior, side: SIDE.Hostile, flags: 0 })).toBe(false);
    expect(shotPassesThrough({ kind: KIND.Barrel, side: SIDE.Neutral, flags: 0 })).toBe(false);
  });
  it('the wolf and a teammate let it fly on', () => {
    expect(shotPassesThrough({ kind: KIND.DireWolf, side: SIDE.Friendly, flags: 0 })).toBe(true);
    expect(shotPassesThrough({ kind: KIND.Paladin, side: SIDE.Friendly, flags: 0 })).toBe(true);
  });
  it('a calm animal and a boar with a grudge stop it', () => {
    for (const kind of [KIND.Bunny, KIND.Deer, KIND.Stag, KIND.Boar]) expect(shotPassesThrough({ kind, side: SIDE.Neutral, flags: FLAG.WILD })).toBe(false);
    expect(shotPassesThrough({ kind: KIND.Boar, side: SIDE.Hostile, flags: 0 })).toBe(false);
    // Even if a grudge against enemies only leaves it Neutral without the flag, it is an animal by kind.
    expect(shotPassesThrough({ kind: KIND.Boar, side: SIDE.Neutral, flags: 0 })).toBe(false);
  });
});
