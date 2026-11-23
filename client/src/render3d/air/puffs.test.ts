import { describe, expect, it } from 'vitest';
import { LIGHT_KIND } from '../../generated/defs';
import { MAX_EMBERS, MAX_SMOKE } from '../../game/moodmath';
import { TERRAIN } from '../../game/terrain-layers';
import { flameTip } from '../torch/torch';
import { Air3d, type AirInput } from './air';
import type { AirParts } from './airParts';
import { floorMap, frame, maskAt, seeded } from './air.testutil';

type Torch = AirInput['torches'][number];
const torch = (tx: number, tz: number, lit = true): Torch => ({ x: tx + 0.5, z: tz, nx: 0, nz: 1, lit, tx, tz });

function run(air: Air3d, secs: number, make: (t: number) => AirInput, t0 = 0): AirParts {
  let parts!: AirParts;
  for (let i = 0, n = Math.round(secs / 0.05); i < n; i++) parts = air.step(make(t0 + i * 0.05));
  return parts;
}

describe('smoke', () => {
  it('rises from a lit torch, from the flame tip', () => {
    const air = new Air3d(floorMap(), seeded(1));
    const parts = run(air, 4, (t) => frame({ t, torches: [torch(10, 10)] }));
    expect(parts.puffs.count).toBeGreaterThan(0);
    const tipY = flameTip(torch(10, 10))[1];
    let top = 0;
    for (let i = 0; i < parts.puffs.count; i++) {
      const y = parts.puffs.pos[i * 3 + 1];
      expect(y).toBeGreaterThanOrEqual(tipY - 0.1);
      top = Math.max(top, y);
    }
    expect(top).toBeGreaterThan(tipY + 1);
    // A puff is its own sight probe: the torch's floor tile.
    expect(parts.puffs.sight[0]).toBeCloseTo(10.5, 6);
    expect(parts.puffs.sight[1]).toBeCloseTo(10.5, 6);
  });

  it('keeps a gust per torch: two torches on one floor tile both smoke', () => {
    const north: Torch = { x: 10.5, z: 10, nx: 0, nz: 1, lit: true, tx: 10, tz: 10 };
    const west: Torch = { x: 10, z: 10.5, nx: 1, nz: 0, lit: true, tx: 10, tz: 10 };
    const fa = flameTip(north), fb = flameTip(west), tipY = fa[1];
    const air = new Air3d(floorMap(), seeded(11));
    let a = 0, b = 0;
    for (let i = 0; i < 200; i++) {
      const p = air.step(frame({ t: i * 0.05, torches: [north, west] }));
      if (i < 20) continue;
      // Young puffs sit at their flame: count those within a tile of each.
      for (let k = 0; k < p.puffs.count; k++) {
        const y = p.puffs.pos[k * 3 + 1];
        if (y > tipY + 0.6) continue;
        const x = p.puffs.pos[k * 3], z = p.puffs.pos[k * 3 + 2];
        if (Math.abs(x - fa[0]) < 0.2 && Math.abs(z - fa[2]) < 0.2) a++;
        if (Math.abs(x - fb[0]) < 0.2 && Math.abs(z - fb[2]) < 0.2) b++;
      }
    }
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
  });

  it('makes none from an unlit torch', () => {
    const air = new Air3d(floorMap(), seeded(2));
    run(air, 10, (t) => frame({ t, torches: [torch(10, 10, false)] }));
    expect(air.counts.smoke).toBe(0);
  });

  it('makes none from a torch on a hidden tile', () => {
    const map = floorMap();
    const mask = maskAt(map, 10, 10, 3);
    const air = new Air3d(map, seeded(3));
    run(air, 10, (t) => frame({ t, mask, torches: [torch(30, 30)] }));
    expect(air.counts.smoke).toBe(0);
    const seen = new Air3d(map, seeded(3));
    run(seen, 10, (t) => frame({ t, mask, torches: [torch(10, 9)] }));
    expect(seen.counts.smoke).toBeGreaterThan(0);
  });

  it('stays at or under MAX_SMOKE under a flood of torches', () => {
    const air = new Air3d(floorMap(), seeded(4));
    const torches: Torch[] = [];
    for (let i = 0; i < 400; i++) torches.push(torch(6 + (i % 25), 6 + Math.floor(i / 25)));
    let peak = 0;
    for (let i = 0; i < 400; i++) {
      const parts = air.step(frame({ t: i * 0.05, torches }));
      expect(parts.puffs.count).toBe(air.counts.smoke);
      peak = Math.max(peak, air.counts.smoke);
    }
    expect(peak).toBe(MAX_SMOKE);
  });
});

