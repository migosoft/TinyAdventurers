import { describe, expect, it } from 'vitest';
import { ANIM, EFFECT, FLAG, KIND, SIDE, TILE_ID } from '../generated/defs';
import { FIGURES, PROJECTILES } from '../game/anim/defs';
import type { FrameBounds } from '../game/anim/pose';
import { isR3dDemo, r3dPage, wants3d } from '../r3dFlag';
import { seenOpeners } from './openers';
import { Figures3d } from './figures';
import { GALLERY, ID, STATES, galleryEnts, galleryFrame, galleryInit, parseGallery } from './galleryStage';
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
    expect(ents.filter((e) => e.kind === KIND.Torch).map((e) => e.anim).sort()).toEqual([0, 1]);
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
      const ents = galleryEnts(t, null).filter((e) => e.id >= ID.corridor);
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
    const w = galleryEnts(0, null).filter((e) => e.id >= ID.corridor);
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
    expect(parseGallery('?r3d=gallery')).toEqual({ state: null, slow: 1, focus: 'figures', start: 0 });
    expect(parseGallery('?r3d=gallery&state=melee&slow=8&focus=corridor&t=1.5')).toEqual({ state: 'melee', slow: 8, focus: 'corridor', start: 1.5 });
    expect(parseGallery('?r3d=gallery&state=nope&slow=0&focus=x&t=-2')).toEqual({ state: null, slow: 1, focus: 'figures', start: 0 });
  });

  it('is its own ?r3d page, a server-free one like the demo', () => {
    expect(r3dPage('?r3d=gallery')).toBe('gallery');
    expect(r3dPage('?r3d=demo')).toBe('demo');
    expect(r3dPage('?r3d')).toBeNull();
    expect(isR3dDemo('?r3d=gallery')).toBe(true);
    expect(wants3d('?r3d=gallery', true)).toBe(false);
  });
});
