import { describe, expect, it } from 'vitest';
import { bandOrder } from './settle';

describe('bandOrder', () => {
  it('goes outward from the centre row, upper row first on a tie, and covers every row once', () => {
    expect(bandOrder(7, 3)).toEqual([3, 2, 4, 1, 5, 0, 6]);
    expect(bandOrder(5, 0)).toEqual([0, 1, 2, 3, 4]);
    expect(bandOrder(4, 99)).toEqual([3, 2, 1, 0]);
    expect([...bandOrder(50, 20.7)].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });
});
