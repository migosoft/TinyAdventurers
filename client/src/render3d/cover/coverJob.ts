// The cover sources run as one time-sliced job (#330): every source's prep, then every source's heights, then one unit
// per source that writes its px into the cover image and places its bushels. Replaces `groundJob` (#302).
import type { CoveInfo } from '../../generated/CoveInfo';
import type { TileMap } from '../../sim/map';
import type { GroundImage } from '../view';
import { placeBushels } from './bushels';
import { coveSource } from './cove';
import { HeightBuilder } from './heights';
import { encodeCover } from './kinds';
import { mossSource } from './moss';
import type { Bushel, BushelSpot, CoverSource } from './source';
import { woodlandSource } from './woodland';

/** RGBA per art px: rgb the colour, alpha `encodeCover(height, kind id)` (0 = no cover). */
export interface CoverImage { w: number; h: number; data: Uint8Array }
export interface CoverResult {
  image: CoverImage;
  /** The woodland's ground without its grass; null elsewhere. */
  bare: GroundImage | null;
  bushels: Bushel[];
  /** The tallest cover kind present, art px: how many sheets the layer draws. */
  sheets: number;
}

/** Milliseconds of work per frame. */
export const COVER_BUDGET_MS = 4;

export interface CoverJob {
  readonly done: boolean;
  /** Works for at most `budgetMs` (at least one unit of work); true on the call that finishes. */
  step(budgetMs: number, nowMs?: () => number): boolean;
  /** null until `done`. */
  result(): CoverResult | null;
}

/** Map px rows per unit that writes a source's px into the image. */
const WRITE_ROWS = 16;

export function coverJob(sources: readonly CoverSource[], seed: number): CoverJob {
  const w = sources.length ? sources[0].w : 1, h = sources.length ? sources[0].h : 1;
  const image: CoverImage = { w, h, data: new Uint8Array(w * h * 4) };
  const bushels: Bushel[] = [];
  const units: (() => void)[] = [];
  for (const s of sources) units.push(...s.prep);
  const builders = sources.map((s, i) => {
    const b = new HeightBuilder(s.grow, s.allow, s.w, s.h, s.kind, seed + i * 101);
    units.push(...b.units);
    return b;
  });
  // later sources win where they have height; the write goes in bands of rows so a frame does not stall
  sources.forEach((s, i) => {
    for (let z0 = 0; z0 < s.h; z0 += WRITE_ROWS) units.push(() => {
      const heights = builders[i].heights, { data } = image, p1 = Math.min(s.h, z0 + WRITE_ROWS) * s.w;
      for (let p = z0 * s.w; p < p1; p++) {
        if (!heights[p]) continue;
        data[p * 4] = s.colour[p * 4]; data[p * 4 + 1] = s.colour[p * 4 + 1]; data[p * 4 + 2] = s.colour[p * 4 + 2];
        data[p * 4 + 3] = encodeCover(heights[p], s.kind.id);
      }
    });
    if (s.kind.bushels) {
      const look = s.kind.bushels;
      units.push(() => { bushels.push(...placeBushels(builders[i].heights, s.w, s.h, look, seed + i * 101 + 50, s.density, s.spots)); });
    }
  });
  const bare = sources.find((s) => s.bare)?.bare?.image ?? null;
  const sheets = sources.reduce((m, s) => Math.max(m, s.kind.maxH), 0);
  const total = units.length;
  let next = 0, finished = false, kept: CoverResult | null = null;
  /** The run keeps the job for rebuilds after a lost device: once the last unit has run, only the result stays alive. */
  const finish = (): void => {
    finished = true;
    kept = { image, bare, bushels, sheets };
    units.length = 0;
    builders.length = 0;
  };
  if (total === 0) finish();
  return {
    get done(): boolean {
      return finished;
    },
    step(budgetMs: number, nowMs: () => number = () => performance.now()): boolean {
      if (finished) return false;
      const t0 = nowMs();
      do {
        units[next++]();
      } while (next < total && nowMs() - t0 < budgetMs);
      if (next < total) return false;
      finish();
      return true;
    },
    result(): CoverResult | null {
      return kept;
    },
  };
}

/** The cover sources of a run: the woodland's grass, or a dungeon's moss and then the cove's grass (the cove wins where both have height). */
export function coverSources(
  map: TileMap,
  info: { woodland: { seed: number } | null; cove: CoveInfo | null; spawnRow: number; /** The cove's bushel spots (`Cove3d.bushelSpots()`). */ spots: BushelSpot[] },
  opts?: { everywhere?: boolean },
): CoverSource[] {
  if (info.woodland) return [woodlandSource(map, info.woodland.seed, info.spawnRow)];
  const out: CoverSource[] = [];
  const moss = mossSource(map, info.cove, opts);
  if (moss) out.push(moss);
  if (info.cove) out.push(coveSource(map, info.cove, info.spots));
  return out;
}

