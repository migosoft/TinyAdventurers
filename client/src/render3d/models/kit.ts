// The figure kit (#338): hands out 3D models, building each one off the frame (in a Web Worker) the first time it is asked for.
// `get` never throws and never blocks: until a model has arrived it returns null and the caller draws a sprite card instead.

import { FIGURES, type FigureDef } from '../../game/anim/defs';
import { boundsOfPixels } from '../atlasBounds';
import { buildJob, isFigureKey, isPictureKey, isTubeKey, isWeaponKey, paintJob } from './build';
import type { FigureModel } from './model';
import type { PaintImage } from './paint';
import { FIT_KIND } from './table';
import { WEAPONS, type SpritePixels } from './weapons';

export interface FigureKit {
  /** The model if it is built; otherwise null, and the build is started (once). Keys: a ModelKey, 'skull', or a weapon sprite name. */
  get(key: string): FigureModel | null;
  /** False for a key nothing can build (an unknown weapon): `get` stays null and one warning is logged. */
  known(key: string): boolean;
  /** A painted picture if it is ready; otherwise null, and the painting is started (once), off the frame. Keys: `PICTURES` in build.ts. */
  picture(key: string): PaintImage | null;
  /** Build times in ms by key, for the F3 panel and the docs. */
  readonly times: ReadonlyMap<string, number>;
  /** Bumped when a model or a picture arrives. Only the dev readout reads it (the layer asks `get` every frame). */
  readonly version: number;
  dispose(): void;
}

/** Builds one model, or paints one picture when `job.picture` is set (#358); resolves with it, the duration being the job's own (not the queue wait). */
export type BuildJob = {
  key: string;
  px: SpritePixels | null;
  /** A figure key only: the standing height (sprite px) of the card the model replaces; null when its sprite is unknown. */
  height?: number | null;
  /** A picture job (#358): `key` is a `PICTURES` key and the result is a `PaintImage`, not a model. */
  picture?: boolean;
};
export type BuildRunner = ((job: BuildJob) => Promise<FigureModel | PaintImage>) & {
  /** Ends the runner (a worker is terminated); what is pending is rejected. */
  dispose?(): void;
};

/** A runner that also reports how long the build took, through `times`. Plain runners are timed by the kit around the call. */
export type TimedRunner = BuildRunner & { lastMs?: Map<string, number> };

/** Builds at once, on the calling thread (tests). It is not a fallback: when the worker dies, `workerRunner` rejects every later job and the figures stay sprite cards. */
export const directRunner: TimedRunner & { lastMs: Map<string, number> } = Object.assign(
  async (job: BuildJob): Promise<FigureModel | PaintImage> => {
    const t = performance.now();
    const m = job.picture ? paintJob(job.key) : buildJob(job.key, job.px, job.height);
    directRunner.lastMs.set(job.key, Math.max(performance.now() - t, 1e-3));
    return m;
  },
  { lastMs: new Map<string, number>() },
);

/** Builds in a module worker; the typed arrays come back transferred. One worker per runner. */
export const workerRunner = (): BuildRunner => {
  const pending = new Map<number, { ok: (m: FigureModel | PaintImage) => void; fail: (e: Error) => void; key: string }>();
  let next = 0, dead: Error | null = null, worker: Worker | null = null;
  /** The worker is gone or unusable: everything pending fails, and so does every later job. */
  const die = (why: string): void => {
    dead = dead ?? new Error(why);
    for (const p of pending.values()) p.fail(dead);
    pending.clear();
  };
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; model?: FigureModel; image?: PaintImage; ms?: number; error?: string }>) => {
      const d = e.data, p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      const made = d.model ?? d.image;
      if (made) { runner.lastMs.set(p.key, d.ms ?? 0); p.ok(made); } else p.fail(new Error(d.error ?? 'build failed'));
    };
    worker.onerror = (e) => die(e.message || 'the model worker failed');
    worker.onmessageerror = () => die('the model worker sent a message that could not be read');
  } catch (e) {
    die(`the model worker could not be started (${e instanceof Error ? e.message : String(e)})`);
  }
  const runner: BuildRunner & { lastMs: Map<string, number> } = Object.assign(
    (job: BuildJob) => new Promise<FigureModel | PaintImage>((ok, fail) => {
      if (dead || !worker) { fail(dead ?? new Error('the model worker is closed')); return; }
      const id = next++;
      pending.set(id, { ok, fail, key: job.key });
      worker.postMessage({ id, key: job.key, px: job.px, height: job.height ?? null, picture: job.picture === true });
    }),
    {
      lastMs: new Map<string, number>(),
      dispose: () => { worker?.terminate(); worker = null; die('the model worker was closed'); },
    },
  );
  return runner;
};

