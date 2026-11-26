// SPIKE (#379): the demon's surfaces, painted in the shader from each point's place on the resting body (so the paint sticks to
// the skin when the bones move): rock plates with lava in the grooves, horn, and the torn skin of the wings.
import * as THREE from 'three';
import { EYE, MOUTH } from './body';

export const uTime = { value: 0 };

const NOISE = /* glsl */ `
vec3 hash3(vec3 p){ p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6))); return fract(sin(p)*43758.5453123); }
float hash1(vec3 p){ return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453); }
float vnoise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash1(i),hash1(i+vec3(1,0,0)),f.x),mix(hash1(i+vec3(0,1,0)),hash1(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash1(i+vec3(0,0,1)),hash1(i+vec3(1,0,1)),f.x),mix(hash1(i+vec3(0,1,1)),hash1(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ return vnoise(p)*.5+vnoise(p*2.03+3.1)*.25+vnoise(p*4.01+7.7)*.125+vnoise(p*8.1+1.3)*.0625; }
// x: how far from the nearest groove between two cells, y: a random number of the cell
vec2 voro(vec3 x){ vec3 n=floor(x), f=fract(x); float d1=8., d2=8.; vec3 id=vec3(0.);
  for(int k=-1;k<=1;k++) for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec3 g=vec3(float(i),float(j),float(k)); vec3 o=hash3(n+g); vec3 r=g+o-f; float d=dot(r,r);
    if(d<d1){ d2=d1; d1=d; id=n+g; } else if(d<d2) d2=d; }
  return vec2(sqrt(d2)-sqrt(d1), hash1(id)); }
vec3 bumped(vec3 n, vec3 viewPos, float h, float face){
  vec3 sx=dFdx(viewPos), sy=dFdy(viewPos); vec3 r1=cross(sy,n), r2=cross(n,sx); float det=dot(sx,r1)*face;
  vec3 g=sign(det)*(dFdx(h)*r1+dFdy(h)*r2); return normalize(abs(det)*n-g); }
`;

function patch(m: THREE.MeshStandardMaterial, uniforms: Record<string, { value: unknown }>, decl: string, surface: string) {
  m.customProgramCacheKey = () => decl; // three shares a program between materials whose hook has the same source
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, { uTime });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aInfo; varying vec3 vRest; varying vec4 vInfo; varying vec2 vSt;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position; vInfo = aInfo; vSt = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; varying vec3 vRest; varying vec4 vInfo; varying vec2 vSt;\nvec3 dAlb; vec3 dEmit; float dRough; float dH;\n${NOISE}\n${decl}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n{ ${surface} }\ndiffuseColor.rgb = dAlb;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = dRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = bumped(normal, -vViewPosition, dH, faceDirection);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += dEmit;');
  };
  return m;
}

