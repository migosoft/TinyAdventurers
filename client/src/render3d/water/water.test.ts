import { describe, expect, it } from 'vitest';
import { CONST, TILE_ID } from '../../generated/defs';
import { FIGURES } from '../../game/anim/defs';
import { KIND } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import type { DrawnFig } from '../fx/types';
import { WATER_LEVEL, isWater } from '../dips/shape';
import type { PondInfo } from '../../generated/PondInfo';
import demo from '../../generated/pond-demo.json';
import { FISH, FISH_CAP, FISH_STRIDE, Fish } from '../pond/fish';
import { pondField, pondViewMap, setPondField } from '../pond/pondField';
import { MOUTH_RING, RIPPLE_CAP } from './ripples';
import { PUDDLE_STIR, Water3d, WADE, type WaterIn } from './water';

// a 10 x 4 room: floor in the west half, a shallow pool from x = 5
const room = (): TileMap => {
  const t = new Uint8Array(40).fill(TILE_ID.Floor);
  for (let z = 0; z < 4; z++) for (let x = 5; x < 10; x++) t[z * 10 + x] = TILE_ID.ShallowWater;
  return new TileMap(10, 4, t);
};
const fig = (id: number, x: number, z: number, o: Partial<DrawnFig> = {}): DrawnFig => ({
  id, kind: KIND.Paladin, x, z, top: 1, foot: -0.2, hand: [x, 0.6, z], aim: 0, anim: 0, animT: 0, effects: 0, alpha: 1, dashing: false, model: false, side: 0,
  def: FIGURES[KIND.Paladin], yaw: 0, swingY: 0.6, arc: 0, bite: -1, spectre: null, form: 1, rig: null, ...o,
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

  it('a breathing creature in the drowning state sends bubbles that follow it and thicken once its head is under; a breathless one and a wader make none (#448)', () => {
    const run = (swim: { t: number; breathless: boolean } | null, ticks = 120) => {
      const w = new Water3d(room(), rng);
      let n = 0, last: { x: number; z: number } | null = null;
      for (let i = 0; i < ticks; i++) {
        const x = 6 + i * 0.005;
        const r = w.step(inp(i / 60, 1 / 60, [fig(1, x, 2)], { swims: swim ? [{ id: 1, x, z: 2, ...swim }] : [] }));
        n += r.cues.bubbles.length;
        if (r.cues.bubbles.length) last = { x: r.cues.bubbles[r.cues.bubbles.length - 1].x, z: r.cues.bubbles[r.cues.bubbles.length - 1].z };
      }
      return { n, last, x: 6 + (ticks - 1) * 0.005 };
    };
    const early = run({ t: 0.3, breathless: false });
    const under = run({ t: CONST.HEAD_UNDER + 0.5, breathless: false });
    expect(early.n).toBeGreaterThan(0);
    expect(under.n).toBeGreaterThan(early.n * 2);
    expect(Math.abs(under.last!.x - under.x)).toBeLessThan(0.1);   // above its head, following it
    expect(run({ t: 2, breathless: true }).n).toBe(0);
    expect(run(null).n).toBe(0);
  });

  it('a breathing swimmer rings the surface where its bubbles come up; a breathless one makes neither (#448)', () => {
    const live = (breathless: boolean) => {
      const w = new Water3d(room(), rng);
      let bubbles = 0, l = 0;
      for (let i = 0; i < 90; i++) {
        const r = w.step(inp(i / 60, 1 / 60, [fig(1, 6.5, 2)], { swims: [{ id: 1, x: 6.5, z: 2, t: CONST.HEAD_UNDER + 0.5, breathless }] }));
        bubbles += r.cues.bubbles.length; l = r.live;
      }
      return { bubbles, l };
    };
    const a = live(false), b = live(true);
    expect(a.bubbles).toBeGreaterThan(0);
    expect(a.l).toBeGreaterThan(b.l);
    expect(b.bubbles).toBe(0);
  });

  it('rings where a drip lands', () => {
    const w = new Water3d(room(), rng);
    const pos = new Float32Array([6.5, 1.5, 8.5, 2.5]);
    const r = w.step(inp(0, 1 / 60, [], { landed: { count: 2, pos } }));
    expect(r.live).toBe(2);
    expect(r.ripples[0]).toBeCloseTo(6.5);
    expect(r.ripples[3]).toBeCloseTo(WADE.drip);
  });

  it("rings where the pond's life asks for one, with its strength (#360)", () => {
    const w = new Water3d(room(), rng);
    const r = w.step(inp(0, 1 / 60, [], { rings: [6.5, 1.5, 1, 8.5, 2.5, 0.45] }));
    expect(r.live).toBe(2);
    expect(r.ripples[0]).toBeCloseTo(6.5);
    expect(r.ripples[3]).toBeCloseTo(1);
    expect(r.ripples[7]).toBeCloseTo(0.45);
  });

  it("leaves out the life's rings outside the screen's ground, so they take no ripple slot (#360)", () => {
    const w = new Water3d(room(), rng);
    const r = w.step(inp(0, 1 / 60, [], { rings: [6.5, 1.5, 1, 30, 1.5, 1, 6.5, 40, 1], fp: { x0: 0, z0: 0, x1: 12, z1: 8 } }));
    expect(r.live).toBe(1);
    expect(r.ripples[0]).toBeCloseTo(6.5);
    expect(r.ripples[1]).toBeCloseTo(1.5);
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

  it('stirs a puddle with small rings as a figure steps in and walks through, and makes no cue (#401)', () => {
    const w = new Water3d(room(), rng);
    const puddles = [{ x: 2, z: 2, r: 0.6 }], dt = 1 / 60;
    const at = (now: number, x: number, o: Partial<DrawnFig> = {}) => w.step(inp(now, dt, [fig(1, x, 2, { foot: 0, ...o })], { puddles }));
    expect(at(0, 1).live).toBe(0);
    const r = at(dt, 1.8); // stepped in
    expect(r.live).toBe(1);
    expect(r.ripples[3]).toBe(-PUDDLE_STIR.enter);
    expect(r.cues.enters.length).toBe(0);
    expect(at(2 * dt, 1.8).live).toBe(1); // standing still: no more rings
    let now = 2 * dt, x = 1.8;
    for (let k = 0; k < 7; k++) { now += dt; x += 0.1; at(now, x); } // 0.7 tiles on, still inside
    expect(w.step(inp(now, 0, [fig(1, x, 2, { foot: 0 })], { puddles })).live).toBe(3); // walking: a ring every `step` tiles
    // the dry rim, a faller above the puddle and a puddle-less level: nothing
    const dry = new Water3d(room(), rng);
    dry.step(inp(0, dt, [fig(1, 1, 2, { foot: 0 }), fig(2, 1, 2, { foot: 1 }), fig(3, 1, 2, { foot: 0 })], { puddles }));
    expect(dry.step(inp(dt, dt, [fig(1, 2.58, 2, { foot: 0 }), fig(2, 2, 2, { foot: 1 })], { puddles })).live).toBe(0);
    expect(dry.step(inp(2 * dt, dt, [fig(3, 2, 2, { foot: 0 })])).live).toBe(0);
  });
});

describe('Water3d on a woodland pond (#360)', () => {
  /** The view map of demo level `i` with its pond field, as a run sets it up. */
  const pondMap = (i: number) => {
    const l = demo[i], pond = l.woodland!.pond as unknown as PondInfo;
    const rules = new TileMap(l.w, l.h, Uint8Array.from(l.tiles));
    const view = pondViewMap(rules, pond), field = pondField(rules, pond, view);
    setPondField(view, field);
    return { view, field };
  };
  const slots = (r: Float32Array) => Array.from({ length: RIPPLE_CAP }, (_, i) => ({ x: r[i * 4], z: r[i * 4 + 1], age: r[i * 4 + 2], strength: r[i * 4 + 3] }));

  it('a mouth makes rings and leaves slots for waders', () => {
    const { view, field } = pondMap(2);
    expect(field.mouths.length).toBe(1);
    const m = field.mouths[0];
    const w = new Water3d(view, rng);
    const births = new Set<number>();
    for (let k = 0; k <= 720; k++) {
      const now = k / 60, r = w.step(inp(now, 1 / 60, []));
      expect(r.live).toBeLessThanOrEqual(MOUTH_RING.slots);
      if (now > 3) expect(r.live).toBeGreaterThanOrEqual(MOUTH_RING.slots - 1);
      for (const s of slots(r.ripples)) {
        if (s.age < 0) continue;
        births.add(Math.round((now - s.age) * 1000));
        expect(s.strength).toBeCloseTo(MOUTH_RING.strength, 6);
        // just inside the pond from the mouth
        expect(Math.hypot(s.x - (m.x + m.dx * MOUTH_RING.into), s.z - (m.z + m.dz * MOUTH_RING.into))).toBeLessThanOrEqual(MOUTH_RING.scatter + 1e-4);
      }
    }
    // one every 0.5 to 0.9 s
    const at = [...births].sort((a, b) => a - b);
    expect(at.length).toBeGreaterThan(12);
    for (let k = 1; k < at.length; k++) {
      expect(at[k] - at[k - 1]).toBeGreaterThanOrEqual(499);
      expect(at[k] - at[k - 1]).toBeLessThanOrEqual(901);
    }
    // twelve other rings in one frame: all of them find a slot, and the mouth keeps its own
    const n = RIPPLE_CAP - MOUTH_RING.slots;
    const pos = new Float32Array(n * 2).map((_, i) => 500 + i);
    const full = w.step(inp(12.01, 0.01, [], { landed: { count: n, pos } }));
    expect(full.live).toBe(RIPPLE_CAP);
    const xs = slots(full.ripples).map((s) => s.x);
    for (let k = 0; k < n; k++) expect(xs).toContain(500 + 2 * k);
    // ... and the mouth's rings go on without taking a slot from them
    let later = full;
    for (let k = 1; k <= 60; k++) later = w.step(inp(12.01 + k / 60, 1 / 60, []));
    const xs2 = slots(later.ripples).filter((s) => s.age >= 0).map((s) => s.x);
    for (let k = 0; k < n; k++) expect(xs2).toContain(500 + 2 * k);
    expect(later.live).toBe(RIPPLE_CAP);
  });

  it('a pinned clock shows the rings that still live, the same ones every time', () => {
    const { view } = pondMap(1);
    const a = new Water3d(view, rng).step(inp(7.3, 0, [])), b = new Water3d(view, rng).step(inp(7.3, 0, []));
    expect(a.live).toBe(MOUTH_RING.slots);
    expect(Array.from(a.ripples)).toEqual(Array.from(b.ripples));
  });

  it('steps the pond\'s fish with the figures that wade, and hands them on', () => {
    const { view, field } = pondMap(0);
    const w = new Water3d(view, rng);
    const first = Array.from(w.step(inp(0, 0, [])).fish!);
    expect(first.length).toBe(FISH_CAP * FISH_STRIDE);
    expect(first).toEqual(Array.from(new Fish(field, field.seed).positions()));
    // a shallow tile near a fish: a figure standing there scares it, one flying over it does not
    let spot: { x: number; z: number } | null = null;
    for (let i = 0; i < FISH_CAP && !spot; i++) {
      const fx = first[i * FISH_STRIDE], fz = first[i * FISH_STRIDE + 1];
      for (let z = Math.floor(fz) - 2; z <= fz + 2 && !spot; z++) for (let x = Math.floor(fx) - 2; x <= fx + 2; x++) {
        if (view.get(x, z) === TILE_ID.ShallowWater && Math.hypot(x + 0.5 - fx, z + 0.5 - fz) < FISH.scare - 0.3) { spot = { x: x + 0.5, z: z + 0.5 }; break; }
      }
    }
    expect(spot).not.toBeNull();
    const after = (figs: DrawnFig[], hidden = NONE): number[] => {
      const v = new Water3d(view, rng);
      let out = v.step(inp(0, 0, figs, { hidden }));
      for (let k = 1; k <= 30; k++) out = v.step(inp(k / 60, 1 / 60, figs, { hidden }));
      return Array.from(out.fish!);
    };
    const calm = after([]);
    expect(calm).not.toEqual(first);
    expect(after([fig(1, spot!.x, spot!.z, { foot: 0.3 })])).toEqual(calm);
    expect(after([fig(1, spot!.x, spot!.z)])).not.toEqual(calm);
    // fish, like the ripples, ignore a wader the viewer cannot see
    expect(after([fig(1, spot!.x, spot!.z)], new Set([1]))).toEqual(calm);
  });

  it('a deck is dry: a dash along a bridge throws no spray, but one beside it does', () => {
    const { view } = pondMap(3);
    const b = (demo[3].woodland!.pond as unknown as PondInfo).bridges[0];
    const [bx, bz, bw, bh] = b.rect;
    const dash = (x: number, z: number) => {
      const w = new Water3d(view, rng);
      let sprays = 0, live = 0;
      for (let i = 0; i < 60; i++) { const r = w.step(inp(i / 60, 1 / 60, [fig(1, x, z, { dashing: true })])); sprays += r.cues.spray.length; live = r.live; }
      return { sprays, live };
    };
    const on = dash(bx + bw / 2, bz + bh / 2);
    expect(on.sprays).toBe(0);
    expect(on.live).toBe(0);
    // beside the deck: the centre of a water tile next to it (a deck has water on both sides of at least one of its tiles)
    const side = Array.from({ length: Math.max(bw, bh) }, (_, i) => (b.along_x ? [bx + i + 0.5, bz - 0.5] : [bx - 0.5, bz + i + 0.5]))
      .find(([x, z]) => isWater(view.get(Math.floor(x), Math.floor(z))))!;
    expect(dash(side[0], side[1]).sprays).toBeGreaterThan(20);
  });

  it('a map without a pond has no fish and no mouth rings', () => {
    const w = new Water3d(room(), rng);
    let r = w.step(inp(0, 1 / 60, []));
    for (let k = 1; k < 300; k++) r = w.step(inp(k / 60, 1 / 60, []));
    expect(r.fish).toBeNull();
    expect(r.live).toBe(0);
  });
});
