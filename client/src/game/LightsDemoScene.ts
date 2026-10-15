// Dev page ?lights (no server): the light sources on a small board. Four torches
// in four colours, a lava pool with a warm torch beside it (colour mixing), a
// fireball flying down a corridor into a dark room and back, an explosion
// (a short Blast flash) in the dark room's doorway while the fireball is at
// its far end, a frost bolt circling in the first room, and a blue torch that
// switches every 3 s.
// `&slow=N` slows time. Key V cycles the viewer's darkvision 0 / 50% / 100% (greyscale
// where it sees only by darkvision); `&dv=0.5` starts with it.
import Phaser from 'phaser';
import { CONST, LIGHT_KIND, TILE_ID } from '../generated/defs';
import type { MovingLight } from '../generated/MovingLight';
import { TILE, TileMap } from '../sim/map';
import { tileDraws } from './autotile';
import { Effects, DEPTH } from './effects';
import { LightField } from './light';
import { syncDarkvisionFX } from './darkvisionfx';
import { LightView, nextDarkvision } from './lightview';
import { TERRAIN, TerrainLayer } from './terrain';
import { TorchView } from './torch';

const W = 30;
const H = 20;
const LOOP = 4;
const SWITCH = 3;
/** How long the explosion at the fireball's turnaround flashes (the server's `BLAST_FLASH`). */
const FLASH = 0.4;
/** The viewer stands in the middle of room 1. */
const VIEWER: [number, number] = [7, 9];
const CORRIDOR_Y = 9;
const BLUE = 0x3060ff;
const FIRE_COLOUR = 0xff7020;
const FROST_COLOUR = 0x78c8ff;

function buildMap(): TileMap {
  const tiles = new Uint8Array(W * H).fill(TILE_ID.Wall);
  const floor = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles[y * W + x] = TILE_ID.Floor;
  };
  floor(2, 3, 11, 15); // room 1
  floor(12, CORRIDOR_Y, 14, CORRIDOR_Y); // corridor
  floor(15, 5, 28, 13); // room 2: the dark pocket
  for (let y = 11; y <= 13; y++) for (let x = 3; x <= 6; x++) tiles[y * W + x] = TERRAIN.Lava;
  return new TileMap(W, H, tiles);
}

export class LightsDemoScene extends Phaser.Scene {
  private slow = Number(new URLSearchParams(location.search).get('slow') ?? 1) || 1;
  /** The viewer's darkvision, 0..1 (V cycles it). */
  private darkvision = Math.min(1, Math.max(0, Number(new URLSearchParams(location.search).get('dv') ?? 0) || 0));
  private caption!: Phaser.GameObjects.Text;
  private t = 0;
  private fx!: Effects;
  private layer!: TerrainLayer;
  private field!: LightField;
  private view!: LightView;
  private fireball!: Phaser.GameObjects.Image;
  private frost!: Phaser.GameObjects.Image;
  private blue = { id: 0, on: true };
  /** Torch sprites: the pixel position the server would send, the side, and whether it is the blue one that toggles. */
  private torches: { view: TorchView; x: number; y: number; side: number; blue: boolean }[] = [];

  constructor() {
    super('lights-demo');
  }

  create(): void {
    const map = buildMap();
    this.cameras.main.setBackgroundColor('#000000');
    this.fx = new Effects(this);

    const rt = this.add.renderTexture(0, 0, W * TILE, H * TILE).setOrigin(0).setDepth(DEPTH.map);
    rt.beginDraw();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        for (const d of tileDraws(map, x, y)) rt.batchDrawFrame('atlas', d.frame, x * TILE, y * TILE + (d.dy ?? 0));
    rt.endDraw();
    this.layer = new TerrainLayer(this, map, this.fx);

    this.field = new LightField(map);
    let id = 1;
    const torch = (x: number, y: number, colour: number) => {
      this.field.add({ id: id++, kind: LIGHT_KIND.Torch, colour, x, y, on: true });
      return id - 1;
    };
    // Torches hang on the first floor row, under the north wall.
    torch(3, 3, 0xffaa5a);
    this.blue.id = torch(5, 3, BLUE);
    torch(8, 3, 0x50ff70);
    torch(10, 3, 0xc040ff);
    torch(7, 12, 0xffaa5a); // beside the lava pool
    // Torch sprites on the four face torches (the wall's bottom edge, as the server positions them)...
    for (const tx of [3, 5, 8, 10]) this.torches.push({ view: new TorchView(this), x: (tx + 0.5) * TILE, y: 3 * TILE + 0.5, side: 0, blue: tx === 5 });
    // ...and one on each side wall of room 1, each with its own light.
    torch(2, 6, 0xffaa5a);
    torch(11, 6, 0xffaa5a);
    this.torches.push({ view: new TorchView(this), x: 2 * TILE + 0.5, y: 6.5 * TILE, side: 1, blue: false });
    this.torches.push({ view: new TorchView(this), x: 12 * TILE - 0.5, y: 6.5 * TILE, side: 2, blue: false });
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (map.get(x, y) === TERRAIN.Lava) this.field.add({ id: id++, kind: LIGHT_KIND.Lava, colour: 0xff4818, x, y, on: true });
    this.view = new LightView(this, map, this.field);

    const glow = (colour: number, scale: number) =>
      this.add.image(0, 0, 'glow').setTint(colour).setScale(scale).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.projectile);
    this.fireball = glow(FIRE_COLOUR, 1.4);
    this.frost = glow(0x9ae0ff, 1);

