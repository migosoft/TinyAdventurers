// Dev pages for the terrain, without a server. Scripted figures walk set
// paths; the board, speeds, wading, burning, falling and drowning follow the
// planned game rules:
// - ?water: shallow water slows everyone (enemies wade in too); deep water
//   cannot be walked into, but a figure knocked into it drowns; the
//   barbarian's dash jumps a deep stream.
// - ?chasm: walking in is a fall (and death); the dash jumps it; a skeleton
//   takes the bridge.
// - ?lava: heroes are slowed a lot and burn; imps and chorts walk straight
//   through unharmed; a skeleton walks around.
import Phaser from 'phaser';
import { ANIM, CLASSES, CONST, FLAG, KIND } from '../generated/defs';
import { EntityView } from './anim/EntityView';
import { Effects } from './effects';
import { bubbleFx, sinkDepth, sinkStartFx, speedFactor, TERRAIN, TerrainLayer, WadeFx } from './terrain';
import { TILE, TileMap } from '../sim/map';

/** Tile ids for the ASCII maps: `.` floor, `s` shallow, `D` deep water, `C` chasm, `L` lava. */
const CHARS: Record<string, number> = { '.': 1, s: TERRAIN.Shallow, D: TERRAIN.Deep, C: TERRAIN.Chasm, L: TERRAIN.Lava };
const DASH_SPEED = 300;
const PUSH_SPEED = 160;
const FALL_T = CONST.FALL_TIME;
const DROWN_T = CONST.DROWN_TIME;
/** Seconds from the start of a fall or drowning until the figure starts over. */
const RESPAWN_T = 2.6;
const LAVA_TICK = 0.5;
const LAVA_DAMAGE = 10;
const OX = 1;
const OY = 3;

/**
 * A script step, in tile units (fractions allowed): walk or dash to a point,
 * wait, or strike the named figure (once it stands close) and knock it away.
 */
type Step = { to: [number, number]; dash?: boolean } | { wait: number } | { hit: string; push: [number, number] };

interface Actor {
  v: EntityView;
  name: string;
  x: number;
  y: number;
  speed: number;
  demon: boolean;
  steps: Step[];
  i: number;
  t: number;
  aim: number;
  anim: number;
  animT: number;
  dashing: boolean;
  /** Knockback still to travel, in px. */
  push: { vx: number; vy: number; left: number } | null;
  doom: { kind: 'fall' | 'drown'; t: number } | null;
  hurtT: number;
  burnT: number;
  rippleT: number;
  wade: WadeFx;
}

abstract class TerrainDemo extends Phaser.Scene {
  protected fx!: Effects;
  private layer!: TerrainLayer;
  private map!: TileMap;
  private actors: Actor[] = [];
  private slow = Number(new URLSearchParams(location.search).get('slow') ?? 1) || 1;

  protected abstract rows: string[];
  protected abstract title: string;
  protected abstract setup(): void;

  create(): void {
    this.cameras.main.setBackgroundColor('#25131a');
    this.fx = new Effects(this);
    const w = this.rows[0].length + 2 * OX;
    const h = this.rows.length + OY + 1;
    const tiles = new Uint8Array(w * h);
    this.rows.forEach((r, y) => [...r].forEach((c, x) => (tiles[(y + OY) * w + x + OX] = CHARS[c] ?? 0)));
    this.map = new TileMap(w, h, tiles);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (this.map.get(x, y)) this.add.image(x * TILE, y * TILE, 'atlas', (x * 7 + y * 3) % 8 === 0 ? 'floor_2' : 'floor_1').setOrigin(0);
    this.layer = new TerrainLayer(this, this.map, this.fx);
    this.add.text(OX * TILE, TILE - 4, this.title, { fontFamily: 'monospace', fontSize: '8px', color: '#fff' }).setResolution(4);
    this.setup();
  }

