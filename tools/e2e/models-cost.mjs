// Frame cost of the gallery crowd (#364): the crowd as models against cards, with the work light and the torch light, on WebGL2 and on the
// default backend (WebGPU where there is one). One line per run: mean, median and 99th percentile frame time, the figures and draws the
// model layer published and the render size.
// Usage: GPU=uncapped node models-cost.mjs <baseUrl> <label>
// Env: BROWSER (the executable), GPU (1 or uncapped: the real card, gpu.mjs; without it the run is SwiftShader and the numbers mean nothing),
//      SECS (10: seconds measured), CROWD (40), KINDS (e.g. stag,deer,boar,bunny: passed as &crowdKinds=).
// Fails (exit 1) on a console error, a "device lost" warning, a software renderer or a missing WebGPU adapter when GPU is set, or a page
// that does not draw 10 frames in 40 s (that one stops the run at once; the others are listed at the end).
import { chromium } from 'playwright-core';
import { gpuLaunch, printGpu } from './gpu.mjs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const label = process.argv[3] ?? '';
const SECS = Number(process.env.SECS) || 10;
const CROWD = Number(process.env.CROWD) || 40;
const kinds = process.env.KINDS ? `&crowdKinds=${process.env.KINDS}` : '';
const b = await chromium.launch({ executablePath: process.env.BROWSER, ...gpuLaunch() });
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software/i;
const failures = [];
let first = true;
for (const backend of ['webgl', 'auto']) {
  for (const light of ['', '&light=torch']) {
    for (const as of ['models', 'cards']) {
      const p = await b.newPage({ viewport: { width: 2560, height: 1280 } });
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
      p.on('console', (m) => { if (m.type() === 'error' || /device lost/i.test(m.text())) errs.push(m.text().slice(0, 200)); });
      await p.goto(`${base}?r3d=gallery&focus=models&crowd=${CROWD}${kinds}${as === 'cards' ? '&crowdAs=cards' : ''}${light}&backend=${backend}`);
      const run = `${backend} ${light || 'work'} ${as}`;
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
      if (backend === 'webgl') {
        // The renderer of the page's own canvas: the one that draws the run.
        const gl = await p.evaluate(() => {
          const c = document.querySelector('canvas');
          const g = c?.getContext('webgl2');
          const e = g?.getExtension('WEBGL_debug_renderer_info');
          return g ? (e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) : 'no webgl2 context on the page canvas';
        });
        console.log(`renderer (page canvas, ${backend}): ${gl}`);
        // With GPU set the numbers are worthless on a software renderer: a failure (the run goes on, the exit code is 1).
        if (process.env.GPU && SOFTWARE.test(gl)) failures.push(`${run}: software renderer ${gl}`);
      } else if (process.env.GPU) {
        const adapter = await p.evaluate(async () => {
          const a = await navigator.gpu?.requestAdapter().catch(() => null);
          return a ? [a.info?.vendor, a.info?.architecture, a.info?.device, a.info?.description].join(' ') : null;
        });
        if (!adapter || SOFTWARE.test(adapter)) failures.push(`${run}: ${adapter ? `software adapter ${adapter}` : 'no WebGPU adapter'}`);
      }
      await p.waitForTimeout(6000);
      const r = await p.evaluate((secs) => new Promise((res) => {
        const ts = [];
        const t0 = performance.now();
        const f = (t) => {
          ts.push(t);
          if (t - t0 < secs * 1000) requestAnimationFrame(f);
          else {
            const d = ts.slice(1).map((v, i) => v - ts[i]).sort((a, c) => a - c);
            const w = window.__r3d;
            res({
              mean: (ts[ts.length - 1] - ts[0]) / (ts.length - 1), med: d[d.length >> 1], p99: d[Math.floor(d.length * 0.99)],
              backend: w.backend, size: w.renderSize,
              models: w.models && { figures: w.models.figures, draws: w.models.draws },
              fx: w.fx && { tris: w.fx.tris, dropped: w.fx.dropped },
            });
          }
        };
        requestAnimationFrame(f);
      }), SECS);
      console.log(`${label}\t${r.backend}\t${light ? 'torch' : 'work'}\t${as}\tmean ${r.mean.toFixed(2)} ms\tmed ${r.med.toFixed(2)}\tp99 ${r.p99.toFixed(2)}\t${JSON.stringify(r.models)}\t${r.size}\tfx tris ${r.fx?.tris}\tdropped ${r.fx?.dropped}${errs.length ? `\tERR ${errs[0]}` : ''}`);
      if (r.fx?.dropped > 0) failures.push(`${backend} ${light || 'work'} ${as}: the effects dropped ${r.fx.dropped} triangles at their caps`);
      if (errs.length) failures.push(`${backend} ${light || 'work'} ${as}: ${errs[0]}`);
      await p.close();
    }
  }
}
await b.close();
if (failures.length) {
  console.log(`FAILED:\n${failures.join('\n')}`);
  process.exit(1);
}
