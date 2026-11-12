// Dev page ?lights (no server): the light sources on a small board. Four torches
// in four colours, a lava pool with a warm torch beside it (colour mixing), a
// fireball flying down a corridor into a dark room and back, an explosion
// (a short Blast flash) in the dark room's doorway while the fireball is at
// its far end, a frost bolt circling in the first room, and a blue torch that
// switches every 3 s.
// `&slow=N` slows time. Key V cycles the viewer's darkvision 0 / 50% / 100% (greyscale
// where it sees only by darkvision); `&dv=0.5` starts with it.
// Two pillars in room 1 show the straight shadow edges (the vision mask). Click
// moves the viewer (`&at=x,y` in tiles starts it there); E toggles old (tile)
// and new edges (`&edges=old` starts with the old ones).
import Phaser from 'phaser';
import { CONST, LIGHT_KIND } from '../generated/defs';
import { TILE } from '../sim/map';
import { demoBoard } from './contextrestore';
import { Effects, DEPTH } from './effects';
import { LightField } from './light';
import { syncDarkvisionFX } from './darkvisionfx';
import { LightView, nextDarkvision } from './lightview';
import { BLUE, BOOM_X, FIRE_COLOUR, H, LOOP, SWITCH, TORCHES, VIEWER, W, boltsAt, buildMap, lavaLights, movingAt } from './lightsDemoScript';
import { TerrainLayer } from './terrain';
import { TorchView } from './torch';
import { VisionMask } from './visionmask';

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
  private mask!: VisionMask;
  /** The viewer in px: `&at=x,y` (tiles) or the middle of room 1; a click moves it. */
  private viewer = (() => {
    const at = new URLSearchParams(location.search).get('at')?.split(',').map(Number);
    return at?.length === 2 && at.every(Number.isFinite) ? { x: at[0] * TILE, y: at[1] * TILE } : { x: (VIEWER[0] + 0.5) * TILE, y: (VIEWER[1] + 0.5) * TILE };
  })();
  /** Straight edges (the vision mask) or the old tile edges (E, `&edges=old`). */
  private straight = new URLSearchParams(location.search).get('edges') !== 'old';
  private dot!: Phaser.GameObjects.Arc;
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

    demoBoard(this, map);
    this.layer = new TerrainLayer(this, map, this.fx);

    this.field = new LightField(map);
    let id = 1;
    // Each torch's light on the tile its spot lies in; the spots with a torch figure get a sprite.
    for (const t of TORCHES) {
      this.field.add({ id, kind: LIGHT_KIND.Torch, colour: t.colour, x: Math.floor(t.x / TILE), y: Math.floor(t.y / TILE), on: true });
      if (t.blue) this.blue.id = id;
      if (t.sprite) this.torches.push({ view: new TorchView(this), x: t.x, y: t.y, side: t.side, blue: t.blue });
      id++;
    }
    for (const l of lavaLights(map)) this.field.add({ id: id++, kind: LIGHT_KIND.Lava, colour: 0xff4818, x: l.x, y: l.y, on: true });
    this.view = new LightView(this, map, this.field);
    this.mask = new VisionMask(this, map);
    this.dot = this.add.circle(0, 0, 2, 0xffffff).setDepth(DEPTH.numbers);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!map.opaqueAt(p.worldX, p.worldY)) this.viewer = { x: p.worldX, y: p.worldY };
    });

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
    this.input.keyboard!.on('keydown-E', () => {
      this.straight = !this.straight;
      this.showCaption();
    });
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
        `\ndarkvision ${Math.round(this.darkvision * 100)}% (V), edges ${this.straight ? 'straight' : 'old'} (E), click moves the viewer`,
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
    const { fx, fy, cx, cy, sinceBoom } = boltsAt(this.t);
    // An explosion in the dark room's doorway (in the viewer's sight) while the fireball is at its far end, out of sight.
    if (sinceBoom >= 0 && prev % LOOP < LOOP / 2) this.fx.blast(BOOM_X, fy, 20);
    // Frost bolt: a circle of 2.5 tiles in the north of room 1.
    this.fireball.setPosition(fx, fy);
    this.frost.setPosition(cx, cy);

    const moving = movingAt(this.t);
    this.view.wide = this.straight;
    this.view.update(this.cameras.main.worldView, this.viewer.x, this.viewer.y, moving, this.t, this.darkvision, CONST.FOV_RADIUS);
    this.mask.enabled = this.straight;
    this.mask.update(this.cameras.main.worldView, this.view.view);
    this.dot.setPosition(this.viewer.x, this.viewer.y);
    syncDarkvisionFX(this.cameras.main, this.darkvision, this.view.mask, [W * TILE, H * TILE]);
  }
}
