// Publishes the title logo (assets-src/logo/logo.png, made for this game with
// Google's image generation AI) and its derivatives into public/assets:
// logo.png (login hero, lobby background), logo-emblem.png (the shield with
// the title, small header) and favicon.png (the treasure chest on top).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng, type Image } from './png';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'assets-src', 'logo', 'logo.png');
const outDir = path.join(root, 'public', 'assets');

if (!fs.existsSync(src)) {
  console.error('logo: client/assets-src/logo/logo.png missing');
  process.exit(1);
}
const logo = decodePng(fs.readFileSync(src));

function crop(img: Image, x: number, y: number, w: number, h: number): Image {
  const out: Image = { w, h, data: new Uint8Array(w * h * 4) };
  for (let r = 0; r < h; r++) out.data.set(img.data.subarray(((y + r) * img.w + x) * 4, ((y + r) * img.w + x + w) * 4), r * w * 4);
  return out;
}

/** Area-average downscale to size×size (for the favicon). */
function shrink(img: Image, size: number): Image {
  const out: Image = { w: size, h: size, data: new Uint8Array(size * size * 4) };
  const sx = img.w / size;
  const sy = img.h / size;
  for (let oy = 0; oy < size; oy++)
    for (let ox = 0; ox < size; ox++) {
      const sum = [0, 0, 0, 0];
      let n = 0;
      for (let y = Math.floor(oy * sy); y < Math.floor((oy + 1) * sy); y++)
        for (let x = Math.floor(ox * sx); x < Math.floor((ox + 1) * sx); x++) {
          for (let c = 0; c < 4; c++) sum[c] += img.data[(y * img.w + x) * 4 + c];
          n++;
        }
      for (let c = 0; c < 4; c++) out.data[(oy * size + ox) * 4 + c] = Math.round(sum[c] / n);
    }
  return out;
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'logo.png'), encodePng(logo));
fs.writeFileSync(path.join(outDir, 'logo-emblem.png'), encodePng(crop(logo, 370, 78, 680, 626)));
fs.writeFileSync(path.join(outDir, 'favicon.png'), encodePng(shrink(crop(logo, 638, 76, 144, 144), 64)));
console.log('logo: logo.png, logo-emblem.png, favicon.png');
