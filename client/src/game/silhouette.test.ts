import { describe, expect, it } from 'vitest';
import { behindOccluder, bodyLookFrom, heroBox, lookOf, MAX_OCCLUDERS, occludersOf, type BodyParts } from './silhouette';

// canopy box: x 100-196, top 20, trunk foot y 99
const OCC = { left: 100, right: 196, top: 20, footY: 99 };

describe('occludersOf (#262)', () => {
  // two overlapping conifers: the back one (foot 99) holds the hero, the front one's (foot 120) wide box overlaps it too
  const back = { id: 'back', left: 100, right: 196, top: 20, footY: 99 };
  const front = { id: 'front', left: 150, right: 230, top: 40, footY: 120 };
  const hero = { left: 150, right: 166, top: 50, footY: 80 };
  it('lists every tree the hero stands behind, front-most first', () => {
    expect(occludersOf(hero, [back, front]).map((o) => o.id)).toEqual(['front', 'back']);
  });
  it('leaves out trees the hero is not behind', () => {
    const aside = { id: 'aside', left: 300, right: 380, top: 0, footY: 110 };
    const north = { id: 'north', left: 100, right: 200, top: 0, footY: 60 };
    expect(occludersOf(hero, [aside, north, back]).map((o) => o.id)).toEqual(['back']);
  });
  it(`keeps at most ${MAX_OCCLUDERS}, the front-most`, () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, left: 100, right: 200, top: 0, footY: 90 + i }));
    expect(occludersOf(hero, many).map((o) => o.id)).toEqual(['t5', 't4', 't3', 't2']);
  });
});

describe('behindOccluder', () => {
  it('true: north of the trunk foot, inside the canopy box', () => {
    expect(behindOccluder({ left: 140, right: 156, top: 40, footY: 70 }, OCC)).toBe(true);
  });
  it('false: same box but the feet are below the trunk foot', () => {
    expect(behindOccluder({ left: 140, right: 156, top: 80, footY: 110 }, OCC)).toBe(false);
  });
  it('false: north but left of the box', () => {
    expect(behindOccluder({ left: 60, right: 90, top: 40, footY: 70 }, OCC)).toBe(false);
  });
  it('true: head above the canopy top but feet behind', () => {
    expect(behindOccluder({ left: 140, right: 156, top: 10, footY: 40 }, OCC)).toBe(true);
  });
});

describe('heroBox', () => {
  it('judges "behind" by the sprite y, not the bounds bottom (untrimmed frame, bottom 14 px below y)', () => {
    const bounds = { left: 140, right: 156, top: 70 };
    const box = heroBox(bounds, 90); // y 90 < 99, bounds.bottom 104 > 99
    expect(box.footY).toBe(90);
    expect(behindOccluder(box, OCC)).toBe(true);
  });
});

const fakeBody = (over: Partial<BodyParts> = {}): BodyParts => ({
  x: 0, y: 1, originX: 0.5, originY: 0.9, scaleX: 1, scaleY: 1, flipX: false, width: 16, height: 20,
  texture: { key: 'atlas' }, frame: { name: 'knight_idle0' }, ...over,
});

describe('bodyLookFrom', () => {
  const root = { x: 100, y: 200 };
  const fig = { x: 0, y: 0, scaleX: 2, scaleY: 2 };
  it('facing left: world position, doubled scale, flipX, bounds inside the figure box', () => {
    // EntityView mirrors the hip origin when facing left
    const look = bodyLookFrom(root, fig, fakeBody({ flipX: true, originX: 0.4, x: 3, y: -2 }));
    expect(look.x).toBe(106);
    expect(look.y).toBe(196);
    expect(look.footY).toBe(200); // the root's y, not the body's draw y
    expect(look.scaleX).toBe(2);
    expect(look.scaleY).toBe(2);
    expect(look.flipX).toBe(true);
    expect(look.key).toBe('atlas');
    expect(look.frame).toBe('knight_idle0');
    // 16x20 frame at scale 2: 32 wide, 40 tall; origin (0.4, 0.9)
    expect(look.bounds.left).toBeCloseTo(106 - 0.4 * 32);
    expect(look.bounds.right).toBeCloseTo(106 - 0.4 * 32 + 32);
    expect(look.bounds.top).toBeCloseTo(196 - 0.9 * 40);
  });
  it('facing right: flipX false, same y', () => {
    const l = bodyLookFrom(root, fig, fakeBody({ flipX: true, x: 0, y: 1 }));
    const r = bodyLookFrom(root, fig, fakeBody({ flipX: false, x: 0, y: 1 }));
    expect(r.flipX).toBe(false);
    expect(r.y).toBe(l.y);
    expect(r.y).toBe(202);
    expect(r.footY).toBe(200);
  });
});

describe('lookOf', () => {
  it('copies a root sprite incl. its getBounds (silhouetteFollows)', () => {
    const sprite = {
      x: 50, y: 80, originX: 0.5, originY: 1, scaleX: 1, scaleY: 1, flipX: true,
      texture: { key: 'k' }, frame: { name: 'f' }, getBounds: () => ({ left: 40, right: 60, top: 50, bottom: 80 }),
    };
    const look = lookOf(sprite as never);
    expect(look).toMatchObject({ key: 'k', frame: 'f', x: 50, y: 80, footY: 80, flipX: true, bounds: { left: 40, right: 60, top: 50 } });
  });
});
