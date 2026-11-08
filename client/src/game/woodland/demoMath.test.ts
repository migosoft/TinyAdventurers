import { describe, expect, it, vi } from 'vitest';

// unseenfx.ts imports Phaser, which needs a browser; only DEFAULT_HAZE is used here.
vi.mock('phaser', () => ({ default: { Renderer: { WebGL: { Pipelines: { PostFXPipeline: class {} } } } } }));

import { DEFAULT_HAZE } from '../unseenfx';
import { DEFAULT_CLOUDS } from './clouds';
import { ELEV, HAZE_STEPS, nextSeed, stepAlpha, stepCloud, stepElev, stepHaze, stepTiles, stepToward, TILES, zoomForTiles } from './demoMath';

describe('woodland demo math', () => {
  it('steps each cloud value up and down without float drift', () => {
    let l = { size: 360, speed: 14, dark: 0.22, cover: 0.35 };
    for (let i = 0; i < 3; i++) l = stepCloud(l, 'dark', 1);
    expect(l.dark).toBe(0.34);
    l = stepCloud(l, 'dark', -1);
    expect(l.dark).toBe(0.3);
    expect(stepCloud(l, 'size', 1).size).toBe(420);
    expect(stepCloud(l, 'speed', -1).speed).toBe(10);
    expect(stepCloud(l, 'cover', 1).cover).toBe(0.4);
  });
  it('clamps at the ends of the range', () => {
    expect(stepCloud({ ...DEFAULT_CLOUDS, dark: 0.02 }, 'dark', -1).dark).toBe(0);
    expect(stepCloud({ ...DEFAULT_CLOUDS, cover: 0.98 }, 'cover', 1).cover).toBe(1);
    expect(stepCloud({ ...DEFAULT_CLOUDS, size: 130 }, 'size', -1).size).toBe(120);
  });
  it('fits 20 tiles across the width', () => {
    expect(zoomForTiles(320, 20, 16)).toBe(1);
    expect(zoomForTiles(412, 20, 16) * 20 * 16).toBeCloseTo(412);
  });
  it('steps the zoom in 4 tiles within 16..48', () => {
    expect(TILES.def).toBe(32);
    expect(stepTiles(32, 1)).toBe(36);
    expect(stepTiles(32, -1)).toBe(28);
    expect(stepTiles(16, -1)).toBe(16);
    expect(stepTiles(48, 1)).toBe(48);
  });
  it('wraps the seed', () => {
    expect([nextSeed(1, 3), nextSeed(2, 3), nextSeed(3, 3)]).toEqual([2, 3, 1]);
  });
  it('walks towards a target and arrives', () => {
    expect(stepToward(0, 0, 10, 0, 4)).toEqual({ x: 4, y: 0, arrived: false });
    expect(stepToward(8, 0, 10, 0, 4)).toEqual({ x: 10, y: 0, arrived: true });
  });
  it('steps the sun elevation by 5 within 20..85', () => {
    expect(ELEV).toEqual({ step: 5, min: 20, max: 85 });
    expect(stepElev(35, 1)).toBe(40);
    expect(stepElev(20, -1)).toBe(20);
    expect(stepElev(85, 1)).toBe(85);
    expect(stepElev(83, 1)).toBe(85);
    expect(stepElev(61, 1)).toBe(65);
    expect(stepElev(61, -1)).toBe(60);
    expect(stepElev(60, 1)).toBe(65);
    expect(stepElev(60, -1)).toBe(55);
    expect(stepElev(22, -1)).toBe(20);
  });
  it('steps each haze value without float drift and clamps', () => {
    let h = { ...DEFAULT_HAZE };
    h = stepHaze(h, 'mix', 1);
    expect(h.mix).toBe(0.5);
    h = stepHaze(stepHaze(h, 'soft', -1), 'soft', -1);
    expect(h.soft).toBe(0.5);
    expect(DEFAULT_HAZE.outside).toBe(0.8);
    expect(stepHaze(h, 'outside', 1).outside).toBe(0.9);
    expect(stepHaze({ ...h, outside: 0.95 }, 'outside', 1).outside).toBe(1);
    expect(stepHaze({ ...h, desat: 0.05 }, 'desat', -1).desat).toBe(0);
    expect(stepHaze(h, 'blurPx', 1).blurPx).toBe(2);
    expect(stepHaze({ ...h, blurPx: 3.8 }, 'blurPx', 1).blurPx).toBe(4);
    expect(stepHaze(h, 'mix', 1).colour).toBe(DEFAULT_HAZE.colour);
    expect(Object.keys(HAZE_STEPS)).toEqual(['outside', 'soft', 'mix', 'desat', 'blurPx', 'feather']);
    expect(stepHaze(h, 'feather', 1).feather).toBe(32);
    expect(stepHaze({ ...h, feather: 60 }, 'feather', 1).feather).toBe(64);
    expect(stepHaze({ ...h, feather: 4 }, 'feather', -1).feather).toBe(0);
  });
  it('steps the shadow alpha by 0.04 within 0..0.6', () => {
    expect(stepAlpha(0.28, 1)).toBe(0.32);
    expect(stepAlpha(0.28, -1)).toBe(0.24);
    expect(stepAlpha(0.02, -1)).toBe(0);
    expect(stepAlpha(0.58, 1)).toBe(0.6);
  });
});
