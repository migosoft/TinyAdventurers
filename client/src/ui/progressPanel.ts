// The stopgap "Character (temporary)" panel: the Attribute shop, the skill tree, respec, loadout and
// equipment, in plain markup. Plan 5 replaces it. The helpers are pure; render and bind stay thin.
import { ABILITIES, CLASSES } from '../generated/defs';
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

type AnyNode = { cost: number; kind: string; links: readonly string[]; name: string; req: readonly string[]; text: string; ability?: string; attr?: string };
export type NodeState = 'owned' | 'buyable' | 'blocked' | 'locked';

const EQUIP_SLOTS: EquipSlot[] = ['Melee', 'Ranged', 'OffHand', 'Armor', 'Ring1', 'Ring2', 'Shoes', 'Belt'];
const ATTR_KEYS = Object.keys(ATTRS) as Attr[];
/** The `prices` order, which is the `Attr` order. */
const PRICE_ORDER: Attr[] = ['Str', 'Dex', 'Con', 'Int', 'Wil', 'Cha'];
const itemDef = (id: string) => (ITEMS as Record<string, { name: string; slot: string; classes: readonly string[]; grants: readonly string[]; hero: boolean }>)[id];
const nodesOf = (cls: ClassId) => (TREES as unknown as Record<string, { nodes: Record<string, AnyNode>; start: string }>)[cls];

function owned(cls: ClassId, info: CharacterInfo): Set<string> {
  return new Set<string>([nodesOf(cls).start, ...info.nodes]);
}

/** The first requirement ("INT 18") the sheet does not meet, as text, or null. */
function unmetRequirement(info: CharacterInfo, req: readonly string[]): string | null {
  for (const r of req) {
    const [short, n] = r.split(' ');
    const attr = ATTR_KEYS.find((a) => ATTRS[a].short === short);
    const total = info.sheet.attrs.find((l) => l.attr === attr)?.total ?? 0;
    if (total < Number(n)) return r;
  }
  return null;
}

function blockReason(cls: ClassId, info: CharacterInfo, node: NodeId): string | null {
  const n = nodesOf(cls).nodes[node];
  const req = unmetRequirement(info, n.req);
  if (req) return `needs ${req}`;
  if (info.xp < n.cost) return 'not enough XP';
  return null;
}

export function nodeState(cls: ClassId, info: CharacterInfo, node: NodeId): NodeState {
  const tree = nodesOf(cls);
  const have = owned(cls, info);
  if (have.has(node)) return 'owned';
  // Links are undirected: a neighbour is anything the node links to or that links to it.
  const near = tree.nodes[node].links.some((l) => have.has(l)) || [...have].some((o) => tree.nodes[o]?.links.includes(node));
  if (!near) return 'locked';
  return blockReason(cls, info, node) ? 'blocked' : 'buyable';
}

/** What can fill a loadout slot: the start ability, owned Unlock nodes, and worn items that grant one. */
export function loadoutPool(cls: ClassId, info: CharacterInfo, slot: 'Primary' | 'Secondary'): Pick[] {
  const abilities = ABILITIES as Record<string, { slot: string }>;
  const pool: Pick[] = [];
  const tree = nodesOf(cls);
  const own = (a: string) => {
    if (abilities[a]?.slot === slot && !pool.some((p) => p.ability === a && p.source === 'Own')) pool.push({ ability: a as Pick['ability'], source: 'Own' });
  };
  own(slot === 'Primary' ? CLASSES[cls].primary : CLASSES[cls].secondary);
  for (const id of info.nodes) {
    const n = tree.nodes[id];
    if (n?.kind === 'Unlock' && n.ability) own(n.ability);
  }
  EQUIP_SLOTS.forEach((es, i) => {
    const item = info.equipment.slots[i];
    if (!item) return;
    for (const g of itemDef(item)?.grants ?? []) {
      if (abilities[g]?.slot === slot) pool.push({ ability: g as Pick['ability'], source: { Item: es } });
    }
  });
  return pool;
}

const pickName = (p: Pick) => `${ABILITIES[p.ability].name}${p.source === 'Own' ? '' : ` (${p.source.Item})`}`;
const sameSource = (a: Pick, b: Pick) => a.ability === b.ability && JSON.stringify(a.source) === JSON.stringify(b.source);

function fitsSlot(id: string, slot: EquipSlot): boolean {
  const s = itemDef(id)?.slot;
  return s === slot || (s === 'Ring' && (slot === 'Ring1' || slot === 'Ring2'));
}

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
  const buyable = all.filter((id) => nodeState(cls, info, id) === 'buyable').map((id) => row(id, `<button data-node="${id}"${off}>Buy</button>`));
  const blocked = all.filter((id) => nodeState(cls, info, id) === 'blocked').map((id) => row(id, `<small>(${blockReason(cls, info, id)})</small>`));
  const ownedRows = all.filter((id) => have.has(id) && id !== tree.start).map((id) => row(id, '<small>(owned)</small>'));

  const poolSelect = (slot: 'Primary' | 'Secondary', current: Pick) =>
    `<select data-loadout="${slot}"${off}>${loadoutPool(cls, info, slot)
      .map((p) => `<option value="${esc(JSON.stringify(p))}"${sameSource(p, current) ? ' selected' : ''}>${esc(pickName(p))}</option>`)
      .join('')}</select>`;

  const equipRows = EQUIP_SLOTS.map((slot, i) => {
    const cur = info.equipment.slots[i];
    const opt = info.inventory
      .filter((id, k) => fitsSlot(id, slot) && info.inventory.indexOf(id) === k && itemDef(id).classes.includes(cls))
      .map((id) => `<option value="${id}"${id === cur ? ' selected' : ''}>${esc(itemDef(id).name)}</option>`)
      .join('');
    return `<li>${slot} <select data-equip="${slot}"${off}><option value=""${cur ? '' : ' selected'}>(empty)</option>${opt}</select></li>`;
  }).join('');

  const grant = opts.debug
    ? `<p>Grant item <select data-grant>${Object.keys(ITEMS)
        .filter((id) => itemDef(id).hero && itemDef(id).classes.includes(cls))
        .map((id) => `<option value="${id}">${esc(itemDef(id).name)}</option>`)
        .join('')}</select> <button data-grant-go>Grant</button></p>`
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
