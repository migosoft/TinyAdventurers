import { describe, expect, it } from 'vitest';
import { GroundTooLargeError, limitOr } from './groundError';

describe('limitOr (#353)', () => {
  it('passes a real limit and replaces a missing one: null, undefined, 0, NaN and a non-number', () => {
    expect(limitOr(8192, Infinity)).toBe(8192);
    for (const v of [null, undefined, 0, -1, NaN, '4096']) expect(limitOr(v, Infinity)).toBe(Infinity);
    expect(limitOr(null, 4096)).toBe(4096);
  });

  it('an unknown limit never makes a ground "too large"; a known one does', () => {
    const tooLarge = (w: number, limit: unknown): boolean => w > limitOr(limit, Infinity);
    expect(tooLarge(20000, null)).toBe(false);
    expect(tooLarge(20000, 8192)).toBe(true);
    expect(new GroundTooLargeError(20000, 1, 8192).message).toContain('8192 px');
  });
});
