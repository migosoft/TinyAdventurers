// Dev page (?dragon): the red dragon without a server, looping through every
// action so its animations can be judged: idle, walking, front claw, bite,
// tail whip, fire breath, fireball volley, then a flight (lift off, hover after
// the party, breathe fire from the air, land with a ground smash). Every
// attack except the breath pushes the heroes it hits.
//
// Keys: Space pauses, S toggles slow motion (1/4), 1-8 jump to an action.
// `?dragon&slow=3` starts slowed down.
import Phaser from 'phaser';
import { ANIM, CLASSES, CONST, FLAG, KIND } from '../generated/defs';
import { EntityView } from './anim/EntityView';
import { DEPTH, Effects } from './effects';
import { TILE } from '../sim/map';

const W = 26;
const H = 13;
/** The dragon's spot and the heroes around it (px). */
const HOME: [number, number] = [11 * TILE, 7 * TILE];
const PUSH_DECAY = 15;
const PUSH_MIN_SPEED = 8;
const FIREBALL_SPEED = 120;
const FIREBALL_R = 30;
const BREATH_RANGE = 115;
const BREATH_HALF = 0.38;
const FLIGHT_T = 3.5;

interface Hero {
  v: EntityView;
  name: string;
  home: [number, number];
  x: number;
  y: number;
  push: { dx: number; dy: number; v: number } | null;
  hurtT: number;
  /** Seconds until it walks back home after a push. */
  backT: number;
}

interface Fireball {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  dx: number;
  dy: number;
  left: number;
}

/** One action of the loop: its caption, length (s) and what happens at time `t`. */
interface Phase {
  name: string;
  dur: number;
  run: (t: number, prevT: number) => void;
}

export class DragonDemoScene extends Phaser.Scene {
  private fx!: Effects;
  private dragon!: EntityView;
  private heroes: Hero[] = [];
  private balls: Fireball[] = [];
  private d = { x: HOME[0], y: HOME[1], aim: 0, anim: ANIM.Idle as number, animT: 0, flags: 0 };
  private phases: Phase[] = [];
  private pi = 0;
  private t = 0;
  private paused = false;
  private slow = Number(new URLSearchParams(location.search).get('slow') ?? 1) || 1;
  private caption!: Phaser.GameObjects.Text;

