import { describe, expect, it, vi } from 'vitest';
import { KIND, TILE_ID } from '../../generated/defs';
import { FIGURES } from '../../game/anim/defs';
import { TILE } from '../../sim/map';
import { TileMap } from '../../sim/map';
import { View } from '../../sim/view';
import type { DrawnFig } from '../fx/types';
import { LAVA_LEVEL, isLava, maskAt } from '../dips/shape';
import { SightMask, hiddenAt, type SightLook } from '../sightmask';
import { BUBBLE, BUBBLE_CAP, Bubbles } from './bubbles';
import { LAVA, Lava3d, STIR_CAP, type LavaIn } from './lava';

const T = TILE_ID;
const room = (w: number, h: number, cells: [number, number, number][] = []): TileMap => {
  const t = new Uint8Array(w * h).fill(T.Floor);
  for (const [x, z, id] of cells) t[z * w + x] = id;
  return new TileMap(w, h, t);
};
const block = (x0: number, z0: number, w: number, h: number, id: number = T.Lava): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let z = z0; z < z0 + h; z++) for (let x = x0; x < x0 + w; x++) out.push([x, z, id]);
  return out;
};
/** A 5 x 4 pool in a 12 x 8 room. */
const poolRoom = (): TileMap => room(12, 8, block(3, 2, 5, 4));
const fig = (id: number, x: number, z: number, o: Partial<DrawnFig> = {}): DrawnFig => ({
  id, kind: KIND.Paladin, x, z, top: 1, foot: -1, hand: [x, 0.6, z], aim: 0, anim: 0, animT: 0, effects: 0, alpha: 1, dashing: false, model: false, side: 0,
  def: FIGURES[KIND.Paladin], yaw: 0, swingY: 0.6, arc: 0, bite: -1, spectre: null, form: 1, rig: null, ...o,
});
const NONE = new Set<number>();
const ALL = { x0: -100, z0: -100, x1: 100, z1: 100 };
const inp = (now: number, dt: number, figs: DrawnFig[] = [], o: Partial<LavaIn> = {}): LavaIn => ({
  dt, now, figs, hidden: NONE, fp: ALL, mask: null, focus: { x: 0, z: 0 }, ...o,
});
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Runs `seconds` of frames, collecting the distinct bubble spots seen in the packed array. */
function run(l: Lava3d, seconds: number, o: Partial<LavaIn> = {}, from = 0, dt = 1 / 60) {
  const spots = new Set<string>();
  let maxLive = 0, last = l.step(inp(from, dt, [], o));
  const n = Math.round(seconds / dt);
  for (let i = 1; i <= n; i++) {
    last = l.step(inp(from + i * dt, dt, [], o));
    maxLive = Math.max(maxLive, last.live);
    for (let s = 0; s < BUBBLE_CAP; s++) if (last.bubbles[s * 4 + 2] >= 0) spots.add(`${last.bubbles[s * 4]},${last.bubbles[s * 4 + 1]}`);
  }
  return { spots, maxLive, last };
}
const mask = (map: TileMap, tx = 0.5, tz = 0.5): SightMask => {
  const look: SightLook = { daylight: false, feather: 0, ramp: 0 };
  const m = new SightMask(map, look);
  const v = new View(map.w, map.h);
  v.compute(map, tx * TILE, tz * TILE, 3, 'hard');
  m.update(v, null, 0);
  return m;
};

