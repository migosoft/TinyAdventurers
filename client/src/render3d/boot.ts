// The entry points of the ?r3d pages: the demo (#301) and a real run (#302).

import type { ClassId } from '../generated/ClassId';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { ServerMsg } from '../generated/ServerMsg';
import type { Net } from '../net';
import type { Hud } from '../ui/hud';
import { createDemoStage } from './demoStage';
import { createGalleryStage } from './galleryStage';
import { createLightsStage } from './lightsStage';
import { parseParams } from './params';
import { clearErrors, startHost, type Host } from './host';
import { createRunStage, newRun } from './runStage';
import { createWoodlandStage } from './woodlandStage';

export async function bootDemo(el: HTMLElement, search: string): Promise<void> {
  const p = parseParams(search);
  await startHost(el, search, 'demo', (assets) => createDemoStage(assets, p));
}

/** `?r3d=gallery` (#303): every figure kind and state, the world objects and a corridor behind a wall, no server needed. */
export async function bootGallery(el: HTMLElement, search: string): Promise<void> {
  // The stage is wide: unless the URL picks a zoom, the picture is twice the pixel size, not the auto zoom's 4.
  const s = new URLSearchParams(search).has('zoom') ? search : `${search}&zoom=2`;
  const p = parseParams(s);
  await startHost(el, s, 'demo', (assets) => createGalleryStage(assets, p, s));
}

/** `?r3d=lights` (#304): the 2D `?lights` demo's board and lights in 3D, no server needed. Zoom 2 unless the URL picks one. */
export async function bootLights(el: HTMLElement, search: string): Promise<void> {
  const s = new URLSearchParams(search).has('zoom') ? search : `${search}&zoom=2`;
  const p = parseParams(s);
  await startHost(el, s, 'demo', (assets, host) => createLightsStage(assets, p, s, host));
}

/** `?r3d=woodland` (#306): a forest road under the sun and sky of the time of day, no server needed. Zoom 2 unless the URL picks one. */
export async function bootWoodland(el: HTMLElement, search: string): Promise<void> {
  const s = new URLSearchParams(search).has('zoom') ? search : `${search}&zoom=2`;
  const p = parseParams(s);
  await startHost(el, s, 'demo', (assets, host) => createWoodlandStage(assets, p, s, host));
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
  deps: { info: RunStartInfo; net: Net; hud: Hud; myClass: ClassId; early?: ServerMsg[]; startHost?: typeof startHost },
): Run3d {
  const run = newRun(deps);
  // Messages that came while this chunk loaded, replayed before any later one can arrive.
  for (const m of deps.early ?? []) run.session.receive(m);
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
      clearErrors(el); // a host that failed to start left its error box
      run.session.destroy();
      deps.hud.setToggles([]); // the log is gone with the session
    },
  };
}
