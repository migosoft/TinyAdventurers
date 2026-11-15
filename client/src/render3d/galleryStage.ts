// The stage of the ?r3d=gallery page (#303): every figure kind cycling through its states, the status-effect looks, the board
// objects and shots, and a corridor behind a full-height wall where things walk for the see-through check. It runs on the real
// path of a run: a synthetic `RunFrame` goes through `Figures3d`, its openers through `seenOpeners` (all visible here), and the
// result into `FrameInput.see`. No server, no login. The 2D twin is `GalleryScene` (game/GalleryScene.ts).
import { ANIM, CONST, EFFECT, FLAG, KIND, LIGHT_KIND, SIDE } from '../generated/defs';
import { LightField } from '../game/light';
import type { PictureEv } from '../run/view';
import type { RunStartInfo } from '../generated/RunStartInfo';
import { FIGURES, PROJECTILES, isPlayerKind } from '../game/anim/defs';
import type { EntState } from '../game/world';
import type { RunFrame, RunViewInit } from '../run/view';
import { atlasBounds } from './atlasBounds';
import { freeClamp, keysToWorld } from './camera';
import { glowsOf, quadsOf, shadowsOf, type Dynamic } from './cards';
import { Figures3d } from './figures';
import { CROWD_MAX, EFFECT_GROUPS, GROUP_CELLS, OBJECT_Z, SHOT_Z, TORCH_Z, layoutOf } from './galleryMap';
import { MOVE_KEYS, type Stage, type StageCtx } from './host';
import { LIGHT_CAP, WORK_AMBIENT, dungeonAmbient } from './light';
import { assignSkips, carrierMap, CASTER_CAP, footprint, selectCasters, selectLights, staticCands, torchOf, TorchPairs } from './lights';
import type { FigureKit } from './models/kit';
import { MODEL_OF_KIND } from './models/table';
import { seenOpeners } from './openers';
import { seeLook } from './seeThrough';
import { createStageKit, modelsReadout } from './stageKit';
import type { Assets, WorldInput } from './view';

const TILE = 16;
/** The free camera's speed in tiles per second. */
const PAN_SPEED = 12;

/** The figure states the rows cycle through, as the 2D gallery lists them. */
export const STATES: [string, number][] = [
  ['idle', ANIM.Idle],
  ['move', ANIM.Move],
  ['melee', ANIM.Melee],
  ['shoot', ANIM.Shoot],
  ['cast', ANIM.Cast],
  ['windup', ANIM.Windup],
  ['dash', ANIM.Dash],
  ['channel', ANIM.Channel],
  ['breath', ANIM.Breath],
  ['tail', ANIM.Tail],
  ['bite', ANIM.Bite],
  ['takeoff', ANIM.TakeOff],
  ['land', ANIM.Land],
];

export const GALLERY = layoutOf(Object.keys(FIGURES).length);

/** Entity ids by part of the stage. */
export const ID = {
  figure: 100,
  effect: 1000,
  object: 2000,
  barrelCycle: 2003,
  shot: 2500,
  corridor: 3000,
  corridorBarrel: 3009,
  corridorKnight: 3010,
  /** What opens walls in the corridor: the hero, five skeletons, the wolf, the chest and the closed mimic. */
  corridorOpeners: [3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008],
  /** The 3D models (#338): one row per kind with a model, the effect rows (`+ row * 10 + col`), the figures that die, the pillars' torches, the crowd. */
  model: 4000,
  modelEffect: 4100,
  dying: 4300,
  pillarTorch: 4900,
  crowd: 5000,
} as const;

export type Focus = 'figures' | 'corridor' | 'effects' | 'objects' | 'models';
export interface GalleryOpts {
  state: string | null; slow: number; focus: Focus; start: number;
  /** Walking model figures added in a 2 tile grid, and whether they are drawn as models or as cards. */
  crowd: number; crowdAs: 'models' | 'cards';
  /** `torch`: the gallery is lit by its torches through the game's lights and casters, not by the work light. */
  light: 'work' | 'torch';
  /** The camera's start in tiles (overrides the focus). */
  at: { x: number; z: number } | null;
  /** `&aim=<deg>` (radians here): pins the aim of the figure rows and the model rows (90 faces the camera). */
  aim: number | null;
}

