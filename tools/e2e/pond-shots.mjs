// Spike (#348): pictures of the ?r3d=pond page. Hides the panel, takes a picture, then walks the knight with the given keys
// (a string such as "wwwd": each letter held for half a second) and takes one picture after each.
// Usage: node pond-shots.mjs [baseUrl] [outDir] [extraQuery] [keys]
// Env: GPU=1 a visible window on the discrete card (gpu.mjs); R3D_W / R3D_H the viewport (1280x768).
import { chromium } from 'playwright-core';
import { gpuLaunch, gpuOn } from './gpu.mjs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots';
const extra = process.argv[4] ?? '';
const keys = process.argv[5] ?? '';
const b = await chromium.launch({
  executablePath: process.env.BROWSER ?? '/usr/bin/brave-browser',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  ...(gpuOn ? gpuLaunch() : {}),
});
const errs = [];
const p = await b.newPage({ viewport: { width: Number(process.env.R3D_W) || 1280, height: Number(process.env.R3D_H) || 768 } });
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => (m.type() === 'error' || (m.type() === 'warning' && /device lost/i.test(m.text()))) && errs.push(m.text()));
await p.goto(`${base}?r3d=pond${extra}`);
await p.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 30000 }).catch(() => errs.push('timeout: no frames drawn within 30 s'));
await p.getByText('Hide', { exact: true }).click().catch(() => {});
await p.waitForTimeout(Number(process.env.WAIT_MS) || 6000);
await p.screenshot({ path: `${out}/pond-0.png` });
let n = 1;
for (const k of keys) {
  await p.keyboard.down(`Key${k.toUpperCase()}`);
  await p.waitForTimeout(500);
  await p.keyboard.up(`Key${k.toUpperCase()}`);
  await p.screenshot({ path: `${out}/pond-${n++}.png` });
}
console.log(errs.length ? errs.join('\n') : 'no browser errors');
await b.close();
process.exit(errs.length ? 1 : 0);
