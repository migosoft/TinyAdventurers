import { describe, expect, it } from 'vitest';
import { KIND, SIDE } from '../generated/defs';
import { shotPassesThrough } from './shotTargets';

describe('shotPassesThrough', () => {
  it('a neutral and a recruited knight let a shot fly on', () => {
    expect(shotPassesThrough({ kind: KIND.Knight, side: SIDE.Neutral })).toBe(true);
    expect(shotPassesThrough({ kind: KIND.Knight, side: SIDE.Friendly })).toBe(true);
  });
  it('a hostile orc and a barrel stop it', () => {
    expect(shotPassesThrough({ kind: KIND.OrcWarrior, side: SIDE.Hostile })).toBe(false);
    expect(shotPassesThrough({ kind: KIND.Barrel, side: SIDE.Neutral })).toBe(false);
  });
});
