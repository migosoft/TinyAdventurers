// SPIKE (#379), throwaway: shots of the demon model. Usage: node demon-shot.mjs <outDir> <name>=<query> ...   (query after ?r3d=)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
const base = process.env.BASE ?? 'http://localhost:5179/';
const [out, ...shots] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.BROWSER ?? '/usr/bin/brave-browser', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const s of shots) {
  const i = s.indexOf('='), name = s.slice(0, i), q = s.slice(i + 1);
  const p = await b.newPage({ viewport: { width: 1280, height: 768 } });
  p.on('pageerror', (e) => console.log(name, 'ERR', e.message));
  p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(name, m.type(), m.text().slice(0, 300)));
  await p.goto(`${base}?r3d=${q}`);
  await p.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 60000 }).catch(() => console.log(name, 'no frames'));
  await p.evaluate(() => { const t = document.querySelector('.r3d-toggle'); if (t && t.textContent === 'Hide') t.click(); });
  await p.waitForTimeout(Number(process.env.WAIT ?? 2500));
  await p.screenshot({ path: `${out}/${name}.png` });
  await p.close();
}
await b.close();
