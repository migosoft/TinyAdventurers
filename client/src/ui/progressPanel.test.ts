import { describe, expect, test } from 'vitest';
import type { CharacterInfo } from '../generated/CharacterInfo';
import type { PoolCard } from '../generated/PoolCard';
import { fixtureInfo } from './hub/fixture';
import { progressPanel } from './progressPanel';

describe('the panel text', () => {
  test('heading, Attribute row and +1 button', () => {
    const html = progressPanel(fixtureInfo('Wizard', { xp: 1000 }), { debug: false, ready: false });
    expect(html).toContain('Character (temporary)');
    expect(html).toContain('INT 15 (class 15, shop 0, tree 0, items 0)');
    expect(html).toContain('+1 · 225 XP');
  });
  test('everything is disabled while ready', () => {
    const html = progressPanel(fixtureInfo('Wizard', { xp: 1000 }), { debug: true, ready: true });
    const live = html.match(/<(button|select)\b[^>]*>/g)!.filter((t) => !t.includes('disabled'));
    expect(live).toEqual([]);
    expect(html).toContain('data-node=');
    expect(html).toContain('data-respec');
    expect(html).toContain('data-grant-go');
  });
  test('the worn item is its own selected option, not "(empty)"', () => {
    const html = progressPanel(fixtureInfo('Paladin', { slots: { Ring1: 'RingOfTheMagus' } }), { debug: false, ready: false });
    const sel = html.match(/<select data-equip="Ring1"[^>]*>.*?<\/select>/)![0];
    expect(sel).toContain('<option value="RingOfTheMagus" selected>Ring of the Magus</option>');
    expect(sel).not.toContain('<option value="" selected>');
  });
  test('a stored pick missing from the pool is a selected "(unavailable)" option', () => {
    const info = fixtureInfo('Wizard');
    info.loadout = { ...info.loadout, secondary: { ability: 'Haste', source: { Item: 'Ring1' } } } as CharacterInfo['loadout'];
    const html = progressPanel(info, { debug: false, ready: false });
    const sel = html.match(/<select data-loadout="Secondary"[^>]*>.*?<\/select>/)![0];
    expect(sel).toMatch(/<option value="[^"]*Haste[^"]*" selected>Haste \(Ring1\) \(unavailable\)<\/option>/);
    expect(sel.match(/ selected/g)).toHaveLength(1);
    const card = (ability: string) => ({ pick: { ability, source: 'Own' }, ability: null, error: null, locked: false }) as unknown as PoolCard;
    const ok = progressPanel(fixtureInfo('Wizard', { pool: [card('MagicMissile'), card('Fireball')] }), { debug: false, ready: false });
    expect(ok).not.toContain('(unavailable)');
  });
});
