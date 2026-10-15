// Dev page (?gallery): every figure cycling through all animation states,
// plus projectiles, barrels and the boss hall force field, to check sprites without
// playing to each enemy.
import Phaser from 'phaser';
import { ANIM, CONST, FLAG } from '../generated/defs';
import { FIGURES, PROJECTILES } from './anim/defs';
import { EntityView } from './anim/EntityView';
import { Effects } from './effects';
import { ForceField } from './forcefield';
import { BarrelView } from './barrel';
import { TILE } from '../sim/map';

const STATES: [string, number][] = [
  ['idle', ANIM.Idle],
  ['move', ANIM.Move],
  ['melee', ANIM.Melee],
  ['shoot', ANIM.Shoot],
  ['cast', ANIM.Cast],
  ['windup', ANIM.Windup],
  ['dash', ANIM.Dash],
  ['channel', ANIM.Channel],
  ['breath', ANIM.Breath],
  ['tail', ANIM.Tail],
  ['bite', ANIM.Bite],
  ['takeoff', ANIM.TakeOff],
  ['land', ANIM.Land],
];

export class GalleryScene extends Phaser.Scene {
  private views: { v: EntityView; x: number; y: number }[] = [];
  private fx!: Effects;
  private t = 0;
  private label!: Phaser.GameObjects.Text;
  private fields: ForceField[] = [];
  private barrels: { v: BarrelView; x: number; y: number; explosive: boolean }[] = [];

  constructor() {
    super('gallery');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#25131a');
    this.fx = new Effects(this);
    const kinds = Object.keys(FIGURES).map(Number);
    kinds.forEach((k, i) => {
      const x = 40 + (i % 8) * 70;
      const y = 80 + Math.floor(i / 8) * 110;
      this.views.push({ v: new EntityView(this, k, this.fx, `${k}`), x, y });
    });
    Object.entries(PROJECTILES).forEach(([, pd], i) => {
      const img = pd.frame ? this.add.image(0, 0, 'atlas', pd.frame).setRotation(Math.PI / 2) : this.add.image(0, 0, 'glow').setTint(pd.glow!).setBlendMode(Phaser.BlendModes.ADD);
      img.setScale(pd.scale).setPosition(40 + i * 30, 320);
    });
    // Force fields on a patch of floor: a horizontal and a vertical entrance (tile coordinates).
    for (let y = 2; y <= 10; y++) for (let x = 35; x <= 39; x++) this.add.image(x * TILE, y * TILE, 'atlas', 'floor_1').setOrigin(0);
    this.fields.push(new ForceField(this, this.fx, [[35, 3], [36, 3], [37, 3]], true));
    this.fields.push(new ForceField(this, this.fx, [[38, 6], [38, 7], [38, 8]], true));
    // Barrels: a plain one at rest, an explosive one at rest and one cycling
    // through fuse, falling and sinking.
    [['barrel', 0], ['barrel_explosive', 0], ['barrel_explosive', 1]].forEach(([frame, cycle], i) =>
      this.barrels.push({ v: new BarrelView(this, frame as string), x: 400 + i * 30, y: 340, explosive: cycle === 1 }));
    this.label = this.add.text(8, 6, '', { fontFamily: 'monospace', fontSize: '10px', color: '#fff' });
  }

  // ?gallery&state=melee&slow=8 loops one state in slow motion for inspection.
  private q = new URLSearchParams(location.search);
  private slow = Number(this.q.get("slow") ?? 1) || 1;
  private only = STATES.findIndex(([n]) => n === this.q.get("state"));

  update(_t: number, dms: number): void {
    const dt = dms / 1000 / this.slow;
    this.t += dt;
    const idx = this.only >= 0 ? this.only : Math.floor(this.t / 1.2) % STATES.length;
    const [name, anim] = STATES[idx];
    const animT = this.t % 1.2;
    this.label.setText(`state: ${name}  (hurt flash every 3s)`);
    for (const { v, x, y } of this.views) {
      const aim = Math.sin(this.t * 0.7) * 0.6 + (Math.floor(this.t / 4) % 2 ? Math.PI : 0);
      const flags = Math.floor(this.t * 2) % 6 === 0 ? FLAG.HURT : 0;
      v.update({ x: anim === ANIM.Move ? x + Math.sin(this.t * 3) * 6 : x, y, anim, animT: animT % 0.5, aim, flags }, dt);
    }
    for (const f of this.fields) f.update(dt);
    // Cycle: rest 1 s, fuse, fall, rest, sink.
    const steps: [number, number][] = [[0, 1], [1, CONST.BARREL_FUSE], [2, CONST.FALL_TIME + 0.3], [0, 1], [3, CONST.DROWN_TIME + 0.3]];
    const total = steps.reduce((s, [, d]) => s + d, 0);
    let bt = this.t % total;
    let step = steps[0];
    for (const s of steps) { step = s; if (bt < s[1]) break; bt -= s[1]; }
    for (const { v, x, y, explosive } of this.barrels) v.update(x, y, explosive ? step[0] : 0, explosive ? bt * 1000 : 0);
    this.fx.update(dt);
  }
}
