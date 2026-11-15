// The pack's weapons as 3D models (#338): each sprite of the 2D pack becomes a rounded piece (its outline smoothed, its colours
// flat, thick in the middle and thin at the rim), a bow becomes two round rods along a smooth line. The page that approved the
// looks is `weapons.html`; this is its `rounded`, `rodGeo` and `bowParts` on plain typed arrays (no canvas), so it runs in a
// Web Worker and under node. A weapon model has one bone (0), the stage `weapon` and its origin at the grip, in sprite pixels.

import { CatmullRomCurve3, Vector3 } from 'three/webgpu';
import { blur } from './grid';
import { hull } from './addons';
import { MAX_BONES, STAGES } from './bones';
import { splitIndex, type FigureModel, type ModelRange } from './model';
import { vertexNormals, type Mesh3 } from './part';

/** A bow made of rods: the limb and the string are smooth lines through points read off the sprite (x, y from its top left). */
export interface RodDesc {
  limb: [number, number][]; r: number; colour: number;
  /** The grip's rows, and its colour; the bands' rows (pairs) and their colour. */
  grip: [number, number]; gripColour: number; bands: [number, number][]; bandColour: number;
  string: [number, number][]; stringR: number; stringColour: number;
}

export interface WeaponDesc {
  /** The pack's sprite name. */
  sprite: string;
  /** Where the hand holds it: sprite pixels from the sprite's left edge and from its bottom edge. */
  grip: [number, number];
  /** How thick the piece swells (a blade is a thin lens, a shaft a rod). */
  deep: number;
  /** Its white is a bright steel edge (the pack's white counts as steel). */
  blade?: boolean;
  /** The largest half thickness, sprite pixels (default 1.9). */
  cap?: number;
  kind: 'melee' | 'bow' | 'cast';
  rod?: RodDesc;
  /** Redrawn rows of colour letters (`ART`) used in place of the sprite. */
  art?: string[];
}

/** One sprite's own pixels: RGBA, rows from the top. */
export interface SpritePixels { w: number; h: number; data: Uint8ClampedArray }

/** The Paladin's polished steel. */
export const STEEL = 0xdfe6ec;
const STEEL_FROM = new Set([0x72d6ce, 0xb6cbcf, 0x55a894]);   // the pack's steel
const ART: Record<string, number> = { s: 0x72d6ce, w: 0xfdf7ed, d: 0x8f4029, e: 0xc56025, v: 0x2b3a4c, k: 0x222222, t: 0x55a894 };
const FLAT = 75, WK = 6, OUTLINE = 0x222222;

