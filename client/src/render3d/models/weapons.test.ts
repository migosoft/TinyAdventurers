import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../../../scripts/png';
import { STAGES, type FigureModel } from './model';
import { STEEL, WEAPONS, buildWeapon, type SpritePixels } from './weapons';

const PACK = join(__dirname, '../../../assets-src/0x72');
const sheet = decodePng(readFileSync(join(PACK, '0x72_DungeonTilesetII_v1.7.png')));
const rects = new Map<string, [number, number, number, number]>();
for (const line of readFileSync(join(PACK, 'tile_list_v1.7'), 'utf8').split(/\r?\n/)) {
  const [name, x, y, w, h] = line.trim().split(/\s+/);
  if (name && h !== undefined) rects.set(name, [+x, +y, +w, +h]);
}
/** One pack sprite's own pixels. */
const sprite = (name: string): SpritePixels => {
  const [x, y, w, h] = rects.get(name)!;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) data.set(sheet.data.subarray(((y + r) * sheet.w + x) * 4, ((y + r) * sheet.w + x + w) * 4), r * w * 4);
  return { w, h, data };
};

const memo = new Map<string, FigureModel>();
const model = (name: string): FigureModel => {
  let m = memo.get(name);
  if (!m) memo.set(name, (m = buildWeapon(name, sprite(name))));
  return m;
};
const NAMES = Object.keys(WEAPONS);
const SLOW = 120000;
const steelShare = (m: FigureModel): number => {
  let s = 0, n = 0;
  for (let i = 0; i < m.look.length / 4; i++) if (m.skin[i * 4 + 1] === 0) { n++; if (m.look[i * 4 + 3] === 1) s++; }
  return s / n;
};
const zMax = (m: FigureModel): number => {
  let z = 0;
  for (let i = 0; i < m.position.length / 3; i++) if (m.skin[i * 4 + 1] === 0) z = Math.max(z, Math.abs(m.position[i * 3 + 2]));   // the pieces, not their outline hulls
  return z;
};

describe('the table', () => {
  it('lists every weapon sprite of the pack', () => {
    const pack = [...rects.keys()].filter((k) => k.startsWith('weapon_')).sort();
    expect(pack.length).toBe(27);
    expect(NAMES.slice().sort()).toEqual(pack);
    for (const k of NAMES) expect(WEAPONS[k].sprite).toBe(k);
  });
});

