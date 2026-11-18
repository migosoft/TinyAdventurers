import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodePng } from '../../scripts/png';
import { ROW, ROW_TEXELS, packInstance } from './models/instances';
import { cardHeight, createKit, directRunner, type FigureKit } from './models/kit';
import { BONES } from './models/model';
import { LIE_SINK, sideReach } from './models/pose3d';
import { variationOf } from './models/variation';
import { DESCS, FIT_KIND, modelKeyOf, outlineFrame, TUBE_DESCS, type DescKey } from './models/table';
import type { SpritePixels } from './models/weapons';
import { ANIM, CONST, EFFECT, FLAG, KIND, SIDE, TILE_ID } from '../generated/defs';
import { FIGURES, PROJECTILES } from '../game/anim/defs';
import { INCORPOREAL_ALPHA, VANISH_SECS } from '../game/anim/entityAlpha';
import type { FrameBounds } from '../game/anim/pose';
import { CHEST_HEIGHT } from '../game/objectPose';
import { TILE, TileMap } from '../sim/map';
import type { EntState } from '../game/world';
import type { OwnHero, RunFrame, RunViewInit, ShotView } from '../run/view';
import { startInfo } from '../run/testing';
import { LIE_Y, type CardBuf } from './cards';
import { project, snapGround, type Cam } from './camera';
import { bedAt, depthFade, LAVA_LEVEL, NOTHING_HIDDEN, walkBedAt, WATER_LEVEL } from './dips/shape';
import { LAVA_SHARE } from './dips/descent';
import { AMBIENT } from './light';
import { Figures3d, screenAim, type FigureOut } from './figures';
import type { FrameRects } from './worldMesh';

const FIG = { w: 16, h: 28 };
const frames: FrameRects = {};
const add = (name: string | undefined, w: number, h: number) => {
  if (name) frames[name] = { x: 10, y: 20, w, h };
};
for (const d of Object.values(FIGURES)) {
  for (let i = 0; i < 4; i++) for (const p of [d.idle, d.run]) add(`${p}${i}`, FIG.w, FIG.h);
  add(d.hit, FIG.w, FIG.h);
  add(d.weapon, 8, 20);
  add(d.meleeWeapon, 8, 20);
  for (const a of Object.values(d.frames ?? {})) for (let i = 0; i < a.n; i++) add(`${a.prefix}${i}`, 86, 54);
}
for (const p of Object.values(PROJECTILES)) add(p.frame, 8, 16);
add('skull', 16, 16);

const bounds = (f: string): FrameBounds => {
  const r = frames[f] ?? { w: 16, h: 16 };
  return { l: 0, r: r.w - 1, t: 0, w: r.w, h: r.h };
};
const at = (tx: number) => tx * TILE + TILE / 2;
const cam = (yaw = 0): Cam => ({ x: 5, z: 5, pitch: Math.PI / 4, yaw });

/** A 4x1 map of floor: the tests that need terrain use `dipMap` below. */
const map = (): TileMap => new TileMap(4, 1, new Uint8Array(4).fill(TILE_ID.Floor));
const init = (): RunViewInit => ({ info: startInfo(['....']), map: map(), light: {} as RunViewInit['light'], myKind: KIND.Wizard });

const own = (o: Partial<OwnHero> = {}): OwnHero => ({ x: at(0), y: 8, alive: false, charmed: false, anim: ANIM.Idle, animT: 0, aim: 0, flags: 0, effects: 0, entangled: 0, dashing: false, sinking: false, aimsAtPointer: false, aimFromX: at(0), aimFromY: 8, ...o });
const ent = (id: number, kind: number, o: Partial<EntState> = {}): EntState => ({ id, kind, x: at(0), y: 8, hp: 10, anim: ANIM.Idle, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0, side: SIDE.Hostile, entangled: 0, ...o });
const frame = (ents: EntState[], o: Partial<RunFrame> = {}): RunFrame => ({
  dt: 0.016, now: 10, ents: new Map(ents.map((e) => [e.id, e])), you: 1, own: own(), watching: null, camera: { x: 0, y: 0 }, snap: undefined, shots: [], hiddenShots: new Set(),
  useHint: null, ownCast: null, dark: new Set(), debug: { on: false, path: [], ogre: [], cove: [], notice: [], dodges: [] }, ...o,
});
const make = () => new Figures3d(init(), frames, bounds);

/** Vertex y values of quad `q`. */
const ys = (b: CardBuf, q = 0): number[] => Array.from({ length: 6 }, (_, i) => b.position[(q * 6 + i) * 3 + 1]);
const xs = (b: { position: number[] }, q = 0): number[] => Array.from({ length: 6 }, (_, i) => b.position[(q * 6 + i) * 3]);
const mid = (v: number[]) => (Math.min(...v) + Math.max(...v)) / 2;
/** The texture is mirrored when the top-left corner reads a larger u than the bottom-right one. */
const mirrored = (b: CardBuf, q = 0): boolean => b.uv[q * 12] > b.uv[q * 12 + 4];
const total = (o: { cards: CardBuf; ghosts: CardBuf; decals: CardBuf }) => o.cards.n + o.ghosts.n + o.decals.n;

describe('screenAim', () => {
  it('is the aim as it appears on screen, y down', () => {
    expect(screenAim(0, 0.7)).toBe(0.7);
    expect(screenAim(Math.PI / 2, 0)).toBeCloseTo(-Math.PI / 2, 12);
    // the camera's right vector at yaw y is (cos y, sin y): the world direction (cos a, sin a) is screen right by cos(a - y)
    for (const [yaw, a] of [[0.3, 1.1], [2, -1], [-1.2, 0.4]]) {
      const xr = Math.cos(a) * Math.cos(yaw) + Math.sin(a) * Math.sin(yaw);
      const zr = Math.sin(a) * Math.cos(yaw) - Math.cos(a) * Math.sin(yaw);
      expect(Math.cos(screenAim(yaw, a))).toBeCloseTo(xr / Math.hypot(xr, zr), 12);
      expect(Math.sin(screenAim(yaw, a))).toBeCloseTo(zr / Math.hypot(xr, zr), 12);
    }
  });
});

