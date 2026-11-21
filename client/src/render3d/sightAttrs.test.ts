import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { TILE, TileMap } from '../sim/map';
import { View } from '../sim/view';
import { newCardBuf, newGlowBuf, newShadowBuf, glowsOf, shadowsOf, pushCard, pushGlow, pushShadow, pushWall, quadsOf, type Card } from './cards';
import type { FigureInst } from './models/instances';
import { newBuiltBuf, type BuiltInst } from './built';
import { newSmokeBuf, type SmokeBuf } from './fx/smoke';
import { cardSightData, figureSight, glowSightData, hiddenByPicture, shadowSightData, smokeUpload, type SmokeArrays } from './sightAttrs';
import { footSight, SightMask, thingHard } from './sightmask';
import type { Cam } from './camera';
import type { FrameRects } from './worldMesh';

const frames: FrameRects = { f: { x: 0, y: 0, w: 16, h: 16 } };
const cam: Cam = { x: 10, z: 10, pitch: Math.PI / 4, yaw: 0 };
const card = (o: Partial<Card>): Card => ({ frame: 'f', x: 10, z: 10, lift: 0, flip: false, originX: 0.5, footY: 1, scale: 1, tint: [1, 1, 1], mode: 0, alpha: 1, ...o });

/** A dark-map mask from a viewer at the centre of a room of floor. */
function mask(): SightMask {
  const w = 41, tiles = new Uint8Array(w * w).fill(TILE_ID.Floor);
  const map = new TileMap(w, w, tiles);
  const hard = new View(w, w);
  hard.compute(map, 20.5 * TILE, 20.5 * TILE, 6, 'hard');
  const m = new SightMask(map, { daylight: false, feather: 0, ramp: 0 });
  m.update(hard, null, 0);
  return m;
}

describe('the sight attributes', () => {
  it('copies one footSight value per quad to its six vertices', () => {
    const m = mask();
    const b = newCardBuf();
    pushCard(b, card({ x: 20.5, z: 20.5 }), frames, cam); // at the viewer: seen
    pushCard(b, card({ x: 38, z: 38 }), frames, cam); // far: unseen
    const q = quadsOf(b);
    const out = cardSightData(q, m, new Float32Array(12 * 3));
    const near = footSight(m, 20.5, 20.5, 0), far = footSight(m, 38, 38, 0);
    expect(near.hard).toBeLessThan(0.1);
    expect(far.hard).toBeGreaterThan(0.9);
    for (let i = 0; i < 6; i++) expect(Array.from(out.slice(i * 3, i * 3 + 3))).toEqual([Math.fround(near.hard), Math.fround(near.soft), 0].map((v) => v));
    for (let i = 6; i < 12; i++) expect(Array.from(out.slice(i * 3, i * 3 + 3))).toEqual([Math.fround(far.hard), Math.fround(far.soft), 0]);
  });
  it('carries the scenery flag', () => {
    const b = newCardBuf();
    pushCard(b, card({ scenery: true }), frames, cam);
    const out = cardSightData(quadsOf(b), mask(), new Float32Array(18));
    expect(out[2]).toBe(1);
  });
  it('a null mask gives zeros', () => {
    const b = newCardBuf();
    pushCard(b, card({ x: 38, z: 38 }), frames, cam);
    const out = cardSightData(quadsOf(b), null, new Float32Array(18).fill(7));
    expect(Array.from(out)).toEqual(new Array(18).fill(0));
  });
  it('a wide card uses its reach', () => {
    const m = mask();
    // at the edge of sight a wide card sees a corner that is seen
    let found = false;
    for (let x = 22; x < 30 && !found; x += 0.25) {
      const wide = footSight(m, x, 20.5, 2), thin = footSight(m, x, 20.5, 0);
      if (Math.abs(wide.hard - thin.hard) > 0.05) {
        const b = newCardBuf();
        pushCard(b, card({ x, z: 20.5, reach: 2 }), frames, cam);
        const out = cardSightData(quadsOf(b), m, new Float32Array(18));
        expect(out[0]).toBeCloseTo(wide.hard, 5);
        expect(out[0]).not.toBeCloseTo(thin.hard, 3);
        found = true;
      }
    }
    expect(found).toBe(true);
  });
  it('shadows and glows give (hard, soft) per vertex', () => {
    const m = mask();
    const s = newShadowBuf();
    pushShadow(s, cam, 38, 38, 0.4, 0.2, 0.45);
    const so = shadowSightData(shadowsOf(s), m, new Float32Array(12));
    const far = footSight(m, 38, 38, 0);
    for (let i = 0; i < 6; i++) expect(Array.from(so.slice(i * 2, i * 2 + 2))).toEqual([Math.fround(far.hard), Math.fround(far.soft)]);
    const g = newGlowBuf();
    pushGlow(g, 20.5, 1, 20.5, 0.5, [1, 1, 1], cam);
    const go = glowSightData(glowsOf(g), m, new Float32Array(12));
    expect(go[0]).toBeLessThan(0.1);
    expect(Array.from(glowSightData(glowsOf(g), null, new Float32Array(12).fill(3)))).toEqual(new Array(12).fill(0));
  });

  it('a torch on the far face of a visible wall is unseen, on the near face seen', () => {
    // a wall at x = 24 in a room of floor; the viewer stands west of it at (20.5, 20.5)
    const w = 41, tiles = new Uint8Array(w * w).fill(TILE_ID.Floor);
    for (let z = 0; z < w; z++) tiles[z * w + 24] = TILE_ID.Wall;
    const map = new TileMap(w, w, tiles);
    const hard = new View(w, w);
    hard.compute(map, 20.5 * TILE, 20.5 * TILE, 8, 'hard');
    const m = new SightMask(map, { daylight: false, feather: 0, ramp: 0 });
    m.update(hard, null, 0);
    const near = newCardBuf(), far = newCardBuf();
    // torches as figures.ts places them: TORCH_OFF in front of the face, normal pointing out of the wall
    pushWall(near, 'f', 24 - 0.02, 1, 20.5, -1, 0, false, frames); // west face: x = 24 - 0.02
    pushWall(far, 'f', 25 - 0.02, 1, 20.5, 1, 0, false, frames); // east face
    const nf = footSight(m, near.foot[0], near.foot[1], 0), ff = footSight(m, far.foot[0], far.foot[1], 0);
    expect(nf.hard).toBeLessThan(0.05);
    expect(ff.hard).toBeGreaterThanOrEqual(0.95);
  });
});

