import { describe, expect, it } from 'vitest';
import { EFFECT, EFFECT_LOOK } from '../generated/defs';
import { DEPTH, SOUND_TEXT } from './effects';
import { StatusView, flameSpots, has, lieLayout, lookOf, lyingPose, snowflakeAlpha } from './status';

describe('status', () => {
  it('reads effect bits', () => {
    const bits = (1 << EFFECT.Sleep) | (1 << EFFECT.Slowed);
    expect(has(bits, EFFECT.Sleep)).toBe(true);
    expect(has(bits, EFFECT.Blind)).toBe(false);
  });

  it('lies down towards its facing, flattened on the ground side', () => {
    expect(lyingPose(16, false).angle).toBe(90);
    expect(lyingPose(16, true).angle).toBe(-90);
    const p = lyingPose(16, false);
    expect(p.cropBottom).toBeGreaterThanOrEqual(1);
    expect(p.cropBottom).toBeLessThanOrEqual(2);
    expect(p.squash).toBeCloseTo(0.92, 2);
  });

  it('cuts the floor side from the opaque edge and rests it on the floor, centred', () => {
    // 16 x 28 frame, figure in columns 3..12 from row 8, origin in the middle.
    const b = { l: 3, r: 12, t: 8 };
    // Falling right: the right edge (column 12) loses 1 px; head 20 px long, centred.
    expect(lieLayout(b, 16, 28, 8, false, 1, 0.92)).toEqual({ cropX: 0, cropW: 12, x: -10, y: -3 });
    // Falling left (flipped): the mirrored left edge (column 3) loses 1 px.
    expect(lieLayout(b, 16, 28, 8, true, 1, 0.92)).toEqual({ cropX: 4, cropW: 12, x: 10, y: -3 });
  });
});

describe('damage-type effect visuals', () => {
  it('snowflakes shimmer in, hold, and out', () => {
    expect(snowflakeAlpha(0, 1)).toBe(0);
    expect(snowflakeAlpha(0.5, 1)).toBe(1);
    expect(snowflakeAlpha(1, 1)).toBe(0);
    expect(snowflakeAlpha(0.1, 1)).toBeGreaterThan(0);
    expect(snowflakeAlpha(0.1, 1)).toBeLessThan(1);
  });

  it('flames sit on the body', () => {
    for (const [x, y] of flameSpots(12, 20, 3, 7)) {
      expect(Math.abs(x)).toBeLessThanOrEqual(6);
      expect(y).toBeLessThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(-20);
    }
    expect(flameSpots(12, 20, 3, 7)).toHaveLength(3);
  });
});

describe('sleep Z', () => {
  it('draws the sleep Z above the darkness with a light outline', () => {
    const made: Array<{ depth: number; stroke: string; fill: string }> = [];
    const mk = (_x?: number, _y?: number, _s?: string, style?: { color?: string }) => {
      const t: Record<string, unknown> = { depth: 0, stroke: '', fill: style?.color ?? '' };
      const self = new Proxy(t, {
        get: (o, k: string) => (k in o ? o[k] : (...a: unknown[]) => {
          if (k === 'setDepth') o.depth = a[0];
          if (k === 'setStroke') o.stroke = a[0];
          return self;
        }),
      });
      made.push(t as { depth: number; stroke: string; fill: string });
      return self;
    };
    const scene = { add: { text: mk, image: mk }, textures: { exists: () => true } } as never;
    const body = { frame: { name: 'f', height: 16 }, x: 0, y: 0, originY: 1, flipX: false } as never;
    const anchor = { x: 10, y: 20, head: 16, w: 10, cx: 0, hand: { x: 3, y: 10 }, body, scale: 1, alpha: 1 };
    const view = new StatusView(scene, {} as never, () => anchor);
    view.update(1 << EFFECT.Sleep, 0.7);
    const z = made.find((t) => t.stroke !== '');
    expect(z).toBeDefined();
    expect(z!.depth).toBe(DEPTH.sound);
    expect(z!.stroke).toBe(SOUND_TEXT.stroke);
    expect(z!.fill).toBe(SOUND_TEXT.fill);
  });

  it('looks up the look of an effect on an entity, Plain when none is sent', () => {
    const looks: [number, number, number][] = [[3, EFFECT.Entangled, EFFECT_LOOK.Vines]];
    expect(lookOf(looks, 3, EFFECT.Entangled)).toBe(EFFECT_LOOK.Vines);
    expect(lookOf(looks, 3, EFFECT.Frozen)).toBe(EFFECT_LOOK.Plain);
    expect(lookOf(looks, 4, EFFECT.Entangled)).toBe(EFFECT_LOOK.Plain);
    expect(lookOf([], 3, EFFECT.Entangled)).toBe(EFFECT_LOOK.Plain);
  });

  it('shows the Fear "!" in the sound style above the head and hides it when the fear ends', () => {
    const made: Array<{ s?: string; depth: number; stroke: string; visible: boolean }> = [];
    const mk = (_x?: number, _y?: number, s?: string) => {
      const t: Record<string, unknown> = { s, depth: 0, stroke: '', visible: true };
      const self = new Proxy(t, {
        get: (o, k: string) => (k in o ? o[k] : (...a: unknown[]) => {
          if (k === 'setDepth') o.depth = a[0];
          if (k === 'setStroke') o.stroke = a[0];
          if (k === 'setVisible') o.visible = a[0];
          return self;
        }),
      });
      made.push(t as never);
      return self;
    };
    const scene = { add: { text: mk, image: mk }, textures: { exists: () => true } } as never;
    const body = { frame: { name: 'f', height: 16 }, x: 0, y: 0, originY: 1, flipX: false } as never;
    const anchor = { x: 10, y: 20, head: 16, w: 10, cx: 0, hand: { x: 3, y: 10 }, body, scale: 1, alpha: 1 };
    const view = new StatusView(scene, {} as never, () => anchor);
    view.update(1 << EFFECT.Fear, 0.1);
    const bang = made.find((t) => t.s === '!');
    expect(bang).toBeDefined();
    expect(bang!.visible).toBe(true);
    expect(bang!.depth).toBe(DEPTH.sound);
    expect(bang!.stroke).toBe(SOUND_TEXT.stroke);
    view.update(0, 0.1);
    expect(bang!.visible).toBe(false);
  });
});
