import { describe, expect, it } from 'vitest';
import { CONST, TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { bedAt, LAVA_LEVEL, WATER_LEVEL } from './shape';
import {
  followT, stepSwimY, swimDepth, SWIM,
  DROWN_SINK, FALL_G, FALL_RADIUS, FALL_GONE, FALL_MAX_AGE, LAVA_SINK, type Faller, SLIDE_MAX, drownY, sinkCell, standY, startFall, stepFall, stepLavaSink,
} from './descent';

const DROWN_TIME = CONST.DROWN_TIME;

function block3(): (x: number, z: number) => number {
  const w = 10, h = 10;
  const tiles = new Uint8Array(w * h).fill(TILE_ID.Floor);
  for (let j = 3; j < 6; j++) for (let i = 3; i < 6; i++) tiles[j * w + i] = TILE_ID.Chasm;
  const map = new TileMap(w, h, tiles);
  return (x, z) => bedAt(map, x, z);
}

/** Steps a faller to the end, checking every step: never in rock (also on the step that returns false), no drop beyond free fall. */
function run(bed: (x: number, z: number) => number, f: Faller, dt: number) {
  let time = 0, minVy = 0, steps = 0, gone = false;
  for (;;) {
    const y0 = f.y, vy0 = f.vy;
    const alive = stepFall(f, dt, bed);
    expect(bed(f.x, f.z)).toBeLessThanOrEqual(f.y + 1e-6);
    expect(y0 - f.y).toBeLessThanOrEqual(Math.abs(vy0) * dt + 0.5 * FALL_G * dt * dt + 1e-6);
    minVy = Math.min(minVy, f.vy);
    if (!alive) { gone = f.y <= -FALL_GONE + 1e-9; break; }
    time += dt;
    if (++steps > 2000) throw new Error('never gone');
  }
  return { time, minVy, gone };
}

describe('descent', () => {
  it('drops with gravity over the hole', () => {
    const f = startFall(5.5, 5.5, 0, 1, 0);
    for (let i = 0; i < 60; i++) stepFall(f, 1 / 60, () => -12);
    expect(Math.abs(f.y + 7)).toBeLessThan(0.2);
    expect(f.x).toBeCloseTo(5.5 + 1, 1);
  });

  it('is gone before the bottom', () => {
    const f = startFall(5.5, 5.5, 0, 0, 0);
    let t = 0;
    while (stepFall(f, 1 / 60, () => -12)) t += 1 / 60;
    expect(f.y).toBeLessThanOrEqual(-FALL_GONE + 1e-9);
    expect(t).toBeGreaterThan(1.2);
    expect(t).toBeLessThan(1.4);
  });

  it('gives up after FALL_MAX_AGE', () => {
    const f = startFall(5.5, 5.5, 0, 0, 0);
    let t = 0, low = 0;
    while (stepFall(f, 1 / 60, () => 0)) { t += 1 / 60; low = Math.min(low, f.y); }
    expect(t).toBeGreaterThan(FALL_MAX_AGE - 0.05);
    expect(t).toBeLessThan(FALL_MAX_AGE + 0.05);
    expect(low).toBe(0);
  });

  it('caps the slide', () => {
    const f = startFall(0, 0, 0, 30, 40);
    expect(Math.hypot(f.vx, f.vz)).toBeCloseTo(SLIDE_MAX);
  });

  it('never enters rock', () => {
    // A chasm strip one cell wide (column 5) through floor; the faller starts mid-strip, sliding across it.
    const w = 11, h = 11;
    const tiles = new Uint8Array(w * h).fill(TILE_ID.Floor);
    for (let j = 0; j < h; j++) tiles[j * w + 5] = TILE_ID.Chasm;
    const map = new TileMap(w, h, tiles);
    const bed = (x: number, z: number) => bedAt(map, x, z);
    // Across from the middle, from near one bank toward the other, and diagonally.
    const starts: [number, number, number, number][] = [
      [5.5, 5.5, SLIDE_MAX, 0], [5.05, 5.5, SLIDE_MAX, 0], [5.95, 5.5, -SLIDE_MAX, 0],
      [5.1, 5.5, 2.1, 2.1], [5.9, 4.5, -2.1, 2.1], [5.5, 5.5, 0, SLIDE_MAX],
    ];
    for (const dt of [1 / 60, 0.05]) {
      for (const [x, z, vx, vz] of starts) {
        const r = run(bed, startFall(x, z, 0, vx, vz), dt);
        expect(r.gone).toBe(true);
      }
    }
  });

  it('keeps its body (FALL_RADIUS) out of the walls of a chasm one cell wide', () => {
    const w = 11, h = 11;
    const tiles = new Uint8Array(w * h).fill(TILE_ID.Floor);
    for (let j = 0; j < h; j++) tiles[j * w + 5] = TILE_ID.Chasm;
    const map = new TileMap(w, h, tiles);
    const bed = (x: number, z: number) => bedAt(map, x, z);
    const starts: [number, number, number, number][] = [
      [5.5, 5.5, SLIDE_MAX, 0], [5.5, 5.5, -SLIDE_MAX, 0], [5.05, 5.5, SLIDE_MAX, 0], [5.95, 5.5, -SLIDE_MAX, 0],
      [5.1, 5.5, 2.1, 2.1], [5.9, 4.5, -2.1, 2.1], [5.5, 5.5, 2.1, 2.1], [5.05, 5.5, 0, 0], [5.95, 5.5, 0, 0], [5.05, 5.5, -1, 2], [5.5, 5.5, 0, SLIDE_MAX],
    ];
    for (const dt of [1 / 60, 0.05]) {
      for (const [x, z, vx, vz] of starts) {
        const f = startFall(x, z, Math.max(0, bed(x, z)), vx, vz);
        let steps = 0;
        const tag = `${x},${z} v ${vx},${vz} dt ${dt}`;
        while (stepFall(f, dt, bed)) {
          if (f.y < -1) {
            for (const dx of [-FALL_RADIUS, 0, FALL_RADIUS]) expect(bed(f.x + dx, f.z), `${tag} at y ${f.y.toFixed(2)} dx ${dx}`).toBeLessThanOrEqual(f.y + 1e-6);
          }
          if (++steps > 2000) throw new Error('never gone');
        }
        expect(f.y, tag).toBeLessThanOrEqual(-FALL_GONE + 1e-9);   // it went down, not stuck on a ledge until FALL_MAX_AGE
      }
    }
  });

  it('keeps its body off a convex rock corner of an L-shaped chasm two cells wide', () => {
    const w = 14, h = 14;
    const tiles = new Uint8Array(w * h).fill(TILE_ID.Floor);
    for (let j = 5; j <= 11; j++) for (let i = 2; i <= 3; i++) tiles[j * w + i] = TILE_ID.Chasm;   // the vertical arm
    for (let j = 5; j <= 6; j++) for (let i = 2; i <= 10; i++) tiles[j * w + i] = TILE_ID.Chasm;   // the horizontal arm
    const map = new TileMap(w, h, tiles);
    const bedM = (x: number, z: number) => bedAt(map, x, z);
    const R = FALL_RADIUS;
    const starts: [number, number, number, number][] = [[2.05, 8.95, 2.1, -2.1]];   // the case that clipped the corner at (4, 7)
    for (let x = 2.05; x < 4; x += 0.3) for (let z = 7.05; z < 12; z += 0.45) for (const [a, b] of [[1, -1], [1, 0], [0, -1], [-1, -1], [1, 1]]) starts.push([x, z, a * 2.1, b * 2.1]);
    for (const dt of [1 / 60]) {
      for (const [x, z, vx, vz] of starts) {
        const f = startFall(x, z, 0, vx, vz);
        let steps = 0;
        while (stepFall(f, dt, bedM)) {
          if (f.y < -1) {
            for (const [dx, dz] of [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R], [R, R], [R, -R], [-R, R], [-R, -R]]) {
              const b = bedM(f.x + dx, f.z + dz);
              if (b > f.y + 1e-6) expect(b, `${x},${z} dt ${dt} at ${f.x.toFixed(2)},${f.z.toFixed(2)} y ${f.y.toFixed(2)} d ${dx},${dz}`).toBeLessThanOrEqual(f.y + 1e-6);
            }
          }
          if (++steps > 2000) throw new Error('never gone');
        }
        expect(f.y).toBeLessThanOrEqual(-FALL_GONE + 1e-9);
      }
    }
  });

  it('slides off a rim first', () => {
    // 3x3 chasm block; start on its rounded outer corner, where the bed is about 0.
    const w = 10, h = 10;
    const tiles = new Uint8Array(w * h).fill(TILE_ID.Floor);
    for (let j = 3; j < 6; j++) for (let i = 3; i < 6; i++) tiles[j * w + i] = TILE_ID.Chasm;
    const map = new TileMap(w, h, tiles);
    const bed = (x: number, z: number) => bedAt(map, x, z);
    const sx = 3.08, sz = 3.08;
    expect(Math.abs(bed(sx, sz))).toBeLessThan(0.1);
    const f = startFall(sx, sz, bed(sx, sz), 0, 0);
    const d0 = Math.hypot(f.x - f.cx, f.z - f.cz);
    expect(stepFall(f, 1 / 60, bed)).toBe(true);
    // First step: pulled toward the cell centre, still standing on the bed.
    expect(Math.hypot(f.x - f.cx, f.z - f.cz)).toBeLessThan(d0);
    expect(f.y).toBeGreaterThanOrEqual(bed(f.x, f.z));
    expect(f.y).toBeGreaterThan(-0.05);
    expect(f.vy).toBe(0);
    const r = run(bed, startFall(sx, sz, bed(sx, sz), 0, 0), 1 / 60);
    expect(r.gone).toBe(true);
    expect(r.minVy).toBeLessThan(0);
  });

  it('reaches the hole from the outer corner cell', () => {
    const bed = block3();
    for (const [x, z] of [[3.05, 3.05], [3.05, 5.95], [3.15, 3.05], [5.95, 5.95]]) {
      const r = run(bed, startFall(x, z, Math.max(0, bed(x, z)), 0, 0), 1 / 60);
      expect(r.gone).toBe(true);
      expect(r.time).toBeLessThan(2);
      expect(r.minVy).toBeLessThan(0);
    }
  });

  it('never ages out or jumps from any start in a 3x3 chasm', () => {
    const bed = block3();
    for (const dt of [1 / 60, 0.05]) {
      for (let x = 3.05; x < 6; x += 0.15) {
        for (let z = 3.05; z < 6; z += 0.15) {
          const r = run(bed, startFall(x, z, Math.max(0, bed(x, z)), 0, 0), dt);
          expect(r.gone, `${x.toFixed(2)},${z.toFixed(2)} dt ${dt}`).toBe(true);
          expect(r.time).toBeLessThan(FALL_MAX_AGE);
        }
      }
    }
  }, 30000);   // a grid scan with a check per step; stepFall makes about twice as many bed() calls since the body radius

  it('drowns onto the bed', () => {
    expect(drownY(-0.3, -2.3, 0)).toBe(-0.3);
    expect(drownY(-0.3, -2.3, DROWN_SINK)).toBe(-2.3);
    expect(drownY(-0.3, -2.3, 9)).toBe(-2.3);
    expect(DROWN_SINK).toBeLessThan(DROWN_TIME);
    let prev = -0.3;
    for (let i = 1; i <= 20; i++) {
      const y = drownY(-0.3, -2.3, (DROWN_SINK * i) / 20);
      expect(y).toBeLessThanOrEqual(prev);
      prev = y;
    }
    // Ease-in: it accelerates (less than half the way down at half the time) and rests on the bed from DROWN_SINK on.
    expect(drownY(0, -2, DROWN_SINK / 2)).toBeCloseTo(-0.5, 9);
    expect(drownY(0, -2, DROWN_SINK + 0.01)).toBe(-2);
  });

  it('sinks slowly in lava and rises fast', () => {
    let s = 0;
    const goal = LAVA_SINK;
    for (let i = 0; i < 60; i++) s = stepLavaSink(s, goal, 1 / 60);
    // after a second about 42 % of the way down (1 - exp(-0.55))
    expect(s / goal).toBeGreaterThan(0.3);
    expect(s / goal).toBeLessThan(0.6);
    for (let i = 0; i < 300; i++) s = stepLavaSink(s, goal, 1 / 60);
    expect(Math.abs(s - goal)).toBeLessThan(0.05);
    for (let i = 0; i < 60; i++) s = stepLavaSink(s, 0, 1 / 60);
    expect(s).toBeLessThan(0.1);
  });

  it('settles at LAVA_SINK', () => {
    expect(LAVA_SINK).toBe(0.7);
    let s = 0;
    for (let i = 0; i < 600; i++) s = stepLavaSink(s, LAVA_SINK, 1 / 60);
    expect(Math.abs(s - LAVA_SINK)).toBeLessThan(0.01);
  });

  it('stands on the bed or floats', () => {
    expect(standY(-0.4, null)).toBe(-0.4);
    expect(standY(-1.7, 1.05)).toBeCloseTo(LAVA_LEVEL - 1.05);
    expect(standY(-0.1, 1.05)).toBe(-0.1);
  });

  it('chooses the sink cell: none on a chasm cell or far from one, else the chasm cell the velocity points into', () => {
    const m = new TileMap(8, 8, new Uint8Array(64).fill(TILE_ID.Floor));
    m.set(4, 3, TILE_ID.Chasm); m.set(2, 3, TILE_ID.Chasm);
    expect(sinkCell(m, 4.5, 3.5, 0, 0)).toBeNull();
    expect(sinkCell(m, 6.5, 6.5, 1, 0)).toBeNull();
    expect(sinkCell(m, 3.5, 3.5, 3, 0)).toEqual({ cx: 4.5, cz: 3.5 });
    expect(sinkCell(m, 3.5, 3.5, -3, 0)).toEqual({ cx: 2.5, cz: 3.5 });
    expect(startFall(3.5, 3.5, 0, 0, 0, { cx: 4.5, cz: 3.5 }).cx).toBe(4.5);
  });
});