/**
 * `&state=<name>` pins one state, `&slow=<n>` slows the clock, `&focus=` picks where the camera starts (`&at=x,z` in tiles, or
 * `&at=model:<i>` / `effect:<row>,<col>` / `dying:<i>` / `crowd:<i>`, overrides it),
 * `&t=<s>` starts the clock there (the hurt flash is on at 0), `&crowd=<n>` adds walking model figures (`&crowdAs=cards` as cards),
 * `&light=torch` lights it with the torches.
 */
export function parseGallery(search: string): GalleryOpts {
  const q = new URLSearchParams(search);
  const state = q.get('state');
  const slow = Number(q.get('slow') ?? 1);
  const focus = q.get('focus');
  const start = Number(q.get('t') ?? 0);
  const crowd = Math.floor(Number(q.get('crowd') ?? 0));
  const atRaw = q.get('at') ?? '';
  // `at=x,z` in tiles, or the foot of a figure of the model block: `model:<kind>`, `effect:<row>,<col>`, `dying:<i>`, `crowd:<i>`.
  const named = /^(model|effect|dying|crowd):(\d+)(?:,(\d+))?$/.exec(atRaw);
  const at = named
    ? (() => {
      const [, what, a, b] = named;
      const n = Number(a);
      return what === 'model' ? GALLERY.model(n) : what === 'effect' ? GALLERY.modelEffect(n, Number(b ?? 0)) : what === 'dying' ? GALLERY.dying(n) : GALLERY.crowd(n);
    })()
    : null;
  const xz = atRaw.split(',').map(Number);
  return {
    start: Number.isFinite(start) && start > 0 ? start : 0,
    state: STATES.some(([n]) => n === state) ? state : null,
    slow: Number.isFinite(slow) && slow > 0 ? slow : 1,
    focus: focus === 'corridor' || focus === 'effects' || focus === 'objects' || focus === 'models' ? focus : 'figures',
    crowd: Number.isFinite(crowd) && crowd > 0 ? Math.min(crowd, CROWD_MAX) : 0,
    crowdAs: q.get('crowdAs') === 'cards' ? 'cards' : 'models',
    light: q.get('light') === 'torch' ? 'torch' : 'work',
    at: at ?? (xz.length === 2 && xz.every(Number.isFinite) ? { x: xz[0], z: xz[1] } : null),
    aim: q.get('aim') !== null && Number.isFinite(Number(q.get('aim'))) ? (Number(q.get('aim')) * Math.PI) / 180 : null,
  };
}

/** Which entities the stage draws as 3D models: the model blocks (ids from `ID.model` up) and the crowd unless it is cards. */
export function modelsOf(o: GalleryOpts): (e: EntState) => boolean {
  return (e) => e.id >= ID.model && (e.id < ID.crowd || o.crowdAs === 'models');
}

const ent = (id: number, kind: number, x: number, z: number, o: Partial<EntState> = {}): EntState => ({
  id, kind, x: x * TILE, y: z * TILE, hp: 10, anim: ANIM.Idle, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0,
  side: isPlayerKind(kind) ? SIDE.Friendly : SIDE.Hostile, entangled: 0, ...o,
});

/** The effect groups: what each shows, in order (the last is the party, invisible). */
const EFFECT_ROWS: { effect?: number; flag?: number; run?: boolean }[] = [
  { effect: EFFECT.Sleep }, { effect: EFFECT.Petrified }, { effect: EFFECT.Frozen }, { effect: EFFECT.Slowed, run: true }, { effect: EFFECT.Poisoned },
  { effect: EFFECT.Chilled, run: true }, { effect: EFFECT.Tainted }, { flag: FLAG.INCORPOREAL }, {}, { effect: EFFECT.Invisible },
];
const EFFECT_KINDS = [KIND.Knight, KIND.SkeletonWarrior, KIND.Ogre, KIND.Lich];
const PARTY_KINDS = [KIND.Wizard, KIND.Paladin, KIND.Barbarian, KIND.ElvenRanger];
/** The model block's effect rows: every row of `EFFECT_ROWS` that shows something (not the plain wading one), for the four heroes, a skeleton, the ogre and the wolf. */
const MODEL_EFFECT_ROW_LIST = EFFECT_ROWS.filter((r) => r.effect !== undefined || r.flag !== undefined);
const MODEL_EFFECT_KINDS = [KIND.Wizard, KIND.Paladin, KIND.Barbarian, KIND.ElvenRanger, KIND.SkeletonWarrior, KIND.Ogre, KIND.DireWolf];
/** The kinds with a model, in the order of the model rows. */
const MODEL_KINDS = Object.keys(MODEL_OF_KIND).map(Number);
/** A figure of the dying row lives this many seconds of every `DIE_PERIOD`, then dies (and leaves its skull). */
const DIE_PERIOD = 6;
const DIE_AT = 3;

