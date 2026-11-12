// The DOM panel of the ?r3d page: the single place that renders the params.

import { wrapYaw, type R3dParams } from './params';
import type { Quality } from './quality';
import type { SeeMode } from './seeThrough';

export interface Panel {
  setReadout(text: string): void;
  setParams(p: R3dParams): void;
}

const PITCHES = [30, 45, 48.6];
const QUALITIES: [Quality, string][] = [['high', 'High'], ['balanced', 'Balanced'], ['fast', 'Fast']];
const ZOOMS = [1, 2, 3, 4];
const SEE_MODES: [SeeMode, string][] = [['soft', 'Soft'], ['lattice', 'Lattice'], ['off', 'Off']];
const SEE_SLIDERS: { key: 'seeR' | 'seeKeep' | 'seeEdge'; name: string; min: number; max: number; step: number }[] = [
  { key: 'seeR', name: 'Radius', min: 0.5, max: 3, step: 0.1 },
  { key: 'seeKeep', name: 'Keep', min: 0, max: 1, step: 0.05 },
  { key: 'seeEdge', name: 'Edge', min: 0, max: 1, step: 0.05 },
];
type Switch = { name: string; get: (p: R3dParams) => boolean; set: (p: R3dParams) => Partial<R3dParams> };
const flag = (k: keyof Pick<R3dParams, 'shadows' | 'orb' | 'smooth' | 'free'>, name: string): Switch =>
  ({ name, get: (p) => p[k], set: (p) => ({ [k]: !p[k] }) });
const LANTERN: Switch = {
  name: 'Lantern', get: (p) => p.light === 'lantern', set: (p) => ({ light: p.light === 'lantern' ? 'work' : 'lantern' }),
};
const SWITCHES: Record<'demo' | 'run', Switch[]> = {
  demo: [flag('shadows', 'Wall shadows'), flag('orb', 'Moving light'), flag('smooth', 'Smoothed ground')],
  run: [flag('shadows', 'Wall shadows'), flag('smooth', 'Smoothed ground'), LANTERN, flag('free', 'Free camera')],
};

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

/**
 * `mode` 'run' is the panel inside a run (bottom left, with Lantern and Free camera instead of Moving light).
 * `onLose` (debug): makes the device fail on purpose and returns false when the backend cannot, which disables the button.
 */
export function createPanel(
  host: HTMLElement, p: R3dParams, onChange: (p: R3dParams) => void,
  opts: { mode: 'demo' | 'run'; onLose?: () => boolean },
): Panel & { destroy(): void } {
  const { mode, onLose } = opts;
  let cur = p;
  const root = el('div', mode === 'run' ? 'r3d-panel run' : 'r3d-panel');
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
  const zRow = el('div', 'r3d-row');
  zRow.appendChild(el('span', undefined, 'Zoom'));
  button(zRow, 'Auto', () => cur.zoom === null, () => change({ zoom: null }));
  for (const z of ZOOMS) button(zRow, String(z), () => cur.zoom === z, () => change({ zoom: z }));
  const swRow = el('div', 'r3d-row');
  for (const sw of SWITCHES[mode]) button(swRow, sw.name, () => sw.get(cur), () => change(sw.set(cur)));

  // See through: the mode and the look's three sliders.
  const seeRow = el('div', 'r3d-row');
  seeRow.appendChild(el('span', undefined, 'See through'));
  for (const [m, name] of SEE_MODES) button(seeRow, name, () => cur.see === m, () => change({ see: m }));
  const seeSliders = SEE_SLIDERS.map((d) => {
    const row = el('div', 'r3d-row');
    const label = el('label');
    const s = slider(d.min, d.max, d.step, () => cur[d.key], (v) => change({ [d.key]: v }));
    s.input.id = `r3d-${d.key}`;
    label.htmlFor = s.input.id;
    row.append(label, s.input);
    return { d, label, s, row };
  });

  const readout = el('div', 'r3d-readout');
  const body = el('div', 'r3d-body');
  body.append(pitchRow, yawRow, qRow, zRow, swRow, seeRow, ...seeSliders.map((x) => x.row));
  if (onLose) {
    const row = el('div', 'r3d-row');
    button(row, 'Lose device (debug)', null, () => {
      if (!onLose()) row.querySelector('button')!.disabled = true;
    });
    body.appendChild(row);
  }
  body.appendChild(readout);

  // Hide / Show collapses the panel to this button alone (an action button: no aria-pressed, not a URL parameter).
  const toggle = el('button', 'r3d-toggle', 'Hide');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'true');
  toggle.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    root.classList.toggle('collapsed', !open);
    toggle.textContent = open ? 'Hide' : 'Show';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.blur();
  });
  root.append(body, toggle);
  host.appendChild(root);

  function refresh(): void {
    pitchLabel.textContent = `Camera pitch ${deg(cur.pitch)}`;
    yawLabel.textContent = `Camera turn ${deg(cur.yaw)}`;
    pitch.sync();
    yaw.sync();
    for (const { d, label, s } of seeSliders) {
      label.textContent = `${d.name} ${Math.round(cur[d.key] * 100) / 100}`;
      s.sync();
    }
    for (const { btn, test } of pressed) btn.setAttribute('aria-pressed', String(test()));
  }
  refresh();

  return {
    destroy() {
      root.remove();
    },
    setReadout(text) {
      if (readout.textContent !== text) readout.textContent = text;
    },
    setParams(next) {
      cur = next;
      refresh();
    },
  };
}
