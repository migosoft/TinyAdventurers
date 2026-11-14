import { describe, expect, it } from 'vitest';
import { CARD_BIAS } from '../materials';
import { PITCH_MAX } from '../params';
import { SWAY_WAVE_MAX } from '../wind';
import type { CoverResult } from './coverJob';
import { buildCoverChunk } from './coverMesh';
import { COVER_KINDS, encodeCover, GH_MAX } from './kinds';
import type { Bushel } from './source';

const W = 37, H = 23;
/** A map-sized cover image; `put` sets a px height (grass) at art px (px, pz). */
function result(put: [number, number, number][], bushels: Bushel[] = [], sheets = 4): CoverResult {
  const w = W * 16, h = H * 16, data = new Uint8Array(w * h * 4);
  for (const [x, z, ht] of put) data[(z * w + x) * 4 + 3] = encodeCover(ht, 0);
  return { image: { w, h, data }, bare: null, bushels, sheets };
}

describe('buildCoverChunk', () => {
  it('returns null when there are no sources', () => {
    const r: CoverResult = { image: { w: 1, h: 1, data: new Uint8Array(4) }, bare: null, bushels: [], sheets: 0 };
    expect(buildCoverChunk(r, 0, 0)).toBeNull();
  });

  it('returns null for a chunk without cover', () => {
    expect(buildCoverChunk(result([[5, 5, 2]]), 1, 1)).toBeNull();
    expect(buildCoverChunk(result([[5, 5, 2]]), 0, 0)).not.toBeNull();
  });

  it('gives a cell of height 2 quads on layers 1 and 2 only', () => {
    const c = buildCoverChunk(result([[3 * 16 + 4, 2 * 16 + 9, 2]]), 0, 0)!;
    expect(c.sheet.count).toBe(12);
    expect(new Set(c.sheet.layer.subarray(0, c.sheet.count))).toEqual(new Set([1, 2]));
    for (let i = 0; i < c.sheet.count; i++) {
      expect(c.sheet.position[i * 3]).toBeGreaterThanOrEqual(3);
      expect(c.sheet.position[i * 3]).toBeLessThanOrEqual(4);
      expect(c.sheet.position[i * 3 + 1]).toBe(0);
      expect(c.sheet.position[i * 3 + 2]).toBeGreaterThanOrEqual(2);
      expect(c.sheet.position[i * 3 + 2]).toBeLessThanOrEqual(3);
    }
  });

  it('only builds quads over cells inside the map', () => {
    const put: [number, number, number][] = [];
    for (let x = 0; x < W * 16; x++) for (let z = 0; z < H * 16; z += 16) put.push([x, z, 1]);
    const c = buildCoverChunk(result(put), 2, 1)!; // cells x 32..36, z 16..22
    expect(c.sheet.count).toBe(5 * 7 * 6);
    for (let i = 0; i < c.sheet.count; i++) {
      expect(c.sheet.position[i * 3]).toBeLessThanOrEqual(W);
      expect(c.sheet.position[i * 3 + 2]).toBeLessThanOrEqual(H);
    }
    expect(c.min[0]).toBe(32);
    expect(c.max[0]).toBeGreaterThanOrEqual(W);
  });

  it('keeps every drawn bushel corner inside the bounds for any yaw, with sway and the card bias', () => {
    const bushels: Bushel[] = [
      { x: 20.5, z: 3.2, w: 12, h: 13, seed: 0.3, fern: false },
      { x: 17.1, z: 15.9, w: 14, h: 8, seed: 0.7, fern: true },
      { x: 16.02, z: 0.1, w: 7, h: 7, seed: 0.1, fern: false },
    ];
    const c = buildCoverChunk(result([[20 * 16, 3 * 16, 4]], bushels), 1, 0)!;
    expect(c.bushel.count).toBe(18);
    const swing = (COVER_KINDS[0].bushels?.sway ?? 0) * SWAY_WAVE_MAX;
    const stretch = 1 / Math.cos((PITCH_MAX * Math.PI) / 180);
    for (const deg of [0, 8, 37, 90, 135]) {
      const yaw = (deg * Math.PI) / 180;
      const right = [Math.cos(yaw), Math.sin(yaw)], toward = [-Math.sin(yaw), Math.cos(yaw)]; // card plane direction; horizontal part of the way to the camera
      for (let i = 0; i < c.bushel.count; i++) {
        const [fx, fy, fz] = [c.bushel.foot[i * 3], c.bushel.foot[i * 3 + 1], c.bushel.foot[i * 3 + 2]];
        const [w, h] = [c.bushel.info[i * 4], c.bushel.info[i * 4 + 1]];
        for (const side of [-1, 1]) for (const up of [0, 1]) for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const bias of [-1, 1]) {
          const x = fx + side * right[0] * (w / 32) + sx * swing + bias * CARD_BIAS * toward[0];
          const z = fz + side * right[1] * (w / 32) + sz * swing + bias * CARD_BIAS * toward[1];
          const y = fy + up * (h / 16) * GH_MAX * stretch + (up ? swing : 0);
          expect(x).toBeGreaterThanOrEqual(c.min[0]); expect(x).toBeLessThanOrEqual(c.max[0]);
          expect(y).toBeGreaterThanOrEqual(c.min[1]); expect(y).toBeLessThanOrEqual(c.max[1]);
          expect(z).toBeGreaterThanOrEqual(c.min[2]); expect(z).toBeLessThanOrEqual(c.max[2]);
        }
      }
    }
    expect(c.max[1]).toBeGreaterThanOrEqual((4 / 16) * GH_MAX);
  });
});
