// The stage of a real run in the 3D view (#302): the Phaser-free `RunSession` on the host core. The session owns the map, the
// prediction and the HUD; `RunView3d` draws; this file joins them to the host's frame, keys and the ground painting.
import type { ClassId } from '../generated/ClassId';
import type { RunStartInfo } from '../generated/RunStartInfo';
import { TILE } from '../sim/map';
import { RunSession, type FrameClock, type HudLike, type NetLike } from '../run/session';
import type { StepInput } from '../run/input';
import { GROUND_BUDGET_MS, groundJob, type GroundJob } from './groundJob';
import { MOVE_KEYS, showError, type Host, type Stage, type StageCtx } from './host';
import { WOODLAND_CLEAR } from './light';
import { RunView3d, moveInput } from './runView3d';
import type { R3dSystem } from './stats';
import type { FrameTimer } from '../game/frameTimer';
import { GroundTooLargeError, type Assets, type View } from './view';

/** What the host's frame tells the session's input function. */
export interface RunInputState {
  held: ReadonlySet<string>;
  /** Radians. */
  yaw: number;
  free: boolean;
}

/** One fixed step's input: the keys turned by the yaw, no buttons; nothing while the free camera is on. */
export function stepInput(s: RunInputState): StepInput {
  if (s.free) return { mx: 0, my: 0, primary: false, secondary: false, act: false, held: false };
  let any = false;
  for (const k of s.held) if (k in MOVE_KEYS) any = true;
  return { ...moveInput(s.held, s.yaw), primary: false, secondary: false, act: false, held: any };
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

export interface Run {
  readonly session: RunSession;
  readonly input: RunInputState;
  readonly clock: { timer: FrameTimer<R3dSystem> | null };
}

/** The session, made at once so messages are handled from `RunStarted` on, before the host has a view. */
export function newRun(deps: { info: RunStartInfo; net: NetLike; hud: HudLike; myClass: ClassId }): Run {
  const input: RunInputState = { held: new Set(), yaw: 0, free: false };
  const clock = new TimerClock();
  const session = new RunSession({ ...deps, input: () => stepInput(input), clock });
  return { session, input, clock };
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
  const runView = new RunView3d(session.viewInit(), assets.frames);
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
      run.input.yaw = (c.params.yaw * Math.PI) / 180;
      run.input.free = c.params.free;
      if (job && !job.done && job.step(GROUND_BUDGET_MS) && c.view) upload(c.view);
      runView.begin(c, shift);
      session.frame(c.dt * 1000);
      const r = window.__r3d;
      if (r) {
        r.hero = runView.hero;
        r.cam = runView.cam;
        if (c.view) r.chunks = c.view.chunks;
      }
      return runView.drawCalls;
    },
    key(e: KeyboardEvent): boolean {
      switch (e.code) {
        case 'Escape':
          if (!e.repeat) session.toggleMenu();
          return true;
        case 'KeyQ':
        case 'KeyE':
          if (session.alive) return false;
          if (!e.repeat) session.spectate(e.code === 'KeyQ' ? -1 : 1);
          return true;
        case 'KeyF':
          if (!e.repeat) host.setParams({ ...host.params, free: !host.params.free });
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
      window.removeEventListener('keydown', onMod);
      window.removeEventListener('keyup', onMod);
      window.removeEventListener('blur', onBlur);
      run.clock.timer = null;
      runView.destroy();
    },
  };
}
