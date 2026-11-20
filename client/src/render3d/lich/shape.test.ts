import { describe, expect, it } from 'vitest';
import { newCloth } from './cloth';
import { REGION } from './paint';
import { restPose, type LichPose } from './pose';
import { LICH, LICH_TOP, ROBE_RINGS, buildLich, lichRest, newLichOut, ringLean, type LichOut } from './shape';

const WEIGHTS = ['novaUp', 'novaHit', 'novaChest', 'novaOut', 'raiseUp', 'raiseHit', 'raiseLow', 'raiseLift', 'flingBack', 'flingOut', 'gaze', 'hurt', 'glide', 'casting', 'flare'] as const;

function build(pose: LichPose, parts: 'all' | 'caster' = 'all', out: LichOut = newLichOut()): LichOut {
  buildLich(pose, newCloth(), out, parts);
  return out;
}
const used = (a: Float32Array | Uint32Array, n: number): number[] => Array.from(a.subarray(0, n));
const poseOf = (patch: Partial<LichPose>): LichPose => ({ ...restPose(), ...patch });
const weighted = (...names: (typeof WEIGHTS[number])[]): LichPose => { const p = restPose(); for (const n of names) p[n] = 1; return p; };

describe('the lich builder', () => {
  it('gives equal arrays for equal input, also after other poses went through the same out (no state leaks)', () => {
    const a = build(restPose());
    const b = newLichOut();
    build(weighted('novaUp', 'novaHit', 'gaze', 'glide'), 'all', b);
    build(poseOf({ t: 3.3, face: 2, headYaw: 0.4, flingOut: 1, raiseLift: 1 }), 'caster', b);
    build(restPose(), 'all', b);
    for (const key of ['position', 'normal', 'uv', 'colour', 'look'] as const) {
      const n = key === 'uv' || key === 'look' ? a.body.verts * 2 : a.body.verts * 3;
      expect(b.body.verts).toBe(a.body.verts);
      expect(used(b.body[key], n)).toEqual(used(a.body[key], n));
    }
    expect(used(b.body.index, a.body.indices)).toEqual(used(a.body.index, a.body.indices));
    expect(b.claws.verts).toBe(a.claws.verts);
    expect(used(b.claws.position, a.claws.verts * 3)).toEqual(used(a.claws.position, a.claws.verts * 3));
  });

  const cases: [string, LichPose][] = [['rest', restPose()], ...WEIGHTS.map((w): [string, LichPose] => [w, weighted(w)])];
  it.each(cases)('stays in bounds with no NaN and every index in range: %s', (_name, pose) => {
    const o = build(pose);
    for (const [buf, maxV, maxI] of [[o.body, LICH.bodyVerts, LICH.bodyIndices], [o.claws, LICH.clawVerts, LICH.clawIndices]] as const) {
      expect(buf.verts).toBeLessThanOrEqual(maxV);
      expect(buf.indices).toBeLessThanOrEqual(maxI);
      for (const key of ['position', 'normal', 'uv'] as const) {
        const n = key === 'uv' ? buf.verts * 2 : buf.verts * 3;
        for (let i = 0; i < n; i++) if (!Number.isFinite(buf[key][i])) throw new Error(`${key}[${i}] is not finite`);
      }
      for (let i = 0; i < buf.indices; i++) if (buf.index[i] >= buf.verts) throw new Error(`index ${i} is out of range`);
    }
  });

  it('writes the same uv, look and index in every pose, so `fixed` depends on `parts` only', () => {
    for (const parts of ['all', 'caster'] as const) {
      const ref = build(restPose(), parts);
      expect(ref.body.fixed).toBe(parts === 'all' ? 1 : 2);
      expect(ref.claws.fixed).toBe(ref.body.fixed);
      for (const [name, pose] of cases) {
        const o = build(pose, parts);
        for (const [x, r] of [[o.body, ref.body], [o.claws, ref.claws]] as const) {
          expect(x.fixed, name).toBe(r.fixed);
          expect(x.verts, name).toBe(r.verts);
          expect(x.indices, name).toBe(r.indices);
          expect(used(x.uv, x.verts * 2), name).toEqual(used(r.uv, r.verts * 2));
          expect(used(x.look, x.verts * 2), name).toEqual(used(r.look, r.verts * 2));
          expect(used(x.index, x.indices), name).toEqual(used(r.index, r.indices));
        }
      }
    }
  });

  it('puts every body uv inside one of the painted regions', () => {
    const o = build(restPose());
    const rects = Object.values(REGION);
    for (let i = 0; i < o.body.verts; i++) {
      const x = o.body.uv[i * 2] * 512, y = o.body.uv[i * 2 + 1] * 512;
      if (!rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) throw new Error(`uv of vertex ${i} is outside: ${x}, ${y}`);
    }
  });

  const skullTop = (o: LichOut): number => {
    let top = -Infinity;
    for (let i = 0; i < o.body.verts; i++) {
      const x = o.body.uv[i * 2] * 512, y = o.body.uv[i * 2 + 1] * 512;
      if (x >= REGION.skull.x && x <= REGION.skull.x + REGION.skull.w && y >= REGION.skull.y && y <= REGION.skull.y + REGION.skull.h) top = Math.max(top, o.body.position[i * 3 + 1]);
    }
    return top;
  };

  it('stands as tall as the model says', () => {
    const o = build(restPose());
    expect(Math.abs(skullTop(o) - LICH.height / LICH.unit)).toBeLessThan(0.5);
    expect(LICH_TOP).toBeGreaterThanOrEqual(skullTop(o) - 1e-3);
  });

  it('keeps the robe off the floor and its hem as wide as LICH.hem', () => {
    const o = build(restPose());
    const robeVerts = ROBE_RINGS.length * 49;
    let low = Infinity;
    for (let i = 0; i < robeVerts; i++) low = Math.min(low, o.body.position[i * 3 + 1]);
    expect(low).toBeGreaterThanOrEqual(0.05 - 1e-6);
    // the whole body: only the staff's foot, planted into the floor as in the spike (-0.2), goes lower
    let lowest = Infinity;
    for (let i = 0; i < o.body.verts; i++) lowest = Math.min(lowest, o.body.position[i * 3 + 1]);
    expect(lowest).toBeGreaterThanOrEqual(-0.25);
    // the hem ring is the last one; the fold and the short train (x1.3 at the back) make the whole ring wider than its nominal
    // radius, so the front half's mean radius is what is compared
    const hem = (ROBE_RINGS.length - 1) * 49;
    let sum = 0, n = 0;
    for (let j = 0; j < 49; j++) {
      const x = o.body.position[(hem + j) * 3], z = o.body.position[(hem + j) * 3 + 2];
      if (x > 0) { sum += Math.hypot(x, z); n++; }
    }
    expect(Math.abs(sum / n - LICH.hem / LICH.unit)).toBeLessThan(0.3);
  });

  it('places the anchors on the figure', () => {
    const o = build(restPose()), a = o.anchors, p = o.body.position;
    let top = -Infinity, topI = 0;
    // the staff leans toward z 3.3 at the top; nothing else on the right side (the skull and the collar stay within z 3) is that far out
    for (let i = 0; i < o.body.verts; i++) if (p[i * 3 + 2] > 3 && p[i * 3 + 1] > top) { top = p[i * 3 + 1]; topI = i; }
    expect(Math.hypot(a.gem[0] - p[topI * 3], a.gem[1] - p[topI * 3 + 1], a.gem[2] - p[topI * 3 + 2])).toBeLessThan(1);
    for (let k = 0; k < 3; k++) expect(a.eyes[k]).toBeCloseTo((a.eyeL[k] + a.eyeR[k]) / 2, 5);
    expect(a.eyeL[2]).toBeLessThan(0);
    expect(a.eyeR[2]).toBeGreaterThan(0);
    expect(a.eyes[1]).toBeLessThan(skullTop(o));
    expect(a.eyes[1]).toBeGreaterThan(skullTop(o) - 4);
    // a hand vertex: bone coloured, which the jaw (darker) and the cloth are not
    let near = Infinity;
    for (let i = 0; i < o.body.verts; i++) {
      if (Math.abs(o.body.colour[i * 3] - 0.8) < 1e-4 && Math.abs(o.body.colour[i * 3 + 2] - 0.72) < 1e-4) near = Math.min(near, Math.hypot(a.hand[0] - p[i * 3], a.hand[1] - p[i * 3 + 1], a.hand[2] - p[i * 3 + 2]));
    }
    expect(near).toBeLessThan(1.5);
    expect(a.chest[1]).toBeCloseTo(13.8, 0);
    expect(a.tome[1]).toBeGreaterThan(9);
  });

  it("'caster' leaves out the tome and the claws", () => {
    const all = build(restPose()), caster = build(restPose(), 'caster');
    expect(all.claws.indices).toBeGreaterThan(0);
    expect(caster.claws.indices).toBe(0);
    expect(caster.body.verts).toBeLessThan(all.body.verts);
  });

  it('lichRest is the rest pose and LICH_TOP its highest point', () => {
    const rest = lichRest('caster');
    let top = -Infinity;
    for (let i = 0; i < rest.body.verts; i++) top = Math.max(top, rest.body.position[i * 3 + 1]);
    expect(LICH_TOP).toBeCloseTo(top, 5);
    expect(lichRest('all').claws.indices).toBeGreaterThan(0);
  });

  // Pins the port of the spike's step (checked vertex by vertex against it under node: equal to float precision). Re-record only when
  // a shape is changed on purpose.
  const sums = (o: LichOut): number[] => {
    let s = 0, a = 0;
    for (let i = 0; i < o.body.verts * 3; i++) { s += o.body.position[i]; a += Math.abs(o.body.position[i]); }
    return [s, a, o.body.verts, o.body.indices];
  };
  it.each([
    ['rest', restPose(), [120712.50018, 130635.73818, 6890, 37287]],
    ['nova', poseOf({ novaUp: 1, novaChest: 1 }), [125122.61581, 134055.41628, 6890, 37287]],
    ['fling', poseOf({ flingOut: 1, casting: 1 }), [125113.45245, 134626.92551, 6890, 37287]],
  ] as [string, LichPose, number[]][])('keeps the spike\'s shape: %s', (_n, pose, want) => {
    const got = sums(build(pose));
    expect(got[0]).toBeCloseTo(want[0], 3);
    expect(got[1]).toBeCloseTo(want[1], 3);
    expect(got[2]).toBe(want[2]);
    expect(got[3]).toBe(want[3]);
  });

  it('a hurt flinch throws the head back and straightens the stoop; hurt 0 changes nothing', () => {
    const rest = build(restPose()), hurt = build(poseOf({ hurt: 1 })), zero = build(poseOf({ hurt: 0 }));
    expect(used(zero.body.position, zero.body.verts * 3)).toEqual(used(rest.body.position, rest.body.verts * 3));
    const skullTopX = (o: LichOut): number => {
      let top = -Infinity, x = 0;
      for (let i = 0; i < o.body.verts; i++) {
        const u = o.body.uv[i * 2] * 512, v = o.body.uv[i * 2 + 1] * 512;
        if (u >= REGION.skull.x && u <= REGION.skull.x + REGION.skull.w && v >= REGION.skull.y && v <= REGION.skull.y + REGION.skull.h && o.body.position[i * 3 + 1] > top) { top = o.body.position[i * 3 + 1]; x = o.body.position[i * 3]; }
      }
      return x;
    };
    expect(skullTopX(hurt)).toBeLessThan(skullTopX(rest));
    const a = ringLean(restPose(), new Float32Array(ROBE_RINGS.length * 2)), h = ringLean(poseOf({ hurt: 1 }), new Float32Array(ROBE_RINGS.length * 2));
    ROBE_RINGS.forEach((r, i) => { if (r[0] > 11) expect(h[i * 2]).toBeCloseTo(0.4 * a[i * 2], 6); });
  });

  it('ringLean: nothing at rest, nothing for the rings at or below y 8, a lean when it stoops', () => {
    const lean = ringLean(restPose(), new Float32Array(ROBE_RINGS.length * 2));
    ROBE_RINGS.forEach((r, i) => { if (r[0] <= 8) { expect(lean[i * 2]).toBe(0); expect(lean[i * 2 + 1]).toBe(0); } });
    expect(lean[0]).toBeGreaterThan(0);
    const gazing = ringLean(poseOf({ gaze: 1 }), new Float32Array(ROBE_RINGS.length * 2));
    expect(gazing[0]).toBeGreaterThan(lean[0]);
  });
});
