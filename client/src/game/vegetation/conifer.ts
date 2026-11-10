// A conifer (fir/spruce) (#279).
import { Canvas, DEFAULT_LIGHT, type Drawn, type Light, barkShade, rng } from './canvas';
import { clumps } from './crown';
import { canopyShadow, rootMoss } from './trunk';

/** A conifer (fir/spruce): straight tapering trunk, stacked drooping tiers of leaf clumps narrowing to a spire, blue-green palette 5..9. */
export function drawConifer(seed: number, s: number, light: Light): Drawn {
  const r = rng(seed), cv = new Canvas(220, 220), cx = 110, base = 190, detail = s >= 0.7;
  const bare = r() * 0.25 * 82; // bare trunk below the lowest tier, uniform 0-25 % of the height (design units)
  const X = (dx: number) => cx + dx * s, Y = (y: number) => base + (y - 86) * s;
  const footY = Y(82);
  const paint = (px: number, py: number, w: number, edge: boolean, maxY = Infinity) => {
    for (let dy = -Math.ceil(w); dy <= Math.ceil(w); dy++) for (let dx = -Math.ceil(w); dx <= Math.ceil(w); dx++) {
      const d = Math.hypot(dx, dy); if (d > w) continue; const x = Math.round(px + dx), y = Math.round(py + dy); if (y > maxY) continue;
      const lit = (dx * light.x + dy * light.y) / Math.max(w, 1), litRef = (dx * DEFAULT_LIGHT.x + dy * DEFAULT_LIGHT.y) / Math.max(w, 1);
      cv.set(x, y, barkShade(lit, edge && d > w - 1), barkShade(litRef, edge && d > w - 1));
    }
  };
  // straight trunk, mostly hidden
  for (let i = 0; i <= 40; i++) { const t = i / 40; paint(cx, Y(50 + 32 * t), Math.max(1.5, (3.2 + 1.3 * t + 2.5 * t ** 4) * s), false, footY); }
  // 3-4 short roots
  const R: [number, number][] = detail ? [[-1, 0.2], [-0.35, 0.6], [0.4, 0.55], [1, 0.2]] : [[-1, 0.25], [0, 0.6], [1, 0.25]];
  for (const [vx, vy] of R) { const len = (8 + r() * 3) * s, m = Math.hypot(vx, vy); const n = Math.max(6, Math.round(len * 1.5)); let x = cx + (vx / m) * 3 * s, y = footY - 1;
    for (let i = 0; i <= n; i++) { const t = i / n; paint(x, y, 2.6 * s * (1 - t) ** 1.2 + 0.5, true); const fy = vy * (1 - 0.6 * t), mm = Math.hypot(vx, fy); x += (vx / mm) * (len / n); y += (fy / mm) * (len / n); } }
  rootMoss(cv, rng(seed ^ 0x6d6f7373), cx, footY, s); // its own stream, so the tiers below are drawn as before
  // tiers, bottom first so higher ones overlap; each is a centre clump, two side clumps and two drooping tips
  const span = 82 - bare - 29, nominal = s < 0.7 ? 10.5 : 8.4; // tier spacing stays near nominal: longer trunk, fewer tiers
  const n = Math.max(3, Math.round(span / nominal) + 1), step = span / (n - 1), NW = 0.67; // NW slims the silhouette
  const tier = (list: { x: number; y: number; rx: number; ry: number }[], under: boolean) => {
    const before = cv.px.slice(), beforeRef = cv.ref.slice(); clumps(cv, r, list, Y(4), 64 * s, '56789', light);
    if (!under) return;
    // the dark underside of the tier, for the picture and for its default-light reference alike
    for (const [px, was] of [[cv.px, before], [cv.ref, beforeRef]] as const) {
      const mine = (x: number, y: number) => px[y * cv.w + x] !== was[y * cv.w + x];
      for (let y = 0; y < cv.h - 1; y++) for (let x = 0; x < cv.w; x++) if (mine(x, y) && !mine(x, y + 1)) { px[y * cv.w + x] = '5'; if (y > 0 && mine(x, y - 1) && px[(y - 1) * cv.w + x] !== '5') px[(y - 1) * cv.w + x] = '6'; }
    }
  };
  for (let i = n - 1; i >= 0; i--) {
    const t = i / (n - 1), yc = 17 + i * step, w = (5.5 + t * 19.5 + (r() - 0.5) * 2) * NW;
    const j = () => (r() - 0.5) * 1.5;
    tier([
      { x: X(j()), y: Y(yc + j()), rx: w * 0.6 * s, ry: 6.2 * s },
      ...[-1, 1].map((sg) => ({ x: X(sg * w * 0.6 + j()), y: Y(yc + 4 + j()), rx: w * 0.45 * s, ry: 5.2 * s })),
      ...[-1, 1].map((sg) => ({ x: X(sg * w * 0.98 + j()), y: Y(yc + 8 + j()), rx: w * 0.26 * s, ry: 3.8 * s })),
    ], true);
  }
  tier([{ x: X(0), y: Y(5), rx: 2 * s, ry: 5.5 * s }, { x: X(0), y: Y(10), rx: 3.2 * s, ry: 5 * s }], false); // pointed top
  for (let k = 0; k < 160 * s * s; k++) { const x = Math.floor(r() * cv.w), y = Math.floor(r() * cv.h); const c = cv.getRef(x, y);
    if (c === '7' && cv.getRef(x + 1, y) === '7') { cv.set(x, y, '8'); if (r() < 0.5) cv.set(x + 1, y - 1, '8'); }
    if (c === '8' && cv.getRef(x + 1, y) === '8' && r() < 0.5) cv.set(x, y, '9'); }
  canopyShadow(cv, 5 * s); // the lowest tier's shadow on the trunk
  return cv.finish({ x: cx, y: footY });
}
