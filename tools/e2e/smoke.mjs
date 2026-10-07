// Two-player smoke test: create/join a run, pick classes, start, move, attack, screenshots.
// Usage: node smoke.mjs [baseUrl] [query] [outDir] [Class1,Class2]
//   e.g. node smoke.mjs http://localhost:8080/ "?debug&boss=dragon" shots Paladin,Wizard
// Set BROWSER to a Chrome/Edge executable if Edge is not at the default Windows path.
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8080/';
const query = process.argv[3] ?? '';
const out = process.argv[4] ?? '.';
const classes = (process.argv[5] ?? 'Wizard,Barbarian').split(',');
const browser = await chromium.launch({ executablePath: process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`));
  await page.goto(base + query);
  await page.waitForSelector('#name');
  await page.fill('#name', name);
  await page.dispatchEvent('#name', 'change');
  return page;
}
const p1 = await player('Alice');
await p1.fill('#runname', 'Test Crawl');
await p1.click('#create');
await p1.waitForSelector('.class-card');
await p1.click(`.class-card.c-${classes[0].toLowerCase()}`);
await p1.screenshot({ path: `${out}/1-room.png` });

const p2 = await player('Bob');
await p2.waitForSelector('[data-join]');
await p2.screenshot({ path: `${out}/0-lobby.png` });
await p2.click('[data-join]');
await p2.waitForSelector('.class-card');
await p2.click(`.class-card.c-${classes[1].toLowerCase()}`);
await p2.click('#ready');
await p1.waitForFunction(() => document.querySelectorAll('.players .ok').length === 2);
await p1.click('#start');
await p1.waitForSelector('#game.active', { timeout: 10000 });
await p2.waitForSelector('#game.active', { timeout: 10000 });
await p1.waitForTimeout(1500);
await p1.screenshot({ path: `${out}/2-start.png` });

// Move and attack.
await p1.mouse.move(900, 300);
await p1.keyboard.down('w');
await p1.waitForTimeout(900);
await p1.keyboard.up('w');
await p1.keyboard.down('d');
await p1.waitForTimeout(500);
await p1.keyboard.up('d');
for (let i = 0; i < 3; i++) {
  await p1.mouse.click(900, 300);
  await p1.waitForTimeout(120);
}
await p1.mouse.click(900, 250, { button: 'right' });
await p1.waitForTimeout(150);
await p1.screenshot({ path: `${out}/3-attack.png` });
await p2.keyboard.down('a');
await p2.waitForTimeout(600);
await p2.keyboard.up('a');
await p2.mouse.click(300, 300);
await p2.waitForTimeout(80);
await p2.screenshot({ path: `${out}/4-p2.png` });
await p1.keyboard.press('F3');
await p1.waitForTimeout(600);
await p1.screenshot({ path: `${out}/5-debug.png` });
const dbg = await p1.textContent('.debug');
console.log(dbg);
console.log(errors.length ? errors.join('\n') : 'no browser errors');
await browser.close();
