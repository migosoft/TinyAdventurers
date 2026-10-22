// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { SettingsView, type Toggle } from './settings';

function make() {
  const state = [false, false, false];
  const set = vi.fn();
  const toggles: Toggle[] = ['Rules log', 'Calculation lines', 'Network stats'].map((label, i) => ({
    label,
    key: ['L', 'Shift+L', 'F3'][i],
    get: () => state[i],
    set: (on) => set(i, on),
  }));
  const back = vi.fn();
  const view = new SettingsView(toggles, back);
  document.body.append(view.root);
  return { state, set, back, view };
}

describe('SettingsView', () => {
  it('lists the toggles in order with their keys', () => {
    const { view } = make();
    expect([...view.root.querySelectorAll('.check span')].map((e) => e.textContent)).toEqual(['Rules log', 'Calculation lines', 'Network stats']);
    expect([...view.root.querySelectorAll('.check kbd')].map((e) => e.textContent)).toEqual(['L', 'Shift+L', 'F3']);
  });
  it('calls set when a box is clicked', () => {
    const { view, set } = make();
    view.root.querySelectorAll<HTMLInputElement>('input')[1].click();
    expect(set).toHaveBeenCalledWith(1, true);
  });
  it('sync checks a box in place after an outside change', () => {
    const { view, state } = make();
    const box = view.root.querySelectorAll<HTMLInputElement>('input')[0];
    state[0] = true;
    view.sync();
    expect(box.checked).toBe(true);
    expect(view.root.querySelectorAll('input')[0]).toBe(box);
  });
  it('Back calls onBack', () => {
    const { view, back } = make();
    view.root.querySelector('button')!.click();
    expect(back).toHaveBeenCalled();
  });
});
