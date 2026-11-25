// Check shots of the pond page (#360): every demo pond at=pond (zoom 2 and 6), mouth and bridge, at hours 9.5 and 18.5, t=3.
// node pond-shots.mjs [base] [outDir]; GPU=1 for the real card (gpu.mjs). Fails on a browser error.
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
for (const s of shots) {
  await p.goto(`${base}?r3d=pond${s.q}&t=3&hourRate=0`);
  await p.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 120000 });
  // The trees are grown a few per frame, nearest to the knight first: give them a few seconds.
  await p.waitForTimeout(Number(process.env.WAIT_MS) || 6000);
  await p.getByText('Hide').click().catch(() => {});
  await p.screenshot({ path: `${out}/${s.name}.png` });
}
console.log(errs.join('\n') || 'no browser errors');
await b.close();
if (errs.length) process.exit(1);
