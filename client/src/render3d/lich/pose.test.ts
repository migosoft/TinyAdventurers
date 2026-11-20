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
    for (let t = 0.12; t < 1.9; t += DT) p = lichPose(base(), DT, m);
    expect(weights(p).every((w) => w === 0)).toBe(true);
  });
  it('the Nova ends without a step: from 0.9 s on no level moves by more than 0.01 a frame', () => {
    const m = newLichMem(), rest = newLichMem();
    run(m, ANIM.Slam, W.slam);
    run(rest, ANIM.Idle, W.slam);
    // the weights follow the spike's own smoothsteps (novaOut falls 0.04 a frame until 0.97 s); the shared levels must not step at the end
    const levels = ['rune', 'staffRune', 'gem', 'eye', 'flare', 'casting'] as const;
    let prev: number[] | null = null;
    for (let i = 0; i < 130; i++) {
      const p = lichPose(base(), DT, m), q = lichPose(base(), DT, rest); // the clock-driven part is the same in both
      const r = (i + 1) * DT;
      const now = levels.map((k) => p[k] - q[k]);
      if (r > 0.9 && prev) now.forEach((v, j) => expect(Math.abs(v - prev![j]), `${levels[j]} at ${r}`).toBeLessThan(0.01));
      prev = now;
    }
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
  // 60 fps frames of `dt` = DT; the server's animT arrives in snapshots only, so it steps every `every`th frame
  /** Feeds frames of `anim` whose animT runs `from`, `from + DT`, ... up to `last`; only every `every`th frame brings a new value. Returns the last value seen. */
  const feed = (m: LichMem, anim: number, from: number, last: number, every = 2): number => {
    let seen = from;
    for (let k = 0; from + k * DT <= last + 1e-9; k++) { if (k % every === 0) seen = from + k * DT; lichPose(base({ anim, animT: seen }), DT, m); }
    return seen;
  };
  /** `n` more frames of the same anim with no new snapshot. */
  const holdFrames = (m: LichMem, anim: number, seen: number, n: number): void => { for (let i = 0; i < n; i++) lichPose(base({ anim, animT: seen }), DT, m); };
  it('a normal release: snapshots every 2 ticks, the last one at W - 2 DT', () => {
    const m = newLichMem();
    const seen = feed(m, ANIM.Slam, W.slam - 20 * DT, W.slam - 2 * DT);
    expect(seen).toBeCloseTo(W.slam - 2 * DT, 9);
    holdFrames(m, ANIM.Slam, seen, 1);
    expect(lichPose(base(), DT, m).novaHit).toBeGreaterThan(0.8);
  });
  it('one lost snapshot at the end: the last animT seen is W - 4 DT and the cast still releases', () => {
    const m = newLichMem();
    const seen = feed(m, ANIM.Slam, W.slam - 20 * DT, W.slam - 4 * DT);
    expect(seen).toBeCloseTo(W.slam - 4 * DT, 9);
    holdFrames(m, ANIM.Slam, seen, 3);
    expect(lichPose(base(), DT, m).novaHit).toBeGreaterThan(0.8);
  });
  it('two lost snapshots are the same elapsed time: it releases, as the server\'s clock really got there', () => {
    const m = newLichMem();
    const seen = feed(m, ANIM.Slam, W.slam - 24 * DT, W.slam - 6 * DT);
    holdFrames(m, ANIM.Slam, seen, 5);
    expect(lichPose(base(), DT, m).novaHit).toBeGreaterThan(0.8);
  });
  it('a cast broken off early after a lost snapshot is still broken: no hit, no fling', () => {
    const m = newLichMem();
    const seen = feed(m, ANIM.Slam, 0.2 - 10 * DT, 0.2);
    holdFrames(m, ANIM.Slam, seen, 3);
    const ps = [snap(lichPose(base(), DT, m)), ...idle(m, 0.4)];
    expect(ps.every((p) => p.novaHit === 0 && p.novaOut === 0)).toBe(true);
    expect(ps[0].novaChest).toBeGreaterThan(0.1);
    const b = newLichMem();
    const seenB = feed(b, ANIM.Slam, W.slam - 24 * DT, W.slam - 8 * DT);
    holdFrames(b, ANIM.Slam, seenB, 3);
    expect(lichPose(base(), DT, b).novaHit).toBe(0);
  });
  it('a cast broken off early without a lost snapshot is broken', () => {
    const m = newLichMem();
    const seen = feed(m, ANIM.Slam, 0.2 - 10 * DT, 0.2);
    holdFrames(m, ANIM.Slam, seen, 1);
    expect(lichPose(base(), DT, m).novaHit).toBe(0);
  });
  it('the same wind-up restarting: the first releases, the second runs on its own animT', () => {
    const m = newLichMem();
    const seen = feed(m, ANIM.Slam, W.slam - 20 * DT, W.slam - 2 * DT);
    holdFrames(m, ANIM.Slam, seen, 1);
    const fresh = newLichMem();
    const p = lichPose(base({ anim: ANIM.Slam, animT: 0.5 }), DT, m);
    expect(p.novaUp).toBeCloseTo(lichPose(base({ anim: ANIM.Slam, animT: 0.5 }), DT, fresh).novaUp, 9);
    // the new one goes on to its own release, from its own clock
    const seen2 = feed(m, ANIM.Slam, 0.5, W.slam - 2 * DT);
    holdFrames(m, ANIM.Slam, seen2, 1);
    expect(lichPose(base(), DT, m).novaHit).toBeGreaterThan(0.8);
  });
  it('a restart does not carry a frozen wind-up\'s heldFor into the new one', () => {
    const m = newLichMem();
    lichPose(base({ anim: ANIM.Slam, animT: 0.6 }), DT, m);
    for (let i = 1; i <= 60; i++) lichPose(base({ anim: ANIM.Slam, animT: 0.6 + i * DT, effects: bit(EFFECT.Frozen) }), DT, m);
    lichPose(base({ anim: ANIM.Slam, animT: 0.6 + 61 * DT }), DT, m); // thawed, the same wind-up
    const fresh = newLichMem();
    const p = lichPose(base({ anim: ANIM.Slam, animT: 0.3 }), DT, m); // the animT fell: a new wind-up
    expect(p.novaUp).toBeCloseTo(lichPose(base({ anim: ANIM.Slam, animT: 0.3 }), DT, fresh).novaUp, 9);
    expect(m.heldFor).toBe(0);
  });
  it('a first sight in mid wind-up starts from its animT and releases when it ends', () => {
    const m = newLichMem();
    expect(lichPose(base({ anim: ANIM.Slam, animT: 0.6 }), DT, m).novaUp).toBeGreaterThan(0.9);
    const seen = feed(m, ANIM.Slam, W.slam - 20 * DT, W.slam - 2 * DT);
    holdFrames(m, ANIM.Slam, seen, 1);
    expect(lichPose(base(), DT, m).novaHit).toBeGreaterThan(0.8);
  });
  it('dt 0 and a huge dt change nothing wrong', () => {
    const m = newLichMem();
    const seen = feed(m, ANIM.Slam, W.slam - 20 * DT, W.slam - 2 * DT);
    for (let i = 0; i < 5; i++) lichPose(base({ anim: ANIM.Slam, animT: seen }), 0, m); // dt 0 adds no time: still a release below
    holdFrames(m, ANIM.Slam, seen, 1);
    expect(lichPose(base(), DT, m).novaHit).toBeGreaterThan(0.8);
    // a long frame on the same anim does not turn a broken-off cast into a release
    const b = newLichMem();
    const sb = feed(b, ANIM.Slam, 0.2 - 10 * DT, 0.2);
    lichPose(base({ anim: ANIM.Slam, animT: sb }), 5, b);
    const p = lichPose(base(), DT, b);
    expect(p.novaHit).toBe(0);
    expect(Object.values(p).every((v) => !Number.isNaN(v))).toBe(true);
  });
  it('a dt over 0.1 s ends a running second half at once, at 0.15 s too', () => {
    const m = newLichMem();
    run(m, ANIM.Slam, W.slam);
    lichPose(base(), DT, m);
    for (let i = 0; i < 20; i++) lichPose(base(), DT, m);
    expect(lichPose(base(), DT, m).novaOut).toBeGreaterThan(0.5);
    const p = lichPose(base(), 0.15, m);
    expect(weights(p).every((w) => w === 0)).toBe(true);
    expect(Object.values(p).every((v) => !Number.isNaN(v))).toBe(true);
    // a broken-off ease ends the same way
    const e = newLichMem();
    run(e, ANIM.Windup, 0.2);
    lichPose(base(), DT, e);
    expect(weights(lichPose(base(), 0.15, e)).every((w) => w === 0)).toBe(true);
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
      // the server's wind-up goes on counting animT while frozen (anim stays Slam)
      const FROZEN = 120;
      for (let i = 1; i <= FROZEN; i++) {
        const p = lichPose(base({ anim: ANIM.Slam, animT: W.slam / 2 + i * DT, effects: bit(fx), aim: 2 }), DT, m);
        expect(p).toEqual(last);
      }
      // thawed: the wind-up resumes where it stopped, no jump
      const thawed = lichPose(base({ anim: ANIM.Slam, animT: W.slam / 2 + (FROZEN + 1) * DT }), DT, m);
      for (const k of WEIGHTS) expect(thawed[k], k).toBeCloseTo(last[k], 1);
      expect(thawed.flare).toBeCloseTo(last.flare, 1);
      expect(thawed.novaUp).toBeGreaterThan(0.9);
      // it goes on and the release fires after the wind-up's own length, frozen seconds not counted
      for (let e = W.slam / 2 + 2 * DT; e < W.slam - 1e-9; e += DT) {
        const p = lichPose(base({ anim: ANIM.Slam, animT: e + FROZEN * DT }), DT, m);
        expect(p.novaHit).toBe(0);
      }
      expect(lichPose(base({ anim: ANIM.Idle, animT: W.slam + (FROZEN + 1) * DT }), DT, m).novaHit).toBeGreaterThan(0.8);
    });
  }
  it('a wind-up that really ends early eases back', () => {
    const m = newLichMem();
    run(m, ANIM.Slam, 0.5);
    const ps = idle(m, 0.4);
    expect(ps.every((p) => p.novaHit === 0 && p.novaOut === 0)).toBe(true);
    expect(ps[0].novaUp).toBeGreaterThan(0.9);
    expect(ps[ps.length - 1].novaUp).toBeLessThan(0.01);
  });
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
    // still set at 0.3 s: it did not start again
    for (let t = 0.2; t < 0.3; t += DT) p = lichPose(base({ flags: FLAG.HURT }), DT, m);
    expect(p.hurt).toBe(0);
    lichPose(base(), DT, m);
    // a second rise after the flag cleared flinches again
    p = lichPose(base({ flags: FLAG.HURT }), DT, m);
    for (let t = DT; t < 0.075 - 1e-9; t += DT) p = lichPose(base({ flags: FLAG.HURT }), DT, m);
    expect(p.hurt).toBeGreaterThan(0.9);
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
    expect(Object.values(q).every((v) => !Number.isNaN(v))).toBe(true);
    const c = newLichMem();
    const z = lichPose(base({ anim: ANIM.Slam, animT: 0.3 }), 0, c);
    expect(Object.values(z).every((v) => !Number.isNaN(v))).toBe(true);
  });
  it('face stays within PI and turns the short way across the wrap', () => {
    const m = newLichMem();
    let p = lichPose(base({ aim: 3.1 }), DT, m);
    expect(p.face).toBeCloseTo(3.1, 9);
    for (let i = 0; i < 120; i++) {
      const before = p.face;
      p = lichPose(base({ aim: -3.1 }), DT, m);
      const d = Math.atan2(Math.sin(p.face - before), Math.cos(p.face - before));
      expect(Math.abs(d)).toBeLessThan(0.1);
      expect(Math.abs(p.face)).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
    expect(Math.abs(Math.atan2(Math.sin(p.face + 3.1), Math.cos(p.face + 3.1)))).toBeLessThan(0.01);
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
