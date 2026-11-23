// Lava in 3D (#344): what the pools and the figures do to each other. A pool in view and seen bubbles now and then; a figure
// that stands in lava opens a ring in the surface, enters with a splash, sprays when it dashes over and burns when it is a hero.
// Sizes and distances are in tiles. Pure: no three.js, no effects.
import { isPlayerKind } from '../../game/anim/defs';
import type { TileMap } from '../../sim/map';
import type { DrawnFig } from '../fx/types';
import { LAVA_LEVEL, isLava, maskAt } from '../dips/shape';
import type { Footprint } from '../lights';
import { hiddenAt, type SightMask } from '../sightmask';
import { BUBBLE, BUBBLE_CAP, Bubbles } from './bubbles';

export const STIR_CAP = 8;
/** The seed of the dev pages' lava bubbles. */
export const LAVA_SEED = 344;
/** Seconds between a pool's bubbles; the least lava mask of a bubble's spot and the tries to find one; the depth (tiles) at which a figure's ring is full; cue rates per second. */
export const LAVA = { every: [0.6, 2], mask: 0.95, tries: 8, ringDepth: 0.3, sprayRate: 30 } as const;
/** How far outside the ground the screen shows a pool still counts as in view (tiles). */
const VIEW_MARGIN = 1;

export interface LavaSpot { id: number; x: number; z: number }
/** `pops` have id -1. `burning`: the heroes standing in lava this frame. */
export interface LavaCues { enters: LavaSpot[]; spray: LavaSpot[]; burning: LavaSpot[]; pops: LavaSpot[] }
export interface LavaIn {
  dt: number;
  now: number;
  figs: readonly DrawnFig[];
  hidden: ReadonlySet<number>;
  /** The ground the screen shows, and the sight mask (null: everything is seen): a pool bubbles only when one of its tiles is in view (margin 1 tile) and not hidden (`hiddenAt`). */
  fp: Footprint;
  mask: SightMask | null;
  /** The camera target on the ground: with more than STIR_CAP figures in lava the nearest to it keep their rings. */
  focus: { x: number; z: number };
}

/** `standing`: in lava last frame; a dash over lava counts as in it, so a dash that ends in lava makes no entering. */
interface FigState { standing: boolean; spray: number; seen: number }
/** A 4-connected group of lava tiles (their cell corners as x, z pairs), its box and the seconds until its next bubble. */
interface Pool { tiles: number[]; x0: number; z0: number; x1: number; z1: number; timer: number }
interface Ring { x: number; z: number; s: number; d: number }

/** A list of cues that reuses its spot objects from frame to frame. */
class Spots {
  readonly list: LavaSpot[] = [];
  private readonly pool: LavaSpot[] = [];
  clear(): void { this.list.length = 0; }
  push(id: number, x: number, z: number): void {
    const n = this.list.length;
    const s = this.pool[n] ?? (this.pool[n] = { id: 0, x: 0, z: 0 });
    s.id = id; s.x = x; s.z = z;
    this.list.push(s);
  }
}

export class Lava3d {
  private pools: Pool[] = [];
  private readonly bubbles = new Bubbles();
  private readonly packed = new Float32Array(BUBBLE_CAP * 4);
  private readonly stirs = new Float32Array(STIR_CAP * 4);
  private readonly states = new Map<number, FigState>();
  private frameNo = 0;
  private readonly enters = new Spots();
  private readonly spray = new Spots();
  private readonly burning = new Spots();
  private readonly pops = new Spots();
  private readonly cues: LavaCues = { enters: this.enters.list, spray: this.spray.list, burning: this.burning.list, pops: this.pops.list };
  private readonly result = { bubbles: this.packed, stirs: this.stirs, live: 0, cues: this.cues };
  private readonly rings: Ring[] = [];
  private input: LavaIn | null = null;
  private readonly onPop = (x: number, z: number): void => {
    const i = this.input;
    if (i && !(i.mask && hiddenAt(i.mask, x, z))) this.pops.push(-1, x, z);
  };

  constructor(private readonly map: TileMap, private readonly rng: () => number = Math.random) {
    this.findPools();
  }

  /** The lava tiles changed: the pools are found again, bubbles over a cell that is no longer lava are dropped. */
  mapChanged(): void {
    this.findPools();
    this.bubbles.prune((x, z) => isLava(this.map.get(Math.floor(x), Math.floor(z))));
  }

  private wait(): number {
    return LAVA.every[0] + this.rng() * (LAVA.every[1] - LAVA.every[0]);
  }