/** The body, the horns and claws, the tail and the wings' bones. */
export function skinMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.7, side: THREE.DoubleSide });
  return patch(m, { uEye: { value: new THREE.Vector3(...EYE) }, uMouth: { value: new THREE.Vector3(...MOUTH) } }, 'uniform vec3 uEye; uniform vec3 uMouth;', /* glsl */ `
    vec3 p = vRest;
    vec2 v1 = voro(p*7.5+3.);
    vec2 v2 = voro(p*22.);
    float n = fbm(p*5.);
    float plate = smoothstep(0.02, 0.2, v1.x);
    float scale = smoothstep(0.0, 0.3, v2.x);
    float limb = vInfo.w;
    float h = plate*(0.7+0.5*v1.y) + scale*(0.12+0.3*limb) + n*0.35;
    vec3 rock = mix(vec3(0.04,0.033,0.032), vec3(0.17,0.105,0.085), clamp(0.15+0.55*v1.y*plate+0.35*n, 0., 1.));
    rock *= mix(0.4, 1., plate) * mix(0.7, 1., scale) * (1.-0.75*limb);
    float streak = fbm(p*vec3(26.,9.,26.));
    vec3 horn = mix(mix(vec3(0.035,0.028,0.028), vec3(0.2,0.11,0.08), streak*streak), vec3(0.5,0.36,0.22), vInfo.z*0.8);
    dAlb = mix(rock, horn, vInfo.y);
    dH = mix(h, streak*0.5, vInfo.y) * 0.012;
    dRough = mix(mix(0.9, 0.55, plate), 0.38, vInfo.y);
    // lava in the grooves: in patches, strongest on the chest and belly, breathing slowly up the body
    float patchy = smoothstep(0.5, 0.66, fbm(p*2.6+7.) + vInfo.x*0.42 - 0.12) * vInfo.x;
    float crack = 1.-smoothstep(0.0, 0.045, v1.x);
    float pulse = 0.72+0.28*sin(uTime*1.6 - p.y*3.5);
    dEmit = crack*crack*patchy*vInfo.x*pulse * mix(vec3(1.,0.16,0.01), vec3(1.,0.55,0.12), crack*crack) * 2.2;
    dEmit += vInfo.z * vec3(1.,0.3,0.04) * 0.1;
    // the eyes: slanted slits; the mouth: a jagged glowing maw
    vec3 e = p - vec3(sign(p.x)*uEye.x, uEye.y, uEye.z); float sl = sign(p.x)*0.45;
    e.xy = vec2(e.x*cos(sl)+e.y*sin(sl), -e.x*sin(sl)+e.y*cos(sl));
    float eye = 1.-smoothstep(0.6, 1., length(e/vec3(0.05,0.022,0.06)));
    vec3 q = (p-uMouth)/vec3(0.09,0.03,0.08);
    float fang = abs(fract(p.x*26.)-0.5)*2.;
    float maw = (1.-smoothstep(0.5, 1., length(q))) * step(abs(q.y)*1.5, fang);
    dEmit += (eye*vec3(1.,0.62,0.16)*4. + maw*vec3(1.,0.4,0.06)*2.) * (0.85+0.15*sin(uTime*3.1));
    dAlb *= 1.-0.8*max(eye, maw);
  `);
}

/** Thin skin: the wings' webbing (torn, with holes and burnt rims) and the loincloth. */
export function sheetMaterial(wing: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.8, side: THREE.DoubleSide });
  return patch(m, { uWing: { value: wing ? 1 : 0 } }, 'uniform float uWing;', /* glsl */ `
    float s = fract(vSt.x), t = vSt.y, u = vSt.x;
    vec3 p = vec3(u*3., t*4., floor(vSt.x)*1.7);
    float rag = 0.015 + 0.16*pow(fbm(vec3(u*7., 0.3, 2.)), 1.5) + 0.06*pow(abs(sin(u*17.+sin(u*7.)*2.)), 4.);
    float hn = fbm(p*vec3(1.3,0.8,1.)+11.);
    float edge = t - (1.-rag);
    float hole = uWing * smoothstep(0.25, 0.5, t) * hn;
    if (edge > 0. || hole > 0.66) discard;
    float burn = max(smoothstep(-0.09, 0., edge), smoothstep(0.56, 0.66, hole));
    float fine = fbm(vec3(u*40., t*14., 3.));
    float vein = 1.-smoothstep(0., 0.06, voro(vec3(u*5., t*7., 1.)).x);
    float bone = smoothstep(0.12, 0., min(s, 1.-s));
    vec3 web = mix(vec3(0.36,0.03,0.028), vec3(0.13,0.012,0.016), clamp(0.1+0.5*t+0.5*fine, 0., 1.));
    web *= 1.-0.35*vein; web = mix(web, vec3(0.1,0.02,0.02), bone*0.7);
    vec3 hide = mix(vec3(0.16,0.07,0.045), vec3(0.07,0.035,0.03), fine) * (1.-0.5*t);
    dAlb = mix(mix(hide, web, uWing), vec3(0.02,0.015,0.015), burn);
    dH = (fine*0.4 + vein*0.4 + sin(s*3.14159*3.)*0.6*uWing) * 0.012;
    dRough = 0.85 - 0.25*uWing*(1.-burn);
    // light through the thin skin, and embers along the burnt rims
    dEmit = web * uWing * 0.1 * (1.-burn);
  `);
}
