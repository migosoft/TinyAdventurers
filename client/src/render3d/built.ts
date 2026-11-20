// Vertex streams of a figure that is built in code and refilled every frame (the lich, #358): types only, shared by the builders.

export type V3 = [number, number, number];

/** Vertex streams of a fixed size, refilled every frame; only the first `verts` and `indices` count. `look`: 2 floats, [unlit 0|1, shade]. */
export interface BuiltBuf {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  colour: Float32Array;
  look: Float32Array;
  index: Uint32Array;
  verts: number;
  indices: number;
}

export function newBuiltBuf(maxVerts: number, maxIndices: number): BuiltBuf {
  return {
    position: new Float32Array(maxVerts * 3),
    normal: new Float32Array(maxVerts * 3),
    uv: new Float32Array(maxVerts * 2),
    colour: new Float32Array(maxVerts * 3),
    look: new Float32Array(maxVerts * 2),
    index: new Uint32Array(maxIndices),
    verts: 0,
    indices: 0,
  };
}