// The grips are where the hand holds the weapon (the model's origin). From the approved figures page: the knight sword, hammer, great
// axe, big hammer, rapier (duel sword), red staff, bow and arrow. The rest are first guesses by kind (swords, katana, machete, knife
// and cleaver [w/2, 3]; axes, mace and club [w/2, 4]; the green staff and the spear [w/2, 11]; bow 2 like the bow), to be judged in the gallery.
export const WEAPONS: Record<string, WeaponDesc> = {
  weapon_knight_sword: { sprite: 'weapon_knight_sword', grip: [5, 3], deep: 0.32, blade: true, kind: 'melee' },
  weapon_regular_sword: { sprite: 'weapon_regular_sword', grip: [5, 3], deep: 0.32, blade: true, kind: 'melee' },
  weapon_rusty_sword: { sprite: 'weapon_rusty_sword', grip: [5, 3], deep: 0.32, blade: true, kind: 'melee' },
  weapon_red_gem_sword: { sprite: 'weapon_red_gem_sword', grip: [5, 3], deep: 0.32, blade: true, kind: 'melee' },
  weapon_golden_sword: { sprite: 'weapon_golden_sword', grip: [5, 3], deep: 0.32, blade: true, kind: 'melee' },
  weapon_lavish_sword: { sprite: 'weapon_lavish_sword', grip: [5, 3], deep: 0.32, blade: true, kind: 'melee' },
  weapon_anime_sword: { sprite: 'weapon_anime_sword', grip: [6, 3], deep: 0.32, blade: true, kind: 'melee' },
  weapon_duel_sword: { sprite: 'weapon_duel_sword', grip: [3, 6], deep: 0.32, blade: true, kind: 'melee' },
  weapon_katana: { sprite: 'weapon_katana', grip: [3, 3], deep: 0.32, blade: true, kind: 'melee' },
  weapon_saw_sword: { sprite: 'weapon_saw_sword', grip: [5, 3], deep: 0.32, blade: true, kind: 'melee' },
  weapon_machete: { sprite: 'weapon_machete', grip: [2.5, 3], deep: 0.32, blade: true, kind: 'melee' },
  weapon_cleaver: { sprite: 'weapon_cleaver', grip: [4.5, 3], deep: 0.4, blade: true, kind: 'melee' },
  weapon_knife: { sprite: 'weapon_knife', grip: [3, 3], deep: 0.32, blade: true, kind: 'melee' },
  weapon_double_axe: { sprite: 'weapon_double_axe', grip: [8, 4], deep: 0.4, blade: true, kind: 'melee' },
  weapon_waraxe: { sprite: 'weapon_waraxe', grip: [6, 4], deep: 0.4, blade: true, kind: 'melee' },
  weapon_axe: { sprite: 'weapon_axe', grip: [4.5, 4], deep: 0.4, blade: true, kind: 'melee' },
  weapon_throwing_axe: { sprite: 'weapon_throwing_axe', grip: [5, 4], deep: 0.4, blade: true, kind: 'melee' },
  weapon_hammer: { sprite: 'weapon_hammer', grip: [5, 4], deep: 0.7, blade: true, cap: 2.6, kind: 'melee' },
  weapon_big_hammer: { sprite: 'weapon_big_hammer', grip: [8, 6], deep: 0.7, blade: true, cap: 3.2, kind: 'melee', art: ['sssv........vsss', 'sssv...de...vsss', 'sssvsssdesssvsss', 'sssvsssdesssvsss', 'sssvsssdesssvsss', 'sssvsssdesssvsss', 'sssvsssdesssvsss', 'sssvsssdesssvsss', 'sssvsssdesssvsss', 'sssv...de...vsss', 'sssv...de...vsss', '.......de.......', '.......de.......', '.......de.......', '.......de.......', '.......de.......', '.......de.......', '.......de.......', '.......de.......', '.......de.......', '.......de.......', '.......de.......', '.......de.......', '.......de.......', '.......de.......', '.......de.......', '.......de.......', '.......de.......', '.......de.......', '.......de.......'] },
  weapon_mace: { sprite: 'weapon_mace', grip: [5, 4], deep: 0.7, blade: true, cap: 2.6, kind: 'melee' },
  weapon_baton_with_spikes: { sprite: 'weapon_baton_with_spikes', grip: [5, 4], deep: 0.7, blade: true, cap: 2.6, kind: 'melee' },
  weapon_spear: { sprite: 'weapon_spear', grip: [3, 11], deep: 0.45, blade: true, kind: 'melee' },
  weapon_red_magic_staff: { sprite: 'weapon_red_magic_staff', grip: [4, 11], deep: 0.7, kind: 'cast' },
  weapon_green_magic_staff: { sprite: 'weapon_green_magic_staff', grip: [4, 11], deep: 0.7, kind: 'cast' },
  weapon_bow: { sprite: 'weapon_bow', grip: [11.5, 13], deep: 0.6, kind: 'bow', rod: { limb: [[9, 1], [9.2, 2.5], [10.3, 4.3], [11.2, 6.5], [11.7, 8.2], [12.5, 10.3], [12.6, 13], [12.5, 15.7], [11.7, 17.8], [11.2, 19.5], [10.3, 21.7], [9.2, 23.5], [9, 25]], r: 0.8, colour: 0x8f4029, grip: [10.9, 15.1], gripColour: 0x9b1a0a, bands: [[5.2, 6.8], [8.3, 9.7], [16.3, 17.7], [19.2, 20.8]], bandColour: 0x550f0a, string: [[8.6, 3.2], [7.6, 13], [8.6, 22.8]], stringR: 0.3, stringColour: 0xd3bfa9 } },
  weapon_bow_2: { sprite: 'weapon_bow_2', grip: [11.5, 13], deep: 0.6, kind: 'bow', rod: { limb: [[9, 1], [9.2, 2.5], [10.3, 4.3], [11.2, 6.5], [11.7, 8.2], [12.5, 10.3], [12.6, 13], [12.5, 15.7], [11.7, 17.8], [11.2, 19.5], [10.3, 21.7], [9.2, 23.5], [9, 25]], r: 0.8, colour: 0x8f4029, grip: [10.9, 15.1], gripColour: 0x9b1a0a, bands: [[5.2, 6.8], [8.3, 9.7], [16.3, 17.7], [19.2, 20.8]], bandColour: 0x550f0a, string: [[8.6, 3.2], [0.7, 13], [8.6, 22.8]], stringR: 0.3, stringColour: 0xd3bfa9 } },
  weapon_arrow: { sprite: 'weapon_arrow', grip: [3.5, 1], deep: 0.6, kind: 'melee' },
};

