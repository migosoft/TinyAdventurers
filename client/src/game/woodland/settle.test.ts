import { describe, expect, it } from 'vitest';
import { bandOrder, PendingGrid, windowSettled } from './settle';

describe('bandOrder', () => {
  it('goes outward from the centre row, upper row first on a tie, and covers every row once', () => {
    expect(bandOrder(7, 3)).toEqual([3, 2, 4, 1, 5, 0, 6]);
    expect(bandOrder(5, 0)).toEqual([0, 1, 2, 3, 4]);
    expect(bandOrder(4, 99)).toEqual([3, 2, 1, 0]);
    expect([...bandOrder(50, 20.7)].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });
});

describe('windowSettled', () => {
  const win = { x0: 100, y0: 100, x1: 400, y1: 300 };
  it('needs the strips the window touches', () => {
    const p = new PendingGrid();
    expect(windowSettled(win, 64, (n) => n >= 1 && n <= 4, 1000, p)).toBe(true);
    expect(windowSettled(win, 64, (n) => n >= 1 && n <= 3, 1000, p)).toBe(false);
    expect(windowSettled({ ...win, y1: 5000 }, 64, () => true, 640, p)).toBe(true); // clipped to the map
  });
  it('waits for plants pending inside the window, not outside', () => {
    const p = new PendingGrid();
    p.add(2000, 2000);
    expect(windowSettled(win, 64, () => true, 1000, p)).toBe(true);
    p.add(250, 150);
    expect(windowSettled(win, 64, () => true, 1000, p)).toBe(false);
    p.remove(250, 150);
    expect(windowSettled(win, 64, () => true, 1000, p)).toBe(true);
  });
});
