// The plant recipe (#334): what a leafy tree, a conifer or a bush is made of, from (kind, seed, scale) alone. No canvas, no painting:
// the 3D trees (grow.ts) read it, and nothing else draws plants (the 2D painters were removed by #333).
// Self-contained: it imports nothing.
//
// A plant's numbers come from one random stream per seed. The painters draw from that stream between the recipe's parts (bark
// lines, shadow lines, a noise value for every leaf pixel), so the recipe steps over those draws (`Rng.skip`) with the counts the
// painter uses; both take the counts from the helpers here (`limbSteps`, `barkLineCount`, `skirtColumns`). Every tree therefore keeps
// the shape it had when the picture and the recipe were made together; recipe.test.ts pins that.

/** A random stream; `skip(n)` steps over the next `n` draws (the state is a counter, so it costs nothing). */
export interface Rng { (): number; skip(n: number): void }
export function rng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (() => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }) as Rng;
  next.skip = (n) => { s = (s + Math.imul(n, 0x6d2b79f5)) >>> 0; };
  return next;
}

/** A stroke point of the recipe: canvas px (before the picture's crop), y down, and half-width. */
export interface RecipePt { x: number; y: number; w: number }
/** A stroke: discs of half-width `w` along a path. */
export type Seg = RecipePt[];
/**
 * What a leafy tree, a conifer or a bush is made of: every length in px of the generator's canvas (y down), `foot` in the same px.
 * `s` is the px per design unit (the scale). The bare tree has none.
 * Only the plants that have them carry `limbs` (a bush's twigs), `lobes` (a bush's crown ellipses) and `skirts` (a conifer's cones:
 * apex row `yTop`, hem `h` below it, half-width `W`).
 */
export interface Recipe {
  foot: { x: number; y: number }; trunk: RecipePt[]; roots: RecipePt[][]; s: number;
  limbs?: RecipePt[][];
  lobes?: { x: number; y: number; rx: number; ry: number }[];
  skirts?: { yTop: number; h: number; W: number }[];
}

// ---- trunk, limbs, roots, bark lines

export interface Trunk {
  /** The axis at t (0 = foot, 1 = fork): position and half-width in px. */
  at(t: number): RecipePt;
  seg: Seg;
  topY: number;
  footY: number;
}

/**
 * A bent, tapering trunk from the foot (design y 79) to the fork (design y `forkY`): a bend B·sin(πt) (up to ±5 units times
 * `bend`), a lean of up to ±3 units and a 0.6-unit wobble; half-width 6.0 − 3.2 t units times `tw`, plus a foot flare
 * 1.6·(1 − t/0.2)² in the lowest fifth. `Y` maps design y to px, `sx` stretches x, `tw` is scale times the shape's trunk factor.
 */
export function trunkPath(r: () => number, cx: number, Y: (y: number) => number, s: number, sx: number, tw: number, forkY: number, bend: number): Trunk {
  const B = (r() < 0.5 ? -1 : 1) * (1.5 + r() * 3.5) * bend, lean = (r() - 0.5) * 6, ph = r() * 6;
  const at = (t: number) => ({
    x: cx + (B * Math.sin(Math.PI * t) + lean * t + 0.6 * Math.sin(t * 9 + ph)) * s * sx,
    y: Y(79 + (forkY - 79) * t),
    w: Math.max(1.2, (6.0 - 3.2 * t + (t < 0.2 ? 1.6 * (1 - t / 0.2) ** 2 : 0)) * tw),
  });
  const seg: Seg = []; for (let i = 0; i <= 48; i++) seg.push(at(i / 48));
  return { at, seg, topY: Y(forkY), footY: Y(79) };
}

/** A limb from the fork to (tx, ty) px has this many steps, so one more point; the painter draws once per point for its shadow line. */
export const limbSteps = (fork: { x: number; y: number }, tx: number, ty: number) => Math.max(8, Math.ceil(Math.hypot(tx - fork.x, ty - fork.y) * 2));

/** The bark lines along a trunk: `n` lines (4; 2 below 70 % scale) of `len` + 1 steps each. The painter draws once per line and once per step. */
export function barkLineCount(tr: Trunk, s: number, tTop = 0.97): { n: number; len: number } {
  return { n: s >= 0.7 ? 4 : 2, len: Math.max(8, Math.ceil((tr.footY - tr.topY) * tTop)) };
}

const ROOT_DIRS: Record<2 | 3 | 4, [number, number, number, number][]> = {
  4: [[-1, 0.2, 11, 2.8], [-0.4, 0.55, 7, 2.4], [0.45, 0.55, 7, 2.4], [1, 0.18, 12, 2.8]],
  3: [[-1, 0.22, 11, 2.8], [0.2, 0.6, 6, 2.2], [1, 0.2, 11, 2.8]],
  2: [[-1, 0.25, 9, 2.6], [1, 0.25, 9, 2.6]],
};

