// Two-player smoke test in the 3D view: register two ordinary (non-debug) throwaway accounts, create a character each,
// create/join a run, start, check the 3D view (frames, canvases, figures, walking, no address-bar rewrite, no free camera,
// the quality setting), screenshots; then a second login closes the first window, and both accounts are deleted again.
// Usage: node smoke.mjs [baseUrl] [query] [outDir] [Class1,Class2] [dungeon|woodland]
//   e.g. node smoke.mjs http://localhost:8080/ "" shots ElvenRanger,Paladin
// Set BROWSER to a Chrome/Edge executable if Edge is not at the default Windows path.
// The page gets `backend=webgl` appended (BACKEND=webgpu: nothing). READBACK=1 saves r3d-readback.png (Alice's frame read back).
// NOCHUNK=1: Bob's page cannot load the 3D chunk; his run must end and the lobby must say "The 3D view could not load".
// The debug keys (F4, F8, F9, the rules log) are checked by r3d-run.mjs, which uses a debug account.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { PASSWORD, tag, login, deleteAccount } from './account.mjs';
import { VIEWPORT, watchPage, backendQuery, r3dState, saveReadback } from './r3d-page.mjs';

const base = process.argv[2] ?? 'http://localhost:8080/';
const query = process.argv[3] ?? '';
const out = process.argv[4] ?? '.';
const classes = (process.argv[5] ?? 'Wizard,Barbarian').split(',');
const level = (process.argv[6] ?? 'dungeon').toLowerCase();
const launch = () => chromium.launch({ executablePath: process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const browser = await launch();
const errors = [];
const noChunk = process.env.NOCHUNK === '1';
// With NOCHUNK=1 Bob's page reports the aborted chunk request and the client's own failure line: those two are expected, every other error counts.
const EXPECTED_NOCHUNK = /net::ERR_FAILED|The 3D view could not load/;
const bobErrors = { push: (m) => { if (!EXPECTED_NOCHUNK.test(m)) errors.push(m); } };
const created = []; // the e2e_* accounts this run registered
const pageUrl = base + query + (backendQuery() ? (query.includes('?') ? '&' : '?') + backendQuery() : '');

async function open(name, b = browser, errs = errors) {
  const ctx = await b.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  watchPage(page, name, errs);
  // NOCHUNK: the client preloads the 3D chunk when its connection says Welcome, so the request is blocked before the page loads.
  if (noChunk && name === 'Bob') await page.route(/(render3d\/boot|assets\/boot-)/, (r) => r.abort());
  await page.goto(pageUrl);
  await page.waitForSelector('#auth-name');
  return page;
}
/** Registers a fresh account, creates a character of `cls` (its hub opens) and enters the runs list with it. */
async function player(name, cls, shots, errs = errors) {
  const account = `e2e_${tag()}`;
  created.push(account);
  const page = await open(name, browser, errs);
  if (shots) await page.screenshot({ path: `${out}/0-login.png` });
  await login(page, account, true);
  if (shots) await page.screenshot({ path: `${out}/0-roster.png` });
  await page.click('#new-char');
  await page.fill('#char-name', `${name}${tag()}`);
  await page.click(`.ui-class.c-${cls.toLowerCase()}`);
  if (shots) await page.screenshot({ path: `${out}/0-create.png` });
  await page.click('#char-create');
  await page.waitForSelector('.ui-bar');
  await page.waitForSelector('[data-attr]'); // the Sheet tab, after the Character message
  if (shots) {
    await page.screenshot({ path: `${out}/0-hub-sheet.png` });
    for (const tab of ['tree', 'equipment', 'loadout']) {
      await page.click(`[data-tab="${tab}"]`);
      if (tab === 'tree') await page.waitForSelector('.ui-node.owned');
      else await page.waitForTimeout(150);
      await page.screenshot({ path: `${out}/0-hub-${tab}.png` });
    }
    console.log('hub: four tabs shown');
    await page.click('[data-tab="sheet"]');
  }
  await page.click('#to-dungeon');
  await page.waitForSelector('#runname');
  await page.waitForSelector('.hero .cinfo');
  return { page, account };
}

// Everything the run creates is declared here so that the cleanup below can reach it when a step throws.
let a1, a2, p1, p2, p3, browser2, typed = null, adminDone = false; // typed: NOCHUNK skips Bob's steps; his account is deleted in the cleanup
try {
  a1 = await player('Alice', classes[0], true);
  p1 = a1.page;
  await p1.fill('#runname', 'Test Crawl');
  await p1.click('#create');
  await p1.waitForSelector('.players li');
  if (level === 'woodland') {
    await p1.click('.level-card.level-woodland');
    await p1.waitForSelector('.level-card.level-woodland.selected');
    if ((await p1.locator('.boss-list').count()) !== 0) throw new Error('boss panel must be hidden for woodland');
  }
  await p1.screenshot({ path: `${out}/1-room.png` });
  await p1.locator('.level-panel').screenshot({ path: `${out}/1-level-panel.png` });

  a2 = await player('Bob', classes[1], false, noChunk ? bobErrors : errors);
  p2 = a2.page;
    await p2.waitForSelector('[data-join]');
  await p2.screenshot({ path: `${out}/0-lobby.png` });
  await p2.click('[data-join]');
  await p2.waitForSelector('.players li');
  // Your own row offers the loadout selects until you are Ready.
  await p2.waitForSelector('[data-own="Primary"]', { timeout: 5000 });
  await p2.click('#ready');
  await p2.waitForFunction(() => !document.querySelector('[data-own]'));
  console.log('waiting room: own loadout picker shown');
  await p1.waitForFunction(() => document.querySelectorAll('.players .ok').length === 2);
  if (level === 'woodland') await p2.waitForSelector('.level-card.level-woodland.selected'); // the guest sees the host's choice
  await p1.click('#start');
  await p1.waitForSelector('#game.active', { timeout: 10000 });
  const searchAtStart = await p1.evaluate(() => location.search);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const pages = [['Alice', p1]];
  if (noChunk) {
    // Bob cannot load the 3D chunk: his run ends and the lobby says why.
    await p2.waitForFunction(() => /The 3D view could not load/.test(document.body.textContent ?? ''), null, { timeout: 15000 }).then(
      () => console.log('NOCHUNK: Bob sees "The 3D view could not load"'),
      () => errors.push('NOCHUNK: Bob never saw "The 3D view could not load"'),
    );
    if (await p2.locator('#game.active').count()) errors.push('NOCHUNK: #game is still active on Bob\'s page');
    await p2.screenshot({ path: `${out}/4-nochunk.png` });
  } else {
    await p2.waitForSelector('#game.active', { timeout: 10000 });
    pages.push(['Bob', p2]);
  }
  const searchB = new Map();
  for (const [name, page] of pages) searchB.set(name, name === 'Alice' ? searchAtStart : await page.evaluate(() => location.search));

  // The 3D view is up on every window that runs it.
  for (const [name, page] of pages) {
    await page.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 60000 }).catch(() => errors.push(`${name}: window.__r3d.frames never passed 10`));
    if ((await page.locator('#game canvas.r3d').count()) !== 1) errors.push(`${name}: expected exactly one #game canvas.r3d`);
    if ((await page.locator('#game canvas.r3d-overlay').count()) !== 1) errors.push(`${name}: expected exactly one #game canvas.r3d-overlay`);
    if ((await page.locator('.r3d-panel').count()) !== 0) errors.push(`${name}: an ordinary account must not get the .r3d-panel`);
    await page.waitForFunction(() => window.__r3d?.figures >= 1, null, { timeout: 15000 }).catch(() => {});
    const st = await r3dState(page);
    if (!(st.figures >= 1)) errors.push(`${name}: no figure drawn (figures = ${st.figures})`);
    console.log(`${name}: backend ${st.backend}, ${st.frames} frames, ${st.figures} figures`);
  }
  await p1.waitForTimeout(1500);
  await p1.screenshot({ path: `${out}/2-start.png` });
  if (!(await saveReadback(p1, `${out}/r3d-readback.png`))) errors.push('Alice: readback returned nothing');

  // Hold D: the hero walks more than a tile.
  for (const [name, page] of pages) {
    const h0 = (await r3dState(page)).hero;
    await page.mouse.move(900, 300);
    await page.keyboard.down('d');
    // Software frames are slow (two games share the machine): hold at least 900 ms, then until the hero has walked a tile (6 s at most).
    await page.waitForTimeout(900);
    let moved = 0;
    for (let waited = 0; waited < 6000; waited += 250) {
      const h1 = (await r3dState(page)).hero;
      moved = h0 && h1 ? dist(h0, h1) : 0;
      if (moved > 1) break;
      await page.waitForTimeout(250);
    }
    await page.keyboard.up('d');
    console.log(`${name}: hero moved ${moved.toFixed(2)} tiles holding D`);
    if (!(moved > 1)) errors.push(`${name}: the hero moved only ${moved.toFixed(2)} tiles holding D`);
  }
  // Attack.
  await p1.keyboard.down('w');
  await p1.waitForTimeout(500);
  await p1.keyboard.up('w');
  await p1.screenshot({ path: `${out}/3-weapons.png` }); // the heroes after moving, holding their weapons
  for (let i = 0; i < 3; i++) {
    await p1.mouse.click(900, 300);
    await p1.waitForTimeout(120);
  }
  await p1.mouse.click(900, 250, { button: 'right' });
  await p1.waitForTimeout(150);
  await p1.screenshot({ path: `${out}/3-attack.png` });

  // F is not a free camera for an ordinary account: the camera stays on the hero.
  await p1.keyboard.press('f');
  await p1.keyboard.down('d');
  await p1.waitForTimeout(600);
  await p1.keyboard.up('d');
  await p1.waitForTimeout(1000);
  {
    const { cam, hero } = await r3dState(p1);
    const gap = cam && hero ? dist(cam, hero) : Infinity;
    console.log(`after F and D: camera ${gap.toFixed(2)} tiles from the hero`);
    if (!(gap < 2)) errors.push(`F moved the camera ${gap} tiles away from the hero`);
  }
  await p1.keyboard.press('f');

  // Settings: three checkboxes, the Quality radios; Fast shrinks the render size and is stored, Balanced restores both.
  await p1.keyboard.press('Escape');
  await p1.click('text=Settings');
  await p1.waitForTimeout(150);
  await p1.screenshot({ path: `${out}/3c-settings.png` });
  if ((await p1.locator('.menu input[type=checkbox]').count()) !== 3) errors.push('Settings view must hold three checkboxes');
  const radios = p1.locator('.menu input[type=radio][name="choice-quality"]');
  if ((await radios.count()) !== 3) errors.push('Settings view must hold three Quality radios');
  if (!(await p1.locator('.menu input[type=radio][name="choice-quality"][value=balanced]').isChecked())) errors.push('Quality must start on Balanced');
  const area = async () => { const r = (await r3dState(p1)).renderSize; return r ? r[0] * r[1] : 0; };
  const stored = () => p1.evaluate(() => { try { return localStorage.getItem('ta.quality'); } catch { return null; } });
  const a0 = await area(); // the render size follows on a frame; a software frame takes up to a second, so allow 10 s
  await p1.click('.menu input[type=radio][name="choice-quality"][value=fast]');
  await p1.waitForFunction((n) => { const r = window.__r3d?.renderSize; return r && r[0] * r[1] < n; }, a0, { timeout: 10000 }).catch(() => errors.push(`Fast did not shrink the render size within 10 s (was ${a0})`));
  if ((await stored()) !== 'fast') errors.push(`localStorage ta.quality is ${await stored()}, expected fast`);
  console.log(`quality Fast: render area ${a0} -> ${await area()}`);
  await p1.click('.menu input[type=radio][name="choice-quality"][value=balanced]');
  await p1.waitForFunction((n) => { const r = window.__r3d?.renderSize; return r && r[0] * r[1] === n; }, a0, { timeout: 10000 }).catch(() => errors.push(`Balanced did not restore the render size within 10 s (want ${a0})`));
  if ((await stored()) !== 'balanced') errors.push(`localStorage ta.quality is ${await stored()}, expected balanced`);
  await p1.click('.menu .settings button');
  await p1.keyboard.press('Escape');

  if (!noChunk) {
    await p2.keyboard.down('a');
    await p2.waitForTimeout(600);
    await p2.keyboard.up('a');
    await p2.mouse.click(300, 300);
    await p2.waitForTimeout(80);
    await p2.screenshot({ path: `${out}/4-p2.png` });
  }
  await p1.keyboard.press('F3');
  await p1.waitForTimeout(600);
  await p1.screenshot({ path: `${out}/5-debug.png` });
  const dbg = await p1.textContent('.debug');
  console.log(dbg);
  await p1.keyboard.press('F3');

  // The address bar was not rewritten, and no effect triangle was refused.
  for (const [name, page] of pages) {
    const now = await page.evaluate(() => location.search);
    if (now !== searchB.get(name)) errors.push(`${name}: location.search changed from "${searchB.get(name)}" to "${now}"`);
    const fx = (await r3dState(page)).fx;
    if (fx == null) errors.push(`${name}: window.__r3d.fx is not set`);
    else if (fx.dropped !== 0) errors.push(`${name}: effect triangles dropped at the caps: ${fx.dropped}`);
  }

  // A second login to Alice's account closes her first window.
  // Its own browser: in the shared one, its WebGL start queues behind the two running
  // software-rendered games and blocks its page for ~30 s (#175).
  browser2 = await launch();
  p3 = await open('Alice2', browser2);
  await login(p3, a1.account, false);
  await p3.click('[data-open]');
  await p3.waitForSelector('[data-attr]');
  await p3.click('#to-dungeon');
  await p3.waitForSelector('#runname');
  await p1.waitForFunction(() => /another window/.test(document.body.textContent ?? ''), null, { timeout: 10000 });
  console.log('second login closed the first window');

  // Bob leaves the run and deletes his account by typing the password (it contains
  // w, a, s, d, e: game keys must not be swallowed outside the game).
  if (!noChunk) {
    await p2.keyboard.press('Escape');
    await p2.click('text=Leave dungeon');
    await p2.click('#to-hub');
    await p2.click('#to-roster');
    await p2.click('#delete-account');
    await p2.click('#delete-password');
    await p2.keyboard.type(PASSWORD);
    typed = await p2.inputValue('#delete-password');
    if (typed !== PASSWORD) errors.push(`typing in the password box after a run gave "${typed}"`);
    await p2.click('#delete-confirm');
    await p2.waitForSelector('#auth-name', { timeout: 5000 }).then(
      () => console.log('typed the password after a run and deleted the account'),
      () => errors.push('account deletion by typing the password failed'),
    );
  }

  // Admin area (only with ADMIN_USER / ADMIN_PASSWORD set, as on the server): live
  // data, then delete Alice's character, change her password and delete her.
  adminDone = process.env.ADMIN_USER && process.env.ADMIN_PASSWORD ? await adminPass() : false;
} catch (e) {
  errors.push(`failed: ${e.message.split('\n')[0]}`);
}


