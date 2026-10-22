import { describe, expect, it } from 'vitest';
import { ATTRS, ITEMS, RESPEC, TREES } from './generated/progression';

describe('static progression data', () => {
  it('every class tree has its start and only links to nodes that exist', () => {
    for (const [cls, tree] of Object.entries(TREES)) {
      const nodes: Record<string, { links: readonly string[]; kind: string }> = tree.nodes;
      expect(nodes[tree.start], cls).toBeDefined();
      expect(nodes[tree.start].kind).toBe('Start');
      for (const [id, n] of Object.entries(nodes)) {
        for (const l of n.links) {
          expect(nodes[l], `${id} -> ${l}`).toBeDefined();
          expect(nodes[l].links, `${l} links back to ${id}`).toContain(id);
        }
      }
    }
  });

  it('knows item heroes can hold and natural weapons they cannot', () => {
    expect(ITEMS.Knife.hero).toBe(true);
    expect(ITEMS.MimicBite.hero).toBe(false);
  });

  it('has the Attribute lines and the respec price', () => {
    expect(ATTRS.Dex.weight).toBe(1.25);
    expect(ATTRS.Int.short).toBe('INT');
    expect(ATTRS.Str.text.length).toBeGreaterThan(0);
    expect(RESPEC).toEqual({ base: 20, per: 50 });
  });
});
