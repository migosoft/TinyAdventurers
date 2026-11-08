// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { EFFECT } from '../generated/defs';
import { CharmView, charmFrac, charmLeft } from './charmView';

const bar = (v: CharmView) => (v.root.querySelector('.charm-bar i') as HTMLElement).style.width;

describe('charmFrac', () => {
  it('shrinks with the time left and clamps to 0..1', () => {
    expect(charmFrac(5, 10)).toBe(0.5);
    expect(charmFrac(10, 10)).toBe(1);
    expect(charmFrac(0, 10)).toBe(0);
    expect(charmFrac(12, 10)).toBe(1);
    expect(charmFrac(-1, 10)).toBe(0);
    expect(charmFrac(3, 0)).toBe(0);
  });
});

describe('charmLeft', () => {
  it('is the longest unpaused Charmed entry', () => {
    const e = (k: number, left: number, paused: boolean) => [k, left, 0, paused] as Parameters<typeof charmLeft>[0][number];
    expect(charmLeft([e(EFFECT.Charmed, 2, false), e(EFFECT.Charmed, 5, false), e(EFFECT.Charmed, 9, true), e(EFFECT.Fear, 30, false)])).toBe(5);
    expect(charmLeft([])).toBe(0);
  });
});

describe('CharmView', () => {
  let view: CharmView;
  beforeEach(() => {
    document.body.innerHTML = '';
    view = new CharmView(document.body);
  });
  it('shows the title, the caster and the shrinking bar only while charmed', () => {
    expect(view.root.hidden).toBe(true);
    view.update('the Orc Warrior', 8);
    expect(view.root.hidden).toBe(false);
    expect(view.root.querySelector('.charm-title')!.textContent).toBe('CHARMED');
    expect(view.root.querySelector('.charm-by')!.textContent).toBe('by the Orc Warrior');
    expect(bar(view)).toBe('100%');
    view.update('the Orc Warrior', 4);
    expect(bar(view)).toBe('50%');
    view.update('the Orc Warrior', 2);
    expect(bar(view)).toBe('25%');
    view.update(null, 0);
    expect(view.root.hidden).toBe(true);
  });
  it('starts the bar full again for a new charm', () => {
    view.update('A', 6);
    view.update('A', 3);
    view.update(null, 0);
    view.update('B', 4);
    expect(bar(view)).toBe('100%');
  });
});
