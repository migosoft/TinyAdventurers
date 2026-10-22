import { describe, expect, it } from 'vitest';
import { critLabel, popScale, WORLD_TEXT } from './worldText';

describe('world text', () => {
  it('labels a crit with its number only', () => expect(critLabel(23.6)).toBe('24'));
  it('pops a crit from 1.4 down to 1 within 0.12 s', () => {
    expect(popScale(0)).toBeCloseTo(1.4);
    expect(popScale(0.06)).toBeGreaterThan(1);
    expect(popScale(0.12)).toBe(1);
    expect(popScale(0.5)).toBe(1);
  });
  it('keeps every world text at or above 6 world px', () => {
    for (const t of Object.values(WORLD_TEXT)) expect(t.size).toBeGreaterThanOrEqual(6);
  });
});
