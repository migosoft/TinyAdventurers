// Screenshots of the sprite gallery (?gallery) in chosen animation states, slowed down.
// Usage: node gallery-shots.mjs [baseUrl] [outDir] [state,state,...]
//   e.g. node gallery-shots.mjs http://localhost:8080/ shots melee,breath,windup
// States: idle, move, melee, shoot, cast, windup, dash, channel, breath.
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? '.';
const states = (process.argv[4] ?? 'melee').split(',');
const b = await chromium.launch({
  executablePath: process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errs = [];
for (const state of states) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${base}?gallery&state=${state}&slow=2`);
  for (let i = 0; i < 3; i++) {
    await p.waitForTimeout(i === 0 ? 2000 : 1300);
    await p.screenshot({ path: `${out}/${state}${i}.png` });
  }
  await p.close();
}
console.log(errs.join('\n') || 'no errors');
await b.close();