describe('daylight things', () => {
  /** An open daylight map, the viewer at its centre, vision 9 (the edge of sight at 9.5 tiles). */
  function day(): SightMask {
    const w = 61, tiles = new Uint8Array(w * w).fill(TILE_ID.Floor);
    const map = new TileMap(w, w, tiles);
    const hard = new View(w, w);
    hard.compute(map, 30.5 * TILE, 30.5 * TILE, 9, 'hard');
    const m = new SightMask(map, { daylight: true, feather: 24, ramp: 24 });
    m.update(hard, null, 0);
    return m;
  }
  it('a card 1 tile inside the edge gets hard 0, well beyond it about 1; the ground keeps the blur', () => {
    const m = day();
    const b = newCardBuf();
    pushCard(b, card({ x: 30.5 + 8.5, z: 30.5 }), frames, cam);
    pushCard(b, card({ x: 30.5 + 13, z: 30.5 }), frames, cam);
    const out = cardSightData(quadsOf(b), m, new Float32Array(36));
    expect(out[0]).toBe(0);
    expect(out[18]).toBeGreaterThan(0.95); // the blur tails reach 4.5 tiles past the edge
    expect(m.sample(30.5 + 9.5, 30.5).hard).toBeGreaterThan(0.3); // the ground itself is unchanged: feathered at the edge
  });
  it('shadows and glows get the same remap', () => {
    const m = day();
    const s = newShadowBuf();
    pushShadow(s, cam, 30.5 + 8.5, 30.5, 0.4, 0.2, 0.45);
    expect(shadowSightData(shadowsOf(s), m, new Float32Array(12))[0]).toBe(0);
  });
  it('a scenery model instance stays shown on a daylight map though the mask hides its place; a dungeon map and a figure hide it (#317)', () => {
    const inst = (scenery: boolean | undefined): FigureInst => ({ owner: 1, x: 30.5 + 13, z: 30.5, reach: 0, scenery, sight: { hard: 9, soft: 9 } } as unknown as FigureInst);
    const m = day();
    expect(footSight(m, 30.5 + 13, 30.5, 0).hard).toBeGreaterThan(0.9);
    const [prop, figure, plain] = [inst(true), inst(false), inst(undefined)];
    figureSight([prop, figure, plain], m);
    expect(prop.sight.hard).toBe(0);
    expect(figure.sight.hard).toBeGreaterThan(0.9);
    expect(plain.sight.hard).toBeGreaterThan(0.9);
    // the id pass leaves the prop out of the hidden things as it does a scenery card
    const out = new Set<number>();
    hiddenByPicture([], m, new Set(), out, [prop]);
    expect(out.size).toBe(0);
    hiddenByPicture([], m, new Set(), out, [figure]);
    expect([...out]).toEqual([1]);
    // a dungeon map hides it
    const dark = mask(), dprop = { ...inst(true), x: 38, z: 38 } as FigureInst;
    figureSight([dprop], dark);
    expect(dprop.sight.hard).toBeGreaterThan(0.9);
    const hidden = new Set<number>();
    hiddenByPicture([], dark, new Set(), hidden, [dprop]);
    expect([...hidden]).toEqual([1]);
  });
});

