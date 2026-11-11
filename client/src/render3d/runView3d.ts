// The 3D view of a run (#302): a `RunView` for the Phaser-free session. The camera follows the own hero (or the spectated
// teammate) or flies free, the own hero is a stand-in card, and the lights come from the page's parameters. The three.js
// `View` comes and goes (a lost device), so it is attached and detached from outside.
import { FIGURES } from '../game/anim/defs';
import { dir8 } from '../run/input';
import { NO_STATS, type PictureEv, type RunFrame, type RunView, type RunViewInit, type ShotView, type ViewStats } from '../run/view';
import { facesLeft, followClamp, freeClamp, keysToWorld, type Cam } from './camera';
import { cardQuads, type Dynamic } from './cards';
import { MOVE_KEYS, type StageCtx } from './host';
import { AMBIENT, WORK_AMBIENT, type Light } from './light';
import { R3D_SYSTEMS } from './stats';
import type { View } from './view';
import type { FrameRects } from './worldMesh';

const TILE = 16;
const rad = (deg: number): number => (deg * Math.PI) / 180;
/** The follow camera's ease, per second (#301's factor `1 - exp(-dt * 6)`). */
const FOLLOW_RATE = 6;
/** The free camera's speed in tiles per second, and with Shift. */
const FREE_SPEED = 12;
const FREE_SPEED_FAST = 36;
/** Below this many tiles per second the own hero counts as standing still. */
const MOVING_SPEED = 0.5;
const EMPTY = { position: new Float32Array(0), uv: new Float32Array(0), count: 0 };
const NO_GLOWS = { position: new Float32Array(0), uv: new Float32Array(0), color: new Float32Array(0), count: 0 };

/** Keys held -> the fixed step's movement: the screen direction turned by the yaw, rounded to the eight wire directions. */
export function moveInput(held: ReadonlySet<string>, yawRad: number): { mx: -1 | 0 | 1; my: -1 | 0 | 1 } {
  let ix = 0;
  let iz = 0;
  for (const k of held) {
    const d = MOVE_KEYS[k];
    if (d) {
      ix += d[0];
      iz += d[1];
    }
  }
  if (ix === 0 && iz === 0) return { mx: 0, my: 0 };
  const w = keysToWorld(yawRad, ix, iz);
  return dir8(w.x, w.z);
}

/** The own hero's stand-in card: the class's idle or run frame from the pack, no weapon. Idle 5 per second, run 9 per second, 4 frames. */
export function heroFrame(kind: number, moving: boolean, t: number): string {
  const def = FIGURES[kind];
  const n = Math.floor(t * (moving ? 9 : 5)) % 4;
  return `${moving ? def.run : def.idle}${n}`;
}

export class RunView3d implements RunView {
  /** Draw calls of the last frame. */
  drawCalls = 0;
  /** The own hero and the camera target, in tiles (for `window.__r3d`). */
  readonly hero = { x: 0, z: 0 };
  readonly cam = { x: 0, z: 0 };

  private v: View | null = null;
  private c: StageCtx | null = null;
  private fast = false;
  private started = false;
  private flip = false;
  private fx = 0;
  private fz = 0;
  private fps = 0;
  private readonly map: RunViewInit['map'];
  private readonly woodland: boolean;
  private readonly kind: number;

  constructor(init: RunViewInit, private readonly frames: FrameRects) {
    this.map = init.map;
    this.woodland = !!init.info.woodland;
    this.kind = init.myKind;
  }

  /** The three.js view of the moment (null while it is restored). */
  attach(view: View | null): void {
    this.v = view;
  }

  /** Per host frame, before the session's frame: the frame's context. `fast`: Shift is down (the free camera flies faster). */
  begin(c: StageCtx, fast = false): void {
    this.c = c;
    this.v = c.view;
    this.fast = fast;
  }

