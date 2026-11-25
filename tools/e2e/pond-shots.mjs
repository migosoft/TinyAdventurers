// Check shots of the pond page (#360): every demo pond at=pond (zoom 2 and 6), mouth and bridge, at hours 9.5 and 18.5, t=3.
// node pond-shots.mjs [base] [outDir]; GPU=1 for the real card (gpu.mjs). Fails on a browser error. EXTRA=&cover=0 adds to every URL.
import { launch } from './gpu.mjs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots';
const b = await launch('webgl');
const p = await b.newPage({ viewport: { width: 1280, height: 768 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

const shots = [];
for (let pond = 0; pond < 4; pond++) {
  for (const hour of [9.5, 18.5]) {
    shots.push({ name: `p${pond}-pond-z2-h${hour}`, q: `&pond=${pond}&at=pond&zoom=2&hour=${hour}` });
    shots.push({ name: `p${pond}-pond-z6-h${hour}`, q: `&pond=${pond}&at=pond&zoom=6&hour=${hour}` });
    shots.push({ name: `p${pond}-mouth-h${hour}`, q: `&pond=${pond}&at=mouth&zoom=6&hour=${hour}` });
    shots.push({ name: `p${pond}-bridge-h${hour}`, q: `&pond=${pond}&at=bridge&zoom=6&hour=${hour}` });
  }
}
const fail = async () => { console.log(errs.join('\n')); await b.close(); process.exit(1); };
for (const s of shots) {
  const t0 = Date.now();
  console.log(`shot ${s.name}`);
  try {
    await p.goto(`${base}?r3d=pond${s.q}&t=3&hourRate=0${process.env.EXTRA ?? ''}`);
    await p.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 120000 });
    // The trees are grown a few per frame, nearest to the knight first: give them a few seconds.
    await p.waitForTimeout(Number(process.env.WAIT_MS) || 6000);
    await p.evaluate(() => { const t = document.querySelector('.r3d-toggle'); if (t && t.textContent === 'Hide') t.click(); });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/${s.name}.png` });
  } catch (e) {
    errs.push(`${s.name}: ${e.message}`);
    await fail();
  }
  if (errs.length) await fail();
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
console.log('no browser errors');
await b.close();