/** The redrawn art as sprite pixels. */
function artPixels(rows: string[]): SpritePixels {
  const w = rows[0].length, h = rows.length, data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const k = ART[row[x]];
      if (k !== undefined) data.set([k >> 16, (k >> 8) & 255, k & 255, 255], (y * w + x) * 4);
    }
  });
  return { w, h, data };
}

const hex = (k: number): [number, number, number] => [(k >> 16) / 255, ((k >> 8) & 255) / 255, (k & 255) / 255];
const colourAt = (px: SpritePixels, x: number, y: number): number => { const i = (y * px.w + x) * 4; return (px.data[i] << 16) | (px.data[i + 1] << 8) | px.data[i + 2]; };
const wOn = (px: SpritePixels, x: number, y: number): boolean => x >= 0 && y >= 0 && x < px.w && y < px.h && px.data[(y * px.w + x) * 4 + 3] > 127;
/** A pixel of the weapon itself: the pack's own dark outline (dark pixels on the sprite's rim) is left out, the model gets its own. */
function wIn(px: SpritePixels, x: number, y: number): boolean {
  if (!wOn(px, x, y)) return false;
  const i = (y * px.w + x) * 4;
  if (px.data[i] > 60 || px.data[i + 1] > 60 || px.data[i + 2] > 60) return true;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!wOn(px, x + dx, y + dy)) return false;
  return true;
}

/** The sprite's colours as a few flat ones: the shades of one material all become the most common of them. */
function flatColours(W: WeaponDesc, px: SpritePixels): Map<number, number> {
  const count = new Map<number, number>(), heads: number[] = [], to = new Map<number, number>();
  for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) if (wIn(px, x, y)) { const k = colourAt(px, x, y); count.set(k, (count.get(k) || 0) + 1); }
  for (const k of [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!)) {
    if (STEEL_FROM.has(k) || (W.blade && k === 0xfdf7ed)) { to.set(k, STEEL); continue; }
    let best: number | null = null, bd = FLAT * FLAT;
    for (const hd of heads) {
      const d = ((k >> 16) - (hd >> 16)) ** 2 + (((k >> 8) & 255) - ((hd >> 8) & 255)) ** 2 + ((k & 255) - (hd & 255)) ** 2;
      if (d < bd) { bd = d; best = hd; }
    }
    if (best === null) { heads.push(k); best = k; }
    to.set(k, best);
  }
  return to;
}

/** A rounded piece: the mesh, its paint (a small picture) and which vertices lie on steel. */
interface Rounded { mesh: Mesh3; paint: { w: number; h: number; data: Uint8Array }; steel: Uint8Array }

/**
 * The sprite as a rounded piece: its outline is smoothed (no pixel steps), its colours are flat with rounded borders, and it
 * swells from nothing at the rim to its thickest in the middle. A vertex is steel when its paint texel (the cell its position
 * falls in; a rim vertex sits on the smoothed outline, so that is the cell just inside or outside it) is the steel colour.
 */
