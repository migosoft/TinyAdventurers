import { describe, expect, it } from 'vitest';
import { MAP_ROWS, parseMap, solid } from './demoMap';
import { frameDt, frameOf, newScene, stepScene } from './scene';

const map = parseMap(MAP_ROWS);

describe('frameDt', () => {
  it('clamps the frame time', () => {
    expect(frameDt(10, 0)).toBe(0.05);
    expect(frameDt(1, 1)).toBe(0.001);
    expect(frameDt(1.02, 1)).toBeCloseTo(0.02, 10);
  });
});

describe('player', () => {
  it('stops at the west wall and never enters a solid cell', () => {
    const s = newScene();
    for (let i = 0; i < 100; i++) {
      stepScene(map, s, { x: -1, z: 0 }, 0.05);
      expect(solid(map, Math.floor(s.player.x), Math.floor(s.player.z))).toBe(false);
    }
    expect(s.player.x).toBeGreaterThanOrEqual(2.28 - 1e-9);
  });

  it('slides along the north wall when pushed diagonally into it', () => {
    const s = newScene();
    for (let i = 0; i < 40; i++) stepScene(map, s, { x: 0, z: -1 }, 0.05);
    const x0 = s.player.x;
    const z0 = s.player.z;
    const d = Math.SQRT1_2;
    for (let i = 0; i < 10; i++) stepScene(map, s, { x: d, z: -d }, 0.05);
    expect(s.player.x).toBeGreaterThan(x0 + 0.5);
    expect(s.player.z).toBeGreaterThanOrEqual(z0 - 0.5);
    expect(s.player.moving).toBe(true);
  });

  it('never moves more than speed * dt per step', () => {
    const s = newScene();
    for (let i = 0; i < 50; i++) {
      const px = s.player.x, pz = s.player.z;
      stepScene(map, s, { x: 1, z: 1 }, 0.05);
      expect(Math.hypot(s.player.x - px, s.player.z - pz)).toBeLessThanOrEqual(4.6 * 0.05 + 1e-9);
    }
  });
});

describe('walkers', () => {
  it('reaches the second waypoint, then waits its pause', () => {
    const s = newScene();
    const orc = s.ents.find((e) => e.kind === 'orc')!;
    const path = orc.path!;
    let guard = 0;
    while (orc.at === 1 && guard++ < 2000) stepScene(map, s, { x: 0, z: 0 }, 0.05);
    expect(orc.at).toBe(2);
    expect(orc.x).toBeCloseTo(path[1][0], 6);
    expect(orc.z).toBeCloseTo(path[1][1], 6);
    expect(orc.wait).toBeGreaterThan(0);
    stepScene(map, s, { x: 0, z: 0 }, 0.05);
    expect(orc.moving).toBe(false);
  });
});

describe('frameOf', () => {
  it('picks idle for a standing knight and run for a moving one', () => {
    const s = newScene();
    expect(frameOf(s.player).startsWith('knight_m_idle_anim_f')).toBe(true);
    s.player.moving = true;
    expect(frameOf(s.player).startsWith('knight_m_run_anim_f')).toBe(true);
  });
});

describe('torches', () => {
  it('stand on floor cells whose northern neighbour is a wall', () => {
    for (const t of newScene().torches) {
      const cx = Math.floor(t.x), cz = Math.floor(t.z);
      expect(solid(map, cx, cz)).toBe(false);
      expect(solid(map, cx, cz - 1)).toBe(true);
    }
  });
});
