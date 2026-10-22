import { describe, expect, test } from 'vitest';
import { CLASSES } from '../generated/defs';
import type { Attr } from '../generated/Attr';
import type { CharacterInfo } from '../generated/CharacterInfo';
import type { ClassId } from '../generated/ClassId';
import type { ItemId } from '../generated/ItemId';
import type { NodeId } from '../generated/NodeId';
import { loadoutPool, nodeState, progressPanel } from './progressPanel';

const ATTR_ORDER: Attr[] = ['Str', 'Dex', 'Con', 'Int', 'Wil', 'Cha'];

function fixtureInfo(cls: ClassId, o: { xp?: number; nodes?: string[]; ring1?: string } = {}): CharacterInfo {
  const start = CLASSES[cls];
  const slots: (ItemId | null)[] = [null, null, null, null, (o.ring1 ?? null) as ItemId | null, null, null, null];
  return {
    id: 1,
    name: 'Test',
    class: cls,
    xp: o.xp ?? 0,
    total_xp: o.xp ?? 0,
    coins: 0,
    bought: [0, 0, 0, 0, 0, 0],
    nodes: (o.nodes ?? []) as NodeId[],
    equipment: { slots },
    inventory: [] as ItemId[], // worn items leave the inventory (Ruling 10)
    loadout: { primary: { ability: start.primary, source: 'Own' }, secondary: { ability: start.secondary, source: 'Own' } },
    xp_spent: 0,
    respec_price: 20,
    prices: [225, 225, 225, 225, 225, 225],
    sheet: {
      attrs: ATTR_ORDER.map((attr) => ({ attr, total: start.attrs[attr], class: start.attrs[attr], shop: 0, tree: 0, items: 0 })),
      hp: 10, speed: 70, weight: 0, push: 10, save_con: 0, save_wil: 0, res: [], effect_res: [], profs: [], keystones: [], loadout_error: null,
    },
  } as unknown as CharacterInfo;
}

test('the start node is owned, its neighbours buyable with XP', () => {
  const info = fixtureInfo('Wizard', { xp: 1000 });
  expect(nodeState('Wizard', info, 'W0')).toBe('owned');
  expect(nodeState('Wizard', info, 'WA1')).toBe('buyable');
  expect(nodeState('Wizard', info, 'WA2')).toBe('locked');
});
test('a requirement or XP shortfall blocks', () => {
  const info = fixtureInfo('Wizard', { xp: 50, nodes: ['WA1', 'WA2'] });
  expect(nodeState('Wizard', info, 'WA3')).toBe('blocked'); // INT 18, and XP
});
test('the pool holds the start, unlocks and item versions', () => {
  const info = fixtureInfo('Paladin', { nodes: ['PL1'], ring1: 'RingOfTheMagus' });
  const prim = loadoutPool('Paladin', info, 'Primary');
  expect(prim).toContainEqual({ ability: 'Strike', source: 'Own' });
  expect(prim).toContainEqual({ ability: 'MagicMissile', source: { Item: 'Ring1' } });
  expect(loadoutPool('Paladin', info, 'Secondary')).toContainEqual({ ability: 'Purify', source: 'Own' });
});
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
    const html = progressPanel(fixtureInfo('Paladin', { ring1: 'RingOfTheMagus' }), { debug: false, ready: false });
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
    const ok = progressPanel(fixtureInfo('Wizard'), { debug: false, ready: false });
    expect(ok).not.toContain('(unavailable)');
  });
});
