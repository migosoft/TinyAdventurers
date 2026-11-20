import { describe, expect, it } from 'vitest';
import { ANIM, CONST, EFFECT, FLAG } from '../../generated/defs';
import { LICH_TIMES, lichPose, newLichMem, restPose, type LichIn, type LichMem, type LichPose } from './pose';

const DT = CONST.DT;
const W = { slam: CONST.LICH_NOVA_WINDUP, summon: CONST.MINION_WINDUP, windup: CONST.LICH_GLOOM_WINDUP };
const base = (o: Partial<LichIn> = {}): LichIn => ({ anim: ANIM.Idle, animT: 0, effects: 0, flags: 0, aim: 0, look: null, glide: 0, ...o });
const bit = (k: number): number => 2 ** k;
const WEIGHTS = ['novaUp', 'novaHit', 'novaChest', 'novaOut', 'raiseUp', 'raiseHit', 'raiseLow', 'raiseLift', 'flingBack', 'flingOut', 'gaze', 'hurt'] as const;
const snap = (p: LichPose): LichPose => ({ ...p });
const weights = (p: LichPose): number[] => WEIGHTS.map((k) => p[k]);

/** Runs `anim` from animT 0 for `secs` in steps of DT; returns the last pose. */
function run(mem: LichMem, anim: number, secs: number, o: Partial<LichIn> = {}): LichPose {
  let p = lichPose(base({ anim, animT: 0, ...o }), DT, mem);
  for (let t = DT; t < secs - 1e-9; t += DT) p = lichPose(base({ anim, animT: t, ...o }), DT, mem);
  return p;
}
/** Idle frames for `secs`; returns every pose. */
function idle(mem: LichMem, secs: number): LichPose[] {
  const out: LichPose[] = [];
  for (let t = 0; t < secs - 1e-9; t += DT) out.push(snap(lichPose(base(), DT, mem)));
  return out;
}
const lastTick = (w: number): number => w - DT;

describe('wind-ups', () => {
  it.each([
    ['Slam start', ANIM.Slam, 0, (p: LichPose) => expect(p.novaUp).toBeLessThan(0.01)],
    ['Slam middle', ANIM.Slam, W.slam / 2, (p: LichPose) => { expect(p.novaUp).toBeGreaterThan(0.9); expect(p.novaChest).toBeGreaterThan(0.9); }],
    ['Slam last tick', ANIM.Slam, lastTick(W.slam), (p: LichPose) => { expect(p.novaChest).toBeGreaterThan(0.9); expect(p.novaHit).toBe(0); expect(p.novaOut).toBeLessThan(0.05); }],
    ['Summon start', ANIM.Summon, 0, (p: LichPose) => expect(p.raiseUp).toBeLessThan(0.01)],
    ['Summon 0.58', ANIM.Summon, 0.58, (p: LichPose) => { expect(p.raiseLow).toBeGreaterThan(0.5); expect(p.raiseHit).toBe(0); }],
    ['Summon last tick', ANIM.Summon, lastTick(W.summon), (p: LichPose) => expect(p.raiseHit).toBeGreaterThan(0.5)],
    ['Windup start', ANIM.Windup, 0, (p: LichPose) => expect(p.flingBack).toBeLessThan(0.01)],
    ['Windup 0.4', ANIM.Windup, 0.4, (p: LichPose) => { expect(p.flingBack).toBeGreaterThan(0.9); expect(p.flingOut).toBe(0); }],
    ['Windup last tick', ANIM.Windup, lastTick(W.windup), (p: LichPose) => { expect(p.flingBack).toBeGreaterThan(0.9); expect(p.flingOut).toBe(0); }],
  ])('%s', (_n, anim, animT, check) => {
    check(lichPose(base({ anim, animT }), DT, newLichMem()));
  });
});

