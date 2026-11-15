// The stage of the ?r3d=fx page (#308): the 3D effects system on its own, no server. Every row of `FX_ROWS` is a small scenario in its
// own room (a slot of the map): a still wizard caster, three skeleton targets, the events the row sends and the entities it changes.
// A group of rows is shown side by side; the page runs them through `galleryFrame`, `Figures3d.frame` and the same `Effects3d.frame`
// as a run (`FxPass`). The clock is the page's own: `&t=<s>` pins it (the same picture again), `&fx=<group>` picks the group,
// `Slow` runs it five times slower, `Cast now` restarts every row. Each later task of #308 adds its rows to `FX_ROWS`.
import { ANIM, KIND, LIGHT_KIND, RUNE_LOOK, SIDE, TILE_ID } from '../generated/defs';
import type { Snapshot } from '../generated/Snapshot';
import { LightField } from '../game/light';
import type { EntState } from '../game/world';
import { snap } from '../run/testing';
import type { PictureEv, ShotView } from '../run/view';
import { TILE, TileMap } from '../sim/map';
import { atlasBounds } from './atlasBounds';
import { freeClamp, keysToWorld } from './camera';
import { glowsOf, quadsOf, shadowsOf, type Dynamic } from './cards';
import { Effects3d } from './fx/effects3d';
import { FxPass } from './fx/pass';
import { Figures3d } from './figures';
import { galleryFrame, galleryInit } from './galleryStage';
import { MOVE_KEYS, type Host, type Stage, type StageCtx } from './host';
import { LIGHT_CAP, WORK_AMBIENT, dungeonAmbient } from './light';
import { assignSkips, carrierMap, CASTER_CAP, footprint, selectCasters, selectLights, staticCands, TorchPairs, type Cand } from './lights';
import { seenOpeners } from './openers';
import type { R3dParams } from './params';
import { seeLook } from './seeThrough';
import { SIGHT_OFF } from './sightNodes';
import { createStageKit } from './stageKit';
import type { Assets, WorldInput } from './view';

const PAN_SPEED = 12;
/** One room: its size in tiles, and the map's grid of rooms (the boss bay is the extra one below the grid). */
const W = 15, H = 13, COLS = 4, ROWS = 4;
export const SLOTS = COLS * ROWS;
const BAY = SLOTS;
/** The room's floor, the two pillars and the two torches (local tiles; the try-out's room). */
const FLOOR = { x0: 1, x1: 13, y0: 3, y1: 11 };
const PILLARS: [number, number][] = [[8, 5], [13, 10]];
const TORCH_TILES = [3, 11];

/** Local tile positions and ids every scenario shares (a row may move or replace them). */
export const CASTER = { x: 3.5, z: 8 };
export const IMPACT = { x: 10.8, z: 8.2 };
export const TARGETS: [number, number][] = [[10.4, 7.4], [11.5, 8.3], [10.6, 9.1]];
export const CASTER_ID = 100, TARGET_ID = 110;
/** The bosses of the corner, in the bay. */
const BOSSES: [number, number, number][] = [[KIND.Lich, 3.5, 6], [KIND.Dragon, 7, 6.5], [KIND.Demon, 10.5, 6], [KIND.Ogre, 12, 9]];

export type FxGroup = 'spells' | 'booms' | 'shots' | 'figures' | 'hazards' | 'status' | 'objects';
export const FX_GROUPS: FxGroup[] = ['spells', 'booms', 'shots', 'figures', 'hazards', 'status', 'objects'];

/** What a row changes in the snapshot (the drain beams and the moving lights; px, local to the room). */
export interface SnapExtras { drain?: NonNullable<Snapshot['drain']>; lights?: Snapshot['lights'] }

/**
 * A row's picture at `t` seconds into its period: the entities it sets (local px; the stage adds the caster and the targets unless
 * a row gives the same id) and the events it sends (`at` seconds into the period; local px). `ents` may be empty.
 */
export interface FxScene {
  ents: EntState[];
  events: Array<{ at: number; ev: PictureEv }>;
  /** Shots that end at `at` seconds (local px); the stage calls `Effects3d.shotEnded` for them. */
  shotEnds?: Array<{ at: number; shot: ShotView; how: 'wall' | 'enemy' | 'gone' }>;
  snapExtras?: SnapExtras;
}

export interface FxRow {
  group: FxGroup;
  name: string;
  /** Seconds before the row repeats. */
  period: number;
  at(t: number): FxScene;
}

