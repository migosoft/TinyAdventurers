// The F3 readout of the ?r3d page. The layout mirrors `statsText` in `ui/hud.ts` (labels padded to 11, ms with two
// decimals, systems indented); it is not imported from there because render3d takes nothing from the game's UI.

/** The systems of one 3D frame, in the order the frame runs them and the readout lists them. */
export const R3D_SYSTEMS = ['sim', 'cards', 'lights', 'upload', 'scene', 'present'] as const;
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
}

const UPDATE = new Set<string>(['sim', 'cards', 'lights']);

export function statsText3d(s: R3dStats): string {
  const ms = (v: number) => `${v.toFixed(2)} ms`;
  const update = s.systems.reduce((a, [name, v]) => (UPDATE.has(name) ? a + v : a), 0);
  return (
    `FPS        ${s.fps.toFixed(0)}\n` +
    `frame      ${ms(s.frameMs)}\n` +
    `render     ${ms(s.renderMs)}\n` +
    `update     ${ms(update)}\n` +
    s.systems.map(([name, v]) => `  ${name.padEnd(9)}${v.toFixed(2)}\n`).join('') +
    `draw calls ${s.drawCalls}\n` +
    `canvas     ${s.canvas[0]}x${s.canvas[1]}\n` +
    `render     ${s.render[0]}x${s.render[1]} (${s.quality})\n` +
    `zoom       ${s.zoom}\n` +
    `backend    ${s.backend}`
  );
}
