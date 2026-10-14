import { describe, expect, it } from 'vitest';
import { endText } from './endText';

describe('endText', () => {
  it('names the slain boss on a dungeon win', () => {
    expect(endText(true, 'Dungeon', 'Lich')).toBe('Vael, the Undying Lich has been slain.');
  });
  it('keeps the dungeon defeat line', () => {
    expect(endText(false, 'Dungeon', 'Demon')).toBe('The dungeon claims another party.');
  });
  it('falls back to the level text when there is no boss', () => {
    expect(endText(true, 'Dungeon', null)).toBe('The dungeon is cleared.');
  });
});
