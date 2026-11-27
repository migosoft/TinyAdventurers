// Frame cost of the cove's plant shadow maps (#333): the demo cove (five cracks with their bounce fills, both torches) on WebGL2 and on the
// default backend (WebGPU where there is one), at quality High and Balanced. One line per run: mean, median and 99th percentile frame
// time, the plant shadow tiles drawn and the render size.
// Usage: GPU=uncapped node cove-cost.mjs <baseUrl> <label> [extra query, e.g. "&torches=0"]
// Env: BROWSER (the executable), GPU (1 or uncapped: the real card, gpu.mjs; without it the run is SwiftShader and the numbers mean nothing),
//      SECS (10: seconds measured), T (3: the page's pinned clock).
// Fails (exit 1) on a console error, a "device lost" warning, a software renderer or a missing WebGPU adapter when GPU is set, or a page
// that does not draw 10 frames in 40 s.
import { chromium } from 'playwright-core';
import { gpuLaunch, printGpu, sampleFrames, SOFTWARE } from './gpu.mjs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const label = process.argv[3] ?? '';
const extra = process.argv[4] ?? '';
const SECS = Number(process.env.SECS) || 10;
const T = process.env.T ?? '3';
const b = await chromium.launch({ executablePath: process.env.BROWSER, ...gpuLaunch() });
const failures = [];
let first = true;
for (const backend of ['webgl', 'auto']) {
  for (const quality of ['high', 'balanced']) {
    const run = `${backend} ${quality}`;
    const p = await b.newPage({ viewport: { width: 2560, height: 1280 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
    p.on('console', (m) => { if (m.type() === 'error' || /device lost/i.test(m.text())) errs.push(m.text().slice(0, 200)); });
    await p.goto(`${base}?r3d=cove&t=${T}&quality=${quality}&backend=${backend}${extra}`);
    try {
      await p.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 40000 });
    } catch (e) {
      console.log(`FAILED: the page of the run "${run}" did not draw 10 frames in 40 s (${e.message.split('\n')[0]})`);
      await b.close();
      process.exit(1);
    }
    if (first) {
      await printGpu(p);
      first = false;
    }
    if (process.env.GPU) {
      const gpu = backend === 'webgl'
        ? await p.evaluate(() => {
          const g = document.querySelector('canvas')?.getContext('webgl2');
          const e = g?.getExtension('WEBGL_debug_renderer_info');
          return g ? (e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) : null;
        })
        : await p.evaluate(async () => {
          const a = await navigator.gpu?.requestAdapter().catch(() => null);
          return a ? [a.info?.vendor, a.info?.architecture, a.info?.device, a.info?.description].join(' ') : null;
        });
      if (!gpu || SOFTWARE.test(gpu)) failures.push(`${run}: ${gpu ? `software renderer ${gpu}` : 'no GPU renderer'}`);
    }
    await p.waitForTimeout(6000);
    const r = { ...(await sampleFrames(p, SECS)), ...(await p.evaluate(() => ({ backend: window.__r3d.backend, size: window.__r3d.renderSize, tiles: window.__r3d.plantTiles }))) };
    console.log(`${label}\t${r.backend}\t${quality}\tmean ${r.mean.toFixed(2)} ms\tmed ${r.med.toFixed(2)}\tp99 ${r.p99.toFixed(2)}\ttiles ${r.tiles}\t${r.size}${errs.length ? `\tERR ${errs[0]}` : ''}`);
    if (errs.length) failures.push(`${run}: ${errs[0]}`);
    await p.close();
  }
}
await b.close();
if (failures.length) {
  console.log(`FAILED:\n${failures.join('\n')}`);
  process.exit(1);
}
