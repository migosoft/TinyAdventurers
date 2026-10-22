// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import type { Atlas } from '../atlas';
import type { ClientMsg } from '../../generated/ClientMsg';
import type { CharacterInfo } from '../../generated/CharacterInfo';
import { ITEMS } from '../../generated/progression';
import { renderEquipment } from './equipment';
import { fixtureInfo, type FixtureOptions } from './fixture';
import { clearTips } from './tip';

const ctx2d = { imageSmoothingEnabled: false, clearRect() {}, drawImage() {} };
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx2d as unknown as CanvasRenderingContext2D);
const atlas = { img: new Image(), frames: new Proxy({}, { get: () => ({ frame: { x: 0, y: 0, w: 16, h: 16 } }) }) } as unknown as Atlas;

let sent: ClientMsg[];
let el: HTMLElement;
beforeEach(() => {
  sent = [];
  clearTips();
});
const draw = (info: CharacterInfo, debug = false) => {
  el = renderEquipment({ info, atlas, send: (m) => sent.push(m), debug });
  document.body.replaceChildren(el);
  return el;
};
const wiz = (o: FixtureOptions = {}) => fixtureInfo('Wizard', o);
const $ = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
const cells = () => [...el.querySelectorAll<HTMLElement>('.ui-cell')];
const drop = (target: HTMLElement, data: string) => {
  const e = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { getData: () => data } });
  target.dispatchEvent(e);
};

