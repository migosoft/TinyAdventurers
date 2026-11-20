// SPIKE (#380): screenshots of ?r3d=stone variants with the panel hidden. Usage: node stone-shots.mjs [baseUrl] [outDir] [name=query ...]
import { chromium } from 'playwright-core';
import { gpuLaunch, gpuOn } from './gpu.mjs';
const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots380';
const jobs = process.argv.slice(4).map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]);
const b = await chromium.launch({ executablePath: process.env.BROWSER ?? '/usr/bin/brave-browser', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], ...(gpuOn ? gpuLaunch() : {}) });
for (const [name, query] of jobs) {
  const p = await b.newPage({ viewport: { width: 1280, height: 768 } });
  p.on('pageerror', (e) => console.log(name, 'ERROR', e.message));
  p.on('console', (m) => m.type() === 'error' && console.log(name, 'error', m.text()));
  await p.goto(`${base}?${query}&backend=webgl`);
  await p.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 60000 });
  await p.getByText('Hide', { exact: true }).click().catch(() => {});
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/${name}.png` });
  await p.close();
  console.log('shot', name);
}
await b.close();
