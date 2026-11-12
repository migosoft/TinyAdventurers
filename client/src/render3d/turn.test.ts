import { describe, expect, it } from 'vitest';
import { viewRay } from './camera';
import { CamTurn, DRAG_DEG_PER_PX } from './turn';

const rad = (d: number) => (d * Math.PI) / 180;

describe('CamTurn', () => {
  it('Z turns 45 degrees in 0.2 s', () => {
    const t = new CamTurn();
    t.step(1);
    t.update(0.1);
    expect(t.shown).toBeGreaterThan(0);
    expect(t.shown).toBeLessThan(45);
    t.update(0.11);
    expect(t.shown).toBe(45);
  });

  it('two quick presses turn 90', () => {
    const t = new CamTurn();
    t.step(1);
    t.update(0.05);
    const mid = t.shown;
    t.step(1);
    expect(t.shown).toBe(mid); // no jump on retarget
    t.update(0.3);
    expect(t.shown).toBe(90);
  });

  it('Z walks the camera to the left', () => {
    const t = new CamTurn();
    t.step(1);
    t.update(0.3);
    expect(viewRay(rad(45), rad(t.shown))[0]).toBeLessThan(0);
  });

  it('eight Z presses come back to north without a long spin', () => {
    const t = new CamTurn();
    let prev = t.shown;
    for (let i = 0; i < 8; i++) {
      t.step(1);
      t.update(0.3);
      expect(Math.abs(t.shown - prev) <= 45 || Math.abs(Math.abs(t.shown - prev) - 360) <= 45).toBe(true);
      expect(t.shown).toBeGreaterThanOrEqual(-180);
      expect(t.shown).toBeLessThanOrEqual(180);
      prev = t.shown;
    }
    expect(Math.abs(t.shown)).toBe(0);
  });

  it('X eases to north the short way', () => {
    const a = new CamTurn();
    a.set(170);
    a.north();
    a.update(0.1);
    expect(a.shown).toBeGreaterThan(0);
    expect(a.shown).toBeLessThan(170);
    const b = new CamTurn();
    b.set(-135);
    b.north();
    b.update(0.1);
    expect(b.shown).toBeGreaterThan(-135);
    expect(b.shown).toBeLessThan(0);
    const c = new CamTurn();
    for (let i = 0; i < 8; i++) c.step(1);
    c.north();
    c.update(0.1);
    expect(Math.abs(c.shown)).toBeLessThan(1e-9);
    c.update(0.3);
    expect(Math.abs(c.shown)).toBe(0);
  });

  it('X from 190 degrees (unwrapped past 180) goes to north via 180, not back through 360', () => {
    const t = new CamTurn();
    t.set(-170);
    t.north();
    t.update(0.1);
    expect(t.shown).toBeGreaterThan(-170);
    expect(t.shown).toBeLessThan(0);
  });

  it('a drag follows the mouse and snaps to the nearest step', () => {
    const t = new CamTurn();
    t.dragStart();
    expect(t.dragging).toBe(true);
    t.drag(100);
    expect(t.shown).toBe(100 * DRAG_DEG_PER_PX);
    t.update(0.3);
    expect(t.shown).toBe(100 * DRAG_DEG_PER_PX); // no ease while dragging
    t.dragEnd();
    expect(t.dragging).toBe(false);
    t.update(0.3);
    expect(t.shown % 45).toBe(0);
    expect(Math.abs(t.shown - 100 * DRAG_DEG_PER_PX)).toBeLessThanOrEqual(22.5);
  });

  it('a drag across 180 snaps the short way', () => {
    const t = new CamTurn();
    t.set(170);
    t.dragStart();
    t.drag(20 / DRAG_DEG_PER_PX); // 190 = -170
    expect(t.shown).toBeCloseTo(-170, 9);
    t.dragEnd();
    t.update(0.3);
    expect(Math.abs(t.shown)).toBe(180);
  });

  it('set jumps without an ease', () => {
    const t = new CamTurn(30);
    expect(t.shown).toBe(30);
    t.set(-90);
    expect(t.shown).toBe(-90);
    t.update(0.1);
    expect(t.shown).toBe(-90);
  });
});
