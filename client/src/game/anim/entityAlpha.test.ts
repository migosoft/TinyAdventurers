import { describe, expect, it } from 'vitest';
import { EFFECT, FLAG } from '../../generated/defs';
import { appearFactor, entityAlpha, ghostAlpha, ghostPhase, ghostPulse, GHOST_FLICKER_SECS, GHOST_PULSE_SECS, skimsTerrain, splashes, INCORPOREAL_ALPHA, INVISIBLE_PARTY_ALPHA, Marks } from './entityAlpha';

describe('entityAlpha', () => {
  it('is opaque for an ordinary figure', () => {
    expect(entityAlpha(0, 0, false)).toBe(1);
    expect(entityAlpha(FLAG.HURT, 1 << EFFECT.Burning, true)).toBe(1);
  });
  it('draws an incorporeal figure semi-transparent', () => {
    expect(entityAlpha(FLAG.INCORPOREAL, 0, false)).toBe(INCORPOREAL_ALPHA);
    expect(entityAlpha(FLAG.INCORPOREAL, 0, false, undefined, 0.75)).toBe(0.75); // the Shade's own
    expect(INCORPOREAL_ALPHA).toBe(0.6);
  });
  it('draws an invisible party hero fainter still', () => {
    expect(entityAlpha(0, 1 << EFFECT.Invisible, true)).toBe(INVISIBLE_PARTY_ALPHA);
    expect(INVISIBLE_PARTY_ALPHA).toBe(0.35);
    expect(entityAlpha(FLAG.INCORPOREAL, 1 << EFFECT.Invisible, true)).toBe(INVISIBLE_PARTY_ALPHA);
  });
  it('ignores Invisible on a non-party figure (it is not sent anyway)', () => {
    expect(entityAlpha(0, 1 << EFFECT.Invisible, false)).toBe(1);
  });
});

describe('appearFactor', () => {
  it('rises from 0 to 1 over the fade', () => {
    expect(appearFactor(0.3, 0.3)).toBe(0);
    expect(appearFactor(0.15, 0.3)).toBeCloseTo(0.5);
    expect(appearFactor(0, 0.3)).toBe(1);
    expect(appearFactor(-1, 0.3)).toBe(1);
    expect(appearFactor(0, 0)).toBe(1);
  });
});

describe('Marks', () => {
  it('is taken once, and only while fresh', () => {
    const m = new Marks(1);
    m.add(7, 10);
    expect(m.take(7, 10.5)).toBe(true);
    expect(m.take(7, 10.6)).toBe(false);
    m.add(8, 10);
    expect(m.take(8, 12)).toBe(false);
  });
  it('prunes stale marks and forgets deleted ones', () => {
    const m = new Marks(1);
    m.add(1, 0);
    m.add(2, 5);
    m.add(3, 5);
    m.delete(3);
    m.prune(5.5);
    expect(m.size).toBe(1);
  });
});

describe('skimsTerrain', () => {
  it('is true for a dash or an incorporeal figure only', () => {
    expect(skimsTerrain(0, false)).toBe(false);
    expect(skimsTerrain(FLAG.HURT, false)).toBe(false);
    expect(skimsTerrain(0, true)).toBe(true);
    expect(skimsTerrain(FLAG.INCORPOREAL, false)).toBe(true);
  });
});

describe('splashes', () => {
  it('is false only for an incorporeal figure', () => {
    expect(splashes(0)).toBe(true);
    expect(splashes(FLAG.HURT)).toBe(true);
    expect(splashes(FLAG.INCORPOREAL)).toBe(false);
  });
});

describe('the Ghost', () => {
  it('pulses between 0.55 and 0.85 with a period of 1.5 s', () => {
    expect(GHOST_PULSE_SECS).toBe(1.5);
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < 300; i++) {
      const p = ghostPulse(i * 0.01, 0.7);
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
      expect(p).toBeGreaterThanOrEqual(0.55 - 1e-9);
      expect(p).toBeLessThanOrEqual(0.85 + 1e-9);
      expect(ghostPulse(i * 0.01 + 1.5, 0.7)).toBeCloseTo(p, 9);
    }
    expect(lo).toBeCloseTo(0.55, 2);
    expect(hi).toBeCloseTo(0.85, 2);
  });
  it('does not pulse in step across ids', () => {
    const phases = new Set([1, 2, 3, 4, 5].map((id) => ghostPhase(id).toFixed(3)));
    expect(phases.size).toBe(5);
    for (const id of [0, 1, 99, 123456]) expect(ghostPhase(id)).toBeGreaterThanOrEqual(0);
  });
  it('is drawn at the pulse instead of INCORPOREAL_ALPHA, never multiplied with it', () => {
    for (const t of [0, 0.3, 0.9, 1.2]) {
      const pulse = ghostPulse(t, 1);
      expect(entityAlpha(FLAG.INCORPOREAL, 0, false, { t, phase: 1, ambushT: null })).toBeCloseTo(pulse, 9);
      expect(entityAlpha(FLAG.INCORPOREAL, 0, false, { t, phase: 1, ambushT: null })).not.toBeCloseTo(INCORPOREAL_ALPHA * pulse, 3);
    }
  });
  it('flickers between 0 and the pulse every 60 ms during the ambush wind-up', () => {
    expect(GHOST_FLICKER_SECS).toBe(0.06);
    const seen = new Set<string>();
    for (let a = 0; a < 0.2; a += 0.005) {
      const v = ghostAlpha(5 + a, 0.3, a);
      seen.add(v === 0 ? 'off' : v > 0.5 ? 'on' : 'other');
      if (v !== 0) expect(v).toBeCloseTo(ghostPulse(5 + a, 0.3), 9);
    }
    expect([...seen].sort()).toEqual(['off', 'on']);
  });
  it('never flickers outside the wind-up', () => {
    for (let t = 0; t < 3; t += 0.01) expect(ghostAlpha(t, 0, null)).toBeGreaterThan(0.5);
  });
});
