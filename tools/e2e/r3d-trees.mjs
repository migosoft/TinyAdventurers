// Screenshots of the 3D trees proof of concept (?r3d=trees, spike/3d-trees): cards and 3D trees at several times of day and turns.
// Usage: node r3d-trees.mjs [baseUrl] [outDir] [set] [extraQuery]
// set: all (default: 5 times x 2 turns x cards and 3D), quick (one 3D shot), or a list like "9.5:0:3d,13:45:cards".
// HEADED=1 opens a visible window on the real GPU and prints the frame rate.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5183/';
const out = process.argv[3] ?? 'shots/trees';
const set = process.argv[4] || 'all';
const extra = process.argv[5] ?? '';
mkdirSync(out, { recursive: true });
const hours = [6.5, 9.5, 13, 18.5, 22.5];
const list = set === 'all' ? hours.flatMap((h) => [0, 45].flatMap((y) => ['cards', '3d'].map((m) => [h, y, m])))
  : set === 'quick' ? [[9.5, 0, '3d']] : set.split(',').map((s) => { const [h, y, m] = s.split(':'); return [Number(h), Number(y), m]; });
const b = await chromium.launch({
  executablePath: process.env.BROWSER ?? '/usr/bin/brave-browser',
  headless: !process.env.HEADED,
  args: process.env.HEADED ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ozone-platform=x11'] /* on Wayland the WebGPU canvas loses its device on this machine */ : process.env.GPU ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errs = [];
const [vw, vh] = (process.env.VIEW ?? '1280x720').split('x').map(Number);
const p = await b.newPage({ viewport: { width: vw, height: vh } });
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(`${base}?r3d=trees${process.env.GPU ? '' : '&backend=webgl'}&t=3${extra}`); // GPU=1: WebGPU (headless: SwiftShader, compiles and runs but captures blank)
try {
  await p.waitForFunction(() => window.__r3d?.frames > 3, null, { timeout: 60000 });
  for (const [hour, yaw, mode] of list) {
    await p.evaluate(([hour, yaw, mode]) => window.__r3d.set({ hour, yaw, mode }), [hour, yaw, mode]);
    const n = await p.evaluate(() => window.__r3d.frames);
    await p.waitForTimeout(mode === 'cards' ? 900 : 100);
    await p.waitForFunction((n) => window.__r3d.frames >= n + 3, n, { timeout: 60000 });
    if (!process.env.NOSHOT) await p.screenshot({ path: `${out}/${mode}-h${String(hour).replace('.', '_')}-y${yaw}.png` }); // NOSHOT=1: a capture of a WebGPU canvas loses the device on this machine
  }
  if (process.env.HEADED) {
    await p.evaluate(() => window.__r3d.set({ t: null }));
    await p.waitForTimeout(4000);
  }
  console.log(JSON.stringify(await p.evaluate(() => { const { frames, backend, fps, ms, drawCalls, triangles, treeTris, plants } = window.__r3d; return { frames, backend, fps, ms, drawCalls, triangles, treeTris, plants }; })));
} catch (e) {
  errs.push(String(e.message ?? e));
}
console.log(errs.join('\n') || 'no browser errors');
await b.close();
if (errs.length) process.exit(1);
