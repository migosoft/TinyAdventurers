import { describe, expect, it } from 'vitest';
import { STAGES } from '../models/bones';
import { PARTS } from './parts';
import { restPose } from './pose';
import { DEMON, DEMON_LAYOUT, WING_FLAT, buildDemon, demonRest, newDemonOut, type DemonOut } from './shape';
import { ARM, BONE, BONES, FOOT, J, RIG, SLOT, placeBones } from './skeleton';

const build = (pose = restPose()): DemonOut => { const o = newDemonOut(); buildDemon(pose, o); return o; };
const bytes = (a: Float32Array | Uint32Array, n: number): Uint8Array => new Uint8Array(a.buffer, 0, n * a.BYTES_PER_ELEMENT);
/** The first byte that differs, or -1 (expect's own comparison of arrays this long takes seconds). */
const differs = (a: Uint8Array, b: Uint8Array): number => { if (a.length !== b.length) return 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return -1; };
const near = (o: DemonOut, a: readonly number[]): number => {
  let best = Infinity;
  const p = o.body.position;
  for (let i = 0; i < o.body.verts; i++) best = Math.min(best, Math.hypot(a[0] - p[i * 3], a[1] - p[i * 3 + 1], a[2] - p[i * 3 + 2]));
  return best;
};
/** The middle of each main ring of a swept tube. */
const centres = (o: DemonOut, t: { v0: number; N: number; K: number }): number[][] => {
  const out: number[][] = [], W = t.K + 1;
  for (let r = 0; r <= t.N; r++) {
    const c = [0, 0, 0];
    for (let k = 0; k < t.K; k++) for (let a = 0; a < 3; a++) c[a] += o.body.position[(t.v0 + (DEMON_LAYOUT.capRings + r) * W + k) * 3 + a] / t.K;
    out.push(c);
  }
  return out;
};
const toLine = (p: number[], line: number[][]): number => {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / l2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t, p[2] - a[2] - d[2] * t));
  }
  return best;
};

