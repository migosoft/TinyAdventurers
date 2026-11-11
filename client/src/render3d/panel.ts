// The DOM panel of the ?r3d page: the single place that renders the params.

import { wrapYaw, type R3dParams } from './params';
import type { Quality } from './quality';

export interface Panel {
  setReadout(text: string): void;
  setParams(p: R3dParams): void;
}

const PITCHES = [30, 45, 48.6];
const QUALITIES: [Quality, string][] = [['high', 'High'], ['balanced', 'Balanced'], ['fast', 'Fast']];
const SWITCHES: [keyof Pick<R3dParams, 'shadows' | 'orb' | 'smooth'>, string][] = [
  ['shadows', 'Wall shadows'], ['orb', 'Moving light'], ['smooth', 'Smoothed ground'],
];

/** A degree value with at most one decimal and no trailing .0. */
function deg(v: number): string {
  return `${Math.round(v * 10) / 10}°`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function createPanel(host: HTMLElement, p: R3dParams, onChange: (p: R3dParams) => void): Panel {
  let cur = p;
  const root = el('div', 'r3d-panel');
  const pressed: { btn: HTMLButtonElement; test: () => boolean }[] = [];

  // test = null: an action button, not a toggle, so it carries no aria-pressed.
  const button = (parent: HTMLElement, text: string, test: (() => boolean) | null, act: () => void): void => {
    const btn = el('button', undefined, text);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      act();
      btn.blur();
    });
    if (test) pressed.push({ btn, test });
    parent.appendChild(btn);
  };
  const change = (next: Partial<R3dParams>): void => {
    cur = { ...cur, ...next };
    refresh();
    onChange(cur);
  };

  const slider = (min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
    const input = el('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.addEventListener('input', () => set(Number(input.value)));
    // Blur only after the mouse lets go: a keyboard-focused slider keeps its arrow keys.
    input.addEventListener('pointerup', () => input.blur());
    input.addEventListener('pointercancel', () => input.blur());
    return { input, sync: () => { input.value = String(get()); } };
  };

  // Pitch.
  const pitchRow = el('div', 'r3d-row');
  const pitchLabel = el('label');
  const pitch = slider(30, 80, 0.1, () => cur.pitch, (v) => change({ pitch: v }));
  pitch.input.id = 'r3d-pitch';
  pitchLabel.htmlFor = 'r3d-pitch';
  pitchRow.append(pitchLabel, pitch.input);
  for (const v of PITCHES) button(pitchRow, deg(v), () => cur.pitch === v, () => change({ pitch: v }));

  // Turn.
  const yawRow = el('div', 'r3d-row');
  const yawLabel = el('label');
  const yaw = slider(-180, 180, 1, () => cur.yaw, (v) => change({ yaw: wrapYaw(v) }));
  yaw.input.id = 'r3d-yaw';
  yawLabel.htmlFor = 'r3d-yaw';
  yawRow.append(yawLabel, yaw.input);
  button(yawRow, '⟲ 45°', null, () => change({ yaw: wrapYaw(cur.yaw - 45) }));
  button(yawRow, '45° ⟳', null, () => change({ yaw: wrapYaw(cur.yaw + 45) }));
  button(yawRow, 'North', null, () => change({ yaw: 0 }));

  // Quality and switches.
  const qRow = el('div', 'r3d-row');
  qRow.appendChild(el('span', undefined, 'Quality'));
  for (const [q, name] of QUALITIES) button(qRow, name, () => cur.quality === q, () => change({ quality: q }));
  const swRow = el('div', 'r3d-row');
  for (const [k, name] of SWITCHES) button(swRow, name, () => cur[k], () => change({ [k]: !cur[k] }));

  const readout = el('div', 'r3d-readout');
  root.append(pitchRow, yawRow, qRow, swRow, readout);
  host.appendChild(root);

  function refresh(): void {
    pitchLabel.textContent = `Camera pitch ${deg(cur.pitch)}`;
    yawLabel.textContent = `Camera turn ${deg(cur.yaw)}`;
    pitch.sync();
    yaw.sync();
    for (const { btn, test } of pressed) btn.setAttribute('aria-pressed', String(test()));
  }
  refresh();

  return {
    setReadout(text) {
      if (readout.textContent !== text) readout.textContent = text;
    },
    setParams(next) {
      cur = next;
      refresh();
    },
  };
}
