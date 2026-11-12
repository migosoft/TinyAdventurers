// The light of the 3D view in TSL: point lights with a grid-walk wall shadow (port of the demo's lightAt / wallVis).
import { DataTexture, DataUtils, HalfFloatType, LinearFilter, NoColorSpace, RGBAFormat, Vector2, Vector3, Vector4, type Texture } from 'three/webgpu';
import { Break, Fn, If, Loop, abs, clamp, exp, float, floor, int, ivec2, length, max, min, mix, select, smoothstep, texture, textureLoad, uniform, uniformArray, dot, vec2, vec3, vec4 } from 'three/tsl';
import { DV_DARK, EDGE } from '../game/light';
import { AMBIENT, DV_EYE, DV_FADE, DV_MARGIN, LIGHT_CAP, packLights, type Light } from './light';
import { CASTER_CAP, LIGHT_MARGIN, type ShadowCaster } from './lights';

/** A card casts a shadow on a segment only when its foot is within half its width plus this (tiles) of the segment's line. */
const CARD_REACH = 0.5;

// TSL's node types are too narrow for swizzles and mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export interface Lighting {
  /**
   * `rgb`: ambient plus lava plus the lights; `dv` (0..1): the darkvision strength at P. P and N are vec3 nodes, wrap a float node or number.
   * `self`: the caster slot the surface belongs to, a float node, -1 none (its own shadow does not fall on it); `darkOnly` > 0.5: ambient alone, no lights, no lava, no darkvision.
   */
  lightAt(P: N, N: N, wrap: N, opts?: { self?: N; darkOnly?: N }): { rgb: N; dv: N };
  /** The darkvision rule (grey where only darkvision shows, colour back as real light grows), then the shoulder. */
  finish(albedo: N, lit: { rgb: N; dv: N }): N;
  /** The lava light texture (`w * h` half-float rgba texels). */
  readonly lavaTexture: DataTexture;
  /**
   * The lava light per tile (`map.w * map.h * 4` floats), or null for none. Called every frame: the data is converted and
   * uploaded only when the array object or `version` differs from the last call, so a caller that refills one buffer must bump `version`.
   */
  setLava(data: Float32Array | null, version?: number): void;
  /** The followed figure's centre and reach in tiles; null: no darkvision. */
  setDarkvision(d: { x: number; z: number; reach: number } | null): void;
  /** mix(col, 1 - exp(-1.6 col), smoothstep(0.55, 1.1, col)) */
  shoulder(col: N): N;
  /** ivec2 cell -> wall height in tiles, clamped to the map. */
  cellH(cell: N): N;
  setLights(lights: Light[]): void;
  /** The figures that cast shadows, in slot order (the first `CASTER_CAP` are used); `yaw` is the camera's, which turns the cards' right axis. */
  setCasters(casters: readonly ShadowCaster[], yaw?: number): void;
  setShadows(on: boolean): void;
  /** The ambient light (a uniform); `AMBIENT` is its start value. */
  setAmbient(rgb: [number, number, number]): void;
}

