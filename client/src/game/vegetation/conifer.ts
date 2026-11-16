// A conifer (fir/spruce): a straight trunk under stacked, jagged skirts (#279).
// The trunk, the roots and every tier's place and outline come from the recipe module (#334); this file paints them.
import { coniferRoots, coniferSpire, coniferStart, coniferTier, rng, skirtColumns } from '../../render3d/trees/recipe';
import { Canvas, DEFAULT_LIGHT, type Drawn, type Light, type PlantShape, step } from './canvas';
import { barkLines, canopyShadow, painter, rootMoss } from './trunk';

const PAL = '56789';
const quant = (l: number) => (l > 0.6 ? '9' : l > 0.2 ? '8' : l > -0.3 ? '7' : l > -0.75 ? '6' : '5');

/**
 * One skirt, a rounded triangle of width `2W` px whose top edge is `yTop + 0.9 h (|x|/W)^1.1` and whose hem is
 * `yTop + h + 2.6 s (|x|/W)^2` minus a zigzag. `id` is stored in the lobe-id map. Every random draw (zigzag, noise,
 * dabs) is made whatever the light is. Fixed-position colours (shading, dark hem, the shadow onto the skirt below)
 * are written for both lights; the sun-side lift and dabs only recolour.
 */
function skirt(cv: Canvas, r: () => number, light: Light, s: number, cx: number, id: number, W: number, yTop: number, h: number, t: number): void {
  const { x0, n, tops, bots, dabs } = skirtColumns(r, s, cx, W, yTop, h);
  const lx = 0.7 * light.x, dx = 0.7 * DEFAULT_LIGHT.x, base = 0.05 - 0.3 * (1 - t);
  for (let i = 0; i < n; i++) {
    if (tops[i] === Infinity) continue;
    const x = x0 + i, top = tops[i], bot = bots[i];
    const xw = (x - cx) / W, span = Math.max(bot - top, 1);
    for (let y = Math.ceil(top); y <= Math.floor(bot); y++) {
      const b = 0.9 * (0.75 - (y - top) / span) + (r() - 0.5) * 0.12 + base, dB = bot - y;
      let c = quant(b + lx * xw), cRef = quant(b + dx * xw);
      if (dB < 1.5) { c = '5'; cRef = '5'; } else if (dB < 2.6) { if (c > '6') c = '6'; if (cRef > '6') cRef = '6'; }
      cv.set(x, y, c, cRef, id);
    }
  }
  const recolour = (ref: boolean, x: number, y: number, by: number) => {
    if (cv.idAt(x, y) !== id) return;
    if (ref) cv.recolourRef(x, y, step(PAL, cv.getRef(x, y), by) as string); else cv.recolour(x, y, step(PAL, cv.get(x, y), by) as string);
  };
  // the outer tenth of the sun side is lifted one step (not the hem)
  for (const ref of [false, true]) {
    const sg = Math.sign(ref ? DEFAULT_LIGHT.x : light.x);
    for (let i = 0; i < n; i++) {
      const x = x0 + i;
      if (tops[i] === Infinity || Math.abs(x - cx) / W <= 0.9 || Math.sign(x - cx) !== sg) continue;
      for (let y = Math.ceil(tops[i]); y <= Math.floor(bots[i] - 2.6); y++) recolour(ref, x, y, 1);
    }
  }
  // dabs on the sun side, 2 px wide, one step lighter; every draw first
  for (let k = 0; k < dabs; k++) {
    const u = 0.25 + 0.7 * r(), v = 0.6 * r();
    for (const ref of [false, true]) {
      const sg = Math.sign(ref ? DEFAULT_LIGHT.x : light.x), x = Math.round(cx + sg * u * W), i = x - x0;
      if (i < 0 || i >= n || tops[i] === Infinity) continue;
      const y = Math.round(tops[i] + v * (bots[i] - tops[i]));
      for (let q = 0; q < 2; q++) { const j = i + q; if (j < n && bots[j] - y >= 2.6) recolour(ref, x + q, y, 1); }
    }
  }
  // the shadow of this hem on the two rows below it, where a lower skirt shows: two steps, then one
  for (let i = 0; i < n; i++) {
    if (tops[i] === Infinity) continue;
    for (let d = 1; d <= 2; d++) {
      const x = x0 + i, y = Math.floor(bots[i]) + d, j = cv.idAt(x, y);
      if (j >= 0 && j < id) cv.set(x, y, step(PAL, cv.get(x, y), -(3 - d)) as string, step(PAL, cv.getRef(x, y), -(3 - d)) as string, j);
    }
  }
}

