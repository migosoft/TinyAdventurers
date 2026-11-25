import { describe, expect, it } from 'vitest';
import type { PondInfo } from '../../generated/PondInfo';
import demo from '../../generated/pond-demo.json';
import { PLANT_KIND } from '../../generated/defs';
import { TILE, TileMap } from '../../sim/map';
import { View } from '../../sim/view';
import { SightMask, hiddenAt } from '../sightmask';
import { newCardBuf, newShadowBuf } from '../cards';
import { PX_FRAME } from '../critters3d';
import { pondField, type PondField } from './pondField';
import { FROG, LIFE, PondLife, plantFeet, type PlantFoot } from './pondLife';

const fieldOf = (i: number): PondField => {
  const rules = new TileMap(demo[i].w, demo[i].h, Uint8Array.from(demo[i].tiles));
  return pondField(rules, demo[i].woodland!.pond as unknown as PondInfo);
};
const FIELDS = demo.map((_, i) => fieldOf(i));
const SEEDS = Array.from({ length: 50 }, (_, i) => i * 7919 + 3);
const each = (f: (life: PondLife, field: PondField) => void): void => {
  for (const field of FIELDS) for (const seed of SEEDS) f(new PondLife(field, seed), field);
};
const frames = { [PX_FRAME]: { x: 0, y: 0, w: 16, h: 16 } };
const cam = { x: 0, z: 0, pitch: 0.85, yaw: 0 };
const ALL = { x0: -1e3, z0: -1e3, x1: 1e3, z1: 1e3 };
const pushed = (life: PondLife, day: number) => {
  const out = { cards: newCardBuf(), shadows: newShadowBuf() };
  const flies = life.push(out, frames, cam, 1, { day, wind: true, mask: null, view: ALL as never });
  return { out, flies };
};
/** Steps `life` for `s` seconds with `near`; returns every ring triple. */
const run = (life: PondLife, s: number, near: { x: number; z: number }[]): number[] => {
  const rings: number[] = [];
  for (let t = 0; t < s; t += 1 / 30) rings.push(...life.step(1 / 30, near));
  return rings;
};