describe('the demon builder', () => {
  it('builds the same bytes twice, in one buffer and in two', () => {
    const a = build(), b = build();
    buildDemon(restPose(), b);
    for (const k of ['position', 'normal', 'uv', 'colour', 'look', 'index'] as const) {
      expect(differs(bytes(a.body[k], k === 'index' ? a.body.indices : a.body.verts * (k === 'uv' || k === 'look' ? 2 : 3)), bytes(b.body[k], k === 'index' ? b.body.indices : b.body.verts * (k === 'uv' || k === 'look' ? 2 : 3)))).toBe(-1);
    }
    expect(differs(bytes(a.hull.position, a.hull.verts * 3), bytes(b.hull.position, b.hull.verts * 3))).toBe(-1);
    expect(a.anchors).toEqual(b.anchors);
  });

  it('gives no NaN and stays inside its buffers, at rest and bent', () => {
    const bent = restPose();
    for (let i = 0; i < bent.joints.length; i++) bent.joints[i] += 0.4 * Math.sin(i * 1.7);
    bent.joints[J.jaw] = 1; bent.joints[J.footL + FOOT.y] = 40;   // a foot out of reach
    bent.tail.fill(0.5);
    for (const o of [build(), build(bent)]) {
      expect(o.body.verts).toBeLessThanOrEqual(DEMON.bodyVerts);
      expect(o.body.indices).toBeLessThanOrEqual(DEMON.bodyIndices);
      expect(o.hull.verts).toBeLessThanOrEqual(DEMON.hullVerts);
      expect(o.hull.indices).toBeLessThanOrEqual(DEMON.hullIndices);
      expect(o.body.verts).toBe(DEMON_LAYOUT.verts);
      for (const [buf, n] of [[o.body.position, o.body.verts * 3], [o.body.normal, o.body.verts * 3], [o.hull.position, o.hull.verts * 3], [o.bones, o.bones.length]] as const) {
        for (let i = 0; i < n; i++) if (!Number.isFinite(buf[i])) throw new Error(`not a number at ${i}`);
      }
      for (let i = 0; i < o.body.verts; i++) expect(Math.abs(Math.hypot(o.body.normal[i * 3], o.body.normal[i * 3 + 1], o.body.normal[i * 3 + 2]) - 1)).toBeLessThan(1e-3);
      for (let i = 0; i < o.body.indices; i++) if (o.body.index[i] >= o.body.verts) throw new Error(`body index ${i}`);
      for (let i = 0; i < o.hull.indices; i++) if (o.hull.index[i] >= o.hull.verts) throw new Error(`hull index ${i}`);
      for (const a of Object.values(o.anchors)) for (const v of a) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('sizes its buffers to the counts plus a quarter', () => {
    const L = DEMON_LAYOUT;
    for (const [size, count] of [[DEMON.bodyVerts, L.verts], [DEMON.bodyIndices, L.indices], [DEMON.hullVerts, L.hullVerts], [DEMON.hullIndices, L.hullIndices]]) {
      expect(size).toBeGreaterThanOrEqual(count * 1.2);
      expect(size).toBeLessThanOrEqual(count * 1.3);
    }
  });

  it('stands 54 px to the top of the head, the feet on the floor', () => {
    const o = demonRest(), head = STAGES.indexOf('head'), legs = STAGES.indexOf('legs');
    let top = -Infinity, low = Infinity;
    for (let i = 0; i < o.body.verts; i++) {
      // the legs and feet: the wings' lowest claws hang a little below the floor at rest, as in the spike
      if (o.body.look[i * 2 + 1] === legs) low = Math.min(low, o.body.position[i * 3 + 1]);
      if (o.body.look[i * 2 + 1] === head) top = Math.max(top, o.body.position[i * 3 + 1]);
    }
    expect(top * DEMON.unit).toBeCloseTo(54, 3);
    expect(DEMON.top).toBe(54);
    expect(Math.abs(low)).toBeLessThan(0.2);   // the foot claws' bellies dip 0.15 into the floor, the spike's
  });

  it('mirrors the left and right bones in z', () => {
    const M = new Float32Array(BONES * 12);
    placeBones(restPose(), M);
    for (const [r, l] of [[BONE.armR, BONE.armL], [BONE.foreR, BONE.foreL], [BONE.handR, BONE.handL], [BONE.thighR, BONE.thighL], [BONE.shinR, BONE.shinL], [BONE.footR, BONE.footL]]) {
      expect(M[r * 12]).toBeCloseTo(M[l * 12], 5);
      expect(M[r * 12 + 1]).toBeCloseTo(M[l * 12 + 1], 5);
      expect(M[r * 12 + 2]).toBeCloseTo(-M[l * 12 + 2], 5);
      expect(M[r * 12 + 2]).toBeGreaterThan(1);
    }
    // the middle bones stay in the middle
    for (const b of [BONE.hips, BONE.spine, BONE.chest, BONE.neck, BONE.head, BONE.jaw]) expect(M[b * 12 + 2]).toBe(0);
  });

  it('stands the legs on the foot points: the rest is the description, a lifted foot bends the knee', () => {
    const M = new Float32Array(BONES * 12), pose = restPose();
    placeBones(pose, M);
    expect(M[BONE.shinR * 12]).toBeCloseTo(RIG.stifle[0], 4);
    expect(M[BONE.shinR * 12 + 1]).toBeCloseTo(RIG.stifle[1], 4);
    expect(M[BONE.footR * 12]).toBeCloseTo(RIG.hock[0], 4);
    expect(M[BONE.footR * 12 + 1]).toBeCloseTo(RIG.hock[1], 4);
    expect(M[BONE.thighR * 12 + 3]).toBeCloseTo(1, 4);   // not turned
    pose.joints[J.footR + FOOT.y] = 3; pose.joints[J.hipsY] = -2;
    placeBones(pose, M);
    expect(M[BONE.footR * 12 + 1]).toBeCloseTo(RIG.hock[1] + 3, 4);
    expect(M[BONE.shinR * 12]).toBeGreaterThan(RIG.stifle[0]);   // the knee goes forward
    expect(M[BONE.footL * 12 + 1]).toBeCloseTo(RIG.hock[1], 4);   // the other foot stays planted under the sunk hips
  });

  it('puts each anchor on its part', () => {
    const o = demonRest(), a = o.anchors;
    for (const p of [a.hand, a.mouth, a.chest, a.eyes]) expect(near(o, p)).toBeLessThan(1.5);
    expect(a.hand[2]).toBeGreaterThan(5);
    expect(a.mouth[2]).toBe(0);
    expect(a.eyes[1]).toBeGreaterThan(a.mouth[1]);
    expect(a.chest[1]).toBeLessThan(a.mouth[1]);
    const left = restPose();
    left.caster = -1;
    expect(build(left).anchors.hand[2]).toBeCloseTo(-a.hand[2], 4);
  });

  it('opens the mouth and curls the fingers by the pose', () => {
    const rest = demonRest(), pose = restPose();
    pose.joints[J.jaw] = 1; pose.joints[J.armR + ARM.curl] = 1;
    const o = build(pose);
    expect(o.anchors.mouth[1]).toBeLessThan(rest.anchors.mouth[1] - 0.3);
    let moved = 0;
    for (let i = 0; i < o.body.verts; i++) if (Math.abs(o.body.position[i * 3 + 1] - rest.body.position[i * 3 + 1]) > 1e-4) moved++;
    expect(moved).toBeGreaterThan(500);
    expect(moved).toBeLessThan(o.body.verts / 4);
    // the right hand's first finger: its second joint comes up and in towards the body; the left hand's stays
    const joint = (SLOT.finger + 1) * 12, left = (SLOT.finger + 11) * 12;
    expect(o.bones[joint + 1]).toBeGreaterThan(rest.bones[joint + 1] + 0.3);
    expect(o.bones[joint + 2]).toBeLessThan(rest.bones[joint + 2] - 0.3);
    expect(o.bones[left + 1]).toBeCloseTo(rest.bones[left + 1], 5);
  });

  it('hangs the webbing on the finger bones and turns it to face behind the wing', () => {
    const o = demonRest(), [nt, nw] = WING_FLAT.cells, p = o.body.position;
    for (const w of DEMON_LAYOUT.wings) {
      const lines = w.fingers.map((f) => centres(o, f));
      for (let i = 0; i < 4; i++) for (let a = 0; a <= nt; a++) {
        const first = w.web + i * (nt + 1) * (nw + 1) + a * (nw + 1), last = first + nw;
        expect(toLine([p[first * 3], p[first * 3 + 1], p[first * 3 + 2]], lines[i])).toBeLessThan(0.05);
        if (i < 3) expect(toLine([p[last * 3], p[last * 3 + 1], p[last * 3 + 2]], lines[i + 1])).toBeLessThan(0.05);
      }
      let back = 0;
      for (let v = w.web; v < w.web + w.webVerts; v++) back += o.body.normal[v * 3];
      expect(back / w.webVerts).toBeLessThan(-0.5);
    }
    // the two wings mirror
    const [r, l] = DEMON_LAYOUT.wings;
    for (let v = 0; v < r.webVerts; v++) {
      expect(p[(r.web + v) * 3 + 2]).toBeCloseTo(-p[(l.web + v) * 3 + 2], 4);
      expect(p[(r.web + v) * 3 + 1]).toBeCloseTo(p[(l.web + v) * 3 + 1], 4);
    }
  });

  it('gives the hull every outlined part and nothing of the webbing', () => {
    const o = demonRest(), swept = [DEMON_LAYOUT.tail, ...DEMON_LAYOUT.wings.flatMap((w) => [w.arm, ...w.fingers])];
    let verts = 0, indices = 0;
    for (const part of PARTS) if (part.line > 0) { verts += part.position.length / 3; indices += part.index.length; }
    for (const t of swept) { verts += (t.N + 1 + 2 * DEMON_LAYOUT.capRings) * (t.K + 1) + 2; indices += (t.N + 2 * DEMON_LAYOUT.capRings + 1) * t.K * 6; }
    expect(o.hull.verts).toBe(verts);
    expect(o.hull.indices).toBe(indices);
    expect(o.body.verts - o.hull.verts).toBeGreaterThanOrEqual(2 * DEMON_LAYOUT.wings[0].webVerts);
    // the hull's points in the body's order without the unlined ones: each lies its line off its body point, along the normal
    let h = 0, v = 0;
    const b = o.body, check = (line: number, n: number): void => {
      for (let i = 0; i < n; i += 7) for (let a = 0; a < 3; a++) expect(o.hull.position[(h + i) * 3 + a]).toBeCloseTo(b.position[(v + i) * 3 + a] + b.normal[(v + i) * 3 + a] * line, 4);
      h += n;
    };
    for (const part of PARTS) { const n = part.position.length / 3; if (part.line > 0) check(part.line, n); v += n; }
    expect(v).toBe(DEMON_LAYOUT.tail.v0);
    for (const t of swept) { v = t.v0; check(Math.hypot(o.hull.position[h * 3] - b.position[v * 3], o.hull.position[h * 3 + 1] - b.position[v * 3 + 1], o.hull.position[h * 3 + 2] - b.position[v * 3 + 2]), (t.N + 1 + 2 * DEMON_LAYOUT.capRings) * (t.K + 1) + 2); }
    expect(h).toBe(o.hull.verts);
  });

  it('demonRest is the rest pose built', () => {
    const a = demonRest(), b = build(restPose());
    expect(differs(bytes(a.body.position, a.body.verts * 3), bytes(b.body.position, b.body.verts * 3))).toBe(-1);
    expect(a.body.verts).toBeGreaterThan(0);
  });
});
