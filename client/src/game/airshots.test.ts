import { describe, expect, it } from 'vitest';
import { KIND } from '../generated/defs';
import { PROJECTILES } from './anim/defs';
import { projectileAir, shotAir } from './airshots';

describe('airshots', () => {
  it('an arrow is thin and cold', () => {
    const a = projectileAir(KIND.Arrow);
    expect(a.r).toBeLessThan(9);
    expect(a.heat).toBe(0);
  });

  it('a fireball is wide and hot', () => {
    const f = projectileAir(KIND.Fireball);
    expect(f.r).toBeGreaterThan(15);
    expect(f.r).toBeLessThan(18);
    expect(f.heat).toBe(1);
    const d = projectileAir(KIND.DragonFireball);
    expect(d.r).toBeCloseTo(24, 6);
    expect(d.heat).toBe(1);
  });

  it('a frost bolt is cold', () => {
    expect(projectileAir(KIND.FrostBolt).heat).toBe(0);
    expect(projectileAir(KIND.SleepOrb).heat).toBe(0);
    expect(projectileAir(KIND.ShadowBolt).heat).toBe(0);
  });

  it('every projectile gets air', () => {
    for (const k of Object.keys(PROJECTILES)) {
      const a = projectileAir(Number(k));
      expect(a.r).toBeGreaterThanOrEqual(6);
      expect(a.r).toBeLessThanOrEqual(28);
      expect([0, 1]).toContain(a.heat);
    }
  });

  it('an unknown kind gets the arrow-like default', () => {
    expect(projectileAir(-1)).toEqual({ r: 6, heat: 0 });
  });

  it('an override wins', () => {
    expect(shotAir({ scale: 1, glow: 0xff7020, air: { heat: 0, r: 9 } })).toEqual({ r: 9, heat: 0 });
  });
});
