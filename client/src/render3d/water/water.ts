// Water in 3D (#345): what the figures do to the water of a dip. Wading, entering, dashing, drowning and the
// drips that land become ripple sources (for the surface) and cues (for the droplet effects), in tiles. Pure: no three.js, no effects.
import { CONST } from '../../generated/defs';
import { WATER_LEVEL, isWater, pondFieldOf } from '../dips/shape';
import type { TileMap } from '../../sim/map';
import type { DrawnFig } from '../fx/types';
import type { Footprint } from '../lights';
import { Fish } from '../pond/fish';
import type { PondField } from '../pond/pondField';
import type { Puddle } from '../stone/place';
import { DROP, RIPPLE_CAP, RIPPLE_LIFE, Ripples, mouthRings, puddleDrops } from './ripples';

/** Seconds between the rings of a wader, its speed (tiles/s) above which it rings, the strengths of the ripples and the rates (per second) of the cues. */
export const WADE = { every: 0.3, speed: 0.3, ring: 1, enter: 1.6, drip: 0.55, plunge: 1.6, plunges: 3, stir: 0.6, stirRate: 8, bubbleRate: 12, sprayRate: 30 } as const;
/**
 * A figure's feet in a puddle (#401): small rings (`DROP.scale`) of these strengths as it steps in and every `step` tiles it walks there
 * (by distance, not time: a puddle is crossed in a fraction of a second), within this share of the puddle's radius (the rim of a basin
 * is dry), with its foot below this height (tiles; a faller is above it).
 */
export const PUDDLE_STIR = { enter: 1.5, ring: 1, step: 0.3, within: 0.85, foot: 0.05 } as const;
/** How far (tiles) the ripples of a drowning scatter around the spot: the plunge, the stirring. */
const PLUNGE_SCATTER = 0.15, STIR_SCATTER = 0.2;

export interface WaterSpot { id: number; x: number; z: number }
export interface WaterCues { enters: WaterSpot[]; plunges: WaterSpot[]; spray: WaterSpot[]; bubbles: WaterSpot[] }
export interface WaterIn {
  dt: number;
  now: number;
  figs: readonly Pick<DrawnFig, 'id' | 'x' | 'z' | 'foot' | 'dashing'>[];
  /** The drownings that began this frame (`FigureOut.sinks`). */
  sinks: readonly WaterSpot[];
  /** The drips that reached the water this frame: (x, z) pairs. */
  landed: { count: number; pos: Float32Array } | null;
  hidden: ReadonlySet<number>;
  /** The level's puddles and the ground the screen shows (#380): drops ring the puddles in view, and feet stir them (#401). Absent: none. */
  puddles?: readonly Puddle[];
  fp?: Footprint;
}

/** `standing`: in the water last frame; a dash over water counts as in it (a figure keeps its tile during a dash), so a dash that ends in water makes no entering. */
interface FigState { x: number; z: number; standing: boolean; puddle: boolean; walked: number; ring: number; spray: number; seen: number }
interface Drown { id: number; x: number; z: number; left: number; stir: number; bubble: number }

/** A list of cues that reuses its spot objects from frame to frame. */
class Spots {
  readonly list: WaterSpot[] = [];
  private readonly pool: WaterSpot[] = [];
  clear(): void { this.list.length = 0; }
  push(id: number, x: number, z: number): void {
    const n = this.list.length;
    const s = this.pool[n] ?? (this.pool[n] = { id: 0, x: 0, z: 0 });
    s.id = id; s.x = x; s.z = z;
    this.list.push(s);
  }
}

function inPuddle(puddles: readonly Puddle[], x: number, z: number): boolean {
  for (const p of puddles) if (Math.hypot(x - p.x, z - p.z) < p.r * PUDDLE_STIR.within) return true;
  return false;
}

export class Water3d {
  private readonly ripples = new Ripples();
  private readonly packed = new Float32Array(RIPPLE_CAP * 4);
  private readonly states = new Map<number, FigState>();
  private drowns: Drown[] = [];
  private frameNo = 0;
  private readonly enters = new Spots();
  private readonly plunges = new Spots();
  private readonly spray = new Spots();
  private readonly bubbles = new Spots();
  private readonly cues: WaterCues = { enters: this.enters.list, plunges: this.plunges.list, spray: this.spray.list, bubbles: this.bubbles.list };
  /** A woodland pond's fish (#360), stepped here with the figures that stand in the water; null: the map has no pond, or the pond no deep water. */
  private readonly fish: Fish | null;
  private readonly waders = new Spots();
  private readonly result: { ripples: Float32Array; live: number; cues: WaterCues; fish: Float32Array | null } = { ripples: this.packed, live: 0, cues: this.cues, fish: null };
  /** A mouth's ring (`mouthRings`), with the frame's clock. */
  private now = 0;
  private readonly mouthRing = (x: number, z: number, at: number): void => this.ripples.addMouth(x, z, at, this.now);

  /** The clock the puddles' drops and the mouths' rings are made up to, and the ground in view this frame. */
  private dropsTo = -Infinity;
  private fp: Footprint = { x0: 0, z0: 0, x1: 0, z1: 0 };
  /** A drop rings its puddle only in view: the ripple slots are few. */
  private readonly drop = (p: Puddle, x: number, z: number, at: number): void => {
    const f = this.fp;
    if (p.x + p.r > f.x0 && p.x - p.r < f.x1 && p.z + p.r > f.z0 && p.z - p.r < f.z1) this.ripples.add(x, z, at, -DROP.strength);
  };

