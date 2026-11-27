// The plant shadows' lookup in TSL (#333): the shader twin of `pointVisAt` and `crackVisAt` (plantShadow.ts), which it mirrors line by line.
// It sits inside the light and crack loops, which are not uniform control flow on WebGPU, so it never samples with a compare: it loads four
// texels of the depth atlas (`textureLoad`), compares each by hand (0 or 1) and mixes them by the bilinear weights, every texel clamped inside its tile.
import { DepthTexture, Vector4 } from 'three/webgpu';
import { Fn, If, abs, clamp, cross, dot, float, floor, int, ivec2, max, min, mix, select, texture, uniform, vec3 } from 'three/tsl';
import { sharedArray } from './sharedArray';
import { CRACK_BIAS, FACES, PLANT_BIAS, PLANT_FAR, PLANT_NEAR, TABLE_LEN } from './plantShadow';
import { LIGHT_CAP } from './light';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export interface PlantShadow {
  /** 1 (lit) or less: the plant shadow at the world point P from light slot `slot` (an int node) at L (a vec3 node). */
  pointVis(P: N, slot: N, L: N): N;
  /** The same for crack slot `slot` (an int node): the crack's tile along its beam. */
  crackVis(P: N, slot: N): N;
  /** Takes the frame's table (`packTable`'s TABLE_LEN * 4 floats), the atlas depth texture and its size in texels. */
  set(table: Float32Array, depth: DepthTexture, atlasTexels: number): void;
}

export function makePlantShadow(): PlantShadow {
  const table = sharedArray(Array.from({ length: TABLE_LEN }, () => new Vector4()), 'vec4').setName('plantTable');
  const uAtlas = uniform(1).setName('plantAtlas');
  const atlas = texture(new DepthTexture(1, 1));
  const head: N = table.element(0);

  /** `vals[face]` as a vec3 node (a chain of selects over constants). */
  const pick = (face: N, vals: readonly (readonly number[])[]): N =>
    vals.reduceRight<N>((acc, v, i) => (acc ? select(face.lessThan(i + 0.5), vec3(v[0], v[1], v[2]), acc) : vec3(v[0], v[1], v[2])), null);

  // softCompare: four texel loads, a 0/1 compare each, the bilinear mix; `id` the tile (a float node), `v` unflipped.
  const soft = (id: N, u: N, v: N, depth: N, bias: number): N => {
    const perRow = head.x;
    const T = uAtlas.div(perRow);
    const col = id.sub(floor(id.div(perRow)).mul(perRow));
    const row = floor(id.div(perRow));
    const fu = clamp(u, 0, 1).mul(T).sub(0.5);
    const fv = clamp(select(head.z.greaterThan(0.5), float(1).sub(v), v), 0, 1).mul(T).sub(0.5);
    const x0 = floor(fu), y0 = floor(fv);
    const wx = fu.sub(x0), wy = fv.sub(y0);
    const at = (dx: number, dy: number): N => {
      const x = clamp(x0.add(dx), 0, T.sub(1)), y = clamp(y0.add(dy), 0, T.sub(1));
      const px = int(col.mul(T).add(x)), py = int(row.mul(T).add(y));
      return select((atlas.load(ivec2(px, py)) as N).setUpdateMatrix(false).x.greaterThanEqual(depth.sub(bias)), float(1), float(0));
    };
    const top = mix(at(0, 0), at(1, 0), wx), bot = mix(at(0, 1), at(1, 1), wx);
    return mix(top, bot, wy);
  };

  const pointVis = (P: N, slot: N, L: N): N => Fn(() => {
    const vis = float(1).toVar();
    const s = int(slot).toVar(); // a variable: the slot is the light loop's index
    If(head.y.greaterThan(0.5), () => {
      const d = P.sub(L).toVar();
      const ax = abs(d.x), ay = abs(d.y), az = abs(d.z);
      const face = select(ax.greaterThanEqual(ay).and(ax.greaterThanEqual(az)), select(d.x.greaterThanEqual(0), float(0), float(1)),
        select(ay.greaterThanEqual(az), select(d.y.greaterThanEqual(0), float(2), float(3)), select(d.z.greaterThanEqual(0), float(4), float(5)))).toVar();
      const a: N = table.element(s.mul(2).add(1)), b: N = table.element(s.mul(2).add(2));
      const id = select(face.lessThan(0.5), a.x, select(face.lessThan(1.5), a.y, select(face.lessThan(2.5), a.z, select(face.lessThan(3.5), a.w, select(face.lessThan(4.5), b.x, b.y))))).toVar();
      If(id.greaterThanEqual(0), () => {
        const F = pick(face, FACES.map((f) => f.F)), U = pick(face, FACES.map((f) => f.U));
        const R = cross(F, U);
        const aa = max(dot(d, F), PLANT_NEAR);
        const depth = min(float(1), aa.sub(PLANT_NEAR).mul(PLANT_FAR).div(aa.mul(PLANT_FAR - PLANT_NEAR)));
        const u = dot(d, R).div(aa.mul(2)).add(0.5), v = dot(d, U).div(aa.mul(2)).add(0.5);
        vis.assign(soft(id, u, v, depth, PLANT_BIAS));
      });
    });
    return vis;
  })();

  const crackVis = (P: N, slot: N): N => Fn(() => {
    const vis = float(1).toVar();
    const s = int(slot).toVar();
    If(head.y.greaterThan(0.5), () => {
      const o = s.mul(4).add(1 + 2 * LIGHT_CAP);
      const e0: N = table.element(o), e1: N = table.element(o.add(1)), e2: N = table.element(o.add(2)), e3: N = table.element(o.add(3));
      const id = e0.w.toVar();
      If(id.greaterThanEqual(0), () => {
        const d = P.sub(e0.xyz);
        const u = dot(d, e1.xyz).div(e1.w.mul(2)).add(0.5), v = dot(d, e2.xyz).div(e2.w.mul(2)).add(0.5);
        const depth = clamp(dot(d, e3.xyz).div(e3.w.mul(2)).add(0.5), 0, 1);
        If(u.greaterThanEqual(0).and(u.lessThanEqual(1)).and(v.greaterThanEqual(0)).and(v.lessThanEqual(1)), () => {
          vis.assign(soft(id, u, v, depth, CRACK_BIAS));
        });
      });
    });
    return vis;
  })();

  return {
    pointVis,
    crackVis,
    set(t, depth, atlasTexels) {
      for (let i = 0; i < TABLE_LEN; i++) (table.array[i] as Vector4).set(t[i * 4], t[i * 4 + 1], t[i * 4 + 2], t[i * 4 + 3]);
      atlas.value = depth;
      uAtlas.value = atlasTexels;
    },
  };
}

