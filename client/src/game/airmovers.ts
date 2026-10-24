// Turns positions per id into AirMovers (see mood.ts), with velocities from the change since the last frame.
import type { AirMover } from './mood';

/** A step longer than this in one frame is a teleport or a respawn, not a walk. */
const JUMP = 48;
/** Speeds are clamped to this many px/s. */
const MAX_SPEED = 400;

export class MoverTracker {
  // Position records are mutated in place, so a frame allocates none for ids seen before.
  private prev = new Map<number, { x: number; y: number }>();
  private cur = new Map<number, { x: number; y: number }>();
  private dt = 0;

  /** Starts a frame: ids not given again before the next `begin` are forgotten. */
  begin(dt: number): void {
    const old = this.prev;
    this.prev = this.cur;
    this.cur = old;
    this.cur.clear();
    this.dt = dt;
  }

  /** The mover for this id at (x, y), or null on its first frame, when it stood still, or when it jumped more than JUMP px. */
  track(id: number, x: number, y: number, r: number, shot: boolean, heat: number): AirMover | null {
    const o = this.prev.get(id);
    let c = this.cur.get(id);
    if (!c) {
      c = o ?? { x, y }; // shared with `prev` until the next `begin` clears that map
      this.cur.set(id, c);
    }
    const px = o ? o.x : x;
    const py = o ? o.y : y;
    c.x = x;
    c.y = y;
    if (!o || this.dt <= 0) return null;
    const dx = x - px;
    const dy = y - py;
    const d = Math.hypot(dx, dy);
    if (d === 0 || d > JUMP) return null;
    const k = Math.min(1, MAX_SPEED / (d / this.dt));
    return { x, y, vx: (dx / this.dt) * k, vy: (dy / this.dt) * k, r, shot, heat };
  }
}
