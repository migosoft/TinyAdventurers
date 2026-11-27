// The stage of the ?r3d=lich page (#358): the built lich on the game's own code, no server. A boss hall of 26 x 20 tiles with four wall
// torches (on two pillars) and a patch of shallow water, the Knight (WASD) as an ordinary entity, and the lich an entity of `KIND.Lich` whose state is
// what a run would send (`lichAct`, lichScript.ts). It draws through `Figures3d` (the figure pass, the kit's picture), `Effects3d` and
// `FxPass` (their lights join the torches') and `view.draw` with `built`, as a run does: the hall's torches light the lich.
// Query: `&act=` (stand, glide, nova, raise, bolts, curse, mist, gaze, hurt, broken), `&at=<s>` (pins the act's clock, game seconds of
// its loop), `&glide=1`, `&face=<deg>` (a fixed aim), `&t=<s>` (pins the page's clock: the stage steps to it from rest in steps of 1/30 s,
// then holds still), `&zoom=`, `&light=work`, `&fx=frozen|chilled|stone|immune`, `&px=&pz=` (the lich's place, tiles), `&lich=0` (no lich,
// for the cost). Readouts: `window.__r3d.built` (built instances of the last frame) and `window.__r3d.lichMs` (the mean of
// `Figures3d.frame` in ms: seeded with the first sample after 30 frames of warm-up, exponential afterwards). `&at=` without `&t=` pins the page at 3 s.
//
// The hall itself (its map, torches, knight, frame loop and pinned replay) is `createHallStage`, which the demon's page shares (#379).
import { ANIM, EFFECT, FLAG, KIND, LIGHT_KIND, SIDE, TILE_ID } from '../generated/defs';
import type { Snapshot } from '../generated/Snapshot';
import { LightField } from '../game/light';
import { TERRAIN } from '../game/terrain-layers';
import type { EntState } from '../game/world';
import { snap } from '../run/testing';
import { TILE } from '../sim/map';
import { atlasBounds } from './atlasBounds';
import { builtOf } from './built';
import { closeCam, keysToWorld } from './camera';
import { glowsOf, quadsOf, shadowsOf, type Dynamic } from './cards';
import { Effects3d } from './fx/effects3d';
import { FxPass } from './fx/pass';
import { rng } from './fx/rand';
import { fxEnt } from './fxStage';
import { Figures3d, type FigureOut } from './figures';
import { galleryFrame, galleryInit } from './galleryStage';
import { MOVE_KEYS, type Host, type Stage, type StageCtx } from './host';
import { parseMap } from './demoMap';
import { LAVA_SEED, Lava3d, type LavaIn } from './lava/lava';
import { LIGHT_CAP, WORK_AMBIENT, dungeonAmbient } from './light';
import { assignSkips,CASTER_CAP, footprint, lavaTexels, lightView, selectCasters, selectLights, staticCands, type Cand } from './lights';
import { actPeriod, LICH_ACTS, lichAct, type LichAct } from './lichScript';
import { seenOpeners } from './openers';
import type { PageButton } from './panel';
import { reflects, shimmers, type R3dParams } from './params';
import { seeLook } from './seeThrough';
import { SIGHT_OFF } from './sightNodes';
import { createStageKit, modelsReadouter } from './stageKit';
import type { Assets, WorldInput } from './view';
import { stoneField } from './stone/field';
import { makeStoneRun } from './stone/stoneRun';
import { Water3d } from './water/water';

/** The hall (tiles), the wall around it, and the lich's and the knight's speed (tiles/s) and the pause of the glide at a corner (s). */
export const HALL_W = 26, HALL_H = 20, WALL = 2;
/** The hall's middle (tiles). */
export const HALL_CENTRE = { x: WALL + HALL_W / 2, z: WALL + HALL_H / 2 } as const;
const SPEED = 2.2, PAUSE = 1.8, KNIGHT_SPEED = 3.2;
/** The step of a pinned page's replay from rest (s). */
const STEP = 1 / 30;
/** A pool of a hall: the tiles (map coordinates, both ends included) of one terrain. */
export interface HallPool { x0: number; x1: number; z0: number; z1: number; tile: number }
/** The shallow water. */
const WATER: HallPool = { x0: 19, x1: 22, z0: 10, z1: 13, tile: TERRAIN.Shallow };
/**
 * Two pillars (one wall tile each, north of the glide's path) carry the four torches, so the hall's lights are near the lich: a torch's
 * light reaches about 7 tiles, and the hall is wider. Offsets from the hall's middle; a torch is the tile before its wall and the wall's
 * side (`extra` of a torch: 0 north wall, 1 west wall, 2 east wall), as the liquids page's.
 */
