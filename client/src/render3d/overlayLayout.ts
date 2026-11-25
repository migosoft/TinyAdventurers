// The overlay's layout (#311): what is drawn over the 3D canvas and where, as plain items in canvas device px. No DOM. The rules
// are those of the HP bars and beams, the hero name tag and its effect symbols, and the key cap; each item hangs from a figure's
// anchor (render3d/figures.ts) projected to the canvas, offset upward by its art-px amount times `zoom`.
import { EFFECT, FLAG } from '../generated/defs';
import { isPlayerKind } from '../game/anim/defs';
import { barOf } from '../game/barName';
import { BODY_RISE, floatOf, onOwnHero } from '../game/damage';
import type { PictureEv } from '../run/view';
import { has } from '../game/effectBits';
import { SOUND_TEXT } from '../game/fxLooks';
import type { UseHint } from '../game/useHint';
import { CHARM_COLOR, FLOAT, popScale, WORLD_TEXT, Z_EVERY, Z_LIFE, Z_RISE, type WorldTextKind } from '../game/worldText';
import type { EntState } from '../game/world';
import { EFFECT_ICON } from '../ui/effectIcons';
import type { FigureAnchor } from './figures';

const TILE = 16;
/** The effect ids that have a symbol, once. */
const ICON_IDS = Object.keys(EFFECT_ICON).map(Number);
/** A bar sits this high above the figure's drawn height. */
const BAR_GAP = 3;
const LABEL_GAP = 2;
/** A rules-log tag sits this high above the figure's drawn height. */
const TAG_RISE = 7;
/** The use hint: the cap 26 art px above the target's foot, 11 x 11 art px, its label 2 px right of the cap. */
const CAP_RISE = 26;
export const CAP_SIZE = 11;
const CAP_LABEL_GAP = 2;
/** The effect symbols next to a hero's name: 5.5 art px, 2 px from the tag, 1 px apart. */
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
  | { t: 'poly'; pts: [number, number][] }
  | { t: 'cap'; x: number; y: number }
  | { t: 'icon'; x: number; y: number; id: number };

export interface LayoutIn {
  ents: ReadonlyMap<number, EntState>;
  you: number;
  anchors: ReadonlyMap<number, FigureAnchor>;
  heroNames: Map<number, string>;
  useHint: UseHint | null;
  /** The ids with nothing over them: the snapshot's dark ones and what the picture hides (no bar, name, tag, hint or mark). */
  dark: ReadonlySet<number>;
  /** A point in tiles on the canvas (device px): `y` the height above the floor in tiles (a foot on the bed of a dip is below 0). */
  at: (x: number, z: number, y: number) => { px: number; py: number };
  /** Canvas px per art px of the world: heights above the floor. */
  zoom: number;
  /** Canvas px per art px of a label: sizes, gaps and rises of the overlay's own things (between limits, see `labelZoom`). */
  label: number;
  /** The width in art px of `text` in style `kind`; optional (a rough estimate when missing). */
  measure?: (text: string, kind: WorldTextKind) => number;
  /** Vision cones [entity id, full angle (rad), radius (px)] and whether to draw them (`RunFrame.cones`, `showCones`, #341). */
  cones?: readonly (readonly [number, number, number])[];
  showCones?: boolean;
}

/** Points on a cone's arc (the whole cone is the centre plus these; a full circle has no centre). */
const CONE_ARC = 12;

/** Each creature's vision cone as a polygon: its interpolated position and `CONE_ARC` points at `aim + head ± cone/2`. */
export function layoutCones(i: LayoutIn, out: OverlayItem[]): void {
  if (!i.showCones || !i.cones) return;
  for (const [id, cone, radius] of i.cones) {
    const e = i.ents.get(id);
    if (!e) continue;
    const full = cone >= Math.PI * 2 - 1e-6;
    const mid = e.aim + (e.head ?? 0);
    const c = i.at(e.x / TILE, e.y / TILE, 0);
    const pts: [number, number][] = full ? [] : [[c.px, c.py]];
    for (let k = 0; k < CONE_ARC; k++) {
      const a = mid - cone / 2 + (cone * k) / (full ? CONE_ARC : CONE_ARC - 1);
      const p = i.at((e.x + Math.cos(a) * radius) / TILE, (e.y + Math.sin(a) * radius) / TILE, 0);
      pts.push([p.px, p.py]);
    }
    out.push({ t: 'poly', pts });
  }
}