  frame(f: RunFrame): ViewStats {
    const c = this.c;
    if (!c) return NO_STATS; // the session ran before the host's first frame
    const pitch = rad(c.params.pitch);
    const yaw = rad(c.params.yaw);
    const dt = f.dt;
    if (dt > 0) this.fps = this.fps === 0 ? 1 / dt : this.fps * 0.9 + (1 / dt) * 0.1;

    // The own hero: where it stands, which way it last moved, whether it moves now.
    const hx = f.own.x / TILE;
    const hz = f.own.y / TILE;
    let moving = false;
    if (this.started) {
      const dx = hx - this.hero.x;
      const dz = hz - this.hero.z;
      if (dt > 0 && Math.hypot(dx, dz) / dt > MOVING_SPEED) {
        moving = true;
        this.fx = dx;
        this.fz = dz;
      }
    }
    this.hero.x = hx;
    this.hero.z = hz;

    // The camera.
    const tx = f.camera.x / TILE;
    const tz = f.camera.y / TILE;
    if (c.params.free && this.started) {
      let ix = 0;
      let iz = 0;
      for (const k of c.held) {
        const d = MOVE_KEYS[k];
        if (d) {
          ix += d[0];
          iz += d[1];
        }
      }
      if (ix !== 0 || iz !== 0) {
        const w = keysToWorld(yaw, ix, iz);
        const len = Math.hypot(w.x, w.z) || 1;
        const sp = (this.fast ? FREE_SPEED_FAST : FREE_SPEED) * dt;
        const p = freeClamp(this.map, this.cam.x + (w.x / len) * sp, this.cam.z + (w.z / len) * sp);
        this.cam.x = p.x;
        this.cam.z = p.z;
      }
    } else {
      const want = followClamp(this.map, { x: tx, z: tz, pitch, yaw }, c.plan.halfW, c.plan.halfH);
      if (!this.started) {
        this.cam.x = want.x;
        this.cam.z = want.z;
      } else {
        const k = 1 - Math.exp(-dt * FOLLOW_RATE);
        this.cam.x += (want.x - this.cam.x) * k;
        this.cam.z += (want.z - this.cam.z) * k;
      }
    }
    this.started = true;
    const cam: Cam = { x: this.cam.x, z: this.cam.z, pitch, yaw };

    const view = this.v;
    if (!view) {
      this.drawCalls = 0;
      return this.stats(c, 0);
    }
    this.flip = facesLeft(yaw, this.fx, this.fz, this.flip);
    const cards = f.own.alive ? cardQuads([{ frame: heroFrame(this.kind, moving, f.now), x: hx, z: hz, flip: this.flip }], this.frames, cam) : EMPTY;
    const dynamic: Dynamic = { cards, emissive: EMPTY, glows: NO_GLOWS };
    c.timer.lap('cards');
    const work = this.woodland || c.params.light === 'work';
    const lights: Light[] = work ? [] : [{ x: cam.x, y: 1.0, z: cam.z, radius: 9, r: 1.0, g: 0.82, b: 0.55, shadow: c.params.shadows }];
    c.timer.lap('lights');
    c.timer.renderStart();
    this.drawCalls = view.draw(
      { cam, plan: c.plan, dynamic, lights, ambient: work ? WORK_AMBIENT : AMBIENT, shadows: c.params.shadows, smooth: c.params.smooth, t: c.now },
      c.timer,
    );
    return this.stats(c, view.meshes);
  }

  private stats(c: StageCtx, objects: number): ViewStats {
    return {
      fps: this.fps,
      wholeMs: c.timer.frameMs,
      renderMs: c.timer.renderMs,
      systems: R3D_SYSTEMS.map((s) => [s, c.timer.systems[s]] as const),
      objects,
      drawCalls: this.drawCalls,
      canvas: { w: c.canvas.w, h: c.canvas.h, cssZoom: 1 },
    };
  }

  event(_ev: PictureEv, _own: { x: number; y: number }): void {}

  tileChanged(x: number, y: number, _v: number): void {
    this.v?.tileChanged(x, y);
  }

  shotEnded(_shot: ShotView, _how: 'wall' | 'enemy' | 'gone'): void {}

  pointerWorld(): { x: number; y: number } | null {
    return null;
  }

  destroy(): void {
    this.v = null;
    this.c = null;
  }
}