describe('Figures3d', () => {
  it('draws one body card per figure kind, and a weapon card for the armed ones', () => {
    const kinds = Object.keys(FIGURES).map(Number);
    const fg = make();
    expect(fg.count).toBe(0);
    fg.frame(frame(kinds.map((k, i) => ent(10 + i, k))), cam());
    expect(fg.count).toBe(kinds.length);
    for (const k of kinds) {
      const one = make().frame(frame([ent(10, k)]), cam());
      expect(total(one), `kind ${k}`).toBe(FIGURES[k].weapon ? 2 : 1);
    }
  });

  it('draws nothing for a dead figure, and one skull on the floor after it died, none when it was lost', () => {
    const fg = make();
    const dead = ent(10, KIND.Knight, { flags: FLAG.DEAD });
    const a = fg.frame(frame([dead]), cam());
    expect(total(a)).toBe(0);
    expect(fg.count).toBe(0);
    fg.event({ t: 'Died', id: 10, x: at(1), y: 8, kind: KIND.Knight });
    const b = fg.frame(frame([]), cam());
    expect(b.decals.n).toBe(1);
    expect(ys(b.decals).every((y) => y === LIE_Y)).toBe(true);

    const lost = make();
    lost.event({ t: 'Sink', id: 11, x: at(1), y: 8, how: 0 });
    lost.event({ t: 'Died', id: 11, x: at(1), y: 8, kind: KIND.Knight });
    expect(lost.frame(frame([]), cam()).decals.n).toBe(0);

    const ghost = make();
    ghost.event({ t: 'Died', id: 12, x: at(1), y: 8, kind: KIND.Ghost });
    expect(ghost.frame(frame([]), cam()).decals.n).toBe(0);
  });

  it('lays the skull flat and upright on the screen: its top edge is farther from the camera, at any yaw', () => {
    for (const yaw of [0, Math.PI / 2]) {
      const c = cam(yaw);
      const fg = make();
      fg.event({ t: 'Died', id: 10, x: at(1), y: 8, kind: KIND.Knight });
      const out = fg.frame(frame([]), c);
      expect(out.decals.n).toBe(1);
      const depth = (v: number): number => {
        const d: number[] = [];
        for (let i = 0; i < 6; i++) if (out.decals.uv[i * 2 + 1] === v) d.push(project(c, out.decals.position[i * 3], 0, out.decals.position[i * 3 + 2]).depth);
        return d.reduce((a, x) => a + x, 0) / d.length;
      };
      const top = depth(20), bottom = depth(36); // skull: y 20, h 16
      expect(top).toBeGreaterThan(bottom);
      // 2 / 16 tile up the screen from the death spot
      const centre = project(c, mid(xs(out.decals)), 0, mid(Array.from({ length: 6 }, (_, i) => out.decals.position[i * 3 + 2])));
      const spot = project(c, at(1) / TILE, 0, 8 / TILE);
      expect(spot.depth - centre.depth).toBeCloseTo((-2 / TILE) * Math.cos(c.pitch), 1); // within the pixel snap
    }
  });

  it('moves the standing body 1 / 16 tile toward the camera on the ground, the shadow stays at the entity', () => {
    for (const yaw of [0, Math.PI / 2]) {
      const c = cam(yaw);
      const out = make().frame(frame([ent(10, KIND.Knight, { x: 88, y: 88 })]), c);
      const foot = snapGround(c.pitch, yaw, 5.5, 5.5);
      const body = snapGround(c.pitch, yaw, 5.5 - Math.sin(yaw) / TILE, 5.5 + Math.cos(yaw) / TILE); // screen down on the ground is (-sin yaw, cos yaw)
      const zs = (b: { position: number[] }) => mid(Array.from({ length: 6 }, (_, i) => b.position[i * 3 + 2]));
      // the card's extent is along screen right, so its mid is the foot on the other axis
      expect(mid(xs(out.cards))).toBeCloseTo(body.x, 5);
      expect(zs(out.cards)).toBeCloseTo(body.z, 5);
      expect(mid(xs(out.shadows))).toBeCloseTo(foot.x, 6);
      expect(zs(out.shadows)).toBeCloseTo(foot.z, 6);
    }
  });

  it('keeps the alpha of a sleeping incorporeal figure in the floor decals', () => {
    const e = ent(10, KIND.SkeletonWarrior, { flags: FLAG.INCORPOREAL, effects: 1 << EFFECT.Sleep });
    const out = make().frame(frame([e]), cam());
    expect(out.decals.n).toBe(1);
    expect(out.decals.look[4]).toBeCloseTo(INCORPOREAL_ALPHA, 6);
  });

  it('draws a skull under a figure sleeping on the same spot: the skull comes first in the decals (#318)', () => {
    const fg = make();
    fg.event({ t: 'Died', id: 11, x: at(1), y: 8, kind: KIND.Knight });
    const out = fg.frame(frame([ent(10, KIND.Knight, { effects: 1 << EFFECT.Sleep })]), cam());
    expect(out.decals.n).toBe(2);
    // The decal pass draws in buffer order without depth writes: the later quad is on top. The skull's alpha is 0.85, the knight's 1.
    expect(out.decals.look[4]).toBeCloseTo(0.85, 6);
    expect(out.decals.look[6 * 5 + 4]).toBeCloseTo(1, 6);
  });

  it('lays a sleeping knight on the floor: body in the decals, every y at LIE_Y', () => {
    const e = ent(10, KIND.Knight, { effects: 1 << EFFECT.Sleep });
    const out = make().frame(frame([e]), cam());
    expect(out.cards.n).toBe(0);
    expect(out.decals.n).toBe(1);
    expect(ys(out.decals).every((y) => y === LIE_Y)).toBe(true);
  });

  it('sends an incorporeal skeleton to the translucent pass at the incorporeal alpha', () => {
    const e = ent(10, KIND.SkeletonWarrior, { flags: FLAG.INCORPOREAL });
    const out = make().frame(frame([e]), cam());
    expect(out.cards.n).toBe(0);
    expect(out.ghosts.n).toBe(2);
    expect(out.ghosts.look[4]).toBeCloseTo(INCORPOREAL_ALPHA, 6);
  });

  it('draws a server shot unless hidden, and the own shots from f.shots at height 0.5', () => {
    const server = ent(20, KIND.Missile);
    const hidden = make().frame(frame([server], { hiddenShots: new Set([20]) }), cam());
    expect(hidden.glows.n).toBe(0);
    // glow shots leave the card glow list: the effects system draws them
    expect(make().frame(frame([server]), cam()).glows.n).toBe(0);
    const shot: ShotView = { shot: 1, kind: KIND.Arrow, x: at(1), y: 8, vx: 100, vy: 0 };
    const out = make().frame(frame([ent(20, KIND.Arrow)], { hiddenShots: new Set([20]), shots: [shot] }), cam());
    expect(out.cards.n).toBe(1);
    expect(mid(ys(out.cards))).toBeCloseTo(0.5, 6);
    const g = make().frame(frame([], { shots: [{ ...shot, kind: KIND.Fireball }] }), cam());
    expect(g.glows.n).toBe(0);
  });

  it('keeps the facing inside the dead zone when the aim runs into the screen', () => {
    const fg = make();
    const left = ent(10, KIND.Knight, { aim: Math.PI });
    expect(mirrored(fg.frame(frame([left]), cam(0)).cards)).toBe(true);
    // at yaw 90 degrees an aim along +x is straight into the screen
    const into = ent(10, KIND.Knight, { aim: 0 });
    expect(mirrored(fg.frame(frame([into]), cam(Math.PI / 2)).cards)).toBe(true);
    // then out of the dead zone to the right
    const right = ent(10, KIND.Knight, { aim: Math.PI / 2 });
    expect(mirrored(fg.frame(frame([right]), cam(Math.PI / 2)).cards)).toBe(false);
  });

  it('steps a melee knight 3 / 16 tiles along the world aim at the start of the swing', () => {
    const e = (anim: number) => ent(10, KIND.Knight, { x: 88, y: 88, aim: 0, anim, animMs: 0 });
    const a = make().frame(frame([e(ANIM.Idle)]), cam());
    const b = make().frame(frame([e(ANIM.Melee)]), cam());
    expect(mid(xs(b.cards)) - mid(xs(a.cards))).toBeCloseTo(3 / 16, 6);
  });

  it('keeps a wading figure an opener, but not one that falls or drowns (Task 7 fix)', () => {
    const wade = make().frame(frame([ent(10, KIND.Knight, { x: at(3), side: SIDE.Friendly })]), cam());
    expect(wade.openers.map((o) => o.id)).toEqual([10]);
    const fell = make();
    fell.event({ t: 'Sink', id: 11, x: at(2), y: 8, how: 0 });
    expect(fell.frame(frame([ent(11, KIND.Knight, { x: at(2), side: SIDE.Friendly })]), cam()).openers).toEqual([]);
    const drowned = make();
    drowned.event({ t: 'Sink', id: 12, x: at(1), y: 8, how: 1 });
    expect(drowned.frame(frame([ent(12, KIND.Knight, { x: at(1), side: SIDE.Friendly })]), cam()).openers).toEqual([]);
  });

  it('starts a fall that came before the first frame on that frame, not at clock 0 (#319)', () => {
    const fallen = (f: Figures3d) => f.frame(frame([ent(11, KIND.Knight, { x: at(2), side: SIDE.Friendly })]), cam());
    const early = make();
    early.event({ t: 'Sink', id: 11, x: at(2), y: 8, how: 0 });
    const late = make();
    late.frame(frame([]), cam());
    late.event({ t: 'Sink', id: 11, x: at(2), y: 8, how: 0 });
    const a = fallen(early);
    const b = fallen(late);
    expect(total(b)).toBeGreaterThan(0);
    expect(a.cards.position).toEqual(b.cards.position);
    expect(a.cards.n).toBe(b.cards.n);
  });

  it("places the dragon's mouth above its foot on the side it faces, and has none for a frame without a point", () => {
    const fg = make();
    const d = FIGURES[KIND.Dragon];
    const e = (aim: number) => ent(10, KIND.Dragon, { x: 88, y: 88, aim, anim: ANIM.Breath, animMs: 2000 });
    fg.frame(frame([e(Math.PI)]), cam());
    const m = fg.framePoint(10, d.mouth);
    expect(m).not.toBeNull();
    expect(m!.y).toBeGreaterThan(0.3);
    expect(m!.x).toBeLessThan(5.5);
    fg.frame(frame([e(0)]), cam());
    const r = fg.framePoint(10, d.mouth);
    expect(r!.x).toBeGreaterThan(5.5);
    expect(fg.framePoint(10, {})).toBeNull();
    expect(fg.framePoint(10, undefined)).toBeNull();
    expect(fg.framePoint(99, d.mouth)).toBeNull();
  });

  it('fades a monster in from nothing when it reappears from Invisible, and leaves a fading image when it goes', () => {
    const fg = make();
    const e = ent(10, KIND.SkeletonWarrior);
    fg.frame(frame([]), cam()); // events are stamped with the clock of the last frame
    fg.event({ t: 'Effect', id: 10, kind: EFFECT.Invisible, on: false, look: 0 });
    const a = fg.frame(frame([e], { dt: 0 }), cam());
    expect(a.ghosts.n).toBe(2);
    expect(a.ghosts.look[4]).toBe(0);

    const gone = make();
    gone.frame(frame([e]), cam());
    gone.event({ t: 'Effect', id: 10, kind: EFFECT.Invisible, on: true, look: 0 });
    const b = gone.frame(frame([], { dt: 0.1, now: 10.1 }), cam());
    expect(b.ghosts.n).toBe(1);
    expect(b.ghosts.look[4]).toBeGreaterThan(0.3);
    gone.frame(frame([], { dt: VANISH_SECS, now: 10.5 }), cam());
    expect(gone.frame(frame([], { dt: 0.016, now: 10.52 }), cam()).ghosts.n).toBe(0);
  });

  it('draws a dash afterimage at half alpha behind a dashing figure', () => {
    const out = make().frame(frame([ent(10, KIND.Knight, { anim: ANIM.Dash })]), cam());
    expect(out.cards.n).toBe(1);
    expect(out.ghosts.n).toBe(1);
    expect(out.ghosts.look[4]).toBeCloseTo(0.5, 6);
  });

  it('marks a dashing figure', () => {
    const dash = make().frame(frame([ent(10, KIND.Knight, { anim: ANIM.Dash })]), cam());
    expect(dash.figs[0].dashing).toBe(true);
    const walk = make().frame(frame([ent(10, KIND.Knight, { anim: ANIM.Move })]), cam());
    expect(walk.figs[0].dashing).toBe(false);
    const ghost = make().frame(frame([ent(10, KIND.Knight, { flags: FLAG.INCORPOREAL })]), cam());
    expect(ghost.figs[0].dashing).toBe(false);
    const hero = make().frame(frame([], { own: own({ alive: true, dashing: true }) }), cam());
    expect(hero.figs[0].dashing).toBe(true);
    const still = make().frame(frame([], { own: own({ alive: true }) }), cam());
    expect(still.figs[0].dashing).toBe(false);
  });

  it('reports a figure that may open walls, by who it is', () => {
    const out = make().frame(frame([ent(10, KIND.Knight, { side: SIDE.Friendly }), ent(11, KIND.OrcWarrior)]), cam());
    expect(out.openers.map((o) => [o.id, o.who])).toEqual([[10, 'friend'], [11, 'enemy']]);
    expect(out.openers[0].mid).toBeGreaterThan(0.3);
  });

  it('leaves neutral creatures and dead heroes out of the openers', () => {
    const out = make().frame(frame([ent(10, KIND.Knight, { side: SIDE.Neutral }), ent(11, KIND.Knight, { side: SIDE.Friendly, flags: FLAG.DEAD })]), cam());
    expect(out.openers).toEqual([]);
  });

  it('draws the own hero from the prediction when it is missing from the entities', () => {
    const fg = make();
    const out = fg.frame(frame([], { own: own({ alive: true }) }), cam());
    expect(fg.count).toBe(1);
    expect(out.openers[0].who).toBe('hero');
  });

  it('draws the board objects (#303 Task 6)', () => {
    const names = ['torch_f0', 'torch_f1', 'torch_f2', 'torch_f3', 'torch_f4', 'torch_out', 'barrel_explosive', 'coin_anim_f0', 'coin_anim_f1', 'coin_anim_f2', 'coin_anim_f3',
      'chest_full_open_anim_f0', 'chest_full_open_anim_f1', 'chest_full_open_anim_f2', 'chest_empty_open_anim_f2',
      'chest_mimic_open_anim_f0', 'chest_mimic_open_anim_f1', 'chest_mimic_open_anim_f2'];
    names.forEach((n, i) => { frames[n] = { x: 500 + i * 20, y: 20, w: n.startsWith('torch') ? 16 : 16, h: 16 }; });
    const nameOf = (b: CardBuf, q = 0): string => {
      const u = Math.min(b.uv[q * 12], b.uv[q * 12 + 4]);
      return names.find((n) => frames[n].x === u) ?? '?';
    };
    const zs = (b: CardBuf, q = 0): number[] => Array.from({ length: 6 }, (_, i) => b.position[(q * 6 + i) * 3 + 2]);
    const torch = (side: number, lit: boolean, x: number, y: number) => ent(30, KIND.Torch, { x, y, extra: side, anim: lit ? 1 : 0, side: SIDE.Neutral });

    // side 0: the wall's south face at z = floor(y / 16), 0.02 into the room
    const t0 = make().frame(frame([torch(0, true, 3 * 16 + 8, 2 * 16 + 0.5)]), cam());
    expect(t0.emissive.n).toBe(1);
    expect(t0.glows.n).toBe(1);
    for (const z of zs(t0.emissive)) expect(z).toBeCloseTo(2 + 0.02, 6);
    expect(nameOf(t0.emissive)).toMatch(/^torch_f\d$/);
    expect(t0.openers).toEqual([]); // a torch never opens a wall
    // side 1: the east face of the wall west of the floor
    const t1 = make().frame(frame([torch(1, true, 4 * 16 + 0.5, 2 * 16 + 8)]), cam());
    for (const x of xs(t1.emissive)) expect(x).toBeCloseTo(4 + 0.02, 6);
    // side 2: the west face of the wall east of the floor
    const t2 = make().frame(frame([torch(2, true, 4 * 16 - 0.5, 2 * 16 + 8)]), cam());
    for (const x of xs(t2.emissive)) expect(x).toBeCloseTo(4 - 0.02, 6);
    // unlit: burnt out and no glow
    const t3 = make().frame(frame([torch(0, false, 24, 32.5)]), cam());
    expect(nameOf(t3.emissive)).toBe('torch_out');
    expect(t3.glows.n).toBe(0);
    // #325: an unlit torch is lit by the room's light (the wall card's flag), a burning one is self-lit
    expect(t3.emissive.foot[3]).toBe(1);
    expect(t0.emissive.foot[3]).toBe(0);

    // chests: closed lid, then the lid over the gold, then empty
    const chest = (anim: number, animMs: number) => ent(31, KIND.Chest, { anim, animMs, side: SIDE.Neutral });
    expect(nameOf(make().frame(frame([chest(0, 0)]), cam()).cards)).toBe('chest_full_open_anim_f0');
    const co = make().frame(frame([chest(1, 600)]), cam());
    expect(nameOf(co.cards)).toBe('chest_empty_open_anim_f2');
    expect(co.shadows.n).toBe(1);
    expect(co.openers[0].who).toBe('chest');

    // barrels: a flash frame of the fuse is a fill, a resting one is not, a drowning one is whole and opaque (#324: it sinks by height, no fade)
    const barrel = (anim: number, animMs: number) => ent(32, KIND.Barrel, { anim, animMs, side: SIDE.Neutral });
    expect(make().frame(frame([barrel(1, 0)]), cam()).cards.look[3]).toBe(1);
    expect(make().frame(frame([barrel(0, 0)]), cam()).cards.look[3]).toBe(0);
    const sunk = make().frame(frame([barrel(3, 200)]), cam());
    expect(sunk.ghosts.n).toBe(0);
    expect(sunk.cards.n).toBe(1);
    expect(sunk.cards.look[4]).toBe(1);
    expect(sunk.shadows.n).toBe(0);
    expect(sunk.openers).toEqual([]); // nor does a barrel

    // mimics: hiding is a closed chest; once it stops hiding the reveal shows the open lid and lifts it
    const mimic = (flags: number) => ent(33, KIND.Mimic, { flags });
    const fg = make();
    const a = fg.frame(frame([mimic(FLAG.HIDING)]), cam());
    expect(nameOf(a.cards)).toBe('chest_mimic_open_anim_f0');
    fg.frame(frame([mimic(0)], { dt: 0.016, now: 10.016 }), cam());
    const c = fg.frame(frame([mimic(0)], { dt: 0.3, now: 10.3 }), cam());
    expect(nameOf(c.cards)).toBe('chest_mimic_open_anim_f2');
    expect(Math.min(...ys(c.cards))).toBeGreaterThan(Math.min(...ys(a.cards)) + 0.1);
    expect(c.openers[0].who).toBe('mimic');
    expect(c.shadows.n).toBe(1);
    // a hiding mimic is scenery (a chest), a revealed one a creature (its foot's scenery flag is the 4th float)
    expect(a.cards.foot[3]).toBe(1);
    expect(c.cards.foot[3]).toBe(0);

    // coins: min(10, 3 + v / 4) translucent coins that are gone after a second
    const cf = make();
    cf.frame(frame([]), cam());
    cf.event({ t: 'Coins', x: at(1), y: 8, v: 20 });
    expect(cf.frame(frame([], { now: 10.1 }), cam()).ghosts.n).toBe(8);
    expect(cf.frame(frame([], { now: 11.2 }), cam()).ghosts.n).toBe(0);

    // a coin that has landed rests on the floor instead of sinking into it (the card's middle is on the foot point)
    const lf = make();
    lf.frame(frame([]), cam());
    lf.event({ t: 'Coins', x: at(1), y: 8, v: 20 });
    for (const now of [10.2, 10.4, 10.6, 10.65]) {
      const g = lf.frame(frame([], { now }), cam()).ghosts;
      expect(g.n).toBeGreaterThan(0);
      for (let q = 0; q < g.n; q++) expect(Math.min(...ys(g, q))).toBeGreaterThanOrEqual(-1e-6);
    }
  });
});