describe('the sight of model figures (#338)', () => {
  // Only the fields the sight reads matter here.
  const inst = (owner: number, x: number, z: number, reach = 0): FigureInst => ({ owner, x, z, reach, sight: { hard: 9, soft: 9 } } as unknown as FigureInst);

  it('reads the mask at the foot, like a card: seen, unseen', () => {
    const m = mask();
    const list = [inst(1, 20.5, 20.5), inst(2, 38, 38)];
    figureSight(list, m);
    const near = footSight(m, 20.5, 20.5, 0), far = footSight(m, 38, 38, 0);
    expect(list[0].sight.hard).toBeLessThan(0.1);
    expect(list[0].sight.soft).toBeCloseTo(near.soft, 9);
    expect(list[1].sight.hard).toBeGreaterThan(0.9);
    expect(list[1].sight.soft).toBeCloseTo(far.soft, 9);
  });
  it('a wide figure uses its reach, as a wide card does', () => {
    const m = mask();
    const narrow = [inst(1, 26.2, 20.5, 0)], wide = [inst(1, 26.2, 20.5, 2)];
    figureSight(narrow, m);
    figureSight(wide, m);
    const want = footSight(m, 26.2, 20.5, 2);
    expect(wide[0].sight.soft).toBeCloseTo(want.soft, 9);
    expect(narrow[0].sight.soft).toBeCloseTo(footSight(m, 26.2, 20.5, 0).soft, 9);
  });
  it('partly shown stays between 0 and 1 for the stipple', () => {
    const m = mask();
    // somewhere along the edge of the viewer's 6 tile disc
    let found = false;
    for (let x = 24; x < 28 && !found; x += 0.05) {
      const l = [inst(1, x, 20.5)];
      figureSight(l, m);
      if (l[0].sight.hard > 0.05 && l[0].sight.hard < 0.95) found = true;
    }
    expect(found).toBe(true);
  });
  it('a null mask gives zeros', () => {
    const l = [inst(1, 38, 38)];
    figureSight(l, null);
    expect(l[0].sight).toEqual({ hard: 0, soft: 0 });
  });
  it('hides the owner of an unseen model figure, asks once per owner and adds nothing for a seen one', () => {
    const m = mask();
    const out = new Set<number>(), seen = new Set<number>();
    // owner 2: body unseen, weapon (and a copy) at other places: only the first instance counts; owner 1 is seen; owner -1 (a skull) is never hidden
    const list = [inst(1, 20.5, 20.5), inst(2, 38, 38), inst(2, 20.5, 20.5), inst(1, 38, 38), inst(-1, 38, 38)];
    hiddenByPicture([], m, seen, out, list);
    expect([...out]).toEqual([2]);
    expect(seen.has(2)).toBe(true);
    // the cards' own rule is unchanged (no models)
    const none = new Set<number>();
    hiddenByPicture([], m, seen, none);
    expect(none.size).toBe(0);
  });
});

