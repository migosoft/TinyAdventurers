// The light shafts in TSL (#307): the dungeon 3D demo's `shafts` march and its `compProg` composite.
// The march runs once per art pixel into a small half-float target: from the surface point of the pre-pass depth it walks toward
// the camera up to the ceiling and sums every crack's light that reaches each sample (the same mask that lights the floor patch).
// The composite lays that texture over the picture, additively, through a 5-tap blur. Nothing here moves with time: the sample
// offset is fixed per pixel, so the picture holds still.
import { CustomBlending, DepthTexture, Matrix4, NodeMaterial, OneFactor, Texture, Vector2, Vector3, ZeroFactor } from 'three/webgpu';
import {
  Break, Fn, If, Loop, dot, float, floor, fract, getViewPosition, screenCoordinate, screenUV, select, texture, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import type { Lighting } from '../lightNodes';
import type { Sight } from '../sightNodes';
import { CRACK_CAP } from './cracks';
import { BLUR_CENTRE, BLUR_DIAG, SHAFT_GAIN, SHAFT_STEPS } from './shafts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** What a frame gives the pass. */
export interface ShaftFrame {
  /** The depth of the opaque scene, drawn by the pre-pass camera. */
  depth: DepthTexture;
  /** The march's result (the texture of the march target). */
  shaft: Texture;
  /** The pre-pass camera's inverse projection and world matrix (read after its render: the renderer sets the clip space). */
  projInv: Matrix4;
  camWorld: Matrix4;
  /** Unit vector from the ground toward the camera. */
  toward: Vector3;
  /** The highest ceiling of the frame's cracks (tiles). */
  top: number;
  /** The composite's scale of the picture's uv into the shaft texture's, and the shaft texture's texel. */
  uvScale: Vector2;
  texel: Vector2;
}

export interface ShaftPass {
  /** Full-screen: reads the pre-pass depth, rebuilds the surface point, marches, writes rgb. */
  march: NodeMaterial;
  /** Full-screen, additive: the 5-tap blur of the shaft texture. */
  composite: NodeMaterial;
  set(o: ShaftFrame): void;
  /** The frame's uniform nodes (for tests): `set` writes their values. */
  readonly uniforms: { top: N; toward: N; uvScale: N; texel: N };
  dispose(): void;
}

/** A loop from 0 to `end` whose index is called `name` (as `named` in lightNodes.ts). */
const named = (name: string, end: number): N => ({ start: 0, end, name });

export function makeShaftPass(lighting: Lighting, sight: Sight): ShaftPass {
  const standIn = new DepthTexture(1, 1);
  const depthNode = texture(standIn).setName('shaftDepth');
  const shaftNode = texture(new Texture()).setName('shaftTex');
  const uProjInv = uniform(new Matrix4());
  const uCamWorld = uniform(new Matrix4());
  const uToward = uniform(new Vector3(0, 1, 0));
  const uTop = uniform(1);
  const uUvScale = uniform(new Vector2(1, 1));
  const uTexel = uniform(new Vector2(1, 1));

  // The march. Everything that samples a texture (the depth, the sight mask) sits at the top level, before any branch or loop.
  const uv = screenUV;
  const marchColour = Fn(() => {
    const depth = depthNode.sample(uv).x.toVar();
    const world = (d: N): N => uCamWorld.mul(vec4(getViewPosition(uv, d, uProjInv), 1)).xyz;
    // Orthographic: the ray is the same everywhere. Where nothing was drawn, the point is where the ray meets the ground (y = 0).
    const nearP = world(float(0));
    const ground = nearP.sub(uToward.mul(nearP.y.div(uToward.y)));
    const P: N = select(depth.greaterThanEqual(1), ground, world(depth)).toVar();
    const u = sight.unseenAt(P.xz);
    const dt = uTop.sub(P.y).max(0).div(uToward.y).div(SHAFT_STEPS).toVar();
    // The interleaved-gradient offset of this pixel (ignOffset in shafts.ts): fixed per pixel, never per frame.
    const j = fract(float(52.9829189).mul(fract(dot(floor(screenCoordinate.xy), vec2(0.06711056, 0.00583715)))));
    const acc = vec3(0).toVar();
    Loop(named('sm', SHAFT_STEPS), ({ sm: k }: N) => {
      const Q = P.add(uToward.mul(float(k).add(j).mul(dt)));
      Loop(named('ss', CRACK_CAP), ({ ss: s }: N) => {
        If(float(s).greaterThanEqual(lighting.cracks.count), () => {
          Break();
        });
        const m = lighting.cracks.mask(Q, s).toVar();
        If(m.greaterThanEqual(0.01), () => {
          const cr = lighting.cracks.at(s);
          const v = float(1).toVar();
          If(lighting.shadowsOn.greaterThan(0.5), () => {
            v.assign(lighting.sunRayVis(Q, cr.dir, float(-1), s));
          });
          acc.addAssign(cr.rgb.mul(m.mul(v)));
        });
      });
    });
    // Hidden from the hero: gone where the sight mask hides the surface, dimmed in the soft shade (dark maps).
    return vec4(sight.dim(acc.mul(dt).mul(SHAFT_GAIN), u.y).mul(sight.shown(u.x, 0)), 1);
  });
  const march = new NodeMaterial();
  march.fragmentNode = marchColour();
  march.depthTest = false;
  march.depthWrite = false;

  // The composite: the demo's 5 taps (the centre and the four diagonals).
  const cuv = vec2(0.5).add(uv.sub(0.5).mul(uUvScale));
  const tap = (dx: number, dy: number): N => shaftNode.sample(cuv.add(uTexel.mul(vec2(dx, dy)))).rgb;
  const blurred = tap(0, 0).mul(BLUR_CENTRE).add(tap(1, 1).add(tap(-1, 1)).add(tap(1, -1)).add(tap(-1, -1)).mul(BLUR_DIAG));
  const composite = new NodeMaterial();
  composite.fragmentNode = vec4(blurred, 1);
  composite.depthTest = false;
  composite.depthWrite = false;
  composite.transparent = true;
  // gl.ONE, gl.ONE on the colour; the alpha stays as it is.
  composite.blending = CustomBlending;
  composite.blendSrc = OneFactor;
  composite.blendDst = OneFactor;
  composite.blendSrcAlpha = ZeroFactor;
  composite.blendDstAlpha = OneFactor;

  return {
    march,
    composite,
    uniforms: { top: uTop, toward: uToward, uvScale: uUvScale, texel: uTexel },
    set(o) {
      depthNode.value = o.depth;
      shaftNode.value = o.shaft;
      (uProjInv.value as Matrix4).copy(o.projInv);
      (uCamWorld.value as Matrix4).copy(o.camWorld);
      (uToward.value as Vector3).copy(o.toward);
      uTop.value = o.top;
      (uUvScale.value as Vector2).copy(o.uvScale);
      (uTexel.value as Vector2).copy(o.texel);
    },
    dispose() {
      march.dispose();
      composite.dispose();
      standIn.dispose();
    },
  };
}
