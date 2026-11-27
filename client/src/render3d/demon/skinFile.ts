// The demon's skin as a file, built ahead of time by scripts/build-demon-skin.ts and fetched by the game.
// Little endian: 'TADS', version, hash of the sources that built it, then the seven parts in PARTS order. Per part: points,
// indices, the body's `solid` (0xffffffff if none), whether it has uvs; then position f32x3, uv f32x2, index u32,
// normal i8x4 (x127), info u8x4 (x127: the leather tag's 2 fits), skinIndex u8x4, skinWeight u8x4 (x255).
// The 4-byte arrays come first so each stays aligned. shortcut: assumes a little-endian host (every browser we support is), upgrade never.
import type { DemonSkin, SkinPart } from './body';

export const SKIN_VERSION = 1;
const MAGIC = 0x53444154; // 'TADS' read little endian
const NO_SOLID = 0xffffffff;
const PARTS = ['body', 'tail', 'tubes', 'web', 'cloth', 'blade', 'iron'] as const;
const HEAD = 12, PART_HEAD = 16;

const q = (v: number, k: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v * k)));

function partBytes(p: SkinPart): number {
  const nv = p.position.length / 3;
  return PART_HEAD + nv * 12 + (p.uv ? nv * 8 : 0) + p.index.length * 4 + nv * 16;
}

export function encodeSkin(s: DemonSkin, hash = 0): ArrayBuffer {
  const buf = new ArrayBuffer(HEAD + PARTS.reduce((n, k) => n + partBytes(s[k]), 0));
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, SKIN_VERSION, true); dv.setUint32(8, hash >>> 0, true);
  let o = HEAD;
  for (const k of PARTS) {
    const p = s[k], nv = p.position.length / 3;
    dv.setUint32(o, nv, true); dv.setUint32(o + 4, p.index.length, true); dv.setUint32(o + 8, p.solid ?? NO_SOLID, true); dv.setUint32(o + 12, p.uv ? 1 : 0, true);
    o += PART_HEAD;
    new Float32Array(buf, o, nv * 3).set(p.position); o += nv * 12;
    if (p.uv) { new Float32Array(buf, o, nv * 2).set(p.uv); o += nv * 8; }
    new Uint32Array(buf, o, p.index.length).set(p.index); o += p.index.length * 4;
    for (let v = 0; v < nv; v++) {
      for (let c = 0; c < 3; c++) u8[o + v * 4 + c] = q(p.normal[v * 3 + c], 127, -127, 127) & 255;
      for (let c = 0; c < 4; c++) {
        u8[o + nv * 4 + v * 4 + c] = q(p.info[v * 4 + c], 127, 0, 255);
        u8[o + nv * 8 + v * 4 + c] = p.skinIndex[v * 4 + c];
        u8[o + nv * 12 + v * 4 + c] = q(p.skinWeight[v * 4 + c], 255, 0, 255);
      }
    }
    o += nv * 16;
  }
  return buf;
}

/** The hash of the sources that built the file (0 if the header is not one). */
export function skinFileHash(buf: ArrayBuffer): number {
  return buf.byteLength >= HEAD && new DataView(buf).getUint32(0, true) === MAGIC ? new DataView(buf).getUint32(8, true) : 0;
}

export function decodeSkin(buf: ArrayBuffer): DemonSkin {
  if (buf.byteLength < HEAD) throw new Error('demon skin: too short');
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('demon skin: wrong magic');
  if (dv.getUint32(4, true) !== SKIN_VERSION) throw new Error('demon skin: wrong version');
  let o = HEAD;
  const need = (n: number) => { if (o + n > buf.byteLength) throw new Error('demon skin: cut short'); };
  const out: Partial<Record<(typeof PARTS)[number], SkinPart>> = {};
  for (const k of PARTS) {
    need(PART_HEAD);
    const nv = dv.getUint32(o, true), ni = dv.getUint32(o + 4, true), solid = dv.getUint32(o + 8, true), hasUv = dv.getUint32(o + 12, true) === 1;
    o += PART_HEAD;
    need(nv * 12 + (hasUv ? nv * 8 : 0) + ni * 4 + nv * 16);
    const position = new Float32Array(buf.slice(o, o + nv * 12)); o += nv * 12;
    let uv: Float32Array | null = null;
    if (hasUv) { uv = new Float32Array(buf.slice(o, o + nv * 8)); o += nv * 8; }
    const index = new Uint32Array(buf.slice(o, o + ni * 4)); o += ni * 4;
    const b = new Uint8Array(buf, o, nv * 16), normal = new Float32Array(nv * 3), info = new Float32Array(nv * 4), skinWeight = new Float32Array(nv * 4);
    for (let v = 0; v < nv; v++) {
      for (let c = 0; c < 3; c++) normal[v * 3 + c] = ((b[v * 4 + c] << 24) >> 24) / 127;
      for (let c = 0; c < 4; c++) { info[v * 4 + c] = b[nv * 4 + v * 4 + c] / 127; skinWeight[v * 4 + c] = b[nv * 12 + v * 4 + c] / 255; }
    }
    const skinIndex = b.slice(nv * 8, nv * 12);
    o += nv * 16;
    out[k] = { position, normal, info, uv, skinIndex, skinWeight, index, ...(solid === NO_SOLID ? {} : { solid }) };
  }
  if (o !== buf.byteLength) throw new Error('demon skin: wrong length');
  return out as DemonSkin;
}

let skin: DemonSkin | null = null, started = false;
/** The skin, once `assets/demon-skin.bin` is fetched and decoded; null until then, and for good if that failed (one warning). */
export function demonSkin(): DemonSkin | null {
  if (!started) {
    started = true;
    fetch('assets/demon-skin.bin')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((b) => { skin = decodeSkin(b); })
      .catch((e) => console.warn('demon skin: not loaded', e));
  }
  return skin;
}
/** Tests and the dev pages' replays: sets the skin; null lets the next `demonSkin()` fetch again. */
export function setDemonSkin(s: DemonSkin | null): void { skin = s; started = s !== null; }
