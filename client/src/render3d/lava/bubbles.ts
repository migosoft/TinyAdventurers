// The bubbles of a lava pool (#344): a dome swells on the surface for a while, then pops. Pure bookkeeping for the shader's
// uniform slots; sizes and distances are in tiles, times in seconds.

export const BUBBLE_CAP = 6;
/** Seconds a bubble swells, then the seconds of its pop; its size range (tiles); the dome's height per size; the pop ring's reach. */
export const BUBBLE = { swell: 1.25, pop: 0.65, size: [0.2, 0.36], rise: 0.22, grow: 1.2, ring: 1.6 } as const;

function smooth(a: number, b: number, t: number): number {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/** The dome's radius at `age`: it starts at 0.4 of its size and grows to the whole. */
export function bubbleRadius(age: number, size: number): number {
  return size * (0.4 + 0.6 * smooth(0, BUBBLE.grow, age));
}

/** How far the surface rises at distance `d` from the centre: nothing outside 0 < age < swell, else a round dome that reaches 0 at its radius. */
export function bubbleRise(d: number, age: number, size: number): number {
  if (age <= 0 || age >= BUBBLE.swell) return 0;
  const r = bubbleRadius(age, size);
  return BUBBLE.rise * size * smooth(0, BUBBLE.grow, age) * Math.max(0, 1 - (d * d) / (r * r));
}

interface Bubble { x: number; z: number; born: number; size: number; popped: boolean }

export class Bubbles {
  private live: Bubble[] = [];

  /** A bubble at (x, z) born at `now`. With BUBBLE_CAP live ones it is not added; returns whether it was. */
  add(x: number, z: number, now: number, size: number): boolean {
    this.live = this.live.filter((b) => now - b.born < BUBBLE.swell + BUBBLE.pop);
    if (this.live.length >= BUBBLE_CAP) return false;
    this.live.push({ x, z, born: now, size, popped: false });
    return true;
  }

  /** Drops the live bubbles for which `keep(x, z)` is false. */
  prune(keep: (x: number, z: number) => boolean): void {
    this.live = this.live.filter((b) => keep(b.x, b.z));
  }

  /** Writes (x, z, age, size) per slot into `out` (BUBBLE_CAP * 4); a free or ended slot has age -1. Calls `popped(x, z)` once for each bubble whose age passed `swell` since the last pack. Returns the live count. */
  pack(now: number, out: Float32Array, popped?: (x: number, z: number) => void): number {
    let w = 0;
    for (let k = 0; k < this.live.length; k++) {
      const b = this.live[k];
      const age = now - b.born;
      if (age >= BUBBLE.swell && !b.popped) { b.popped = true; popped?.(b.x, b.z); }
      if (age >= BUBBLE.swell + BUBBLE.pop) continue;
      this.live[w++] = b;
    }
    this.live.length = w;
    for (let s = 0; s < BUBBLE_CAP; s++) {
      const o = s * 4;
      if (s < w) {
        const b = this.live[s];
        out[o] = b.x; out[o + 1] = b.z; out[o + 2] = now - b.born; out[o + 3] = b.size;
      } else { out[o] = 0; out[o + 1] = 0; out[o + 2] = -1; out[o + 3] = 0; }
    }
    return w;
  }
}
