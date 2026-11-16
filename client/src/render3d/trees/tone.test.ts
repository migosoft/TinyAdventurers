import { describe, expect, it } from 'vitest';
import { sky, type Vec3 } from '../sun';
import { NOON_LIGHT, SKY_LEVEL_MIN, TREE_LIGHT, leafLevelOf, skyLevel, treeTone } from './tone';

const lum = (v: Vec3): number => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** How far the crown's form term moves the step to either side on an ordinary crown (treeNodes.ts: the normal and gradient terms). */
const FORM = 0.6;
const HOURS = Array.from({ length: 96 }, (_, i) => i / 4);

describe('the tree tone rule', () => {
  it('at every hour the crown\'s form picks different tones, in the shade and in the light (#339: dawn and dusk were one flat tone)', () => {
    for (const h of HOURS) {
      const s = sky(h);
      const level = skyLevel(s.ambient, s.colour);
      for (const b of [lum(s.ambient), lum(add(s.ambient, s.colour))]) {
        const { step } = treeTone(b, level);
        expect(leafLevelOf(step + FORM), `hour ${h}, light ${b}`).toBeGreaterThan(leafLevelOf(step - FORM));
      }
    }
  });

  it('a tree is darker by the sky\'s level: the tone is shown at the light over the relative brightness', () => {
    const noon = sky(13), dusk = sky(21);
    const shown = (s: typeof noon): number => {
      const b = lum(add(s.ambient, s.colour));
      return b / treeTone(b, skyLevel(s.ambient, s.colour)).rel;
    };
    expect(shown(noon)).toBeCloseTo(1, 6);
    expect(shown(dusk)).toBeLessThan(0.2);
    expect(shown(dusk)).toBeCloseTo(skyLevel(dusk.ambient, dusk.colour), 6);
  });

  it('at noon the rule is the light\'s own brightness: the step is log2(b / mid) * gain and the tone is shown undimmed', () => {
    const s = sky(13);
    expect(skyLevel(s.ambient, s.colour)).toBe(1);
    for (const b of [lum(s.ambient), 0.7, lum(add(s.ambient, s.colour))]) {
      const t = treeTone(b, 1);
      expect(t.rel).toBeCloseTo(b, 9);
      expect(t.step).toBeCloseTo(Math.log2(b / TREE_LIGHT.mid) * TREE_LIGHT.gain, 9);
    }
  });

  it('outside the ramp\'s range the step stays at its end and the brightness goes on with the light', () => {
    expect(treeTone(0.05, 1)).toEqual(treeTone(TREE_LIGHT.lo, 1));
    expect(treeTone(9, 1)).toEqual(treeTone(TREE_LIGHT.hi, 1));
    // A torch at night: far above the sky's level, so the lightest tones, shown brighter than the moonlit ones.
    const night = sky(0);
    const level = skyLevel(night.ambient, night.colour);
    const torch = treeTone(0.8, level), moon = treeTone(lum(add(night.ambient, night.colour)), level);
    expect(torch.rel).toBe(TREE_LIGHT.hi);
    expect(0.8 / torch.rel).toBeGreaterThan(lum(add(night.ambient, night.colour)) / moon.rel);
  });

  it('the sky level is 1 at noon, never above it and never 0', () => {
    for (const h of HOURS) {
      const s = sky(h);
      const k = skyLevel(s.ambient, s.colour);
      expect(k).toBeGreaterThanOrEqual(SKY_LEVEL_MIN);
      expect(k).toBeLessThanOrEqual(1);
    }
    expect(skyLevel([0, 0, 0], [0, 0, 0])).toBe(SKY_LEVEL_MIN);
    expect(NOON_LIGHT).toBeGreaterThan(1);
  });
});
