import { loadAtlas } from '../ui/atlas';
import { createView } from './view';
import './r3d.css';

declare global {
  interface Window {
    __r3d?: { backend: string; frames: number };
  }
}

export async function bootR3d(host: HTMLElement, search: string): Promise<void> {
  const q = new URLSearchParams(search);
  const canvas = document.createElement('canvas');
  canvas.className = 'r3d';
  host.appendChild(canvas);
  const atlas = await loadAtlas();
  const view = await createView(canvas, { forceWebGL: q.get('backend') === 'webgl' }, atlas);
  const state = { backend: view.backend as string, frames: 0 };
  window.__r3d = state;
  const loop = () => {
    view.render();
    state.frames++;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
