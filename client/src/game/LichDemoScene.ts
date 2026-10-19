// Dev page (?lich): the lich's magic without a server, all of it dark purple
// gloom. Left: the gloom bolt volley (5 bolts) and the summon (5 raised
// skeletons and 5 raised archers in a ring). Right: the nova; the ring on the
// floor shows the real radius and fills up during the wind-up, then every
// hero inside is hurt and pushed 64 px straight away (one into the chasm);
// the hero just outside is spared. Far right: the effect spells on three
// standing heroes, one after the other: the blinding curse (a dark orb), the
// sleep mist (a purple orb) and the stone gaze (a grey beam, then stone).
import Phaser from 'phaser';
import { ANIM, CLASSES, CONST, EFFECT, EFFECTS, KIND } from '../generated/defs';
import { EntityView } from './anim/EntityView';
import { PROJECTILES } from './anim/defs';
import { DEPTH } from './effects';
import { drawGazeBeam } from './status';
import { TerrainDemo } from './TerrainDemoScene';

const W = 37;
const H = 15;
const NOVA = CONST.LICH_NOVA_RADIUS;
const NOVA_T = CONST.LICH_NOVA_WINDUP;
const KNOCK = CONST.LICH_NOVA_KNOCK;
/** Left arena loop (s): volley wind-up at 0, bolts at 0.5; summon wind-up at 3, raise at 3.7; skeletons gone at 6.5. */
const LOOP = 7;
const BOLT_SPEED = 140;
/** The server's orb speed (LICH_ORB_SPEED, px/s). */
const ORB_SPEED = CONST.LICH_ORB_SPEED;
/** Effect spells loop (s): curse at 0, sleep at 4, gaze at 8. */
const SPELL_LOOP = 12.5;
const SPELLS: { at: number; kind: number; windup: number; effect: number; orb?: number; name: string }[] = [
  { at: 0, kind: KIND.Paladin, windup: CONST.LICH_BLIND_WINDUP, effect: EFFECT.Blind, orb: KIND.BlindOrb, name: 'Paladin' },
  { at: 4, kind: KIND.Wizard, windup: CONST.LICH_SLEEP_WINDUP, effect: EFFECT.Sleep, orb: KIND.SleepOrb, name: 'Wizard' },
  { at: 8, kind: KIND.Barbarian, windup: CONST.LICH_GAZE_WINDUP, effect: EFFECT.Petrified, name: 'Barbarian' },
];

function board(): string[] {
  const g = Array.from({ length: H }, () => Array<string>(W).fill(' '));
  const fill = (x0: number, x1: number, y0: number, y1: number, c: string): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c;
  };
  fill(0, 13, 0, 14, '.');
  fill(15, 29, 0, 14, '.');
  fill(27, 28, 0, 14, 'C');
  fill(30, 36, 0, 14, '.');
  return g.map((r) => r.join(''));
}

interface Target {
  v: EntityView;
  x: number;
  y: number;
  /** Seconds the effect has left (0: none). */
  left: number;
}

interface Orb {
  img: Phaser.GameObjects.Image;
  kind: number;
  x: number;
  y: number;
  to: number;
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
  protected title = 'lich: gloom bolt volley, summon 5 + 5 skeletons (left); nova: everyone inside the ring is pushed 64 px (middle); curse, sleep, gaze (right)';
  protected rows = board();
  private caster!: EntityView;
  private casterAt: [number, number] = [0, 0];
  private clock = 0;
  private bolts: Bolt[] = [];
  private raised: EntityView[] = [];
  private raisedAt: [number, number][] = [];
  private spellLich!: EntityView;
  private spellAt: [number, number] = [0, 0];
  private targets: Target[] = [];
  private orbs: Orb[] = [];
  private beam!: Phaser.GameObjects.Graphics;

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
    hero(KIND.ElvenRanger, 'Ranger', CLASSES.ElvenRanger.speed, [19.6, 9.8]);
    hero(KIND.Barbarian, 'Barbarian', CLASSES.Barbarian.speed, [17.6, 7.2]);
    // Effect spells: a third lich and three heroes standing still.
    this.spellAt = this.px([31, 7]);
    this.spellLich = new EntityView(this, KIND.Lich, this.fx, 'Lich 3');
    this.orbs = [];
    this.targets = SPELLS.map((sp, i) => {
      const [x, y] = this.px([35.5, 2.5 + i * 4.5]);
      this.label(32.4, 3.2 + i * 4.5, ['blinding curse', 'sleep mist', 'stone gaze'][i]);
      return { v: new EntityView(this, sp.kind, this.fx, sp.name), x, y, left: 0 };
    });
    this.beam = this.add.graphics().setDepth(DEPTH.fx);
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

