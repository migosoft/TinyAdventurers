// Screenshot of the lights demo page (?lights) every 0.5 s (its loop is 4 s).
// Usage: node lights-shot.mjs [baseUrl] [outDir] [darkvision] [extraQuery] [prefix]
// darkvision (0..1, e.g. 0.5) starts the viewer with it (&dv=) and names the shots lights-dv0.5-N.png.
// extraQuery is appended to the URL (e.g. "&at=13.5,9.5&edges=old"); prefix replaces "lights" in the file names.
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'shots';
const dv = process.argv[4] || '';
const extra = process.argv[5] ?? '';
const prefix = process.argv[6] ?? 'lights';
const b = await chromium.launch({
  executablePath: process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errs = [];
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(`${base}?lights${dv ? `&dv=${dv}` : ''}${extra}`);
for (let i = 0; i < 8; i++) {
  await p.waitForTimeout(i === 0 ? 1500 : 500);
  await p.screenshot({ path: `${out}/${prefix}${dv ? `-dv${dv}-` : ''}${i}.png` });
}
console.log(errs.join('\n') || 'no errors');
await b.close();
