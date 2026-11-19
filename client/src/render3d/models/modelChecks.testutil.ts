// Checks on a built model that the model tests share.

import { expect } from 'vitest';
import { STAGES } from './bones';
import type { FigureModel } from './model';

/** The streams are as long as the vertex count says, the index stays inside it, and the ranges tile the index by stage, hulls first. */
export function expectStreams(m: FigureModel): void {
  const n = m.position.length / 3;
  expect(m.normal.length).toBe(n * 3);
  expect(m.uv.length).toBe(n * 2);
  expect(m.skin.length).toBe(n * 4);
  expect(m.look.length).toBe(n * 4);
  for (const i of m.index) expect(i).toBeLessThan(n);
  expect(m.pieceIndex.length + m.lineIndex.length).toBe(m.index.length);
  let at = 0, lastStage = -1, hullSeen = false;
  for (const r of m.ranges) {
    expect(r.start).toBe(at); at += r.count;
    expect(r.stage).toBeGreaterThanOrEqual(lastStage);
    if (r.stage !== lastStage) hullSeen = false;
    if (r.line) { expect(hullSeen, 'hull after a piece').toBe(false); } else hullSeen = true;
    lastStage = r.stage;
  }
  expect(at).toBe(m.index.length);
  expect(lastStage).toBeLessThan(STAGES.length);
}

export function expectFinite(m: FigureModel): void {
  for (const arr of [m.position, m.normal, m.pivots]) expect(arr.every(Number.isFinite)).toBe(true);
  for (const bd of m.bends) {
    const nums = [bd.bone, ...bd.origin, ...bd.dir, bd.len, bd.k, bd.up, bd.wag, ...(bd.flutter ? [bd.flutter.rate, bd.flutter.angle] : [])];
    expect(nums.every(Number.isFinite), JSON.stringify(bd)).toBe(true);
  }
}
