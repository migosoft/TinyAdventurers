// URL parameters of the ?r3d page.

import type { Quality } from './quality';

export interface R3dParams {
  pitch: number; yaw: number; // degrees
  quality: Quality;
  zoom: number | null;
  backend: 'auto' | 'webgl';
  shadows: boolean; orb: boolean; smooth: boolean; stats: boolean;
  /** A free camera instead of following the party (a run). */
  free: boolean;
  /** The light a run shows: the work light or the heroes' lantern. */
  light: 'work' | 'lantern';
}

export const DEFAULTS: R3dParams = {
  // The user's picks after the hardware check (#301): 48.6° (a tile is 12 whole screen rows) and the smoothed ground on.
  pitch: 48.6, yaw: 0, quality: 'balanced', zoom: null, backend: 'auto',
  shadows: true, orb: true, smooth: true, stats: false,
  free: false, light: 'work',
};

function num(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Wraps degrees into -180..180 the way the URL does. */
export function wrapYaw(yaw: number): number {
  // In-range values come back exactly as they are (37.3 stays 37.3); +180 maps to -180.
  if (Math.abs(yaw) <= 180) return yaw === 180 ? -180 : yaw;
  const w = ((((yaw + 180) % 360) + 360) % 360) - 180;
  return Number.isFinite(w) ? w : 0;
}

export function parseParams(search: string): R3dParams {
  const q = new URLSearchParams(search);
  const pitch = num(q.get('pitch'));
  const yaw = num(q.get('yaw'));
  const zoom = num(q.get('zoom'));
  const quality = q.get('quality');
  return {
    pitch: pitch === null ? DEFAULTS.pitch : Math.min(80, Math.max(30, pitch)),
    yaw: yaw === null ? DEFAULTS.yaw : wrapYaw(yaw),
    quality: quality === 'high' || quality === 'balanced' || quality === 'fast' ? quality : DEFAULTS.quality,
    zoom: zoom !== null && Number.isInteger(zoom) ? Math.min(8, Math.max(1, zoom)) : null,
    backend: q.get('backend') === 'webgl' ? 'webgl' : 'auto',
    shadows: q.get('shadows') === '0' ? false : DEFAULTS.shadows,
    orb: q.get('orb') === '0' ? false : DEFAULTS.orb,
    smooth: q.get('smooth') === '0' ? false : q.get('smooth') === '1' ? true : DEFAULTS.smooth,
    stats: q.get('stats') === '1',
    free: q.get('free') === '1',
    light: q.get('light') === 'lantern' ? 'lantern' : 'work',
  };
}

const OWN_KEYS = new Set(['pitch', 'yaw', 'quality', 'zoom', 'backend', 'shadows', 'orb', 'smooth', 'stats', 'free', 'light']);

/** The search string with this page's keys set or removed and every other key of `current` kept as it is (a key without a value stays without one). */
export function toSearch(p: R3dParams, current: string): string {
  const kept = current.replace(/^\?/, '').split('&').filter((tok) => tok !== '' && !OWN_KEYS.has(tok.split('=')[0]));
  let s = '?' + (kept.some((tok) => tok.split('=')[0] === 'r3d') ? '' : 'r3d&') + kept.join('&');
  if (s.endsWith('&')) s = s.slice(0, -1);
  if (p.pitch !== DEFAULTS.pitch) s += `&pitch=${p.pitch}`;
  if (p.yaw !== DEFAULTS.yaw) s += `&yaw=${p.yaw}`;
  if (p.quality !== DEFAULTS.quality) s += `&quality=${p.quality}`;
  if (p.zoom !== null) s += `&zoom=${p.zoom}`;
  if (p.backend !== DEFAULTS.backend) s += `&backend=${p.backend}`;
  if (p.shadows !== DEFAULTS.shadows) s += '&shadows=0';
  if (p.orb !== DEFAULTS.orb) s += '&orb=0';
  if (p.smooth !== DEFAULTS.smooth) s += `&smooth=${p.smooth ? 1 : 0}`;
  if (p.stats !== DEFAULTS.stats) s += '&stats=1';
  if (p.free !== DEFAULTS.free) s += '&free=1';
  if (p.light !== DEFAULTS.light) s += `&light=${p.light}`;
  return s;
}
