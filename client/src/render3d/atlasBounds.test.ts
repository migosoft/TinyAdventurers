import { describe, expect, it } from 'vitest';
import { boundsOfPixels } from './atlasBounds';

/** An RGBA image `w` wide, `h` high, opaque only at the given (x, y) points. */
function image(w: number, h: number, opaque: [number, number][]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (const [x, y] of opaque) px[(y * w + x) * 4 + 3] = 255;
  return px;
}

describe('boundsOfPixels', () => {
  it('finds the first and last opaque column and the top row of a frame inside the image, with its size', () => {
    const px = image(32, 32, [[18, 12], [25, 20], [5, 5]]); // (5, 5) lies outside the frame
    expect(boundsOfPixels(px, 32, { x: 16, y: 8, w: 12, h: 20 })).toEqual({ l: 2, r: 9, t: 4, w: 12, h: 20 });
  });
  it('counts a fully transparent frame as opaque from edge to edge', () => {
    expect(boundsOfPixels(image(16, 16, []), 16, { x: 0, y: 0, w: 16, h: 16 })).toEqual({ l: 0, r: 15, t: 0, w: 16, h: 16 });
  });
});
