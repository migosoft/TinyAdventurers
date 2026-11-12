// Headless load check of the 3D renderer page (?r3d): waits for drawn frames, prints the backend, saves a screenshot.
// Usage: node r3d-shot.mjs [baseUrl] [outDir] [extraQuery] [mode] [lose] [page]
// page: demo (default) or gallery (?r3d=gallery, #303).
// mode: webgl (default, SwiftShader GL) or webgpu (SwiftShader Vulkan).
// lose: after the first screenshot the device is lost on purpose (window.__r3d.forceLoss()); the script waits up to 20 s
// for 10 more drawn frames and saves r3d-after-loss.png. Console errors containing "Device Lost" are ignored in this mode.
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots';
const extra = process.argv[4] ?? '';
const mode = process.argv[5] || 'webgl';
const lose = process.argv[6] ?? '';
const page = process.argv[7] || 'demo'; // demo (default) or gallery
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
p.on('console', (m) => m.type() === 'error' && !(lose && m.text().includes('Device Lost')) && errs.push(m.text()));
await p.goto(`${base}?r3d=${page}${extra}`);
let ok = true;
try {
  await p.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 20000 });
} catch {
  ok = false;
  errs.push('timeout: no frames drawn within 20 s');
}
console.log(`backend: ${await p.evaluate(() => window.__r3d?.backend)}`);
await p.screenshot({ path: `${out}/r3d.png` });
if (lose && ok) {
  let forced;
  try {
    forced = await p.evaluate(() => window.__r3d.forceLoss());
  } catch (e) {
    ok = false;
    errs.push(`forceLoss threw: ${e.message}`);
  }
  if (forced !== undefined) console.log(`forceLoss() returned ${forced}`);
  if (ok) {
    try {
      const before = await p.evaluate(() => window.__r3d.frames);
      await p.waitForFunction((n) => window.__r3d.frames >= n + 10, before, { timeout: 20000 });
      console.log(`backend after the loss: ${await p.evaluate(() => window.__r3d.backend)}`);
      await p.screenshot({ path: `${out}/r3d-after-loss.png` });
    } catch {
      ok = false;
      errs.push('timeout: no 10 more frames within 20 s after the loss');
    }
  }
}
console.log(errs.join('\n') || 'no browser errors');
await b.close();
if (errs.length || !ok) process.exit(1);
