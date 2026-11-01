import { describe, expect, it } from 'vitest';
import { AMBUSH_WARNING, dissolveVeil, restingVeil, sheetAlpha, silhouetteAlpha, strandPixels, veilAlpha, veilPixels, VEIL_DEATH_LIFE, VeilStrands } from './shadeHaze';

/** A steady pseudo-random source, so the tests do not flake. */
function lcg(seed = 7): () => number {
  let s = seed;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000);
}

const tips = (v: VeilStrands) => v.lines.map((l) => l.pts[l.pts.length - 1]);
const settle = (v: VeilStrands, feet: { x: number; y: number }, face: 1 | -1, n = 60) => {
  for (let i = 0; i < n; i++) v.step(feet, face, 1 / 30);
};

describe('shade veil', () => {
  it('roots every strand inside the body and, standing, puffs them out all round it like a cloud', () => {
    for (const face of [1, -1] as const) {
      const v = new VeilStrands(lcg());
      settle(v, { x: 100, y: 100 }, face);
      for (const l of v.lines) {
        expect(Math.abs(l.pts[0].x - 100)).toBeLessThanOrEqual(3);
        expect(l.pts[0].y).toBeGreaterThanOrEqual(100 - 10);
        expect(l.pts[0].y).toBeLessThanOrEqual(100 - 2);
      }
      const t = tips(v);
      expect(t.some((p) => (p.x - 100) * face > 3)).toBe(true); // in front
      expect(t.some((p) => (p.x - 100) * face < -3)).toBe(true); // behind
      expect(t.some((p) => p.y < 100 - 12)).toBe(true); // above
      expect(t.some((p) => p.y > 100 - 2)).toBe(true); // below
    }
  });
  it('wraps the figure: some strands are drawn in front of it, most behind', () => {
    const v = new VeilStrands(lcg());
    v.step({ x: 0, y: 0 }, 1, 1 / 30);
    const front = v.lines.filter((l) => l.front).length;
    expect(front).toBeGreaterThan(0);
    expect(front).toBeLessThan(v.lines.length / 2);
  });
  it('veilTrailsWhenMoving: moving, the tips stream behind; standing again, the cloud comes back', () => {
    const v = new VeilStrands(lcg());
    settle(v, { x: 100, y: 100 }, 1);
    let x = 100;
    for (let i = 0; i < 30; i++) v.step({ x: (x += 40 / 30), y: 100 }, 1, 1 / 30);
    const behind = tips(v).filter((p) => p.x < x - 3).length;
    expect(behind).toBeGreaterThanOrEqual(v.lines.length - 2);
    settle(v, { x, y: 100 }, 1);
    expect(tips(v).some((p) => p.x > x + 3)).toBe(true);
  });
  it('never stretches a segment past 1.3 times its length', () => {
    const v = new VeilStrands(lcg());
    settle(v, { x: 0, y: 0 }, 1);
    v.step({ x: 200, y: 0 }, 1, 1 / 30);
    for (const l of v.lines)
      for (let i = 1; i < l.pts.length; i++) expect(Math.hypot(l.pts[i].x - l.pts[i - 1].x, l.pts[i].y - l.pts[i - 1].y)).toBeLessThanOrEqual(3 * 1.3 + 1e-9);
  });
  it('veilIsEmptyWhileInvisible, and starts again on the Shade when it reappears', () => {
    const v = new VeilStrands(lcg());
    v.step({ x: 10, y: 10 }, 1, 1 / 30);
    expect(v.lines.length).toBeGreaterThan(0);
    v.step(null, 1, 1 / 30);
    expect(v.lines).toEqual([]);
    v.step({ x: 200, y: 50 }, 1, 1 / 30);
    for (const l of v.lines) expect(Math.hypot(l.pts[0].x - 200, l.pts[0].y - 50)).toBeLessThan(14);
  });
  it('is solid black at the root and fades to a dithered edge at the tip', () => {
    expect(veilAlpha(0, 0, 0)).toBe(1);
    expect(veilAlpha(0.6, 0, 0)).toBe(0.6);
    expect([veilAlpha(0.9, 0, 0), veilAlpha(0.9, 1, 0)].sort()).toEqual([0, 0.3]);
  });
  it('strandPixels covers the strand in whole pixels, wider near the root, root to tip', () => {
    const px = strandPixels([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 6, y: 0 }]);
    for (const p of px) expect([Number.isInteger(p.x), Number.isInteger(p.y)]).toEqual([true, true]);
    expect(px.filter((p) => p.y === 0).map((p) => p.x)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(px.some((p) => p.x === 0 && p.y === 1)).toBe(true);
    expect(px.some((p) => p.x === 6 && p.y === 1)).toBe(false);
    expect(px.at(-1)?.f).toBe(1);
  });
  it('veilPixels fills the cloth between back strands, fainter than the strands, and keeps the wrapping strands apart', () => {
    const v = new VeilStrands(lcg());
    settle(v, { x: 100, y: 100 }, 1);
    const { back, front } = veilPixels(v.lines);
    const sheet = [...back.values()].filter((a) => a < 0.6 && a > 0);
    expect(sheet.length).toBeGreaterThan(20);
    expect(Math.max(...sheet)).toBeLessThanOrEqual(sheetAlpha(0, 0, 0));
    expect([...back.values()]).toContain(1);
    expect(front.size).toBeGreaterThan(0);
    for (const a of [...back.values(), ...front.values()]) expect(a).toBeLessThanOrEqual(1);
  });
});

