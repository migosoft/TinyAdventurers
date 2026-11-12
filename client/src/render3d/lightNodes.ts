// The light of the 3D view in TSL: point lights with a grid-walk wall shadow (port of the demo's lightAt / wallVis).
import { Vector3, Vector4 } from 'three/webgpu';
import type { DataTexture } from 'three/webgpu';
import { Break, Fn, If, Loop, abs, exp, float, floor, int, ivec2, length, max, min, mix, select, smoothstep, textureLoad, uniform, uniformArray, dot } from 'three/tsl';
import { AMBIENT, LIGHT_CAP, packLights, type Light } from './light';

// TSL's node types are too narrow for swizzles and mixed scalar/vector maths; the nodes are untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export interface Lighting {
  /** vec3: ambient plus the lights; P and N are vec3 nodes, wrap a float node or number. */
  lightAt(P: N, N: N, wrap: N): N;
  /** mix(col, 1 - exp(-1.6 col), smoothstep(0.55, 1.1, col)) */
  shoulder(col: N): N;
  /** ivec2 cell -> wall height in tiles, clamped to the map. */
  cellH(cell: N): N;
  setLights(lights: Light[]): void;
  setShadows(on: boolean): void;
  /** The ambient light (a uniform); `AMBIENT` is its start value. */
  setAmbient(rgb: [number, number, number]): void;
}

export function makeLighting(heightTex: DataTexture, map: { w: number; h: number }): Lighting {
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

  const lightAt = (P: N, Nrm: N, wrap: N): N => {
    const w = typeof wrap === 'number' ? float(wrap) : wrap;
    return Fn(() => {
      const sum = ambient.toVar();
      const Po = P.add(Nrm.mul(0.03));
      Loop(LIGHT_CAP, ({ i }: N) => {
        const lp: N = lPos.element(i);
        const lc: N = lCol.element(i);
        const L = lp.xyz;
        const rad = lp.w;
        const d = L.sub(P);
        const dist = length(d);
        If(dist.lessThan(rad), () => {
          const k = dist.div(rad);
          const f = float(1).sub(k.mul(k).mul(float(3).sub(k.mul(2))));
          const ndl = mix(max(dot(Nrm, d.div(max(dist, 1e-3))), 0), float(1), w);
          const v = float(1).toVar();
          If(lc.w.greaterThan(0.5).and(uShadows.greaterThan(0.5)), () => {
            v.assign(wallVis(Po, L));
          });
          sum.addAssign(lc.xyz.mul(f.mul(ndl).mul(v)));
        });
      });
      return sum;
    })();
  };

  const shoulder = (col: N): N => mix(col, float(1).sub(exp(col.mul(-1.6))), smoothstep(0.55, 1.1, col));

  return {
    lightAt,
    shoulder,
    cellH,
    setLights(lights) {
      const p = packLights(lights);
      for (let i = 0; i < LIGHT_CAP; i++) {
        (lPos.array[i] as Vector4).set(p.pos[i * 4], p.pos[i * 4 + 1], p.pos[i * 4 + 2], p.pos[i * 4 + 3]);
        (lCol.array[i] as Vector4).set(p.col[i * 4], p.col[i * 4 + 1], p.col[i * 4 + 2], p.col[i * 4 + 3]);
      }
    },
    setShadows(on) {
      uShadows.value = on ? 1 : 0;
    },
    setAmbient(rgb) {
      (uAmbient.value as Vector3).set(rgb[0], rgb[1], rgb[2]);
    },
  };
}
