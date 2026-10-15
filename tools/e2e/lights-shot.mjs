// Screenshot of the lights demo page (?lights) every 0.5 s (its loop is 4 s).
// Usage: node lights-shot.mjs [baseUrl] [outDir]
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'shots';
const b = await chromium.launch({
  executablePath: process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errs = [];
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(`${base}?lights`);
for (let i = 0; i < 8; i++) {
  await p.waitForTimeout(i === 0 ? 1500 : 500);
  await p.screenshot({ path: `${out}/lights${i}.png` });
}
console.log(errs.join('\n') || 'no errors');
await b.close();
