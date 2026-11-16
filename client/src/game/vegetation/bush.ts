// A bush: a lobed crown standing on one thin stem that forks early (#279).
// The lobes, the stem and the twigs come from the recipe module (#334); this file paints them.
import { bushPlan, rng } from '../../render3d/trees/recipe';
import { Canvas, DEFAULT_LIGHT, type Drawn, type Light, type PlantShape, barkShade, isLeaf, step } from './canvas';
import { crown, pockets } from './crown';

/** A bush: 3-5 lobes on one thin stem that forks early; `width` is the drawn width in px (about, to a few px). */
export function drawBush(o: { seed: number; width: number; light?: Light }): Drawn {
  const { seed } = o, light = o.light ?? DEFAULT_LIGHT;
  const r = rng(seed); const cv = new Canvas(120, 100);
  const { cx, ground, s, lobes, sx, wide, h, stemCentre, yFork, twigs, recipe } = bushPlan(r, o.width);
  // the stem is painted before the crown, which covers the branch tops
  for (let x = sx; x < sx + wide; x++) {
    const lit = wide === 1 ? 0 : (x - stemCentre) / (wide / 2);
    for (let y = ground - h; y <= ground - 1; y++) cv.set(x, y, barkShade(lit * light.x, false), barkShade(lit * DEFAULT_LIGHT.x, false));
  }
  // the twigs are 1 px wide; the sun side of the stem is the lighter brown
  for (const { a, len } of twigs) {
    for (let t = 0; t <= len; t += 0.5) {
      const x = stemCentre + Math.sin(a) * t, y = yFork - Math.cos(a) * t, side = x - stemCentre;
      cv.set(x, y, side * light.x > 0 ? 'c' : 'b', side * DEFAULT_LIGHT.x > 0 ? 'c' : 'b');
    }
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of lobes) { minX = Math.min(minX, b.x - b.rx); maxX = Math.max(maxX, b.x + b.rx); minY = Math.min(minY, b.y - b.ry); maxY = Math.max(maxY, b.y + b.ry); }
  crown(cv, r, lobes, { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, crx: (maxX - minX) / 2, cry: (maxY - minY) / 2, topY: minY, spanY: maxY - minY, pal: '01234', light, bias: 0.3 });
  const made = pockets(cv, r, { cx, y0: minY + (maxY - minY) * 0.45, y1: minY + (maxY - minY) * 0.85, halfW: (maxX - minX) * 0.3, s, pal: '01234', n: o.width >= 32 ? 1 : 0, twig: false });
  // flat dark underside: the lowest leaf of every column is the darkest green, the row above two steps darker
  const { x0, y0, x1, y1 } = cv.box();
  for (let x = x0; x <= x1; x++) {
    let y = y1; while (y >= y0 && !isLeaf(cv.get(x, y))) y--;
    if (y < y0) continue;
    cv.recolour(x, y, '0'); cv.recolourRef(x, y, '0');
    if (isLeaf(cv.get(x, y - 1))) { cv.recolour(x, y - 1, step('01234', cv.get(x, y - 1), -2) as string); cv.recolourRef(x, y - 1, step('01234', cv.getRef(x, y - 1), -2) as string); }
  }
  // the shadow shape: the lobes only; the stem is too thin for a trunk caster (trunkTop = the foot)
  const shape: PlantShape = { cast: 'parts', trunkTop: ground, trunkX0: sx, trunkX1: sx + wide - 1, clumps: lobes.map((b) => ({ x: b.x, y: b.y, r: Math.max(b.rx, b.ry) })) };
  return cv.finish({ x: cx, y: ground }, { pockets: made, vines: 0, stems: 1, limbs: 0 }, shape, recipe);
}
