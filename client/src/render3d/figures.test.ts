import { describe, expect, it } from 'vitest';
import { ANIM, EFFECT, FLAG, KIND, SIDE, TILE_ID } from '../generated/defs';
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

/** A 4x1 map: floor, deep water, chasm, shallow water. */
const map = (): TileMap => new TileMap(4, 1, Uint8Array.from([TILE_ID.Floor, TILE_ID.DeepWater, TILE_ID.Chasm, TILE_ID.ShallowWater]));
const init = (): RunViewInit => ({ info: startInfo(['....']), map: map(), light: {} as RunViewInit['light'], myKind: KIND.Wizard });

const own = (o: Partial<OwnHero> = {}): OwnHero => ({ x: at(0), y: 8, alive: false, charmed: false, anim: ANIM.Idle, animT: 0, aim: 0, flags: 0, effects: 0, entangled: 0, dashing: false, sinking: false, aimsAtPointer: false, aimFromX: at(0), aimFromY: 8, ...o });
const ent = (id: number, kind: number, o: Partial<EntState> = {}): EntState => ({ id, kind, x: at(0), y: 8, hp: 10, anim: ANIM.Idle, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0, side: SIDE.Hostile, entangled: 0, ...o });
const frame = (ents: EntState[], o: Partial<RunFrame> = {}): RunFrame => ({
  dt: 0.016, now: 10, ents: new Map(ents.map((e) => [e.id, e])), you: 1, own: own(), watching: null, camera: { x: 0, y: 0 }, snap: undefined, shots: [], hiddenShots: new Set(),
  useHint: null, dark: new Set(), debug: { on: false, path: [], ogre: [], cove: [], notice: [], dodges: [] }, ...o,
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
    expect(make().frame(frame([server]), cam()).glows.n).toBe(1);
    const shot: ShotView = { shot: 1, kind: KIND.Arrow, x: at(1), y: 8, vx: 100, vy: 0 };
    const out = make().frame(frame([ent(20, KIND.Arrow)], { hiddenShots: new Set([20]), shots: [shot] }), cam());
    expect(out.cards.n).toBe(1);
    expect(mid(ys(out.cards))).toBeCloseTo(0.5, 6);
    // a glow shot of the own hero: size scale * 7 / 16 tiles
    const g = make().frame(frame([], { shots: [{ ...shot, kind: KIND.Fireball }] }), cam());
    expect(g.glows.n).toBe(1);
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

  it('cuts the body of a wading knight by the sink and lowers it by the same', () => {
    const dry = make().frame(frame([ent(10, KIND.Knight, { x: at(0) })]), cam());
    const wet = make().frame(frame([ent(10, KIND.Knight, { x: at(3) })]), cam());
    const sink = 3 / TILE; // shallow water
    expect(Math.max(...ys(dry.cards)) - Math.max(...ys(wet.cards))).toBeCloseTo(sink, 6);
    expect(Math.min(...ys(wet.cards))).toBeCloseTo(0, 6);
    expect(Math.min(...ys(dry.cards))).toBeCloseTo(0, 6);
    expect(wet.shadows.n).toBe(0);
    expect(dry.shadows.n).toBe(1);
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

    // chests: closed lid, then the lid over the gold, then empty
    const chest = (anim: number, animMs: number) => ent(31, KIND.Chest, { anim, animMs, side: SIDE.Neutral });
    expect(nameOf(make().frame(frame([chest(0, 0)]), cam()).cards)).toBe('chest_full_open_anim_f0');
    const co = make().frame(frame([chest(1, 600)]), cam());
    expect(nameOf(co.cards)).toBe('chest_empty_open_anim_f2');
    expect(co.shadows.n).toBe(1);
    expect(co.openers[0].who).toBe('chest');

    // barrels: a flash frame of the fuse is a fill, a resting one is not, a sinking one is translucent and sunk
    const barrel = (anim: number, animMs: number) => ent(32, KIND.Barrel, { anim, animMs, side: SIDE.Neutral });
    expect(make().frame(frame([barrel(1, 0)]), cam()).cards.look[3]).toBe(1);
    expect(make().frame(frame([barrel(0, 0)]), cam()).cards.look[3]).toBe(0);
    const sunk = make().frame(frame([barrel(3, 200)]), cam());
    expect(sunk.ghosts.n).toBe(1);
    expect(sunk.cards.n).toBe(0);
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
    // the 2D numbers: height is the frame height times the scale, the tag sits 3 px above the foot
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
  });
});

describe('Figures3d in the dark (#304)', () => {
  const look = (ambient: [number, number, number], dark: 'fade' | 'shape' = 'fade', torchGlow = true) => ({ ambient, dark, torchGlow });
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
    // anim 2: a barrel falling into a chasm fades out
    const o = make().frame(frame([ent(21, KIND.Barrel, { side: SIDE.Neutral, anim: 2, animMs: 200 })]), cam(), look(AMBIENT));
    expect(o.ghosts.n).toBe(1);
    expect(o.cards.n).toBe(0);
    expect(o.casters).toEqual([]);
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

  it('the board objects are scenery: torch flame, barrel, mimic, skull and coins', () => {
    const torch = make().frame(frame([ent(30, KIND.Torch, { x: 3 * 16 + 8, y: 2 * 16 + 0.5, extra: 0, anim: 1, side: SIDE.Neutral })]), cam());
    for (let i = 0; i < torch.emissive.n * 6; i++) expect(footOf(torch.emissive, i).scenery).toBe(1);
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
