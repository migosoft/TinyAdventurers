// The air's quads (#307): AirParts into per-pass vertex arrays, no GPU.
import { describe, expect, it } from 'vitest';
import { MAX_SPECKS, newParts } from './airParts';
import { DROP_RGB } from './drips';
import { HAZE, HAZE_Y, KIND, airQuads, hazeQuads, newAirBuffers } from './airQuads';

describe('airQuads', () => {
  it('a speck goes to the additive mesh as kind 0, an ember as kind 1', () => {
    const p = newParts();
    p.specks.count = 1;
    p.specks.pos.set([3, 1, 4]);
    p.specks.alpha[0] = 0.5;
    p.embers.count = 1;
    p.embers.pos.set([5, 0.5, 6]);
    p.embers.size[0] = 0.2;
    p.embers.rgba.set([1, 0.5, 0.25, 0.8]);
    const out = newAirBuffers();
    const n = airQuads(p, out);
    expect(n).toEqual({ add: 12, blend: 0 });
    expect(out.add.kind[0]).toBe(KIND.speck);
    expect(out.add.kind[6]).toBe(KIND.ember);
    expect(Array.from(out.add.position.subarray(0, 3))).toEqual([3, 1, 4]);
    expect(out.add.rgba[3]).toBeCloseTo(0.5);
    expect(out.add.size[12]).toBeCloseTo(0.2);
    // A speck without its own sight point reads the mask at its own xz.
    expect(Array.from(out.add.sightXZ.subarray(0, 2))).toEqual([3, 4]);
  });

  it('a puff, a drop and a splash pixel go to the blend mesh with their kinds', () => {
    const p = newParts();
    p.puffs.count = 1;
    p.puffs.pos.set([1, 2, 3]);
    p.puffs.size[0] = 0.5;
    p.puffs.rgba.set([0.3, 0.3, 0.3, 0.4]);
    p.puffs.sight.set([7, 8]);
    p.drops.count = 2;
    p.drops.pos.set([2, 2, 2, 3, 0.01, 3]);
    p.drops.size.set([1 / 16, 1 / 16]);
    p.drops.alpha.set([0.85, 0.8]);
    p.drops.splash.set([0, 1]);
    const out = newAirBuffers();
    const n = airQuads(p, out);
    expect(n).toEqual({ add: 0, blend: 18 });
    const b = out.blend;
    expect(b.kind[0]).toBe(KIND.puff);
    expect(Array.from(b.sightXZ.subarray(0, 2))).toEqual([7, 8]);
    // The colour is the drip tint and the alpha its own.
    expect(b.rgba[6 * 4]).toBeCloseTo(((DROP_RGB >> 16) & 255) / 255);
    expect(b.rgba[6 * 4 + 3]).toBeCloseTo(0.85);
    // A falling drop is twice as tall as wide, a splash pixel square; both are the pixel kind.
    expect(b.kind[6]).toBe(KIND.pixel);
    expect(b.size[12]).toBeCloseTo(1 / 16);
    expect(b.size[13]).toBeCloseTo(2 / 16);
    expect(b.kind[12]).toBe(KIND.pixel);
    expect(b.size[24]).toBeCloseTo(1 / 16);
    expect(b.size[25]).toBeCloseTo(1 / 16);
  });

  it('a quad is six vertices whose corners cover -1..1', () => {
    const p = newParts();
    p.specks.count = 1;
    const out = newAirBuffers();
    airQuads(p, out);
    const c = Array.from(out.add.corner.subarray(0, 12));
    expect(Math.min(...c)).toBe(-1);
    expect(Math.max(...c)).toBe(1);
    expect(new Set(c.map((_, i) => (i % 2 ? `${c[i - 1]},${c[i]}` : '')).filter(Boolean)).size).toBe(4);
  });

  it('the arrays grow when a frame needs more', () => {
    const p = newParts();
    p.specks.count = MAX_SPECKS;
    p.embers.count = p.embers.size.length;
    const out = newAirBuffers();
    const before = out.add.position.length;
    const n = airQuads(p, out);
    expect(n.add).toBe((MAX_SPECKS + p.embers.count) * 6);
    expect(out.add.position.length).toBeGreaterThanOrEqual(n.add * 3);
    expect(out.add.position.length).toBeGreaterThan(before);
    expect(out.add.rgba.length).toBeGreaterThanOrEqual(n.add * 4);
  });
});

describe('hazeQuads', () => {
  it('two sheets over the footprint grown by two tiles, at their heights', () => {
    const pos = new Float32Array(2 * 6 * 3), sheet = new Float32Array(2 * 6 * 4);
    hazeQuads({ x0: 10, z0: 20, x1: 30, z1: 40 }, pos, sheet);
    expect(Math.min(...Array.from(pos).filter((_, i) => i % 3 === 0))).toBe(8);
    expect(Math.max(...Array.from(pos).filter((_, i) => i % 3 === 0))).toBe(32);
    expect(Math.min(...Array.from(pos).filter((_, i) => i % 3 === 2))).toBe(18);
    expect(Math.max(...Array.from(pos).filter((_, i) => i % 3 === 2))).toBe(42);
    expect(pos[1]).toBeCloseTo(HAZE_Y[0]);
    expect(pos[6 * 3 + 1]).toBeCloseTo(HAZE_Y[1]);
    Array.from(sheet.subarray(0, 4)).forEach((v, i) => expect(v).toBeCloseTo(HAZE[0][i]));
    Array.from(sheet.subarray(24, 28)).forEach((v, i) => expect(v).toBeCloseTo(HAZE[1][i]));
  });
});
