// The stage of a real run in the 3D view (#302): the Phaser-free `RunSession` on the host core. The session owns the map, the
// prediction and the HUD; `RunView3d` draws; this file joins them to the host's frame, keys and the ground painting.
import type { ClassId } from '../generated/ClassId';
import type { RunStartInfo } from '../generated/RunStartInfo';
import { TILE } from '../sim/map';
import { RunSession, type FrameClock, type HudLike, type NetLike } from '../run/session';
import { RulesLog } from '../rulesLog';
import type { Hud } from '../ui/hud';
import type { StepInput } from '../run/input';
import { atlasBounds } from './atlasBounds';
import { GROUND_BUDGET_MS, groundJob, type GroundJob } from './groundJob';
import { RunMouse, turnKeyLabels } from './input';
import { CamTurn } from './turn';
import { isTextTarget, MOVE_KEYS, showError, type Host, type Stage, type StageCtx } from './host';
import { WOODLAND_CLEAR } from './light';
import { Overlay3d } from './overlay';
import { RunView3d, moveInput } from './runView3d';
import type { R3dSystem } from './stats';
import type { FrameTimer } from '../game/frameTimer';
import { wrapYaw } from './params';
import { GroundTooLargeError, type Assets, type View } from './view';

/** What the host's frame tells the session's input function. */
export interface RunInputState {
  held: ReadonlySet<string>;
  /** Radians. */
  yaw: number;
  free: boolean;
  /** Held or clicked since the last step (the mouse's latch). */
  primary: () => boolean;
  secondary: () => boolean;
  /** E pressed since the last step: the stage sets it, `stepInput` clears it. */
  act: boolean;
}

/** One fixed step's input: the keys turned by the yaw and the buttons; nothing while the free camera is on. */
export function stepInput(s: RunInputState): StepInput {
  // Read in any case so a click or E from the free camera does not fire later.
  const primary = s.primary();
  const secondary = s.secondary();
  const act = s.act;
  s.act = false;
  if (s.free) return { mx: 0, my: 0, primary: false, secondary: false, act: false, held: false };
  let any = false;
  for (const k of s.held) if (k in MOVE_KEYS) any = true;
  return { ...moveInput(s.held, s.yaw), primary, secondary, act, held: any };
}

/** The session's frame clock, forwarded to the host's timer of the moment (none before the host's first frame). */
class TimerClock implements FrameClock {
  timer: FrameTimer<R3dSystem> | null = null;
  get on(): boolean {
    return this.timer?.on ?? false;
  }
  set on(v: boolean) {
    if (this.timer) this.timer.on = v;
  }
  begin(): void {
    this.timer?.begin();
  }
  lap(s: 'sim' | 'hud'): void {
    this.timer?.lap(s);
  }
}

/** The HUD as the 3D run needs it: the session's, plus the Settings switches the host sets (the rules log's). */
export type RunHud = HudLike & Pick<Hud, 'setToggles'>;

export interface Run {
  readonly session: RunSession;
  readonly input: RunInputState;
  readonly hud: RunHud;
  readonly log: RulesLog;
  readonly clock: { timer: FrameTimer<R3dSystem> | null };
}

/** The session, made at once so messages are handled from `RunStarted` on, before the host has a view. */
export function newRun(deps: { info: RunStartInfo; net: NetLike; hud: RunHud; myClass: ClassId }): Run {
  const input: RunInputState = { held: new Set(), yaw: 0, free: false, primary: () => false, secondary: () => false, act: false };
  const clock = new TimerClock();
  // The rules log lives with the session (it hears the snapshots and ends with it); the stage binds its key and tags.
  const log = new RulesLog(deps.net, deps.info);
  const session = new RunSession({ ...deps, input: () => stepInput(input), clock, log });
  // The Settings switches point at this run's log from the start (the stage may come late, or never).
  deps.hud.setToggles(log.settings());
  return { session, input, clock, hud: deps.hud, log };
}

export interface RunStage extends Stage {
  readonly runView: RunView3d;
  readonly job: GroundJob | null;
}

/**
 * `el` shows the ground's error box; `onLoop` is called at the first frame (the host's loop has taken over from whatever
 * drove the session before).
 */
