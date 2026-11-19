import { describe, expect, it } from 'vitest';
import { CONST, TILE_ID } from '../../generated/defs';
import { FIGURES } from '../../game/anim/defs';
import { KIND } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import type { DrawnFig } from '../fx/types';
import { WATER_LEVEL } from '../dips/shape';
import { RIPPLE_CAP } from './ripples';
import { Water3d, WADE, type WaterIn } from './water';

// a 10 x 4 room: floor in the west half, a shallow pool from x = 5
const room = (): TileMap => {
  const t = new Uint8Array(40).fill(TILE_ID.Floor);
  for (let z = 0; z < 4; z++) for (let x = 5; x < 10; x++) t[z * 10 + x] = TILE_ID.ShallowWater;
  return new TileMap(10, 4, t);
};
const fig = (id: number, x: number, z: number, o: Partial<DrawnFig> = {}): DrawnFig => ({
  id, kind: KIND.Paladin, x, z, top: 1, foot: -0.2, hand: [x, 0.6, z], aim: 0, anim: 0, animT: 0, effects: 0, alpha: 1, dashing: false, model: false, side: 0,
  def: FIGURES[KIND.Paladin], yaw: 0, swingY: 0.6, arc: 0, bite: -1, spectre: null, form: 1, ...o,
});
const NONE = new Set<number>();
const inp = (now: number, dt: number, figs: DrawnFig[], o: Partial<WaterIn> = {}): WaterIn => ({ dt, now, figs, sinks: [], landed: null, hidden: NONE, ...o });
const rng = () => 0.5;

