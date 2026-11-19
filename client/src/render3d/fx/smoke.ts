// The smoke of a body of smoke (#359): a dense, near-black core of camera-facing patches along the body's middle line and on the
// parts that carry smoke, and wisps that are born on the core's rim, drift slowly outward and fade into a second tone. Pure maths: it reads a
// `SmokeSpec` and writes quads (two triangles each, a corner coordinate per vertex) into a `SmokeBuf`; the material (round shapes made of
// noise, never a disc) and the mesh are the view's. World lengths are tiles; the spec's and `SMOKE`'s are model px, `px` of a tile each.
// The state per body is kept by `status.ts`; the look is the approved try-out's `puffs` smoke.
import { BONES } from '../models/bones';
import type { SmokeSpec } from '../models/tubeDesc';
import { smooth, type Axes } from './shapes';

/** The look and the way it moves, first values for the user's eye. Sizes and speeds in model px, rates per second, ranges [low, high]. */
export const SMOKE = {
  wisps: 340, life: [1.4, 3.0], leave: 12,                       // px of the body's travel that use up one whole wisp life: the distance the body leaves a wisp behind ages it
  core: { alpha: 0.97, size: [1.1, 0.5], tall: 1.35, wobble: 0.05, points: 13, pairOver: 2, pairAt: 0.55, pairR: 0.5 },
  rate: { top: 30, tail: 12, from: 0.45, part: 40 },          // 1/s: how fast a core point follows its place
  wisp: { alpha: 0.6, tall: 2.2, out: [0.3, 0.8], rise: [-0.15, 0.6], jitter: 0.8, wig: [0.45, 1.2], size: [0.75, 1.5], grow: [0.8, 0.7], black: 0.45, tone: [0.25, 0.85] },   // px, px/s
  topRise: 1.5, topUntil: 0.3,                                 // the wisps of the top 30 % of the line rise 1.5 times as fast
  black: [0.006, 0.005, 0.012], clock: 0.5,
  pool: { r: 5, y: 0.03, rise: [0.1, 0.8], alpha: [0, 0.3] },  // forming: a pool of radius 5 px on the floor, then the body rises
  death: { spread: 6, grow: 0.6 },                             // px/s outward; size per second of age
} as const;

/** Constants of the shapes that `SMOKE` does not name: the patch's wobble phase step, the wisp's rim and fade, the seed's spreads. */
const SHAPE = { wobblePhase: 2.1, wobbleRate: 0.6, rim: [0.75, 0.5], sizeBase: 0.7, sizeR: 0.3, hue: [0.05, 0.7], fadeIn: 0.15, fadeOut: [0.35, 1], seedStep: 0.137, seedMix: 0.1, minHalf: 0.05, gap: 1e-9,
  lineRadius: 0.8, lineWeight: 0.6, wigSeed: 40 } as const;   // a line point's patch: radius floor (share of the half width) and weight base; the wisp's sway phase per seed

/** Triangles (two per quad) with a corner coordinate: `c` holds cx, cy, seed, clock per corner. `n` is the triangle count, so the fx sight data reads it as an `FxBuf`. */
export interface SmokeBuf { position: number[]; rgba: number[]; c: number[]; n: number; dropped: number }
export const newSmokeBuf = (): SmokeBuf => ({ position: [], rgba: [], c: [], n: 0, dropped: 0 });
export const FX_SMOKE_CAP = 32000;   // triangles a frame (one Shade writes 728, so 43 Shades fit); more are dropped and counted, nearest last

/** A point of the body in the world this frame. */
export type PlaceOf = (bone: number, p: readonly [number, number, number], out: [number, number, number]) => void;

/** A point of the dense core: where it is (`x, y, z`), where its place is this frame (`tx, ty, tz`), and what it is. Bone -1 is the figure's root. */
export interface CorePoint {
  x: number; y: number; z: number; tx: number; ty: number; tz: number;
  bone: number; local: readonly [number, number, number];
  r: number; weight: number; rise: number; rate: number;
  /** Position along the line (0 the hump, 1 the tip); -1 for an `on` point. `halfWidth`: the line point's (a pair carries its line point's). */
  u: number; halfWidth: number;
  on: boolean; pair: boolean;
  /** Writes a dense patch (a line point, a pair, or an `on` point with r over 1). */
  patch: boolean;
  /** The point's angle round the foot while forming. */
  ang: number;
}
export interface Wisp { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; tone: number; seed: number; a: number }

