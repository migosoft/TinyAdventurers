// SPIKE (#379): the demon's surfaces, painted in the shader from each point's place on the resting body (so the paint sticks to
// the skin when the bones move): armour plates of rock with lava in the grooves, horn, the leather of the wing bones, and the
// thin torn skin of the wings, which lets light through and hangs in pleats.
import * as THREE from 'three';
import { EYE, HORN_PATH, MOUTH } from './body';
import { on } from './opts';

export const uTime = { value: 0 };
/** How far the wings are folded (deeper pleats), and how hard the air pushes the skin in a wing beat (-1..1). */
export const uFold = { value: 0 }, uBillow = { value: 0 };
/** 0..1: the breath weapon's heat in the throat. */
export const uBreath = { value: 0 };
/** The lights that shine through the wings: world places, and colour times strength. */
export const uLPos = { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] };
export const uLCol = { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] };

const NOISE = /* glsl */ `
vec3 hash3(vec3 p){ p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6))); return fract(sin(p)*43758.5453123); }
float hash1(vec3 p){ return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453); }
float vnoise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash1(i),hash1(i+vec3(1,0,0)),f.x),mix(hash1(i+vec3(0,1,0)),hash1(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash1(i+vec3(0,0,1)),hash1(i+vec3(1,0,1)),f.x),mix(hash1(i+vec3(0,1,1)),hash1(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ return vnoise(p)*.5+vnoise(p*2.03+3.1)*.25+vnoise(p*4.01+7.7)*.125+vnoise(p*8.1+1.3)*.0625; }
// Cells whose seeds sit in staggered rows (as laid scales); jit 1 scatters them freely, less keeps the rows.
// x: how far from the nearest groove, y: a random number of the cell; cellR: from the point to its cell's seed, cellId: the cell.
vec3 cellR; vec3 cellId;
vec2 voro(vec3 x, float jit){ vec3 n=floor(x), f=fract(x); float d1=8., d2=8.;
  for(int k=-1;k<=1;k++) for(int j=-1;j<=1;j++) for(int i=-2;i<=1;i++){ vec3 g=vec3(float(i),float(j),float(k)); vec3 c=n+g;
    vec3 o=0.5+jit*(hash3(c)-0.5); o.x+=0.5*mod(c.y,2.); vec3 r=g+o-f; float d=dot(r,r);
    if(d<d1){ d2=d1; d1=d; cellR=r; cellId=c; } else if(d<d2) d2=d; }
  return vec2(sqrt(d2)-sqrt(d1), hash1(cellId)); }
vec3 bumped(vec3 n, vec3 viewPos, float hx, float hy, float face){
  vec3 sx=dFdx(viewPos), sy=dFdy(viewPos); vec3 r1=cross(sy,n), r2=cross(n,sx); float det=dot(sx,r1)*face;
  vec3 g=sign(det)*(hx*r1+hy*r2); vec3 o=abs(det)*n-g; return dot(o,o)>1e-20 ? normalize(o) : n; }
`;

