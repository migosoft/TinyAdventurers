// The stage of the ?r3d=mood page (#307): the dungeon air's demo room, no server, no login.
// It plays the script of game/moodDemoScript.ts: warm wall torches, a lava pool, a water pool with drips, a few still figures,
// a knight who walks a loop round the pillar and dashes every 6 s, an arrow every 3 s and a fireball every 4 s that explodes at the
// east wall. The knight, the arrow and the fireball stir the air. The air is the run's own (`Air3d`, fed as runView3d.ts feeds it);
// its switches (dust, smoke, embers, haze, drips, stir, draft) and `respawn` are the params, the panel shows Stir and Draft.
// The pool's water (#345) is the run's too (`Water3d`, ripples only: the drips that land ring it); `window.__r3d.ripples` is the live count.
// WASD pans a free camera.
import { ANIM, CONST, KIND, LIGHT_KIND, SIDE } from '../generated/defs';
import type { MovingLight } from '../generated/MovingLight';
import { LightField } from '../game/light';
import { DEFAULT_HAZE } from '../game/sightField';
import { MoverTracker } from '../game/airmovers';
import { projectileAir } from '../game/airshots';
import type { AirMover, AirShot } from '../game/airTypes';
import { MOOD_FIGURES, MOOD_TORCHES, MOOD_VIEWER, MOOD_WARM, moodMap, moodScript } from '../game/moodDemoScript';
import { TERRAIN } from '../game/terrain-layers';
import type { EntState } from '../game/world';
import { TILE } from '../sim/map';
import { View as SightView } from '../sim/view';
import { Air3d } from './air/air';
import { atlasBounds } from './atlasBounds';
import { closeCam, freeClamp, keysToWorld } from './camera';
import { glowsOf, quadsOf, shadowsOf, type Dynamic } from './cards';
import { Figures3d } from './figures';
import { galleryFrame, galleryInit } from './galleryStage';
import { MOVE_KEYS, type Host, type Stage, type StageCtx } from './host';
import { parseLights } from './lightsStage';
import { LIGHT_CAP, WORK_AMBIENT, dungeonAmbient, stoneClear } from './light';
import { assignSkips, carrierMap, CASTER_CAP, footprint, lavaTexels, lightView, movingCands, selectCasters, selectLights, staticCands, TorchPairs, torchOf } from './lights';
import { MIST } from './mist';
import { seenOpeners } from './openers';
import { reflects, shimmers, type R3dParams } from './params';
import { Lava3d, type LavaIn } from './lava/lava';
import { rng } from './fx/rand';
import { seeLook } from './seeThrough';
import { SightMask } from './sightmask';
import { SIGHT_OFF } from './sightNodes';
import type { Assets, FrameInput, WorldInput } from './view';
import { stoneField } from './stone/field';
import { makeStoneRun } from './stone/stoneRun';
import { Water3d } from './water/water';

/** The free camera's speed in tiles per second. */
const PAN_SPEED = 12;
/** The seed of the page's lava bubbles. */
const LAVA_SEED = 344;
const KNIGHT_ID = 100;
const ARROW_ID = 101;
const FIRE_ID = 102;
/** Ids of the still figures start here. */
const STILL_ID = 200;
/** The body radius of the walking knight in px, and how far above its feet its centre is. */
const KNIGHT_R = 6;
const KNIGHT_LIFT = 4;

/** The pack frame of a still figure as the entity that draws it; the skull has no entity and stays out of the 3D room. */
const STILL_KIND: Record<string, number | undefined> = {
  elf_f_idle_anim_f0: KIND.ElvenRanger,
  wizzard_m_idle_anim_f0: KIND.Wizard,
  skelet_idle_anim_f0: KIND.SkeletonWarrior,
  chest_full_open_anim_f0: KIND.Chest,
  crate: KIND.Barrel,
};

const ent = (id: number, kind: number, x: number, y: number, o: Partial<EntState> = {}): EntState => ({
  id, kind, x, y, hp: 10, anim: ANIM.Idle, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0,
  side: kind === KIND.Knight || kind === KIND.ElvenRanger || kind === KIND.Wizard ? SIDE.Friendly : SIDE.Neutral, entangled: 0, ...o,
});

/** True when the knight faces west: its last horizontal heading (the straights going north and south keep it). */
function facesWest(t: number): boolean {
  for (let s = t; s > t - 20; s -= 0.1) {
    const dx = moodScript(Math.max(0, s)).walker.dx;
    if (dx !== 0) return dx < 0;
  }
  return false;
}

