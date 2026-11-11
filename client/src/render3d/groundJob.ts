// The woodland's ground painted in time slices (#302): the bands in the order nearest the spawn first, then the blades and
// the flowers, the same pieces and order as `paintGround`, so the finished image is the same bytes.
import { GroundPainter } from '../game/woodland/ground';
import { bandOrder } from '../game/woodland/settle';
import type { TileMap } from '../sim/map';
import type { GroundImage } from './view';

/** Milliseconds of painting per frame. */
export const GROUND_BUDGET_MS = 4;

export interface GroundJob {
  readonly done: boolean;
  /** Works for at most `budgetMs` (at least one unit of work); true on the call that finishes. */
  step(budgetMs: number, nowMs?: () => number): boolean;
  /** The image painted so far; the whole ground once `done`. */
  image(): GroundImage;
}

export function groundJob(map: TileMap, seed: number, spawnRow: number): GroundJob {
  const painter = new GroundPainter(map, seed);
  const units: (() => void)[] = bandOrder(painter.rows, spawnRow).map((ty) => () => painter.band(ty));
  units.push(() => painter.blades(), () => painter.flowers());
  let next = 0;
  return {
    get done(): boolean {
      return next >= units.length;
    },
    step(budgetMs: number, nowMs: () => number = () => performance.now()): boolean {
      if (next >= units.length) return false;
      const t0 = nowMs();
      do {
        units[next++]();
      } while (next < units.length && nowMs() - t0 < budgetMs);
      return next >= units.length;
    },
    image(): GroundImage {
      return { w: painter.w, h: painter.h, data: painter.data };
    },
  };
}