describe('Lava3d bubbles', () => {
  it('does nothing on a map without lava', () => {
    const l = new Lava3d(room(8, 8), seeded(1));
    for (let i = 0; i < 600; i++) {
      const r = l.step(inp(i / 60, 1 / 60));
      expect(r.live).toBe(0);
      for (let s = 0; s < STIR_CAP; s++) expect(r.stirs[s * 4 + 2]).toBe(0);
      expect(r.cues.enters.length + r.cues.spray.length + r.cues.burning.length + r.cues.pops.length).toBe(0);
    }
  });

  it('bubbles a pool in view about every 0.6 to 2 s', () => {
    const l = new Lava3d(poolRoom(), seeded(2));
    const { spots } = run(l, 20);
    expect(spots.size).toBeGreaterThanOrEqual(10);
    expect(spots.size).toBeLessThanOrEqual(34);
  });

  it('keeps bubbles away from the banks', () => {
    const cells = [...block(3, 2, 5, 4), ...block(8, 2, 1, 4, T.Wall), ...block(3, 6, 5, 1, T.Chasm), ...block(0, 2, 3, 4, T.ShallowWater)];
    const map = room(12, 8, cells);
    const l = new Lava3d(map, seeded(3));
    const { spots } = run(l, 20);
    expect(spots.size).toBeGreaterThan(5);
    for (const s of spots) {
      const [x, z] = s.split(',').map(Number);
      expect(maskAt(map, x, z, isLava)).toBeGreaterThanOrEqual(LAVA.mask);
    }
  });

  it('never bubbles a pool too small for one', () => {
    // the rim of a lone tile is all bank: its points never reach the mask, and the search ends after `tries`
    const l = new Lava3d(room(6, 6, [[3, 3, T.Lava]]), seeded(4));
    const { spots } = run(l, 20);
    expect(spots.size).toBe(0);
  });

  it('leaves a pool out of view or unseen alone', () => {
    const map = poolRoom();
    const l = new Lava3d(map, seeded(5));
    expect(run(l, 10, { fp: { x0: 50, z0: 50, x1: 60, z1: 60 } }).spots.size).toBe(0);
    const hid = run(l, 10, { mask: mask(map) }, 10);
    expect(hid.spots.size).toBe(0);
    expect(run(l, 10, {}, 20).spots.size).toBeGreaterThan(0);
  });

  it('starts bubbles only on spots that are in view and seen', () => {
    const map = room(24, 8, block(2, 1, 20, 6));
    const m = mask(map, 6.5, 3.5);
    const fp = { x0: 0, z0: 0, x1: 14, z1: 8 };
    const l = new Lava3d(map, seeded(21));
    const { spots } = run(l, 30, { mask: m, fp });
    expect(spots.size).toBeGreaterThan(3);
    for (const s of spots) {
      const [x, z] = s.split(',').map(Number);
      expect(x).toBeLessThanOrEqual(fp.x1 + 1);
      expect(hiddenAt(m, x, z)).toBe(false);
    }
  });

  it('gives two pools their own timers and shares the cap', () => {
    const cells: [number, number, number][] = [];
    for (let k = 0; k < 8; k++) cells.push(...block(1 + (k % 4) * 5, 1 + Math.floor(k / 4) * 5, 3, 3));
    const l = new Lava3d(room(22, 12, cells), seeded(6));
    const { spots, maxLive } = run(l, 10);
    expect(maxLive).toBeLessThanOrEqual(BUBBLE_CAP);
    const pools = new Set<number>();
    for (const s of spots) { const [x, z] = s.split(',').map(Number); pools.add(Math.floor(x / 5) + 4 * Math.floor(z / 5)); }
    expect(pools.size).toBeGreaterThanOrEqual(4);
  });

  it('starts at most one bubble per pool in a long frame', () => {
    const l = new Lava3d(poolRoom(), seeded(7));
    const add = vi.spyOn(Bubbles.prototype, 'add');
    try {
      let started = 0;
      for (let k = 0; k <= 3; k++) {
        add.mockClear();
        l.step(inp(k, 1));
        expect(add.mock.calls.length).toBeLessThanOrEqual(1);
        started += add.mock.calls.length;
      }
      expect(started).toBeGreaterThan(0);
    } finally { add.mockRestore(); }
  });

  it('drops a bubble when its cell is no longer lava', () => {
    const map = poolRoom();
    const l = new Lava3d(map, seeded(8));
    let t = 0, r = l.step(inp(t, 1 / 60));
    while (r.live === 0 && t < 5) { t += 1 / 60; r = l.step(inp(t, 1 / 60)); }
    expect(r.live).toBe(1);
    for (const [x, z] of block(2, 1, 7, 6)) map.set(x, z, T.Floor);
    l.mapChanged();
    t += 1 / 60;
    r = l.step(inp(t, 1 / 60));
    expect(r.live).toBe(0);
    let pops = 0;
    for (let i = 0; i < 180; i++) { t += 1 / 60; pops += l.step(inp(t, 1 / 60)).cues.pops.length; }
    expect(pops).toBe(0);
  });

  it('finds a pool that appears', () => {
    const map = room(12, 8);
    const l = new Lava3d(map, seeded(9));
    expect(run(l, 5).spots.size).toBe(0);
    for (const [x, z, id] of block(4, 2, 4, 4)) map.set(x, z, id);
    l.mapChanged();
    expect(run(l, 10, {}, 5).spots.size).toBeGreaterThan(0);
  });

  it('cues a pop once, at the bubble, when it is seen', () => {
    const l = new Lava3d(poolRoom(), seeded(10));
    let t = 0, r = l.step(inp(t, 1 / 60));
    while (r.live === 0 && t < 5) { t += 1 / 60; r = l.step(inp(t, 1 / 60)); }
    expect(r.live).toBeGreaterThan(0);
    const x = r.bubbles[0], z = r.bubbles[1], born = t;
    const pops: { id: number; x: number; z: number }[] = [];
    while (t < born + BUBBLE.swell + 0.2) {
      t += 1 / 60;
      r = l.step(inp(t, 1 / 60));
      for (const p of r.cues.pops) pops.push({ ...p });
    }
    const mine = pops.filter((p) => Math.abs(p.x - x) < 1e-4 && Math.abs(p.z - z) < 1e-4);
    expect(mine.length).toBe(1);
    expect(mine[0].id).toBe(-1);
  });

  it('still cues the pop of a bubble whose frame jumped past swell and pop while another started', () => {
    const l = new Lava3d(poolRoom(), seeded(12));
    let t = 0, r = l.step(inp(t, 1 / 60));
    while (r.live === 0 && t < 5) { t += 1 / 60; r = l.step(inp(t, 1 / 60)); }
    expect(r.live).toBeGreaterThan(0);
    const x = r.bubbles[0], z = r.bubbles[1];
    t += BUBBLE.swell + BUBBLE.pop + 0.5;
    r = l.step(inp(t, 5));
    expect(r.cues.pops.some((p) => Math.abs(p.x - x) < 1e-4 && Math.abs(p.z - z) < 1e-4)).toBe(true);
  });

  it('makes no pop cue where the mask hides the bubble', () => {
    const map = poolRoom();
    const l = new Lava3d(map, seeded(11));
    // the pool is in view but its bubbles are behind the mask: only the view box says in view, the mask hides every tile
    // so no bubble starts; start them unmasked, then hide them
    let t = 0, r = l.step(inp(t, 1 / 60));
    while (r.live === 0 && t < 5) { t += 1 / 60; r = l.step(inp(t, 1 / 60)); }
    expect(r.live).toBeGreaterThan(0);
    const m = mask(map);
    let pops = 0;
    for (let i = 0; i < 150; i++) { t += 1 / 60; pops += l.step(inp(t, 1 / 60, [], { mask: m })).cues.pops.length; }
    expect(pops).toBe(0);
  });
});

