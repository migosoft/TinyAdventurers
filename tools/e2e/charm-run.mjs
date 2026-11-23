// One debug account, F8 up to Charmed (the nearest living enemy is the caster), then watch the charmed view and F3's
// correction until the charm ends (#224). Run it with a network simulation to check the blend:
//   BROWSER=/usr/bin/brave-browser node charm-run.mjs http://localhost:8080/ "?lag=150&jitter=40&loss=2" shots
// Prints a timeline: seconds since Charmed, whether the charmed view is shown, F3's correction (px). Screenshots:
// charm-run-on.png (haze) and charm-run-off.png (after the end). Deletes its throwaway account.
import { tag, login, createCharacter, markDebug, deleteAccount, purge } from './account.mjs';
import { launch } from './gpu.mjs';
import { VIEWPORT, watchPage, pageUrl, r3dState, waitLoaded } from './r3d-page.mjs';

const base = process.argv[2] ?? 'http://localhost:8080/';
const query = process.argv[3] ?? '';
const out = process.argv[4] ?? 'shots';
const account = `e2e_${tag()}`;

const browser = await launch();
const errors = [];
let onShot = false;
let page;
try {
  page = await (await browser.newContext({ viewport: VIEWPORT })).newPage();
  watchPage(page, '', errors);
  await page.goto(pageUrl(base, query));
  await page.waitForSelector('#auth-name');
  await login(page, account, true);
  await markDebug(base, account);
  await createCharacter(page, `Charm${account.slice(4)}`, 'Barbarian');
  await page.click('#to-dungeon');
  await page.waitForSelector('#runname');
  await page.fill('#runname', 'Charm Run');
  await page.click('#create');
  await page.waitForSelector('.players li');
  await page.click('#start');
  await page.waitForSelector('#game.active', { timeout: 15000 });
  await waitLoaded(page);
  // The 3D run starts late in software: F8 is dropped until the session knows it is a debug run (the badge) and is drawing frames.
  await page.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 60000 });
  await page.waitForSelector('.debug-badge', { timeout: 30000 });
  console.log(`run up: ${(await r3dState(page)).frames} frames, debug badge shown`);
  await page.keyboard.press('F3');

  // F8 puts the next effect on the hero; Charmed is one of them (the nearest living enemy is the caster). Press until the charmed view shows,
  // one press per ~400 ms (the simulated lag delays the answer), at most 40 presses (more than a cycle of the effect list).
  const shown = () => page.evaluate(() => { const v = document.querySelector('.charm-view'); return !!v && !v.hidden; });
  let presses = 0;
  for (; presses < 40 && !(await shown()); presses++) {
    await page.keyboard.press('F8');
    await page.waitForTimeout(400);
  }
  console.log(`F8 pressed ${presses} times`);
  const t0 = Date.now();
  let maxCorr = 0;
  let last = null;
  const log = [];
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
  // The API delete; the database delete takes the account when it did not return 204 (a crash before the login).
  const status = page ? await deleteAccount(page).catch((e) => `error ${e.message}`) : null;
  const failed = status === 204 ? null : purge([account]);
  if (failed) errors.push(`deleting ${account}: ${status}; ${failed}`);
  await browser.close();
}
console.log(errors.join('\n') || 'no browser errors');
if (errors.length || !onShot) process.exit(1);
