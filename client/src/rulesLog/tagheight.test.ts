// A tag's height comes from the entity's view. A real chest, a barrel and a hidden mimic must all
// have one, with the same value for chest and mimic, or the log would tell them apart.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('tag heights', () => {
  it('the draw hook looks in every view map that can hold a taggable entity', () => {
    const line = read('game/GameScene.ts')
      .split('\n')
      .find((l) => l.includes('this.rulesLog.draw('));
    expect(line).toBeDefined();
    for (const m of ['this.views', 'this.mimicViews', 'this.chestViews', 'this.barrelViews']) expect(line).toContain(m);
  });

  it('chest, barrel and mimic views share one height', () => {
    for (const f of ['game/chest.ts', 'game/barrel.ts', 'game/mimic.ts']) expect(read(f)).toMatch(/\bheight = CHEST_HEIGHT\b/);
    expect(read('game/chest.ts')).toMatch(/export const CHEST_HEIGHT = 16;/);
  });
});
