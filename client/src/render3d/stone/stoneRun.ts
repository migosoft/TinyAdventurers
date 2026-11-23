// The stone paint job of a stage (#380): steps `stoneJob` each frame into the view's sheets, and hands the painted pixels to a view rebuilt after
// a lost device (the old view's sheets keep their CPU data, so nothing is painted again). A stage makes one of these beside its cover job.
import type { View, WorldInput } from '../view';
import { samePlan, type SheetPlan } from './plan';
import type { Sheets } from './sheets';
import { STONE_BUDGET_MS, stoneJob, type StoneJob } from './stoneJob';

export interface StoneRun {
  /** True once every page and face is painted (always true without stone). */
  readonly done: boolean;
  /** The job's units done of all, null while there is no job (no stone, or no view yet). */
  readonly progress: { done: number; total: number } | null;
  /** One frame: works the job for `STONE_BUDGET_MS` into the view's sheets; a null view (being rebuilt) waits. */
  frame(view: View | null, budgetMs?: number): void;
  /** A new view was built (the first one, or after a lost device): it takes over the painted pixels, or starts the job over when the layout changed. */
  built(view: View): void;
}

/** `spawn` (tiles): the job paints the chunks nearest it first. A world without stone (the woodland) gets a run that does nothing. */
export function makeStoneRun(world: WorldInput, spawn: { x: number; z: number }): StoneRun {
  const field = world.stone;
  if (!field) return { done: true, progress: null, frame: () => {}, built: () => {} };
  const map = world.map;
  let job: StoneJob | null = null; // made by the first `attach`, on the view's own plan
  /** The plan of the view that is drawing (compared by identity: a replan makes a new object). */
  let seen: SheetPlan | null = null;
  /** The view that is drawing. */
  let current: View | null = null;
  /** The last view's plan and sheets: what a rebuilt view takes over. */
  let kept: { plan: SheetPlan; sheets: Sheets } | null = null;

  const attach = (view: View): void => {
    const s = view.stone;
    if (!s) return;
    if (kept && seen === null && samePlan(kept.plan, s.plan, map)) {
      // A rebuilt view (after a lost device) with the same layout: the painted pages are copied, the job goes on.
      s.sheets.copyFrom(kept.sheets);
    } else {
      // The first view, or the layout moved (a face appeared or went): everything is painted (again), on the view's plan.
      job = stoneJob(field, map, s.plan, s.marks, spawn);
    }
    seen = s.plan;
    kept = { plan: s.plan, sheets: s.sheets };
  };

  return {
    get done(): boolean {
      return job?.done ?? false;
    },
    get progress() {
      return job?.progress ?? null;
    },
    built(view) {
      current = view;
      seen = null; // a new view: its plan is new by identity whatever its layout
      attach(view);
    },
    frame(view, budgetMs = STONE_BUDGET_MS) {
      if (!view?.stone) return;
      if (view !== current) {
        // A stage without a `built` hook: the first frame of a rebuilt view is its start.
        current = view;
        seen = null;
      }
      if (view.stone.plan !== seen) attach(view);
      if (!job || job.done) return;
      view.setStonePages(job.step(budgetMs));
    },
  };
}
