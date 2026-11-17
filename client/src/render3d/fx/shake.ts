// Camera shake (#308): for `ms` a random screen offset of up to `intensity x w` and `intensity x h` px each frame, seeded from the
// frame count (so a frozen clock shows the same picture). A new kick replaces a weaker running one only when it is stronger.
import { hash3 } from './rand';

/**
 * The ground tiles the drawn camera moves by so the picture shifts by (`dx` right, `dy` down) canvas px: the screen's right and
 * ground-down axes (turned by the yaw, the down one foreshortened by sin(pitch)) over `perTile` canvas px per tile (art px per tile x zoom).
 */
export function groundShift(pitch: number, yaw: number, dx: number, dy: number, perTile: number, out: { x: number; z: number }): void {
  const sx = dx / perTile, zr = dy / (perTile * Math.sin(pitch)), c = Math.cos(yaw), s = Math.sin(yaw);
  out.x = -(sx * c - zr * s);
  out.z = -(sx * s + zr * c);
}

export class Shake {
  private start = -1;
  private ms = 0;
  private intensity = 0;
  private frames = 0;
  private fresh = false;

  /** Starts a shake of `ms` milliseconds; the clock starts at the next `offset`. A running stronger shake is kept. */
  kick(ms: number, intensity: number): void {
    if (this.live() && intensity < this.intensity) return;
    this.ms = ms;
    this.intensity = intensity;
    this.fresh = true;
  }

  private live(): boolean {
    return this.fresh || this.start >= 0;
  }

  /** The screen offset in px at `now` (ms) for a canvas of `w` x `h`; 0 once the shake is over. */
  offset(now: number, w: number, h: number, out: { x: number; y: number }): void {
    out.x = 0;
    out.y = 0;
    if (this.fresh) {
      this.fresh = false;
      this.start = now;
    }
    if (this.start < 0) return;
    if (now - this.start >= this.ms) {
      this.start = -1;
      return;
    }
    const f = ++this.frames;
    out.x = (hash3(f, 1, 7) * 2 - 1) * this.intensity * w;
    out.y = (hash3(f, 2, 7) * 2 - 1) * this.intensity * h;
  }
}
