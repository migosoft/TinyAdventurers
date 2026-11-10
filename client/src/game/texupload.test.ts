import { describe, expect, it } from 'vitest';
import { copyWindow } from './texupload';

describe('copyWindow (#292)', () => {
  it('packs the rows of a rectangle of a wider image', () => {
    // A 4×3 image whose pixel (x, y) is [x, y, 10 * x + y, 255].
    const sw = 4;
    const src = new Uint8Array(sw * 3 * 4);
    for (let y = 0; y < 3; y++) for (let x = 0; x < sw; x++) src.set([x, y, 10 * x + y, 255], (y * sw + x) * 4);
    const dst = new Uint8Array(2 * 2 * 4);
    copyWindow(src, sw, 1, 1, 2, 2, dst);
    expect(Array.from(dst)).toEqual([1, 1, 11, 255, 2, 1, 21, 255, 1, 2, 12, 255, 2, 2, 22, 255]);
  });
  it('copies the whole image when the window is the image', () => {
    const src = new Uint8Array(3 * 2 * 4).map((_, i) => i);
    const dst = new Uint8Array(src.length);
    copyWindow(src, 3, 0, 0, 3, 2, dst);
    expect(dst).toEqual(src);
  });
});
