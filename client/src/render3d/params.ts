// URL parameters of the ?r3d page.

import type { Quality } from './quality';
import { MIST } from './mist';
import { SEE_DEFAULTS, type SeeMode } from './seeThrough';

export interface R3dParams {
  pitch: number; yaw: number; // degrees
  quality: Quality;
  zoom: number | null;
  backend: 'auto' | 'webgl';
  shadows: boolean; orb: boolean; smooth: boolean; stats: boolean;
  /** A free camera instead of following the party (a run). */
  free: boolean;
  /** The light a run shows: the game's own lights, or the flat work light. */
  light: 'game' | 'work';
  /** How the dark looks: the game's hard-edged shape (default), or a soft fade. */
  dark: 'fade' | 'shape';
  /** The dungeon's ambient light, 0..1 of the demo's AMBIENT. */
  amb: number;
  /** Caps on the point lights and on the shadow casters, 0..16. */
  lcap: number; ccap: number;
  /** The dev scenes' darkvision override, 0..100; null = none. */
  dv: number | null;
  /** Walls opening around things behind them (#303): the mode and the look's radius (tiles), keep and edge (0..1). */
  see: SeeMode; seeR: number; seeKeep: number; seeEdge: number;
  /** Sight (#305): hiding what the hero cannot see; the mist's height (tiles), top and drift (shares) and the day share (dev). */
  sight: boolean; mistHigh: number; mistTop: number; mistDrift: number; mistDay: number;
  /** The sky (#306): the hour of day, 0..24 (null = the run's own); game hours per 720 real seconds times `hourRate` (0 stops time); the wind and the clouds on or off. */
  hour: number | null; hourRate: number; wind: boolean; clouds: boolean;
}

/** The hour the sky pages start at (and the panel's slider shows) when the URL gives none. */
export const DEFAULT_HOUR = 9.5;

export const DEFAULTS: R3dParams = {
  // The user's picks after the hardware check (#301): 48.6° (a tile is 12 whole screen rows) and the smoothed ground on.
  pitch: 48.6, yaw: 0, quality: 'balanced', zoom: null, backend: 'auto',
  shadows: true, orb: true, smooth: true, stats: false,
  free: false, light: 'game', dark: 'shape', amb: 0, lcap: 16, ccap: 16, dv: null,
  see: SEE_DEFAULTS.mode, seeR: SEE_DEFAULTS.radius, seeKeep: SEE_DEFAULTS.keep, seeEdge: SEE_DEFAULTS.edge,
  sight: true, mistHigh: MIST.high, mistTop: MIST.top, mistDrift: MIST.drift, mistDay: 1,
  hour: null, hourRate: 1, wind: true, clouds: true,
};

/** A value clamped to min..max; a missing or unreadable one gives `dflt`. */
function range(v: number | null, min: number, max: number, dflt: number): number {
  return v === null ? dflt : Math.min(max, Math.max(min, v));
}

