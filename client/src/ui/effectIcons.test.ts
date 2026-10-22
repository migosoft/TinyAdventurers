import { describe, expect, it } from 'vitest';
import { EFFECT } from '../generated/defs';
import { EFFECT_ICON, effectIconDataUri, effectIconSvg } from './effectIcons';

describe('effect icons', () => {
  it('has a symbol for every effect', () => {
    for (const [name, id] of Object.entries(EFFECT)) expect(EFFECT_ICON[id], name).toBeDefined();
  });
  it('draws each weaker step as its strong symbol in outline', () => {
    for (const [weak, strong] of [[EFFECT.Singed, EFFECT.Burning], [EFFECT.Chilled, EFFECT.Frozen], [EFFECT.Tainted, EFFECT.Poisoned]]) {
      expect(EFFECT_ICON[weak].body).toBe(EFFECT_ICON[strong].body);
      expect(EFFECT_ICON[weak].color).toBe(EFFECT_ICON[strong].color);
      expect([EFFECT_ICON[weak].weak, EFFECT_ICON[strong].weak]).toEqual([true, false]);
    }
  });
  it('gives every other effect its own symbol', () => {
    const strong = Object.values(EFFECT).filter((id) => !EFFECT_ICON[id].weak).map((id) => EFFECT_ICON[id].body);
    expect(new Set(strong).size).toBe(strong.length);
  });
  it('renders an outline for a weak fill symbol', () => {
    expect(effectIconSvg(EFFECT.Tainted, 14)).toContain('fill="none"');
    expect(effectIconSvg(EFFECT.Poisoned, 14)).toContain('fill="#6ad04a"');
  });
  it('makes a data URI Phaser can load', () => expect(effectIconDataUri(EFFECT.Sleep, 32)).toMatch(/^data:image\/svg\+xml;base64,/));
});