describe('buildWeapon', () => {
  it('builds every weapon: finite positions, indices in range, one bone, the weapon stage', () => {
    for (const k of NAMES) {
      const m = model(k), n = m.position.length / 3;
      expect(n, k).toBeGreaterThan(8);
      expect(m.normal.length).toBe(n * 3);
      expect(m.uv.length).toBe(n * 2);
      expect(m.skin.length).toBe(n * 4);
      expect(m.look.length).toBe(n * 4);
      for (const v of m.position) expect(Number.isFinite(v), k).toBe(true);
      for (const v of m.normal) expect(Number.isFinite(v), k).toBe(true);
      for (const i of m.index) expect(i).toBeLessThan(n);
      for (let i = 0; i < n; i++) expect(m.skin[i * 4]).toBe(0);
      for (const r of m.ranges) expect(r.stage).toBe(STAGES.indexOf('weapon'));
      expect(m.pieceIndex.length + m.lineIndex.length).toBe(m.index.length);
      expect(m.robeTop).toBeNull();
      expect(m.bends).toEqual([]);
      expect(m.baseHeight, k).toBeGreaterThan(0);
      expect(m.radius, k).toBeGreaterThan(0);
      expect(m.paint.data.length).toBe(m.paint.w * m.paint.h * 4);
    }
  }, SLOW);

  it('is deterministic', () => {
    const a = buildWeapon('weapon_knight_sword', sprite('weapon_knight_sword')), b = model('weapon_knight_sword');
    expect(a.position).toEqual(b.position);
    expect(a.look).toEqual(b.look);
    expect(a.index).toEqual(b.index);
    expect(a.paint.data).toEqual(b.paint.data);
  }, SLOW);

  it('steel: the knight sword is mostly polished steel, the pack colour is gone, the red staff has none', () => {
    const m = model('weapon_knight_sword');
    expect(steelShare(m)).toBeGreaterThan(0.5);
    const pk = m.paint.data;
    for (let i = 0; i < pk.length; i += 4) expect((pk[i] << 16) | (pk[i + 1] << 8) | pk[i + 2]).not.toBe(0x72d6ce);
    expect(STEEL).toBe(0xdfe6ec);
    expect(steelShare(model('weapon_red_magic_staff'))).toBe(0);
  }, SLOW);

  it('a blade is a lens, a hammer is fat', () => {
    // The page's rule gives the knight sword 0.92 (the brief's 0.7 was a guess): a lens against the hammer's 2.6.
    expect(zMax(model('weapon_knight_sword'))).toBeLessThan(1);
    expect(zMax(model('weapon_hammer'))).toBeGreaterThan(1.2);
  }, SLOW);

  it('the grip is the origin: the knight sword (29 px tall, gripped at 14.5) spans -14.5 to 14.5', () => {
    const m = model('weapon_knight_sword');
    let hi = -Infinity, lo = Infinity;
    for (let i = 1; i < m.position.length; i += 3) { hi = Math.max(hi, m.position[i]); lo = Math.min(lo, m.position[i]); }
    expect(hi).toBeGreaterThan(13);
    expect(hi).toBeLessThan(15);
    expect(lo).toBeLessThan(-13);
    expect(lo).toBeGreaterThan(-15);
  }, SLOW);

  it('bows are rods: a limb and a string, the second bow drawn back', () => {
    for (const k of ['weapon_bow', 'weapon_bow_2']) {
      const m = model(k);
      expect(m.ranges.filter((r) => !r.line).length, k).toBe(1);
      expect(m.paint.w * m.paint.h).toBe(1);
      for (let i = 0; i < m.look.length; i += 4) expect(m.look[i]).toBeGreaterThanOrEqual(0);   // flat colours, no paint lookup
    }
    const reach = (k: string): number => {
      const m = model(k);
      let lo = Infinity;
      for (let i = 0; i < m.position.length; i += 3) lo = Math.min(lo, m.position[i]);
      return lo;
    };
    // The string's middle lies at x 0.7 (page pixels) from the grip at 7: 6.3 behind it, and the first bow's at 7.6 - 7 = 0.6.
    expect(reach('weapon_bow_2')).toBeLessThan(reach('weapon_bow') - 5);
    expect(reach('weapon_bow_2')).toBeCloseTo(0.7 - 7 - 0.3 - 0.4, 0);
  }, SLOW);

  it('the big hammer is the redrawn one: a wide head', () => {
    const m = model('weapon_big_hammer');
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < m.position.length; i += 3) { lo = Math.min(lo, m.position[i]); hi = Math.max(hi, m.position[i]); }
    expect(hi - lo).toBeGreaterThan(13);
  }, SLOW);

  it('pins every weapon (a hash of the positions)', () => {
    const hash: Record<string, string> = {};
    for (const k of NAMES) {
      let h = 0x811c9dc5;
      for (const v of model(k).position) {
        h = (h ^ (Math.round(v * 1e4) | 0)) >>> 0;
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      hash[k] = h.toString(16);
    }
    expect(hash).toEqual({
      weapon_anime_sword: '7b02de30',
      weapon_arrow: '8478eb8c',
      weapon_axe: '28d28f28',
      weapon_baton_with_spikes: 'a58d900d',
      weapon_big_hammer: 'cc284e7e',
      weapon_bow: '1035686d',
      weapon_bow_2: 'cdf981cf',
      weapon_cleaver: '2a39021a',
      weapon_double_axe: '3eac3171',
      weapon_duel_sword: '78c80cf9',
      weapon_golden_sword: '956d5b65',
      weapon_green_magic_staff: '5b93139c',
      weapon_hammer: '538a0a8',
      weapon_katana: 'e8da15',
      weapon_knife: '54765edd',
      weapon_knight_sword: 'fe3c9413',
      weapon_lavish_sword: 'b7496b8',
      weapon_mace: 'a02e878d',
      weapon_machete: '8be45cb3',
      weapon_red_gem_sword: 'fb561021',
      weapon_red_magic_staff: 'be2479bc',
      weapon_regular_sword: 'be91faf1',
      weapon_rusty_sword: 'be91faf1',
      weapon_saw_sword: 'f0670150',
      weapon_spear: '4a481407',
      weapon_throwing_axe: '537da371',
      weapon_waraxe: 'd005a126',
    });
  }, SLOW);
});
