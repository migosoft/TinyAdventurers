// Check shots of the 3D figure models (#338) in the ?r3d=gallery and ?r3d=woodland&models=1 pages: every model kind in the states idle,
// move, melee, shoot, cast, windup and dash, the effect block, the torch light, the dying figures' skulls, the crowd as models and as
// cards, the woodland at hour 9.5 and 18.5, and a lost device. Fails on any console error, any "3D model" build warning and any
// lost-device warning (but in the `lose` run, where the loss is on purpose).
// Usage: node models-shots.mjs [baseUrl] [outDir] [mode]     mode: webgl (default, SwiftShader GL) or webgpu (SwiftShader Vulkan)
// Env: BROWSER (the executable), HEADED=1 (a visible window; with mode webgpu on the real GPU),
//      GPU=1 (a visible window on the real GPU with the notebook's start line, gpu.mjs; headless SwiftShader loses the WebGPU device),
//      READBACK=1 (also saves <name>-readback.png: the frame re-drawn off-screen and read back, for WebGPU), R3D_W / R3D_H (1280x768),
//      ONLY=<regex> (only shots whose name matches), HIDE=0 (keep the panel on), QUALITY=<high|balanced|fast> (appends &quality= to every URL).
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
  ['wizard', 'wizard'], ['paladin', 'knight'], ['barbarian', 'dwarf'], ['ranger', 'elf'], ['goblin', 'goblin'],
  ['skelwarrior', 'skelet'], ['skelarcher', 'skelet'], ['orcwarrior', 'orc'], ['orcarcher', 'orc'], ['necromancer', 'necromancer'],
  ['raisedskel', 'skelet'], ['disciple', 'disciple'], ['imp', 'imp'], ['chort', 'chort'], ['summoner', 'summoner'], ['ogre', 'ogre'], ['wolf', 'wolf'],
  ['ghost', 'ghost'], ['shade', 'shade'], ['npcknight', 'npcKnight'], ['bunny', 'bunny'], ['deer', 'deer'], ['stag', 'stag'], ['boar', 'boar'],
];
/** A kind's row in the gallery's model rows (they wrap, so a position is looked up by name, never counted). */
const row = (name) => {
  const i = KINDS.findIndex((k) => k[0] === name);
  if (i < 0) throw new Error(`models-shots: no kind named ${name}`);
  return i;
};
const ALL = ['wizard', 'knight', 'dwarf', 'elf', 'skelet', 'ogre', 'wolf', 'stag', 'deer', 'boar', 'bunny', 'goblin', 'orc', 'npcKnight', 'necromancer', 'summoner', 'disciple', 'imp', 'chort', 'ghost', 'shade'];
/** The woodland page's line-up: the seven figures it places, no animals. */
const WOODLAND = ['wizard', 'knight', 'dwarf', 'elf', 'skelet', 'ogre', 'wolf'];
/** The animals (#357); their rows are looked up by name with `row()`. */
const ANIMALS = ['bunny', 'deer', 'stag', 'boar'];
// A still picture: the clock nearly stopped (slow) at t = 0.6 (past the hurt flash).
const STILL = '&slow=1000&t=0.6';
// A dash leaves copies that fade in 0.25 s of the stage's clock, so a stopped clock would keep the copies of the first frames (drawn as cards
// before the models were built) for ever: a dash runs slowly instead (the copies of the first frames are gone when the picture is taken).
const still = (state) => (state === 'dash' ? '&slow=4&t=0.6' : STILL);

