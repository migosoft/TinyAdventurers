import { describe, expect, it } from 'vitest';
import { KIND } from '../../generated/defs';
import { DESCS, FIT_KIND, MODEL_OF_KIND, modelKeyOf, type DescKey } from './table';

describe('figure descriptions', () => {
  it('every description is well formed', () => {
    for (const [key, d] of Object.entries(DESCS)) {
      const known = (c: string) => expect(Object.keys(d.colours), `${key}: colour ${c}`).toContain(c);
      const sides = [d.side, ...d.parts.map((p) => p.side ?? [])];
      for (const side of sides) {
        for (const line of side) {
          expect(line.length, `${key}: ${line}`).toBe(16);
          for (const ch of line) if (ch !== '.') known(ch);
        }
      }
      expect(d.parts.length).toBe(2);
      if (d.hair) known(d.hair.colour);
      if (d.hat) { known(d.hat.colour); known(d.hat.band); }
      if (d.collar) known(d.collar.colour);
      for (const r of d.rings ?? []) known(r.colour);
      for (const s of d.shells ?? []) known(s.colour);
      if (d.legs) known(d.legs.colour);
      if (d.arms) { known(d.arms.colour); known(d.arms.hand); }
      for (const k of Object.keys(d.raised ?? {})) known(k);
      for (const s of d.spikes ?? []) {
        known(s.colour);
        if (s.on !== undefined) expect(['head', 'body']).toContain(s.on);
        for (const ref of [s.front, s.side]) {
          if (!ref) continue;
          expect(['head', 'body', 'hair']).toContain(ref.of);
          if (ref.of === 'hair') expect(d.hair, `${key}: hair ref`).toBeDefined();
        }
      }
    }
  });

  it('the approved numbers', () => {
    expect(DESCS.knight.visor).toEqual({ rows: [15, 18], half: 50, line: 0.6, slits: 3, slitWide: 0.8, frame: 0x2b3a4c, slit: 0x1a222c });
    expect(DESCS.wolf.eyes).toEqual({ rows: [17.1, 17.1], width: 2.5, colour: 0x9f294e, at: 29 });
    expect(DESCS.ogre.spikes?.[0].row).toBe(17.2);
  });

  it('sizes: the wizard is as tall as its card, the dwarf takes the least, the rest a little less', () => {
    const want: Record<DescKey, number | undefined> = { wizard: undefined, dwarf: 0.77, elf: 0.87, knight: 0.87, skelet: 0.87, ogre: 0.87, wolf: 0.87 };
    for (const key of Object.keys(DESCS) as DescKey[]) expect(DESCS[key].size, key).toBe(want[key]);
  });

  it('every description is fitted to a kind that wears it', () => {
    for (const key of Object.keys(DESCS) as DescKey[]) expect(modelKeyOf(FIT_KIND[key]), key).toBe(key);
  });

  it('seventeen game kinds have a model', () => {
    expect(Object.keys(MODEL_OF_KIND).length).toBe(17);
    expect(modelKeyOf(KIND.Knight)).toBe('npcKnight');
    expect(modelKeyOf(KIND.Paladin)).toBe('knight');
    expect(modelKeyOf(KIND.GoblinArcher)).toBe('goblin');
    expect(modelKeyOf(KIND.OrcWarrior)).toBe('orc');
    expect(modelKeyOf(KIND.OrcArcher)).toBe('orcArcher');
    expect(modelKeyOf(KIND.Stag)).toBe('stag');
    expect(modelKeyOf(KIND.Deer)).toBe('deer');
    expect(modelKeyOf(KIND.Boar)).toBe('boar');
    expect(modelKeyOf(KIND.Bunny)).toBe('bunny');
    expect(modelKeyOf(KIND.Lich)).toBeNull();
    expect(modelKeyOf(KIND.RaisedSkeleton)).toBe('skelet');
  });
});