/** The entities of the stage at time `t` (s): the torches (ids from 1), the knight, the arrow and the fireball in flight, and the still figures. */
export function moodEnts(t: number): EntState[] {
  const out: EntState[] = [];
  let id = 1;
  for (const tc of MOOD_TORCHES) out.push(ent(id++, KIND.Torch, tc.x, tc.y, { extra: tc.side, anim: tc.lit ? 1 : 0 }));
  const st = moodScript(t);
  out.push(ent(KNIGHT_ID, KIND.Knight, st.walker.x, st.walker.y, { anim: ANIM.Move, animMs: t * 1000, aim: facesWest(t) ? Math.PI : 0 }));
  if (st.arrow) out.push(ent(ARROW_ID, KIND.Arrow, st.arrow.x, st.arrow.y, { anim: ANIM.Move, aim: 0 }));
  if (st.fireball) out.push(ent(FIRE_ID, KIND.Fireball, st.fireball.x, st.fireball.y, { anim: ANIM.Move, aim: 0 }));
  let n = STILL_ID;
  for (const f of MOOD_FIGURES) {
    const kind = STILL_KIND[f.frame];
    if (kind !== undefined) out.push(ent(n++, kind, f.x * TILE, f.y * TILE, { aim: f.flip ? Math.PI : 0 }));
  }
  return out;
}

/** The moving lights at time `t`: the fireball's glow in flight, the blast's flash at the east wall. */
export function moodLights(t: number): MovingLight[] {
  const st = moodScript(t);
  const out: MovingLight[] = [];
  if (st.fireball) out.push([st.fireball.x, st.fireball.y, LIGHT_KIND.Fire, 0xff7020]);
  if (st.blast) out.push([st.blast.x, st.blast.y, LIGHT_KIND.Blast, null]);
  return out;
}

const ALL_VISIBLE = { isVisible: (): boolean => true };
const NONE_IDS: ReadonlySet<number> = new Set();
const arrowAir = projectileAir(KIND.Arrow);
const fireAir = projectileAir(KIND.Fireball);

