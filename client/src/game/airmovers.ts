// Turns positions per id into AirMovers (see mood.ts), with velocities from the change since the last frame.
import type { AirMover } from './mood';

/** A step longer than this in one frame is a teleport or a respawn, not a walk. */
const JUMP = 48;
/** Speeds are clamped to this many px/s. */
const MAX_SPEED = 400;

export class MoverTracker {
  private prev = new Map<number, [number, number]>();
  private cur = new Map<number, [number, number]>();
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
    this.cur.set(id, [x, y]);
    const o = this.prev.get(id);
    if (!o || this.dt <= 0) return null;
    const dx = x - o[0];
    const dy = y - o[1];
    const d = Math.hypot(dx, dy);
    if (d === 0 || d > JUMP) return null;
    const k = Math.min(1, MAX_SPEED / (d / this.dt));
    return { x, y, vx: (dx / this.dt) * k, vy: (dy / this.dt) * k, r, shot, heat };
  }
}
