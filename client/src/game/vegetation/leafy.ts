// The leafy trees (round, wide, tall): trunk, branches, roots and a lobed crown (#279).
import type { Shape } from '../vegetation';
import { Canvas, type Drawn, type Light, rng } from './canvas';
import { type Lobe, crown, pockets, vines } from './crown';
import { barkLines, canopyShadow, limbs, painter, rootMoss, roots, trunkPath } from './trunk';

type LeafyShape = Exclude<Shape, 'conifer' | 'bare'>;
/** `old`: an older tree: trunk x1.4, bend x1.9, four longer roots (x1.25), and the trunk forks 3 units lower. */
export interface LeafyOpts { seed: number; scale: number; shape: LeafyShape; light: Light; old?: boolean }
const SHAPES: Record<LeafyShape, { sx: number; sy: number; trunk: number; roots: 2 | 3 | 4; rootLen: number; bend: number; lobes: [number, number, number][] }> = {
  round: { sx: 1, sy: 1, trunk: 1, roots: 3, rootLen: 1, bend: 1, lobes: [[0, 14, 19], [-21, 26, 15], [22, 25, 15], [-11, 37, 13], [12, 37, 13], [-30, 36, 10], [30, 35, 10]] },
  wide: { sx: 1.3, sy: 0.85, trunk: 1.1, roots: 4, rootLen: 1.15, bend: 1.2, lobes: [[-7, 15, 18], [13, 17, 17], [-24, 27, 15], [26, 27, 14], [-13, 38, 13], [11, 38, 13], [-33, 36, 10], [32, 36, 10]] },
  tall: { sx: 0.8, sy: 1.3, trunk: 0.65, roots: 2, rootLen: 0.6, bend: 0.6, lobes: [[0, 9, 17], [-14, 22, 15], [15, 22, 15], [-9, 36, 13], [10, 36, 13]] },
};

/** round/wide/tall. */
export function drawLeafy(o: LeafyOpts): Drawn {
  const r = rng(o.seed), sh = SHAPES[o.shape], s = o.scale, light = o.light;
  const cv = new Canvas(220, 220);
  const cx = 110, base = 190;
  const X = (dx: number) => cx + dx * s * sh.sx, Y = (y: number) => base + (y - 86) * s * sh.sy; // y in design units (0..86)
  const old = o.old === true;
  const tw = s * sh.trunk * (old ? 1.4 : 1); // trunk width factor
  const detail = s >= 0.7, footY = Y(79);
  const paint = painter(cv, light);
  // trunk and limbs: the limbs go first, so the trunk's fork shows below the crown
  const tr = trunkPath(r, cx, Y, s, sh.sx, tw, (old ? 57 : 54) + (r() - 0.5) * 6, sh.bend * (old ? 1.9 : 1));
  const targets: [number, number][] = [[-(17 + r() * 6), 33], [15 + r() * 6, 32], [(r() < 0.5 ? -4 : 4) + (r() - 0.5), 27]];
  const used = o.shape === 'tall' ? targets.slice(0, 2) : targets;
  const limbSegs = limbs(cv, r, light, tr.at(1), used, X, Y, detail);
  paint(tr.seg, false, footY);
  const rootSegs = roots(r, paint, cx, footY, s, tw, old ? 4 : sh.roots, sh.rootLen * (old ? 1.25 : 1));
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
  return cv.finish({ x: cx, y: footY }, { pockets: made, vines: vineCount, stems: 0, limbs: used.length },
    { kind: 'leafy', trunk: tr.seg, limbs: limbSegs, roots: rootSegs, lobes, skirts: [], s });
}
