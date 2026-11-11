import { describe, expect, it } from 'vitest';
import { KIND } from '../generated/defs';
import { keysToWorld } from './camera';
import { heroFrame, moveInput } from './runView3d';

const deg = (d: number): number => (d * Math.PI) / 180;

describe('moveInput', () => {
  it('W at yaw 0 walks north', () => {
    expect(moveInput(new Set(['KeyW']), 0)).toEqual({ mx: 0, my: -1 });
  });
  it('W at yaw 90 degrees is the rounded keysToWorld', () => {
    const w = keysToWorld(deg(90), 0, -1);
    expect(moveInput(new Set(['KeyW']), deg(90))).toEqual({ mx: Math.round(w.x) + 0, my: Math.round(w.z) + 0 }); // + 0: no -0
    expect(moveInput(new Set(['KeyW']), deg(90))).toEqual({ mx: 1, my: 0 });
  });
  it('W at yaw 45 degrees walks north-east', () => {
    expect(moveInput(new Set(['KeyW']), deg(45))).toEqual({ mx: 1, my: -1 });
  });
  it('opposite keys cancel', () => {
    expect(moveInput(new Set(['KeyW', 'KeyS']), 0)).toEqual({ mx: 0, my: 0 });
  });
  it('the arrow keys equal the letters', () => {
    expect(moveInput(new Set(['ArrowLeft']), 0)).toEqual(moveInput(new Set(['KeyA']), 0));
    expect(moveInput(new Set(['ArrowLeft']), 0)).toEqual({ mx: -1, my: 0 });
  });
  it('two keys give a diagonal', () => {
    expect(moveInput(new Set(['KeyS', 'KeyD']), 0)).toEqual({ mx: 1, my: 1 });
  });
  it('nothing held is still', () => {
    expect(moveInput(new Set(), deg(30))).toEqual({ mx: 0, my: 0 });
  });
});

describe('heroFrame', () => {
  it('names the class idle and run frames, 5 and 9 per second', () => {
    expect(heroFrame(KIND.Paladin, false, 0)).toBe('knight_m_idle_anim_f0');
    expect(heroFrame(KIND.Paladin, true, 0.12)).toBe('knight_m_run_anim_f1');
    expect(heroFrame(KIND.Paladin, false, 0.45)).toBe('knight_m_idle_anim_f2');
    expect(heroFrame(KIND.Wizard, true, 0)).toBe('wizzard_m_run_anim_f0');
  });
  it('wraps after four frames', () => {
    expect(heroFrame(KIND.Paladin, false, 0.8)).toBe('knight_m_idle_anim_f0');
  });
});
