// Status-effect symbols as data: one 16x16 body per symbol, drawn as an SVG string.
// Used by the HTML HUD (inline) and, as textures, by the hero name tags on the board.
import { EFFECT } from '../generated/defs';

export type IconMode = 'fill' | 'line';
export interface IconDef { body: string; mode: IconMode; weak: boolean; color: string }

const FLAME = '<path d="M8 1c1 3 4.5 4.5 4.5 8.6A4.5 4.5 0 0 1 3.5 9.6C3.5 7 5.2 6 5.8 3.8c.9 1.2 1.2 2.4 1.2 3.4C8.2 5.8 8.4 3.6 8 1z"/>';
const DROP = '<path d="M8 1.5S3 7.4 3 10.4a5 5 0 0 0 10 0C13 7.4 8 1.5 8 1.5z"/>';
const FROST = '<path d="M8 1v14M1.9 4.5l12.2 7M1.9 11.5l12.2-7M6 2.2 8 4l2-1.8M6 13.8 8 12l2 1.8"/>';
const MOON = '<path d="M10.5 1.5a6.5 6.5 0 1 0 4 11.2A5.3 5.3 0 0 1 10.5 1.5z"/>';
const BLIND = '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM2.5 13.5l11-11"/>';
const STONE = '<path d="M3 13.5 1.6 8.2 4.6 3l6-1.2 3.6 4-1 6.4-5.4 2.2z"/><path d="m6 6 2.2 2.4-1 3" fill="none" stroke="#140c12" stroke-width="1.1"/>';
const HOURGLASS = '<path d="M3.5 1h9v2.2c0 2.2-2.2 3.6-3.2 4.8 1 1.2 3.2 2.6 3.2 4.8V15h-9v-2.2c0-2.2 2.2-3.6 3.2-4.8-1-1.2-3.2-2.6-3.2-4.8z"/>';
const HASTE = '<path d="m2.5 3 5 5-5 5M8.5 3l5 5-5 5"/>';
const VINE = '<path d="M2 14.5C5.5 11 3.5 7 7.5 5.5S11.5 2 14 1.5M4.6 9.6C3 8.6 1.8 9.2 1.8 9.2M8.4 5.2c-.3-1.8.6-3.4.6-3.4M10.6 8.2c1.6-.4 3 .4 3 .4"/>';
const SKULL = '<path d="M8 1.2A5.8 5.8 0 0 0 2.2 7c0 2.1 1 3.4 2.1 4.1V14h7.4v-2.9c1.1-.7 2.1-2 2.1-4.1A5.8 5.8 0 0 0 8 1.2z"/><circle cx="5.6" cy="7.4" r="1.5" fill="#140c12"/><circle cx="10.4" cy="7.4" r="1.5" fill="#140c12"/><path d="M7 14v-2M9 14v-2" stroke="#140c12" stroke-width="1"/>';
const SHIELD = '<path d="M8 1 14 3.4V8c0 3.6-3 6.1-6 7-3-.9-6-3.4-6-7V3.4z"/>';
const BLADE = '<path d="M2.5 13.5 11.5 4.5M9.5 2.5l4 4M3.8 9.8l2.4 2.4"/>';

const def = (body: string, mode: IconMode, color: string, weak = false): IconDef => ({ body, mode, weak, color });

export const EFFECT_ICON: Record<number, IconDef> = {
  [EFFECT.Burning]: def(FLAME, 'fill', '#ff8a30'),
  [EFFECT.Singed]: def(FLAME, 'fill', '#ff8a30', true),
  [EFFECT.Frozen]: def(FROST, 'line', '#8cc8ff'),
  [EFFECT.Chilled]: def(FROST, 'line', '#8cc8ff', true),
  [EFFECT.Poisoned]: def(DROP, 'fill', '#6ad04a'),
  [EFFECT.Tainted]: def(DROP, 'fill', '#6ad04a', true),
  [EFFECT.Sleep]: def(MOON, 'fill', '#c8b8ff'),
  [EFFECT.Blind]: def(BLIND, 'line', '#d8d0d0'),
  [EFFECT.Petrified]: def(STONE, 'fill', '#b8a890'),
  [EFFECT.Slowed]: def(HOURGLASS, 'fill', '#d8b060'),
  [EFFECT.Entangled]: def(VINE, 'line', '#70b040'),
  [EFFECT.Fear]: def(SKULL, 'fill', '#d8c0ff'),
  [EFFECT.Accelerated]: def(HASTE, 'line', '#70e080'),
  [EFFECT.Warded]: def(SHIELD, 'fill', '#e8c040'),
  [EFFECT.Coated]: def(BLADE, 'line', '#a0e070'),
};

/** The symbol as a standalone `<svg>` string of `px` x `px`. */
export function effectIconSvg(id: number, px: number): string {
  const d = EFFECT_ICON[id];
  let paint: string;
  if (d.mode === 'fill') {
    paint = d.weak ? `fill="none" stroke="${d.color}" stroke-width="1.4"` : `fill="${d.color}"`;
  } else {
    const w = d.weak ? '1.2' : '2';
    paint = `fill="none" stroke="${d.color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${d.weak ? ' opacity="0.85"' : ''}`;
  }
  return `<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${px}" height="${px}" ${paint}>${d.body}</svg>`;
}

export function effectIconDataUri(id: number, px: number): string {
  return 'data:image/svg+xml;base64,' + btoa(effectIconSvg(id, px));
}

export const iconTextureKey = (id: number) => `fx-icon-${id}`;
