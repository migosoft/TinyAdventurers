// Check shots of the 3D figure models (#338) in the ?r3d=gallery and ?r3d=woodland&models=1 pages: every model kind in the states idle,
// move, melee, shoot, cast, windup and dash, the effect block, the torch light, the dying figures' skulls, the crowd as models and as
// cards, the woodland at hour 9.5 and 18.5, and a lost device. Fails on any console error, any "3D model" build warning and any
// lost-device warning (but in the `lose` run, where the loss is on purpose).
// Usage: node models-shots.mjs [baseUrl] [outDir] [mode]     mode: webgl (default, SwiftShader GL) or webgpu (SwiftShader Vulkan)
// Env: BROWSER (the executable), HEADED=1 (a visible window; with mode webgpu on the real GPU), GPU=1 (gpu.mjs: the notebook's start line),
//      READBACK=1 (also saves <name>-readback.png: the frame re-drawn off-screen and read back, for WebGPU), R3D_W / R3D_H (1280x768),
//      ONLY=<regex> (only shots whose name matches), HIDE=0 (keep the panel on).
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { gpuLaunch, gpuOn, printGpu } from './gpu.mjs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots';
const mode = process.argv[4] || 'webgl';
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
mkdirSync(out, { recursive: true });

const STATES = ['idle', 'move', 'melee', 'shoot', 'cast', 'windup', 'dash'];
/** The model rows of the gallery, in order (kind ids ascending): the description each one wears. */
const KINDS = [
  ['wizard', 'wizard'], ['paladin', 'knight'], ['barbarian', 'dwarf'], ['ranger', 'elf'],
  ['skelwarrior', 'skelet'], ['skelarcher', 'skelet'], ['raisedskel', 'skelet'], ['ogre', 'ogre'], ['wolf', 'wolf'],
];
const ALL = ['wizard', 'knight', 'dwarf', 'elf', 'skelet', 'ogre', 'wolf'];
// A still picture: the clock nearly stopped (slow) at t = 0.6 (past the hurt flash).
const STILL = '&slow=1000&t=0.6';

const shots = [];
for (const [i, [name, desc]] of KINDS.entries()) {
  for (const s of STATES) shots.push({ name: `kind-${name}-${s}`, q: `&focus=models&at=model:${i}&zoom=6&state=${s}${STILL}`, need: [desc] });
}
for (const s of STATES) shots.push({ name: `row-${s}`, q: `&focus=models&zoom=3&state=${s}${STILL}`, need: ALL });
for (const [name, row] of [['top', 1], ['middle', 4], ['bottom', 7]]) shots.push({ name: `effects-${name}`, q: `&at=effect:${row},3&zoom=3${STILL}`, need: ALL });
shots.push({ name: 'torch-light', q: `&focus=models&light=torch&zoom=3&state=idle${STILL}`, need: ALL });
shots.push({ name: 'torch-light-close', q: `&at=model:3&light=torch&zoom=6&state=idle${STILL}`, need: ALL });
shots.push({ name: 'dying-skulls', q: '&at=dying:4&zoom=3&t=0.5&slow=8', need: ALL, skull: true });
shots.push({ name: 'crowd-models', q: '&crowd=40&at=crowd:20&zoom=3&slow=1000&t=0.6', need: ALL, readout: true });
shots.push({ name: 'crowd-cards', q: '&crowd=40&crowdAs=cards&at=crowd:20&zoom=3&slow=1000&t=0.6', need: [], readout: true });
shots.push({ name: 'crowd-models-many', q: '&crowd=184&at=crowd:90&zoom=2&slow=1000&t=0.6', need: ALL, readout: true });
for (const hour of ['9.5', '18.5']) shots.push({ name: `woodland-${hour}`, page: 'woodland', q: `&models=1&hour=${hour}&hourRate=0&zoom=3`, need: ALL, wait: 4000 });

const args =
  mode === 'webgpu' && process.env.HEADED
    ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan']
    : mode === 'webgpu'
    ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const b = await chromium.launch({
  executablePath: process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: !process.env.HEADED,
  args,
  ...(gpuOn ? gpuLaunch() : {}),
});
const errs = [];
const failures = [];
const viewport = { width: Number(process.env.R3D_W) || 1280, height: Number(process.env.R3D_H) || 768 };

