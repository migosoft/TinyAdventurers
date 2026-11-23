// Page helpers shared by the e2e scripts that play a run in the 3D view (smoke.mjs, r3d-run.mjs, charm-run.mjs).
import { writeFileSync } from 'node:fs';

/** The window size: WebGPU on the dev notebook loses its device silently at 720 high. */
export const VIEWPORT = { width: 1280, height: 768 };

/**
 * Collects the page's failures into `errors`: uncaught errors, console errors (not the expected 401 of the first /api/me before
 * logging in) and a "3D model" / "built figure" build warning and a "device lost" warning (host.ts only warns; unless `isLosing()` says the script loses the device on purpose, it is a failure).
 */
export function watchPage(page, name, errors, isLosing = () => false) {
  const label = name ? `${name} ` : '';
  page.on('pageerror', (e) => errors.push(`${label}pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && !(isLosing() && /Device Lost/i.test(m.text())) && errors.push(`${label}console: ${m.text()}`));
  page.on('console', (m) => m.type() === 'warning' && /^(3D model |built figure )/.test(m.text()) && errors.push(`${label}${m.text()}`));
  page.on('console', (m) => m.type() === 'warning' && /device lost/i.test(m.text()) && !isLosing() && errors.push(`${label}device lost: ${m.text()}`));
}

/** The URL of a page with the backend parameter appended to `query`. */
export const pageUrl = (base, query = '') => base + query + (backendQuery() ? (query.includes('?') ? '&' : '?') + backendQuery() : '');

/** The page parameter that picks the backend: nothing for BACKEND=webgpu, else `backend=webgl` (software WebGL2 is what headless has). */
export function backendQuery() {
  return process.env.BACKEND === 'webgpu' ? '' : 'backend=webgl';
}

/** The loading screen (#322) is up from RunStarted until the party starts together: wait until it is hidden. */
export async function waitLoaded(page, timeout = 90000) {
  await page.waitForSelector('.loading-screen', { state: 'hidden', timeout });
}

/** What the run publishes as `window.__r3d`, the numbers the checks read. */
export function r3dState(page) {
  return page.evaluate(() => {
    const r = window.__r3d;
    return {
      frames: r?.frames, hero: r?.hero, cam: r?.cam, figures: r?.figures, chunks: r?.chunks, fx: r?.fx, renderSize: r?.renderSize, backend: r?.backend,
    };
  });
}

/** READBACK=1: the frame re-drawn off-screen and read back (a WebGPU canvas capture is black on this notebook), saved as a PNG. Returns false when nothing came back. */
export async function saveReadback(page, path) {
  if (!process.env.READBACK) return true;
  const url = await page.evaluate(async () => {
    const r = await window.__r3d.readback?.();
    if (!r) return null;
    const c = document.createElement('canvas');
    c.width = r.w;
    c.height = r.h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
    return c.toDataURL('image/png');
  });
  if (!url) return false;
  writeFileSync(path, Buffer.from(url.split(',')[1], 'base64'));
  return true;
}
