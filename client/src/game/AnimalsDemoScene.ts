// Dev page (?animals): the cove animals (#227) next to heroes at game scale,
// to pick the art on a phone. Sheets from lyaseek's "Forest creatures"
// (assets-src/forest-animals): 32x32 frames, row 0 idle, row 1 move, feet at
// the bottom of the cell. Each animal stands idle on the left and walks back
// and forth on the right. The button below switches Outline / Without outline.
import Phaser from 'phaser';
import { CLASSES, KIND } from '../generated/defs';
import { TerrainDemo } from './TerrainDemoScene';
import { TILE } from '../sim/map';
import bunnyO from '../../assets-src/forest-animals/Outline/MiniBunny.png';
import boarO from '../../assets-src/forest-animals/Outline/MiniBoar.png';
import deer1O from '../../assets-src/forest-animals/Outline/MiniDeer1.png';
import deer2O from '../../assets-src/forest-animals/Outline/MiniDeer2.png';
import bunnyN from '../../assets-src/forest-animals/Without outline/MiniBunny.png';
import boarN from '../../assets-src/forest-animals/Without outline/MiniBoar.png';
import deer1N from '../../assets-src/forest-animals/Without outline/MiniDeer1.png';
import deer2N from '../../assets-src/forest-animals/Without outline/MiniDeer2.png';

type Variant = 'outline' | 'plain';
const SHEETS: Record<string, Record<Variant, string>> = {
  bunny: { outline: bunnyO, plain: bunnyN },
  deer1: { outline: deer1O, plain: deer1N },
  deer2: { outline: deer2O, plain: deer2N },
  boar: { outline: boarO, plain: boarN },
};
/** Columns per sheet and frames in the idle (row 0) and move (row 1) rows. */
const COLS: Record<string, number> = { bunny: 4, deer1: 5, deer2: 7, boar: 5 };
const FRAMES = 4;
/** Walking speeds in px/s (the plan's first guesses: bunny 80, deer 90, boar 64; the demo walks at half). */
const WALK: Record<string, number> = { bunny: 40, deer1: 45, deer2: 45, boar: 32 };
const NAMES: Record<string, string> = { bunny: 'bunny', deer1: 'deer 1', deer2: 'deer 2', boar: 'boar' };

const W = 12;
const H = 14;

interface Walker {
  s: Phaser.GameObjects.Sprite;
  name: string;
  x0: number;
  x1: number;
  dir: number;
}

export class AnimalsDemoScene extends TerrainDemo {
  protected title = 'cove animals, heroes for scale';
  protected rows = Array.from({ length: H }, () => '.'.repeat(W));
  private variant: Variant = 'outline';
  private sprites: { s: Phaser.GameObjects.Sprite; name: string; moving: boolean }[] = [];
  private walkers: Walker[] = [];
  private bar?: HTMLDivElement;

  constructor() {
    super('animals-demo');
  }

  preload(): void {
    for (const [name, v] of Object.entries(SHEETS))
      for (const [variant, url] of Object.entries(v)) this.load.spritesheet(`${name}-${variant}`, url, { frameWidth: 32, frameHeight: 32 });
  }

  protected setup(): void {
    for (const name of Object.keys(SHEETS))
      for (const variant of ['outline', 'plain'] as const) {
        const tex = `${name}-${variant}`;
        this.anims.create({ key: `${tex}-idle`, frames: this.anims.generateFrameNumbers(tex, { start: 0, end: FRAMES - 1 }), frameRate: 5, repeat: -1 });
        this.anims.create({ key: `${tex}-move`, frames: this.anims.generateFrameNumbers(tex, { start: COLS[name], end: COLS[name] + FRAMES - 1 }), frameRate: 10, repeat: -1 });
      }

    // Heroes on the top row: idle, and one walking past for comparison.
    const hero = (kind: number, name: string, speed: number, at: [number, number]): void => this.actor(kind, name, speed, [{ to: at }, { wait: 3 }]);
    hero(KIND.ElvenRanger, '', CLASSES.ElvenRanger.speed, [1.5, 1.5]);
    hero(KIND.Paladin, '', CLASSES.Paladin.speed, [3, 1.5]);
    this.actor(KIND.Knight, '', 40, [{ to: [4.5, 1.5] }, { wait: 3 }]);
    this.actor(KIND.Barbarian, '', 30, [{ to: [6, 1.5] }, { to: [11, 1.5] }, { wait: 0.5 }, { to: [6, 1.5] }, { wait: 0.5 }]);

    // One row per animal: idle next to a ranger, then walking back and forth.
    Object.keys(SHEETS).forEach((name, i) => {
      const ty = 4.5 + i * 2.8;
      this.label(0.2, ty - 1.6, NAMES[name]);
      this.actor(KIND.ElvenRanger, '', 0, [{ to: [1.5, ty] }, { wait: 3 }]);
      this.sprites.push({ s: this.animal(name, 3, ty), name, moving: false });
      const s = this.animal(name, 5.5, ty);
      this.sprites.push({ s, name, moving: true });
      this.walkers.push({ s, name, x0: s.x, x1: this.px([11, ty])[0], dir: 1 });
    });
    this.play();
    this.buttons();
    // Zoom so the board fills the phone's width (after the page-wide view is applied on CREATE).
    this.events.once(Phaser.Scenes.Events.CREATE, () => {
      const cam = this.cameras.main;
      cam.setZoom(Math.floor((this.scale.width / ((W + 2) * TILE)) * 4) / 4);
    });
    this.events.once('shutdown', () => this.bar?.remove());
  }

  private animal(name: string, tx: number, ty: number): Phaser.GameObjects.Sprite {
    const [x, y] = this.px([tx, ty]);
    // Feet at the bottom of the 32x32 cell, standing on the same line as the heroes' feet.
    return this.add.sprite(x, y + TILE / 2, `${name}-${this.variant}`, 0).setOrigin(0.5, 1).setDepth(y);
  }

  private play(): void {
    for (const a of this.sprites) a.s.play(`${a.name}-${this.variant}-${a.moving ? 'move' : 'idle'}`);
  }

  update(time: number, delta: number): void {
    super.update?.(time, delta);
    const dt = delta / 1000;
    for (const w of this.walkers) {
      w.s.x += w.dir * WALK[w.name] * dt;
      if (w.s.x > w.x1 || w.s.x < w.x0) w.dir = -w.dir;
      // The sheets face right.
      w.s.setFlipX(w.dir < 0);
    }
  }

  /** One big button at the bottom, for a phone. */
  private buttons(): void {
    const bar = (this.bar = document.createElement('div'));
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:center;padding:8px;background:rgba(0,0,0,.75);z-index:10;font:600 16px system-ui,sans-serif';
    const b = document.createElement('button');
    b.style.cssText = 'padding:12px 18px;border-radius:8px;border:1px solid #777;background:#222;color:#fff;font:inherit;min-width:220px';
    const label = () => (b.textContent = this.variant === 'outline' ? 'Showing: Outline (tap to switch)' : 'Showing: Without outline (tap to switch)');
    label();
    b.onclick = () => {
      this.variant = this.variant === 'outline' ? 'plain' : 'outline';
      this.play();
      label();
    };
    bar.appendChild(b);
    document.body.appendChild(bar);
  }
}
