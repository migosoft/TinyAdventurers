import { describe, expect, it } from 'vitest';
import { r3dPage } from '../r3dFlag';
import { CASTER_ID, FX_GROUPS, FX_ROWS, SLOTS, TARGET_ID, eventsBetween, parseFx, placeEnt, placeEvent, slotEnts, slotOrigin } from './fxStage';

describe('the ?r3d=fx page', () => {
  it('is a dev page, and the try-out page is gone', () => {
    expect(r3dPage('?r3d=fx')).toBe('fx');
    expect(r3dPage('?r3d=magic')).toBeNull();
  });

  it('every row builds', () => {
    expect(FX_ROWS.length).toBeGreaterThan(0);
    for (const row of FX_ROWS) {
      expect(FX_GROUPS).toContain(row.group);
      for (const t of [0, 0.3, 1, row.period - 0.01]) {
        const s = row.at(t);
        for (const e of s.ents) {
          expect(Number.isFinite(e.x)).toBe(true);
          expect(Number.isFinite(e.y)).toBe(true);
        }
        for (const e of s.events) {
          expect(e.at).toBeGreaterThanOrEqual(0);
          expect(e.at).toBeLessThan(row.period);
        }
      }
    }
  });

  it('puts the caster, the targets and the torches in a slot, and a scene\'s entity of the same id replaces the default', () => {
    const row = FX_ROWS[0];
    const ents = slotEnts(2, row.at(1), 1, true);
    const ids = ents.map((e) => e.id);
    expect(ids).toContain(2000 + CASTER_ID);
    expect(ids).toContain(2000 + TARGET_ID + 2);
    expect(new Set(ids).size).toBe(ids.length);
    const o = slotOrigin(2);
    expect(ents.find((e) => e.id === 2000 + CASTER_ID)!.x).toBeGreaterThan(o.x * 16);
    expect(ents.filter((e) => e.id === 2000 + CASTER_ID)).toHaveLength(1);
  });

  it('moves events and entities into the room, ids and all', () => {
    const ev = placeEvent({ t: 'Zap', x: 10, y: 20, x2: 30, y2: 40 }, 5);
    const o = slotOrigin(5);
    expect(ev).toEqual({ t: 'Zap', x: 10 + o.x * 16, y: 20 + o.z * 16, x2: 30 + o.x * 16, y2: 40 + o.z * 16 });
    expect((placeEvent({ t: 'Died', id: 7, x: 0, y: 0, kind: 1 }, 3) as { id: number }).id).toBe(3007);
    const e = placeEnt({ ...FX_ROWS[0].at(0).ents[0], x: 16, y: 32 }, 1);
    expect(e.x).toBe(16 + 15 * 16);
  });

  it('sends each event once as the clock passes it, in every cycle', () => {
    const row = { ...FX_ROWS[0], period: 4 };
    const scene = row.at(0);
    const at = scene.events.map((e) => e.at);
    expect(eventsBetween(row, scene, -1, 0.2)).toHaveLength(0);
    expect(eventsBetween(row, scene, 0.2, 0.4).map((e) => e.abs)).toEqual([at[0]]);
    expect(eventsBetween(row, scene, 0, 4.2).length).toBe(2);
    expect(eventsBetween(row, scene, 0, 8.2).map((e) => e.abs)).toEqual([at[0], at[1], 4 + at[0], 4 + at[1]].sort((a, b) => a - b));
    expect(SLOTS).toBe(16);
  });

  it('reads the group, the pinned clock and the slowdown from the URL', () => {
    expect(parseFx('?r3d=fx')).toEqual({ group: 'spells', start: 0, pinned: false, slow: 1 });
    expect(parseFx('?r3d=fx&fx=booms&t=2.5&slow=5')).toEqual({ group: 'booms', start: 2.5, pinned: true, slow: 5 });
    expect(parseFx('?fx=nonsense').group).toBe('spells');
  });
});
