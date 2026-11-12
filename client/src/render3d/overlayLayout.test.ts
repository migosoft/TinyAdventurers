import { describe, expect, it } from 'vitest';
import { EFFECT, FLAG, KIND, SIDE } from '../generated/defs';
import type { EntState } from '../game/world';
import type { UseHint } from '../game/useHint';
import type { FigureAnchor } from './figures';
import { layoutBars, layoutHeroTags, layoutUseHint, type LayoutIn, type OverlayItem } from './overlayLayout';

const ZOOM = 3;
const TILE = 16;
/** A fixed linear map: 100 canvas px per tile, offset (7, 11). */
const at = (x: number, z: number) => ({ px: 7 + x * 100, py: 11 + z * 100 });

const ent = (id: number, kind: number, o: Partial<EntState> = {}): EntState => ({ id, kind, x: 5 * TILE, y: 5 * TILE, hp: 0.5, anim: 0, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0, side: SIDE.Hostile, entangled: 0, ...o });
const anchor = (o: Partial<FigureAnchor> = {}): FigureAnchor => ({ x: 5, z: 5, height: 20, tag: 23, head: 18, cx: 0, alpha: 1, tagShown: true, effects: 0, ...o });

function input(ents: EntState[], anchors: [number, FigureAnchor][], o: Partial<LayoutIn> = {}): LayoutIn {
  return { ents: new Map(ents.map((e) => [e.id, e])), you: 1, anchors: new Map(anchors), heroNames: new Map(), useHint: null, at, zoom: ZOOM, ...o };
}
const bars = (i: LayoutIn): OverlayItem[] => {
  const out: OverlayItem[] = [];
  layoutBars(i, out);
  return out;
};
const tags = (i: LayoutIn): OverlayItem[] => {
  const out: OverlayItem[] = [];
  layoutHeroTags(i, out);
  return out;
};
const hint = (i: LayoutIn): OverlayItem[] => {
  const out: OverlayItem[] = [];
  layoutUseHint(i, out);
  return out;
};
type Of<T extends OverlayItem['t']> = Extract<OverlayItem, { t: T }>;
const only = <T extends OverlayItem['t']>(items: OverlayItem[], t: T): Of<T>[] => items.filter((i): i is Of<T> => i.t === t);

describe('layoutBars', () => {
  it('a hurt enemy gets a red 12 px bar 3 px above its height', () => {
    const items = bars(input([ent(7, KIND.SkeletonWarrior)], [[7, anchor()]]));
    const b = only(items, 'bar');
    expect(b).toHaveLength(1);
    const foot = at(5, 5);
    expect(b[0].w).toBe(12);
    expect(b[0].frac).toBe(0.5);
    expect(b[0].color).toBe('#d03030');
    expect(b[0].x).toBe(Math.round(foot.px - (12 * ZOOM) / 2));
    expect(b[0].y).toBe(Math.round(foot.py - (20 + 3) * ZOOM));
  });
  it("the ogre's bar is 28 px wide", () => {
    const b = only(bars(input([ent(7, KIND.Ogre, { hp: 1 })], [[7, anchor()]])), 'bar');
    expect(b).toHaveLength(1);
    expect(b[0].w).toBe(28);
  });
  it('a boss, a chest and a dead creature get no bar', () => {
    const ents = [ent(7, KIND.Dragon), ent(8, KIND.Chest), ent(9, KIND.SkeletonWarrior, { flags: FLAG.DEAD }), ent(10, KIND.Missile), ent(11, KIND.Barrel)];
    const anchors: [number, FigureAnchor][] = ents.map((e) => [e.id, anchor()]);
    expect(bars(input(ents, anchors))).toEqual([]);
  });
  it('a full-health enemy has no bar, an entity without an anchor none either', () => {
    expect(bars(input([ent(7, KIND.SkeletonWarrior, { hp: 1 })], [[7, anchor()]]))).toEqual([]);
    expect(bars(input([ent(7, KIND.SkeletonWarrior)], []))).toEqual([]);
  });
  it('a Friendly knight shows "Knight" in green above its bar', () => {
    const items = bars(input([ent(7, KIND.Knight, { side: SIDE.Friendly, hp: 1 })], [[7, anchor()]]));
    const b = only(items, 'bar')[0];
    const t = only(items, 'text')[0];
    expect(b.color).toBe('#40d060');
    expect(t.text).toBe('Knight');
    expect(t.color).toBe('#7fe08a');
    expect(t.kind).toBe('tag');
    expect(t.align).toBe('center');
    expect(t.base).toBe('bottom');
    expect(t.y).toBe(b.y - 2 * ZOOM);
    expect(t.x).toBe(Math.round(at(5, 5).px));
  });
  it("a neutral creature's bar is grey-blue with a pale label; the wolf names its owner", () => {
    const n = bars(input([ent(7, KIND.Knight, { side: SIDE.Neutral, hp: 1 })], [[7, anchor()]]));
    expect(only(n, 'bar')[0].color).toBe('#8a9ab8');
    expect(only(n, 'text')[0].color).toBe('#b8c4d8');
    const w = bars(input([ent(7, KIND.DireWolf, { side: SIDE.Friendly, hp: 1, extra: 1 })], [[7, anchor()]], { heroNames: new Map([[1, 'Ann']]) }));
    expect(only(w, 'text')[0].text).toBe("Ann's wolf");
  });
  it("the own hero's bar follows its anchor", () => {
    const e = ent(1, KIND.Wizard, { side: SIDE.Friendly });
    const a = bars(input([e], [[1, anchor()]]));
    const b = bars(input([e], [[1, anchor({ x: 5 + 10 / 100, z: 5 + 10 / 100 })]]));
    // the anchor moved by 0.1 tile = 10 canvas px in the test's map
    expect(only(b, 'bar')[0].x - only(a, 'bar')[0].x).toBe(10);
    expect(only(b, 'bar')[0].y - only(a, 'bar')[0].y).toBe(10);
    expect(only(a, 'bar')[0].color).toBe('#40d060');
  });
  it('positions are whole canvas px', () => {
    const odd = (x: number, z: number) => ({ px: 7.37 + x * 99.9, py: 11.61 + z * 99.9 });
    const items = bars(input([ent(7, KIND.Knight, { side: SIDE.Friendly, hp: 0.4 })], [[7, anchor({ height: 19.5 })]], { at: odd, zoom: 2.5 }));
    expect(items.length).toBeGreaterThan(1);
    for (const i of items) {
      expect(Number.isInteger(i.x), JSON.stringify(i)).toBe(true);
      expect(Number.isInteger(i.y), JSON.stringify(i)).toBe(true);
    }
  });
});