/** The Catmull-Rom of the line at `u` (0..1): [x, y, half depth, half width]. */
function lineAt(line: SmokeSpec['line'], u: number, out: number[]): void {
  const n = line.length, f = Math.min(n - 1.0001, Math.max(0, u * (n - 1))), i = Math.floor(f), t = f - i;
  const a = line[Math.max(0, i - 1)], b = line[i], c = line[i + 1], d = line[Math.min(n - 1, i + 2)];
  for (let k = 0; k < 4; k++) {
    const v = 0.5 * (2 * b[k] + (c[k] - a[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * t * t * t);
    out[k] = k >= 2 ? Math.max(SHAPE.minHalf, v) : v;
  }
}

const tmp: [number, number, number] = [0, 0, 0], foot: [number, number, number] = [0, 0, 0], ZERO: readonly [number, number, number] = [0, 0, 0];

export class Smoke {
  readonly core: CorePoint[] = [];
  readonly wisps: Wisp[] = [];
  /** Core patches + wisps: the quads `write` puts at most. */
  readonly quads: number;
  private readonly rnd: () => number;
  private readonly seed: number;
  private t = 0;
  private px = 1 / 16;
  private form = 1;
  private parts = 1;

  constructor(spec: SmokeSpec, rnd: () => number, detail: number) {
    this.rnd = rnd; this.seed = rnd();
    const R = SMOKE.rate, K = SMOKE.core, s = [0, 0, 0, 0];
    for (let i = 0; i < K.points; i++) {
      const u = i / (K.points - 1);
      lineAt(spec.line, u, s);
      const [x, y, d, w] = s, rate = u < R.from ? R.top : R.top - (R.top - R.tail) * smooth(R.from, 1, u), rise = u < SMOKE.topUntil ? SMOKE.topRise : 1;
      this.core.push(this.point(-1, [x, y, 0], Math.max(d, SHAPE.lineRadius * w), d * w + SHAPE.lineWeight, rise, rate, u, w, false, false));
      if (w > K.pairOver) for (const side of [-1, 1]) this.core.push(this.point(-1, [x, y, side * K.pairAt * w], w * K.pairR, w, rise, rate, u, w, false, true));
    }
    for (const e of spec.on) this.core.push(this.point(BONES.indexOf(e.bone), e.at, e.r, e.weight, e.rise, R.part, -1, 0, true, false, e.r > 1));
    const n = Math.round(SMOKE.wisps * detail);
    for (let i = 0; i < n; i++) this.wisps.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 1, life: 1, size: 1, tone: 0, seed: rnd(), a: 0 });
    this.quads = this.core.filter((c) => c.patch).length + n;
  }

  private point(bone: number, local: readonly [number, number, number], r: number, weight: number, rise: number, rate: number, u: number, halfWidth: number, on: boolean, pair: boolean, patch = true): CorePoint {
    return { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, bone, local, r, weight, rise, rate, u, halfWidth, on, pair, patch, ang: this.rnd() * Math.PI * 2 };
  }

  /** The place of every core point this frame: its place on the body, mixed with its spot on the pool by `form`. */
  private targets(place: PlaceOf, px: number, form: number, footY: number): void {
    this.px = px; this.form = form;
    place(-1, ZERO, foot);
    const k = smooth(SMOKE.pool.rise[0], SMOKE.pool.rise[1], form), ring = SMOKE.pool.r * px, py = footY + SMOKE.pool.y;
    for (const c of this.core) {
      place(c.bone, c.local, tmp);
      const qx = foot[0] + Math.cos(c.ang) * ring, qz = foot[2] + Math.sin(c.ang) * ring;
      c.tx = qx + (tmp[0] - qx) * k; c.ty = py + (tmp[1] - py) * k; c.tz = qz + (tmp[2] - qz) * k;
    }
  }

  /** A wisp is born on the rim of a core point picked by weight (the `on` points' weights times `parts`). */
  private birth(w: Wisp, ax: Axes, px: number): void {
    const core = this.core, rnd = this.rnd, W = SMOKE.wisp;
    let total = 0;
    for (const c of core) total += c.on ? c.weight * this.parts : c.weight;
    let pick = rnd() * total, a = 0;
    for (let i = 0; i < core.length; i++) {
      pick -= core[i].on ? core[i].weight * this.parts : core[i].weight;
      if (pick <= 0) { a = i; break; }
      a = i;
    }
    // a point with no weight is never the last one picked by rounding
    while (core[a].on && this.parts === 0 && a > 0) a--;
    const c = core[a], ang = rnd() * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang);
    const rr = c.r * (SHAPE.rim[0] + SHAPE.rim[1] * rnd()) * px, up = (rnd() - 0.5) * c.r * px, out = (W.out[0] + rnd() * (W.out[1] - W.out[0])) * px;
    w.x = c.x + (ax.right[0] * cs + ax.up[0] * sn) * rr;
    w.y = c.y + (ax.right[1] * cs + ax.up[1] * sn) * rr + up;
    w.z = c.z + (ax.right[2] * cs + ax.up[2] * sn) * rr;
    w.vx = ax.right[0] * cs * out + (rnd() - 0.5) * W.jitter * px;
    w.vz = ax.right[2] * cs * out + (rnd() - 0.5) * W.jitter * px;
    w.vy = (W.rise[0] + rnd() * (W.rise[1] - W.rise[0])) * c.rise * px;
    w.age = 0; w.a = a;
    w.life = SMOKE.life[0] + rnd() * (SMOKE.life[1] - SMOKE.life[0]);
    w.size = (W.size[0] + rnd() * (W.size[1] - W.size[0])) * (SHAPE.sizeBase + SHAPE.sizeR * c.r);
    w.tone = rnd() < W.black ? 0 : W.tone[0] + rnd() * (W.tone[1] - W.tone[0]);
  }

  /** Every core point and wisp at its place at once (a first frame, a jump, a gap). `parts`: as in `step` (1 when the Shade is whole). */
  settle(place: PlaceOf, ax: Axes, px: number, form: number, footY: number, parts = 1): void {
    this.parts = parts;
    this.targets(place, px, form, footY);
    for (const c of this.core) { c.x = c.tx; c.y = c.ty; c.z = c.tz; }
    for (const w of this.wisps) {
      this.birth(w, ax, px);
      w.age = this.rnd();
      const s = w.age * w.life;
      w.x += w.vx * s; w.y += w.vy * s; w.z += w.vz * s;
    }
  }

  /** `dt` 0 changes nothing. `moved`: the body's step in x and z since the last call (tiles). `parts`: 0..1, how much smoke the hard parts carry (their forming alpha). */
  step(dt: number, place: PlaceOf, ax: Axes, px: number, moved: readonly [number, number], form: number, parts: number, footY: number): void {
    if (!(dt > 0)) return;
    this.parts = parts; this.t += dt;
    this.targets(place, px, form, footY);
    for (const c of this.core) {
      const k = 1 - Math.exp(-dt * c.rate);
      c.x += (c.tx - c.x) * k; c.y += (c.ty - c.y) * k; c.z += (c.tz - c.z) * k;
    }
    const W = SMOKE.wisp, travel = Math.hypot(moved[0], moved[1]) / px / SMOKE.leave, leaving = Number.isFinite(travel) ? travel : 0;
    for (const w of this.wisps) {
      // the body's travel ages a wisp as well as time: what it leaves behind runs through its life (fade-in, full, fade-out) within `SMOKE.leave` px
      w.age += dt / w.life + leaving;
      if (w.age >= 1) { const phase = w.age % 1; this.birth(w, ax, px); w.age = phase; }   // the part beyond 1 carries over, so a big step does not line the wisps up
      const wig = W.wig[0] * Math.sin(W.wig[1] * this.t + SHAPE.wigSeed * w.seed) * px;
      w.x += (w.vx + ax.right[0] * wig) * dt;
      w.y += (w.vy + ax.right[1] * wig) * dt;
      w.z += (w.vz + ax.right[2] * wig) * dt;
    }
  }

  /** Dying: nothing is born; every core point and wisp drifts outward from (x, z) at `SMOKE.death.spread` px/s. */
  spread(dt: number, x: number, z: number): void {
    if (!(dt > 0)) return;
    const d = SMOKE.death.spread * this.px * dt;
    const away = (p: { x: number; z: number }): void => {
      const ex = p.x - x, ez = p.z - z, el = Math.hypot(ex, ez);
      if (el < SHAPE.gap) return;
      p.x += (ex / el) * d; p.z += (ez / el) * d;
    };
    for (const c of this.core) away(c);
    for (const w of this.wisps) away(w);
  }

  /**
   * Writes the quads: the core, then the wisps (the caller orders the Shades far to near). `clock`: the smoke's own (it stands still when
   * petrified). `alpha`: a factor on every quad; `grow`: a factor on every size. A quad that is two triangles past `FX_SMOKE_CAP` is dropped and counted.
   */
  write(out: SmokeBuf, ax: Axes, px: number, tone: readonly [number, number, number], clock: number, alpha: number, grow: number): void {
    const form = smooth(SMOKE.pool.alpha[0], SMOKE.pool.alpha[1], this.form), clk = clock * SMOKE.clock, K = SMOKE.core, W = SMOKE.wisp, B = SMOKE.black;
    for (let i = 0; i < this.core.length; i++) {
      const c = this.core[i];
      if (!c.patch) continue;
      const hw = (c.r * K.size[0] + K.size[1]) * (1 + K.wobble * Math.sin(SHAPE.wobbleRate * clock + SHAPE.wobblePhase * i)) * px * grow;
      emit(out, ax, c.x, c.y, c.z, hw, K.tall, B[0], B[1], B[2], K.alpha * form * alpha * (c.on ? this.parts : 1), (i * SHAPE.seedStep + this.seed * SHAPE.seedMix) % 1, clk);
    }
    for (const w of this.wisps) {
      const m = w.tone * smooth(SHAPE.hue[0], SHAPE.hue[1], w.age), fade = smooth(0, SHAPE.fadeIn, w.age) * (1 - smooth(SHAPE.fadeOut[0], SHAPE.fadeOut[1], w.age));
      emit(out, ax, w.x, w.y, w.z, w.size * (W.grow[0] + W.grow[1] * w.age) * px * grow, W.tall,
        B[0] + (tone[0] - B[0]) * m, B[1] + (tone[1] - B[1]) * m, B[2] + (tone[2] - B[2]) * m, W.alpha * fade * form * alpha, w.seed, clk);
    }
  }
}

/** The corners of a quad, as two triangles: (-1,-1) (1,-1) (1,1) and (-1,-1) (1,1) (-1,1). */
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1] as const;

function emit(o: SmokeBuf, ax: Axes, x: number, y: number, z: number, hw: number, tall: number, r: number, g: number, b: number, a: number, seed: number, clock: number): void {
  if (o.n + 2 > FX_SMOKE_CAP) { o.dropped += 2; return; }
  const hh = hw * tall;
  let p = o.n * 9, q = o.n * 12;
  for (let k = 0; k < 6; k++) {
    const cx = CORNERS[k * 2], cy = CORNERS[k * 2 + 1];
    o.position[p++] = x + ax.right[0] * cx * hw + ax.up[0] * cy * hh;
    o.position[p++] = y + ax.right[1] * cx * hw + ax.up[1] * cy * hh;
    o.position[p++] = z + ax.right[2] * cx * hw + ax.up[2] * cy * hh;
    o.rgba[q] = r; o.rgba[q + 1] = g; o.rgba[q + 2] = b; o.rgba[q + 3] = a;
    o.c[q] = cx; o.c[q + 1] = cy; o.c[q + 2] = seed; o.c[q + 3] = clock;
    q += 4;
  }
  o.n += 2;
}