describe('Lava3d figures', () => {
  const stirs = (r: { stirs: Float32Array }) => Array.from({ length: STIR_CAP }, (_, s) => r.stirs[s * 4 + 2]);

  it('opens a ring by the depth of the foot', () => {
    const l = new Lava3d(poolRoom(), seeded(1));
    const at = (foot: number) => l.step(inp(0, 1 / 60, [fig(1, 5.5, 3.5, { foot })])).stirs;
    expect(at(LAVA_LEVEL)[2]).toBe(0);
    expect(at(LAVA_LEVEL - 0.15)[2]).toBeCloseTo(0.5, 5);
    const full = at(LAVA_LEVEL - 1);
    expect(full[2]).toBe(1);
    expect([full[0], full[1]]).toEqual([5.5, 3.5]);
  });

  it('gives no ring to a dasher, a ghost at height 0 or a hidden id', () => {
    const l = new Lava3d(poolRoom(), seeded(1));
    expect(stirs(l.step(inp(0, 1 / 60, [fig(1, 5.5, 3.5, { dashing: true })])))[0]).toBe(0);
    expect(stirs(l.step(inp(0, 1 / 60, [fig(2, 5.5, 3.5, { foot: 0 })])))[0]).toBe(0);
    expect(stirs(l.step(inp(0, 1 / 60, [fig(3, 5.5, 3.5)], { hidden: new Set([3]) })))[0]).toBe(0);
    expect(stirs(l.step(inp(0, 1 / 60, [fig(3, 5.5, 3.5)])))[0]).toBe(1);
  });

  it('keeps the STIR_CAP rings nearest the focus', () => {
    const l = new Lava3d(room(30, 8, block(0, 0, 30, 8)), seeded(1));
    const figs: DrawnFig[] = [];
    for (let k = 0; k < 12; k++) figs.push(fig(k + 1, 0.5 + k * 2, 3.5));
    const r = l.step(inp(0, 1 / 60, figs, { focus: { x: 0, z: 3.5 } }));
    const xs: number[] = [];
    for (let s = 0; s < STIR_CAP; s++) { expect(r.stirs[s * 4 + 2]).toBe(1); xs.push(r.stirs[s * 4]); }
    expect(Math.max(...xs)).toBeLessThanOrEqual(0.5 + 7 * 2);
    expect(new Set(xs).size).toBe(STIR_CAP);
  });

  it('cues an entering once, not for a figure first seen in lava, not for a dash that ends in lava', () => {
    const l = new Lava3d(poolRoom(), seeded(1));
    expect(l.step(inp(0, 1 / 60, [fig(1, 5.5, 3.5)])).cues.enters.length).toBe(0);
    l.step(inp(0, 1 / 60, [fig(2, 1.5, 3.5)]));
    const r = l.step(inp(1 / 60, 1 / 60, [fig(1, 5.5, 3.5), fig(2, 3.5, 3.5)]));
    expect(r.cues.enters.map((e) => e.id)).toEqual([2]);
    expect(l.step(inp(2 / 60, 1 / 60, [fig(1, 5.5, 3.5), fig(2, 3.6, 3.5)])).cues.enters.length).toBe(0);
    const d = new Lava3d(poolRoom(), seeded(1));
    d.step(inp(0, 1 / 60, [fig(1, 1.5, 3.5, { dashing: true })]));
    d.step(inp(1 / 60, 1 / 60, [fig(1, 3.5, 3.5, { dashing: true })]));
    expect(d.step(inp(2 / 60, 1 / 60, [fig(1, 3.6, 3.5)])).cues.enters.length).toBe(0);
  });

  it('sprays under a dash at sprayRate whatever the frame time', () => {
    for (const dt of [1 / 60, 1 / 20]) {
      const l = new Lava3d(poolRoom(), seeded(1));
      let n = 0;
      for (let i = 0; i < Math.round(1 / dt); i++) n += l.step(inp(i * dt, dt, [fig(1, 5.5, 3.5, { dashing: true })])).cues.spray.length;
      expect(Math.abs(n - LAVA.sprayRate)).toBeLessThanOrEqual(1);
    }
  });

  it('lists a hero in lava as burning, a monster not', () => {
    const l = new Lava3d(poolRoom(), seeded(1));
    const r = l.step(inp(0, 1 / 60, [fig(1, 5.5, 3.5), fig(2, 6.5, 3.5, { kind: KIND.SkeletonWarrior })]));
    expect(r.cues.burning.map((b) => b.id)).toEqual([1]);
    expect(l.step(inp(1 / 60, 1 / 60, [fig(1, 1.5, 3.5)])).cues.burning.length).toBe(0);
  });

  it('makes no cue for a hidden id but tracks it', () => {
    const l = new Lava3d(poolRoom(), seeded(1));
    const hid = { hidden: new Set([1]) };
    l.step(inp(0, 1 / 60, [fig(1, 1.5, 3.5)], hid));
    const r = l.step(inp(1 / 60, 1 / 60, [fig(1, 3.5, 3.5)], hid));
    expect(r.cues.enters.length + r.cues.burning.length).toBe(0);
    expect(l.step(inp(2 / 60, 1 / 60, [fig(1, 3.6, 3.5)])).cues.enters.length).toBe(0);
  });

  it('returns the same arrays every call', () => {
    const l = new Lava3d(poolRoom(), seeded(1));
    const a = l.step(inp(0, 1 / 60)), b = l.step(inp(1 / 60, 1 / 60));
    expect(b.bubbles).toBe(a.bubbles);
    expect(b.stirs).toBe(a.stirs);
  });
});
