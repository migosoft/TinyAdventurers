// Pictures of the 3D trees on the dev page (?r3d=woodland, WebGL2): one screenshot of a named view of the line-ups and the forest.
// Usage: node r3d-trees.mjs [baseUrl] [outDir] [view ...]
// Views: leaf, shapes, plain, dead, willow, forest08, forest13 (default: all). Each is a camera spot (`at`, tiles), zoom and parameters of the page;
// `at=x,z` starts the knight, and the camera that follows it, on that tile; `sight=0` takes the mist away.
// Env: GPU=1 a visible window on the discrete card (WebGL2 over ANGLE-Vulkan, see gpu.mjs), BROWSER the browser, R3D_W / R3D_H the window (1600x900),
// WAIT_MS the time allowed for the forest to grow (120000), R3D_BASE_QUERY extra parameters for every view.
import { launch, gpuOn, printGpu } from './gpu.mjs';
import { watchPage } from './r3d-page.mjs';

const base = process.argv[2] ?? 'http://localhost:8080/';
const out = process.argv[3] ?? 'shots/trees-329';
// at: the tile the knight and the camera start on (`at=x,z`); it must be a walkable tile.
const VIEWS = {
  leaf: { at: '15,17', zoom: 3, q: '&hour=11&hourRate=0&wind=0&sight=0' },
  shapes: { at: '20,12', zoom: 2, q: '&hour=11&hourRate=0&wind=0&sight=0' },
  plain: { at: '20,12', zoom: 2, q: '&hour=11&hourRate=0&wind=0&sight=0&plain=1' },
  dead: { at: '29,17', zoom: 4, q: '&hour=11&hourRate=0&wind=0&sight=0' },
  willow: { at: '36,16', zoom: 4, q: '&hour=11&hourRate=0&wind=0&sight=0' },
  forest08: { at: '20,6', zoom: 3, q: '&hour=8&hourRate=0&sight=0' },
  forest13: { at: '20,6', zoom: 3, q: '&hour=13&hourRate=0&sight=0' },
};
const wanted = process.argv.slice(4).length ? process.argv.slice(4) : Object.keys(VIEWS);
const browser = await launch();
const errs = [];
const page = await browser.newPage({ viewport: { width: Number(process.env.R3D_W) || 1600, height: Number(process.env.R3D_H) || 900 } });
watchPage(page, '', errs);
const built = () => page.evaluate(() => { const p = window.__r3d?.plants; return p ? [p.built, p.total] : null; });
for (const name of wanted) {
  const v = VIEWS[name];
  if (!v) { errs.push(`unknown view ${name}`); continue; }
  await page.goto(`${base}?r3d=woodland&backend=webgl&quality=high&at=${v.at}&zoom=${v.zoom}${v.q}${process.env.R3D_BASE_QUERY ?? ''}`);
  await page.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 60000 });
  if (gpuOn && name === wanted[0]) await printGpu(page);
  const until = Date.now() + Number(process.env.WAIT_MS || 120000);
  let n = await built();
  while ((!n || n[0] < n[1]) && Date.now() < until) { await page.waitForTimeout(500); n = await built(); }
  if (!n || n[0] < n[1]) errs.push(`${name}: forest not built (${n ? n.join(' of ') : 'no plants count'})`);
  await page.getByRole('button', { name: 'Hide', exact: true }).click(); // the panel off the picture
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${name}: ${n ? n.join(' of ') : '?'} trees`);
}
console.log(errs.join('\n') || 'no browser errors');
await browser.close();
if (errs.length) process.exit(1);
