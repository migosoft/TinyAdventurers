// The stage of the ?r3d=lights page (#304): the 2D `?lights` demo (game/LightsDemoScene.ts) in the 3D view, no server, no login.
// Both play the same script (game/lightsDemoScript.ts): the board, seven torches (one a blue one that switches every 3 s, one
// beside the lava pool without a flame figure), a lava pool, a fireball, a frost bolt and an explosion flash. The lights go through
// the run's own light-list functions (lights.ts): the static field, the moving lights, the choice for the shader's slots, the lava
// texels. A knight walks a loop past the pillars so its shadow can be seen. V cycles the viewer's darkvision 0 / 50 / 100 %.
import { ANIM, CONST, KIND, LIGHT_KIND, SIDE } from '../generated/defs';
import { nextDarkvision } from '../game/darkvisionSteps';
import { LightField } from '../game/light';
import { BLUE, TORCHES, VIEWER, blueOn, buildMap, lavaLights, movingAt } from '../game/lightsDemoScript';
import type { EntState } from '../game/world';
import { atlasBounds } from './atlasBounds';
import { freeClamp, keysToWorld } from './camera';
import { glowsOf, quadsOf, shadowsOf, type Dynamic } from './cards';
import { Figures3d } from './figures';
import { galleryFrame, galleryInit } from './galleryStage';
import { MOVE_KEYS, type Stage, type StageCtx } from './host';
import { LIGHT_CAP, WORK_AMBIENT, dungeonAmbient } from './light';
import { footprint, lavaTexels, movingCands, selectLights, staticCands, TorchPairs } from './lights';
import { seenOpeners } from './openers';
import { seeLook } from './seeThrough';
import type { Assets, WorldInput } from './view';

const TILE = 16;
/** The free camera's speed in tiles per second. */
const PAN_SPEED = 12;
/** The knight's speed along its loop, in tiles per second. */
const KNIGHT_SPEED = 2;
const KNIGHT_ID = 100;
/** The knight's loop in tiles (closed): along the north wall past the first pillar, down the east side past the second, back through the middle of room 1. */
const LOOP: [number, number][] = [[3.5, 4.5], [10.5, 4.5], [10.5, 14.5], [7.5, 14.5], [7.5, 8.5], [3.5, 8.5]];
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

export function createLightsStage(assets: Assets, p: { pitch: number; yaw: number; light: 'game' | 'work'; amb: number; lcap: number; dv: number | null }, search: string): Stage {
  const opts = parseLights(search);
  const map = buildMap();
  const world: WorldInput = { map, painted: false, clear: 'stone' };
  const figures = new Figures3d({ ...galleryInit(), map }, assets.frames, atlasBounds(assets.image, assets.frames));
  const cam = { x: map.w / 2, z: map.h / 2, pitch: (p.pitch * Math.PI) / 180, yaw: (p.yaw * Math.PI) / 180 };
  let t = opts.start;
  /** The viewer's darkvision, 0..1: from `&dv=` (0..100), cycled by V. */
  let darkvision = p.dv !== null ? p.dv / 100 : 0;

  // The field: each torch's light on the tile its spot lies in (ids from 1, as in 2D), then a light on every lava tile.
  const field = new LightField(map);
  let lightId = 1;
  let blueId = 0;
  for (const tc of TORCHES) {
    field.add({ id: lightId, kind: LIGHT_KIND.Torch, colour: tc.colour, x: Math.floor(tc.x / TILE), y: Math.floor(tc.y / TILE), on: true });
    if (tc.blue) blueId = lightId;
    lightId++;
  }
  for (const l of lavaLights(map)) field.add({ id: lightId++, kind: LIGHT_KIND.Lava, colour: 0xff4818, x: l.x, y: l.y, on: true });
  const pairs = new TorchPairs();
  let lava = new Float32Array(map.w * map.h * 4);
  let lavaVersion = -1;

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;bottom:8px;font:11px monospace;color:#fff;text-shadow:0 0 3px #000;pointer-events:none';
  document.body.appendChild(label);
  const caption = (): void => {
    label.textContent = `lights demo in 3D: torches, lava, fireball, frost bolt, explosion; darkvision ${Math.round(darkvision * 100)}% (V); WASD pans`;
  };
  caption();

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
      for (const e of ents) if (e.kind === KIND.Torch) pairs.see(e);
      c.timer.lap('sim');
      if (!c.view) return 0;
      const fo = figures.frame(galleryFrame(ents, t, dt), cam);
      const dynamic: Dynamic = { cards: quadsOf(fo.cards), ghosts: quadsOf(fo.ghosts), decals: quadsOf(fo.decals), shadows: shadowsOf(fo.shadows), emissive: quadsOf(fo.emissive), glows: glowsOf(fo.glows) };
      c.timer.lap('cards');

      const game = c.params.light === 'game';
      const viewer = { x: VIEWER[0] + 0.5, z: VIEWER[1] + 0.5 };
      let lights: ReturnType<typeof selectLights>['list'] = [];
      if (game) {
        const cands = [...staticCands(field, pairs, map, t), ...movingCands(movingAt(t), [], () => null, t)];
        lights = selectLights(cands, footprint(cam, c.plan.halfW, c.plan.halfH), viewer, Math.min(LIGHT_CAP, c.params.lcap)).list;
        if (field.version !== lavaVersion) {
          lavaVersion = field.version;
          lava = new Float32Array(map.w * map.h * 4);
          lavaTexels(field, map, lava);
        }
      }
      c.timer.lap('lights');
      if (window.__r3d) window.__r3d.figures = figures.count;
      c.timer.renderStart();
      return c.view.draw(
        {
          cam, plan: c.plan, dynamic, lights, ambient: game ? dungeonAmbient(c.params.amb) : WORK_AMBIENT, shadows: c.params.shadows, smooth: c.params.smooth, t: c.now,
          see: { openers: seenOpeners(fo.openers, ALL_VISIBLE, new Set()), look: seeLook(c.params) },
          lava: game ? lava : null,
          darkvision: game && darkvision > 0 ? { x: viewer.x, z: viewer.z, reach: darkvision * CONST.FOV_RADIUS } : null,
          casters: [],
        },
        c.timer,
      );
    },
    key(e: KeyboardEvent): boolean {
      if (e.code !== 'KeyV' || e.repeat) return false;
      darkvision = nextDarkvision(darkvision);
      caption();
      return true;
    },
    dispose(): void {
      label.remove();
    },
  };
}
