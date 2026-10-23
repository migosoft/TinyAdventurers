// A CharacterInfo for tests, built from the class start values.
import { CLASSES } from '../../generated/defs';
import type { Attr } from '../../generated/Attr';
import type { CharacterInfo } from '../../generated/CharacterInfo';
import type { ClassId } from '../../generated/ClassId';
import type { EquipSlot } from '../../generated/EquipSlot';
import type { ItemId } from '../../generated/ItemId';
import type { NodeId } from '../../generated/NodeId';
import type { PoolCard } from '../../generated/PoolCard';
import { EQUIP_SLOTS } from './model';

export const ATTR_ORDER: Attr[] = ['Str', 'Dex', 'Con', 'Int', 'Wil', 'Cha'];
/** Every proficiency except Heavy armor, unless a test says otherwise. */
const DEFAULT_PROFS = ['Axe', 'Bow', 'Club', 'Cloth armor', 'Dagger', 'Hammer', 'Light armor', 'Medium armor', 'Staff', 'Sword'];

export interface FixtureOptions {
  id?: number;
  name?: string;
  xp?: number;
  coins?: number;
  respec_price?: number;
  xp_spent?: number;
  prices?: number[];
  nodes?: string[];
  slots?: Partial<Record<EquipSlot, ItemId>>;
  inventory?: ItemId[];
  pool?: PoolCard[];
  profs?: string[];
  attrs?: Partial<Record<Attr, { total: number; items: number }>>;
  loadout_error?: string | null;
}

export function fixtureInfo(cls: ClassId, o: FixtureOptions = {}): CharacterInfo {
  const start = CLASSES[cls];
  const slots = EQUIP_SLOTS.map((s) => o.slots?.[s] ?? null);
  return {
    id: o.id ?? 1,
    name: o.name ?? 'Test',
    class: cls,
    xp: o.xp ?? 0,
    total_xp: o.xp ?? 0,
    coins: o.coins ?? 0,
    bought: [0, 0, 0, 0, 0, 0],
    nodes: (o.nodes ?? []) as NodeId[],
    equipment: { slots },
    inventory: o.inventory ?? [], // worn items leave the inventory (Ruling 10)
    loadout: { primary: { ability: start.primary, source: 'Own' }, secondary: { ability: start.secondary, source: 'Own' } },
    xp_spent: o.xp_spent ?? 0,
    respec_price: o.respec_price ?? 20,
    prices: o.prices ?? [225, 225, 225, 225, 225, 225],
    sheet: {
      attrs: ATTR_ORDER.map((attr) => {
        const a = o.attrs?.[attr];
        const cl = start.attrs[attr];
        return { attr, total: a?.total ?? cl, class: cl, shop: 0, items: a?.items ?? 0 };
      }),
      hp: 10, speed: 70, weight: 0, push: 10, save_con: 0, save_wil: 0, res: [], effect_res: [],
      profs: o.profs ?? DEFAULT_PROFS, keystones: [], loadout_error: o.loadout_error ?? null, pool: o.pool ?? [],
    },
  } as unknown as CharacterInfo;
}