/**
 * The height a standing figure's card shows, in sprite px: from the highest opaque row of its idle frame to the foot row
 * (`FigureDef.footY`, else the frame's bottom), times the game's `FigureDef.scale`. A fully transparent frame counts as fully opaque
 * (the rule of `boundsOfPixels`, which does the reading). Null when the height would not be positive (a foot row at or above the top).
 */
export function cardHeight(d: Pick<FigureDef, 'footY' | 'scale'>, px: SpritePixels): number | null {
  const b = boundsOfPixels(px.data, px.w, { x: 0, y: 0, w: px.w, h: px.h });
  const height = ((d.footY ?? b.h) - b.t) * (d.scale ?? 1);
  return height > 0 ? height : null;
}

export function createKit(sprite: (name: string) => SpritePixels | null, run: BuildRunner = directRunner): FigureKit {
  const models = new Map<string, FigureModel>();
  const times = new Map<string, number>();
  const started = new Set<string>();
  const warned = new Set<string>();
  let version = 0, disposed = false;

  const warnOnce = (key: string, why: string): void => {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`3D model ${key}: ${why}`);
  };
  const pixelsOf = (key: string): SpritePixels | null => (isWeaponKey(key) && !WEAPONS[key].art ? sprite(key) : null);
  const known = (key: string): boolean => isFigureKey(key) || isTubeKey(key) || key === 'skull' || isWeaponKey(key);

  const start = (key: string): void => {
    started.add(key);
    let px: SpritePixels | null = null;
    if (isWeaponKey(key)) {
      try { px = pixelsOf(key); } catch (e) { warnOnce(key, `the sprite lookup failed (${e instanceof Error ? e.message : String(e)})`); return; }
      if (!WEAPONS[key].art && !px) { warnOnce(key, 'the weapon has no sprite pixels'); return; }
    }
    let height: number | null = null;
    if (isFigureKey(key)) {
      // The card this model replaces: the idle frame of the kind the description is fitted to. An unknown sprite builds at scale 1.
      try {
        const def = FIGURES[FIT_KIND[key]], card = def ? sprite(`${def.idle}0`) : null;
        if (def && card) height = cardHeight(def, card);
      } catch (e) { warnOnce(key, `the card sprite lookup failed (${e instanceof Error ? e.message : String(e)})`); }
    }
    const t0 = performance.now();
    let job: Promise<FigureModel | PaintImage>;
    try { job = run({ key, px, height }); } catch (e) { job = Promise.reject(e); }
    job.then((m) => {
      if (disposed) return;
      const own = (run as TimedRunner).lastMs?.get(key);
      times.set(key, own ?? performance.now() - t0);
      models.set(key, m as FigureModel);
      version++;
    }, (e: unknown) => {
      if (!disposed) warnOnce(key, `the build failed (${e instanceof Error ? e.message : String(e)})`);
    });
  };

  const pictures = new Map<string, PaintImage>();
  const picturesStarted = new Set<string>();
  const startPicture = (key: string): void => {
    picturesStarted.add(key);
    let job: Promise<FigureModel | PaintImage>;
    try { job = run({ key, px: null, picture: true }); } catch (e) { job = Promise.reject(e); }
    const t0 = performance.now();
    job.then((img) => {
      if (disposed) return;
      times.set(key, (run as TimedRunner).lastMs?.get(key) ?? performance.now() - t0);
      pictures.set(key, img as PaintImage);
      version++;
    }, (e: unknown) => {
      if (!disposed) warnOnce(key, `the painting failed (${e instanceof Error ? e.message : String(e)})`);
    });
  };

  return {
    picture(key) {
      const p = pictures.get(key);
      if (p) return p;
      if (disposed || picturesStarted.has(key)) return null;
      if (!isPictureKey(key)) { picturesStarted.add(key); warnOnce(key, 'no such picture'); return null; }
      startPicture(key);
      return null;
    },
    get(key) {
      const m = models.get(key);
      if (m) return m;
      if (disposed || started.has(key)) return null;
      if (!known(key)) { started.add(key); warnOnce(key, 'no such model'); return null; }
      start(key);
      return null;
    },
    known,
    times,
    get version() { return version; },
    dispose() { disposed = true; models.clear(); pictures.clear(); times.clear(); run.dispose?.(); },
  };
}
