import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { FACE_H, FACE_W, PAGE } from './format';
import { stoneField } from './field';
import { noMarks } from './place';
import { planSheets } from './plan';
import { STAND_IN, GRID_SHARE, paintFace, paintGroundRows } from './paint';
import { STONE_BUDGET_MS, stoneJob, type StoneJob } from './stoneJob';

/** 48 by 16: three chunks in a row, a wall cell in each. */
function level() {
  const map = new TileMap(48, 16, new Uint8Array(48 * 16).fill(TILE_ID.Floor));
  for (const x of [5, 21, 37]) map.set(x, 8, TILE_ID.Wall);
  return map;
}
const job = (spawn = { x: 40, z: 8 }): { j: StoneJob; plan: ReturnType<typeof planSheets> } => {
  const map = level();
  const plan = planSheets(map);
  return { j: stoneJob(stoneField(map), map, plan, noMarks(), spawn), plan };
};
/** A clock that advances `tick` ms per reading. */
const clock = (tick: number) => { let t = 0; return () => (t += tick); };

describe('stoneJob', () => {
  it('runs at least one unit per step and stops at the budget', () => {
    // The spawn chunk's page is 16 row units. With no budget each step runs exactly one unit: the page comes with the 16th step.
    const { j } = job();
    for (let i = 0; i < 15; i++) expect(j.step(0, clock(1)).pages.length).toBe(0);
    expect(j.step(0, clock(1)).pages.length).toBe(1);
    // A 1 ms clock and a 3 ms budget: the first reading is the start, then units run until 3 ms have passed (3 units).
    const { j: k } = job();
    for (let i = 0; i < 5; i++) k.step(3, clock(1)); // 15 units
    expect(k.step(0, clock(1)).pages.length).toBe(1); // the 16th
    expect(j.done).toBe(false);
  });

  it('finishes the spawn chunk first', () => {
    const { j, plan } = job({ x: 40, z: 8 });
    let first: number | null = null;
    while (!j.done && first === null) {
      const r = j.step(1000, clock(0.001));
      if (r.pages.length) first = r.pages[0].layer;
      if (first === null && j.done) break;
    }
    expect(first).toBe(plan.groundOf(2, 0));
  });

  it('gives every planned page and face exactly once, then nothing', () => {
    const { j, plan } = job();
    const pages: number[] = [], faces: string[] = [];
    for (let i = 0; i < 1000 && !j.done; i++) {
      const r = j.step(4, clock(1));
      pages.push(...r.pages.map((p) => p.layer));
      faces.push(...r.faces.map((f) => `${f.slot.layer}:${f.slot.u}:${f.slot.v}`));
    }
    expect(j.done).toBe(true);
    expect(pages.sort()).toEqual(Array.from({ length: plan.groundLayers }, (_, i) => i));
    expect(new Set(faces).size).toBe(faces.length);
    expect(faces.length).toBe(12);
    const after = j.step(4, clock(1));
    expect(after).toEqual({ pages: [], faces: [] });
  });

  it('the budget constant is the plan\'s 4 ms', () => {
    expect(STONE_BUDGET_MS).toBe(4);
  });
});

describe('the stand-in painter', () => {
  it('paints the laid colour with a darker line at every tile edge, rows by rows', () => {
    const map = level();
    const f = stoneField(map);
    const out = new Uint8Array(PAGE * PAGE * 4);
    paintGroundRows(f, map, noMarks(), 0, 0, 32, 64, out);
    const at = (x: number, y: number) => out[(y * PAGE + x) * 4];
    expect(at(10, 40)).toBe(STAND_IN.laid[0]);
    expect(at(0, 40)).toBe(Math.floor(STAND_IN.laid[0] * GRID_SHARE));
    expect(at(10, 32)).toBe(Math.floor(STAND_IN.laid[0] * GRID_SHARE));
    expect(at(10, 10)).toBe(0); // row 10 is not in the asked rows
  });

  it('paints a face of FACE_W by FACE_H with its own line at u 0 and every tile of v', () => {
    const map = level();
    const out = new Uint8Array(FACE_W * FACE_H * 4);
    paintFace(stoneField(map), map, noMarks(), { x: 5, z: 8, side: 0 }, out);
    expect(out[(10 * FACE_W + 10) * 4]).toBe(STAND_IN.laid[0]);
    expect(out[(10 * FACE_W) * 4]).toBe(Math.floor(STAND_IN.laid[0] * GRID_SHARE));
    expect(out[(32 * FACE_W + 10) * 4]).toBe(Math.floor(STAND_IN.laid[0] * GRID_SHARE));
  });
});
