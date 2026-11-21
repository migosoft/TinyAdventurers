import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { WALL_H } from '../heights';
import { FACE_H, FACE_W } from './format';
import { CHUNK, KIND } from './grid';
import { stoneField } from './field';
import { buildStoneChunk, type StoneArrays } from './mesh';
import { noMarks } from './place';
import { planSheets } from './plan';

/** A 3 by 3 floor with a wall in the middle. */
function ring() {
  const m = new TileMap(3, 3, new Uint8Array(9).fill(TILE_ID.Floor));
  m.set(1, 1, TILE_ID.Wall);
  return m;
}
const build = (m: TileMap, cx = 0, cz = 0): { a: StoneArrays; plan: ReturnType<typeof planSheets> } => {
  const plan = planSheets(m);
  return { a: buildStoneChunk(m, stoneField(m), plan, noMarks(), cx, cz), plan };
};
const vertex = (a: StoneArrays, i: number) => ({
  p: [a.position[i * 3], a.position[i * 3 + 1], a.position[i * 3 + 2]], n: [a.normal[i * 3], a.normal[i * 3 + 1], a.normal[i * 3 + 2]],
  sheet: [a.sheet[i * 3], a.sheet[i * 3 + 1], a.sheet[i * 3 + 2]], A: [a.faceA[i * 3], a.faceA[i * 3 + 1], a.faceA[i * 3 + 2]], B: [a.faceB[i * 3], a.faceB[i * 3 + 1], a.faceB[i * 3 + 2]],
  kind: a.kind[i],
});

describe('buildStoneChunk', () => {
  it('gives the quads the world mesh gave: 8 floors, a top and 2 face quads on each of 4 sides', () => {
    const { a } = build(ring());
    expect(a.count).toBe((8 + 1 + 8) * 6);
    const kinds = [0, 0, 0];
    for (let q = 0; q < a.count / 6; q++) kinds[a.kind[q * 6]]++;
    expect(kinds).toEqual([8, 8, 1]);
    // the top: y = WALL_H over the cell (1, 1), normal up
    const top = Array.from({ length: a.count }, (_, i) => vertex(a, i)).filter((v) => v.kind === KIND.top);
    expect(top.length).toBe(6);
    for (const v of top) {
      expect(v.p[1]).toBe(WALL_H);
      expect(v.n).toEqual([0, 1, 0]);
      expect(v.p[0]).toBeGreaterThanOrEqual(1);
      expect(v.p[0]).toBeLessThanOrEqual(2);
    }
    // the south face (side 0): normal +z at z = 2
    const south = Array.from({ length: a.count }, (_, i) => vertex(a, i)).filter((v) => v.kind === KIND.face && v.n[2] === 1);
    expect(south.length).toBe(12);
    for (const v of south) expect(v.p[2]).toBe(2);
    expect(new Set(south.map((v) => v.p[1]))).toEqual(new Set([0, 1, 2]));
  });

  it('a floor vertex\'s sheet is its world px in the chunk\'s layer', () => {
    const m = new TileMap(32, 16, new Uint8Array(32 * 16).fill(TILE_ID.Floor));
    const { a, plan } = build(m, 1, 0);
    expect(plan.groundOf(1, 0)).toBe(1);
    for (let i = 0; i < a.count; i++) {
      const v = vertex(a, i);
      expect(v.sheet).toEqual([(v.p[0] - CHUNK) * 32, v.p[2] * 32, 1]);
      expect(v.A[2]).toBe(-1);
      expect(v.B[2]).toBe(-1);
    }
    expect(Array.from(a.push).every((x) => x === 0)).toBe(true);
    expect(a.index.length).toBe(a.count);
  });

  it('a face vertex\'s faceA or faceB lies inside its slot with v = 0 at the wall\'s top', () => {
    const m = ring();
    const { a, plan } = build(m);
    let seen = 0;
    for (let i = 0; i < a.count; i++) {
      const v = vertex(a, i);
      if (v.kind !== KIND.face) continue;
      seen++;
      const side = v.n[2] === 1 ? 0 : v.n[2] === -1 ? 1 : v.n[0] === 1 ? 2 : 3;
      const slot = plan.slotOf({ x: 1, z: 1, side: side as 0 | 1 | 2 | 3 });
      const own = side < 2 ? v.A : v.B, other = side < 2 ? v.B : v.A;
      expect(other[2]).toBe(-1);
      expect(own[2]).toBe(slot.layer);
      expect(own[0]).toBeGreaterThanOrEqual(slot.u);
      expect(own[0]).toBeLessThanOrEqual(slot.u + FACE_W);
      expect(own[1]).toBeGreaterThanOrEqual(slot.v);
      expect(own[1]).toBeLessThanOrEqual(slot.v + FACE_H);
      // v = 0 (the slot's top) at y = WALL_H, a tile (32 px) per unit of height down
      expect(own[1]).toBe(slot.v + (WALL_H - v.p[1]) * 32);
      // u grows with +x on sides 0 and 1, +z on sides 2 and 3
      expect(own[0]).toBe(slot.u + (side < 2 ? v.p[0] - 1 : v.p[2] - 1) * FACE_W);
    }
    expect(seen).toBe(48);
  });

  it('leaves cells to another mesh when asked, and a chunk of only Void ground layer -1', () => {
    const m = new TileMap(2, 1, Uint8Array.from([TILE_ID.Floor, TILE_ID.Void]));
    const plan = planSheets(m);
    const skipped = buildStoneChunk(m, stoneField(m), plan, noMarks(), 0, 0, (x) => x === 0);
    expect(skipped.count).toBe(18); // the Void's top and its west face (2 quads); no floor quad
    const v = new TileMap(1, 1, Uint8Array.from([TILE_ID.Void]));
    const all = buildStoneChunk(v, stoneField(v), planSheets(v), noMarks(), 0, 0);
    expect(all.sheet[2]).toBe(-1);
  });
});
