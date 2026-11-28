import { describe, expect, it } from 'vitest';
import { PLANT_KIND } from '../../generated/defs';
import type { PlantInfo } from '../../generated/PlantInfo';
import { PLANT_KINDS, plantLook } from './kinds';

describe('plant kinds', () => {
  // The server's `PlantKind` ids, written by export.rs; adding a kind on one side fails this until the other follows.
  it('lists the server\'s plant kinds at their wire ids', () => {
    const byId = Object.entries(PLANT_KIND).sort((a, b) => a[1] - b[1]).map(([name]) => name.toLowerCase());
    expect(byId).toEqual([...PLANT_KINDS]);
  });

  it('a dead plant looks like the bare tree, a living one like its kind', () => {
    const plant = (kind: number, dead: boolean): PlantInfo => [kind, 0, 0, 7, 100, false, dead ? 0 : 100, dead];
    expect(plantLook(plant(0, true))).toBe('bare');
    expect(plantLook(plant(2, true))).toBe('bare');
    expect(plantLook(plant(2, false))).toBe('tall');
    expect(plantLook(plant(4, false))).toBe('bush');
  });
});
