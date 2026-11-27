// Headless check of a real run in the 3D view (?r3d): one debug e2e_* account opens a debug room for the level, starts it,
// waits for drawn frames, walks the hero, switches to the free camera and checks the chunk culling on the dungeon.
// It is a debug account, so the debug keys run here too: F4 (darkvision), F9 (immortality) and, with LOG=1, the rules log (L, F8).
// Usage: node r3d-run.mjs [baseUrl] [outDir] [dungeon|woodland]
// Frame rate (woodland): FPS_S=10 [FPS_ONLY=1] [PHASE=walk|turn] [GLPROF=1] [TRACE=file.json] BACKEND=webgpu|webgl R3D_W=2560 R3D_H=1280 R3D_QUERY="&quality=high" GPU=uncapped WAIT_MS=... (see the sampling block). DV=1|2: the run's pictures with darkvision 50 % or 100 % (F4).
// Dungeon: waits (WAIT_MS) for the F3 line `stone <done> of <total>` to be complete and prints `stone painted ...` with the time and the longest frame (#380).
// BOSS=firedemon|icedemon|lich|dragon: picks that boss in the room before the start (the boss decides the dungeon's stone: laid, natural rock, both; default: the room's own Random).
// ZOOM=far|near|start: the mouse wheel zooms to the farthest or closest zoom (or stays at the start zoom) before the pictures and FPS_S, so the pictures and FPS_S use it (#376). It prints the glide's frame times; ZOOM_PASSES=3 zooms there, back and there again (a hitch only in pass 1 is a first-use cost).
// Set BROWSER to a Chrome/Edge executable (e.g. /usr/bin/brave-browser). GPU=1: a visible window on the discrete card, printing the GPU in use (GPU=uncapped: no frame limit). The account is deleted at the end, also on failure.
import { decode } from '../../client/node_modules/@msgpack/msgpack/dist.esm/index.mjs';
import { tag, markDebug, login, createCharacter, deleteAccount, purge } from './account.mjs';
import { launch, gpuOn, printGpu } from './gpu.mjs';
import { VIEWPORT, watchPage, saveReadback, r3dState, backendQuery, waitLoaded, walkTile } from './r3d-page.mjs';

