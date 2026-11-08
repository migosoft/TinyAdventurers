// One debug account, F8 up to Charmed (the nearest living enemy is the caster), then watch the charmed view and F3's
// correction until the charm ends (#224). Run it with a network simulation to check the blend:
//   BROWSER=/usr/bin/brave-browser node charm-run.mjs http://localhost:8080/ "?lag=150&jitter=40&loss=2" shots
// Prints a timeline: seconds since Charmed, whether the charmed view is shown, F3's correction (px). Screenshots:
// charm-run-on.png (haze) and charm-run-off.png (after the end). Deletes its throwaway account.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';

const base = process.argv[2] ?? 'http://localhost:8080/';
const query = process.argv[3] ?? '';
const out = process.argv[4] ?? 'shots';
const PASSWORD = 'smoke-test-password';
const account = `e2e_${Math.random().toString(16).slice(2, 8)}`;
const psql = (sql) => execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'tiny', '-d', 'tiny', '-c', sql], { stdio: 'inherit' });

const browser = await chromium.launch({ executablePath: process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(`console: ${m.text()}`));
  await page.goto(base + query);
  await page.waitForSelector('#auth-name');
  await page.click('#auth-switch');
  await page.fill('#auth-name', account);
  await page.fill('#auth-password', PASSWORD);
  await page.fill('#auth-password2', PASSWORD);
  await page.click('#register');
  await page.waitForSelector('.ui-roster');
  psql(`update accounts set debug = true where name = '${account}'`);
  await page.click('#new-char');
  await page.fill('#char-name', `Charm${account.slice(4)}`);
  await page.click('.ui-class.c-barbarian');
  await page.click('#char-create');
  await page.waitForSelector('[data-attr]');
  await page.click('#to-dungeon');
  await page.waitForSelector('#runname');
  await page.fill('#runname', 'Charm Run');
  await page.click('#create');
  await page.waitForSelector('.players li');
  await page.click('#start');
  await page.waitForSelector('#game.active', { timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.keyboard.press('F3');

  // F8 cycles the effects; Charmed is the 19th press (Sleep, Petrified, ... are the ones before it).
  const shown = () => page.evaluate(() => { const v = document.querySelector('.charm-view'); return !!v && !v.hidden; });
  for (let i = 0; i < 19 && !(await shown()); i++) {
    await page.keyboard.press('F8');
    await page.waitForTimeout(120);
  }
  const t0 = Date.now();
  let maxCorr = 0;
  let last = null;
  const log = [];
  let onShot = false;
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(250);
    const on = await shown();
    const dbg = (await page.textContent('.debug').catch(() => '')) ?? '';
    const corr = Number(/correction ([0-9.]+) px/.exec(dbg)?.[1] ?? 0);
    const s = ((Date.now() - t0) / 1000).toFixed(1);
    if (on !== last) log.push(`${s}s charmed view ${on ? 'ON' : 'off'} (correction ${corr})`);
    last = on;
    if (on && !onShot && Date.now() - t0 > 1500) {
      await page.screenshot({ path: `${out}/charm-run-on.png` });
      onShot = true;
    }
    if (on || Date.now() - t0 < 20000) maxCorr = Math.max(maxCorr, corr);
    if (!on && onShot) {
      // Control is back: sample the correction for two more seconds.
      for (let j = 0; j < 8; j++) {
        await page.waitForTimeout(250);
        const d = (await page.textContent('.debug').catch(() => '')) ?? '';
        const c = Number(/correction ([0-9.]+) px/.exec(d)?.[1] ?? 0);
        log.push(`  after the end: correction ${c}`);
        maxCorr = Math.max(maxCorr, c);
      }
      await page.screenshot({ path: `${out}/charm-run-off.png` });
      break;
    }
  }
  console.log(log.join('\n'));
  console.log(`never charmed: ${!onShot}; max correction seen: ${maxCorr} px`);
} finally {
  await browser.close();
  psql(`delete from accounts where name = '${account}'`);
}
console.log(errors.join('\n') || 'no browser errors');
