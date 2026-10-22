// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import type { Atlas } from '../atlas';
import type { ClientMsg } from '../../generated/ClientMsg';
import { fixtureInfo } from './fixture';
import { Hub } from './hub';

const ctx = { imageSmoothingEnabled: false, clearRect() {}, drawImage() {} };
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
// Every frame exists (the figures and weapons), each 16 x 16.
const atlas = { img: new Image(), frames: new Proxy({}, { get: () => ({ frame: { x: 0, y: 0, w: 16, h: 16 } }) }) } as unknown as Atlas;

let host: HTMLElement;
let sent: ClientMsg[];
let hub: Hub;
beforeEach(() => {
  host = document.createElement('div');
  sent = [];
  hub = new Hub(host, atlas, (m) => sent.push(m), () => {}, () => {});
  hub.show();
});
const $ = <T extends HTMLElement>(sel: string) => host.querySelector<T>(sel);
const attrButtons = () => [...host.querySelectorAll<HTMLButtonElement>('[data-attr]')];

test('a Character message for another id is ignored while the hub waits for its own', () => {
  hub.open(1);
  hub.setCharacter(fixtureInfo('Wizard', { id: 2 }));
  expect(host.textContent).toContain('Loading…');
  expect($('.ui-bar')!.textContent).not.toContain('Test');
  hub.setCharacter(fixtureInfo('Wizard', { id: 1, name: 'Merlin' }));
  expect(host.textContent).not.toContain('Loading…');
  expect($('.ui-bar')!.textContent).toContain('Merlin');
});
test('opening another character shows Loading again and drops a late message for the first', () => {
  hub.open(1);
  hub.setCharacter(fixtureInfo('Wizard', { id: 1, name: 'Merlin' }));
  hub.open(3);
  hub.setCharacter(fixtureInfo('Wizard', { id: 1, name: 'Merlin' }));
  expect(host.textContent).toContain('Loading…');
  expect($('.ui-bar')!.textContent).not.toContain('Merlin');
});
test('XP and coins are in the bar', () => {
  hub.open(1);
  hub.setCharacter(fixtureInfo('Wizard', { xp: 300, coins: 42 }));
  expect($('.ui-purse')!.textContent).toContain('300 XP');
  expect($('.ui-purse')!.textContent).toContain('42');
});
test('with enough XP all six Attributes can be bought, and a click sends BuyAttribute', () => {
  hub.open(1);
  hub.setCharacter(fixtureInfo('Wizard', { xp: 300 }));
  expect(attrButtons()).toHaveLength(6);
  expect(attrButtons().every((b) => !b.disabled)).toBe(true);
  host.querySelector<HTMLButtonElement>('[data-attr="Dex"]')!.click();
  expect(sent).toEqual([{ t: 'BuyAttribute', attr: 'Dex' }]);
});
test('with too little XP every buy button is disabled', () => {
  hub.open(1);
  hub.setCharacter(fixtureInfo('Wizard', { xp: 100 }));
  expect(attrButtons().every((b) => b.disabled)).toBe(true);
});
test('the Respec button is disabled without the coins, and without anything spent', () => {
  hub.open(1);
  hub.setCharacter(fixtureInfo('Wizard', { coins: 10, respec_price: 20, xp_spent: 100 }));
  expect($<HTMLButtonElement>('#respec')!.disabled).toBe(true);
  hub.setCharacter(fixtureInfo('Wizard', { coins: 30, respec_price: 20, xp_spent: 0 }));
  expect($<HTMLButtonElement>('#respec')!.disabled).toBe(true);
  hub.setCharacter(fixtureInfo('Wizard', { coins: 30, respec_price: 20, xp_spent: 100 }));
  expect($<HTMLButtonElement>('#respec')!.disabled).toBe(false);
  expect($('#respec')!.textContent).toContain('Respec for');
});
test('Respec asks first and then sends Respec', () => {
  hub.open(1);
  hub.setCharacter(fixtureInfo('Wizard', { coins: 30, respec_price: 20, xp_spent: 100 }));
  const confirm = vi.spyOn(window, 'confirm');
  confirm.mockReturnValueOnce(false);
  $('#respec')!.click();
  expect(sent).toEqual([]);
  confirm.mockReturnValueOnce(true);
  $('#respec')!.click();
  expect(sent).toEqual([{ t: 'Respec' }]);
  confirm.mockRestore();
});
test('an error writes the line and keeps the body element and its content', () => {
  hub.open(1);
  hub.setCharacter(fixtureInfo('Wizard', { xp: 300 }));
  const body = $('.ui-body');
  const first = body!.firstElementChild;
  hub.error('Not enough XP.');
  expect($('.error')!.textContent).toBe('Not enough XP.');
  expect($('.ui-body')).toBe(body);
  expect(body!.firstElementChild).toBe(first);
});
test('an error before the character arrived is shown too', () => {
  hub.open(1);
  hub.error('Connection lost.');
  expect($('.error')!.textContent).toBe('Connection lost.');
});
test('a switched tab stays after a new Character message', () => {
  hub.open(1);
  hub.setCharacter(fixtureInfo('Wizard'));
  $('[data-tab="tree"]')!.click();
  expect(hub.tab).toBe('tree');
  hub.setCharacter(fixtureInfo('Wizard', { xp: 50 }));
  expect(hub.tab).toBe('tree');
  expect($('[data-tab="tree"]')!.classList.contains('on')).toBe(true);
  expect(host.querySelector('[data-attr]')).toBeNull();
});
test('opening a character starts on the Sheet tab', () => {
  hub.open(1);
  hub.setCharacter(fixtureInfo('Wizard'));
  $('[data-tab="tree"]')!.click();
  hub.open(2);
  expect(hub.tab).toBe('sheet');
});
test('the Attribute row shows what the Attribute does', () => {
  hub.open(1);
  hub.setCharacter(fixtureInfo('Paladin'));
  const row = host.querySelector('[data-attr="Str"]')!.closest('li')!;
  expect(row.textContent).toContain('+25 %');
});
test('the bar buttons call back', () => {
  const calls: string[] = [];
  const own = document.createElement('div');
  const h = new Hub(own, atlas, () => {}, () => calls.push('roster'), () => calls.push('dungeon'));
  h.open(1);
  h.setCharacter(fixtureInfo('Wizard'));
  own.querySelector<HTMLButtonElement>('#to-roster')!.click();
  own.querySelector<HTMLButtonElement>('#to-dungeon')!.click();
  expect(calls).toEqual(['roster', 'dungeon']);
});
