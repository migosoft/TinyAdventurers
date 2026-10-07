// Publishes the 0x72 "16x16 DungeonTileset II" sheet (CC0) as a Phaser atlas:
// public/assets/atlas.png + atlas.json with the pack's own frame names
// (e.g. `knight_m_run_anim_f2`, `weapon_axe`, `floor_3`), plus a few pack
// frames recolored with pack colors (see RECOLORS, e.g. the summoner), plus
// the generated terrain tiles (water, lava, chasm; see terrain-tiles.ts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng, type Image } from './png';
import { buildTerrain } from './terrain-tiles';

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

// Recolored variants of pack frames, in a strip added below the sheet. Each
// swaps whole pack colors for other pack colors (the art stays the pack's).
const RECOLORS: { from: string; to: string; colors: Record<string, string> }[] = [
  // Summoner: the necromancer's purple robe in the imp's and chort's reds.
  { from: 'necromancer_anim_f', to: 'summoner_anim_f', colors: { '5f2d56': '62232f', '9f294e': 'da4e38' } },
];
const src = decodePng(fs.readFileSync(sheet));
const STRIP = 32;
const f1 = (frames['floor_1'] as { frame: { x: number; y: number } }).frame;
const floor1 = new Uint8Array(16 * 16 * 4);
for (let y = 0; y < 16; y++) floor1.set(src.data.subarray(((f1.y + y) * src.w + f1.x) * 4, ((f1.y + y) * src.w + f1.x + 16) * 4), y * 64);
const terrain = buildTerrain(floor1);
if (terrain.img.w > src.w) throw new Error('atlas: terrain sheet wider than the pack sheet');
const terrainY = src.h + STRIP * RECOLORS.length;
const outH = terrainY + terrain.img.h;
const out: Image = { w: src.w, h: outH, data: new Uint8Array(src.w * outH * 4) };
out.data.set(src.data);
RECOLORS.forEach((r, row) => {
  let dx = 0;
  for (let i = 0; frames[`${r.from}${i}`]; i++) {
    const f = (frames[`${r.from}${i}`] as { frame: { x: number; y: number; w: number; h: number } }).frame;
    const dy = src.h + row * STRIP;
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const s = ((f.y + y) * src.w + f.x + x) * 4;
        const d = ((dy + y) * out.w + dx + x) * 4;
        const hex = Array.from(src.data.subarray(s, s + 3), (v) => v.toString(16).padStart(2, '0')).join('');
        const to = src.data[s + 3] ? r.colors[hex] : undefined;
        out.data.set(to ? [0, 2, 4].map((k) => parseInt(to.slice(k, k + 2), 16)).concat(src.data[s + 3]) : src.data.subarray(s, s + 4), d);
      }
    frames[`${r.to}${i}`] = { ...(frames[`${r.from}${i}`] as object), frame: { x: dx, y: src.h + row * STRIP, w: f.w, h: f.h } };
    dx += f.w;
  }
});

// Generated terrain tiles below the recolor strips.
for (let y = 0; y < terrain.img.h; y++)
  out.data.set(terrain.img.data.subarray(y * terrain.img.w * 4, (y + 1) * terrain.img.w * 4), ((terrainY + y) * out.w) * 4);
for (const [name, f] of Object.entries(terrain.frames))
  frames[name] = { frame: { x: f.x, y: terrainY + f.y, w: f.w, h: f.h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h }, sourceSize: { w: f.w, h: f.h } };

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'atlas.png'), encodePng(out));
fs.writeFileSync(path.join(outDir, 'atlas.json'), JSON.stringify({ frames, meta: { image: 'atlas.png', scale: 1 } }));
console.log(`atlas: ${Object.keys(frames).length} frames from the 0x72 pack (${RECOLORS.length} recolored, ${Object.keys(terrain.frames).length} terrain) -> public/assets/atlas.{png,json}`);
