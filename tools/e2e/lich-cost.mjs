// What the built lich costs (#358). Per backend: `?r3d=lich&glide=1` against the same page with `&lich=0`, RUNS runs of SECS seconds
// each, the median of the runs' median frame times, and the figure pass's CPU time (`__r3d.lichMs`: the running mean of
// `Figures3d.frame`, with and without the lich; the difference is the lich's pose, cloth and builder).
// Usage: GPU=uncapped BROWSER=/usr/bin/brave-browser node lich-cost.mjs <baseUrl of a production build (vite preview)>
import { chromium } from 'playwright-core';
import { gpuLaunch, printGpu, sampleFrames, SOFTWARE } from './gpu.mjs';

const base = process.argv[2] ?? 'http://localhost:4173/';
const SECS = Number(process.env.SECS) || 10, RUNS = Number(process.env.RUNS) || 3;
// EXTRA: more query for both pages of a pair, e.g. EXTRA='&fx=stone' (no lights, halos or claws) or '&light=work'.
const EXTRA = process.env.EXTRA ?? '';
if (!process.env.GPU) { console.log('FAILED: set GPU=uncapped (the numbers mean nothing on a software renderer)'); process.exit(1); }
const b = await chromium.launch({ executablePath: process.env.BROWSER, ...gpuLaunch() });
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const failures = [];
let first = true;
const out = {};
for (const backend of ['webgl', 'webgpu']) {
  const rows = { on: [], off: [], ms: [], msOff: [] };
  for (let run = 0; run < RUNS; run++) {
    for (const lich of ['on', 'off']) {
      const p = await b.newPage({ viewport: { width: 2560, height: 1280 } });
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
      p.on('console', (m) => { if (m.type() === 'error' || /device lost/i.test(m.text())) errs.push(m.text().slice(0, 200)); });
      await p.goto(`${base}?r3d=lich&glide=1${lich === 'off' ? '&lich=0' : ''}${EXTRA}&backend=${backend}`);
      await p.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 40000 });
      if (first) { await printGpu(p); first = false; }
      const drawn = await p.evaluate(async (backend) => {
        if (backend === 'webgl') {
          const g = document.querySelector('canvas')?.getContext('webgl2');
          const e = g?.getExtension('WEBGL_debug_renderer_info');
          return g ? (e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) : 'no webgl2 context';
        }
        const a = await navigator.gpu?.requestAdapter().catch(() => null);
        return a ? [a.info?.vendor, a.info?.architecture, a.info?.device, a.info?.description].join(' ') : 'software: no adapter';
      }, backend);
      if (SOFTWARE.test(drawn)) failures.push(`${backend}: ${drawn}`);
      await p.waitForTimeout(4000);
      const r = { ...(await sampleFrames(p, SECS)), ...(await p.evaluate(() => ({ backend: window.__r3d.backend, size: window.__r3d.renderSize, lichMs: window.__r3d.lichMs ?? null }))) };
      console.log(`${backend}\trun ${run + 1}\tlich ${lich}\t${r.backend}\tmed ${r.med.toFixed(3)} ms\tmean ${r.mean.toFixed(3)}\tlichMs ${r.lichMs === null ? '-' : r.lichMs.toFixed(3)}\t${r.size}${errs.length ? `\tERR ${errs[0]}` : ''}`);
      if (errs.length) failures.push(`${backend} lich ${lich}: ${errs[0]}`);
      rows[lich].push(r.med);
      (lich === 'on' ? rows.ms : rows.msOff).push(r.lichMs ?? NaN);
      await p.close();
    }
  }
  out[backend] = { on: median(rows.on), off: median(rows.off), build: median(rows.ms), buildOff: median(rows.msOff) };
}
await b.close();
console.log('\nbackend\twith lich\twithout\tdifference\tfigure pass with\twithout\tthe lich on the CPU');
for (const [k, v] of Object.entries(out)) console.log(`${k}\t${v.on.toFixed(3)} ms\t${v.off.toFixed(3)} ms\t${(v.on - v.off).toFixed(3)} ms\t${v.build.toFixed(3)} ms\t${v.buildOff.toFixed(3)} ms\t${(v.build - v.buildOff).toFixed(3)} ms`);
if (failures.length) { console.log(`FAILED:\n${failures.join('\n')}`); process.exit(1); }
