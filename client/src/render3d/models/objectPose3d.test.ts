import { afterEach, describe, expect, it, vi } from 'vitest';
import { mimicPose } from '../../game/objectPose';
import { buildJob } from './build';
import { HINGE } from './descs/chest';
import { BONES } from './bones';
import type { FigureModel } from './model';
import { barrelYaw, CHEST_OPEN, chestPoseIn, MIMIC_GAPE, mimicPoseIn, type ObjectPoseIn, poseObject, REST_OBJECT, SOUTH, turnTo } from './objectPose3d';
import { TURN_RATE } from './pose3d';
import { skinVertex } from './rig';

type P3 = [number, number, number];
const chest = buildJob('chest', null), mimic = buildJob('mimic', null);
const boneOf = (m: FigureModel, i: number): string => BONES[m.skin[i * 4]];
const count = (m: FigureModel): number => m.position.length / 3;
const rest = (m: FigureModel, i: number): P3 => [m.position[i * 3], m.position[i * 3 + 1], m.position[i * 3 + 2]];
/** Every vertex of `m` skinned by the pose of `o` (description px). */
function skinned(m: FigureModel, o: Partial<ObjectPoseIn>): P3[] {
  const pose = poseObject(m, { ...REST_OBJECT, ...o });
  return Array.from({ length: count(m) }, (_, i) => { const v: P3 = [0, 0, 0]; skinVertex(m, pose, i, v); return v; });
}
const key = (v: P3): string => v.map((c) => Math.round(c * 1000) / 1000 + 0).join(',');
const near = (a: P3, b: P3): void => { for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k], 3); };