export function createRunStage(run: Run, info: RunStartInfo, assets: Assets, host: Host, el: HTMLElement, onLoop: () => void = () => {}): RunStage {
  const { session } = run;
  // The overlay canvas is the stage's, not the view's: it survives a lost device's rebuild (which replaces the 3D canvas).
  const overlay = new Overlay3d(el);
  const runView = new RunView3d(session.viewInit(), assets.frames, atlasBounds(assets.image, assets.frames), overlay);
  session.setView(runView);
  const job = info.woodland ? groundJob(session.map, info.woodland.seed, info.spawn_y / TILE) : null;
  // A ground too large for the device: shown once, the run keeps its flat grass.
  let tooLarge = false;
  const upload = (v: View): void => {
    if (!job || tooLarge) return;
    try {
      v.setGround(job.image());
    } catch (e) {
      if (!(e instanceof GroundTooLargeError)) throw e;
      tooLarge = true;
      showError(el, e.message, false);
    }
  };

  // Shift (the free camera's fast flight): every key event carries the modifier, so a release is seen on any key.
  let shift = false;
  const onMod = (e: KeyboardEvent): void => {
    shift = e.shiftKey;
  };
  const onBlur = (): void => {
    shift = false;
  };
  window.addEventListener('keydown', onMod);
  window.addEventListener('keyup', onMod);
  window.addEventListener('blur', onBlur);

  // The run's own turn state: every run starts facing north, whatever the URL says. The mouse listens on the host element.
  const turn = new CamTurn();
  // The yaw (whole degrees) last put into the host's params; a different `params.yaw` means the panel's slider moved it.
  let reported = 0;
  if (host.params.yaw !== 0) host.setRunYaw(0);
  const mouse = new RunMouse(el, turn);
  run.input.primary = () => mouse.takePrimary();
  run.input.secondary = () => mouse.takeSecondary();
  runView.mouse = mouse;
  runView.tagOf = (e) => run.log.tagOf(e);

  // The help line names the turn keys by the player's layout.
  let live = true;
  turnKeyLabels().then((k) => { if (live) run.hud.setTurnHelp(k); }, () => {});

  let looped = false;
  return {
    runView,
    job,
    world: { map: session.map, painted: !!info.woodland, clear: info.woodland ? WOODLAND_CLEAR : 'stone' },
    built(view: View): void {
      runView.attach(view);
      if (job?.done) upload(view); // the kept pixels, no repaint
    },
    frame(c: StageCtx): number {
      if (!looped) {
        looped = true;
        onLoop();
      }
      run.clock.timer = c.timer;
      run.input.held = c.held;
      if (c.params.yaw !== reported) {
        turn.set(c.params.yaw); // the panel's slider
        reported = c.params.yaw;
      }
      turn.update(c.dt);
      const shown = turn.shown;
      const whole = wrapYaw(Math.round(shown));
      if (whole !== reported) {
        reported = whole;
        host.setRunYaw(whole);
      }
      run.input.yaw = (shown * Math.PI) / 180;
      run.input.free = c.params.free;
      if (job && !job.done && job.step(GROUND_BUDGET_MS) && c.view) upload(c.view);
      runView.begin({ ...c, params: { ...c.params, yaw: shown } }, shift);
      session.frame(c.dt * 1000);
      const r = window.__r3d;
      if (r) {
        r.hero = runView.hero;
        r.cam = runView.cam;
        r.figures = runView.figureCount;
        r.overlay = runView.overlayItems;
        r.yaw = whole;
        if (c.view) r.chunks = c.view.chunks;
      }
      return runView.drawCalls;
    },
    key(e: KeyboardEvent): boolean {
      switch (e.code) {
        case 'Escape':
          if (!e.repeat) session.toggleMenu();
          return true;
        case 'KeyE':
        case 'KeyQ':
          if (session.alive) {
            // E uses (once per press); Q has no use while alive
            if (e.code !== 'KeyE') return false;
            if (!e.repeat) run.input.act = true;
            return true;
          }
          if (!e.repeat) session.spectate(e.code === 'KeyQ' ? -1 : 1);
          return true;
        case 'KeyZ':
        case 'KeyC':
        case 'KeyX':
          if (isTextTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return false; // Ctrl+C is a copy
          if (!e.repeat) {
            if (e.code === 'KeyX') turn.north();
            else turn.step(e.code === 'KeyZ' ? 1 : -1);
          }
          return true;
        case 'KeyL':
          if (isTextTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return false; // Ctrl+L is the address bar
          run.log.key(e);
          return true;
        case 'KeyF':
          if (!e.repeat) host.setParams({ ...host.params, free: !host.params.free });
          return true;
        // Debug runs only (debug accounts); the session ignores them otherwise and while dead. Always taken from the
        // browser (F7 is caret browsing), a held key acts once.
        case 'F4':
          if (!e.repeat) session.debugDarkvision();
          return true;
        case 'F7':
          if (!e.repeat) {
            if (e.shiftKey) session.debugAntiMagic();
            else session.debugIncorporeal();
          }
          return true;
        case 'F8':
          if (!e.repeat) {
            if (e.shiftKey) session.debugDispel();
            else session.debugEffect();
          }
          return true;
        case 'F9':
          if (!e.repeat) session.debugImmortal();
          return true;
        default:
          return false;
      }
    },
    stats(): boolean {
      session.toggleStats();
      return true;
    },
    dispose(): void {
      live = false;
      run.hud.setTurnHelp(null);
      window.removeEventListener('keydown', onMod);
      window.removeEventListener('keyup', onMod);
      window.removeEventListener('blur', onBlur);
      mouse.dispose();
      run.input.primary = run.input.secondary = () => false;
      run.clock.timer = null;
      runView.destroy();
      overlay.dispose();
    },
  };
}
