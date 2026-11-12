// The lying layout of a prone figure (asleep): pure, Phaser-free, shared by the
// 2D view (EntityView through status.ts) and the 3D view.

/**
 * A prone figure (asleep) lies down towards its facing: rotated ±90° about
 * its feet, a little flattened, with the side that ends up on the floor
 * cropped (tall figures lose 2 px, small ones 1 px) so it does not float.
 */
export function lyingPose(figureH: number, left: boolean): { angle: number; cropBottom: number; squash: number } {
  return { angle: left ? -90 : 90, cropBottom: figureH >= 20 ? 2 : 1, squash: 0.92 };
}

/** Opaque part of a body frame: first and last columns, top row (frame pixels, unflipped). */
export interface Bounds {
  l: number;
  r: number;
  t: number;
}

/**
 * Where a lying body goes (in display space, after the flip): the crop of the
 * frame (`cut` px off the side that faces the floor after the ±90° turn: the
 * right edge falling right, the left edge falling left; counted from the
 * opaque edge, the pack frames have empty margins) and the body offset that
 * puts the cut edge on the floor line (y 1, where the feet stand) and centres
 * the lying figure on its shadow. `ox`: the body's origin column (px).
 */
export function lieLayout(b: Bounds, w: number, foot: number, ox: number, left: boolean, cut: number, squash: number): { cropX: number; cropW: number; x: number; y: number } {
  const l = left ? w - 1 - b.r : b.l;
  const r = left ? w - 1 - b.l : b.r;
  const len = foot - b.t;
  if (left) {
    const c0 = l + cut;
    return { cropX: c0, cropW: w - c0, x: Math.round(len / 2), y: 1 - Math.round((ox - c0) * squash) };
  }
  const c1 = r + 1 - cut;
  return { cropX: 0, cropW: c1, x: -Math.round(len / 2), y: 1 - Math.round((c1 - ox) * squash) };
}
