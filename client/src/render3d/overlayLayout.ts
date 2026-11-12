// The overlay's layout (#311): what is drawn over the 3D canvas and where, as plain items in canvas device px. No DOM. The rules
// are the 2D view's (`drawBarsAndBeams`, the hero name tag and its `TagEffects`, the key cap); each item hangs from a figure's
// anchor (render3d/figures.ts) projected to the canvas, offset upward by 2D's art-px amounts times `zoom`.
import { EFFECT, FLAG } from '../generated/defs';
import { isPlayerKind } from '../game/anim/defs';
import { barOf } from '../game/barName';
import { has } from '../game/effectBits';
import { SOUND_TEXT } from '../game/effects';
import type { UseHint } from '../game/useHint';
import { CHARM_COLOR, FLOAT, popScale, WORLD_TEXT, Z_EVERY, Z_LIFE, Z_RISE, type WorldTextKind } from '../game/worldText';
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

/** A floating number or word, kept at its ground spot (tiles) and rising in screen space; the twin of `Effects.text`. */
interface Float { x: number; z: number; dx: number; up: number; rise: number; vy: number; age: number; life: number; max: number; pop: boolean; text: string; color: string; stroke: string; kind: WorldTextKind }

export class Floats {
  private readonly list: Float[] = [];

  /** `rand`: 0..1, for the sideways spread (injected so tests are exact). */
  constructor(private readonly rand: () => number = Math.random) {}

  /** `x`, `y`: simulation px. `opts.up`: art px above the spot to start (coins 14, IMMUNE 18, the mimic's "!" 18). */
  add(x: number, y: number, text: string, color: string, opts: { big?: boolean; kind?: WorldTextKind; up?: number; stroke?: string } = {}): void {
    const { big = false, kind = 'number', up = 0, stroke = '#000000' } = opts;
    const life = big ? FLOAT.critLife : FLOAT.life;
    this.list.push({
      x: x / TILE, z: y / TILE, dx: Math.round(this.rand() * FLOAT.spread - FLOAT.spread / 2), up, rise: 0, vy: big ? FLOAT.critVy : FLOAT.vy,
      age: 0, life, max: life, pop: big, text, color, stroke, kind: big ? 'crit' : kind,
    });
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.list.splice(i, 1);
        continue;
      }
      f.age += dt;
      f.rise += f.vy * dt;
      f.vy *= FLOAT.drag;
    }
  }

  layout(at: LayoutIn['at'], zoom: number, out: OverlayItem[]): void {
    for (const f of this.list) {
      const p = at(f.x, f.z);
      out.push({
        t: 'text', x: Math.round(p.px + f.dx * zoom), y: Math.round(p.py + (f.rise - f.up) * zoom), text: f.text, kind: f.kind, color: f.color, stroke: f.stroke,
        alpha: Math.min(1, (f.life / f.max) * 2), scale: f.pop ? popScale(f.age) : 1, align: 'center', base: 'bottom',
      });
    }
  }
}

/** A sleeper's rising Z: born at the figure's spot (tiles), 3 art px right of the foot at the head. */
interface Zed { x: number; z: number; head: number; age: number }
/** What the marks need from a figure's anchor, by id. */
interface MarkState { x: number; z: number; head: number; cx: number; alpha: number; fear: boolean; charm: boolean; zT: number; zs: Zed[] }

/** Sleep Z, fear "!" and charm heart over figures, from the anchors' effect bits: the twin of the marks in `StatusFx`. */
export class Marks {
  private clock = 0;
  private readonly states = new Map<number, MarkState>();

  update(dt: number, anchors: ReadonlyMap<number, FigureAnchor>): void {
    this.clock += dt;
    for (const [id, a] of anchors) {
      let s = this.states.get(id);
      const sleep = has(a.effects, EFFECT.Sleep);
      if (!s) {
        if (!(sleep || has(a.effects, EFFECT.Fear) || has(a.effects, EFFECT.Charmed))) continue;
        this.states.set(id, (s = { x: a.x, z: a.z, head: a.head, cx: a.cx, alpha: a.alpha, fear: false, charm: false, zT: 0, zs: [] }));
      }
      s.x = a.x; s.z = a.z; s.head = a.head; s.cx = a.cx; s.alpha = a.alpha;
      s.fear = has(a.effects, EFFECT.Fear);
      s.charm = has(a.effects, EFFECT.Charmed);
      if (sleep) {
        s.zT -= dt;
        if (s.zT <= 0) {
          s.zT = Z_EVERY;
          s.zs.push({ x: a.x, z: a.z, head: a.head, age: 0 });
        }
      } else s.zT = 0;
      for (let i = s.zs.length - 1; i >= 0; i--) {
        s.zs[i].age += dt;
        if (s.zs[i].age >= Z_LIFE) s.zs.splice(i, 1);
      }
      if (!sleep && !s.fear && !s.charm && s.zs.length === 0) this.states.delete(id);
    }
    for (const id of this.states.keys()) if (!anchors.has(id)) this.states.delete(id);
  }

  layout(at: LayoutIn['at'], zoom: number, out: OverlayItem[]): void {
    const mark = (text: string, color: string, p: { px: number; py: number }, dx: number, up: number, alpha: number): void => {
      out.push({ t: 'text', x: Math.round(p.px + dx * zoom), y: Math.round(p.py - up * zoom), text, kind: 'mark', color, stroke: SOUND_TEXT.stroke, alpha, scale: 1, align: 'center', base: 'bottom' });
    };
    for (const s of this.states.values()) {
      for (const z of s.zs) {
        const k = z.age / Z_LIFE;
        mark('Z', SOUND_TEXT.fill, at(z.x, z.z), 3 + Math.sin(z.age * 5) * 1.5, z.head + k * Z_RISE, (1 - k) * s.alpha);
      }
      const foot = at(s.x, s.z);
      if (s.fear) mark('!', SOUND_TEXT.fill, foot, s.cx, s.head + 3 + Math.abs(Math.sin(this.clock * 9)) * 1.5, s.alpha);
      if (s.charm) mark('♥', CHARM_COLOR, foot, s.cx + (s.fear ? 7 : 0), s.head + 3 + Math.abs(Math.sin(this.clock * 9 + 1)) * 1.5, s.alpha);
    }
  }
}
