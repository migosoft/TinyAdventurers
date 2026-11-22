// The stone paint job (#380 part 3): the whole map painted in small units, nearest the spawn first, a few milliseconds per frame, as the
// woodland's ground job does. A unit is 32 px rows of one ground page, or a few faces of one chunk. Pure: no three.
import type { TileMap } from '../../sim/map';
import { PAGE, FACE_H, FACE_W } from './format';
import { CHUNK, chunkGrid } from './grid';
import { STONE_PX, type StoneField } from './field';
import { paintDone, paintFace, paintGroundRows } from './paint';
import type { Marks } from './place';
import type { FaceSlot, SheetPlan } from './plan';

/** Milliseconds of stone work per frame. */
export const STONE_BUDGET_MS = 4;
/** Wall faces painted in one unit: a face of masonry takes about 0.3 ms, so a unit stays inside the budget. */
const FACES_PER_UNIT = 8;

export interface StoneJobResult { pages: { layer: number; px: Uint8Array }[]; faces: { slot: FaceSlot; px: Uint8Array }[] }

export interface StoneJob {
  readonly done: boolean;
  /** The units finished of all (the F3 line). */
  readonly progress: { done: number; total: number };
  /** Works for at most `budgetMs` (at least one unit); returns the pages and faces finished in this call. */
  step(budgetMs: number, nowMs?: () => number): StoneJobResult;
}

/** Units: 32 px rows of a ground page, and `FACES_PER_UNIT` of a chunk's faces; chunks ordered by distance to `spawn` (tiles). */
export function stoneJob(f: StoneField, map: TileMap, plan: SheetPlan, marks: Marks, spawn: { x: number; z: number }): StoneJob {
  const { nx, nz } = chunkGrid(map);
  const order: [number, number][] = [];
  for (let cz = 0; cz < nz; cz++) for (let cx = 0; cx < nx; cx++) order.push([cx, cz]);
  const dist = ([cx, cz]: [number, number]): number => Math.hypot(cx * CHUNK + CHUNK / 2 - spawn.x, cz * CHUNK + CHUNK / 2 - spawn.z);
  order.sort((a, b) => dist(a) - dist(b) || a[1] - b[1] || a[0] - b[0]);

  const out: StoneJobResult = { pages: [], faces: [] };
  const units: (() => void)[] = [];
  const rows = PAGE / STONE_PX;
  for (const [cx, cz] of order) {
    const layer = plan.groundOf(cx, cz);
    if (layer >= 0) {
      let page: Uint8Array | null = null;
      for (let r = 0; r < rows; r++) {
        units.push(() => {
          page ??= new Uint8Array(PAGE * PAGE * 4);
          paintGroundRows(f, map, marks, cx, cz, r * STONE_PX, (r + 1) * STONE_PX, page);
          if (r === rows - 1) {
            out.pages.push({ layer, px: page });
            page = null;
          }
        });
      }
    }
    const faces = plan.facesOf(cx, cz);
    for (let i = 0; i < faces.length; i += FACES_PER_UNIT) {
      units.push(() => {
        for (const face of faces.slice(i, i + FACES_PER_UNIT)) {
          const px = new Uint8Array(FACE_W * FACE_H * 4);
          paintFace(f, map, marks, face, px);
          out.faces.push({ slot: plan.slotOf(face), px });
        }
      });
    }
  }
  const total = units.length;
  let next = 0, finished = total === 0;
  return {
    get progress() {
      return { done: next, total };
    },
    get done(): boolean {
      return finished;
    },
    step(budgetMs: number, nowMs: () => number = () => performance.now()): StoneJobResult {
      const res: StoneJobResult = { pages: [], faces: [] };
      if (finished) return res;
      const t0 = nowMs();
      do {
        units[next++]();
      } while (next < units.length && nowMs() - t0 < budgetMs);
      res.pages = out.pages.splice(0);
      res.faces = out.faces.splice(0);
      if (next >= units.length) {
        finished = true;
        units.length = 0; // the closures hold the painter's inputs
        paintDone();
      }
      return res;
    },
  };
}
