// A bush: a lobed crown standing on short stems (#279).
import { Canvas, DEFAULT_LIGHT, type Drawn, type Light, barkShade, isLeaf, rng, step } from './canvas';
import { type Lobe, crown, pockets } from './crown';

/** How much wider a bush is drawn than the width its lobe layout is sized for (measured over many seeds and sizes). */
export const BUSH_SPREAD = 1.1;

/** Lobe layouts `[dx, dy, r]` in design units from the ground line, by lobe count. */
const LAYOUTS: Record<3 | 4 | 5, [number, number, number][]> = {
  3: [[0, -13, 10], [-9, -8, 8], [9, -8, 8]],
  4: [[-4, -13, 10], [6, -12, 9], [-13, -7, 7], [12, -7, 7]],
  5: [[0, -14, 10], [-9, -10, 9], [9, -10, 9], [-17, -6, 7], [17, -6, 7]],
};

/** The width of each layout in design units (outermost lobe edges). */
const EXTENT: Record<3 | 4 | 5, number> = { 3: 34, 4: 39, 5: 48 };

/** A bush: 3-5 lobes on 1-3 short stems; `width` is the drawn width in px (about, to a few px). */
export function drawBush(o: { seed: number; width: number; light?: Light }): Drawn {
  const { seed } = o, light = o.light ?? DEFAULT_LIGHT;
  const r = rng(seed); const cv = new Canvas(120, 100); const cx = 60, ground = 85;
  const n = o.width < 28 ? 3 : o.width < 40 ? 4 : 5; // lobe count by the drawn size
  const s = o.width / BUSH_SPREAD / EXTENT[n]; // design units to px: the layout's width in units becomes the drawn width
  const lift = Math.round((3 + r()) * (o.width / 32)); // the crown stands this high above the ground
  const lobes: Lobe[] = LAYOUTS[n].map(([dx, dy, rad]) => {
    const x = cx + (dx + (r() - 0.5) * 3) * s, y = ground - lift + (dy + (r() - 0.5) * 2) * s, rr = rad + (r() - 0.5) * 2;
    return { x, y, rx: rr * s, ry: rr * s * 0.86, ph: r() * 6, ph2: r() * 6 };
  }).sort((a, b) => b.y - a.y);
  // stems: under the lowest lobes, painted before the crown, which covers their tops
  const count = n === 3 ? 1 : n === 4 ? 2 : r() < 0.5 ? 2 : 3;
  const byBottom = lobes.map((b, i) => ({ i, bottom: b.y + b.ry })).sort((a, b) => b.bottom - a.bottom);
  const wide = o.width < 40 ? 2 : 3;
  for (let k = 0; k < count; k++) {
    const b = lobes[byBottom[k].i], jit = Math.round((r() - 0.5) * 2), mid = Math.round(b.x) + jit;
    const top = Math.min(ground - 2, Math.round(byBottom[k].bottom) - 2);
    const x0 = wide === 2 ? mid : mid - 1, centre = x0 + (wide - 1) / 2;
    for (let x = x0; x < x0 + wide; x++) {
      const lit = ((x - centre) * light.x) / (wide / 2), litRef = ((x - centre) * DEFAULT_LIGHT.x) / (wide / 2);
      for (let y = top; y <= ground - 1; y++) cv.set(x, y, barkShade(lit, false), barkShade(litRef, false));
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
  return cv.finish({ x: cx, y: ground }, { pockets: made, vines: 0, stems: count, limbs: 0 });
}
