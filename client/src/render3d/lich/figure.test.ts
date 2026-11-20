import { describe, expect, it } from 'vitest';
import { ANIM } from '../../generated/defs';
import { BUILT_OF_KIND, builtOf, builtPoint, type BuiltIn } from '../built';
import { LICH_FIGURE } from './figure';
import { LICH, LICH_TOP } from './shape';
import { KIND } from '../../generated/defs';

const idle = (o: Partial<BuiltIn> = {}): BuiltIn => ({ anim: ANIM.Idle, animT: 0, effects: 0, flags: 0, aim: 0, look: null, x: 3, z: 4, ...o });

describe('LICH_FIGURE', () => {
  it('is the figure of the lich kind, with the builder\'s numbers', () => {
    expect(builtOf(KIND.Lich)).toBe(LICH_FIGURE);
    expect(Object.keys(BUILT_OF_KIND)).toEqual([String(KIND.Lich)]);
    expect(builtOf(KIND.Knight)).toBeNull();
    expect(LICH_FIGURE).toMatchObject({ key: 'lich', picture: 'lich', unit: LICH.unit, hem: LICH.hem });
    expect(LICH_FIGURE.top).toBe(LICH_TOP * LICH.unit);
  });

  it('keeps two memories apart: separate buffers, and drawing one does not change the other', () => {
    const a = LICH_FIGURE.newMem(), b = LICH_FIGURE.newMem();
    const da = LICH_FIGURE.draw(idle(), 0.016, a);
    const before = Float32Array.from(da.body.position.subarray(0, da.body.verts * 3));
    const db = LICH_FIGURE.draw(idle({ x: 9, anim: ANIM.Slam, animT: 1, aim: 2 }), 0.016, b);
    expect(da.body).not.toBe(db.body);
    expect(da.body.position).not.toBe(db.body.position);
    expect(Array.from(da.body.position.subarray(0, da.body.verts * 3))).toEqual(Array.from(before));
  });

  it('draws the same twice with dt 0', () => {
    const m = LICH_FIGURE.newMem();
    const d1 = LICH_FIGURE.draw(idle(), 0.016, m);
    const p1 = Float32Array.from(d1.body.position.subarray(0, d1.body.verts * 3));
    const d2 = LICH_FIGURE.draw(idle(), 0, m);
    expect(d2.body.verts).toBe(d1.body.verts);
    expect(Array.from(d2.body.position.subarray(0, d2.body.verts * 3))).toEqual(Array.from(p1));
  });

  it('hands back four halos, a magic gem above 0, the levels and a free yaw', () => {
    const m = LICH_FIGURE.newMem();
    const d = LICH_FIGURE.draw(idle({ aim: 1 }), 0.016, m);
    expect(d.halos.length).toBe(4);
    expect(d.halos[3].r).toBe(2.6);
    expect(d.magic.gem).toBeGreaterThan(0);
    expect(d.levels[0]).toBeGreaterThan(0);
    expect(d.levels[3]).toBe(0);
    expect(d.yaw).toBeCloseTo(1, 9);          // the first frame faces the aim
    expect(d.glow).not.toBeNull();
    for (const h of d.halos) expect(h.rgb.every((v) => v >= 0)).toBe(true);
  });
});

describe('builtPoint', () => {
  it('turns by the yaw as the instance row does (+x to (cos, sin)), scales, lifts and stretches the height', () => {
    const out: [number, number, number] = [0, 0, 0];
    builtPoint([2, 3, 1], 10, 20, 0.5, 0, 0.1, 1.5, out);
    expect(out[0]).toBeCloseTo(10.2, 6); expect(out[1]).toBeCloseTo(0.5 + 3 * 0.1 * 1.5, 6); expect(out[2]).toBeCloseTo(20.1, 6);
    builtPoint([2, 3, 1], 10, 20, 0.5, Math.PI / 2, 0.1, 1, out);
    expect(out[0]).toBeCloseTo(10 - 0.1, 6); expect(out[2]).toBeCloseTo(20.2, 6);
  });
});