function rounded(W: WeaponDesc, px: SpritePixels): Rounded {
  const w = px.w, h = px.h, K = WK, gw = (w + 2) * K, gh = (h + 2) * K, n = gw * gh, to = flatColours(W, px);
  const f = new Float32Array(n), big = new Int32Array(n).fill(-1);
  for (let Y = 0; Y < gh; Y++) for (let X = 0; X < gw; X++) {
    const x = Math.floor(X / K) - 1, y = Math.floor(Y / K) - 1;
    if (!wIn(px, x, y)) continue;
    f[Y * gw + X] = 1; big[Y * gw + X] = to.get(colourAt(px, x, y))!;
  }
  blur(f, gw, gh, 4);
  const THR = 0.4, inside = new Uint8Array(n);
  for (let Y = 1; Y < gh - 1; Y++) for (let X = 1; X < gw - 1; X++) if (f[Y * gw + X] > THR) inside[Y * gw + X] = 1;
  // The paint: every flat colour spreads a little, the strongest wins; what is left takes its neighbour's colour.
  const best = new Float32Array(n), lab = new Int32Array(n).fill(-1);
  for (const k of new Set(to.values())) {
    const m = new Float32Array(n);
    for (let i = 0; i < n; i++) if (big[i] === k) m[i] = 1;
    blur(m, gw, gh, 3);
    for (let i = 0; i < n; i++) if (m[i] > best[i] && m[i] > 0.02) { best[i] = m[i]; lab[i] = k; }
  }
  for (let pass = 0; pass < 3 * K; pass++) {
    const src = lab.slice();
    for (let Y = 0; Y < gh; Y++) for (let X = 0; X < gw; X++) {
      const i = Y * gw + X;
      if (src[i] !== -1) continue;
      lab[i] = X > 0 && src[i - 1] !== -1 ? src[i - 1] : X < gw - 1 && src[i + 1] !== -1 ? src[i + 1] : Y > 0 && src[i - gw] !== -1 ? src[i - gw] : Y < gh - 1 && src[i + gw] !== -1 ? src[i + gw] : -1;
    }
  }
  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const k = lab[i] === -1 ? 0x222222 : lab[i];
    rgba.set([k >> 16, (k >> 8) & 255, k & 255, 255], i * 4);
  }
  // The thickness: a Poisson inflation (a disc becomes a ball), scaled by the weapon's `deep` and levelled off at a largest thickness.
  const u = new Float32Array(n), g4 = 4 / (K * K), cap = W.cap || 1.9;
  for (let it = 0; it < 160; it++) for (let Y = 1; Y < gh - 1; Y++) for (let X = 1; X < gw - 1; X++) {
    const i = Y * gw + X;
    if (inside[i]) u[i] += 1.9 * ((u[i - 1] + u[i + 1] + u[i - gw] + u[i + gw] + g4) / 4 - u[i]);
  }
  for (let i = 0; i < n; i++) u[i] = inside[i] ? cap * Math.tanh((W.deep || 0.6) * Math.sqrt(Math.max(0, u[i])) / cap) : 0;
  const cell = (a: ArrayLike<number>, X: number, Y: number): number => (X < 0 || Y < 0 || X >= gw || Y >= gh ? 0 : a[Y * gw + X]);
  // One point per corner of an inside cell, on the front and on the back; on the rim the two are the same point, moved onto
  // the smoothed outline so that the rim has no steps.
  const cw = gw + 1, front = new Int32Array(cw * (gh + 1)).fill(-1), back = new Int32Array(cw * (gh + 1)).fill(-1);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], steel: number[] = [];
  const corner = (X: number, Y: number): void => {
    const c = Y * cw + X;
    if (front[c] !== -1) return;
    const ins = cell(inside, X - 1, Y - 1) + cell(inside, X, Y - 1) + cell(inside, X - 1, Y) + cell(inside, X, Y);
    let ppx = X, ppy = Y, hz = 0;
    if (ins === 4) hz = (cell(u, X - 1, Y - 1) + cell(u, X, Y - 1) + cell(u, X - 1, Y) + cell(u, X, Y)) / 4;
    else {
      const a = cell(f, X - 1, Y - 1), b = cell(f, X, Y - 1), c2 = cell(f, X - 1, Y), d = cell(f, X, Y), gx = (b + d - a - c2) / 2, gy = (c2 + d - a - b) / 2, g2 = gx * gx + gy * gy;
      if (g2 > 1e-6) {
        let sx = (THR - (a + b + c2 + d) / 4) * gx / g2, sy = (THR - (a + b + c2 + d) / 4) * gy / g2;
        const l = Math.hypot(sx, sy);
        if (l > 0.7) { sx *= 0.7 / l; sy *= 0.7 / l; }
        ppx += sx; ppy += sy;
      }
    }
    const x = ppx / K - 1 - W.grip[0], y = h - (ppy / K - 1) - W.grip[1];
    const tx = Math.min(gw - 1, Math.max(0, Math.floor(ppx))), ty = Math.min(gh - 1, Math.max(0, Math.floor(ppy))), st = lab[ty * gw + tx] === STEEL ? 1 : 0;
    front[c] = pos.length / 3; pos.push(x, y, hz); uv.push(ppx / gw, 1 - ppy / gh); steel.push(st);
    if (hz > 0) { back[c] = pos.length / 3; pos.push(x, y, -hz); uv.push(ppx / gw, 1 - ppy / gh); steel.push(st); } else back[c] = front[c];
  };
  for (let Y = 1; Y < gh - 1; Y++) for (let X = 1; X < gw - 1; X++) {
    if (!inside[Y * gw + X]) continue;
    corner(X, Y); corner(X + 1, Y); corner(X + 1, Y + 1); corner(X, Y + 1);
    const a = Y * cw + X, b = a + 1, c = a + cw + 1, d = a + cw;
    idx.push(front[a], front[d], front[c], front[a], front[c], front[b], back[a], back[c], back[d], back[a], back[b], back[c]);
  }
  const position = new Float32Array(pos), index = Uint32Array.from(idx);
  return { mesh: { position, normal: vertexNormals(position, index), uv: new Float32Array(uv), index }, paint: { w: gw, h: gh, data: rgba }, steel: Uint8Array.from(steel) };
}