/** A foot point as whole canvas px, at the foot's height `y`. */
function foot(i: LayoutIn, x: number, z: number, y: number): { px: number; py: number } {
  const p = i.at(x, z, y);
  return { px: Math.round(p.px), py: Math.round(p.py) };
}

const textWidth = (i: LayoutIn, text: string, kind: WorldTextKind): number =>
  i.measure ? i.measure(text, kind) : text.length * WORLD_TEXT[kind].size * EM_PER_CHAR;

/** HP bars and the names over Neutral and Friendly creatures' bars. */
export function layoutBars(i: LayoutIn, out: OverlayItem[]): void {
  for (const e of i.ents.values()) {
    if (i.dark.has(e.id)) continue;
    const look = barOf(e, i.heroNames);
    if (!look) continue;
    const a = i.anchors.get(e.id);
    if (!a || a.descending) continue;   // a falling or drowning figure has no bar or name
    const f = foot(i, a.x, a.z, a.y);
    const x = Math.round(f.px - (look.w * i.label) / 2);
    const y = Math.round(f.py - (a.height * i.zoom + BAR_GAP * i.label));
    out.push({ t: 'bar', x, y, w: look.w, frac: e.hp, color: FILL[look.fill] });
    if (look.label) {
      out.push({ t: 'text', x: f.px, y: Math.round(y - LABEL_GAP * i.label), text: look.label.text, kind: 'tag', color: look.label.color, stroke: '', alpha: 1, scale: 1, align: 'center', base: 'bottom' });
    }
  }
}

/** The other heroes' name tags (white, black stroke, 3 art px above the head) and their effect symbols to the right. */
export function layoutHeroTags(i: LayoutIn, out: OverlayItem[]): void {
  for (const e of i.ents.values()) {
    if (e.id === i.you || !isPlayerKind(e.kind) || e.flags & FLAG.DEAD || i.dark.has(e.id)) continue;
    const name = i.heroNames.get(e.id);
    const a = i.anchors.get(e.id);
    if (!name || !a || !a.tagShown) continue;
    const f = foot(i, a.x, a.z, a.y);
    const y = Math.round(f.py - a.tag * i.zoom);
    out.push({ t: 'text', x: f.px, y, text: name, kind: 'tag', color: '#ffffff', stroke: '#000000', alpha: a.alpha, scale: 1, align: 'center', base: 'bottom' });
    // The symbols start ICON_GAP right of the tag's edge, centred on the tag's middle.
    const right = textWidth(i, name, 'tag') / 2 + ICON_GAP;
    const midY = Math.round(y - ((WORLD_TEXT.tag.size * TAG_LINE) / 2) * i.label);
    let n = 0;
    for (const id of ICON_IDS) {
      if (!(a.effects & (1 << id))) continue;
      out.push({ t: 'icon', x: Math.round(f.px + (right + n * (ICON_SIZE + ICON_STEP)) * i.label), y: midY, id });
      n++;
    }
  }
}

/** The rules log's tags over creatures (white, black stroke, centred): their bottom is 7 art px above the figure's height. */
export function layoutTags(i: LayoutIn, tagOf: (e: EntState) => string | null, out: OverlayItem[]): void {
  for (const e of i.ents.values()) {
    const a = i.anchors.get(e.id);
    if (!a || i.dark.has(e.id)) continue;
    const text = tagOf(e);
    if (text === null) continue;
    const f = foot(i, a.x, a.z, a.y);
    out.push({ t: 'text', x: f.px, y: Math.round(f.py - (a.height * i.zoom + TAG_RISE * i.label)), text, kind: 'tag', color: '#ffffff', stroke: '#000000', alpha: 1, scale: 1, align: 'center', base: 'bottom' });
  }
}