/** A new page on `url`; its console problems go to `errs` tagged with `tag` (the loss run expects device-lost noise). */
async function open(url, tag, lose = false) {
  const p = await b.newPage({ viewport });
  p.on('pageerror', (e) => errs.push(`${tag}: ${e.message}`));
  p.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !(lose && t.includes('Device Lost'))) errs.push(`${tag}: ${t}`);
    if (m.type() === 'warning' && !lose && /device lost/i.test(t)) errs.push(`${tag}: ${t}`);
    if (m.type() === 'warning' && /^3D model /.test(t)) errs.push(`${tag}: ${t}`);
  });
  await p.goto(url);
  await p.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 40000 });
  return p;
}

/** Waits until every model in `need` (and `skull` when asked) is built and the set of built models stayed the same for 1.5 s. */
async function built(p, need, skull = false, timeout = 90000) {
  const t0 = Date.now();
  let last = '';
  let since = Date.now();
  for (;;) {
    const keys = await p.evaluate(() => Object.keys(window.__r3d.models?.builtMs ?? {}).sort().join(','));
    const has = need.every((k) => keys.split(',').includes(k)) && (!skull || keys.split(',').includes('skull'));
    if (keys !== last) { last = keys; since = Date.now(); }
    if (has && Date.now() - since > 1500) return keys;
    if (Date.now() - t0 > timeout) throw new Error(`timeout: models built so far: ${keys || 'none'}`);
    await p.waitForTimeout(250);
  }
}

async function snap(p, name) {
  if (process.env.HIDE !== '0') await p.evaluate(() => { const t = document.querySelector('.r3d-toggle'); if (t && t.textContent === 'Hide') t.click(); });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/${name}.png` });
  if (process.env.READBACK) {
    const url = await p.evaluate(async () => {
      const r = await window.__r3d.readback?.();
      if (!r) return null;
      const c = document.createElement('canvas');
      c.width = r.w;
      c.height = r.h;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
      return c.toDataURL('image/png');
    });
    if (url) writeFileSync(`${out}/${name}-readback.png`, Buffer.from(url.split(',')[1], 'base64'));
    else errs.push(`${name}: readback returned nothing`);
  }
}

const first = await open(`${base}?r3d=gallery&zoom=2`, 'start');
console.log(`backend: ${await first.evaluate(() => window.__r3d.backend)}`);
if (gpuOn) await printGpu(first);
await first.close();

for (const s of shots) {
  if (only && !only.test(s.name)) continue;
  const t0 = Date.now();
  try {
    const p = await open(`${base}?r3d=${s.page ?? 'gallery'}${s.q}`, s.name);
    const keys = await built(p, s.need, s.skull);
    if (s.wait) await p.waitForTimeout(s.wait);
    await p.waitForTimeout(800);
    await snap(p, s.name);
    const m = await p.evaluate(() => window.__r3d.models ?? null);
    console.log(`${s.name}: ${((Date.now() - t0) / 1000).toFixed(1)} s, built ${keys || 'nothing'}${m ? `, drew ${m.figures} figures in ${m.batches} batches, ${m.draws} draws` : ''}`);
    await p.close();
  } catch (e) {
    failures.push(`${s.name}: ${e.message}`);
    errs.push(`${s.name}: ${e.message}`);
  }
}

// A lost device: the stage's kit lives on, so the new view's layer draws from the models already built, which are not built again.
if (!only || only.test('lose')) {
  try {
    const p = await open(`${base}?r3d=gallery&focus=models&zoom=3&state=idle${STILL}`, 'lose', true);
    await built(p, ALL);
    await snap(p, 'lose-before');
    const before = await p.evaluate(() => JSON.stringify(window.__r3d.models.builtMs));
    const forced = await p.evaluate(() => window.__r3d.forceLoss());
    console.log(`lose: forceLoss() returned ${forced}`);
    const f0 = await p.evaluate(() => window.__r3d.frames);
    await p.waitForFunction((n) => window.__r3d.frames >= n + 10, f0, { timeout: 30000 });
    await p.waitForTimeout(1500);
    const after = await p.evaluate(() => ({ builtMs: JSON.stringify(window.__r3d.models.builtMs), drawn: window.__r3d.models.figures }));
    await snap(p, 'lose-after');
    console.log(`lose: ${after.drawn} figures drawn after the loss; models rebuilt: ${before === after.builtMs ? 'no (same build times)' : 'YES'}`);
    if (before !== after.builtMs) errs.push('lose: the models were built again after the loss');
    if (!(after.drawn >= 9)) errs.push(`lose: only ${after.drawn} figures drawn after the loss`);
    await p.close();
  } catch (e) {
    errs.push(`lose: ${e.message}`);
  }
}

console.log(errs.join('\n') || 'no browser errors');
await b.close();
if (errs.length) process.exit(1);
