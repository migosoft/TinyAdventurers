// The F3 readout of the ?r3d page. The layout mirrors `statsText` in `ui/hud.ts` (labels padded to 11, ms with two
// decimals, systems indented); it is not imported from there because render3d takes nothing from the game's UI.

/** The systems of one 3D frame, in the order the frame runs them and the readout lists them. */
export const R3D_SYSTEMS = ['sim', 'cards', 'lights', 'sight', 'sun', 'upload', 'scene', 'present', 'hud'] as const;
export type R3dSystem = (typeof R3D_SYSTEMS)[number];

export interface R3dStats {
  fps: number;
  /** Whole frame, ms. */
  frameMs: number;
  /** The render part of the frame, ms. */
  renderMs: number;
  systems: (readonly [string, number])[];
  drawCalls: number;
  /** The canvas in device px. */
  canvas: [number, number];
  /** The scene pass's size in px. */
  render: [number, number];
  zoom: number;
  quality: string;
  backend: string;
  /** Extra lines after the systems (the run's lights and shadow cards). */
  lines?: readonly string[];
}

/** The readout's two light lines (#304): lights in use of those that reach the screen, and the shadow cards, each with its cap. */
export function lightLines(list: number, inView: number, casters: number, lcap: number, ccap: number): string[] {
  return [`lights     ${list} of ${inView} (cap ${lcap})`, `shadows    ${casters} cards (cap ${ccap})`];
}

const UPDATE = new Set<string>(['sim', 'cards', 'lights', 'sight']);

export function statsText3d(s: R3dStats): string {
  const ms = (v: number) => `${v.toFixed(2)} ms`;
  const update = s.systems.reduce((a, [name, v]) => (UPDATE.has(name) ? a + v : a), 0);
  return (
    `FPS        ${s.fps.toFixed(0)}\n` +
    `frame      ${ms(s.frameMs)}\n` +
    `render     ${ms(s.renderMs)}\n` +
    `update     ${ms(update)}\n` +
    s.systems.map(([name, v]) => `  ${name.padEnd(9)}${v.toFixed(2)}\n`).join('') +
    (s.lines ?? []).map((l) => `${l}\n`).join('') +
    `draw calls ${s.drawCalls}\n` +
    `canvas     ${s.canvas[0]}x${s.canvas[1]}\n` +
    `render     ${s.render[0]}x${s.render[1]} (${s.quality})\n` +
    `zoom       ${s.zoom}\n` +
    `backend    ${s.backend}`
  );
}
