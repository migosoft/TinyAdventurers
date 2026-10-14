import { describe, expect, it } from 'vitest';
import { DMG_TYPE } from '../generated/defs';
import { dmgColor } from './damage';

describe('damage colours', () => {
  it('keeps physical white on enemies and red on heroes, colours other types', () => {
    expect(dmgColor(DMG_TYPE.Physical, false)).toBe('#ffffff');
    expect(dmgColor(DMG_TYPE.Physical, true)).toBe('#ff5050');
    expect(dmgColor(DMG_TYPE.Heat, false)).toBe('#ff9030');
    expect(dmgColor(DMG_TYPE.Cold, true)).toBe('#80d0ff');
  });
});