const shots = [];
for (const [i, [name, desc]] of KINDS.entries()) {
  for (const s of STATES) shots.push({ name: `kind-${name}-${s}`, q: `&focus=models&at=model:${i}&zoom=6&state=${s}${still(s)}`, need: [desc], wait: s === 'dash' ? 6000 : 0 });
}
for (const s of STATES) shots.push({ name: `row-${s}`, q: `&focus=models&zoom=2&state=${s}${still(s)}`, need: ALL, wait: s === 'dash' ? 6000 : 0 });
// The small effects (Task 11): the channel swirl, the wolf's bite state and the swing's swoosh from the south (aim 90).
shots.push({ name: 'kind-wizard-channel', q: `&focus=models&at=model:${row('wizard')}&zoom=6&state=channel${STILL}`, need: ['wizard'] });
shots.push({ name: 'kind-wolf-bite', q: `&focus=models&at=model:${row('wolf')}&zoom=6&state=bite${STILL}`, need: ['wolf'] });
shots.push({ name: 'swoosh-paladin-south', q: `&focus=models&at=model:${row('paladin')}&zoom=6&state=melee&aim=90${STILL}`, need: ['knight'] });
shots.push({ name: 'fangs-wolf-south', q: `&focus=models&at=model:${row('wolf')}&zoom=6&state=melee&aim=90${STILL}`, need: ['wolf'] });
// The animals (#357) have their state shots from the loop above; here the swing's reach from the south (aim 90).
for (const [name, i] of ANIMALS.map((n) => [n, row(n)])) {
  shots.push({ name: `kind-${name}-aim`, q: `&focus=models&at=model:${i}&zoom=6&state=melee&aim=90${STILL}`, need: [name] });
}
// The variety block: six animals of each kind in a row, each with its own look from its id (the antlers, tusks, size and coat vary).
// #356 adds four rows: the goblin archer, the orc warrior, the imp and the chort.
for (const [r, [name, desc]] of [['stag', 'stag'], ['deer', 'deer'], ['boar', 'boar'], ['bunny', 'bunny'], ['goblin', 'goblin'], ['orc', 'orc'], ['imp', 'imp'], ['chort', 'chort']].entries()) shots.push({ name: `variety-${name}`, q: `&at=variety:${r}&zoom=4&state=idle${STILL}`, need: [desc] });
// The lamp's own outline of the stag as its shadow.
shots.push({ name: 'torch-light-stag', q: `&at=model:${row('stag')}&light=torch&zoom=6&state=idle${STILL}`, need: ALL });
// The nine two-legged creatures (#356): [row name, description, liquids key, attack state]. Aimed at the camera in the attack state (the
// swoosh or the aimed weapon from the south), each in the torch light of its row, and on the liquids page (wading, the chasm, the lava).
// The Orc Archer wears the orc's model with its bow: the liquids page takes model keys, so its liquids shots are the warrior's (key null).
const HUMANOIDS = [
  ['goblin', 'goblin', 'goblin', 'shoot'], ['orcwarrior', 'orc', 'orc', 'melee'], ['orcarcher', 'orc', null, 'shoot'],
  ['necromancer', 'necromancer', 'necromancer', 'cast'], ['summoner', 'summoner', 'summoner', 'cast'], ['disciple', 'disciple', 'disciple', 'cast'],
  ['imp', 'imp', 'imp', 'cast'], ['chort', 'chort', 'chort', 'melee'], ['npcknight', 'npcKnight', 'npcKnight', 'melee'],
];
for (const [name, desc, key, attack] of HUMANOIDS) {
  shots.push({ name: `aim-${name}`, q: `&focus=models&at=model:${row(name)}&zoom=6&state=${attack}&aim=90${STILL}`, need: [desc] });
  shots.push({ name: `torch-light-${name}`, q: `&at=model:${row(name)}&light=torch&zoom=6&state=idle${STILL}`, need: [desc] });
  if (!key) continue;
  shots.push({ name: `liquids-${key}-wade`, page: 'liquids', q: `&models=${key}&t=4&zoom=3`, need: [desc] });
  shots.push({ name: `liquids-${key}-chasm`, page: 'liquids', q: `&models=${key}&push=chasm&t=1.6&zoom=3`, need: [desc] });
  shots.push({ name: `liquids-${key}-lava`, page: 'liquids', q: `&models=${key}&t=4.5&zoom=3`, need: [desc] });
}
// The animals on the liquids page: wading, the fall into the chasm and the sink into the lava.
for (const name of ANIMALS) {
  shots.push({ name: `liquids-${name}-wade`, page: 'liquids', q: `&models=${name}&t=4&zoom=3`, need: [name] });
  shots.push({ name: `liquids-${name}-chasm`, page: 'liquids', q: `&models=${name}&push=chasm&t=1.6&zoom=3`, need: [name] });
  shots.push({ name: `liquids-${name}-lava`, page: 'liquids', q: `&models=${name}&t=4.5&zoom=3`, need: [name] });
}
// Facing the camera (aim 90: south): the front of the paint (eyes, visor, belt) at its rows.
for (const i of ['wizard', 'paladin', 'barbarian', 'ranger', 'skelwarrior', 'ogre', 'wolf'].map(row)) shots.push({ name: `face-${KINDS[i][0]}`, q: `&focus=models&at=model:${i}&zoom=8&state=idle&aim=90${STILL}`, need: [KINDS[i][1]] });
// The Ghost and the Shade (#359). The spectre block is the gallery's last: places 0 to 2 the Ghost (standing, walking, the life loop), 3 to 5 the
// Shade; the life figure (2, 5) forms for the 0.5 s ambush warning, stands, winds up at 2.75 s and 4.75 s, strikes at 3.0 s and 5.0 s, and dies at 7.0 s.
const SPECTRES = [['ghost', 0, 2], ['shade', 3, 5]]; // [model key, standing place, life place]
const SPOT = '&slow=1000&t=1.7';
// The two trios whole (the Ghost's places 0 to 2 centred on place 1, the Shade's 3 to 5 on place 4), in the work light and the torch light.
for (const [name, place] of [['ghost', 1], ['shade', 4]]) {
  for (const [light, extra] of [['work', ''], ['torch', '&light=torch']]) shots.push({ name: `spectre-trio-${name}-${light}`, q: `&at=spectre:${place}&zoom=4${extra}${SPOT}`, need: [name] });
}
for (let i = 0; i < 6; i++) shots.push({ name: `spectre-place-${i}`, q: `&at=spectre:${i}&zoom=8${SPOT}`, need: [SPECTRES[i < 3 ? 0 : 1][0]] });
// The life loop. The ambush warning is the first 0.5 s (`AMBUSH_WARNING`): the Ghost blinks in 0.06 s steps (on in 0.06-0.12, 0.18-0.24,
// 0.30-0.36, 0.42-0.48), so it is shot at 0.21 and 0.45 (blinked on) and once at 0.4 (blinked off, named so); the Shade forms (fog pool,
// fog risen with the body fading in, the eyes lighting last) at 0.15, 0.35 and 0.47. Then the blow (3.1) and the death (7.3).
const LIFE = { ghost: ['0.21', '0.45', 'blinkoff-0.4', '3.1', '7.3'], shade: ['0.15', '0.35', '0.47', '3.1', '7.3'] };
for (const [key, , life] of SPECTRES) {
  for (const label of LIFE[key]) shots.push({ name: `spectre-life-${key}-${label}`, q: `&at=spectre:${life}&zoom=8&slow=1000&t=${label.replace('blinkoff-', '')}`, need: [key] });
}
// The eyes from the front (aim 90 faces the camera) and from the side (aim 0), close; in the work light and in the torch light.
for (const [key, stand] of SPECTRES) {
  for (const [light, extra] of [['work', ''], ['torch', '&light=torch']]) {
    for (const [side, aim] of [['front', 90], ['side', 0]]) shots.push({ name: `spectre-close-${key}-${side}-${light}`, q: `&at=spectre:${stand}&zoom=16&aim=${aim}${extra}${SPOT}`, need: [key] });
  }
}
// The pillar torches hang over the walkers (places 1 and 4): the Shade as a hole in front of the lit wall, the Ghost's own floor light, and the block whole.
for (const [name, place] of [['ghost', 1], ['shade', 4]]) shots.push({ name: `spectre-torch-${name}-walk`, q: `&at=spectre:${place}&zoom=8&light=torch${SPOT}`, need: [name] });
// The effect rows at columns 12 (Ghost) and 13 (Shade): asleep, stone, frozen, poisoned, invisible.
for (const [name, effRow] of [['asleep', 0], ['stone', 1], ['frozen', 2], ['poisoned', 4], ['invisible', 8]]) shots.push({ name: `spectre-effects-${name}`, q: `&at=effect:${effRow},12&zoom=6${STILL}`, need: ['ghost', 'shade'] });
// The liquids page with the spectre playing every role: wading, the chasm, the lava.
for (const key of ['ghost', 'shade']) {
  shots.push({ name: `spectre-liquids-${key}-wade`, page: 'liquids', q: `&models=${key}&t=4&zoom=3`, need: [key] });
  shots.push({ name: `spectre-liquids-${key}-chasm`, page: 'liquids', q: `&models=${key}&push=chasm&t=1.6&zoom=3`, need: [key] });
  shots.push({ name: `spectre-liquids-${key}-lava`, page: 'liquids', q: `&models=${key}&t=4.5&zoom=3`, need: [key] });
}
// The size line-up (#356): both halves, and the two spectres side by side (the Shade at place 16, the Ghost at 18).
for (const place of [4, 14, 17]) shots.push({ name: `spectre-lineup-${place}`, q: `&focus=lineup&at=lineup:${place}&zoom=3&state=idle${STILL}`, need: ['ghost', 'shade'] });
// Column 10 is the Imp, between the Necromancer (9) and the Knight (11) (#356): the three new kinds in view.
for (const [name, effRow] of [['asleep', 0], ['top', 1], ['frozen', 2], ['middle', 4], ['bottom', 7]]) shots.push({ name: `effects-${name}`, q: `&at=effect:${effRow},10&zoom=3${STILL}`, need: ALL });
// The pinned states above never reach the end of the unpinned state cycle (take-off and landing, which only the dragon has frames for):
// this shot lets the clock run through them (stage time 12.5 to 16 s) and any "3D frame failed" error fails the run.
shots.push({ name: 'state-cycle', q: '&focus=models&zoom=2&t=12.5&slow=1', need: ALL, until: 16 });
shots.push({ name: 'torch-light', q: `&focus=models&light=torch&zoom=2&state=idle${STILL}`, need: ALL });
// The pillar torches light every kind of a row: the first, a middle and the last column of the first row.
for (const c of [0, 5, 10]) shots.push({ name: `torch-light-col${c}`, q: `&at=model:${c}&light=torch&zoom=6&state=idle${STILL}`, need: ALL });
shots.push({ name: 'torch-light-close', q: `&at=model:${row('ranger')}&light=torch&zoom=6&state=idle${STILL}`, need: ALL });
shots.push({ name: 'dying-skulls', q: '&at=dying:4&zoom=3&t=1.5&slow=2', need: ALL, skull: true });
shots.push({ name: 'crowd-models', q: '&crowd=40&at=crowd:20&zoom=3&slow=1000&t=0.6', need: ALL, readout: true });
shots.push({ name: 'crowd-cards', q: '&crowd=40&crowdAs=cards&at=crowd:20&zoom=3&slow=1000&t=0.6', need: [], readout: true });
shots.push({ name: 'crowd-models-many', q: '&crowd=184&at=crowd:90&zoom=2&slow=1000&t=0.6', need: ALL, readout: true });
for (const hour of ['9.5', '18.5']) shots.push({ name: `woodland-${hour}`, page: 'woodland', q: `&models=1&hour=${hour}&hourRate=0&zoom=3`, need: WOODLAND, wait: 4000 });

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
// GPU=1 launches one start line for both modes: the page's own `backend` parameter then picks WebGL2 (webgl) or WebGPU (auto).
const urlExtra = (gpuOn && mode === 'webgl' ? '&backend=webgl' : '') + (process.env.QUALITY ? `&quality=${process.env.QUALITY}` : '');
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
  await p.goto(url + urlExtra);
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

