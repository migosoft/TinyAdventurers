// Dev page (?demon): the red demon without a server, looping through every
// action so its animations can be judged: idle, walking, cleave, the swoop (a
// charge on foot), the ring of fire, and an enraged cleave (shorter wind-up).
// The cleave and the charge push the heroes they hit, with the game's distances.
//
// Keys: Space pauses, S toggles slow motion (1/4), 1-7 jump to an action.
// `?demon&slow=3` starts slowed down.
import Phaser from 'phaser';
import { ANIM, CLASSES, CONST, FLAG, KIND } from '../generated/defs';
import { EntityView } from './anim/EntityView';
import { DEPTH, Effects } from './effects';
import { TILE } from '../sim/map';

const W = 26;
const H = 13;
/** The demon's spot (px). */
const HOME: [number, number] = [9 * TILE, 8 * TILE];
const PUSH_DECAY = 15;
const PUSH_MIN_SPEED = 8;
/** Server numbers: pushes (defs/bosses.rs), swoop speed and ring of fire orbs (demon.rs). */
const CLEAVE_KNOCK = CONST.DEMON_CLEAVE_KNOCK;
const SWOOP_KNOCK = CONST.DEMON_SWOOP_KNOCK;
const SWOOP_SPEED = 260;
const ORB_SPEED = 105;
const ORB_LIFE = 2.2;

interface Hero {
  v: EntityView;
  name: string;
  home: [number, number];
  x: number;
  y: number;
  push: { dx: number; dy: number; v: number } | null;
  hurtT: number;
  backT: number;
}

interface Orb {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  dx: number;
  dy: number;
  life: number;
}

interface Phase {
  name: string;
  dur: number;
  run: (t: number, prevT: number) => void;
}

export class DemonDemoScene extends Phaser.Scene {
  private fx!: Effects;
  private demon!: EntityView;
  private heroes: Hero[] = [];
  private orbs: Orb[] = [];
  private d = { x: HOME[0], y: HOME[1], aim: 0, anim: ANIM.Idle as number, animT: 0, flags: 0 };
  private phases: Phase[] = [];
  private pi = 0;
  private t = 0;
  private paused = false;
  private slow = Number(new URLSearchParams(location.search).get('slow') ?? 1) || 1;
  private caption!: Phaser.GameObjects.Text;
  /** The swoop hits once per charge. */
  private swoopHit = false;

