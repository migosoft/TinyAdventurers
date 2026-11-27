// Check shots of the built demon (#379) in the ?r3d=demon page: every act as a strip of six instants (the flight twelve), `stand` from four
// sides, the effects, the wings' fold, the work light, the breath and a cast, wading at the lava's edge, two demons, and a lost device (the
// built layer's drawn count before and after equal). Every page is pinned (`&at=<s>` into the act's loop, which pins `&t=3`), so a shot is the same picture every
// time. Fails on a console error, a "3D model <key>: ..." / "built figure <key>: ..." warning, a device-lost warning (but in the `lose` run) and a
// page whose `window.__r3d.built` stays below 1.
// Usage: node demon-shot.mjs [baseUrl] [outDir] [mode]     mode: webgl (default) or webgpu
// Env: BROWSER (the executable), GPU=1 (a visible window on the real GPU with the notebook's start line, gpu.mjs), HEADED=1,
//      READBACK=1 (also saves <name>-readback.png: the frame re-drawn off-screen and read back; a WebGPU canvas capture may be black),
//      R3D_W / R3D_H (1280x768), ONLY=<regex> (only shots whose name matches), HIDE=0 (keep the panel on), ZOOM (default 4).
import { mkdirSync } from 'node:fs';
import { launch, gpuOn, printGpu } from './gpu.mjs';
import { VIEWPORT, saveReadback, watchPage } from './r3d-page.mjs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots-demon';
const mode = process.argv[4] || 'webgl';
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const zoom = process.env.ZOOM ?? '4';
mkdirSync(out, { recursive: true });

// The acts: [name, first s, last s, instants] of the act's loop (the server's times: demonScript.ts).
const STRIPS = [['stand', 0, 3.5], ['walk', 0.4, 2.8], ['claws', 0, 0.9], ['tail', 0, 1.1], ['swoop', 0.3, 2.0], ['cast', 0, 1.1], ['breath', 0, 2.5], ['hurt', 0.9, 1.2], ['broken', 0, 0.6], ['wings', 0.4, 12.4]];
const at = (a, b, n, i) => (a + ((b - a) * i) / (n - 1)).toFixed(2);
const T = '&t=3';
const shots = [];
for (const [act, a, b] of STRIPS) for (let i = 0; i < 6; i++) shots.push({ name: `${act}-${i}`, q: `&act=${act}&at=${at(a, b, 6, i)}${T}` });
for (let i = 0; i < 12; i++) shots.push({ name: `fly-${String(i).padStart(2, '0')}`, q: `&act=fly&at=${at(0.2, 8.3, 12, i)}${T}` });
// The knight stands 1.6 tiles east and 2.4 south of the hall's middle (15, 12): put the demon 3 tiles behind him on each facing so its head is straight.
for (const deg of [0, 90, 180, 270]) {
  const r = (deg * Math.PI) / 180;
  shots.push({ name: `side-${deg}`, q: `&face=${deg}&px=${(16.6 - 3 * Math.cos(r)).toFixed(2)}&pz=${(14.4 - 3 * Math.sin(r)).toFixed(2)}${T}` });
}
for (const fx of ['frozen', 'chilled', 'stone']) shots.push({ name: `fx-${fx}`, q: `&fx=${fx}${T}` });
for (const f of [0, 0.5, 1]) shots.push({ name: `fold-${f}`, q: `&fold=${f}${T}` });
shots.push({ name: 'work-light', q: `&light=work${T}` });
shots.push({ name: 'breath-fx', q: `&act=breath&at=1.5${T}` });
shots.push({ name: 'cast-fx', q: `&act=cast&at=0.7${T}` });
shots.push({ name: 'front-zoom8', q: `&zoom=8&face=90${T}`, zoom: '8' });
shots.push({ name: 'back-zoom8', q: `&zoom=8&face=270${T}`, zoom: '8' });
// The lava pool is tiles x 19..22, z 10..13 of the hall's map.
shots.push({ name: 'wading', q: `&px=19.3&pz=11.5${T}` });
shots.push({ name: 'wading-zoom8', q: `&px=19.3&pz=11.5&zoom=8&face=90${T}`, zoom: '8' });
shots.push({ name: 'two', q: `&two=1&act=claws&at=0.6${T}`, built: 2 });

