// The shared core of the ?r3d pages: the canvas, the atlas, the view and its recovery after a lost device, the panel,
// the params' single path, the F3 readout and the frame loop. A Stage is what is drawn (the demo scene, a run).

import { loadAtlas } from '../ui/atlas';
import { FrameTimer } from '../game/frameTimer';
import { createPanel } from './panel';
import { DEFAULTS, parseParams, toSearch, type R3dParams } from './params';
import { R3D_SYSTEMS, lightLines, statsText3d, type R3dSystem } from './stats';
import { pickZoom, renderPlan, type RenderPlan } from './quality';
import { frameDt } from './scene';
import { createRecovery, type Recovery } from './recover';
import { trailingWriter } from './urlWriter';
import { createView, RendererInitError, type Assets, type View, type WorldInput } from './view';
import type { FrameRects } from './worldMesh';
import './r3d.css';

declare global {
  interface Window {
    __r3d?: {
      backend: string; frames: number; renderSize: [number, number]; zoom: number; forceLoss?: () => boolean;
      /** A run's stage adds these: the own hero and the camera target (tiles), the view's chunk meshes and the figures drawn last frame. */
      hero?: { x: number; z: number }; cam?: { x: number; z: number }; chunks?: { total: number; drawn: number }; figures?: number;
      /** ... and the camera's yaw in whole degrees (-180..180) and the items the overlay painted last frame. */
      yaw?: number; overlay?: number;
      /** ... and the lights in use of those that reach the screen, and the shadow cards (#304). */
      lights?: { list: number; inView: number }; casters?: number;
    };
  }
}

export interface StageCtx {
  now: number; dt: number; params: R3dParams;
  /** KeyboardEvent.code of the held movement keys. */
  held: ReadonlySet<string>;
  canvas: { w: number; h: number }; zoom: number; plan: RenderPlan;
  /** The current canvas element (a rebuild after a lost device replaces it). */
  canvasEl: HTMLCanvasElement;
  /** Null while the device is being restored. */
  view: View | null;
  timer: FrameTimer<R3dSystem>;
}

export interface Stage {
  /** Read at the first build and at every rebuild. */
  readonly world: WorldInput;
  /** After the first build and after every rebuild (upload what the view lost). */
  built?(view: View): void;
  /** One frame: steps the stage and, when `c.view` is set, draws through it. Returns the draw calls. */
  frame(c: StageCtx): number;
  /** A key the host does not handle itself; true when the stage used it (the host then prevents the default). */
  key?(e: KeyboardEvent): boolean;
  /** F3: true when the stage shows its own panel (then the host's readout stays hidden). */
  stats?(): boolean;
  dispose(): void;
}

export interface Host {
  readonly params: R3dParams;
  setParams(p: R3dParams): void;
  /** A run's camera turned: the yaw in `params` and the panel, not in the address bar. */
  setRunYaw(deg: number): void;
  /** Shows the panel's mist rows (daylight maps); a run calls it once it knows the map. */
  setDaylight(on: boolean): void;
  stop(): void;
}

/** The movement keys the host tracks in `held`. */
export const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

export interface HostDeps {
  createView: typeof createView;
  loadAtlas: () => Promise<{ img: HTMLImageElement; frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> }>;
}

export function showError(host: HTMLElement, text: string, fixed: boolean): HTMLElement {
  const d = document.createElement('div');
  d.className = 'r3d-error';
  d.textContent = fixed ? `This page needs WebGPU or WebGL2, which this browser does not offer. ${text}` : text;
  host.appendChild(d);
  console.error(d.textContent);
  return d;
}

/** Removes the error boxes `showError` put in the element (the element is reused for every run). */
export function clearErrors(host: HTMLElement): void {
  for (const d of Array.from(host.children)) if (d.classList.contains('r3d-error')) d.remove();
}

export const isTextTarget = (t: EventTarget | null): boolean =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

/**
 * Null when it showed an error or was stopped during the start. Error boxes are the element's: a host removes those of
 * earlier hosts when it starts and its own in `stop()`; a host that failed leaves its box up (the player reads it), and the
 * caller clears it with `clearErrors`. `makeStage` runs once the atlas is loaded. Everything the
 * host adds is created before the first await, so `stop()` (also through the Host given to `makeStage`) is safe at any
 * point. A `makeStage` or first `built` that throws leaves nothing behind and the error is rethrown.
 */
