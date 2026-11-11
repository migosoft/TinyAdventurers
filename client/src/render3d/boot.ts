// The entry points of the ?r3d pages: the demo (#301) and a real run (#302).

import type { ClassId } from '../generated/ClassId';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { Net } from '../net';
import type { Hud } from '../ui/hud';
import { createDemoStage } from './demoStage';
import { parseParams } from './params';
import { startHost, type Host } from './host';
import { createRunStage, newRun } from './runStage';

export async function bootDemo(el: HTMLElement, search: string): Promise<void> {
  const p = parseParams(search);
  await startHost(el, search, 'demo', (assets) => createDemoStage(assets, p));
}

export interface Run3d {
  stop(): void;
}

/**
 * Starts a run in the 3D view. The session exists at once, so messages are handled from `RunStarted` on; until the host's
 * loop runs it is driven by a 16 ms timer without a view. `stop()` ends the host, the session and the timer, whichever state
 * the start is in. `deps.startHost` is for tests.
 */
export function startRun3d(
  el: HTMLElement,
  search: string,
  deps: { info: RunStartInfo; net: Net; hud: Hud; myClass: ClassId; startHost?: typeof startHost },
): Run3d {
  const run = newRun(deps);
  let stopped = false;
  let host: Host | null = null;
  let timer: ReturnType<typeof setInterval> | null = setInterval(() => run.session.frame(16), 16);
  const clearTimer = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  void (deps.startHost ?? startHost)(el, search, 'run', (assets, h) => {
    host = h; // stop() reaches the host from here on, at any point of its start
    if (stopped) h.stop(); // stopped while the atlas loaded: the host disposes the stage it gets and ends
    return createRunStage(run, deps.info, assets, h, el, clearTimer);
  }).catch((e: unknown) => console.error('The 3D run could not start:', e));
  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearTimer();
      host?.stop();
      run.session.destroy();
    },
  };
}
