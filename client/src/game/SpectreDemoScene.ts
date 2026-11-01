// Dev page ?spectres (no server): the haunting dungeons' spectres, to judge their looks on a phone (#169).
// One small room, zoomed to fit the screen; the Ghost on the left, the hero in the middle, (later) the Shade
// on the right. Big buttons along the bottom act on every spectre: Idle, Move, Attack (a lunge at the hero),
// Vanish (a ghost image fades out, the figure fades back in), Ambush (gone, then it flickers into view for the
// 0.5 s wind-up, then touches; no fade-in over the flicker), Hurt, Die (the Ghost comes apart, no skull).
// To add a spectre: put its kind in SPECTRES and give it a figure def; nothing else here changes.
import Phaser from 'phaser';
import { ANIM, FLAG, KIND } from '../generated/defs';
import { EntityView } from './anim/EntityView';
import { FIGURES } from './anim/defs';
import { Effects } from './effects';
import { TILE } from '../sim/map';

const W = 12;
const H = 8;
/** The spectres that have a look so far, with their spots (tiles) and names. */
const SPECTRES = [
  { kind: KIND.Ghost, name: 'Ghost', id: 11, x: 3, y: 5 },
  { kind: KIND.Shade, name: 'Shade', id: 12, x: 9, y: 5 },
].filter((s) => FIGURES[s.kind]);
const HERO: [number, number] = [6 * TILE, 5 * TILE];
/** Server wind-up of the ambush (`AMBUSH_WARNING`). */
const AMBUSH_SECS = 0.5;
const MELEE_SECS = 0.4;

type Mode = 'idle' | 'move' | 'attack' | 'vanish' | 'ambush' | 'hurt' | 'die';
const MODES: [Mode, string][] = [['idle', 'Idle'], ['move', 'Move'], ['attack', 'Attack'], ['vanish', 'Vanish'], ['ambush', 'Ambush'], ['hurt', 'Hurt'], ['die', 'Die']];

interface Spectre {
  def: (typeof SPECTRES)[number];
  view: EntityView | null;
  x: number;
  y: number;
  mode: Mode;
  /** Seconds in the mode. */
  t: number;
  /** Seconds the current animation has run. */
  animT: number;
  anim: number;
}

export class SpectreDemoScene extends Phaser.Scene {
  private fx!: Effects;
  private hero!: EntityView;
  private spectres: Spectre[] = [];
  private bar?: HTMLDivElement;
  private caption!: Phaser.GameObjects.Text;

  constructor() {
    super('spectre-demo');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#101820');
    this.fx = new Effects(this);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const wall = y < 2;
        this.add.image(x * TILE, y * TILE, 'atlas', wall ? (y === 1 ? 'wall_mid' : 'wall_top_mid') : (x * 7 + y * 3) % 8 === 0 ? 'floor_2' : 'floor_1').setOrigin(0);
      }
    this.hero = new EntityView(this, KIND.Paladin, this.fx, 'Paladin');
    this.spectres = SPECTRES.map((def) => ({ def, view: this.spawn(def), x: def.x * TILE, y: def.y * TILE, mode: 'idle', t: 0, animT: 0, anim: ANIM.Idle }));
    this.caption = this.add.text(4, 2, '', { fontFamily: 'monospace', fontSize: '8px', color: '#ffe080' }).setResolution(4).setDepth(1e6);

