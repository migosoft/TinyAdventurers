// Nymph's cove: the grass carpet, its flowers and the plant spots, all seeded and pure.
// Ported 1:1 from the approved prototype; the stone floor, the tree and the plants themselves are drawn elsewhere.

/** The room's floor area in px (origin = its top-left floor pixel) and the trunk foot in the same space. */
export interface CoveSpec { w: number; h: number; tree: { x: number; y: number }; seed: number }

/** Mirrors scripts/cove-frames.ts (the client cannot import from there): the trunk foot inside cove_tree, px. */
export const COVE_TREE_FOOT = { x: 48, y: 79 };

export const COVE_PLANTS = ['cove_bush_a', 'cove_bush_b', 'cove_tuft_a', 'cove_tuft_b', 'cove_fern'] as const;
export type CovePlantFrame = typeof COVE_PLANTS[number];

/** No plant stands here around the trunk foot: |dx| < dx, and from `up` above to `down` below. */
export const TRUNK_CLEAR = { dx: 36, up: 30, down: 14 };

/** Transparent margin around the floor area, so blades and shadows over the wall line are kept. */
const MARGIN = 32;

type Rgb = [number, number, number];
const hex = (s: string): Rgb => [0, 2, 4].map((k) => parseInt(s.slice(k, k + 2), 16)) as Rgb;
const G1 = hex('28643e');
const BASE = hex('3e8a43'), PATCH: Rgb = [58, 131, 64], EDGE: Rgb = [49, 116, 60];
const FLOWERS: Rgb[] = [hex('fdf7ed'), hex('facb3e'), hex('e8a0c8'), hex('cae6f5'), hex('da4e38')];
const SHADOW_ALPHA = 115; // black, about the prototype's x0.55 on stone

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise on a wrapping 64x64 lattice, one lattice cell every `step` px. */
function noise(seed: number, step: number) {
  const r = rng(seed);
  const N = 64;
  const g = Array.from({ length: N * N }, () => r());
  const at = (i: number, j: number) => g[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const fx = x / step, fy = y / step, i = Math.floor(fx), j = Math.floor(fy), u = sm(fx - i), v = sm(fy - j);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u, b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}

// The prototype's fixed seeds belong to seed 1; other seeds shift all of them.
const seeded = (base: number, spec: CoveSpec) => base + (spec.seed - 1) * 1000;

/** Which floor-area pixels are grass: one rounded carpet inset 22 px, its edge wobbling by noise. */
export function coveGrass(spec: CoveSpec): (x: number, y: number) => boolean {
  const { w: W, h: H } = spec;
  const n1 = noise(seeded(3, spec), 12), n2 = noise(seeded(9, spec), 3);
  const INSET = 22, R = 28;
  return (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const qx = Math.max(INSET + R - x, x - (W - INSET - R), 0), qy = Math.max(INSET + R - y, y - (H - INSET - R), 0);
    const out = Math.hypot(qx, qy) - R; // signed distance to the rounded rectangle, <0 inside
    return 0.5 - (out + (n1(x, y) - 0.5) * 10 + (n2(x, y) - 0.5) * 4) / 8 > 0.5;
  };
}

/** RGBA of the grass, its border blades with their shadow on the stone, and the flowers; the floor area plus MARGIN px all round. */
export function paintCove(spec: CoveSpec): { w: number; h: number; data: Uint8ClampedArray } {
  const { w: W, h: H } = spec;
  const cx = spec.tree.x, cy = spec.tree.y;
  const OW = W + MARGIN * 2, OH = H + MARGIN * 2;
  const data = new Uint8ClampedArray(OW * OH * 4);
  const grass = coveGrass(spec);
  const put = (x: number, y: number, c: Rgb) => {
    const X = x + MARGIN, Y = y + MARGIN;
    if (X < 0 || Y < 0 || X >= OW || Y >= OH) return;
    const i = (Y * OW + X) * 4;
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  };
  // grass texture: one flat colour, big faint patches only a shade apart
  const n3 = noise(seeded(17, spec), 26);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!grass(x, y)) continue;
    const sh = Math.hypot((x - cx) / 46, (y - (cy - 6)) / 17); // canopy shadow around the trunk
    put(x, y, sh < 1 ? PATCH : n3(x, y) < 0.42 ? PATCH : BASE);
  }
  // a few sparse, faint blade marks so the carpet is not dead flat
  const rb = rng(seeded(23, spec));
  for (let k = 0; k < (W * H) / 90; k++) {
    const x = Math.floor(rb() * W), y = Math.floor(rb() * H);
    if (grass(x, y) && grass(x, y - 2) && grass(x, y + 1)) { put(x, y, EDGE); put(x + (rb() < 0.5 ? -1 : 1), y - 1, EDGE); }
  }
  // border: pointed blades of varied height sticking out over the stone, shaded on one side
  const rt = rng(seeded(31, spec));
  const stoneShadow = (x: number, y: number) => {
    if (grass(x, y)) return;
    const X = x + MARGIN, Y = y + MARGIN;
    if (X < 0 || Y < 0 || X >= OW || Y >= OH) return;
    const i = (Y * OW + X) * 4;
    const a = data[i + 3] / 255, s = SHADOW_ALPHA / 255, out = a + s * (1 - a);
    for (let c = 0; c < 3; c++) data[i + c] = Math.round((data[i + c] * a * (1 - s)) / out);
    data[i + 3] = Math.round(out * 255);
  };
  const blade = (x: number, y: number, dx: number, dy: number) => {
    const len = 2 + Math.floor(rt() * 3), half = 1 + Math.floor(rt() * 2.5), lean = rt() < 0.5 ? -1 : 1;
    const px = -dy, py = dx; // across the blade
    for (let t = 0; t <= len; t++) {
      const w = Math.round(half * (1 - t / (len + 1)));
      const off = Math.round((lean * t * t) / (len * 3));
      for (let k = -w; k <= w; k++) {
        const X = x + dx * t + px * (k + off), Y = y + dy * t + py * (k + off);
        put(X, Y, k === (lean > 0 ? -w : w) && w > 0 ? EDGE : BASE);
        if (dy === 1) { stoneShadow(X, Y + 1); stoneShadow(X, Y + 2); }
      }
    }
  };
  const marks: [number, number, number, number][] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!grass(x, y)) continue;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const)
      if (!grass(x + dx, y + dy) && rt() < (dy === 0 ? 0.2 : 0.3)) marks.push([x, y, dx, dy]);
  }
  // shadow under the bottom edge first, so blades drawn later sit on top of it
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grass(x, y) && !grass(x, y + 1)) { stoneShadow(x, y + 1); stoneShadow(x, y + 2); stoneShadow(x, y + 3); }
  for (const [x, y, dx, dy] of marks) blade(x, y, dx, dy);
  // flowers: denser near the tree, none on the trunk
  const rfl = rng(seeded(41, spec));
  for (let k = 0; k < 4000; k++) {
    const x = Math.floor(rfl() * W), y = Math.floor(rfl() * H);
    if (!grass(x - 1, y) || !grass(x + 1, y) || !grass(x, y + 1) || !grass(x, y - 1)) continue;
    const d = Math.hypot((x - cx) / (W * 0.5), (y - cy) / (H * 0.5));
    if (rfl() > Math.max(0, 1 - d * 1.05) ** 2 * 0.8) continue;
    const c = FLOWERS[Math.floor(rfl() * FLOWERS.length)];
    if (rfl() < 0.35) { put(x - 1, y, c); put(x + 1, y, c); put(x, y - 1, c); put(x, y + 1, G1); put(x, y, FLOWERS[1]); } else { put(x, y, c); put(x, y + 1, G1); }
  }
  return { w: OW, h: OH, data };
}

