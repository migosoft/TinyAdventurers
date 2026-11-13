// The stage of the ?r3d=woodland page (#306): the woodland's light in the 3D view, no server, no login. A forest road with a forest edge
// north of it, the ground painted as in a run, a knight to walk with WASD, a few standing figures and a fireball circling, under the
// sun and sky of the time of day (sun.ts): `?hour=` picks the hour, `?hourRate=` the pace (0 stops time),
// `?wind=0` and `?clouds=0` switch those off. The daylight mist's sight mask runs around the knight as in a run.
import { ANIM, CONST, KIND, LIGHT_KIND, SIDE } from '../generated/defs';
import { DEFAULT_HAZE } from '../game/sightField';
import type { MovingLight } from '../generated/MovingLight';
import type { EntState } from '../game/world';
import { View as SightView } from '../sim/view';
import { atlasBounds } from './atlasBounds';
import { keysToWorld } from './camera';
import { glowsOf, quadsOf, shadowsOf, type Dynamic } from './cards';
import { Figures3d } from './figures';
import { galleryFrame, galleryInit } from './galleryStage';
import { groundJob, type GroundJob } from './groundJob';
import { MOVE_KEYS, type Host, type Stage, type StageCtx } from './host';
import { LIGHT_CAP, WOODLAND_CLEAR, WORK_AMBIENT } from './light';
import { assignSkips, carrierMap, CASTER_CAP, footprint, movingCands, selectCasters, selectLights } from './lights';
import { MIST } from './mist';
import { seenOpeners } from './openers';
import { DEFAULT_HOUR, type R3dParams } from './params';
import { seeLook } from './seeThrough';
import { SightMask } from './sightmask';
import { SIGHT_OFF, type SightFrame } from './sightNodes';
import { HourClock, SUN_MAP, fitSunMap, hourLabel, mistLightOf, sky, sunView } from './sun';
import type { Assets, SunFrame, View, WorldInput } from './view';
import { WIND } from './wind';
import { KNIGHT_START, woodlandStageMap } from './woodlandMap';

const TILE = 16;
const KNIGHT_ID = 100;
/** The knight's speed in tiles per second. */
const KNIGHT_SPEED = 4;
/** The seed of the ground's paint: fixed, so the page looks the same every time. */
const GROUND_SEED = 306;
const FIREBALL_COLOUR = 0xff7020;
/** The fireball's circle: its centre (tiles), radius (tiles) and period (s). */
const FIRE = { x: 20, z: 11, r: 6, period: 8 } as const;
const ALL_VISIBLE = { isVisible: (): boolean => true };

const ent = (id: number, kind: number, x: number, z: number, o: Partial<EntState> = {}): EntState => ({
  id, kind, x: x * TILE, y: z * TILE, hp: 10, anim: ANIM.Idle, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0,
  side: SIDE.Friendly, entangled: 0, ...o,
});

/** The figures that stand about: [kind, x, z] in tiles. */
const STANDING: [number, number, number][] = [[KIND.Wizard, 17, 12], [KIND.Paladin, 23, 12.5], [KIND.Barbarian, 14, 18], [KIND.ElvenRanger, 26, 18.5]];

/** The fireball at stage time `t` (s): one moving light on a circle. */
export function fireballAt(t: number): MovingLight {
  const a = (t / FIRE.period) * 2 * Math.PI;
  return [(FIRE.x + FIRE.r * Math.cos(a)) * TILE, (FIRE.z + FIRE.r * Math.sin(a)) * TILE, LIGHT_KIND.Fire, FIREBALL_COLOUR];
}