/** The dying row's figures alive at time `t`: the first `DIE_AT` seconds of every period. */
function dyingAt(t: number): EntState[] {
  if (t % DIE_PERIOD >= DIE_AT) return [];
  return MODEL_KINDS.map((k, i) => {
    const p = GALLERY.dying(i);
    return ent(ID.dying + i, k, p.x, p.z, { anim: ANIM.Idle, animMs: (t % 1) * 1000 });
  });
}

/** The `Died` events of the dying row between two times (the stage sends them to the figures, which leave a skull): one per figure when a period's `DIE_AT` falls in (t0, t1]. */
export function diedBetween(t0: number, t1: number): Extract<PictureEv, { t: 'Died' }>[] {
  if (Math.floor((t1 - DIE_AT) / DIE_PERIOD) === Math.floor((t0 - DIE_AT) / DIE_PERIOD)) return [];
  return dyingAt(0).map((e) => ({ t: 'Died', id: e.id, x: e.x, y: e.y, kind: e.kind }));
}

/** A walker: `base` and `amp` in tiles, `w` rad/s. Its position, and the aim it faces while it goes. */
function walk(base: number, amp: number, w: number, ph: number, t: number): { x: number; aim: number } {
  return { x: base + amp * Math.sin(w * t + ph), aim: Math.cos(w * t + ph) >= 0 ? 0 : Math.PI };
}

/** The barrel's cycle as `GalleryScene` runs it: rest, fuse, fall, rest, sink. */
const BARREL_STEPS: [number, number][] = [[0, 1], [1, CONST.BARREL_FUSE], [2, CONST.FALL_TIME + 0.3], [0, 1], [3, CONST.DROWN_TIME + 0.3]];
function barrelAt(t: number): { anim: number; animMs: number } {
  const total = BARREL_STEPS.reduce((s, [, d]) => s + d, 0);
  let bt = t % total;
  let step = BARREL_STEPS[0];
  for (const s of BARREL_STEPS) { step = s; if (bt < s[1]) break; bt -= s[1]; }
  return { anim: step[0], animMs: bt * 1000 };
}