  private findPools(): void {
    const { w, h } = this.map;
    const seen = new Uint8Array(w * h);
    const pools: Pool[] = [];
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      if (seen[z * w + x] || !isLava(this.map.get(x, z))) continue;
      const p: Pool = { tiles: [], x0: x, z0: z, x1: x + 1, z1: z + 1, timer: this.wait() };
      const stack = [x, z];
      seen[z * w + x] = 1;
      while (stack.length > 0) {
        const cz = stack.pop()!, cx = stack.pop()!;
        p.tiles.push(cx, cz);
        p.x0 = Math.min(p.x0, cx); p.z0 = Math.min(p.z0, cz); p.x1 = Math.max(p.x1, cx + 1); p.z1 = Math.max(p.z1, cz + 1);
        for (let k = 0; k < 4; k++) {
          const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), nz = cz + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx < 0 || nz < 0 || nx >= w || nz >= h || seen[nz * w + nx] || !isLava(this.map.get(nx, nz))) continue;
          seen[nz * w + nx] = 1;
          stack.push(nx, nz);
        }
      }
      pools.push(p);
    }
    this.pools = pools;
  }

  /** Whether a tile of the pool is in view (margin 1 tile) and not hidden by the mask. */
  private watched(p: Pool, i: LavaIn): boolean {
    const f = i.fp;
    if (p.x1 < f.x0 - VIEW_MARGIN || p.x0 > f.x1 + VIEW_MARGIN || p.z1 < f.z0 - VIEW_MARGIN || p.z0 > f.z1 + VIEW_MARGIN) return false;
    if (!i.mask) return true;
    for (let k = 0; k < p.tiles.length; k += 2) if (!hiddenAt(i.mask, p.tiles[k] + 0.5, p.tiles[k + 1] + 0.5)) return true;
    return false;
  }

  private deep(x: number, z: number): boolean {
    return maskAt(this.map, x, z, isLava) >= LAVA.mask;
  }

  private startBubble(p: Pool, now: number, i: LavaIn): void {
    const n = p.tiles.length / 2;
    const f = i.fp;
    for (let t = 0; t < LAVA.tries; t++) {
      const k = Math.floor(this.rng() * n) * 2;
      const x = p.tiles[k] + this.rng(), z = p.tiles[k + 1] + this.rng();
      const size = BUBBLE.size[0] + this.rng() * (BUBBLE.size[1] - BUBBLE.size[0]);
      // only where the hero can see it: in view (margin 1 tile) and not hidden by the mask
      if (x < f.x0 - VIEW_MARGIN || x > f.x1 + VIEW_MARGIN || z < f.z0 - VIEW_MARGIN || z > f.z1 + VIEW_MARGIN) continue;
      if (i.mask && hiddenAt(i.mask, x, z)) continue;
      // the spot and the four points a dome's size away must all be lava: a dome never reaches a bank, and a lone tile has no room for one
      if (!this.deep(x, z) || !this.deep(x + size, z) || !this.deep(x - size, z) || !this.deep(x, z + size) || !this.deep(x, z - size)) continue;
      this.bubbles.add(x, z, now, size);
      return;
    }
  }

  /** One frame: `bubbles` and `stirs` (the same arrays every call), the live bubble count and the cues (reused lists). */
  step(i: LavaIn): { bubbles: Float32Array; stirs: Float32Array; live: number; cues: LavaCues } {
    const { dt, now, hidden } = i;
    this.input = i;
    this.enters.clear(); this.spray.clear(); this.burning.clear(); this.pops.clear();
    const frame = ++this.frameNo;
    let rings = 0;
    for (let k = 0; k < i.figs.length; k++) {
      const f = i.figs[k];
      const over = isLava(this.map.get(Math.floor(f.x), Math.floor(f.z)));
      const standing = over && !f.dashing && f.foot < LAVA_LEVEL;
      const quiet = hidden.has(f.id);
      let s = this.states.get(f.id);
      if (!s) {
        s = { standing, spray: 0, seen: frame };
        this.states.set(f.id, s);
      } else {
        if (standing && !s.standing && !quiet) this.enters.push(f.id, f.x, f.z);
        s.standing = standing || (over && f.dashing);
        s.seen = frame;
      }
      if (over && f.dashing) {
        s.spray += LAVA.sprayRate * dt;
        const n = Math.floor(s.spray);
        s.spray -= n;
        if (!quiet) for (let c = 0; c < n; c++) this.spray.push(f.id, f.x, f.z);
      } else s.spray = 0;
      if (standing && !quiet) {
        const r = this.rings[rings] ?? (this.rings[rings] = { x: 0, z: 0, s: 0, d: 0 });
        r.x = f.x; r.z = f.z;
        r.s = Math.min(1, Math.max(0, (LAVA_LEVEL - f.foot) / LAVA.ringDepth));
        r.d = (f.x - i.focus.x) ** 2 + (f.z - i.focus.z) ** 2;
        rings++;
        if (isPlayerKind(f.kind)) this.burning.push(f.id, f.x, f.z);
      }
    }
    if (this.states.size > 0) for (const [id, s] of this.states) if (s.seen !== frame) this.states.delete(id);

    // the nearest rings to the focus take the slots
    // (insertion sort of the first `rings` entries in place: no allocation, `rings` is small)
    const kept = this.rings;
    if (rings > STIR_CAP) {
      for (let a = 1; a < rings; a++) {
        const r = kept[a];
        let b = a - 1;
        for (; b >= 0 && kept[b].d > r.d; b--) kept[b + 1] = kept[b];
        kept[b + 1] = r;
      }
    }
    this.stirs.fill(0);
    for (let k = 0; k < Math.min(rings, STIR_CAP); k++) {
      const o = k * 4;
      this.stirs[o] = kept[k].x; this.stirs[o + 1] = kept[k].z; this.stirs[o + 2] = kept[k].s;
    }

    // a pool in view and seen counts its timer down; a long frame starts one bubble, not a burst
    // expired bubbles report their pop first: `add` drops them without a word
    this.bubbles.pack(now, this.packed, this.onPop);
    for (const p of this.pools) {
      if (!this.watched(p, i)) continue;
      p.timer -= dt;
      if (p.timer > 0) continue;
      p.timer = this.wait();
      this.startBubble(p, now, i);
    }
    this.result.live = this.bubbles.pack(now, this.packed, this.onPop);
    this.input = null;
    return this.result;
  }
}
