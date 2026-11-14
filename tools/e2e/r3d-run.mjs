// Headless check of a real run in the 3D view (?r3d): one debug e2e_* account opens a debug room for the level, starts it,
// waits for drawn frames, walks the hero, switches to the free camera and checks the chunk culling on the dungeon.
// Usage: node r3d-run.mjs [baseUrl] [outDir] [dungeon|woodland]
// Frame rate (woodland): FPS_S=10 [FPS_ONLY=1] BACKEND=webgpu|webgl R3D_W=2560 R3D_H=1280 R3D_QUERY="&quality=high" GPU=uncapped WAIT_MS=... (see the sampling block).
// Set BROWSER to a Chrome/Edge executable (e.g. /usr/bin/brave-browser). GPU=1: a visible window on the discrete card, printing the GPU in use (GPU=uncapped: no frame limit). The account is deleted at the end, also on failure.
import { chromium } from 'playwright-core';
import { tag, markDebug, login, createCharacter, deleteAccount } from './account.mjs';
import { gpuLaunch, gpuOn, printGpu } from './gpu.mjs';

const base = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'shots';
const level = (process.argv[4] ?? 'dungeon').toLowerCase();
const browser = await chromium.launch({
  executablePath: process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  // GPU=1 (or GPU=uncapped): a visible window on the discrete card with the notebook's start line (gpu.mjs).
  ...(gpuOn ? gpuLaunch() : {}),
});
const errors = [];
const account = `e2e_${tag()}`;
// R3D_W / R3D_H: the window (1280x768). BACKEND=webgpu: the page picks WebGPU (default: WebGL2). FPS_S=10: the frame-rate measurement (below).
const viewport = { width: Number(process.env.R3D_W) || 1280, height: Number(process.env.R3D_H) || 768 };
const page = await (await browser.newContext({ viewport })).newPage();
// Frame-rate bookkeeping, from the first script of the page: every requestAnimationFrame interval, and the draw calls and triangles
// the context submits (all passes: depth, colour, sun). WebGL2 and WebGPU are both hooked.
await page.addInitScript(() => {
  const perf = { t: [], dt: [], calls: 0, tris: 0 };
  window.__perf = perf;
  let last = performance.now();
  const loop = (t) => { perf.t.push(t); perf.dt.push(t - last); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  const tri = (mode, n, inst = 1) => { perf.calls++; if (mode === 4) perf.tris += (n / 3) * inst; };
  for (const [name, f] of [
    ['drawElements', (mode, n) => tri(mode, n)], ['drawElementsInstanced', (mode, n, _t, _o, i) => tri(mode, n, i)],
    ['drawArrays', (mode, _f, n) => tri(mode, n)], ['drawArraysInstanced', (mode, _f, n, i) => tri(mode, n, i)],
  ]) {
    const orig = WebGL2RenderingContext.prototype[name];
    WebGL2RenderingContext.prototype[name] = function (...a) { f(...a); return orig.apply(this, a); };
  }
  if (typeof GPURenderPassEncoder !== 'undefined') {
    for (const name of ['draw', 'drawIndexed']) {
      const orig = GPURenderPassEncoder.prototype[name];
      GPURenderPassEncoder.prototype[name] = function (n, inst = 1, ...r) { perf.calls++; perf.tris += (n / 3) * inst; return orig.call(this, n, inst, ...r); };
    }
  }
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
// The first /api/me before logging in is an expected 401.
page.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(`console: ${m.text()}`));
// A lost device is only a console warning (host.ts); unless the script loses it on purpose below, it is a failure.
let losing = false;
page.on('console', (m) => m.type() === 'warning' && /device lost/i.test(m.text()) && !losing && errors.push(`device lost: ${m.text()}`));
// A minimal MessagePack reader for the frames the page sends: an Input goes out as a bare array [seq, mx, my, aim, aim_dist, primary, ...].
function unpack(buf) {
  let p = 0;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const str = (n) => { const s = buf.toString('utf8', p, p + n); p += n; return s; };
  const arr = (n) => Array.from({ length: n }, one);
  const map = (n) => { const o = {}; for (let i = 0; i < n; i++) { const k = one(); o[k] = one(); } return o; };
  function one() {
    const b = buf[p++];
    if (b < 0x80) return b;
    if (b >= 0xe0) return b - 256;
    if (b >= 0xa0 && b < 0xc0) return str(b & 0x1f);
    if (b >= 0x90 && b < 0xa0) return arr(b & 0x0f);
    if (b >= 0x80 && b < 0x90) return map(b & 0x0f);
    const take = (n, f) => { const r = f(p); p += n; return r; };
    switch (b) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xca: return take(4, (o) => v.getFloat32(o));
      case 0xcb: return take(8, (o) => v.getFloat64(o));
      case 0xcc: return take(1, (o) => v.getUint8(o));
      case 0xcd: return take(2, (o) => v.getUint16(o));
      case 0xce: return take(4, (o) => v.getUint32(o));
      case 0xcf: return take(8, (o) => Number(v.getBigUint64(o)));
      case 0xd0: return take(1, (o) => v.getInt8(o));
      case 0xd1: return take(2, (o) => v.getInt16(o));
      case 0xd2: return take(4, (o) => v.getInt32(o));
      case 0xd3: return take(8, (o) => Number(v.getBigInt64(o)));
      case 0xd9: return str(take(1, (o) => v.getUint8(o)));
      case 0xda: return str(take(2, (o) => v.getUint16(o)));
      case 0xdc: return arr(take(2, (o) => v.getUint16(o)));
      case 0xde: return map(take(2, (o) => v.getUint16(o)));
      default: throw new Error(`msgpack byte ${b}`);
    }
  }
  return one();
}
const sentInputs = []; // decoded Input arrays, in order
page.on('websocket', (ws) => ws.on('framesent', (f) => {
  if (typeof f.payload === 'string') return;
  try {
    const m = unpack(f.payload);
    if (Array.isArray(m) && typeof m[0] === 'number' && m.length >= 9) sentInputs.push(m);
  } catch { /* other messages are not read here */ }
}));
// The woodland's trees draw slowly in software (a few frames a second): the walk and the click get longer to be seen (the real GPU needs none of it).
const slow = level === 'woodland' && !gpuOn ? 4 : 1;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z); // window.__r3d.hero / cam are {x, z} in tiles
const r3d = () => page.evaluate(() => ({ hero: window.__r3d?.hero, cam: window.__r3d?.cam, chunks: window.__r3d?.chunks, frames: window.__r3d?.frames, figures: window.__r3d?.figures }));
let registered = false;