/** Every entity of the stage at gallery time `t` (s); `state` pins a state (else the 1.2 s cycle); `crowd` walking model figures are added. */
export function galleryEnts(t: number, state: string | null, crowd = 0, aimPin: number | null = null): EntState[] {
  const out: EntState[] = [];
  // Figure rows: the state cycle, the hurt flash every 3 s, the aim swinging and turning every 4 s.
  const only = STATES.findIndex(([n]) => n === state);
  const [, anim] = STATES[only >= 0 ? only : Math.floor(t / 1.2) % STATES.length];
  const animMs = ((t % 1.2) % 0.5) * 1000;
  const aim = aimPin ?? Math.sin(t * 0.7) * 0.6 + (Math.floor(t / 4) % 2 ? Math.PI : 0);
  const hurt = Math.floor(t * 2) % 6 === 0 ? FLAG.HURT : 0;
  Object.keys(FIGURES).map(Number).forEach((k, i) => {
    const p = GALLERY.figure(i);
    out.push(ent(ID.figure + i, k, p.x + (anim === ANIM.Move ? (Math.sin(t * 3) * 6) / TILE : 0), p.z, { anim, animMs, aim, flags: hurt }));
  });

  // The model block: a row of the kinds with a model, cycling like the card rows; the effect rows; the figures that die; the pillars' torches; the crowd.
  MODEL_KINDS.forEach((k, i) => {
    const p = GALLERY.model(i);
    out.push(ent(ID.model + i, k, p.x + (anim === ANIM.Move ? (Math.sin(t * 3) * 6) / TILE : 0), p.z, { anim, animMs, aim, flags: hurt }));
  });
  const swapM = Math.floor(t / 4) % 2;
  MODEL_EFFECT_ROW_LIST.forEach((row, r) => MODEL_EFFECT_KINDS.forEach((kind, c) => {
    const p = GALLERY.modelEffect(r, c);
    const dx = row.run ? Math.sin(t * 3) * (18 / TILE) : 0;
    out.push(ent(ID.modelEffect + r * 10 + c, kind, p.x + dx, p.z, {
      anim: row.run ? ANIM.Move : ANIM.Idle, animMs: (t % 1) * 1000,
      aim: row.run ? (Math.cos(t * 3) > 0 ? 0 : Math.PI) : (c + swapM) % 2 ? Math.PI : 0,
      effects: row.effect !== undefined ? 1 << row.effect : 0, flags: row.flag ?? 0,
    }));
  }));
  out.push(...dyingAt(t));
  GALLERY.pillarTorches.forEach((p, i) => out.push(ent(ID.pillarTorch + i, KIND.Torch, p.x, p.z, { side: SIDE.Neutral, anim: 1, extra: 0 })));
  for (let i = 0; i < crowd; i++) {
    const p = GALLERY.crowd(i);
    const w = walk(p.x, 0.4, 1 + (i % 5) * 0.2, i * 0.9, t);
    out.push(ent(ID.crowd + i, MODEL_KINDS[i % MODEL_KINDS.length], w.x, p.z, { anim: ANIM.Move, animMs: t * 1000 + i * 70, aim: w.aim }));
  }

  // Effect groups: idle (the slowed and chilled run back and forth); asleep and stone figures keep a facing, alternating every 4 s.
  const swap = Math.floor(t / 4) % 2;
  EFFECT_ROWS.forEach((row, g) => {
    for (let k = 0; k < GROUP_CELLS; k++) {
      const p = GALLERY.effect(g, k);
      const kind = (g === EFFECT_GROUPS - 1 ? PARTY_KINDS : EFFECT_KINDS)[k];
      const dx = row.run ? Math.sin(t * 3) * (18 / TILE) : 0;
      out.push(ent(ID.effect + g * 10 + k, kind, p.x + dx, p.z, {
        anim: row.run ? ANIM.Move : ANIM.Idle, animMs: (t % 1) * 1000,
        aim: row.run ? (Math.cos(t * 3) > 0 ? 0 : Math.PI) : (k + swap) % 2 ? Math.PI : 0,
        effects: row.effect !== undefined ? 1 << row.effect : 0, flags: row.flag ?? 0,
      }));
    }
  });

  // World objects: a chest, an opening chest, a barrel, the cycling explosive barrel, three mimics, a lit and an unlit torch.
  const ox = (i: number): number => 4 + i * 3;
  out.push(ent(ID.object, KIND.Chest, ox(0), OBJECT_Z, { side: SIDE.Neutral }));
  out.push(ent(ID.object + 1, KIND.Chest, ox(1), OBJECT_Z, { side: SIDE.Neutral, anim: 1, animMs: (t % 3) * 1000 }));
  out.push(ent(ID.object + 2, KIND.Barrel, ox(2), OBJECT_Z, { side: SIDE.Neutral }));
  out.push(ent(ID.barrelCycle, KIND.Barrel, ox(3), OBJECT_Z, { side: SIDE.Neutral, ...barrelAt(t) }));
  out.push(ent(ID.object + 4, KIND.Mimic, ox(4), OBJECT_Z, { flags: FLAG.HIDING }));
  out.push(ent(ID.object + 5, KIND.Mimic, ox(5), OBJECT_Z, { anim: ANIM.Move, animMs: t * 1000, aim: Math.cos(t * 2) > 0 ? 0 : Math.PI }));
  out.push(ent(ID.object + 6, KIND.Mimic, ox(6), OBJECT_Z, t % 6 < 3 ? { flags: FLAG.HIDING } : {})); // it gives itself away every 6 s
  out.push(ent(ID.object + 7, KIND.Torch, 26.5, TORCH_Z, { side: SIDE.Neutral, anim: 1, extra: 0 }));
  out.push(ent(ID.object + 8, KIND.Torch, 29.5, TORCH_Z, { side: SIDE.Neutral, anim: 0, extra: 0 }));
  // Shots of every kind, each flying along its row in a loop.
  Object.keys(PROJECTILES).map(Number).forEach((k, i) => {
    out.push(ent(ID.shot + i, k, 3 + i * 2.6 + ((t * 5) % 2) - 1, SHOT_Z, { side: SIDE.Neutral }));
  });

  // The corridor: a hero, five skeletons close together, a wolf, a chest, a closed mimic, a barrel and a Neutral knight.
  const c = ID.corridor;
  const move = (e: { x: number; aim: number }) => ({ anim: ANIM.Move, animMs: t * 1000, aim: e.aim });
  const hero = walk(22, 3, 1.1, 0, t);
  out.push(ent(c, KIND.Wizard, hero.x, 3.4, move(hero)));
  for (let i = 0; i < 5; i++) {
    const s = walk(15 + 1.1 * i, 1.5, 0.9, i * 0.7, t);
    out.push(ent(c + 1 + i, KIND.SkeletonWarrior, s.x, 1.7 + (i % 3) * 0.8, move(s)));
  }
  const wolf = walk(25, 3, 1.3, 1, t);
  out.push(ent(c + 6, KIND.DireWolf, wolf.x, 3.5, move(wolf)));
  out.push(ent(c + 7, KIND.Chest, 29.5, 3.6, { side: SIDE.Neutral }));
  out.push(ent(c + 8, KIND.Mimic, 34, 3.6, { flags: FLAG.HIDING }));
  // Right behind the wall, where it would hide them: neither opens it.
  out.push(ent(ID.corridorBarrel, KIND.Barrel, 8.5, 3.75, { side: SIDE.Neutral }));
  const knight = walk(6, 3, 1, 0.5, t);
  out.push(ent(ID.corridorKnight, KIND.Knight, knight.x, 3.75, { side: SIDE.Neutral, ...move(knight) }));
  return out;
}

