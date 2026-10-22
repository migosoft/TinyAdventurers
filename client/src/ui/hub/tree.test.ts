// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import type { Atlas } from '../atlas';
import type { ClientMsg } from '../../generated/ClientMsg';
import type { ClassId } from '../../generated/ClassId';
import type { PoolCard } from '../../generated/PoolCard';
import { TREES } from '../../generated/progression';
import { fixtureInfo } from './fixture';
import { Hub } from './hub';

const ctx = { imageSmoothingEnabled: false, clearRect() {}, drawImage() {} };
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
const atlas = { img: new Image(), frames: new Proxy({}, { get: () => ({ frame: { x: 0, y: 0, w: 16, h: 16 } }) }) } as unknown as Atlas;

let host: HTMLElement;
let sent: ClientMsg[];
let hub: Hub;
beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
  sent = [];
  hub = new Hub(host, atlas, (m) => sent.push(m), () => {}, () => {});
  hub.show();
  vi.unstubAllGlobals();
});
const open = (cls: ClassId, o: Parameters<typeof fixtureInfo>[1] = {}) => {
  hub.open(1);
  hub.setCharacter(fixtureInfo(cls, o));
  host.querySelector<HTMLButtonElement>('[data-tab="tree"]')!.click();
};
const node = (id: string) => host.querySelector<HTMLElement>(`[data-node="${id}"]`)!;
const nova: PoolCard = {
  pick: { ability: 'FrostNova', source: 'Own' },
  ability: { id: 'FrostNova', cooldown: 4, damage: 22, split: { Cold: 1 }, range: 0, arc: 0, speed: 0, radius: 3, duration: 0, pierce: 0, pierce_through: 0, ranged: false, projectile: null, behind: 0 },
  error: null,
  locked: true,
};
const neighbours = () => (TREES.Wizard.nodes.W0.links as readonly string[]).map(node);

test('the start node is owned and its neighbours are buyable with enough XP', () => {
  open('Wizard', { xp: 1000 });
  expect(node('W0').classList.contains('owned')).toBe(true);
  expect(neighbours().length).toBeGreaterThan(0);
  expect(neighbours().every((n) => n.classList.contains('buyable'))).toBe(true);
});
test('with no XP the neighbours are blocked', () => {
  open('Wizard', { xp: 0 });
  expect(neighbours().every((n) => n.classList.contains('blocked'))).toBe(true);
});
test('a confirmed click on a buyable node sends BuyNode, a declined one sends nothing', () => {
  open('Wizard', { xp: 1000 });
  const id = neighbours()[0].dataset.node!;
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  node(id).click();
  expect(sent).toEqual([]);
  expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/^Buy .+ for \d+ XP\?$/));
  confirm.mockReturnValue(true);
  node(id).click();
  expect(sent).toEqual([{ t: 'BuyNode', node: id }]);
});
test('a click on a locked or blocked node does nothing', () => {
  const confirm = vi.fn(() => true);
  vi.stubGlobal('confirm', confirm);
  open('Wizard', { xp: 0 });
  expect(node('WF4').classList.contains('locked')).toBe(true);
  node('WF4').click();
  neighbours()[0].click();
  expect(confirm).not.toHaveBeenCalled();
  expect(sent).toEqual([]);
});
test('hovering the Frost Nova node shows its numbers and requirement, leaving removes the tip', () => {
  open('Wizard', { xp: 1000, pool: [nova], attrs: { Int: { total: 15, items: 0 } } });
  node('WF4').dispatchEvent(new MouseEvent('mouseenter'));
  const tips = document.body.querySelectorAll('.ui-tip');
  expect(tips).toHaveLength(1);
  const t = tips[0];
  expect(t.textContent).toContain('22 cold');
  expect(t.textContent).toContain('Needs INT 17');
  expect(t.textContent).toContain('(you have 15)');
  expect(t.querySelector('li.bad')).not.toBeNull();
  expect(t.textContent).toContain('700 XP');
  node('WF4').dispatchEvent(new MouseEvent('mouseleave'));
  expect(document.body.querySelectorAll('.ui-tip')).toHaveLength(0);
});
test('a tooltip names the node kind in words, not the enum', () => {
  open('Wizard', { xp: 1000 });
  node('WA1').dispatchEvent(new MouseEvent('mouseenter'));
  const small = document.body.querySelector('.ui-tip small')!.textContent;
  expect(small).toBe('Attribute');
  node('WA1').dispatchEvent(new MouseEvent('mouseleave'));
  node('WF4').dispatchEvent(new MouseEvent('mouseenter'));
  expect(document.body.querySelector('.ui-tip small')!.textContent).not.toMatch(/[a-z][A-Z]/);
});
test('the cost is red when the XP is short', () => {
  open('Wizard', { xp: 100 });
  node('WF4').dispatchEvent(new MouseEvent('mouseenter'));
  expect(document.body.querySelector('.ui-tip .cost.bad')).not.toBeNull();
});
test('a new Character message removes an open tooltip', () => {
  open('Wizard', { xp: 1000 });
  node('WF4').dispatchEvent(new MouseEvent('mouseenter'));
  expect(document.body.querySelectorAll('.ui-tip')).toHaveLength(1);
  hub.setCharacter(fixtureInfo('Wizard', { xp: 900 }));
  expect(document.body.querySelectorAll('.ui-tip')).toHaveLength(0);
});
test.each(['Wizard', 'Paladin', 'Barbarian', 'ElvenRanger'] as const)('%s tree renders every node', (cls) => {
  open(cls, { xp: 500 });
  expect(host.querySelectorAll('.ui-node:not(.mini)')).toHaveLength(Object.keys(TREES[cls].nodes).length);
});
