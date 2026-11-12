import { wrapYaw } from './params';

/** One Z or C press, degrees. */
export const TURN_STEP = 45;
/** How long a turn takes, seconds. */
export const TURN_SECS = 0.2;
/** Degrees of yaw per CSS pixel of a middle-mouse drag. */
export const DRAG_DEG_PER_PX = 0.4;

const easeOutCubic = (u: number) => 1 - (1 - u) ** 3;

/**
 * The camera's turn state: eased 45 degree steps, north, and a drag that snaps on release.
 * Internally the angle is unwrapped (it may pass 180 while a turn runs); `shown` is wrapped.
 * Positive yaw moves the camera to the west of a north-facing view ("walks around to the left").
 */
export class CamTurn {
  private cur: number; // unwrapped angle drawn now
  private from: number;
  private target: number;
  private elapsed = TURN_SECS; // >= TURN_SECS means no ease is running
  private drag_ = false;

  constructor(yawDeg = 0) {
    this.cur = this.from = this.target = wrapYaw(yawDeg);
  }

  get shown(): number {
    return wrapYaw(this.cur);
  }

  get dragging(): boolean {
    return this.drag_;
  }

  /** Z = +1, C = -1: 45 degrees from where the running turn is heading. */
  step(dir: 1 | -1): void {
    if (this.drag_) return;
    this.ease(this.target + dir * TURN_STEP);
  }

  /** Eases to yaw 0 the short way. */
  north(): void {
    if (this.drag_) return;
    this.ease(360 * Math.round(this.cur / 360));
  }

  /** Jumps, no ease. */
  set(yawDeg: number): void {
    this.cur = this.from = this.target = wrapYaw(yawDeg);
    this.elapsed = TURN_SECS;
  }

  dragStart(): void {
    this.drag_ = true;
    this.target = this.from = this.cur;
    this.elapsed = TURN_SECS;
  }

  drag(dxCssPx: number): void {
    if (!this.drag_) return;
    this.cur += dxCssPx * DRAG_DEG_PER_PX;
    this.target = this.from = this.cur;
  }

  /** Releases the drag and eases to the nearest multiple of 45 (the short way). */
  dragEnd(): void {
    if (!this.drag_) return;
    this.drag_ = false;
    this.ease(TURN_STEP * Math.round(this.cur / TURN_STEP));
  }

  update(dt: number): void {
    if (this.drag_ || this.elapsed >= TURN_SECS) return;
    this.elapsed += dt;
    if (this.elapsed >= TURN_SECS) {
      // Done: land exactly and renormalise so the angle never grows.
      this.cur = this.from = this.target = wrapYaw(this.target);
      this.elapsed = TURN_SECS;
      return;
    }
    this.cur = this.from + (this.target - this.from) * easeOutCubic(this.elapsed / TURN_SECS);
  }

  /** Starts an ease from the angle shown now toward `target`. */
  private ease(target: number): void {
    this.from = this.cur;
    this.target = target;
    this.elapsed = 0;
  }
}
