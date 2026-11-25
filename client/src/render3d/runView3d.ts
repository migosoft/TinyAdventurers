// The 3D view of a run (#302): a `RunView` for the run session. The camera follows the own hero (or the spectated
// teammate) or flies free, the figures and shots are cards (`Figures3d`), and the lights come from the page's parameters. The three.js
// `View` comes and goes (a lost device), so it is attached and detached from outside.
import type { FrameBounds } from '../game/anim/pose';
import { settleOwnAim } from '../run/aim';
import { dir8 } from '../run/input';
import { NO_STATS, type PictureEv, type RunFrame, type RunView, type RunViewInit, type ShotView, type ViewStats } from '../run/view';
import { ART, followClamp, freeClamp, keysToWorld, type Cam } from './camera';
import { RunMouse } from './input';
import { aimGround, toCanvas } from './screen';
import type { Overlay3d } from './overlay';
import type { EntState } from '../game/world';
import { Floats, layoutBars, layoutCones, layoutHeroTags, layoutTags, layoutUseHint, Marks, type LayoutIn, type OverlayItem } from './overlayLayout';
import { emptyGlows, emptyQuads, emptyShadows, fillGlows, fillQuads, fillShadows, type Dynamic } from './cards';
import { View as SightView } from '../sim/view';
import { Figures3d, type FigureOut, type Opener } from './figures';
import { seenOpeners } from './openers';
import { seeLook } from './seeThrough';
import { MOVE_KEYS, type StageCtx } from './host';
import { WORK_AMBIENT, dungeonAmbient, stoneClear, type Light } from './light';
import { MIST } from './mist';
import { WIND, WIND_DIR } from './wind';
import { SightMask, hiddenAt } from './sightmask';
import { hiddenByPicture } from './sightAttrs';
import { SIGHT_OFF, type SightFrame } from './sightNodes';
import { SHOT_LIFT } from './camera';
import { isBossKind, isProjectileKind } from '../game/anim/defs';
import { CONST, KIND, LEAF_PALETTE } from '../generated/defs';
import { DEFAULT_HAZE } from '../game/sightField';
import { Air3d } from './air/air';
import type { AirParts } from './air/airParts';
import { Water3d, type WaterCues, type WaterIn } from './water/water';
import { MoverTracker, collectAirMovers } from '../game/airmovers';
import type { AirMover, AirShot } from '../game/airTypes';
import { CRACK_CAP, crackOf, selectCracks, type Crack } from './air/cracks';
import { sunLook } from '../game/sunmath';
import { assignSkips,footprint, lavaTexels, lightView, movingCands, selectCasters, selectLights, staticCands, torchOf, type Carrier, type ShadowCaster } from './lights';
import { R3D_SYSTEMS, fxLine, lightLines, skyLines, stoneLine, treeLine } from './stats';
import { SkyClock, hourLabel, mistInputs, ovalOf, sky, startHour, sunFrame, type Sky } from './sun';
import { CoverField } from './cover/coverField';
import type { CoverResult } from './cover/coverJob';
import type { BushelSpot } from './cover/source';
import { Forest, TREE_BUDGET_MS } from './trees/forest';
import { treeSpecOf } from './trees/spec';
import { Critters3d } from './critters3d';
import { Fireflies } from './fireflies';
import { Cove3d } from './cove3d';
import type { FrameInput, SunFrame, View } from './view';
import { Effects3d } from './fx/effects3d';
import { FxPass } from './fx/pass';
import { Shake, blastFalloff, groundShift } from './fx/shake';
import { onOwnHero } from '../game/damage';
import type { FrameRects } from './worldMesh';
import { reflects, shimmers } from './params';
import { Lava3d, type LavaCues, type LavaIn } from './lava/lava';

const TILE = 16;
const rad = (deg: number): number => (deg * Math.PI) / 180;
/** The follow camera's ease, per second (#301's factor `1 - exp(-dt * 6)`). */
const FOLLOW_RATE = 6;
/** The free camera's speed in tiles per second, and with Shift. */
const FREE_SPEED = 12;
const FREE_SPEED_FAST = 36;
/** The woodland's pollen drifts with the wind at this speed, tiles per second (first guess). */
export const POLLEN_DRIFT = 0.25;

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

