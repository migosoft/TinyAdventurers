// Publishes the 0x72 "16x16 DungeonTileset II" sheet (CC0) as a Phaser atlas:
// public/assets/atlas.png + atlas.json with the pack's own frame names
// (e.g. `knight_m_run_anim_f2`, `weapon_axe`, `floor_3`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packDir = path.join(root, 'assets-src', '0x72');
const outDir = path.join(root, 'public', 'assets');

const sheet = path.join(packDir, '0x72_DungeonTilesetII_v1.7.png');
const list = path.join(packDir, 'tile_list_v1.7');
if (!fs.existsSync(sheet) || !fs.existsSync(list)) {
  console.error('atlas: 0x72 pack missing in client/assets-src/0x72 (sheet + tile_list_v1.7)');
  process.exit(1);
}

const frames: Record<string, unknown> = {};
for (const line of fs.readFileSync(list, 'utf8').split(/\r?\n/)) {
  const p = line.trim().split(/\s+/);
  if (p.length < 5) continue;
  const [name, x, y, w, h] = [p[0], +p[1], +p[2], +p[3], +p[4]];
  frames[name] = {
    frame: { x, y, w, h },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w, h },
    sourceSize: { w, h },
  };
}
// The pack names one frame `zombie_anim_f10`; expose it as f0 as well.
if (frames['zombie_anim_f10'] && !frames['zombie_anim_f0']) frames['zombie_anim_f0'] = frames['zombie_anim_f10'];

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(sheet, path.join(outDir, 'atlas.png'));
fs.writeFileSync(path.join(outDir, 'atlas.json'), JSON.stringify({ frames, meta: { image: 'atlas.png', scale: 1 } }));
console.log(`atlas: ${Object.keys(frames).length} frames from the 0x72 pack -> public/assets/atlas.{png,json}`);