/** The use hint: the key cap 26 art px above the target's foot and its label to the right. */
export function layoutUseHint(i: LayoutIn, out: OverlayItem[]): void {
  const h = i.useHint;
  if (!h || i.dark.has(h.ent.id)) return;
  const a = i.anchors.get(h.ent.id);
  const f = foot(i, a ? a.x : h.ent.x / TILE, a ? a.z : h.ent.y / TILE, a ? a.y : 0);
  const x = f.px;
  const y = Math.round(f.py - CAP_RISE * i.zoom);
  out.push({ t: 'cap', x, y });
  if (h.label) {
    out.push({
      t: 'text', x: Math.round(x + (CAP_SIZE / 2 + CAP_LABEL_GAP) * i.label), y: Math.round(y - (CAP_SIZE / 2) * i.label), text: h.label, kind: 'tag',
      color: '#ffffff', stroke: '#000000', alpha: 1, scale: 1, align: 'left', base: 'middle',
    });
  }
}

/**
 * Where a hit or heal's float is born. The server places the event on the own hero from the hero's SERVER position `srv` (in the
 * snapshot that carried it); such an event (the proximity test against `srv`) is born at the predicted spot instead, shifted by
 * predicted minus server position (#281). Any other event keeps its spot.
 */
export function floatSpot(ev: { x: number; y: number; p: boolean }, pred: { x: number; y: number }, srv: { x: number; y: number } | null): { x: number; y: number } {
  if (!srv || !onOwnHero(ev, srv)) return { x: ev.x, y: ev.y };
  return { x: ev.x + pred.x - srv.x, y: ev.y + pred.y - srv.y };
}

/** A floating number or word, kept at its ground spot (tiles) and rising in screen space. `id`: the figure it follows (a cue, #422). */
interface Float { id?: number; x: number; z: number; dx: number; up: number; rise: number; vy: number; age: number; life: number; max: number; pop: boolean; text: string; color: string; stroke: string; kind: WorldTextKind }

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

  /**
   * The float of a picture event, if it has one. A hit or heal arrives at the body, `BODY_RISE` px above the foot, which is a
   * screen-up offset; here it is the foot, lifted by the same art px on the screen, so it holds at any yaw. `own`: the
   * predicted hero, `server`: the hero's server position (see `floatSpot`). `dark`: the event is in the dark, so it has no float.
   */
  addPicture(ev: PictureEv, own: { x: number; y: number }, server: { x: number; y: number } | null, dark = false): void {
    if (dark) return; // in the dark: nothing is drawn over it
    const w = floatOf(ev);
    if (!w) return;
    if (ev.t === 'Dmg' || ev.t === 'Heal') {
      const at = floatSpot(ev, own, server);
      this.add(at.x, at.y + BODY_RISE, w.text, w.color, { ...w.opts, up: (w.opts.up ?? 0) + BODY_RISE });
    } else if (ev.t === 'Immune' || ev.t === 'Coins') this.add(ev.x, ev.y, w.text, w.color, w.opts);
    else if (ev.t === 'Cue') {
      this.add(ev.x, ev.y, w.text, w.color, w.opts);
      this.list[this.list.length - 1].id = ev.id;
    }
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

  /**
   * `zoom`: the world's (the start height above the spot); `label`: the label's (the sideways spread and the rise). A float with
   * an `id` moves with that figure's anchor while it has one, and stays where it was last seen when the figure is gone.
   */
  layout(at: LayoutIn['at'], zoom: number, label: number, out: OverlayItem[], anchors?: ReadonlyMap<number, { x: number; z: number }>): void {
    for (const f of this.list) {
      const a = f.id === undefined ? undefined : anchors?.get(f.id);
      if (a) {
        f.x = a.x;
        f.z = a.z;
      }
      const p = at(f.x, f.z, 0);
      out.push({
        t: 'text', x: Math.round(p.px + f.dx * label), y: Math.round(p.py + f.rise * label - f.up * zoom), text: f.text, kind: f.kind, color: f.color, stroke: f.stroke,
        alpha: Math.min(1, (f.life / f.max) * 2), scale: f.pop ? popScale(f.age) : 1, align: 'center', base: 'bottom',
      });
    }
  }
}

