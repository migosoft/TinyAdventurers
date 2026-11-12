// The 3D view of a run (#302): a `RunView` for the Phaser-free session. The camera follows the own hero (or the spectated
// teammate) or flies free, the figures and shots are cards (`Figures3d`), and the lights come from the page's parameters. The three.js
// `View` comes and goes (a lost device), so it is attached and detached from outside.
import type { FrameBounds } from '../game/anim/pose';
import { settleOwnAim } from '../run/aim';
import { dir8 } from '../run/input';
import { NO_STATS, type PictureEv, type RunFrame, type RunView, type RunViewInit, type ShotView, type ViewStats } from '../run/view';
import { followClamp, freeClamp, keysToWorld, type Cam } from './camera';
import { RunMouse } from './input';
import { aimGround, toCanvas } from './screen';
import type { Overlay3d } from './overlay';
import type { EntState } from '../game/world';
import { Floats, layoutBars, layoutHeroTags, layoutTags, layoutUseHint, Marks, type LayoutIn, type OverlayItem } from './overlayLayout';
import { glowsOf, quadsOf, shadowsOf, type Dynamic } from './cards';
import { View as SightView } from '../sim/view';
import { Figures3d, type Opener } from './figures';
import { seenOpeners } from './openers';
import { seeLook } from './seeThrough';
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

export class RunView3d implements RunView {
  /** Draw calls of the last frame. */
  drawCalls = 0;
  /** The own hero and the camera target, in tiles (for `window.__r3d`). */
  readonly hero = { x: 0, z: 0 };
  readonly cam = { x: 0, z: 0 };

  /** The run's mouse: where the pointer is (set by the stage). */
  mouse: RunMouse | null = null;
  /** The rules log's tag over a creature (set by the stage; null: no tags). */
  tagOf: ((e: EntState) => string | null) | null = null;
  private v: View | null = null;
  private c: StageCtx | null = null;
  // What `pointerWorld` reads: the last frame's camera, plan, zoom and canvas (also read between frames by the session's steps).
  private lastCam: Cam | null = null;
  private lastPlan: StageCtx['plan'] | null = null;
  private lastZoom = 1;
  private lastCanvas: StageCtx['canvasEl'] | null = null;
  private lastSize = { w: 0, h: 0 };
  private lastRect: DOMRect | null = null;
  private fast = false;
  private started = false;
  private fps = 0;
  private readonly map: RunViewInit['map'];
  private readonly woodland: boolean;
  private readonly figures: Figures3d;

  private readonly heroNames = new Map<number, string>();
  private readonly floats = new Floats();
  private readonly marks = new Marks();

  /** `overlay`: the layer over the canvas (the stage's; tests pass none). */
  constructor(init: RunViewInit, frames: FrameRects, bounds: (frame: string) => FrameBounds, private readonly overlay: Overlay3d | null = null) {
    this.map = init.map;
    for (const p of init.info.players) this.heroNames.set(p.ent, p.name);
    this.sight = new SightView(init.map.w, init.map.h);
    this.woodland = !!init.info.woodland;
    this.figures = new Figures3d(init, frames, bounds);
  }

  /** What may open walls this frame and stands where the followed hero sees (for the wall openings, #303 Task 8). */
  seen: Opener[] = [];
  private readonly sight: SightView;
  private sightKey = '';

  /**
   * The followed figure's sight (the own hero's, or the spectated teammate's: `f.camera`), as 2D's `LightView` computes it:
   * `hard` blockers, recomputed only when the position, the vision or the map changes.
   */
  private sightFor(f: RunFrame): SightView {
    const vision = Math.round(f.snap?.me.vision ?? 0);
    const key = `${f.camera.x.toFixed(1)},${f.camera.y.toFixed(1)},${vision}`;
    if (key !== this.sightKey) {
      this.sightKey = key;
      this.sight.compute(this.map, f.camera.x, f.camera.y, vision, 'hard');
    }
    return this.sight;
  }

  private overlayCount = 0;