/** A few short humps around the foot: length + r()·4 units times `lenMul`, tapering by (1 − t)^1.1; sorted so the lower ones come last (they overlap the others in the picture). */
export function rootPaths(r: () => number, cx: number, footY: number, s: number, tw: number, count: 2 | 3 | 4, lenMul: number): Seg[] {
  const list: Seg[] = [];
  for (const [vx, vy, len0, hw] of ROOT_DIRS[count]) {
    const len = (len0 + r() * 4) * s * lenMul, wig = r() * 6, w0 = Math.max(1.2, hw * tw), m = Math.hypot(vx, vy);
    const n = Math.max(6, Math.round(len * 1.5)); let x = cx + (vx / m) * 4 * tw, y = footY + (vy / m) * 2 * s;
    const seg: Seg = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n; seg.push({ x: x + Math.sin(t * 8 + wig) * 0.7 * t * s, y, w: w0 * (1 - t) ** 1.1 + 0.5 });
      const fy = vy * (1 - 0.6 * t), mm = Math.hypot(vx, fy); x += (vx / mm) * (len / n); y += (fy / mm) * (len / n);
    }
    list.push(seg);
  }
  return list.sort((A, B) => A[A.length - 1].y - B[B.length - 1].y);
}

// ---- leafy trees (round, wide, tall)

export type LeafyShape = 'round' | 'wide' | 'tall';
/** `old`: an older tree: trunk x1.4, bend x1.9, four longer roots (x1.25), and the trunk forks 3 units lower. */
export interface LeafyOpts { seed: number; scale: number; shape: LeafyShape; old?: boolean }
/** Per shape: the stretch, the trunk factor, the roots, the bend and the crown's lobe layout `[dx, y, r]` in design units (the picture's crown). */
export const SHAPES: Record<LeafyShape, { sx: number; sy: number; trunk: number; roots: 2 | 3 | 4; rootLen: number; bend: number; lobes: [number, number, number][] }> = {
  round: { sx: 1, sy: 1, trunk: 1, roots: 3, rootLen: 1, bend: 1, lobes: [[0, 14, 19], [-21, 26, 15], [22, 25, 15], [-11, 37, 13], [12, 37, 13], [-30, 36, 10], [30, 35, 10]] },
  wide: { sx: 1.3, sy: 0.85, trunk: 1.1, roots: 4, rootLen: 1.15, bend: 1.2, lobes: [[-7, 15, 18], [13, 17, 17], [-24, 27, 15], [26, 27, 14], [-13, 38, 13], [11, 38, 13], [-33, 36, 10], [32, 36, 10]] },
  tall: { sx: 0.8, sy: 1.3, trunk: 0.65, roots: 2, rootLen: 0.6, bend: 0.6, lobes: [[0, 9, 17], [-14, 22, 15], [15, 22, 15], [-9, 36, 13], [10, 36, 13]] },
};

/**
 * The first part of a leafy tree: its frame (`X`, `Y` map design units to px), the trunk and the limb targets (design units; a
 * tall tree uses two). After it the painter paints the limbs, then come the roots (`leafyRoots`).
 */
export function leafyStart(r: () => number, o: LeafyOpts) {
  const sh = SHAPES[o.shape], s = o.scale;
  const cx = 110, base = 190;
  const X = (dx: number) => cx + dx * s * sh.sx, Y = (y: number) => base + (y - 86) * s * sh.sy; // y in design units (0..86)
  const old = o.old === true;
  const tw = s * sh.trunk * (old ? 1.4 : 1); // trunk width factor
  const detail = s >= 0.7, footY = Y(79);
  const tr = trunkPath(r, cx, Y, s, sh.sx, tw, (old ? 57 : 54) + (r() - 0.5) * 6, sh.bend * (old ? 1.9 : 1));
  const targets: [number, number][] = [[-(17 + r() * 6), 33], [15 + r() * 6, 32], [(r() < 0.5 ? -4 : 4) + (r() - 0.5), 27]];
  const used = o.shape === 'tall' ? targets.slice(0, 2) : targets;
  return { sh, s, cx, X, Y, old, tw, detail, footY, tr, used };
}
export type LeafyStart = ReturnType<typeof leafyStart>;

export const leafyRoots = (r: () => number, p: LeafyStart): Seg[] => rootPaths(r, p.cx, p.footY, p.s, p.tw, p.old ? 4 : p.sh.roots, p.sh.rootLen * (p.old ? 1.25 : 1));