/** A sleeper's rising Z: born at the figure's spot (tiles), 3 art px right of the foot at the head. */
interface Zed { x: number; z: number; y: number; head: number; age: number }
/** What the marks need from a figure's anchor, by id. */
interface MarkState { x: number; z: number; y: number; head: number; cx: number; alpha: number; fear: boolean; charm: boolean; zT: number; zs: Zed[] }

/** Sleep Z, fear "!" and charm heart over figures, from the anchors' effect bits. */
export class Marks {
  private clock = 0;
  private readonly states = new Map<number, MarkState>();

  update(dt: number, anchors: ReadonlyMap<number, FigureAnchor>, dark: ReadonlySet<number>): void {
    this.clock += dt;
    for (const [id, a] of anchors) {
      if (dark.has(id)) {
        this.states.delete(id);
        continue;
      }
      let s = this.states.get(id);
      const sleep = has(a.effects, EFFECT.Sleep);
      if (!s) {
        if (!(sleep || has(a.effects, EFFECT.Fear) || has(a.effects, EFFECT.Charmed))) continue;
        this.states.set(id, (s = { x: a.x, z: a.z, y: a.y, head: a.head, cx: a.cx, alpha: a.alpha, fear: false, charm: false, zT: 0, zs: [] }));
      }
      s.x = a.x; s.z = a.z; s.y = a.y; s.head = a.head; s.cx = a.cx; s.alpha = a.alpha;
      s.fear = has(a.effects, EFFECT.Fear);
      s.charm = has(a.effects, EFFECT.Charmed);
      if (sleep) {
        s.zT -= dt;
        if (s.zT <= 0) {
          s.zT = Z_EVERY;
          s.zs.push({ x: a.x, z: a.z, y: a.y, head: a.head, age: 0 });
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

  /** `zoom`: the world's (the head height and the figure's `cx`); `label`: the label's (the Z's drift and rise, the "!" bounce). */
  layout(at: LayoutIn['at'], zoom: number, label: number, out: OverlayItem[]): void {
    // `dxWorld` and `dxLabel`: sideways art px by each zoom; `upWorld` and `upLabel`: upward art px by each zoom.
    const mark = (text: string, color: string, p: { px: number; py: number }, dxWorld: number, dxLabel: number, upWorld: number, upLabel: number, alpha: number): void => {
      out.push({
        t: 'text', x: Math.round(p.px + dxWorld * zoom + dxLabel * label), y: Math.round(p.py - (upWorld * zoom + upLabel * label)), text, kind: 'mark', color,
        stroke: SOUND_TEXT.stroke, alpha, scale: 1, align: 'center', base: 'bottom',
      });
    };
    for (const s of this.states.values()) {
      for (const z of s.zs) {
        const k = z.age / Z_LIFE;
        mark('Z', SOUND_TEXT.fill, at(z.x, z.z, z.y), 0, 3 + Math.sin(z.age * 5) * 1.5, z.head, k * Z_RISE, (1 - k) * s.alpha);
      }
      const foot = at(s.x, s.z, s.y);
      if (s.fear) mark('!', SOUND_TEXT.fill, foot, s.cx, 0, s.head, 3 + Math.abs(Math.sin(this.clock * 9)) * 1.5, s.alpha);
      if (s.charm) mark('♥', CHARM_COLOR, foot, s.cx, s.fear ? 7 : 0, s.head, 3 + Math.abs(Math.sin(this.clock * 9 + 1)) * 1.5, s.alpha);
    }
  }
}
