// Headless load check of the 3D renderer page (?r3d): waits for drawn frames, prints the backend, saves a screenshot.
// Usage: node r3d-shot.mjs [baseUrl] [outDir] [extraQuery] [mode] [lose]
// mode: webgl (default, SwiftShader GL) or webgpu (SwiftShader Vulkan). lose is used by later tasks.
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots';
const extra = process.argv[4] ?? '';
const mode = process.argv[5] || 'webgl';
const lose = process.argv[6] ?? '';
const args =
  mode === 'webgpu'
    ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const b = await chromium.launch({
  executablePath: process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args,
});
const errs = [];
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(`${base}?r3d${extra}`);
let ok = true;
try {
  await p.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 20000 });
  if (lose) await p.evaluate(() => window.__r3d.forceLoss?.());
} catch {
  ok = false;
  errs.push('timeout: no frames drawn within 20 s');
}
console.log(`backend: ${await p.evaluate(() => window.__r3d?.backend)}`);
await p.screenshot({ path: `${out}/r3d.png` });
console.log(errs.join('\n') || 'no browser errors');
await b.close();
if (errs.length || !ok) process.exit(1);
