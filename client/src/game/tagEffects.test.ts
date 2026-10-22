import { describe, expect, it, vi } from 'vitest';
import { EFFECT } from '../generated/defs';
import { TagEffects } from './tagEffects';

function fakeImage() {
  const o: any = { visible: false, x: 0, y: 0, texture: '', destroyed: false };
  o.setOrigin = vi.fn(() => o);
  o.setTexture = vi.fn((t: string) => ((o.texture = t), o));
  o.setDisplaySize = vi.fn(() => o);
  o.setPosition = vi.fn((x: number, y: number) => ((o.x = x), (o.y = y), o));
  o.setVisible = vi.fn((v: boolean) => ((o.visible = v), o));
  o.destroy = vi.fn(() => (o.destroyed = true));
  return o;
}

function setup() {
  const made: any[] = [];
  const scene: any = { add: { image: vi.fn(() => (made.push(fakeImage()), made[made.length - 1])) } };
  const parent: any = { add: vi.fn() };
  return { made, scene, parent, fx: new TagEffects(scene, parent) };
}
const bits = (...ids: number[]) => ids.reduce((b, id) => b | (1 << id), 0);

describe('TagEffects', () => {
  it('creates images once and leaves them alone while the bits are unchanged', () => {
    const { made, fx } = setup();
    const a = bits(EFFECT.Burning, EFFECT.Sleep);
    fx.set(a, 30, -10);
    fx.set(a, 30, -10);
    expect(made).toHaveLength(2);
    expect(made[0].setTexture).toHaveBeenCalledTimes(1);
  });
  it('hides all for no effects, and reuses hidden images first', () => {
    const { made, fx } = setup();
    fx.set(bits(EFFECT.Burning, EFFECT.Sleep), 30, -10);
    fx.set(0, 30, -10);
    expect(made.every((m) => !m.visible)).toBe(true);
    fx.set(bits(EFFECT.Blind, EFFECT.Fear, EFFECT.Warded), 30, -10);
    expect(made).toHaveLength(3);
    expect(made.every((m) => m.visible)).toBe(true);
  });
  it('starts 2 world px right of a 20-letter name tag', () => {
    const { made, fx } = setup();
    const tagRight = 0 + (20 * 4.5) / 2; // centred tag, ~4.5 px per letter
    fx.set(bits(EFFECT.Frozen), tagRight, -12);
    expect(made[0].x).toBe(tagRight + 2);
    expect(made[0].y).toBe(-12);
  });
  it('destroys its images', () => {
    const { made, fx } = setup();
    fx.set(bits(EFFECT.Frozen), 10, 0);
    fx.destroy();
    expect(made[0].destroyed).toBe(true);
  });
});
