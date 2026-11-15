import { describe, expect, it } from 'vitest';
import { FH, PAD, U } from './grid';
import { buildPart as build } from './part';
import { DESCS, type DescKey } from './table';

// Building a part takes a fraction of a second; the tests share the results.
const memo = new Map<string, ReturnType<typeof build>>();
const buildPart = (d: (typeof DESCS)[DescKey], i: 0 | 1): ReturnType<typeof build> => {
  const k = `${d.name}${i}`;
  let r = memo.get(k);
  if (!r) memo.set(k, (r = build(d, i)));
  return r;
};
const SLOW = 30000;

const KEYS = Object.keys(DESCS) as DescKey[];

describe('buildPart', () => {
  it('is deterministic', () => {
    const a = build(DESCS.elf, 0), b = buildPart(DESCS.elf, 0);
    expect(a.mesh.position).toEqual(b.mesh.position);
    expect(a.mesh.normal).toEqual(b.mesh.normal);
    expect(a.mesh.index).toEqual(b.mesh.index);
    expect(a.paint.data).toEqual(b.paint.data);
  }, SLOW);

  it('gives valid meshes for every description and part', () => {
    for (const key of KEYS) for (const i of [0, 1] as const) {
      const { mesh, rows } = buildPart(DESCS[key], i), n = mesh.position.length / 3;
      expect(rows.length, key).toBeGreaterThan(5);
      expect(mesh.normal.length).toBe(mesh.position.length);
      expect(mesh.uv!.length).toBe(n * 2);
      let outside = 0, infinite = 0;   // one assertion per check, not per element (vitest's worker RPC)
      for (const idx of mesh.index) if (!(idx < n)) outside++;
      for (const v of mesh.position) if (!Number.isFinite(v)) infinite++;
      for (const v of mesh.normal) if (!Number.isFinite(v)) infinite++;
      expect(outside, key).toBe(0);
      expect(infinite, key).toBe(0);
    }
  }, SLOW);

  it('keeps the elf\'s head within sprite rows 11 to 19', () => {
    const { rows, mesh } = buildPart(DESCS.elf, 0);
    expect(rows[0].Y).toBeGreaterThanOrEqual(PAD + 11 * U - 3);
    expect(rows[rows.length - 1].Y).toBeLessThanOrEqual(PAD + 20 * U + 3);
    let lo = Infinity, hi = -Infinity;
    for (let k = 1; k < mesh.position.length; k += 3) { lo = Math.min(lo, mesh.position[k]); hi = Math.max(hi, mesh.position[k]); }
    expect(lo).toBeGreaterThanOrEqual(FH - 20 - 0.5);
    expect(hi).toBeLessThanOrEqual(FH - 11 + 0.5);
  });

  it('keeps an open robe at full depth down to its end', () => {
    const { rows } = buildPart(DESCS.wizard, 1), last = rows[rows.length - 1];
    expect(last.deep).toBeCloseTo(last.rc / U, 5);
  });

  it('lays the wolf\'s body down: longer along x than high', () => {
    const { mesh, lie } = buildPart(DESCS.wolf, 1);
    expect(lie).not.toBeNull();
    const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (let k = 0; k < mesh.position.length; k += 3) for (const a of [0, 1]) {
      lo[a] = Math.min(lo[a], mesh.position[k + a]); hi[a] = Math.max(hi[a], mesh.position[k + a]);
    }
    expect(hi[0] - lo[0]).toBeGreaterThan(hi[1] - lo[1]);
  });

  it('pins every part of the seven figures (a hash of the positions)', () => {
    const hash: Record<string, string> = {};
    for (const key of KEYS) for (const i of [0, 1] as const) {
      let h = 0x811c9dc5;
      for (const v of buildPart(DESCS[key], i).mesh.position) {
        h = (h ^ (Math.round(v * 1e4) | 0)) >>> 0;
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      hash[`${key}${i}`] = h.toString(16);
    }
    expect(hash).toEqual({
      dwarf0: '42e957f1', dwarf1: 'c85fe863', elf0: 'c71d885d', elf1: '2779b639', knight0: '28c5be29', knight1: '600eddb',
      ogre0: '6208c131', ogre1: '3e0a9813', skelet0: '9f882f79', skelet1: '27878af3', wizard0: '201dfaa1', wizard1: '34a3b6d5',
      wolf0: 'aae659b9', wolf1: '3a3adf15',
    });
  }, SLOW);
});