  constructor() {
    super('dragon-demo');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#25131a');
    this.fx = new Effects(this);
    for (let y = 2; y < H + 2; y++)
      for (let x = 0; x < W; x++) this.add.image(x * TILE, y * TILE, 'atlas', (x * 7 + y * 3) % 8 === 0 ? 'floor_2' : 'floor_1').setOrigin(0);
    const style = { fontFamily: 'monospace', fontSize: '8px', color: '#fff' };
    this.add.text(4, 4, 'dragon: every action in a loop. Space pause, S slow motion, 1-8 jump to an action', style).setResolution(4).setDepth(1e6);
    this.caption = this.add.text(4, 16, '', { ...style, color: '#ffe080' }).setResolution(4).setDepth(1e6);

    this.dragon = new EntityView(this, KIND.Dragon, this.fx, 'Dragon');
    const [hx, hy] = HOME;
    this.hero(KIND.Paladin, 'Paladin', [hx + 34, hy]);
    this.hero(KIND.Barbarian, 'Barbarian', [hx - 36, hy + 4]);
    this.hero(KIND.Wizard, 'Wizard', [hx + 90, hy - 14]);
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

  /** The dragon's actions, in loop order. */
  private script(): Phase[] {
    const [hx, hy] = HOME;
    const set = (anim: number, flags = 0) => {
      if (anim !== this.d.anim) this.d.animT = 0;
      this.d.anim = anim;
      this.d.flags = flags;
    };
    const at = (t: number, prevT: number, when: number) => prevT < when && t >= when;
    const claw = CONST.DRAGON_CLAW_WINDUP;
    const bite = CONST.DRAGON_BITE_WINDUP;
    const tail = CONST.DRAGON_TAIL_WINDUP;
    const bw = CONST.DRAGON_BREATH_WINDUP;
    const bt = CONST.DRAGON_BREATH_TIME;
    const up = CONST.DRAGON_TAKEOFF;
    const land = CONST.DRAGON_LAND;
    return [
      { name: 'idle', dur: 2.5, run: () => set(ANIM.Idle) },
      {
        name: 'walking',
        dur: 4,
        run: (t) => {
          // Out up-left (past the barbarian) and back.
          const k = Math.sin(((t < 2 ? t / 2 : 2 - t / 2) * Math.PI) / 2);
          this.d.x = hx - 50 * k;
          this.d.y = hy - 40 * k;
          this.d.aim = t < 2 ? Math.atan2(-40, -50) : Math.atan2(40, 50);
          set(t < 3.95 ? ANIM.Move : ANIM.Idle);
        },
      },
      {
        name: `front claw: ${CONST.DRAGON_CLAW_KNOCK} px push`,
        dur: 2,
        run: (t, p) => {
          this.d.aim = 0;
          set(t < claw + 0.5 ? ANIM.Melee : ANIM.Idle);
          if (at(t, p, claw)) this.hit('Paladin', CONST.DRAGON_CLAW_KNOCK);
        },
      },
      {
        name: `bite (straight ahead, ${CONST.DRAGON_BITE_RANGE} px reach): ${CONST.DRAGON_BITE_KNOCK} px push`,
        dur: 2,
        run: (t, p) => {
          this.d.aim = 0;
          set(t < bite + 0.5 ? ANIM.Bite : ANIM.Idle);
          if (at(t, p, bite)) this.hit('Paladin', CONST.DRAGON_BITE_KNOCK);
        },
      },
      {
        name: `tail whip (behind it): ${CONST.DRAGON_TAIL_KNOCK} px push`,
        dur: 2.2,
        run: (t, p) => {
          this.d.aim = 0;
          set(t < tail + 0.7 ? ANIM.Tail : ANIM.Idle);
          if (at(t, p, tail)) this.hit('Barbarian', CONST.DRAGON_TAIL_KNOCK);
        },
      },
      {
        name: 'fire breath: no push, burns',
        dur: bw + bt + 0.8,
        run: (t) => {
          this.d.aim = 0;
          set(t < bw + bt ? ANIM.Breath : ANIM.Idle);
          if (t > bw && t < bw + bt) this.burn();
        },
      },
      {
        name: `fireball volley: ${CONST.DRAGON_FIREBALL_KNOCK} px push`,
        dur: 3.2,
        run: (t, p) => {
          this.d.aim = 0;
          set(t < 0.6 ? ANIM.Windup : t < 1 ? ANIM.Cast : ANIM.Idle);
          if (at(t, p, 0.6)) this.volley();
        },
      },
      {
        name: `flight: lift off, hover, breathe from the air, land (smash: ${CONST.DRAGON_SMASH_RADIUS} px, ${CONST.DRAGON_SMASH_KNOCK} px push)`,
        dur: up + FLIGHT_T + land + 1.5,
        run: (t, p) => {
          const air = FLAG.AIRBORNE;
          const fly = t - up;
          if (t < up) set(ANIM.TakeOff);
          else if (fly < FLIGHT_T) {
            // Hover out to the right, breathe fire on the wizard, come back.
            const breath = fly > 1.0 && fly < 1.0 + bw + bt;
            const k = fly < 1 ? fly : breath ? 1 : 1 - (fly - 1 - bw - bt) / (FLIGHT_T - 1 - bw - bt);
            this.d.x = hx + 30 * k;
            this.d.aim = fly < 1 || breath ? Math.atan2(this.heroes[2].y - this.d.y, this.heroes[2].x - this.d.x) : Math.PI;
            set(breath ? ANIM.Breath : ANIM.Move, air);
            if (breath && fly > 1 + bw) this.burn();
          } else if (t < up + FLIGHT_T + land) {
            this.d.aim = 0;
            set(ANIM.Land);
          } else set(ANIM.Idle);
          if (at(t, p, up + FLIGHT_T + land)) this.smash();
        },
      },
    ];
  }

  private jump(i: number): void {
    this.pi = i;
    this.t = 0;
    this.d.x = HOME[0];
    this.d.y = HOME[1];
    this.d.anim = -1;
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
    this.dragon.update({ ...this.d }, dt);
    for (const b of [...this.balls]) this.fly(b, dt);
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
      // Walk back to the starting spot.
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

  /** A hit on one hero: spark, number, a push of `dist` px straight away from (fx, fy) (the dragon by default). */
  private hit(name: string, dist: number, from: [number, number] = [this.d.x, this.d.y]): void {
    const h = this.heroes.find((o) => o.name === name)!;
    this.fx.hitSpark(h.x, h.y - 8, 0xffd0a0);
    h.hurtT = 0.2;
    this.fx.text(h.x, h.y - 20, dist > 0 ? `push ${dist} px` : 'burn', '#ffe080');
    if (dist <= 0) return;
    const dx = h.x - from[0];
    const dy = h.y - from[1];
    const len = Math.hypot(dx, dy) || 1;
    h.push = { dx: dx / len, dy: dy / len, v: dist * PUSH_DECAY };
    h.backT = 1.2;
  }

  /** Breath: heroes in the cone flash (no push). */
  private burn(): void {
    for (const h of this.heroes) {
      const d = Math.hypot(h.x - this.d.x, h.y - this.d.y);
      const off = Math.atan2(h.y - this.d.y, h.x - this.d.x) - this.d.aim;
      if (d < BREATH_RANGE && Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) < BREATH_HALF) h.hurtT = 0.1;
    }
  }

  /** Three fireballs from the mouth, one at each hero. */
  private volley(): void {
    const m = this.dragon.framePoint(this.dragon.def.mouth) ?? { x: this.d.x + 20, y: this.d.y - 30 };
    for (const h of this.heroes) {
      // They fly at the hero's feet (the server's fireballs travel along the ground).
      const sx = this.d.x + 16;
      const dx = h.x - sx;
      const dy = h.y - this.d.y;
      const len = Math.hypot(dx, dy) || 1;
      const img = this.add.image(m.x, m.y, 'glow').setTint(0xff5010).setBlendMode(Phaser.BlendModes.ADD).setScale(2).setDepth(DEPTH.projectile);
      this.balls.push({ img, x: sx, y: this.d.y, dx: dx / len, dy: dy / len, left: len });
    }
  }

  private fly(b: Fireball, dt: number): void {
    const step = FIREBALL_SPEED * dt;
    b.x += b.dx * step;
    b.y += b.dy * step;
    b.left -= step;
    // Drawn above the ground, dropping from mouth height to the target.
    b.img.setPosition(b.x, b.y - Math.max(4, b.left * 0.2));
    if (Math.random() < 0.6) this.fx.particle(b.img.x, b.img.y, 0, -8, 0.3, 0xffb040);
    if (b.left > 0) return;
    b.img.destroy();
    this.balls.splice(this.balls.indexOf(b), 1);
    this.fx.explosion(b.x, b.y, FIREBALL_R);
    for (const h of this.heroes)
      if (!h.push && Math.hypot(h.x - b.x, h.y - b.y) <= FIREBALL_R) this.hit(h.name, CONST.DRAGON_FIREBALL_KNOCK, [b.x - b.dx * 6, b.y - b.dy * 6]);
  }

  /** Landing smash: every hero within the radius is pushed straight away. */
  private smash(): void {
    this.fx.shockwave(this.d.x, this.d.y, CONST.DRAGON_SMASH_RADIUS);
    for (const h of this.heroes)
      if (Math.hypot(h.x - this.d.x, h.y - this.d.y) <= CONST.DRAGON_SMASH_RADIUS) this.hit(h.name, CONST.DRAGON_SMASH_KNOCK);
  }
}
