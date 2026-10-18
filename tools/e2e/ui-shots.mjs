// Screenshots of the progression design's mock screens (?uidemo=<screen>, client/src/uidemo/).
// Usage: node ui-shots.mjs [baseUrl] [outDir] [screen,screen,...]
//   e.g. BROWSER=/usr/bin/brave-browser node ui-shots.mjs http://localhost:5173/ ../../docs/superpowers/specs/img/2026-10-18-progression
// Screens: roster, create, sheet, tree, tree-barbarian, equipment, loadout, room.
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? '.';
const screens = (process.argv[4] ?? 'roster,create,sheet,tree,tree-barbarian,equipment,loadout,room').split(',');
const b = await chromium.launch({
  executablePath: process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errs = [];
for (const screen of screens) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', (e) => errs.push(`${screen}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errs.push(`${screen}: ${m.text()}`));
  await p.goto(`${base}?uidemo=${screen}`);
  await p.waitForSelector('.ud > *');
  await p.waitForTimeout(800); // fonts and the first sprite frames
  await p.screenshot({ path: `${out}/${screen}.png` });
  await p.close();
}
console.log(errs.join('\n') || 'no errors');
await b.close();
