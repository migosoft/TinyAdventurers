// The client must unpack exactly what the server packed (fixtures written by
// `cargo test`, server/src/export.rs). Positions and aim lose precision on
// the wire by design; everything else must match.
import { decode } from '@msgpack/msgpack';
import { describe, expect, it } from 'vitest';
import { CONST, EFFECT, EFFECT_LOOK } from './generated/defs';
import type { SelfW } from './generated/SelfW';
import type { SnapW } from './generated/SnapW';
import fixtures from './generated/wire-fixtures.json';
import { packInput, unpackSnap } from './wire';

const POS_TOL = 0.5 / CONST.POS_SCALE + 1e-6;
const AIM_TOL = Math.PI / 256 + 1e-6;

function close(got: unknown, want: unknown, path: string): void {
  if (typeof want === 'number') {
    expect(typeof got, path).toBe('number');
    let d = Math.abs((got as number) - want);
    if (/^ents\.\d+\.6$/.test(path)) {
      d = Math.min(d, 2 * Math.PI - d);
      expect(d, path).toBeLessThanOrEqual(AIM_TOL);
    } else if (/^(ents\.\d+\.[23]|ev\.\d+\.[xy]|drain\.\d+\.[01]|lights\.\d+\.[01])$/.test(path)) {
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

  it('keeps an exactly-left aim at +pi (the staff swing uses the raw angle)', () => {
    const me: SelfW = [true, 1, 1, 0, 0, 0, 0, 0, 0, 0, null, null, 0, 9, [], 1, false, 1];
    const snap = unpackSnap([1, 0, [[5, 1, 16, 16, 255, 0, 128, 0, 0, 0, 0]], me, null, [], 0, null, [], [], null]);
    expect(snap.ents[0][6]).toBe(Math.PI);
  });

  it('unpacks moving lights with an optional colour', () => {
    const me: SelfW = [true, 1, 1, 0, 0, 0, 0, 0, 0, 0, null, null, 0, 9, [], 1, false, 1];
    const snap = unpackSnap([1, 0, [], me, null, [], 0, null, [[160, 320, 2, null], [16, 32, 3, 0x78c8ff]], [], null]);
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

  it('packs inputs in field order with null for no shot', () => {
    const i = { seq: 7, mx: 1, my: -1, aim: 0.5, aim_dist: 30, primary: 3, secondary: undefined as unknown as null, view_lag: 80, rtt: 40, act: true };
    expect(packInput(i)).toEqual([7, 1, -1, 0.5, 30, 3, null, 80, 40, true]);
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