export function makeLighting(heightTex: DataTexture, map: { w: number; h: number }, atlas: Texture): Lighting {
  // The casters: (x, z, w, y0), (y1, 0, 0, 0) and the atlas rect (u0, v0, u1, v1) per slot; w 0 ends the list.
  const cA = uniformArray(Array.from({ length: CASTER_CAP }, () => new Vector4()), 'vec4');
  const cB = uniformArray(Array.from({ length: CASTER_CAP }, () => new Vector4()), 'vec4');
  const cR = uniformArray(Array.from({ length: CASTER_CAP }, () => new Vector4()), 'vec4');
  const uRight = uniform(new Vector2(1, 0));
  const lPos = uniformArray(Array.from({ length: LIGHT_CAP }, () => new Vector4()), 'vec4');
  const lCol = uniformArray(Array.from({ length: LIGHT_CAP }, () => new Vector4()), 'vec4');
  const uShadows = uniform(1);
  const uAmbient = uniform(new Vector3(...AMBIENT));
  const ambient = uAmbient;

  const cellH = (cell: N): N => {
    const x = int(min(max(float(cell.x), 0), map.w - 1));
    const z = int(min(max(float(cell.y), 0), map.h - 1));
    return textureLoad(heightTex, ivec2(x, z)).x.mul(2.55);
  };

  // 1 when nothing stands between P and L, else 0: a walk over the map's cells along the segment.
  const wallVis = Fn(([P, L]: N[]) => {
    const ox = P.x, oz = P.z;
    const dx = L.x.sub(P.x), dz = L.z.sub(P.z);
    const dy = L.y.sub(P.y);
    const cx = int(floor(ox)).toVar();
    const cz = int(floor(oz)).toVar();
    const sx = select(dx.lessThan(0), float(-1), float(1));
    const sz = select(dz.lessThan(0), float(-1), float(1));
    const tDx = float(1).div(max(abs(dx), 1e-6));
    const tDz = float(1).div(max(abs(dz), 1e-6));
    const fcx = float(cx), fcz = float(cz);
    const tMx = select(sx.greaterThan(0), fcx.add(1).sub(ox), ox.sub(fcx)).mul(tDx).toVar();
    const tMz = select(sz.greaterThan(0), fcz.add(1).sub(oz), oz.sub(fcz)).mul(tDz).toVar();
    const t0 = float(0).toVar();
    const vis = float(1).toVar();
    Loop(40, ({ i }: N) => {
      const t1 = min(min(tMx, tMz), 1);
      If(i.greaterThan(0), () => {
        const h = cellH(ivec2(cx, cz));
        If(h.greaterThan(0), () => {
          const ym = P.y.add(dy.mul(select(dy.lessThan(0), t1, t0)));
          If(ym.lessThan(h.sub(0.001)), () => {
            vis.assign(0);
            Break();
          });
        });
      });
      If(t1.greaterThanEqual(1), () => {
        Break();
      });
      If(tMx.lessThan(tMz), () => {
        cx.addAssign(int(sx));
        t0.assign(tMx);
        tMx.addAssign(tDx);
      }).Else(() => {
        cz.addAssign(int(sz));
        t0.assign(tMz);
        tMz.addAssign(tDz);
      });
    });
    return vis;
  });

  // 1 when no caster's current frame stands between P and the light L, else 0 (the demo's cardVis). Each card is turned to face the
  // light and its atlas alpha is the occluder. Slot `self` (the surface's own figure) and `skip` (the light's carrier) are not tested;
  // the loop ends at the first empty slot; a card whose foot is far from the segment is rejected before the atlas is touched.
  const cardVis = Fn(([P, L, self, skip]: N[]) => {
    const vis = float(1).toVar();
    const D = L.sub(P);
    const d2 = D.xz;
    const len2 = max(dot(d2, d2), 1e-6);
    Loop(CASTER_CAP, ({ i }: N) => {
      const a: N = cA.element(i);
      If(a.z.lessThanEqual(0), () => {
        Break();
      });
      const j = float(i);
      If(j.notEqual(self).and(j.notEqual(skip)), () => {
        const F = a.xy;
        const near = F.sub(P.xz.add(d2.mul(clamp(dot(F.sub(P.xz), d2).div(len2), 0, 1))));
        If(length(near).lessThan(a.z.mul(0.5).add(CARD_REACH)), () => {
          const n0 = F.sub(L.xz);
          const nl = length(n0);
          If(nl.greaterThan(1e-3), () => {
            const n = n0.div(nl);
            const den = dot(d2, n);
            // Where the segment meets the card's plane (through the foot, facing the light); a segment along the plane misses it.
            const t = dot(F.sub(P.xz), n).div(select(abs(den).lessThan(1e-4), float(1e-4), den));
            If(abs(den).greaterThanEqual(1e-4).and(t.greaterThan(0.02)).and(t.lessThan(0.99)), () => {
              const H = P.add(D.mul(t));
              const b: N = cB.element(i);
              const y0 = a.w;
              const y1 = b.x;
              If(H.y.greaterThanEqual(y0).and(H.y.lessThanEqual(y1)), () => {
                // The card's width runs across the light's direction; it is read the way the camera sees it (its right is `uRight`).
                const pp0 = vec2(n.y, n.x.negate());
                const pp = select(dot(pp0, uRight).lessThan(0), pp0.negate(), pp0);
                const u = dot(H.xz.sub(F), pp).div(a.z).add(0.5);
                If(u.greaterThanEqual(0).and(u.lessThanEqual(1)), () => {
                  const r: N = cR.element(i);
                  // u0 > u1 when the card is mirrored: the rect then runs back to front.
                  const wU = abs(r.z.sub(r.x));
                  const lo = min(r.x, r.z);
                  const fu = select(r.z.lessThan(r.x), float(1).sub(u), u);
                  const vf = clamp(y1.sub(H.y).div(max(y1.sub(y0), 1e-4)), 0, 1);
                  const hV = r.w.sub(r.y);
                  const px = floor(lo.add(min(fu.mul(wU), wU.sub(0.001))));
                  const py = floor(r.y.add(min(vf.mul(hV), hV.sub(0.001))));
                  If(textureLoad(atlas, ivec2(int(px), int(py))).a.greaterThan(0.5), () => {
                    vis.assign(0);
                    Break();
                  });
                });
              });
            });
          });
        });
      });
    });
    return vis;
  });

  // The lava light: one rgba texel per tile (rgb: the light the tile's lava lights give, a: 1 on a lava tile).
  const lavaTex = new DataTexture(new Uint16Array(map.w * map.h * 4), map.w, map.h, RGBAFormat, HalfFloatType);
  lavaTex.colorSpace = NoColorSpace;
  lavaTex.magFilter = LinearFilter;
  lavaTex.minFilter = LinearFilter;
  lavaTex.generateMipmaps = false;
  lavaTex.flipY = false;
  lavaTex.premultiplyAlpha = false;
  lavaTex.needsUpdate = true;
  let lavaSrc: Float32Array | null | undefined;
  let lavaVer = -1;
  const mapSize = vec2(map.w, map.h);

  // Darkvision: the followed figure's centre (x, z) and the reach in tiles; reach 0 is off.
  const uDvEye = uniform(new Vector2());
  const uDvReach = uniform(0);

  const lightAt = (P: N, Nrm: N, wrap: N, opts: { self?: N; darkOnly?: N } = {}): { rgb: N; dv: N } => {
    const w = typeof wrap === 'number' ? float(wrap) : wrap;
    const dark: N = opts.darkOnly ?? float(0);
    const self: N = opts.self ?? float(-1);
    // Sampled outside any branch: a filtered read needs uniform control flow.
    const lavaLight = texture(lavaTex, P.xz.div(mapSize)).rgb;
    const out = Fn(() => {
      const sum = ambient.toVar();
      const dvOut = float(0).toVar();
      const Po = P.add(Nrm.mul(0.03));
      If(dark.lessThan(0.5), () => {
        sum.addAssign(lavaLight);
        // Self-lit only on the pool's own surface (an upward face); walls on a cell boundary and cards get the sampled lava light alone.
        If(Nrm.y.greaterThan(0.5), () => {
          const lx = int(min(max(floor(P.x), 0), map.w - 1));
          const lz = int(min(max(floor(P.z), 0), map.h - 1));
          sum.addAssign(textureLoad(lavaTex, ivec2(lx, lz)).a);
        });
        Loop(LIGHT_CAP, ({ i }: N) => {
          const lp: N = lPos.element(i);
          const lc: N = lCol.element(i);
          const L = lp.xyz;
          const rad = lp.w;
          If(rad.lessThanEqual(0), () => {
            Break();
          });
          const d = L.sub(P);
          const dist = length(d);
          const dh = length(d.xz);
          If(dh.lessThan(rad.add(LIGHT_MARGIN)), () => {
            const k = min(dh.div(rad), 1);
            const f = float(1).sub(float(1 - EDGE).mul(k.mul(k).mul(float(3).sub(k.mul(2)))));
            const ndl = mix(max(dot(Nrm, d.div(max(dist, 1e-3))), 0), float(1), w);
            const v = float(1).toVar();
            If(lc.w.greaterThan(0.5).and(uShadows.greaterThan(0.5)), () => {
              v.assign(wallVis(Po, L));
              // The wall test first: a card is looked at only for a light that still reaches P. The shadow channel is skip + 2.
              If(v.greaterThan(0.5), () => {
                v.assign(cardVis(Po, L, self, lc.w.sub(2)));
              });
            });
            sum.addAssign(lc.xyz.mul(f.mul(ndl).mul(v)));
          });
        });
        // Darkvision: a fading disc around the eye that walls block.
        If(uDvReach.greaterThan(0), () => {
          const eyeD = length(P.xz.sub(uDvEye));
          const edge = float(1).sub(smoothstep(uDvReach.add(DV_MARGIN), uDvReach.add(DV_MARGIN + DV_FADE), eyeD));
          If(edge.greaterThan(0), () => {
            dvOut.assign(edge.mul(wallVis(Po, vec3(uDvEye.x, DV_EYE, uDvEye.y))));
          });
        });
      });
      return vec4(sum, dvOut);
    })();
    return { rgb: out.xyz, dv: out.w };
  };

  const shoulder = (col: N): N => mix(col, float(1).sub(exp(col.mul(-1.6))), smoothstep(0.55, 1.1, col));

  // The darkvision rule: where only darkvision shows a surface it is grey at the 2D minimum; real light brings its colour back.
  const finish = (albedo: N, lit: { rgb: N; dv: N }): N => {
    const l = max(lit.rgb.r, max(lit.rgb.g, lit.rgb.b));
    const g = lit.dv.mul(clamp(float(1).sub(l.div(1 - DV_DARK)), 0, 1));
    const grey = vec3(albedo.dot(vec3(0.299, 0.587, 0.114))).mul(max(l, lit.dv.mul(1 - DV_DARK)));
    return shoulder(mix(albedo.mul(lit.rgb), grey, g));
  };

  return {
    lightAt,
    finish,
    shoulder,
    cellH,
    lavaTexture: lavaTex,
    setLava(data, version = 0) {
      if (data === lavaSrc && version === lavaVer) return;
      lavaSrc = data;
      lavaVer = version;
      const out = lavaTex.image.data as Uint16Array;
      if (data) {
        const n = Math.min(out.length, data.length);
        for (let i = 0; i < n; i++) out[i] = DataUtils.toHalfFloat(Math.min(data[i], 65504));
        out.fill(0, n);
      } else out.fill(0);
      lavaTex.needsUpdate = true;
    },
    setDarkvision(d) {
      if (d) {
        (uDvEye.value as Vector2).set(d.x, d.z);
        uDvReach.value = d.reach;
      } else uDvReach.value = 0;
    },
    setLights(lights) {
      const p = packLights(lights);
      for (let i = 0; i < LIGHT_CAP; i++) {
        (lPos.array[i] as Vector4).set(p.pos[i * 4], p.pos[i * 4 + 1], p.pos[i * 4 + 2], p.pos[i * 4 + 3]);
        (lCol.array[i] as Vector4).set(p.col[i * 4], p.col[i * 4 + 1], p.col[i * 4 + 2], p.col[i * 4 + 3]);
      }
    },
    setCasters(casters, yaw = 0) {
      for (let i = 0; i < CASTER_CAP; i++) {
        const c = i < casters.length ? casters[i] : null;
        (cA.array[i] as Vector4).set(c ? c.x : 0, c ? c.z : 0, c ? c.w : 0, c ? c.y0 : 0);
        (cB.array[i] as Vector4).set(c ? c.y1 : 0, 0, 0, 0);
        (cR.array[i] as Vector4).set(c ? c.u0 : 0, c ? c.v0 : 0, c ? c.u1 : 0, c ? c.v1 : 0);
      }
      (uRight.value as Vector2).set(Math.cos(yaw), Math.sin(yaw));
    },
    setShadows(on) {
      uShadows.value = on ? 1 : 0;
    },
    setAmbient(rgb) {
      (uAmbient.value as Vector3).set(rgb[0], rgb[1], rgb[2]);
    },
  };
}
