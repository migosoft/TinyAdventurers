// The stage of the ?r3d=lights page (#304): the lights demo, no server, no login.
// It plays the script of game/lightsDemoScript.ts: the board, seven torches (one a blue one that switches every 3 s, one
// beside the lava pool without a flame figure), a lava pool, a fireball, a frost bolt and an explosion flash. The lights go through
// the run's own light-list functions (lights.ts): the static field, the moving lights, the choice for the shader's slots, the lava
// texels. A knight walks a loop past the pillars so its shadow can be seen. V cycles the viewer's darkvision 0 / 50 / 100 %.
import { ANIM, CONST, KIND, LIGHT, LIGHT_KIND, SIDE } from '../generated/defs';
import { nextDarkvision } from '../game/darkvisionSteps';
import { LightField } from '../game/light';
import { DEFAULT_HAZE } from '../game/sightField';
import { BLUE, TORCHES, VIEWER, blueOn, buildMap, lavaLights, movingAt } from '../game/lightsDemoScript';
import type { EntState } from '../game/world';
import { atlasBounds } from './atlasBounds';
import { closeCam, freeClamp, keysToWorld } from './camera';
import { glowsOf, quadsOf, shadowsOf, type Dynamic } from './cards';
import { Figures3d } from './figures';
import { galleryFrame, galleryInit } from './galleryStage';
import { MOVE_KEYS, type Host, type Stage, type StageCtx } from './host';
import { shimmers, type R3dParams } from './params';
import { LAVA_SEED, Lava3d, type LavaIn } from './lava/lava';
import { rng } from './fx/rand';
import { LIGHT_CAP, WORK_AMBIENT, dungeonAmbient, stoneClear } from './light';
import { CRACK_CAP, crackOf, selectCracks, type Crack } from './air/cracks';
import { sunLook } from '../game/sunmath';
import { assignSkips,CASTER_CAP, footprint, lavaTexels, lightView, movingCands, selectCasters, selectLights, staticCands } from './lights';
import { seenOpeners } from './openers';
import { seeLook } from './seeThrough';
import { MIST } from './mist';
import { SightMask } from './sightmask';
import { SIGHT_OFF } from './sightNodes';
import { View as SightView } from '../sim/view';
import type { Assets, WorldInput } from './view';
import { stoneField } from './stone/field';
import { makeStoneRun } from './stone/stoneRun';

const TILE = 16;
/** The free camera's speed in tiles per second. */
const PAN_SPEED = 12;
/** The knight's speed along its loop, in tiles per second. */
const KNIGHT_SPEED = 2;
const KNIGHT_ID = 100;
/** The knight's loop in tiles (closed): along the north wall past the first pillar, down the east side past the second, back through the middle of room 1. */
const LOOP: [number, number][] = [[3.5, 4.5], [10.5, 4.5], [10.5, 14.5], [7.5, 14.5], [7.5, 8.5], [3.5, 8.5]];
/** The tile of the Daylight crack: on the loop's west leg, so the knight crosses the patch and cuts a gap into the shafts. */
export const CRACK_TILE: [number, number] = [7, 9];
const LOOP_LEN = LOOP.reduce((s, p, i) => s + Math.hypot(LOOP[(i + 1) % LOOP.length][0] - p[0], LOOP[(i + 1) % LOOP.length][1] - p[1]), 0);

