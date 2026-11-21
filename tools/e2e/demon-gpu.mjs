// SPIKE (#379): load the page in a visible window on the real GPU and print the console.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { gpuLaunch, printGpu } from './gpu.mjs';
mkdirSync('shots-demon', { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/brave-browser', ...gpuLaunch() });
for (const q of process.argv.slice(2)) {
  const p = await b.newPage({ viewport: { width: 1280, height: 768 } });
  p.on('pageerror', (e) => console.log('PAGEERR', e.message.slice(0, 600)));
  p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(m.type(), m.text().slice(0, 600)));
  await p.goto(`http://localhost:5179/?r3d=${q}`);
  await p.waitForTimeout(9000);
  await printGpu(p);
  console.log(q, JSON.stringify(await p.evaluate(() => ({ frames: window.__r3d?.frames, keys: Object.keys(window.__r3d ?? {}).slice(0, 30) }))));
  await p.screenshot({ path: `shots-demon/gpu-${q.includes('backend') ? 'webgl' : 'webgpu'}.png` });
  await p.close();
}
await b.close();
