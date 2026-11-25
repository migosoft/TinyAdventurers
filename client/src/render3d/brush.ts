// Brushers (#331): the walking, visible figures that make the plants they pass wiggle. Pure; `brushOffset` is the spec of the shader.
import { FLAG } from '../generated/defs';
import type { AirMover } from '../game/airTypes';

/** All first guesses, tuned by eye. Lengths in tiles, times in seconds. */
export const BRUSH = {
  // rate 3: at 4.5 swings a second a shift of one or two art pixels read as a flicker, not a rustle; ease 0.45 lets it ring out about once.
  cap: 16, amp: 0.09, max: 0.14, margin: 0.35, soft: 0.3, rate: 3,
  lean: 0.4, // the steady part of the push (0..1): the bush bends away first, the sine rides on it
  along: 0.4, // how much of the direction is the figure's way (0: straight away from it)
  rise: 0.08, ease: 0.45, tail: 0.15,
} as const;

/** A figure that moved this frame (tiles, tiles/s). */
export interface Walker { id: number; x: number; z: number; r: number; vx: number; vz: number }
/** One push: (dx, dz) is a unit vector, `tail` is in tiles. */
export interface Brusher { x: number; z: number; reach: number; strength: number; dx: number; dz: number; tail: number }

/** The seen, walking figures among `movers`, in tiles, appended to `out` (cleared first). */
export function walkersOf(movers: readonly AirMover[], seen: (m: AirMover) => boolean, out: Walker[]): Walker[] {
  out.length = 0;
  for (const m of movers) {
    if (m.shot || m.flags & (FLAG.AIRBORNE | FLAG.INCORPOREAL) || !seen(m)) continue;
    out.push({ id: m.id, x: m.x / 16, z: m.y / 16, r: m.r / 16, vx: m.vx / 16, vz: m.vy / 16 });
  }
  return out;
}

interface Rec { id: number; x: number; z: number; r: number; dx: number; dz: number; speed: number; s: number; b: Brusher }

export class BrushTracker {
  private recs = new Map<number, Rec>();
  private out: Brusher[] = [];
  private order: Rec[] = [];

  /** One frame: ids in `walkers` push harder, the others ease out; `present` false drops an id at once. Returns the (reused) brushers. */
  step(dt: number, walkers: readonly Walker[], present: (id: number) => boolean, look: { x: number; z: number }): readonly Brusher[] {
    const walking = new Set<number>();
    for (const w of walkers) {
      walking.add(w.id);
      const speed = Math.hypot(w.vx, w.vz);
      let r = this.recs.get(w.id);
      if (!r) {
        r = { id: w.id, x: w.x, z: w.z, r: w.r, dx: 1, dz: 0, speed, s: 0, b: { x: 0, z: 0, reach: 0, strength: 0, dx: 1, dz: 0, tail: 0 } };
        this.recs.set(w.id, r);
      }
      r.x = w.x; r.z = w.z; r.r = w.r; r.speed = speed;
      if (speed > 0) { r.dx = w.vx / speed; r.dz = w.vz / speed; }
    }
    const order = this.order;
    order.length = 0;
    for (const r of this.recs.values()) {
      if (!present(r.id)) { this.recs.delete(r.id); continue; }
      if (dt > 0) r.s = Math.min(1, Math.max(0, r.s + (walking.has(r.id) ? dt / BRUSH.rise : -dt / BRUSH.ease)));
      if (r.s <= 0) { if (dt > 0) this.recs.delete(r.id); continue; }
      order.push(r);
    }
    if (order.length > BRUSH.cap) {
      const d = (r: Rec) => (r.x - look.x) ** 2 + (r.z - look.z) ** 2;
      order.sort((a, b) => d(a) - d(b)).length = BRUSH.cap;
    }
    this.out.length = 0;
    for (const r of order) {
      const b = r.b;
      b.x = r.x; b.z = r.z; b.reach = r.r + BRUSH.margin; b.strength = r.s; b.dx = r.dx; b.dz = r.dz; b.tail = BRUSH.tail * r.speed;
      this.out.push(b);
    }
    return this.out;
  }
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** The offset (tiles, x and z) of a point at (px, pz) of a plant with stiffness factor `k`, `phase` its own sway phase, at time `t`. */
export function brushOffset(px: number, pz: number, k: number, phase: number, t: number, brushers: readonly Brusher[]): [number, number] {
  let sx = 0;
  let sz = 0;
  const wave = BRUSH.lean + (1 - BRUSH.lean) * Math.sin(2 * Math.PI * BRUSH.rate * t + phase);
  for (const b of brushers) {
    const rx = px - b.x;
    const rz = pz - b.z;
    const len = Math.hypot(rx, rz);
    const d = Math.min(len, Math.hypot(px - (b.x - b.dx * b.tail), pz - (b.z - b.dz * b.tail)));
    const near = 1 - smoothstep(b.reach, b.reach + BRUSH.soft, d);
    const away = Math.max(len, 1e-4);
    let ux = (rx / away) * (1 - BRUSH.along) + b.dx * BRUSH.along;
    let uz = (rz / away) * (1 - BRUSH.along) + b.dz * BRUSH.along;
    const ul = Math.hypot(ux, uz);
    if (ul > 0) { ux /= ul; uz /= ul; } else { ux = b.dx; uz = b.dz; }
    const f = near * b.strength * wave;
    sx += ux * f;
    sz += uz * f;
  }
  const ox = sx * BRUSH.amp * k;
  const oz = sz * BRUSH.amp * k;
  const max = BRUSH.max * k;
  const l = Math.hypot(ox, oz);
  return l > max && l > 0 ? [(ox / l) * max, (oz / l) * max] : [ox, oz];
}
