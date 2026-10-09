// Two-player smoke test: register two throwaway accounts, create a character each,
// create/join a run, start, move, attack, screenshots; then a second login closes
// the first window, and both accounts are deleted again.
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
const PASSWORD = 'smoke-test-password';
const tag = () => Math.random().toString(16).slice(2, 8);

async function open(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  // The first /api/me before logging in is an expected 401.
  page.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(`${name} console: ${m.text()}`));
  await page.goto(base + query);
  await page.waitForSelector('#auth-name');
  return page;
}
async function login(page, account, register) {
  if (register) await page.click('#auth-switch');
  await page.fill('#auth-name', account);
  await page.fill('#auth-password', PASSWORD);
  if (register) await page.fill('#auth-password2', PASSWORD);
  await page.click(register ? '#register' : '#login');
  await page.waitForSelector('.chars');
}
/** Registers a fresh account, creates a character of `cls` and enters the lobby with it. */
async function player(name, cls, shots) {
  const account = `e2e_${tag()}`;
  const page = await open(name);
  if (shots) await page.screenshot({ path: `${out}/0-login.png` });
  await login(page, account, true);
  await page.fill('#char-name', `${name}${tag()}`);
  await page.click(`.new-char .class-card.c-${cls.toLowerCase()}`);
  await page.click('#char-create');
  await page.waitForSelector('[data-play]');
  if (shots) await page.screenshot({ path: `${out}/0-characters.png` });
  await page.click('[data-play]');
  await page.waitForSelector('#runname');
  await page.waitForSelector('.hero .cinfo');
  return { page, account };
}

const a1 = await player('Alice', classes[0], true);
const p1 = a1.page;
await p1.fill('#runname', 'Test Crawl');
await p1.click('#create');
await p1.waitForSelector('.players li');
await p1.screenshot({ path: `${out}/1-room.png` });

const a2 = await player('Bob', classes[1]);
const p2 = a2.page;
await p2.waitForSelector('[data-join]');
await p2.screenshot({ path: `${out}/0-lobby.png` });
await p2.click('[data-join]');
await p2.waitForSelector('.players li');
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

// A second login to Alice's account closes her first window.
const p3 = await open('Alice2');
await login(p3, a1.account, false);
await p3.click('[data-play]');
await p3.waitForSelector('#runname');
await p1.waitForFunction(() => /another window/.test(document.body.textContent ?? ''), null, { timeout: 10000 });
console.log('second login closed the first window');

// Clean up: delete both throwaway accounts.
for (const [page, account] of [
  [p3, a1.account],
  [p2, a2.account],
]) {
  const status = await page.evaluate(
    (password) => fetch('/api/account', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }).then((r) => r.status),
    PASSWORD,
  );
  if (status !== 204) errors.push(`deleting ${account}: HTTP ${status}`);
}
console.log(errors.length ? errors.join('\n') : 'no browser errors');
await browser.close();
