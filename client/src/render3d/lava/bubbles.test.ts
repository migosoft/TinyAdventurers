import { describe, expect, it } from 'vitest';
import { BUBBLE, BUBBLE_CAP, Bubbles, bubbleRadius, bubbleRise } from './bubbles';

describe('bubbleRise', () => {
  it('is flat before it is born and once it pops', () => {
    expect(bubbleRise(0, 0, 0.3)).toBe(0);
    expect(bubbleRise(0, BUBBLE.swell, 0.3)).toBe(0);
  });
  it('swells to rise * size at its centre and to nothing at its radius', () => {
    expect(bubbleRise(0, 1.2, 0.3)).toBeCloseTo(0.066, 6);
    expect(bubbleRise(bubbleRadius(1.2, 0.3), 1.2, 0.3)).toBe(0);
    expect(bubbleRise(bubbleRadius(1.2, 0.3) * 2, 1.2, 0.3)).toBe(0);
  });
});

describe('Bubbles', () => {
  it('packs age and size, and frees a slot after swell + pop', () => {
    const b = new Bubbles(), out = new Float32Array(BUBBLE_CAP * 4);
    expect(b.add(3, 4, 1, 0.25)).toBe(true);
    expect(b.pack(1.5, out)).toBe(1);
    expect([out[0], out[1], out[2], out[3]]).toEqual([3, 4, 0.5, 0.25]);
    expect(out[6]).toBe(-1);
    expect(b.pack(1 + 1.9 + 0.01, out)).toBe(0);
    expect(out[2]).toBe(-1);
  });
  it('reports each pop once', () => {
    const b = new Bubbles(), out = new Float32Array(BUBBLE_CAP * 4), pops: number[][] = [];
    b.add(3, 4, 1, 0.25);
    const cb = (x: number, z: number) => pops.push([x, z]);
    b.pack(2.0, out, cb);
    expect(pops.length).toBe(0);
    b.pack(2.3, out, cb);
    expect(pops).toEqual([[3, 4]]);
    b.pack(2.4, out, cb);
    expect(pops.length).toBe(1);
  });
  it('never holds more than BUBBLE_CAP', () => {
    const b = new Bubbles();
    let added = 0;
    for (let i = 0; i < 10; i++) if (b.add(i, 0, 0, 0.2)) added++;
    expect(added).toBe(BUBBLE_CAP);
  });
  it('prunes', () => {
    const b = new Bubbles(), out = new Float32Array(BUBBLE_CAP * 4);
    b.add(1, 1, 0, 0.2); b.add(2, 2, 0, 0.2);
    b.prune((x) => x > 1);
    expect(b.pack(0.1, out)).toBe(1);
    b.prune(() => false);
    expect(b.pack(0.1, out)).toBe(0);
  });
});