/** A Boom kind's camera shake near the own hero: [ms, intensity]. */
/** Half the screen's width at the default zoom, world px: a blast's shake is gone this far from its edge. */
const SHAKE_RANGE = 320;
const BLAST_SHAKE: Record<number, readonly [number, number]> = { 0: [120, 0.004], 4: [120, 0.004], 7: [120, 0.004], 6: [200, 0.007], 10: [200, 0.007], 5: [140, 0.005] };

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
  /** The frame's quads, grow-only and refilled in place (no new arrays per frame). */
  private readonly dynQ: Dynamic = { cards: emptyQuads(), ghosts: emptyQuads(), decals: emptyQuads(), shadows: emptyShadows(), glows: emptyGlows() };
  // The effects (#308): owned by the run (a lost device keeps them), drawn into these lists every frame, then flushed to the view's two buffers.
  private readonly fx: Effects3d;
  private readonly fxPass: FxPass;
  /** The camera shake of hits and blasts; only the drawn camera is shifted by it. */
  readonly shake = new Shake();
  private readonly shakeAt = { x: 0, y: 0 };
  private readonly shakeGround = { x: 0, z: 0 };
  /** The run clock of the last host frame, seconds (events are stamped with it). */
  private clockNow = 0;
  /** What the camera follows (the own hero, or the watched teammate), simulation px: a blast shakes by its distance from here. */
  private readonly followed: { x: number; y: number } = { x: 0, y: 0 };
  private hasFrame = false;
  // The dungeon air and the woodland's pollen (#307): simulated here, once per run (a lost device keeps it).
  private readonly air: Air3d;
  // The water (#345): ripples and droplet cues, made here like the air so a lost device keeps them. The air steps after the water in a
  // frame, so the drips the water rings for are the ones that landed in the air's last step (null: none, or not stepped).
  private readonly water: Water3d;
  private landed: AirParts['landed'] | null = null;
  /** The input of `water.step`, reused every frame. */
  private readonly waterStepIn: WaterIn = { dt: 0, now: 0, figs: [], sinks: [], landed: null, hidden: new Set() };
  private readonly waterIn:{ ripples: Float32Array | null; now: number; reflect: boolean } = { ripples: null, now: 0, reflect: false };
  // The lava (#344): bubbles, rings and spark cues, made here like the water so a lost device keeps them.
  private readonly lavaSim: Lava3d;
  private readonly lavaStepIn: LavaIn = { dt: 0, now: 0, figs: [], hidden: new Set(), fp: { x0: 0, z0: 0, x1: 0, z1: 0 }, mask: null, focus: { x: 0, z: 0 } };
  private readonly lavaIn: { bubbles: Float32Array | null; stirs: Float32Array | null; now: number; heat: boolean } = { bubbles: null, stirs: null, now: 0, heat: false };
  private readonly moverTracker = new MoverTracker();
  private readonly airMovers: AirMover[] = [];
  private readonly myKind: number;
  private readonly airTorches: { x: number; z: number; nx: number; nz: number; lit: boolean; tx: number; tz: number }[] = [];
  /** The objects behind `airTorches` and `airShots`, kept between frames (the lists are refilled, nothing is allocated per frame). */
  private readonly airTorchPool: { x: number; z: number; nx: number; nz: number; lit: boolean; tx: number; tz: number }[] = [];
  private readonly airShots: AirShot[] = [];
  // The woodland's sky (#306): the hour of day (run seconds, re-anchored by the panel's hour and pace), the plants, and the readout's numbers.
  private clock: SkyClock | null = null;
  private forest: Forest | null = null;
  /** Milliseconds of tree growing per frame; the stage raises it while the loading screen is up (#322). */
  treeBudgetMs = TREE_BUDGET_MS;
  /** False while the loading screen covers a level still being built: the frame steps everything (trees too) but does not draw (#322). */
  drawing = true;
  /** Trees grown of all, 0..1; null without a forest. */
  get treeProgress(): number | null {
    return this.forest ? (this.forest.total ? this.forest.built / this.forest.total : 1) : null;
  }
  /** The stage's stone job progress, for the F3 line (#380); null without stone. */
  stoneProgress: { done: number; total: number } | null = null;
  private critters: Critters3d | null = null;
  private fireflies: Fireflies | null = null;
  // The nymph's cove (dungeon runs): its tufts and ferns as bushel spots, the bushes' casters, the pixies.
  private cove: Cove3d | null = null;
  // The ground cover's heights, once the stage has set a good cover (#330); null before and after a failed one: nothing is lifted.
  private coverField: CoverField | null = null;
  private readonly groundOf = (x: number, z: number, r: number): number => this.coverField!.topAt(x, z, r, this.groundGh);
  private groundGh = 1;
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
      // The trees are grown by `step` a few per frame; the forest outlives a lost device (the view re-reads every chunk).
      this.forest = new Forest(wl.plants.map(treeSpecOf), init.map, wl.palette);
      this.critters = new Critters3d(init.map, wl.seed);
      this.fireflies = new Fireflies(wl.seed);
    }
    if (init.info.cove) {
      if (this.forest) throw new Error('A level has a woodland and a cove: the one forest of a run would hold only one of them.');
      this.cove = new Cove3d(init.info.cove, frames);
      // The cove has no sun: its willow and bushes are grown trees lit by the cove's own lights; the tufts and ferns are bushels of the cover layer.
      this.forest = new Forest([this.cove.tree(), ...this.cove.bushes()], init.map, LEAF_PALETTE.Summer, this.cove.builder());
      this.coveCasters = this.cove.casters();
    }
    this.figures = new Figures3d(init, frames, bounds);
    this.fx = new Effects3d(init.map);
    this.fxPass = new FxPass(this.hidden);
    this.myKind = init.myKind;
    this.air = new Air3d(init.map);
    this.water = new Water3d(init.map);
    this.lavaSim = new Lava3d(init.map, init.lavaRng);
    this.field = init.light;
    this.lava = new Float32Array(init.map.w * init.map.h * 4);
  }

  // The game's lights (#304): the field of the static ones, the torch flames' walls, and the lava texels (refilled when the field changes).
  private readonly field: RunViewInit['light'];
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
   * The followed figure's sight (the own hero's, or the spectated teammate's: `f.camera`), computed from the view's blockers:
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

  /** The cove's bushel spots (tufts and ferns) for the cover sources; none without a cove. */
  bushelSpots(): BushelSpot[] {
    return this.cove ? this.cove.bushelSpots() : [];
  }

  /** The cover the view now draws (null: none, or it failed): from here on what lies flat is lifted onto its top. */
  setCover(r: CoverResult | null): void {
    this.coverField = r ? new CoverField(r) : null;
  }

  /** Records of the effects system alive (for tests and `window.__r3d`). */
  get fxRecords(): number {
    return this.fx.records;
  }

  /** The effects' numbers for the F3 readout and `window.__r3d.fx`: records alive, triangles of the last frame, dropped at the caps since the run began. */
  get fxStat(): { records: number; tris: number; dropped: number } {
    return { records: this.fx.records, tris: this.fxPass.triCount, dropped: this.fxPass.droppedTotal };
  }

  /** The three.js view of the moment (null while it is restored). */
  attach(view: View | null): void {
    this.v = view;
  }

  /** Per host frame, before the session's frame: the frame's context. `fast`: Shift is down (the free camera flies faster). */
  begin(c: StageCtx, fast = false): void {
    this.c = c;
    this.clockNow = c.now;
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
    this.hasFrame = true;
    this.followed.x = f.camera.x;
    this.followed.y = f.camera.y;

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
      this.landed = null; // the air does not step now: its last drips were not rung for, and will not be later
      for (const id of f.dark) this.hidden.add(id); // the picture's own hidden ids stay from the last frame
      this.paintOverlay(f, c, cam);
      return this.stats(c, 0);
    }
    const work = c.params.light === 'work';
    const skyNow = this.woodland ? this.skyOf(f, c) : null;
    const ambient = work ? WORK_AMBIENT : skyNow ? skyNow.ambient : dungeonAmbient(c.params.amb);
    const oval = skyNow && !work ? ovalOf(skyNow) : 1;
    // What lies flat sits on the cover's top while the cover is drawn.
    this.groundGh = c.params.gh;
    const ground = this.coverField && c.params.cover ? this.groundOf : undefined;
    const fo = this.figures.frame(f, cam, { ambient, dark: c.params.dark, oval, ground });
    for (const w of fo.floats) this.floats.add(w.x, w.y, w.text, w.color, { kind: w.kind, up: w.up });
    const fp = footprint(cam, c.plan.halfW, c.plan.halfH);
    if (skyNow && this.critters && this.fireflies) {
      // Bees and butterflies by day, fireflies at night, where the viewer sees (the mask of the last frame: one frame behind is not seen).
      const seenMask = c.params.sight ? this.mask : null;
      this.critters.push(fo.cards, this.frames, cam, c.now, skyNow.day, seenMask, fp, ground);
      this.fireflies.step(c.dt, cam);
      this.fireflies.push(fo.glows, cam, skyNow.night, seenMask);
    }
    // The cove's pixies (glows and wings), where the viewer sees.
    this.cove?.push(c.now, cam, fo.glows, fo.ghosts, c.params.sight ? this.mask : null);
    // The sight and the ids it hides come first (the effects read them); cards and ghosts are copied once for both uses.
    const cardsQ = fillQuads(this.dynQ.cards, fo.cards), ghostsQ = fillQuads(this.dynQ.ghosts, fo.ghosts);
    const sight = this.sightFrame(f, c, ambient, skyNow);
    // The ids over which nothing is drawn: the snapshot's dark ones and what the picture hides (beyond sight, or in a shadow line).
    this.hidden.clear();
    for (const id of f.dark) this.hidden.add(id);
    if (sight.mask) hiddenByPicture([cardsQ, ghostsQ], sight.mask, this.hiddenSeen, this.hidden, fo.models, fo.built);
    // The water (#345): after the figures and the hidden ids, before the effects (they draw its droplets); the drips of the air's last step ring it.
    const ws = this.waterStepIn;
    ws.dt = dt; ws.now = c.now; ws.figs = fo.figs; ws.sinks = fo.sinks; ws.landed = this.landed; ws.hidden = this.hidden;
    ws.puddles = view.stone?.marks.puddles; ws.fp = fp;
    const wo = this.water.step(ws);
    this.landed = null;
    const wi = this.waterIn;
    wi.ripples = wo.ripples; wi.now = c.now; wi.reflect = reflects(c.params);
    // The lava (#344): the same place in the frame; its cues go to the effects, its arrays to the view.
    const ls = this.lavaStepIn;
    ls.dt = dt; ls.now = c.now; ls.figs = fo.figs; ls.hidden = this.hidden; ls.fp = fp; ls.mask = c.params.sight ? this.mask : null;
    ls.focus.x = cam.x; ls.focus.z = cam.z;
    const lo = this.lavaSim.step(ls);
    const li = this.lavaIn;
    li.bubbles = lo.bubbles; li.stirs = lo.stirs; li.now = c.now; li.heat = shimmers(c.params);
    // The effects (#308): their glows join the figures' before the glow quads are copied, their lights the candidates below.
    this.fxFrame(f, c, cam, fo, fp, wo.cues, lo.cues);
    const dq = this.dynQ;
    const dynamic: Dynamic = { cards: cardsQ, ghosts: ghostsQ, decals: fillQuads(dq.decals, fo.decals), shadows: fillShadows(dq.shadows, fo.shadows), glows: fillGlows(dq.glows, fo.glows) };
    c.timer.lap('cards');
    // The trees: a few grown per frame, nearest to the camera first.
    this.forest?.step(cam, this.treeBudgetMs);
    c.timer.lap('plants');
    let lights: ReturnType<typeof selectLights>['list'] = [];
    let casters: ShadowCaster[] = [];
    let lava: Float32Array | null = null;
    let darkvision: { x: number; z: number; reach: number } | null = null;
    let cracks: Crack[] = [];
    this.lightStat = null;
    if (!work) {
      const focus = { x: f.camera.x / TILE, z: f.camera.y / TILE };
      const cands = [
        ...staticCands(this.field, c.now),
        ...movingCands(f.snap?.lights ?? [], f.snap?.ents ?? [], (id) => this.carrier(f, id), c.now),
        ...(this.cove ? this.cove.lights(c.now) : []),
        ...this.fxPass.out.lights,
      ];
      const sel = selectLights(cands, lightView(fp, cam), focus, c.params.lcap);
      lights = sel.list;
      // The cove's bushes cast only where the viewer sees them (the mask of the last frame), so an unseen plant throws no torch shadow onto seen floor.
      const mask = this.mask;
      const cove = this.cove ? (c.params.sight ? this.coveCasters.filter((k) => !hiddenAt(mask, k.x, k.z)) : this.coveCasters) : [];
      casters = selectCasters(cove.length > 0 ? [...fo.casters, ...cove] : fo.casters, lights, c.params.ccap);
      assignSkips(lights, casters);
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
    this.seen = seenOpeners(fo.openers, this.sightFor(f), this.hidden);
    c.timer.lap('sight');
    // The dungeon's sunlight through the ceiling (#307): the Daylight lights the viewer sees now (this frame's mask), as their cracks. A woodland and the work light have none.
    if (!work && !skyNow) cracks = selectCracks(this.field, fp, c.params.sight ? this.mask : null, CRACK_CAP).map((l) => crackOf(l, sunLook, c.now));
    const air = this.airFrame(f, c, fp, lights, cracks, !!skyNow);
    c.timer.lap('air');
    // The sun or moon of the hour (not with the work light), its map fitted to what the camera sees.
    let sun: SunFrame | null = null;
    this.sunPx = 0;
    if (skyNow && !work) {
      sun = sunFrame(skyNow, fp, cam, this.map, c.params, c.now, view.maxTexture);
      this.sunPx = sun.fit.size;
    }
    // The camera shake shifts the drawn camera only: the pointer, the follow camera and the effects keep the steady one.
    this.shake.offset(c.now * 1000, c.canvas.w, c.canvas.h, this.shakeAt);
    let drawCam = cam;
    if (this.shakeAt.x !== 0 || this.shakeAt.y !== 0) {
      groundShift(pitch, yaw, this.shakeAt.x, this.shakeAt.y, ART * c.zoom, this.shakeGround);
      drawCam = { ...cam, x: cam.x + this.shakeGround.x, z: cam.z + this.shakeGround.z };
    }
    if (!this.drawing) {
      this.drawCalls = 0;
      return this.stats(c, view.meshes);
    }
    c.timer.renderStart();
    this.drawCalls = view.draw(
      {
        cam: drawCam, fx: { tris: this.fxPass.blend, lit: this.fxPass.lit, smoke: this.fxPass.smoke }, field: this.fieldIn(c.now), plan: c.plan, dynamic, lights, ambient, lava, lavaVersion: this.lavaVersion, darkvision, casters, shadows: c.params.shadows, smooth: c.params.smooth, t: c.now,
        see: { openers: this.seen, look: seeLook(c.params) }, sight, sun, cracks, shafts: c.params.shafts, air, ...(this.forest ? { trees: this.forest.frame({ wind: c.params.wind, t: c.now }) } : {}), cover: { on: c.params.cover, gh: c.params.gh, wind: c.params.wind, t: c.now }, water: wi, lavaPool: li, wallLights: this.wallLightsIn(c.now),
      },
      c.timer,
    );
    this.paintOverlay(f, c, drawCam);
    return this.stats(c, view.meshes);
  }

  /** The crystals and wall torches of this frame (reused object): a crystal whose light is off is broken (#380), a torch out (#391); a rebuilt view learns it on its first frame. */
  private readonly wallLightFrame = { off: (id: number): boolean => this.field.lights.get(id)?.on === false, now: 0 };
  private wallLightsIn(now: number): { off: (id: number) => boolean; now: number } {
    this.wallLightFrame.now = now;
    return this.wallLightFrame;
  }

  private readonly fieldFrame = { age: 10, t: 0 };
  /** The force field's life of this frame (reused object). */
  private fieldIn(now: number): { age: number; t: number } {
    this.fieldFrame.age = this.fx.fieldAge(now);
    this.fieldFrame.t = now;
    return this.fieldFrame;
  }

  /** The effects of this frame: the glows join the figures' (`fo.glows`), the triangles are sorted into the pass's two buffers, the lights wait in `fxPass.out.lights`. */
  private fxFrame(f: RunFrame, c: StageCtx, cam: Cam, fo: FigureOut, fp: ReturnType<typeof footprint>, water: WaterCues, lava: LavaCues): void {
    this.fxPass.run(this.fx, {
      cam, now: c.now, quality: c.params.quality, figs: fo.figs, ents: f.ents, shots: f.shots, hiddenShots: f.hiddenShots, snap: f.snap, hidden: this.hidden, you: f.you, ownCast: f.ownCast, cues: fo.cues, falls: fo.falls, water, lava, fp, stuck: fo.stuck,
    }, fo.glows);
  }

  /** The air of this frame (#307): the torches, shots and movers of the frame feed the simulation; the haze is for the dungeon only. */
  private airFrame(f: RunFrame, c: StageCtx, fp: ReturnType<typeof footprint>, lights: readonly Light[], cracks: readonly Crack[], pollen: boolean): NonNullable<FrameInput['air']> {
    const torches = this.airTorches;
    torches.length = 0;
    for (const e of f.ents.values()) {
      if (e.kind !== KIND.Torch) continue;
      const t = this.airTorchPool[torches.length] ??= { x: 0, z: 0, nx: 0, nz: 0, lit: false, tx: 0, tz: 0 };
      Object.assign(t, torchOf(e));
      t.lit = e.anim === 1;
      torches.push(t);
    }
    const shots = this.airShots;
    const src = f.snap?.lights ?? [];
    shots.length = src.length;
    for (let i = 0; i < src.length; i++) {
      const s = (shots[i] ??= { x: 0, y: 0, kind: 0 });
      s.x = src[i][0];
      s.y = src[i][1];
      s.kind = src[i][2];
    }
    const p = c.params;
    const parts = this.air.step({
      dt: f.dt, t: c.now, fp, mask: p.sight ? this.mask : null, torches, shots, movers: collectAirMovers(f, this.moverTracker, this.myKind, this.airMovers), lights, cracks,
      on: { dust: p.dust, smoke: p.smoke, embers: p.embers, drips: p.drips, stir: p.stir, draft: p.draft }, respawn: p.respawn,
      drift: pollen ? (p.wind ? [WIND_DIR[0] * POLLEN_DRIFT, WIND_DIR[1] * POLLEN_DRIFT] : [0, 0]) : null, kinds: pollen ? 'pollen' : 'dungeon',
    });
    this.landed = p.drips && !pollen ? parts.landed : null; // the arrays are the air's own: read at the next frame's water step, before the air steps again
    return { parts, haze: { on: p.haze && !pollen, t: c.now } };
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
      ents: f.ents, you: f.you, anchors: this.figures.anchors, heroNames: this.heroNames, useHint: f.useHint, dark: this.hidden, zoom: c.zoom, label: c.labelZoom,
      at: (x, z, y) => toCanvas(cam, c.plan, c.zoom, x, y, z), measure: (t, k) => o.measure(t, k),
      cones: f.cones, showCones: f.showCones,
    };
    layoutCones(i, items); // first: under the bars and names
    layoutBars(i, items);
    layoutHeroTags(i, items);
    if (this.tagOf) layoutTags(i, this.tagOf, items);
    layoutUseHint(i, items);
    this.marks.layout(i.at, c.zoom, c.labelZoom, items);
    this.floats.layout(i.at, c.zoom, c.labelZoom, items, this.figures.anchors);
    this.overlayCount = items.length;
    o.paint(items, c.labelZoom);
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
    const y = e && isProjectileKind(e.kind) ? SHOT_LIFT : a ? a.y + a.height / 2 / TILE : 0.5;
    if (id === f.you) return { id, x: f.own.x / TILE, z: f.own.y / TILE, y };
    if (a) return { id, x: a.x, z: a.z, y };
    return e ? { id, x: e.x / TILE, z: e.y / TILE, y } : null;
  }

  private stats(c: StageCtx, objects: number): ViewStats {
    const ls = this.lightStat;
    const fs = this.fxStat;
    const lines = [
      ...(ls ? lightLines(ls.list, ls.inView, ls.casters, c.params.lcap, c.params.ccap) : []),
      ...(this.forest && this.woodland ? skyLines(hourLabel(this.hourNow), this.sunPx, this.forest.built, this.forest.total) : this.forest ? [treeLine(this.forest.built, this.forest.total)] : []),
      ...(this.stoneProgress ? [stoneLine(this.stoneProgress.done, this.stoneProgress.total)] : []),
      fxLine(fs.records, fs.tris, fs.dropped),
    ];
    return {
      lines: lines.length > 0 ? lines : undefined,
      fps: this.fps,
      wholeMs: c.timer.frameMs,
      renderMs: c.timer.renderMs,
      systems: R3D_SYSTEMS.map((s) => [s, c.timer.systems[s]] as const),
      objects,
      drawCalls: this.drawCalls,
      canvas: { w: c.canvas.w, h: c.canvas.h },
      renderer: { backend: c.backend, w: c.plan.targetW, h: c.plan.targetH, quality: c.params.quality, zoom: c.zoom },
    };
  }

  event(ev: PictureEv, own: { x: number; y: number }, server: { x: number; y: number } | null = null, dark = false): void {
    // A figure lost to a chasm or the deep leaves nothing behind: no burst, no light, no shake.
    if (this.figures.event(ev)) return;
    this.fx.event(ev, this.clockNow, dark);
    // The camera shakes on a hit on the own hero, a barrel's blast, a fire pool next to the own hero.
    if (ev.t === 'Dmg' && !ev.imm && onOwnHero(ev, own)) this.shake.kick(90, 0.003);
    else if (ev.t === 'Boom' && BLAST_SHAKE[ev.k]) {
      // Full where the blast reaches the followed hero, none beyond SHAKE_RANGE from its edge.
      const at = this.hasFrame ? this.followed : own;
      const near = blastFalloff(Math.max(0, Math.hypot(ev.x - at.x, ev.y - at.y) - ev.r), SHAKE_RANGE);
      if (near > 0) this.shake.kick(BLAST_SHAKE[ev.k][0], BLAST_SHAKE[ev.k][1] * near);
    }
    else if (ev.t === 'Died' && isBossKind(ev.kind)) this.shake.kick(120, 0.004);
    else if (ev.t === 'Boom' && ev.k === 11 && Math.hypot(ev.x - own.x, ev.y - own.y) < CONST.PLAYER_RADIUS * 2) this.shake.kick(100, 0.003);
    // A hit on the own hero is born at the predicted foot (#281).
    this.floats.addPicture(ev, own, server, dark);
  }

  tileChanged(x: number, y: number, _v: number): void {
    this.air.mapChanged();
    this.lavaSim.mapChanged();
    this.sightKey = ''; // a door or a wall changed: the sight is recomputed
    this.mapVersion++;
    this.softDirty = true;
    this.fx.tileChanged(x, y, _v, this.clockNow);
    this.v?.tileChanged(x, y);
  }

  shotEnded(shot: ShotView, how: 'wall' | 'enemy' | 'gone' | 'landed'): void {
    this.figures.shotEnded(shot, how);
    this.fx.shotEnded(shot, how, this.clockNow);
  }

  pointerWorld(ground = false): { x: number; y: number } | null {
    const { lastCam: cam, lastPlan: plan, lastCanvas: canvas, mouse } = this;
    if (!cam || !plan || !canvas || !mouse) return null;
    const p = mouse.at(canvas, this.lastSize.w, this.lastSize.h, this.lastRect ?? undefined);
    if (!p) return null;
    const g = aimGround(cam, plan, this.lastZoom, p.px, p.py, ground ? 0 : undefined);
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
