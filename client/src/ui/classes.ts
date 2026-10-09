// Class figures and the class card, shared by the character screen and the lobby.
import type { ClassId } from '../generated/ClassId';
import { spritePreview, type Atlas } from './atlas';
import { CLASS_TEXT } from './text';

export const CLASSES: ClassId[] = ['Wizard', 'Paladin', 'Barbarian', 'Assassin'];

/** Pack figure and weapon of each class. */
export const FIG: Record<ClassId, [string, string]> = {
  Wizard: ['wizzard_m', 'weapon_red_magic_staff'],
  Paladin: ['knight_m', 'weapon_knight_sword'],
  Barbarian: ['dwarf_m', 'weapon_double_axe'],
  Assassin: ['elf_m', 'weapon_bow'],
};

export function classFigure(atlas: Atlas, c: ClassId, scale = 4): HTMLCanvasElement {
  return spritePreview(atlas, FIG[c][0], scale, FIG[c][1]);
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
    <p><kbd>LMB</kbd> ${t.abilities[0].name}<br><span>${t.abilities[0].text}</span></p>
    <p><kbd>RMB</kbd> ${t.abilities[1].name}<br><span>${t.abilities[1].text}</span></p>`;
  card.append(info);
  return card;
}
