import { describe, expect, it } from 'vitest';
import { ANIM, CONST, FLAG, KIND, TILE_ID } from '../generated/defs';
import { TILE } from '../sim/map';
import { liquidsMap } from './liquidsMap';
import { drownOf } from '../wire';
import { liquidsScript, WADE_TIME, type Pushes } from './liquidsScript';

const none: Pushes = { chasm: null, water: null, barrel: null };
const map = liquidsMap();
const tileOf = (e: { x: number; y: number }): number => map.get(Math.floor(e.x / TILE), Math.floor(e.y / TILE));
const kindOf = (t: number, kind: number) => liquidsScript(t, 0.016, none).ents.filter((e) => e.kind === kind);
const IMP_CHASM = 102, IMP_WATER = 103, BARREL = 104;

describe('liquidsMap', () => {
  it('is 18 x 12 with the three dips', () => {
    expect([map.w, map.h]).toEqual([18, 12]);
    const count = (id: number): number => Array.from(map.tiles).filter((v) => v === id).length;
    expect(count(TILE_ID.ShallowWater)).toBeGreaterThan(0);
    expect(count(TILE_ID.DeepWater)).toBeGreaterThan(0);
    expect(count(TILE_ID.Lava)).toBeGreaterThan(0);
    expect(count(TILE_ID.Chasm)).toBeGreaterThanOrEqual(4);
    // the lava lies against the east wall
    expect(map.get(16, 4)).toBe(TILE_ID.Lava);
    expect(map.get(17, 4)).toBe(TILE_ID.Wall);
  });
});

