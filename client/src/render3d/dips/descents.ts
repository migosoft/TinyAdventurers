// The descents of the figures in `figures.ts` (#324): which id is falling into a chasm or drowning, and the fallers that outlived their
// entity (the server's `Died` comes while the figure is still falling). Pure bookkeeping; the pieces a faller is drawn from are the
// caller's (`P`), kept next to it. The curves are `descent.ts`.
import { stepFall, startFall, type Faller } from './descent';

/** The most detached fallers kept (the oldest go first). */
export const FALLEN_CAP = 32;
/** The longest step handed to `stepFall`: a frame longer than this is stepped in pieces. */
export const STEP_MAX = 0.05;

export type Descent =
  | { kind: 'fall'; faller: Faller; /** Out of sight: nothing is drawn any more. */ gone: boolean }
  | { kind: 'drown'; y0: number; t0: number };

interface Detached<P> { id: number; faller: Faller; parts: P }

export class Descents<P> {
  private readonly live = new Map<number, Descent>();
  private fallen: Array<Detached<P>> = [];

  get(id: number): Descent | undefined {
    return this.live.get(id);
  }

  /** The ids with a descent of their own (entities, not detached fallers). */
  ids(): number[] {
    return [...this.live.keys()];
  }

  /** A fall from (x, z) tiles and height y with the drawn speed (tiles/s): `startFall`'s slide and rim rules. */
  startFall(id: number, x: number, z: number, y: number, vx: number, vz: number): Descent & { kind: 'fall' } {
    const d: Descent & { kind: 'fall' } = { kind: 'fall', faller: startFall(x, z, y, vx, vz), gone: false };
    this.live.set(id, d);
    return d;
  }

  startDrown(id: number, y0: number, t0: number): Descent {
    const d: Descent = { kind: 'drown', y0, t0 };
    this.live.set(id, d);
    return d;
  }

  /** One frame of a fall, in pieces of at most STEP_MAX; false once the faller is out of sight. */
  advance(f: Faller, dt: number, bed: (x: number, z: number) => number): boolean {
    let alive = true;
    for (let left = dt; left > 0 && alive; left -= STEP_MAX) alive = stepFall(f, Math.min(left, STEP_MAX), bed);
    return alive;
  }

  /** The entity of `id` is gone: a falling one lives on with its drawn `parts` (unless it is out of sight); a drowning one is dropped. */
  detach(id: number, parts: P | undefined): void {
    const d = this.live.get(id);
    this.live.delete(id);
    if (d?.kind !== 'fall' || d.gone || !parts) return;
    this.fallen.push({ id, faller: d.faller, parts });
    if (this.fallen.length > FALLEN_CAP) this.fallen.shift();
  }

  /** The id's descent and any detached faller of it are gone (a climb-out). */
  end(id: number): void {
    this.live.delete(id);
    this.fallen = this.fallen.filter((d) => d.id !== id);
  }

  /** Steps every detached faller by `dt`, drops the ones out of sight and hands the rest to `draw`. */
  stepDetached(dt: number, bed: (x: number, z: number) => number, draw: (id: number, faller: Faller, parts: P) => void): void {
    this.fallen = this.fallen.filter((d) => this.advance(d.faller, dt, bed));
    for (const d of this.fallen) draw(d.id, d.faller, d.parts);
  }

  /** The things falling now: falls of present entities (not out of sight) and the detached ones. */
  get falling(): number {
    let n = this.fallen.length;
    for (const d of this.live.values()) if (d.kind === 'fall' && !d.gone) n++;
    return n;
  }

  clear(): void {
    this.live.clear();
    this.fallen = [];
  }
}
