// Headless check of a real run in the 3D view (?r3d): one debug e2e_* account opens a debug room for the level, starts it,
// waits for drawn frames, walks the hero, switches to the free camera and checks the chunk culling on the dungeon.
// Usage: node r3d-run.mjs [baseUrl] [outDir] [dungeon|woodland]
// Set BROWSER to a Chrome/Edge executable (e.g. /usr/bin/brave-browser). The account is deleted at the end, also on failure.
import { chromium } from 'playwright-core';
import { tag, markDebug, login, createCharacter, deleteAccount } from './account.mjs';

const base = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'shots';
const level = (process.argv[4] ?? 'dungeon').toLowerCase();
const browser = await chromium.launch({
  executablePath: process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const account = `e2e_${tag()}`;
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
// The first /api/me before logging in is an expected 401.
page.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(`console: ${m.text()}`));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z); // window.__r3d.hero / cam are {x, z} in tiles
const r3d = () => page.evaluate(() => ({ hero: window.__r3d?.hero, cam: window.__r3d?.cam, chunks: window.__r3d?.chunks, frames: window.__r3d?.frames }));
let registered = false;

try {
  await page.goto(`${base}?r3d&backend=webgl`);
  await page.waitForSelector('#auth-name');
  await login(page, account, true);
  registered = true;
  await markDebug(base, account); // no WebSocket yet, so the connection reads the new flag
  await createCharacter(page, `Hero${tag()}`, 'Paladin');
  await page.click('#to-dungeon');
  await page.waitForSelector('#runname');
  await page.fill('#runname', 'R3D Run');
  await page.click('#create');
  await page.waitForSelector('.players li');
  if (level === 'woodland') {
    await page.click('.level-card.level-woodland');
    await page.waitForSelector('.level-card.level-woodland.selected');
  }
  await page.click('#start');
  await page.waitForSelector('#game.active', { timeout: 10000 });
  await page.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 60000 });
  if ((await page.locator('#game canvas').count()) !== 1) errors.push('expected exactly one canvas in #game (the 3D one)');
  await page.screenshot({ path: `${out}/r3d-run-${level}.png` });

  // Hold D: the hero walks.
  const h0 = (await r3d()).hero;
  if (!h0) errors.push('window.__r3d.hero is not set in a run');
  await page.keyboard.down('d');
  await page.waitForTimeout(2000);
  await page.keyboard.up('d');
  const h1 = (await r3d()).hero;
  if (h0 && h1) {
    const moved = dist(h0, h1);
    console.log(`hero moved ${moved.toFixed(2)} tiles`);
    if (!(moved > 1)) errors.push(`the hero moved only ${moved.toFixed(2)} tiles holding D`);
  }

  // F: the free camera. D now moves the camera, not the hero.
  const before = await r3d();
  await page.keyboard.press('f');
  await page.keyboard.down('d');
  await page.waitForTimeout(1000);
  await page.keyboard.up('d');
  const after = await r3d();
  if (before.cam && after.cam) {
    const camMoved = dist(before.cam, after.cam);
    const heroMoved = dist(before.hero, after.hero);
    console.log(`free camera moved ${camMoved.toFixed(2)} tiles, hero ${heroMoved.toFixed(2)}`);
    if (!(camMoved > 0.01)) errors.push('the free camera did not move');
    if (heroMoved > 0.2) errors.push(`the hero moved ${heroMoved.toFixed(2)} tiles under the free camera`);
  } else errors.push('window.__r3d.cam is not set in a run');
  await page.screenshot({ path: `${out}/r3d-run-${level}-free.png` });

  if (level === 'dungeon') {
    const { chunks } = after;
    console.log(`chunks drawn ${chunks?.drawn} of ${chunks?.total}`);
    if (!chunks || !(chunks.drawn < chunks.total)) errors.push(`chunk culling: drawn ${chunks?.drawn} of ${chunks?.total}`);
  }
} catch (e) {
  errors.push(`failed: ${e.message.split('\n')[0]}`);
} finally {
  if (registered) {
    const status = await deleteAccount(page).catch((e) => `error ${e.message}`);
    if (status !== 204) errors.push(`deleting ${account}: ${status}`);
  }
  await browser.close();
}
console.log(errors.length ? errors.join('\n') : 'no browser errors');
if (errors.length) process.exit(1);