/** An entity at local tile (x, z). */
export const fxEnt = (id: number, kind: number, x: number, z: number, o: Partial<EntState> = {}): EntState => ({
  id, kind, x: x * TILE, y: z * TILE, hp: 10, anim: ANIM.Idle, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0,
  side: kind === KIND.Wizard ? SIDE.Friendly : kind === KIND.Torch ? SIDE.Neutral : SIDE.Hostile, entangled: 0, ...o,
});

const px = (tiles: number): number => tiles * TILE;

/** The rune rows (#308): a wind-up, an instant cast, a primary, a channel and a wind-up that is broken off. */
function runeRows(): FxRow[] {
  const cast = (at: number, look: number, windup_ms: number, primary: boolean): { at: number; ev: PictureEv } =>
    ({ at, ev: { t: 'Cast', id: CASTER_ID, x: px(CASTER.x), y: px(CASTER.z), look, windup_ms, primary, aim: 0 } });
  const caster = (anim: number, t0: number): EntState[] => [fxEnt(CASTER_ID, KIND.Wizard, CASTER.x, CASTER.z, { anim, animMs: t0 * 1000 })];
  return [
    { group: 'spells', name: 'runes: wind-up', period: 4, at: (t) => ({ ents: caster(t >= 0.3 && t < 1.5 ? ANIM.Windup : ANIM.Idle, t - 0.3), events: [cast(0.3, RUNE_LOOK.Fire, 1200, false)] }) },
    { group: 'spells', name: 'runes: instant', period: 2.5, at: (t) => ({ ents: caster(ANIM.Cast, t), events: [cast(0.3, RUNE_LOOK.Cold, 0, false)] }) },
    { group: 'spells', name: 'runes: primary', period: 2, at: (t) => ({ ents: caster(ANIM.Cast, t), events: [cast(0.3, RUNE_LOOK.Arcane, 0, true)] }) },
    { group: 'spells', name: 'runes: channel', period: 5, at: (t) => ({ ents: caster(t >= 0.3 && t < 3.5 ? ANIM.Channel : ANIM.Idle, t), events: [] }) },
    { group: 'spells', name: 'runes: broken off', period: 4, at: (t) => ({ ents: caster(t >= 0.3 && t < 0.9 ? ANIM.Windup : ANIM.Idle, t - 0.3), events: [cast(0.3, RUNE_LOOK.Holy, 1200, false)] }) },
  ];
}

/** The shot rows (#308): a shot flies from the caster to the far wall in 1.2 s (the wall at tile x 13), then hits it. */
function shotRows(): FxRow[] {
  const FLY = 1.2, X1 = 13.8;
  const one = (name: string, kind: number): FxRow => ({
    group: 'shots', name, period: 2.4,
    at: (t) => {
      const k = Math.min(1, t / FLY), x = CASTER.x + 1 + (X1 - CASTER.x - 1) * k;
      return {
        ents: t < FLY ? [fxEnt(300, kind, x, CASTER.z, { aim: 0 })] : [],
        events: [],
        shotEnds: [{ at: FLY, shot: { shot: 1, kind, x: px(X1), y: px(CASTER.z), vx: 1, vy: 0 }, how: 'wall' }],
      };
    },
  });
  return [one('fire bolt', KIND.FireBolt), one('fireball', KIND.Fireball), one('dragon fireball', KIND.DragonFireball), one('frost bolt', KIND.FrostBolt),
    one('magic missile', KIND.Missile), one('gloom bolt', KIND.GloomBolt), one('shadow bolt', KIND.ShadowBolt), one('judgement', KIND.Judgement)];
}

/** The rows. Each later task of #308 adds the ones of its group. */
export const FX_ROWS: FxRow[] = [
  {
    group: 'spells', name: 'Fireball', period: 4,
    at: (t) => ({
      ents: [fxEnt(CASTER_ID, KIND.Wizard, CASTER.x, CASTER.z, t >= 0.3 && t < 1.5 ? { anim: ANIM.Windup, animMs: (t - 0.3) * 1000 } : t >= 1.5 && t < 1.75 ? { anim: ANIM.Cast, animMs: (t - 1.5) * 1000 } : {})],
      events: [
        { at: 0.3, ev: { t: 'Cast', id: CASTER_ID, x: px(CASTER.x), y: px(CASTER.z), look: RUNE_LOOK.Fire, windup_ms: 1200, primary: false, aim: 0 } },
        { at: 1.95, ev: { t: 'Boom', x: px(IMPACT.x), y: px(IMPACT.z), r: px(1.5), k: 0 } },
      ],
    }),
  },
  ...runeRows(),
  ...shotRows(),
  {
    group: 'booms', name: 'Frost nova', period: 5,
    at: () => ({ ents: [], events: [{ at: 0.2, ev: { t: 'Boom', x: px(IMPACT.x), y: px(IMPACT.z), r: px(2.5), k: 10 } }] }),
  },
];

