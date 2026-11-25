import { describe, expect, it } from 'vitest';
import { cloudCount } from '../../game/moodmath';
import { Air3d, type AirInput } from './air';
import { CLOUD_MOTES, type AirParts } from './airParts';
import { flood, floorMap, frame, maskAt, seeded } from './air.testutil';
import type { Light } from '../light';

/** Steps `secs` seconds; `make` builds each frame's input from the time. */
function run(air: Air3d, secs: number, make: (t: number) => AirInput, t0 = 0): AirParts {
  let parts!: AirParts;
  const n = Math.round(secs / 0.05);
  for (let i = 0; i < n; i++) parts = air.step(make(t0 + i * 0.05));
  return parts;
}
const at = (p: AirParts, i: number): [number, number, number] => [p.specks.pos[i * 3], p.specks.pos[i * 3 + 1], p.specks.pos[i * 3 + 2]];

describe('dust', () => {
  it('spawns no cloud in darkness', () => {
    const air = new Air3d(floorMap(), seeded(1));
    const parts = run(air, 10, (t) => frame({ t }));
    expect(parts.specks.count).toBe(0);
  });

  it('spawns clouds on lit, seen tiles only', () => {
    const map = floorMap();
    const air = new Air3d(map, seeded(2));
    // The viewer stands at (10, 10) with vision 3; the only light is a torch over (30, 30), far outside it.
    const mask = maskAt(map, 10, 10, 3);
    const far: Light = { x: 30.5, y: 1, z: 30.5, radius: 3, r: 3, g: 3, b: 3, shadow: false, skip: -1 };
    expect(run(air, 10, (t) => frame({ t, mask, lights: [far] })).specks.count).toBe(0);
    const air2 = new Air3d(map, seeded(2));
    const lit: Light = { x: 10.5, y: 1, z: 10.5, radius: 3, r: 3, g: 3, b: 3, shadow: false, skip: -1 };
    const parts = run(air2, 10, (t) => frame({ t, mask, lights: [lit] }));
    expect(parts.specks.count).toBeGreaterThan(0);
    for (let i = 0; i < parts.specks.count; i++) {
      const [x, y, z] = at(parts, i);
      expect(Math.hypot(x - 10.5, z - 10.5)).toBeLessThan(3 + 0.5 + 1.2 + 1); // lit radius, the cloud's reach, a little drift
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(2.6);
    }
  });

  it('keeps as many clouds as the footprint asks for', () => {
    const air = new Air3d(floorMap(), seeded(3));
    run(air, 1, (t) => frame({ t, lights: [flood()] }));
    expect(air.counts.clouds).toBe(cloudCount(30 * 16, 30 * 16));
    const small = new Air3d(floorMap(), seeded(3));
    run(small, 1, (t) => frame({ t, fp: { x0: 10, z0: 10, x1: 16, z1: 16 }, lights: [flood()] }));
    expect(small.counts.clouds).toBe(cloudCount(6 * 16, 6 * 16));
  });

  it('fills every active cloud with motes when it is bright everywhere', () => {
    const air = new Air3d(floorMap(), seeded(4));
    const parts = run(air, 5, (t) => frame({ t, lights: [flood()] }));
    expect(parts.specks.count).toBe(air.counts.clouds * CLOUD_MOTES);
  });

  it('is stirred apart by a mover, the motes are gone within 2 s, and the cloud respawns after `respawn` s', () => {
    const air = new Air3d(floorMap(), seeded(5));
    const make = (t: number, movers: AirInput['movers'] = []) => frame({ t, lights: [flood()], respawn: 3, movers });
    let parts = run(air, 4, (t) => make(t));
    const before = parts.specks.count;
    expect(air.counts.stirred).toBe(0);
    // A hero runs east through the first speck, in px, as the movers are.
    const [sx, , sz] = at(parts, 0);
    let t = 4;
    let peak = 0;
    for (let i = 0; i < 12; i++, t += 0.05) {
      parts = air.step(make(t, [{ id: 1, flags: 0, x: (sx - 0.4 + 0.1 * i) * 16, y: sz * 16, vx: 120, vy: 0, r: 6, shot: false, heat: 0 }]));
      peak = Math.max(peak, air.counts.stirred);
    }
    expect(peak).toBeGreaterThan(0);
    // Without movers the stirred clouds' motes fade within 2 s (and 3 s of waiting keep them from respawning yet).
    parts = run(air, 2.1, (tt) => make(tt), t);
    t += 2.1;
    expect(air.counts.stirred).toBeGreaterThan(0);
    expect(parts.specks.count).toBeLessThanOrEqual(before - peak * CLOUD_MOTES);
    // After the wait they are back.
    parts = run(air, 3.2, (tt) => make(tt), t);
    expect(air.counts.stirred).toBe(0);
    expect(parts.specks.count).toBe(air.counts.clouds * CLOUD_MOTES);
  });

  it('does not stir with `stir` off', () => {
    const air = new Air3d(floorMap(), seeded(5));
    const make = (t: number, movers: AirInput['movers'] = []) => frame({ t, lights: [flood()], on: { dust: true, smoke: true, embers: true, drips: true, stir: false, draft: true }, movers });
    let parts = run(air, 4, (t) => make(t));
    const [sx, , sz] = at(parts, 0);
    for (let i = 0; i < 12; i++) parts = air.step(make(4 + i * 0.05, [{ id: 1, flags: 0, x: (sx - 0.4 + 0.1 * i) * 16, y: sz * 16, vx: 120, vy: 0, r: 6, shot: false, heat: 0 }]));
    expect(air.counts.stirred).toBe(0);
  });

  it('drifts the pollen east when the drift is east', () => {
    const air = new Air3d(floorMap(), seeded(6));
    const make = (t: number, drift: [number, number]) => frame({ t, kinds: 'pollen', drift, on: { dust: true, smoke: true, embers: true, drips: true, stir: false, draft: false } });
    let parts = run(air, 3, (t) => make(t, [0, 0]));
    expect(parts.specks.count).toBeGreaterThan(0); // pollen needs no torch: the sun is the shader's
    const x0 = Array.from({ length: parts.specks.count }, (_, i) => at(parts, i)[0]);
    parts = run(air, 0.5, (t) => make(t, [0.8, 0]), 3);
    let dx = 0;
    for (let i = 0; i < x0.length; i++) dx += at(parts, i)[0] - x0[i];
    expect(dx / x0.length).toBeGreaterThan(0.25);
  });
});
