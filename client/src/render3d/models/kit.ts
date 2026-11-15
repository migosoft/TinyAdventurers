// The figure kit (#338): hands out 3D models, building each one off the frame (in a Web Worker) the first time it is asked for.
// `get` never throws and never blocks: until a model has arrived it returns null and the caller draws a sprite card instead.

import { buildJob, isFigureKey, isWeaponKey } from './build';
import type { FigureModel } from './model';
import { WEAPONS, type SpritePixels } from './weapons';

export interface FigureKit {
  /** The model if it is built; otherwise null, and the build is started (once). Keys: a DescKey, 'skull', or a weapon sprite name. */
  get(key: string): FigureModel | null;
  /** False for a key nothing can build (an unknown weapon): `get` stays null and one warning is logged. */
  known(key: string): boolean;
  /** Build times in ms by key, for the F3 panel and the docs. */
  readonly times: ReadonlyMap<string, number>;
  /** Bumped when a model arrives. Only the dev readout reads it (the layer asks `get` every frame). */
  readonly version: number;
  dispose(): void;
}

/** Builds one model; resolves with it and the build's own duration (not the queue wait). */
export type BuildRunner = ((job: { key: string; px: SpritePixels | null }) => Promise<FigureModel>) & {
  /** Ends the runner (a worker is terminated); what is pending is rejected. */
  dispose?(): void;
};

/** A runner that also reports how long the build took, through `times`. Plain runners are timed by the kit around the call. */
export type TimedRunner = BuildRunner & { lastMs?: Map<string, number> };

/** Builds at once, on the calling thread (tests). It is not a fallback: when the worker dies, `workerRunner` rejects every later job and the figures stay sprite cards. */
export const directRunner: TimedRunner & { lastMs: Map<string, number> } = Object.assign(
  async (job: { key: string; px: SpritePixels | null }): Promise<FigureModel> => {
    const t = performance.now();
    const m = buildJob(job.key, job.px);
    directRunner.lastMs.set(job.key, Math.max(performance.now() - t, 1e-3));
    return m;
  },
  { lastMs: new Map<string, number>() },
);

/** Builds in a module worker; the typed arrays come back transferred. One worker per runner. */
export const workerRunner = (): BuildRunner => {
  const pending = new Map<number, { ok: (m: FigureModel) => void; fail: (e: Error) => void; key: string }>();
  let next = 0, dead: Error | null = null, worker: Worker | null = null;
  /** The worker is gone or unusable: everything pending fails, and so does every later job. */
  const die = (why: string): void => {
    dead = dead ?? new Error(why);
    for (const p of pending.values()) p.fail(dead);
    pending.clear();
  };
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; model?: FigureModel; ms?: number; error?: string }>) => {
      const d = e.data, p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      if (d.model) { runner.lastMs.set(p.key, d.ms ?? 0); p.ok(d.model); } else p.fail(new Error(d.error ?? 'build failed'));
    };
    worker.onerror = (e) => die(e.message || 'the model worker failed');
    worker.onmessageerror = () => die('the model worker sent a message that could not be read');
  } catch (e) {
    die(`the model worker could not be started (${e instanceof Error ? e.message : String(e)})`);
  }
  const runner: BuildRunner & { lastMs: Map<string, number> } = Object.assign(
    (job: { key: string; px: SpritePixels | null }) => new Promise<FigureModel>((ok, fail) => {
      if (dead || !worker) { fail(dead ?? new Error('the model worker is closed')); return; }
      const id = next++;
      pending.set(id, { ok, fail, key: job.key });
      worker.postMessage({ id, key: job.key, px: job.px });
    }),
    {
      lastMs: new Map<string, number>(),
      dispose: () => { worker?.terminate(); worker = null; die('the model worker was closed'); },
    },
  );
  return runner;
};

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
  const known = (key: string): boolean => isFigureKey(key) || key === 'skull' || isWeaponKey(key);

  const start = (key: string): void => {
    started.add(key);
    let px: SpritePixels | null = null;
    if (isWeaponKey(key)) {
      try { px = pixelsOf(key); } catch (e) { warnOnce(key, `the sprite lookup failed (${e instanceof Error ? e.message : String(e)})`); return; }
      if (!WEAPONS[key].art && !px) { warnOnce(key, 'the weapon has no sprite pixels'); return; }
    }
    const t0 = performance.now();
    let job: Promise<FigureModel>;
    try { job = run({ key, px }); } catch (e) { job = Promise.reject(e); }
    job.then((m) => {
      if (disposed) return;
      const own = (run as TimedRunner).lastMs?.get(key);
      times.set(key, own ?? performance.now() - t0);
      models.set(key, m);
      version++;
    }, (e: unknown) => {
      if (!disposed) warnOnce(key, `the build failed (${e instanceof Error ? e.message : String(e)})`);
    });
  };

  return {
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
    dispose() { disposed = true; models.clear(); times.clear(); run.dispose?.(); },
  };
}
