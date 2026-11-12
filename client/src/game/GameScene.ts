import Phaser from 'phaser';
import type { ClassId } from '../generated/ClassId';
import type { RunStartInfo } from '../generated/RunStartInfo';
import type { Net } from '../net';
import type { StepInput } from '../run/input';
import { RunSession } from '../run/session';
import { RulesLog } from '../rulesLog';
import type { Hud } from '../ui/hud';
import { FrameTimer, SYSTEMS, type DrawGl } from './frameTimer';
import { PhaserRunView } from './PhaserRunView';

export interface GameInit {
  info: RunStartInfo;
  net: Net;
  hud: Hud;
  myClass: ClassId;
}

/**
 * The Phaser host of a run: it reads the keys and the mouse into the session's input and calls the session's
 * `frame` each display frame. The run's logic lives in `RunSession`, its pictures in `PhaserRunView`.
 */
export class GameScene extends Phaser.Scene {
  private hud!: Hud;
  private session!: RunSession;
  private view?: PhaserRunView;
  private keys!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private primaryClicked = false;
  private secondaryClicked = false;
  private actPressed = false;
  private log!: RulesLog;
  /** The F3 panel's frame, render and per-system timings; on only while the panel is open. */
  private timer!: FrameTimer;
  private detachTimer?: () => void;

  constructor() {
    super('game');
  }

  init(data: GameInit): void {
    this.hud = data.hud;
    this.primaryClicked = this.secondaryClicked = this.actPressed = false;
    this.timer = new FrameTimer(SYSTEMS);
    this.view = undefined;
    this.detachTimer = undefined;
    // The session feeds the log its snapshots (after the HUD) and ends it.
    this.log = new RulesLog(data.net, data.info);
    this.session = new RunSession({ info: data.info, net: data.net, hud: data.hud, myClass: data.myClass, input: () => this.readInput(), clock: this.timer, log: this.log });
    // Registered now, so a throw in `create` still unsubscribes the session.
    this.events.once('shutdown', () => this.cleanup());
  }

  create(): void {
    // The session subscribed in `init`; the view is built here and handed to it.
    const view = new PhaserRunView(this, this.session.viewInit(), { timer: this.timer, log: this.log });
    this.view = view;
    this.session.setView(view);
    this.hud.setToggles(this.log.settings());

    const kb = this.input.keyboard!;
    // No key capture: Phaser's capture calls preventDefault page-wide and outlives the
    // scene, so these letters could no longer be typed into the lobby's inputs.
    this.keys = kb.addKeys('W,A,S,D', false) as GameScene['keys'];
    kb.addKey('Q', false);
    kb.addKey('E', false);
    kb.addKey('L', false);
    kb.on('keydown-L', (e: KeyboardEvent) => this.log.key(e));
    kb.on('keydown-Q', () => this.session.spectate(-1));
    kb.on('keydown-E', (e: KeyboardEvent) => {
      // One push per press: holding E must not push again on OS key repeat.
      if (this.session.alive) {
        if (!e.repeat) this.actPressed = true;
      }
      else this.session.spectate(1);
    });
    kb.on('keydown-F3', (e: KeyboardEvent) => {
      e.preventDefault();
      this.session.toggleStats();
    });
    // Debug runs only (debug accounts); the session ignores them otherwise and while dead.
    kb.on('keydown-F4', (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.repeat) return;
      this.session.debugDarkvision();
    });
    kb.on('keydown-F7', (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.repeat) return;
      if (e.shiftKey) this.session.debugAntiMagic();
      else this.session.debugIncorporeal();
    });
    kb.on('keydown-F8', (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.repeat) return;
      if (e.shiftKey) this.session.debugDispel();
      else this.session.debugEffect();
    });
    kb.on('keydown-F9', (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.repeat) return;
      this.session.debugImmortal();
    });
    kb.on('keydown-ESC', () => this.session.toggleMenu());
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) this.secondaryClicked = true;
      else this.primaryClicked = true;
    });

    const renderer = this.game.renderer;
    this.detachTimer = this.timer.attach(this.game.events, renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer ? (renderer.gl as unknown as DrawGl) : null);
  }

  /** The keys and buttons for one fixed step; it consumes the click latches, also while dead. */
  private readInput(): StepInput {
    const k = this.keys;
    const ptr = this.input.activePointer;
    const inp: StepInput = {
      mx: (k.D.isDown ? 1 : 0) - (k.A.isDown ? 1 : 0) as -1 | 0 | 1,
      my: (k.S.isDown ? 1 : 0) - (k.W.isDown ? 1 : 0) as -1 | 0 | 1,
      primary: ptr.leftButtonDown() || this.primaryClicked,
      secondary: ptr.rightButtonDown() || this.secondaryClicked,
      act: this.actPressed,
      held: k.W.isDown || k.A.isDown || k.S.isDown || k.D.isDown,
    };
    this.primaryClicked = this.secondaryClicked = this.actPressed = false;
    return inp;
  }

  update(_time: number, deltaMs: number): void {
    this.session.frame(deltaMs);
  }

  private cleanup(): void {
    this.session.destroy();
    this.session.setView(null);
    this.view?.destroy();
    this.detachTimer?.();
    this.timer.on = false;
  }
}