describe('Figures3d anchors (#311)', () => {
  it('anchors carry the predicted own position, not the interpolated entity', () => {
    const fg = make();
    fg.frame(frame([ent(1, KIND.Wizard, { side: SIDE.Friendly, x: at(0), y: 8 })], { own: own({ alive: true, x: at(1), y: 40, effects: 1 << EFFECT.Burning }) }), cam());
    const a = fg.anchors.get(1);
    expect(a).toBeDefined();
    expect(a!.x).toBeCloseTo(at(1) / TILE, 9);
    expect(a!.z).toBeCloseTo(40 / TILE, 9);
    expect(a!.effects).toBe(1 << EFFECT.Burning);
    expect(a!.tagShown).toBe(true);
    // height is the frame height times the scale, the tag sits 3 px above the foot
    const d = FIGURES[KIND.Wizard];
    expect(a!.height).toBe(FIG.h * (d.scale ?? 1));
    expect(a!.tag).toBe((d.footY ?? FIG.h) * (d.scale ?? 1) + 3);
    expect(a!.head).toBe(((d.footY ?? FIG.h) - 0) * (d.scale ?? 1));
  });
  it("the mimic's wake cue adds a red \"!\"", () => {
    const fg = make();
    const mimic = (flags: number) => ent(33, KIND.Mimic, { flags });
    expect(fg.frame(frame([mimic(FLAG.HIDING)]), cam()).floats).toEqual([]);
    fg.frame(frame([mimic(0)], { dt: 0.016, now: 10.016 }), cam());
    let all: FigureOut['floats'] = [];
    for (let i = 1; i <= 12; i++) all = all.concat(fg.frame(frame([mimic(0)], { dt: 0.1, now: 10.016 + i * 0.1 }), cam()).floats);
    expect(all).toHaveLength(1); // once, on the reveal frame
    expect(all[0]).toEqual({ x: at(0), y: 8, text: '!', color: '#ff5050', kind: 'mark', up: 18 });
  });
  it("a marked mimic's wake cue adds no float", () => {
    const run = (dark: Set<number>) => {
      const fg = make();
      const mimic = (flags: number) => ent(33, KIND.Mimic, { flags });
      fg.frame(frame([mimic(FLAG.HIDING)], { dark }), cam());
      fg.frame(frame([mimic(0)], { dt: 0.016, now: 10.016, dark }), cam());
      let all: FigureOut['floats'] = [];
      for (let i = 1; i <= 12; i++) all = all.concat(fg.frame(frame([mimic(0)], { dt: 0.1, now: 10.016 + i * 0.1, dark }), cam()).floats);
      return all;
    };
    expect(run(new Set([33]))).toEqual([]);
    expect(run(new Set())).toHaveLength(1);
  });
  it('a chest, a barrel and a mimic anchor at CHEST_HEIGHT', () => {
    const fg = make();
    fg.frame(frame([ent(20, KIND.Chest, { side: SIDE.Neutral }), ent(21, KIND.Barrel, { side: SIDE.Neutral }), ent(22, KIND.Mimic)]), cam());
    for (const id of [20, 21, 22]) {
      const a = fg.anchors.get(id);
      expect(a, `entity ${id}`).toBeDefined();
      expect(a!.height).toBe(CHEST_HEIGHT);
      expect(a!.x).toBeCloseTo(at(0) / TILE, 9);
      expect(a!.tagShown).toBe(false);
    }
  });
  it('anchors are rebuilt every frame', () => {
    const fg = make();
    fg.frame(frame([ent(20, KIND.Chest, { side: SIDE.Neutral })]), cam());
    expect(fg.anchors.size).toBe(1);
    fg.frame(frame([]), cam());
    expect(fg.anchors.size).toBe(0);
  });
  it('a falling figure has tagShown false', () => {
    const fg = make();
    const f = (now: number) => frame([ent(1, KIND.Wizard, { side: SIDE.Friendly })], { now, own: own({ alive: true, x: at(2), y: 8, sinking: true }) });
    fg.frame(f(10), cam());
    fg.frame(f(10.3), cam());
    expect(fg.anchors.get(1)!.tagShown).toBe(false);
    expect(fg.anchors.get(1)!.descending).toBe(true);
  });
  it('a falling barrel is descending, a standing one and a chest are not (F5)', () => {
    const fg = dipFigs();
    fg.frame(frame([ent(20, KIND.Barrel, { ...at2(2, 4), anim: 2, side: SIDE.Neutral }), ent(21, KIND.Chest, { ...at2(1, 1), side: SIDE.Neutral }), ent(22, KIND.Barrel, { ...at2(5, 5), side: SIDE.Neutral })]), cam());
    expect(fg.anchors.get(20)!.descending).toBe(true);
    expect(fg.anchors.get(21)!.descending).toBe(false);
    expect(fg.anchors.get(22)!.descending).toBe(false);
  });
});

describe('Figures3d status looks (#308)', () => {
  const look = { ambient: [1, 1, 1] as [number, number, number], dark: 'shape' as const, torchGlow: true, oval: 1 };
  it('frozen card is tinted', () => {
    const plain = make().frame(frame([ent(10, KIND.Knight)]), cam(), look);
    const iced = make().frame(frame([ent(10, KIND.Knight, { effects: 1 << EFFECT.Frozen })]), cam(), look);
    expect(plain.cards.look[0]).toBeCloseTo(1, 6);
    expect(iced.cards.look[0]).toBeCloseTo(0xa8 / 255, 6);
    expect(iced.cards.look[1]).toBeCloseTo(0xd8 / 255, 6);
  });
  it('an accelerated figure leaves a golden afterimage every 0.08 s', () => {
    const fg = make();
    const n = (t: number, dt: number) => fg.frame(frame([ent(10, KIND.Knight, { effects: 1 << EFFECT.Accelerated })], { dt, now: t }), cam(), look).ghosts.n;
    let frames = 0;
    for (let i = 0; i < 30; i++) if (n(1 + i * 0.016, 0.016) > 0) frames++;
    // an image lives 0.2 s (12 frames); a new one is due every 0.08 s (5 frames): copies are on screen in every frame after the first
    expect(frames).toBe(30);
    const none = make().frame(frame([ent(10, KIND.Knight)], { dt: 0.016 }), cam(), look);
    expect(none.ghosts.n).toBe(0);
  });
});

describe('Figures3d in the dark (#304)', () => {
  const look = (ambient: [number, number, number], dark: 'fade' | 'shape' = 'fade', torchGlow = true) => ({ ambient, dark, torchGlow, oval: 1 });
  const alphas = (b: CardBuf): number[] => b.look.filter((_, i) => i % 5 === 4);
  const monster = () => [ent(10, KIND.Knight)];
  const torchFrames = ['torch_f0', 'torch_f1', 'torch_f2', 'torch_f3', 'torch_f4', 'torch_out'];
  it('a dark monster fades to nothing at ambient 0 and shows fully at AMBIENT, with no shadow and no caster', () => {
    const dim = make().frame(frame(monster(), { dark: new Set([10]) }), cam(), look([0, 0, 0]));
    expect(dim.cards.n).toBe(0);
    expect(dim.ghosts.n).toBeGreaterThan(0);
    expect(new Set(alphas(dim.ghosts))).toEqual(new Set([0]));
    expect(dim.shadows.n).toBe(0);
    expect(dim.casters).toEqual([]);
    const full = make().frame(frame(monster(), { dark: new Set([10]) }), cam(), look(AMBIENT));
    expect(full.cards.n).toBe(0);
    expect(new Set(alphas(full.ghosts))).toEqual(new Set([1]));
    expect(full.shadows.n).toBe(0);
    expect(full.casters).toEqual([]);
  });
  it('with dark shape it stays an opaque card with the dark flag at any ambient', () => {
    const o = make().frame(frame(monster(), { dark: new Set([10]) }), cam(), look([0, 0, 0], 'shape'));
    expect(o.ghosts.n).toBe(0);
    expect(o.cards.n).toBeGreaterThan(0);
    expect(o.cards.dark.every((d) => d === 1)).toBe(true);
    expect(new Set(alphas(o.cards))).toEqual(new Set([1]));
    expect(o.shadows.n).toBe(0);
    expect(o.casters).toEqual([]);
  });
  it('the same monster not in f.dark gives a card, a shadow, a caster and no dark flag', () => {
    const o = make().frame(frame(monster()), cam(), look([0, 0, 0]));
    expect(o.cards.n).toBeGreaterThan(0);
    expect(o.shadows.n).toBe(1);
    expect(o.casters).toHaveLength(1);
    expect(o.cards.dark.every((d) => d === 0)).toBe(true);
  });
  it('a hero in a frame whose f.dark is empty is drawn lit, with a shadow and a caster', () => {
    const o = make().frame(frame([ent(1, KIND.Wizard, { side: SIDE.Friendly })]), cam(), look([0, 0, 0]));
    expect(o.cards.n).toBeGreaterThan(0);
    expect(o.shadows.n).toBe(1);
    expect(o.casters).toHaveLength(1);
  });
  it('a dark dashing monster leaves no visible afterimage at ambient 0, and the image carries the dark flag', () => {
    const dash = [ent(10, KIND.Knight, { anim: ANIM.Dash })];
    const o = make().frame(frame(dash, { dark: new Set([10]) }), cam(), look([0, 0, 0]));
    expect(o.ghosts.n).toBeGreaterThan(1);
    expect(Math.max(...alphas(o.ghosts))).toBe(0);
    expect(o.ghosts.dark.every((d) => d === 1)).toBe(true);
    const shape = make().frame(frame(dash, { dark: new Set([10]) }), cam(), look([0, 0, 0], 'shape'));
    expect(shape.ghosts.n).toBe(1);
    expect(shape.ghosts.dark.every((d) => d === 1)).toBe(true);
  });
  it('a dark figure that vanishes leaves no visible image', () => {
    const fg = make();
    const e = ent(10, KIND.SkeletonWarrior);
    const dk = new Set([10]);
    fg.frame(frame([e], { dark: dk }), cam(), look([0, 0, 0]));
    fg.event({ t: 'Effect', id: 10, kind: EFFECT.Invisible, on: true, look: 0 });
    const b = fg.frame(frame([], { dt: 0.1, now: 10.1, dark: dk }), cam(), look([0, 0, 0]));
    expect(b.ghosts.n).toBeGreaterThan(0);
    expect(Math.max(...alphas(b.ghosts))).toBe(0);
    expect(b.ghosts.dark.every((d) => d === 1)).toBe(true);
  });
  it('a dark chest, barrel and mimic lose shadow and caster too', () => {
    const o = make().frame(frame([ent(20, KIND.Chest, { side: SIDE.Neutral }), ent(21, KIND.Barrel, { side: SIDE.Neutral }), ent(22, KIND.Mimic)], { dark: new Set([20, 21, 22]) }), cam(), look([0, 0, 0], 'shape'));
    expect(o.shadows.n).toBe(0);
    expect(o.casters).toEqual([]);
    expect(o.cards.n).toBe(3);
  });
  it('a card in the ghost pass casts no shadow', () => {
    // a barrel falling into a chasm is opaque (#324) but casts none; a dark fading one is in the ghost pass and casts none
    const o = make().frame(frame([ent(21, KIND.Barrel, { side: SIDE.Neutral, anim: 2, animMs: 200 })]), cam(), look(AMBIENT));
    expect(o.cards.n).toBe(1);
    expect(o.casters).toEqual([]);
    const d = make().frame(frame([ent(22, KIND.Barrel, { side: SIDE.Neutral })], { dark: new Set([22]) }), cam(), { ...look(AMBIENT), dark: 'fade' });
    expect(d.ghosts.n).toBe(1);
    expect(d.casters).toEqual([]);
  });
  it('a lit torch gives a glow quad with torchGlow and none without', () => {
    for (const n of torchFrames) frames[n] = { x: 500, y: 20, w: 16, h: 16 };
    const torch = ent(30, KIND.Torch, { x: 3 * 16 + 8, y: 2 * 16 + 0.5, extra: 0, anim: 1, side: SIDE.Neutral });
    expect(make().frame(frame([torch]), cam(), look(AMBIENT, 'fade', true)).glows.n).toBe(1);
    const off = make().frame(frame([torch]), cam(), look(AMBIENT, 'fade', false));
    expect(off.glows.n).toBe(0);
    expect(off.emissive.n).toBe(1);
  });
});

