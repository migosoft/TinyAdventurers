import { describe, expect, it } from 'vitest';
import { LIGHT_KIND, TILE_ID } from '../../generated/defs';
import { LightField, type StaticLight } from '../../game/light';
import { HEIGHT_RANGE, cloudAt, lookFor, sunLook } from '../../game/sunmath';
import { TILE, TileMap } from '../../sim/map';
import { View } from '../../sim/view';
import { SightMask, type SightLook } from '../sightmask';
import { CHASM_BED } from '../dips/shape';
import { CRACK_CAP, CRACK_Z_TILT, RAY_CAP, crackMask, crackOf, packCracks, selectCracks, type Crack } from './cracks';

const sun = (id: number, x = 10, y = 10, on = true): StaticLight => ({ id, kind: LIGHT_KIND.Daylight, colour: 0xffffff, x, y, on, wall: 0 });

/** A hand-made crack with one ray over the whole opening, so the shade is the same wherever the rim lets light through. */
function plain(over: Partial<Crack> = {}): Crack {
  return { id: 1, fx: 10.5, fz: 10.5, ceil: 6, dir: [-0.3, 0.93, CRACK_Z_TILT], rx: 1.2, rz: 0.8, rot: 0, widen: 1, rgb: [1, 1, 1], main: 0, rays: [[-1, 1, -1, 1]], wave: 0, ...over };
}

