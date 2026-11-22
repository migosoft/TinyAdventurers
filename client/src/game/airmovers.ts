// Turns positions per id into AirMovers (see airTypes.ts), with velocities from the change since the last frame.
import { FLAG, KIND } from '../generated/defs';
import type { RunFrame } from '../run/view';
import type { AirMover } from './airTypes';
import { projectileAir } from './airshots';
import { FIGURES, isHazardKind, isProjectileKind } from './anim/defs';
import { ownPredictedShot } from './world';

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

/**
 * The movers of a frame for the air, appended to `out` (cleared first) and returned: figures (the own hero
 * included), server projectiles and the own predicted shots (`f.shots`). Dead entities, torches, hazards, chests
 * and barrels give none. `tracker.begin` is called here.
 */
export function collectAirMovers(f: RunFrame, tracker: MoverTracker, myKind: number, out: AirMover[]): AirMover[] {
  out.length = 0;
  tracker.begin(f.dt);
  const add = (m: AirMover | null) => {
    if (m) out.push(m);
  };
  // Projectiles are drawn 8 px above their ground position; their air follows the drawing.
  const shotMover = (m: AirMover | null): AirMover | null => {
    if (m) m.airY = m.y - 8;
    return m;
  };
  for (const e of f.ents.values()) {
    if (e.id === f.you || e.flags & FLAG.DEAD) continue;
    if (isProjectileKind(e.kind)) {
      if (ownPredictedShot(e.extra, f.you) !== null) continue; // own shots come from f.shots
      const a = projectileAir(e.kind);
      add(shotMover(tracker.track(e.id, e.x, e.y, a.r, true, a.heat)));
    } else if (e.kind === KIND.Torch || e.kind === KIND.Crystal || isHazardKind(e.kind) || e.kind === KIND.Chest || e.kind === KIND.Barrel) {
      continue;
    } else {
      add(tracker.track(e.id, e.x, e.y, FIGURES[e.kind]?.baseR ?? 6, false, 0));
    }
  }
  if (f.own.alive) add(tracker.track(-1, f.own.x, f.own.y, FIGURES[myKind]?.baseR ?? 6, false, 0));
  for (const c of f.shots) {
    const a = projectileAir(c.kind);
    add(shotMover(tracker.track(-(100000 + c.shot), c.x, c.y, a.r, true, a.heat)));
  }
  return out;
}