interface Patch { key: string; uniforms: Record<string, { value: unknown }>; decl: string; vertex?: string; fdecl?: string; surface: string; late?: string }
function patch(m: THREE.MeshStandardMaterial, p: Patch) {
  m.customProgramCacheKey = () => p.key; // three shares a program between materials whose hook has the same source
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, p.uniforms, { uTime });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; attribute vec4 aInfo; varying vec3 vRest; varying vec4 vInfo; varying vec2 vSt;\n${p.decl}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvRest = position; vInfo = aInfo; vSt = uv;\n${p.vertex ?? ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; varying vec3 vRest; varying vec4 vInfo; varying vec2 vSt;\nvec3 dAlb; vec3 dEmit; vec3 dThin; float dRough; float dHx; float dHy;\n${NOISE}\n${p.decl}\n${p.fdecl ?? ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n{ ${p.surface} }\ndiffuseColor.rgb = dAlb;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = dRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = bumped(normal, -vViewPosition, dHx, dHy, faceDirection);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${p.late ?? ''}\ntotalEmissiveRadiance += dEmit;`)
      // one invalid pixel (a NaN) is smeared by the bloom into a big black box: never let one out
      .replace('#include <opaque_fragment>', 'if (any(isnan(outgoingLight)) || any(isinf(outgoingLight)) || !(dot(outgoingLight, outgoingLight) < 1e8)) outgoingLight = vec3(0.);\n#include <opaque_fragment>');
  };
  return m;
}

/** The body, the horns and claws, the tail, the strap and the wings' bones. */
export function skinMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.7, side: THREE.DoubleSide });
  return patch(m, {
    key: 'skin', uniforms: { uHorn: { value: HORN_PATH.map(([p, r]) => new THREE.Vector4(p[0], p[1], p[2], r)) }, uRidges: { value: on('ridges') ? 1 : 0 }, uDark: { value: on('dark') ? 1 : 0 }, uBreath, uEye: { value: new THREE.Vector3(...EYE) }, uMouth: { value: new THREE.Vector3(...MOUTH) } },
    decl: 'uniform vec3 uEye; uniform vec3 uMouth; uniform float uBreath; uniform vec4 uHorn[8]; uniform float uRidges; uniform float uDark;',
    fdecl: /* glsl */ `
    float gEdge; float gRnd; float gPlate; float gHu; float gHa; float gHd; float gRidge;
    // Where a point is on the great horn: how far along it (0 base, 1 tip), the angle round it, and how far outside its skin.
    void hornAt(vec3 p){
      float best = 1e9, acc = 0., tot = 0.;
      for (int i = 0; i < 7; i++) tot += length(uHorn[i+1].xyz - uHorn[i].xyz);
      for (int i = 0; i < 7; i++) {
        vec3 a = uHorn[i].xyz, ab = uHorn[i+1].xyz - a; float L = length(ab), t = clamp(dot(p-a, ab)/(L*L), 0., 1.);
        vec3 d = p - (a + ab*t); float dd = length(d);
        if (dd < best) { best = dd; vec3 T = ab/L, N = normalize(vec3(0.,0.,1.) - T*T.z), B = cross(T, N);
          gHu = (acc + t*L)/tot; gHa = atan(dot(d, B), dot(d, N)); gHd = dd - mix(uHorn[i].w, uHorn[i+1].w, t); }
        acc += L;
      }
    }
    // The relief at a point of the resting body. Mirrored left to right, so the plates read as grown armour.
    float relief(vec3 p0){
      vec3 p = vec3(abs(p0.x), p0.y, p0.z);
      float leather = step(1.5, vInfo.x), limb = vInfo.w;
      // the armour proper: the front of the torso, where the plates keep their rows
      float front = smoothstep(-0.05, 0.12, p0.z) * smoothstep(1.2, 1.4, p0.y) * smoothstep(2.25, 2.1, p0.y) * smoothstep(0.5, 0.36, p.x);
      vec2 v1 = voro(p*vec3(6.2,7.4,6.2)+vec3(0.,0.35,3.), mix(0.8, 0.3, front));
      float tilt = dot(cellR, hash3(cellId+5.)-0.5);
      float edge = min(v1.x, mix(8., p.x*9., front));
      vec2 v2 = voro(p*vec3(19.,23.,19.), 0.7);
      float n = fbm(p0*5.);
      float plate = smoothstep(0.015, 0.16, edge), scale = smoothstep(0.0, 0.3, v2.x);
      gEdge = edge; gRnd = v1.y; gPlate = plate;
      float rock = plate*(0.9 + 0.4*v1.y + 1.3*tilt) + scale*(0.1 + 0.3*limb) + n*0.3;
      float streak = fbm(p0*vec3(26.,9.,26.));
      float wr = fbm(p0*vec3(46.,12.,46.));
      // the great horns: ridges running their length (with a slow twist), fine ribs across, both dying out toward the hot tip
      hornAt(p);
      float oh = vInfo.y * step(gHd, 0.04) * step(2.3, p.y) * uRidges, fade = 1. - smoothstep(0.7, 0.92, gHu);
      float ridge = pow(0.5 + 0.5*cos(gHa*9. + gHu*5.), 1.6), rib = 0.5 + 0.5*cos(gHu*150. + 0.6*sin(gHa*3.));
      gRidge = mix(0.5, ridge, oh*fade);
      float hornH = (ridge*1.5 + rib*0.3)*fade + streak*0.2;
      return mix(mix(mix(rock, streak*0.5, vInfo.y*0.55), hornH, oh), wr*0.7, leather) * 0.013;
    }`,
    surface: /* glsl */ `
    vec3 p = vRest;
    float hX = relief(p + dFdx(p)), hY = relief(p + dFdy(p)), h0 = relief(p);
    dHx = hX - h0; dHy = hY - h0;
    float leather = step(1.5, vInfo.x), limb = vInfo.w, n = fbm(p*5.);
    vec3 rock = mix(vec3(0.04,0.033,0.032), vec3(0.17,0.105,0.085), clamp(0.15+0.55*gRnd*gPlate+0.35*n, 0., 1.));
    rock *= mix(0.4, 1., gPlate) * (1.-0.75*limb);
    float streak = fbm(p*vec3(26.,9.,26.));
    vec3 horn = mix(mix(vec3(0.035,0.028,0.028), vec3(0.2,0.11,0.08), streak*streak), vec3(0.5,0.36,0.22), vInfo.z*0.45);
    float wr = fbm(p*vec3(46.,12.,46.));
    vec3 hide = mix(vec3(0.05,0.022,0.02), vec3(0.2,0.07,0.05), wr*wr);
    // the great horns: near black at the base, lighter along the middle, black again toward the tip, and the tip itself hot metal
    float onHorn = vInfo.y * step(gHd, 0.04) * step(2.3, p.y);
    float hu = gHu;
    float ramp = smoothstep(0.22, 0.4, hu) * (1.-smoothstep(0.46, 0.64, hu)) * (0.45 + 0.75*gRidge);
    horn = mix(horn, mix(vec3(0.01,0.008,0.008), vec3(0.19,0.12,0.09)*(0.6+0.8*streak), ramp), onHorn);
    dAlb = mix(mix(rock, horn, max(vInfo.y*0.6, onHorn)), hide, leather);
    // darker where two parts of the body meet
    float open = mix(clamp(vInfo.x, 0., 1.), 1., leather);
    dAlb *= mix(0.12, 1., smoothstep(0.3, 0.95, open));
    // darker paint (not shadow) where parts meet and in the hollows: armpits, the insides of the joints, the middle line of
    // chest and belly, under the chest muscles, the flanks, the groin, beside the spine, round the eyes
    vec3 pa = vec3(abs(p.x), p.yz); float dk = 0.; vec3 dq;
    #define DK(c, r) dq = (pa - c)/r; dk = max(dk, exp(-dot(dq, dq)));
    DK(vec3(0.36,1.93,0.), vec3(0.1,0.14,0.14)) DK(vec3(0.69,1.57,-0.03), vec3(0.11)) DK(vec3(0.87,1.04,0.), vec3(0.09))
    DK(vec3(0.,2.28,0.), vec3(0.2,0.09,0.2)) DK(vec3(0.,1.9,0.2), vec3(0.035,0.2,0.1)) DK(vec3(0.,1.55,0.2), vec3(0.03,0.22,0.1))
    DK(vec3(0.17,1.86,0.17), vec3(0.2,0.035,0.1)) DK(vec3(0.2,1.27,0.1), vec3(0.16,0.07,0.15)) DK(vec3(0.3,0.72,0.02), vec3(0.1,0.08,0.08))
    DK(vec3(0.3,0.28,-0.1), vec3(0.09)) DK(vec3(0.13,1.85,-0.25), vec3(0.05,0.35,0.08)) DK(vec3(0.27,1.5,0.), vec3(0.08,0.1,0.2))
    DK(vec3(0.,1.15,-0.25), vec3(0.15)) DK(vec3(0.08,2.5,0.3), vec3(0.09,0.04,0.06)) DK(vec3(0.,2.28,0.2), vec3(0.12,0.05,0.12))
    dAlb *= 1. - 0.65*dk*uDark*(1.-onHorn);
    dRough = mix(mix(mix(0.98, 0.86, gPlate), 0.72, vInfo.y), 0.8, leather);
    // lava in the grooves: hottest on the chest, fading out over belly, hips, shoulders and limbs; breathing slowly up the body
    vec3 gq = (p - vec3(0.,1.84,0.06)) / vec3(0.5,0.72,0.5);
    float glow = max(exp(-dot(gq,gq)*1.2), 0.07*(1.-limb)) * (1.-vInfo.y) * (1.-leather);
    float patchy = smoothstep(0.3, 0.55, fbm(p*2.6+7.) + glow*0.75 - 0.12);
    float crack = 1.-smoothstep(0.0, mix(0.02, 0.075, glow), gEdge);
    float pulse = 0.72+0.28*sin(uTime*1.6 - p.y*3.5);
    dEmit = crack*crack*patchy*pow(max(glow, 0.), 0.7)*pulse * mix(vec3(1.,0.14,0.01), vec3(1.,0.55,0.12), crack*crack*glow) * 2.4;
    dEmit += (1.-smoothstep(0.0, 0.2, gEdge))*patchy*glow*glow * vec3(0.5,0.06,0.0);
    dEmit += vInfo.z * vec3(1.,0.3,0.04) * 0.1 * (1.-onHorn);
    float hot = smoothstep(0.8, 1., hu) * onHorn;
    dEmit += (hot*hot*vec3(1.,0.25,0.02)*1.8 + smoothstep(0.94, 1., hu)*onHorn*vec3(1.,0.7,0.3)*1.2) * (0.85+0.15*sin(uTime*2.1+p.x*4.));
    // the eyes: narrow slanted slits; the mouth: a jagged glowing maw
    vec3 e = p - vec3(sign(p.x)*uEye.x, uEye.y, uEye.z); float sl = sign(p.x)*0.42;
    e.xy = vec2(e.x*cos(sl)+e.y*sin(sl), -e.x*sin(sl)+e.y*cos(sl));
    float eye = 1.-smoothstep(0.55, 1., length(e/vec3(0.062,0.011,0.07)));
    float halo = 1.-smoothstep(0.5, 2.2, length(e/vec3(0.062,0.018,0.07)));
    vec3 q = (p-uMouth)/vec3(0.095,0.034,0.14);
    float fang = abs(fract(p.x*24.)-0.5)*2.;
    float maw = (1.-smoothstep(0.5, 1., length(q))) * step(abs(q.y)*1.5, fang);
    dEmit += (eye*vec3(1.,0.5,0.1)*3.2 + halo*halo*vec3(0.9,0.12,0.0)*0.5 + maw*vec3(1.,0.4,0.06)*(2.+6.*uBreath)) * (0.85+0.15*sin(uTime*3.1));
    dAlb *= 1.-0.8*max(eye, maw);`,
  });
}

/** Thin skin: the wings' webbing (torn, with holes and burnt rims) and the loincloth. */
export function sheetMaterial(wing: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.8, side: THREE.DoubleSide, flatShading: wing });
  return patch(m, {
    key: wing ? 'web' : 'cloth', uniforms: { uWing: { value: wing ? 1 : 0 }, uFold, uBillow, uLPos, uLCol },
    decl: 'uniform float uWing; uniform float uFold; uniform float uBillow; uniform vec3 uLPos[3]; uniform vec3 uLCol[3];',
    vertex: /* glsl */ `
    // the skin really hangs in pleats between the fingers: deeper as they close, stirred by the air, bellied by a wing beat
    float s_ = fract(uv.x), t_ = uv.y, span = sin(3.14159*s_), free_ = step(uv.x, 3.999);
    float pleat = sin(s_*3.14159*5.) * sqrt(max(span, 0.)) * t_ * (0.022 + 0.1*uFold) * mix(0.3, 1., free_);
    float wave = sin(uTime*1.4 + uv.x*5. + t_*4.) * 0.02 * t_ * span;
    transformed += objectNormal * (pleat + wave) * uWing;
    transformed.z -= uBillow * 0.2 * span * t_ * uWing;`,
    surface: /* glsl */ `
    float s = fract(vSt.x), t = vSt.y, u = vSt.x, isFree = step(u, 3.999);
    vec3 p = vec3(u*3., t*4., floor(vSt.x)*1.7);
    float rag = (0.015 + 0.16*pow(fbm(vec3(u*7., 0.3, 2.)), 1.5) + 0.06*pow(abs(sin(u*17.+sin(u*7.)*2.)), 4.)) * isFree;
    float hn = fbm(p*vec3(1.3,0.8,1.)+11.);
    float edge = t - (1.-rag);
    float hole = uWing * isFree * smoothstep(0.25, 0.5, t) * hn;
    if ((edge > 0. && isFree > 0.5) || hole > 0.66) discard;
    float burn = max(smoothstep(-0.09, 0., edge) * isFree, smoothstep(0.56, 0.66, hole));
    float fine = fbm(vec3(u*40., t*14., 3.));
    float vein = 1.-smoothstep(0., 0.06, voro(vec3(u*5., t*7., 1.), 1.).x);
    float bone = smoothstep(0.12, 0., min(s, 1.-s));
    vec3 web = mix(vec3(0.36,0.03,0.028), vec3(0.13,0.012,0.016), clamp(0.1+0.5*t+0.5*fine, 0., 1.));
    web *= 1.-0.35*vein; web = mix(web, vec3(0.1,0.02,0.02), bone*0.7);
    vec3 hide = mix(vec3(0.16,0.07,0.045), vec3(0.07,0.035,0.03), fine) * (1.-0.5*t);
    dAlb = mix(mix(hide, web, uWing), vec3(0.02,0.015,0.015), burn);
    float h0 = (fine*0.4 + vein*0.4) * 0.008;
    dHx = dFdx(h0); dHy = dFdy(h0);
    dRough = 0.85 - 0.25*uWing*(1.-burn);
    dEmit = vec3(0.);
    // how much light gets through: less at the veins, beside the bones and where it is burnt
    dThin = vec3(1.,0.13,0.05) * uWing * (1.-burn) * (1.-0.6*vein) * (1.-0.8*bone) * (0.35+0.9*fine*fine) * (0.5+0.5*t);`,
    late: /* glsl */ `
    // light from behind comes through the thin skin
    for (int i = 0; i < 3; i++) {
      vec3 lv = (viewMatrix * vec4(uLPos[i], 1.)).xyz + vViewPosition; float d = length(lv);
      dEmit += dThin * uLCol[i] * max(0., dot(-normal, lv/d)) / pow(d, 1.8) * 0.045;
    }`,
  });
}