describe('poseObject', () => {
  afterEach(() => vi.restoreAllMocks());

  it('the closed chest is the rest position', () => {
    const pts = skinned(chest, chestPoseIn(-1));
    for (let i = 0; i < count(chest); i++) near(pts[i], rest(chest, i));
  });

  it('the lid turns about the hinge and nothing else moves', () => {
    const pts = skinned(chest, { lid: 1 });
    let found = 0;
    for (let i = 0; i < count(chest); i++) {
      const r = rest(chest, i);
      if (boneOf(chest, i) === 'head') {
        const d0 = Math.hypot(r[0] - HINGE[0], r[1] - HINGE[1]), d1 = Math.hypot(pts[i][0] - HINGE[0], pts[i][1] - HINGE[1]);
        expect(d1).toBeCloseTo(d0, 3);
        expect(pts[i][2]).toBeCloseTo(r[2], 3);
        if (Math.abs(r[0] - 4.5) < 1e-6 && Math.abs(r[1] - 5.5) < 1e-6) { near(pts[i], [-4.5 + 9 * Math.cos(1), 5.5 + 9 * Math.sin(1), r[2]]); found++; }
      } else if (boneOf(chest, i) === 'body') near(pts[i], r);
    }
    expect(found).toBeGreaterThan(0);
  });

  it('hat 0 collapses the loot onto its pivot', () => {
    const pts = skinned(chest, { hat: 0 });
    let n = 0;
    for (let i = 0; i < count(chest); i++) if (boneOf(chest, i) === 'hat') { near(pts[i], [chest.pivots[9], chest.pivots[10], chest.pivots[11]]); n++; }
    expect(n).toBeGreaterThan(0);
    expect(chestPoseIn(0.6)).toMatchObject({ hat: 0, lid: CHEST_OPEN });
    expect(chestPoseIn(1e9)).toMatchObject({ hat: 0, lid: CHEST_OPEN });
    expect(chestPoseIn(0.1).hat).toBe(1);
  });

  it('a hiding Mimic is the chest', () => {
    const state = { x: 0, y: 0, hiding: true, rattle: 0, aim: 0 };
    const mp = mimicPose(state, 0, { lastHop: 0, wakeFx: false });
    const a = skinned(chest, chestPoseIn(-1)), b = skinned(mimic, mimicPoseIn(mp, true, SOUTH, 0));
    const inMimic = new Set<string>();
    for (let i = 0; i < count(mimic); i++) inMimic.add(key(b[i]));
    for (let i = 0; i < count(chest); i++) if (boneOf(chest, i) !== 'hat') expect(inMimic.has(key(a[i])), key(a[i])).toBe(true);
    const inChest = new Set<string>();
    for (let i = 0; i < count(chest); i++) if (boneOf(chest, i) !== 'hat') inChest.add(key(a[i]));
    for (let i = 0; i < count(mimic); i++) {
      if (inChest.has(key(b[i]))) continue;
      expect(Math.abs(b[i][0])).toBeLessThan(4.5); expect(Math.abs(b[i][2])).toBeLessThan(7);
      expect(b[i][1]).toBeGreaterThan(0); expect(b[i][1]).toBeLessThan(9);
    }
  });

  it('a shivering Mimic fits the chest posed the same way', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const mp = mimicPose({ x: 0, y: 0, hiding: true, rattle: 0.5, aim: 0 }, 0, { lastHop: 0, wakeFx: false });
    expect(mp.lid).toBeGreaterThan(0);
    const o = mimicPoseIn(mp, true, SOUTH, 0);
    const box = (m: FigureModel, pts: P3[]): number[] => {
      const r = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      pts.forEach((v, i) => { if (boneOf(m, i) === 'hat') return; for (let k = 0; k < 3; k++) { r[k] = Math.min(r[k], v[k]); r[k + 3] = Math.max(r[k + 3], v[k]); } });
      return r;
    };
    const bm = box(mimic, skinned(mimic, o)), bc = box(chest, skinned(chest, { lid: o.lid, pitch: o.pitch, side: o.side, yaw: SOUTH }));
    bm.forEach((v, k) => expect(v).toBeCloseTo(bc[k], 3));
  });

  it('squash scales x and z by sx and y by sy; lift raises every point', () => {
    const base = skinned(chest, {}), sq = skinned(chest, { sx: 1.2, sy: 0.8 }), up = skinned(chest, { lift: 5 });
    for (let i = 0; i < count(chest); i++) {
      near(sq[i], [base[i][0] * 1.2, base[i][1] * 0.8, base[i][2] * 1.2]);
      near(up[i], [base[i][0], base[i][1] + 5, base[i][2]]);
    }
  });

  it('ahead and side shift along and across the facing; pitch lifts the front', () => {
    const base = skinned(chest, {}), moved = skinned(chest, { ahead: 3, side: -2 }), tilt = skinned(chest, { pitch: 0.3 });
    for (let i = 0; i < count(chest); i++) {
      near(moved[i], [base[i][0] + 3, base[i][1], base[i][2] - 2]);
      if (boneOf(chest, i) === 'body' && base[i][0] > 4.4 && base[i][1] < 0.1) expect(tilt[i][1]).toBeGreaterThan(1);
    }
  });

  it('a non-finite input is the rest value', () => {
    for (const m of [chest, mimic]) {
      const p = poseObject(m, { ...REST_OBJECT, lid: NaN, pitch: NaN, lift: NaN, sx: NaN, sway: NaN, hat: NaN, yaw: NaN });
      expect(p.bones.every(Number.isFinite)).toBe(true);
      expect(p.bends.every(Number.isFinite)).toBe(true);
      expect(Object.values(p.root).every(Number.isFinite)).toBe(true);
      expect(p.root.sx).toBe(1);
      expect(p.yaw).toBe(0);
    }
  });

  it('the tongue sways through the bend', () => {
    const p = poseObject(mimic, { ...REST_OBJECT, sway: 0.2 });
    expect(Array.from(p.bends.slice(0, 4))).toEqual([1, 0, 0, expect.closeTo(0.2, 6)]);
  });

  it('mimicPoseIn maps the pose', () => {
    const mp = { frame: 0, lift: 2, sx: 1.1, sy: 0.9, bx: 1, by: 0, angle: 0, lid: 0.5, lunge: 3, pitch: 90, hurtFill: false, shadowScale: 1, shadowAlpha: 1, flip: false, wakeCue: false, landCue: false };
    const awake = mimicPoseIn(mp, false, 1.5, 0), hid = mimicPoseIn(mp, true, 1.5, 0);
    expect(awake).toMatchObject({ yaw: 1.5, lid: 0.5 * MIMIC_GAPE, lift: 2, sx: 1.1, sy: 0.9, ahead: 3, side: 0 });
    expect(awake.pitch).toBeCloseTo(Math.PI / 2, 6);
    expect(awake.hat).toBeGreaterThan(0);
    expect(hid).toMatchObject({ hat: 0, side: 1 });
  });
});

describe('turnTo and barrelYaw', () => {
  it('turns towards the aim at TURN_RATE and arrives', () => {
    const one = turnTo(0, Math.PI / 2, 1 / 60);
    expect(one).toBeGreaterThan(0); expect(one).toBeLessThan(Math.PI / 2);
    expect(one).toBeCloseTo(TURN_RATE / 60, 6);
    let y = 0;
    for (let i = 0; i < 120; i++) y = turnTo(y, Math.PI / 2, 1 / 60);
    expect(Math.abs(y - Math.PI / 2)).toBeLessThan(0.01);
  });
  it('takes the short way round', () => { expect(turnTo(3, -3, 1 / 60)).toBeGreaterThan(3); });
  it('a non-finite aim or dt leaves it', () => {
    expect(turnTo(1, NaN, 0.016)).toBe(1);
    expect(turnTo(1, 2, 0)).toBe(1);
    expect(turnTo(1, 2, NaN)).toBe(1);
  });
  it('a barrel has its own fixed turn', () => {
    expect(barrelYaw(7)).not.toBe(barrelYaw(8));
    for (const id of [0, 7, 8, 12345]) { expect(barrelYaw(id)).toBeGreaterThanOrEqual(0); expect(barrelYaw(id)).toBeLessThan(2 * Math.PI); }
  });
});