test('three items show in 20 cells; the BoneStaff is red; a band goes to Ring1', () => {
  draw(wiz({ inventory: ['BandOfVigor', 'BandOfVigor', 'BoneStaff'] }));
  expect(el.querySelectorAll('[data-item]').length).toBe(3);
  expect(cells().length).toBe(20);
  expect($('[data-item="BoneStaff"]').classList.contains('bad')).toBe(true);
  $('[data-item="BandOfVigor"]').click();
  expect(sent).toEqual([{ t: 'Equip', slot: 'Ring1', item: 'BandOfVigor' }]);
});
test('with Ring1 filled a band goes to Ring2', () => {
  draw(wiz({ slots: { Ring1: 'BandOfVigor' }, inventory: ['BandOfVigor'] }));
  $('[data-item="BandOfVigor"]').click();
  expect(sent).toEqual([{ t: 'Equip', slot: 'Ring2', item: 'BandOfVigor' }]);
});
test('23 items make 25 cells and the 23rd is clickable', () => {
  draw(wiz({ inventory: Array(22).fill('BoneStaff').concat('BandOfVigor') }));
  expect(cells().length).toBe(25);
  expect(el.querySelectorAll('[data-item]').length).toBe(23);
  $('[data-index="22"]').click();
  expect(sent).toEqual([{ t: 'Equip', slot: 'Ring1', item: 'BandOfVigor' }]);
});
test('clicking a worn weapon takes it off; an empty slot does nothing', () => {
  draw(wiz({ slots: { Melee: 'RedStaff' } }));
  $('[data-slot="Melee"]').click();
  $('[data-slot="Armor"]').click();
  expect(sent).toEqual([{ t: 'Equip', slot: 'Melee', item: null }]);
});
test('the eight slots are there and OffHand is reserved', () => {
  draw(wiz());
  expect(el.querySelectorAll('.ui-slot[data-slot]').length).toBe(8);
  expect($('[data-slot="OffHand"]').classList.contains('reserved')).toBe(true);
  expect($('[data-slot="OffHand"]').textContent).toContain('shields');
});
test('dropping an item on a slot equips it there; a slot on a slot does nothing; a slot on the inventory takes it off', () => {
  draw(wiz({ slots: { Ring1: 'BandOfVigor' } }));
  drop($('[data-slot="Ring2"]'), 'item:RingOfEmbers');
  expect(sent).toEqual([{ t: 'Equip', slot: 'Ring2', item: 'RingOfEmbers' }]);
  sent.length = 0;
  drop($('[data-slot="Ring2"]'), 'slot:Ring1');
  expect(sent).toEqual([]);
  drop($('.ui-bag'), 'slot:Ring1');
  expect(sent).toEqual([{ t: 'Equip', slot: 'Ring1', item: null }]);
});
test('cells and filled slots are draggable and set text/plain', () => {
  draw(wiz({ slots: { Melee: 'RedStaff' }, inventory: ['BandOfVigor'] }));
  const set = vi.fn();
  for (const [sel, want] of [['[data-item]', 'item:BandOfVigor'], ['[data-slot="Melee"]', 'slot:Melee']] as const) {
    const n = $(sel);
    expect(n.draggable).toBe(true);
    const e = new Event('dragstart', { bubbles: true });
    Object.defineProperty(e, 'dataTransfer', { value: { setData: set } });
    n.dispatchEvent(e);
    expect(set).toHaveBeenLastCalledWith('text/plain', want);
  }
  expect($('[data-slot="Armor"]').draggable).toBe(false);
});
test('Grant shows only with debug and sends DebugGrantItem', () => {
  draw(wiz());
  expect(el.querySelector('[data-grant]')).toBeNull();
  draw(wiz(), true);
  const sel = $<HTMLSelectElement>('[data-grant]');
  expect([...sel.options].some((o) => o.value === 'StaffOfRot')).toBe(true);
  sel.value = 'StaffOfRot';
  $('[data-grant-go]').click();
  expect(sent).toEqual([{ t: 'DebugGrantItem', item: 'StaffOfRot' }]);
});
test('the tooltip of the Staff of Rot shows its prop as non-magical', () => {
  draw(wiz({ inventory: ['StaffOfRot'] }));
  $('[data-item]').dispatchEvent(new Event('mouseenter'));
  const tip = document.querySelector('.ui-tip')!;
  expect(tip.textContent).toContain('+50 % poison share');
  expect(tip.textContent).toContain('non-magical');
  expect(tip.textContent).toContain('Weapon effects ride only on attacks that use the weapon.');
  expect(tip.textContent).toContain('you have');
  $('[data-item]').dispatchEvent(new Event('mouseleave'));
  expect(document.querySelector('.ui-tip')).toBeNull();
});
test('the items line lists item Attribute points and worn non-weapon props', () => {
  draw(wiz({ slots: { Ring1: 'BandOfVigor' }, attrs: { Con: { total: 11, items: 1 } } }));
  expect(el.textContent).toContain('From items: +1 CON');
  expect(el.querySelector('.ui-small')!.textContent).toBe('From items: +1 CON');
  draw(wiz());
  expect(el.textContent).not.toContain('From items');
});
test('two worn Bands read +2 CON once; two Rings of Embers list their text twice', () => {
  draw(wiz({ slots: { Ring1: 'BandOfVigor', Ring2: 'BandOfVigor' }, attrs: { Con: { total: 12, items: 2 } } }));
  expect($('.ui-small').textContent).toBe('From items: +2 CON');
  draw(wiz({ slots: { Ring1: 'RingOfEmbers', Ring2: 'RingOfEmbers' } }));
  expect($('.ui-small').textContent!.match(/\+15 % heat resistance/g)!.length).toBe(2);
});
test('hovering a worn slot shows its tooltip', () => {
  draw(wiz({ slots: { Melee: 'StaffOfRot' } }));
  $('[data-slot="Melee"]').dispatchEvent(new Event('mouseenter'));
  expect(document.querySelector('.ui-tip')!.textContent).toContain('Staff of Rot');
});
test('clicking a cell whose item has no slot sends nothing', () => {
  const d = (ITEMS as unknown as Record<string, { slot: string }>).BoneStaff;
  const was = d.slot;
  d.slot = 'OffHand';
  try {
    draw(wiz({ inventory: ['BoneStaff'] }));
    $('[data-item]').click();
  } finally {
    d.slot = was;
  }
  expect(sent).toEqual([]);
});
