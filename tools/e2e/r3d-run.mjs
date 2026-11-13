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
const page = await (await browser.newContext({ viewport: { width: 1280, height: 768 } })).newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
// The first /api/me before logging in is an expected 401.
page.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(`console: ${m.text()}`));
// A minimal MessagePack reader for the frames the page sends: an Input goes out as a bare array [seq, mx, my, aim, aim_dist, primary, ...].
function unpack(buf) {
  let p = 0;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const str = (n) => { const s = buf.toString('utf8', p, p + n); p += n; return s; };
  const arr = (n) => Array.from({ length: n }, one);
  const map = (n) => { const o = {}; for (let i = 0; i < n; i++) { const k = one(); o[k] = one(); } return o; };
  function one() {
    const b = buf[p++];
    if (b < 0x80) return b;
    if (b >= 0xe0) return b - 256;
    if (b >= 0xa0 && b < 0xc0) return str(b & 0x1f);
    if (b >= 0x90 && b < 0xa0) return arr(b & 0x0f);
    if (b >= 0x80 && b < 0x90) return map(b & 0x0f);
    const take = (n, f) => { const r = f(p); p += n; return r; };
    switch (b) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xca: return take(4, (o) => v.getFloat32(o));
      case 0xcb: return take(8, (o) => v.getFloat64(o));
      case 0xcc: return take(1, (o) => v.getUint8(o));
      case 0xcd: return take(2, (o) => v.getUint16(o));
      case 0xce: return take(4, (o) => v.getUint32(o));
      case 0xcf: return take(8, (o) => Number(v.getBigUint64(o)));
      case 0xd0: return take(1, (o) => v.getInt8(o));
      case 0xd1: return take(2, (o) => v.getInt16(o));
      case 0xd2: return take(4, (o) => v.getInt32(o));
      case 0xd3: return take(8, (o) => Number(v.getBigInt64(o)));
      case 0xd9: return str(take(1, (o) => v.getUint8(o)));
      case 0xda: return str(take(2, (o) => v.getUint16(o)));
      case 0xdc: return arr(take(2, (o) => v.getUint16(o)));
      case 0xde: return map(take(2, (o) => v.getUint16(o)));
      default: throw new Error(`msgpack byte ${b}`);
    }
  }
  return one();
}
const sentInputs = []; // decoded Input arrays, in order
page.on('websocket', (ws) => ws.on('framesent', (f) => {
  if (typeof f.payload === 'string') return;
  try {
    const m = unpack(f.payload);
    if (Array.isArray(m) && typeof m[0] === 'number' && m.length >= 9) sentInputs.push(m);
  } catch { /* other messages are not read here */ }
}));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z); // window.__r3d.hero / cam are {x, z} in tiles
const r3d = () => page.evaluate(() => ({ hero: window.__r3d?.hero, cam: window.__r3d?.cam, chunks: window.__r3d?.chunks, frames: window.__r3d?.frames, figures: window.__r3d?.figures }));
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
  // The 3D canvas, plus the overlay canvas over it (#311).
  if ((await page.locator('#game canvas.r3d').count()) !== 1) errors.push('expected exactly one 3D canvas in #game');
  if ((await page.locator('#game canvas.r3d-overlay').count()) !== 1) errors.push('expected exactly one overlay canvas in #game');
  if ((await page.locator('#game canvas').count()) !== 2) errors.push('expected exactly two canvases in #game (3D and overlay)');
  await page.screenshot({ path: `${out}/r3d-run-${level}.png` });
  const figures = (await r3d()).figures;
  console.log(`figures drawn ${figures}`);
  if (!(figures >= 1)) errors.push(`no figure drawn (window.__r3d.figures = ${figures})`);

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

  await page.keyboard.press('f'); // back to the follow camera

  // Mouse over the canvas: Z turns the camera 45 degrees, X goes back north; a left click sends a primary.
  const state = () => page.evaluate(() => ({ yaw: window.__r3d?.yaw, overlay: window.__r3d?.overlay }));
  await page.mouse.move(760, 330);
  await page.keyboard.press('z');
  // The turn is eased by frame time (dt is clamped), so slow software frames stretch it: wait for the target, not a fixed time.
  await page.waitForFunction(() => window.__r3d?.yaw === 45, null, { timeout: 5000 }).catch(() => {});
  const yawZ = (await state()).yaw;
  console.log(`yaw after Z ${yawZ}`);
  if (yawZ !== 45) errors.push(`yaw after Z is ${yawZ}, expected 45`);
  await page.screenshot({ path: `${out}/r3d-run-${level}-turned.png` });
  await page.keyboard.press('x');
  await page.waitForFunction(() => window.__r3d?.yaw === 0, null, { timeout: 5000 }).catch(() => {});
  const yawX = (await state()).yaw;
  console.log(`yaw after X ${yawX}`);
  if (yawX !== 0) errors.push(`yaw after X is ${yawX}, expected 0`);
  const overlay = (await state()).overlay;
  console.log(`overlay items ${overlay}`);
  // The dungeon has the neutral knight (a name and a bar) near the start; the woodland start has no creature in sight.
  if (level === 'dungeon' && !(overlay >= 1)) errors.push(`the overlay painted no item (window.__r3d.overlay = ${overlay})`);
  const mark = sentInputs.length;
  await page.mouse.move(800, 300);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const shots = sentInputs.slice(mark).filter((m) => m[5] != null);
  console.log(`primary inputs after the click ${shots.length}`);
  if (shots.length === 0) errors.push('a left click sent no primary Input');
  await page.screenshot({ path: `${out}/r3d-run-${level}-aimed.png` });

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
