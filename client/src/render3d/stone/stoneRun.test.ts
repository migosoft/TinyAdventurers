import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import type { View, WorldInput } from '../view';
import { stoneField } from './field';
import { PAGE } from './format';
import { planSheets, type SheetPlan } from './plan';
import { makeSheets, type Sheets } from './sheets';
import { makeStoneRun } from './stoneRun';

function level() {
  const map = new TileMap(32, 16, new Uint8Array(32 * 16).fill(TILE_ID.Floor));
  map.set(20, 5, TILE_ID.Wall);
  return map;
}
/** The part of a View the run reads: the stone and `setStonePages` (which writes through the real sheets). */
function fakeView(map: TileMap, plan: SheetPlan = planSheets(map)): View & { sheets: Sheets } {
  const sheets = makeSheets(plan, { size: 4096, layers: 256 });
  return {
    stone: { plan, sheets }, sheets,
    setStonePages(this: { stone: { sheets: Sheets } }, r: { pages: { layer: number; px: Uint8Array }[]; faces: { slot: { layer: number; u: number; v: number }; px: Uint8Array }[] }) {
      // the view's current sheets (a replan swaps them)
      for (const p of r.pages) this.stone.sheets.setPage('ground', p.layer, p.px);
      for (const f of r.faces) this.stone.sheets.setFace(f.slot, f.px);
    },
  } as unknown as View & { sheets: Sheets };
}
const run = (map: TileMap) => makeStoneRun({ map, painted: false, clear: 'stone', stone: stoneField(map) } satisfies WorldInput, { x: 24, z: 8 });
const drain = (r: ReturnType<typeof run>, v: View) => { for (let i = 0; i < 2000 && !r.done; i++) r.frame(v); };

describe('makeStoneRun', () => {
  it('does nothing for a world without stone', () => {
    const map = level();
    const r = makeStoneRun({ map, painted: true, clear: [0, 0, 0], stone: null }, { x: 0, z: 0 });
    expect(r.done).toBe(true);
    expect(() => r.frame(null)).not.toThrow();
  });

  it('paints every page into the view\'s sheets over the frames', () => {
    const map = level();
    const r = run(map), v = fakeView(map);
    r.built(v);
    expect(r.done).toBe(false);
    drain(r, v);
    expect(r.done).toBe(true);
    expect(v.sheets.painted.ground).toEqual(new Set([0, 1]));
    expect(v.sheets.painted.wall.size).toBe(1);
  });

  it('waits while the view is being rebuilt', () => {
    const map = level();
    const r = run(map), v = fakeView(map);
    r.built(v);
    r.frame(null);
    expect(v.sheets.painted.ground.size).toBe(0);
  });

  it('a view rebuilt with the same layout takes over the painted pages and the job goes on', () => {
    const map = level();
    const r = run(map), a = fakeView(map);
    r.built(a);
    for (let i = 0; i < 20 && a.sheets.painted.ground.size === 0; i++) r.frame(a);
    const had = new Set(a.sheets.painted.ground);
    expect(had.size).toBeGreaterThan(0);
    const b = fakeView(map);
    r.built(b);
    expect(b.sheets.painted.ground).toEqual(had);
    expect((b.sheets.ground.image.data as Uint8Array)[PAGE * PAGE * 4 * [...had][0]]).toBe((a.sheets.ground.image.data as Uint8Array)[PAGE * PAGE * 4 * [...had][0]]);
    drain(r, b);
    expect(b.sheets.painted.ground).toEqual(new Set([0, 1]));
  });

  it('a view with another plan object (a replan) starts the job over on the new plan', () => {
    const map = level();
    const r = run(map), a = fakeView(map);
    r.built(a);
    drain(r, a);
    map.set(20, 5, TILE_ID.Floor); // the wall goes: no wall page any more
    const b = fakeView(map);
    (a as unknown as { stone: unknown }).stone = b.stone; // the same view object, its sheets and plan replaced (as `tileChanged` does)
    r.frame(a);
    expect(r.done).toBe(false);
    for (let i = 0; i < 2000 && !r.done; i++) r.frame(a);
    expect(b.sheets.painted.ground).toEqual(new Set([0, 1]));
    expect(b.sheets.painted.wall.size).toBe(0);
  });
});
