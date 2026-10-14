import { describe, expect, it } from 'vitest';
import { KIND } from '../generated/defs';
import { shotHits } from './hitbox';

// The same cases as the server test `shots_hit_the_upper_body_of_tall_figures`.
describe('shot hitboxes', () => {
  it('cover the upper body of tall figures', () => {
    expect(shotHits(KIND.Ogre, 0, 0, false, 0, -18, 3)).toBe(true);
    expect(shotHits(KIND.Ogre, 0, 0, false, 0, -32, 3)).toBe(false);
    expect(shotHits(KIND.Demon, 0, 0, false, 0, -45, 3)).toBe(true);
    expect(shotHits(KIND.Demon, 0, 0, false, 0, -70, 3)).toBe(false);
  });

  it('keep small figures round', () => {
    expect(shotHits(KIND.OrcWarrior, 0, 0, false, 8, 0, 3)).toBe(true);
    expect(shotHits(KIND.OrcWarrior, 0, 0, false, 0, -16, 3)).toBe(false);
  });

  it('rise with a flying dragon', () => {
    expect(shotHits(KIND.Dragon, 0, 0, false, 0, -50, 3)).toBe(false);
    expect(shotHits(KIND.Dragon, 0, 0, true, 0, -50, 3)).toBe(true);
  });

  it('ignore heroes and props', () => {
    expect(shotHits(KIND.Wizard, 0, 0, false, 0, 0, 3)).toBe(false);
    expect(shotHits(KIND.Chest, 0, 0, false, 0, 0, 3)).toBe(false);
  });
});
