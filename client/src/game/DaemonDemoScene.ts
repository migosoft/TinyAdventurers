// Dev page (?daemons): small demons for the demon boss's dungeon, without a
// server. Lane 1: an imp skirmisher (keeps its distance, fire bolts, claws
// when cornered). Lane 2: a chort brawler (chases and claws, a bolt now and
// then). Lane 3: a pack of two imps and a chort. Lane 4: a red-robed
// summoner shooting fire bolts and summoning imps.
import Phaser from 'phaser';
import { ANIM, FLAG, KIND } from '../generated/defs';
import { EntityView } from './anim/EntityView';
import { DEPTH, Effects } from './effects';
import { TILE } from '../sim/map';

const KINDS = { imp: KIND.Imp, chort: KIND.Chort, summoner: KIND.Summoner };

type Style = keyof typeof KINDS;
interface Mob {
  v: EntityView;
  style: Style;
  x: number;
  y: number;
  /** Personal offset so pack members spread around the target. */
  side: number;
  anim: number;
  animT: number;
  /** What the current wind-up leads to. */
  next: 'bolt' | 'claw';
  /** Summoned imps vanish after this many seconds (keeps the lane tidy). */
  life?: number;
  summonCd: number;
  clawCd: number;
  boltCd: number;
}
interface Knight {
  v: EntityView;
  x: number;
  y: number;
  dir: number;
  hurtT: number;
}
interface Bolt {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  left: number;
  target: Knight;
}

const STATS: Record<Style, { speed: number; boltCd: number; clawCd: number; keepAway: number }> = {
  imp: { speed: 42, boltCd: 1.6, clawCd: 0.9, keepAway: 70 },
  chort: { speed: 34, boltCd: 3.2, clawCd: 1.1, keepAway: 0 },
  summoner: { speed: 30, boltCd: 2.2, clawCd: 99, keepAway: 100 },
};
const WINDUP = 0.3;
const CAST_T = 0.3;
const MELEE_T = 0.3;
const CLAW_RANGE = 16;
const BOLT_SPEED = 120;

export class DaemonDemoScene extends Phaser.Scene {
  private fx!: Effects;
  private slow = Number(new URLSearchParams(location.search).get('slow') ?? 1) || 1;
  private knights: Knight[] = [];
  private mobs: { m: Mob; k: Knight }[] = [];
  private bolts: Bolt[] = [];
  private spawnMob!: (style: Style, k: Knight, x: number, side?: number) => Mob;

  constructor() {
    super('daemon-demo');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#25131a');
    this.fx = new Effects(this);
    const lanes = [3, 7, 11, 15];
    for (const ly of lanes)
      for (let y = ly - 1; y <= ly + 1; y++)
        for (let x = 1; x <= 20; x++) this.add.image(x * TILE, y * TILE, 'atlas', (x * 7 + y * 3) % 8 === 0 ? 'floor_2' : 'floor_1').setOrigin(0);
    const label = (ly: number, s: string) =>
      this.add.text(TILE, (ly - 1) * TILE - 9, s, { fontFamily: 'monospace', fontSize: '8px', color: '#fff' }).setResolution(4);
    label(3, '1  imp: skirmisher (fire bolts, claws when close)');
    label(7, '2  chort: brawler (claws, a bolt now and then)');
    label(11, '3  pack: 2 imps + chort');
    label(15, '4  summoner: fire bolts, summons imps');

    const knight = (ly: number, x: number): Knight => {
      const k = { v: new EntityView(this, KIND.Paladin, this.fx), x: x * TILE, y: ly * TILE + 12, dir: 1, hurtT: 0 };
      this.knights.push(k);
      return k;
    };
    const mob = (style: Style, k: Knight, x: number, side = 0) => {
      const m: Mob = {
        v: new EntityView(this, KINDS[style], this.fx),
        style,
        x: x * TILE,
        y: k.y + side * 8,
        side,
        anim: ANIM.Idle,
        animT: 0,
        next: 'bolt',
        clawCd: 0,
        boltCd: 0.5 + Math.random(),
        summonCd: 1.5,
      };
      this.mobs.push({ m, k });
      return m;
    };
    this.spawnMob = mob;
    const k1 = knight(3, 8);
    mob('imp', k1, 14);
    const k2 = knight(7, 8);
    mob('chort', k2, 15);
    const k3 = knight(11, 8);
    mob('imp', k3, 15, -1);
    mob('imp', k3, 17, 1);
    mob('chort', k3, 13, 0);
    mob('summoner', knight(15, 8), 17);
  }

