// The sight step every 3D material ends with (#305): what the hero cannot see is black on dark maps and mist on daylight maps.
// The unseen strength comes from the sight mask (sightmask.ts) as a small RG8 texture over world space; the mist maths
// is mist.ts's, written as nodes.
import { DataTexture, LinearFilter, NoColorSpace, RGFormat, UnsignedByteType, Vector2, Vector3, Vector4, ClampToEdgeWrapping } from 'three/webgpu';
import { Fn, If, clamp, dot, float, max, mix, mx_noise_float, select, smoothstep, texture, uniform, vec2, vec3 } from 'three/tsl';
import { DEFAULT_HAZE, SHADE, type HazeLook } from '../game/sightField';
import { MIST, mistColour, type MistLook } from './mist';
import type { SightMask } from './sightmask';

// TSL's node types are too narrow for swizzles and mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export type SightMode = 'off' | 'dark' | 'mist';

export interface SightFrame {
  mode: SightMode;
  mask: SightMask | null; // null with mode 'off'
  clear: [number, number, number]; // the clear colour (dark maps: stoneClear(ambient))
  haze: HazeLook;
  mist: MistLook;
  mistDay: number; // 0 night .. 1 day
  mistLight: [number, number, number]; // white until #306
  wind: [number, number]; // tiles per second
  t: number; // seconds
}

export interface Sight {
  /** vec2 node (hard, soft) at a ground point `xz` (tiles), from the mask texture; sampled outside any branch. */
  unseenAt(xz: N): N;
  /** The colour after the sight step: `mode` off unchanged; dark mix(c * (1 - SHADE * soft), clear, hard); mist per `mist.ts` with `P` the true world point (height P.y, drift at P.xz). */
  apply(colour: N, P: N, u: N): N;
  /** How much of a card is drawn (0..1) from its (hard, scenery) attribute values, as `cardShown`; 1 when off. */
  shown(hard: N, scenery: N): N;
  /** Uploads the mask when its `data` object or `version` differs from the last call on this Sight (a new Sight always uploads); a new data size makes a new texture assigned to the node. */
  set(f: SightFrame): void;
  dispose(): void;
}

export const SIGHT_OFF: SightFrame = {
  mode: 'off', mask: null, clear: [0, 0, 0], haze: DEFAULT_HAZE, mist: MIST, mistDay: 1, mistLight: [1, 1, 1], wind: [0, 0], t: 0,
};

const MODE = { off: 0, dark: 1, mist: 2 } as const;

/** Seen everywhere and unseen nowhere: (hard 255, soft 0) in one texel, the stand-in until the first mask. */
function pending(): DataTexture {
  return texelTexture(new Uint8Array([255, 0]), 1);
}

function texelTexture(data: Uint8Array, n: number): DataTexture {
  const t = new DataTexture(data, n, n, RGFormat, UnsignedByteType);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.colorSpace = NoColorSpace;
  t.generateMipmaps = false;
  t.flipY = false;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

export function makeSight(): Sight {
  const uMode = uniform(0).setName('sightMode');
  // (ox, oz, world side n / res, res): the texture covers n texels = n / res tiles, one more than the mask's `size`.
  const uOrigin = uniform(new Vector4(0, 0, 1, 1)).setName('sightOrigin');
  const uClear = uniform(new Vector3());
  // outside, soft, mix, desat
  const uHaze = uniform(new Vector4(DEFAULT_HAZE.outside, DEFAULT_HAZE.soft, DEFAULT_HAZE.mix, DEFAULT_HAZE.desat));
  // low, high, top, drift
  const uMist = uniform(new Vector4(MIST.low, MIST.high, MIST.top, MIST.drift));
  const uMistColour = uniform(new Vector3(...mistColour(1)));
  const uMistLight = uniform(new Vector3(1, 1, 1));
  // wind * t / 3: the noise's offset in noise units
  const uDrift = uniform(new Vector2());

  let tex = pending();
  const maskNode = texture(tex).setName('sightMask');
  let lastData: Uint8Array | null = null;
  let lastVersion = -1;

  const isMist = uMode.greaterThan(1.5);
  const isDark = uMode.greaterThan(0.5).and(isMist.not());

  const unseenAt = (xz: N): N => {
    const uv = vec2(xz).sub(uOrigin.xy).div(uOrigin.z);
    const rg = maskNode.sample(uv).rg;
    const inside = uv.x.greaterThanEqual(0).and(uv.x.lessThanEqual(1)).and(uv.y.greaterThanEqual(0)).and(uv.y.lessThanEqual(1));
    return select(inside, rg, vec2(1, 0));
  };

  const apply = (colour: N, P: N, u: N): N => Fn(() => {
    const out = vec3(colour).toVar();
    const hard = u.x;
    const soft = u.y;
    If(isDark, () => {
      out.assign(mix(out.mul(float(1).sub(soft.mul(SHADE))), uClear, hard));
    });
    If(isMist, () => {
      const strength = max(uHaze.x.mul(hard), uHaze.y.mul(soft));
      const height = float(1).sub(float(1).sub(uMist.z).mul(smoothstep(uMist.x, uMist.y, P.y)));
      const n = clamp(mx_noise_float(vec3(P.x.div(3).sub(uDrift.x), P.z.div(3).sub(uDrift.y), 0)).mul(0.5).add(0.5), 0, 1);
      const amount = strength.mul(height).mul(float(1).sub(uMist.w.mul(n)));
      const luma = dot(out, vec3(0.2126, 0.7152, 0.0722));
      out.assign(mix(out, vec3(luma), amount.mul(uHaze.w)));
      out.assign(mix(out, uMistColour.mul(uMistLight), amount.mul(uHaze.z)));
    });
    return out;
  })();

  const shown = (hard: N, scenery: N): N => {
    const seen = float(1).sub(hard);
    return select(uMode.lessThan(0.5), float(1), select(isMist.and(float(scenery).greaterThan(0.5)), float(1), seen));
  };

  const set = (f: SightFrame): void => {
    uMode.value = MODE[f.mode];
    (uClear.value as Vector3).set(...f.clear);
    (uHaze.value as Vector4).set(f.haze.outside, f.haze.soft, f.haze.mix, f.haze.desat);
    (uMist.value as Vector4).set(f.mist.low, f.mist.high, f.mist.top, f.mist.drift);
    (uMistColour.value as Vector3).set(...mistColour(f.mistDay, f.haze));
    (uMistLight.value as Vector3).set(...f.mistLight);
    (uDrift.value as Vector2).set((f.wind[0] * f.t) / 3, (f.wind[1] * f.t) / 3);
    const m = f.mask;
    if (!m) return;
    (uOrigin.value as Vector4).set(m.ox, m.oz, m.n / m.res, m.res);
    if (m.data === lastData && m.version === lastVersion) return;
    const sameSize = lastData !== null && lastData.length === m.data.length;
    lastData = m.data;
    lastVersion = m.version;
    if (sameSize && tex.image.width === m.n) {
      // The texture keeps its data object only when that is the mask's own array; copy otherwise.
      if (tex.image.data !== m.data) (tex.image.data as Uint8Array).set(m.data);
      tex.needsUpdate = true;
    } else {
      tex.dispose();
      tex = texelTexture(m.data, m.n);
      maskNode.value = tex;
    }
  };

  const dispose = (): void => tex.dispose();

  return { unseenAt, apply, shown, set, dispose };
}
