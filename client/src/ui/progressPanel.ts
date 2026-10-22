// The stopgap "Character (temporary)" panel: the Attribute shop, the skill tree, respec, loadout and
// equipment, in plain markup. Plan 5 replaces it. The helpers are pure; render and bind stay thin.
import { ABILITIES } from '../generated/defs';
import { ATTRS, ITEMS, TREES } from '../generated/progression';
import type { Attr } from '../generated/Attr';
import type { CharacterInfo } from '../generated/CharacterInfo';
import type { ClassId } from '../generated/ClassId';
import type { ClientMsg } from '../generated/ClientMsg';
import type { EquipSlot } from '../generated/EquipSlot';
import type { ItemId } from '../generated/ItemId';
import type { NodeId } from '../generated/NodeId';
import type { Pick } from '../generated/Pick';
import { esc } from './hud';
import { blockReason, fitsSlot, nodeState, poolFor, samePick } from './hub/model';

const EQUIP_SLOTS: EquipSlot[] = ['Melee', 'Ranged', 'OffHand', 'Armor', 'Ring1', 'Ring2', 'Shoes', 'Belt'];
/** The `prices` order, which is the `Attr` order. */
const PRICE_ORDER: Attr[] = ['Str', 'Dex', 'Con', 'Int', 'Wil', 'Cha'];
const itemDef = (id: string) => (ITEMS as Record<string, { name: string; slot: string; classes: readonly string[]; grants: readonly string[]; hero: boolean }>)[id];
const nodesOf = (cls: ClassId) => (TREES as unknown as Record<string, { nodes: Record<string, { cost: number; name: string; text: string }>; start: string }>)[cls];
const owned = (cls: ClassId, info: CharacterInfo): Set<string> => new Set<string>([nodesOf(cls).start, ...info.nodes]);

const pickName = (p: Pick) => `${ABILITIES[p.ability].name}${p.source === 'Own' ? '' : ` (${p.source.Item})`}`;

