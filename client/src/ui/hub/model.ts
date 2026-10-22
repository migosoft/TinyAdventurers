// Pure helpers for the character screens: tree node state, requirements, equipment slots, ability numbers.
import { ABILITIES } from '../../generated/defs';
import { ATTRS, ITEMS, TREES } from '../../generated/progression';
import type { Attr } from '../../generated/Attr';
import type { CharacterInfo } from '../../generated/CharacterInfo';
import type { EquipSlot } from '../../generated/EquipSlot';
import type { ItemId } from '../../generated/ItemId';
import type { NodeId } from '../../generated/NodeId';
import type { Pick } from '../../generated/Pick';
import type { PoolCard } from '../../generated/PoolCard';
import type { ResolvedAbility } from '../../generated/ResolvedAbility';

type AnyNode = { cost: number; kind: string; links: readonly string[]; name: string; req: readonly string[]; text: string; ability?: string; attr?: string };
type ItemDef = { name: string; slot: string; classes: readonly string[]; prof: string | null; req: readonly string[] };
export type NodeState = 'owned' | 'buyable' | 'blocked' | 'locked';

export const EQUIP_SLOTS: EquipSlot[] = ['Melee', 'Ranged', 'OffHand', 'Armor', 'Ring1', 'Ring2', 'Shoes', 'Belt'];
const ATTR_KEYS = Object.keys(ATTRS) as Attr[];
const itemDef = (id: string) => (ITEMS as unknown as Record<string, ItemDef>)[id];
const nodesOf = (info: CharacterInfo) => (TREES as unknown as Record<string, { nodes: Record<string, AnyNode>; start: string }>)[info.class];

const owned = (info: CharacterInfo): Set<string> => new Set<string>([nodesOf(info).start, ...info.nodes]);
const attrOf = (info: CharacterInfo, a: Attr) => info.sheet.attrs.find((l) => l.attr === a);

/** The Attribute requirements ("INT 18") the sheet does not meet; other requirement texts are skipped. */
export function unmetRequirements(info: CharacterInfo, req: readonly string[], withItems: boolean): { text: string; have: number }[] {
  const out: { text: string; have: number }[] = [];
  for (const r of req) {
    const m = /^([A-Z]{3}) (\d+)$/.exec(r);
    const attr = m && ATTR_KEYS.find((a) => ATTRS[a].short === m[1]);
    if (!m || !attr) continue;
    const l = attrOf(info, attr);
    const have = l ? (withItems ? l.total : l.total - l.items) : 0;
    if (have < Number(m[2])) out.push({ text: r, have });
  }
  return out;
}

export function blockReason(info: CharacterInfo, node: NodeId): string | null {
  const n = nodesOf(info).nodes[node];
  const req = unmetRequirements(info, n.req, true)[0];
  if (req) return `needs ${req.text}`;
  if (info.xp < n.cost) return 'not enough XP';
  return null;
}

export function nodeState(info: CharacterInfo, node: NodeId): NodeState {
  const tree = nodesOf(info);
  const have = owned(info);
  if (have.has(node)) return 'owned';
  // Links are undirected: a neighbour is anything the node links to or that links to it.
  const near = tree.nodes[node].links.some((l) => have.has(l)) || [...have].some((o) => tree.nodes[o]?.links.includes(node));
  if (!near) return 'locked';
  return blockReason(info, node) ? 'blocked' : 'buyable';
}

/** The loadout pool cards of one slot, in the server's order. */
export function poolFor(info: CharacterInfo, slot: 'Primary' | 'Secondary'): PoolCard[] {
  return info.sheet.pool.filter((c) => ABILITIES[c.pick.ability].slot === slot);
}

export const samePick = (a: Pick, b: Pick): boolean => a.ability === b.ability && JSON.stringify(a.source) === JSON.stringify(b.source);

export function pickLabel(p: Pick, info: CharacterInfo): string {
  const name = ABILITIES[p.ability].name;
  if (p.source === 'Own') return name;
  const item = info.equipment.slots[EQUIP_SLOTS.indexOf(p.source.Item)];
  return item ? `${name} (${itemDef(item).name})` : name;
}

export function fitsSlot(item: ItemId, slot: EquipSlot): boolean {
  const s = itemDef(item)?.slot;
  return s === slot || (s === 'Ring' && (slot === 'Ring1' || slot === 'Ring2'));
}

/** The slot a click equips an item into: a ring takes the first empty ring slot, else Ring1. */
export function slotForItem(info: CharacterInfo, item: ItemId): EquipSlot | null {
  const s = itemDef(item)?.slot;
  if (s === 'Ring') {
    const empty = (['Ring1', 'Ring2'] as const).find((r) => !info.equipment.slots[EQUIP_SLOTS.indexOf(r)]);
    return empty ?? 'Ring1';
  }
  return EQUIP_SLOTS.includes(s as EquipSlot) && s !== 'OffHand' ? (s as EquipSlot) : null;
}

/** The first reason this hero cannot use the item, or null. */
export function itemProblem(info: CharacterInfo, item: ItemId): string | null {
  const d = itemDef(item);
  if (!d.classes.includes(info.class)) return 'Your class cannot use it.';
  if (d.prof && !info.sheet.profs.includes(d.prof)) return `Not trained in ${d.prof}.`;
  const miss = unmetRequirements(info, d.req, false)[0];
  return miss ? `Needs ${miss.text} (you have ${miss.have}).` : null;
}

const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)} %`;
const sign = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)}`;

export function attrEffect(attr: Attr, v: number): string {
  const d = v - 10;
  switch (attr) {
    case 'Str':
      return `melee/thrown dmg ${pct(5 * d)} · push power ${v}`;
    case 'Dex':
      return `finesse/ranged dmg ${pct(5 * d)} · arc ${pct(3 * d)} · speed ${pct(2 * d)}`;
    case 'Con':
      return `HP ${sign(5 * d)} · move speed ${pct(d)} · non-magical save ${v}`;
    case 'Int':
      return `spell dmg and power ${pct(5 * d)}`;
    case 'Wil':
      return `magical save ${v}`;
    case 'Cha':
      return `innate dmg, heals, power ${pct(5 * d)}`;
  }
}

/** The numbers line of an ability card. `uses` is accepted for callers; the numbers do not depend on it. */
export function abilityNumbers(r: ResolvedAbility, _uses: string): string {
  const out: string[] = [];
  if (r.damage > 0) {
    const shares = Object.entries(r.split).sort((a, b) => b[1] - a[1]);
    if (r.id === 'HolyLight') out.push(`heal ${r.damage}`);
    else if (shares.length === 1) out.push(`${r.damage} ${shares[0][0].toLowerCase()}`);
    else if (shares.length > 1) out.push(`${r.damage}: ${shares.map(([k, s]) => `${Math.round(s * 100)} % ${k.toLowerCase()}`).join(', ')}`);
    else out.push(`${r.damage}`);
  }
  if (r.cooldown > 0) out.push(`cd ${r.cooldown} s`);
  if (r.ranged) out.push(`range ${r.range}`);
  if (r.radius > 0) out.push(`radius ${r.radius}`);
  if (r.duration > 0) out.push(`${r.duration} s`);
  if (r.pierce_through > 0) out.push(`pierces ${r.pierce_through}`);
  return out.join(' · ');
}

/** Two letters for the placeholder ability icon: the initials of two words, else the first two letters. */
export function monogram(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}
