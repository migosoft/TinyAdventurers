// Icons for the character screens: item sprites (or letters) and the placeholder ability icons.
import { ABILITIES } from '../generated/defs';
import { ABILITY_INFO, ITEMS } from '../generated/progression';
import type { AbilityId } from '../generated/AbilityId';
import type { ItemId } from '../generated/ItemId';
import type { Atlas } from './atlas';
import { monogram } from './hub/model';

/** The item's atlas frame at the largest integer scale that fits `box`, else its first two letters in a box. */
export function itemIcon(atlas: Atlas, item: ItemId, box: number): HTMLElement {
  const def = (ITEMS as unknown as Record<string, { name: string; sprite: string }>)[item];
  const f = def.sprite ? atlas.frames[def.sprite]?.frame : undefined;
  if (!f) {
    const s = document.createElement('span');
    s.className = 'ui-letter';
    s.style.setProperty('--box', `${box}px`);
    s.textContent = def.name.slice(0, 2).toUpperCase();
    return s;
  }
  const scale = Math.max(1, Math.floor(box / Math.max(f.w, f.h)));
  const c = document.createElement('canvas');
  c.width = f.w * scale;
  c.height = f.h * scale;
  c.className = 'ui-frame';
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(atlas.img, f.x, f.y, f.w, f.h, 0, 0, c.width, c.height);
  }
  return c;
}

/** The placeholder ability icon: two letters on the main damage colour. */
export function abilityIcon(id: AbilityId, big = false): string {
  const name = ABILITIES[id].name;
  const tint = (ABILITY_INFO[id].tint ?? 'none').toLowerCase();
  return `<span class="ui-ab t-${tint}${big ? ' big' : ''}" title="${name}">${monogram(name)}</span>`;
}