function num(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The steepest camera pitch (degrees) the URL accepts. */
export const PITCH_MAX = 80;

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
  const see = q.get('see');
  const lcap = num(q.get('lcap'));
  const ccap = num(q.get('ccap'));
  const dv = num(q.get('dv'));
  const hour = num(q.get('hour'));
  return {
    pitch: pitch === null ? DEFAULTS.pitch : Math.min(PITCH_MAX, Math.max(30, pitch)),
    yaw: yaw === null ? DEFAULTS.yaw : wrapYaw(yaw),
    quality: quality === 'high' || quality === 'balanced' || quality === 'fast' ? quality : DEFAULTS.quality,
    zoom: zoom !== null && Number.isInteger(zoom) ? Math.min(8, Math.max(1, zoom)) : null,
    backend: q.get('backend') === 'webgl' ? 'webgl' : 'auto',
    shadows: q.get('shadows') === '0' ? false : DEFAULTS.shadows,
    orb: q.get('orb') === '0' ? false : DEFAULTS.orb,
    smooth: q.get('smooth') === '0' ? false : q.get('smooth') === '1' ? true : DEFAULTS.smooth,
    stats: q.get('stats') === '1',
    free: q.get('free') === '1',
    light: q.get('light') === 'work' ? 'work' : 'game',
    dark: q.get('dark') === 'fade' ? 'fade' : 'shape',
    amb: range(num(q.get('amb')), 0, 1, DEFAULTS.amb),
    lcap: lcap !== null && Number.isInteger(lcap) ? range(lcap, 0, 16, DEFAULTS.lcap) : DEFAULTS.lcap,
    ccap: ccap !== null && Number.isInteger(ccap) ? range(ccap, 0, 16, DEFAULTS.ccap) : DEFAULTS.ccap,
    dv: dv === null ? null : range(dv, 0, 100, 0),
    see: see === 'lattice' || see === 'off' ? see : DEFAULTS.see,
    seeR: range(num(q.get('seeR')), 0.5, 3, DEFAULTS.seeR),
    seeKeep: range(num(q.get('seeKeep')), 0, 1, DEFAULTS.seeKeep),
    seeEdge: range(num(q.get('seeEdge')), 0.01, 1, DEFAULTS.seeEdge),
    sight: q.get('sight') === '0' ? false : DEFAULTS.sight,
    mistHigh: range(num(q.get('mistHigh')), 0.5, 6, DEFAULTS.mistHigh),
    mistTop: range(num(q.get('mistTop')), 0, 1, DEFAULTS.mistTop),
    mistDrift: range(num(q.get('mistDrift')), 0, 1, DEFAULTS.mistDrift),
    mistDay: range(num(q.get('mistDay')), 0, 1, DEFAULTS.mistDay),
    hour: hour === null ? null : range(hour, 0, 24, 0),
    hourRate: range(num(q.get('hourRate')), 0, 100, DEFAULTS.hourRate),
    wind: q.get('wind') === '0' ? false : DEFAULTS.wind,
    clouds: q.get('clouds') === '0' ? false : DEFAULTS.clouds,
  };
}

const OWN_KEYS = new Set(['pitch', 'yaw', 'quality', 'zoom', 'backend', 'shadows', 'orb', 'smooth', 'stats', 'free', 'light', 'dark', 'amb', 'lcap', 'ccap', 'dv', 'see', 'seeR', 'seeKeep', 'seeEdge', 'sight', 'mistHigh', 'mistTop', 'mistDrift', 'mistDay', 'hour', 'hourRate', 'wind', 'clouds']);

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
  if (p.dark !== DEFAULTS.dark) s += `&dark=${p.dark}`;
  if (p.amb !== DEFAULTS.amb) s += `&amb=${p.amb}`;
  if (p.lcap !== DEFAULTS.lcap) s += `&lcap=${p.lcap}`;
  if (p.ccap !== DEFAULTS.ccap) s += `&ccap=${p.ccap}`;
  if (p.dv !== null) s += `&dv=${p.dv}`;
  if (p.see !== DEFAULTS.see) s += `&see=${p.see}`;
  if (p.seeR !== DEFAULTS.seeR) s += `&seeR=${p.seeR}`;
  if (p.seeKeep !== DEFAULTS.seeKeep) s += `&seeKeep=${p.seeKeep}`;
  if (p.seeEdge !== DEFAULTS.seeEdge) s += `&seeEdge=${p.seeEdge}`;
  if (p.sight !== DEFAULTS.sight) s += '&sight=0';
  if (p.mistHigh !== DEFAULTS.mistHigh) s += `&mistHigh=${p.mistHigh}`;
  if (p.mistTop !== DEFAULTS.mistTop) s += `&mistTop=${p.mistTop}`;
  if (p.mistDrift !== DEFAULTS.mistDrift) s += `&mistDrift=${p.mistDrift}`;
  if (p.mistDay !== DEFAULTS.mistDay) s += `&mistDay=${p.mistDay}`;
  if (p.hour !== null) s += `&hour=${p.hour}`;
  if (p.hourRate !== DEFAULTS.hourRate) s += `&hourRate=${p.hourRate}`;
  if (p.wind !== DEFAULTS.wind) s += '&wind=0';
  if (p.clouds !== DEFAULTS.clouds) s += '&clouds=0';
  return s;
}