export interface FxOpts { group: FxGroup; start: number; pinned: boolean; slow: number }

/** `&fx=<group>` (default spells), `&t=<s>` pins the clock, `&slow=<n>` slows it. */
export function parseFx(search: string): FxOpts {
  const q = new URLSearchParams(search);
  const g = q.get('fx');
  const t = Number(q.get('t'));
  const slow = Number(q.get('slow') ?? 1);
  return {
    group: FX_GROUPS.includes(g as FxGroup) ? (g as FxGroup) : 'spells',
    start: Number.isFinite(t) && t > 0 ? t : 0,
    pinned: q.has('t') && Number.isFinite(t),
    slow: Number.isFinite(slow) && slow > 0 ? slow : 1,
  };
}

/** The slot's room origin in tiles: slots fill a grid left to right, then down; the bay is below the grid. */
export function slotOrigin(slot: number): { x: number; z: number } {
  return slot === BAY ? { x: 0, z: ROWS * H } : { x: (slot % COLS) * W, z: Math.floor(slot / COLS) * H };
}

function fxMap(): TileMap {
  const w = COLS * W, h = (ROWS + 1) * H;
  const tiles = new Uint8Array(w * h).fill(TILE_ID.Wall);
  for (let s = 0; s <= BAY; s++) {
    const o = slotOrigin(s);
    for (let y = FLOOR.y0; y <= FLOOR.y1; y++) for (let x = FLOOR.x0; x <= FLOOR.x1; x++) tiles[(o.z + y) * w + o.x + x] = TILE_ID.Floor;
    for (const [x, y] of PILLARS) tiles[(o.z + y) * w + o.x + x] = TILE_ID.Wall;
  }
  return new TileMap(w, h, tiles);
}

const slotId = (slot: number, id: number): number => slot * 1000 + id;

/** A scene's event moved into the slot's room (positions in px, ids made unique). */
export function placeEvent(ev: PictureEv, slot: number): PictureEv {
  const o = slotOrigin(slot), dx = px(o.x), dy = px(o.z);
  const e = { ...ev } as Record<string, unknown>;
  if (typeof e.x === 'number') e.x += dx;
  if (typeof e.y === 'number') e.y += dy;
  if (typeof e.x2 === 'number') e.x2 += dx;
  if (typeof e.y2 === 'number') e.y2 += dy;
  if (typeof e.id === 'number') e.id = slotId(slot, e.id);
  return e as unknown as PictureEv;
}

/** A scene's entity moved into the slot's room. */
export function placeEnt(e: EntState, slot: number): EntState {
  const o = slotOrigin(slot);
  return { ...e, id: slotId(slot, e.id), x: e.x + px(o.x), y: e.y + px(o.z) };
}

/** The entities of one slot: the still caster and targets (replaced by the scene's own of the same id), the scene's others, the torches. */
export function slotEnts(slot: number, scene: FxScene, t: number, torchesOn: boolean): EntState[] {
  const own = new Map(scene.ents.map((e) => [e.id, e]));
  const out: EntState[] = [];
  out.push(placeEnt(own.get(CASTER_ID) ?? fxEnt(CASTER_ID, KIND.Wizard, CASTER.x, CASTER.z, { animMs: t * 1000 }), slot));
  TARGETS.forEach(([x, z], i) => out.push(placeEnt(own.get(TARGET_ID + i) ?? fxEnt(TARGET_ID + i, KIND.SkeletonWarrior, x, z, { aim: Math.PI, animMs: t * 1000 + i * 130 }), slot)));
  for (const e of scene.ents) if (e.id !== CASTER_ID && !(e.id >= TARGET_ID && e.id < TARGET_ID + TARGETS.length)) out.push(placeEnt(e, slot));
  TORCH_TILES.forEach((tx, i) => out.push(placeEnt(fxEnt(500 + i, KIND.Torch, tx + 0.5, 3 + 0.5 / TILE, { extra: 0, anim: torchesOn ? 1 : 0 }), slot)));
  return out;
}

/** The events of a row whose time falls in (`from`, `to`] of the row's clock (seconds since it started), with their absolute times. */
export function eventsBetween(row: FxRow, scene: FxScene, from: number, to: number): Array<{ abs: number; ev: PictureEv }> {
  const out: Array<{ abs: number; ev: PictureEv }> = [];
  const P = row.period;
  for (let k = Math.floor(from / P); k <= Math.floor(to / P); k++) {
    for (const e of scene.events) {
      const abs = k * P + e.at;
      if (abs > from && abs <= to) out.push({ abs, ev: e.ev });
    }
  }
  return out.sort((a, b) => a.abs - b.abs);
}

