// Two-player smoke test: register two throwaway accounts, create a character each,
// create/join a run, start, move, attack, screenshots; then a second login closes
// the first window, and both accounts are deleted again.
// Usage: node smoke.mjs [baseUrl] [query] [outDir] [Class1,Class2]
//   e.g. node smoke.mjs http://localhost:8080/ "?debug&boss=dragon" shots Paladin,Wizard
// Set BROWSER to a Chrome/Edge executable if Edge is not at the default Windows path.
// Set LOG=1 to turn the rules log on in both windows (key L) and assert that a `.rules-log .rl-row` appears.
// An empty start room logs nothing, so use LOG=1 with a `debug` query (F8 puts a debug effect on Alice).
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
  await page.waitForSelector('.ui-roster');
}
/** Registers a fresh account, creates a character of `cls` (its hub opens) and enters the runs list with it. */
async function player(name, cls, shots) {
  const account = `e2e_${tag()}`;
  const page = await open(name);
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
// Your own row offers the loadout selects until you are Ready.
await p2.waitForSelector('[data-own="Primary"]', { timeout: 5000 });
await p2.click('#ready');
await p2.waitForFunction(() => !document.querySelector('[data-own]'));
console.log('waiting room: own loadout picker shown');
await p1.waitForFunction(() => document.querySelectorAll('.players .ok').length === 2);
await p1.click('#start');
await p1.waitForSelector('#game.active', { timeout: 10000 });
await p2.waitForSelector('#game.active', { timeout: 10000 });
await p1.waitForTimeout(1500);
await p1.screenshot({ path: `${out}/2-start.png` });

const logOn = process.env.LOG === '1';
if (logOn) {
  await p1.keyboard.press('l');
  await p2.keyboard.press('l');
}

// Move and attack.
await p1.mouse.move(900, 300);
await p1.keyboard.down('w');
await p1.waitForTimeout(900);
await p1.keyboard.up('w');
await p1.keyboard.down('d');
await p1.waitForTimeout(500);
await p1.keyboard.up('d');
await p1.screenshot({ path: `${out}/3-weapons.png` }); // the heroes after moving, holding their weapons
for (let i = 0; i < 3; i++) {
  await p1.mouse.click(900, 300);
  await p1.waitForTimeout(120);
}
await p1.mouse.click(900, 250, { button: 'right' });
await p1.waitForTimeout(150);
await p1.screenshot({ path: `${out}/3-attack.png` });
await p1.keyboard.press('Escape');
await p1.click('text=Settings');
await p1.waitForTimeout(150);
await p1.screenshot({ path: `${out}/3c-settings.png` });
if ((await p1.locator('.menu input[type=checkbox]').count()) !== 3) throw new Error('Settings view must hold three checkboxes');
await p1.click('.menu .settings button');
await p1.keyboard.press('Escape');
await p2.keyboard.down('a');
await p2.waitForTimeout(600);
await p2.keyboard.up('a');
await p2.mouse.click(300, 300);
await p2.waitForTimeout(80);
await p2.screenshot({ path: `${out}/4-p2.png` });
if (logOn && query.includes('debug')) {
  // The start room is usually empty of enemies; a debug effect on her own hero (F8) is a certain log event.
  await p1.keyboard.press('F8');
  await p1.waitForTimeout(500);
}
if (logOn && !query.includes('debug')) console.log('WARNING: LOG=1 without a debug query: the empty start room logs nothing, so the row assertion is skipped');
if (logOn && query.includes('debug')) {
  // Both windows must show at least one row: this also proves the opt-in reaches the run.
  for (const [name, page] of [['Alice', p1], ['Bob', p2]]) {
    await page.waitForSelector('.rules-log .rl-row', { timeout: 10000 }).then(
      async () => console.log(`rules log: ${name} sees ${await page.locator('.rules-log .rl-row').count()} rows`),
      () => errors.push(`rules log: no .rules-log .rl-row appeared for ${name}`),
    );
  }
  await p1.screenshot({ path: `${out}/3b-log.png` });
}
await p1.keyboard.press('F3');
await p1.waitForTimeout(600);
await p1.screenshot({ path: `${out}/5-debug.png` });
const dbg = await p1.textContent('.debug');
console.log(dbg);
// With ?debug only: F4 (debug darkvision) twice, 0 -> 50% -> 100%; the greyscale shows
// where she sees only by darkvision. A failure is logged, never thrown past the cleanup below.
if (query.includes('debug')) {
  try {
    for (const want of ['50%', '100%']) {
      await p1.keyboard.press('F4');
      await p1.waitForFunction((w) => document.querySelector('.debug')?.textContent?.includes(`darkvision ${w}`), want, { timeout: 5000 });
    }
    await p1.screenshot({ path: `${out}/5-darkvision.png` });
    console.log('F4 darkvision: 50% -> 100%');
  } catch (e) {
    console.log(`F4 darkvision FAILED: ${e.message.split('\n')[0]}`);
  }
} else console.log('F4 darkvision step skipped (no debug in the query)');

// A second login to Alice's account closes her first window.
const p3 = await open('Alice2');
await login(p3, a1.account, false);
await p3.click('[data-open]');
await p3.waitForSelector('[data-attr]');
await p3.click('#to-dungeon');
await p3.waitForSelector('#runname');
await p1.waitForFunction(() => /another window/.test(document.body.textContent ?? ''), null, { timeout: 10000 });
console.log('second login closed the first window');

// Bob leaves the run and deletes his account by typing the password (it contains
// w, a, s, d, e: game keys must not be swallowed outside the game).
await p2.keyboard.press('Escape');
await p2.click('text=Leave dungeon');
await p2.click('#to-hub');
await p2.click('#to-roster');
await p2.click('#delete-account');
await p2.click('#delete-password');
await p2.keyboard.type(PASSWORD);
const typed = await p2.inputValue('#delete-password');
if (typed !== PASSWORD) errors.push(`typing in the password box after a run gave "${typed}"`);
await p2.click('#delete-confirm');
await p2.waitForSelector('#auth-name', { timeout: 5000 }).then(
  () => console.log('typed the password after a run and deleted the account'),
  () => errors.push('account deletion by typing the password failed'),
);

// Admin area (only with ADMIN_USER / ADMIN_PASSWORD set, as on the server): live
// data, then delete Alice's character, change her password and delete her.
const adminDone = process.env.ADMIN_USER && process.env.ADMIN_PASSWORD ? await adminPass() : false;

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
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: `${out}/6-admin-dashboard-dark.png`, fullPage: true });
  await page.emulateMedia({ colorScheme: 'light' });

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

  await page.fill(`input[aria-label="Type ${a1.account} to confirm"]`, a1.account);
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

// Clean up: delete the remaining throwaway account (and Bob's, if the form failed).
for (const [page, account] of [
  ...(adminDone ? [] : [[p3, a1.account]]),
  ...(typed === PASSWORD ? [] : [[p2, a2.account]]),
]) {
  const status = await page.evaluate(
    (password) => fetch('/api/account', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }).then((r) => r.status),
    PASSWORD,
  );
  if (status !== 204) errors.push(`deleting ${account}: HTTP ${status}`);
}
console.log(errors.length ? errors.join('\n') : 'no browser errors');
await browser.close();
