// Class figures and the class card, shared by the character screen and the lobby.
import { ABILITIES, CLASSES as CLASS_DEFS } from '../generated/defs';
import { ABILITY_INFO, ITEMS } from '../generated/progression';
import type { CharacterInfo } from '../generated/CharacterInfo';
import type { ClassId } from '../generated/ClassId';
import { spritePreview, type Atlas } from './atlas';
import { CLASS_TEXT } from './text';

const START = (c: ClassId) => [CLASS_DEFS[c].primary, CLASS_DEFS[c].secondary] as const;

export const CLASSES: ClassId[] = ['Wizard', 'Paladin', 'Barbarian', 'ElvenRanger'];

/** Pack figure and weapon of each class. */
export const FIG: Record<ClassId, [string, string]> = {
  Wizard: ['wizzard_m', 'weapon_red_magic_staff'],
  Paladin: ['knight_m', 'weapon_knight_sword'],
  Barbarian: ['dwarf_m', 'weapon_double_axe'],
  ElvenRanger: ['elf_m', 'weapon_bow'],
};

export function classFigure(atlas: Atlas, c: ClassId, scale = 4, weapon?: string): HTMLCanvasElement {
  return spritePreview(atlas, FIG[c][0], scale, weapon ?? FIG[c][1]);
}

/** The sprite the figure holds (Ruling 8): a Ranger the ranged item, others the melee item (only the melee slot
 * falls back to the class starter when empty); the class's own sprite when the item has none. */
export function figureWeapon(info: CharacterInfo): string {
  const sprite = (id: string | null | undefined) => (id ? (ITEMS as unknown as Record<string, { sprite: string }>)[id]?.sprite : '') || '';
  const start = CLASS_DEFS[info.class].starter;
  const melee = info.equipment.slots[0] ?? start.melee;
  const ranged = info.equipment.slots[1];
  const s = info.class === 'ElvenRanger' ? sprite(ranged) || sprite(melee) : sprite(melee);
  return s || FIG[info.class][1];
}

/** A card with figure, blurb and both abilities. */
export function classCard(atlas: Atlas, c: ClassId, selected: boolean): HTMLButtonElement {
  const t = CLASS_TEXT[c];
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `class-card c-${c.toLowerCase()}${selected ? ' selected' : ''}`;
  card.append(classFigure(atlas, c));
  const info = document.createElement('div');
  info.innerHTML = `<b>${t.title}</b><small>${t.blurb}</small>
    ${START(c)
      .map((id, i) => `<p><kbd>${i ? 'RMB' : 'LMB'}</kbd> ${ABILITIES[id].name}<br><span>${ABILITY_INFO[id].text}</span></p>`)
      .join('')}`;
  card.append(info);
  return card;
}