describe('swimming (#448)', () => {
  const HU = CONST.HEAD_UNDER, DEEP = -2.3, H = 1.2;
  it('starts as wading, floats chin-deep, is fully under by HEAD_UNDER, and never leaves the bed', () => {
    expect(swimDepth(0, -0.3, H)).toBeCloseTo(WATER_LEVEL + 0.3, 9);   // the feet on the bed, as wading
    expect(swimDepth(0, DEEP, H)).toBeCloseTo(H * SWIM.chin, 9);
    expect(swimDepth(HU, DEEP, H)).toBeGreaterThanOrEqual(H);
    expect(swimDepth(0.6 * HU, DEEP, H)).toBeGreaterThanOrEqual(H * 0.95);   // the head about at the surface by 0.6 HEAD_UNDER
    expect(swimDepth(9, DEEP, H)).toBeCloseTo(H + SWIM.margin, 9);
    expect(swimDepth(HU, -0.4, H)).toBeCloseTo(WATER_LEVEL + 0.4, 9);   // a shallow bed holds it
  });

  it('is continuous and monotone in t, at most 0.05 tiles per 0.01 s', () => {
    let prev = swimDepth(0, DEEP, H);
    for (let t = 0.01; t <= 2; t += 0.01) {
      const d = swimDepth(t, DEEP, H);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(d - prev).toBeLessThan(0.05);
      prev = d;
    }
  });

  it('a clock fed in 0.1 s snapshot steps sinks without a visible step per frame', () => {
    let local: number | null = null, prev: number | null = null;
    for (let f = 0; f < 150; f++) {
      const target = Math.round((f / 60) * 10) / 10 + 0.1;   // the byte: 0.1 s steps, a little ahead
      local = followT(local, target, 1 / 60);
      const y = swimDepth(local, DEEP, H);
      if (prev !== null) expect(Math.abs(y - prev)).toBeLessThan(0.05);
      prev = y;
    }
    expect(followT(null, 0.7, 1 / 60)).toBe(0.7);
    expect(followT(0.2, 1.7, 1 / 60)).toBe(1.7);   // far off: jumps
  });

  it('leaving fully under over a bed 0.4 tiles higher: a gentle rise (under 0.02 a frame), at the bed within a second', () => {
    let y = WATER_LEVEL - swimDepth(HU, DEEP, H);
    const bed = y + 0.4;
    let f = 0;
    for (; f < 120 && y < bed; f++) {
      const n = stepSwimY(y, bed, bed - 0.4, 1 / 60);
      expect(n - y).toBeLessThan(0.02);
      y = n;
    }
    expect(y).toBeCloseTo(bed, 6);
    expect(f).toBeLessThan(60);
  });

  it('rises out along the bed: no jump over 0.1 tiles per frame, never below the bed', () => {
    let y = WATER_LEVEL - swimDepth(HU, DEEP, H);
    for (let f = 0; f < 120; f++) {
      const bed = Math.min(0, -2.2 + f * 0.03);   // the slope up to the shore
      const n = stepSwimY(y, bed, bed, 1 / 60);
      expect(Math.abs(n - y)).toBeLessThan(0.1);
      expect(n).toBeGreaterThanOrEqual(bed);
      y = n;
    }
    expect(y).toBe(0);
  });
});