const PILLARS: [number, number][] = [[-4, -5], [4, -5]];
const TORCHES: { dx: number; dz: number; side: number }[] = [
  { dx: -4, dz: -4, side: 0 }, { dx: -3, dz: -5, side: 1 }, { dx: 4, dz: -4, side: 0 }, { dx: 3, dz: -5, side: 2 },
];
/** The ids of the stage's entities (the boss is 1, the knight 2). */
export const BOSS_ID = 1, KNIGHT_ID = 2;
const TORCH_ID = 10, DISCIPLE_ID = 20;
const ALL_VISIBLE = { isVisible: (): boolean => true };
const NONE: ReadonlySet<number> = new Set();
const FX_NAMES = ['frozen', 'chilled', 'stone', 'immune'] as const;
type FxName = (typeof FX_NAMES)[number];

/** A hall: floor inside a wall of `WALL` tiles, the two pillars, and the pools. */
export function hallMap(pools: readonly HallPool[]): ReturnType<typeof parseMap> {
  const rows = [...Array(HALL_H + 2 * WALL).keys()].map((z) => (z < WALL || z >= HALL_H + WALL ? '#'.repeat(HALL_W + 2 * WALL) : '#'.repeat(WALL) + '.'.repeat(HALL_W) + '#'.repeat(WALL)));
  const map = parseMap(rows);
  for (const p of pools) for (let z = p.z0; z <= p.z1; z++) for (let x = p.x0; x <= p.x1; x++) map.set(x, z, p.tile);
  for (const [dx, dz] of PILLARS) map.set(HALL_CENTRE.x + dx, HALL_CENTRE.z + dz, TILE_ID.Wall);
  return map;
}

/** The lich's hall: the shallow water patch. */
export const lichMap = (): ReturnType<typeof parseMap> => hallMap([WATER]);

/** The six channelling Disciples round a lich at (`x`, `z`) tiles and the drain list the server sends (px: the lich first, then each Disciple). */
export function immuneRing(x: number, z: number): { ents: EntState[]; drain: [number, number][] } {
  const ents: EntState[] = [], drain: [number, number][] = [[x * TILE, z * TILE]];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6, dx = x + 3.2 * Math.cos(a), dz = z + 3.2 * Math.sin(a);
    ents.push(fxEnt(DISCIPLE_ID + i, KIND.Disciple, dx, dz, { anim: ANIM.Channel, aim: Math.atan2(z - dz, x - dx), side: SIDE.Hostile }));
    drain.push([dx * TILE, dz * TILE]);
  }
  return { ents, drain };
}