const b = await launch(mode);
// GPU=1 launches one start line for both modes: the page's own `backend` parameter then picks WebGL2 (webgl) or WebGPU (auto).
const backend = mode === 'webgl' ? '&backend=webgl' : '';
const errs = [];

/** A new page on the demon page with `q`; its console problems go to `errs` tagged with `tag` (the loss run expects device-lost noise). */
async function open(q, tag, zoomOf = zoom, lose = false) {
  const p = await b.newPage({ viewport: VIEWPORT });
  const mine = [];
  watchPage(p, tag, mine, () => lose);
  p.on('console', (m) => m.type() === 'warning' && /shader|uniform|validation|WGSL/i.test(m.text()) && mine.push(`${tag}: ${m.text()}`));
  p._mine = mine;
  await p.goto(`${base}?r3d=demon&zoom=${zoomOf}${backend}${q}`);
  await p.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 40000 });
  await p.waitForFunction(() => window.__r3d?.built >= 1, null, { timeout: 60000 });
  return p;
}

async function snap(p, name) {
  if (process.env.HIDE !== '0') await p.evaluate(() => { const t = document.querySelector('.r3d-toggle'); if (t && t.textContent === 'Hide') t.click(); });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/${name}.png` });
  if (!(await saveReadback(p, `${out}/${name}-readback.png`))) errs.push(`${name}: readback returned nothing`);
}

const first = await open(shots[0].q, 'start');
console.log(`backend: ${await first.evaluate(() => window.__r3d.backend)}`);
if (gpuOn) await printGpu(first);
errs.push(...first._mine);
await first.close();

for (const s of shots) {
  if (only && !only.test(s.name)) continue;
  const t0 = Date.now();
  let p = null;
  try {
    p = await open(s.q, s.name, s.zoom ?? zoom);
    await p.waitForTimeout(800);
    await snap(p, s.name);
    const r = await p.evaluate(() => ({ built: window.__r3d.built, demonMs: window.__r3d.demonMs, draws: window.__r3d.models?.draws, fx: window.__r3d.fx }));
    console.log(`${s.name}: ${((Date.now() - t0) / 1000).toFixed(1)} s, built ${r.built}, demonMs ${r.demonMs?.toFixed(2)}, draws ${r.draws}, fx tris ${r.fx?.tris} dropped ${r.fx?.dropped}`);
    if (!(r.built >= (s.built ?? 1))) errs.push(`${s.name}: ${r.built} built demons, ${s.built ?? 1} expected`);
    errs.push(...p._mine.splice(0));
  } catch (e) {
    errs.push(`${s.name}: ${e.message}`);
    if (p) errs.push(...p._mine.splice(0));
  } finally {
    await p?.close().catch(() => {});
  }
}

// A lost device: the stage's kit lives on, so the new view makes its own layer and picture from it; the built layers' drawn count (the demon's layer) before and after are equal.
if (!only || only.test('lose')) {
  let p = null;
  try {
    p = await open(`&t=3${'&act=claws&at=0.6'}`, 'lose', zoom, true);
    await p.waitForTimeout(800);
    await snap(p, 'lose-before');
    const before = await p.evaluate(() => ({ built: window.__r3d.built, drawn: window.__r3d.builtDrawn }));
    console.log(`lose: forceLoss() returned ${await p.evaluate(() => window.__r3d.forceLoss())}`);
    const f0 = await p.evaluate(() => window.__r3d.frames);
    await p.waitForFunction((n) => window.__r3d.frames >= n + 10, f0, { timeout: 30000 });
    await p.waitForTimeout(1500);
    const after = await p.evaluate(() => ({ built: window.__r3d.built, drawn: window.__r3d.builtDrawn }));
    await snap(p, 'lose-after');
    console.log(`lose: built ${before.built} before, ${after.built} after; built layers drew ${before.drawn} before, ${after.drawn} after`);
    if (!(after.built >= 1)) errs.push('lose: no built demon after the loss');
    if (!(before.drawn >= 1) || after.drawn !== before.drawn) errs.push(`lose: the built layer drew ${before.drawn} before the loss, ${after.drawn} after`);
    errs.push(...p._mine.splice(0));
  } catch (e) {
    errs.push(`lose: ${e.message}`);
  } finally {
    await p?.close().catch(() => {});
  }
}

console.log(errs.join('\n') || 'no browser errors');
await b.close();
if (errs.length) process.exit(1);
