import { describe, expect, it } from 'vitest';
import { ANIM, CONST, EFFECT, FLAG, KIND, SIDE, TILE_ID } from '../generated/defs';
import { FIGURES, PROJECTILES } from '../game/anim/defs';
import type { FrameBounds } from '../game/anim/pose';
import { isR3dDemo, r3dPage } from '../r3dFlag';
import { seenOpeners } from './openers';
import { Figures3d } from './figures';
import { CROWD_MAX, MODEL_EFFECT_COLS, MODEL_EFFECT_STRIDE, MODEL_KIND_ROW_PITCH, MODEL_PER_ROW, layoutOf } from './galleryMap';
import { GALLERY, ID, LINEUP_KEYS, SPECTRE_LIFE, STATES, circleOf, diedBetween, galleryEnts, galleryFrame, galleryInit, lineupCircles, lineupKind, modelsOf, parseGallery, spectrePassIn, spectreAt, spectreDiedBetween } from './galleryStage';
import { Effects3d, clearFxRegistry } from './fx/effects3d';
import { registerFigureFx } from './fx/figureFx';
import { clearVeils, registerStatus } from './fx/status';
import { newGlowBuf } from './cards';
import { shade } from './models/descs/shade';
import type { DrawnFig, FxOut } from './fx/types';
import type { EntState } from '../game/world';
import { TileMap } from '../sim/map';
import { FxTris } from './fx/tris';
import { LINEUP_MAX, OBJECT_PLACES, SPECTRE_PITCH, SPECTRE_PLACES } from './galleryMap';
import { buildJob } from './models/build';
import { MODEL_OF_KIND, OBJECT_MODEL, floats, modelKeyOf, objectModelOf } from './models/table';
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
/** How many game kinds have a 3D model: the model block, the dying row and the lit block have one figure of each. */
const KINDS = Object.keys(MODEL_OF_KIND).length;

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

  it('&circles=1 draws the hit circle of every line-up figure: a monster its server radius, a hero the player radius', () => {
    expect(parseGallery('?focus=lineup&circles=1').circles).toBe(true);
    expect(parseGallery('?focus=lineup&circles=0').circles).toBe(false);
    expect(LINEUP_KEYS.map((k) => circleOf(lineupKind(k)))).toEqual([4, 4, 4, 6, 6, 4, 5, 5, 4, 5, 5, 5, 6, 10, 5, 5, 6, 4, 6, 4, 4, 4, 4, 4]);
    const T = new FxTris(4096);
    lineupCircles(T);
    expect(T.n).toBe(LINEUP_KEYS.length * 64);
    expect(T.dropped).toBe(0);
  });

  it('reads the URL: state, slow and focus', () => {
    const d = { state: null, slow: 1, focus: 'figures', start: 0, crowd: 0, crowdAs: 'models', crowdKinds: null, light: 'work', at: null, aim: null, circles: false };
    expect(parseGallery('?r3d=gallery')).toEqual(d);
    expect(parseGallery('?r3d=gallery&state=melee&slow=8&focus=corridor&t=1.5')).toEqual({ ...d, state: 'melee', slow: 8, focus: 'corridor', start: 1.5 });
    expect(parseGallery('?r3d=gallery&state=nope&slow=0&focus=x&t=-2')).toEqual(d);
  });

  it('reads the model options: focus=models, crowd, crowdAs, light and at', () => {
    expect(parseGallery('?focus=models&crowd=40&crowdAs=cards&light=torch&at=12.5,60')).toEqual({
      state: null, slow: 1, focus: 'models', start: 0, crowd: 40, crowdAs: 'cards', crowdKinds: null, light: 'torch', at: { x: 12.5, z: 60 }, aim: null, circles: false,
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

  it('has the model block: every model kind from ID.model, each cycling through the states like the card rows', () => {
    const rows = galleryEnts(0.1, null).filter((e) => inRange(e.id, ID.model, KINDS));
    expect(KINDS).toBeGreaterThanOrEqual(15);
    expect(rows.map((e) => e.id)).toEqual(Array.from({ length: KINDS }, (_, i) => 4000 + i));
    expect(ID.model).toBe(4000);
    expect(rows.map((e) => modelKeyOf(e.kind)).every((k) => k !== null)).toBe(true);
    expect(new Set(rows.map((e) => modelKeyOf(e.kind))).size).toBe(new Set(Object.values(MODEL_OF_KIND)).size);
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

  it('has the effect block: 9 effect rows of 14 columns: the four heroes, a skeleton, the ogre, the wolf, the stag, the boar, the Necromancer, the Imp, the Knight, the Ghost and the Shade', () => {
    const ents = galleryEnts(0, null).filter((e) => inRange(e.id, ID.modelEffect, 200));
    expect(MODEL_EFFECT_COLS).toBe(14);
    expect(ents).toHaveLength(9 * 14);
    const kinds = ents.slice(0, 14).map((e) => e.kind);
    expect(kinds).toEqual([KIND.Wizard, KIND.Paladin, KIND.Barbarian, KIND.ElvenRanger, KIND.SkeletonWarrior, KIND.Ogre, KIND.DireWolf, KIND.Stag, KIND.Boar, KIND.Necromancer, KIND.Imp, KIND.Knight, KIND.Ghost, KIND.Shade]);
    for (const eff of ['Sleep', 'Petrified', 'Frozen', 'Slowed', 'Poisoned', 'Chilled', 'Tainted', 'Invisible'] as const) {
      expect(ents.filter((e) => e.effects & (1 << EFFECT[eff])), eff).toHaveLength(14);
    }
    // the incorporeal row (all 14), and the Ghost and the Shade of the other eight rows, which float by themselves
    expect(ents.filter((e) => e.flags & FLAG.INCORPOREAL)).toHaveLength(14 + 2 * 8);
    for (const e of ents) {
      expect(GALLERY.map.tileAt(e.x, e.y)).toBe(TILE_ID.Floor);
      expect(e.x / 16).toBeLessThan(GALLERY.map.w - 1);
    }
  });

  it('has the model rows of the four animals in every state of the cycle', () => {
    const animals: number[] = [KIND.Bunny, KIND.Deer, KIND.Stag, KIND.Boar];
    const rowOf = (t: number, s: string | null) => galleryEnts(t, s).filter((e) => inRange(e.id, ID.model, KINDS) && animals.includes(e.kind));
    expect(rowOf(0.1, null)).toHaveLength(4);
    for (const [name, anim] of STATES) expect(rowOf(0.1, name).map((e) => e.anim), name).toEqual([anim, anim, anim, anim]);
  });

  it('has the variety block: 8 rows (stag, deer, boar, bunny, goblin archer, orc warrior, imp, chort) of 6 figures standing idle, facing right, as models', () => {
    const v = galleryEnts(1.7, null).filter((e) => inRange(e.id, ID.variety, 100));
    expect(v).toHaveLength(48);
    expect(v.map((e) => e.id)).toEqual(Array.from({ length: 8 }, (_, r) => Array.from({ length: 6 }, (_, c) => ID.variety + r * 10 + c)).flat());
    const rowKinds = [KIND.Stag, KIND.Deer, KIND.Boar, KIND.Bunny, KIND.GoblinArcher, KIND.OrcWarrior, KIND.Imp, KIND.Chort];
    v.forEach((e, i) => {
      expect(e.kind).toBe(rowKinds[Math.floor(i / 6)]);
      expect([e.anim, e.aim, e.flags, e.effects]).toEqual([ANIM.Idle, 0, 0, 0]);
    });
    // drawn as models, also when the crowd is cards; inside the map; on a floor; clear of every other block's feet
    for (const q of ['?x=1', '?crowdAs=cards']) expect(v.every(modelsOf(parseGallery(q)))).toBe(true);
    const others = galleryEnts(1.7, null, CROWD_MAX).filter((e) => !inRange(e.id, ID.variety, 100));
    for (const e of v) {
      expect(GALLERY.map.tileAt(e.x, e.y)).toBe(TILE_ID.Floor);
      expect(e.y / 16).toBeLessThan(GALLERY.map.h - 1);
      for (const o of others) expect(Math.hypot(o.x - e.x, o.y - e.y), `${e.id} / ${o.id}`).toBeGreaterThan(16);
    }
    expect(parseGallery('?at=variety:2').at).toEqual(GALLERY.variety(2, 2.5));
  });

  describe('the object row as models (#317)', () => {
    const row = (): ReturnType<typeof galleryEnts> => galleryEnts(1.7, null).filter((e) => e.id >= ID.object && e.id < ID.shot);

    it('draws the chests, barrels and Mimics of the row as models under &focus=models, not its torches', () => {
      const is = modelsOf(parseGallery('?focus=models'));
      const objects = row().filter((e) => e.kind !== KIND.Torch);
      expect(objects.map((e) => e.kind).sort()).toEqual([KIND.Mimic, KIND.Mimic, KIND.Mimic, KIND.Barrel, KIND.Barrel, KIND.Chest, KIND.Chest].sort());
      expect(objects.every(is)).toBe(true);
      expect(row().filter((e) => e.kind === KIND.Torch).some(is)).toBe(false);
    });

    it('keeps the row as cards with any other focus', () => {
      for (const q of ['?focus=objects', '?focus=figures', '']) expect(row().some(modelsOf(parseGallery(q))), q).toBe(false);
    });

    it('aims &at=object:<i> at place i of the row, clamped to the row', () => {
      expect(parseGallery('?at=object:4').at).toEqual(GALLERY.object(4));
      const places = row().filter((e) => e.kind !== KIND.Torch).sort((a, b) => a.id - b.id);
      expect(places).toHaveLength(OBJECT_PLACES);
      places.forEach((e, i) => expect(GALLERY.object(i), String(e.id)).toEqual({ x: e.x / 16, z: e.y / 16 }));
      expect(parseGallery('?at=object:99').at).toEqual(GALLERY.object(OBJECT_PLACES - 1));
    });
  });

  describe('the size line-up (#356)', () => {
    const line = (): ReturnType<typeof galleryEnts> => galleryEnts(1.7, null).filter((e) => inRange(e.id, ID.lineup, 100));

    it('shows every distinct model key, creatures and objects, exactly once', () => {
      const keys = new Set([...Object.values(MODEL_OF_KIND), ...Object.values(OBJECT_MODEL)]);
      const keyOf = (kind: number) => modelKeyOf(kind) ?? objectModelOf(kind);
      expect(LINEUP_KEYS).toHaveLength(24);
      expect(LINEUP_MAX).toBe(24);
      expect(new Set(LINEUP_KEYS)).toEqual(keys);
      expect(line().map((e) => keyOf(e.kind))).toEqual([...LINEUP_KEYS]);
      for (const k of keys) expect(keyOf(lineupKind(k!)), String(k)).toBe(k);
    });

    it('stands them idle, facing right, on one line at equal depth, on floor and inside the map', () => {
      const L = line();
      expect(new Set(L.map((e) => e.y)).size).toBe(1);
      for (const e of L) {
        expect(e.anim).toBe(ANIM.Idle);
        expect(e.aim).toBe(0);
        expect(GALLERY.map.tileAt(e.x, e.y)).toBe(TILE_ID.Floor);
        expect(e.x / 16).toBeGreaterThan(1);
        expect(e.x / 16).toBeLessThan(GALLERY.map.w - 1);
      }
      expect(L.map((e) => e.x)).toEqual([...L.map((e) => e.x)].sort((a, b) => a - b));
      expect(L.every((e) => e.id < ID.pillarTorch && e.id >= ID.lineup)).toBe(true);
    });

    it('is ordered by the built height, shortest first, and every figure is a model', () => {
      const h = LINEUP_KEYS.map((k) => buildJob(k, null).baseHeight);
      expect(h).toEqual([...h].sort((a, b) => a - b));
      const is = modelsOf(parseGallery(''));
      expect(line().every(is)).toBe(true);
    });

    it('opens on the middle of the row with &focus=lineup', () => {
      expect(parseGallery('?focus=lineup').focus).toBe('lineup');
      expect(GALLERY.focus.lineup.x).toBeCloseTo((GALLERY.lineup(0).x + GALLERY.lineup(LINEUP_MAX - 1).x) / 2, 9);
      expect(GALLERY.focus.lineup.z).toBe(GALLERY.lineup(0).z);
      expect(parseGallery('?at=lineup:4').at).toEqual(GALLERY.lineup(4));
    });
  });

  it('opens the models block on the middle of the first kind row, however many kinds it has', () => {
    const n = Object.keys(MODEL_OF_KIND).length;
    expect(GALLERY.focus.models.x).toBeCloseTo((GALLERY.model(0).x + GALLERY.model(Math.min(n, MODEL_PER_ROW) - 1).x) / 2, 9);
    expect(GALLERY.focus.models.z).toBe(GALLERY.model(0).z);
  });

  it('wraps the kinds into rows of 11, each row with its own four pillar torches', () => {
    const L = layoutOf(Object.keys(FIGURES).length, 22);
    expect(MODEL_PER_ROW).toBe(11);
    expect(L.model(11).x).toBe(L.model(0).x);
    expect(L.model(11).z).toBe(L.model(0).z + MODEL_KIND_ROW_PITCH);
    for (let i = 0; i < 22; i++) {
      const p = L.model(i);
      expect(p.x > 0 && p.x < L.map.w && p.z > 0 && p.z < L.map.h, `model ${i} inside`).toBe(true);
      expect(L.map.get(Math.floor(p.x), Math.floor(p.z)), `model ${i} on a floor`).toBe(TILE_ID.Floor);
    }
    expect(L.pillarTorches).toHaveLength(8);
    // `&light=torch`: every kind is lit by a torch of its own row (the torches of a row share one z)
    const D = 4.5;
    for (let i = 0; i < 22; i++) {
      const p = L.model(i);
      const own = L.pillarTorches.filter((t) => Math.abs(t.z - (p.z - 2.5)) < 0.01);
      expect(own, `model ${i} has torches in its row`).toHaveLength(4);
      expect(Math.min(...own.map((t) => Math.hypot(t.x - p.x, t.z - p.z))), `model ${i} torch distance`).toBeLessThanOrEqual(D);
    }
    expect(L.pillarTorches.slice(4).map((p) => p.z - L.pillarTorches[0].z)).toEqual(Array(4).fill(MODEL_KIND_ROW_PITCH));
    // no pillar stands in front of a figure: no wall in a kind's column within 3 tiles south of it, for 22 and for 33 kinds
    for (const n of [22, 33]) {
      const W = layoutOf(Object.keys(FIGURES).length, n);
      for (let i = 0; i < n; i++) {
        const p = W.model(i);
        for (let dz = 0; dz <= 3; dz += 0.5) expect(W.map.get(Math.floor(p.x), Math.floor(p.z + dz)), `n ${n}, model ${i}, ${dz} south`).not.toBe(TILE_ID.Wall);
      }
      expect(W.model(n - 1).z).toBeLessThan(W.map.h - 1);
    }
    for (const p of L.pillarTorches) expect(L.map.get(Math.floor(p.x), Math.floor(p.z) - 1)).toBe(TILE_ID.Wall);
    // everything else starts below the last kind row
    const lastKind = L.model(21).z;
    for (const p of [L.modelEffect(0, 0), L.dying(0), L.crowd(0), L.variety(0, 0)]) expect(p.z).toBeGreaterThan(lastKind + 1);
    expect(L.dying(0).z).toBeGreaterThan(L.modelEffect(8, 0).z);
    expect(L.crowd(0).z).toBeGreaterThan(L.dying(21).z);
    expect(L.variety(0, 0).z).toBeGreaterThan(L.crowd(CROWD_MAX - 1).z);
    for (let i = 0; i < 22; i++) expect(L.map.get(Math.floor(L.dying(i).x), Math.floor(L.dying(i).z)), `dying ${i}`).toBe(TILE_ID.Floor);
    const one = layoutOf(Object.keys(FIGURES).length, 11);
    expect(one.pillarTorches).toHaveLength(4);
    expect(one.modelEffect(0, 0).z).toBeLessThan(L.modelEffect(0, 0).z);
  });

  it('gives the model effect ids room: ID.modelEffect + row * MODEL_EFFECT_STRIDE + col, all distinct, all below ID.dying', () => {
    expect(MODEL_EFFECT_STRIDE).toBe(20);
    const ents = galleryEnts(0, null).filter((e) => inRange(e.id, ID.modelEffect, ID.dying - ID.modelEffect));
    expect(ents).toHaveLength(126);
    expect(new Set(ents.map((e) => e.id)).size).toBe(126);
    ents.forEach((e, i) => expect(e.id).toBe(ID.modelEffect + Math.floor(i / 14) * MODEL_EFFECT_STRIDE + (i % 14)));
    expect(MODEL_EFFECT_COLS).toBeLessThanOrEqual(MODEL_EFFECT_STRIDE);
    expect(Math.max(...ents.map((e) => e.id))).toBeLessThan(ID.dying);
  });

  it('lets one figure of each kind die every 6 s and leave its skull', () => {
    const alive = (t: number) => galleryEnts(t, null).filter((e) => inRange(e.id, ID.dying, 100));
    expect(alive(1)).toHaveLength(KINDS);
    expect(alive(4)).toHaveLength(0);
    expect(alive(7)).toHaveLength(KINDS);
    expect(diedBetween(2.9, 3.1)).toHaveLength(KINDS);
    expect(diedBetween(3.1, 5)).toHaveLength(0);
    expect(diedBetween(8.9, 9.1)).toHaveLength(KINDS);
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

  it('reads `crowdKinds` as kind ids in the order named, null when none is known', () => {
    expect(parseGallery('?crowdKinds=stag,bunny').crowdKinds).toEqual([KIND.Stag, KIND.Bunny]);
    expect(parseGallery('?crowdKinds=nonsense').crowdKinds).toBeNull();
    expect(parseGallery('?crowdKinds=nonsense,deer').crowdKinds).toEqual([KIND.Deer]);
    expect(parseGallery('?crowd=3').crowdKinds).toBeNull();
  });

  it('cycles the crowd through `crowdKinds` when given', () => {
    const c = galleryEnts(0, null, 8, null, [KIND.Stag, KIND.Bunny]).filter((e) => e.id >= ID.crowd);
    expect(c).toHaveLength(8);
    expect(c.map((e) => e.kind)).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i % 2 ? KIND.Bunny : KIND.Stag)));
    expect(c.map((e) => e.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ID.crowd + i));
  });

  it('draws as models exactly the ids of the model blocks and the crowd, and not a crowd that is cards', () => {
    const o = parseGallery('?crowd=5');
    const is = modelsOf(o);
    const ents = galleryEnts(0, null, 5);
    const yes = ents.filter(is).map((e) => e.id);
    expect(yes.every((id) => id >= ID.model)).toBe(true);
    expect(yes.filter((id) => inRange(id, ID.model, KINDS))).toHaveLength(KINDS);
    expect(yes.filter((id) => inRange(id, ID.modelEffect, 200))).toHaveLength(126);
    expect(yes.filter((id) => id >= ID.crowd)).toHaveLength(5);
    expect(ents.filter((e) => e.id < ID.model).some(is)).toBe(false);
    const cards = modelsOf(parseGallery('?crowd=5&crowdAs=cards'));
    expect(ents.filter(cards).some((e) => e.id >= ID.crowd)).toBe(false);
    expect(ents.filter(cards).filter((e) => e.id < ID.crowd)).toHaveLength(yes.length - 5);
  });

  it('has a lit torch on each pillar of the model block, on a wall', () => {
    const t = galleryEnts(0, null).filter((e) => inRange(e.id, ID.pillarTorch, 20));
    // Three rows of kinds (24 kinds, 11 to a row), four pillars each.
    expect(t.map((e) => [e.kind, e.anim, e.extra])).toEqual(Array.from({ length: 12 }, () => [KIND.Torch, 1, 0]));
    for (const e of t) expect(GALLERY.map.get(Math.floor(e.x / 16), Math.floor(e.y / 16) - 1)).toBe(TILE_ID.Wall);
  });

  describe('the spectre block (#359)', () => {
    const W = CONST.AMBUSH_WARNING;
    const block = (t: number): ReturnType<typeof spectreAt> => spectreAt(t);
    const place = (t: number, i: number): ReturnType<typeof spectreAt>[number] | undefined => block(t).find((e) => e.id === ID.spectre + i);

    it('is the last block, below the line-up, behind its own wall row, on floor', () => {
      expect(ID.spectre).toBe(4800);
      expect([SPECTRE_PLACES, SPECTRE_PITCH, SPECTRE_LIFE]).toEqual([6, 6, 9]);
      expect(ID.spectre + SPECTRE_PLACES).toBeLessThanOrEqual(ID.pillarTorch);
      for (let i = 0; i < SPECTRE_PLACES; i++) {
        const p = GALLERY.spectre(i);
        expect(p.z, `place ${i} below the line-up`).toBeGreaterThan(GALLERY.lineup(0).z + 3);
        expect(GALLERY.map.get(Math.floor(p.x), Math.floor(p.z)), `place ${i} on floor`).toBe(TILE_ID.Floor);
        expect(GALLERY.map.get(Math.floor(p.x), Math.floor(p.z) - 3), `place ${i} wall row behind`).toBe(TILE_ID.Wall);
        expect(p.z).toBeLessThan(GALLERY.map.h - 1);
        if (i) expect(p.x - GALLERY.spectre(i - 1).x).toBe(SPECTRE_PITCH);
      }
      expect(GALLERY.spectre(SPECTRE_PLACES - 1).x).toBeLessThan(GALLERY.map.w - 2);
      // the wall row is clear of the line-up: nothing of the line-up stands in it
      for (let i = 0; i < LINEUP_MAX; i++) expect(GALLERY.lineup(i).z).toBeLessThan(GALLERY.spectre(0).z - 3);
    });

    it('has a lit pillar torch over every place on the wall row, ids clear of the kind rows', () => {
      expect(GALLERY.spectreTorches).toHaveLength(SPECTRE_PLACES);
      GALLERY.spectreTorches.forEach((t, i) => expect(Math.abs(t.x - GALLERY.spectre(i).x)).toBeLessThanOrEqual(0.5));
      for (const p of GALLERY.spectreTorches) expect(GALLERY.map.get(Math.floor(p.x), Math.floor(p.z) - 1)).toBe(TILE_ID.Wall);
      const torches = galleryEnts(0, null).filter((e) => e.kind === KIND.Torch && e.y / 16 > GALLERY.spectre(0).z - 4);
      expect(torches).toHaveLength(SPECTRE_PLACES);
      expect(new Set(torches.map((e) => e.id)).size).toBe(SPECTRE_PLACES);
      expect(torches.every((e) => e.anim === 1 && e.id >= ID.pillarTorch && e.id < ID.crowd)).toBe(true);
      // the kind rows keep their own twelve
      expect(galleryEnts(0, null).filter((e) => inRange(e.id, ID.pillarTorch, 20))).toHaveLength(12);
    });

    it('puts the Ghost in places 0 to 2 and the Shade in 3 to 5; idle, walking, the life loop', () => {
      const e = block(0.4);
      expect(e.map((x) => x.id)).toEqual([0, 1, 2, 3, 4, 5].map((i) => ID.spectre + i));
      expect(e.map((x) => x.kind)).toEqual([KIND.Ghost, KIND.Ghost, KIND.Ghost, KIND.Shade, KIND.Shade, KIND.Shade]);
      for (const k of [0, 3]) {
        const idle = place(1.7, k)!;
        expect([idle.anim, idle.aim]).toEqual([ANIM.Idle, 0]);
        expect(idle.x / 16).toBe(GALLERY.spectre(k).x);
      }
    });

    it('lets the idle and the life figures take the pinned aim; the walker goes by its motion', () => {
      for (const k of [0, 2, 3, 5]) expect(spectreAt(1.7, 1.2).find((e) => e.id === ID.spectre + k)!.aim).toBe(1.2);
      for (const k of [1, 4]) {
        const a = spectreAt(0.2, 1.2).find((e) => e.id === ID.spectre + k)!.aim;
        expect(a).toBe(0);
        expect(spectreAt(2.0, 1.2).find((e) => e.id === ID.spectre + k)!.aim).toBe(Math.PI);
      }
    });

    it('walks x = base + 1.5 sin(2 t) tiles in ANIM.Move, aimed along the motion', () => {
      for (const k of [1, 4]) {
        const base = GALLERY.spectre(k).x;
        for (const t of [0.2, 0.9, 1.4, 2.0, 3.3]) {
          const w = place(t, k)!;
          expect(w.x / 16).toBeCloseTo(base + 1.5 * Math.sin(2 * t), 9);
          expect(w.anim).toBe(ANIM.Move);
          expect(w.aim).toBe(Math.cos(2 * t) >= 0 ? 0 : Math.PI);
          expect(w.animMs).toBeCloseTo(t * 1000, 6);
        }
      }
    });

    it('runs the life loop: ambush for the warning, idle, a blow at 3.0 s and 5.0 s after a wind-up, gone from 7.0 s, back at 9 s', () => {
      for (const k of [2, 5]) {
        const at = (t: number) => place(t, k);
        expect(at(0)!.anim).toBe(ANIM.Ambush);
        expect(at(0.25)!.anim).toBe(ANIM.Ambush);
        expect(at(0.25)!.animMs).toBeCloseTo(250, 6);
        expect(at(W - 0.01)!.animMs).toBeLessThan(W * 1000);
        expect(at(W + 0.01)!.anim).toBe(ANIM.Idle);
        expect(at(1.2)!.anim).toBe(ANIM.Idle);
        expect(at(2.74)!.anim).toBe(ANIM.Idle);
        expect(at(2.75)!.anim).toBe(ANIM.Windup);
        expect(at(2.9)!.anim).toBe(ANIM.Windup);
        expect(at(3.0)!.anim).toBe(ANIM.Melee);
        expect(at(3.1)!.anim).toBe(ANIM.Melee);
        expect(at(3.1)!.animMs).toBeCloseTo(100, 6);
        expect(at(4.0)!.anim).toBe(ANIM.Idle);
        expect(at(4.75)!.anim).toBe(ANIM.Windup);
        expect(at(5.0)!.anim).toBe(ANIM.Melee);
        expect(at(6.5)!.anim).toBe(ANIM.Idle);
        expect(at(6.99)).toBeDefined();
        expect(at(7.0)).toBeUndefined();
        expect(at(8.99)).toBeUndefined();
        expect(at(9.0)!.anim).toBe(ANIM.Ambush);
        expect(at(9 + 3.1)!.anim).toBe(ANIM.Melee);
      }
      // the walkers and the idle figures never leave
      for (const k of [0, 1, 3, 4]) expect(place(8, k)).toBeDefined();
      expect(block(8)).toHaveLength(4);
    });

    it('sends one Died per life figure when 7.0 s falls in (t0, t1], once per life', () => {
      const ev = spectreDiedBetween(6.9, 7.1);
      expect(ev.map((x) => [x.t, x.id, x.kind])).toEqual([['Died', ID.spectre + 2, KIND.Ghost], ['Died', ID.spectre + 5, KIND.Shade]]);
      expect(ev.map((x) => [x.x, x.y])).toEqual([2, 5].map((i) => [GALLERY.spectre(i).x * 16, GALLERY.spectre(i).z * 16]));
      expect(spectreDiedBetween(6.9, 7.0)).toHaveLength(2);
      expect(spectreDiedBetween(7.0, 7.1)).toHaveLength(0);
      expect(spectreDiedBetween(7.1, 8.9)).toHaveLength(0);
      expect(spectreDiedBetween(15.9, 16.1)).toHaveLength(2);
      expect(spectreDiedBetween(0, 6.9)).toHaveLength(0);
    });

    it('draws its figures as models, and no other id is the block\'s', () => {
      const is = modelsOf(parseGallery(''));
      expect(block(1).every(is)).toBe(true);
      expect(galleryEnts(1, null).filter((e) => inRange(e.id, ID.spectre, SPECTRE_PLACES))).toHaveLength(6);
    });

    it('gives every Ghost and Shade of the model stage FLAG.INCORPOREAL, and no other kind gains it', () => {
      const all = galleryEnts(1.3, null, 10);
      const models = all.filter((e) => e.id >= ID.model);
      const sp = models.filter((e) => e.kind === KIND.Ghost || e.kind === KIND.Shade);
      // kind row, 9 effect rows, dying row, line-up, the block (6), the crowd's share
      expect(sp.length).toBeGreaterThanOrEqual(2 + 18 + 2 + 2 + 6);
      for (const e of sp) expect(e.flags & FLAG.INCORPOREAL, `${e.id}`).toBeTruthy();
      expect(floats(KIND.Ghost) && floats(KIND.Shade)).toBe(true);
      const incorporealRow = (e: { id: number }): boolean => inRange(e.id, ID.modelEffect, 200) && Math.floor((e.id - ID.modelEffect) / MODEL_EFFECT_STRIDE) === 7;
      for (const e of models) {
        if (e.kind === KIND.Ghost || e.kind === KIND.Shade) continue;
        if (incorporealRow(e)) continue;
        expect(e.flags & FLAG.INCORPOREAL, `${e.id} kind ${e.kind}`).toBe(0);
      }
      // the card rows are as before
      for (const e of all.filter((e) => e.id < ID.model && e.id >= ID.figure && e.id < ID.effect)) expect(e.flags & FLAG.INCORPOREAL).toBe(0);
    });

    it('reads &at=spectre:<i> as the place\'s foot, clamped to the block', () => {
      expect(parseGallery('?at=spectre:4').at).toEqual(GALLERY.spectre(4));
      expect(parseGallery('?at=spectre:99').at).toEqual(GALLERY.spectre(SPECTRE_PLACES - 1));
    });
  });

  describe('the effects pass over the spectre models (#359)', () => {
    const drawn = (id: number, kind: number, spectre: DrawnFig['spectre']): DrawnFig => ({
      id, kind, x: 5, z: 5, top: 1, foot: 0, hand: [5.3, 0.6, 5], aim: 0, anim: ANIM.Idle, animT: 0, effects: 0, alpha: 1, dashing: false, model: true, side: 0, def: FIGURES[kind],
      yaw: 0, swingY: 0.6, arc: 0, bite: -1, spectre, form: 1,
    });
    const entOf = (id: number, kind: number): EntState => ({ id, kind, x: 80, y: 80, hp: 1, anim: ANIM.Idle, aim: 0, animMs: 0, flags: 0, extra: 0, effects: 0, side: 1, entangled: 0 });
    const triangles = (figs: DrawnFig[], ents: EntState[]): number => {
      clearFxRegistry(); registerFigureFx(); registerStatus(); clearVeils();
      const fx = new Effects3d(new TileMap(4, 4, new Uint8Array(16)));
      const out: FxOut = { tris: new FxTris(20000), lit: new FxTris(5000), glows: newGlowBuf(), lights: [] };
      fx.frame({
        ctx: { cam: { x: 0, z: 0, pitch: 0.9, yaw: 0.3 }, ax: { right: [Math.cos(0.3), 0, Math.sin(0.3)], up: [0, 1, 0] }, now: 1, detail: 1, ballDetail: 2 },
        figs, ents: new Map(ents.map((e) => [e.id, e])), shots: [], hiddenShots: new Set(), snap: undefined, hidden: new Set(), you: 0, ownCast: null,
      }, out);
      return out.tris.n + out.lit.n;
    };

    it('lets a model Shade of an effect row and of the kind rows through, wherever its id is, and gives it fog', () => {
      const ids = [ID.modelEffect + 7 * MODEL_EFFECT_STRIDE + 12, ID.model + 3, ID.dying + 1, ID.lineup + 2, ID.crowd];
      const figs = ids.map((id) => drawn(id, KIND.Shade, shade.spectre!));
      const ents = ids.map((id) => entOf(id, KIND.Shade));
      const outFigs: DrawnFig[] = [], outEnts = new Map<number, EntState>();
      spectrePassIn(figs, ents, outFigs, outEnts);
      expect(outFigs.map((f) => f.id)).toEqual(ids);
      expect([...outEnts.keys()]).toEqual(ids);
      for (const f of outFigs) expect(triangles([f], [outEnts.get(f.id)!]), `${f.id}`).toBeGreaterThan(0);
    });

    it('never lets a figure of another kind or a card Ghost through', () => {
      const figs = [drawn(ID.model, KIND.Wizard, null), drawn(ID.spectre, KIND.Ghost, null), drawn(ID.crowd, KIND.Imp, null)];
      const outFigs: DrawnFig[] = [], outEnts = new Map<number, EntState>();
      spectrePassIn(figs, [entOf(ID.model, KIND.Wizard), entOf(ID.crowd, KIND.Imp)], outFigs, outEnts);
      expect(outFigs).toHaveLength(0);
      expect(outEnts.size).toBe(0);
    });
  });

  it('is its own ?r3d page, a server-free one like the demo', () => {
    expect(r3dPage('?r3d=gallery')).toBe('gallery');
    expect(r3dPage('?r3d=demo')).toBe('demo');
    expect(r3dPage('?r3d')).toBeNull();
    expect(isR3dDemo('?r3d=gallery')).toBe(true);
  });
});
