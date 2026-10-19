import { describe, expect, it } from 'vitest';
import { className } from './text';

describe('className', () => {
  it('shows the class as players read it', () => {
    expect(className('ElvenRanger')).toBe('Elven Ranger');
    expect(className('Wizard')).toBe('Wizard');
  });
});
