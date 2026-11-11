import { loadAtlas } from '../ui/atlas';
import { keysToWorld } from './camera';
import { buildDynamic } from './cards';
import { parseMap, MAP_ROWS } from './demoMap';
import { sceneLights } from './light';
import { createPanel } from './panel';
import { FrameTimer } from '../game/frameTimer';
import { parseParams, toSearch, type R3dParams } from './params';
import { R3D_SYSTEMS, statsText3d, type R3dSystem } from './stats';
import { pickZoom, renderPlan } from './quality';
import { frameDt, newScene, stepScene } from './scene';
import { createRecovery, type Recovery } from './recover';
import { createView, type Assets, type View } from './view';
import type { FrameRects } from './worldMesh';
import './r3d.css';

declare global {
  interface Window {
    __r3d?: { backend: string; frames: number; renderSize: [number, number]; zoom: number; forceLoss?: () => boolean };
  }
}

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

function showError(host: HTMLElement, text: string, fixed: boolean): void {
  const d = document.createElement('div');
  d.className = 'r3d-error';
  d.textContent = fixed ? `This page needs WebGPU or WebGL2, which this browser does not offer. ${text}` : text;
  host.appendChild(d);
  console.error(d.textContent);
}

export async function bootR3d(host: HTMLElement, search: string): Promise<void> {
  const initial = parseParams(search);
  let canvas = document.createElement('canvas');
  canvas.className = 'r3d';
  host.appendChild(canvas);

  let view: View;
  const map = parseMap(MAP_ROWS);
  const frames: FrameRects = {};
  let assets: Assets | null = null;
  // The view being replaced is disposed once, even when the rebuild is retried.
  let viewLive = true;
  // Each view reports its loss through the generation it was made in; a report from an older one is ignored.
  let gen = 0;
  // Until boot has set everything up the rebuild has nothing to write to: a loss then only sets a flag, and boot starts the recovery at its end.
  let booted = false;
  let lostEarly = false;
  const lostFrom = (g: number) => (message: string): void => {
    if (g !== gen) return;
    console.warn(`Graphics device lost: ${message}`);
    if (booted) recovery.lost();
    else lostEarly = true;
  };

  async function rebuild(): Promise<void> {
    const g = ++gen;
    if (viewLive) {
      viewLive = false;
      try {
        view.dispose();
      } catch (e) {
        console.warn('Disposing the lost view failed:', e);
      }
    }
    // A fresh canvas every attempt: the old one may hold a dead context. It takes the old one's place in the DOM.
    const next = document.createElement('canvas');
    next.className = 'r3d';
    canvas.replaceWith(next);
    canvas = next;
    view = await createView(next, assets!, map, { forceWebGL: initial.backend === 'webgl' }, lostFrom(g));
    viewLive = true;
    cw = 0; // setSize again for the current canvas size
    ch = 0;
    backendName = view.backend;
    state.backend = backendName;
    readout = '';
  }
  const recovery: Recovery = createRecovery(rebuild);

  try {
    const atlas = await loadAtlas().catch((e) => {
      showError(host, `Could not load the atlas: ${String(e)}`, false);
      throw e;
    });
    for (const [name, f] of Object.entries(atlas.frames)) frames[name] = { x: f.frame.x, y: f.frame.y, w: f.frame.w, h: f.frame.h };
    assets = { image: atlas.img, frames };
    try {
      view = await createView(canvas, assets, map, { forceWebGL: initial.backend === 'webgl' }, lostFrom(gen));
    } catch (e) {
      showError(host, String(e instanceof Error ? e.message : e), true);
      return;
    }
  } catch {
    return;
  }

  const state = {
    backend: view.backend as string,
    frames: 0,
    renderSize: [0, 0] as [number, number],
    zoom: 0,
    forceLoss: (): boolean => view.forceLoss(),
  };
  window.__r3d = state;

  let params = initial;
  // The one path of every params change (the panel, F3): it keeps `params`, the panel's copy, the address bar and
  // what follows `params.stats` (the readout's visibility, the timer) in step.
  const apply = (next: R3dParams): void => {
    params = next;
    panel.setParams(next);
    history.replaceState(null, '', toSearch(next));
    follow();
  };
  // Disabled only when the backend has no way to force a loss; a click during a rebuild does nothing but stays possible later.
  const panel = createPanel(host, params, apply, () => {
    view.forceLoss();
    return view.canForceLoss;
  });

  // The F3 readout; the timer runs only while it is open.
  const timer = new FrameTimer<R3dSystem>(R3D_SYSTEMS);
  const statsEl = document.createElement('pre');
  statsEl.className = 'r3d-stats';
  host.appendChild(statsEl);
  const follow = (): void => {
    statsEl.hidden = !params.stats;
    timer.on = params.stats;
  };
  follow();
  let fps = 0;
  let lastFrameMs = -1;
  let statsAt = 0;
  let readout = '';
  let backendName: string = view.backend;

  const held = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      e.preventDefault(); // not the browser's find-next
      if (!e.repeat) apply({ ...params, stats: !params.stats });
      return;
    }
    if (e.target instanceof HTMLInputElement) return; // the slider keeps its own keys
    if (e.code in MOVE_KEYS) {
      held.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => held.clear());

  const scene = newScene();
  const cam = { x: scene.player.x, z: scene.player.z, pitch: (params.pitch * Math.PI) / 180, yaw: (params.yaw * Math.PI) / 180 };
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cw = 0;
  let ch = 0;
  let last = performance.now() / 1000;

  const loop = (nowMs: number) => {
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
    if (!recovery.busy && (w !== cw || h !== ch)) {
      cw = w;
      ch = h;
      view.setSize(w, h);
    }
    let ix = 0;
    let iz = 0;
    for (const k of held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
    cam.pitch = (params.pitch * Math.PI) / 180;
    cam.yaw = (params.yaw * Math.PI) / 180;
    stepScene(map, scene, ix || iz ? keysToWorld(cam.yaw, ix, iz) : { x: 0, z: 0 }, dt);
    const k = 1 - Math.exp(-dt * 6);
    cam.x += (scene.player.x - cam.x) * k;
    cam.z += (scene.player.z - cam.z) * k;
    timer.lap('sim');
    const zoom = params.zoom ?? pickZoom(w, h);
    const dynamic = buildDynamic(scene, frames, cam, now, params.orb);
    timer.lap('cards');
    const lights = sceneLights(scene, now, params.orb);
    timer.lap('lights');
    const plan = renderPlan(params.quality, zoom, w, h);
    state.renderSize = [plan.targetW, plan.targetH];
    state.zoom = zoom;
    // While the view is being rebuilt the scene keeps stepping; only the drawing waits.
    const restoring = recovery.busy;
    const text = restoring ? 'Graphics device lost, restoring…' : `${backendName} · zoom ${zoom} · render ${plan.targetW}×${plan.targetH}`;
    if (text !== readout) {
      readout = text;
      panel.setReadout(text);
    }
    if (!restoring) {
      timer.renderStart();
      const drawCalls = view.draw({ cam, plan, dynamic, lights, shadows: params.shadows, smooth: params.smooth, t: now }, timer);
      timer.renderEnd(drawCalls);
      state.frames++;
    }
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
      });
    }
    requestAnimationFrame(loop);
  };
  booted = true;
  if (lostEarly) recovery.lost(); // the first view was lost while boot was still setting up
  requestAnimationFrame(loop);
}
