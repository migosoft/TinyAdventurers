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
    expect(parseParams('?pitch=abc').pitch).toBe(48.6);
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
    expect(parseParams('?r3d').smooth).toBe(true);
    expect(parseParams('?r3d&smooth=0').smooth).toBe(false);
    expect(toSearch({ ...DEFAULTS, smooth: false }, '?r3d')).toBe('?r3d&smooth=0');
  });

  it('reads free, light and zoom 1..8', () => {
    expect(parseParams('?r3d&free=1&light=work&zoom=1')).toMatchObject({ free: true, light: 'work', zoom: 1 });
    expect(parseParams('?r3d&zoom=0').zoom).toBe(1);
    expect(parseParams('?r3d&zoom=9').zoom).toBe(8);
    expect(parseParams('?r3d&light=x').light).toBe('game');
    expect(parseParams('?r3d&light=lantern').light).toBe('game');
    expect(parseParams('?r3d')).toMatchObject({ free: false, light: 'game' });
  });

  it('reads the dungeon light parameters and clamps or rejects them', () => {
    expect(parseParams('')).toMatchObject({ light: 'game', dark: 'fade', amb: 0, lcap: 16, ccap: 16, dv: null });
    expect(parseParams('?dark=shape').dark).toBe('shape');
    expect(parseParams('?dark=x').dark).toBe('fade');
    expect(parseParams('?amb=2').amb).toBe(1);
    expect(parseParams('?amb=-1').amb).toBe(0);
    expect(parseParams('?lcap=40').lcap).toBe(16);
    expect(parseParams('?lcap=3.5').lcap).toBe(16);
    expect(parseParams('?ccap=3.5').ccap).toBe(16);
    expect(parseParams('?ccap=0').ccap).toBe(0);
    expect(parseParams('?dv=150').dv).toBe(100);
    expect(parseParams('?dv=50').dv).toBe(50);
    expect(parseParams('?dv=x').dv).toBeNull();
    expect(toSearch(parseParams('?r3d&light=work&dark=shape&amb=0.5&lcap=8&ccap=0&dv=50'), '?r3d')).toBe('?r3d&light=work&dark=shape&amb=0.5&lcap=8&ccap=0&dv=50');
    expect(toSearch(DEFAULTS, '?r3d&light=work&dark=shape&amb=0.5&lcap=8&ccap=0&dv=50')).toBe('?r3d');
  });
});

describe('toSearch', () => {
  it('writes only what differs', () => {
    expect(toSearch(DEFAULTS, '?r3d')).toBe('?r3d');
    expect(toSearch({ ...DEFAULTS, quality: 'fast' }, '?r3d')).toBe('?r3d&quality=fast');
  });

  it('keeps foreign keys and removes this page\'s keys at their default', () => {
    expect(toSearch(DEFAULTS, '?r3d=demo&lag=150')).toBe('?r3d=demo&lag=150');
    expect(toSearch({ ...DEFAULTS, free: true }, '?r3d&lag=150&jitter=40')).toBe('?r3d&lag=150&jitter=40&free=1');
    expect(toSearch(DEFAULTS, '?r3d&free=1')).toBe('?r3d');
    expect(toSearch(DEFAULTS, '?r3d&flag&lag=1')).toBe('?r3d&flag&lag=1');
  });

  it('round-trips a fully non-default value', () => {
    const p: R3dParams = {
      pitch: 60.5, yaw: 37.3, quality: 'fast', zoom: 5, backend: 'webgl',
      shadows: false, orb: false, smooth: false, stats: true, free: true, light: 'work', dark: 'shape', amb: 0.5, lcap: 8, ccap: 0, dv: 50,
      see: 'lattice', seeR: 2, seeKeep: 0.5, seeEdge: 0.2,
    };
    expect(parseParams(toSearch(p, '?r3d'))).toEqual(p);
  });

  it('reads the see-through switch and sliders, clamps them, and leaves defaults out of the URL', () => {
    expect(parseParams('?r3d&see=lattice&seeR=2')).toMatchObject({ see: 'lattice', seeR: 2, seeKeep: DEFAULTS.seeKeep });
    expect(parseParams('?r3d&see=off').see).toBe('off');
    expect(parseParams('?r3d&see=bogus').see).toBe('soft');
    expect(parseParams('?r3d&seeR=9').seeR).toBe(3);
    expect(parseParams('?r3d&seeR=0').seeR).toBe(0.5);
    expect(parseParams('?r3d&seeKeep=2').seeKeep).toBe(1);
    expect(parseParams('?r3d&seeEdge=-1').seeEdge).toBe(0.01); // an edge of 0 would be smoothstep(1, 1, t) in the mask shader
    expect(parseParams('?r3d&seeEdge=0').seeEdge).toBe(0.01);
    expect(toSearch({ ...DEFAULTS, see: 'lattice', seeR: 2 }, '?r3d')).toBe('?r3d&see=lattice&seeR=2');
    expect(toSearch(DEFAULTS, '?r3d&see=off&seeR=2&seeKeep=0.5&seeEdge=0.1')).toBe('?r3d');
  });
});
