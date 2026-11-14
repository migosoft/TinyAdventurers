// How high the ground cover reaches at a point (#330): what lies flat on the ground (ground shadows, lying bodies, skulls,
// landed butterflies) is lifted onto it. Read from the kept cover image, so it follows the cover's `gh` factor.
import type { CoverResult } from './coverJob';
import { coverH, GH_MAX } from './kinds';

export class CoverField {
  private readonly data: Uint8Array | null;
  private readonly w: number;
  private readonly h: number;

  /** null: no cover, every height is 0. */
  constructor(r: CoverResult | null) {
    this.data = r ? r.image.data : null;
    this.w = r ? r.image.w : 0;
    this.h = r ? r.image.h : 0;
  }

  private px(x: number, z: number): number {
    const ix = Math.floor(x * 16), iz = Math.floor(z * 16);
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.h) return 0;
    return coverH(this.data![(iz * this.w + ix) * 4 + 3]);
  }

  /** Tiles: the largest cover height at the centre and the four points +-`r` (tiles) along x and z, times `gh` (clamped as the layer does); 0 without cover. */
  topAt(x: number, z: number, r: number, gh: number): number {
    if (!this.data) return 0;
    const m = Math.max(this.px(x, z), this.px(x + r, z), this.px(x - r, z), this.px(x, z + r), this.px(x, z - r));
    return (m * Math.min(GH_MAX, Math.max(0, gh))) / 16;
  }
}
