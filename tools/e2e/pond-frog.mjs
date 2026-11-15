// Spike (#348): walks the knight up to a frog and saves pictures of its leap. Usage: node pond-frog.mjs [baseUrl] [outDir]
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:5173/', out = process.argv[3] ?? 'shots';
const b = await chromium.launch({ executablePath: process.env.BROWSER ?? '/usr/bin/brave-browser', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 768 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(`${base}?r3d=pond&hour=11&sight=0&zoom=6`);
await p.waitForFunction(() => window.__pond, null, { timeout: 30000 });
// The southernmost bank frog: start four tiles south of it and walk north.
const f = await p.evaluate(() => window.__pond.frogs.filter((q) => q.lift === 0).sort((a, c) => c.hz - a.hz)[0]);
await p.goto(`${base}?r3d=pond&hour=11&sight=0&zoom=6&at=${Math.floor(f.hx)},${Math.floor(f.hz) + 4}`);
await p.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 30000 });
await p.getByText('Hide', { exact: true }).click().catch(() => {});
await p.waitForTimeout(3000);
await p.keyboard.down('KeyW');
const states = [];
for (let i = 0; i < 14; i++) {
  await p.waitForTimeout(150);
  states.push(await p.evaluate(([x, z]) => window.__pond.frogs.find((q) => q.hx === x && q.hz === z).state, [f.hx, f.hz]));
  if (i % 2 === 1) await p.screenshot({ path: `${out}/frog-${(i - 1) / 2}.png` });
}
await p.keyboard.up('KeyW');
console.log(states.join(' '));
console.log(errs.length ? errs.join('\n') : 'no browser errors');
await b.close();