export function createWoodlandStage(assets: Assets, p: R3dParams, search: string, host?: Pick<Host, 'setDaylight' | 'setSky'>): Stage {
  void search;
  const map = woodlandStageMap();
  const world: WorldInput = { map, painted: true, clear: WOODLAND_CLEAR };
  const figures = new Figures3d({ ...galleryInit(), map }, assets.frames, atlasBounds(assets.image, assets.frames));
  host?.setDaylight(true);
  host?.setSky(true);

  const knight: { x: number; z: number; aim: number; moving: boolean } = { x: KNIGHT_START.x, z: KNIGHT_START.z, aim: 0, moving: false };
  const cam = { x: knight.x, z: knight.z, pitch: (p.pitch * Math.PI) / 180, yaw: (p.yaw * Math.PI) / 180 };

  // The sight: the daylight mist around the knight, with the `hard` and the `all` views as the run computes them.
  const hardView = new SightView(map.w, map.h);
  const allView = new SightView(map.w, map.h);
  const mask = new SightMask(map, { daylight: true, feather: DEFAULT_HAZE.feather, ramp: DEFAULT_HAZE.ramp });
  let sightKey = '';
  const sightFrame: SightFrame = {
    mode: 'mist', mask: null, clear: [0, 0, 0], haze: DEFAULT_HAZE, mist: { ...MIST }, mistDay: 1, mistLight: [1, 1, 1], wind: WIND, t: 0,
  };

  // The ground is painted whole at the first build and kept for the rebuilds after a lost device.
  let job: GroundJob | null = null;
  const paint = (): GroundJob => {
    if (!job) {
      job = groundJob(map, GROUND_SEED, KNIGHT_START.z);
      job.step(Infinity);
    }
    return job;
  };

  // The clock: stage seconds, anchored again when the URL's hour or the pace changes.
  const clock = new HourClock(p.hour ?? DEFAULT_HOUR);
  let seconds = 0;
  let seenHour = p.hour;
  let seenRate = p.hourRate;

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;bottom:8px;font:11px monospace;color:#fff;text-shadow:0 0 3px #000;pointer-events:none';
  document.body.appendChild(label);
  let shown = '';
  const caption = (hour: number): void => {
    const text = `woodland in 3D: ${hourLabel(hour)}; WASD walks`;
    if (text === shown) return;
    shown = text;
    label.textContent = text;
  };

  /** Moves the knight by `d` tiles along the world direction (wx, wz), one axis at a time so it slides along what blocks. */
  const walk = (wx: number, wz: number, d: number): void => {
    const len = Math.hypot(wx, wz) || 1;
    const nx = knight.x + (wx / len) * d;
    if (!map.blocks(Math.floor(nx), Math.floor(knight.z), 'hero')) knight.x = nx;
    const nz = knight.z + (wz / len) * d;
    if (!map.blocks(Math.floor(knight.x), Math.floor(nz), 'hero')) knight.z = nz;
  };

  return {
    world,
    built(view: View): void {
      view.setGround(paint().image());
    },
    frame(c: StageCtx): number {
      const params = c.params;
      seconds += c.dt;
      cam.pitch = (params.pitch * Math.PI) / 180;
      cam.yaw = (params.yaw * Math.PI) / 180;
      // The hour: a new URL/panel hour re-anchors there; a new pace continues from the hour reached so far.
      if (params.hour !== seenHour && params.hour !== null) clock.anchor(params.hour, seconds);
      else if (params.hourRate !== seenRate) clock.anchor(clock.hourAt(seconds, seenRate), seconds);
      seenHour = params.hour;
      seenRate = params.hourRate;
      const hour = clock.hourAt(seconds, params.hourRate);
      const s = sky(hour);
      caption(hour);

      let ix = 0;
      let iz = 0;
      for (const k of c.held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
      knight.moving = ix !== 0 || iz !== 0;
      if (knight.moving) {
        const w = keysToWorld(cam.yaw, ix, iz);
        walk(w.x, w.z, KNIGHT_SPEED * c.dt);
        if (w.x !== 0) knight.aim = w.x < 0 ? Math.PI : 0;
      }
      cam.x = knight.x;
      cam.z = knight.z;
      const ents: EntState[] = [ent(KNIGHT_ID, KIND.Knight, knight.x, knight.z, { anim: knight.moving ? ANIM.Move : ANIM.Idle, animMs: c.now * 1000, aim: knight.aim })];
      STANDING.forEach(([kind, x, z], i) => ents.push(ent(KNIGHT_ID + 1 + i, kind, x, z, { animMs: c.now * 1000 })));
      c.timer.lap('sim');
      if (!c.view) return 0;

      const game = params.light === 'game';
      const ambient = game ? s.ambient : WORK_AMBIENT;
      const fo = figures.frame(galleryFrame(ents, c.now, c.dt), cam, { ambient, dark: params.dark, torchGlow: !game });
      const dynamic: Dynamic = { cards: quadsOf(fo.cards), ghosts: quadsOf(fo.ghosts), decals: quadsOf(fo.decals), shadows: shadowsOf(fo.shadows), emissive: quadsOf(fo.emissive), glows: glowsOf(fo.glows) };
      c.timer.lap('cards');

      const viewer = { x: knight.x, z: knight.z };
      const fp = footprint(cam, c.plan.halfW, c.plan.halfH);
      let lights: ReturnType<typeof selectLights>['list'] = [];
      let inView = 0;
      if (game) {
        const sel = selectLights(movingCands([fireballAt(seconds)], [], () => null, seconds), fp, viewer, Math.min(LIGHT_CAP, params.lcap));
        lights = sel.list;
        inView = sel.inView;
      }
      const casters = game ? selectCasters(fo.casters, lights, Math.min(CASTER_CAP, params.ccap)) : [];
      assignSkips(lights, carrierMap(lights), casters);
      c.timer.lap('lights');

      let sight: SightFrame = SIGHT_OFF;
      if (params.sight) {
        const key = `${knight.x.toFixed(1)},${knight.z.toFixed(1)}`;
        if (key !== sightKey) {
          sightKey = key;
          hardView.compute(map, knight.x * TILE, knight.z * TILE, CONST.FOV_RADIUS, 'hard');
          allView.compute(map, knight.x * TILE, knight.z * TILE, CONST.FOV_RADIUS, 'all');
        }
        mask.update(hardView, allView, 0);
        const wind: [number, number] = params.wind ? WIND : [0, 0];
        sightFrame.mask = mask;
        sightFrame.mist.high = params.mistHigh;
        sightFrame.mist.top = params.mistTop;
        sightFrame.mist.drift = params.mistDrift;
        sightFrame.mistDay = s.day;
        sightFrame.mistLight = mistLightOf(s);
        sightFrame.wind = wind;
        sightFrame.t = c.now;
        sight = sightFrame;
      }
      c.timer.lap('sight');

      const sun: SunFrame = {
        dir: s.dir, colour: s.colour,
        fit: fitSunMap(s.dir, sunView(fp, cam), map, SUN_MAP[params.quality]),
        shadows: params.shadows, clouds: params.clouds, wind: params.wind ? WIND : [0, 0], t: seconds,
      };
      const r = window.__r3d;
      if (r) {
        r.figures = figures.count;
        r.lights = { list: lights.length, inView };
        r.casters = casters.length;
      }
      c.timer.renderStart();
      return c.view.draw(
        {
          cam, plan: c.plan, dynamic, lights, ambient, shadows: params.shadows, smooth: params.smooth, t: c.now,
          see: { openers: seenOpeners(fo.openers, ALL_VISIBLE, new Set()), look: seeLook(params) },
          lava: null, lavaVersion: 0, darkvision: null, casters, sight, sun,
        },
        c.timer,
      );
    },
    dispose(): void {
      label.remove();
    },
  };
}
