import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { FACE_H, FACE_W, FLAT_A, FLAT_RGB, PAGE } from './format';
import { planSheets, unplanned } from './plan';
import { StoneTooLargeError, makeSheets } from './sheets';

const LIMITS = { size: 4096, layers: 256 };
const PAGE_BYTES = PAGE * PAGE * 4;

/** Two ground pages and a wall page: two chunks side by side, one wall cell in the second. */
function plan() {
  const map = new TileMap(32, 16, new Uint8Array(32 * 16).fill(TILE_ID.Floor));
  map.set(20, 5, TILE_ID.Wall);
  return planSheets(map);
}
const page = (v: number) => new Uint8Array(PAGE_BYTES).fill(v);

describe('makeSheets', () => {
  it('starts every page flat: the flat colour with FLAT_A', () => {
    const s = makeSheets(plan(), LIMITS);
    const g = s.ground.image.data as Uint8Array;
    expect(Array.from(g.subarray(0, 4))).toEqual([...FLAT_RGB, FLAT_A]);
    expect(Array.from(g.subarray(PAGE_BYTES * 2 - 4, PAGE_BYTES * 2))).toEqual([...FLAT_RGB, FLAT_A]);
    expect((s.ground.image as { depth: number }).depth).toBe(2);
    expect((s.wall.image as { depth: number }).depth).toBe(1);
    expect(s.ground.layerUpdates.size).toBe(0);
  });

  it('keeps one layer in a texture for a plan with none', () => {
    const s = makeSheets(unplanned(), LIMITS);
    expect((s.ground.image as { depth: number }).depth).toBe(1);
    expect((s.wall.image as { depth: number }).depth).toBe(1);
  });

  it('throws StoneTooLargeError when the plan needs more layers than the limit, or the page is larger than the size limit', () => {
    expect(() => makeSheets(plan(), { size: 4096, layers: 1 })).toThrow(StoneTooLargeError);
    expect(() => makeSheets(plan(), { size: 256, layers: 256 })).toThrow(StoneTooLargeError);
  });
});

describe('Sheets.setPage', () => {
  it('writes only its layer and marks only it', () => {
    const s = makeSheets(plan(), LIMITS);
    s.setPage('ground', 1, page(7));
    const g = s.ground.image.data as Uint8Array;
    expect(g[PAGE_BYTES]).toBe(7);
    expect(g[PAGE_BYTES * 2 - 1]).toBe(7);
    expect(g[PAGE_BYTES - 1]).toBe(FLAT_A); // layer 0 untouched
    expect(Array.from(s.ground.layerUpdates)).toEqual([1]);
    expect(s.wall.layerUpdates.size).toBe(0);
  });

  it('copies: later changes to the array do not reach the sheet', () => {
    const s = makeSheets(plan(), LIMITS);
    const px = page(9);
    s.setPage('ground', 0, px);
    px.fill(1);
    expect((s.ground.image.data as Uint8Array)[0]).toBe(9);
  });

  it('setFace writes the slot rows into the wall page and marks the wall layer', () => {
    const p = plan();
    const s = makeSheets(p, LIMITS);
    const face = p.facesOf(1, 0)[0];
    const slot = p.slotOf(face);
    s.setFace(slot, new Uint8Array(FACE_W * FACE_H * 4).fill(5));
    const w = s.wall.image.data as Uint8Array;
    const at = (u: number, v: number) => w[((slot.layer * PAGE + v) * PAGE + u) * 4];
    expect(at(slot.u, slot.v)).toBe(5);
    expect(at(slot.u + FACE_W - 1, slot.v + FACE_H - 1)).toBe(5);
    expect(at(slot.u + FACE_W, slot.v)).toBe(FLAT_RGB[0]);
    expect(at(slot.u, slot.v + FACE_H)).toBe(FLAT_RGB[0]);
    expect(Array.from(s.wall.layerUpdates)).toEqual([slot.layer]);
  });

  it('refuses a page of the wrong size or a layer out of range', () => {
    const s = makeSheets(plan(), LIMITS);
    expect(() => s.setPage('ground', 0, new Uint8Array(10))).toThrow();
    expect(() => s.setPage('ground', 2, page(1))).toThrow();
  });
});

describe('Sheets.reupload', () => {
  it('marks every layer that was ever set and no other', () => {
    const s = makeSheets(plan(), LIMITS);
    s.setPage('ground', 1, page(3));
    s.ground.clearLayerUpdates();
    s.wall.clearLayerUpdates();
    s.reupload();
    expect(Array.from(s.ground.layerUpdates)).toEqual([1]);
    expect(s.wall.layerUpdates.size).toBe(0);
  });

  it('copyFrom takes the painted layers of another sheet of the same size and reuploads them', () => {
    const a = makeSheets(plan(), LIMITS), b = makeSheets(plan(), LIMITS);
    a.setPage('ground', 0, page(4));
    b.copyFrom(a);
    expect((b.ground.image.data as Uint8Array)[0]).toBe(4);
    expect(Array.from(b.ground.layerUpdates)).toEqual([0]);
  });
});
