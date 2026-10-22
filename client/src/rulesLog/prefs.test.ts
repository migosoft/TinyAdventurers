import { describe, expect, it } from 'vitest';
import { loadPrefs, savePrefs } from './prefs';

const DEFAULTS = { on: false, details: true };

describe('prefs', () => {
  it('prefs survive a throwing storage', () => {
    const bad = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadPrefs(bad)).toEqual(DEFAULTS);
    expect(() => savePrefs(bad, { on: true, details: false })).not.toThrow();
    expect(loadPrefs(null)).toEqual(DEFAULTS);
    expect(() => savePrefs(null, DEFAULTS)).not.toThrow();
  });

  it('prefs round-trip', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    savePrefs(store, { on: true, details: false });
    expect(m.has('ta.rulesLog')).toBe(true);
    expect(loadPrefs(store)).toEqual({ on: true, details: false });
  });

  it('bad JSON gives the defaults', () => {
    expect(loadPrefs({ getItem: () => '{nope' })).toEqual(DEFAULTS);
    expect(loadPrefs({ getItem: () => '42' })).toEqual(DEFAULTS);
    expect(loadPrefs({ getItem: () => null })).toEqual(DEFAULTS);
  });
});
