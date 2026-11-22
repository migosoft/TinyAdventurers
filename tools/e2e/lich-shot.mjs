// Check shots of the built lich (#358) in the ?r3d=lich page: standing, gliding, every act in the middle of its wind-up and 0.1 s and 0.5 s
// after its release, the broken wind-up and the hurt flash, the four effects (frozen, chilled, stone, immune), the work light, the front
// and the back close up, the lich wading, and a lost device (the draws before and after equal). Every page is pinned (`&t=3`: the page steps
// to it from rest), so a shot is the same picture every time. Fails on a console error, a "3D model <key>: ..." warning, a "built figure <key>: ..." warning (a built key without a layer in view.ts), a device-lost warning (but in
// the `lose` run) and a page whose `window.__r3d.built` stays below 1.
// Usage: node lich-shot.mjs [baseUrl] [outDir] [mode]     mode: webgl (default) or webgpu
// Env: BROWSER (the executable), GPU=1 (a visible window on the real GPU with the notebook's start line, gpu.mjs), HEADED=1,
//      READBACK=1 (also saves <name>-readback.png: the frame re-drawn off-screen and read back; a WebGPU canvas capture may be black),
//      R3D_W / R3D_H (1280x768), ONLY=<regex> (only shots whose name matches), HIDE=0 (keep the panel on), ZOOM (default 4).
import { mkdirSync } from 'node:fs';
import { launch, gpuOn, printGpu } from './gpu.mjs';
import { VIEWPORT, saveReadback, watchPage } from './r3d-page.mjs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots-lich';
const mode = process.argv[4] || 'webgl';
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const zoom = process.env.ZOOM ?? '4';
mkdirSync(out, { recursive: true });

// The acts with a wind-up: [name, the wind-up's length in s]. The release is at the end of it; `&at=` is the seconds into the act's loop.
const ACTS = [['nova', 1.2], ['raise', 0.7], ['bolts', 0.5], ['curse', 0.6], ['mist', 0.8], ['gaze', 1.0]];
const T = '&t=3';
const shots = [];
shots.push({ name: 'stand', q: `&act=stand${T}` });
shots.push({ name: 'glide', q: `&glide=1&t=3` });
for (const [act, wind] of ACTS) {
  shots.push({ name: `${act}-windup`, q: `&act=${act}&at=${(wind / 2).toFixed(2)}${T}` });
  for (const r of [0.1, 0.5]) shots.push({ name: `${act}-release-${r}`, q: `&act=${act}&at=${(wind + r).toFixed(2)}${T}` });
}
shots.push({ name: 'broken-0.35', q: `&act=broken&at=0.35${T}` });
shots.push({ name: 'hurt-0.07', q: `&act=hurt&at=0.07${T}` });
for (const fx of ['frozen', 'chilled', 'stone', 'immune']) shots.push({ name: `fx-${fx}`, q: `&fx=${fx}${T}` });
shots.push({ name: 'work-light', q: `&light=work${T}` });
shots.push({ name: 'front-zoom8', q: `&zoom=8&face=90${T}`, zoom: '8' });
shots.push({ name: 'back-zoom8', q: `&zoom=8&face=270${T}`, zoom: '8' });
// The lich in the shallow water (tiles x 19..22, z 10..13 of the hall's map), in the torch light and in the work light.
shots.push({ name: 'wading', q: `&px=20.5&pz=11.5${T}` });
shots.push({ name: 'wading-zoom8', q: `&px=20.5&pz=11.5&zoom=8&face=90${T}`, zoom: '8' });
shots.push({ name: 'wading-work', q: `&px=20.5&pz=11.5&light=work&zoom=8&face=90${T}`, zoom: '8' });

const b = await launch(mode);
// GPU=1 launches one start line for both modes: the page's own `backend` parameter then picks WebGL2 (webgl) or WebGPU (auto).
const backend = mode === 'webgl' ? '&backend=webgl' : '';
const errs = [];

/** A new page on the lich page with `q`; its console problems go to `errs` tagged with `tag` (the loss run expects device-lost noise). */
async function open(q, tag, zoomOf = zoom, lose = false) {
  const p = await b.newPage({ viewport: VIEWPORT });
  const mine = [];
  watchPage(p, tag, mine, () => lose);
  p.on('console', (m) => m.type() === 'warning' && /shader|uniform|validation|WGSL/i.test(m.text()) && mine.push(`${tag}: ${m.text()}`));
  p._mine = mine;
  await p.goto(`${base}?r3d=lich&zoom=${zoomOf}${backend}${q}`);
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
    const r = await p.evaluate(() => ({ built: window.__r3d.built, lichMs: window.__r3d.lichMs, draws: window.__r3d.models?.draws, fx: window.__r3d.fx }));
    console.log(`${s.name}: ${((Date.now() - t0) / 1000).toFixed(1)} s, built ${r.built}, lichMs ${r.lichMs?.toFixed(2)}, draws ${r.draws}, fx tris ${r.fx?.tris} dropped ${r.fx?.dropped}`);
    if (!(r.built >= 1)) errs.push(`${s.name}: no built lich`);
    errs.push(...p._mine.splice(0));
  } catch (e) {
    errs.push(`${s.name}: ${e.message}`);
    if (p) errs.push(...p._mine.splice(0));
  } finally {
    await p?.close().catch(() => {});
  }
}

// A lost device: the stage's kit lives on, so the new view makes its own layer and picture from it; the draws before and after are equal.
if (!only || only.test('lose')) {
  let p = null;
  try {
    p = await open(`&t=3${'&act=nova&at=1.3'}`, 'lose', zoom, true);
    await p.waitForTimeout(800);
    await snap(p, 'lose-before');
    const before = await p.evaluate(() => ({ built: window.__r3d.built, draws: window.__r3d.models.draws }));
    console.log(`lose: forceLoss() returned ${await p.evaluate(() => window.__r3d.forceLoss())}`);
    const f0 = await p.evaluate(() => window.__r3d.frames);
    await p.waitForFunction((n) => window.__r3d.frames >= n + 10, f0, { timeout: 30000 });
    await p.waitForTimeout(1500);
    const after = await p.evaluate(() => ({ built: window.__r3d.built, draws: window.__r3d.models.draws }));
    await snap(p, 'lose-after');
    console.log(`lose: built ${before.built} before, ${after.built} after; draws ${before.draws} before, ${after.draws} after`);
    if (!(after.built >= 1)) errs.push('lose: no built lich after the loss');
    if (after.draws !== before.draws) errs.push(`lose: ${before.draws} draws before the loss, ${after.draws} after`);
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
