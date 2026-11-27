import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildDemonSkin, type DemonSkin } from './body';
import { SKIN_VERSION, decodeSkin, demonSkin, encodeSkin, setDemonSkin, skinFileHash } from './skinFile';

let s: DemonSkin, buf: ArrayBuffer;
beforeAll(() => { s = buildDemonSkin(0.05); buf = encodeSkin(s, 1234); });
afterEach(() => { vi.unstubAllGlobals(); setDemonSkin(null); });

describe('the skin file', () => {
  it('is the same bytes every time', () => {
    expect(Buffer.from(encodeSkin(buildDemonSkin(0.05), 1234)).equals(Buffer.from(buf))).toBe(true);
  });

  it('survives the file', () => {
    const r = decodeSkin(buf);
    expect(r.body.position).toEqual(s.body.position);
    expect(r.body.index).toEqual(s.body.index);
    expect(r.body.solid).toBe(s.body.solid);
    expect(r.tail.solid).toBeUndefined();
    expect(r.blade.uv).toEqual(s.blade.uv);
    expect(r.iron.uv).toBeNull();
    for (const k of Object.keys(s) as (keyof DemonSkin)[]) {
      expect(r[k].skinIndex).toEqual(s[k].skinIndex);
      const max = (a: Float32Array, b: Float32Array) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
      expect(max(r[k].skinWeight, s[k].skinWeight), k).toBeLessThanOrEqual(1 / 255);
      expect(max(r[k].info, s[k].info), k).toBeLessThanOrEqual(1 / 127);
      expect(max(r[k].normal, s[k].normal), k).toBeLessThanOrEqual(1 / 127);
    }
    expect(new Set(r.iron.info.filter((_, i) => i % 4 === 0))).toEqual(new Set([0, 1, 2]));
    expect(skinFileHash(buf)).toBe(1234);
  });

  it('refuses a cut file, a wrong magic and another version', () => {
    const flipped = buf.slice(0), bumped = buf.slice(0);
    new Uint8Array(flipped)[0] ^= 1;
    new DataView(bumped).setUint32(4, SKIN_VERSION + 1, true);
    // the body's `solid` sits in the first part's header, at byte 12 + 8
    const past = buf.slice(0), odd = buf.slice(0);
    new DataView(past).setUint32(20, s.body.index.length + 3, true);
    new DataView(odd).setUint32(20, s.body.solid! + 1, true);
    for (const bad of [past, odd, buf.slice(0, 100), buf.slice(0, buf.byteLength - 4), flipped, bumped, new ArrayBuffer(3)]) expect(() => decodeSkin(bad)).toThrow();
  });

  it('a failed fetch leaves the skin null and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', f);
    expect(demonSkin()).toBeNull();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(demonSkin()).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a good fetch hands the decoded skin out', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(buf) })));
    expect(demonSkin()).toBeNull();
    await vi.waitFor(() => expect(demonSkin()).not.toBeNull());
    expect(demonSkin()!.body.solid).toBe(s.body.solid);
  });
});
