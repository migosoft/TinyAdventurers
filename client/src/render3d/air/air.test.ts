import { describe, expect, it } from 'vitest';
import { LIGHT_KIND } from '../../generated/defs';
import { TERRAIN } from '../../game/terrain-layers';
import { Air3d, type AirInput } from './air';
import { ALL_ON, flood, floorMap, frame, seeded } from './air.testutil';
import type { AirParts } from './airParts';

/** A map with water, lava, and a lit torch, a fire shot and a mover, so every part has something to do. */
function busy(): { map: ReturnType<typeof floorMap>; make: (t: number, over?: Partial<AirInput>) => AirInput } {
  const map = floorMap();
  for (let x = 12; x < 20; x++) map.set(x, 12, TERRAIN.Shallow);
  map.set(25, 25, TERRAIN.Lava);
  const make = (t: number, over: Partial<AirInput> = {}) =>
    frame({
      t, lights: [flood()], torches: [{ x: 10.5, z: 10, nx: 0, nz: 1, lit: true, tx: 10, tz: 10 }],
      shots: [{ x: 15 * 16, y: 15 * 16, kind: LIGHT_KIND.Fire }], ...over,
    });
  return { map, make };
}
function run(air: Air3d, secs: number, make: (t: number) => AirInput): AirParts {
  let parts!: AirParts;
  for (let i = 0, n = Math.round(secs / 0.05); i < n; i++) parts = air.step(make(i * 0.05));
  return parts;
}

describe('Air3d', () => {
  it('runs every part when all are on', () => {
    const { map, make } = busy();
    const air = new Air3d(map, seeded(1));
    let drips = 0;
    for (let i = 0; i < 600; i++) {
      const p = air.step(make(i * 0.05));
      drips = Math.max(drips, p.drops.count + p.rings.count);
      if (i === 599) {
        expect(p.specks.count).toBeGreaterThan(0);
        expect(p.puffs.count).toBeGreaterThan(0);
        expect(p.embers.count).toBeGreaterThan(0);
      }
    }
    expect(drips).toBeGreaterThan(0);
  });

  it('pollen gives no smoke, embers or drips (and dust)', () => {
    const { map, make } = busy();
    const air = new Air3d(map, seeded(2));
    let any = 0;
    const parts = run(air, 30, (t) => {
      const i = make(t, { kinds: 'pollen', drift: [0.1, 0] });
      return i;
    });
    any = parts.puffs.count + parts.embers.count + parts.drops.count + parts.rings.count;
    expect(any).toBe(0);
    expect(air.counts.smoke + air.counts.embers + air.counts.drips).toBe(0);
    expect(parts.specks.count).toBeGreaterThan(0);
  });

  const cases: [keyof typeof ALL_ON, (p: AirParts, a: Air3d) => number][] = [
    ['dust', (p) => p.specks.count],
    ['smoke', (p) => p.puffs.count],
    ['embers', (p) => p.embers.count],
    ['drips', (p) => p.drops.count + p.rings.count],
  ];
  for (const [key, count] of cases) {
    it(`gives zero of its part with ${key} off`, () => {
      const { map, make } = busy();
      const on = { ...ALL_ON, [key]: false };
      const air = new Air3d(map, seeded(3));
      let seen = 0;
      for (let i = 0; i < 400; i++) seen = Math.max(seen, count(air.step(make(i * 0.05, { on })), air));
      expect(seen).toBe(0);
      const ref = new Air3d(map, seeded(3));
      let refSeen = 0;
      for (let i = 0; i < 400; i++) refSeen = Math.max(refSeen, count(ref.step(make(i * 0.05)), ref));
      expect(refSeen).toBeGreaterThan(0);
    });
  }

  it('picks up a new water tile after mapChanged', () => {
    const map = floorMap();
    const air = new Air3d(map, seeded(4));
    const make = (t: number) => frame({ t });
    run(air, 20, make);
    expect(air.counts.drips).toBe(0);
    map.set(20, 20, TERRAIN.Deep);
    run(air, 20, make);
    expect(air.counts.drips).toBe(0); // not before mapChanged
    air.mapChanged();
    let seen = 0;
    for (let i = 0; i < 1200; i++) seen = Math.max(seen, air.step(make(i * 0.05)).drops.count);
    expect(seen).toBeGreaterThan(0);
  });

  it('reuses its arrays from frame to frame', () => {
    const { map, make } = busy();
    const air = new Air3d(map, seeded(5));
    const a = air.step(make(0));
    const b = air.step(make(0.05));
    expect(b).toBe(a);
    expect(b.specks.pos).toBe(a.specks.pos);
  });
});