/** The dying row is dead (and its skulls lie) in the second half of every 6 s of the gallery's clock: waits for it, and fails loudly if the clock is past it (the figures are back). */
async function inDeadHalf(p) {
  for (let i = 0; i < 240; i++) {
    const t = await p.evaluate(() => window.__r3d.models?.t);
    if (t === undefined) throw new Error('dying-skulls: the stage publishes no clock');
    const ph = t % 6;
    if (ph >= 3.3 && ph < 5.5) return;
    if (ph >= 5.5 || (t >= 6 && ph < 3)) throw new Error(`dying-skulls: the clock (${t.toFixed(2)} s) is past the dead half, the figures are back`);
    await p.waitForTimeout(250);
  }
  throw new Error('dying-skulls: the clock never reached the dead half');
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
  let p = null;
  let cap = null;
  try {
    // One shot may take at most 4 minutes (a page of software-rendered frames can stall).
    await Promise.race([
      (async () => {
        p = await open(`${base}?r3d=${s.page ?? 'gallery'}${s.q}`, s.name);
        const keys = await built(p, s.need, s.skull);
        if (s.skull) await inDeadHalf(p);
        if (s.until) {
          for (let i = 0; i < 800 && !((await p.evaluate(() => window.__r3d.models?.t)) >= s.until); i++) await p.waitForTimeout(250);
          if (!((await p.evaluate(() => window.__r3d.models?.t)) >= s.until)) throw new Error(`the clock never reached ${s.until} s`);
        }
        if (s.wait) await p.waitForTimeout(s.wait);
        await p.waitForTimeout(800);
        await snap(p, s.name);
        const m = await p.evaluate(() => window.__r3d.models ?? null);
        console.log(`${s.name}: ${((Date.now() - t0) / 1000).toFixed(1)} s, built ${keys ? keys.split(',').length : 0} models${m ? `, drew ${m.figures} figures, ${m.draws} draws` : ''}`);
      })(),
      new Promise((_, no) => { cap = setTimeout(() => no(new Error('timeout: the shot took more than 4 minutes')), 240000); }),
    ]);
  } catch (e) {
    failures.push(`${s.name}: ${e.message}`);
    errs.push(`${s.name}: ${e.message}`);
  } finally {
    clearTimeout(cap);
    await p?.close().catch(() => {});
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
    if (!(after.drawn >= 13)) errs.push(`lose: only ${after.drawn} figures drawn after the loss`);
    await p.close();
  } catch (e) {
    errs.push(`lose: ${e.message}`);
  }
}

console.log(errs.join('\n') || 'no browser errors');
await b.close();
if (errs.length) process.exit(1);
