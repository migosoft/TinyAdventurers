// The Equipment tab: the paper doll with eight slots, the inventory grid, tooltips, equip by click and by drag.
import { ATTRS, ITEMS } from '../../generated/progression';
import type { EquipSlot } from '../../generated/EquipSlot';
import type { ItemId } from '../../generated/ItemId';
import { classFigure, figureWeapon } from '../classes';
import { esc } from '../hud';
import { itemIcon } from '../icons';
import { EQUIP_SLOTS, itemProblem, requirementStatus, slotForItem } from './model';
import { clearTips, showTip } from './tip';
import type { TabCtx } from './hub';

type ItemDef = { name: string; kind: string; prof: string | null; base: string; props: { text: string; magical: boolean }[]; req: string[]; slot: string; hero: boolean; classes: string[] };
const defs = ITEMS as unknown as Record<string, ItemDef>;
const SLOT_LABEL: Record<EquipSlot, string> = { Melee: 'Melee', Ranged: 'Ranged', OffHand: 'Off hand', Armor: 'Armor', Ring1: 'Ring', Ring2: 'Ring', Shoes: 'Shoes', Belt: 'Belt' };
const MIN_CELLS = 20;
const ROW = 5;
const isWeapon = (d: ItemDef) => d.slot === 'Melee' || d.slot === 'Ranged';

const el = (tag: string, cls: string, html = ''): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  return e;
};

function tipHtml(ctx: TabCtx, id: ItemId): string {
  const { info } = ctx;
  const d = defs[id];
  const problem = itemProblem(info, id);
  const kind = problem ? `${esc(d.kind)} · <span class="bad">${esc(problem)}</span>` : `${esc(d.kind)}${d.prof ? ' · proficient' : ''}`;
  const props = d.props.map((p) => `<li class="prop">${esc(p.text)} <span class="${p.magical ? 'mag' : 'non'}">${p.magical ? 'magical' : 'non-magical'}</span></li>`);
  const reqs = requirementStatus(info, d.req, false).map((r) => `<li class="${r.ok ? 'ok' : 'bad'}">Needs ${esc(r.text)} <span>(you have ${r.have})</span></li>`);
  const note = isWeapon(d) && d.props.length ? '<p class="muted">Weapon effects ride only on attacks that use the weapon.</p>' : '';
  return `<b>${esc(d.name)}</b><small>${kind}</small>${d.base ? `<p>${esc(d.base)}</p>` : ''}<ul>${props.join('')}${reqs.join('')}</ul>${note}`;
}

/** "From items: +1 CON · …": the AttrLine item points, then the props of each worn non-weapon item (its Attribute grants are already in the points). */
function itemsLine(ctx: TabCtx): string {
  const { info } = ctx;
  const isAttr = (t: string) => /^[+−-]\d+ ([A-Z]{3})$/.test(t) && Object.values(ATTRS).some((a) => t.endsWith(` ${a.short}`));
  const parts = info.sheet.attrs.filter((l) => l.items !== 0).map((l) => `${l.items > 0 ? '+' : '−'}${Math.abs(l.items)} ${ATTRS[l.attr].short}`);
  for (const id of info.equipment.slots) {
    const d = id ? defs[id] : null;
    if (d && !isWeapon(d)) parts.push(...d.props.map((p) => p.text).filter((t) => !isAttr(t)));
  }
  return parts.join(' · ');
}

export function renderEquipment(ctx: TabCtx): HTMLElement {
  const { info, atlas, send } = ctx;
  const root = el('div', 'ui-split ui-equip');

  const doll = el('div', 'panel ui-doll', '<h2>Equipped <span class="muted">· fixed for the whole run</span></h2>');
  const grid = el('div', 'ui-dollgrid');
  const fig = el('div', 'ui-figure');
  fig.append(classFigure(atlas, info.class, 6, figureWeapon(info)));
  grid.append(fig);
  EQUIP_SLOTS.forEach((slot, i) => {
    const id = info.equipment.slots[i];
    const reserved = slot === 'OffHand';
    const s = el('div', `ui-slot s-${slot.toLowerCase()}${reserved ? ' reserved' : ''}`);
    s.dataset.slot = slot;
    const box = el('div', 'box');
    if (id) box.append(itemIcon(atlas, id, 40));
    else box.innerHTML = reserved ? '<small>shields<br>later</small>' : '<small>empty</small>';
    s.append(box, el('span', '', SLOT_LABEL[slot]));
    if (id) {
      s.draggable = true;
      s.ondragstart = (e) => e.dataTransfer?.setData('text/plain', `slot:${slot}`);
      s.onclick = () => send({ t: 'Equip', slot, item: null });
      s.onmouseenter = () => showTip(s, tipHtml(ctx, id), 'right');
      s.onmouseleave = () => clearTips();
    }
    if (!reserved) {
      s.ondragover = (e) => {
        e.preventDefault();
        box.classList.add('hover');
      };
      s.ondragleave = () => box.classList.remove('hover');
      s.ondrop = (e) => {
        e.preventDefault();
        box.classList.remove('hover');
        const data = e.dataTransfer?.getData('text/plain') ?? '';
        if (data.startsWith('item:')) send({ t: 'Equip', slot, item: data.slice(5) as ItemId });
      };
    }
    grid.append(s);
  });
  doll.append(grid);
  const line = itemsLine(ctx);
  if (line) doll.append(el('p', 'ui-small', `From items: ${esc(line)}`));

  const bag = el('div', 'panel ui-bag', '<h2>Inventory</h2>');
  const cellsEl = el('div', 'ui-baggrid');
  const total = Math.max(MIN_CELLS, Math.ceil(info.inventory.length / ROW) * ROW);
  for (let i = 0; i < total; i++) {
    const cell = el('div', 'ui-cell');
    const id = info.inventory[i];
    if (id) {
      cell.dataset.item = id;
      cell.dataset.index = String(i);
      cell.classList.toggle('bad', !!itemProblem(info, id));
      cell.append(itemIcon(atlas, id, 36));
      cell.draggable = true;
      cell.ondragstart = (e) => e.dataTransfer?.setData('text/plain', `item:${id}`);
      cell.onclick = () => {
        const slot = slotForItem(info, id);
        if (slot) send({ t: 'Equip', slot, item: id });
      };
      cell.onmouseenter = () => showTip(cell, tipHtml(ctx, id), 'below');
      cell.onmouseleave = () => clearTips();
    }
    cellsEl.append(cell);
  }
  bag.append(cellsEl, el('p', 'ui-small', '<span class="bad">Red</span>: not proficient, or a requirement is not met. You can still try it; the server tells you why not.'));
  bag.ondragover = (e) => e.preventDefault();
  bag.ondrop = (e) => {
    e.preventDefault();
    const data = e.dataTransfer?.getData('text/plain') ?? '';
    if (data.startsWith('slot:')) send({ t: 'Equip', slot: data.slice(5) as EquipSlot, item: null });
  };

  if (ctx.debug) {
    const ids = Object.entries(defs).filter(([, d]) => d.hero && d.classes.includes(info.class)).map(([id, d]) => `<option value="${id}">${esc(d.name)}</option>`);
    const row = el('div', 'ui-grant', `<select data-grant>${ids.join('')}</select><button data-grant-go>Grant</button>`);
    row.querySelector<HTMLButtonElement>('[data-grant-go]')!.onclick = () => send({ t: 'DebugGrantItem', item: row.querySelector<HTMLSelectElement>('[data-grant]')!.value as ItemId });
    bag.append(row);
  }
  root.append(doll, bag);
  return root;
}