/** A plant's foot (bottom centre) in floor-area px. */
export interface CovePlant { frame: CovePlantFrame; x: number; y: number }

/** Bushes near the grass edge, tufts and ferns scattered, a few around the tree, none on the trunk; at most 30. */
export function placeCovePlants(spec: CoveSpec): CovePlant[] {
  const { w: W, h: H } = spec;
  const cx = spec.tree.x, cy = spec.tree.y;
  const grass = coveGrass(spec);
  const rp = rng(seeded(57, spec));
  const placed: CovePlant[] = [];
  const isBush = (f: CovePlantFrame) => f.startsWith('cove_bush');
  const free = (x: number, y: number, r: number) => placed.every((p) => Math.hypot(p.x - x, p.y - y) > r);
  const onTrunk = (x: number, y: number) => Math.abs(x - cx) < TRUNK_CLEAR.dx && y > cy - TRUNK_CLEAR.up && y < cy + TRUNK_CLEAR.down; // trunk and roots
  const pick = (nearEdge: boolean): CovePlantFrame =>
    nearEdge && rp() < 0.6 ? (rp() < 0.5 ? 'cove_bush_a' : 'cove_bush_b') : (['cove_tuft_a', 'cove_tuft_b', 'cove_tuft_a', 'cove_fern'] as const)[Math.floor(rp() * 4)];
  const tryPlace = (x: number, y: number, frame: CovePlantFrame) => {
    if (!grass(x - 8, y) || !grass(x + 8, y) || !grass(x, y - 12) || !grass(x, y + 3) || onTrunk(x, y)) return false;
    if (!free(x, y, isBush(frame) ? 24 : 15)) return false;
    placed.push({ frame, x, y });
    return true;
  };
  // a few bushes and ferns around the tree
  const ring = ['cove_bush_a', 'cove_bush_b', 'cove_fern', 'cove_fern'] as const;
  for (let k = 0, n = 0; k < 400 && n < 6; k++) {
    const ang = rp() * Math.PI * 2, d = 0.8 + rp() * 0.5;
    if (tryPlace(Math.round(cx + Math.cos(ang) * 62 * d), Math.round(cy - 4 + Math.sin(ang) * 30 * d), ring[n % 4])) n++;
  }
  for (let k = 0; k < 3000 && placed.length < 30; k++) {
    const x = Math.floor(rp() * W), y = Math.floor(rp() * H);
    const nearEdge = !grass(x - 26, y) || !grass(x + 26, y) || !grass(x, y - 30) || !grass(x, y + 24);
    tryPlace(x, y, pick(nearEdge));
  }
  return placed;
}
