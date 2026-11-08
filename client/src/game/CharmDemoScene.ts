// Dev page ?charm (no server): what a charmed player sees (#224), to judge on a phone.
// One small room, zoomed to fit the screen: a charmed Barbarian runs at a Paladin and swings at him, over the pink
// view of mockup B (haze, pulsing edge, "CHARMED", the caster, a shrinking bar). Big buttons along the bottom:
//   Charmed: the view is on and the charm counts down (8 s, then it starts again).
//   Paused:  Dispel or an anti-magic area pauses the charm: no view, the Barbarian stands still, the effect icon is grey.
//   Ends:    the view fades out, the heart goes and the Barbarian walks back to where he stood.
// No keyboard needed. Runtime shapes and text only; the figures are pack sprites.
import Phaser from 'phaser';
import { ANIM, EFFECT, FLAG, KIND } from '../generated/defs';
import { EntityView } from './anim/EntityView';
import { Effects } from './effects';
import { TILE } from '../sim/map';
import { CharmView } from '../ui/charmView';
import { effectChipHtml } from '../ui/hud';

const W = 12;
const H = 8;
const CHARM_SECS = 8;
const SWING_EVERY = 1;
const SWING_SECS = 0.4;
const START: [number, number] = [2 * TILE, 5 * TILE];
const PALADIN: [number, number] = [9 * TILE, 5 * TILE];
const SPEED = 55;
/** The Barbarian stops this far from the Paladin to swing. */
const REACH = 22;

type Mode = 'charmed' | 'paused' | 'ends';
const MODES: [Mode, string][] = [['charmed', 'Charmed'], ['paused', 'Paused'], ['ends', 'Ends']];

export class CharmDemoScene extends Phaser.Scene {
  private fx!: Effects;
  private barb!: EntityView;
  private pal!: EntityView;
  private view!: CharmView;
  private host?: HTMLDivElement;
  private bar?: HTMLDivElement;
  private chip?: HTMLDivElement;
  private caption!: Phaser.GameObjects.Text;
  private mode: Mode = 'charmed';
  /** Seconds in the mode. */
  private t = 0;
  private x = START[0];
  private y = START[1];
  private dir = 0;
  private swingT = 0;
  private hurtT = 0;

  constructor() {
    super('charm-demo');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#101820');
    this.fx = new Effects(this);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const wall = y < 2;
        this.add.image(x * TILE, y * TILE, 'atlas', wall ? (y === 1 ? 'wall_mid' : 'wall_top_mid') : (x * 7 + y * 3) % 8 === 0 ? 'floor_2' : 'floor_1').setOrigin(0);
      }
    this.barb = new EntityView(this, KIND.Barbarian, this.fx, 'Barbarian');
    this.pal = new EntityView(this, KIND.Paladin, this.fx, 'Paladin');
    this.caption = this.add.text(4, 2, '', { fontFamily: 'monospace', fontSize: '8px', color: '#ffe080' }).setResolution(4).setDepth(1e6);

    const cam = this.cameras.main;
    const barH = 120;
    cam.setZoom(Math.min(cam.width / (W * TILE), (cam.height - barH) / (H * TILE)));
    cam.centerOn((W * TILE) / 2, (H * TILE) / 2 + barH / 2 / cam.zoom);
    this.dom();
    this.events.once('shutdown', () => {
      this.bar?.remove();
      this.host?.remove();
    });
    this.set('charmed');
  }

  private dom(): void {
    // The view fills the screen, like the HUD root it lives in during a run.
    const host = (this.host = document.createElement('div'));
    host.style.cssText = 'position:fixed;inset:0;z-index:5;pointer-events:none;transition:opacity .6s';
    this.view = new CharmView(host);
    document.body.appendChild(host);

    // The effect row as the HUD shows it: the heart with the seconds, grey while paused.
    const chip = (this.chip = document.createElement('div'));
    chip.style.cssText = 'position:fixed;top:8px;left:8px;z-index:6;font:600 14px system-ui,sans-serif;color:#fff';
    document.body.appendChild(chip);

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
    this.events.once('shutdown', () => this.chip?.remove());
  }

  private set(mode: Mode): void {
    this.mode = mode;
    this.t = 0;
    this.caption.setText(mode);
    if (mode === 'charmed') {
      this.x = START[0];
      this.y = START[1];
      this.swingT = 0;
    }
  }

  private left(): number {
    return CHARM_SECS - (this.t % CHARM_SECS);
  }

  update(_t: number, dms: number): void {
    const dt = dms / 1000;
    this.t += dt;
    const charmed = this.mode === 'charmed';
    const tx = charmed ? PALADIN[0] - REACH : START[0];
    const dist = tx - this.x;
    let anim: number = ANIM.Idle;
    // Charmed: runs at the Paladin and swings. Ends: walks back. Paused: stands.
    if (this.mode !== 'paused' && Math.abs(dist) > 1) {
      this.x += Math.sign(dist) * Math.min(Math.abs(dist), SPEED * dt);
      this.dir = dist > 0 ? 0 : Math.PI;
      anim = ANIM.Move;
    } else if (charmed) {
      this.swingT += dt;
      if (this.swingT >= SWING_EVERY) {
        this.swingT = 0;
        this.hurtT = 0.25;
        this.fx.hitSpark(PALADIN[0] - 6, PALADIN[1] - 8, 0xffffff);
      }
      if (this.swingT < SWING_SECS) anim = ANIM.Melee;
      this.dir = 0;
    }
    this.hurtT = Math.max(0, this.hurtT - dt);

    // The view: on while the charm runs, off when paused (control is back), fading out when it ends.
    const on = charmed;
    this.host!.style.opacity = on ? '1' : '0';
    if (on) this.view.update('the Dark Elf Priestess', this.left());
    else if (this.t > 0.7) this.view.update(null, 0);
    const left = this.mode === 'ends' ? 0 : this.left();
    this.chip!.innerHTML = this.mode === 'ends' ? '' : effectChipHtml(EFFECT.Charmed, left, 0, this.mode === 'paused');

    const heart = charmed ? 1 << EFFECT.Charmed : 0;
    const swinging = anim === ANIM.Melee;
    this.barb.update({ x: this.x, y: this.y, anim, animT: swinging ? this.swingT : this.t, aim: this.dir, flags: 0, effects: heart }, dt);
    this.pal.update({ x: PALADIN[0], y: PALADIN[1], anim: ANIM.Idle, animT: 0, aim: Math.PI, flags: this.hurtT > 0 ? FLAG.HURT : 0, party: true }, dt);
    this.fx.update(dt);
  }
}