export function progressPanel(info: CharacterInfo, opts: { debug: boolean; ready: boolean }): string {
  const cls = info.class;
  const off = opts.ready ? ' disabled' : '';
  const tree = nodesOf(cls);

  const attrRows = PRICE_ORDER.map((attr, i) => {
    const l = info.sheet.attrs.find((x) => x.attr === attr)!;
    const price = info.prices[i];
    const dis = opts.ready || info.xp < price ? ' disabled' : '';
    return `<li>${ATTRS[attr].short} ${l.total} (class ${l.class}, shop ${l.shop}, tree ${l.tree}, items ${l.items}) <button data-attr="${attr}"${dis}>+1 · ${price} XP</button></li>`;
  }).join('');

  const have = owned(cls, info);
  const all = Object.keys(tree.nodes) as NodeId[];
  const row = (id: NodeId, extra: string) => {
    const n = tree.nodes[id];
    return `<li><b>${esc(n.name)}</b> ${esc(n.text)} · ${n.cost} XP ${extra}</li>`;
  };
  const buyable = all.filter((id) => nodeState(info, id) === 'buyable').map((id) => row(id, `<button data-node="${id}"${off}>Buy</button>`));
  const blocked = all.filter((id) => nodeState(info, id) === 'blocked').map((id) => row(id, `<small>(${blockReason(info, id)})</small>`));
  const ownedRows = all.filter((id) => have.has(id) && id !== tree.start).map((id) => row(id, '<small>(owned)</small>'));

  const poolSelect = (slot: 'Primary' | 'Secondary', current: Pick) => {
    const pool = poolFor(info, slot).map((c) => c.pick);
    // Ruling 9 keeps a stored pick that left the pool; show it, so changing the other select resends it.
    const gone = pool.some((p) => samePick(p, current)) ? '' : `<option value="${esc(JSON.stringify(current))}" selected>${esc(pickName(current))} (unavailable)</option>`;
    return `<select data-loadout="${slot}"${off}>${gone}${pool
      .map((p) => `<option value="${esc(JSON.stringify(p))}"${samePick(p, current) ? ' selected' : ''}>${esc(pickName(p))}</option>`)
      .join('')}</select>`;
  };

  const equipRows = EQUIP_SLOTS.map((slot, i) => {
    const cur = info.equipment.slots[i];
    const opt = info.inventory
      .filter((id, k) => fitsSlot(id, slot) && info.inventory.indexOf(id) === k && itemDef(id).classes.includes(cls))
      .map((id) => `<option value="${id}"${id === cur ? ' selected' : ''}>${esc(itemDef(id).name)}</option>`)
      .join('');
    const worn = cur ? `<option value="${cur}" selected>${esc(itemDef(cur).name)}</option>` : '';
    return `<li>${slot} <select data-equip="${slot}"${off}><option value=""${cur ? '' : ' selected'}>(empty)</option>${worn}${opt}</select></li>`;
  }).join('');

  const grant = opts.debug
    ? `<p>Grant item <select data-grant${off}>${Object.keys(ITEMS)
        .filter((id) => itemDef(id).hero && itemDef(id).classes.includes(cls))
        .map((id) => `<option value="${id}">${esc(itemDef(id).name)}</option>`)
        .join('')}</select> <button data-grant-go${off}>Grant</button></p>`
    : '';
  const err = info.sheet.loadout_error ? `<p style="color:#e05050">${esc(info.sheet.loadout_error)}</p>` : '';

  return `<div class="panel progress"><h2>Character (temporary) <span class="xp">${info.xp} XP <span class="coins"><i class="coin-icon"></i>${info.coins}</span></span></h2>
    <ul>${attrRows}</ul>
    <h3>Skill tree</h3><ul>${buyable.join('')}${blocked.join('')}${ownedRows.join('')}</ul>
    <p><button data-respec${off}>Respec · ${info.respec_price} coins</button> <small class="hint">Refunds the ${info.xp_spent} XP spent on Attributes and the tree.</small></p>
    <h3>Loadout</h3><p>${poolSelect('Primary', info.loadout.primary)} ${poolSelect('Secondary', info.loadout.secondary)}</p>${err}
    <h3>Equipment</h3><ul>${equipRows}</ul>${grant}
    <small class="hint">Plain stopgap panel; the real character screen comes later.</small></div>`;
}

export function bindProgressPanel(root: HTMLElement, send: (m: ClientMsg) => void): void {
  root.querySelectorAll<HTMLButtonElement>('[data-attr]').forEach((b) => {
    b.onclick = () => send({ t: 'BuyAttribute', attr: b.dataset.attr as Attr });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-node]').forEach((b) => {
    b.onclick = () => {
      if (confirm(`Buy this node? ${b.parentElement?.textContent ?? ''}`)) send({ t: 'BuyNode', node: b.dataset.node as NodeId });
    };
  });
  const respec = root.querySelector<HTMLButtonElement>('[data-respec]');
  if (respec) respec.onclick = () => confirm('Respec? This refunds your XP and removes your tree nodes and shop points.') && send({ t: 'Respec' });
  const loadout = () => {
    const get = (s: string) => JSON.parse(root.querySelector<HTMLSelectElement>(`[data-loadout="${s}"]`)!.value) as Pick;
    send({ t: 'SetLoadout', primary: get('Primary'), secondary: get('Secondary') });
  };
  root.querySelectorAll<HTMLSelectElement>('[data-loadout]').forEach((s) => (s.onchange = loadout));
  root.querySelectorAll<HTMLSelectElement>('[data-equip]').forEach((s) => {
    s.onchange = () => send({ t: 'Equip', slot: s.dataset.equip as EquipSlot, item: s.value === '' ? null : (s.value as ItemId) });
  });
  const go = root.querySelector<HTMLButtonElement>('[data-grant-go]');
  if (go) go.onclick = () => send({ t: 'DebugGrantItem', item: root.querySelector<HTMLSelectElement>('[data-grant]')!.value as ItemId });
}