describe('release', () => {
  it('Slam then Idle: the hit, the outstretched hand, then nothing', () => {
    const m = newLichMem();
    run(m, ANIM.Slam, W.slam);
    const p0 = lichPose(base({ anim: ANIM.Slam, animT: lastTick(W.slam) }), DT, m);
    expect(p0.novaHit).toBe(0);
    const hit = lichPose(base(), DT, m);
    expect(hit.novaHit).toBeGreaterThan(0.8);
    let p = hit;
    for (let t = DT; t < 0.12; t += DT) p = lichPose(base(), DT, m);
    expect(p.novaOut).toBeGreaterThan(0.9);
    for (let t = 0.12; t < 1.0; t += DT) p = lichPose(base(), DT, m);
    expect(weights(p).every((w) => w === 0)).toBe(true);
  });
  it('Summon then Idle lifts the hand', () => {
    const m = newLichMem();
    run(m, ANIM.Summon, W.summon);
    const ps = idle(m, 0.7);
    expect(ps[Math.round(0.65 / DT)].raiseLift).toBeGreaterThan(0.9);
    expect(ps[Math.round(0.65 / DT)].casting).toBeGreaterThan(0.9);
  });
  it('Windup then Idle flings', () => {
    const m = newLichMem();
    run(m, ANIM.Windup, W.windup);
    const ps = idle(m, 0.3);
    expect(ps[Math.round(0.16 / DT)].flingOut).toBeGreaterThan(0.9);
  });
  it('broken off: eases back and never flings', () => {
    const m = newLichMem();
    run(m, ANIM.Windup, 0.2);
    const ps = idle(m, 0.4);
    expect(ps.every((p) => p.flingOut === 0)).toBe(true);
    expect(ps[0].flingBack).toBeGreaterThan(0.5);
    expect(ps[Math.round(0.25 / DT) + 1].flingBack).toBeLessThan(0.01);
  });
  it('releases across a gap but not when broken off early', () => {
    const a = newLichMem();
    lichPose(base({ anim: ANIM.Slam, animT: W.slam - 3 * DT }), DT, a);
    expect(lichPose(base(), 2 * DT, a).novaHit).toBeGreaterThan(0.8);
    const b = newLichMem();
    lichPose(base({ anim: ANIM.Slam, animT: W.slam - 6 * DT }), DT, b);
    expect(lichPose(base(), DT, b).novaHit).toBe(0);
  });
  it('a second wind-up replaces a second half at once', () => {
    const m = newLichMem();
    run(m, ANIM.Slam, W.slam);
    lichPose(base(), DT, m);
    lichPose(base(), DT, m);
    const p = lichPose(base({ anim: ANIM.Windup, animT: 0 }), DT, m);
    expect(p.novaOut).toBe(0);
    expect(p.novaHit).toBe(0);
  });
  it('dt 5 ends a second half', () => {
    const m = newLichMem();
    run(m, ANIM.Summon, W.summon);
    lichPose(base(), DT, m);
    const p = lichPose(base(), 5, m);
    expect(weights(p).every((w) => w === 0)).toBe(true);
    expect(Object.values(p).every((v) => !Number.isNaN(v))).toBe(true);
  });
});

describe('held', () => {
  for (const [name, fx] of [['Frozen', EFFECT.Frozen], ['Petrified', EFFECT.Petrified]] as const) {
    it(`${name} changes nothing`, () => {
      const m = newLichMem();
      run(m, ANIM.Slam, W.slam / 2);
      const last = snap(lichPose(base({ anim: ANIM.Slam, animT: W.slam / 2 }), DT, m));
      for (let i = 0; i < 60; i++) {
        const p = lichPose(base({ anim: ANIM.Idle, effects: bit(fx), aim: 2 }), DT, m);
        expect(p).toEqual(last);
      }
      // thawed: the wind-up was broken off, it eases back from where it stood
      const thawed = lichPose(base({ anim: ANIM.Idle }), DT, m);
      expect(thawed.novaUp).toBeGreaterThan(0.9);
      expect(thawed.novaHit).toBe(0);
    });
  }
  it('holds a second half', () => {
    const m = newLichMem();
    run(m, ANIM.Slam, W.slam);
    lichPose(base(), DT, m);
    const last = snap(lichPose(base(), DT, m));
    for (let i = 0; i < 60; i++) expect(lichPose(base({ effects: bit(EFFECT.Frozen) }), DT, m)).toEqual(last);
  });
  it('first seen held: the pose of its animT, then held', () => {
    const m = newLichMem();
    const p = snap(lichPose(base({ anim: ANIM.Slam, animT: 0.6, effects: bit(EFFECT.Frozen) }), DT, m));
    expect(p.novaUp).toBeGreaterThan(0.9);
    expect(lichPose(base({ anim: ANIM.Idle, effects: bit(EFFECT.Frozen) }), DT, m)).toEqual(p);
  });
});

