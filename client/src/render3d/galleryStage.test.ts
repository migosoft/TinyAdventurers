import { describe, expect, it } from 'vitest';
import { ANIM, EFFECT, FLAG, KIND, SIDE, TILE_ID } from '../generated/defs';
import { FIGURES, PROJECTILES } from '../game/anim/defs';
import type { FrameBounds } from '../game/anim/pose';
import { isR3dDemo, r3dPage } from '../r3dFlag';
import { seenOpeners } from './openers';
import { Figures3d } from './figures';
import { CROWD_MAX } from './galleryMap';
import { GALLERY, ID, STATES, diedBetween, galleryEnts, galleryFrame, galleryInit, modelsOf, parseGallery } from './galleryStage';
import { MODEL_OF_KIND, modelKeyOf } from './models/table';
import type { FrameRects } from './worldMesh';
import type { Cam } from './camera';

const frames: FrameRects = {};
const add = (name: string | undefined, w: number, h: number) => {
  if (name) frames[name] = { x: 10, y: 20, w, h };
};
for (const d of Object.values(FIGURES)) {
  for (let i = 0; i < 4; i++) for (const p of [d.idle, d.run]) add(`${p}${i}`, 16, 28);
  add(d.hit, 16, 28);
  add(d.weapon, 8, 20);
  add(d.meleeWeapon, 8, 20);
  for (const a of Object.values(d.frames ?? {})) for (let i = 0; i < a.n; i++) add(`${a.prefix}${i}`, 86, 54);
}
for (const p of Object.values(PROJECTILES)) add(p.frame, 8, 16);
for (const f of ['skull', 'barrel_explosive', 'chest_empty_open_anim_f2', 'torch_out']) add(f, 16, 16);
for (let i = 0; i < 3; i++) for (const p of ['chest_full_open_anim_f', 'chest_mimic_open_anim_f']) add(`${p}${i}`, 16, 16);
for (let i = 0; i < 5; i++) add(`torch_f${i}`, 16, 16);
const bounds = (f: string): FrameBounds => {
  const r = frames[f] ?? { w: 16, h: 16 };
  return { l: 0, r: r.w - 1, t: 0, w: r.w, h: r.h };
};
const cam = (yaw = 0): Cam => ({ x: 10, z: 10, pitch: Math.PI / 4, yaw });
const make = () => new Figures3d(galleryInit(), frames, bounds);
const inRange = (id: number, a: number, n: number) => id >= a && id < a + n;

