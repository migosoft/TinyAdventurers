// The bare tree (plant kind 5): the leafy trunk and roots under recursive, leafless limbs (#279).
import { Canvas, DEFAULT_LIGHT, type Drawn, type Light, rng } from './canvas';
import { type NormalPt, barkLines, painter, rootMoss, roots, shadowLine, trunkPath } from './trunk';

/** Twig pixels: mid brown on the sun side of the trunk, dark brown on the other (colour only). */
const twigColour = (x: number, cx: number, L: Light) => ((x - cx) * L.x > 0 ? 'c' : 'b');

/**
 * A leafless tree. The trunk (fork at design y 54 ± 4) carries a limb 22 units long that forks at its end into 2 children
 * (3 for the first, 40 % of the time) spread ±(0.45..0.75) rad, each 0.66..0.78 of its length and 0.68 of its width; from depth 1
 * on, 35 % of the limbs that fork grow a side twig (the deepest limbs, and the twigs themselves, get none). Depth 4 (3 below 70 % scale). Limbs at least 1 px wide are bark with a dark line on
 * the shadow side; thinner ones are 1-px twigs. Every random draw of a limb is made before its children, whatever the light.
 */
export function drawBare(seed: number, s: number, light: Light): Drawn {
  const r = rng(seed), cv = new Canvas(220, 220), cx = 110, base = 190;
  const Y = (y: number) => base + (y - 86) * s, tw = s * 0.95, detail = s >= 0.7, maxDepth = detail ? 4 : 3;
  const footY = Y(79), paint = painter(cv, light);
  const tr = trunkPath(r, cx, Y, s, 1, tw, 54 + (r() - 0.5) * 8, 1.1);
  paint(tr.seg, false, footY);
  roots(r, paint, cx, footY, s, tw, 3, 1);
  let count = 0;

  /** One limb from (x0, y0) at angle `a0` (rad from straight up, + to the right), `len` px long, half-width `w0` tapering to 0.68 of it. */
  const limb = (x0: number, y0: number, a0: number, len: number, w0: number, depth: number, side: boolean): void => {
    count++;
    const drift = (r() - 0.5) * 0.25, n = Math.max(2, Math.ceil(len * 2)), angle = (t: number) => a0 * (1 - 0.3 * t) + drift * t;
    const pts: NormalPt[] = []; let x = x0, y = y0;
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = angle(t);
      pts.push({ x, y, w: w0 * (1 - 0.32 * t), nx: Math.cos(a), ny: Math.sin(a) });
      x += Math.sin(a) * (len / n); y -= Math.cos(a) * (len / n);
    }
    const thick: NormalPt[] = [];
    for (const p of pts) { if (p.w >= 1) thick.push(p); else cv.set(p.x, p.y, twigColour(p.x, cx, light), twigColour(p.x, cx, DEFAULT_LIGHT)); }
    paint(thick, false);
    if (detail) shadowLine(cv, r, light, thick);
    if (depth >= maxDepth || side) return;
    // every child's draws come before any recursion
    const kids: { a: number; len: number }[] = [];
    const nk = depth === 0 && r() < 0.4 ? 3 : 2, end = angle(1);
    for (let k = 0; k < nk; k++) {
      const spread = 0.45 + r() * 0.3, f = 0.66 + r() * 0.12;
      kids.push({ a: end + (nk === 3 && k === 1 ? (r() - 0.5) * 0.3 : (k === 0 ? -spread : spread)), len: len * f });
    }
    let twig: { at: number; a: number } | null = null;
    if (depth >= 1) { const grow = r() < 0.35, at = 0.3 + r() * 0.4, sg = r() < 0.5 ? -1 : 1, d = 0.6 + r() * 0.4; if (grow) twig = { at, a: angle(at) + sg * d }; }
    for (const k of kids) limb(x, y, k.a, k.len, w0 * 0.68, depth + 1, false);
    if (twig) { const p = pts[Math.round(twig.at * n)]; limb(p.x, p.y, twig.a, len * 0.4, w0 * 0.45, maxDepth, true); }
  };
  const fork = tr.at(1);
  limb(fork.x, fork.y, (r() - 0.5) * 0.3, 22 * s, 0.85 * fork.w, 0, false);
  barkLines(cv, r, tr, light, s);
  rootMoss(cv, r, cx, footY, s);
  // dead wood: every bark pixel, picture and reference, moves to the greyer ramp (colour only); moss stays green
  const dead: Record<string, string> = { a: 'e', b: 'f', c: 'g', d: 'h' }, { x0, y0, x1, y1 } = cv.box();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = cv.get(x, y), cRef = cv.getRef(x, y);
    if (c !== null && c in dead) cv.recolour(x, y, dead[c]);
    if (cRef !== null && cRef in dead) cv.recolourRef(x, y, dead[cRef]);
  }
  return cv.finish({ x: cx, y: footY }, { pockets: 0, vines: 0, stems: 0, limbs: count });
}