describe('gaze and hurt', () => {
  it('gaze rises then eases out', () => {
    const m = newLichMem();
    expect(run(m, ANIM.Gaze, 0.5).gaze).toBeGreaterThan(0.99);
    const ps = idle(m, 0.45);
    expect(ps[0].gaze).toBeGreaterThan(0.9);
    expect(ps[ps.length - 1].gaze).toBeLessThan(0.01);
    expect(ps[Math.round(0.4 / DT)].gaze).toBeLessThan(0.01);
  });
  it('hurt flinches once per rising flag', () => {
    const m = newLichMem();
    lichPose(base(), DT, m);
    let p = lichPose(base({ flags: FLAG.HURT }), DT, m);
    for (let t = DT; t < 0.075 - 1e-9; t += DT) p = lichPose(base({ flags: FLAG.HURT }), DT, m);
    expect(p.hurt).toBeGreaterThan(0.9);
    for (let t = 0.075; t < 0.2; t += DT) p = lichPose(base({ flags: FLAG.HURT }), DT, m);
    expect(p.hurt).toBe(0);
    for (let i = 0; i < 30; i++) expect(lichPose(base({ flags: FLAG.HURT }), DT, m).hurt).toBe(0);
    lichPose(base(), DT, m);
    expect(lichPose(base({ flags: FLAG.HURT }), DT, m).hurt).toBeGreaterThanOrEqual(0);
  });
});

describe('memory', () => {
  it('first seen mid-cast equals a lich seen from the start', () => {
    const seen = newLichMem();
    const from0 = run(seen, ANIM.Slam, 0.9);
    const late = lichPose(base({ anim: ANIM.Slam, animT: 0.9 - DT }), DT, newLichMem());
    for (const k of WEIGHTS) expect(late[k]).toBeCloseTo(from0[k], 9);
    // and it never fires a release
    const m = newLichMem();
    lichPose(base({ anim: ANIM.Slam, animT: W.slam - DT }), DT, m);
    expect(lichPose(base({ anim: ANIM.Slam, animT: W.slam }), DT, m).novaHit).toBe(0);
  });
  it('Idle on a new memory is the rest pose', () => {
    const p = lichPose(base(), DT, newLichMem());
    const r = restPose();
    for (const k of Object.keys(r) as (keyof LichPose)[]) expect(p[k], k).toBeCloseTo(r[k], 12);
  });
  it('dt 0 returns an equal pose, the same object every call', () => {
    const m = newLichMem();
    const p = lichPose(base({ aim: 1 }), DT, m);
    const a = snap(p);
    const q = lichPose(base({ aim: 1 }), 0, m);
    expect(q).toBe(p);
    expect(q).toEqual(a);
    lichPose(base({ anim: ANIM.Slam, animT: 0.3 }), 0, m);
  });
  it('face eases toward aim, the head toward look, glide is passed on', () => {
    const m = newLichMem();
    expect(lichPose(base({ aim: 1 }), DT, m).face).toBe(1);
    const p = lichPose(base({ aim: 2, look: 3, glide: 0.5 }), 0.1, m);
    expect(p.face).toBeCloseTo(1 + (1 - Math.exp(-0.4)), 9);
    expect(p.headYaw).toBeGreaterThan(0);
    expect(p.headYaw).toBeLessThanOrEqual(0.45);
    expect(p.glide).toBe(0.5);
    expect(p.t).toBeCloseTo(0.1, 12);
  });
  it('times table keeps the brief values', () => {
    expect(LICH_TIMES.nova.at).toBe(1.33);
    expect(LICH_TIMES.slack).toBe(2);
  });
});