describe('Figures3d casters (#304)', () => {
  it('gives one caster per standing figure, chest, barrel and mimic, owned by its entity, and the card the same owner', () => {
    const ents = [ent(10, KIND.Knight), ent(11, KIND.Chest), ent(12, KIND.Barrel), ent(13, KIND.Mimic), ent(14, KIND.Wizard, { x: at(2) })];
    const out = make().frame(frame(ents), cam());
    expect(out.casters.map((c) => c.id).sort()).toEqual([10, 11, 12, 13, 14]);
    for (const c of out.casters) {
      expect(c.w).toBeGreaterThan(0);
      expect(c.y1).toBeGreaterThan(c.y0);
      expect(out.cards.owner).toContain(c.id);
    }
  });
  it('gives none for a shot, a lying figure or a dead one, and none for the images left behind', () => {
    const shot: ShotView = { shot: 1, kind: KIND.Arrow, x: at(1), y: 8, vx: 100, vy: 0 };
    const out = make().frame(frame([ent(20, KIND.Arrow), ent(21, KIND.Knight, { effects: 1 << EFFECT.Sleep }), ent(22, KIND.Knight, { flags: FLAG.DEAD })], { shots: [shot] }), cam());
    expect(out.casters).toEqual([]);
    const fg = make();
    fg.frame(frame([ent(10, KIND.Knight)]), cam());
    const gone = fg.frame(frame([]), cam());
    expect(gone.casters).toEqual([]);
  });
  it('takes the caster from the current frame: a flipped figure reads its atlas rect back to front', () => {
    const a = make().frame(frame([ent(10, KIND.Knight, { aim: 0 })]), cam()).casters[0];
    const b = make().frame(frame([ent(10, KIND.Knight, { aim: Math.PI })]), cam()).casters[0];
    expect(a.u0).toBeLessThan(a.u1);
    expect(b.u0).toBeGreaterThan(b.u1);
  });
});

describe('the sight attributes of the cards (#305)', () => {
  const footOf = (b: CardBuf, i: number): { reach: number; scenery: number } => ({ reach: b.foot[i * 4 + 2], scenery: b.foot[i * 4 + 3] });

  it('a chest is scenery, a monster is not', () => {
    const chest = make().frame(frame([ent(31, KIND.Chest, { side: SIDE.Neutral })]), cam());
    expect(footOf(chest.cards, 0).scenery).toBe(1);
    const orc = make().frame(frame([ent(11, KIND.OrcWarrior)]), cam());
    expect(footOf(orc.cards, 0).scenery).toBe(0);
  });

  // A torch is not in this list: its pass never read the flag, and a wall card's fourth foot value says "lit by the room's light" (#325).
  it('the board objects are scenery: barrel, mimic, skull and coins', () => {
    const barrel = make().frame(frame([ent(32, KIND.Barrel, { side: SIDE.Neutral })]), cam());
    expect(footOf(barrel.cards, 0).scenery).toBe(1);
    const mimic = make().frame(frame([ent(33, KIND.Mimic, { side: SIDE.Neutral, flags: FLAG.HIDING })]), cam()); // hiding: a chest (a revealed one is a creature)
    expect(mimic.cards.n + mimic.ghosts.n).toBe(1);
    expect(footOf(mimic.cards.n ? mimic.cards : mimic.ghosts, 0).scenery).toBe(1);
    const fg = make();
    for (let i = 0; i < 4; i++) frames[`coin_anim_f${i}`] ??= { x: 500, y: 20, w: 16, h: 16 };
    fg.event({ t: 'Coins', x: 40, y: 40, v: 8 } as never);
    fg.event({ t: 'Died', id: 10, x: 40, y: 40, kind: KIND.Knight });
    const out = fg.frame(frame([]), cam());
    expect(out.decals.n).toBeGreaterThan(0);
    expect(out.ghosts.n).toBeGreaterThan(0);
    for (const b of [out.decals, out.ghosts]) for (let i = 0; i < b.n * 6; i++) expect(footOf(b, i).scenery).toBe(1);
  });

  it('a wide figure body and weapon carry the same reach: half the frame width in tiles', () => {
    const wide = new Figures3d(init(), frames, (f) => ({ ...bounds(f), r: 47, w: 48 }));
    const out = wide.frame(frame([ent(10, KIND.Paladin, { side: SIDE.Friendly })]), cam());
    expect(out.cards.n).toBe(2);
    const body = footOf(out.cards, 0), weapon = footOf(out.cards, 6);
    expect(body.reach).toBeGreaterThan(0.5);
    expect(body.reach).toBeCloseTo((48 * (FIGURES[KIND.Paladin].scale ?? 1)) / 2 / TILE, 5);
    expect(weapon.reach).toBe(body.reach);
    expect(body.scenery).toBe(0);
  });
});

describe('Figures3d ground ovals (#306)', () => {
  const ents = () => [ent(10, KIND.Knight), ent(11, KIND.Chest, { side: SIDE.Neutral, x: at(2) }), ent(12, KIND.Barrel, { side: SIDE.Neutral, x: at(3) })];
  const look = (oval: number) => ({ ambient: AMBIENT, dark: 'shape' as const, torchGlow: true, oval });
  it('oval scales the alpha of every ground oval', () => {
    const full = make().frame(frame(ents()), cam(), look(1));
    const half = make().frame(frame(ents()), cam(), look(0.5));
    expect(full.shadows.n).toBeGreaterThanOrEqual(3);
    expect(half.shadows.n).toBe(full.shadows.n);
    full.shadows.alpha.forEach((a, i) => expect(half.shadows.alpha[i]).toBeCloseTo(a * 0.5, 6));
  });
  it('lifts the ovals and a skull by look.ground (#330), the standing bodies stay put', () => {
    const calls: number[] = [];
    const ground = (_x: number, _z: number, r: number): number => { calls.push(r); return 0.2; };
    const plain = make().frame(frame(ents()), cam(), look(1));
    const fg = make();
    const lifted = fg.frame(frame(ents()), cam(), { ...look(1), ground });
    expect(lifted.shadows.n).toBe(plain.shadows.n);
    for (let i = 0; i < plain.shadows.position.length; i += 3) expect(lifted.shadows.position[i + 1] - plain.shadows.position[i + 1]).toBeCloseTo(0.2, 6);
    expect(Array.from(lifted.cards.position)).toEqual(Array.from(plain.cards.position));
    fg.event({ t: 'Died', id: 10, x: at(1), y: 8, kind: KIND.Knight });
    const b = fg.frame(frame([]), cam(), { ...look(1), ground });
    expect(ys(b.decals).every((y) => Math.abs(y - (LIE_Y + 0.2)) < 1e-6)).toBe(true);
    expect(calls).toContain(0.3);
  });
});