    this.spells(this.clock - dt, dt);

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

  /** The effect spells: wind-up towards the target, then an orb (curse, sleep) or the gaze landing (stone). */
  private spells(before: number, dt: number): void {
    const k = this.clock % SPELL_LOOP;
    const p = before % SPELL_LOOP;
    const crossed = (at: number): boolean => (p < at && k >= at) || (k < p && at <= k);
    const [lx, ly] = this.spellAt;
    let anim: number = ANIM.Idle;
    let animT = 0;
    let aim = 0;
    const g = this.beam.clear();
    SPELLS.forEach((sp, i) => {
      const t = this.targets[i];
      const end = sp.at + sp.windup;
      if (k >= sp.at && k < end + 0.3) {
        aim = Math.atan2(t.y - ly, t.x - lx);
        animT = k - sp.at;
        // Curse and sleep wind up (Windup), the gaze stares (Gaze); then the cast.
        anim = k >= end ? ANIM.Cast : sp.orb ? ANIM.Windup : ANIM.Gaze;
        if (k >= end) animT = k - end;
        if (anim === ANIM.Gaze) drawGazeBeam(g, lx, ly, t.x, t.y, this.clock);
      }
      if (crossed(end)) {
        if (sp.orb) {
          const pd = PROJECTILES[sp.orb];
          const img = this.add.image(lx, ly - 8, 'glow').setTint(pd.glow ?? 0xffffff).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.projectile);
          const a = Math.atan2(t.y - ly, t.x - lx);
          this.orbs.push({ img, kind: sp.orb, x: lx + Math.cos(a) * 8, y: ly + Math.sin(a) * 8, to: i });
        } else t.left = EFFECTS[sp.effect].duration;
      }
    });
    this.spellLich.update({ x: lx, y: ly, anim, animT, aim, flags: 0 }, dt);

    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      const t = this.targets[o.to];
      const dx = t.x - o.x;
      const dy = t.y - o.y;
      const d = Math.hypot(dx, dy);
      const step = ORB_SPEED * dt;
      if (d <= step + 4) {
        // The orb lands: a gloomy burst and the effect.
        this.fx.burst(t.x, t.y - 8, 10, PROJECTILES[o.kind].trail ?? 0xffffff, 40, 0.4);
        t.left = EFFECTS[SPELLS[o.to].effect].duration;
        o.img.destroy();
        this.orbs.splice(i, 1);
        continue;
      }
      o.x += (dx / d) * step;
      o.y += (dy / d) * step;
      const pd = PROJECTILES[o.kind];
      o.img.setPosition(Math.round(o.x), Math.round(o.y - 8)).setScale(pd.scale * (0.8 + Math.random() * 0.35)).setAlpha(0.7 + Math.random() * 0.3);
      this.fx.gloomWisp(o.x, o.y - 8);
    }

    this.targets.forEach((t, i) => {
      t.left = Math.max(0, t.left - dt);
      const bits = t.left > 0 ? 1 << SPELLS[i].effect : 0;
      t.v.update({ x: t.x, y: t.y, anim: ANIM.Idle, animT: k, aim: Math.PI, flags: 0, effects: bits }, dt);
    });
  }
}
