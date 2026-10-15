// Publishes the 0x72 "16x16 DungeonTileset II" sheet (CC0) as a Phaser atlas:
// public/assets/atlas.png + atlas.json with the pack's own frame names
// (e.g. `knight_m_run_anim_f2`, `weapon_axe`, `floor_3`), plus a few pack
// frames recolored with pack colors (see RECOLORS, e.g. the summoner), plus
// the generated terrain tiles (water, lava, chasm; see terrain-tiles.ts), plus
// the dragon frames built from its base sprite (see dragon-frames.ts), plus
// the lich's own frames (see lich-frames.ts), plus the demon's frames
// (see demon-frames.ts), plus the barrels (see barrel-frames.ts), plus the torch (see torch-frames.ts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng, type Image } from './png';
import { buildTerrain } from './terrain-tiles';
import { buildDragon } from './dragon-frames';
import { buildLich } from './lich-frames';
import { buildDemon } from './demon-frames';
import { buildBarrels } from './barrel-frames';
import { buildTorches } from './torch-frames';
import { DRAGON_SHEETS, type DragonSheet } from '../src/game/anim/dragonRig';

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
const dragonPng = (f: string) => decodePng(fs.readFileSync(path.join(root, 'assets-src', 'dragon', f)));
const dragonSheets = Object.fromEntries(Object.keys(DRAGON_SHEETS).map((n) => [n, dragonPng(`dragon_${n}.png`)])) as Record<DragonSheet, Image>;
const dragon = buildDragon(dragonPng('dragon_base.png'), dragonSheets, src.w);
const dragonY = terrainY + terrain.img.h;
const lich = buildLich(src.w);
const lichY = dragonY + dragon.img.h;
const demon = buildDemon(path.join(root, 'assets-src', 'demon'), src.w);
const demonY = lichY + lich.img.h;
const barrels = buildBarrels(src.w);
const barrelY = demonY + demon.img.h;
const torches = buildTorches(path.join(root, 'assets-src', 'torch'), src.w);
const torchY = barrelY + barrels.img.h;
const outH = torchY + torches.img.h;
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

// Dragon frames below the terrain.
for (let y = 0; y < dragon.img.h; y++)
  out.data.set(dragon.img.data.subarray(y * dragon.img.w * 4, (y + 1) * dragon.img.w * 4), ((dragonY + y) * out.w) * 4);
for (const [name, f] of Object.entries(dragon.frames))
  frames[name] = { frame: { x: f.x, y: dragonY + f.y, w: f.w, h: f.h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h }, sourceSize: { w: f.w, h: f.h } };

// Lich frames below the dragon.
for (let y = 0; y < lich.img.h; y++)
  out.data.set(lich.img.data.subarray(y * lich.img.w * 4, (y + 1) * lich.img.w * 4), ((lichY + y) * out.w) * 4);
for (const [name, f] of Object.entries(lich.frames))
  frames[name] = { frame: { x: f.x, y: lichY + f.y, w: f.w, h: f.h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h }, sourceSize: { w: f.w, h: f.h } };

// Demon frames below the lich.
for (let y = 0; y < demon.img.h; y++)
  out.data.set(demon.img.data.subarray(y * demon.img.w * 4, (y + 1) * demon.img.w * 4), ((demonY + y) * out.w) * 4);
for (const [name, f] of Object.entries(demon.frames))
  frames[name] = { frame: { x: f.x, y: demonY + f.y, w: f.w, h: f.h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h }, sourceSize: { w: f.w, h: f.h } };

// Barrel frames below the demon.
for (let y = 0; y < barrels.img.h; y++)
  out.data.set(barrels.img.data.subarray(y * barrels.img.w * 4, (y + 1) * barrels.img.w * 4), ((barrelY + y) * out.w) * 4);
for (const [name, f] of Object.entries(barrels.frames))
  frames[name] = { frame: { x: f.x, y: barrelY + f.y, w: f.w, h: f.h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h }, sourceSize: { w: f.w, h: f.h } };

// Torch frames below the barrels.
for (let y = 0; y < torches.img.h; y++)
  out.data.set(torches.img.data.subarray(y * torches.img.w * 4, (y + 1) * torches.img.w * 4), ((torchY + y) * out.w) * 4);
for (const [name, f] of Object.entries(torches.frames))
  frames[name] = { frame: { x: f.x, y: torchY + f.y, w: f.w, h: f.h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h }, sourceSize: { w: f.w, h: f.h } };

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'atlas.png'), encodePng(out));
fs.writeFileSync(path.join(outDir, 'atlas.json'), JSON.stringify({ frames, meta: { image: 'atlas.png', scale: 1 } }));
console.log(`atlas: ${Object.keys(frames).length} frames from the 0x72 pack (${RECOLORS.length} recolored, ${Object.keys(terrain.frames).length} terrain, ${Object.keys(dragon.frames).length} dragon, ${Object.keys(lich.frames).length} lich, ${Object.keys(demon.frames).length} demon, ${Object.keys(barrels.frames).length} barrel, ${Object.keys(torches.frames).length} torch) -> public/assets/atlas.{png,json}`);