  /** A figure following `steps` in a loop, starting at the first `to`. */
  protected actor(kind: number, name: string, speed: number, steps: Step[], demon = false): void {
    const a: Actor = {
      v: new EntityView(this, kind, this.fx, name),
      name,
      x: 0,
      y: 0,
      speed,
      demon,
      steps,
      i: 0,
      t: 0,
      aim: 0,
      anim: ANIM.Idle,
      animT: 0,
      dashing: false,
      push: null,
      doom: null,
      hurtT: 0,
      burnT: 0,
      rippleT: 0,
      wade: new WadeFx(),
    };
    this.restart(a);
    this.actors.push(a);
  }

  private restart(a: Actor): void {
    [a.x, a.y] = this.px((a.steps.find((s) => 'to' in s) as { to: [number, number] }).to);
    a.i = 0;
    a.t = 0;
    a.doom = null;
    a.push = null;
    a.dashing = false;
  }

  private px([tx, ty]: [number, number]): [number, number] {
    return [(tx + OX) * TILE, (ty + OY) * TILE];
  }

  update(_t: number, dms: number): void {
    const dt = dms / 1000 / this.slow;
    this.layer.update(dt);
    for (const a of this.actors) this.step(a, dt);
    this.fx.update(dt);
  }

  private step(a: Actor, dt: number): void {
    a.hurtT -= dt;
    a.animT += dt;
    if (a.doom) return this.doomed(a, dt);

    const tile = this.map.get(Math.floor(a.x / TILE), Math.floor((a.y - 3) / TILE));
    let anim: number = a.anim === ANIM.Melee && a.animT < 0.3 ? ANIM.Melee : ANIM.Idle;
    const s = a.steps[a.i];
    if (a.push) {
      // Knocked back: slides away, whatever lies there.
      const d = Math.min(a.push.left, PUSH_SPEED * dt);
      a.x += a.push.vx * d;
      a.y += a.push.vy * d;
      a.push.left -= d;
      if (a.push.left <= 0) a.push = null;
    } else if ('wait' in s) {
      a.t += dt;
      if (a.t >= s.wait) this.next(a);
    } else if ('hit' in s) {
      const target = this.actors.find((o) => o.name === s.hit);
      if (target && !target.doom && !target.push && Math.hypot(target.x - a.x, target.y - a.y) < 26) {
        a.t += dt;
        anim = ANIM.Windup;
        a.aim = Math.atan2(target.y - a.y, target.x - a.x);
        if (a.t >= 0.35) {
          a.anim = ANIM.Melee;
          a.animT = 0;
          anim = ANIM.Melee;
          this.fx.hitSpark(target.x, target.y - 8, 0xffd0a0);
          target.hurtT = 0.2;
          const [px, py] = s.push;
          const len = Math.hypot(px, py);
          target.push = { vx: px / len, vy: py / len, left: len * TILE };
          this.next(a);
        }
      }
    } else {
      const [tx, ty] = this.px(s.to);
      const dx = tx - a.x;
      const dy = ty - a.y;
      const d = Math.hypot(dx, dy);
      a.dashing = !!s.dash;
      const v = s.dash ? DASH_SPEED : a.speed * speedFactor(tile, a.demon);
      if (d > 0.5) a.aim = Math.atan2(dy, dx);
      if (d <= v * dt) {
        a.x = tx;
        a.y = ty;
        this.next(a);
      } else {
        a.x += (dx / d) * v * dt;
        a.y += (dy / d) * v * dt;
      }
      anim = s.dash ? ANIM.Dash : ANIM.Move;
    }

    // Over a chasm or deep water without a dash to carry you: the end.
    if (!a.dashing && (tile === TERRAIN.Chasm || tile === TERRAIN.Deep)) {
      const drown = tile === TERRAIN.Deep;
      a.doom = { kind: drown ? 'drown' : 'fall', t: 0 };
      sinkStartFx(this.fx, a.x, a.y, drown);
    }
    a.wade.update(this.fx, a.x, a.y, tile, a.dashing, anim === ANIM.Move, !a.demon, dt);
    // Burning in lava (demons are immune).
    if (!a.dashing && tile === TERRAIN.Lava && !a.demon) {
      a.burnT -= dt;
      if (a.burnT <= 0) {
        a.burnT = LAVA_TICK;
        a.hurtT = 0.12;
        this.fx.text(a.x, a.y - 18, String(LAVA_DAMAGE), '#ff9040');
      }
    } else a.burnT = 0;

    a.v.update(
      { x: a.x, y: a.y, anim, animT: anim === ANIM.Melee ? a.animT : 0, aim: a.aim, flags: a.hurtT > 0 ? FLAG.HURT : 0, sink: a.dashing ? 0 : sinkDepth(tile) },
      dt,
    );
  }