    this.caption = this.add
      .text(8, 6, '', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#fff',
        stroke: '#000',
        strokeThickness: 2,
        wordWrap: { width: 300 },
      })
      .setResolution(4)
      .setDepth(DEPTH.numbers);
    this.showCaption();
    this.input.keyboard!.on('keydown-V', () => {
      this.darkvision = nextDarkvision(this.darkvision);
      this.showCaption();
    });

    const cam = this.cameras.main;
    cam.setZoom(Math.min(cam.width / (W * TILE), cam.height / (H * TILE)));
    cam.centerOn((W * TILE) / 2, (H * TILE) / 2);
  }

  private showCaption(): void {
    this.caption.setText(
      'lights demo: torches in four colours, lava, torch+lava mix, fireball into a dark room, explosion flash in its doorway, frost bolt; blue torch toggles every 3 s' +
        `\ndarkvision ${Math.round(this.darkvision * 100)}% (V)`,
    );
  }

  update(_t: number, dms: number): void {
    const dt = dms / 1000 / this.slow;
    const prev = this.t;
    this.t += dt;
    this.fx.update(dt);
    this.layer.update(dt);
    if (Math.floor(this.t / SWITCH) !== Math.floor(prev / SWITCH)) {
      this.blue.on = !this.blue.on;
      this.field.set(this.blue.id, this.blue.on, BLUE);
    }
    for (const tr of this.torches) tr.view.update(tr.x, tr.y, !tr.blue || this.blue.on, tr.side, this.t);

    // Fireball: out along the corridor to the far end of room 2 and back.
    const p = (this.t % LOOP) / LOOP;
    const tri = p < 0.5 ? p * 2 : 2 - p * 2;
    const fx = ((VIEWER[0] + 1 + tri * 13) + 0.5) * TILE;
    const fy = (CORRIDOR_Y + 0.5) * TILE;
    // An explosion in the dark room's doorway (in the viewer's sight) while the fireball is at its far end, out of sight.
    const sinceBoom = (this.t % LOOP) - LOOP / 2;
    const boomX = 15.5 * TILE;
    if (sinceBoom >= 0 && prev % LOOP < LOOP / 2) this.fx.explosion(boomX, fy, 20);
    // Frost bolt: a circle of 2.5 tiles in the north of room 1.
    const a = p * Math.PI * 2;
    const cx = (6.5 + 2.5 * Math.cos(a)) * TILE;
    const cy = (6.5 + 2.5 * Math.sin(a)) * TILE;
    this.fireball.setPosition(fx, fy);
    this.frost.setPosition(cx, cy);

    const moving: MovingLight[] = [
      [fx, fy, LIGHT_KIND.Fire, FIRE_COLOUR],
      [cx, cy, LIGHT_KIND.Magic, FROST_COLOUR],
    ];
    if (sinceBoom >= 0 && sinceBoom < FLASH) moving.push([boomX, fy, LIGHT_KIND.Blast, null]);
    this.view.update(this.cameras.main.worldView, (VIEWER[0] + 0.5) * TILE, (VIEWER[1] + 0.5) * TILE, moving, this.t, this.darkvision, CONST.FOV_RADIUS);
    syncDarkvisionFX(this.cameras.main, this.darkvision, this.view.mask, [W * TILE, H * TILE]);
  }
}
