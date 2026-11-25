// The fish of a woodland pond (#360), after the pond spike (#348): only for the look. The server does not know them; the water's
// material draws them as dark shapes under the surface (waterNodes.ts) from the array `positions` fills. Pure TypeScript, and the same
// fish for the same seed and the same sequence of steps.
import type { PondField } from './pondField';

/** The most fish a pond has (the material's array holds this many), and the floats of one fish in `positions`: x, z (tiles), heading (radians, 0 = east, toward +z), wag phase (radians). */
export const FISH_CAP = 14, FISH_STRIDE = 4;
/** Where an unused slot of `positions` lies (tiles): far from every map. */
export const FISH_AWAY = -1000;

/**
 * `deep`: the least bed depth (tiles, `depthAt`) a fish swims over. `area`: tiles of such water per fish, between `min` and FISH_CAP
 * of them (a pond with no such water has none). `speed`: a calm fish's speed range (tiles/s). `wander`: how fast the turn rate drifts
 * (rad/s per second), the pull back to straight (per second) and the largest turn rate (rad/s). `ahead`: how far (tiles) a fish looks
 * for the shallows, `margin` the depth over `deep` it wants there, `veer` its turn rate away from them (rad/s) and `feel` the angle
 * (rad) to either side at which it compares the depths. `scare`: the distance (tiles) from a wading figure within which it darts away,
 * `dart` for this long (s), up to `burst` times its own speed more at the start, heading away within `spread` radians.
 * `wag`: the tail's beat (rad/s) at rest and what a tile per second of speed adds.
 */
export const FISH = {
  deep: 1.0, area: 3, min: 4,
  speed: [0.3, 0.65], wander: 3, straighten: 0.6, turnMax: 1.2,
  ahead: 0.9, margin: 0.15, veer: 3.2, feel: 0.9,
  scare: 2.5, dart: 0.8, burst: 5, spread: 0.6,
  wag: [5, 9],
} as const;
/** The step (tiles) of the grid the deep water is counted on. */
const GRID = 0.5;

interface One { x: number; z: number; a: number; speed: number; turn: number; burst: number; phase: number }

/** A small seeded generator (mulberry32), 0..1. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Fish {
  private readonly fish: One[] = [];
  private readonly r: () => number;
  private readonly out = new Float32Array(FISH_CAP * FISH_STRIDE);

  constructor(private readonly field: PondField, seed: number) {
    const r = this.r = rng(seed);
    // The deep water, on a grid: where the fish start, and by its area how many there are.
    const spots: number[] = [];
    const b = field.box;
    for (let z = b.z0 + GRID / 2; z < b.z1; z += GRID) for (let x = b.x0 + GRID / 2; x < b.x1; x += GRID) {
      if (field.depthAt(x, z) >= FISH.deep) spots.push(x, z);
    }
    const tiles = (spots.length / 2) * GRID * GRID;
    const n = spots.length === 0 ? 0 : Math.min(FISH_CAP, Math.max(FISH.min, Math.round(tiles / FISH.area)));
    for (let i = 0; i < n; i++) {
      const k = 2 * Math.floor(r() * (spots.length / 2));
      this.fish.push({ x: spots[k], z: spots[k + 1], a: r() * Math.PI * 2, speed: FISH.speed[0] + r() * (FISH.speed[1] - FISH.speed[0]), turn: 0, burst: 0, phase: r() * Math.PI * 2 });
    }
    this.out.fill(0);
    for (let i = 0; i < FISH_CAP; i++) this.out[i * FISH_STRIDE] = this.out[i * FISH_STRIDE + 1] = FISH_AWAY;
  }

  get count(): number { return this.fish.length; }

  /** One step: every fish wanders in slow curves, turns away from the shallows and darts away from a wading figure (`waders`, tiles) that comes within `FISH.scare`. */
  step(dt: number, waders: readonly { x: number; z: number }[]): void {
    if (!(dt > 0)) return;
    const r = this.r, depth = this.field.depthAt;
    for (const f of this.fish) {
      f.turn += (r() - 0.5) * FISH.wander * dt;
      f.turn = Math.max(-FISH.turnMax, Math.min(FISH.turnMax, f.turn * (1 - FISH.straighten * dt)));
      let want = f.turn;
      // The shallows ahead: turn to the side where the water is deeper.
      if (depth(f.x + Math.cos(f.a) * FISH.ahead, f.z + Math.sin(f.a) * FISH.ahead) < FISH.deep + FISH.margin) {
        const left = depth(f.x + Math.cos(f.a + FISH.feel) * FISH.ahead, f.z + Math.sin(f.a + FISH.feel) * FISH.ahead);
        const right = depth(f.x + Math.cos(f.a - FISH.feel) * FISH.ahead, f.z + Math.sin(f.a - FISH.feel) * FISH.ahead);
        want = (left >= right ? 1 : -1) * FISH.veer;
      }
      if (f.burst <= 0) {
        for (const w of waders) {
          if (Math.hypot(w.x - f.x, w.z - f.z) >= FISH.scare) continue;
          f.a = Math.atan2(f.z - w.z, f.x - w.x) + (r() - 0.5) * FISH.spread;
          f.burst = FISH.dart;
          break;
        }
      }
      f.burst = Math.max(0, f.burst - dt);
      f.a += want * dt;
      const v = f.speed * (1 + (f.burst / FISH.dart) * FISH.burst);
      const nx = f.x + Math.cos(f.a) * v * dt, nz = f.z + Math.sin(f.a) * v * dt;
      // Never out of the deep water: a fish whose way is shut stays and keeps turning.
      if (depth(nx, nz) >= FISH.deep) { f.x = nx; f.z = nz; } else f.a += want * dt;
      f.phase = (f.phase + (FISH.wag[0] + FISH.wag[1] * v) * dt) % (Math.PI * 2);
    }
  }

  /** FISH_CAP times (x, z, heading, wag phase), the same array every call; an unused slot lies at `FISH_AWAY`. */
  positions(): Float32Array {
    const o = this.out;
    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i], k = i * FISH_STRIDE;
      o[k] = f.x; o[k + 1] = f.z; o[k + 2] = f.a; o[k + 3] = f.phase;
    }
    return o;
  }
}