  /** Falling into the dark or sinking into the deep, then the message, then start over. */
  private doomed(a: Actor, dt: number): void {
    const d = a.doom!;
    d.t += dt;
    const dur = d.kind === 'fall' ? FALL_T : DROWN_T;
    if (d.t >= dur && d.t - dt < dur)
      this.fx.text(a.x, a.y - 20, d.kind === 'fall' ? `${a.name} fell into the abyss` : `${a.name} drowned`, '#ff6060', true);
    if (d.kind === 'drown' && d.t < dur + 0.4) {
      // Bubbles rising where the figure went down.
      bubbleFx(this.fx, a.x, a.y, dt);
      a.rippleT -= dt;
      if (a.rippleT <= 0) {
        a.rippleT = 0.3;
        this.fx.ring(a.x, a.y - 1, 6, 0x72d6ce, 0.5);
      }
    }
    if (d.t > RESPAWN_T) this.restart(a);
    const k = Math.min(1, d.t / dur);
    a.v.update({ x: a.x, y: a.y, anim: ANIM.Idle, animT: 0, aim: a.aim, flags: k >= 1 ? FLAG.DEAD : 0, fall: d.kind === 'fall' ? k : 0, drown: d.kind === 'drown' ? k : 0 }, dt);
  }

  private next(a: Actor): void {
    a.i = (a.i + 1) % a.steps.length;
    a.t = 0;
    a.dashing = false;
  }
}

export class WaterDemoScene extends TerrainDemo {
  protected title = 'water: shallow slows everyone (wading); knocked into deep water = drowned; the dash jumps the stream';
  protected rows = [
    '..................sDs.....',
    '...ssssssssss.....sDs.....',
    '..ssssssssssss....sDs.....',
    '..sssDDDDDDsss....sDs.....',
    '..ssDDDDDDDDss....sDs.....',
    '..sssDDDDDDsss....sDs.....',
    '..ssssssssssss....sDs.....',
    '...ssssssssss.....sDs.....',
    '..................sDs.....',
  ];

  constructor() {
    super('water-demo');
  }

  protected setup(): void {
    // Wades in, stops at the deep water, wades along the rim and back.
    this.actor(KIND.Paladin, 'Paladin', CLASSES.Paladin.speed, [
      { to: [0.6, 4.6] },
      { to: [3.7, 4.6] },
      { wait: 0.8 },
      { to: [3.7, 6.6] },
      { to: [11.4, 6.6] },
      { wait: 0.6 },
      { to: [3.7, 6.6] },
      { to: [3.7, 4.6] },
      { to: [0.6, 4.6] },
      { wait: 0.6 },
    ]);
    // Wades to the edge of the deep water and gets knocked in.
    this.actor(KIND.Wizard, 'Wizard', CLASSES.Wizard.speed, [{ to: [0.6, 2.5] }, { to: [7.5, 2.5] }, { wait: 99 }]);
    this.actor(KIND.SkeletonWarrior, 'Skeleton', 40, [{ to: [7.5, 0.4] }, { wait: 0.8 }, { to: [7.5, 1.6] }, { hit: 'Wizard', push: [0, 1.6] }, { wait: 1 }, { to: [7.5, 0.4] }]);
    // Enemies wade through shallow water (slowed, but unharmed).
    this.actor(KIND.SkeletonWarrior, 'Skeleton 2', 40, [{ to: [12.6, 8.7] }, { to: [12.6, 0.4] }, { wait: 0.4 }, { to: [12.6, 8.7] }, { wait: 0.4 }]);
    // Dashes over the deep stream and back.
    this.actor(KIND.Barbarian, 'Barbarian', CLASSES.Barbarian.speed, [
      { to: [24, 3.6] },
      { to: [21.3, 3.6] },
      { wait: 0.5 },
      { to: [17.6, 3.6], dash: true },
      { to: [16.6, 3.6] },
      { wait: 1 },
      { to: [17.6, 3.6] },
      { wait: 0.3 },
      { to: [21.3, 3.6], dash: true },
      { to: [24, 3.6] },
      { wait: 1 },
    ]);
  }
}

