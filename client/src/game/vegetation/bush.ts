// A bush (#279).
import { Canvas, DEFAULT_LIGHT, type Drawn, type Light, isLeaf, rng } from './canvas';
import { clumps } from './crown';

/** How much wider a bush is drawn than the width its clump layout is sized for (measured over many seeds and sizes). */
export const BUSH_SPREAD = 1.28;

/** A bush: 3-6 leaf clumps on the ground, no trunk; `width` is the drawn width in px (about, to a few px). */
export function drawBush(o: { seed: number; width: number; light?: Light }): Drawn {
  const { seed } = o, light = o.light ?? DEFAULT_LIGHT;
  const width = o.width / BUSH_SPREAD; // the clump layout below is sized by its centre spacing; the drawn bush spreads wider
  const r = rng(seed); const cv = new Canvas(120, 100); const cx = 60, ground = 85;
  const s = width / 32, n = o.width < 28 ? 3 : o.width < 40 ? 4 : 5; // clump count by the drawn size
  const list: { x: number; y: number; rx: number; ry: number }[] = [];
  list.push({ x: cx + (r() - 0.5) * 3 * s, y: ground - 13 * s, rx: (10 + r() * 2) * s, ry: (7 + r()) * s }); // back top
  for (let i = 0; i < n - 1; i++) { const t = i / (n - 2); list.push({ x: cx + (t - 0.5) * 20 * s + (r() - 0.5) * 3 * s, y: ground - (6 + r() * 2) * s, rx: (8 + r() * 3) * s, ry: (6 + r() * 1.5) * s }); }
  clumps(cv, r, list, ground - 20 * s, 18 * s, '01234', light);
  for (let k = 0; k < 40 * s * s; k++) { const x = Math.floor(r() * cv.w), y = Math.floor(r() * cv.h); if (cv.getRef(x, y) === '2' && cv.getRef(x + 1, y) === '2') { cv.set(x, y, '3'); if (r() < 0.5) cv.set(x + 1, y - 1, '3'); } }
  // flat dark underside where the bush meets the ground
  for (let x = 0; x < cv.w; x++) for (let y = ground; y < cv.h; y++) cv.clear(x, y);
  for (let x = 0; x < cv.w; x++) if (isLeaf(cv.get(x, ground - 1))) { cv.set(x, ground - 1, '0'); if (isLeaf(cv.get(x, ground - 2))) cv.set(x, ground - 2, '1'); }
  return cv.finish({ x: cx, y: ground });
}
