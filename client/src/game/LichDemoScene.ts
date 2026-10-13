// Dev page (?lich): the lich's magic without a server, all of it dark purple
// gloom. Left: the gloom bolt volley (5 bolts) and the summon (5 raised
// skeletons and 5 raised archers in a ring). Right: the nova; the ring on the
// floor shows the real radius and fills up during the wind-up, then every
// hero inside is hurt and pushed 64 px straight away (one into the chasm);
// the hero just outside is spared.
import Phaser from 'phaser';
import { ANIM, CLASSES, CONST, KIND } from '../generated/defs';
import { EntityView } from './anim/EntityView';
import { PROJECTILES } from './anim/defs';
import { DEPTH } from './effects';
import { TerrainDemo } from './TerrainDemoScene';

const W = 30;
const H = 15;
const NOVA = CONST.LICH_NOVA_RADIUS;
const NOVA_T = CONST.LICH_NOVA_WINDUP;
const KNOCK = CONST.LICH_NOVA_KNOCK;
/** Left arena loop (s): volley wind-up at 0, bolts at 0.5; summon wind-up at 3, raise at 3.7; skeletons gone at 6.5. */
const LOOP = 7;
const BOLT_SPEED = 140;

function board(): string[] {
  const g = Array.from({ length: H }, () => Array<string>(W).fill(' '));
  const fill = (x0: number, x1: number, y0: number, y1: number, c: string): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c;
  };
  fill(0, 13, 0, 14, '.');
  fill(15, 29, 0, 14, '.');
  fill(27, 28, 0, 14, 'C');
  return g.map((r) => r.join(''));
}

interface Bolt {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export class LichDemoScene extends TerrainDemo {
  protected title = 'lich: gloom bolt volley, summon 5 + 5 skeletons (left); nova: everyone inside the ring is pushed 64 px (right)';
  protected rows = board();
  private caster!: EntityView;
  private casterAt: [number, number] = [0, 0];
  private clock = 0;
  private bolts: Bolt[] = [];
  private raised: EntityView[] = [];
  private raisedAt: [number, number][] = [];

  constructor() {
    super('lich-demo');
  }

  protected setup(): void {
    this.clock = 0;
    this.bolts = [];
    this.raised = [];
    this.label(0.2, 12.6, 'volley: 5 gloom bolts');
    this.label(0.2, 13.3, 'summon: 5 skeletons + 5 archers');
    this.casterAt = this.px([3, 7]);
    this.caster = new EntityView(this, KIND.Lich, this.fx, 'Lich');

    this.label(15.2, 13.3, `nova: radius ${NOVA} px, ${KNOCK} px push (ogre club: 28 px)`);
    const hero = (kind: number, name: string, speed: number, at: [number, number]): void => this.actor(kind, name, speed, [{ to: at }, { wait: 3 }]);
    hero(KIND.Wizard, 'Wizard', CLASSES.Wizard.speed, [24, 8]);
    hero(KIND.Paladin, 'Paladin', CLASSES.Paladin.speed, [21.5, 5.6]);
    hero(KIND.Assassin, 'Assassin', CLASSES.Assassin.speed, [19.6, 9.8]);
    hero(KIND.Barbarian, 'Barbarian', CLASSES.Barbarian.speed, [17.6, 7.2]);
    this.actor(KIND.Lich, 'Lich 2', 34, [{ to: [21.5, 8] }, { wait: 1.5, face: 0 }, { slam: NOVA, dist: KNOCK, windup: NOVA_T, nova: true }, { wait: 2.5 }]);
  }

  update(t: number, dms: number): void {
    super.update(t, dms);
    const dt = dms / 1000 / this.slow;
    const prev = this.clock % LOOP;
    this.clock += dt;
    const k = this.clock % LOOP;
    const crossed = (at: number): boolean => (prev < at && k >= at) || (k < prev && at <= k);
    const [cx, cy] = this.casterAt;

    if (crossed(0.5)) {
      for (let i = -2; i <= 2; i++) {
        const a = i * 0.2;
        const pd = PROJECTILES[KIND.GloomBolt];
        const img = this.add.image(cx, cy - 8, 'glow').setTint(pd.glow ?? 0xffffff).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.projectile);
        this.bolts.push({ img, x: cx + Math.cos(a) * 8, y: cy + Math.sin(a) * 8, vx: Math.cos(a) * BOLT_SPEED, vy: Math.sin(a) * BOLT_SPEED, life: 1.4 });
      }
    }
    if (crossed(3.7)) {
      const n = 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = cx + Math.cos(a) * 22, y = cy + Math.sin(a) * 22;
        this.fx.raise(x, y, 2);
        this.raised.push(new EntityView(this, i % 2 ? KIND.SkeletonArcher : KIND.RaisedSkeleton, this.fx));
        this.raisedAt.push([x, y]);
      }
    }
    if (crossed(6.5)) {
      for (const v of this.raised) v.destroy();
      this.raised = [];
      this.raisedAt = [];
    }

    // The caster: wind-up, cast, idle.
    const anim = k < 0.5 || (k >= 3 && k < 3.7) ? ANIM.Windup : k < 0.8 || (k >= 3.7 && k < 4) ? ANIM.Cast : ANIM.Idle;
    const animT = k < 3 ? (k < 0.5 ? k : k - 0.5) : k < 3.7 ? k - 3 : k - 3.7;
    this.caster.update({ x: cx, y: cy, anim, animT, aim: 0, flags: 0 }, dt);
    this.raised.forEach((v, i) => v.update({ x: this.raisedAt[i][0], y: this.raisedAt[i][1], anim: ANIM.Idle, animT: k, aim: Math.PI, flags: 0 }, dt));

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      if (b.life <= 0) {
        b.img.destroy();
        this.bolts.splice(i, 1);
        continue;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const pd = PROJECTILES[KIND.GloomBolt];
      b.img.setPosition(Math.round(b.x), Math.round(b.y - 8)).setScale(pd.scale * (0.8 + Math.random() * 0.35)).setAlpha(0.7 + Math.random() * 0.3);
      this.fx.gloomWisp(b.x, b.y - 8);
    }
  }
}
