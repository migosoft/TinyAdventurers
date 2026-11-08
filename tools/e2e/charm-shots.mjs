// Screenshots of the ?charm demo (#224) at phone size: charmed, paused, ends.
// Usage: BROWSER=/usr/bin/brave-browser node charm-shots.mjs [baseUrl] [outDir]
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'shots';
const b = await chromium.launch({
  executablePath: process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errs = [];
const p = await b.newPage({ viewport: { width: 844, height: 390 } });
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(`${base}?charm`);
await p.waitForTimeout(3500);
await p.screenshot({ path: `${out}/charm-charmed.png` });
await p.getByText('Paused', { exact: true }).click();
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/charm-paused.png` });
await p.getByText('Ends', { exact: true }).click();
await p.waitForTimeout(1200);
await p.screenshot({ path: `${out}/charm-ends.png` });
console.log(errs.join('\n') || 'no browser errors');
await b.close();