describe("the pond's life (#360)", () => {
  it('placement keeps to its zones', () => {
    each((life, f) => {
      for (const p of life.pads) {
        // calm water away from the shore, and no two pads on each other
        expect(f.shoreAt(p.x, p.z)).toBeGreaterThanOrEqual(LIFE.padShore[0]);
        expect(f.shoreAt(p.x, p.z)).toBeLessThanOrEqual(LIFE.padShore[1]);
        // a pad never leaves its zone as it drifts
        for (const t of [0, 3, 7.7, 100]) {
          const [x, z] = life.padAt(p, t);
          expect(f.shoreAt(x, z)).toBeGreaterThanOrEqual(LIFE.padShore[0]);
          expect(f.shoreAt(x, z)).toBeLessThanOrEqual(LIFE.padShore[1]);
        }
        for (const q of life.pads) if (q !== p) expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeGreaterThan((p.size + q.size) / 32);
      }
      for (const c of life.clumps) {
        expect(c.stalks.length).toBeGreaterThanOrEqual(3);
        expect(c.stalks.length).toBeLessThanOrEqual(7);
        for (const s of c.stalks) {
          expect(f.shoreAt(c.x + s.dx, c.z + s.dz)).toBeLessThanOrEqual(LIFE.reedShore);
          expect(f.bankAt(c.x + s.dx, c.z + s.dz)).toBeLessThanOrEqual(LIFE.reedBank);
        }
      }
      for (const g of life.frogs) {
        // on a pad or on the bank's bare earth; it lands in the water
        if (g.pad) expect(life.pads).toContain(g.pad);
        else {
          expect(f.bankAt(g.hx, g.hz)).toBeLessThanOrEqual(LIFE.frogBank[0]);
          expect(f.shoreAt(g.hx, g.hz)).toBeLessThanOrEqual(LIFE.frogBank[1]);
          expect(f.depthAt(g.hx, g.hz)).toBeLessThan(0.08); // the bed there is above the water's surface
          // not in the reeds, where it would not be seen
          for (const c of life.clumps) expect(Math.hypot(c.x - g.hx, c.z - g.hz)).toBeGreaterThanOrEqual(1);
        }
        expect(f.shoreAt(g.wx, g.wz)).toBeGreaterThan(0.4);
      }
    });
  });

  it('nothing sits on a deck, a mouth or a brook', () => {
    each((life, f) => {
      const clear = (x: number, z: number): void => {
        expect(f.deckAt(x, z)).toBeNull();
        expect(f.flowAt(x, z).s).toBeLessThanOrEqual(LIFE.calm);
        for (const m of f.mouths) expect(Math.hypot(m.x - x, m.z - z)).toBeGreaterThanOrEqual(LIFE.mouth);
      };
      for (const p of life.pads) clear(p.x, p.z);
      for (const c of life.clumps) for (const s of c.stalks) clear(c.x + s.dx, c.z + s.dz);
      for (const g of life.frogs) { clear(g.hx, g.hz); clear(g.wx, g.wz); }
      // a dragonfly's hovering places too, over half a minute
      for (let i = 0; i < 300; i++) {
        life.step(0.1, []);
        for (const d of life.flies) clear(d.tx, d.tz);
      }
    });
  }, 30_000); // 2 to 3 s alone; the whole suite under load ran it past the default 5 s

  it('the counts stay in their ranges, and the demo ponds have life', () => {
    each((life) => {
      expect(life.pads.length).toBeLessThanOrEqual(LIFE.pads[1]);
      expect(life.clumps.length).toBeLessThanOrEqual(LIFE.clumps[1]);
      expect(life.frogs.length).toBeLessThanOrEqual(LIFE.frogs[1]);
      expect(life.flies.length).toBeLessThanOrEqual(LIFE.flies[1]);
    });
    FIELDS.forEach((f) => {
      const life = new PondLife(f, f.seed);
      expect(life.clumps.length).toBeGreaterThanOrEqual(1);
      expect(life.frogs.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('two ponds with different seeds differ in their counts', () => {
    const counts = SEEDS.map((s) => { const l = new PondLife(FIELDS[0], s); return [l.pads.length, l.clumps.length, l.frogs.length, l.flies.length]; });
    for (let k = 0; k < 4; k++) expect(new Set(counts.map((c) => c[k])).size).toBeGreaterThanOrEqual(4);
    // each kind is its own roll: a pond rich in lilies is not thereby rich in reeds
    expect(counts.some((c) => c[0] >= 10 && c[1] <= 4)).toBe(true);
    expect(counts.some((c) => c[0] <= 3 && c[1] >= 7)).toBe(true);
  });

  it('a frog leaps for any figure, not only a hero', () => {
    const life = new PondLife(FIELDS[0], 5);
    expect(life.frogs.length).toBeGreaterThan(1);
    // nothing near: they sit
    run(life, 3, []);
    expect(life.frogs.every((g) => g.state === 'sit')).toBe(true);
    // a figure is only a point: a stag beside the first frog sets it off, and the frogs out of its reach stay
    const g = life.frogs[0];
    const stag = { x: g.hx + 1.5, z: g.hz };
    run(life, FROG.nerve + 0.1, [stag]);
    for (const q of life.frogs) expect(q.state === 'sit').toBe(Math.hypot(q.hx - stag.x, q.hz - stag.z) >= FROG.scare);
    expect(g.state).not.toBe('sit');
  });

  it('frogs near a walker do not all leap at once', () => {
    const at = new Set<number>();
    for (const seed of SEEDS.slice(0, 10)) {
      const life = new PondLife(FIELDS[0], seed);
      const near = life.frogs.map((g) => ({ x: g.hx + 1.5, z: g.hz }));
      for (let i = 0; i < 30; i++) {
        life.step(1 / 30, near);
        life.frogs.forEach((g) => { if (g.state === 'leap' && g.t === 0) at.add(i); });
      }
      expect(life.frogs.every((g) => g.state !== 'sit')).toBe(true);
    }
    expect(at.size).toBeGreaterThan(5);
  });

  it('a leap ends in a ring cue, and the frog comes back when it is quiet', () => {
    const life = new PondLife(FIELDS[0], 5);
    const g = life.frogs[0];
    const near = [{ x: g.hx + 0.5, z: g.hz }];
    expect(run(life, FROG.leap - 0.1, near)).toEqual([]); // in the air
    const rings = run(life, 0.3, near);
    expect(rings.slice(0, 3)).toEqual([g.wx, g.wz, FROG.splash]);
    expect(g.state).toBe('under');
    // it never climbs back while the figure stands at its seat
    run(life, 40, near);
    expect(['under', 'peek']).toContain(g.state);
    // alone again: it peeks (a ring), leaps back and sits
    const later = run(life, FROG.under[1] + FROG.peek[1] + 1, []);
    expect(later.length).toBeGreaterThanOrEqual(6);
    expect(g.state).toBe('sit');
  });

  it('nothing at night but frogs, pads and reeds', () => {
    const life = new PondLife(FIELDS[0], SEEDS.find((s) => new PondLife(FIELDS[0], s).flies.length > 1)!);
    const day = pushed(life, 1), night = pushed(life, 0);
    expect(day.flies).toBe(life.flies.length);
    expect(night.flies).toBe(0);
    // a dragonfly is six rects and a shadow
    expect(day.out.cards.n - night.out.cards.n).toBe(life.flies.length * 6);
    expect(day.out.shadows.n - night.out.shadows.n).toBe(life.flies.length);
    expect(night.out.cards.n).toBeGreaterThan(0);
  });

  it('a frog under water is not drawn', () => {
    const life = new PondLife(FIELDS[0], 5);
    const g = life.frogs[0];
    const before = pushed(life, 0).out.cards.n;
    run(life, 1.5, [{ x: g.hx + 0.5, z: g.hz }]);
    expect(g.state).toBe('under');
    expect(pushed(life, 0).out.cards.n).toBeLessThan(before);
  });

  it('with a plant list no bank frog sits under a bush or a tree', () => {
    let moved = 0;
    for (const field of FIELDS) for (const seed of SEEDS) {
      // a bush at the first bank frog's seat and a tree at the second's
      const bank = new PondLife(field, seed).frogs.filter((g) => !g.pad);
      const plants: PlantFoot[] = bank.slice(0, 2).map((g, i) => ({ x: g.hx, z: g.hz, bush: i === 0 }));
      const life = new PondLife(field, seed, plants);
      for (const g of life.frogs) if (!g.pad) for (const p of plants) expect(Math.hypot(p.x - g.hx, p.z - g.hz)).toBeGreaterThanOrEqual(p.bush ? LIFE.frogBush : LIFE.frogTree);
      if (plants.length > 0 && life.frogs.some((g) => !g.pad)) moved++;
    }
    expect(moved).toBeGreaterThan(50);
    // the server's plants: kind, x and y in px
    expect(plantFeet([[PLANT_KIND.Bush, 32, 48, 0, 100, false, 100, false], [PLANT_KIND.Conifer, 8, 16, 0, 100, false, 100, false]])).toEqual([{ x: 2, z: 3, bush: true }, { x: 0.5, z: 1, bush: false }]);
  });

  it('a frog the viewer cannot see makes no ring', () => {
    const rules = new TileMap(demo[0].w, demo[0].h, Uint8Array.from(demo[0].tiles));
    const life = new PondLife(FIELDS[0], 5), g = life.frogs[0];
    // the viewer stands in a far corner and sees 2 tiles around
    const view = new View(rules.w, rules.h);
    view.compute(rules, 1.5 * TILE, 1.5 * TILE, 2, 'hard');
    const mask = new SightMask(rules, { daylight: false, feather: 0, ramp: 0 });
    mask.update(view, null, 0);
    expect(hiddenAt(mask, g.wx, g.wz)).toBe(true);
    const rings: number[] = [];
    for (let t = 0; t < 2; t += 1 / 30) rings.push(...life.step(1 / 30, [{ x: g.hx + 0.5, z: g.hz }], mask));
    expect(g.state).toBe('under'); // it leapt all the same
    expect(rings).toEqual([]);
  });

  it('the same seed and steps give the same life', () => {
    const a = new PondLife(FIELDS[1], 77), b = new PondLife(FIELDS[1], 77);
    const walker = (t: number) => [{ x: a.frogs[0].hx + 3 - t * 0.5, z: a.frogs[0].hz }];
    const ra: number[] = [], rb: number[] = [];
    for (let i = 0; i < 600; i++) { ra.push(...a.step(1 / 30, walker(i / 30))); rb.push(...b.step(1 / 30, walker(i / 30))); }
    expect(ra.length).toBeGreaterThan(0);
    expect(rb).toEqual(ra);
    expect(JSON.stringify([b.pads, b.clumps, b.frogs, b.flies])).toBe(JSON.stringify([a.pads, a.clumps, a.frogs, a.flies]));
    expect(pushed(b, 1).out.cards.position).toEqual(pushed(a, 1).out.cards.position);
  });
});