async function adminPass() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`admin pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(`admin console: ${m.text()}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(new URL('admin', base).href);
  await page.fill('input[name=name]', process.env.ADMIN_USER);
  await page.fill('input[name=password]', process.env.ADMIN_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('.tile.hero');
  await page.waitForSelector(`text=${a1.account}`);
  console.log(`admin: dashboard shows ${await page.textContent('.tile.hero .tile-value')} online, ${a1.account} among them`);
  await page.screenshot({ path: `${out}/6-admin-dashboard.png`, fullPage: true });

  await page.click('nav >> text=Players');
  await page.fill('input[type=search]', a1.account);
  await page.click(`a:text-is("${a1.account}")`);
  await page.waitForSelector('text=Change password');
  await page.screenshot({ path: `${out}/7-admin-player.png`, fullPage: true });
  await page.click('button:text-is("Delete")'); // her only character (confirm dialog accepted)
  await page.waitForSelector('.flash >> text=deleted');
  await p3.waitForFunction(() => /deleted by an admin/.test(document.body.textContent ?? ''), null, { timeout: 10000 });
  console.log('admin: deleting the character logged its player out');

  const NEW = 'admin-set-password';
  await page.fill('input[autocomplete=new-password] >> nth=0', NEW);
  await page.fill('input[autocomplete=new-password] >> nth=1', NEW);
  await page.click('button:text-is("Change password")');
  await page.waitForSelector('.flash >> text=Password of');
  const logins = await page.evaluate(
    async ([name, oldPw, newPw]) => {
      const tryLogin = (password) => fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password }) }).then((r) => r.status);
      return [await tryLogin(oldPw), await tryLogin(newPw)];
    },
    [a1.account, PASSWORD, NEW],
  );
  if (logins.join() !== '401,200') errors.push(`after the admin changed the password: old/new login gave ${logins}`);
  else console.log('admin: old password refused, new one works');

  await page.fill(`input[aria-label="Type ${a1.account} to confirm deleting the player"]`, a1.account);
  await page.click('button:text-is("Delete player")');
  await page.waitForSelector('.flash >> text=deleted');
  await page.click('nav >> text=Audit log');
  await page.waitForSelector(`td:text-is("${a1.account}")`);
  const actions = await page.$$eval('tbody tr', (rows) => rows.slice(0, 3).map((r) => r.children[2].textContent));
  if (actions.join() !== 'Deleted player,Changed password,Deleted character') errors.push(`audit log shows ${actions}`);
  else console.log('admin: audit log lists all three actions');
  await page.screenshot({ path: `${out}/8-admin-audit.png` });
  await ctx.close();
  return true;
}


// Clean up: delete the remaining throwaway accounts (and Bob's, if the form failed), whatever happened above.
try {
  for (const [page, account] of [
    ...(adminDone ? [] : [[p3 ?? p1, a1?.account]]),
    ...(typed === PASSWORD ? [] : [[p2, a2?.account]]),
  ]) {
    if (!page || !account) continue;
    const status = await deleteAccount(page).catch((e) => `error ${e.message.split('\n')[0]}`);
    if (status !== 204) errors.push(`deleting ${account}: HTTP ${status}`);
  }
} finally {
  // Whatever is left (a step threw before the account was deleted, a page is gone) goes with the database.
  const left = created.filter((n) => /^e2e_[0-9a-f]+$/.test(n));
  if (left.length) {
    try {
      execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'tiny', '-d', 'tiny', '-c', `delete from accounts where name in (${left.map((n) => `'${n}'`).join(',')})`], { stdio: 'ignore' });
    } catch (e) { errors.push(`database cleanup failed: ${e.message.split('\n')[0]}`); }
  }
  console.log(errors.length ? errors.join('\n') : 'no browser errors');
  await browser.close();
  await browser2?.close();
}
if (errors.length) process.exit(1);
