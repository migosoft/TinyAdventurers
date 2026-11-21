import { describe, expect, it } from 'vitest';
import { effZoom, pickZoom, renderPlan } from './quality';

describe('effZoom', () => {
  it('follows the rule per level', () => {
    const zs = [2, 3, 4, 5, 6, 7, 8];
    expect(zs.map((z) => effZoom('balanced', z))).toEqual([2, 2, 2, 3, 3, 4, 4]);
    expect(zs.map((z) => effZoom('fast', z))).toEqual([2, 2, 2, 2, 2, 2, 2]);
    expect(zs.map((z) => effZoom('high', z))).toEqual(zs);
  });

  it('gives a whole number for a fractional zoom', () => {
    expect(effZoom('high', 4.5)).toBe(5);
    expect(effZoom('balanced', 5.3)).toBe(3);
    expect(effZoom('balanced', 13.3)).toBe(7);
    expect(effZoom('fast', 13.3)).toBe(2);
    expect(effZoom('balanced', 1.5)).toBe(2);
    expect(effZoom('high', 2.857)).toBe(3);
  });

  it('never exceeds the zoom: at zoom 1 every quality gives 1', () => {
    for (const q of ['fast', 'balanced', 'high'] as const) expect(effZoom(q, 1)).toBe(1);
    expect(renderPlan('balanced', 1, 1280, 720).direct).toBe(true);
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
  it('holds the art size in both modes', () => {
    const h = renderPlan('high', 3, 1000, 700);
    expect([h.artW, h.artH]).toEqual([334, 234]);
    const hi = renderPlan('high', 4, 1921, 1081), ba = renderPlan('balanced', 4, 1921, 1081);
    expect([ba.artW, ba.artH]).toEqual([hi.artW, hi.artH]);
    expect([ba.artW, ba.artH]).toEqual([482, 272]);
  });

  it('rounds the art size up to even, so art px edges never land on texel centres', () => {
    for (const q of ['high', 'balanced', 'fast'] as const) {
      for (const z of [1, 2, 2.857, 3, 3.01, 4.37, 4.5, 5, 7.7, 12.63]) {
        for (const [w, h] of [[1281, 767], [1, 1], [1920, 1080], [1280, 768]]) {
          const p = renderPlan(q, z, w, h);
          expect(p.artW % 2, `${q} ${z} ${w}x${h}`).toBe(0);
          expect(p.artH % 2, `${q} ${z} ${w}x${h}`).toBe(0);
          expect(p.artW * z).toBeGreaterThanOrEqual(w);
          expect(p.artH * z).toBeGreaterThanOrEqual(h);
        }
      }
    }
  });

  it('copies at the effective zoom when it is lower', () => {
    const p = renderPlan('balanced', 4, 1921, 1081);
    expect(p.direct).toBe(false);
    expect(p.ze).toBe(2);
    expect(p.targetW).toBe(964);
    expect(p.targetH).toBe(544);
    expect(p.scaleX).toBe(2);
    expect(p.dstX).toBe(Math.floor((1921 - 1928) / 2));
  });

  it('scales by a whole ratio when the zoom is a multiple, by a fraction otherwise', () => {
    expect(renderPlan('balanced', 4, 1921, 1081).scaleX).toBe(2);
    const p = renderPlan('balanced', 5, 1280, 768);
    expect(p.ze).toBe(3);
    expect(p.scaleX).toBeCloseTo(5 / 3, 1);
    expect(p.direct).toBe(false);
  });

  it('plans a fractional zoom that is shrunk to a whole target', () => {
    const p = renderPlan('high', 4.5, 1280, 768);
    expect(p.ze).toBe(5);
    expect(p.targetW).toBe(286 * 5);
    expect(p.scaleX).toBeLessThan(1);
    expect(p.dstW).toBe(Math.round(286 * 4.5));
    expect(p.dstW).toBeGreaterThanOrEqual(1280);
  });

  it('always covers the canvas with a whole target, for any zoom', () => {
    for (const q of ['high', 'balanced', 'fast'] as const) {
      for (const z of [1, 2.857, 4.37, 5, 7.7, 12.63]) {
        for (const [w, h] of [[1281, 767], [1, 1], [1920, 1080]]) {
          const p = renderPlan(q, z, w, h);
          const tag = `${q} ${z} ${w}x${h}`;
          expect(Number.isInteger(p.targetW) && p.targetW >= 1, tag).toBe(true);
          expect(Number.isInteger(p.targetH) && p.targetH >= 1, tag).toBe(true);
          expect(p.dstW, tag).toBeGreaterThanOrEqual(w);
          expect(p.dstH, tag).toBeGreaterThanOrEqual(h);
          expect(p.dstX, tag).toBeLessThanOrEqual(0);
          expect(p.dstY, tag).toBeLessThanOrEqual(0);
          expect(p.dstX + p.dstW, tag).toBeGreaterThanOrEqual(w);
          expect(p.dstY + p.dstH, tag).toBeGreaterThanOrEqual(h);
        }
      }
    }
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
