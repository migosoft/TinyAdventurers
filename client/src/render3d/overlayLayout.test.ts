import { describe, expect, it } from 'vitest';
import { EFFECT, FLAG, KIND, SIDE } from '../generated/defs';
import type { EntState } from '../game/world';
import type { UseHint } from '../game/useHint';
import type { FigureAnchor } from './figures';
import { SOUND_TEXT } from '../game/effects';
import { popScale, WORLD_TEXT } from '../game/worldText';
import { BODY_RISE } from '../game/damage';
import type { PictureEv } from '../run/view';
import { renderPlan } from './quality';
import { toCanvas } from './screen';
import { Floats, floatSpot, layoutBars, layoutHeroTags, layoutTags, layoutUseHint, Marks, type LayoutIn, type OverlayItem } from './overlayLayout';

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

describe('layoutTags', () => {
  it('a tagged enemy reads its tag 7 px above its height', () => {
    const e = ent(7, KIND.SkeletonWarrior);
    const out: OverlayItem[] = [];
    layoutTags(input([e, ent(8, KIND.SkeletonWarrior)], [[7, anchor()], [8, anchor()]]), (x) => (x.id === 7 ? 'Skeleton Warrior 2' : null), out);
    const t = only(out, 'text');
    expect(t).toHaveLength(1);
    const foot = at(5, 5);
    expect(t[0]).toMatchObject({ text: 'Skeleton Warrior 2', kind: 'tag', color: '#ffffff', stroke: '#000000', align: 'center', base: 'bottom', x: Math.round(foot.px), y: Math.round(foot.py - (20 + 7) * ZOOM) });
  });
  it('an entity without an anchor gets none', () => {
    const out: OverlayItem[] = [];
    layoutTags(input([ent(7, KIND.SkeletonWarrior)], []), () => 'x', out);
    expect(out).toEqual([]);
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

// A fixed "random": the middle of the spread, so no sideways shift.
const mid = () => 0.5;
const floatItems = (f: Floats, a = at): OverlayItem[] => {
  const out: OverlayItem[] = [];
  f.layout(a, ZOOM, out);
  return out;
};

describe('Floats', () => {
  it('a damage number rises and fades like 2D', () => {
    const f = new Floats(mid);
    f.add(5 * TILE, 5 * TILE, '12', '#ffffff');
    const start = only(floatItems(f), 'text')[0];
    expect(start.text).toBe('12');
    expect(start.alpha).toBe(1);
    expect(start.base).toBe('bottom');
    expect(start.kind).toBe('number');
    expect(start.stroke).toBe('#000000');
    expect(start.x).toBe(Math.round(at(5, 5).px));
    f.update(0.35);
    const half = only(floatItems(f), 'text')[0];
    expect(half.alpha).toBe(1);
    expect(half.y).toBeLessThan(start.y);
    f.update(0.25);
    expect(only(floatItems(f), 'text')[0].alpha).toBeLessThan(1);
    f.update(0.11);
    expect(floatItems(f)).toEqual([]);
  });
  it('rises at -26 art px/s, slowing by 0.92 per update', () => {
    const f = new Floats(mid);
    f.add(5 * TILE, 5 * TILE, '1', '#fff');
    const y0 = only(floatItems(f), 'text')[0].y;
    f.update(0.1);
    expect(only(floatItems(f), 'text')[0].y).toBe(Math.round(y0 - 2.6 * ZOOM));
    f.update(0.1);
    expect(only(floatItems(f), 'text')[0].y).toBe(Math.round(y0 - (2.6 + 2.6 * 0.92) * ZOOM));
  });
  it('a crit pops from 1.4 and is gold', () => {
    const f = new Floats(mid);
    f.add(5 * TILE, 5 * TILE, '30', WORLD_TEXT.crit.color, { big: true });
    const t = only(floatItems(f), 'text')[0];
    expect(t.scale).toBeCloseTo(1.4, 9);
    expect(t.color).toBe('#ffd24a');
    expect(t.kind).toBe('crit');
    f.update(0.05);
    expect(only(floatItems(f), 'text')[0].scale).toBeCloseTo(popScale(0.05), 9);
    f.update(0.1);
    expect(only(floatItems(f), 'text')[0].scale).toBe(1);
    // it lives 0.9 s and rises faster (-34)
    f.update(0.7);
    expect(floatItems(f)).toHaveLength(1);
    f.update(0.06);
    expect(floatItems(f)).toEqual([]);
  });
  it('an immune hit reads immune in grey, small', () => {
    const f = new Floats(mid);
    f.add(5 * TILE, 5 * TILE, 'immune', '#a0a0a0', { kind: 'small' });
    const t = only(floatItems(f), 'text')[0];
    expect(t.text).toBe('immune');
    expect(t.color).toBe('#a0a0a0');
    expect(t.kind).toBe('small');
  });
  it('starts `up` art px above its spot', () => {
    const f = new Floats(mid);
    f.add(5 * TILE, 5 * TILE, 'IMMUNE', '#9ae0ff', { kind: 'small', up: 18 });
    expect(only(floatItems(f), 'text')[0].y).toBe(Math.round(at(5, 5).py - 18 * ZOOM));
  });
  it('spreads the x by up to 3 art px either way', () => {
    const lo = new Floats(() => 0);
    const hi = new Floats(() => 1);
    lo.add(5 * TILE, 5 * TILE, '1', '#fff');
    hi.add(5 * TILE, 5 * TILE, '1', '#fff');
    expect(only(floatItems(lo), 'text')[0].x).toBe(Math.round(at(5, 5).px - 3 * ZOOM));
    expect(only(floatItems(hi), 'text')[0].x).toBe(Math.round(at(5, 5).px + 3 * ZOOM));
  });
  it('keeps its ground spot when the camera moves', () => {
    const f = new Floats(mid);
    f.add(5 * TILE, 5 * TILE, '9', '#fff');
    f.update(0.2);
    const a = only(floatItems(f), 'text')[0];
    const moved = (x: number, z: number) => ({ px: 300 + x * 40, py: -20 + z * 40 });
    const b = only(floatItems(f, moved), 'text')[0];
    expect(b.x).toBe(Math.round(moved(5, 5).px));
    expect(a.x).toBe(Math.round(at(5, 5).px));
    // the same rise in screen space on both maps
    expect(a.y - Math.round(at(5, 5).py)).toBe(b.y - Math.round(moved(5, 5).py));
  });
});

describe('floatSpot', () => {
  // The server has the hero at (100, 60); the prediction runs 30 px ahead at (130, 60). The server puts the event 10 px over the foot.
  const srv = { x: 100, y: 60 };
  const pred = { x: 130, y: 60 };
  it('moves a hit on the own hero from the server spot to the predicted spot', () => {
    expect(floatSpot({ x: 100, y: 50, p: true }, pred, srv)).toEqual({ x: 130, y: 50 });
    expect(floatSpot({ x: 101, y: 51, p: true }, pred, srv)).toEqual({ x: 131, y: 51 });
  });
  it('leaves a hit on another creature near the predicted spot, other hits and an unknown server spot where they are', () => {
    expect(floatSpot({ x: 130, y: 50, p: true }, pred, srv)).toEqual({ x: 130, y: 50 }); // near the prediction, far from the server hero
    expect(floatSpot({ x: 30, y: 20, p: true }, pred, srv)).toEqual({ x: 30, y: 20 });
    expect(floatSpot({ x: 100, y: 50, p: false }, pred, srv)).toEqual({ x: 100, y: 50 });
    expect(floatSpot({ x: 100, y: 50, p: true }, pred, null)).toEqual({ x: 100, y: 50 });
  });
});

describe('Floats.addPicture', () => {
  // A hit at the foot (160, 120) arrives from the server 10 px up, at y = 110. Whatever the camera's yaw, the number starts 10 art px
  // straight up the screen from the foot, as in 2D.
  const zoom = 4;
  const plan = renderPlan('high', zoom, 1920, 1080);
  for (const yawDeg of [0, 90, 180, 270]) {
    for (const ty of ['Dmg', 'Heal'] as const) {
      it(`a ${ty} starts ${BODY_RISE} art px over the foot at yaw ${yawDeg}`, () => {
        const cam = { x: 10, z: 7.5, pitch: Math.PI / 4, yaw: (yawDeg * Math.PI) / 180 };
        const to = (x: number, z: number) => toCanvas(cam, plan, zoom, x, 0, z);
        const f = new Floats(mid);
        const ev = ty === 'Dmg'
          ? ({ t: 'Dmg', x: 160, y: 110, v: 5, ty: 0, crit: false, p: false, imm: false } as PictureEv)
          : ({ t: 'Heal', x: 160, y: 110, v: 5, p: false } as PictureEv);
        f.addPicture(ev, { x: 0, y: 0 }, null);
        const out: OverlayItem[] = [];
        f.layout(to, zoom, out);
        const foot = to(10, 7.5);
        const t = only(out, 'text')[0];
        expect(t.x).toBe(Math.round(foot.px));
        expect(t.y).toBe(Math.round(foot.py - BODY_RISE * zoom));
      });
    }
  }
  it('Immune keeps its own lift from the spot', () => {
    const f = new Floats(mid);
    f.addPicture({ t: 'Immune', x: 5 * TILE, y: 5 * TILE } as PictureEv, { x: 0, y: 0 }, null);
    expect(only(floatItems(f), 'text')[0].y).toBe(Math.round(at(5, 5).py - 18 * ZOOM));
  });
  it('a hit on the own hero is born at the predicted foot', () => {
    const f = new Floats(mid);
    // server hero (100, 60), predicted (130, 60); the event sits 10 px over the server foot
    f.addPicture({ t: 'Dmg', x: 100, y: 50, v: 5, ty: 0, crit: false, p: true, imm: false } as PictureEv, { x: 130, y: 60 }, { x: 100, y: 60 });
    const t = only(floatItems(f), 'text')[0];
    expect(t.x).toBe(Math.round(at(130 / TILE, 60 / TILE).px));
    expect(t.y).toBe(Math.round(at(130 / TILE, 60 / TILE).py - BODY_RISE * ZOOM));
  });
});

const sleeper = (o: Partial<FigureAnchor> = {}): [number, FigureAnchor][] => [[7, anchor({ effects: 1 << EFFECT.Sleep, ...o })]];
const texts = (m: Marks): Of<'text'>[] => {
  const out: OverlayItem[] = [];
  m.layout(at, ZOOM, out);
  return only(out, 'text');
};

describe('Marks', () => {
  it('a sleeper gets a Z every 0.6 s, rising 10 art px over 1.2 s', () => {
    const m = new Marks();
    const a = new Map(sleeper());
    m.update(0.01, a);
    expect(texts(m)).toHaveLength(1); // the first Z at once
    const z = texts(m)[0];
    expect(z.text).toBe('Z');
    expect(z.kind).toBe('mark');
    expect(z.color).toBe(SOUND_TEXT.fill);
    expect(z.stroke).toBe(SOUND_TEXT.stroke);
    expect(z.base).toBe('bottom');
    m.update(0.6, a);
    expect(texts(m)).toHaveLength(2);
    m.update(0.6, a);
    // the first two (1.21 s and 1.2 s old) are gone; the newest, 0.6 s old, is half way up and half faded
    expect(texts(m)).toHaveLength(1);
    expect(texts(m)[0].alpha).toBeCloseTo(0.5, 5);
    expect(texts(m)[0].y).toBe(Math.round(at(5, 5).py - (18 + 5) * ZOOM));
  });
  it('a Z starts 3 art px right of the foot at the head and sways', () => {
    const m = new Marks();
    m.update(0.0001, new Map(sleeper({ head: 18 })));
    const z = texts(m)[0];
    expect(z.x).toBe(Math.round(at(5, 5).px + 3 * ZOOM));
    expect(z.y).toBe(Math.round(at(5, 5).py - 18 * ZOOM));
    expect(z.alpha).toBeCloseTo(1, 3);
  });
  it('a Z is as faint as its figure and stops when the sleep ends', () => {
    const m = new Marks();
    m.update(0.0001, new Map(sleeper({ alpha: 0.5 })));
    expect(texts(m)[0].alpha).toBeCloseTo(0.5, 3);
    m.update(0.1, new Map([[7, anchor()]]));
    m.update(0.7, new Map([[7, anchor()]]));
    expect(texts(m)).toHaveLength(1); // the old one keeps rising, no new one
  });
  it('fear and charm sit side by side', () => {
    const m = new Marks();
    m.update(0.1, new Map([[7, anchor({ effects: (1 << EFFECT.Fear) | (1 << EFFECT.Charmed), cx: 2, head: 18, alpha: 0.8 })]]));
    const t = texts(m);
    const bang = t.find((x) => x.text === '!')!;
    const heart = t.find((x) => x.text === '♥')!;
    expect(bang.color).toBe(SOUND_TEXT.fill);
    expect(heart.color).toBe('#ff80c0');
    expect(heart.stroke).toBe(SOUND_TEXT.stroke);
    expect(bang.alpha).toBe(0.8);
    expect(heart.alpha).toBe(0.8);
    expect(bang.x).toBe(Math.round(at(5, 5).px + 2 * ZOOM));
    expect(heart.x).toBe(Math.round(at(5, 5).px + 9 * ZOOM));
    // 3 art px over the head, bobbing at most 1.5 more
    expect(at(5, 5).py - bang.y).toBeGreaterThanOrEqual(Math.round((18 + 3) * ZOOM) - 1);
    expect(at(5, 5).py - bang.y).toBeLessThanOrEqual(Math.round((18 + 4.5) * ZOOM) + 1);
  });
  it('charm alone sits on the centre, and no marks without an effect', () => {
    const m = new Marks();
    m.update(0.1, new Map([[7, anchor({ effects: 1 << EFFECT.Charmed, cx: 2 })]]));
    expect(texts(m)).toHaveLength(1);
    expect(texts(m)[0].x).toBe(Math.round(at(5, 5).px + 2 * ZOOM));
    const none = new Marks();
    none.update(0.1, new Map([[7, anchor()]]));
    expect(texts(none)).toEqual([]);
  });
});
