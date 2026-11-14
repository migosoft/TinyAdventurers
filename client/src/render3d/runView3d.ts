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
import { WORK_AMBIENT, dungeonAmbient, stoneClear } from './light';
import { MIST } from './mist';
import { WIND } from './wind';
import { SightMask, hiddenAt } from './sightmask';
import { hiddenByPicture } from './sightAttrs';
import { SIGHT_OFF, type SightFrame } from './sightNodes';
import { SHOT_LIFT } from './camera';
import { isProjectileKind } from '../game/anim/defs';
import { CONST, KIND } from '../generated/defs';
import { DEFAULT_HAZE } from '../game/sightField';
import { assignSkips, carrierMap, footprint, lavaTexels, movingCands, selectCasters, selectLights, staticCands, TorchPairs, type Carrier, type ShadowCaster } from './lights';
import { R3D_SYSTEMS, lightLines, skyLines } from './stats';
import { SkyClock, hourLabel, mistInputs, ovalOf, sky, startHour, sunFrame, type Sky } from './sun';
import { PLANT_BUDGET_MS, PlantField } from './plantField';
import { Critters3d } from './critters3d';
import { Fireflies } from './fireflies';
import { Cove3d } from './cove3d';
import { lightVector } from '../game/vegetation';
import type { SunFrame, View } from './view';
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
  // The woodland's sky (#306): the hour of day (run seconds, re-anchored by the panel's hour and pace), the plants, and the readout's numbers.
  private clock: SkyClock | null = null;
  private plants: PlantField | null = null;
  private critters: Critters3d | null = null;
  private fireflies: Fireflies | null = null;
  // The nymph's cove (dungeon runs): its plants as atlas sprites (all ready at once), their casters, the pixies.
  private cove: Cove3d | null = null;
  private covePlants: PlantField | null = null;
  private coveCasters: ShadowCaster[] = [];
  private readonly frames: FrameRects;
  private hourNow = 0;
  private sunPx = 0;

  private readonly heroNames = new Map<number, string>();
  private readonly floats = new Floats();
  private readonly marks = new Marks();

  /** `overlay`: the layer over the canvas (the stage's; tests pass none). */
  constructor(init: RunViewInit, frames: FrameRects, bounds: (frame: string) => FrameBounds, private readonly overlay: Overlay3d | null = null) {
    this.map = init.map;
    this.frames = frames;
    for (const p of init.info.players) this.heroNames.set(p.ent, p.name);
    this.sight = new SightView(init.map.w, init.map.h);
    this.allSight = new SightView(init.map.w, init.map.h);
    this.daylight = init.info.daylight;
    this.mask = new SightMask(init.map, this.daylight ? { daylight: true, feather: DEFAULT_HAZE.feather, ramp: DEFAULT_HAZE.ramp } : { daylight: false, feather: 0, ramp: 0 });
    this.softTiles = this.countSoft();
    this.frameOut = {
      mode: this.daylight ? 'mist' : 'dark',
      mask: null,
      clear: this.daylight ? [0, 0, 0] : stoneClear([0, 0, 0]),
      haze: DEFAULT_HAZE,
      mist: { ...MIST },
      mistDay: 1,
      mistLight: [1, 1, 1],
      wind: WIND,
      t: 0,
    };
    const wl = init.info.woodland;
    this.woodland = !!wl;
    if (wl) {
      this.clock = new SkyClock(startHour(wl.sun));
      // The plants are drawn by `step` a few per frame, baked with the level's sun; the field outlives a lost device (the view re-reads every chunk).
      this.plants = new PlantField(wl.plants, init.map, lightVector(wl.sun));
      this.critters = new Critters3d(init.map, wl.seed);
      this.fireflies = new Fireflies(wl.seed);
    }
    if (init.info.cove) {
      this.cove = new Cove3d(init.info.cove, frames);
      this.covePlants = PlantField.fromAtlas(this.cove.plants(), init.map);
      this.coveCasters = this.cove.casters();
    }
    this.figures = new Figures3d(init, frames, bounds);
    this.field = init.light;
    this.lava = new Float32Array(init.map.w * init.map.h * 4);
  }

  // The game's lights (#304): the field of the static ones, the torch flames' walls, and the lava texels (refilled when the field changes).
  private readonly field: RunViewInit['light'];
  private readonly pairs = new TorchPairs();
  private readonly lava: Float32Array;
  private lavaSeen = -1;
  private lavaVersion = 0;
  /** The lights and casters of the last frame, for the readout and `window.__r3d`: the list, all that reach the screen, the casters. */
  lightStat: { list: number; inView: number; casters: number } | null = null;

  /** What may open walls this frame and stands where the followed hero sees (for the wall openings, #303 Task 8). */
  seen: Opener[] = [];
  // The sight mask (#305). `sight` (hard blockers) and `allSight` (every blocker, only while the map has trunks or thickets) are
  // the same two objects for the whole run, so the mask's version keys (`hard.version`, `all.version`) only ever grow and a
  // replaced view can never match the last fill by coincidence; `mapVersion` is bumped by every `tileChanged`.
  private readonly sight: SightView;
  private readonly allSight: SightView;
  private readonly mask: SightMask;
  private readonly daylight: boolean;
  private sightKey = '';
  private mapVersion = 0;
  /** Whether the map has a soft tile (a trunk or a thicket); recounted in the frame after a tile changed. */
  private softTiles: boolean;
  private softDirty = false;

  private countSoft(): boolean {
    const m = this.map;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.opaque(x, y) && !m.hardOpaque(x, y)) return true;
    return false;
  }

  /**
   * The followed figure's sight (the own hero's, or the spectated teammate's: `f.camera`), as 2D's `LightView` computes it:
   * `hard` blockers, recomputed only when the position, the vision or the map changes.
   */
  private sightFor(f: RunFrame): SightView {
    if (this.softDirty) {
      this.softDirty = false;
      this.softTiles = this.countSoft(); // a tile changed: the views below are recomputed (tileChanged cleared the key) with the right set
    }
    const vision = Math.round(f.snap?.me.vision ?? CONST.FOV_RADIUS);
    const key = `${f.camera.x.toFixed(1)},${f.camera.y.toFixed(1)},${vision}`;
    if (key !== this.sightKey) {
      this.sightKey = key;
      this.sight.compute(this.map, f.camera.x, f.camera.y, vision, 'hard');
      // the `all` view of the same key, only while there is something soft to see through
      if (this.softTiles) this.allSight.compute(this.map, f.camera.x, f.camera.y, vision, 'all');
    }
    return this.sight;
  }

  /** The sky of this frame: the clock's hour at the run's seconds (none before a snapshot: the start hour). A new panel hour re-anchors there, a new pace continues from the hour reached. */
  private skyOf(f: RunFrame, c: StageCtx): Sky {
    this.hourNow = this.clock!.hour(c.params, f.snap ? f.snap.tick / CONST.TICK_HZ : null);
    return sky(this.hourNow);
  }

  /** The sight step of this frame for the view: the mask is refilled when the views or the map changed (booked under `sight`). `skyNow`: the woodland's sky, which drives the mist. */
  private sightFrame(f: RunFrame, c: StageCtx, ambient: [number, number, number], skyNow: Sky | null): SightFrame {
    const hard = this.sightFor(f);
    if (!c.params.sight) return SIGHT_OFF;
    this.mask.update(hard, this.softTiles ? this.allSight : null, this.mapVersion);
    const p = c.params;
    // One frame object for the whole run, updated in place (nothing is allocated per frame once it exists).
    const s = this.frameOut;
    s.mask = this.mask;
    s.mist.high = p.mistHigh;
    s.mist.top = p.mistTop;
    s.mist.drift = p.mistDrift;
    if (skyNow) Object.assign(s, mistInputs(skyNow, p.wind));
    else s.mistDay = p.mistDay;
    s.t = c.now; // the clouds' clock too, so mist and cloud shadows drift together
    if (!this.daylight && (ambient[0] !== this.clearFor[0] || ambient[1] !== this.clearFor[1] || ambient[2] !== this.clearFor[2])) {
      this.clearFor = [ambient[0], ambient[1], ambient[2]];
      s.clear = stoneClear(ambient);
    }
    return s;
  }

  /** The ids nothing is drawn over this frame: `f.dark` plus the things the picture hides (reused every frame). */
  private readonly hidden = new Set<number>();
  private readonly hiddenSeen = new Set<number>();
  private readonly frameOut: SightFrame;
  /** The ambient `frameOut.clear` was made for. */
  private clearFor: [number, number, number] = [0, 0, 0];

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
      for (const id of f.dark) this.hidden.add(id); // the picture's own hidden ids stay from the last frame
      this.paintOverlay(f, c, cam);
      return this.stats(c, 0);
    }
    const work = c.params.light === 'work';
    const skyNow = this.woodland ? this.skyOf(f, c) : null;
    const ambient = work ? WORK_AMBIENT : skyNow ? skyNow.ambient : dungeonAmbient(c.params.amb);
    const oval = skyNow && !work ? ovalOf(skyNow) : 1;
    const fo = this.figures.frame(f, cam, { ambient, dark: c.params.dark, torchGlow: work, oval });
    for (const w of fo.floats) this.floats.add(w.x, w.y, w.text, w.color, { kind: w.kind, up: w.up });
    const fp = footprint(cam, c.plan.halfW, c.plan.halfH);
    if (skyNow && this.critters && this.fireflies) {
      // Bees and butterflies by day, fireflies at night, where the viewer sees (the mask of the last frame: one frame behind is not seen).
      const seenMask = c.params.sight ? this.mask : null;
      this.critters.push(fo.cards, this.frames, cam, c.now, skyNow.day, seenMask, fp);
      this.fireflies.step(c.dt, cam);
      this.fireflies.push(fo.glows, cam, skyNow.night, seenMask);
    }
    // The cove's pixies (glows and wings), where the viewer sees.
    this.cove?.push(c.now, cam, fo.glows, fo.ghosts, c.params.sight ? this.mask : null);
    const dynamic: Dynamic = { cards: quadsOf(fo.cards), ghosts: quadsOf(fo.ghosts), decals: quadsOf(fo.decals), shadows: shadowsOf(fo.shadows), emissive: quadsOf(fo.emissive), glows: glowsOf(fo.glows) };
    c.timer.lap('cards');
    // The plants: a few drawn per frame, nearest to the camera first.
    this.plants?.step(cam, PLANT_BUDGET_MS);
    c.timer.lap('plants');
    let lights: ReturnType<typeof selectLights>['list'] = [];
    let casters: ShadowCaster[] = [];
    let lava: Float32Array | null = null;
    let darkvision: { x: number; z: number; reach: number } | null = null;
    this.lightStat = null;
    if (!work) {
      const focus = { x: f.camera.x / TILE, z: f.camera.y / TILE };
      for (const e of f.ents.values()) if (e.kind === KIND.Torch) this.pairs.see(e);
      const cands = [
        ...staticCands(this.field, this.pairs, this.map, c.now),
        ...movingCands(f.snap?.lights ?? [], f.snap?.ents ?? [], (id) => this.carrier(f, id), c.now),
        ...(this.cove ? this.cove.lights(c.now) : []),
      ];
      const sel = selectLights(cands, fp, focus, c.params.lcap);
      lights = sel.list;
      // The cove's plants cast only where the viewer sees them (the mask of the last frame), so an unseen plant throws no torch shadow onto seen floor.
      const mask = this.mask;
      const cove = this.cove ? (c.params.sight ? this.coveCasters.filter((k) => !hiddenAt(mask, k.x, k.z)) : this.coveCasters) : [];
      casters = selectCasters(cove.length > 0 ? [...fo.casters, ...cove] : fo.casters, lights, c.params.ccap);
      assignSkips(lights, carrierMap(lights), casters);
      if (this.field.version !== this.lavaSeen) {
        this.lavaSeen = this.field.version;
        lavaTexels(this.field, this.map, this.lava);
        this.lavaVersion++;
      }
      lava = this.lava;
      const me = f.snap?.me;
      if (me && me.darkvision > 0) darkvision = { x: focus.x, z: focus.z, reach: (me.darkvision / 100) * me.vision };
      this.lightStat = { list: lights.length, inView: sel.inView, casters: casters.length };
    }
    c.timer.lap('lights');
    const sight = this.sightFrame(f, c, ambient, skyNow);
    // The ids over which nothing is drawn: the snapshot's dark ones and what the picture hides (beyond sight, or in a shadow line).
    this.hidden.clear();
    for (const id of f.dark) this.hidden.add(id);
    if (sight.mask) hiddenByPicture([dynamic.cards, dynamic.ghosts], sight.mask, this.hiddenSeen, this.hidden);
    this.seen = seenOpeners(fo.openers, this.sightFor(f), this.hidden);
    c.timer.lap('sight');
    // The sun or moon of the hour (not with the work light), its map fitted to what the camera sees.
    let sun: SunFrame | null = null;
    this.sunPx = 0;
    if (skyNow && !work) {
      sun = sunFrame(skyNow, fp, cam, this.map, c.params, c.now, view.maxTexture);
      this.sunPx = sun.fit.size;
    }
    c.timer.renderStart();
    this.drawCalls = view.draw(
      {
        cam, plan: c.plan, dynamic, lights, ambient, lava, lavaVersion: this.lavaVersion, darkvision, casters, shadows: c.params.shadows, smooth: c.params.smooth, t: c.now,
        see: { openers: this.seen, look: seeLook(c.params) }, sight, sun, ...(this.plants ? { plants: this.plants.frame(c.params.wind, c.now) } : this.covePlants ? { plants: this.covePlants.frame(c.params.wind, c.now) } : {}),
      },
      c.timer,
    );
    this.paintOverlay(f, c, cam);
    return this.stats(c, view.meshes);
  }

  /** The overlay over the canvas: bars, names, tags and the use hint, placed from this frame's camera and plan. */
  private paintOverlay(f: RunFrame, c: StageCtx, cam: Cam): void {
    this.floats.update(f.dt);
    this.marks.update(f.dt, this.figures.anchors, this.hidden);
    const o = this.overlay;
    if (!o) return;
    o.size(c.canvas.w, c.canvas.h);
    const items: OverlayItem[] = [];
    const i: LayoutIn = {
      ents: f.ents, you: f.you, anchors: this.figures.anchors, heroNames: this.heroNames, useHint: f.useHint, dark: this.hidden, zoom: c.zoom,
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

  /** Where the figure of entity `id` is drawn this frame (tiles) and the height of its card's centre: the own hero from `f.own`, else its anchor or the interpolated entity. */
  private carrier(f: RunFrame, id: number): Carrier | null {
    const a = this.figures.anchors.get(id);
    const e = f.ents.get(id);
    // 0.5 tile: mid-body of a figure without an anchor yet (the first frame of an entity).
    const y = e && isProjectileKind(e.kind) ? SHOT_LIFT : a ? a.height / 2 / TILE : 0.5;
    if (id === f.you) return { id, x: f.own.x / TILE, z: f.own.y / TILE, y };
    if (a) return { id, x: a.x, z: a.z, y };
    return e ? { id, x: e.x / TILE, z: e.y / TILE, y } : null;
  }

  private stats(c: StageCtx, objects: number): ViewStats {
    const ls = this.lightStat;
    const lines = [
      ...(ls ? lightLines(ls.list, ls.inView, ls.casters, c.params.lcap, c.params.ccap) : []),
      ...(this.plants ? skyLines(hourLabel(this.hourNow), this.sunPx, this.plants.drawn, this.plants.total) : []),
    ];
    return {
      lines: lines.length > 0 ? lines : undefined,
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
    this.mapVersion++;
    this.softDirty = true;
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