  /** `pond`: the map's pond field (#360), whose mouths ring and whose deep water holds fish; a map without one has neither. */
  constructor(private readonly map: TileMap, private readonly rng: () => number = Math.random, private readonly pond: PondField | undefined = pondFieldOf(map)) {
    const fish = pond ? new Fish(pond, pond.seed) : null;
    this.fish = fish && fish.count > 0 ? fish : null;
  }

  /** A ripple of `strength` at (x, z), scattered by up to `scatter` tiles. */
  private ring(x: number, z: number, now: number, strength: number, scatter: number): void {
    if (scatter > 0) {
      const a = this.rng() * Math.PI * 2, r = this.rng() * scatter;
      x += Math.cos(a) * r; z += Math.sin(a) * r;
    }
    this.ripples.add(x, z, now, strength);
  }

  /**
   * One frame: the packed ripples (the same array every call), how many are live, the cues for the effects (reused lists) and the
   * pond's fish (`Fish.positions`; null: none).
   */
  step(i: WaterIn): { ripples: Float32Array; live: number; cues: WaterCues; fish: Float32Array | null } {
    const { dt, now, hidden } = i;
    this.enters.clear(); this.plunges.clear(); this.spray.clear(); this.bubbles.clear(); this.waders.clear();
    const frame = ++this.frameNo;
    for (let k = 0; k < i.figs.length; k++) {
      const f = i.figs[k];
      const over = isWater(this.map.get(Math.floor(f.x), Math.floor(f.z)));
      const standing = over && !f.dashing && f.foot < WATER_LEVEL;
      if (standing && this.fish) this.waders.push(f.id, f.x, f.z);
      const puddle = !over && !!i.puddles && f.foot < PUDDLE_STIR.foot && inPuddle(i.puddles, f.x, f.z);
      const quiet = hidden.has(f.id);
      let s = this.states.get(f.id);
      if (!s) {
        s = { x: f.x, z: f.z, standing, puddle, walked: 0, ring: 0, spray: 0, seen: frame };
        this.states.set(f.id, s);
      } else {
        const speed = dt > 0 ? Math.hypot(f.x - s.x, f.z - s.z) / dt : 0;
        s.ring = Math.min(WADE.every, s.ring + dt);
        if (standing && !s.standing) {
          s.ring = 0;
          if (!quiet) { this.ripples.add(f.x, f.z, now, WADE.enter); this.enters.push(f.id, f.x, f.z); }
        } else if (standing && speed > WADE.speed && s.ring >= WADE.every) {
          s.ring = 0;
          if (!quiet) this.ripples.add(f.x, f.z, now, WADE.ring);
        } else if (puddle) {
          s.walked = s.puddle ? s.walked + speed * dt : PUDDLE_STIR.step;
          if (s.walked >= PUDDLE_STIR.step) {
            s.walked = 0;
            if (!quiet) this.ripples.add(f.x, f.z, now, s.puddle ? -PUDDLE_STIR.ring : -PUDDLE_STIR.enter);
          }
        }
        s.x = f.x; s.z = f.z; s.standing = standing || (over && f.dashing); s.puddle = puddle; s.seen = frame;
      }
      if (over && f.dashing) {
        s.spray += WADE.sprayRate * dt;
        const n = Math.floor(s.spray);
        s.spray -= n;
        if (!quiet) for (let c = 0; c < n; c++) this.spray.push(f.id, f.x, f.z);
      } else s.spray = 0;
    }
    if (this.states.size > 0) for (const [id, s] of this.states) if (s.seen !== frame) this.states.delete(id);

    // the drownings that began before this frame stir the water and bubble until their time is up
    let w = 0;
    for (let k = 0; k < this.drowns.length; k++) {
      const d = this.drowns[k];
      const t = Math.min(dt, d.left);
      d.left -= t;
      d.stir += WADE.stirRate * t; d.bubble += WADE.bubbleRate * t;
      const ns = Math.floor(d.stir), nb = Math.floor(d.bubble);
      d.stir -= ns; d.bubble -= nb;
      if (!hidden.has(d.id)) {
        for (let c = 0; c < ns; c++) this.ring(d.x, d.z, now, WADE.stir, STIR_SCATTER);
        for (let c = 0; c < nb; c++) this.bubbles.push(d.id, d.x, d.z);
      }
      if (d.left > 0) this.drowns[w++] = d;
    }
    this.drowns.length = w;
    for (let k = 0; k < i.sinks.length; k++) {
      const d = i.sinks[k];
      this.drowns.push({ id: d.id, x: d.x, z: d.z, left: CONST.DROWN_TIME, stir: 0, bubble: 0 });
      if (hidden.has(d.id)) continue;
      for (let c = 0; c < WADE.plunges; c++) this.ring(d.x, d.z, now, WADE.plunge, PLUNGE_SCATTER);
      this.plunges.push(d.id, d.x, d.z);
    }

    const l = i.landed;
    if (l) for (let k = 0; k < l.count; k++) this.ripples.add(l.pos[k * 2], l.pos[k * 2 + 1], now, WADE.drip);

    // The puddles' drops and the mouths' rings since the last frame; the first frame, and one after the clock went back, brings the rings that still live.
    const since = Math.max(now - RIPPLE_LIFE, this.dropsTo > now ? -Infinity : this.dropsTo);
    if (i.puddles && i.fp) {
      this.fp = i.fp;
      puddleDrops(i.puddles, since, now, this.drop);
    }
    if (this.pond && this.pond.mouths.length > 0) {
      this.now = now;
      mouthRings(this.pond.mouths, since, now, this.mouthRing);
    }
    this.dropsTo = now;

    if (this.fish) {
      this.fish.step(dt, this.waders.list);
      this.result.fish = this.fish.positions();
    }
    this.result.live = this.ripples.pack(now, this.packed);
    return this.result;
  }
}