/**
 * A thin, curved piece (a bow's limb, its string) as a round rod along a smooth line through a few points read off the sprite.
 * `rOf(t)` is the rod's radius along it (0 to 1), `colOf(y)` its colour at a sprite row.
 */
function rodGeo(W: WeaponDesc, h: number, pts: [number, number][], smooth: boolean, rOf: (t: number) => number, colOf: (y: number) => number): { mesh: Mesh3; colour: Float32Array } {
  const curve = new CatmullRomCurve3(pts.map(([x, y]) => new Vector3(x - W.grip[0], h - y - W.grip[1], 0)), false, 'catmullrom', smooth ? 0.5 : 0);
  const N = 72, K = 12, pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, p = curve.getPoint(t), tg = curve.getTangent(t), nx = -tg.y, ny = tg.x;
    const r = Math.max(0.03, rOf(t) * Math.sqrt(Math.min(1, Math.min(t, 1 - t) * N / 3)));   // rounded ends
    const c = hex(colOf(h - p.y - W.grip[1]));
    for (let k = 0; k < K; k++) { const a = 2 * Math.PI * k / K; pos.push(p.x + r * Math.cos(a) * nx, p.y + r * Math.cos(a) * ny, r * Math.sin(a)); col.push(...c); }
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < K; k++) { const a = i * K + k, b = i * K + (k + 1) % K, e = a + K, f = b + K; idx.push(a, b, e, b, f, e); }
  const position = new Float32Array(pos), index = Uint32Array.from(idx);
  return { mesh: { position, normal: vertexNormals(position, index), uv: null, index }, colour: new Float32Array(col) };
}

/** A bow: the limb with its red grip and dark bands, and the string. Each is a piece with its own dark outline. */
function bowParts(W: WeaponDesc, h: number): { mesh: Mesh3; colour: Float32Array; line: number }[] {
  const B = W.rod!, band = (y: number): boolean => B.bands.some(([a, b]) => y >= a && y <= b);
  const limb = rodGeo(W, h, B.limb, true, (t) => (Math.abs(t - 0.5) < 0.085 ? B.r * 1.25 : B.r * (0.65 + 0.35 * Math.sin(Math.PI * t))), (y) => (y >= B.grip[0] && y <= B.grip[1] ? B.gripColour : band(y) ? B.bandColour : B.colour));
  const string = rodGeo(W, h, B.string, false, () => B.stringR, () => B.stringColour);
  return [{ ...limb, line: 0.4 }, { ...string, line: 0.22 }];
}

