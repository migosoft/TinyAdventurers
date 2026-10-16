import { describe, expect, it } from 'vitest';
import { secondaryLabel } from './hud';

describe('secondaryLabel', () => {
  it('reads Heal Wolf while the wolf lives', () => expect(secondaryLabel(true, 'Dire Wolf')).toBe('Heal Wolf'));
  it('reads Summon Wolf without a wolf', () => expect(secondaryLabel(false, 'Dire Wolf')).toBe('Summon Wolf'));
  it('keeps the name of other classes', () => expect(secondaryLabel(null, 'Charge')).toBe('Charge'));
});
