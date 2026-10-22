// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import type { Me } from '../generated/Me';
import { api } from '../api';
import type { Atlas } from './atlas';
import { Create } from './create';
import { fixtureInfo } from './hub/fixture';
import { Roster } from './roster';

const ctx = { imageSmoothingEnabled: false, clearRect() {}, drawImage() {} };
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
const atlas = { img: new Image(), frames: new Proxy({}, { get: () => ({ frame: { x: 0, y: 0, w: 16, h: 16 } }) }) } as unknown as Atlas;

const me = (n: number, max = 8): Me => ({
  name: 'michael',
  max_characters: max,
  characters: Array.from({ length: n }, (_, i) => fixtureInfo('Wizard', { id: i + 1, name: `Merlin${i}`, xp: 40, coins: 7 })),
});

test('a card opens its character; Delete is a separate button outside the card', async () => {
  const host = document.createElement('div');
  const opened: number[] = [];
  const roster = new Roster(host, atlas, (c) => opened.push(c.id), () => {});
  await roster.show(me(2));
  const card = host.querySelector<HTMLButtonElement>('[data-open="Merlin1"]')!;
  expect(card.textContent).toContain('40 XP');
  card.click();
  expect(opened).toEqual([2]);
  const del = host.querySelector('[data-delete="Merlin1"]')!;
  expect(del.className).toBe('danger');
  expect(card.contains(del)).toBe(false);
});
test('the new-character card shows the free slots, and is gone when the roster is full', async () => {
  const host = document.createElement('div');
  let made = 0;
  const roster = new Roster(host, atlas, () => {}, () => made++);
  await roster.show(me(3, 8));
  expect(host.querySelector('#new-char')!.textContent).toContain('5 slots left');
  host.querySelector<HTMLButtonElement>('#new-char')!.click();
  expect(made).toBe(1);
  await roster.show(me(8, 8));
  expect(host.querySelector('#new-char')).toBeNull();
});
test('the create screen shows start values and creates the chosen class', async () => {
  const host = document.createElement('div');
  const created: string[] = [];
  const spy = vi.spyOn(api, 'createCharacter').mockResolvedValue(fixtureInfo('Paladin', { name: 'Sir' }));
  const create = new Create(host, atlas, (c) => created.push(c.name), () => {});
  create.show();
  expect(host.querySelectorAll('.ui-class')).toHaveLength(4);
  const paladin = host.querySelector<HTMLElement>('.ui-class.c-paladin')!;
  expect(paladin.querySelectorAll('kbd')).toHaveLength(2);
  expect(paladin.querySelector('.ui-attrs .hi')!.textContent).toContain('15');
  paladin.click();
  expect(host.querySelector('#char-create')!.textContent).toBe('Create Paladin');
  host.querySelector<HTMLInputElement>('#char-name')!.value = ' Sir ';
  host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(created).toEqual(['Sir']));
  expect(spy).toHaveBeenCalledWith('Sir', 'Paladin');
});