export function leafyRecipe(o: LeafyOpts): Recipe {
  const r = rng(o.seed), p = leafyStart(r, o);
  // the painter's limbs: on a large tree, one draw per limb point (its shadow line)
  if (p.detail) { const fork = p.tr.at(1); for (const [dx, ty] of p.used) r.skip(limbSteps(fork, p.X(dx), p.Y(ty)) + 1); }
  return { foot: { x: p.cx, y: p.footY }, trunk: p.tr.seg, roots: leafyRoots(r, p), s: p.s };
}

// ---- conifer

/** The first part of a conifer: the bare length below the lowest skirt (design units, 1 to 24) and the straight, tapering trunk with a foot flare. Then come the roots (`coniferRoots`), the painter's bark lines, and the tiers. */
export function coniferStart(r: () => number, s: number) {
  const cx = 110, base = 190, detail = s >= 0.7;
  const bare = 1 + r() * 23; // bare trunk below the lowest skirt, design units (1 to 24: some hide it, some show a long trunk)
  const Y = (y: number) => base + (y - 86) * s;
  const footY = Y(80);
  // trunk: half-width 3.2 to 1.4 units with a foot flare, up to just under the lowest skirt
  const len = bare + 4, wAt = (u: number) => Math.max(1.2, (3.2 - 1.8 * (u / len) + 2.2 * Math.max(0, 1 - u / 5) ** 2) * s);
  const seg: Seg = [], steps = Math.ceil(len * s);
  for (let i = 0; i <= steps; i++) { const u = (i / steps) * len; seg.push({ x: cx, y: Y(80 - u), w: wAt(u) }); }
  const tr: Trunk = { at: (t) => ({ x: cx, y: Y(80 - t * len), w: wAt(t * len) }), seg, topY: Y(80 - len), footY };
  // the top skirt's top is at y 13; the gap is at most 10, so the full zigzag (2.4 px) never opens a row between two skirts
  const bottom = 80 - bare, span = bottom - 26, n = Math.max(3, Math.ceil(span / 10) + 1), gap = span / (n - 1);
  return { s, cx, Y, detail, bare, footY, wAt, seg, tr, bottom, n, gap };
}
export type ConiferStart = ReturnType<typeof coniferStart>;

export const coniferRoots = (r: () => number, p: ConiferStart): Seg[] => rootPaths(r, p.cx, p.footY, p.s, 0.7 * p.s, p.detail ? 3 : 2, 0.7);

/** Tier `i` of `p.n`, counted from the bottom: its place `t` (0 bottom, 1 top), half-width `W`, apex row `yTop` and height `h` in px. One draw. */
export function coniferTier(r: () => number, p: ConiferStart, i: number): { t: number; W: number; yTop: number; h: number } {
  const t = i / (p.n - 1), W = (5 + 17 * (1 - t) ** 1.15 + (r() * 2 - 1)) * p.s;
  return { t, W, yTop: p.Y(p.bottom - i * p.gap - 13), h: 13 * p.s };
}
/** The spire on top: its top is 4 units above the top skirt's, so it overlaps it. */
export const coniferSpire = (p: ConiferStart): { W: number; yTop: number; h: number } => ({ W: 3.2 * p.s, yTop: p.Y(9), h: 8 * p.s });

/**
 * One skirt's outline by column: a rounded triangle of width `2W` px whose top edge is `yTop + 0.9 h (|x|/W)^1.1` and whose hem is
 * `yTop + h + 2.6 s (|x|/W)^2` minus a zigzag. Column `i` is x `x0 + i`; columns outside the skirt have `tops` = Infinity.
 * Three draws (the zigzag). `pixels` is the number of pixels inside; `draws` what the painter then draws: one noise value per pixel
 * and two per sun-side dab.
 */
export function skirtColumns(r: () => number, s: number, cx: number, W: number, yTop: number, h: number) {
  const period = 3.2 + r() * 1.2, amp = (1.6 + r() * 0.8) * s, phase = r() * period;
  const x0 = Math.round(cx - W), n = Math.round(cx + W) - x0 + 1;
  const tops = new Float64Array(n), bots = new Float64Array(n), yB = yTop + h;
  let pixels = 0;
  for (let i = 0; i < n; i++) {
    const x = x0 + i, ax = Math.abs(x - cx) / W;
    if (ax > 1) { tops[i] = Infinity; bots[i] = -Infinity; continue; }
    const u = ((x + phase) / period) % 1, jag = amp * (1 - Math.abs(2 * u - 1));
    const top = yTop + 0.9 * h * ax ** 1.1, bot = yB + 2.6 * s * ax * ax - jag;
    tops[i] = top; bots[i] = bot;
    pixels += Math.max(0, Math.floor(bot) - Math.ceil(top) + 1);
  }
  const dabs = Math.round((W * h) / 40);
  return { x0, n, tops, bots, pixels, dabs, draws: pixels + 2 * dabs };
}

