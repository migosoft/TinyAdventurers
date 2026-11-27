import { beforeAll, describe, expect, it } from 'vitest';
import { B, BLADE, BONES, BONE_DEFS, TAIL_N, buildDemonSkin, type DemonSkin } from './body';

let s: DemonSkin;
beforeAll(() => { s = buildDemonSkin(0.05); });

describe('the demon skin', () => {
  it("has the spike's skeleton", () => {
    expect(BONES).toBe(88);
    expect(TAIL_N).toBe(10);
    expect(B.wf3bR).toBeGreaterThan(0);
    expect(B.chain5).toBe(BONES - 1);
    const by = new Map(BONE_DEFS.map((d, i) => [d[0], i]));
    BONE_DEFS.forEach((d, i) => { if (d[1]) expect(by.get(d[1])!).toBeLessThan(i); });
  });

  it('every point hangs on at most four bones whose weights sum to 1', () => {
    for (const [name, p] of Object.entries(s)) {
      const nv = p.position.length / 3;
      expect(nv, name).toBeGreaterThan(0);
      for (let v = 0; v < nv; v++) {
        let sum = 0;
        for (let c = 0; c < 4; c++) { sum += p.skinWeight[v * 4 + c]; expect(p.skinIndex[v * 4 + c]).toBeLessThan(BONES); }
        expect(sum, `${name} ${v}`).toBeCloseTo(1, 5);
      }
      expect(Math.max(...p.index), name).toBeLessThan(nv);
      expect(p.normal.length).toBe(p.position.length);
      expect(p.info.length).toBe(nv * 4);
    }
  });

  it("splits the body's index so the crystal triangles come last", () => {
    const b = s.body;
    expect(b.solid).toBeGreaterThan(0);
    expect(b.solid!).toBeLessThan(b.index.length);
    expect(b.solid! % 3).toBe(0);
    const hy = (t: number, c: number) => b.info[b.index[t + c] * 4 + 1];
    for (let t = b.solid!; t < b.index.length; t += 3) {
      expect([0, 1, 2].every((c) => hy(t, c) > 0.5)).toBe(true);
      expect([0, 1, 2].some((c) => hy(t, c) > 0.95)).toBe(true);
    }
    // the spine's plates, the crest and the tail blade are horn-tagged too and stay in the solid part
    let kept = 0;
    for (let t = 0; t < b.solid!; t += 3) if ([0, 1, 2].every((c) => hy(t, c) > 0.5)) kept++;
    expect(kept).toBeGreaterThan(0);
  });

  it('puts the blade and the iron on the hand and the chain on its links', () => {
    expect(new Set(s.blade.skinIndex)).toEqual(new Set([0, B.handR]));
    const used = new Set(s.iron.skinIndex);
    for (const n of ['handR', 'foreArmL', 'chain0', 'chain5']) expect(used.has(B[n]), n).toBe(true);
    expect(s.blade.uv).not.toBeNull();
    expect(s.iron.uv).toBeNull();
  });

  it("the blade's edge runs from the grip along the blade", () => {
    const a = BLADE.edge(0), z = BLADE.edge(1);
    expect(Math.hypot(z[0] - a[0], z[1] - a[1], z[2] - a[2])).toBeGreaterThan(BLADE.len * 0.9);
    expect(BLADE.edge(0.5)).not.toEqual(a);
  });
});