    const cam = this.cameras.main;
    const barH = 120;
    cam.setZoom(Math.min(cam.width / (W * TILE), (cam.height - barH) / (H * TILE)));
    cam.centerOn((W * TILE) / 2, (H * TILE) / 2 + barH / 2 / cam.zoom);
    this.buttons();
    this.events.once('shutdown', () => this.bar?.remove());
    this.set('idle');
  }

  private spawn(def: (typeof SPECTRES)[number]): EntityView {
    return new EntityView(this, def.kind, this.fx, def.name);
  }

  private buttons(): void {
    const bar = (this.bar = document.createElement('div'));
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;display:flex;flex-wrap:wrap;gap:8px;justify-content:center;padding:10px;background:rgba(0,0,0,.75);z-index:10;font:600 18px system-ui,sans-serif';
    for (const [mode, label] of MODES) {
      const b = document.createElement('button');
      b.style.cssText = 'padding:14px 16px;border-radius:10px;border:1px solid #777;background:#222;color:#fff;font:inherit;min-width:88px';
      b.textContent = label;
      b.onclick = () => this.set(mode);
      bar.appendChild(b);
    }
    document.body.appendChild(bar);
  }

  /** Starts a mode on every spectre (a dead or vanished one comes back first). */
  private set(mode: Mode): void {
    this.caption.setText(mode);
    for (const s of this.spectres) {
      s.mode = mode;
      s.t = 0;
      s.x = s.def.x * TILE;
      s.y = s.def.y * TILE;
      s.view ??= this.spawn(s.def);
      s.anim = mode === 'move' ? ANIM.Move : ANIM.Idle;
      s.animT = 0;
      if (mode === 'vanish') s.view.ghost();
      if (mode === 'ambush') this.hide(s);
      if (mode === 'die') {
        s.view.destroy();
        s.view = null;
        if (s.def.kind === KIND.Ghost) this.fx.disintegrate(s.x, s.y - 8);
        else if (s.def.kind === KIND.Shade) this.fx.darkCloud(s.x, s.y - 8);
        else this.fx.burst(s.x, s.y - 6, 14, 0x9a2020, 50, 0.5, 60);
      }
    }
  }

  private hide(s: Spectre): void {
    s.view?.destroy();
    s.view = null;
  }

  /** The spectre appears again, as the game does it: fading in, unless it comes straight into the ambush wind-up. */
  private show(s: Spectre, fade: boolean): void {
    s.view = this.spawn(s.def);
    if (fade) s.view.fadeIn();
  }

  update(_t: number, dms: number): void {
    const dt = dms / 1000;
    const aimAt = (s: Spectre) => Math.atan2(HERO[1] - s.y, HERO[0] - s.x);
    for (const s of this.spectres) {
      s.t += dt;
      s.animT += dt;
      let hurt = false;
      switch (s.mode) {
        case 'move': {
          const k = Math.sin(s.t * 1.6);
          s.x = s.def.x * TILE + 30 * k;
          s.anim = ANIM.Move;
          break;
        }
        case 'attack':
          s.anim = s.t % 1.6 < MELEE_SECS ? ANIM.Melee : ANIM.Idle;
          if (s.anim === ANIM.Idle) s.animT = s.t % 1.6 - MELEE_SECS;
          else s.animT = s.t % 1.6;
          break;
        case 'vanish':
          // Gone for 1.2 s (as an Invisible creature is), then it fades in.
          if (s.t < 1.2) this.hide(s);
          else if (!s.view) this.show(s, true);
          break;
        case 'ambush':
          if (s.t >= 1 && !s.view) {
            this.show(s, false);
            s.anim = ANIM.Ambush;
            s.animT = 0;
          }
          if (s.view && s.t >= 1 + AMBUSH_SECS && s.anim === ANIM.Ambush) {
            s.anim = ANIM.Melee;
            s.animT = 0;
          } else if (s.view && s.t >= 1 + AMBUSH_SECS + MELEE_SECS && s.anim === ANIM.Melee) {
            s.anim = ANIM.Idle;
            s.animT = 0;
          }
          break;
        case 'hurt':
          hurt = s.t % 1.2 < 0.3;
          break;
        case 'die':
          if (s.t > 1.8) this.set('idle');
          break;
        default:
      }
      s.view?.update({ id: s.def.id, x: s.x, y: s.y, anim: s.anim, animT: s.animT, aim: aimAt(s), flags: FLAG.INCORPOREAL | (hurt ? FLAG.HURT : 0) }, dt);
    }
    this.hero.update({ x: HERO[0], y: HERO[1], anim: ANIM.Idle, animT: 0, aim: 0, flags: 0, party: true }, dt);
    this.fx.update(dt);
  }
}
