import { describe, expect, it } from 'vitest';
import { effZoom, pickZoom, renderPlan } from './quality';

describe('effZoom', () => {
  it('follows the rule per level', () => {
    const zs = [2, 3, 4, 5, 6, 7, 8];
    expect(zs.map((z) => effZoom('balanced', z))).toEqual([2, 2, 2, 3, 3, 4, 4]);
    expect(zs.map((z) => effZoom('fast', z))).toEqual([2, 2, 2, 2, 2, 2, 2]);
    expect(zs.map((z) => effZoom('high', z))).toEqual(zs);
  });
});

describe('pickZoom', () => {
  it('fits the window and clamps', () => {
    expect(pickZoom(1920, 1080)).toBe(7);
    expect(pickZoom(300, 200)).toBe(2);
    expect(pickZoom(8000, 8000)).toBe(8);
  });
});

describe('renderPlan', () => {
  it('copies at the effective zoom when it is lower', () => {
    const p = renderPlan('balanced', 4, 1921, 1081);
    expect(p.direct).toBe(false);
    expect(p.ze).toBe(2);
    expect(p.targetW).toBe(962);
    expect(p.targetH).toBe(542);
    expect(p.linear).toBe(false);
    expect(p.dstX).toBe(Math.floor((1921 - 1924) / 2));
  });

  it('is linear when the zoom is not a multiple', () => {
    expect(renderPlan('balanced', 3, 900, 600).linear).toBe(true);
  });

  it('draws direct when ze equals zoom', () => {
    const p = renderPlan('high', 4, 1920, 1080);
    expect(p.direct).toBe(true);
    expect(p.targetW).toBe(1920);
    expect(p.halfW).toBe(1920 / 128);
    expect(renderPlan('balanced', 2, 640, 480).direct).toBe(true);
  });

  it('keeps a target of at least 1x1', () => {
    const p = renderPlan('fast', 5, 1, 1);
    expect(p.targetW).toBeGreaterThanOrEqual(1);
    expect(p.targetH).toBeGreaterThanOrEqual(1);
  });
});