  /** Figures drawn last frame (for `window.__r3d`). */
  get figureCount(): number {
    return this.figures.count;
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

    // The own hero, for `window.__r3d`.
    this.hero.x = f.own.x / TILE;
    this.hero.z = f.own.y / TILE;

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

    this.lastCam = cam;
    this.lastPlan = c.plan;
    this.lastZoom = c.zoom;
    this.lastCanvas = c.canvasEl;
    this.lastSize = c.canvas;
    // One layout read per frame, whatever the number of pointer reads; a resize shows in the next frame's rect.
    this.lastRect = c.canvasEl.getBoundingClientRect();
    // The drawn aim uses this frame's camera: whatever pointerWorld reads must be stored above this line.
    settleOwnAim(f.own, this.pointerWorld());

    const view = this.v;
    if (!view) {
      // The device is being restored: the overlay still paints (from the last frame's anchors), so names do not blink.
      this.drawCalls = 0;
      this.paintOverlay(f, c, cam);
      return this.stats(c, 0);
    }
    const fo = this.figures.frame(f, cam);
    for (const w of fo.floats) this.floats.add(w.x, w.y, w.text, w.color, { kind: w.kind, up: w.up });
    this.seen = seenOpeners(fo.openers, this.sightFor(f), f.dark);
    const dynamic: Dynamic = { cards: quadsOf(fo.cards), ghosts: quadsOf(fo.ghosts), decals: quadsOf(fo.decals), shadows: shadowsOf(fo.shadows), emissive: quadsOf(fo.emissive), glows: glowsOf(fo.glows) };
    c.timer.lap('cards');
    const work = this.woodland || c.params.light === 'work';
    const lights: Light[] = work ? [] : [{ x: cam.x, y: 1.0, z: cam.z, radius: 9, r: 1.0, g: 0.82, b: 0.55, shadow: c.params.shadows, skip: -1 }];
    c.timer.lap('lights');
    c.timer.renderStart();
    this.drawCalls = view.draw(
      { cam, plan: c.plan, dynamic, lights, ambient: work ? WORK_AMBIENT : AMBIENT, lava: null, darkvision: null, casters: [], shadows: c.params.shadows, smooth: c.params.smooth, t: c.now, see: { openers: this.seen, look: seeLook(c.params) } },
      c.timer,
    );
    this.paintOverlay(f, c, cam);
    return this.stats(c, view.meshes);
  }

  /** The overlay over the canvas: bars, names, tags and the use hint, placed from this frame's camera and plan. */
  private paintOverlay(f: RunFrame, c: StageCtx, cam: Cam): void {
    this.floats.update(f.dt);
    this.marks.update(f.dt, this.figures.anchors, f.dark);
    const o = this.overlay;
    if (!o) return;
    o.size(c.canvas.w, c.canvas.h);
    const items: OverlayItem[] = [];
    const i: LayoutIn = {
      ents: f.ents, you: f.you, anchors: this.figures.anchors, heroNames: this.heroNames, useHint: f.useHint, dark: f.dark, zoom: c.zoom,
      at: (x, z) => toCanvas(cam, c.plan, c.zoom, x, 0, z), measure: (t, k) => o.measure(t, k),
    };
    layoutBars(i, items);
    layoutHeroTags(i, items);
    if (this.tagOf) layoutTags(i, this.tagOf, items);
    layoutUseHint(i, items);
    this.marks.layout(i.at, c.zoom, items);
    this.floats.layout(i.at, c.zoom, items);
    this.overlayCount = items.length;
    o.paint(items, c.zoom);
  }

  /** Items the overlay painted last frame (for `window.__r3d`). */
  get overlayItems(): number {
    return this.overlayCount;
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

  event(ev: PictureEv, own: { x: number; y: number }, server: { x: number; y: number } | null = null, dark = false): void {
    this.figures.event(ev);
    // A hit on the own hero is born at the predicted foot (#281).
    this.floats.addPicture(ev, own, server, dark);
  }

  tileChanged(x: number, y: number, _v: number): void {
    this.sightKey = ''; // a door or a wall changed: the sight is recomputed
    this.v?.tileChanged(x, y);
  }

  shotEnded(shot: ShotView, _how: 'wall' | 'enemy' | 'gone'): void {
    this.figures.shotEnded(shot);
  }

  pointerWorld(): { x: number; y: number } | null {
    const { lastCam: cam, lastPlan: plan, lastCanvas: canvas, mouse } = this;
    if (!cam || !plan || !canvas || !mouse) return null;
    const p = mouse.at(canvas, this.lastSize.w, this.lastSize.h, this.lastRect ?? undefined);
    if (!p) return null;
    const g = aimGround(cam, plan, this.lastZoom, p.px, p.py);
    return { x: g.x * TILE, y: g.z * TILE };
  }

  destroy(): void {
    this.v = null;
    this.c = null;
    this.mouse = null;
    this.lastCanvas = null;
    this.lastRect = null;
  }
}
