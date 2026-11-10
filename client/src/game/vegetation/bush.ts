// A bush: a lobed crown standing on one thin stem that forks early (#279).
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

/** The width of each layout in design units (outermost lobe edges), derived from `LAYOUTS`. */
const EXTENT = Object.fromEntries(([3, 4, 5] as const).map((n) => [n, Math.max(...LAYOUTS[n].map(([dx, , rad]) => dx + rad)) - Math.min(...LAYOUTS[n].map(([dx, , rad]) => dx - rad))])) as Record<3 | 4 | 5, number>;

/** A bush: 3-5 lobes on one thin stem that forks early; `width` is the drawn width in px (about, to a few px). */
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
  // one thin stem in the middle (1 px below 40 px wide, else 2), painted before the crown, which covers the branch tops
  const sx = cx + Math.round((r() - 0.5) * 2), wide = o.width < 40 ? 1 : 2, h = Math.round(1 + o.width / 40);
  const stemCentre = sx + (wide - 1) / 2;
  for (let x = sx; x < sx + wide; x++) {
    const lit = wide === 1 ? 0 : (x - stemCentre) / (wide / 2);
    for (let y = ground - h; y <= ground - 1; y++) cv.set(x, y, barkShade(lit * light.x, false), barkShade(lit * DEFAULT_LIGHT.x, false));
  }
  // it forks early into 2 branches (3 with 5 lobes), 1 px wide, going up and out at 35-60 degrees until they are under the crown;
  // every angle is drawn whatever the light, the sun side of the stem is the lighter brown
  const nb = n === 5 ? 3 : 2, yEnd = ground - lift - 1, yFork = ground - h - 1;
  for (let k = 0; k < nb; k++) {
    const mag = ((35 + r() * 25) * Math.PI) / 180, a = nb === 3 && k === 1 ? (r() - 0.5) * 0.3 : (k === 0 ? -mag : mag);
    const len = Math.max(1, (yFork - yEnd) / Math.cos(a));
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
  return cv.finish({ x: cx, y: ground }, { pockets: made, vines: 0, stems: 1, limbs: 0 });
}