/** The shot ends of a row in (`from`, `to`] of the row's clock, like `eventsBetween`. */
export function endsBetween(row: FxRow, scene: FxScene, from: number, to: number): Array<{ abs: number; shot: ShotView; how: 'wall' | 'enemy' | 'gone' }> {
  const out: Array<{ abs: number; shot: ShotView; how: 'wall' | 'enemy' | 'gone' }> = [];
  if (!scene.shotEnds) return out;
  const P = row.period;
  for (let k = Math.floor(from / P); k <= Math.floor(to / P); k++) {
    for (const e of scene.shotEnds) {
      const abs = k * P + e.at;
      if (abs > from && abs <= to) out.push({ abs, shot: e.shot, how: e.how });
    }
  }
  return out;
}

const ALL_VISIBLE ={ isVisible: (): boolean => true };
const NONE: ReadonlySet<number> = new Set();

export function createFxStage(assets: Assets, p: R3dParams, search: string, host?: Pick<Host, 'setPageButtons' | 'syncPageButtons'>): Stage {
  const opts = parseFx(search);
  const map = fxMap();
  const world: WorldInput = { map, painted: false, clear: 'stone' };
  const figures = new Figures3d({ ...galleryInit(), map }, assets.frames, atlasBounds(assets.image, assets.frames));
  const kit = createStageKit(assets);
  const cam = { x: 7.5, z: 7.6, pitch: (p.pitch * Math.PI) / 180, yaw: (p.yaw * Math.PI) / 180 };
  const pass = new FxPass(NONE);
  let fx = new Effects3d(map);
  let group = opts.group;
  let slow = opts.slow;
  let torchesOn = new URLSearchParams(search).get('torches') !== '0';
  // The page's clock; each row's clock is `t - origin` (Cast now restarts them). `prev` is the row clock events were sent up to.
  let t = opts.start;
  let origin = 0;
  let prev = 0;
  /** Sends the events of the last seconds again on the next frame (a new group, the first frame): records alive by now show. */
  const reseed = (): void => { prev = t - origin - 6; };
  reseed();

  const field = new LightField(map);
  for (let s = 0; s <= BAY; s++) {
    const o = slotOrigin(s);
    TORCH_TILES.forEach((tx, i) => field.add({ id: s * 2 + i + 1, kind: LIGHT_KIND.Torch, colour: 0xffaa5a, x: o.x + tx, y: o.z + 3, on: torchesOn }));
  }
  const pairs = new TorchPairs();

  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;bottom:8px;font:11px monospace;color:#fff;text-shadow:0 0 3px #000;pointer-events:none';
  document.body.appendChild(label);

  const rowsOf = (g: FxGroup): FxRow[] => FX_ROWS.filter((r) => r.group === g).slice(0, SLOTS);
  const home = (): void => { cam.x = 7.5; cam.z = 7.6; };
  host?.setPageButtons([
    ...FX_GROUPS.map((g) => ({
      name: g[0].toUpperCase() + g.slice(1), pressed: () => group === g,
      press: () => { group = g; fx = new Effects3d(map); reseed(); home(); },
    })),
    { name: 'Slow', pressed: () => slow > 1, press: () => { slow = slow > 1 ? 1 : 5; } },
    { name: 'Cast now', pressed: null, press: () => { origin = t; prev = -1e-6; } },
    { name: 'Torches', pressed: () => torchesOn, press: () => { torchesOn = !torchesOn; for (let s = 0; s <= BAY; s++) TORCH_TILES.forEach((_, i) => field.set(s * 2 + i + 1, torchesOn, 0xffaa5a)); } },
  ]);

  return {
    world,
    frame(c: StageCtx): number {
      const dt = c.dt / slow;
      if (!opts.pinned) t += dt;
      cam.pitch = (c.params.pitch * Math.PI) / 180;
      cam.yaw = (c.params.yaw * Math.PI) / 180;
      let ix = 0, iz = 0;
      for (const k of c.held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
      if (ix || iz) {
        const w = keysToWorld(cam.yaw, ix, iz), len = Math.hypot(w.x, w.z) || 1;
        const n = freeClamp(map, cam.x + (w.x / len) * PAN_SPEED * c.dt, cam.z + (w.z / len) * PAN_SPEED * c.dt);
        cam.x = n.x; cam.z = n.z;
      }

      // The rows of the group: entities and events of this frame.
      const rt = t - origin;
      const rows = rowsOf(group);
      const ents: EntState[] = [];
      const extras: SnapExtras = {};
      rows.forEach((row, slot) => {
        const lt = ((rt % row.period) + row.period) % row.period;
        const scene = row.at(lt);
        ents.push(...slotEnts(slot, scene, t, torchesOn));
        const o = slotOrigin(slot);
        if (scene.snapExtras?.drain) (extras.drain ??= []).push(...scene.snapExtras.drain.map(([x, y]): [number, number] => [x + px(o.x), y + px(o.z)]));
        if (scene.snapExtras?.lights) (extras.lights ??= []).push(...scene.snapExtras.lights.map(([x, y, k, col]): [number, number, number, number | null] => [x + px(o.x), y + px(o.z), k, col]));
        for (const e of eventsBetween(row, scene, prev, rt)) {
          const ev = placeEvent(e.ev, slot);
          figures.event(ev);
          fx.event(ev, origin + e.abs, false);
        }
        for (const e of endsBetween(row, scene, prev, rt)) {
          fx.shotEnded({ ...e.shot, x: e.shot.x + px(o.x), y: e.shot.y + px(o.z) }, e.how, origin + e.abs);
        }
      });
      prev = rt;
      // The boss corner and (when the group has no rows) a quiet bay.
      BOSSES.forEach(([kind, x, z], i) => ents.push(placeEnt(fxEnt(200 + i, kind, x, z, { aim: Math.PI, animMs: t * 1000 + i * 90 }), BAY)));
      TORCH_TILES.forEach((tx, i) => ents.push(placeEnt(fxEnt(500 + i, KIND.Torch, tx + 0.5, 3 + 0.5 / TILE, { extra: 0, anim: torchesOn ? 1 : 0 }), BAY)));
      for (const e of ents) if (e.kind === KIND.Torch) pairs.see(e);
      label.textContent = `fx try-out (#308): ${group}${rows.length ? '' : ' (no rows yet)'}: ${rows.map((r) => r.name).join(', ')}; t ${t.toFixed(2)} s; WASD pans`;
      c.timer.lap('sim');
      if (!c.view) return 0;

      const game = c.params.light === 'game';
      const ambient = game ? dungeonAmbient(c.params.amb) : WORK_AMBIENT;
      const frame = galleryFrame(ents, t, dt);
      if (extras.drain || extras.lights) frame.snap = snap({ drain: extras.drain ?? null, lights: extras.lights ?? [] }) as unknown as Snapshot;
      const fo = figures.frame(frame, cam, { ambient, dark: c.params.dark, torchGlow: !game, oval: 1, models: { kit, is: (e) => e.kind !== KIND.Torch } });
      pass.run(fx, { cam, now: t, quality: c.params.quality, figs: fo.figs, ents: frame.ents, shots: [], hiddenShots: NONE, snap: frame.snap, hidden: NONE, you: -1, ownCast: null }, fo.glows);

      const dynamic: Dynamic = { cards: quadsOf(fo.cards), ghosts: quadsOf(fo.ghosts), decals: quadsOf(fo.decals), shadows: shadowsOf(fo.shadows), emissive: quadsOf(fo.emissive), glows: glowsOf(fo.glows) };
      c.timer.lap('cards');
      let lights: Cand[] = [];
      if (game) {
        const cands = [...staticCands(field, pairs, map, t), ...pass.out.lights];
        lights = selectLights(cands, footprint(cam, c.plan.halfW, c.plan.halfH), { x: cam.x, z: cam.z }, Math.min(LIGHT_CAP, c.params.lcap)).list as Cand[];
      }
      const casters = game ? selectCasters(fo.casters, lights, Math.min(CASTER_CAP, c.params.ccap)) : [];
      assignSkips(lights, carrierMap(lights), casters);
      c.timer.lap('lights');
      const r = window.__r3d;
      if (r) { r.figures = figures.count; r.lights = { list: lights.length, inView: lights.length }; r.casters = casters.length; }
      c.timer.renderStart();
      return c.view.draw(
        {
          cam, plan: c.plan, dynamic, lights, ambient, shadows: c.params.shadows, smooth: c.params.smooth, t: c.now,
          see: { openers: seenOpeners(fo.openers, ALL_VISIBLE, new Set()), look: seeLook(c.params) },
          lava: null, lavaVersion: 0, darkvision: null, casters, sight: SIGHT_OFF, models: { insts: fo.models, kit }, fx: { tris: pass.blend, lit: pass.lit },
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
