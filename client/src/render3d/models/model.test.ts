import { describe, expect, it } from 'vitest';
import { BONES, MAX_BENDS, MAX_BONES, STAGES, buildFigure, buildSkull, type FigureModel } from './model';
import { DESCS, type DescKey } from './table';

// A figure takes about half a second to build (two base parts); the tests share the results.
const memo = new Map<string, FigureModel>();
const model = (key: DescKey): FigureModel => {
  let m = memo.get(key);
  if (!m) memo.set(key, (m = buildFigure(key, DESCS[key])));
  return m;
};
const SLOW = 120000;
const KEYS = Object.keys(DESCS) as DescKey[];
const bone = (name: (typeof BONES)[number]): number => BONES.indexOf(name);

describe('buildFigure', () => {
  it('is deterministic', () => {
    const a = buildFigure('wizard', DESCS.wizard), b = model('wizard');
    expect(a.position).toEqual(b.position);
    expect(a.normal).toEqual(b.normal);
    expect(a.skin).toEqual(b.skin);
    expect(a.look).toEqual(b.look);
    expect(a.index).toEqual(b.index);
    expect(a.paint.data).toEqual(b.paint.data);
  }, SLOW);

  it('keeps the streams the same length and every index inside them', () => {
    for (const key of KEYS) {
      const m = model(key), n = m.position.length / 3;
      expect(m.normal.length, key).toBe(n * 3);
      expect(m.uv.length, key).toBe(n * 2);
      expect(m.skin.length, key).toBe(n * 4);
      expect(m.look.length, key).toBe(n * 4);
      for (const i of m.index) expect(i).toBeLessThan(n);
      for (const a of [m.position, m.normal, m.uv, m.skin, m.look]) for (const v of a) expect(Number.isFinite(v)).toBe(true);
      expect(m.paint.data.length, key).toBe(m.paint.w * m.paint.h * 4);
    }
  }, SLOW);

  it('covers the index exactly once with ranges in ascending (stage, line first) order', () => {
    for (const key of KEYS) {
      const m = model(key);
      let at = 0, last = -1;
      for (const r of m.ranges) {
        expect(r.start, key).toBe(at);
        expect(r.count, key).toBeGreaterThan(0);
        expect(r.count % 3, key).toBe(0);
        const order = r.stage * 2 + (r.line ? 0 : 1);
        expect(order, key).toBeGreaterThan(last);
        last = order;
        expect(r.stage).toBeLessThan(STAGES.length);
        at += r.count;
      }
      expect(at, key).toBe(m.index.length);
      expect(m.pieceIndex.length + m.lineIndex.length, key).toBe(m.index.length);
      const lines = m.ranges.filter((r) => r.line).reduce((s, r) => s + r.count, 0);
      expect(m.lineIndex.length, key).toBe(lines);
    }
  }, SLOW);

  it('flags hull vertices only in line ranges and gives them the outline colour', () => {
    for (const key of KEYS) {
      const m = model(key);
      for (const r of m.ranges) for (let k = r.start; k < r.start + r.count; k++) {
        const v = m.index[k];
        expect(m.skin[v * 4 + 1], `${key} stage ${r.stage}`).toBe(r.line ? 1 : 0);
        if (r.line) {
          const o = DESCS[key].outline;
          expect(m.look[v * 4] * 255).toBeCloseTo(o >> 16, 3);
          expect(m.look[v * 4 + 2] * 255).toBeCloseTo(o & 255, 3);
        }
      }
    }
  }, SLOW);

  it('moves every vertex with a bone the figure has', () => {
    for (const key of KEYS) {
      const m = model(key), d = DESCS[key], has = new Set<number>([bone('hips'), bone('body'), bone('head')]);
      if (d.hat) has.add(bone('hat'));
      if (d.arms) for (const n of ['armR', 'handR', 'armL', 'handL'] as const) has.add(bone(n));
      if (d.legs) for (let i = 0; i < (d.legs.at ? d.legs.at.length * 2 : 2); i++) has.add(bone(`leg${i}` as (typeof BONES)[number]));
      const used = new Set<number>();
      for (let i = 0; i < m.skin.length; i += 4) {
        const b = m.skin[i];
        expect(Number.isInteger(b)).toBe(true);
        expect(b).toBeLessThan(MAX_BONES);
        used.add(b);
      }
      for (const b of used) expect(has.has(b), `${key}: bone ${BONES[b]}`).toBe(true);
      if (d.quad) for (const n of ['leg0', 'leg1', 'leg2', 'leg3'] as const) expect(used.has(bone(n)), `${key} ${n}`).toBe(true);
      expect(MAX_BONES).toBe(BONES.length);
    }
  }, SLOW);

  it('has the bends the descriptions ask for', () => {
    const want: Record<DescKey, number> = { elf: 1, knight: 1, wizard: 1, dwarf: 2, wolf: 3, skelet: 0, ogre: 0 };
    for (const key of KEYS) {
      const m = model(key);
      expect(m.bends.length, key).toBe(want[key]);
      expect(m.bends.length).toBeLessThanOrEqual(MAX_BENDS);
      for (let i = 0; i < m.skin.length; i += 4) {
        const b = m.skin[i + 2];
        if (b >= 0) { expect(b).toBeLessThan(m.bends.length); expect(m.skin[i + 3]).toBeGreaterThanOrEqual(0); expect(m.skin[i + 3]).toBeLessThanOrEqual(1); }
        else expect([-1, -2]).toContain(b);
      }
      for (const b of m.bends) { expect(b.len).toBeGreaterThan(0); expect(Math.hypot(...b.dir)).toBeCloseTo(1, 5); }
    }
  }, SLOW);

  it('weights only the wizard\'s robe, 0 at the chest and 1 at the hem', () => {
    for (const key of KEYS) {
      const m = model(key);
      let n = 0, lo = Infinity, hi = -Infinity;
      for (let i = 0; i < m.skin.length; i += 4) if (m.skin[i + 2] === -2) { n++; lo = Math.min(lo, m.skin[i + 3]); hi = Math.max(hi, m.skin[i + 3]); }
      if (key === 'wizard') {
        expect(m.robeTop).not.toBeNull();
        expect(n).toBeGreaterThan(100);
        expect(lo).toBe(0);
        expect(hi).toBe(1);
      } else { expect(m.robeTop, key).toBeNull(); expect(n, key).toBe(0); }
    }
  }, SLOW);

  it('stands the elf 15.3, the knight 15, the dwarf 14 and the wizard 13 sprite pixels high', () => {
    expect(model('elf').baseHeight).toBeCloseTo(15.3, 0);
    expect(Math.abs(model('elf').baseHeight - 15.3)).toBeLessThan(0.2);
    expect(Math.abs(model('knight').baseHeight - 15)).toBeLessThan(0.2);
    expect(Math.abs(model('dwarf').baseHeight - 14)).toBeLessThan(0.2);
    expect(Math.abs(model('wizard').baseHeight - 13)).toBeLessThan(0.2);
  }, SLOW);

  it('records the skeleton: parents, pivots and the numbers the pose needs', () => {
    for (const key of KEYS) {
      const m = model(key), d = DESCS[key];
      expect(m.parents.length).toBe(MAX_BONES);
      expect(m.pivots.length).toBe(MAX_BONES * 3);
      expect(m.parents[bone('hips')]).toBe(-1);
      expect(m.parents[bone('body')]).toBe(bone('hips'));
      expect(m.parents[bone('head')]).toBe(bone('body'));
      expect(m.parents[bone('hat')]).toBe(bone('head'));
      expect(m.parents[bone('handR')]).toBe(bone('armR'));
      expect(m.parents[bone('leg0')]).toBe(bone('hips'));
      expect(m.scale).toBe(d.scale ?? 1);
      expect(m.quad).toBe(!!d.quad);
      expect(m.pivots[bone('body') * 3 + 1]).toBeCloseTo(m.hipY, 5);
      expect(m.pivots[bone('head') * 3]).toBeCloseTo(m.neck[0], 5);
      expect(m.pivots[bone('head') * 3 + 1]).toBeCloseTo(m.neck[1], 5);
      if (d.arms) {
        expect(m.armLength).toBe(d.arms.length);
        expect(m.armRadius).toBe(d.arms.radius);
        expect(m.shoulderY).toBeCloseTo(28 - d.arms.row, 5);
        expect(m.handY).toBeCloseTo(-d.arms.length + d.arms.radius * 0.8, 5);
        expect(m.pivots[bone('armR') * 3 + 2]).toBeGreaterThan(0);
        expect(m.pivots[bone('armL') * 3 + 2]).toBe(-m.pivots[bone('armR') * 3 + 2]);
        expect(m.pivots[bone('armR') * 3 + 1]).toBeCloseTo(m.shoulderY, 5);
      }
      expect(m.radius, key).toBeGreaterThan(0.3);
      expect(m.radius, key).toBeLessThan(4);
    }
  }, SLOW);

  it('reads the paint of the base parts and nothing else', () => {
    for (const key of KEYS) {
      const m = model(key);
      let paint = 0, flat = 0;
      for (let i = 0; i < m.look.length; i += 4) { if (m.look[i] < 0) paint++; else flat++; }
      expect(paint, key).toBeGreaterThan(1000);
      expect(flat, key).toBeGreaterThan(100);
      for (let i = 0; i < m.uv.length; i++) { expect(m.uv[i]).toBeGreaterThanOrEqual(0); expect(m.uv[i]).toBeLessThanOrEqual(1); }
    }
  }, SLOW);

  it('pins every assembled figure (a hash of the positions)', () => {
    const hash: Record<string, string> = {};
    for (const key of KEYS) {
      let h = 0x811c9dc5;
      for (const v of model(key).position) {
        h = (h ^ (Math.round(v * 1e4) | 0)) >>> 0;
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      hash[key] = h.toString(16);
    }
    expect(hash).toEqual({
      dwarf: '4bbcd23e', elf: '3c5699c', knight: '47d99c7b', ogre: '66ab433b', skelet: '89e4237d', wizard: '15ed1194', wolf: 'a1605cc6',
    });
  }, SLOW);
});

describe('buildSkull', () => {
  it('has the head stage only, on one bone, tipped and lifted', () => {
    const s = buildSkull(), head = STAGES.indexOf('head');
    expect(s.ranges.length).toBeGreaterThan(0);
    for (const r of s.ranges) expect(r.stage).toBe(head);
    expect(s.ranges.some((r) => r.line)).toBe(true);
    expect(s.ranges.some((r) => !r.line)).toBe(true);
    const bones = new Set<number>();
    for (let i = 0; i < s.skin.length; i += 4) bones.add(s.skin[i]);
    expect(bones.size).toBe(1);
    let lo = Infinity;
    for (let k = 1; k < s.position.length; k += 3) lo = Math.min(lo, s.position[k]);
    expect(lo).toBeGreaterThan(-4);
    expect(lo).toBeLessThan(2);
  }, SLOW);
});