describe('Figures3d hands chosen figures to the model layer (#338)', () => {
  const PACK = join(__dirname, '../../assets-src/0x72');
  const sheet = decodePng(readFileSync(join(PACK, '0x72_DungeonTilesetII_v1.7.png')));
  const rects = new Map<string, [number, number, number, number]>();
  for (const line of readFileSync(join(PACK, 'tile_list_v1.7'), 'utf8').split(/\r?\n/)) {
    const [name, x, y, w, h] = line.trim().split(/\s+/);
    if (name && h !== undefined) rects.set(name, [+x, +y, +w, +h]);
  }
  // The wolf is not in the pack's list: its frames are in the game's atlas.
  const atlas = decodePng(readFileSync(join(__dirname, '../../public/assets/atlas.png')));
  const atlasFrames = (JSON.parse(readFileSync(join(__dirname, '../../public/assets/atlas.json'), 'utf8')) as { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> }).frames;
  const sprite = (name: string): SpritePixels | null => {
    const r = rects.get(name), a = atlasFrames[name]?.frame;
    const src = r ? sheet : atlas, box = r ?? (a ? [a.x, a.y, a.w, a.h] : null);
    if (!box) return null;
    const [x, y, w, h] = box;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) data.set(src.data.subarray(((y + row) * src.w + x) * 4, ((y + row) * src.w + x + w) * 4), row * w * 4);
    return { w, h, data };
  };
  let kit: FigureKit;
  const BUILT = ['elf', 'weapon_bow', 'skull', 'knight', 'wolf', 'wizard', 'dwarf', 'skelet', 'ogre', 'stag', 'boar', 'deer', 'bunny'];
  beforeAll(async () => {
    kit = createKit(sprite, directRunner);
    // The lamp outlines are the atlas's own rects (the fake frames above stand in for the cards only).
    for (const k of [...Object.keys(DESCS), ...Object.keys(TUBE_DESCS)]) frames[outlineFrame(k)] = { ...atlasFrames[outlineFrame(k)].frame };
    for (const k of BUILT) kit.get(k);
    while (kit.version < BUILT.length) await new Promise((r) => setTimeout(r, 0));
  }, 120000);
  afterAll(() => kit.dispose());

  const look = (models?: { kit: FigureKit; is(e: EntState): boolean }) => ({ ambient: AMBIENT, dark: 'shape' as const, torchGlow: true, oval: 1, models });
  const all = { is: () => true };
  const ranger = (o: Partial<EntState> = {}) => ent(10, KIND.ElvenRanger, o);
  const owned = (b: CardBuf, id: number): number => b.owner.filter((v) => v === id).length;
  const unbuilt: FigureKit = { get: () => null, known: () => true, times: new Map(), version: 0, dispose: () => {} };

  it('gives a built figure one body and one bow instance, no card, one caster, one shadow and the model height as anchor', () => {
    const fg = make();
    const out = fg.frame(frame([ranger()]), cam(), look({ kit, ...all }));
    expect(out.models.map((m) => [m.owner, m.model, m.bone])).toEqual([[10, 'elf', -1], [10, 'weapon_bow', BONES.indexOf('weaponL')]]);
    expect(owned(out.cards, 10) + owned(out.ghosts, 10)).toBe(0);
    expect(total(out)).toBe(0);
    expect(out.casters.length).toBe(1);
    expect(out.casters[0].id).toBe(10);
    expect(out.shadows.n).toBe(1);
    expect(out.openers[0].mid).toBeCloseTo(fg.anchors.get(10)!.head / 2 / 16, 6);
    // the model's own scale, not the pose's fall shrink
    expect(out.models[0].scale).toBe(kit.get('elf')!.scale);
  });

  it('draws the card when the model is not built, or the kind has no description: the same output as without models', () => {
    const plain = make().frame(frame([ranger(), ent(11, KIND.Lich, { x: at(1) })]), cam(), look());
    const a = make().frame(frame([ranger(), ent(11, KIND.Lich, { x: at(1) })]), cam(), look({ kit: unbuilt, ...all }));
    expect(a).toEqual(plain);
    expect(a.models).toEqual([]);
    const b = make().frame(frame([ent(11, KIND.Lich)]), cam(), look({ kit, ...all }));
    expect(b).toEqual(make().frame(frame([ent(11, KIND.Lich)]), cam(), look()));
    // not chosen: cards, and the kit is not asked
    const c = make().frame(frame([ranger()]), cam(), look({ kit, is: () => false }));
    expect(c).toEqual(make().frame(frame([ranger()]), cam(), look()));
  });

  it('draws a figure without a weapon, and warns once, when its weapon sprite has no model', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const keep = FIGURES[KIND.Paladin];
    frames['weapon_lich_staff'] = { x: 0, y: 0, w: 8, h: 20 };
    FIGURES[KIND.Paladin] = { ...keep, weapon: 'weapon_lich_staff' };
    try {
      const fg = make();
      for (let i = 0; i < 3; i++) fg.frame(frame([ent(10, KIND.Paladin)]), cam(), look({ kit, ...all }));
      const out = make().frame(frame([ent(10, KIND.Paladin)]), cam(), look({ kit, ...all }));
      expect(out.models.map((m) => m.model)).toEqual(['knight']);
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('weapon_lich_staff')).length).toBe(1);
    } finally {
      FIGURES[KIND.Paladin] = keep;
      delete frames['weapon_lich_staff'];
      warn.mockRestore();
    }
  });

  it('gives a model figure the anchor (bar, name, head) the same entity gets as a card, and the opener its mid', () => {
    for (const kind of [KIND.Wizard, KIND.Barbarian, KIND.DireWolf, KIND.Paladin, KIND.Ogre, KIND.SkeletonWarrior]) {
      const e = ent(10, kind);
      const card = make(), model = make();
      const co = card.frame(frame([e]), cam(), look());
      const mo = model.frame(frame([e]), cam(), look({ kit, ...all }));
      expect(mo.models.length, String(kind)).toBeGreaterThan(0);
      const a = card.anchors.get(10)!, b = model.anchors.get(10)!, size = kit.get(modelKeyOf(kind)!)!.size;
      expect(b.height, `${kind} height`).toBeCloseTo(a.height * size, 6);
      expect(b.tag, `${kind} tag`).toBeCloseTo((a.tag - 3) * size + 3, 6);   // the name's 3 px gap is not scaled
      expect(b.head, `${kind} head`).toBeCloseTo(a.head * size, 6);
      expect(mo.openers[0].mid, `${kind} mid`).toBeCloseTo(co.openers[0].mid * size, 6);
      // the shadow oval and the light's caster box shrink with the figure; the card path is what it was
      const sw = (b: FigureOut): number => Math.hypot(b.shadows.position[3] - b.shadows.position[0], b.shadows.position[5] - b.shadows.position[2]);
      expect(sw(mo), `${kind} oval`).toBeCloseTo(sw(co) * size, 6);
      // the lamp's caster is the model's own outline frame, one frame px per model px
      const fr = frames[outlineFrame(modelKeyOf(kind)!)], m = kit.get(modelKeyOf(kind)!)!;
      expect(mo.casters[0].w, `${kind} caster w`).toBeCloseTo((fr.w * m.scale) / 16, 6);
      expect(mo.casters[0].y1 - mo.casters[0].y0, `${kind} caster h`).toBeCloseTo((fr.h * m.scale) / 16, 6);
    }
    // the wizard is the one description at 1: model and card agree exactly
    expect(kit.get('wizard')!.size).toBe(1);
    expect(kit.get('dwarf')!.size).toBe(0.77);
    expect(kit.get('knight')!.size).toBe(0.87);
  });

  it('tells the id pass what the world hides: 0 on the floor, the lava surface in lava, nothing in water or over the chasm (body and weapon alike)', () => {
    const groundOf = (tx: number, tz: number): number[] => {
      const out = dipFigs().frame(frame([ent(10, KIND.ElvenRanger, at2(tx, tz))]), cam(), look({ kit, ...all }));
      expect(out.models.length, 'body and bow').toBe(2);
      return out.models.map((m) => m.groundY);
    };
    expect(groundOf(8, 5)).toEqual([0, 0]);                           // floor
    expect(groundOf(6, 1)).toEqual([LAVA_LEVEL, LAVA_LEVEL]);         // lava
    expect(groundOf(1, 1)).toEqual([NOTHING_HIDDEN, NOTHING_HIDDEN]); // wading
    expect(groundOf(3, 1)).toEqual([NOTHING_HIDDEN, NOTHING_HIDDEN]); // deep water
    expect(groundOf(2, 4)).toEqual([NOTHING_HIDDEN, NOTHING_HIDDEN]); // over the chasm
  });

  it('stands a wading model figure on the bed, uncropped: the caster and the opener follow the foot', () => {
    const e = (tx: number, tz: number) => ent(10, KIND.Barbarian, at2(tx, tz));
    const card = dipFigs().frame(frame([e(1, 1)]), cam(), look());
    const model = dipFigs().frame(frame([e(1, 1)]), cam(), look({ kit, ...all }));
    const dryModel = dipFigs().frame(frame([e(8, 5)]), cam(), look({ kit, ...all }));
    const bed = bedAt(dm, 1.5, 1.5);
    expect(bed).toBeLessThan(-0.3);
    expect(model.casters.length).toBe(1);
    expect(model.casters[0].y0, 'caster lower edge').toBeCloseTo(card.casters[0].y0, 6);   // the foot is the card's foot: both stand on the bed
    expect(model.models[0].lift / Math.cos(Math.PI / 4), 'world height after the stretch').toBeCloseTo(bed, 6);
    expect(model.models[0].cut).toBe(false);
    expect(model.openers[0].mid, 'mid').toBeCloseTo(dryModel.openers[0].mid + bed, 6);
  });

  it('gives a wading model figure the same foot and hand offsets as its card (R8)', () => {
    const e = (tx: number, tz: number) => ent(10, KIND.Barbarian, at2(tx, tz));
    const bed = bedAt(dm, 1.5, 1.5);
    const wet = dipFigs().frame(frame([e(1, 1)]), cam(), look({ kit, ...all })).figs[0];
    const dry = dipFigs().frame(frame([e(8, 5)]), cam(), look({ kit, ...all })).figs[0];
    expect(wet.model).toBe(true);
    expect(wet.foot).toBeCloseTo(bed, 6);
    expect(wet.hand[1] - dry.hand[1]).toBeCloseTo(bed, 6);
    expect(wet.top).toBeCloseTo(dry.top, 9);
  });

  it('fits every description to the standing height of its card, from the real atlas pixels', () => {
    const want: Record<DescKey, number> = { elf: 19, knight: 20, wizard: 19, dwarf: 21, skelet: 14, ogre: 26, wolf: 17 };
    for (const key of Object.keys(FIT_KIND) as DescKey[]) {
      const d = FIGURES[FIT_KIND[key]], card = cardHeight(d, sprite(`${d.idle}0`)!), m = kit.get(key)!;
      expect(card, `${key} card`).toBe(want[key]);
      if (card === null) continue;
      let top = 0;
      for (let i = 1; i < m.position.length; i += 3) top = Math.max(top, m.position[i]);
      expect(top * m.scale, key).toBeCloseTo(want[key] * (DESCS[key].size ?? 1), 3);   // the card's height times the description's size
      expect(m.size, key).toBe(DESCS[key].size ?? 1);
    }
  });

  it('fits the body to its card and draws the weapon at the size the card path gives it (the game\'s weapon scale x the figure\'s)', () => {
    const out = make().frame(frame([ranger()]), cam(), look({ kit, ...all }));
    const [body, bow] = out.models, elf = kit.get('elf')!, d = FIGURES[KIND.ElvenRanger];
    const card = cardHeight(d, sprite(`${d.idle}0`)!);
    let top = 0;
    for (let i = 1; i < elf.position.length; i += 3) top = Math.max(top, elf.position[i]);
    expect(top * body.scale).toBeCloseTo(card! * elf.size, 3);
    expect(body.scale).not.toBe(1);
    expect(elf.size).toBe(0.87);
    // the weapon shrinks with the figure: the card's weapon size times the figure's size
    expect(bow.boneScale * bow.scale).toBeCloseTo(0.48 * (d.scale ?? 1) * elf.size, 6);
  });

  it('hangs the bow on the wielder\'s hand: its origin lands on the weaponL pivot', () => {
    const out = make().frame(frame([ranger()]), cam(), look({ kit, ...all }));
    const [body, bow] = out.models;
    const elf = kit.get('elf')!, hand = BONES.indexOf('weaponL');
    expect(bow.pivot).toEqual([elf.pivots[hand * 3], elf.pivots[hand * 3 + 1], elf.pivots[hand * 3 + 2]]);
    expect(bow.pivot![0] !== 0 || bow.pivot![1] !== 0).toBe(true);
    expect(bow.boneScale * bow.scale).toBeCloseTo(0.48 * elf.size, 6);   // the game's weapon scale for the ranger's bow (0.8 x the 0.6 of a drawn-small weapon) times the figure's size, whatever the body's fit
    expect(bow.scale).toBe(elf.scale);
    const row = new Float32Array(ROW_TEXELS * 4);
    packInstance(row, 0, bow, 0, 0);
    const o = ROW.bones * 4;
    const origin = [row[o + 3], row[o + 7], row[o + 11]];
    // the wielder's hand bone at its pivot, through the same bone matrix
    const M = body.pose.bones, b = hand * 12, p = bow.pivot!;
    const want = [0, 1, 2].map((r) => M[b + r * 4] * p[0] + M[b + r * 4 + 1] * p[1] + M[b + r * 4 + 2] * p[2] + M[b + r * 4 + 3]);
    for (let i = 0; i < 3; i++) expect(origin[i]).toBeCloseTo(want[i], 4);
    // and that is at the hand: within a few sprite px of where the hand bone's own pivot goes
    const h = BONES.indexOf('handL'), hb = h * 12;
    const hp = [elf.pivots[h * 3], elf.pivots[h * 3 + 1], elf.pivots[h * 3 + 2]];
    const handAt = [0, 1, 2].map((r) => M[hb + r * 4] * hp[0] + M[hb + r * 4 + 1] * hp[1] + M[hb + r * 4 + 2] * hp[2] + M[hb + r * 4 + 3]);
    expect(Math.hypot(origin[0] - handAt[0], origin[1] - handAt[1], origin[2] - handAt[2])).toBeLessThan(6);
  });

  it('lays a sleeping model figure on the ground cover, and hangs its anchor from the body on the floor', () => {
    const ground = (_x: number, _z: number, r: number): number => (r === 0.3 ? 0.2 : 0);
    const asleep = make().frame(frame([ranger({ effects: 1 << EFFECT.Sleep })]), cam(), { ...look({ kit, ...all }), ground });
    expect(asleep.models[0].lift).toBeCloseTo(0.2, 6);
    const standing = make().frame(frame([ranger()]), cam(), { ...look({ kit, ...all }), ground });
    expect(standing.models[0].lift).toBeCloseTo(0, 6);
    const fg = make(), fs = make();
    fg.frame(frame([ranger()]), cam(), look({ kit, ...all }));
    fs.frame(frame([ranger({ effects: 1 << EFFECT.Sleep })]), cam(), look({ kit, ...all }));
    // as the card path: only `head` is the body's thickness ((2 - LIE_SINK) times its side reach); the bar and the name stay at the standing height
    expect(fs.anchors.get(10)!.head).toBeLessThan(fg.anchors.get(10)!.head);
    expect(fs.anchors.get(10)!.head).toBeCloseTo((2 - LIE_SINK) * sideReach(kit.get('elf')!) * kit.get('elf')!.scale, 6);
    expect(fs.anchors.get(10)!.height).toBe(fg.anchors.get(10)!.height);
    expect(fs.anchors.get(10)!.tag).toBe(fg.anchors.get(10)!.tag);
    expect(fs.anchors.get(10)!.cx).toBe(0);
  });

  it('keeps the tint figurePose chose for a stone figure in a wind-up, and drops the red flash for a living one', () => {
    const slow = 1 << EFFECT.Slowed;
    const living = make().frame(frame([ranger({ anim: ANIM.Windup, effects: slow })]), cam(), look({ kit, ...all }));
    expect(living.models[0].tint).toEqual([1, 1, 1]);   // the figure's own tint (none), not the slowed blue or the red flash
    const stone = make().frame(frame([ranger({ anim: ANIM.Windup, effects: slow | (1 << EFFECT.Petrified) })]), cam(), look({ kit, ...all }));
    expect(stone.models[0].tint[0]).toBeCloseTo(0xa0 / 255, 6);
    expect(stone.models[0].stone).toBe(true);
  });

  describe('the lamp caster is the model\'s own outline (#357)', () => {
    const one = (e: EntState) => make().frame(frame([e]), cam(), look({ kit, ...all }));
    it('has the atlas rect of model_<key>, as wide as the frame times the model scale, for the wolf and the stag', () => {
      for (const [kind, key] of [[KIND.DireWolf, 'wolf'], [KIND.Stag, 'stag']] as const) {
        const e = ent(10, kind), c = one(e).casters[0], fr = atlasFrames[outlineFrame(key)].frame, m = kit.get(key)!;
        const v = m.varies ? variationOf(10) : { size: 1 };
        expect(c.id, key).toBe(10);
        expect(c.w, key).toBeCloseTo((fr.w * m.scale * v.size) / 16, 6);
        expect([c.u0, c.v0, c.u1, c.v1], key).toEqual([fr.x, fr.y, fr.x + fr.w, fr.y + fr.h]);
      }
    });
    it('is mirrored when the pose faces left', () => {
      const right = one(ent(10, KIND.Stag, { aim: 0 })).casters[0], left = one(ent(10, KIND.Stag, { aim: Math.PI })).casters[0];
      expect(right.u0).toBeLessThan(right.u1);
      expect(left.u0).toBeGreaterThan(left.u1);
    });
    it('is absent for a lying and a faint figure', () => {
      expect(one(ent(10, KIND.Stag, { effects: 1 << EFFECT.Sleep })).casters).toEqual([]);
      expect(one(ent(10, KIND.Stag, { flags: FLAG.INCORPOREAL })).casters).toEqual([]);
      expect(one(ent(10, KIND.Stag)).casters.length).toBe(1);
    });
    it('is absent, without throwing, when the atlas lacks the frame', () => {
      const keep = frames[outlineFrame('stag')];
      delete frames[outlineFrame('stag')];
      try {
        const out = one(ent(10, KIND.Stag));
        expect(out.models.length).toBeGreaterThan(0);
        expect(out.casters).toEqual([]);
      } finally {
        frames[outlineFrame('stag')] = keep;
      }
    });
  });

  describe('the tube models: variation, anchors, oval, reach and fangs (#357)', () => {
    const stag = (id: number, o: Partial<EntState> = {}) => ent(id, KIND.Stag, o);
    const one = (e: EntState, fg = make()) => fg.frame(frame([e]), cam(), look({ kit, ...all }));
    const sm = () => kit.get('stag')!;
    const crestOf = (fg: Figures3d, id: number): number => (fg as unknown as { figs: Map<number, { mem3: { crest: number } }> }).figs.get(id)!.mem3.crest;
    const near = (a: readonly number[], b: readonly number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 6));

    it('scales and tones each animal by its id, the same on every client, and sets the antler scale', () => {
      const m = sm(), v = variationOf(5), fg = make();
      const a = one(stag(5), fg).models[0];
      expect(a.scale).toBeCloseTo(m.scale * v.size, 9);
      near(a.tint, [v.tone, v.tone, v.tone]);
      expect(crestOf(fg, 5)).toBe(v.crest);
      const again = one(stag(5)).models[0];
      expect([again.scale, ...again.tint]).toEqual([a.scale, ...a.tint]);
      const other = one(stag(6)).models[0];
      expect([other.scale, ...other.tint]).not.toEqual([a.scale, ...a.tint]);
    });

    it('multiplies a status tint by the tone, and a stone animal is still grey', () => {
      const v = variationOf(11), poisoned = 1 << EFFECT.Poisoned;
      const wolf = one(ent(11, KIND.DireWolf, { effects: poisoned })).models[0].tint;
      expect(wolf).not.toEqual([1, 1, 1]);
      near(one(stag(11, { effects: poisoned })).models[0].tint, wolf.map((c) => c * v.tone));
      const stone = one(stag(11, { effects: 1 << EFFECT.Petrified })).models[0];
      expect(stone.stone).toBe(true);
    });

    it('leaves a wolf (no `varies`) at the model\'s scale and white', () => {
      const w = kit.get('wolf')!, o = one(ent(10, KIND.DireWolf)).models[0];
      expect(o.scale).toBe(w.scale);
      expect(o.tint).toEqual([1, 1, 1]);
    });

    it('hangs the anchors from the model\'s standing height, and leaves a wolf\'s alone', () => {
      const m = sm(), v = variationOf(5), fg = make(), h = m.stands! * m.scale * v.size;
      one(stag(5), fg);
      const a = fg.anchors.get(5)!;
      expect([a.height, a.head, a.tag]).toEqual([h, h, h + 3].map((x) => expect.closeTo(x, 6)));
      const wf = make();
      one(ent(10, KIND.DireWolf), wf);
      const card = wf.anchors.get(10)!, d = FIGURES[KIND.DireWolf], w = kit.get('wolf')!;
      const ib = bounds(`${d.idle}0`), footY = d.footY ?? ib.h;
      expect(card.height).toBeCloseTo(Math.max(0, footY - ib.t) * (d.scale ?? 1) * w.size, 6);
    });

    /** The half extents of the first ground oval, along screen right and screen depth (the camera's yaw is 0). */
    const oval = (out: FigureOut): [number, number] => {
      const p = out.shadows.position, xs = [0, 1, 2, 3, 4, 5].map((i) => p[i * 3]), zs = [0, 1, 2, 3, 4, 5].map((i) => p[i * 3 + 2]);
      return [(Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...zs) - Math.min(...zs)) / 2];
    };

    it('draws the ground oval from the footprint, turned by the facing, and a wolf\'s from baseR', () => {
      const m = sm(), v = variationOf(5), [hl, hw] = m.footprint!, k = (m.scale * v.size) / 16;
      const east = oval(one(stag(5)));
      expect(east[0]).toBeCloseTo(hl * k, 5);
      expect(east[1]).toBeCloseTo(hw * k * 0.45, 5);
      const south = oval(one(stag(5, { aim: Math.PI / 2 })));
      expect(south[0]).toBeCloseTo(hw * k, 5);
      expect(south[1]).toBeCloseTo(hl * k * 0.45, 5);
      const d = FIGURES[KIND.DireWolf], w = oval(one(ent(10, KIND.DireWolf)));
      expect(w[0]).toBeCloseTo((d.baseR * kit.get('wolf')!.size) / 16, 5);
    });

    it('gives the sight reach from the footprint\'s half length', () => {
      const m = sm(), v = variationOf(5), body = one(stag(5)).models[0];
      expect(body.reach).toBeCloseTo((m.footprint![0] * m.scale * v.size) / 16, 6);
    });

    it('gives a boar no fangs, in the wind-up and the strike, and still its swoosh', () => {
      for (const anim of [ANIM.Windup, ANIM.Melee]) {
        const out = one(ent(12, KIND.Boar, { anim, animMs: 100 }));
        expect(out.figs[0].bite, String(anim)).toBe(-1);
        expect(out.figs[0].arc, String(anim)).toBe(FIGURES[KIND.Boar].swing!.arc);
      }
      const wolf = one(ent(10, KIND.DireWolf, { anim: ANIM.Windup }));
      expect(wolf.figs[0].bite).toBeGreaterThanOrEqual(0);
    });

    it('gives a deer and a bunny, which have no attack to show, no fangs either', () => {
      for (const kind of [KIND.Deer, KIND.Bunny]) for (const anim of [ANIM.Windup, ANIM.Melee]) {
        expect(one(ent(13, kind, { anim, animMs: 100 })).figs[0].bite, `${kind} ${anim}`).toBe(-1);
      }
    });

    it('puts a boar\'s swoosh at its varied shoulder', () => {
      const b = kit.get('boar')!, bv = variationOf(12), out = one(ent(12, KIND.Boar));
      const stretch = 1 / Math.cos(Math.PI / 4);
      expect(out.figs[0].swingY - out.models[0].lift).toBeCloseTo(((b.shoulderY * b.scale * bv.size) / 16) * stretch, 6);
    });
  });

  it('does not drop the tint when the hurt flash blinks: a hurt slowed wolf keeps the slowed blue on every frame', () => {
    const fg = make();
    const tints = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const e = ent(10, KIND.DireWolf, { flags: FLAG.HURT, effects: 1 << EFFECT.Slowed });
      const out = fg.frame(frame([e], { dt: 0.016, now: 10 + i * 0.016 }), cam(), look({ kit, ...all }));
      tints.add(out.models.find((m) => m.model === 'wolf')!.tint.map((v) => v.toFixed(3)).join());
    }
    expect([...tints]).toEqual([[0xa0, 0xc8, 0xff].map((v) => (v / 255).toFixed(3)).join()]);
  });

  // The swoosh, fangs and swirl of the model figures (#338) are drawn by the effects system from Task 10 of #308 on (`models/fx.ts` keeps the shapes).
  it('figs lists each drawn figure once, as a card and as a model, and a hidden one too', () => {
    const e = (id: number, kind: number, tx: number) => ent(id, kind, { x: at(tx) });
    const cards = make().frame(frame([e(10, KIND.ElvenRanger, 0), e(11, KIND.Paladin, 1)], { dark: new Set([11]) }), cam(), look());
    expect(cards.figs.map((f) => [f.id, f.kind, f.model])).toEqual([[10, KIND.ElvenRanger, false], [11, KIND.Paladin, false]]);
    expect(cards.figs[0].top).toBeGreaterThan(0.5);
    expect(cards.figs[0].x).toBeCloseTo(at(0) / TILE);
    const models = make().frame(frame([e(10, KIND.ElvenRanger, 0), e(11, KIND.Paladin, 1)]), cam(), look({ kit, ...all }));
    expect(models.figs.map((f) => [f.id, f.model])).toEqual([[10, true], [11, true]]);
    expect(models.figs[1].def).toBe(FIGURES[KIND.Paladin]);
  });

  describe('the model figures\' small effects', () => {
    it('leaves the sleeper\'s Z to the overlay: no float of its own', () => {
      const fg = make();
      let floats = 0;
      for (let i = 0; i < 4; i++) floats += fg.frame(frame([ranger({ effects: 1 << EFFECT.Sleep })], { dt: 0.5 }), cam(), look({ kit, ...all })).floats.length;
      expect(floats).toBe(0);
    });
  });

  it('gives a model figure the sight reach its card gets for the same entity', () => {
    for (const e of [ranger(), ranger({ effects: 1 << EFFECT.Sleep }), ent(11, KIND.Paladin)]) {
      const card = make().frame(frame([e]), cam(), look());
      const [body, ...rest] = make().frame(frame([e]), cam(), look({ kit, ...all })).models;
      expect(body.reach).toBeCloseTo(card.cards.foot[2] ?? card.decals.foot[2], 6);
      for (const w of rest) expect(w.reach).toBe(body.reach);
    }
  });

  it('leaves a skull instance, no decal, when a model figure dies; every skull has the fitted skeleton\'s scale', () => {
    const fg = make();
    const l = look({ kit, ...all });
    fg.frame(frame([ranger()]), cam(), l);
    fg.event({ t: 'Died', id: 10, x: at(1), y: 8, kind: KIND.ElvenRanger });
    const out = fg.frame(frame([]), cam(), l);
    expect(out.decals.n).toBe(0);
    expect(out.models.map((m) => m.model)).toEqual(['skull']);
    const skelScale = kit.get('skelet')!.scale;
    expect(skelScale).not.toBe(1);
    expect(out.models[0].scale).toBe(skelScale);
    // whoever died: a wizard (hat), an ogre, a wolf
    const sizes = new Set<number>();
    for (const kind of [KIND.Wizard, KIND.Ogre, KIND.DireWolf]) {
      const f2 = make();
      f2.frame(frame([ent(20, kind)]), cam(), l);
      f2.event({ t: 'Died', id: 20, x: at(1), y: 8, kind });
      const o = f2.frame(frame([]), cam(), l);
      sizes.add(o.models.filter((m) => m.model === 'skull')[0].scale);
    }
    expect([...sizes]).toEqual([skelScale]);
    // two skulls never share an owner (so batching can separate them), and every owner is negative
    fg.frame(frame([ent(11, KIND.ElvenRanger), ent(12, KIND.ElvenRanger)]), cam(), l);
    fg.event({ t: 'Died', id: 11, x: at(1), y: 8, kind: KIND.ElvenRanger });
    fg.event({ t: 'Died', id: 12, x: at(1), y: 8, kind: KIND.ElvenRanger });
    const two = fg.frame(frame([]), cam(), l).models.filter((m) => m.model === 'skull').map((m) => m.owner);
    expect(two.length).toBeGreaterThanOrEqual(2);
    expect(new Set(two).size).toBe(two.length);
    expect(two.every((o) => o < 0)).toBe(true);
    // a card figure still leaves the decal
    const cards = make();
    cards.frame(frame([ranger()]), cam(), look());
    cards.event({ t: 'Died', id: 10, x: at(1), y: 8, kind: KIND.ElvenRanger });
    const c = cards.frame(frame([]), cam(), look({ kit, ...all }));
    expect(c.decals.n).toBe(1);
    expect(c.models).toEqual([]);
    for (let i = 0; i < 300; i++) fg.event({ t: 'Died', id: 100 + i, x: at(1), y: 8, kind: KIND.Knight });
    expect(fg.frame(frame([]), cam(), l).decals.n).toBeLessThanOrEqual(256);
  });

  it('does the same for a model figure: the instance follows the faller, is never cut and outlives the entity (#324)', () => {
    const fg = dipFigs();
    const l = look({ kit, ...all });
    const e = ranger({ x: sp(2, 4)[0], y: sp(2, 4)[1] });
    fg.event({ t: 'Sink', id: 10, x: e.x, y: e.y, how: 0 });
    const lifts: number[] = [];
    let last = fg.frame(frame([e]), cam(), l);
    expect(last.falls).toHaveLength(1);
    for (let i = 0; i < 30; i++) {
      last = fg.frame(frame([e]), cam(), l);
      lifts.push(last.models[0].lift / Math.cos(Math.PI / 4));   // the world height (see `low`)
    }
    expect(Math.abs(lifts[29] + 1.75)).toBeLessThan(0.2);
    expect(last.models.every((m) => m.cut === false)).toBe(true);
    expect(last.models[0].tint[0]).toBeCloseTo(depthFade(lifts[29]) * make().frame(frame([ranger()]), cam(), l).models[0].tint[0], 6);
    expect(last.casters).toEqual([]);
    expect(last.shadows.n).toBe(0);
    expect(last.openers).toEqual([]);
    fg.event({ t: 'Died', id: 10, x: e.x, y: e.y, kind: KIND.ElvenRanger });
    let after = fg.frame(frame([]), cam(), l);
    expect(after.models.length).toBeGreaterThan(0);
    expect(after.models[0].lift / Math.cos(Math.PI / 4)).toBeLessThan(lifts[29]);
    expect(after.decals.n).toBe(0);
    expect(after.models.some((m) => m.model === 'skull')).toBe(false);
    for (let i = 0; i < 90; i++) after = fg.frame(frame([]), cam(), l);
    expect(after.models).toEqual([]);
  });

  it('leaves a fading copy of a model figure that went invisible, and dash copies tinted with its base colour', () => {
    const fg = make();
    const l = look({ kit, ...all });
    fg.frame(frame([ranger()]), cam(), l);
    fg.event({ t: 'Effect', id: 10, kind: EFFECT.Invisible, on: true, look: 0 });
    const gone = fg.frame(frame([], { dt: 0.1, now: 10.1 }), cam(), l);
    expect(gone.models.map((m) => m.model)).toEqual(['elf', 'weapon_bow']);
    expect(gone.models[0].alpha).toBeGreaterThan(0.3);
    expect(gone.ghosts.n).toBe(0);
    const later = fg.frame(frame([], { dt: VANISH_SECS / 2, now: 10.2 }), cam(), l);
    expect(later.models[0].alpha).toBeLessThan(gone.models[0].alpha);
    expect(later.models[0].alpha).toBeGreaterThan(0);
    fg.frame(frame([], { dt: VANISH_SECS, now: 10.5 }), cam(), l);
    expect(fg.frame(frame([], { dt: 0.016, now: 10.52 }), cam(), l).models).toEqual([]);
    const dash = make().frame(frame([ranger({ anim: ANIM.Dash })]), cam(), l);
    const copies = dash.models.filter((m) => m.alpha === 0.5);
    expect(copies.length).toBeGreaterThan(0);
    const base = FIGURES[KIND.ElvenRanger].base;
    expect(copies[0].tint[0]).toBeCloseTo(((base >> 16) & 255) / 255, 6);
    expect(dash.models.some((m) => m.alpha === 1)).toBe(true);
  });
});