describe('liquidsScript', () => {
  it('has its actors on their terrain', () => {
    const elf = kindOf(0, KIND.ElvenRanger)[0];
    expect(tileOf(elf)).toBe(TILE_ID.ShallowWater);
    const at = (id: number) => liquidsScript(0, 0.016, none).ents.find((e) => e.id === id)!;
    const dx = (id: number, to: number) => map.get(Math.floor(at(id).x / TILE) + (to === 0 ? 0 : 1), Math.floor(at(id).y / TILE) + (to === 0 ? 1 : 0));
    for (const id of [IMP_CHASM, IMP_WATER, BARREL]) expect(tileOf(at(id))).toBe(TILE_ID.Floor);
    expect(dx(IMP_CHASM, 1)).toBe(TILE_ID.Chasm);
    expect(dx(BARREL, 1)).toBe(TILE_ID.Chasm);
    expect(dx(IMP_WATER, 0)).toBe(TILE_ID.DeepWater);
  });

  it('walks the knight into the lava and out', () => {
    const knightTile = (t: number): number => tileOf(kindOf(t, KIND.Knight)[0]);
    expect(knightTile(0)).toBe(TILE_ID.Floor);
    let lava = 0;
    for (let t = 0; t < 8.4; t += 0.05) if (knightTile(t) === TILE_ID.Lava) lava += 0.05;
    expect(lava).toBeGreaterThan(5);
    expect(knightTile(4.5)).toBe(TILE_ID.Lava);
    expect(knightTile(8.4)).toBe(TILE_ID.Floor); // the loop repeats
    expect(kindOf(4.5, KIND.Knight)[0].anim).toBe(ANIM.Idle);
  });

  it('plays a fall', () => {
    const pushes = { ...none, chasm: 1 };
    const sinkAt = 1.35;
    const sinks = liquidsScript(sinkAt, 0.05, pushes).events.filter((e) => e.t === 'Sink');
    expect(sinks).toHaveLength(1);
    const s = sinks[0] as Extract<(typeof sinks)[number], { t: 'Sink' }>;
    expect(s.id).toBe(IMP_CHASM);
    expect(s.how).toBe(0);
    expect(map.get(Math.floor(s.x / TILE), Math.floor(s.y / TILE))).toBe(TILE_ID.Chasm);
    const has = (t: number): boolean => liquidsScript(t, 0.016, pushes).ents.some((e) => e.id === IMP_CHASM);
    expect(has(sinkAt + CONST.FALL_TIME - 0.01)).toBe(true);
    expect(has(sinkAt + CONST.FALL_TIME + 0.01)).toBe(false);
    const died = liquidsScript(sinkAt + CONST.FALL_TIME, 0.05, pushes).events.filter((e) => e.t === 'Died');
    expect(died).toHaveLength(1);
    expect(has(sinkAt + 3.2 - 0.01)).toBe(false);
    expect(has(sinkAt + 3.2 + 0.01)).toBe(true);
  });

  it('plays a drowning: no Sink, a rising drown byte in deep water, a Died when the breath ends (#448)', () => {
    const pushes = { ...none, water: 2 };
    expect(liquidsScript(2.35, 0.05, pushes).events.some((e) => e.t === 'Sink')).toBe(false);
    const imp = (t: number) => liquidsScript(t, 0.02, pushes).ents.find((e) => e.id === IMP_WATER)!;
    expect(drownOf(imp(2.2).drown ?? 0)).toBeNull();   // still sliding in
    let last = 0;
    for (let t = 2.4; t < 2.35 + CONST.BREATH - 0.05; t += 0.1) {
      expect(tileOf(imp(t))).toBe(TILE_ID.DeepWater);
      const d = drownOf(imp(t).drown ?? 0)!;
      expect(d.t).toBeGreaterThanOrEqual(last);
      last = d.t;
    }
    expect(last).toBeGreaterThan(CONST.HEAD_UNDER);
    expect(liquidsScript(2.35 + CONST.BREATH, 0.05, pushes).events.some((e) => e.t === 'Died' && e.id === IMP_WATER)).toBe(true);
    expect(liquidsScript(2.35 + CONST.BREATH - 0.05, 0.02, pushes).ents.some((e) => e.id === IMP_WATER)).toBe(true);
  });

  it('walks a knight into the deep water and out: drowning exactly while in a deep tile', () => {
    const pushes = { ...none, wade: 1 };
    const knight = (t: number) => liquidsScript(t, 0.016, pushes).ents.find((e) => e.id === 105)!;
    expect(drownOf(knight(0.5).drown ?? 0)).toBeNull();
    let deep = 0, top = 0;
    for (let t = 1; t < 1 + WADE_TIME; t += 0.02) {
      const k = knight(t), d = drownOf(k.drown ?? 0);
      expect(d !== null, `t ${t}`).toBe(tileOf(k) === TILE_ID.DeepWater);
      if (d) { deep += 0.02; top = Math.max(top, d.t); }
    }
    expect(top).toBeGreaterThan(CONST.HEAD_UNDER);
    expect(top).toBeLessThan(CONST.BREATH);
    expect(deep).toBeGreaterThan(1.2);
    expect(drownOf(knight(1 + WADE_TIME + 0.1).drown ?? 0)).toBeNull();
  });

  it('rolls a barrel in and shows its fall anim', () => {
    const pushes = { ...none, barrel: 1 };
    const b = liquidsScript(1.35 + 0.2, 0.016, pushes).ents.find((e) => e.id === BARREL)!;
    expect(b.anim).toBe(2);
    expect(liquidsScript(1.35 + CONST.FALL_TIME - 0.01, 0.016, pushes).ents.find((e) => e.id === BARREL)!.anim).toBe(2);
    let events = 0;
    for (let k = 1; k <= 6 * 60; k++) events += liquidsScript(k / 60, 1 / 60, pushes).events.length;
    expect(events).toBe(0);
    expect(liquidsScript(1.35 + 3.2 + 0.01, 0.016, pushes).ents.some((e) => e.id === BARREL)).toBe(true);
    expect(liquidsScript(1.35 + CONST.FALL_TIME + 0.05, 0.016, pushes).ents.some((e) => e.id === BARREL)).toBe(false);
  });

  it('lets `as` play every role: the wader, the lava walker and the two pushed figures, not the barrel', () => {
    const pushes: Pushes = { chasm: 1, water: 2, barrel: 3 };
    for (const t of [0, 1.2, 2.5]) {
      const plain = liquidsScript(t, 0.016, pushes);
      const as = liquidsScript(t, 0.016, pushes, KIND.Stag);
      expect(as.ents.map((e) => e.id)).toEqual(plain.ents.map((e) => e.id));
      expect(as.ents.filter((e) => e.id !== BARREL).every((e) => e.kind === KIND.Stag)).toBe(true);
      expect(as.ents.find((e) => e.id === BARREL)!.kind).toBe(KIND.Barrel);
      expect(as.events.map((e) => ('id' in e ? e.id : -1))).toEqual(plain.events.map((e) => ('id' in e ? e.id : -1)));
    }
    const ev = liquidsScript(1.35 + CONST.FALL_TIME, 0.05, { ...none, chasm: 1 }, KIND.Boar).events.find((e) => e.t === 'Died') as { kind: number; id: number };
    expect([ev.id, ev.kind]).toEqual([IMP_CHASM, KIND.Boar]);
  });

  it('marks every role INCORPOREAL when the kind floats (the Ghost, the Shade), and no other kind', () => {
    const pushes: Pushes = { chasm: 1, water: 2, barrel: 3 };
    for (const kind of [KIND.Ghost, KIND.Shade]) {
      const roles = liquidsScript(0, 0.016, pushes, kind).ents.filter((e) => e.id !== BARREL);
      expect(roles).toHaveLength(5);
      expect(roles.every((e) => (e.flags & FLAG.INCORPOREAL) !== 0), String(kind)).toBe(true);
      expect(liquidsScript(0, 0.016, pushes, kind).ents.find((e) => e.id === BARREL)!.flags & FLAG.INCORPOREAL).toBe(0);
    }
    for (const kind of [undefined, KIND.Stag, KIND.Imp]) {
      expect(liquidsScript(0, 0.016, pushes, kind).ents.some((e) => e.flags & FLAG.INCORPOREAL), String(kind)).toBe(false);
    }
  });

  it('without `as` plays the same script as before (imps, the elf and the knight)', () => {
    const pushes: Pushes = { chasm: 1, water: 2, barrel: 3 };
    expect(liquidsScript(0, 0.016, none).ents.map((e) => e.kind)).toEqual([KIND.ElvenRanger, KIND.Knight, KIND.Knight, KIND.Imp, KIND.Imp, KIND.Barrel]);
    for (const t of [0, 1.4, 2.4, 4.5]) {
      expect(JSON.stringify(liquidsScript(t, 0.016, pushes, undefined))).toBe(JSON.stringify(liquidsScript(t, 0.016, pushes)));
    }
  });

  it('emits each event once', () => {
    const pushes: Pushes = { chasm: 1, water: 2, barrel: 3 };
    const dt = 1 / 60;
    const sinks: number[] = [], died: number[] = [];
    for (let k = 1; k <= 6 * 60; k++) {
      for (const e of liquidsScript(k * dt, dt, pushes).events) { if (e.t === 'Sink') sinks.push(e.id); if (e.t === 'Died') died.push(e.id); }
    }
    expect(sinks).toEqual([IMP_CHASM]); // a drowning has none
    expect(died.sort()).toEqual([IMP_CHASM, IMP_WATER]); // none for the barrel
  });
});
