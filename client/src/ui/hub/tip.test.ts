import { describe, expect, it } from 'vitest';
import { tipPosition } from './tip';

const box = (left: number, w = 40) => ({ left, right: left + w, width: w, top: 100, bottom: 140, height: 40 });

describe('tipPosition', () => {
  it('places a tip to the right when it fits', () => expect(tipPosition(box(100), 200, 80, 'right', 1280, 720).left).toBe(174));
  it('flips to the left when the right side would leave the window', () => expect(tipPosition(box(1100), 200, 80, 'right', 1280, 720).left).toBe(1100 - 34 - 200));
  it('flips a left tip to the right when the left side is too narrow', () => expect(tipPosition(box(100), 200, 80, 'left', 1280, 720).left).toBe(174));
  it('keeps a tip that fits nowhere inside the window', () => expect(tipPosition(box(10), 300, 80, 'right', 320, 720).left).toBe(12));
  it('centres a tip below its anchor', () => expect(tipPosition(box(100), 200, 80, 'below', 1280, 720)).toEqual({ left: 20, top: 150 }));
});
