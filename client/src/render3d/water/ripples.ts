// Ripple sources of the water surface (#345): where a figure or an effect disturbed the water, and the
// height such a source adds. Pure TypeScript; the water shader holds a twin of rippleHeight and reads
// the array Ripples.pack fills.
import { hash } from '../stone/field';

export const RIPPLE_CAP = 16, RIPPLE_SPEED = 0.75, RIPPLE_LIFE = 3.5;
export const RIPPLE = { height: 0.022, decay: 1.2, rise: 0.15, width: 4, waves: 26 } as const;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The height a source adds at distance d (tiles) and age (s): 0 outside 0 < age < RIPPLE_LIFE, else
 *  height * strength * exp(-decay * age) * smoothstep(0, rise, age) * exp(-((d - age * RIPPLE_SPEED) * width) ** 2) * sin((d - age * RIPPLE_SPEED) * waves);
 *  for a negative strength with d / DROP.scale for d and DROP.scale * -strength for strength. */
export function rippleHeight(d: number, age: number, strength: number): number {
  if (!(age > 0 && age < RIPPLE_LIFE)) return 0;
  // A negative strength is a small ring (a puddle's drop): the same ring at `DROP.scale` of the size, so as steep and that much slower.
  const s = strength < 0 ? DROP.scale : 1;
  const u = d / s - age * RIPPLE_SPEED;
  return RIPPLE.height * s * Math.abs(strength) * Math.exp(-RIPPLE.decay * age) * smoothstep(0, RIPPLE.rise, age)
    * Math.exp(-((u * RIPPLE.width) ** 2)) * Math.sin(u * RIPPLE.waves);
}

/**
 * A puddle's drops (#380): one every `every` seconds on average, within this share of the puddle's radius from its middle; its ring has
 * this strength and `scale` of a pool ring's size (a pool's ring is as wide as a puddle).
 */
export const DROP = { every: 5, strength: 0.8, within: 0.5, scale: 0.35 } as const;

/**
 * The drops that fall into the puddles after `from` and up to `to` (s): `emit` gets the puddle, the spot (tiles) and the time. Drop n of a
 * puddle falls somewhere in the n-th span of `DROP.every` seconds; when and where comes from the puddle's place and n alone.
 */
export function puddleDrops<P extends { x: number; z: number; r: number }>(puddles: readonly P[], from: number, to: number, emit: (p: P, x: number, z: number, at: number) => void): void {
  for (const p of puddles) {
    const a = Math.round(p.x * 64), b = Math.round(p.z * 64);
    for (let n = Math.floor(from / DROP.every); n <= Math.floor(to / DROP.every); n++) {
      const at = (n + hash(n, a, b, 1)) * DROP.every;
      if (!(at > from && at <= to)) continue;
      const ang = hash(n, a, b, 2) * Math.PI * 2, d = Math.sqrt(hash(n, a, b, 3)) * p.r * DROP.within;
      emit(p, p.x + Math.cos(ang) * d, p.z + Math.sin(ang) * d, at);
    }
  }
}

export class Ripples {
  private readonly x = new Float32Array(RIPPLE_CAP);
  private readonly z = new Float32Array(RIPPLE_CAP);
  private readonly strength = new Float32Array(RIPPLE_CAP);
  /** Birth time per slot; -Infinity marks a never-used slot. */
  private readonly born = new Float64Array(RIPPLE_CAP).fill(-Infinity);

  /** A source at (x, z) tiles born at `now` (s). With RIPPLE_CAP live sources the oldest is replaced.
   *  A free or expired slot (now - born >= RIPPLE_LIFE) is reused first, so a live source is only replaced when none is left.
   *  A slot born in the future (the caller's clock went back) is free too: it would never show nor expire. */
  add(x: number, z: number, now: number, strength: number): void {
    let slot = -1, oldest = Infinity;
    for (let i = 0; i < RIPPLE_CAP; i++) {
      const age = now - this.born[i];
      if (age >= RIPPLE_LIFE || age < 0) { slot = i; break; }
      if (this.born[i] < oldest) { oldest = this.born[i]; slot = i; }
    }
    this.x[slot] = x; this.z[slot] = z; this.strength[slot] = strength; this.born[slot] = now;
  }

  /** Writes (x, z, age, strength) per slot into `out` (RIPPLE_CAP * 4); a free or expired slot has age -1. Returns the live count. */
  pack(now: number, out: Float32Array): number {
    let live = 0;
    for (let i = 0; i < RIPPLE_CAP; i++) {
      const age = now - this.born[i];
      const isLive = age >= 0 && age < RIPPLE_LIFE;
      out[i * 4] = this.x[i]; out[i * 4 + 1] = this.z[i];
      out[i * 4 + 2] = isLive ? age : -1;
      out[i * 4 + 3] = this.strength[i];
      if (isLive) live++;
    }
    return live;
  }
}