  update(_t: number, dms: number): void {
    const dt = dms / 1000 / this.slow;

    for (const k of this.knights) {
      k.x += k.dir * 18 * dt;
      if (k.x > 18 * TILE || k.x < 3 * TILE) k.dir *= -1;
      k.hurtT -= dt;
      k.v.update({ x: k.x, y: k.y, anim: ANIM.Move, animT: 0, aim: k.dir > 0 ? 0 : Math.PI, flags: k.hurtT > 0 ? FLAG.HURT : 0 }, dt);
    }

    for (const { m, k } of [...this.mobs]) this.think(m, k, dt);
    this.mobs = this.mobs.filter(({ m }) => {
      if (m.life === undefined || (m.life -= dt) > 0) return true;
      this.fx.burst(m.x, m.y - 6, 10, 0x9a2020, 40, 0.4);
      m.v.root.destroy();
      return false;
    });

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.left -= BOLT_SPEED * dt;
      b.img.setPosition(Math.round(b.x), Math.round(b.y) - 8).setScale(0.7 * (0.9 + 0.15 * Math.sin(performance.now() / 50)));
      if (Math.random() < 0.6) this.fx.particle(b.x, b.y - 8, 0, 0, 0.25, 0xffb040, { depth: DEPTH.projectile - 1 });
      const hit = Math.hypot(b.target.x - b.x, b.target.y - b.y) < 7;
      if (hit || b.left <= 0) {
        if (hit) {
          this.fx.hitSpark(b.x, b.y - 8, 0xff9040);
          b.target.hurtT = 0.15;
        } else this.fx.burst(b.x, b.y - 8, 4, 0xff7020, 30, 0.25);
        b.img.destroy();
        this.bolts.splice(i, 1);
      }
    }

    this.fx.update(dt);
  }

  private think(m: Mob, k: Knight, dt: number): void {
    const st = STATS[m.style];
    const ty = k.y + m.side * 8;
    const dx = k.x - m.x;
    const dy = ty - m.y;
    const dist = Math.hypot(k.x - m.x, k.y - m.y);
    const aim = Math.atan2(k.y - m.y, k.x - m.x);
    m.clawCd -= dt;
    m.boltCd -= dt;
    m.animT += dt;

    if (m.anim === ANIM.Windup && m.animT >= WINDUP) {
      if (m.next === 'bolt') {
        this.shoot(m, k, aim);
        m.anim = ANIM.Shoot;
      } else {
        m.anim = ANIM.Melee;
        if (dist < CLAW_RANGE + 4) {
          this.fx.hitSpark(k.x, k.y - 8, 0xffd0a0);
          k.hurtT = 0.15;
        }
      }
      m.animT = 0;
    } else if (((m.anim === ANIM.Cast || m.anim === ANIM.Shoot) && m.animT >= CAST_T) || (m.anim === ANIM.Melee && m.animT >= MELEE_T)) {
      m.anim = ANIM.Idle;
    }

    if (m.anim === ANIM.Idle || m.anim === ANIM.Move) {
      m.summonCd -= dt;
      if (m.style === 'summoner' && m.summonCd <= 0) {
        // Like the server: a cast, then one or two imps appear next to the summoner.
        m.summonCd = 5;
        m.anim = ANIM.Cast;
        m.animT = 0;
        for (const side of [-1, 1]) {
          const imp = this.spawnMob('imp', k, m.x / TILE, side);
          imp.x = m.x + side * 6;
          imp.y = m.y + side * 12;
          imp.life = 6;
          this.fx.raise(imp.x, imp.y, true);
        }
      } else       if (dist < CLAW_RANGE && m.clawCd <= 0) {
        this.start(m, 'claw');
        m.clawCd = st.clawCd;
      } else if (m.boltCd <= 0 && dist < 150 && dist > (m.style === 'imp' ? 0 : 40)) {
        this.start(m, 'bolt');
        m.boltCd = st.boltCd;
      } else {
        // Imps hover at range; chorts close in.
        const want = st.keepAway ? (dist < st.keepAway - 10 ? -1 : dist > st.keepAway + 25 ? 1 : 0) : dist > CLAW_RANGE - 4 ? 1 : 0;
        const len = Math.hypot(dx, dy) || 1;
        m.x += (dx / len) * st.speed * want * dt;
        m.y += (dy / len) * st.speed * want * dt;
        m.x = Phaser.Math.Clamp(m.x, 1.5 * TILE, 20.5 * TILE);
        m.anim = want ? ANIM.Move : ANIM.Idle;
      }
    }
    m.v.update({ x: m.x, y: m.y, anim: m.anim, animT: m.animT, aim, flags: 0 }, dt);
  }

  private start(m: Mob, next: 'bolt' | 'claw'): void {
    m.anim = ANIM.Windup;
    m.animT = 0;
    m.next = next;
  }

  private shoot(m: Mob, k: Knight, aim: number): void {
    const img = this.add.image(m.x, m.y - 8, 'glow').setTint(0xff7020).setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.projectile);
    this.bolts.push({ img, x: m.x + Math.cos(aim) * 6, y: m.y + Math.sin(aim) * 6, vx: Math.cos(aim) * BOLT_SPEED, vy: Math.sin(aim) * BOLT_SPEED, left: 170, target: k });
  }
}
