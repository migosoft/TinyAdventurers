// SPIKE (#358): shots of ?r3d=lich with the panel hidden. node lich-shot.mjs <outDir> <name>=<query> ...
import { chromium } from 'playwright-core';
const [out, ...shots] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errs = [];
for (const s of shots) {
  const i = s.indexOf('='), name = s.slice(0, i), query = s.slice(i + 1);
  const p = await b.newPage({ viewport: { width: 1280, height: 768 } });
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(`http://localhost:${process.env.PORT ?? 5194}/?r3d=lich${query}`);
  await p.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 30000 });
  await p.getByText('Hide', { exact: true }).click().catch(() => {});
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/${name}.png` });
  await p.close();
}
console.log(errs.length ? errs.join('\n') : 'no browser errors');
await b.close();
