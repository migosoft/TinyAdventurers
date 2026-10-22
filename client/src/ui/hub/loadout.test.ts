// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';
import type { Atlas } from '../atlas';
import type { CharacterInfo } from '../../generated/CharacterInfo';
import type { ClientMsg } from '../../generated/ClientMsg';
import type { Pick } from '../../generated/Pick';
import type { PoolCard } from '../../generated/PoolCard';
import { fixtureInfo, type FixtureOptions } from './fixture';
import { renderLoadout } from './loadout';
import { clearTips } from './tip';

const atlas = {} as unknown as Atlas;
let sent: ClientMsg[];
let el: HTMLElement;
beforeEach(() => {
  sent = [];
  clearTips();
});
const draw = (info: CharacterInfo) => {
  el = renderLoadout({ info, atlas, send: (m) => sent.push(m), debug: false });
  document.body.replaceChildren(el);
  return el;
};
const wiz = (o: FixtureOptions = {}) => fixtureInfo('Wizard', o);
const own = (ability: Pick['ability']): Pick => ({ ability, source: 'Own' });
const card = (pick: Pick, o: Partial<PoolCard> = {}): PoolCard => ({ pick, ability: null, error: null, locked: false, ...o });
const cols = () => [...el.querySelectorAll<HTMLElement>('.ui-pick')];
const btn = (col: number, ability: string) => cols()[col].querySelector<HTMLElement>(`[data-pick*='"ability":"${ability}"']`)!;
const pool = [
  card(own('MagicMissile')),
  card(own('Fireball')),
  card(own('FrostShard'), { error: 'Frost Shard needs INT 14.' }),
  card(own('FrostNova'), { locked: true }),
];

test('primary column: Magic Missile selected, Frost Shard invalid; secondary: Frost Nova locked', () => {
  draw(wiz({ pool }));
  expect(cols().length).toBe(2);
  expect(cols()[0].textContent).toContain('Primary ability');
  expect(cols()[1].textContent).toContain('Secondary ability');
  expect(btn(0, 'MagicMissile').classList.contains('selected')).toBe(true);
  expect(btn(0, 'FrostShard').classList.contains('invalid')).toBe(true);
  expect(btn(0, 'FrostShard').textContent).toContain('Frost Shard needs INT 14.');
  expect(btn(1, 'FrostNova').classList.contains('locked')).toBe(true);
  expect(btn(1, 'FrostNova').textContent).toContain('Unlock it in the skill tree');
  expect(btn(1, 'FrostNova').classList.contains('invalid')).toBe(false);
});
test('clicking Frost Shard sends it with the saved secondary; a locked card sends nothing', () => {
  draw(wiz({ pool }));
  btn(0, 'FrostShard').click();
  btn(1, 'FrostNova').click();
  expect(sent).toEqual([{ t: 'SetLoadout', primary: own('FrostShard'), secondary: own('Fireball') }]);
});
test('the warning explains an Attribute error', () => {
  draw(wiz({ pool, loadout_error: 'Frost Shard needs INT 14.' }));
  const w = el.querySelector('.ui-warn')!;
  expect(w.textContent).toContain('Loadout invalid: Frost Shard needs INT 14.');
  expect(w.textContent).toContain('Buy INT on the Sheet');
  expect(w.textContent).toContain('You cannot be Ready until it is fixed.');
});
test('the warning points at the Equipment tab for weapon errors, and is absent without an error', () => {
  draw(wiz({ pool, loadout_error: 'Strike needs a melee weapon.' }));
  expect(el.querySelector('.ui-warn')!.textContent).toContain('Change the weapon on the Equipment tab.');
  draw(wiz({ pool }));
  expect(el.querySelector('.ui-warn')).toBeNull();
});
test('an item version reads "Magic Missile (Ring of the Magus)"', () => {
  const item: Pick = { ability: 'MagicMissile', source: { Item: 'Ring1' } };
  draw(wiz({ pool: [card(own('MagicMissile')), card(item), card(own('Fireball'))], slots: { Ring1: 'RingOfTheMagus' } }));
  expect(el.textContent).toContain('Magic Missile (Ring of the Magus)');
});
test('a saved pick missing from the pool shows first, selected, invalid and "(unavailable)"', () => {
  draw(wiz({ pool: [card(own('Fireball')), card(own('FrostShard'))] }));
  const first = cols()[0].querySelector<HTMLElement>('.ui-abcard')!;
  expect(first.classList.contains('selected') && first.classList.contains('invalid')).toBe(true);
  expect(first.textContent).toContain('(unavailable)');
  first.click();
  expect(sent).toEqual([{ t: 'SetLoadout', primary: own('MagicMissile'), secondary: own('Fireball') }]);
});