export function createMoodStage(assets: Assets, p: R3dParams, search: string, host?: Pick<Host, 'params' | 'setParams' | 'setAirDev'>): Stage {
  const opts = parseLights(search);
  const map = moodMap();
  const world: WorldInput = { map, painted: false, clear: 'stone', stone: stoneField(map) };
  const stoneRun = makeStoneRun(world, { x: map.w / 2, z: map.h / 2 });
  const figures = new Figures3d({ ...galleryInit(), map }, assets.frames, atlasBounds(assets.image, assets.frames));
  const cam = { x: map.w / 2, z: 9.2, pitch: (p.pitch * Math.PI) / 180, yaw: (p.yaw * Math.PI) / 180 };
  let t = opts.start;
  host?.setAirDev(true);

  const viewer = { x: MOOD_VIEWER.x / TILE, z: MOOD_VIEWER.y / TILE };
  const hardView = new SightView(map.w, map.h);
  hardView.compute(map, MOOD_VIEWER.x, MOOD_VIEWER.y, CONST.FOV_RADIUS, 'hard');
  const mask = new SightMask(map, { daylight: false, feather: 0, ramp: 0 });

  // The field: the warm torches on their tiles, then a light on every lava tile (ids from 1).
  const field = new LightField(map);
  let lightId = 1;
  for (const tc of MOOD_TORCHES) field.add({ id: lightId++, kind: LIGHT_KIND.Torch, colour: MOOD_WARM, x: tc.tx, y: tc.ty, on: true });
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (map.get(x, y) === TERRAIN.Lava) field.add({ id: lightId++, kind: LIGHT_KIND.Lava, colour: 0xff4818, x, y, on: true });
  const pairs = new TorchPairs();
  const lava = new Float32Array(map.w * map.h * 4);
  lavaTexels(field, map, lava);

  const air = new Air3d(map);
  const water = new Water3d(map);
  // The pool's lava (#344): bubbles and rings only, no effects here, so its cues go unused.
  const lava3d = new Lava3d(map, rng(LAVA_SEED));
  const lavaIn: LavaIn = { dt: 0, now: 0, figs: [], hidden: NONE_IDS, fp: { x0: 0, z0: 0, x1: 0, z1: 0 }, mask: null, focus: cam };
  const tracker = new MoverTracker();
  const movers: AirMover[] = [];
  const torches: { x: number; z: number; nx: number; nz: number; lit: boolean; tx: number; tz: number }[] = [];

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;bottom:8px;font:11px monospace;color:#fff;text-shadow:0 0 3px #000;pointer-events:none';
  label.textContent = 'mood demo in 3D: torches, lava, a pool, a walking knight, an arrow and a fireball stir the air; WASD pans';
  document.body.appendChild(label);

  /** The movers of this frame: the knight (a figure), the arrow and the fireball (shots with a wake). */
  const moversOf = (dt: number, st: ReturnType<typeof moodScript>): AirMover[] => {
    movers.length = 0;
    tracker.begin(dt);
    const add = (m: AirMover | null): void => { if (m) movers.push(m); };
    add(tracker.track(1, st.walker.x, st.walker.y - KNIGHT_LIFT, KNIGHT_R, false, 0));
    if (st.arrow) add(tracker.track(2, st.arrow.x, st.arrow.y, arrowAir.r, true, arrowAir.heat));
    if (st.fireball) add(tracker.track(3, st.fireball.x, st.fireball.y, fireAir.r, true, fireAir.heat));
    return movers;
  };
  world.taken = { lights: [...field.lights.values()], spawn: { x: map.w / 2, z: map.h / 2 } };

  return {
    world,
    frame(c: StageCtx): number {
      const dt = c.dt / opts.slow;
      t += dt;
      cam.pitch = (c.params.pitch * Math.PI) / 180;
      cam.yaw = (c.params.yaw * Math.PI) / 180;
      let ix = 0;
      let iz = 0;
      for (const k of c.held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
      if (ix || iz) {
        const w = keysToWorld(cam.yaw, ix, iz);
        const len = Math.hypot(w.x, w.z) || 1;
        const q = freeClamp(map, cam.x + (w.x / len) * PAN_SPEED * c.dt, cam.z + (w.z / len) * PAN_SPEED * c.dt);
        cam.x = q.x;
        cam.z = q.z;
      }
      const ents = moodEnts(t);
      torches.length = 0;
      for (const e of ents) {
        if (e.kind !== KIND.Torch) continue;
        pairs.see(e);
        torches.push({ ...torchOf(e), lit: e.anim === 1 });
      }
      c.timer.lap('sim');
      stoneRun.frame(c.view);
      if (!c.view) return 0; // the air pauses while the view is rebuilt after a device loss
      const game = c.params.light === 'game';
      const ambient = game ? dungeonAmbient(c.params.amb) : WORK_AMBIENT;
      const fo = figures.frame(galleryFrame(ents, t, dt), cam, { ambient, dark: c.params.dark, torchGlow: !game, oval: 1 });
      const dynamic: Dynamic = { cards: quadsOf(fo.cards), ghosts: quadsOf(fo.ghosts), decals: quadsOf(fo.decals), shadows: shadowsOf(fo.shadows), emissive: quadsOf(fo.emissive), glows: glowsOf(fo.glows) };
      c.timer.lap('cards');

      mask.update(hardView, null, 0);
      const fp = footprint(cam, c.plan.halfW, c.plan.halfH);
      const moving = moodLights(t);
      let lights: ReturnType<typeof selectLights>['list'] = [];
      let inView = 0;
      if (game) {
        const cands = [...staticCands(field, pairs, map, t), ...movingCands(moving, [], () => null, t)];
        const sel = selectLights(cands, lightView(fp, cam), viewer, Math.min(LIGHT_CAP, c.params.lcap));
        lights = sel.list;
        inView = sel.inView;
      }
      const casters = game ? selectCasters(fo.casters, lights, Math.min(CASTER_CAP, c.params.ccap)) : [];
      assignSkips(lights, carrierMap(lights), casters);
      c.timer.lap('lights');
      const sight = c.params.sight
        ? { mode: 'dark' as const, mask, clear: stoneClear(ambient), haze: DEFAULT_HAZE, mist: MIST, mistDay: 1, mistLight: [1, 1, 1] as [number, number, number], wind: [0, 0] as [number, number], t: c.now }
        : SIGHT_OFF;
      c.timer.lap('sight');

      // The air, fed as a run feeds it: the torches, the moving lights as shots, the knight, the arrow and the fireball as movers.
      const p2 = c.params;
      const shots: AirShot[] = moving.map(([x, y, kind]) => ({ x, y, kind }));
      const parts = air.step({
        dt, t, fp, mask: p2.sight ? mask : null, torches, shots, movers: moversOf(dt, moodScript(t)), lights, cracks: [],
        on: { dust: p2.dust, smoke: p2.smoke, embers: p2.embers, drips: p2.drips, stir: p2.stir, draft: p2.draft }, respawn: p2.respawn,
        drift: null, kinds: 'dungeon',
      });
      const frameAir: NonNullable<FrameInput['air']> = { parts, haze: { on: p2.haze, t } };
      c.timer.lap('air');
      // The pool's ripples (#345): the drips this air step landed, and the knight if he wades. No effects here, so the cues go unused.
      const wo = water.step({ dt, now: t, figs: fo.figs, sinks: fo.sinks, landed: parts.landed, hidden: NONE_IDS });

      lavaIn.dt = dt; lavaIn.now = t; lavaIn.figs = fo.figs; lavaIn.fp = fp; lavaIn.mask = p2.sight ? mask : null;
      const lo = lava3d.step(lavaIn);

      const r = window.__r3d;
      if (r) {
        r.ripples = wo.live;
        r.figures = figures.count;
        r.lights = { list: lights.length, inView };
        r.casters = casters.length;
      }
      c.timer.renderStart();
      return c.view.draw(
        {
          cam: closeCam(cam, c.zoom), plan: c.plan, dynamic, lights, ambient, shadows: c.params.shadows, smooth: c.params.smooth, t: c.now,
          see: { openers: seenOpeners(fo.openers, ALL_VISIBLE, new Set()), look: seeLook(c.params) },
          lava: game ? lava : null, lavaVersion: 0,
          darkvision: null,
          casters, sight, cracks: [], shafts: c.params.shafts, air: frameAir,
          water: { ripples: wo.ripples, now: t, reflect: reflects(c.params) },
          lavaPool: { bubbles: lo.bubbles, stirs: lo.stirs, now: t, heat: shimmers(c.params) },
        },
        c.timer,
      );
    },
    dispose(): void {
      label.remove();
    },
  };
}