/** A number of the query, or null. */
export function queryNum(q: URLSearchParams, k: string): number | null {
  const v = q.get(k), n = v === null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** What a boss's page brings to the hall. */
export interface HallBoss {
  /** The page's name: the readout `window.__r3d.<name>Ms`. */
  name: string;
  /** The built figure's picture, which a pinned replay waits for. */
  picture: string;
  /** The boss's place (tiles); the camera follows it. */
  at: { x: number; z: number };
  /** The page time a pinned page steps to and holds (s); null: the page runs. */
  pin: number | null;
  /** The page's clock runs this many times slower (default 1). */
  slow?: number;
  /** Moves the boss by `dt` to page time `t`. */
  sim(dt: number, t: number, knight: { x: number; z: number }): void;
  /** The boss's entities at page time `t` (`moveT`: the seconds the page has run, for a walk's frames) and the drain list a snapshot would carry. */
  ents(t: number, moveT: number): { ents: EntState[]; drain: [number, number][] | null };
  /** The label's text at page time `clock`. */
  label(clock: number): string;
  /** The page's buttons; `now` is the page time. */
  buttons(now: () => number): PageButton[];
}

/**
 * A boss hall as a stage: the torches on the pillars, the knight (WASD), the water and the lava of `map`, the frame loop and the pinned
 * replay (a pinned page steps to `boss.pin` from rest in steps of 1/30 s once the picture is painted, then holds still).
 * Readouts: `window.__r3d.built` and `window.__r3d.<name>Ms` (the mean of `Figures3d.frame` in ms: seeded with the first sample after 30
 * frames of warm-up, exponential afterwards).
 */
export function createHallStage(assets: Assets, p: R3dParams, map: ReturnType<typeof parseMap>, boss: HallBoss, host?: Pick<Host, 'setPageButtons'>): Stage {
  const world: WorldInput = { map, painted: false, clear: 'stone', stone: stoneField(map) };
  const stoneRun = makeStoneRun(world, { x: map.w / 2, z: map.h / 2 });
  const figures = new Figures3d({ ...galleryInit(), map }, assets.frames, atlasBounds(assets.image, assets.frames));
  const kit = createStageKit(assets);
  const readout = modelsReadouter(kit);
  const pass = new FxPass(NONE);
  const fx = new Effects3d(map);
  const water = new Water3d(map);

  const centre = HALL_CENTRE;
  const knight = { x: centre.x + 1.6, z: centre.z + 2.4, aim: Math.PI, moving: false };
  const cam = { x: boss.at.x + 0.4, z: boss.at.z - 0.5, pitch: (p.pitch * Math.PI) / 180, yaw: (p.yaw * Math.PI) / 180 };
  let moveT = 0;

  // The field: the four wall torches and a light on every lava tile, and the wall torches' figures.
  const spots = TORCHES.map((t) => ({ tx: centre.x + t.dx, ty: centre.z + t.dz, side: t.side }));
  const field = new LightField(map);
  spots.forEach((s, i) => field.add({ id: i + 1, kind: LIGHT_KIND.Torch, colour: 0xffaa5a, x: s.tx, y: s.ty, on: true, wall: s.side + 1 }));
  const torches: EntState[] = spots.map((s, i) => fxEnt(TORCH_ID + i, KIND.Torch, s.side === 1 ? s.tx + 0.5 / TILE : s.side === 2 ? s.tx + 1 - 0.5 / TILE : s.tx + 0.5, s.side === 0 ? s.ty + 0.5 / TILE : s.ty + 0.5, { extra: s.side, anim: 1, side: SIDE.Neutral }));
  // The lava of a hall that has some: its lights, its texels and its surface (a seeded source, so a pinned page shows the same bubbles).
  let lightId = spots.length + 1, lavaTiles = 0;
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (map.get(x, y) === TERRAIN.Lava) { field.add({ id: lightId++, kind: LIGHT_KIND.Lava, colour: 0xff4818, x, y, on: true, wall: 0 }); lavaTiles++; }
  const lava = lavaTiles > 0 ? { texels: new Float32Array(map.w * map.h * 4), pool: new Lava3d(map, rng(LAVA_SEED)), inp: { dt: 0, now: 0, figs: [], hidden: NONE, fp: { x0: 0, z0: 0, x1: 0, z1: 0 }, mask: null, focus: cam } as LavaIn } : null;
  if (lava) lavaTexels(field, map, lava.texels);

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;bottom:8px;font:11px monospace;color:#fff;text-shadow:0 0 3px #000;pointer-events:none';
  document.body.appendChild(label);

  let clock = 0;
  host?.setPageButtons(boss.buttons(() => clock));
  const pin = boss.pin;
  let warmed = pin === null;
  let lastMs = 0, meanMs = 0, samples = 0;

  /** Moves the boss and the knight by `dt` to page time `t`. Keys move the knight only when `keys` is given. */
  const sim = (dt: number, keys: { x: number; z: number } | null, t: number): void => {
    boss.sim(dt, t, knight);
    knight.moving = false;
    if (keys && (keys.x || keys.z)) {
      const len = Math.hypot(keys.x, keys.z);
      knight.x = Math.min(Math.max(knight.x + (keys.x / len) * KNIGHT_SPEED * dt, WALL + 0.6), WALL + HALL_W - 0.6);
      knight.z = Math.min(Math.max(knight.z + (keys.z / len) * KNIGHT_SPEED * dt, WALL + 0.6), WALL + HALL_H - 0.6);
      knight.aim = Math.atan2(keys.z, keys.x);
      knight.moving = true;
    } else knight.aim = Math.atan2(boss.at.z - knight.z, boss.at.x - knight.x);
    moveT += dt;
  };

  /** One step of the page: the figures, the water, the lava and the effects at page time `t` over `dt` s. Returns what the draw needs. */
  const advance = (c: StageCtx, t: number, dt: number): { fo: FigureOut; wo: ReturnType<Water3d['step']>; lo: ReturnType<Lava3d['step']> | null; fp: ReturnType<typeof footprint>; ambient: [number, number, number]; game: boolean } => {
    const game = c.params.light === 'game';
    const ambient = game ? dungeonAmbient(c.params.amb) : WORK_AMBIENT;
    const mine = boss.ents(t, moveT);
    const ents: EntState[] = [...torches, fxEnt(KNIGHT_ID, KIND.Paladin, knight.x, knight.z, { side: SIDE.Friendly, aim: knight.aim, anim: knight.moving ? ANIM.Move : ANIM.Idle, animMs: moveT * 1000 }), ...mine.ents];
    const frame = galleryFrame(ents, t, dt);
    if (mine.drain) frame.snap = snap({ drain: mine.drain, lights: [] }) as unknown as Snapshot;
    const t0 = performance.now();
    const fo = figures.frame(frame, cam, { ambient, dark: c.params.dark, oval: 1, models: { kit, is: () => true } });
    const ms = performance.now() - t0;
    const wo = water.step({ dt, now: t, figs: fo.figs, sinks: fo.sinks, landed: null, hidden: NONE });
    const fp = footprint(cam, c.plan.halfW, c.plan.halfH);
    let lo: ReturnType<Lava3d['step']> | null = null;
    if (lava) { const i = lava.inp; i.dt = dt; i.now = t; i.figs = fo.figs; i.fp = fp; lo = lava.pool.step(i); }
    pass.run(fx, { cam, now: t, quality: c.params.quality, figs: fo.figs, ents: frame.ents, shots: [], hiddenShots: NONE, snap: frame.snap, hidden: NONE, you: -1, ownCast: null, cues: fo.cues, falls: fo.falls, water: wo.cues, ...(lo ? { lava: lo.cues } : {}), fp }, fo.glows);
    lastMs = ms;
    return { fo, wo, lo, fp, ambient, game };
  };
  world.taken = { lights: [...field.lights.values()], spawn: { x: map.w / 2, z: map.h / 2 } };
  return {
    world,
    frame(c: StageCtx): number {
      cam.pitch = (c.params.pitch * Math.PI) / 180;
      cam.yaw = (c.params.yaw * Math.PI) / 180;
      let ix = 0, iz = 0;
      for (const k of c.held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
      const keys = ix || iz ? keysToWorld(cam.yaw, ix, iz) : null;
      const follow = (k: number): void => { cam.x += (boss.at.x + 0.4 - cam.x) * k; cam.z += (boss.at.z - 0.5 - cam.z) * k; };

      let dt = c.dt / (boss.slow ?? 1);
      if (pin !== null) {
        // The picture of the built figure arrives off the frame: the replay waits for it, else the boss would be a card for the steps it needs.
        if (!warmed && c.view && kit.picture(boss.picture)) {
          warmed = true;
          cam.x = boss.at.x + 0.4; cam.z = boss.at.z - 0.5;
          while (clock < pin - 1e-9) {
            const s = Math.min(STEP, pin - clock);
            sim(s, null, clock + s); clock += s;
            advance(c, clock, s);
          }
        }
        dt = 0;
        follow(1);
      } else {
        sim(dt, keys, clock + dt); clock += dt;
        follow(1 - Math.exp(-c.dt * 6));
      }
      c.timer.lap('sim');
      stoneRun.frame(c.view);
      if (!c.view) return 0;

      const { fo, wo, lo, fp, ambient, game } = advance(c, clock, dt);
      // the first 30 frames (shader and picture start-up) are not counted; the mean is seeded with the 31st sample, then exponential
      if (++samples > 30) meanMs = samples === 31 ? lastMs : meanMs + (lastMs - meanMs) * 0.02;
      const dynamic: Dynamic = { cards: quadsOf(fo.cards), ghosts: quadsOf(fo.ghosts), decals: quadsOf(fo.decals), shadows: shadowsOf(fo.shadows), glows: glowsOf(fo.glows) };
      c.timer.lap('cards');
      let lights: Cand[] = [];
      if (game) lights = selectLights([...staticCands(field, clock), ...pass.out.lights], lightView(fp, cam), { x: cam.x, z: cam.z }, Math.min(LIGHT_CAP, c.params.lcap)).list as Cand[];
      const casters = game ? selectCasters(fo.casters, lights, Math.min(CASTER_CAP, c.params.ccap)) : [];
      assignSkips(lights, casters);
      c.timer.lap('lights');
      label.textContent = boss.label(clock);
      const r = window.__r3d as unknown as Record<string, unknown> | undefined;
      if (r) {
        r.built = fo.built.length; r[`${boss.name}Ms`] = meanMs; r.figures = figures.count; r.lights = { list: lights.length, inView: lights.length }; r.casters = casters.length;
        r.fx = { records: fx.records, tris: pass.triCount, dropped: pass.droppedTotal };
        r.models = readout(c.view.figuresDrawn ?? { figures: 0, draws: 0 }, clock);
        r.builtDrawn = c.view.builtDrawn ?? 0;
      }
      c.timer.renderStart();
      return c.view.draw(
        {
          cam: closeCam(cam, c.zoom), plan: c.plan, dynamic, lights, ambient, shadows: c.params.shadows, smooth: c.params.smooth, t: c.now,
          see: { openers: seenOpeners(fo.openers, ALL_VISIBLE, new Set()), look: seeLook(c.params) },
          lava: lava && game ? lava.texels : null, lavaVersion: 0, darkvision: null, casters, sight: SIGHT_OFF,
          ...(lo ? { lavaPool: { bubbles: lo.bubbles, stirs: lo.stirs, now: clock, heat: shimmers(c.params) } } : {}),
          models: { insts: fo.models, built: fo.built, kit }, water: { ripples: wo.ripples, now: clock, reflect: reflects(c.params) },
          fx: { tris: pass.blend, lit: pass.lit, smoke: pass.smoke }, field: { age: fx.fieldAge(clock), t: clock },
          wallLights: { off: (i) => field.lights.get(i)?.on === false, now: clock },
        },
        c.timer,
      );
    },
    dispose(): void {
      label.remove();
      host?.setPageButtons([]);
      kit.dispose();
    },
  };
}

export interface LichOpts {
  act: LichAct; at: number | null; pinned: number | null; face: number | null; glide: boolean; fx: FxName | null; px: number | null; pz: number | null; lich: boolean;
}

export function parseLich(search: string): LichOpts {
  const q = new URLSearchParams(search);
  const num = (k: string): number | null => queryNum(q, k);
  const act = q.get('act') as LichAct;
  const fx = q.get('fx') as FxName;
  const face = num('face');
  return {
    act: LICH_ACTS.includes(act) ? act : 'stand', at: num('at'), pinned: num('t'), face: face === null ? null : (face * Math.PI) / 180,
    glide: q.get('glide') === '1' || act === 'glide', fx: FX_NAMES.includes(fx) ? fx : null, px: num('px'), pz: num('pz'), lich: q.get('lich') !== '0',
  };
}

export function createLichStage(assets: Assets, p: R3dParams, search: string, host?: Pick<Host, 'setPageButtons' | 'syncPageButtons' | 'params' | 'setParams'>): Stage {
  const opts = parseLich(search);
  const centre = HALL_CENTRE;
  const lich = { x: opts.px ?? centre.x, z: opts.pz ?? centre.z, aim: opts.face ?? (30 * Math.PI) / 180, moving: false };
  const state = {
    act: opts.act, glide: opts.glide, origin: 0, lichOn: opts.lich,
    frozen: opts.fx === 'frozen', chilled: opts.fx === 'chilled', stone: opts.fx === 'stone', immune: opts.fx === 'immune',
  };
  const path = [[-6, -3], [6, -3], [6, 4], [-6, 4]].map(([x, z]) => ({ x: centre.x + x, z: centre.z + z }));
  let leg = 0, wait = 0;

  const NAMES: Record<LichAct, string> = { stand: 'Stand', glide: 'Glide', nova: 'Nova', raise: 'Raise Dead', bolts: 'Bolts', curse: 'Curse', mist: 'Mist', gaze: 'Stone Gaze', hurt: 'Hurt', broken: 'Broken wind-up' };
  const toggle = (name: string, key: 'frozen' | 'chilled' | 'stone' | 'immune') => ({ name, pressed: () => state[key], press: () => { state[key] = !state[key]; } });

  // `&at=` without `&t=` pins the page too (at 3 s), so the replay passes the release and then holds.
  const pin = opts.pinned ?? (opts.at !== null ? 3 : null);
  /** Seconds of the act's loop at page time `t`: `&at=` pins it to the pinned time's end (the replay passes the release), else it runs from the act's start. */
  const actClock = (t: number): number => (opts.at !== null ? opts.at - (pin! - t) : t - state.origin);

  return createHallStage(assets, p, lichMap(), {
    name: 'lich', picture: builtOf(KIND.Lich)!.picture, at: lich, pin,
    buttons: (now) => [
      ...LICH_ACTS.filter((a) => a !== 'glide').map((a) => ({ name: NAMES[a], pressed: () => state.act === a, press: () => { state.act = a; state.origin = now(); } })),
      { name: 'Glide', pressed: () => state.glide, press: () => { state.glide = !state.glide; } },
      toggle('Frozen', 'frozen'), toggle('Chilled', 'chilled'), toggle('Stone', 'stone'), toggle('Immune', 'immune'),
      { name: 'Work light', pressed: () => host!.params.light === 'work', press: () => { host!.setParams({ ...host!.params, light: host!.params.light === 'work' ? 'game' : 'work' }); } },
    ],
    /** The lich glides its rectangle, but stands while it casts. */
    sim(dt, t, knight): void {
      let faceTo = Math.atan2(knight.z - lich.z, knight.x - lich.x);
      lich.moving = false;
      const casting = lichAct(state.act === 'glide' ? 'stand' : state.act, actClock(t), KNIGHT_ID).anim !== ANIM.Idle;
      if (state.glide && !casting && !state.frozen && !state.stone) { // a frozen or stone lich stands, as in a run
        if (wait > 0) wait -= dt;
        else {
          const to = path[leg], dx = to.x - lich.x, dz = to.z - lich.z, d = Math.hypot(dx, dz), go = SPEED * dt;
          if (d <= go) { lich.x = to.x; lich.z = to.z; leg = (leg + 1) % path.length; wait = PAUSE; }
          else { lich.x += (dx / d) * go; lich.z += (dz / d) * go; faceTo = Math.atan2(dz, dx); lich.moving = true; }
        }
      }
      lich.aim = opts.face ?? faceTo; // the pose eases the facing itself
    },
    ents(t, moveT) {
      const ents: EntState[] = [];
      let drain: [number, number][] | null = null;
      if (state.lichOn) {
        const stateOf = lichAct(state.act === 'glide' ? 'stand' : state.act, actClock(t), KNIGHT_ID);
        const moving = lich.moving ? { anim: ANIM.Move, animMs: moveT * 1000 } : {};
        const effects = (state.frozen ? 1 << EFFECT.Frozen : 0) | (state.chilled ? 1 << EFFECT.Chilled : 0) | (state.stone ? 1 << EFFECT.Petrified : 0);
        ents.push(fxEnt(BOSS_ID, KIND.Lich, lich.x, lich.z, { side: SIDE.Hostile, aim: lich.aim, ...stateOf, ...moving, effects, flags: stateOf.flags | (state.immune ? FLAG.IMMUNE : 0) }));
        if (state.immune) { const ring = immuneRing(lich.x, lich.z); ents.push(...ring.ents); drain = ring.drain; }
      }
      return { ents, drain };
    },
    label: (clock) => `lich (#358): ${state.act}${state.glide ? ' + glide' : ''}; act ${actClock(clock).toFixed(2)} of ${actPeriod(state.act === 'glide' ? 'stand' : state.act).toFixed(2)} s; t ${clock.toFixed(2)} s; WASD moves the knight`,
  }, host);
}