describe('layoutHeroTags', () => {
  const names = new Map([[1, 'Me'], [2, 'Bea']]);
  it('other heroes get a name tag, the own hero none', () => {
    const ents = [ent(1, KIND.Wizard, { side: SIDE.Friendly }), ent(2, KIND.Paladin, { side: SIDE.Friendly })];
    const items = tags(input(ents, [[1, anchor()], [2, anchor()]], { heroNames: names }));
    const t = only(items, 'text');
    expect(t).toHaveLength(1);
    expect(t[0].text).toBe('Bea');
    expect(t[0].color).toBe('#ffffff');
    expect(t[0].stroke).toBe('#000000');
    expect(t[0].y).toBe(Math.round(at(5, 5).py - 23 * ZOOM));
  });
  it('shows effect icons to the right of the tag, 5.5 px each, 1 px apart', () => {
    const e = ent(2, KIND.Paladin, { side: SIDE.Friendly });
    const items = tags(input([e], [[2, anchor({ effects: (1 << EFFECT.Burning) | (1 << EFFECT.Sleep) })]], { heroNames: names, measure: () => 20 }));
    const icons = only(items, 'icon');
    expect(icons).toHaveLength(2);
    const px = Math.round(at(5, 5).px);
    expect(icons[0].x).toBe(Math.round(px + (10 + 2) * ZOOM));
    expect(icons[1].x - icons[0].x).toBe(Math.round(6.5 * ZOOM));
    expect(icons[0].y).toBe(icons[1].y);
  });
  it('a falling figure shows no tag and no icons', () => {
    const e = ent(2, KIND.Paladin, { side: SIDE.Friendly });
    expect(tags(input([e], [[2, anchor({ tagShown: false, effects: 1 << EFFECT.Burning })]], { heroNames: names }))).toEqual([]);
  });
});

describe('layoutUseHint', () => {
  it('a Wake hint draws a cap 26 px above the sleeper and a label to its right', () => {
    const sleeper = ent(2, KIND.Paladin, { side: SIDE.Friendly, effects: 1 << EFFECT.Sleep });
    const h: UseHint = { ent: sleeper, label: 'Wake' };
    const items = hint(input([sleeper], [[2, anchor()]], { useHint: h }));
    const cap = only(items, 'cap');
    const lab = only(items, 'text');
    expect(cap).toHaveLength(1);
    const foot = at(5, 5);
    expect(cap[0].x).toBe(Math.round(foot.px));
    expect(cap[0].y).toBe(Math.round(foot.py - 26 * ZOOM));
    expect(lab).toHaveLength(1);
    expect(lab[0].text).toBe('Wake');
    expect(lab[0].align).toBe('left');
    expect(lab[0].base).toBe('middle');
    expect(lab[0].x).toBe(Math.round(cap[0].x + (11 / 2 + 2) * ZOOM));
    expect(lab[0].y).toBe(Math.round(cap[0].y - (11 / 2) * ZOOM));
  });
  it('a bare cap has no label, and no hint draws nothing', () => {
    const barrel = ent(3, KIND.Barrel);
    const items = hint(input([barrel], [], { useHint: { ent: barrel, label: null } }));
    expect(only(items, 'cap')).toHaveLength(1);
    expect(only(items, 'cap')[0].x).toBe(Math.round(at(5, 5).px)); // no anchor: the entity's own spot
    expect(only(items, 'text')).toHaveLength(0);
    expect(hint(input([], []))).toEqual([]);
  });
});
