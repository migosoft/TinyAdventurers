import { describe, expect, it } from 'vitest';
import { DEFAULTS, parseParams, toSearch, wrapYaw, type R3dParams } from './params';

describe('wrapYaw', () => {
  it('wraps into -180..180', () => {
    expect(wrapYaw(215)).toBe(-145);
    expect(wrapYaw(-190)).toBe(170);
    expect(wrapYaw(45)).toBe(45);
    expect(wrapYaw(37.3)).toBe(37.3);
    expect(wrapYaw(540)).toBe(-180);
    expect(wrapYaw(-540)).toBe(-180);
    for (const v of [1e300, -1e300]) {
      const w = wrapYaw(v);
      expect(Number.isFinite(w)).toBe(true);
      expect(Math.abs(w)).toBeLessThanOrEqual(180);
    }
  });
});

describe('parseParams', () => {
  it('gives the defaults for a bare ?r3d', () => {
    expect(parseParams('?r3d')).toEqual(DEFAULTS);
  });

  it('reads values back', () => {
    const p = parseParams('?r3d&pitch=48.6&yaw=-90&quality=high&zoom=4');
    expect(p.pitch).toBe(48.6);
    expect(p.yaw).toBe(-90);
    expect(p.quality).toBe('high');
    expect(p.zoom).toBe(4);
  });

  it('clamps and falls back', () => {
    expect(parseParams('?pitch=abc').pitch).toBe(45);
    expect(parseParams('?pitch=5').pitch).toBe(30);
    expect(parseParams('?pitch=200').pitch).toBe(80);
    expect(parseParams('?zoom=99').zoom).toBe(8);
    expect(parseParams('?zoom=1.5').zoom).toBeNull();
    expect(parseParams('?quality=ultra').quality).toBe('balanced');
    expect(parseParams('?yaw=720').yaw).toBe(0);
    expect(parseParams('?yaw=-190').yaw).toBe(170);
    expect(parseParams('?pitch=30').pitch).toBe(30);
    expect(parseParams('?pitch=80').pitch).toBe(80);
  });

  it('reads the switches', () => {
    const p = parseParams('?backend=webgl&shadows=0&orb=0&smooth=1&stats=1');
    expect(p).toMatchObject({ backend: 'webgl', shadows: false, orb: false, smooth: true, stats: true });
  });
});

describe('toSearch', () => {
  it('writes only what differs', () => {
    expect(toSearch(DEFAULTS)).toBe('?r3d');
    expect(toSearch({ ...DEFAULTS, quality: 'fast' })).toBe('?r3d&quality=fast');
  });

  it('round-trips a fully non-default value', () => {
    const p: R3dParams = {
      pitch: 60.5, yaw: 37.3, quality: 'fast', zoom: 5, backend: 'webgl',
      shadows: false, orb: false, smooth: true, stats: true,
    };
    expect(parseParams(toSearch(p))).toEqual(p);
  });
});
