import { describe, expect, it } from 'vitest';
import { DMG_TYPE } from '../generated/defs';
import { DMG_COLORS, dmgColor, floatOf, onOwnHero } from './damage';

describe('floatOf', () => {
  const dmg = { t: 'Dmg', x: 0, y: 0, v: 11.6, crit: false, p: false, ty: DMG_TYPE.Physical, imm: false } as const;
  it('names every float as 2D shows it', () => {
    expect(floatOf({ ...dmg, imm: true })).toEqual({ text: 'immune', color: '#a0a0a0', opts: { kind: 'small' } });
    expect(floatOf({ ...dmg, crit: true })).toEqual({ text: '12', color: '#ffd24a', opts: { big: true } });
    expect(floatOf(dmg)).toEqual({ text: '12', color: '#ffffff', opts: {} });
    expect(floatOf({ ...dmg, p: true })?.color).toBe('#ff5050');
    expect(floatOf({ t: 'Heal', x: 0, y: 0, v: 4.4, p: true })).toEqual({ text: '+4', color: '#60ff80', opts: {} });
    expect(floatOf({ t: 'Immune', x: 0, y: 0 })).toEqual({ text: 'IMMUNE', color: '#9ae0ff', opts: { kind: 'small', up: 18 } });
    expect(floatOf({ t: 'Coins', x: 0, y: 0, v: 7 })).toEqual({ text: '+7 coins', color: '#ffd040', opts: { kind: 'small', up: 14 } });
    expect(floatOf({ t: 'Boom', x: 0, y: 0, r: 1, k: 0 })).toBeNull();
  });
  it('finds a hit on the own hero by 2D proximity rule', () => {
    expect(onOwnHero({ x: 50, y: 40, p: true }, { x: 51, y: 51 })).toBe(true);
    expect(onOwnHero({ x: 50, y: 40, p: true }, { x: 56, y: 50 })).toBe(false);
    expect(onOwnHero({ x: 50, y: 40, p: false }, { x: 50, y: 50 })).toBe(false);
  });
});

describe('damage colours', () => {
  it('keeps physical white on enemies and red on heroes, colours other types', () => {
    expect(dmgColor(DMG_TYPE.Physical, false)).toBe('#ffffff');
    expect(dmgColor(DMG_TYPE.Physical, true)).toBe('#ff5050');
    expect(dmgColor(DMG_TYPE.Heat, false)).toBe('#ff9030');
    expect(dmgColor(DMG_TYPE.Cold, true)).toBe('#80d0ff');
  });

  it('has a colour for every damage type but physical', () => {
    for (const [name, ty] of Object.entries(DMG_TYPE)) {
      if (ty === DMG_TYPE.Physical) continue;
      expect(DMG_COLORS[ty], name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
