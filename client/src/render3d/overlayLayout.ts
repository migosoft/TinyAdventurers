// The overlay's layout (#311): what is drawn over the 3D canvas and where, as plain items in canvas device px. No DOM. The rules
// are the 2D view's (`drawBarsAndBeams`, the hero name tag and its `TagEffects`, the key cap); each item hangs from a figure's
// anchor (render3d/figures.ts) projected to the canvas, offset upward by 2D's art-px amounts times `zoom`.
import { FLAG } from '../generated/defs';
import { isPlayerKind } from '../game/anim/defs';
import { barOf } from '../game/barName';
import type { UseHint } from '../game/useHint';
import { WORLD_TEXT, type WorldTextKind } from '../game/worldText';
import type { EntState } from '../game/world';
import { EFFECT_ICON } from '../ui/effectIcons';
import type { FigureAnchor } from './figures';

const TILE = 16;
/** Bar widths (art px), the dark frame around the fill and the label's gap above the bar. */
/** A bar sits this high above the figure's drawn height. */
const BAR_GAP = 3;
const LABEL_GAP = 2;
/** The use hint: the cap 26 art px above the target's foot, 11 x 11 art px, its label 2 px right of the cap. */
const CAP_RISE = 26;
export const CAP_SIZE = 11;
const CAP_LABEL_GAP = 2;
/** The effect symbols next to a hero's name: 5.5 art px, 2 px from the tag, 1 px apart (TagEffects). */
export const ICON_SIZE = 5.5;
const ICON_GAP = 2;
const ICON_STEP = 1;
/** Line height of a name tag in em, to find the tag's middle for the symbols. */
const TAG_LINE = 1.2;
/** Estimated text width in em per character when the caller has no measure. */
const EM_PER_CHAR = 0.55;

export const BAR_FRAME = '#140c1a';
export const HERO_FILL = '#40d060';
export const NEUTRAL_FILL = '#8a9ab8';
export const ENEMY_FILL = '#d03030';
const FILL = { hero: HERO_FILL, neutral: NEUTRAL_FILL, enemy: ENEMY_FILL } as const;

export type OverlayItem =
  | { t: 'bar'; x: number; y: number; w: number; frac: number; color: string }
  | { t: 'text'; x: number; y: number; text: string; kind: WorldTextKind; color: string; stroke: string; alpha: number; scale: number; align: 'center' | 'left'; base: 'bottom' | 'middle' }
  | { t: 'cap'; x: number; y: number }
  | { t: 'icon'; x: number; y: number; id: number };

export interface LayoutIn {
  ents: ReadonlyMap<number, EntState>;
  you: number;
  anchors: ReadonlyMap<number, FigureAnchor>;
  heroNames: Map<number, string>;
  useHint: UseHint | null;
  /** A foot point in tiles on the canvas (device px). */
  at: (x: number, z: number) => { px: number; py: number };
  /** Canvas px per art px. */
  zoom: number;
  /** The width in art px of `text` in style `kind`; optional (a rough estimate when missing). */
  measure?: (text: string, kind: WorldTextKind) => number;
}

/** A foot point as whole canvas px. */
function foot(i: LayoutIn, x: number, z: number): { px: number; py: number } {
  const p = i.at(x, z);
  return { px: Math.round(p.px), py: Math.round(p.py) };
}

const textWidth = (i: LayoutIn, text: string, kind: WorldTextKind): number =>
  i.measure ? i.measure(text, kind) : text.length * WORLD_TEXT[kind].size * EM_PER_CHAR;

/** HP bars and the names over Neutral and Friendly creatures' bars: 2D's `drawBarsAndBeams` rules. */
export function layoutBars(i: LayoutIn, out: OverlayItem[]): void {
  for (const e of i.ents.values()) {
    const look = barOf(e, i.heroNames);
    if (!look) continue;
    const a = i.anchors.get(e.id);
    if (!a) continue;
    const f = foot(i, a.x, a.z);
    const x = Math.round(f.px - (look.w * i.zoom) / 2);
    const y = Math.round(f.py - (a.height + BAR_GAP) * i.zoom);
    out.push({ t: 'bar', x, y, w: look.w, frac: e.hp, color: FILL[look.fill] });
    if (look.label) {
      out.push({ t: 'text', x: f.px, y: Math.round(y - LABEL_GAP * i.zoom), text: look.label.text, kind: 'tag', color: look.label.color, stroke: '', alpha: 1, scale: 1, align: 'center', base: 'bottom' });
    }
  }
}

/** The other heroes' name tags (white, black stroke, 3 art px above the head) and their effect symbols to the right. */
export function layoutHeroTags(i: LayoutIn, out: OverlayItem[]): void {
  for (const e of i.ents.values()) {
    if (e.id === i.you || !isPlayerKind(e.kind) || e.flags & FLAG.DEAD) continue;
    const name = i.heroNames.get(e.id);
    const a = i.anchors.get(e.id);
    if (!name || !a || !a.tagShown) continue;
    const f = foot(i, a.x, a.z);
    const y = Math.round(f.py - a.tag * i.zoom);
    out.push({ t: 'text', x: f.px, y, text: name, kind: 'tag', color: '#ffffff', stroke: '#000000', alpha: a.alpha, scale: 1, align: 'center', base: 'bottom' });
    // The symbols start ICON_GAP right of the tag's edge, centred on the tag's middle.
    const right = textWidth(i, name, 'tag') / 2 + ICON_GAP;
    const midY = Math.round(y - ((WORLD_TEXT.tag.size * TAG_LINE) / 2) * i.zoom);
    let n = 0;
    for (const key of Object.keys(EFFECT_ICON)) {
      const id = Number(key);
      if (!(a.effects & (1 << id))) continue;
      out.push({ t: 'icon', x: Math.round(f.px + (right + n * (ICON_SIZE + ICON_STEP)) * i.zoom), y: midY, id });
      n++;
    }
  }
}

/** The use hint: the key cap 26 art px above the target's foot and its label to the right. */
export function layoutUseHint(i: LayoutIn, out: OverlayItem[]): void {
  const h = i.useHint;
  if (!h) return;
  const a = i.anchors.get(h.ent.id);
  const f = foot(i, a ? a.x : h.ent.x / TILE, a ? a.z : h.ent.y / TILE);
  const x = f.px;
  const y = Math.round(f.py - CAP_RISE * i.zoom);
  out.push({ t: 'cap', x, y });
  if (h.label) {
    out.push({
      t: 'text', x: Math.round(x + (CAP_SIZE / 2 + CAP_LABEL_GAP) * i.zoom), y: Math.round(y - (CAP_SIZE / 2) * i.zoom), text: h.label, kind: 'tag',
      color: '#ffffff', stroke: '#000000', alpha: 1, scale: 1, align: 'left', base: 'middle',
    });
  }
}
