// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { SettingsView, type Choice, type Toggle } from './settings';

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
  describe('choices', () => {
    function withChoice() {
      let cur = 'balanced';
      const set = vi.fn((v: string) => { cur = v; });
      const choice: Choice = {
        label: 'Quality',
        options: [['high', 'High'], ['balanced', 'Balanced'], ['fast', 'Fast']],
        get: () => cur,
        set,
      };
      const view = new SettingsView([], () => {}, [choice]);
      document.body.append(view.root);
      return { view, set, setCur: (v: string) => { cur = v; } };
    }
    it('lists the radios in order with the current one checked', () => {
      const { view } = withChoice();
      const radios = [...view.root.querySelectorAll<HTMLInputElement>('.choice input[type=radio]')];
      expect(radios.map((r) => r.value)).toEqual(['high', 'balanced', 'fast']);
      expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
      expect(radios[0].name).toBe('choice-quality');
      expect([...view.root.querySelectorAll('.choice label.radio span')].map((e) => e.textContent)).toEqual(['High', 'Balanced', 'Fast']);
    });
    it('calls set when a radio is clicked', () => {
      const { view, set } = withChoice();
      view.root.querySelectorAll<HTMLInputElement>('.choice input')[2].click();
      expect(set).toHaveBeenCalledWith('fast');
    });
    it('sync checks the new option on the same element', () => {
      const { view, setCur } = withChoice();
      const high = view.root.querySelectorAll<HTMLInputElement>('.choice input')[0];
      setCur('high');
      view.sync();
      expect(high.checked).toBe(true);
      expect(view.root.querySelectorAll('.choice input')[0]).toBe(high);
    });
    it('has no .choice without choices', () => {
      const { view } = make();
      expect(view.root.querySelector('.choice')).toBeNull();
      expect(view.root.querySelectorAll('input[type=checkbox]').length).toBe(3);
    });
  });
});