/** One piece of a weapon: a mesh, its outline width, and how its vertices look (flat colours, or the paint with a steel flag). */
interface Piece { mesh: Mesh3; line: number; flat: Float32Array | null; steel: Uint8Array | null }

/** The 3D model of a pack weapon: `name` is the sprite's name, `px` its pixels (the redrawn big hammer ignores them and may get null; any other weapon needs them). */
export function buildWeapon(name: string, px: SpritePixels | null): FigureModel {
  const W = WEAPONS[name];
  if (!W) throw new Error(`${name} is not a pack weapon`);
  if (!W.art && !px) throw new Error(`${name} needs its sprite pixels`);
  const src = W.art ? artPixels(W.art) : px!;
  let pieces: Piece[], paint: { w: number; h: number; data: Uint8Array };
  if (W.rod) {
    pieces = bowParts(W, src.h).map((p) => ({ mesh: p.mesh, line: p.line, flat: p.colour, steel: null }));
    paint = { w: 1, h: 1, data: Uint8Array.of(255, 255, 255, 255) };
  } else {
    const R = rounded(W, src);
    pieces = [{ mesh: R.mesh, line: 0.5, flat: null, steel: R.steel }];
    paint = R.paint;
  }
  // Drawn outlines first, then the pieces: each outline is its piece pushed out along the normals.
  const parts = [...pieces.map((p) => ({ mesh: hull(p.mesh, p.line), line: true, flat: null as Float32Array | null, steel: null as Uint8Array | null })), ...pieces.map((p) => ({ mesh: p.mesh, line: false, flat: p.flat, steel: p.steel }))];
  let n = 0;
  for (const p of parts) n += p.mesh.position.length / 3;
  const position = new Float32Array(n * 3), normal = new Float32Array(n * 3), uv = new Float32Array(n * 2), skin = new Float32Array(n * 4), look = new Float32Array(n * 4);
  const all: number[] = [], ranges: ModelRange[] = [], stage = STAGES.indexOf('weapon'), outline = hex(OUTLINE);
  let v0 = 0, top = 0, reach = 0;
  for (const p of parts) {
    const m = p.mesh, c = m.position.length / 3, last = ranges[ranges.length - 1];
    if (last && last.line === p.line) last.count += m.index.length;
    else ranges.push({ stage, line: p.line, start: all.length, count: m.index.length });
    for (const i of m.index) all.push(v0 + i);
    position.set(m.position, v0 * 3); normal.set(m.normal, v0 * 3);
    if (m.uv && !p.line) uv.set(m.uv, v0 * 2);
    for (let i = 0; i < c; i++) {
      const o = v0 + i;
      skin.set([0, p.line ? 1 : 0, -1, 0], o * 4);
      if (p.line) look.set([...outline, 0], o * 4);
      else if (p.flat) look.set([p.flat[i * 3], p.flat[i * 3 + 1], p.flat[i * 3 + 2], 0], o * 4);
      else look.set([-1, -1, -1, p.steel![i]], o * 4);
      if (!p.line) { top = Math.max(top, m.position[i * 3 + 1]); reach = Math.max(reach, Math.hypot(m.position[i * 3], m.position[i * 3 + 2])); }
    }
    v0 += c;
  }
  const index = Uint32Array.from(all);
  const { pieceIndex, lineIndex } = splitIndex(index, ranges);
  return {
    key: name, position, normal, uv, skin, look, index, ranges,
    pieceIndex, lineIndex,
    pivots: new Float32Array(MAX_BONES * 3), parents: new Int8Array(MAX_BONES).fill(-1),
    bends: [], robeTop: null, paint,
    baseHeight: top, radius: reach / 16, hatSway: 0,
    shoulderY: 0, handY: 0, armLength: 0, armRadius: 0, quad: false, scale: 1, size: 1, hipY: 0, neck: [0, 0],
  };
}
