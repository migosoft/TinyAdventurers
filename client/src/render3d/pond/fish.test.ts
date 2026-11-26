import { describe, expect, it } from 'vitest';
import { TILE_ID } from '../../generated/defs';
import type { PondInfo } from '../../generated/PondInfo';
import demo from '../../generated/pond-demo.json';
import { TileMap } from '../../sim/map';
import { FISH, FISH_AWAY, FISH_CAP, FISH_STRIDE, Fish } from './fish';
import { pondField, type PondField } from './pondField';
import { inside } from './pondShape';

/** A pond of one round blob of radius `r` at (10.5, 10.5) on a 21 x 21 map, its tiles cut about as the server cuts them: deep 2.4 tiles inside. */
function round(r: number): PondField {
  const pond: PondInfo = { seed: 11, blobs: [[10.5, 10.5, r, r]], streams: [], bridges: [] };
  const m = new TileMap(21, 21, new Uint8Array(21 * 21).fill(TILE_ID.Floor));
  for (let z = 0; z < 21; z++) for (let x = 0; x < 21; x++) if (inside(pond.blobs, pond.seed, x + 0.5, z + 0.5) > 0) m.set(x, z, inside(pond.blobs, pond.seed, x + 0.5, z + 0.5) >= 2.4 ? TILE_ID.DeepWater : TILE_ID.ShallowWater);
  return pondField(m, pond);
}
const demoField = (i: number): PondField => {
  const l = demo[i];
  return pondField(new TileMap(l.w, l.h, Uint8Array.from(l.tiles)), l.woodland!.pond as unknown as PondInfo);
};
/** The fish of `f` as objects. */
const list = (f: Fish): { x: number; z: number; a: number; phase: number }[] => {
  const p = f.positions();
  return Array.from({ length: f.count }, (_, i) => ({ x: p[i * FISH_STRIDE], z: p[i * FISH_STRIDE + 1], a: p[i * FISH_STRIDE + 2], phase: p[i * FISH_STRIDE + 3] }));
};
const DT = 1 / 60;

describe('Fish (#360)', () => {
  it('fish stay in deep water', () => {
    for (const field of [round(5), demoField(0), demoField(2), demoField(3)]) {
      const fish = new Fish(field, field.seed);
      expect(fish.count).toBeGreaterThanOrEqual(FISH.min);
      expect(fish.count).toBeLessThanOrEqual(FISH_CAP);
      const start = list(fish);
      const waders = [{ x: start[0].x, z: start[0].z }];
      for (let s = 0; s < 60 * 40; s++) {
        fish.step(DT, s > 600 && s < 1200 ? waders : []); // ten seconds of fright in between
        // (the positions are read back as 32-bit floats: on the slope to the deep that is worth a little depth)
        for (const f of list(fish)) expect(field.depthAt(f.x, f.z)).toBeGreaterThanOrEqual(FISH.deep - 1e-4);
      }
      // ... and they do swim: every one has left its place
      list(fish).forEach((f, i) => expect(Math.hypot(f.x - start[i].x, f.z - start[i].z), `fish ${i}`).toBeGreaterThan(0.2));
    }
  });

  it('there are more fish in a larger pond', () => {
    expect(new Fish(round(3.2), 1).count).toBeLessThan(new Fish(round(7), 1).count);
  });

  it('fish flee a wader and calm down', () => {
    const field = round(7);
    const fish = new Fish(field, 5);
    for (let s = 0; s < 120; s++) fish.step(DT, []);
    const before = list(fish);
    const wader = { x: before[0].x + 0.3, z: before[0].z };
    const near = before.map((f) => Math.hypot(f.x - wader.x, f.z - wader.z) < FISH.scare);
    expect(near.filter(Boolean).length).toBeGreaterThan(0);
    // calm, a fish swims its own speed at most
    const stepOf = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z) / DT;
    fish.step(DT, []);
    list(fish).forEach((f, i) => expect(stepOf(f, before[i])).toBeLessThanOrEqual(FISH.speed[1] + 1e-3));
    // a wader comes: the near ones dart, the others do not
    let last = list(fish);
    fish.step(DT, [wader]);
    fish.step(DT, [wader]);
    let now = list(fish);
    const fast = now.map((f, i) => stepOf(f, last[i]) > FISH.speed[1] * 1.5 || field.depthAt(f.x + Math.cos(f.a) * 0.1, f.z + Math.sin(f.a) * 0.1) < FISH.deep);
    near.forEach((n, i) => expect(fast[i] || !n, `fish ${i}`).toBe(true));
    for (let s = 0; s < 90; s++) fish.step(DT, [wader]);
    // after a second and a half they are farther from it on the whole
    now = list(fish);
    const mean = (l: { x: number; z: number }[]): number => l.filter((_, i) => near[i]).reduce((sum, f) => sum + Math.hypot(f.x - wader.x, f.z - wader.z), 0) / near.filter(Boolean).length;
    expect(mean(now)).toBeGreaterThan(mean(before) + 0.5);
    // the wader is gone: within the dart's time they are calm again
    for (let s = 0; s < Math.ceil(FISH.dart / DT) + 1; s++) fish.step(DT, []);
    last = list(fish);
    fish.step(DT, []);
    list(fish).forEach((f, i) => expect(stepOf(f, last[i])).toBeLessThanOrEqual(FISH.speed[1] + 1e-3));
  });

  it('a darting fish beats its tail faster', () => {
    const field = round(7);
    const calm = new Fish(field, 5), scared = new Fish(field, 5);
    const at = list(scared)[0];
    const turned = (f: Fish, waders: { x: number; z: number }[]): number => {
      const p0 = list(f)[0].phase;
      f.step(DT, waders);
      return (list(f)[0].phase - p0 + Math.PI * 2) % (Math.PI * 2);
    };
    expect(turned(scared, [{ x: at.x + 0.2, z: at.z }])).toBeGreaterThan(turned(calm, []) * 1.5);
  });

  it('no deep water, no fish', () => {
    const fish = new Fish(round(1.2), 3);
    expect(fish.count).toBe(0);
    fish.step(DT, [{ x: 10.5, z: 10.5 }]);
    const p = fish.positions();
    expect(p.length).toBe(FISH_CAP * FISH_STRIDE);
    for (let i = 0; i < FISH_CAP; i++) expect([p[i * FISH_STRIDE], p[i * FISH_STRIDE + 1]]).toEqual([FISH_AWAY, FISH_AWAY]);
  });

  it('the unused slots lie away from the map', () => {
    const fish = new Fish(round(3.2), 3);
    expect(fish.count).toBeLessThan(FISH_CAP);
    const p = fish.positions();
    for (let i = fish.count; i < FISH_CAP; i++) expect(p[i * FISH_STRIDE]).toBe(FISH_AWAY);
  });

  it('the same seed and steps give the same fish', () => {
    const field = demoField(0);
    const run = (seed: number): number[] => {
      const fish = new Fish(field, seed);
      for (let s = 0; s < 400; s++) fish.step(s % 3 ? DT : 2 * DT, s > 200 ? [{ x: 100, z: 30 }] : []);
      return Array.from(fish.positions());
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
    // the array is the same one every call
    const fish = new Fish(field, 7);
    expect(fish.positions()).toBe(fish.positions());
  });
});
