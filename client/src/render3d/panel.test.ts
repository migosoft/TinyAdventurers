// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createPanel } from './panel';
import { DEFAULTS, type R3dParams } from './params';

function setup(p: R3dParams = DEFAULTS) {
  const host = document.createElement('div');
  const calls: R3dParams[] = [];
  const panel = createPanel(host, p, (n) => calls.push(n));
  const btn = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text)!;
  return { host, calls, panel, btn };
}

describe('panel', () => {
  it('North sets yaw 0', () => {
    const { calls, btn } = setup({ ...DEFAULTS, yaw: 45 });
    btn('North').click();
    expect(calls[0].yaw).toBe(0);
  });

  it('45° ⟳ wraps at 180', () => {
    const { calls, btn } = setup({ ...DEFAULTS, yaw: 170 });
    btn('45° ⟳').click();
    expect(calls[0].yaw).toBe(-145);
  });

  it('⟲ 45° wraps at -180, keeps the other fields, action buttons have no aria-pressed', () => {
    const start = { ...DEFAULTS, yaw: -170, zoom: 5, quality: 'high' as const };
    const { calls, btn } = setup(start);
    btn('⟲ 45°').click();
    expect(calls[0]).toEqual({ ...start, yaw: 145 });
    for (const t of ['⟲ 45°', '45° ⟳', 'North']) expect(btn(t).hasAttribute('aria-pressed')).toBe(false);
  });

  it('the slider yaw 180 is wrapped to -180', () => {
    const { host, calls } = setup();
    const s = host.querySelector<HTMLInputElement>('#r3d-yaw')!;
    s.value = '180';
    s.dispatchEvent(new Event('input'));
    expect(calls[0].yaw).toBe(-180);
  });

  it('shows labels and pressed states', () => {
    const { host, btn, panel } = setup({ ...DEFAULTS, pitch: 48.6 });
    expect(host.textContent).toContain('Camera pitch 48.6°');
    expect(host.textContent).toContain('Camera turn 0°');
    expect(btn('48.6°').getAttribute('aria-pressed')).toBe('true');
    btn('30°').click();
    expect(btn('30°').getAttribute('aria-pressed')).toBe('true');
    expect(btn('48.6°').getAttribute('aria-pressed')).toBe('false');
    expect(host.textContent).toContain('Camera pitch 30°');
    panel.setParams({ ...DEFAULTS, quality: 'fast' });
    expect(btn('Fast').getAttribute('aria-pressed')).toBe('true');
    btn('Wall shadows').click();
    expect(btn('Wall shadows').getAttribute('aria-pressed')).toBe('false');
  });
});