/** Where the knight is at time `t` (s), in px, and the aim it faces (right, or left while it goes west). */
export function lightsKnight(t: number): { x: number; y: number; aim: number } {
  let d = (t * KNIGHT_SPEED) % LOOP_LEN;
  for (let i = 0; i < LOOP.length; i++) {
    const [ax, ay] = LOOP[i];
    const [bx, by] = LOOP[(i + 1) % LOOP.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (d <= len) {
      const k = d / len;
      return { x: (ax + (bx - ax) * k) * TILE, y: (ay + (by - ay) * k) * TILE, aim: bx < ax ? Math.PI : 0 };
    }
    d -= len;
  }
  return { x: LOOP[0][0] * TILE, y: LOOP[0][1] * TILE, aim: 0 };
}

const ent = (id: number, kind: number, x: number, y: number, o: Partial<EntState> = {}): EntState => ({
  id, kind, x, y, hp: 10, anim: ANIM.Idle, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0,
  side: kind === KIND.Knight ? SIDE.Friendly : SIDE.Neutral, entangled: 0, ...o,
});

/** The entities of the stage at time `t` (s): the flame of every torch that has a figure (ids from 1; `extra` the side, `anim` 1 when lit) and the knight. */
export function lightsEnts(t: number): EntState[] {
  const out: EntState[] = [];
  let id = 1;
  for (const tc of TORCHES) {
    if (!tc.sprite) continue;
    out.push(ent(id++, KIND.Torch, tc.x, tc.y, { extra: tc.side, anim: !tc.blue || blueOn(t) ? 1 : 0 }));
  }
  const k = lightsKnight(t);
  out.push(ent(KNIGHT_ID, KIND.Knight, k.x, k.y, { anim: ANIM.Move, animMs: t * 1000, aim: k.aim }));
  return out;
}

/** `&t=<s>` starts the clock there, `&slow=<n>` slows it. */
export function parseLights(search: string): { start: number; slow: number } {
  const q = new URLSearchParams(search);
  const start = Number(q.get('t') ?? 0);
  const slow = Number(q.get('slow') ?? 1);
  return { start: Number.isFinite(start) && start > 0 ? start : 0, slow: Number.isFinite(slow) && slow > 0 ? slow : 1 };
}

const ALL_VISIBLE = { isVisible: (): boolean => true };

export function createLightsStage(assets: Assets, p: R3dParams, search: string, host?: Pick<Host, 'params' | 'setParams'>): Stage {
  const opts = parseLights(search);
  const map = buildMap();
  const world: WorldInput = { map, painted: false, clear: 'stone', stone: stoneField(map) };
  const stoneRun = makeStoneRun(world, { x: map.w / 2, z: map.h / 2 });
  const figures = new Figures3d({ ...galleryInit(), map }, assets.frames, atlasBounds(assets.image, assets.frames));
  const cam = { x: map.w / 2, z: map.h / 2, pitch: (p.pitch * Math.PI) / 180, yaw: (p.yaw * Math.PI) / 180 };
  let t = opts.start;
  // The viewer's sight: `&at=x,y` (tiles) or the script's VIEWER (the middle of room 1's tile); the page's map has no soft tiles.
  const at = new URLSearchParams(search).get('at')?.split(',').map(Number);
  const viewerAt = at?.length === 2 && at.every(Number.isFinite) ? { x: at[0], z: at[1] } : { x: VIEWER[0] + 0.5, z: VIEWER[1] + 0.5 };
  const hardView = new SightView(map.w, map.h);
  hardView.compute(map, viewerAt.x * TILE, viewerAt.z * TILE, CONST.FOV_RADIUS, 'hard');
  const mask = new SightMask(map, { daylight: false, feather: 0, ramp: 0 });

  // The field: each torch's light on the tile its spot lies in (ids from 1), then a light on every lava tile.
  const field = new LightField(map);
  let lightId = 1;
  let blueId = 0;
  for (const tc of TORCHES) {
    field.add({ id: lightId, kind: LIGHT_KIND.Torch, colour: tc.colour, x: Math.floor(tc.x / TILE), y: Math.floor(tc.y / TILE), on: true, wall: tc.side + 1 });
    if (tc.blue) blueId = lightId;
    lightId++;
  }
  // One crack in room 1's ceiling (#307), its patch on the knight's walk: the west leg of the loop (x 7.5, z 8.5 to 14.5) passes tile (7, 9).
  field.add({ id: lightId++, kind: LIGHT_KIND.Daylight, colour: LIGHT[LIGHT_KIND.Daylight].colour, x: CRACK_TILE[0], y: CRACK_TILE[1], on: true, wall: 0 });
  for (const l of lavaLights(map)) field.add({ id: lightId++, kind: LIGHT_KIND.Lava, colour: 0xff4818, x: l.x, y: l.y, on: true, wall: 0 });
  let lava = new Float32Array(map.w * map.h * 4);
  let lavaVersion = -1;
  // The pool's lava (#344): bubbles and rings only, no effects here, so its cues go unused.
  const lava3d = new Lava3d(map, rng(LAVA_SEED));
  const lavaIn: LavaIn = { dt: 0, now: 0, figs: [], hidden: new Set(), fp: { x0: 0, z0: 0, x1: 0, z1: 0 }, mask: null, focus: cam };

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;bottom:8px;font:11px monospace;color:#fff;text-shadow:0 0 3px #000;pointer-events:none';
  document.body.appendChild(label);
  /** The viewer's darkvision, 0..1: the params' `dv` (0..100; the panel, the URL and V all set it). */
  const dvOf = (q: R3dParams): number => (q.dv ?? 0) / 100;
  let shown = -1;
  const caption = (dv: number): void => {
    if (dv === shown) return;
    shown = dv;
    label.textContent = `lights demo in 3D: torches, lava, fireball, frost bolt, explosion; darkvision ${Math.round(dv * 100)}% (V); WASD pans`;
  };
  caption(dvOf(p));
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
      const on = blueOn(t);
      if (field.lights.get(blueId)?.on !== on) field.set(blueId, on, BLUE);
      const ents = lightsEnts(t);
      c.timer.lap('sim');
      stoneRun.frame(c.view);
      if (!c.view) return 0;
      const game = c.params.light === 'game';
      const ambient = game ? dungeonAmbient(c.params.amb) : WORK_AMBIENT;
      const fo = figures.frame(galleryFrame(ents, t, dt), cam, { ambient, dark: c.params.dark, torchGlow: !game, oval: 1 });
      const dynamic: Dynamic = { cards: quadsOf(fo.cards), ghosts: quadsOf(fo.ghosts), decals: quadsOf(fo.decals), shadows: shadowsOf(fo.shadows), emissive: quadsOf(fo.emissive), glows: glowsOf(fo.glows) };
      c.timer.lap('cards');

      const dv = dvOf(c.params);
      caption(dv);
      const viewer = viewerAt;
      mask.update(hardView, null, 0);
      let lights: ReturnType<typeof selectLights>['list'] = [];
      let inView = 0;
      let cracks: Crack[] = [];
      const fp = footprint(cam, c.plan.halfW, c.plan.halfH);
      if (game) {
        const cands = [...staticCands(field, t), ...movingCands(movingAt(t), [], () => null, t)];
        const sel = selectLights(cands, lightView(fp, cam), viewer, Math.min(LIGHT_CAP, c.params.lcap));
        lights = sel.list;
        inView = sel.inView;
        // Only the cracks the viewer sees (as runView3d); the mask is up to date above.
        cracks = selectCracks(field, fp, c.params.sight ? mask : null, CRACK_CAP).map((l) => crackOf(l, sunLook, c.now));
        if (field.version !== lavaVersion) {
          lavaVersion = field.version;
          lava = new Float32Array(map.w * map.h * 4);
          lavaTexels(field, map, lava);
        }
      }
      // The figures that cast a shadow for these lights, and each carried light skips its carrier.
      const casters = game ? selectCasters(fo.casters, lights, Math.min(CASTER_CAP, c.params.ccap)) : [];
      assignSkips(lights, casters);
      c.timer.lap('lights');
      const sight = c.params.sight
        ? { mode: 'dark' as const, mask, clear: stoneClear(ambient), haze: DEFAULT_HAZE, mist: MIST, mistDay: 1, mistLight: [1, 1, 1] as [number, number, number], wind: [0, 0] as [number, number], t: c.now }
        : SIGHT_OFF;
      c.timer.lap('sight');
      lavaIn.dt = dt; lavaIn.now = t; lavaIn.figs = fo.figs; lavaIn.fp = fp; lavaIn.mask = c.params.sight ? mask : null;
      const lo = lava3d.step(lavaIn);
      const r = window.__r3d;
      if (r) {
        r.figures = figures.count;
        r.lights = { list: lights.length, inView };
        r.casters = casters.length;
      }
      c.timer.renderStart();
      return c.view.draw(
        {
          cam: closeCam(cam, c.zoom), plan: c.plan, dynamic, lights, ambient, shadows: c.params.shadows, smooth: c.params.smooth, t: c.now,
          see: { openers: seenOpeners(fo.openers, ALL_VISIBLE, new Set()), look: seeLook(c.params) },
          lava: game ? lava : null, lavaVersion: lavaVersion, lavaPool: { bubbles: lo.bubbles, stirs: lo.stirs, now: t, heat: shimmers(c.params) },
          darkvision: game && dv > 0 ? { x: viewer.x, z: viewer.z, reach: dv * CONST.FOV_RADIUS } : null,
          casters, sight, cracks, shafts: c.params.shafts,
        },
        c.timer,
      );
    },
    key(e: KeyboardEvent): boolean {
      if (e.code !== 'KeyV' || e.repeat) return false;
      if (!host) return false;
      host.setParams({ ...host.params, dv: Math.round(nextDarkvision(dvOf(host.params)) * 100) });
      return true;
    },
    dispose(): void {
      label.remove();
    },
  };
}