/** The frame of a run's view for `ents`: no own hero, no shots of its own. */
export function galleryFrame(ents: readonly EntState[], now: number, dt: number): RunFrame {
  return {
    dt, now, ents: new Map(ents.map((e) => [e.id, e])), you: -1,
    own: { x: 0, y: 0, alive: false, charmed: false, anim: ANIM.Idle, animT: 0, aim: 0, aimsAtPointer: false, aimFromX: 0, aimFromY: 0, flags: 0, effects: 0, entangled: 0, dashing: false, sinking: false },
    watching: null, camera: { x: 0, y: 0 }, snap: undefined, shots: [], hiddenShots: new Set(), useHint: null, dark: new Set(),
    debug: { on: false, path: [], ogre: [], cove: [], notice: [], dodges: [] },
  };
}

/** What `Figures3d` reads of a run's start: the map, no players of its own (nobody is "you"), and a kind for the own figure. */
export function galleryInit(): RunViewInit {
  return { info: { players: [] } as unknown as RunStartInfo, map: GALLERY.map, light: undefined as unknown as RunViewInit['light'], myKind: KIND.Wizard };
}

/** Everything is in sight in the gallery. */
const ALL_VISIBLE = { isVisible: (): boolean => true };

/** `deps.kit` is for tests; a stage makes its own and ends it. */
export function createGalleryStage(assets: Assets, initial: { pitch: number; yaw: number }, search: string, deps: { kit?: FigureKit } = {}): Stage {
  const opts = parseGallery(search);
  const map = GALLERY.map;
  const world: WorldInput = { map, painted: false, clear: 'stone' };
  const figures = new Figures3d(galleryInit(), assets.frames, atlasBounds(assets.image, assets.frames));
  // One kit for the stage, kept across a rebuilt view (the new layer draws from its cached models).
  const kit = deps.kit ?? createStageKit(assets);
  const is = modelsOf(opts);
  const at = opts.at ?? GALLERY.focus[opts.focus];
  const cam = { x: at.x, z: at.z, pitch: (initial.pitch * Math.PI) / 180, yaw: (initial.yaw * Math.PI) / 180 };
  let t = opts.start;
  // `light=torch`: the torches (the lit one on the objects' wall and the pillars') light the gallery through the game's lights and casters.
  const field = new LightField(map);
  const pairs = new TorchPairs();
  if (opts.light === 'torch') {
    let id = 1;
    for (const e of galleryEnts(0, null)) {
      if (e.kind !== KIND.Torch || e.anim !== 1) continue;
      const tc = torchOf(e);
      field.add({ id: id++, kind: LIGHT_KIND.Torch, colour: 0xffaa5a, x: tc.tx, y: tc.tz, on: true });
    }
  }

  // A caption with the state on show.
  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;bottom:8px;font:11px monospace;color:#fff;text-shadow:0 0 3px #000;pointer-events:none';
  document.body.appendChild(label);

  return {
    world,
    frame(c: StageCtx): number {
      const dt = c.dt / opts.slow;
      const t0 = t;
      t += dt;
      cam.pitch = (c.params.pitch * Math.PI) / 180;
      cam.yaw = (c.params.yaw * Math.PI) / 180;
      let ix = 0;
      let iz = 0;
      for (const k of c.held) { ix += MOVE_KEYS[k][0]; iz += MOVE_KEYS[k][1]; }
      if (ix || iz) {
        const w = keysToWorld(cam.yaw, ix, iz);
        const len = Math.hypot(w.x, w.z) || 1;
        const p = freeClamp(map, cam.x + (w.x / len) * PAN_SPEED * c.dt, cam.z + (w.z / len) * PAN_SPEED * c.dt);
        cam.x = p.x;
        cam.z = p.z;
      }
      const only = STATES.findIndex(([n]) => n === opts.state);
      label.textContent = `state: ${STATES[only >= 0 ? only : Math.floor(t / 1.2) % STATES.length][0]} (hurt flash every 3 s); WASD pans`;
      c.timer.lap('sim');
      if (!c.view) return 0;
      // The figures that died since the last frame leave their skulls; the event comes before the frame that no longer has them.
      for (const ev of diedBetween(t0, t)) figures.event(ev);
      const ents = galleryEnts(t, opts.state, opts.crowd, opts.aim);
      const torch = opts.light === 'torch';
      if (torch) for (const e of ents) if (e.kind === KIND.Torch) pairs.see(e);
      const ambient = torch ? dungeonAmbient(c.params.amb) : WORK_AMBIENT;
      const fo = figures.frame(galleryFrame(ents, t, dt), cam, { ambient, dark: c.params.dark, torchGlow: !torch, oval: 1, models: { kit, is } });
      const dynamic: Dynamic = { cards: quadsOf(fo.cards), ghosts: quadsOf(fo.ghosts), decals: quadsOf(fo.decals), shadows: shadowsOf(fo.shadows), emissive: quadsOf(fo.emissive), glows: glowsOf(fo.glows) };
      c.timer.lap('cards');
      let lights: ReturnType<typeof selectLights>['list'] = [];
      let casters: ReturnType<typeof selectCasters> = [];
      if (torch) {
        const fp = footprint(cam, c.plan.halfW, c.plan.halfH);
        lights = selectLights(staticCands(field, pairs, map, t), fp, { x: cam.x, z: cam.z }, Math.min(LIGHT_CAP, c.params.lcap)).list;
        casters = selectCasters(fo.casters, lights, Math.min(CASTER_CAP, c.params.ccap));
        assignSkips(lights, carrierMap(lights), casters);
      }
      c.timer.lap('lights');
      const r = window.__r3d;
      if (r) {
        r.figures = figures.count;
        r.models = modelsReadout(kit, c.view.figuresDrawn ?? { figures: 0, batches: 0, draws: 0 });
        r.lights = { list: lights.length, inView: lights.length };
        r.casters = casters.length;
      }
      c.timer.renderStart();
      return c.view.draw(
        {
          cam, plan: c.plan, dynamic, lights, ambient, lava: null, lavaVersion: 0, darkvision: null, casters, shadows: c.params.shadows, smooth: c.params.smooth, t: c.now,
          see: { openers: seenOpeners(fo.openers, ALL_VISIBLE, new Set()), look: seeLook(c.params) }, models: { insts: fo.models, kit },
        },
        c.timer,
      );
    },
    dispose(): void {
      label.remove();
      if (!deps.kit) kit.dispose();
    },
  };
}