describe('silhouette warning', () => {
  it('silhouetteAlpha rises from 0.2 to 0.9 over AMBUSH_WARNING', () => {
    expect(AMBUSH_WARNING).toBe(0.5);
    expect(silhouetteAlpha(0)).toBeCloseTo(0.2, 10);
    expect(silhouetteAlpha(AMBUSH_WARNING)).toBeCloseTo(0.9, 10);
    expect(silhouetteAlpha(AMBUSH_WARNING / 2)).toBeCloseTo(0.55, 10);
    expect(silhouetteAlpha(-1)).toBeCloseTo(0.2, 10);
    expect(silhouetteAlpha(5)).toBeCloseTo(0.9, 10);
  });
});

describe('veil death', () => {
  const centre = { x: 100, y: 94 };
  const lines = restingVeil({ x: 100, y: 100 }, 1, lcg());
  /** How far it reaches sideways (the rise does not count). */
  const reach = (ls: { pts: { x: number; y: number }[] }[]) => Math.max(...ls.flatMap((l) => l.pts.map((p) => Math.abs(p.x - centre.x))));

  it('starts as the veil was, fully dark', () => {
    const d = dissolveVeil(lines, centre, 0);
    expect(d.alpha).toBe(1);
    expect(d.lines).toEqual(lines.map((l) => ({ front: l.front, pts: l.pts })));
  });
  it('spreads out a little (to 1.7 times its size), fast at first, rising, while it fades to nothing', () => {
    const r0 = reach(lines);
    expect(reach(dissolveVeil(lines, centre, 0.5).lines)).toBeGreaterThan(r0 * 1.45);
    expect(reach(dissolveVeil(lines, centre, 1).lines)).toBeCloseTo(r0 * 1.7, 6);
    const a = [0, 0.25, 0.5, 0.75, 1].map((k) => dissolveVeil(lines, centre, k).alpha);
    for (let i = 1; i < a.length; i++) expect(a[i]).toBeLessThan(a[i - 1]);
    expect(a.at(-1)).toBe(0);
    expect(VEIL_DEATH_LIFE).toBe(1);
  });
  it('restingVeil is a settled cloud with every strand', () => {
    expect(lines.length).toBe(10);
    expect(lines.some((l) => l.pts.at(-1)!.x > 103)).toBe(true);
  });
});