describe('the smoke upload (#359)', () => {
  /** `tris` triangles whose corner k of triangle t has x = t * 10 + k and the tag `t + 1` in every `rgba`, `c` slot. */
  const smoke = (tris: number): SmokeBuf => {
    const b = newSmokeBuf();
    for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) {
      b.position.push(t * 10 + k, 1, 2);
      b.rgba.push(t + 1, 0, 0, 0.5);
      b.c.push(t + 1, 0.25, 0.5, 0.75);
    }
    b.n = tris;
    return b;
  };
  const arrays = (): SmokeArrays => ({ pos: new Float32Array(0), rgba: new Float32Array(0), c: new Float32Array(0), sight: new Float32Array(0) });

  it('4 triangles give 12 corners, with position, rgba, c and sight filled', () => {
    const a = arrays(), m = mask();
    const b = smoke(4);
    b.position[0] = 20.5; b.position[2] = 20.5;   // triangle 0 at the viewer: seen
    b.position[9] = 38; b.position[11] = 38;      // triangle 1 far away: unseen
    expect(smokeUpload(b, m, a)).toBe(12);
    expect(Array.from(a.pos.subarray(0, 36))).toEqual(b.position);
    expect(Array.from(a.rgba.subarray(0, 48))).toEqual(b.rgba);
    expect(Array.from(a.c.subarray(0, 48))).toEqual(b.c);
    const near = footSight(m, 20.5, 20.5, 0), far = footSight(m, 38, 38, 0);
    expect(a.sight[0]).toBeCloseTo(thingHard(m, near.hard), 5);
    expect(a.sight[1]).toBeCloseTo(near.soft, 5);
    expect(a.sight[6]).toBeCloseTo(thingHard(m, far.hard), 5);
    expect(a.sight.length).toBeGreaterThanOrEqual(24);
  });
  it('undefined and an empty buffer give 0 (the mesh then draws nothing)', () => {
    const a = arrays();
    expect(smokeUpload(undefined, null, a)).toBe(0);
    const b = smoke(2);
    expect(smokeUpload(b, null, a)).toBe(6);
    b.n = 0;
    expect(smokeUpload(b, null, a)).toBe(0);
  });
  it('the arrays grow and are then reused', () => {
    const a = arrays();
    smokeUpload(smoke(2), null, a);
    const small = a.pos;
    smokeUpload(smoke(50), null, a);
    expect(a.pos).not.toBe(small);
    expect(a.pos.length).toBeGreaterThanOrEqual(50 * 9);
    const big = { pos: a.pos, rgba: a.rgba, c: a.c, sight: a.sight };
    smokeUpload(smoke(10), null, a);
    expect(a.pos).toBe(big.pos); expect(a.rgba).toBe(big.rgba); expect(a.c).toBe(big.c); expect(a.sight).toBe(big.sight);
  });
});

describe('the sight of built figures (#358)', () => {
  const built = (owner: number, x: number, z: number): BuiltInst => ({
    owner, key: 'lich', x, z, lift: 0, yaw: 0, scale: 1, body: newBuiltBuf(1, 3), glow: null, levels: [0, 0, 0, 0],
    tint: [1, 1, 1], stone: false, alpha: 1, dark: false, cut: false, groundY: 0, sight: { hard: 0, soft: 0 }, reach: 0,
  });

  it('figureSight fills the sight of a built instance, at its foot', () => {
    const m = mask(), near = built(1, 20.5, 20.5), far = built(2, 38, 38);
    figureSight([near, far], m);
    expect(near.sight.hard).toBeLessThan(0.1);
    expect(far.sight.hard).toBeGreaterThan(0.9);
    expect(far.sight.soft).toBeCloseTo(footSight(m, 38, 38, 0).soft, 6);
    figureSight([far], null);
    expect(far.sight).toEqual({ hard: 0, soft: 0 });
  });

  it('hiddenByPicture adds the owner of a built instance that lies in the dark, and not a seen one', () => {
    const m = mask(), near = built(1, 20.5, 20.5), far = built(2, 38, 38);
    figureSight([near, far], m);
    expect(far.sight.hard).toBeGreaterThan(0.5);
    const out = new Set<number>();
    hiddenByPicture([], m, new Set(), out, [], [near, far]);
    expect([...out]).toEqual([2]);
  });
});