describe('crackOf', () => {
  it('is the same for the same id and differs between ids', () => {
    expect(crackOf(sun(4), sunLook, 0)).toEqual(crackOf(sun(4), sunLook, 0));
    const a = crackOf(sun(4), sunLook, 0), b = crackOf(sun(5), sunLook, 0);
    expect(a.rot).not.toBe(b.rot);
    expect(a.rx).not.toBe(b.rx);
    expect(JSON.stringify(a.rays)).not.toBe(JSON.stringify(b.rays));
  });

  it('puts the patch on the tile centre, the ceiling in range and the sun on the look side', () => {
    for (let id = 1; id < 30; id++) {
      const c = crackOf(sun(id, 7, 9), sunLook, 0);
      expect(c.fx).toBe(7.5);
      expect(c.fz).toBe(9.5);
      expect(c.ceil).toBeGreaterThanOrEqual(HEIGHT_RANGE[0]);
      expect(c.ceil).toBeLessThanOrEqual(HEIGHT_RANGE[1]);
      expect(Math.hypot(...c.dir)).toBeCloseTo(1, 9);
      expect(Math.sign(c.dir[0])).toBe(sunLook.dir);
      const look = lookFor(id, sunLook);
      const len = Math.hypot((look.dir * look.slant) / look.height, 1, CRACK_Z_TILT);
      expect(c.dir[2]).toBeCloseTo(CRACK_Z_TILT / len, 12);
      expect(c.rays.length).toBe(look.rays);
      expect(c.widen).toBe(look.widen ? 0.5 : 1);
      expect(c.rx).toBeCloseTo(look.patch / 2 / 0.81, 12);
      expect(c.rz).toBeCloseTo(c.rx * 0.65, 12);
    }
  });

  it('keeps the rays inside the opening, floor and top', () => {
    for (let id = 1; id < 30; id++)
      for (const r of crackOf(sun(id), sunLook, 0).rays) for (const v of r) expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('dims the colour inside a cloud', () => {
    const base = { ...sunLook, vary: false, clouds: 0.5, gap: [2, 4] as [number, number] };
    let t = 0;
    while (cloudAt(3, t, base) > 0.6) t += 0.05;
    let mid = 0;
    for (let s = 0; s < 40; s++) if (cloudAt(3, s * 0.25, base) < cloudAt(3, mid, base)) mid = s * 0.25;
    const sunny = crackOf(sun(3), base, 0);
    const cloudy = crackOf(sun(3), base, mid);
    expect(cloudy.rgb[0]).toBeLessThan(sunny.rgb[0] * 0.8);
  });
});

describe('crackMask', () => {
  it('is bright at the patch centre on the floor', () => {
    expect(crackMask(plain(), 10.5, 0, 10.5)).toBeGreaterThan(0.5);
  });
  it('is 0 two tiles beyond rx, above the ceiling and below the deepest bed', () => {
    const c = plain();
    expect(crackMask(c, c.fx + c.rx + 2, 0, c.fz)).toBe(0);
    expect(crackMask(c, c.fx, c.ceil + 0.1, c.fz)).toBe(0);
    expect(crackMask(c, c.fx, -(CHASM_BED + 1.1), c.fz)).toBe(0);
  });
  it('lights a point below the floor (a dip) as the floor point on the same sun ray, keeping the floor size and pattern (#324)', () => {
    const c = plain();
    const floor = crackMask(c, c.fx, 0, c.fz);
    expect(floor).toBeGreaterThan(0.5);
    for (const y of [-0.1, -1, -CHASM_BED]) {
      const k = y / c.dir[1];
      expect(crackMask(c, c.fx + c.dir[0] * k, y, c.fz + c.dir[2] * k)).toBeCloseTo(floor, 9);
    }
    // Off the ray the patch ends as it does on the floor: the same offset gives the same value at any depth.
    const off = crackMask(c, c.fx + 0.6 * c.rx, 0, c.fz);
    const k = -2 / c.dir[1];
    expect(crackMask(c, c.fx + 0.6 * c.rx + c.dir[0] * k, -2, c.fz + c.dir[2] * k)).toBeCloseTo(off, 9);
  });
  it('is the same along the sun ray as at its floor point', () => {
    const c = plain();
    const floor = crackMask(c, c.fx, 0, c.fz);
    for (const k of [0.5, 2, 4]) {
      const q = [c.fx + c.dir[0] * k, c.dir[1] * k, c.fz + c.dir[2] * k];
      expect(q[1]).toBeLessThan(c.ceil);
      expect(crackMask(c, q[0], q[1], q[2])).toBeCloseTo(floor, 9);
    }
  });
  it('narrows with height when the opening widens only on the floor', () => {
    const straight = plain({ widen: 1 });
    const narrow = plain({ widen: 0.5 });
    const y = narrow.ceil * 0.9;
    // A point on the sun ray from the floor point 0.7 rx across.
    const fx = narrow.fx + 0.7 * narrow.rx;
    const at = (c: Crack) => crackMask(c, fx + c.dir[0] * (y / c.dir[1]), y, c.fz + c.dir[2] * (y / c.dir[1]));
    expect(at(straight)).toBeGreaterThan(0);
    expect(at(narrow)).toBe(0);
  });
  it('shades a crackOf crack inside its opening and stays finite and within sqrt(rays)', () => {
    for (let id = 1; id < 20; id++) {
      const c = crackOf(sun(id), sunLook, 0);
      for (let i = 0; i < 20; i++) {
        const m = crackMask(c, c.fx + (i - 10) * 0.2, (i % 5) * 0.8, c.fz + (i - 10) * 0.1);
        expect(m).toBeGreaterThanOrEqual(0);
        expect(m).toBeLessThanOrEqual(Math.sqrt(RAY_CAP) + 1e-9); // overlapping rays add up (rayGlow keeps it near 1)
      }
    }
  });
});

describe('selectCracks', () => {
  const map = new TileMap(40, 40, new Uint8Array(40 * 40).fill(TILE_ID.Floor));
  const fp = { x0: 5, z0: 5, x1: 15, z1: 15 };
  const field = (lights: StaticLight[]) => {
    const f = new LightField(map);
    for (const l of lights) f.add(l);
    return f;
  };
  /** A mask whose viewer stands at tile (10, 10) with vision 3: tiles farther away are hidden. */
  function mask(): SightMask {
    const look: SightLook = { daylight: false, feather: 0, ramp: 0 };
    const m = new SightMask(map, look);
    const hard = new View(map.w, map.h);
    hard.compute(map, 10.5 * TILE, 10.5 * TILE, 3, 'hard');
    m.update(hard, null, 0);
    return m;
  }

  it('keeps Daylight lights on in the footprint, nearest to its centre first', () => {
    const got = selectCracks(field([sun(1, 14, 10), sun(2, 10, 10), sun(3, 8, 10)]), fp, null, 8);
    expect(got.map((l) => l.id)).toEqual([2, 3, 1]);
  });
  it('drops a light that is off, a torch, one far outside the footprint and anything beyond cap', () => {
    const torch: StaticLight = { id: 9, kind: LIGHT_KIND.Torch, colour: 0xffffff, x: 10, y: 10, on: true, wall: 0 };
    const f = field([sun(1, 10, 10, false), torch, sun(3, 35, 35), sun(4, 9, 10), sun(5, 11, 10), sun(6, 12, 10)]);
    expect(selectCracks(f, fp, null, 8).map((l) => l.id)).toEqual([4, 5, 6]);
    expect(selectCracks(f, fp, null, 2).map((l) => l.id)).toEqual([4, 5]);
  });
  it('drops a light whose tile is hidden', () => {
    const m = mask();
    const got = selectCracks(field([sun(1, 10, 10), sun(2, 15, 10)]), fp, m, 8);
    expect(got.map((l) => l.id)).toEqual([1]);
  });
});

describe('packCracks', () => {
  it('writes count and the fields, and zeroes the unused slots', () => {
    const cs = [crackOf(sun(1), sunLook, 0), crackOf(sun(2), sunLook, 0)];
    const p = packCracks(cs);
    expect(p.count).toBe(2);
    expect(p.a.length).toBe(CRACK_CAP * 4);
    expect(p.e.length).toBe(CRACK_CAP * 12);
    expect(Array.from(p.a.slice(0, 4))).toEqual([cs[0].fx, cs[0].fz, cs[0].ceil, cs[0].widen].map(Math.fround));
    expect(p.d[3]).toBe(cs[0].rays.length);
    expect(Math.fround(p.e[0])).toBe(Math.fround(cs[0].rays[0][0]));
    for (const arr of [p.a, p.b, p.c, p.d]) expect(Array.from(arr.slice(8)).every((v) => v === 0)).toBe(true);
    expect(Array.from(p.e.slice(24)).every((v) => v === 0)).toBe(true);
  });
  it('is empty for no cracks and caps at CRACK_CAP', () => {
    expect(packCracks([]).count).toBe(0);
    expect(packCracks(Array.from({ length: 12 }, () => plain())).count).toBe(CRACK_CAP);
  });
});

describe('selectCracks margin (#307 review)', () => {
  const map = new TileMap(80, 80, new Uint8Array(80 * 80).fill(TILE_ID.Floor));
  const fp = { x0: 20, z0: 20, x1: 30, z1: 30 };
  const field = (lights: StaticLight[]) => {
    const f = new LightField(map);
    for (const l of lights) f.add(l);
    return f;
  };
  it('keeps a crack a few tiles beyond the south edge (its shaft reaches into the view at a flat pitch) and drops one far beyond', () => {
    const got = selectCracks(field([sun(1, 25, 38), sun(2, 25, 60)]), fp, null, 8);
    expect(got.map((l) => l.id)).toEqual([1]);
  });
  it('takes the page\'s own look for the slant', () => {
    const wide = { ...sunLook, slant: 30 };
    const l = field([sun(1, 25, 62)]);
    expect(selectCracks(l, fp, null, 8)).toHaveLength(0);
    expect(selectCracks(l, fp, null, 8, wide)).toHaveLength(1);
  });
});
