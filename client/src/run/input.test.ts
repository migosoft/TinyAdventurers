import { describe, expect, it } from 'vitest';
import { dir8, NO_INPUT } from './input';

describe('dir8', () => {
  it('picks the nearest of the eight directions', () => {
    expect(dir8(1, 0)).toEqual({ mx: 1, my: 0 });
    expect(dir8(0.7, -0.7)).toEqual({ mx: 1, my: -1 });
    expect(dir8(0.9, 0.3)).toEqual({ mx: 1, my: 0 });
    expect(dir8(0.6, 0.5)).toEqual({ mx: 1, my: 1 });
  });
  it('picks the west, north and south sides too', () => {
    expect(dir8(-1, 0)).toEqual({ mx: -1, my: 0 });
    expect(dir8(-0.7, 0.7)).toEqual({ mx: -1, my: 1 });
    expect(dir8(-0.7, -0.7)).toEqual({ mx: -1, my: -1 });
    expect(dir8(-0.9, 0.3)).toEqual({ mx: -1, my: 0 });
    expect(dir8(0, -1)).toEqual({ mx: 0, my: -1 });
    expect(dir8(0.2, -0.9)).toEqual({ mx: 0, my: -1 });
    expect(dir8(0, 1)).toEqual({ mx: 0, my: 1 });
    expect(dir8(-0.2, 0.9)).toEqual({ mx: 0, my: 1 });
  });
  it('is (0, 0) below a length of 1e-6', () => {
    expect(dir8(0, 0)).toEqual({ mx: 0, my: 0 });
    expect(dir8(-1e-9, 0)).toEqual({ mx: 0, my: 0 });
  });
  it('NO_INPUT is idle', () => {
    expect(NO_INPUT).toEqual({ mx: 0, my: 0, primary: false, secondary: false, act: false, held: false });
  });
});