describe('the gallery stage', () => {
  const kinds = Object.keys(FIGURES).map(Number);
  const nFig = kinds.length;

  it('holds every FIGURES kind, once, in the figure rows', () => {
    const ents = galleryEnts(0, 'idle').filter((e) => inRange(e.id, ID.figure, nFig));
    expect(ents.map((e) => e.kind).sort((a, b) => a - b)).toEqual([...kinds].sort((a, b) => a - b));
  });

  it('gives a body card for each kind at state=idle', () => {
    const fg = make();
    const ents = galleryEnts(0, 'idle').filter((e) => inRange(e.id, ID.figure, nFig));
    const out = fg.frame(galleryFrame(ents, 0, 0.016), cam());
    expect(fg.count).toBe(nFig);
    expect(out.cards.n + out.ghosts.n + out.decals.n).toBeGreaterThanOrEqual(nFig);
  });

  it('shows the dragon in its breath frame at state=breath', () => {
    const fg = make();
    fg.frame(galleryFrame(galleryEnts(0.3, 'breath'), 0.3, 0.016), cam());
    const id = galleryEnts(0, 'breath').find((e) => e.kind === KIND.Dragon && inRange(e.id, ID.figure, nFig))!.id;
    expect(galleryEnts(0.3, 'breath').find((e) => e.id === id)!.anim).toBe(ANIM.Breath);
    expect(fg.framePoint(id, FIGURES[KIND.Dragon].mouth)).not.toBeNull();
  });

  it('cycles through the states every 1.2 s, and &state= pins one', () => {
    const anim = (t: number, s: string | null) => galleryEnts(t, s).find((e) => e.id === ID.figure)!.anim;
    expect(STATES.map(([n]) => n)).toEqual(['idle', 'move', 'melee', 'shoot', 'cast', 'windup', 'dash', 'channel', 'breath', 'tail', 'bite', 'takeoff', 'land']);
    expect(anim(0.1, null)).toBe(ANIM.Idle);
    expect(anim(1.3, null)).toBe(ANIM.Move);
    expect(anim(2.5, null)).toBe(ANIM.Melee);
    expect(anim(0.1, 'cast')).toBe(ANIM.Cast);
    expect(anim(7, 'cast')).toBe(ANIM.Cast);
  });

  it('has an effect row: knight, skeleton, ogre and lich under each effect, the party invisible, and a wading group on water', () => {
    const ents = galleryEnts(0, null).filter((e) => inRange(e.id, ID.effect, 1000));
    for (const eff of ['Sleep', 'Petrified', 'Frozen', 'Slowed', 'Poisoned', 'Chilled', 'Tainted', 'Invisible'] as const) {
      const k = ents.filter((e) => e.effects & (1 << EFFECT[eff])).map((e) => e.kind);
      expect(k.length, eff).toBe(4);
    }
    expect(ents.filter((e) => e.flags & FLAG.INCORPOREAL)).toHaveLength(4);
    const inv = ents.filter((e) => e.effects & (1 << EFFECT.Invisible)).map((e) => e.kind);
    expect(inv.sort()).toEqual([KIND.Wizard, KIND.Paladin, KIND.Barbarian, KIND.ElvenRanger].sort());
    const wade = ents.filter((e) => GALLERY.map.tileAt(e.x, e.y) === TILE_ID.ShallowWater);
    expect(wade.map((e) => e.kind).sort()).toEqual([KIND.Knight, KIND.SkeletonWarrior, KIND.Ogre, KIND.Lich].sort());
  });

  it('has the world objects and every projectile kind', () => {
    const ents = galleryEnts(0, null);
    for (const k of [KIND.Chest, KIND.Barrel, KIND.Mimic, KIND.Torch]) expect(ents.some((e) => e.kind === k), `${k}`).toBe(true);
    expect(ents.filter((e) => e.kind === KIND.Mimic && e.flags & FLAG.HIDING).length).toBeGreaterThan(0);
    expect(ents.filter((e) => e.kind === KIND.Mimic && !(e.flags & FLAG.HIDING)).length).toBeGreaterThan(0);
    expect(ents.filter((e) => e.kind === KIND.Torch && e.id < ID.model).map((e) => e.anim).sort()).toEqual([0, 1]);
    const shots = ents.filter((e) => inRange(e.id, ID.shot, 100)).map((e) => e.kind).sort((a, b) => a - b);
    expect(shots).toEqual(Object.keys(PROJECTILES).map(Number).sort((a, b) => a - b));
  });

  it('cycles the explosive barrel through rest, fuse, fall and sink', () => {
    const seen = new Set<number>();
    for (let t = 0; t < 8; t += 0.05) seen.add(galleryEnts(t, null).find((e) => e.id === ID.barrelCycle)!.anim);
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('opens the walls for the corridor walkers, but not for the barrel or the Neutral knight, at any time', () => {
    for (const t of [0, 1.7, 5.3, 9]) {
      const fg = make();
      const ents = galleryEnts(t, null).filter((e) => inRange(e.id, ID.corridor, 1000));
      const out = fg.frame(galleryFrame(ents, t, 0.016), cam());
      const ids = out.openers.map((o) => o.id).sort((a, b) => a - b);
      expect(ids).toEqual(ID.corridorOpeners);
      expect(ents.find((e) => e.id === ID.corridorBarrel)!.kind).toBe(KIND.Barrel);
      const knight = ents.find((e) => e.id === ID.corridorKnight)!;
      expect(knight.kind).toBe(KIND.Knight);
      expect(knight.side).toBe(SIDE.Neutral);
      // an all-visible sight keeps them all
      expect(seenOpeners(out.openers, { isVisible: () => true }, new Set())).toHaveLength(out.openers.length);
    }
    // the walkers: a hero, five skeletons, a wolf, a chest and a closed mimic
    const w = galleryEnts(0, null).filter((e) => inRange(e.id, ID.corridor, 1000));
    expect(w.filter((e) => e.kind === KIND.SkeletonWarrior)).toHaveLength(5);
    expect(w.filter((e) => e.kind === KIND.DireWolf)).toHaveLength(1);
    expect(w.find((e) => e.kind === KIND.Mimic)!.flags & FLAG.HIDING).toBeTruthy();
    // all inside the corridor
    for (const e of w) {
      expect(e.y / 16).toBeGreaterThan(1);
      expect(e.y / 16).toBeLessThan(4);
    }
  });

  it('is a floor under every cell and a full wall between the corridor and the rows', () => {
    const m = GALLERY.map;
    for (let i = 0; i < nFig; i++) expect(m.tileAt(GALLERY.figure(i).x * 16, GALLERY.figure(i).z * 16)).toBe(TILE_ID.Floor);
    for (let x = 2; x < 47; x++) {
      expect(m.get(x, 4)).toBe(TILE_ID.Wall);
      expect(m.get(x, 5)).toBe(TILE_ID.Wall);
      expect(m.get(x, 2)).toBe(TILE_ID.Floor);
    }
  });

  it('reads the URL: state, slow and focus', () => {
    const d = { state: null, slow: 1, focus: 'figures', start: 0, crowd: 0, crowdAs: 'models', light: 'work', at: null, aim: null };
    expect(parseGallery('?r3d=gallery')).toEqual(d);
    expect(parseGallery('?r3d=gallery&state=melee&slow=8&focus=corridor&t=1.5')).toEqual({ ...d, state: 'melee', slow: 8, focus: 'corridor', start: 1.5 });
    expect(parseGallery('?r3d=gallery&state=nope&slow=0&focus=x&t=-2')).toEqual(d);
  });

  it('reads the model options: focus=models, crowd, crowdAs, light and at', () => {
    expect(parseGallery('?focus=models&crowd=40&crowdAs=cards&light=torch&at=12.5,60')).toEqual({
      state: null, slow: 1, focus: 'models', start: 0, crowd: 40, crowdAs: 'cards', light: 'torch', at: { x: 12.5, z: 60 }, aim: null,
    });
    expect(parseGallery('?at=model:3').at).toEqual(GALLERY.model(3));
    expect(parseGallery('?at=effect:2,4').at).toEqual(GALLERY.modelEffect(2, 4));
    expect(parseGallery('?at=dying:1').at).toEqual(GALLERY.dying(1));
    expect(parseGallery('?at=crowd:7').at).toEqual(GALLERY.crowd(7));
    // `aim=<deg>` pins the aim of the figure rows and the model rows (a figure that faces the camera shows its front)
    expect(parseGallery('?aim=90').aim).toBeCloseTo(Math.PI / 2, 9);
    expect(parseGallery('?aim=x').aim).toBeNull();
    expect(parseGallery('?').aim).toBeNull();
    const pinned = galleryEnts(3.3, null, 0, 1.2);
    expect(pinned.filter((e) => inRange(e.id, ID.model, 9) || inRange(e.id, ID.figure, 100)).every((e) => e.aim === 1.2)).toBe(true);
    expect(galleryEnts(3.3, null).find((e) => e.id === ID.model)!.aim).not.toBe(1.2);
    expect(parseGallery('?crowd=-3&crowdAs=x&light=y&at=1').crowd).toBe(0);
    expect(parseGallery('?crowd=100000').crowd).toBe(CROWD_MAX);
    const q = parseGallery('?crowd=2.7&crowdAs=x&light=y&at=1');
    expect([q.crowd, q.crowdAs, q.light, q.at]).toEqual([2, 'models', 'work', null]);
  });

  it('has the model block: 9 kinds from ID.model, each cycling through the states like the card rows', () => {
    const rows = galleryEnts(0.1, null).filter((e) => inRange(e.id, ID.model, 9));
    expect(rows.map((e) => e.id)).toEqual(Array.from({ length: 9 }, (_, i) => 4000 + i));
    expect(ID.model).toBe(4000);
    expect(rows.map((e) => modelKeyOf(e.kind)).every((k) => k !== null)).toBe(true);
    expect(new Set(rows.map((e) => modelKeyOf(e.kind))).size).toBe(7);
    expect(rows.map((e) => e.kind).sort((a, b) => a - b)).toEqual(Object.keys(MODEL_OF_KIND).map(Number).sort((a, b) => a - b));
    const anim = (t: number, s: string | null) => galleryEnts(t, s).find((e) => e.id === ID.model)!.anim;
    expect(anim(0.1, null)).toBe(ANIM.Idle);
    expect(anim(1.3, null)).toBe(ANIM.Move);
    expect(anim(5, 'melee')).toBe(ANIM.Melee);
    // the hurt flag of the card rows
    const fig = galleryEnts(0.1, null).find((e) => e.id === ID.figure)!;
    expect(rows[0].flags).toBe(fig.flags);
    expect(rows[0].flags & FLAG.HURT).toBeTruthy();
    // each stands on its own cell, on a floor
    for (const e of rows) expect(GALLERY.map.tileAt(e.x, e.y)).toBe(TILE_ID.Floor);
  });

  it('has the effect block: 9 effect rows of the four heroes, a skeleton, the ogre and the wolf', () => {
    const ents = galleryEnts(0, null).filter((e) => inRange(e.id, ID.modelEffect, 200));
    expect(ents).toHaveLength(9 * 7);
    const kinds = ents.slice(0, 7).map((e) => e.kind);
    expect(kinds).toEqual([KIND.Wizard, KIND.Paladin, KIND.Barbarian, KIND.ElvenRanger, KIND.SkeletonWarrior, KIND.Ogre, KIND.DireWolf]);
    for (const eff of ['Sleep', 'Petrified', 'Frozen', 'Slowed', 'Poisoned', 'Chilled', 'Tainted', 'Invisible'] as const) {
      expect(ents.filter((e) => e.effects & (1 << EFFECT[eff])), eff).toHaveLength(7);
    }
    expect(ents.filter((e) => e.flags & FLAG.INCORPOREAL)).toHaveLength(7);
    for (const e of ents) expect(GALLERY.map.tileAt(e.x, e.y)).toBe(TILE_ID.Floor);
  });

  it('lets one figure of each kind die every 6 s and leave its skull', () => {
    const alive = (t: number) => galleryEnts(t, null).filter((e) => inRange(e.id, ID.dying, 100));
    expect(alive(1)).toHaveLength(9);
    expect(alive(4)).toHaveLength(0);
    expect(alive(7)).toHaveLength(9);
    expect(diedBetween(2.9, 3.1)).toHaveLength(9);
    expect(diedBetween(3.1, 5)).toHaveLength(0);
    expect(diedBetween(8.9, 9.1)).toHaveLength(9);
    const ev = diedBetween(2.9, 3.1)[0];
    expect(ev.t).toBe('Died');
    const e = alive(1)[0];
    expect([ev.id, ev.kind, ev.x, ev.y]).toEqual([e.id, e.kind, e.x, e.y]);
  });

  it('adds `crowd` walking model figures on a 2 tile grid, none by default', () => {
    expect(galleryEnts(0, null).some((e) => e.id >= ID.crowd)).toBe(false);
    const c = galleryEnts(1, null, 40).filter((e) => e.id >= ID.crowd);
    expect(c).toHaveLength(40);
    expect(c.every((e) => e.anim === ANIM.Move && modelKeyOf(e.kind) !== null)).toBe(true);
    const home = GALLERY.crowd(5);
    expect(Math.abs(c[5].x / 16 - home.x)).toBeLessThan(1);
    expect(GALLERY.crowd(1).x - GALLERY.crowd(0).x).toBe(2);
    for (let i = 0; i < CROWD_MAX; i += 17) expect(GALLERY.map.tileAt(GALLERY.crowd(i).x * 16, GALLERY.crowd(i).z * 16)).toBe(TILE_ID.Floor);
  });

  it('draws as models exactly the ids of the model blocks and the crowd, and not a crowd that is cards', () => {
    const o = parseGallery('?crowd=5');
    const is = modelsOf(o);
    const ents = galleryEnts(0, null, 5);
    const yes = ents.filter(is).map((e) => e.id);
    expect(yes.every((id) => id >= ID.model)).toBe(true);
    expect(yes.filter((id) => inRange(id, ID.model, 9))).toHaveLength(9);
    expect(yes.filter((id) => inRange(id, ID.modelEffect, 200))).toHaveLength(63);
    expect(yes.filter((id) => id >= ID.crowd)).toHaveLength(5);
    expect(ents.filter((e) => e.id < ID.model).some(is)).toBe(false);
    const cards = modelsOf(parseGallery('?crowd=5&crowdAs=cards'));
    expect(ents.filter(cards).some((e) => e.id >= ID.crowd)).toBe(false);
    expect(ents.filter(cards).filter((e) => e.id < ID.crowd)).toHaveLength(yes.length - 5);
  });

  it('has a lit torch on each pillar of the model block, on a wall', () => {
    const t = galleryEnts(0, null).filter((e) => inRange(e.id, ID.pillarTorch, 2));
    expect(t.map((e) => [e.kind, e.anim, e.extra])).toEqual([[KIND.Torch, 1, 0], [KIND.Torch, 1, 0]]);
    for (const e of t) expect(GALLERY.map.get(Math.floor(e.x / 16), Math.floor(e.y / 16) - 1)).toBe(TILE_ID.Wall);
  });

  it('is its own ?r3d page, a server-free one like the demo', () => {
    expect(r3dPage('?r3d=gallery')).toBe('gallery');
    expect(r3dPage('?r3d=demo')).toBe('demo');
    expect(r3dPage('?r3d')).toBeNull();
    expect(isR3dDemo('?r3d=gallery')).toBe(true);
  });
});