describe('embers', () => {
  it('a Fire shot trails embers and another light kind none', () => {
    const fire = new Air3d(floorMap(), seeded(5));
    const parts = run(fire, 1, (t) => frame({ t, shots: [{ x: 200, y: 200, kind: LIGHT_KIND.Fire }] }));
    expect(fire.counts.embers).toBeGreaterThan(5);
    for (let i = 0; i < parts.embers.count; i++) expect(Math.hypot(parts.embers.pos[i * 3] - 12.5, parts.embers.pos[i * 3 + 2] - 12.5)).toBeLessThan(3);
    const magic = new Air3d(floorMap(), seeded(5));
    run(magic, 1, (t) => frame({ t, shots: [{ x: 200, y: 200, kind: LIGHT_KIND.Magic }] }));
    expect(magic.counts.embers).toBe(0);
  });

  it('one blast key bursts exactly once while it shows', () => {
    const air = new Air3d(floorMap(), seeded(6));
    const blast = [{ x: 200, y: 200, kind: LIGHT_KIND.Blast }];
    air.step(frame({ t: 0, shots: blast }));
    expect(air.counts.embers).toBe(18);
    for (let i = 1; i < 6; i++) {
      air.step(frame({ t: i * 0.05, shots: blast }));
      expect(air.counts.embers).toBe(18);
    }
    // Gone for a frame, shown again: a new blast.
    air.step(frame({ t: 0.4, shots: [] }));
    air.step(frame({ t: 0.45, shots: blast }));
    expect(air.counts.embers).toBe(36);
  });

  it('caps at MAX_EMBERS', () => {
    const air = new Air3d(floorMap(), seeded(7));
    for (let i = 0; i < 200; i++) air.step(frame({ t: i * 0.05, shots: [{ x: 200 + i * 8, y: 200, kind: LIGHT_KIND.Blast }, { x: 200, y: 300 + i * 8, kind: LIGHT_KIND.Blast }] }));
    expect(air.counts.embers).toBeLessThanOrEqual(MAX_EMBERS);
  });

  it('shots on hidden tiles make nothing', () => {
    const map = floorMap();
    const mask = maskAt(map, 10, 10, 3);
    const air = new Air3d(map, seeded(8));
    run(air, 1, (t) => frame({ t, mask, shots: [{ x: 30 * 16, y: 30 * 16, kind: LIGHT_KIND.Fire }, { x: 30 * 16, y: 20 * 16, kind: LIGHT_KIND.Blast }] }));
    expect(air.counts.embers).toBe(0);
  });
});

describe('lava', () => {
  it('smokes and sparks when seen, and on a hidden tile makes nothing', () => {
    const map = floorMap();
    map.set(10, 10, TERRAIN.Lava);
    map.set(30, 30, TERRAIN.Lava);
    const mask = maskAt(map, 10, 10, 3);
    const air = new Air3d(map, seeded(9));
    let embers = 0, smoke = 0;
    for (let i = 0; i < 1200; i++) {
      const parts = air.step(frame({ t: i * 0.05, mask }));
      embers = Math.max(embers, parts.embers.count);
      smoke = Math.max(smoke, parts.puffs.count);
      for (let k = 0; k < parts.embers.count; k++) expect(Math.hypot(parts.embers.pos[k * 3] - 10.5, parts.embers.pos[k * 3 + 2] - 10.5)).toBeLessThan(3);
    }
    expect(embers).toBeGreaterThan(0);
    expect(smoke).toBeGreaterThan(0);
    const only = floorMap();
    only.set(30, 30, TERRAIN.Lava);
    const hiddenAir = new Air3d(only, seeded(9));
    run(hiddenAir, 60, (t) => frame({ t, mask: maskAt(only, 10, 10, 3) }));
    expect(hiddenAir.counts.embers + hiddenAir.counts.smoke).toBe(0);
  });
});
