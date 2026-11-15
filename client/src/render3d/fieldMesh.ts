import { DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, float, max, min, mix, positionWorld, sin, smoothstep, step, uniform, vec3, vec4 } from 'three/tsl';
import { TILE_ID } from '../generated/defs';
import type { Sight } from './sightNodes';
import type { TileMap } from '../sim/map';
import { WALL_H, heightAt } from './heights';
import { pushQuad, KIND } from './worldMesh';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** The 2D force field's colours (`game/forcefield.ts`): the fill 0x3a8cff and the rims and bands 0x9fd8ff. */
export const FIELD_FILL: [number, number, number] = [0x3a / 255, 0x8c / 255, 1];
export const FIELD_EDGE: [number, number, number] = [0x9f / 255, 0xd8 / 255, 1];
/** Seconds the field takes to rise from the floor (2D `FADE_IN`). */
export const FIELD_FADE_IN = 0.5;
/** The age of a field that was there when the run began: long past its fade-in. */
export const FIELD_OLD = 10;
/** Height of a rim band at the floor and at the top (tiles): one pixel of the pack's 16. */
const RIM = 1 / 16;

/** Alpha of a layer of alpha `b` lying over alpha `a`. The material builds the same maths from nodes. */
export function overAlpha(a: number, b: number): number {
  return b + a * (1 - b);
}
/** Share of the layer's colour in the result of a layer (alpha `b`) over (alpha `a`): the colour is `mix(under, layer, overWeight)`. */
export function overWeight(a: number, b: number): number {
  return b / Math.max(overAlpha(a, b), 1e-4);
}

/** The field's animated numbers: `age` seconds since it appeared. Uniforms only, set each frame (nothing is rebuilt). */
export interface FieldUniforms { age: ReturnType<typeof uniform> }
export function fieldUniforms(): FieldUniforms {
  return { age: uniform(FIELD_OLD) };
}

/**
 * The force field's material (the 2D look, `forcefield.ts`): a blue fill pulsing in strength that rises from the floor as it appears,
 * three light bands drifting up the face and bright rims at the floor and the top. Unlit and translucent, ending with the sight step
 * at its own point (#305). Per-vertex `edge` (1 on a rim band) and `y01` (0 at the floor, 1 at the top).
 */
export function fieldMaterial(sight: Sight, u: FieldUniforms): MeshBasicNodeMaterial {
  const age: N = u.age;
  const edge: N = attribute('edge', 'float'), y01: N = attribute('y01', 'float');
  const k: N = min(float(1), age.div(FIELD_FADE_IN));
  const pulse: N = sin(age.mul(3.1)).mul(0.5).add(0.5);
  const fill = vec3(...FIELD_FILL), rim = vec3(...FIELD_EDGE);
  // the fade-in rises from the floor: nothing above `k`
  const shown: N = step(y01, k.add(1e-4));
  let a: N = pulse.mul(0.1).add(0.22).mul(k);
  let rgb: N = fill;
  // a layer of colour `c` and alpha `b` lies over (rgb, a), as 2D draws bands and rims on the fill (`overAlpha`, `overWeight`)
  const over = (c: N, b: N): void => {
    const a2: N = b.add(a.mul(float(1).sub(b)));
    rgb = mix(rgb, c, b.div(max(a2, 1e-4)));
    a = a2;
  };
  // the cap (y01 = 1 all over) takes no band
  const sideOnly: N = float(1).sub(step(0.999, y01));
  for (let i = 0; i < 3; i++) {
    const p: N = float(1).sub(age.mul(0.6 + i * 0.25).add(i / 3).fract());
    const band: N = float(1).sub(smoothstep(0.0, 0.05, p.sub(y01).abs()));
    over(rim, band.mul(sideOnly).mul(sin(age.mul(5).add(i * 2)).mul(0.2).add(0.25)).mul(k));
  }
  over(rim, step(0.9, edge).mul(pulse.mul(0.35).add(0.55)).mul(k));
  const m = new MeshBasicNodeMaterial();
  m.colorNode = vec4(sight.apply(rgb, positionWorld, sight.unseenAt(positionWorld.xz)), a.mul(shown));
  m.transparent = true;
  m.depthWrite = false;
  m.side = DoubleSide;
  return m;
}

export function sealedCells(map: TileMap): [number, number][] {
  const out: [number, number][] = [];
  for (let z = 0; z < map.h; z++) for (let x = 0; x < map.w; x++) if (map.get(x, z) === TILE_ID.DoorClosed) out.push([x, z]);
  return out;
}

const NO = { x: 0, y: 0, w: 0, h: 0 };

/**
 * A box of WALL_H per DoorClosed cell: its top, and a side toward every neighbour that is lower than WALL_H and not DoorClosed.
 * 6 vertices per quad; a side is three quads (a rim band of 1 px at the floor, the middle, a rim band at the top) so that `edge`
 * (1 on a rim band, else 0) needs no interpolation. `y01` is the height over WALL_H.
 */
export function buildField(map: TileMap): { position: Float32Array; edge: Float32Array; y01: Float32Array; count: number } {
  const sink = { position: [] as number[], uv: [] as number[], normal: [] as number[], kind: [] as number[], rect: [] as number[] };
  const H = WALL_H;
  for (const [x, z] of sealedCells(map)) {
    pushQuad(sink, [[x, H, z, 0, 0], [x + 1, H, z, 0, 0], [x + 1, H, z + 1, 0, 0], [x, H, z + 1, 0, 0]], [0, 1, 0], KIND.top, NO);
    // dx, dz, then the edge ends (left and right seen from outside)
    const sides: [number, number, number, number, number, number][] = [
      [0, 1, 0, 1, 1, 1], [0, -1, 1, 0, 0, 0], [1, 0, 1, 1, 1, 0], [-1, 0, 0, 0, 0, 1],
    ];
    for (const [dx, dz, ax, az, bx, bz] of sides) {
      if (heightAt(map, x + dx, z + dz) >= H || map.get(x + dx, z + dz) === TILE_ID.DoorClosed) continue;
      // bands from the top down; u of the corner holds the rim flag
      const ys = [H, H - RIM, RIM, 0];
      for (let b = 0; b < 3; b++) {
        const rim = b === 1 ? 0 : 1;
        pushQuad(sink, [[x + ax, ys[b], z + az, rim, 0], [x + bx, ys[b], z + bz, rim, 0], [x + bx, ys[b + 1], z + bz, rim, 0], [x + ax, ys[b + 1], z + az, rim, 0]], [dx, 0, dz], KIND.face, NO);
      }
    }
  }
  const count = sink.kind.length, edge = new Float32Array(count), y01 = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // the top cap is no rim; a side's rim flag rode in the uv
    edge[i] = sink.normal[i * 3 + 1] === 1 ? 0 : sink.uv[i * 2];
    y01[i] = sink.position[i * 3 + 1] / H;
  }
  return { position: new Float32Array(sink.position), edge, y01, count };
}
