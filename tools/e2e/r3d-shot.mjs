// Headless load check of the 3D renderer page (?r3d): waits for drawn frames, prints the backend, saves a screenshot.
// Usage: node r3d-shot.mjs [baseUrl] [outDir] [extraQuery] [mode] [lose] [page]
// page: demo (default), gallery (?r3d=gallery, #303), lights (?r3d=lights, #304), woodland (?r3d=woodland, #306; add &hour=9.5), cove (?r3d=cove, #329), mood (?r3d=mood, #307), sunlight (?r3d=sunlight, #307; keys or panel buttons 2, R, V) fx (?r3d=fx, #308; add &fx=<group> and &t=<s> to pin the clock) liquids (?r3d=liquids, #324; add &push=chasm|water|barrel and &t=<s>) or lich (?r3d=lich, #358; add &act=nova|raise|bolts|curse|mist|gaze|hurt|broken, &at=<s>, &t=<s>, &fx=frozen|chilled|stone|immune; the check shots are lich-shot.mjs) or stone (?r3d=stone, #380; add &stone=laid|rock|zones, &at=cave|border|hall|circle|mosaic|cave2|door, &lamp=0, &break=1).
// Env: GPU=1 runs a visible window on the discrete card with the notebook's start line and prints the GPU in use (GPU=uncapped: no frame limit); HEADED=1 shows the window; READBACK=1 also saves r3d-readback.png (the scene read back, for WebGPU); R3D_W / R3D_H the viewport (1280x768).
// mode: webgl (default, SwiftShader GL) or webgpu (SwiftShader Vulkan).
// lose: after the first screenshot the device is lost on purpose (window.__r3d.forceLoss()); the script waits up to 20 s
// for 10 more drawn frames and saves r3d-after-loss.png. Console errors containing "Device Lost" are ignored in this mode.
import { launch, gpuOn, printGpu } from './gpu.mjs';
import { watchPage, saveReadback } from './r3d-page.mjs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots';
const extra = process.argv[4] ?? '';
const mode = process.argv[5] || 'webgl';
const lose = process.argv[6] ?? '';
const page = process.argv[7] || 'demo'; // demo (default), gallery, lights or woodland
// HEADED=1 with mode webgpu: a visible window on the real GPU. GPU=1 (or GPU=uncapped): a visible window on the discrete card with the notebook's start line (gpu.mjs); `mode` then picks nothing.
const b = await launch(mode);
const errs = [];
// 1280x768 works for WebGPU on the dev notebook (720, 900 and 1080 lose the device); R3D_W / R3D_H override.
const p = await b.newPage({ viewport: { width: Number(process.env.R3D_W) || 1280, height: Number(process.env.R3D_H) || 768 } });
// A lost device is only a console warning (host.ts); unless the run forces the loss, it is a failure.
watchPage(p, '', errs, () => !!lose);
await p.goto(`${base}?r3d=${page}${extra}`);
let ok = true;
// The gallery draws every figure kind in every state: about 0.4 frames a second under SwiftShader (#403), so 10 frames take ~25 s.
const frameWait = page === 'gallery' ? 90000 : 20000;
try {
  await p.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: frameWait });
} catch {
  ok = false;
  errs.push(`timeout: no frames drawn within ${frameWait / 1000} s`);
}
console.log(`backend: ${await p.evaluate(() => window.__r3d?.backend)}`);
if (gpuOn) await printGpu(p);
// WAIT_MS: more time before the picture (the woodland's plants are drawn a few per frame).
if (process.env.WAIT_MS) await p.waitForTimeout(Number(process.env.WAIT_MS));
await p.screenshot({ path: `${out}/r3d.png` });
if (!(await saveReadback(p, `${out}/r3d-readback.png`))) {
  ok = false;
  errs.push('readback returned nothing');
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
      await p.waitForFunction((n) => window.__r3d.frames >= n + 10, before, { timeout: frameWait });
      console.log(`backend after the loss: ${await p.evaluate(() => window.__r3d.backend)}`);
      await p.screenshot({ path: `${out}/r3d-after-loss.png` });
    } catch {
      ok = false;
      errs.push(`timeout: no 10 more frames within ${frameWait / 1000} s after the loss`);
    }
  }
}
console.log(errs.join('\n') || 'no browser errors');
await b.close();
if (errs.length || !ok) process.exit(1);
