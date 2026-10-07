// Dev page (?gallery): every figure cycling through all animation states,
// plus projectiles, to check sprites without playing to each enemy.
import Phaser from 'phaser';
import { ANIM, FLAG } from '../generated/defs';
import { FIGURES, PROJECTILES } from './anim/defs';
import { EntityView } from './anim/EntityView';
import { Effects } from './effects';

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
];

export class GalleryScene extends Phaser.Scene {
  private views: { v: EntityView; x: number; y: number }[] = [];
  private fx!: Effects;
  private t = 0;
  private label!: Phaser.GameObjects.Text;

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
    this.fx.update(dt);
  }
}
