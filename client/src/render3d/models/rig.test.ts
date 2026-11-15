import { describe, expect, it } from 'vitest';
import { buildFigure, BONES, MAX_BONES, type FigureModel } from './model';
import { composeBones, identityLocals } from './rig';
import { DESCS } from './table';

// One cheap figure, built once.
let skelet: FigureModel | null = null;
const model = (): FigureModel => (skelet ??= buildFigure('skelet', DESCS.skelet));
const bone = (name: (typeof BONES)[number]): number => BONES.indexOf(name);
/** A bone's 3x4 matrix applied to a point. */
const apply = (out: Float32Array, b: number, p: [number, number, number]): [number, number, number] => {
  const o = b * 12;
  return [0, 1, 2].map((r) => out[o + r * 4] * p[0] + out[o + r * 4 + 1] * p[1] + out[o + r * 4 + 2] * p[2] + out[o + r * 4 + 3]) as [number, number, number];
};
const pivotOf = (m: FigureModel, name: (typeof BONES)[number]): [number, number, number] => {
  const b = bone(name);
  return [m.pivots[b * 3], m.pivots[b * 3 + 1], m.pivots[b * 3 + 2]];
};
const SLOW = 120000;

describe('composeBones', () => {
  it('gives the identity for every bone when no bone is turned, scaled or shifted', () => {
    const m = model(), out = new Float32Array(MAX_BONES * 12).fill(7);
    composeBones(m, identityLocals(), out);
    for (let b = 0; b < MAX_BONES; b++) {
      const e = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
      for (let k = 0; k < 12; k++) expect(out[b * 12 + k], `bone ${b} element ${k}`).toBeCloseTo(e[k], 6);
    }
  }, SLOW);

  it('turns the head about the body pivot when the body turns 90 degrees about z', () => {
    const m = model(), local = identityLocals(), out = new Float32Array(MAX_BONES * 12);
    local[bone('body')].rz = Math.PI / 2;
    composeBones(m, local, out);
    const body = pivotOf(m, 'body'), head = pivotOf(m, 'head');
    const dx = head[0] - body[0], dy = head[1] - body[1];
    const got = apply(out, bone('head'), head);
    // (dx, dy) turned a quarter circle anticlockwise: (-dy, dx).
    expect(got[0]).toBeCloseTo(body[0] - dy, 4);
    expect(got[1]).toBeCloseTo(body[1] + dx, 4);
    expect(got[2]).toBeCloseTo(head[2], 4);
    // The body's own pivot stays where it is.
    const own = apply(out, bone('body'), body);
    body.forEach((v, i) => expect(own[i]).toBeCloseTo(v, 4));
  }, SLOW);

  it('halves the distance of a foot vertex from the hip when a leg is scaled to half its length', () => {
    const m = model(), local = identityLocals(), out = new Float32Array(MAX_BONES * 12);
    const leg = bone('leg0'), hip = pivotOf(m, 'leg0');
    local[leg].sy = 0.5;
    composeBones(m, local, out);
    let foot = -1, low = Infinity;
    for (let i = 0; i < m.position.length / 3; i++) if (m.skin[i * 4] === leg && m.position[i * 3 + 1] < low) { low = m.position[i * 3 + 1]; foot = i; }
    expect(foot).toBeGreaterThanOrEqual(0);
    const p: [number, number, number] = [m.position[foot * 3], m.position[foot * 3 + 1], m.position[foot * 3 + 2]];
    const q = apply(out, leg, p);
    expect(hip[1] - q[1]).toBeCloseTo((hip[1] - p[1]) / 2, 4);
    expect(q[0]).toBeCloseTo(p[0], 4);
    expect(q[2]).toBeCloseTo(p[2], 4);
  }, SLOW);

  it('composes a child on its parent: the hand follows the arm that turns', () => {
    const m = model(), local = identityLocals(), out = new Float32Array(MAX_BONES * 12);
    local[bone('armR')].rz = 1;
    composeBones(m, local, out);
    const p = pivotOf(m, 'handR');
    const a = apply(out, bone('armR'), [p[0], p[1] - 3, p[2]]), h = apply(out, bone('handR'), [p[0], p[1] - 3, p[2]]);
    a.forEach((v, i) => expect(h[i]).toBeCloseTo(v, 5));
    expect(Math.abs(a[0] - p[0])).toBeGreaterThan(1);
  }, SLOW);

  it('takes a quaternion in place of the angles when one is given', () => {
    const m = model(), local = identityLocals(), out = new Float32Array(MAX_BONES * 12), viaAngles = new Float32Array(MAX_BONES * 12);
    local[bone('body')].rz = 0.7;
    composeBones(m, local, viaAngles);
    local[bone('body')].rz = 0;
    local[bone('body')].q = [0, 0, Math.sin(0.35), Math.cos(0.35)];
    composeBones(m, local, out);
    for (let k = 0; k < out.length; k++) expect(out[k]).toBeCloseTo(viaAngles[k], 5);
  }, SLOW);
});