/**
 * The shadow discs of one skirt of half width `W` at the disc row `y`: radius `r` (limited by the tier's height, so each stays inside it),
 * centres spaced about `r` apart across +-(W - r), so the union spans the skirt's whole width. Off-axis discs carry `reach` = W - |dx|,
 * the depth budget the 3D view keeps their seeded depth offset within.
 */
function tierDiscs(out: PlantShape['clumps'], cx: number, y: number, W: number, r: number): void {
  const span = Math.max(0, W - r), k = Math.max(1, Math.ceil(span / r) * 2 + 1);
  for (let i = 0; i < k; i++) {
    const dx = k === 1 ? 0 : -span + (2 * span * i) / (k - 1);
    out.push(Math.abs(dx) < 0.5 ? { x: cx, y, r } : { x: cx + dx, y, r, reach: W - Math.abs(dx) });
  }
}

/** A conifer: a straight tapering trunk, skirts stacked from the bottom (each one drooping to a zigzag hem) narrowing to a spire, blue-green palette 5..9. */
export function drawConifer(seed: number, s: number, light: Light): Drawn {
  const r = rng(seed), cv = new Canvas(220, 220);
  const p = coniferStart(r, s), { cx, Y, bare, footY, wAt, seg, tr, bottom, n } = p;
  const paint = painter(cv, light);
  paint(seg, false, footY);
  const rootSegs = coniferRoots(r, p);
  rootSegs.forEach((sg) => paint(sg, true));
  const cones: { yTop: number; h: number; W: number }[] = [];
  barkLines(cv, r, tr, light, s);
  rootMoss(cv, rng(seed ^ 0x6d6f7373), cx, footY, s); // its own stream
  // skirts, bottom first so each higher one covers the top of the one below; id = index from the bottom
  const clumps: PlantShape['clumps'] = [];
  for (let i = 0; i < n; i++) {
    const { t, W, yTop, h } = coniferTier(r, p, i);
    skirt(cv, r, light, s, cx, i, W, yTop, h, t);
    cones.push({ yTop, h, W });
    tierDiscs(clumps, cx, yTop + 0.6 * 13 * s, W, Math.min(0.85 * W, 0.4 * 13 * s)); // inside its own tier: the discs end at the hem
  }
  const sp = coniferSpire(p); // its top is 4 units above the top skirt's, so it overlaps it
  skirt(cv, r, light, s, cx, n, sp.W, sp.yTop, sp.h, 1);
  cones.push({ yTop: sp.yTop, h: sp.h, W: sp.W });
  clumps.push({ x: cx, y: Y(9) + 0.6 * 8 * s, r: Math.min(0.85 * 3.2 * s, 0.4 * 8 * s) }); // the spire: one disc
  cv.set(cx, Math.ceil(Y(9)) - 1, '7', '7', n); // its tip, on the row above the spire's top row
  canopyShadow(cv, 4 * s); // the lowest skirt's shadow on the trunk
  // the shadow shape: the trunk caster runs from the lowest skirt's hem to the foot, above the root flare (u >= 5 units, or the whole bare part)
  const trunkTop = Math.min(footY, Y(bottom)), halfW = wAt(Math.min(5, bare));
  const shape: PlantShape = { cast: 'parts', trunkTop, trunkX0: cx - halfW, trunkX1: cx + halfW, clumps };
  return cv.finish({ x: cx, y: footY }, undefined, shape, { foot: { x: cx, y: footY }, trunk: seg, roots: rootSegs, skirts: cones, s });
}
