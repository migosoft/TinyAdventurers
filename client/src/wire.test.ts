// The client must unpack exactly what the server packed (fixtures written by
// `cargo test`, server/src/export.rs). Positions and aim lose precision on
// the wire by design; everything else must match.
import { decode } from '@msgpack/msgpack';
import { describe, expect, it } from 'vitest';
import { CONST, EFFECT, EFFECT_LOOK, KIND } from './generated/defs';
import type { Ev } from './generated/Ev';
import type { SelfW } from './generated/SelfW';
import type { SnapW } from './generated/SnapW';
import fixtures from './generated/wire-fixtures.json';
import { drownByte, drownOf, headOf, hurtDirOf, packInput, unpackSnap } from './wire';

const POS_TOL = 0.5 / CONST.POS_SCALE + 1e-6;
const AIM_TOL = Math.PI / 256 + 1e-6;

function close(got: unknown, want: unknown, path: string): void {
  if (typeof want === 'number') {
    expect(typeof got, path).toBe('number');
    let d = Math.abs((got as number) - want);
    if (/^(ents\.\d+\.6|ev\.\d+\.aim)$/.test(path)) {
      d = Math.min(d, 2 * Math.PI - d);
      expect(d, path).toBeLessThanOrEqual(AIM_TOL);
    } else if (/^(ents\.\d+\.[23]|ev\.\d+\.[xy]|drain\.\d+\.[01]|solids\.\d+\.[012]|lights\.\d+\.[01])$/.test(path)) {
      expect(d, path).toBeLessThanOrEqual(POS_TOL);
    } else {
      expect(d, path).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(want)));
    }
  } else if (want !== null && typeof want === 'object') {
    expect(got !== null && typeof got === 'object', path).toBe(true);
    expect(Object.keys(got as object).sort(), path).toEqual(Object.keys(want).sort());
    for (const k of Object.keys(want)) {
      close((got as Record<string, unknown>)[k], (want as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
    }
  } else {
    expect(got, path).toEqual(want);
  }
}

describe('wire', () => {
  it('unpacks the server snapshots', () => {
    expect(fixtures.cases.length).toBe(3);
    for (const c of fixtures.cases) {
      const snap = unpackSnap(decode(Uint8Array.from(c.bytes)) as SnapW);
      close(snap, c.snap, '');
    }
  });

  // Case 0 holds all sample entities, including aims near both sides of ±π.
  it('returns aims in (-pi, pi] like atan2 on the server', () => {
    const snap = unpackSnap(decode(Uint8Array.from(fixtures.cases[0].bytes)) as SnapW);
    for (const e of snap.ents) {
      expect(e[6]).toBeGreaterThan(-Math.PI);
      expect(e[6]).toBeLessThanOrEqual(Math.PI);
    }
  });

  it('reads a hazard\'s element 6 as a radius in px, not an angle', () => {
    const me: SelfW = [true, 1, 1, 0, 0, 0, 0, 0, 0, 0, null, null, 0, 9, [], 1, false, 1, 1, [], [], null, 0];
    const hazards: SnapW[2] = [[5, KIND.HolyGround, 16, 16, 255, 0, 40, 0, 0, 0, 0, 0, 0, 128, 0], [6, KIND.FirePatch, 16, 16, 255, 0, 48, 0, 0, 0, 0, 0, 0, 128, 0], [7, KIND.Roots, 16, 16, 255, 0, 64, 0, 0, 0, 0, 0, 0, 128, 0]];
    const snap = unpackSnap([1, 0, hazards, me, null, [], 0, null, [], [], [], [], [], null]);
    expect(snap.ents.map((e) => e[6])).toEqual([40, 48, 64]);
    // The wire fixture's hazards (case 1) agree.
    const fx = unpackSnap(decode(Uint8Array.from(fixtures.cases[1].bytes)) as SnapW);
    expect(fx.ents.map((e) => e[6])).toEqual([40, 48]);
  });

  it('keeps an exactly-left aim at +pi (the staff swing uses the raw angle)', () => {
    const me: SelfW = [true, 1, 1, 0, 0, 0, 0, 0, 0, 0, null, null, 0, 9, [], 1, false, 1, 1, [], [], null, 0];
    const snap = unpackSnap([1, 0, [[5, 1, 16, 16, 255, 0, 128, 0, 0, 0, 0, 1, 0, 128, 0]], me, null, [], 0, null, [], [], [], [], [], null]);
    expect(snap.ents[0][6]).toBe(Math.PI);
  });

  it('reads the hit direction: 0 is none, 1..255 an angle in (-pi, pi]', () => {
    expect(hurtDirOf(0)).toBeNull();
    expect(hurtDirOf(1)).toBe(0);
    for (let b = 1; b <= 255; b++) {
      const a = hurtDirOf(b)!;
      expect(a).toBeGreaterThan(-Math.PI);
      expect(a).toBeLessThanOrEqual(Math.PI);
    }
    // 1 + round(a / 2π × 255): a quarter turn is byte 65 (a right angle to within half a step).
    expect(Math.abs(hurtDirOf(65)! - Math.PI / 2)).toBeLessThan(0.0125);
    expect(Math.abs(hurtDirOf(192)! + Math.PI / 2)).toBeLessThan(0.0125);
  });

  it('reads the head angle: 128 is straight ahead, 1 and 255 are -pi and +pi', () => {
    expect(headOf(128)).toBe(0);
    expect(headOf(255)).toBeCloseTo(Math.PI, 9);
    expect(headOf(1)).toBeCloseTo(-Math.PI, 9);
  });

  it('reads the drowning stage: 0 is none, 1 + tenths of a second, plus 128 when breathless', () => {
    expect(drownOf(0)).toBeNull();
    expect(drownOf(128)).toBeNull();
    expect(drownOf(1)).toEqual({ t: 0, breathless: false });
    expect(drownOf(13)).toEqual({ t: 1.2, breathless: false });
    expect(drownOf(127)).toEqual({ t: 12.6, breathless: false });
    expect(drownOf(2 + 128)).toEqual({ t: 0.1, breathless: true });
    // the server's table (`drown_byte_table`)
    expect([drownByte(0), drownByte(0.05), drownByte(1.2), drownByte(20), drownByte(0.05, true), drownByte(20, true)]).toEqual([0, 2, 13, 127, 130, 255]);
  });

  it('keeps the Attribute amount of an own effect', () => {
    const me: SelfW = [true, 1, 1, 0, 0, 0, 0, 0, 0, 0, null, null, 0, 9, [[16, 12.5, -2, false], [4, 3, 0, true]], 1, false, 1, 1, ['BandOfVigor'], ['PU5'], 'the Orc Warrior', 1.35];
    const snap = unpackSnap([1, 0, [], me, null, [], 0, null, [], [], [], [], [], null]);
    expect(snap.me.effects).toEqual([[16, 12.5, -2, false], [4, 3, 0, true]]);
    expect(snap.me.paused_items).toEqual(['BandOfVigor']);
    expect(snap.me.paused_nodes).toEqual(['PU5']);
    expect(snap.me.charmed_by).toBe('the Orc Warrior');
    expect(snap.me.water_t).toBe(1.35);
  });

  it('unpacks moving lights with an optional colour', () => {
    const me: SelfW = [true, 1, 1, 0, 0, 0, 0, 0, 0, 0, null, null, 0, 9, [], 1, false, 1, 1, [], [], null, 0];
    const snap = unpackSnap([1, 0, [], me, null, [], 0, null, [[160, 320, 2, null], [16, 32, 3, 0x78c8ff]], [], [], [], [], null]);
    expect(snap.lights).toEqual([[10, 20, 2, null], [1, 2, 3, 0x78c8ff]]);
  });

  it('unpacks the effect looks', () => {
    const snap = unpackSnap(decode(Uint8Array.from(fixtures.cases[0].bytes)) as SnapW);
    expect(snap.looks).toEqual([[3, EFFECT.Entangled, EFFECT_LOOK.Vines]]);
    expect(unpackSnap(decode(Uint8Array.from(fixtures.cases[1].bytes)) as SnapW).looks).toEqual([]);
  });

  it('carries the look on the effect event', () => {
    const snap = unpackSnap(decode(Uint8Array.from(fixtures.cases[0].bytes)) as SnapW);
    const fx = snap.ev.filter((e) => e.t === 'Effect');
    expect(fx).toEqual([
      { t: 'Effect', id: 3, kind: EFFECT.Entangled, on: true, look: EFFECT_LOOK.Vines },
    ]);
  });

  it('decodes the Zap event', () => {
    const snap = unpackSnap(decode(Uint8Array.from(fixtures.cases[0].bytes)) as SnapW);
    const zaps = snap.ev.filter((e) => e.t === 'Zap');
    expect(zaps).toHaveLength(1);
    const z = zaps[0] as { x: number; y: number; x2: number; y2: number };
    expect(z.x).toBeCloseTo(100.03, 1);
    expect(z.y2).toBeCloseTo(190.25, 1);
  });

  it('decodes the Cast event', () => {
    const snap = unpackSnap(decode(Uint8Array.from(fixtures.cases[0].bytes)) as SnapW);
    const casts = snap.ev.filter((e) => e.t === 'Cast');
    expect(casts).toHaveLength(1);
    const c = casts[0] as Extract<Ev, { t: 'Cast' }>;
    expect([c.id, c.look, c.windup_ms, c.primary]).toEqual([2, 1, 600, true]);
    expect(c.x).toBeCloseTo(130.03, 1);
    expect(c.aim).toBeCloseTo(-1.2, 1);
  });

  it('packs inputs in field order with null for no shot', () => {
    const i = { seq: 7, mx: 1, my: -1, aim: 0.5, aim_dist: 30, primary: 3, secondary: undefined as unknown as null, view_lag: 80, rtt: 40, act: true };
    expect(packInput(i)).toEqual([7, 1, -1, 0.5, 30, 3, null, 80, 40, true]);
  });

  it('unpacks the dark marks', () => {
    const snap = unpackSnap(decode(Uint8Array.from(fixtures.cases[0].bytes)) as SnapW);
    expect(snap.dark).toEqual([300, 70001]);
    expect(snap.dark_ev).toEqual([2, 3]);
    for (const c of fixtures.cases.slice(1)) {
      const s = unpackSnap(decode(Uint8Array.from(c.bytes)) as SnapW);
      expect(s.dark).toEqual([]);
      expect(s.dark_ev).toEqual([]);
    }
  });

  it('a snapshot without the log field decodes with log null', () => {
    for (const c of fixtures.cases.slice(0, 2)) {
      expect(unpackSnap(decode(Uint8Array.from(c.bytes)) as SnapW).log).toBeNull();
    }
  });

  it('a snapshot with a log keeps its tags and lines', () => {
    expect(fixtures.cases.length).toBe(3);
    const snap = unpackSnap(decode(Uint8Array.from(fixtures.cases[2].bytes)) as SnapW);
    expect(snap.log).toEqual([
      [[1, 2, 3], [7, 4, 0]],
      [[1.5, 0, 'Goblin 1 hits Mage', ['9 Slashing', 'x2 vs Mage']], [2.25, 3, 'Goblin 1 dies', []]],
    ]);
  });
});