export async function startHost(
  el: HTMLElement, search: string, mode: 'demo' | 'run', makeStage: (assets: Assets, host: Host) => Stage,
  deps: HostDeps = { createView, loadAtlas },
): Promise<Host | null> {
  clearErrors(el);
  const initial = parseParams(search);
  let params = initial;
  let canvas = document.createElement('canvas');
  canvas.className = 'r3d';
  el.appendChild(canvas);

  let view: View | null = null;
  let stage: Stage | null = null;
  let assets: Assets | null = null;
  let stopped = false;
  // The view being replaced is disposed once, even when the rebuild is retried.
  let viewLive = false;
  // Each view reports its loss through the generation it was made in; a report from an older one is ignored.
  let gen = 0;
  // Until the host has set everything up the rebuild has nothing to write to: a loss then only sets a flag, and the start
  // runs the recovery at its end.
  let booted = false;
  let lostEarly = false;
  let cw = 0;
  let ch = 0;
  let readout = '';
  let backendName = '';
  let raf = 0;
  const state: NonNullable<Window['__r3d']> = {
    backend: '',
    frames: 0,
    renderSize: [0, 0],
    zoom: 0,
    forceLoss: (): boolean => view?.forceLoss() ?? false,
  };
  const lostFrom = (g: number) => (message: string): void => {
    if (g !== gen || stopped) return;
    console.warn(`Graphics device lost: ${message}`);
    if (booted) recovery.lost();
    else lostEarly = true;
  };

  async function rebuild(): Promise<void> {
    if (stopped) return;
    const g = ++gen;
    if (viewLive && view) {
      viewLive = false;
      const old = view;
      view = null;
      try {
        old.dispose();
      } catch (e) {
        console.warn('Disposing the lost view failed:', e);
      }
    }
    // A fresh canvas every attempt: the old one may hold a dead context. It takes the old one's place in the DOM.
    const next = document.createElement('canvas');
    next.className = 'r3d';
    canvas.replaceWith(next);
    canvas = next;
    const v = await deps.createView(next, assets!, stage!.world, { forceWebGL: initial.backend === 'webgl' }, lostFrom(g));
    if (stopped) {
      v.dispose(); // stop() came while the view was being made
      return;
    }
    view = v;
    viewLive = true;
    cw = 0; // setSize again for the current canvas size
    ch = 0;
    backendName = v.backend;
    state.backend = backendName;
    readout = '';
    stage!.built?.(v);
  }
  const recovery: Recovery = createRecovery(rebuild);

  // The one path of every params change (the panel, F3, the stage): it keeps `params`, the panel's copy, the address bar and
  // what follows `params.stats` (the readout's visibility, the timer) in step.
  const writeUrl = trailingWriter((s) => history.replaceState(null, '', s));
  const apply = (next: R3dParams): void => {
    params = next;
    panel.setParams(next);
    // A run always starts facing north, so its yaw never goes into the address.
    writeUrl(toSearch(mode === 'run' ? { ...next, yaw: DEFAULTS.yaw } : next, location.search));
    follow();
  };
  // Disabled only when the backend has no way to force a loss; a click during a rebuild does nothing but stays possible later.
  const panel = createPanel(el, params, apply, {
    mode,
    onLose: () => {
      if (!view) return true;
      view.forceLoss();
      return view.canForceLoss;
    },
  });

  // The F3 readout; the timer runs only while it is open.
  const timer = new FrameTimer<R3dSystem>(R3D_SYSTEMS);
  const statsEl = document.createElement('pre');
  statsEl.className = 'r3d-stats';
  el.appendChild(statsEl);
  const follow = (): void => {
    statsEl.hidden = !params.stats;
    timer.on = params.stats;
  };
  follow();
  let fps = 0;
  let lastFrameMs = -1;
  let statsAt = 0;

  const held = new Set<string>();
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'F3') {
      e.preventDefault(); // not the browser's find-next
      if (e.repeat) return;
      if (stage?.stats?.()) return; // the stage shows its own panel
      apply({ ...params, stats: !params.stats });
      return;
    }
    if (isTextTarget(e.target)) return; // the slider keeps its own keys
    if (e.code in MOVE_KEYS) {
      held.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
    }
    if (stage?.key?.(e)) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    held.delete(e.code);
  };
  const onBlur = (): void => held.clear();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  const host: Host = {
    get params() {
      return params;
    },
    setParams: (p) => apply(p),
    setRunYaw: (deg) => {
      params = { ...params, yaw: deg };
      panel.setParams(params);
    },
    setDaylight: (on) => panel.setDaylight(on),
    stop: () => stop(),
  };

  function stop(): void {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    writeUrl.cancel();
    if (view) {
      try {
        view.dispose();
      } catch (e) {
        console.warn('Disposing the view failed:', e);
      }
      view = null;
    }
    canvas.remove();
    clearErrors(el);
    panel.destroy();
    statsEl.remove();
    timer.on = false;
    try {
      stage?.dispose();
    } finally {
      if (window.__r3d === state) delete window.__r3d;
    }
  }

  const frames: FrameRects = {};
  try {
    const atlas = await deps.loadAtlas();
    for (const [name, f] of Object.entries(atlas.frames)) frames[name] = { x: f.frame.x, y: f.frame.y, w: f.frame.w, h: f.frame.h };
    assets = { image: atlas.img, frames };
  } catch (e) {
    const wasStopped = stopped;
    stop();
    if (!wasStopped) showError(el, `Could not load the atlas: ${String(e)}`, false); // after stop(), which clears the boxes
    return null;
  }
  if (stopped) return null;

  try {
    stage = makeStage(assets, host);
  } catch (e) {
    stop();
    throw e;
  }
  if (stopped) {
    stage.dispose(); // stop() ran inside makeStage, before there was a stage to dispose
    return null;
  }

  let first: View;
  try {
    first = await deps.createView(canvas, assets, stage.world, { forceWebGL: initial.backend === 'webgl' }, lostFrom(gen));
  } catch (e) {
    const wasStopped = stopped;
    stop();
    if (!wasStopped) showError(el, String(e instanceof Error ? e.message : e), e instanceof RendererInitError);
    return null;
  }
  if (stopped) {
    first.dispose(); // stop() came while the view was being made; it disposed the stage already
    return null;
  }
  view = first;
  viewLive = true;
  backendName = view.backend;
  state.backend = backendName;
  window.__r3d = state;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let last = performance.now() / 1000;

  const frame = (nowMs: number): void => {
    const gap = nowMs - lastFrameMs; // the raw time between animation frames, not frameDt's clamped one
    if (lastFrameMs >= 0 && gap > 0) fps = fps === 0 ? 1000 / gap : fps * 0.9 + (1000 / gap) * 0.1;
    lastFrameMs = nowMs;
    timer.stepStart();
    timer.begin();
    const now = nowMs / 1000;
    const dt = frameDt(now, last);
    last = now;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (view && !recovery.busy && (w !== cw || h !== ch)) {
      cw = w;
      ch = h;
      view.setSize(w, h);
    }
    const zoom = params.zoom ?? pickZoom(w, h);
    const plan = renderPlan(params.quality, zoom, w, h);
    state.renderSize = [plan.targetW, plan.targetH];
    state.zoom = zoom;
    // While the view is being rebuilt the stage keeps stepping; only the drawing waits.
    const restoring = recovery.busy || !view;
    const text = restoring ? 'Graphics device lost, restoring…' : `${backendName} · zoom ${zoom} · render ${plan.targetW}×${plan.targetH}`;
    if (text !== readout) {
      readout = text;
      panel.setReadout(text);
    }
    let drawCalls = 0;
    try {
      drawCalls = stage!.frame({ now, dt, params, held, canvas: { w, h }, canvasEl: canvas, zoom, plan, view: restoring ? null : view, timer });
    } finally {
      if (!restoring) timer.renderEnd(drawCalls); // also when the stage threw, so the timer stays consistent
    }
    if (!restoring) state.frames++;
    if (timer.on && nowMs - statsAt >= 250) {
      statsAt = nowMs;
      statsEl.textContent = statsText3d({
        fps,
        frameMs: timer.frameMs,
        renderMs: timer.renderMs,
        systems: R3D_SYSTEMS.map((s) => [s, timer.systems[s]] as const),
        drawCalls: timer.drawCalls,
        canvas: [w, h],
        render: [plan.targetW, plan.targetH],
        zoom,
        quality: params.quality,
        backend: backendName,
        lines: state.lights ? lightLines(state.lights.list, state.lights.inView, state.casters ?? 0, params.lcap, params.ccap) : undefined,
      });
    }
  };
  // The next frame is requested first, and an exception in this one is logged (once per distinct message), so one throw
  // (a context that is lost but not yet reported, say) never stops the loop.
  const reported = new Set<string>();
  const loop = (nowMs: number): void => {
    raf = requestAnimationFrame(loop);
    try {
      frame(nowMs);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (!reported.has(msg)) {
        reported.add(msg);
        console.error('3D frame failed:', e);
      }
    }
  };

  booted = true;
  try {
    stage.built?.(first);
  } catch (e) {
    stop();
    throw e;
  }
  if (stopped) return null; // the stage stopped the host in its first `built`
  if (lostEarly) recovery.lost(); // the first view was lost while the host was still setting up
  raf = requestAnimationFrame(loop);
  return host;
}