const base = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'shots';
const level = (process.argv[4] ?? 'dungeon').toLowerCase();
const browser = await launch(); // GPU=1 (or GPU=uncapped): a visible window on the discrete card with the notebook's start line (gpu.mjs)
const errors = [];
const account = `e2e_${tag()}`;
// R3D_W / R3D_H: the window (1280x768). BACKEND=webgpu: the page picks WebGPU (default: WebGL2). FPS_S=10: the frame-rate measurement (below).
const viewport = { width: Number(process.env.R3D_W) || VIEWPORT.width, height: Number(process.env.R3D_H) || VIEWPORT.height };
const page = await (await browser.newContext({ viewport })).newPage();
// Frame times for the timed windows (the forest build, the stone paint, the zoom glide, FPS_S): a requestAnimationFrame loop that records only
// while a window is open (`measure(true)` clears and opens it, `measure(false)` closes it). The draw-call and triangle counters wrap the
// context's draw calls and are installed only for FPS_S (WebGL2: drawElements, drawArrays, their Instanced forms and drawRangeElements;
// WebGPU: draw and drawIndexed; not counted: multiDraw* and drawIndirect).
await page.addInitScript((counters) => {
  const perf = { t: [], dt: [], calls: 0, tris: 0, on: false };
  window.__perf = perf;
  let last = performance.now();
  // GLPROF=1 (#437): per frame interval, perf.gl[i] (it goes with perf.dt[i]) holds the count and ms of the WebGL2 calls that can stall or compile
  // ({ calls: { name: [n, ms] } }) and the rarer calls with their sizes (`rare`: new buffers and textures, non-uniform bufferData, texture uploads).
  perf.gl = []; let acc = { calls: {}, rare: [] };
  const loop = (t) => { if (perf.on) { perf.t.push(t); perf.dt.push(t - last); perf.gl.push(acc); } acc = { calls: {}, rare: [] }; last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  if (!counters) return;
  if (counters === 'glprof') {
    const P = WebGL2RenderingContext.prototype;
    const RARE = new Set(['bufferData', 'texImage2D', 'texStorage2D', 'texImage3D', 'texStorage3D', 'texSubImage2D', 'texSubImage3D', 'createBuffer', 'createTexture', 'deleteBuffer', 'deleteTexture', 'createFramebuffer']);
    const sz = (v) => typeof v === 'number' ? v : v?.byteLength ?? v?.width ?? '?';
    for (const name of ['linkProgram', 'compileShader', 'getProgramParameter', 'getShaderParameter', 'bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D',
      'texStorage2D', 'texImage3D', 'texSubImage3D', 'texStorage3D', 'generateMipmap', 'readPixels', 'getError', 'clientWaitSync', 'getBufferSubData',
      'getUniformLocation', 'createBuffer', 'createTexture', 'deleteBuffer', 'deleteTexture', 'createFramebuffer', 'useProgram', 'bindVertexArray']) {
      const orig = P[name];
      P[name] = function (...a) {
        if (perf.on && RARE.has(name) && !(name === 'bufferData' && a[0] === 0x8A11)) acc.rare.push(name === 'bufferData' ? `bufferData(${a[0].toString(16)},${sz(a[1])})` : name.startsWith('tex') ? `${name}(${a.slice(1, 6).map(sz).join(',')})` : name);
        const s = performance.now();
        try { return orig.apply(this, a); } finally { const e = acc.calls[name] ??= [0, 0]; e[0]++; e[1] += performance.now() - s; }
      };
    }
  }
  const tri = (mode, n, inst = 1) => { perf.calls++; if (mode === 4) perf.tris += (n / 3) * inst; };
  for (const [name, f] of [
    ['drawElements', (mode, n) => tri(mode, n)], ['drawElementsInstanced', (mode, n, _t, _o, i) => tri(mode, n, i)],
    ['drawArrays', (mode, _f, n) => tri(mode, n)], ['drawArraysInstanced', (mode, _f, n, i) => tri(mode, n, i)],
    ['drawRangeElements', (mode, _s, _e, n) => tri(mode, n)],
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
}, process.env.GLPROF ? 'glprof' : !!process.env.FPS_S);
const measure = (on) => page.evaluate((on) => { const p = window.__perf; if (on) { p.t.length = 0; p.dt.length = 0; p.gl.length = 0; } p.on = on; }, on);
// A lost device is only a console warning (host.ts); unless the script loses it on purpose below, it is a failure.
let losing = false;
watchPage(page, '', errors, () => losing);
// The frames the page sends are MessagePack: an Input goes out as a bare array [seq, mx, my, aim, aim_dist, primary, ...].
const sentInputs = []; // decoded Input arrays, in order
page.on('websocket', (ws) => ws.on('framesent', (f) => {
  if (typeof f.payload === 'string') return;
  try {
    const m = decode(f.payload);
    if (Array.isArray(m) && typeof m[0] === 'number' && m.length >= 9) sentInputs.push(m);
  } catch { /* other messages are not read here */ }
}));
// The woodland's trees draw slowly in software (a few frames a second): the waits for the turn and the click get longer to be seen (the real GPU needs none of it).
const slow = level === 'woodland' && !gpuOn ? 4 : 1;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z); // window.__r3d.hero / cam are {x, z} in tiles
const r3d = () => r3dState(page);

try {
  await page.goto(`${base}?r3d${backendQuery() && `&${backendQuery()}`}${process.env.R3D_QUERY ?? ''}`); // R3D_QUERY: more page parameters, e.g. "&shadows=0&hour=14"
  await page.bringToFront();
  await page.waitForSelector('#auth-name');
  await login(page, account, true);
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
  if (process.env.BOSS) {
    const short = { lich: 'Vael, the Undying Lich', dragon: 'Ignathrax, the Red Dragon', firedemon: 'Kharzul, Lord of Cinders', icedemon: 'Ysskar, Lord of Rime' }[process.env.BOSS];
    if (!short) throw new Error(`BOSS=${process.env.BOSS}: expected firedemon, icedemon, lich or dragon (not demon)`);
    const card = page.locator('.boss-card', { has: page.locator(`b:text-is("${short}")`) });
    await card.click();
    await page.waitForSelector('.boss-card.selected b:text-is("' + short + '")');
  }
  await page.click('#start');
  await page.waitForSelector('#game.active', { timeout: 10000 });
  await waitLoaded(page);
  await page.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 60000 });
  if (gpuOn) await printGpu(page);
  const t0 = await page.evaluate(() => performance.now()); // the build window starts here
  await measure(true);
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
    await measure(false);
    console.log(`forest build: ${((t1 - t0) / 1000).toFixed(1)} s from the first frames, ${build.frames} frames, longest frame ${build.longest.toFixed(1)} ms`);
    await page.keyboard.press('F3');
  }
  // The dungeon's stone is painted a few units per frame: wait until the F3 line `stone <done> of <total>` shows it all (WAIT_MS as above).
  if (level === 'dungeon') {
    await page.keyboard.press('F3');
    const read = () => page.evaluate(() => { const m = /stone\s+(\d+) of (\d+)/.exec(document.body.innerText); return m ? [Number(m[1]), Number(m[2])] : null; });
    const until = Date.now() + Number(process.env.WAIT_MS || 120000);
    let n = await read();
    // On the real GPU all of it; in software (a unit or two a frame at 15-28 fps) the wait is only pacing: the first 40 units.
    const need = (m) => (gpuOn ? m[1] : Math.min(40, m[1])); // first guess: 40
    // A server that sends no stone bytes never shows the line: give up after a few seconds instead of waiting WAIT_MS (#402).
    const lineBy = Date.now() + 5000;
    while ((!n || n[0] < need(n)) && Date.now() < until && (n || Date.now() < lineBy)) { await page.waitForTimeout(500); n = await read(); }
    if (!n) console.log('no F3 stone line within 5 s: the server sent no stone, nothing to wait for');
    else if (n[0] < need(n)) errors.push(`the stone was not painted in time: ${n[0]} of ${n[1]}`);
    const t1 = await page.evaluate(() => performance.now());
    const paint = await page.evaluate(([a, b]) => Math.max(0, ...window.__perf.dt.filter((_, i) => window.__perf.t[i] >= a && window.__perf.t[i] <= b)), [t0, t1]);
    await measure(false);
    console.log(`stone painted ${n ? `${n[0]} of ${n[1]}` : 'unknown'}: ${((t1 - t0) / 1000).toFixed(1)} s from the first frames, longest frame ${paint.toFixed(1)} ms`);
    await page.keyboard.press('F3');
  }
  // ZOOM=far|near|start (#376): send 40 wheel notches over the canvas, wait until the zoom is within 1 % of the limit, then check it.
  if (process.env.ZOOM) {
    const want = process.env.ZOOM;
    const lim = await page.evaluate(() => window.__r3d.zoomRange); // the host's start zoom and limits for this canvas
    const start = lim.start;
    const expected = want === 'far' ? lim.min : want === 'near' ? lim.max : start;
    // ZOOM_PASSES=3: zoom to the limit, back to the other limit, and to the limit again, measuring each glide (a hitch only in the first pass is a first-use cost).
    const passes = want === 'start' ? 0 : Number(process.env.ZOOM_PASSES || 1);
    for (let pass = 0; pass < passes; pass++) {
      const out = (want === 'far') === (pass % 2 === 0);
      const target = out ? lim.min : lim.max;
      await measure(true);
      const g0 = await page.evaluate(() => performance.now());
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      for (let i = 0; i < 40; i++) {
        await page.mouse.wheel(0, out ? 100 : -100);
        await page.waitForTimeout(50);
      }
      // The glide follows the notches; wait until it has arrived (the check below reports a miss).
      await page.waitForFunction((e) => Math.abs(window.__r3d.zoom - e) <= 0.01 * e, target, { timeout: 30000 }).catch(() => {});
      if (passes > 1) process.stdout.write(`pass ${pass + 1} (${out ? 'out' : 'in'}) `);
      // The frames of the glide (the render target is rebuilt while the zoom changes): median and longest.
      const g = await page.evaluate((g0) => {
        const p = window.__perf, dts = p.dt.filter((_, i) => p.t[i] >= g0).sort((x, y) => x - y);
        const slow = p.dt.map((d, i) => [d, p.t[i] - g0]).filter(([d, t]) => t >= 0 && d > 33).map(([d, t]) => `${d.toFixed(0)} ms at +${(t / 1000).toFixed(2)} s`);
        return { n: dts.length, median: dts[Math.floor(dts.length / 2)] ?? 0, p99: dts[Math.floor(dts.length * 0.99)] ?? 0, max: dts[dts.length - 1] ?? 0, slow };
      }, g0);
      await measure(false);
      console.log(`glide: ${g.n} frames, median ${g.median.toFixed(1)} ms, 99th ${g.p99.toFixed(1)} ms, longest ${g.max.toFixed(1)} ms; over 33 ms: ${g.slow.join(', ') || 'none'}`);
    }
    const zoom = await page.evaluate(() => window.__r3d.zoom);
    console.log(`zoom ${zoom.toFixed(3)} (expected ${expected.toFixed(3)}, start ${start}, limits ${lim.min.toFixed(3)} to ${lim.max.toFixed(3)})`);
    if (Math.abs(zoom - expected) > 0.01 * expected) errors.push(`zoom ${zoom} is not within 1 % of ${expected} (${want})`);
    const scroll = await page.evaluate(() => [window.scrollY, document.scrollingElement.scrollTop]);
    if (scroll[0] !== 0 || scroll[1] !== 0) errors.push(`the page scrolled: ${scroll}`);
  }
  // FPS_S=10: sample requestAnimationFrame for that many seconds (F3 off), then print the mean, the 1 % low, the draw calls and triangles per frame
  // (all passes) and the F3 block. With FPS_ONLY=1 the run ends after this and the picture r3d-run-<level>-fps.png.
  if (process.env.FPS_S) {
    await page.waitForTimeout(1000);
    // PHASE=walk|turn (#437): D held, or Z and X in turn every 0.5 s, during the window (default: standing). TRACE=<file.json>: a Chrome trace of
    // the window (TRACE_CATS: comma-separated categories). GLPROF=1: after the window, every frame over 33 ms with its WebGL2 calls, and every frame
    // with a rare call (a new buffer or texture, a non-uniform upload).
    const phase = process.env.PHASE ?? 'stand';
    if (process.env.TRACE) await browser.startTracing(page, { path: process.env.TRACE, screenshots: false, categories: (process.env.TRACE_CATS ?? 'devtools.timeline,disabled-by-default-devtools.timeline,v8,v8.execute,blink,cc,gpu,viz,toplevel,disabled-by-default-v8.gc,blink.user_timing').split(',') });
    if (phase === 'walk') await page.keyboard.down('d');
    await measure(true);
    const a = await page.evaluate(() => ({ now: performance.now(), calls: window.__perf.calls, tris: window.__perf.tris }));
    if (phase === 'turn') for (let i = 0; i < Number(process.env.FPS_S) * 2; i++) { await page.keyboard.press(i % 4 < 2 ? 'z' : 'x'); await page.waitForTimeout(500); }
    else await page.waitForTimeout(Number(process.env.FPS_S) * 1000);
    if (phase === 'walk') await page.keyboard.up('d');
    if (process.env.TRACE) await browser.stopTracing();
    if (process.env.GLPROF) {
      const long = await page.evaluate((a) => {
        const p = window.__perf, f = (o) => Object.entries(o.calls).map(([k, [n, ms]]) => `${k} ${n}/${ms.toFixed(1)}`).join(' ');
        const typical = p.gl.slice(-60, -1).map((o) => Object.values(o.calls).reduce((s, [, ms]) => s + ms, 0));
        const out = [`typical gl ms per frame (last 60): ${typical.sort((x, y) => x - y)[typical.length >> 1]?.toFixed(1)}`];
        p.dt.forEach((d, i) => {
          if (p.t[i] < a.now) return;
          const r = p.gl[i].rare.filter((x) => !/^texSubImage2D\(0,0,0,/.test(x) || d > 33);
          if (d > 33 || r.length) out.push(`${d > 33 ? 'LONG ' : ''}${d.toFixed(0)} ms at +${((p.t[i] - a.now) / 1000).toFixed(2)} s: ${d > 33 ? f(p.gl[i]) : ''} ${r.slice(0, 12).join(' ')}${r.length > 12 ? ` ...${r.length}` : ''}`);
        });
        return out;
      }, a);
      console.log(long.join('\n'));
    }
    const m = await page.evaluate((a) => {
      const p = window.__perf, now = performance.now();
      const dts = p.dt.filter((_, i) => p.t[i] >= a.now).sort((x, y) => y - x);
      const worst = dts.slice(0, Math.max(1, Math.ceil(dts.length / 100)));
      const stalls = p.dt.map((d, i) => [d, p.t[i] - a.now]).filter(([d, t]) => t >= 0 && d > 200).map(([d, t]) => `${d.toFixed(0)} ms at +${(t / 1000).toFixed(1)} s`);
      const median = dts[Math.floor(dts.length / 2)];
      return { n: dts.length, secs: (now - a.now) / 1000, worst: worst.reduce((s, v) => s + v, 0) / worst.length, max: dts[0], median, stalls, calls: p.calls - a.calls, tris: p.tris - a.tris };
    }, a);
    await measure(false);
    console.log(`median frame ${m.median.toFixed(1)} ms (${(1000 / m.median).toFixed(0)} fps); frames over 200 ms: ${m.stalls.join(', ') || 'none'}`);
    console.log(`fps ${(m.n / m.secs).toFixed(1)} mean over ${m.secs.toFixed(1)} s (${m.n} frames), 1% low ${(1000 / m.worst).toFixed(1)} fps, longest frame ${m.max.toFixed(1)} ms; per frame ${(m.calls / m.n).toFixed(0)} draw calls and ${(m.tris / m.n / 1000).toFixed(0)}k triangles (all passes; counted: WebGL2 drawElements, drawArrays, their Instanced forms, drawRangeElements, WebGPU draw, drawIndexed; not counted: multiDraw*, drawIndirect)`);
    await page.keyboard.press('F3');
    await page.waitForTimeout(1500);
    console.log(`F3:\n${await page.evaluate(() => [...document.querySelectorAll('body *')].map((e) => e.children.length === 0 ? e.innerText : '').find((t) => /^FPS/.test(t)) ?? document.body.innerText.slice(0, 600))}`);
    await page.screenshot({ path: `${out}/r3d-run-${level}-fps.png` });
    await page.keyboard.press('F3');
    if (process.env.FPS_ONLY) {
      console.log('FPS_ONLY: the canvas, figure, walk and key checks were skipped');
      throw Object.assign(new Error('FPS_ONLY'), { quiet: true });
    }
  }
  // The 3D canvas, plus the overlay canvas over it (#311).
  if ((await page.locator('#game canvas.r3d').count()) !== 1) errors.push('expected exactly one 3D canvas in #game');
  if ((await page.locator('#game canvas.r3d-overlay').count()) !== 1) errors.push('expected exactly one overlay canvas in #game');
  if ((await page.locator('#game canvas').count()) !== 2) errors.push('expected exactly two canvases in #game (3D and overlay)');
  // DV=1 (50 %) or DV=2 (100 %): F4 that many times, so every picture of the run is taken with darkvision (#328).
  for (let i = 0; i < Number(process.env.DV || 0); i++) {
    await page.keyboard.press('F4');
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${out}/r3d-run-${level}.png` });
  if (!(await saveReadback(page, `${out}/r3d-readback.png`))) errors.push('readback returned nothing');
  const figures = (await r3d()).figures;
  console.log(`figures drawn ${figures}`);
  if (!(figures >= 1)) errors.push(`no figure drawn (window.__r3d.figures = ${figures})`);

  // Hold D: the hero walks.
  if (!(await r3d()).hero) errors.push('window.__r3d.hero is not set in a run');
  else {
    const { moved, frames, secs } = await walkTile(page, 'd');
    console.log(`hero moved ${moved.toFixed(2)} tiles (${frames} frames, ${secs.toFixed(1)} s)`);
    if (!(moved > 1)) errors.push(`the hero moved only ${moved.toFixed(2)} tiles holding D`);
  }

  // The debug keys. F3 shows the .debug block; F4 steps darkvision 0 -> 50 % -> 100 %; F9 flips immortality.
  await page.keyboard.press('F3');
  await page.waitForSelector('.debug', { timeout: 5000 });
  // With DV=1|2 the pictures are taken with darkvision already stepped by the loop above: leave it as asked and skip this check.
  if (!Number(process.env.DV || 0)) {
    for (const want of ['50%', '100%']) {
      await page.keyboard.press('F4');
      await page.waitForFunction((w) => document.querySelector('.debug')?.textContent?.includes(`darkvision ${w}`), want, { timeout: 5000 })
        .catch(() => errors.push(`F4: the debug block never showed darkvision ${want}`));
    }
    console.log('F4 darkvision: 50% -> 100%');
  }
  for (const want of ['MORTAL', 'immortal']) {
    await page.keyboard.press('F9');
    await page.waitForFunction((w) => document.querySelector('.debug-badge .db-title')?.textContent === `DEBUG · ${w}`, want, { timeout: 5000 })
      .catch(() => errors.push(`F9: the badge never said DEBUG · ${want}`));
  }
  console.log('F9 immortality: MORTAL -> immortal');
  if (process.env.LOG === '1') {
    await page.keyboard.press('l');
    await page.keyboard.press('F8'); // a debug effect on the own hero is a certain log event
    await page.waitForSelector('.rules-log .rl-row', { timeout: 10000 }).then(
      async () => console.log(`rules log: ${await page.locator('.rules-log .rl-row').count()} rows`),
      () => errors.push('rules log: no .rules-log .rl-row appeared'),
    );
  }
  await page.keyboard.press('F3');

  // F: the free camera. D now moves the camera, not the hero.
  const before = await r3d();
  await page.keyboard.press('f');
  // Let the free camera take over first: two drawn frames (software rendering can be slow, and a view that was just rebuilt draws none for a while; #353).
  const frF = (await r3d()).frames;
  await page.waitForFunction((n) => window.__r3d.frames >= n + 2, frF, { timeout: 15000 }).catch(() => {});
  await page.keyboard.down('d');
  // Hold D for 1 s and until two more frames were drawn: the far woodland takes about 1.7 s a frame in software, so a fixed second may hold no frame at all.
  const fr0 = (await r3d()).frames;
  await page.waitForTimeout(1000);
  await page.waitForFunction((n) => window.__r3d.frames >= n + 2, fr0, { timeout: 15000 }).catch(() => {});
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
  // Inputs go out with the frames, and a software frame of the 3D view takes about half a second (measured on main, 2026-11-16):
  // hold the button until a primary went out, not for a fixed time (300 ms passed or failed by the luck of the frame's timing).
  const primaries = () => sentInputs.slice(mark).filter((m) => m[5] != null);
  for (let waited = 0; waited < 5000 * slow && primaries().length === 0; waited += 100) await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const shots = primaries();
  console.log(`primary inputs after the click ${shots.length}`);
  if (shots.length === 0) errors.push('a left click sent no primary Input');
  await page.screenshot({ path: `${out}/r3d-run-${level}-aimed.png` });

  // The effects (#308): the left click is the Paladin's Strike (no rune); the secondary, Holy Light (self area, fresh cooldown), leaves
  // rune records alive. Wait for them (a short rune ends fast, a slow software frame may miss it); no triangle may be refused at the caps.
  if (level === 'dungeon') {
    await page.mouse.click(800, 300, { button: 'right' });
    await page.waitForFunction(() => (window.__r3d?.fx?.records ?? 0) > 0, null, { timeout: 3000 * slow }).catch(() => {});
  }
  const fx = await page.evaluate(() => window.__r3d.fx);
  if (!fx) errors.push('window.__r3d.fx is not set in a run');
  else {
    console.log(`fx ${fx.records} records, ${fx.tris} tris, ${fx.dropped} dropped`);
    if (level === 'dungeon' && !(fx.records > 0)) errors.push(`no effect record alive after the click (window.__r3d.fx.records = ${fx.records})`);
  }

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
  const fxEnd = await page.evaluate(() => window.__r3d?.fx);
  if (fxEnd && fxEnd.dropped > 0) errors.push(`effect triangles dropped at the caps: ${fxEnd.dropped}`);
} catch (e) {
  if (!e.quiet) errors.push(`failed: ${e.message.split('\n')[0]}`);
} finally {
  // The API delete; a page that never got logged in answers 401 and the database delete takes the account (a no-op when it was never registered).
  const status = await deleteAccount(page).catch((e) => `error ${e.message}`);
  const failed = status === 204 ? null : purge([account]);
  if (failed) errors.push(`deleting ${account}: ${status}; ${failed}`);
  await browser.close();
}
console.log(errors.length ? errors.join('\n') : `no browser errors${process.env.FPS_ONLY && process.env.FPS_S ? ' (FPS_ONLY: only the frame rate was measured, the other checks were skipped)' : ''}`);
if (errors.length) process.exit(1);