export function coniferRecipe(seed: number, s: number): Recipe {
  const r = rng(seed), p = coniferStart(r, s);
  const roots = coniferRoots(r, p);
  const lines = barkLineCount(p.tr, s);
  r.skip(lines.n * (lines.len + 2)); // the painter's bark lines: one draw per line, one per step
  const skirts: { yTop: number; h: number; W: number }[] = [];
  for (let i = 0; i < p.n; i++) {
    const { W, yTop, h } = coniferTier(r, p, i);
    r.skip(skirtColumns(r, s, p.cx, W, yTop, h).draws); // the painter's skirt
    skirts.push({ yTop, h, W });
  }
  const sp = coniferSpire(p);
  skirts.push({ yTop: sp.yTop, h: sp.h, W: sp.W });
  return { foot: { x: p.cx, y: p.footY }, trunk: p.seg, roots, skirts, s };
}

// ---- bush

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

/** A crown lobe in px: centre, radii and the two phases of its scalloped outline. */
export interface Lobe { x: number; y: number; rx: number; ry: number; ph: number; ph2: number }

/**
 * A bush `width` px wide (about, to a few px): 3-5 lobes (lowest first) on one thin stem (`wide` px wide from column `sx`, `h` px
 * high) that forks early into 2 twigs (3 with 5 lobes) going up and out at 35-60 degrees (`a` rad from straight up, `len` px) until they
 * are under the crown.
 */
export function bushPlan(r: () => number, width: number) {
  const cx = 60, ground = 85;
  const n = width < 28 ? 3 : width < 40 ? 4 : 5; // lobe count by the drawn size
  const s = width / BUSH_SPREAD / EXTENT[n]; // design units to px: the layout's width in units becomes the drawn width
  const lift = Math.round((3 + r()) * (width / 32)); // the crown stands this high above the ground
  const lobes: Lobe[] = LAYOUTS[n].map(([dx, dy, rad]) => {
    const x = cx + (dx + (r() - 0.5) * 3) * s, y = ground - lift + (dy + (r() - 0.5) * 2) * s, rr = rad + (r() - 0.5) * 2;
    return { x, y, rx: rr * s, ry: rr * s * 0.86, ph: r() * 6, ph2: r() * 6 };
  }).sort((a, b) => b.y - a.y);
  // one thin stem in the middle (1 px below 40 px wide, else 2)
  const sx = cx + Math.round((r() - 0.5) * 2), wide = width < 40 ? 1 : 2, h = Math.round(1 + width / 40);
  const stemCentre = sx + (wide - 1) / 2;
  const nb = n === 5 ? 3 : 2, yEnd = ground - lift - 1, yFork = ground - h - 1;
  const twigs: { a: number; len: number; seg: Seg }[] = [];
  for (let k = 0; k < nb; k++) {
    const mag = ((35 + r() * 25) * Math.PI) / 180, a = nb === 3 && k === 1 ? (r() - 0.5) * 0.3 : (k === 0 ? -mag : mag);
    const len = Math.max(1, (yFork - yEnd) / Math.cos(a));
    twigs.push({ a, len, seg: [{ x: stemCentre, y: yFork, w: 0.5 }, { x: stemCentre + Math.sin(a) * len, y: yFork - Math.cos(a) * len, w: 0.5 }] });
  }
  const recipe: Recipe = {
    foot: { x: cx, y: ground },
    trunk: [{ x: stemCentre + 0.5, y: ground, w: wide / 2 }, { x: stemCentre + 0.5, y: ground - h - 1, w: wide / 2 }],
    roots: [], limbs: twigs.map((t) => t.seg), lobes, s,
  };
  return { cx, ground, n, s, lift, lobes, sx, wide, h, stemCentre, yFork, twigs, recipe };
}

export const bushRecipe = (seed: number, width: number): Recipe => bushPlan(rng(seed), width).recipe;

// ---- by kind

export type RecipeKind = LeafyShape | 'conifer' | 'bush';
/** One plant's recipe by kind; trees scale by `scalePct` / 100, a bush is 32 px wide at 100. */
export function plantRecipe(kind: RecipeKind, seed: number, scalePct: number): Recipe {
  if (kind === 'bush') return bushRecipe(seed, (32 * scalePct) / 100);
  if (kind === 'conifer') return coniferRecipe(seed, scalePct / 100);
  return leafyRecipe({ seed, scale: scalePct / 100, shape: kind });
}