export class ChasmDemoScene extends TerrainDemo {
  protected title = 'chasm: walking in is a fall (death); the dash jumps it; the bridge is safe';
  protected rows = [
    '........................',
    '........................',
    '........................',
    'CCCCCCCCCC..CCCCCCCCCCCC',
    'CCCCCCCCCC..CCCCCCCCCCCC',
    '........................',
    '........................',
    '........................',
  ];

  constructor() {
    super('chasm-demo');
  }

  protected setup(): void {
    // Jumps the chasm with a dash, comes back over the bridge.
    this.actor(KIND.Barbarian, 'Barbarian', CLASSES.Barbarian.speed, [
      { to: [4, 1] },
      { to: [4, 2.7] },
      { wait: 0.5 },
      { to: [4, 5.7], dash: true },
      { to: [7, 6.5] },
      { to: [11, 6.5] },
      { to: [11, 1] },
      { to: [4, 1] },
      { wait: 0.6 },
    ]);
    // Walks in and falls.
    this.actor(KIND.Paladin, 'Paladin', CLASSES.Paladin.speed, [{ to: [18, 0.8] }, { wait: 0.8 }, { to: [18, 3.8] }]);
    // Knocked in from the other side.
    this.actor(KIND.Wizard, 'Wizard', CLASSES.Wizard.speed, [{ to: [22, 7] }, { to: [22, 5.7] }, { wait: 99 }]);
    this.actor(KIND.SkeletonWarrior, 'Skeleton 2', 40, [{ to: [22, 7.7] }, { wait: 0.6 }, { to: [22, 6.9] }, { hit: 'Wizard', push: [0, -1.6] }, { wait: 1 }, { to: [22, 7.7] }]);
    // Patrols over the bridge.
    this.actor(KIND.SkeletonWarrior, 'Skeleton', 40, [{ to: [11, 0.6] }, { to: [11, 7.7] }, { wait: 0.5 }, { to: [11, 0.6] }, { wait: 0.5 }]);
  }
}

export class LavaDemoScene extends TerrainDemo {
  protected title = 'lava: heroes are slowed and burn; imps and chorts walk through unharmed';
  protected rows = [
    '........................',
    '.....LLLLLLLL...........',
    '....LLLLLLLLLL..........',
    '....LLLLLLLLLL..........',
    '....LLLLLLLLLL..........',
    '.....LLLLLLLL...........',
    '........................',
  ];

  constructor() {
    super('lava-demo');
  }

  protected setup(): void {
    // Wades through, slowed and burning, and back.
    this.actor(KIND.Paladin, 'Paladin', CLASSES.Paladin.speed, [{ to: [1, 3.6] }, { wait: 0.6 }, { to: [17, 3.6] }, { wait: 0.6 }]);
    // Demons go straight through at full speed.
    this.actor(KIND.Imp, 'Imp', 42, [{ to: [1, 2.6] }, { to: [17, 2.6] }, { wait: 0.4 }], true);
    this.actor(KIND.Chort, 'Chort', 34, [{ to: [17, 4.6] }, { to: [1, 4.6] }, { wait: 0.4 }], true);
    // Walks around the lava.
    this.actor(KIND.SkeletonWarrior, 'Skeleton', 40, [{ to: [3, 0.6] }, { to: [15, 0.6] }, { to: [15, 6.7] }, { to: [3, 6.7] }]);
  }
}
