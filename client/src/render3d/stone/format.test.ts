import { describe, expect, it } from 'vitest';
import { FLAG, FLAT_A, SLOPES, decodeRelief, encodeRelief } from './format';

describe('relief byte', () => {
  it('round-trips every (sx, sy, flag)', () => {
    for (let sx = 0; sx < SLOPES.length; sx++) for (let sy = 0; sy < SLOPES.length; sy++) for (const flag of [FLAG.plain, FLAG.groove, FLAG.pit]) {
      const d = decodeRelief(encodeRelief(SLOPES[sx], SLOPES[sy], flag));
      expect(d).toEqual({ dhdu: SLOPES[sx], dhdv: SLOPES[sy], flag });
    }
  });

  it('FLAT_A decodes to zero slope and plain', () => {
    expect(decodeRelief(FLAT_A)).toEqual({ dhdu: 0, dhdv: 0, flag: FLAG.plain });
  });

  it('a slope beyond the table clamps to its end', () => {
    const d = decodeRelief(encodeRelief(99, -99, FLAG.plain));
    expect(d.dhdu).toBe(SLOPES[SLOPES.length - 1]);
    expect(d.dhdv).toBe(SLOPES[0]);
  });

  it('the slopes are symmetric about zero and fit a byte', () => {
    expect(SLOPES.length).toBe(7);
    SLOPES.forEach((s, i) => expect(s).toBe(-SLOPES[SLOPES.length - 1 - i] || 0));
    expect(encodeRelief(0.5, 0.5, FLAG.pit)).toBeLessThan(256);
  });
});
