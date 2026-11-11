import { loadAtlas } from '../ui/atlas';
import { keysToWorld } from './camera';
import { parseMap, MAP_ROWS } from './demoMap';
import { parseParams } from './params';
import { pickZoom, renderPlan } from './quality';
import { frameDt, newScene, stepScene } from './scene';
import { createView, type View } from './view';
import type { FrameRects } from './worldMesh';
import './r3d.css';

declare global {
  interface Window {
    __r3d?: { backend: string; frames: number };
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
  const params = parseParams(search);
  const canvas = document.createElement('canvas');
  canvas.className = 'r3d';
  host.appendChild(canvas);

  let view: View;
  const map = parseMap(MAP_ROWS);
  try {
    const atlas = await loadAtlas().catch((e) => {
      showError(host, `Could not load the atlas: ${String(e)}`, false);
      throw e;
    });
    const frames: FrameRects = {};
    for (const [name, f] of Object.entries(atlas.frames)) frames[name] = { x: f.frame.x, y: f.frame.y, w: f.frame.w, h: f.frame.h };
    try {
      view = await createView(canvas, { image: atlas.img, frames }, map, { forceWebGL: params.backend === 'webgl' });
    } catch (e) {
      showError(host, String(e instanceof Error ? e.message : e), true);
      return;
    }
  } catch {
    return;
  }

  const state = { backend: view.backend as string, frames: 0 };
  window.__r3d = state;

  const held = new Set<string>();
  window.addEventListener('keydown', (e) => {
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
    const now = nowMs / 1000;
    const dt = frameDt(now, last);
    last = now;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (w !== cw || h !== ch) {
      cw = w;
      ch = h;
      view.setSize(w, h);
    }
    let ix = 0;
    let iz = 0;
    for (const k of held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
    stepScene(map, scene, ix || iz ? keysToWorld(cam.yaw, ix, iz) : { x: 0, z: 0 }, dt);
    const k = 1 - Math.exp(-dt * 6);
    cam.x += (scene.player.x - cam.x) * k;
    cam.z += (scene.player.z - cam.z) * k;
    const zoom = params.zoom ?? pickZoom(w, h);
    view.draw({ cam, plan: renderPlan('high', zoom, w, h), shadows: params.shadows, smooth: params.smooth, t: now });
    state.frames++;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