  constructor() {
    super('demon-demo');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#25131a');
    this.fx = new Effects(this);
    for (let y = 2; y < H + 2; y++)
      for (let x = 0; x < W; x++) this.add.image(x * TILE, y * TILE, 'atlas', (x * 7 + y * 3) % 8 === 0 ? 'floor_2' : 'floor_1').setOrigin(0);
    const style = { fontFamily: 'monospace', fontSize: '8px', color: '#fff' };
    this.add.text(4, 4, 'demon: every action in a loop. Space pause, S slow motion, 1-7 jump to an action', style).setResolution(4).setDepth(1e6);
    this.caption = this.add.text(4, 16, '', { ...style, color: '#ffe080' }).setResolution(4).setDepth(1e6);

    this.demon = new EntityView(this, KIND.Demon, this.fx, 'Demon');
    const [hx, hy] = HOME;
    this.hero(KIND.Paladin, 'Paladin', [hx + 30, hy]);
    this.hero(KIND.Wizard, 'Wizard', [hx + 150, hy]);
    this.hero(KIND.Barbarian, 'Barbarian', [hx - 30, hy + 2]);
    this.phases = this.script();

    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Space') this.paused = !this.paused;
      else if (e.key === 's' || e.key === 'S') this.slow = this.slow === 1 ? 4 : 1;
      else if (/^[1-9]$/.test(e.key) && +e.key <= this.phases.length) this.jump(+e.key - 1);
    });
    this.jump(0);
  }

  private hero(kind: number, name: string, home: [number, number]): void {
    const v = new EntityView(this, kind, this.fx, name);
    this.heroes.push({ v, name, home, x: home[0], y: home[1], push: null, hurtT: 0, backT: 0 });
  }

  /** The demon's actions, in loop order. */
  private script(): Phase[] {
    const [hx, hy] = HOME;
    const set = (anim: number, flags = 0) => {
      if (anim !== this.d.anim) this.d.animT = 0;
      this.d.anim = anim;
      this.d.flags = flags;
    };
    const at = (t: number, prevT: number, when: number) => prevT < when && t >= when;
    const cleave = CONST.DEMON_CLEAVE_WINDUP;
    const sw = CONST.DEMON_SWOOP_WINDUP;
    const ring = CONST.DEMON_RING_WINDUP;
    const rage = CONST.DEMON_ENRAGED_PACE;
    const cleavePhase = (name: string, aim: number, target: string, flags: number): Phase => {
      const w = cleave * (flags ? rage : 1);
      const end = w + CONST.DEMON_CLEAVE_RECOVER * (flags ? rage : 1);
      return {
        name,
        dur: 2,
        run: (t, p) => {
          this.d.aim = aim;
          set(t < end ? ANIM.Melee : ANIM.Idle, flags);
          if (at(t, p, w)) this.hit(target, CLEAVE_KNOCK);
        },
      };
    };
    return [
      { name: 'idle', dur: 3, run: () => set(ANIM.Idle) },
      {
        name: 'walking (right, then back to the left)',
        dur: 4,
        run: (t) => {
          const k = Math.sin(((t < 2 ? t / 2 : 2 - t / 2) * Math.PI) / 2);
          this.d.x = hx + 70 * k;
          this.d.y = hy + 30 * k;
          this.d.aim = t < 2 ? Math.atan2(30, 70) : Math.atan2(-30, -70);
          set(t < 3.95 ? ANIM.Move : ANIM.Idle);
        },
      },
      cleavePhase(`cleave: ${CLEAVE_KNOCK} px push`, 0, 'Paladin', 0),
      cleavePhase('cleave facing left', Math.PI, 'Barbarian', 0),
      {
        name: `swoop (charge on foot): ${SWOOP_KNOCK} px push`,
        dur: 3,
        run: (t, p) => {
          // Wind-up, then the charge to the wizard and on a bit, the stop, and back home.
          const go = sw + CONST.DEMON_SWOOP_TIME;
          const stop = go + CONST.DEMON_SWOOP_RECOVER;
          this.d.aim = t < 2.2 ? 0 : Math.PI;
          if (t < stop) {
            set(ANIM.Dash);
            if (t > sw) this.d.x = Math.min(hx + 150, hx + SWOOP_SPEED * (Math.min(t, go) - sw));
            if (!this.swoopHit && this.d.x >= hx + 128) {
              this.swoopHit = true;
              this.hit('Wizard', SWOOP_KNOCK);
            }
          } else if (t < 2.2) set(ANIM.Idle);
          else {
            // Walk back.
            this.d.x = Math.max(hx, this.d.x - CLASSES.Paladin.speed * 2 * (t - p));
            set(this.d.x > hx ? ANIM.Move : ANIM.Idle);
          }
        },
      },
      {
        name: 'ring of fire: 16 fire orbs',
        dur: 3,
        run: (t, p) => {
          this.d.aim = 0;
          set(t < ring + CONST.DEMON_RING_RECOVER ? ANIM.Cast : ANIM.Idle);
          if (at(t, p, ring)) this.ringOfFire();
        },
      },
      cleavePhase('enraged cleave (faster wind-up)', 0, 'Paladin', FLAG.ENRAGED),
    ];
  }

  private jump(i: number): void {
    this.pi = i;
    this.t = 0;
    this.d.x = HOME[0];
    this.d.y = HOME[1];
    this.d.anim = -1;
    this.swoopHit = false;
    this.caption.setText(`${i + 1}: ${this.phases[i].name}`);
  }

  update(_t: number, dms: number): void {
    if (this.paused) return;
    const dt = dms / 1000 / this.slow;
    const ph = this.phases[this.pi];
    const prev = this.t;
    this.t += dt;
    this.d.animT += dt;
    ph.run(this.t, prev);
    if (this.t >= ph.dur) this.jump((this.pi + 1) % this.phases.length);
    this.demon.update({ ...this.d }, dt);
    for (const o of [...this.orbs]) this.fly(o, dt);
    for (const h of this.heroes) this.stepHero(h, dt);
    this.fx.update(dt);
  }

  private stepHero(h: Hero, dt: number): void {
    h.hurtT -= dt;
    let anim: number = ANIM.Idle;
    let aim = Math.atan2(this.d.y - h.y, this.d.x - h.x);
    if (h.push) {
      h.x += h.push.dx * h.push.v * dt;
      h.y += h.push.dy * h.push.v * dt;
      h.push.v *= Math.exp(-PUSH_DECAY * dt);
      if (h.push.v < PUSH_MIN_SPEED) h.push = null;
    } else if ((h.backT -= dt) <= 0) {
      const dx = h.home[0] - h.x;
      const dy = h.home[1] - h.y;
      const d = Math.hypot(dx, dy);
      const v = CLASSES.Paladin.speed * dt;
      if (d > 0.5) {
        const s = Math.min(1, v / d);
        h.x += dx * s;
        h.y += dy * s;
        anim = ANIM.Move;
        aim = Math.atan2(dy, dx);
      }
    }
    h.v.update({ x: h.x, y: h.y, anim, animT: 0, aim, flags: h.hurtT > 0 ? FLAG.HURT : 0 }, dt);
  }

  /** A hit on one hero: spark, caption, a push of `dist` px straight away from the demon. */
  private hit(name: string, dist: number): void {
    const h = this.heroes.find((o) => o.name === name)!;
    this.fx.hitSpark(h.x, h.y - 8, 0xffd0a0);
    h.hurtT = 0.2;
    this.fx.text(h.x, h.y - 20, `push ${dist} px`, '#ffe080');
    const dx = h.x - this.d.x;
    const dy = h.y - this.d.y;
    const len = Math.hypot(dx, dy) || 1;
    h.push = { dx: dx / len, dy: dy / len, v: dist * PUSH_DECAY };
    h.backT = 1.2;
  }

  /** As in the game: a fiery ring (Boom k 2) and 16 orbs flying out. */
  private ringOfFire(): void {
    const { x, y } = this.d;
    this.fx.ring(x, y, 60, 0xff6020, 0.5, true);
    this.fx.burst(x, y, 20, 0xff8030, 80);
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI * 2) / 16;
      const img = this.add.image(x, y, 'glow').setTint(0xff8030).setBlendMode(Phaser.BlendModes.ADD).setScale(0.9).setDepth(DEPTH.projectile);
      this.orbs.push({ img, x: x + Math.cos(a) * 10, y: y + Math.sin(a) * 10, dx: Math.cos(a), dy: Math.sin(a), life: ORB_LIFE });
    }
  }

  private fly(o: Orb, dt: number): void {
    o.x += o.dx * ORB_SPEED * dt;
    o.y += o.dy * ORB_SPEED * dt;
    o.life -= dt;
    o.img.setPosition(o.x, o.y - 6);
    if (Math.random() < 0.4) this.fx.particle(o.x, o.y - 6, 0, -8, 0.3, 0xff8030);
    if (o.life > 0) return;
    o.img.destroy();
    this.orbs.splice(this.orbs.indexOf(o), 1);
  }
}
