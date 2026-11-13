// Headless load check of the 3D renderer page (?r3d): waits for drawn frames, prints the backend, saves a screenshot.
// Usage: node r3d-shot.mjs [baseUrl] [outDir] [extraQuery] [mode] [lose] [page]
// page: demo (default), gallery (?r3d=gallery, #303), lights (?r3d=lights, #304) or woodland (?r3d=woodland, #306; add &hour=9.5).
// Env: HEADED=1 shows the window; READBACK=1 also saves r3d-readback.png (the scene read back, for WebGPU); R3D_W / R3D_H the viewport (1280x768).
// mode: webgl (default, SwiftShader GL) or webgpu (SwiftShader Vulkan).
// lose: after the first screenshot the device is lost on purpose (window.__r3d.forceLoss()); the script waits up to 20 s
// for 10 more drawn frames and saves r3d-after-loss.png. Console errors containing "Device Lost" are ignored in this mode.
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots';
const extra = process.argv[4] ?? '';
const mode = process.argv[5] || 'webgl';
const lose = process.argv[6] ?? '';
const page = process.argv[7] || 'demo'; // demo (default), gallery, lights or woodland
const args =
  mode === 'webgpu' && process.env.HEADED
    ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan']
    : mode === 'webgpu'
    ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const b = await chromium.launch({
  executablePath: process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: !process.env.HEADED, // HEADED=1 with mode webgpu: a visible window on the real GPU
  args,
});
const errs = [];
// 1280x768 works for WebGPU on the dev notebook (720, 900 and 1080 lose the device); R3D_W / R3D_H override.
const p = await b.newPage({ viewport: { width: Number(process.env.R3D_W) || 1280, height: Number(process.env.R3D_H) || 768 } });
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && !(lose && m.text().includes('Device Lost')) && errs.push(m.text()));
// A lost device is only a console warning (host.ts); unless the run forces the loss, it is a failure.
p.on('console', (m) => m.type() === 'warning' && /device lost/i.test(m.text()) && !lose && errs.push(m.text()));
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
if (process.env.READBACK) {
  // The frame re-drawn off-screen and read back, PNG-encoded in the page (a WebGPU canvas capture is black on this notebook).
  const url = await p.evaluate(async () => {
    const r = await window.__r3d.readback?.();
    if (!r) return null;
    const c = document.createElement('canvas');
    c.width = r.w;
    c.height = r.h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
    return c.toDataURL('image/png');
  });
  if (url) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${out}/r3d-readback.png`, Buffer.from(url.split(',')[1], 'base64'));
  } else {
    ok = false;
    errs.push('readback returned nothing');
  }
}
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
