// A conifer (fir/spruce): a straight trunk under stacked, jagged skirts (#279).
import { Canvas, DEFAULT_LIGHT, type Drawn, type Light, type PlantShape, rng, step } from './canvas';
import { type Trunk, barkLines, canopyShadow, painter, rootMoss, roots, type Seg } from './trunk';

const PAL = '56789';
const quant = (l: number) => (l > 0.6 ? '9' : l > 0.2 ? '8' : l > -0.3 ? '7' : l > -0.75 ? '6' : '5');

/**
 * One skirt, a rounded triangle of width `2W` px whose top edge is `yTop + 0.9 h (|x|/W)^1.1` and whose hem is
 * `yTop + h + 2.6 s (|x|/W)^2` minus a zigzag. `id` is stored in the lobe-id map. Every random draw (zigzag, noise,
 * dabs) is made whatever the light is. Fixed-position colours (shading, dark hem, the shadow onto the skirt below)
 * are written for both lights; the sun-side lift and dabs only recolour.
 */
function skirt(cv: Canvas, r: () => number, light: Light, s: number, cx: number, id: number, W: number, yTop: number, h: number, t: number): void {
  const period = 3.2 + r() * 1.2, amp = (1.6 + r() * 0.8) * s, phase = r() * period;
  const x0 = Math.round(cx - W), n = Math.round(cx + W) - x0 + 1;
  const tops = new Float64Array(n), bots = new Float64Array(n);
  const lx = 0.7 * light.x, dx = 0.7 * DEFAULT_LIGHT.x, yB = yTop + h, base = 0.05 - 0.3 * (1 - t);
  for (let i = 0; i < n; i++) {
    const x = x0 + i, ax = Math.abs(x - cx) / W;
    if (ax > 1) { tops[i] = Infinity; bots[i] = -Infinity; continue; }
    const u = ((x + phase) / period) % 1, jag = amp * (1 - Math.abs(2 * u - 1));
    const top = yTop + 0.9 * h * ax ** 1.1, bot = yB + 2.6 * s * ax * ax - jag;
    tops[i] = top; bots[i] = bot;
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
  for (let k = 0, count = Math.round((W * h) / 40); k < count; k++) {
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

/** A conifer: a straight tapering trunk, skirts stacked from the bottom (each one drooping to a zigzag hem) narrowing to a spire, blue-green palette 5..9. */
export function drawConifer(seed: number, s: number, light: Light): Drawn {
  const r = rng(seed), cv = new Canvas(220, 220), cx = 110, base = 190, detail = s >= 0.7;
  const bare = 1 + r() * 23; // bare trunk below the lowest skirt, design units (1 to 24: some hide it, some show a long trunk)
  const Y = (y: number) => base + (y - 86) * s;
  const footY = Y(80), paint = painter(cv, light);
  // trunk: half-width 3.2 to 1.4 units with a foot flare, up to just under the lowest skirt
  const len = bare + 4, wAt = (u: number) => Math.max(1.2, (3.2 - 1.8 * (u / len) + 2.2 * Math.max(0, 1 - u / 5) ** 2) * s);
  const seg: Seg = [], steps = Math.ceil(len * s);
  for (let i = 0; i <= steps; i++) { const u = (i / steps) * len; seg.push({ x: cx, y: Y(80 - u), w: wAt(u) }); }
  const tr: Trunk = { at: (t) => ({ x: cx, y: Y(80 - t * len), w: wAt(t * len) }), seg, topY: Y(80 - len), footY };
  paint(seg, false, footY);
  roots(r, paint, cx, footY, s, 0.7 * s, detail ? 3 : 2, 0.7);
  barkLines(cv, r, tr, light, s);
  rootMoss(cv, rng(seed ^ 0x6d6f7373), cx, footY, s); // its own stream
  // skirts, bottom first so each higher one covers the top of the one below; id = index from the bottom
  // the top skirt's top is at y 13; the gap is at most 10, so the full zigzag (2.4 px) never opens a row between two skirts
  const bottom = 80 - bare, span = bottom - 26, n = Math.max(3, Math.ceil(span / 10) + 1), gap = span / (n - 1);
  const clumps: PlantShape['clumps'] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), W = (5 + 17 * (1 - t) ** 1.15 + (r() * 2 - 1)) * s;
    const yTop = Y(bottom - i * gap - 13);
    skirt(cv, r, light, s, cx, i, W, yTop, 13 * s, t);
    clumps.push({ x: cx, y: yTop + 0.6 * 13 * s, r: 0.85 * W });
  }
  skirt(cv, r, light, s, cx, n, 3.2 * s, Y(9), 8 * s, 1); // the spire: its top is 4 units above the top skirt's, so it overlaps it
  clumps.push({ x: cx, y: Y(9) + 0.6 * 8 * s, r: 0.85 * 3.2 * s });
  cv.set(cx, Math.ceil(Y(9)) - 1, '7', '7', n); // its tip, on the row above the spire's top row
  canopyShadow(cv, 4 * s); // the lowest skirt's shadow on the trunk
  // the shadow shape: the trunk caster runs from the lowest skirt's hem to the foot, above the root flare (u >= 5 units, or the whole bare part)
  const trunkTop = Math.min(footY, Y(bottom)), halfW = wAt(Math.min(5, bare));
  const shape: PlantShape = { cast: 'parts', trunkTop, trunkX0: cx - halfW, trunkX1: cx + halfW, clumps };
  return cv.finish({ x: cx, y: footY }, undefined, shape);
}
