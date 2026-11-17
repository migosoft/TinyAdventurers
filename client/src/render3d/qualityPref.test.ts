import { describe, expect, it, vi } from 'vitest';
import { loadQuality, saveQuality, QUALITY_KEY } from './qualityPref';

const store = (v: string | null) => ({ getItem: () => v });
const throwing = () => { throw new Error('blocked'); };

describe('loadQuality', () => {
  it('is balanced without a store', () => expect(loadQuality(null)).toBe('balanced'));
  it('is balanced for missing or unknown values', () => {
    for (const v of [null, '', 'ultra', '{"q":"fast"}']) expect(loadQuality(store(v))).toBe('balanced');
  });
  it('reads a stored quality', () => expect(loadQuality(store('fast'))).toBe('fast'));
  it('is balanced when the store throws', () => expect(loadQuality({ getItem: throwing })).toBe('balanced'));
});

describe('saveQuality', () => {
  it('writes the key', () => {
    const setItem = vi.fn();
    saveQuality({ setItem }, 'high');
    expect(setItem).toHaveBeenCalledWith(QUALITY_KEY, 'high');
    expect(QUALITY_KEY).toBe('ta.quality');
  });
  it('does not throw when the store throws', () => {
    expect(() => saveQuality({ setItem: throwing }, 'fast')).not.toThrow();
  });
  it('does nothing without a store', () => {
    expect(() => saveQuality(null, 'fast')).not.toThrow();
  });
});