try {
  await page.goto(`${base}?r3d${process.env.BACKEND === 'webgpu' ? '' : '&backend=webgl'}${process.env.R3D_QUERY ?? ''}`); // R3D_QUERY: more page parameters, e.g. "&shadows=0&hour=14"
  await page.bringToFront();
  await page.waitForSelector('#auth-name');
  await login(page, account, true);
  registered = true;
  await markDebug(base, account); // no WebSocket yet, so the connection reads the new flag
  await createCharacter(page, `Hero${tag()}`, 'Paladin');
  await page.click('#to-dungeon');
  await page.waitForSelector('#runname');
  await page.fill('#runname', 'R3D Run');
  await page.click('#create');
  await page.waitForSelector('.players li');
  if (level === 'woodland') {
    await page.click('.level-card.level-woodland');
    await page.waitForSelector('.level-card.level-woodland.selected');
  }
  await page.click('#start');
  await page.waitForSelector('#game.active', { timeout: 10000 });
  await page.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 60000 });
  if (gpuOn) await printGpu(page);
  const t0 = await page.evaluate(() => performance.now()); // the build window starts here
  // The woodland's trees are grown a few per frame: wait until the F3 line `plants <built> of <total>` shows them all (WAIT_MS: the time allowed, default 120 s).
  if (level === 'woodland') {
    await page.keyboard.press('F3');
    const read = () => page.evaluate(() => { const m = /plants\s+(\d+) of (\d+)/.exec(document.body.innerText); return m ? [Number(m[1]), Number(m[2])] : null; });
    const until = Date.now() + Number(process.env.WAIT_MS || 120000);
    let n = await read();
    // On the real GPU all of them; in software (about 2 frames a second, a tree or two a frame) the wait is only pacing: the nearest 40 trees (a chunk's worth), the forest still growing.
    const need = (m) => (gpuOn ? m[1] : Math.min(40, m[1])); // first guess: 40
    while ((!n || n[0] < need(n)) && Date.now() < until) { await page.waitForTimeout(500); n = await read(); }
    console.log(`trees built ${n ? `${n[0]} of ${n[1]}` : 'unknown (no F3 plants line)'}`);
    if (!n || n[0] < need(n)) errors.push(`the forest was not built in time: ${n ? `${n[0]} of ${n[1]}` : 'no F3 plants line'}`);
    const t1 = await page.evaluate(() => performance.now());
    // The build: the time from the first frames to the last tree, and the longest frame in it (the hitch).
    const build = await page.evaluate(([a, b]) => {
      const dts = window.__perf.dt.filter((_, i) => window.__perf.t[i] >= a && window.__perf.t[i] <= b);
      return { frames: dts.length, longest: Math.max(0, ...dts) };
    }, [t0, t1]);
    console.log(`forest build: ${((t1 - t0) / 1000).toFixed(1)} s from the first frames, ${build.frames} frames, longest frame ${build.longest.toFixed(1)} ms`);
    await page.keyboard.press('F3');
  }
  // FPS_S=10: sample requestAnimationFrame for that many seconds (F3 off), then print the mean, the 1 % low, the draw calls and triangles per frame
  // (all passes) and the F3 block. With FPS_ONLY=1 the run ends after this and the picture r3d-run-<level>-fps.png.
  if (process.env.FPS_S) {
    await page.waitForTimeout(1000);
    const a = await page.evaluate(() => ({ now: performance.now(), calls: window.__perf.calls, tris: window.__perf.tris }));
    await page.waitForTimeout(Number(process.env.FPS_S) * 1000);
    const m = await page.evaluate((a) => {
      const p = window.__perf, now = performance.now();
      const dts = p.dt.filter((_, i) => p.t[i] >= a.now).sort((x, y) => y - x);
      const worst = dts.slice(0, Math.max(1, Math.ceil(dts.length / 100)));
      const stalls = p.dt.map((d, i) => [d, p.t[i] - a.now]).filter(([d, t]) => t >= 0 && d > 200).map(([d, t]) => `${d.toFixed(0)} ms at +${(t / 1000).toFixed(1)} s`);
      const median = dts[Math.floor(dts.length / 2)];
      return { n: dts.length, secs: (now - a.now) / 1000, worst: worst.reduce((s, v) => s + v, 0) / worst.length, max: dts[0], median, stalls, calls: p.calls - a.calls, tris: p.tris - a.tris };
    }, a);
    console.log(`median frame ${m.median.toFixed(1)} ms (${(1000 / m.median).toFixed(0)} fps); frames over 200 ms: ${m.stalls.join(', ') || 'none'}`);
    console.log(`fps ${(m.n / m.secs).toFixed(1)} mean over ${m.secs.toFixed(1)} s (${m.n} frames), 1% low ${(1000 / m.worst).toFixed(1)} fps, longest frame ${m.max.toFixed(1)} ms; per frame ${(m.calls / m.n).toFixed(0)} draw calls and ${(m.tris / m.n / 1000).toFixed(0)}k triangles (all passes)`);
    await page.keyboard.press('F3');
    await page.waitForTimeout(1500);
    console.log(`F3:\n${await page.evaluate(() => [...document.querySelectorAll('body *')].map((e) => e.children.length === 0 ? e.innerText : '').find((t) => /^FPS/.test(t)) ?? document.body.innerText.slice(0, 600))}`);
    await page.screenshot({ path: `${out}/r3d-run-${level}-fps.png` });
    await page.keyboard.press('F3');
    if (process.env.FPS_ONLY) throw Object.assign(new Error('FPS_ONLY'), { quiet: true });
  }
  // The 3D canvas, plus the overlay canvas over it (#311).
  if ((await page.locator('#game canvas.r3d').count()) !== 1) errors.push('expected exactly one 3D canvas in #game');
  if ((await page.locator('#game canvas.r3d-overlay').count()) !== 1) errors.push('expected exactly one overlay canvas in #game');
  if ((await page.locator('#game canvas').count()) !== 2) errors.push('expected exactly two canvases in #game (3D and overlay)');
  await page.screenshot({ path: `${out}/r3d-run-${level}.png` });
  const figures = (await r3d()).figures;
  console.log(`figures drawn ${figures}`);
  if (!(figures >= 1)) errors.push(`no figure drawn (window.__r3d.figures = ${figures})`);

  // Hold D: the hero walks.
  const h0 = (await r3d()).hero;
  if (!h0) errors.push('window.__r3d.hero is not set in a run');
  await page.keyboard.down('d');
  await page.waitForTimeout(2000 * slow);
  await page.keyboard.up('d');
  const h1 = (await r3d()).hero;
  if (h0 && h1) {
    const moved = dist(h0, h1);
    console.log(`hero moved ${moved.toFixed(2)} tiles`);
    if (!(moved > 1)) errors.push(`the hero moved only ${moved.toFixed(2)} tiles holding D`);
  }

  // F: the free camera. D now moves the camera, not the hero.
  const before = await r3d();
  await page.keyboard.press('f');
  await page.keyboard.down('d');
  await page.waitForTimeout(1000);
  await page.keyboard.up('d');
  const after = await r3d();
  if (before.cam && after.cam) {
    const camMoved = dist(before.cam, after.cam);
    const heroMoved = dist(before.hero, after.hero);
    console.log(`free camera moved ${camMoved.toFixed(2)} tiles, hero ${heroMoved.toFixed(2)}`);
    if (!(camMoved > 0.01)) errors.push('the free camera did not move');
    if (heroMoved > 0.2) errors.push(`the hero moved ${heroMoved.toFixed(2)} tiles under the free camera`);
  } else errors.push('window.__r3d.cam is not set in a run');
  await page.screenshot({ path: `${out}/r3d-run-${level}-free.png` });

  await page.keyboard.press('f'); // back to the follow camera

  // Mouse over the canvas: Z turns the camera 45 degrees, X goes back north; a left click sends a primary.
  const state = () => page.evaluate(() => ({ yaw: window.__r3d?.yaw, overlay: window.__r3d?.overlay }));
  await page.mouse.move(760, 330);
  await page.keyboard.press('z');
  // The turn is eased by frame time (dt is clamped), so slow software frames stretch it: wait for the target, not a fixed time.
  await page.waitForFunction(() => window.__r3d?.yaw === 45, null, { timeout: 5000 * slow }).catch(() => {});
  const yawZ = (await state()).yaw;
  console.log(`yaw after Z ${yawZ}`);
  if (yawZ !== 45) errors.push(`yaw after Z is ${yawZ}, expected 45`);
  await page.screenshot({ path: `${out}/r3d-run-${level}-turned.png` });
  await page.keyboard.press('x');
  await page.waitForFunction(() => window.__r3d?.yaw === 0, null, { timeout: 5000 * slow }).catch(() => {});
  const yawX = (await state()).yaw;
  console.log(`yaw after X ${yawX}`);
  if (yawX !== 0) errors.push(`yaw after X is ${yawX}, expected 0`);
  const overlay = (await state()).overlay;
  console.log(`overlay items ${overlay}`);
  // The dungeon has the neutral knight (a name and a bar) near the start; the woodland start has no creature in sight.
  if (level === 'dungeon' && !(overlay >= 1)) errors.push(`the overlay painted no item (window.__r3d.overlay = ${overlay})`);
  const mark = sentInputs.length;
  await page.mouse.move(800, 300);
  await page.mouse.down();
  await page.waitForTimeout(300 * slow);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const shots = sentInputs.slice(mark).filter((m) => m[5] != null);
  console.log(`primary inputs after the click ${shots.length}`);
  if (shots.length === 0) errors.push('a left click sent no primary Input');
  await page.screenshot({ path: `${out}/r3d-run-${level}-aimed.png` });

  if (level === 'woodland') {
    // Review Focus 3: a lost device mid-run brings back the ground, the plants and the sun's target (compare the two pictures).
    await page.screenshot({ path: `${out}/r3d-run-${level}-before-loss.png` });
    losing = true;
    const forced = await page.evaluate(() => window.__r3d.forceLoss());
    console.log(`forceLoss() returned ${forced}`);
    if (forced === false) errors.push('forceLoss() returned false');
    const f0 = (await r3d()).frames;
    try {
      await page.waitForFunction((n) => window.__r3d.frames >= n + 10, f0, { timeout: 30000 });
    } catch {
      errors.push('timeout: no 10 more frames within 30 s after the loss');
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/r3d-run-${level}-after-loss.png` });
    losing = false;
  }

  if (level === 'dungeon') {
    const { chunks } = after;
    console.log(`chunks drawn ${chunks?.drawn} of ${chunks?.total}`);
    if (!chunks || !(chunks.drawn < chunks.total)) errors.push(`chunk culling: drawn ${chunks?.drawn} of ${chunks?.total}`);
  }
} catch (e) {
  if (!e.quiet) errors.push(`failed: ${e.message.split('\n')[0]}`);
} finally {
  if (registered) {
    const status = await deleteAccount(page).catch((e) => `error ${e.message}`);
    if (status !== 204) errors.push(`deleting ${account}: ${status}`);
  }
  await browser.close();
}
console.log(errors.length ? errors.join('\n') : 'no browser errors');
if (errors.length) process.exit(1);
