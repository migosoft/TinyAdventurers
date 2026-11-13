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
    expect(run.btn('Game light')).toBeTruthy();
    expect(run.btn('Moving light')).toBeUndefined();
    expect(run.host.querySelector('.r3d-panel')!.classList.contains('run')).toBe(true);
    run.btn('Free camera').click();
    expect(run.calls[0].free).toBe(true);
    expect(run.btn('Free camera').getAttribute('aria-pressed')).toBe('true');
    run.btn('Game light').click();
    expect(run.calls[1].light).toBe('work');
    const demo = setup();
    expect(demo.btn('Moving light')).toBeTruthy();
    expect(demo.btn('Free camera')).toBeUndefined();
    expect(demo.btn('Game light')).toBeUndefined();
  });

  it('the light sliders set amb, lcap and ccap; dv only on the demo page', () => {
    const { host, calls } = setup(DEFAULTS, 'run');
    const slide = (id: string, v: string): void => {
      const i = host.querySelector<HTMLInputElement>(`#r3d-${id}`)!;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    };
    slide('amb', '0.5');
    expect(calls[0].amb).toBe(0.5);
    slide('lcap', '8');
    expect(calls[1].lcap).toBe(8);
    slide('ccap', '4');
    expect(calls[2].ccap).toBe(4);
    expect(host.querySelector('#r3d-dv')).toBeNull();
    const demo = setup(DEFAULTS, 'demo');
    const dv = demo.host.querySelector<HTMLInputElement>('#r3d-dv')!;
    dv.value = '50';
    dv.dispatchEvent(new Event('input'));
    expect(demo.calls[0].dv).toBe(50);
  });

  it('the See through row has Soft / Lattice / Off and three sliders, in both modes', () => {
    for (const mode of ['demo', 'run'] as const) {
      const { host, calls, btn } = setup(DEFAULTS, mode);
      expect(host.textContent).toContain('See through');
      expect(btn('Soft').getAttribute('aria-pressed')).toBe('true');
      btn('Lattice').click();
      expect(calls[0].see).toBe('lattice');
      expect(btn('Lattice').getAttribute('aria-pressed')).toBe('true');
      expect(btn('Soft').getAttribute('aria-pressed')).toBe('false');
      btn('Off').click();
      expect(calls[1].see).toBe('off');
      const r = host.querySelector<HTMLInputElement>('#r3d-seeR')!;
      expect(r.min).toBe('0.5');
      expect(r.max).toBe('3');
      r.value = '2';
      r.dispatchEvent(new Event('input'));
      expect(calls[2].seeR).toBe(2);
      expect(host.textContent).toContain('Radius 2');
      for (const id of ['seeKeep', 'seeEdge']) expect(host.querySelector(`#r3d-${id}`)).not.toBeNull();
    }
  });

  it('has a Sight switch in both modes; the mist sliders only on daylight, Mist day on the demo page only', () => {
    for (const mode of ['demo', 'run'] as const) {
      const { host, calls, btn, panel } = setup(DEFAULTS, mode);
      expect(btn('Sight').getAttribute('aria-pressed')).toBe('true');
      btn('Sight').click();
      expect(calls[0].sight).toBe(false);
      expect(btn('Sight').getAttribute('aria-pressed')).toBe('false');
      const row = (id: string) => host.querySelector<HTMLInputElement>(`#r3d-${id}`)!.parentElement!;
      for (const id of ['mistHigh', 'mistTop', 'mistDrift']) expect(row(id).hidden).toBe(true);
      panel.setDaylight(true);
      for (const id of ['mistHigh', 'mistTop', 'mistDrift']) expect(row(id).hidden).toBe(false);
      const h = host.querySelector<HTMLInputElement>('#r3d-mistHigh')!;
      expect([h.min, h.max, h.step]).toEqual(['0.5', '6', '0.1']);
      h.value = '4';
      h.dispatchEvent(new Event('input'));
      expect(calls[1].mistHigh).toBe(4);
      expect(host.textContent).toContain('Mist height 4');
      if (mode === 'demo') expect(row('mistDay').hidden).toBe(false);
      else expect(host.querySelector('#r3d-mistDay')).toBeNull();
      panel.setDaylight(false);
      expect(row('mistHigh').hidden).toBe(true);
    }
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
