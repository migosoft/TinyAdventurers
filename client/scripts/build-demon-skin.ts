// Builds the demon's skin ahead of time into public/assets/demon-skin.bin (gitignored, like the atlas). The header holds a hash of
// the three source files, so an unchanged skin is not built again (the fine build takes about half a minute); FORCE=1 rebuilds.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemonSkin } from '../src/render3d/demon/body';
import { encodeSkin, skinFileHash } from '../src/render3d/demon/skinFile';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src', 'render3d', 'demon');
const out = path.join(root, 'public', 'assets', 'demon-skin.bin');

const h = crypto.createHash('sha256');
for (const f of ['sdf.ts', 'body.ts', 'skinFile.ts']) h.update(fs.readFileSync(path.join(src, f)));
const hash = h.digest().readUInt32LE(0) || 1;

if (!process.env.FORCE && fs.existsSync(out)) {
  const b = fs.readFileSync(out);
  if (skinFileHash(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) === hash) {
    console.log('demon skin: up to date');
    process.exit(0);
  }
}
const t0 = Date.now();
const buf = encodeSkin(buildDemonSkin(), hash);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(buf));
console.log(`demon skin: ${(buf.byteLength / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${path.relative(root, out)}`);
