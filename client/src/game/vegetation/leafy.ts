// The leafy trees (round, wide, tall): trunk, branches, roots and a lobed crown (#279).
// The frame, the trunk, the limb targets and the roots come from the recipe module (#334); this file paints them and the crown.
import { type LeafyOpts as RecipeOpts, leafyRoots, leafyStart, rng } from '../../render3d/trees/recipe';
import { Canvas, type Drawn, type Light, type PlantShape } from './canvas';
import { type Lobe, crown, pockets, vines } from './crown';
import { barkLines, canopyShadow, limbs, painter, rootMoss } from './trunk';

/** `old`: an older tree: trunk x1.4, bend x1.9, four longer roots (x1.25), and the trunk forks 3 units lower. */
export interface LeafyOpts extends RecipeOpts { light: Light }

/** round/wide/tall. */
export function drawLeafy(o: LeafyOpts): Drawn {
  const r = rng(o.seed), light = o.light;
  const cv = new Canvas(220, 220);
  const p = leafyStart(r, o), { sh, s, cx, X, Y, detail, footY, tr, used } = p;
  const paint = painter(cv, light);
  // trunk and limbs: the limbs go first, so the trunk's fork shows below the crown
  limbs(cv, r, light, tr.at(1), used, X, Y, detail);
  paint(tr.seg, false, footY);
  const rootSegs = leafyRoots(r, p);
  rootSegs.forEach((sg) => paint(sg, true));
  barkLines(cv, r, tr, light, s);
  rootMoss(cv, r, cx, footY, s);
  // crown: lobes from the shape's layout, lowest first so the upper ones sit in front
  const lobes: Lobe[] = sh.lobes.map(([dx, y, rad]) => {
    const x = X(dx + (r() - 0.5) * 4), yy = Y(y + (r() - 0.5) * 3), rr = rad + (r() - 0.5) * 3;
    return { x, y: yy, rx: rr * s * sh.sx * 0.98, ry: rr * s * sh.sy * 0.86, ph: r() * 6, ph2: r() * 6 };
  }).sort((a, b) => b.y - a.y);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of lobes) { minX = Math.min(minX, b.x - b.rx); maxX = Math.max(maxX, b.x + b.rx); minY = Math.min(minY, b.y - b.ry); maxY = Math.max(maxY, b.y + b.ry); }
  crown(cv, r, lobes, { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, crx: (maxX - minX) / 2, cry: (maxY - minY) / 2, topY: minY, spanY: maxY - minY, pal: '01234', light, bias: 0 });
  const made = pockets(cv, r, { cx, y0: Y(22), y1: Y(42), halfW: 34 * s * sh.sx, s, pal: '01234', n: detail ? 2 + (r() < 0.5 ? 1 : 0) : 1, twig: detail });
  const vineCount = detail ? vines(cv, r, { X, Y, s, max: 8 * s }) : 0;
  canopyShadow(cv, 7 * s);
  // the shadow shape: the lobes are the clumps; the trunk caster runs from under the lowest lobe to the foot, above the root flare
  const trunkTop = Math.min(footY, Math.max(...lobes.map((b) => b.y + b.ry)));
  const tMax = Math.min(1, Math.max(0.2, (trunkTop - footY) / (tr.topY - footY)));
  let tx0 = cx, tx1 = cx;
  for (let i = 0; i <= 16; i++) { const q = tr.at(0.2 + ((tMax - 0.2) * i) / 16); tx0 = Math.min(tx0, q.x - q.w); tx1 = Math.max(tx1, q.x + q.w); }
  const shape: PlantShape = { cast: 'parts', trunkTop, trunkX0: tx0, trunkX1: tx1, clumps: lobes.map((b) => ({ x: b.x, y: b.y, r: Math.max(b.rx, b.ry) })) };
  return cv.finish({ x: cx, y: footY }, { pockets: made, vines: vineCount, stems: 0, limbs: used.length }, shape, { foot: { x: cx, y: footY }, trunk: tr.seg, roots: rootSegs, s });
}
