import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../generated/defs';
import { TILE, TileMap } from '../sim/map';
import { View } from '../sim/view';
import { newCardBuf, newGlowBuf, newShadowBuf, glowsOf, shadowsOf, pushCard, pushGlow, pushShadow, quadsOf, type Card } from './cards';
import { cardSightData, glowSightData, shadowSightData } from './sightAttrs';
import { footSight, SightMask } from './sightmask';
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
});