// ---- sunken terrain (#324) ----
const sp = (tx: number, tz: number): [number, number] => [(tx + 0.5) * TILE, (tz + 0.5) * TILE];
/** 10 x 7: shallow water (1..2, 1) and deep water (3, 1), a lava pool (6..7, 1..2), a chasm (2..3, 4..5), floor elsewhere. */
const dipMap = (): TileMap => {
  const t = new Uint8Array(10 * 7).fill(TILE_ID.Floor);
  const put = (x: number, z: number, id: number) => { t[z * 10 + x] = id; };
  put(1, 1, TILE_ID.ShallowWater); put(2, 1, TILE_ID.ShallowWater); put(3, 1, TILE_ID.DeepWater);
  for (const [x, z] of [[6, 1], [7, 1], [6, 2], [7, 2]]) put(x, z, TILE_ID.Lava);
  for (const [x, z] of [[2, 4], [3, 4], [2, 5], [3, 5]]) put(x, z, TILE_ID.Chasm);
  return new TileMap(10, 7, t);
};
const dm = dipMap();
const dipFigs = (): Figures3d => new Figures3d({ ...init(), map: dipMap() }, frames, bounds);
const at2 = (tx: number, tz: number, o: Partial<EntState> = {}): Partial<EntState> => ({ x: sp(tx, tz)[0], y: sp(tx, tz)[1], ...o });
const knight = (tx: number, tz: number, o: Partial<EntState> = {}): EntState => ent(10, KIND.Knight, { side: SIDE.Friendly, ...at2(tx, tz), ...o });
/**
 * The lowest y of a quad as the world sees it. A card's `lift` is divided by cos(pitch) by the camera passes (the cards' stretch), so a
 * foot at world height y is pushed with lift y * cos(pitch); dividing the buffer's y back gives the height the viewer sees.
 */
