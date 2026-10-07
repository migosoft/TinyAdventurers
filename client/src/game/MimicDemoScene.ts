// Dev page (?mimic): chests and mimics without a server. Lane 1: a mimic
// hopping after a walking knight and biting when close. Lane 2: a treasure
// chest opening with its coin burst. Lane 3: the chest-to-mimic reveal.
import Phaser from 'phaser';
import { ANIM, KIND } from '../generated/defs';
import { EntityView } from './anim/EntityView';
import { ChestView } from './chest';
import { Effects } from './effects';
import { BITE_T, HOP, HOP_CYCLE, MimicView } from './mimic';
import { TILE } from '../sim/map';

const HOP_SPEED = 50 / (HOP.air - HOP.crouch); // px/s while airborne (server: speed 50 on average)
const BITE_RANGE = 14;

export class MimicDemoScene extends Phaser.Scene {
  private fx!: Effects;
  private t = 0;
  private slow = Number(new URLSearchParams(location.search).get('slow') ?? 1) || 1;
  private knight!: { v: EntityView; x: number; y: number; dir: number };
  private chaser!: { v: MimicView; x: number; y: number; hop: number; biteT: number; cd: number };
  private chest!: { v: ChestView; x: number; y: number; opened: boolean };
  private reveal!: { v: MimicView; x: number; y: number };

  constructor() {
    super('mimic-demo');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#25131a');
    this.fx = new Effects(this);
    const lanes = [3, 7, 11];
    for (const ly of lanes)
      for (let y = ly - 1; y <= ly + 1; y++)
        for (let x = 1; x <= 20; x++) this.add.image(x * TILE, y * TILE, 'atlas', (x * 7 + y * 3) % 8 === 0 ? 'floor_2' : 'floor_1').setOrigin(0);
    const label = (ly: number, s: string) =>
      this.add.text(TILE, (ly - 1) * TILE - 9, s, { fontFamily: 'monospace', fontSize: '8px', color: '#fff' }).setResolution(4);
    label(3, '1  mimic: hopping chaser');
    label(7, '2  treasure chest');
    label(11, '3  reveal (chest wakes up)');

    this.knight = { v: new EntityView(this, KIND.Paladin, this.fx), x: 4 * TILE, y: 3 * TILE + 12, dir: 1 };
    this.chaser = { v: new MimicView(this, this.fx), x: 2 * TILE, y: 3 * TILE + 12, hop: 0, biteT: -1, cd: 0 };
    this.chest = { v: new ChestView(this), x: 11 * TILE, y: 7 * TILE + 12, opened: false };
    this.reveal = { v: new MimicView(this, this.fx), x: 11 * TILE, y: 11 * TILE + 12 };
  }

  update(_t: number, dms: number): void {
    const dt = dms / 1000 / this.slow;
    this.t += dt;

    const k = this.knight;
    k.x += k.dir * 20 * dt;
    if (k.x > 19 * TILE || k.x < 4 * TILE) k.dir *= -1;
    k.v.update({ x: k.x, y: k.y, anim: ANIM.Move, animT: 0, aim: k.dir > 0 ? 0 : Math.PI, flags: 0 }, dt);

    // 1: hop towards the knight (moving only while airborne); bite when close.
    const c = this.chaser;
    const dx = k.x - c.x;
    const dy = k.y - c.y;
    const dist = Math.hypot(dx, dy);
    c.cd -= dt;
    if (c.biteT >= 0) {
      c.biteT += dt;
      if (c.biteT >= BITE_T) c.biteT = -1;
    } else if (dist < BITE_RANGE && c.cd <= 0 && c.hop >= HOP.land) {
      c.biteT = 0;
      c.cd = 0.8;
    } else {
      c.hop = (c.hop + dt / HOP_CYCLE) % 1;
      if (c.hop >= HOP.crouch && c.hop < HOP.air && dist > BITE_RANGE - 4) {
        c.x += (dx / dist) * HOP_SPEED * dt;
        c.y += (dy / dist) * HOP_SPEED * dt;
      }
    }
    c.v.update({ x: c.x, y: c.y, asleep: false, hop: c.biteT >= 0 ? -1 : c.hop, biteT: c.biteT, aim: Math.atan2(dy, dx) }, dt);

    // 2: 4 s loop: closed, opens with a coin burst, resets.
    const ch = this.chest;
    const ct = this.t % 4;
    if (ct >= 1.5 && !ch.opened) {
      ch.opened = true;
      this.fx.coins(ch.x, ch.y, 6);
      this.fx.text(ch.x, ch.y - 14, '+12 coins', '#ffd040');
    } else if (ct < 1.5) ch.opened = false;
    ch.v.update(ch.x, ch.y, ct >= 1.5 ? ct - 1.5 : -1);

    // 3: 5 s loop: closed, rattles harder, pops open, chomps, resets.
    const r = this.reveal;
    const lt = this.t % 5;
    const asleep = lt < 2.2;
    const rattle = lt < 1 ? 0 : lt < 1.6 ? 0.3 : 1;
    r.v.update({ x: r.x, y: r.y, asleep, rattle, wakeT: asleep ? -1 : lt - 2.2, aim: 0 }, dt);

    this.fx.update(dt);
  }
}
