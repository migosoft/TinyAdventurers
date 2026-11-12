import { describe, expect, it } from 'vitest';
import { keysToWorld } from './camera';
import { moveInput } from './runView3d';

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
