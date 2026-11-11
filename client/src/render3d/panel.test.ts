// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createPanel } from './panel';
import { DEFAULTS, type R3dParams } from './params';

function setup(p: R3dParams = DEFAULTS, mode: 'demo' | 'run' = 'demo') {
  const host = document.createElement('div');
  const calls: R3dParams[] = [];
  const panel = createPanel(host, p, (n) => calls.push(n), { mode });
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

  it('the debug button calls onLose, has no aria-pressed and is disabled when it returns false', () => {
    const host = document.createElement('div');
    let ok = true;
    let n = 0;
    createPanel(host, DEFAULTS, () => {}, { mode: 'demo', onLose: () => { n++; return ok; } });
    const b = [...host.querySelectorAll('button')].find((x) => x.textContent === 'Lose device (debug)')!;
    expect(b.hasAttribute('aria-pressed')).toBe(false);
    b.click();
    expect(n).toBe(1);
    expect(b.disabled).toBe(false);
    ok = false;
    b.click();
    expect(b.disabled).toBe(true);
    // without the callback there is no button
    const plain = document.createElement('div');
    createPanel(plain, DEFAULTS, () => {}, { mode: 'demo' });
    expect(plain.textContent).not.toContain('Lose device');
  });

  it('run mode has Free camera and Lantern, no Moving light; demo mode the reverse', () => {
    const run = setup(DEFAULTS, 'run');
    expect(run.btn('Free camera')).toBeTruthy();
    expect(run.btn('Lantern')).toBeTruthy();
    expect(run.btn('Moving light')).toBeUndefined();
    expect(run.host.querySelector('.r3d-panel')!.classList.contains('run')).toBe(true);
    run.btn('Free camera').click();
    expect(run.calls[0].free).toBe(true);
    expect(run.btn('Free camera').getAttribute('aria-pressed')).toBe('true');
    run.btn('Lantern').click();
    expect(run.calls[1].light).toBe('lantern');
    const demo = setup();
    expect(demo.btn('Moving light')).toBeTruthy();
    expect(demo.btn('Free camera')).toBeUndefined();
    expect(demo.btn('Lantern')).toBeUndefined();
  });

  it('the zoom row sets zoom or Auto (null)', () => {
    const { calls, btn } = setup({ ...DEFAULTS, zoom: 3 });
    expect(btn('3').getAttribute('aria-pressed')).toBe('true');
    btn('1').click();
    expect(calls[0].zoom).toBe(1);
    btn('Auto').click();
    expect(calls[1].zoom).toBeNull();
    expect(btn('Auto').getAttribute('aria-pressed')).toBe('true');
  });

  it('destroy removes the root from the host', () => {
    const { host, panel } = setup();
    expect(host.querySelector('.r3d-panel')).not.toBeNull();
    panel.destroy();
    expect(host.querySelector('.r3d-panel')).toBeNull();
  });

  it('Hide collapses the panel to the toggle button, Show opens it again', () => {
    const { host, calls, btn } = setup();
    const body = host.querySelector<HTMLElement>('.r3d-body')!;
    const toggle = btn('Hide');
    expect(toggle.hasAttribute('aria-pressed')).toBe(false);
    expect(body.hidden).toBe(false);
    toggle.click();
    expect(body.hidden).toBe(true);
    expect(toggle.textContent).toBe('Show');
    expect(host.querySelector('.r3d-panel')!.classList.contains('collapsed')).toBe(true);
    toggle.click();
    expect(body.hidden).toBe(false);
    expect(toggle.textContent).toBe('Hide');
    expect(calls).toEqual([]); // not a param
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
