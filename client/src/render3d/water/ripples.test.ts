import { describe, expect, it } from 'vitest';
import { DROP, MOUTH_RING, RIPPLE_CAP, RIPPLE_LIFE, Ripples, mouthRings, puddleDrops, rippleHeight } from './ripples';

function peak(age: number, strength = 1): { max: number; at: number } {
  let max = 0, at = 0;
  for (let d = 0; d <= 4; d += 0.005) {
    const h = Math.abs(rippleHeight(d, age, strength));
    if (h > max) { max = h; at = d; }
  }
  return { max, at };
}

describe('ripples', () => {
  it('is flat before it is born and after its life', () => {
    expect(rippleHeight(1, 0, 1)).toBe(0);
    expect(rippleHeight(1, RIPPLE_LIFE, 1)).toBe(0);
  });

  it('travels at RIPPLE_SPEED', () => {
    expect(Math.abs(peak(2).at - 1.5)).toBeLessThan(0.15);
  });

  it('makes a negative strength the same ring at DROP.scale of the size: as steep, that much slower (#380)', () => {
    for (const age of [0.3, 0.8, 1.5]) for (const d of [0.02, 0.1, 0.3, 0.6]) {
      expect(rippleHeight(d, age, -0.7)).toBeCloseTo(DROP.scale * rippleHeight(d / DROP.scale, age, 0.7), 12);
    }
    expect(DROP.scale).toBeLessThan(1);
    expect(Math.abs(peak(2, -1).at - 1.5 * DROP.scale)).toBeLessThan(0.15 * DROP.scale);
    expect(peak(0.5, -1).max).toBeCloseTo(peak(0.5, 1).max * DROP.scale, 3);
    expect(rippleHeight(0.2, RIPPLE_LIFE + 0.1, -1)).toBe(0);
  });

  it('fades', () => {
    expect(peak(3).max).toBeLessThan(peak(0.5).max / 10);
  });

  it('packs live sources with their age', () => {
    const r = new Ripples();
    r.add(3, 4, 1, 0.7);
    const out = new Float32Array(RIPPLE_CAP * 4).fill(9);
    expect(r.pack(1.5, out)).toBe(1);
    expect(Array.from(out.slice(0, 4))).toEqual([3, 4, 0.5, Math.fround(0.7)]);
    for (let i = 1; i < RIPPLE_CAP; i++) expect(out[i * 4 + 2]).toBe(-1);
  });

  it('drops the expired', () => {
    const r = new Ripples();
    r.add(3, 4, 1, 1);
    const out = new Float32Array(RIPPLE_CAP * 4);
    expect(r.pack(1 + RIPPLE_LIFE, out)).toBe(0);
    for (let i = 0; i < RIPPLE_CAP; i++) expect(out[i * 4 + 2]).toBe(-1);
  });

  it('replaces the oldest when full', () => {
    const r = new Ripples();
    // 40 adds 0.01 s apart: all stay live at the pack time.
    for (let i = 0; i < 40; i++) r.add(i, 0, i * 0.01, 1);
    const out = new Float32Array(RIPPLE_CAP * 4);
    expect(r.pack(0.5, out)).toBe(RIPPLE_CAP);
    const xs: number[] = [];
    for (let i = 0; i < RIPPLE_CAP; i++) xs.push(out[i * 4]);
    xs.sort((a, b) => a - b);
    expect(xs).toEqual(Array.from({ length: RIPPLE_CAP }, (_, i) => 24 + i));
  });

  it('treats a source born in the future (the clock went back) as free, not as the newest', () => {
    const r = new Ripples();
    for (let i = 0; i < RIPPLE_CAP; i++) r.add(i, 0, 100 + i * 0.01, 1);
    r.add(99, 0, 1, 1); // the clock restarted at 1 s: all sixteen sources lie in the future
    r.add(98, 0, 1.1, 1);
    const out = new Float32Array(RIPPLE_CAP * 4);
    expect(r.pack(1.2, out)).toBe(2);
    const xs = Array.from({ length: RIPPLE_CAP }, (_, i) => out[i * 4]);
    expect(xs).toContain(99);
    expect(xs).toContain(98);
  });

  it('drops into puddles the same for a clock, and never outside the puddle (#380)', () => {
    const puddles = [{ x: 3.5, z: 4.2, r: 0.5 }, { x: 10.1, z: 2.7, r: 0.8 }];
    const run = (from: number, to: number) => {
      const out: [number, number, number, number][] = [];
      puddleDrops(puddles, from, to, (p, x, z, at) => out.push([puddles.indexOf(p), x, z, at]));
      return out;
    };
    const all = run(0, 60);
    expect(run(0, 60)).toEqual(all);
    // one drop per puddle every DROP.every seconds on average, each in its time span and inside its puddle
    expect(all.length).toBeGreaterThanOrEqual(2 * (60 / DROP.every) - 2);
    expect(all.length).toBeLessThanOrEqual(2 * (60 / DROP.every) + 2);
    for (const [k, x, z, at] of all) {
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThanOrEqual(60);
      expect(Math.hypot(x - puddles[k].x, z - puddles[k].z)).toBeLessThanOrEqual(puddles[k].r * DROP.within);
    }
    // the two puddles do not drop in step, and a span cut in pieces gives the same drops
    expect(all.filter((d) => d[0] === 0).map((d) => d[3])).not.toEqual(all.filter((d) => d[0] === 1).map((d) => d[3]));
    const key = (d: number[]) => d[3] * 1000 + d[0];
    expect([...run(0, 17.3), ...run(17.3, 41), ...run(41, 60)].sort((a, b) => key(a) - key(b))).toEqual([...all].sort((a, b) => key(a) - key(b)));
    expect(run(5, 5)).toEqual([]);
  });

  it('reuses an expired slot before replacing a live one', () => {
    const r = new Ripples();
    r.add(0, 0, 0, 1);
    for (let i = 1; i < RIPPLE_CAP; i++) r.add(i, 0, 10 + i * 0.01, 1);
    r.add(99, 0, 10.5, 1); // the first source (born 0) is long expired
    const out = new Float32Array(RIPPLE_CAP * 4);
    expect(r.pack(10.6, out)).toBe(RIPPLE_CAP);
    const xs = Array.from({ length: RIPPLE_CAP }, (_, i) => out[i * 4]);
    expect(xs).toContain(99);
    expect(xs).toContain(1);
  });

  it('a small ring replaces only the oldest small ring, never a pool ring (#401)', () => {
    const r = new Ripples(), out = new Float32Array(RIPPLE_CAP * 4);
    const xs = () => { r.pack(1, out); return Array.from({ length: RIPPLE_CAP }, (_, i) => out[i * 4]); };
    for (let i = 0; i < RIPPLE_CAP; i++) r.add(i, 0, i * 0.01, 1);
    r.add(50, 0, 0.5, -1); // all slots hold live pool rings: dropped
    expect(xs()).not.toContain(50);
    r.add(60, 0, 0.6, 1); // a pool ring replaces the oldest
    r.add(61, 0, 0.61, -1); // still no small ring to replace
    expect(xs()).not.toContain(61);
    const s = new Ripples();
    for (let i = 0; i < RIPPLE_CAP; i++) s.add(i, 0, i * 0.01, i === 3 || i === 7 ? -1 : 1);
    s.add(70, 0, 0.7, -1);
    s.pack(1, out);
    const got = Array.from({ length: RIPPLE_CAP }, (_, i) => out[i * 4]);
    expect(got).toContain(70);
    expect(got).not.toContain(3);
    expect(got).toContain(7);
    expect(got).toContain(0);
  });

  it('the mouths of a pond share their few slots and never take another ring\'s (#360)', () => {
    const out = new Float32Array(RIPPLE_CAP * 4);
    const xs = (r: Ripples, now: number): number[] => { r.pack(now, out); return Array.from({ length: RIPPLE_CAP }, (_, i) => (out[i * 4 + 2] >= 0 ? out[i * 4] : NaN)).filter((x) => !Number.isNaN(x)); };
    // two mouths, ten seconds, frame by frame: never more than the mouths' slots, and each ring was born at one of the two
    const mouths = [{ x: 10, z: 10, dx: 1, dz: 0 }, { x: 40, z: 10, dx: 0, dz: 1 }];
    const r = new Ripples();
    let last = -Infinity, born = 0;
    for (let k = 0; k <= 600; k++) {
      const now = k / 60;
      mouthRings(mouths, Math.max(now - RIPPLE_LIFE, last), now, (x, z, at) => { born++; expect(at).toBeGreaterThan(last); expect(at).toBeLessThanOrEqual(now); r.addMouth(x, z, at, now); });
      last = now;
      const live = xs(r, now);
      expect(live.length).toBeLessThanOrEqual(MOUTH_RING.slots);
      for (const x of live) expect(Math.min(Math.abs(x - 10 - MOUTH_RING.into), Math.abs(x - 40)), `${x}`).toBeLessThanOrEqual(MOUTH_RING.scatter + 1e-4);
    }
    expect(born).toBeGreaterThan(2 * 10 / 0.9 - 2);
    const seen = xs(r, 10);
    expect(seen.some((x) => x < 20) && seen.some((x) => x > 30)).toBe(true);
    // every slot taken by a fresh ring of something else: the mouth's ring is left out
    const busy = new Ripples();
    for (let i = 0; i < RIPPLE_CAP; i++) busy.add(100 + i, 0, 1, 1);
    busy.addMouth(7, 7, 1.2, 1.2);
    expect(xs(busy, 1.2)).not.toContain(7);
    expect(xs(busy, 1.2).length).toBe(RIPPLE_CAP);
    // four held and the oldest still fresh: left out; once it is `spare` older: replaced
    const held = new Ripples();
    for (let i = 0; i < MOUTH_RING.slots; i++) held.addMouth(i, 0, i * 0.1, i * 0.1);
    held.addMouth(50, 0, 1, 1);
    expect(xs(held, 1)).not.toContain(50);
    held.addMouth(51, 0, MOUTH_RING.spare, MOUTH_RING.spare);
    expect(xs(held, MOUTH_RING.spare)).toContain(51);
    expect(xs(held, MOUTH_RING.spare)).not.toContain(0);
    // a figure's ring may take a mouth's slot (the oldest), not the other way round
    const mixed = new Ripples();
    mixed.addMouth(9, 9, 0, 0);
    for (let i = 0; i < RIPPLE_CAP; i++) mixed.add(200 + i, 0, 0.5, 1);
    expect(xs(mixed, 0.5)).not.toContain(9);
  });
});
