// The brushers of a dev page (#331): the figures whose position changed since the last frame are the walkers.
import { FIGURES } from '../game/anim/defs';
import type { EntState } from '../game/world';
import { BrushTracker, type Brusher, type Walker } from './brush';

export class StageBrush {
  private readonly tracker = new BrushTracker();
  private readonly last = new Map<number, { x: number; z: number }>();
  private readonly walkers: Walker[] = [];

  /** One frame of `dt` seconds over `ents`; with `dt` 0 (a pinned clock) nobody walks and the brushers hold. */
  step(dt: number, ents: readonly EntState[], look: { x: number; z: number }): readonly Brusher[] {
    this.walkers.length = 0;
    for (const e of ents) {
      const x = e.x / 16, z = e.y / 16, p = this.last.get(e.id);
      if (p && dt > 0 && (x !== p.x || z !== p.z)) this.walkers.push({ id: e.id, x, z, r: (FIGURES[e.kind]?.baseR ?? 6) / 16, vx: (x - p.x) / dt, vz: (z - p.z) / dt });
      this.last.set(e.id, { x, z });
    }
    return this.tracker.step(dt, this.walkers, () => true, look);
  }
}
