// Check shots of a figure stirring a puddle (#401): the knight of ?r3d=stone&at=puddle walks east through the nearest puddle.
// node puddle-shots.mjs [base] [outDir] [extra query]; GPU=1 for the real card (gpu.mjs).
import { launch } from './gpu.mjs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? 'shots';
const b = await launch('webgl');
const p = await b.newPage({ viewport: { width: 1280, height: 768 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(`${base}?r3d=stone&at=puddle&zoom=10${process.argv[4] ?? ''}`);
await p.waitForFunction(() => window.__r3d?.frames > 10, null, { timeout: 60000 });
await p.getByText('Hide').click().catch(() => {});
const frames = (n) => p.evaluate((n) => { const f0 = window.__r3d.frames; return new Promise((r) => { const t = () => (window.__r3d.frames >= f0 + n ? r() : requestAnimationFrame(t)); t(); }); }, n);
await p.screenshot({ path: `${out}/puddle-0-before.png` });
await p.keyboard.down('KeyD');
for (let i = 1; i <= 4; i++) { await frames(Number(process.env.STEP) || 8); await p.screenshot({ path: `${out}/puddle-${i}-walk.png` }); }
await p.keyboard.up('KeyD');
await frames(Number(process.env.STEP) || 8);
await p.screenshot({ path: `${out}/puddle-5-after.png` });
console.log(errs.join('\n') || 'no browser errors');
await b.close();
if (errs.length) process.exit(1);