const low = (b: CardBuf, q = 0): number => Math.min(...ys(b, q)) / Math.cos(Math.PI / 4);
const span = (b: CardBuf): number => Math.max(...ys(b)) - Math.min(...ys(b));
/** Frames of `dt` seconds from clock `now0`; the last output. */
function run(fg: Figures3d, mk: (i: number) => EntState[], n: number, dt = 1 / 60, now0 = 10, o: (i: number) => Partial<RunFrame> = () => ({})): FigureOut {
  let out!: FigureOut;
  for (let i = 0; i < n; i++) out = fg.frame(frame(mk(i), { dt, now: now0 + i * dt, ...o(i) }), cam());
  return out;
}
const dryLow = low(make().frame(frame([ent(10, KIND.Knight, { side: SIDE.Friendly })]), cam()).cards);
const dryLook = make().frame(frame([ent(10, KIND.Knight, { side: SIDE.Friendly })]), cam()).cards.look[0];

describe('Figures3d on the bed of a dip (#324)', () => {
  it('stands a wading figure on the bed, uncropped', () => {
    const fg = dipFigs();
    const o = fg.frame(frame([knight(1, 1)]), cam());
    const bed = bedAt(dm, 1.5, 1.5);
    expect(bed).toBeLessThan(-0.3);
    expect(low(o.cards) - dryLow).toBeCloseTo(bed, 6);
    const dry = dipFigs().frame(frame([knight(8, 5)]), cam());
    expect(span(o.cards)).toBeCloseTo(span(dry.cards), 6);
    expect(fg.anchors.get(10)!.y).toBeCloseTo(bed, 6);
  });

  it('hangs the effects heights from the foot on the card path and the model path alike (R8)', () => {
    const bed = bedAt(dm, 1.5, 1.5);
    const card = (tx: number, tz: number) => dipFigs().frame(frame([ent(10, KIND.Barbarian, at2(tx, tz))]), cam());
    expect(card(1, 1).figs[0].foot).toBeCloseTo(bed, 6);
    expect(card(1, 1).figs[0].hand[1] - card(8, 5).figs[0].hand[1]).toBeCloseTo(bed, 6);
    expect(card(1, 1).figs[0].swingY - card(8, 5).figs[0].swingY).toBeCloseTo(bed, 6);
    expect(card(1, 1).figs[0].top).toBeCloseTo(card(8, 5).figs[0].top, 9);   // the size is not moved
  });

  it('keeps a dashing or incorporeal figure at floor height', () => {
    const dash = dipFigs().frame(frame([knight(1, 1, { anim: ANIM.Dash })]), cam());
    const dashDry = dipFigs().frame(frame([knight(8, 5, { anim: ANIM.Dash })]), cam());
    expect(low(dash.cards)).toBeCloseTo(low(dashDry.cards), 6);
    const fg = dipFigs();
    fg.frame(frame([knight(2, 4, { flags: FLAG.INCORPOREAL })]), cam());
    expect(fg.anchors.get(10)!.y).toBe(0);
    const fly = dipFigs();
    fly.frame(frame([knight(2, 4, { flags: FLAG.AIRBORNE })]), cam());
    expect(fly.anchors.get(10)!.y).toBe(0);
  });

  it('a big figure and a hero in lava both stand with the same share above the surface (#344)', () => {
    for (const kind of [KIND.Knight, KIND.Ogre]) {
      const fg = dipFigs();
      const mk = () => ent(10, kind, { side: SIDE.Friendly, ...at2(6, 1) });
      run(fg, () => [mk()], 600);
      const a = fg.anchors.get(10)!;
      const height = a.height / TILE;
      expect((LAVA_LEVEL - a.y) / height).toBeGreaterThan(LAVA_SHARE - 0.03);
      expect((LAVA_LEVEL - a.y) / height).toBeLessThan(LAVA_SHARE + 0.03);
    }
  });

  it('the sink does not depend on the pitch (#344)', () => {
    const settle = (pitch: number): number => {
      const fg = dipFigs();
      for (let i = 0; i < 600; i++) fg.frame(frame([knight(6, 1)], { dt: 1 / 60, now: 10 + i / 60 }), { ...cam(), pitch });
      return fg.anchors.get(10)!.y;
    };
    expect(settle(Math.PI / 6)).toBeCloseTo(settle(Math.PI * 80 / 180), 6);
  });

  it('sinks slowly into lava and comes back up', () => {
    const fg = dipFigs();
    let o = run(fg, () => [knight(6, 1)], 120);
    const lift = low(o.cards) - dryLow;
    expect(lift).toBeGreaterThan(LAVA_LEVEL - 1.05);
    expect(lift).toBeLessThan(LAVA_LEVEL - 0.5);
    expect(fg.anchors.get(10)!.y).toBeCloseTo(lift, 6);
    o = run(fg, () => [knight(8, 5)], 60, 1 / 60, 12);
    expect(low(o.cards) - dryLow).toBeCloseTo(bedAt(dm, 8.5, 5.5), 6);
  });

  it('drops a falling figure with gravity, darker with depth, no shadow, no caster, no opener, one fall cue', () => {
    const fg = dipFigs();
    const e = knight(2, 4);
    fg.event({ t: 'Sink', id: 10, x: e.x, y: e.y, how: 0 });
    const first = fg.frame(frame([e], { now: 10 }), cam());
    expect(first.falls).toEqual([{ id: 10, x: 2.5, z: 4.5 }]);
    const o = run(fg, () => [e], 30, 1 / 60, 10 + 1 / 60);
    expect(o.falls).toEqual([]);
    const lift = low(o.cards) - dryLow;
    expect(Math.abs(lift + 1.75)).toBeLessThan(0.2);
    expect(o.cards.look[0] / dryLook).toBeCloseTo(depthFade(lift), 6);
    expect(o.shadows.n).toBe(0);
    expect(o.casters).toEqual([]);
    expect(o.openers).toEqual([]);
    expect(fg.fallers).toBe(1);
    expect(fg.anchors.get(10)!.tagShown).toBe(false);
  });

  it('goes on falling after the entity is gone, and leaves no skull', () => {
    const fg = dipFigs();
    const e = knight(2, 4);
    fg.event({ t: 'Sink', id: 10, x: e.x, y: e.y, how: 0 });
    let o = run(fg, () => [e], 43);   // 0.7 s of fall
    const at07 = low(o.cards) - dryLow;
    fg.event({ t: 'Died', id: 10, x: e.x, y: e.y, kind: KIND.Knight });
    o = fg.frame(frame([], { now: 11, dt: 1 / 60 }), cam());
    expect(total(o)).toBeGreaterThan(0);
    for (let i = 0; i < 17; i++) o = fg.frame(frame([], { now: 11 + i / 60, dt: 1 / 60 }), cam());   // 1.0 s
    expect(total(o)).toBeGreaterThan(0);
    expect(low(o.cards.n ? o.cards : o.ghosts) - dryLow).toBeLessThan(at07);
    expect(o.decals.n).toBe(0);
    expect(o.shadows.n).toBe(0);
    expect(o.casters).toEqual([]);
    for (let i = 0; i < 40; i++) o = fg.frame(frame([], { now: 12 + i / 60, dt: 1 / 60 }), cam());   // 1.7 s
    expect(total(o)).toBe(0);
    expect(fg.fallers).toBe(0);
  });

  it('starts a fall that came before the first frame at that frame', () => {
    const e = knight(2, 4);
    const early = dipFigs();
    early.event({ t: 'Sink', id: 10, x: e.x, y: e.y, how: 0 });
    const o = early.frame(frame([e], { now: 50 }), cam());
    expect(bedAt(dm, 2.5, 4.5)).toBeLessThan(-1);   // the chasm's middle: the foot is not on it, it starts at the height it had (a new thing: 0)
    expect(low(o.cards) - dryLow).toBeCloseTo(0, 6);
    expect(o.falls).toHaveLength(1);
    const next = early.frame(frame([e], { now: 50.016, dt: 0.016 }), cam());
    expect(low(next.cards) - dryLow).toBeLessThan(0);
    expect(low(next.cards) - dryLow).toBeGreaterThan(-0.1);
  });

  it('ignores a second Sink and ends on a climb-out', () => {
    const fg = dipFigs();
    const e = knight(2, 4);
    fg.event({ t: 'Sink', id: 10, x: e.x, y: e.y, how: 0 });
    fg.event({ t: 'Sink', id: 10, x: e.x, y: e.y, how: 0 });
    let cues = fg.frame(frame([e]), cam()).falls.length;
    fg.event({ t: 'Sink', id: 10, x: e.x, y: e.y, how: 0 });
    for (let i = 0; i < 24; i++) cues += fg.frame(frame([e], { now: 10.1 + i / 60 }), cam()).falls.length;
    expect(cues).toBe(1);
    fg.event({ t: 'Sink', id: 10, x: e.x, y: e.y, how: 2 });
    const back = knight(8, 5);
    const o = fg.frame(frame([back], { now: 11 }), cam());
    expect(low(o.cards) - dryLow).toBeCloseTo(bedAt(dm, 8.5, 5.5), 6);
    expect(o.shadows.n).toBe(1);
    expect(total(fg.frame(frame([], { now: 11.1 }), cam()))).toBe(0);
  });

  it('does not make a figure fall that the server never sinks: a floor cell the rounded chasm outline reaches stands at floor height (R5)', () => {
    const t = new Uint8Array(8 * 6).fill(TILE_ID.Floor);
    for (const [x, z] of [[2, 1], [1, 2], [2, 2]]) t[z * 8 + x] = TILE_ID.Chasm;
    const m = new TileMap(8, 6, t);
    expect(bedAt(m, 1.92, 1.92)).toBeLessThan(-5);   // the outline's wall lies in this floor cell (an inner corner)
    const fg = new Figures3d({ ...init(), map: m }, frames, bounds);
    const k = (x: number, z: number) => ent(10, KIND.Knight, { side: SIDE.Friendly, x: x * TILE, y: z * TILE });
    const o = fg.frame(frame([k(1.92, 1.92)]), cam());
    expect(o.falls).toEqual([]);
    expect(low(o.cards) - dryLow).toBeCloseTo(walkBedAt(m, 1.92, 1.92), 6);
    expect(low(o.cards) - dryLow).toBeGreaterThan(-0.1);
    expect(fg.fallers).toBe(0);
    let last = o;
    for (let i = 0; i < 30; i++) last = fg.frame(frame([k(1.92 + i * 0.1, 1.92 + i * 0.07)], { now: 10.1 + i / 60 }), cam());
    last = fg.frame(frame([k(6, 4)], { now: 11 }), cam());
    expect(last.falls).toEqual([]);
    expect(low(last.cards) - dryLow).toBeCloseTo(0, 1);
    expect(last.cards.n).toBeGreaterThan(0);
  });

  it('falls the own hero from prediction', () => {
    const fg = dipFigs();
    const [x, y] = sp(2, 4);
    const f = (i: number) => frame([], { now: 10 + i / 60, own: own({ alive: true, x, y, sinking: true }) });
    let o = fg.frame(f(0), cam());
    for (let i = 1; i < 31; i++) o = fg.frame(f(i), cam());
    expect(Math.abs(low(o.cards) - dryLow + 1.75)).toBeLessThan(0.25);
  });

  it('gives a dark figure no fall cue, and it still falls', () => {
    const fg = dipFigs();
    const e = knight(2, 4);
    fg.event({ t: 'Sink', id: 10, x: e.x, y: e.y, how: 0 });
    const dark = new Set([10]);
    expect(fg.frame(frame([e], { dark }), cam()).falls).toEqual([]);
    const o = run(fg, () => [e], 30, 1 / 60, 10.1, () => ({ dark }));
    expect(low(o.cards) - dryLow).toBeLessThan(-1);
    expect(o.falls).toEqual([]);
  });

  it('a dark faller stays dark (flag and faded alpha) after the entity is gone (F3)', () => {
    for (const mode of ['fade', 'shape'] as const) {
      const fg = dipFigs();
      const e = knight(2, 4);
      const look = { ambient: [0, 0, 0] as [number, number, number], dark: mode, torchGlow: true, oval: 1 };
      fg.event({ t: 'Sink', id: 10, x: e.x, y: e.y, how: 0 });
      const dark = new Set([10]);
      run(fg, () => [e], 20, 1 / 60, 10, () => ({ dark }));
      fg.event({ t: 'Died', id: 10, x: e.x, y: e.y, kind: KIND.Knight });
      const o = fg.frame(frame([], { now: 10.4, dt: 1 / 60 }), cam(), look);   // the entity left the snapshot: its id is no longer in `dark`
      expect(total(o), mode).toBeGreaterThan(0);
      const bufs = [o.cards, o.ghosts].filter((b) => b.n > 0);
      for (const b of bufs) expect(b.dark.every((d) => d === 1), mode).toBe(true);
      if (mode === 'fade') expect(Math.max(...o.ghosts.look.filter((_, i) => i % 5 === 4))).toBe(0);
    }
  });

  it('reports a drowning once, a dark figure none, a barrel one', () => {
    const fg = dipFigs();
    const e = knight(3, 1);
    fg.event({ t: 'Sink', id: 10, x: e.x, y: e.y, how: 1 });
    const first = fg.frame(frame([e], { now: 10 }), cam());
    expect(first.sinks).toEqual([{ id: 10, x: 3.5, z: 1.5 }]);
    expect(first.falls).toEqual([]);
    const next = fg.frame(frame([e], { now: 10.1 }), cam());
    expect(next.sinks).toEqual([]);
    const dk = dipFigs();
    dk.event({ t: 'Sink', id: 10, x: e.x, y: e.y, how: 1 });
    expect(dk.frame(frame([e], { dark: new Set([10]) }), cam()).sinks).toEqual([]);
    const bg = dipFigs();
    const barrel = (anim: number): EntState => ent(20, KIND.Barrel, { ...at2(3, 1), anim, side: SIDE.Neutral });
    const o = bg.frame(frame([barrel(3)], { now: 10 }), cam());
    expect(o.sinks).toEqual([{ id: 20, x: 3.5, z: 1.5 }]);
    expect(bg.frame(frame([barrel(3)], { now: 10.1 }), cam()).sinks).toEqual([]);
  });

  it('reports no drowning for a fall', () => {
    const fg = dipFigs();
    const e = knight(2, 4);
    fg.event({ t: 'Sink', id: 10, x: e.x, y: e.y, how: 0 });
    const o = fg.frame(frame([e], { now: 10 }), cam());
    expect(o.sinks).toEqual([]);
    expect(o.falls).toHaveLength(1);
  });

  it('drowns onto the bed and leaves nothing', () => {
    const fg = dipFigs();
    const e = knight(3, 1);
    fg.event({ t: 'Sink', id: 10, x: e.x, y: e.y, how: 1 });
    const n = Math.ceil((CONST.DROWN_TIME + 0.1) * 60);
    const o = run(fg, () => [e], n);
    expect(low(o.cards) - dryLow).toBeCloseTo(bedAt(dm, 3.5, 1.5), 6);
    expect(o.falls).toEqual([]);
    fg.event({ t: 'Died', id: 10, x: e.x, y: e.y, kind: KIND.Knight });
    expect(total(fg.frame(frame([], { now: 20 }), cam()))).toBe(0);
    expect(total(fg.frame(frame([], { now: 20.1 }), cam()))).toBe(0);
  });

  it('falls a barrel: whole size, opaque, below the floor, drawn after the entity is gone', () => {
    const fg = dipFigs();
    const b = (anim: number, ms: number): EntState => ent(20, KIND.Barrel, { ...at2(2, 4), anim, animMs: ms, side: SIDE.Neutral });
    const rest = low(make().frame(frame([ent(20, KIND.Barrel, { side: SIDE.Neutral })]), cam()).cards);
    let o = fg.frame(frame([b(2, 0)], { now: 10 }), cam());
    expect(o.falls).toEqual([{ id: 20, x: 2.5, z: 4.5 }]);
    for (let i = 1; i < 31; i++) o = fg.frame(frame([b(2, i * 16)], { now: 10 + i / 60 }), cam());
    expect(o.cards.look[4]).toBe(1);
    expect(Math.abs(low(o.cards) - rest + 1.75)).toBeLessThan(0.25);
    expect(span(o.cards)).toBeCloseTo(span(make().frame(frame([ent(20, KIND.Barrel, { side: SIDE.Neutral })]), cam()).cards), 6);
    expect(o.shadows.n).toBe(0);
    o = fg.frame(frame([], { now: 11 }), cam());
    expect(total(o)).toBe(1);
    expect(fg.fallers).toBe(1);
    for (let i = 0; i < 90; i++) o = fg.frame(frame([], { now: 11.1 + i / 60 }), cam());
    expect(total(o)).toBe(0);
  });

  describe('a barrel pushed into a chasm (F1)', () => {
    // The drawn spot lags the server's: anim 2 arrives while the interpolated spot is still on the floor cell before the rim (chasm cells 2..3 x 4..5).
    const push = (startX: number, speed: number, dt: number) => {
      const fg = dipFigs();
      const rest = low(make().frame(frame([ent(20, KIND.Barrel, { side: SIDE.Neutral })]), cam()).cards);
      const barrel = (x: number, anim: number): EntState => ent(20, KIND.Barrel, { x: x * TILE, y: 4.5 * TILE, anim, side: SIDE.Neutral });
      let now = 10, x = startX - speed * 0.3;
      while (x < startX - 1e-9) { fg.frame(frame([barrel(x, 0)], { dt, now }), cam()); x += speed * dt; now += dt; }
      let minLow = Infinity, goneAt = -1, t = 0;
      for (let i = 0; i < Math.ceil(3 / dt) && goneAt < 0; i++) {
        const o = fg.frame(frame([barrel(startX, 2)], { dt, now }), cam());
        t += dt; now += dt;
        if (total(o) > 0) minLow = Math.min(minLow, low(o.cards) - rest);
        else goneAt = t;
      }
      return { minLow, goneAt };
    };
    for (const dt of [1 / 60, 0.05]) {
      for (const [startX, speed] of [[1.8, 6], [1.5, 0]] as const) {
        it(`falls into the hole from x = ${startX} at ${speed} tiles/s, dt ${dt}`, () => {
          const r = push(startX, speed, dt);
          expect(r.minLow).toBeLessThan(-1);
          expect(r.goneAt).toBeGreaterThan(0);
          expect(r.goneAt).toBeLessThan(2.5);
        });
      }
    }
  });

  it('draws no shadow under water or in the air, and one at the bed on the bank above the level', () => {
    const bank = dipFigs().frame(frame([ent(10, KIND.Knight, { side: SIDE.Friendly, x: 0.9 * TILE, y: 1.5 * TILE })]), cam());
    expect(bank.shadows.n).toBe(1);
    expect(bedAt(dm, 0.9, 1.5)).toBeGreaterThanOrEqual(WATER_LEVEL);
    const wade = dipFigs().frame(frame([knight(1, 1)]), cam());
    expect(wade.shadows.n).toBe(0);
    const air = dipFigs().frame(frame([knight(3, 1, { anim: ANIM.Dash })]), cam());   // dashing over the deep: above its bed
    expect(air.shadows.n).toBe(0);
    const void_ = dipFigs().frame(frame([knight(2, 4, { anim: ANIM.Dash })]), cam());   // dashing over the chasm: nothing to lie on
    expect(void_.shadows.n).toBe(0);
  });

  it('gives the knight at an inner corner of the chasm outline floor height and no oval (R9)', () => {
    const t = new Uint8Array(8 * 6).fill(TILE_ID.Floor);
    for (const [x, z] of [[2, 1], [1, 2], [2, 2]]) t[z * 8 + x] = TILE_ID.Chasm;
    const m = new TileMap(8, 6, t);
    const fg = new Figures3d({ ...init(), map: m }, frames, bounds);
    const o = fg.frame(frame([ent(10, KIND.Knight, { side: SIDE.Friendly, x: 1.92 * TILE, y: 1.92 * TILE })]), cam());
    expect(low(o.cards) - dryLow).toBeCloseTo(0, 1);
    expect(o.shadows.n).toBe(0);
    const away = fg.frame(frame([ent(10, KIND.Knight, { side: SIDE.Friendly, x: 6 * TILE, y: 4 * TILE })], { now: 11 }), cam());
    expect(away.shadows.n).toBe(1);
  });

  it('lifts a chest, a skull and a lying body onto the bed', () => {
    const fg = dipFigs();
    const chest = fg.frame(frame([ent(30, KIND.Chest, { ...at2(1, 1), side: SIDE.Neutral })]), cam());
    expect(low(chest.cards)).toBeCloseTo(low(make().frame(frame([ent(30, KIND.Chest, { side: SIDE.Neutral })]), cam()).cards) + bedAt(dm, 1.5, 1.5), 6);
    expect(fg.anchors.get(30)!.y).toBeCloseTo(bedAt(dm, 1.5, 1.5), 6);
    // the skull a figure leaves lies on the bed too (rule 7)
    fg.event({ t: 'Died', id: 11, x: sp(1, 1)[0], y: sp(1, 1)[1], kind: KIND.Knight });
    const skull = fg.frame(frame([], { now: 11 }), cam());
    expect(skull.decals.n).toBe(1);
    const under = bedAt(dm, 1.5, 1.5 - 2 / TILE);   // the token lies 2 px up the screen from the death spot (yaw 0)
    expect(under).toBeLessThan(-0.3);
    for (const y of ys(skull.decals)) expect(y).toBeCloseTo(LIE_Y + under, 5);
  });
});
