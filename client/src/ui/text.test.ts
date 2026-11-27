import { describe, expect, it } from 'vitest';
import { BOSS_TEXT, className } from './text';

describe('BOSS_TEXT', () => {
  it('names the two demons', () => {
    expect([BOSS_TEXT.FireDemon.name, BOSS_TEXT.FireDemon.short]).toEqual(['Kharzul, Lord of Cinders', 'Kharzul']);
    expect([BOSS_TEXT.IceDemon.name, BOSS_TEXT.IceDemon.short]).toEqual(['Ysskar, Lord of Rime', 'Ysskar']);
  });
});

describe('className', () => {
  it('shows the class as players read it', () => {
    expect(className('ElvenRanger')).toBe('Elven Ranger');
    expect(className('Wizard')).toBe('Wizard');
  });
});