describe('Water3d', () => {
  it('rings when a figure walks in', () => {
    const w = new Water3d(room(), rng);
    w.step(inp(0, 1 / 60, [fig(1, 4.5, 2)]));
    const r = w.step(inp(1 / 60, 1 / 60, [fig(1, 5.5, 2)]));
    expect(r.cues.enters.length).toBe(1);
    expect(r.cues.enters[0].id).toBe(1);
    expect(r.live).toBe(1);
    expect(r.ripples.length).toBe(RIPPLE_CAP * 4);
  });

  it('makes no splash for a figure first seen in water', () => {
    const w = new Water3d(room(), rng);
    const r = w.step(inp(0, 1 / 60, [fig(1, 6.5, 2)]));
    expect(r.cues.enters.length).toBe(0);
    expect(r.live).toBe(0);
  });

  it('rings every 0.3 s while wading, none standing still', () => {
    const w = new Water3d(room(), rng);
    let x = 6, live = 0, t = 0;
    w.step(inp(t, 1 / 60, [fig(1, x, 2)]));
    for (let i = 0; i < 60; i++) { t += 1 / 60; x += 1 / 60; live = w.step(inp(t, 1 / 60, [fig(1, x, 2)])).live; }
    expect(live).toBeGreaterThanOrEqual(3);
    expect(live).toBeLessThanOrEqual(4);
    const still = new Water3d(room(), rng);
    let l2 = 0;
    for (let i = 0; i < 120; i++) l2 = still.step(inp(i / 60, 1 / 60, [fig(1, 7, 2)])).live;
    expect(l2).toBe(0);
  });

  it('ignores a ghost and a flier over water', () => {
    const w = new Water3d(room(), rng);
    let x = 4.5, last = w.step(inp(0, 1 / 60, [fig(1, x, 2, { foot: 0 })]));
    for (let i = 1; i <= 60; i++) { x += 0.05; last = w.step(inp(i / 60, 1 / 60, [fig(1, x, 2, { foot: 0 })])); expect(last.cues.enters.length).toBe(0); }
    expect(last.live).toBe(0);
  });

  it('sprays under a dash and makes no ring', () => {
    const w = new Water3d(room(), rng);
    let sprays = 0, live = 0, x = 6;
    for (let i = 0; i < 60; i++) { x += 0.1; const r = w.step(inp(i / 60, 1 / 60, [fig(1, x % 3 + 5.5, 2, { dashing: true })])); sprays += r.cues.spray.length; live = r.live; }
    expect(sprays).toBeGreaterThanOrEqual(28);
    expect(sprays).toBeLessThanOrEqual(32);
    expect(live).toBe(0);
  });

  it('stirs the water where something drowns', () => {
    const w = new Water3d(room(), rng);
    const first = w.step(inp(0, 1 / 60, [], { sinks: [{ id: 9, x: 7, z: 2 }] }));
    expect(first.live).toBe(WADE.plunges);
    expect(first.cues.plunges.length).toBe(1);
    expect(first.cues.plunges[0].id).toBe(9);
    let bubbles = 0, t = 0;
    const n = Math.round(CONST.DROWN_TIME * 60);
    for (let i = 0; i < n + 30; i++) { t += 1 / 60; bubbles += w.step(inp(t, 1 / 60, [])).cues.bubbles.length; }
    expect(bubbles).toBeGreaterThanOrEqual(9);
    expect(bubbles).toBeLessThanOrEqual(13);
    // ripples made over the drowning: count the sources born after the plunge (the buffer holds at most 16: all of them live)
    const w2 = new Water3d(room(), rng);
    w2.step(inp(0, 1 / 60, [], { sinks: [{ id: 9, x: 7, z: 2 }] }));
    let live = 0;
    for (let i = 1; i <= n + 30; i++) live = w2.step(inp(i / 60, 1 / 60, [])).live;
    expect(live - WADE.plunges).toBeGreaterThanOrEqual(6);
    expect(live - WADE.plunges).toBeLessThanOrEqual(9);
    // none after
    const after = w.step(inp(t + 1 / 60, 1 / 60, []));
    expect(after.cues.bubbles.length).toBe(0);
  });

  it('rings where a drip lands', () => {
    const w = new Water3d(room(), rng);
    const pos = new Float32Array([6.5, 1.5, 8.5, 2.5]);
    const r = w.step(inp(0, 1 / 60, [], { landed: { count: 2, pos } }));
    expect(r.live).toBe(2);
    expect(r.ripples[0]).toBeCloseTo(6.5);
    expect(r.ripples[3]).toBeCloseTo(WADE.drip);
  });

  it('stays silent for what the hero cannot see', () => {
    const w = new Water3d(room(), rng);
    const hidden = new Set([1]);
    w.step(inp(0, 1 / 60, [fig(1, 4.5, 2)], { hidden }));
    let r = w.step(inp(1 / 60, 1 / 60, [fig(1, 5.5, 2)], { hidden }));   // enters, hidden
    expect(r.live).toBe(0);
    expect(r.cues.enters.length).toBe(0);
    let x = 5.5, sprays = 0;
    for (let i = 2; i < 70; i++) { x += 0.02; r = w.step(inp(i / 60, 1 / 60, [fig(1, x, 2)], { hidden })); sprays += r.cues.spray.length + r.cues.enters.length; expect(r.live).toBe(0); }
    for (let i = 70; i < 140; i++) { r = w.step(inp(i / 60, 1 / 60, [fig(1, 7, 2, { dashing: true })], { hidden })); sprays += r.cues.spray.length; expect(r.live).toBe(0); }
    expect(sprays).toBe(0);
    // made visible while standing in water: no enters cue
    r = w.step(inp(3, 1 / 60, [fig(1, 7, 2)], { hidden: NONE }));
    expect(r.cues.enters.length).toBe(0);
    r = w.step(inp(3.02, 1 / 60, [fig(1, 7, 2)], { hidden: NONE }));
    expect(r.cues.enters.length).toBe(0);
    // a hidden drowning is silent for its whole time
    const d = new Water3d(room(), rng);
    let total = d.step(inp(0, 1 / 60, [], { sinks: [{ id: 4, x: 7, z: 2 }], hidden: new Set([4]) })).live;
    for (let i = 1; i < 80; i++) { const s = d.step(inp(i / 60, 1 / 60, [], { hidden: new Set([4]) })); total += s.live + s.cues.bubbles.length + s.cues.plunges.length; }
    expect(total).toBe(0);
  });

  it('never holds more than 16', () => {
    const w = new Water3d(room(), rng);
    const figs = (k: number): DrawnFig[] => Array.from({ length: 30 }, (_, i) => fig(i + 1, 6 + (i % 3) * 0.5 + k * 0.02, 0.5 + (i % 3)));
    let max = 0;
    for (let i = 0; i < 120; i++) max = Math.max(max, w.step(inp(i / 60, 1 / 60, figs(i))).live);
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(RIPPLE_CAP);
  });

  it('follows water that appears under a figure', () => {
    const map = room();
    const w = new Water3d(map, rng);
    w.step(inp(0, 1 / 60, [fig(1, 2.5, 2, { foot: 0 })]));
    w.step(inp(1 / 60, 1 / 60, [fig(1, 2.5, 2, { foot: 0 })]));
    map.set(2, 2, TILE_ID.ShallowWater);
    const r = w.step(inp(2 / 60, 1 / 60, [fig(1, 2.5, 2, { foot: WATER_LEVEL - 0.1 })]));
    expect(r.cues.enters.length).toBe(1);
  });

  const dashPath: Array<[string, Array<[number, boolean]>, number]> = [
    ['wading, a dash inside the pool, a stop in the pool', [[6, false], [6.1, false], [6.5, true], [7, true], [7.2, false]], 0],
    ['floor, a dash across the rim, the dash ends in the pool', [[4, false], [4.5, true], [5.5, true], [6, false]], 0],
    ['floor, a dash that ends on the floor, then a walk into the water', [[3, false], [3.5, true], [4, false], [4.5, false], [5.5, false]], 1],
    ['a dash over water that ends on the floor, then a walk back into the water', [[6, false], [5.5, true], [4.5, true], [4, false], [4.5, false], [5.5, false]], 1],
  ];
  it.each(dashPath)('dash and splash: %s', (_name, path, want) => {
    const w = new Water3d(room(), rng);
    let enters = 0;
    path.forEach(([x, dashing], i) => { enters += w.step(inp(i / 60, 1 / 60, [fig(1, x, 2, { dashing })])).cues.enters.length; });
    expect(enters).toBe(want);
  });

  it('reuses its arrays and forgets ids no longer listed', () => {
    const w = new Water3d(room(), rng);
    const a = w.step(inp(0, 1 / 60, [fig(1, 4.5, 2)]));
    const b = w.step(inp(1 / 60, 1 / 60, [fig(1, 5.5, 2)]));
    expect(b.ripples).toBe(a.ripples);
    expect(b.cues).toBe(a.cues);
    expect(b.cues.enters.length).toBe(1);
    const enters = b.cues.enters, spray = b.cues.spray;
    w.step(inp(2 / 60, 1 / 60, []));
    // listed again in the water: counts as first sight, no enter
    const c = w.step(inp(3 / 60, 1 / 60, [fig(1, 6.5, 2)]));
    expect(c.cues.enters.length).toBe(0);
    expect(c.ripples).toBe(a.ripples);
    expect(c.cues.enters).toBe(enters);
    expect(c.cues.spray).toBe(spray);
  });
});
