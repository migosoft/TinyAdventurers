// SPIKE (#441): a great burning scimitar in the demon's right hand. The blade is white-hot at the edge and toward the point;
// flames rise from it and molten metal gathers on the edge, drips, and cools in small puddles on the floor.
import * as THREE from 'three';

const LEN = 1.75, BEND = 0.42;
const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** The blade in its own space: z runs along it, y is the back (the edge is down), x its thickness. */
const spine = (u: number) => new THREE.Vector3(0, BEND * u * u, LEN * u);
const width = (u: number) => (0.11 + 0.13 * sm(0, 0.72, u)) * (1 - sm(0.74, 1, u) ** 1.4) + 0.004;
function edgeAt(u: number): THREE.Vector3 {
  const t = new THREE.Vector3(0, 2 * BEND * u, LEN).normalize();
  return spine(u).add(new THREE.Vector3(0, -t.z, t.y).multiplyScalar(width(u)));
}

function bladeGeometry(): THREE.BufferGeometry {
  const N = 48, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, s = spine(u), e = edgeAt(u), th = 0.024 * (1 - 0.7 * u);
    pos.push(th, s.y, s.z, -th, s.y, s.z, 0, e.y, e.z); uv.push(u, 0, u, 0, u, 1);
    if (i) { const a = (i - 1) * 3, b = i * 3; idx.push(a, a + 2, b, b, a + 2, b + 2, a + 1, b + 1, a + 2, b + 1, b + 2, a + 2, a, b, a + 1, b, b + 1, a + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

const uTime = { value: 0 };
function bladeMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x0c0908, metalness: 0.85, roughness: 0.4, flatShading: true, side: THREE.DoubleSide });
  m.customProgramCacheKey = () => 'blade';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vBl;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvBl = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        uniform float uTime; varying vec2 vBl;
        float bh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
        float bn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
          return mix(mix(bh(i), bh(i+vec2(1,0)), f.x), mix(bh(i+vec2(0,1)), bh(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        // heat: the back near the hilt is dark iron, the edge and the point are white-hot, and the glow crawls like melt
        float flow = bn(vec2(vBl.x*9. - uTime*0.7, vBl.y*3. + uTime*0.25))*0.6 + bn(vec2(vBl.x*23. - uTime*1.3, vBl.y*7.))*0.4;
        float heat = clamp(0.12 + 0.62*pow(vBl.y, 1.3) + 0.38*vBl.x + 0.45*(flow - 0.5), 0., 1.);
        vec3 hot = mix(vec3(0.25,0.012,0.0), vec3(1.0,0.22,0.02), smoothstep(0.2, 0.5, heat));
        hot = mix(hot, vec3(1.0,0.72,0.3), smoothstep(0.5, 0.75, heat));
        hot = mix(hot, vec3(1.0,0.97,0.88), smoothstep(0.75, 0.97, heat));
        totalEmissiveRadiance += hot * (0.12 + 1.7*heat*heat) * smoothstep(0.08, 0.3, heat);
        diffuseColor.rgb *= 1. - 0.7*heat;`);
  };
  return m;
}

interface P { kind: 0 | 1 | 2; age: number; life: number; pos: THREE.Vector3; vel: THREE.Vector3; u: number; size: number; seed: number }

export interface Sword { update(dt: number, time: number, px: number): void }
/** Puts the sword into the hand bone (the grip at `grip`, in the bone's own space) and returns its per-frame update. */
export function makeSword(scene: THREE.Scene, hand: THREE.Bone, grip: THREE.Vector3): Sword {
  const sword = new THREE.Group();
  // the blade runs forward and a little down from the fist, its back up
  const D = new THREE.Vector3(-0.12, -0.2, 1).normalize(), X = new THREE.Vector3(1, 0, 0), U = new THREE.Vector3().crossVectors(D, X).normalize();
  X.crossVectors(U, D);
  sword.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, U, D));
  sword.position.copy(grip);
  const iron = new THREE.MeshStandardMaterial({ color: 0x1a1210, metalness: 0.8, roughness: 0.5 });
  const blade = new THREE.Mesh(bladeGeometry(), bladeMaterial()); blade.position.z = 0.15;
  const gripM = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.042, 0.4, 10), new THREE.MeshStandardMaterial({ color: 0x1c0d09, roughness: 0.9 })); gripM.rotation.x = Math.PI / 2; gripM.position.z = -0.06;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.05), iron); guard.position.set(0, -0.04, 0.14); guard.rotation.x = 0.25;
  const hornA = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 6), iron); hornA.position.set(0, 0.17, 0.2); hornA.rotation.x = 1.1;
  const hornB = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 6), iron); hornB.position.set(0, -0.25, 0.14); hornB.rotation.x = 2.3;
  const pommel = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), iron); pommel.position.z = -0.29;
  for (const m of [blade, gripM, guard, hornA, hornB, pommel]) { m.castShadow = true; sword.add(m); }
  hand.add(sword);
  const light = new THREE.PointLight(0xffa24a, 2.6, 7, 2); light.position.set(0, 0.1, 1.0); sword.add(light);

  // flames, hanging beads and falling drops: one cloud of soft additive points
  const MAX = 520, parts: P[] = [];
  const pg = new THREE.BufferGeometry();
  const pPos = new Float32Array(MAX * 3), pCol = new Float32Array(MAX * 4), pSize = new Float32Array(MAX);
  pg.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pg.setAttribute('aCol', new THREE.BufferAttribute(pCol, 4)); pg.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
  const uPx = { value: 1000 };
  const cloud = new THREE.Points(pg, new THREE.ShaderMaterial({
    uniforms: { uPx }, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    vertexShader: 'attribute vec4 aCol; attribute float aSize; uniform float uPx; varying vec4 vCol; void main(){ vCol = aCol; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = aSize*uPx/-mv.z; gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'varying vec4 vCol; void main(){ float r = length(gl_PointCoord-0.5)*2.; float a = max(0., 1.-r); gl_FragColor = vec4(vCol.rgb*a*a*vCol.a, 1.); }',
  }));
  cloud.frustumCulled = false; scene.add(cloud);

  // puddles of metal cooling on the floor
  const SPL = 36, splats: { m: THREE.Mesh; age: number; size: number }[] = [];
  const disc = new THREE.CircleGeometry(1, 14); disc.rotateX(-Math.PI / 2);
  for (let i = 0; i < SPL; i++) {
    const m = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ color: 0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    m.visible = false; scene.add(m); splats.push({ m, age: 99, size: 0.05 });
  }
  let nextSplat = 0, flameDue = 0, dripDue = 0;
  const tmp = new THREE.Vector3(), prev = new THREE.Vector3(), tipVel = new THREE.Vector3();
  const world = (u: number, out: THREE.Vector3) => blade.localToWorld(out.copy(edgeAt(u)));
  const rnd = Math.random;

  function update(dt: number, time: number, px: number) {
    uTime.value = time; uPx.value = px;
    light.intensity = 2.6 * (0.85 + 0.15 * Math.sin(time * 17) * Math.sin(time * 5.3));
    world(0.8, tmp); tipVel.copy(tmp).sub(prev).divideScalar(Math.max(dt, 1e-3)); prev.copy(tmp);
    if (tipVel.length() > 30) tipVel.set(0, 0, 0);
    flameDue += dt * 260; dripDue += dt * (3.2 + tipVel.length() * 2.5);
    while (flameDue > 1 && parts.length < MAX - 30) {
      flameDue--;
      const u = 0.06 + 0.94 * Math.sqrt(rnd()), p = blade.localToWorld(spine(u).lerp(edgeAt(u), rnd()));
      parts.push({ kind: 0, age: 0, life: 0.3 + rnd() * 0.45, pos: p, vel: new THREE.Vector3((rnd() - 0.5) * 0.12, 0.35 + rnd() * 0.55, (rnd() - 0.5) * 0.12).addScaledVector(tipVel, 0.25), u, size: 0.2 + 0.2 * rnd(), seed: rnd() * 9 });
    }
    flameDue = Math.min(flameDue, 3);
    while (dripDue > 1) {
      dripDue--;
      if (parts.length < MAX) { const u = 0.15 + 0.83 * rnd(); parts.push({ kind: 1, age: 0, life: 0.25 + rnd() * 0.45, pos: world(u, new THREE.Vector3()), vel: new THREE.Vector3(), u, size: 0.05 + 0.04 * rnd(), seed: rnd() }); }
    }
    let n = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.age += dt;
      let r = 1, g = 1, b = 1, a = 1, size = p.size;
      if (p.kind === 0) {
        if (p.age > p.life) { parts.splice(i, 1); continue; }
        const k = p.age / p.life;
        p.vel.x += Math.sin(time * 9 + p.seed) * dt * 0.6; p.pos.addScaledVector(p.vel, dt);
        r = 1; g = 0.75 - 0.6 * k; b = 0.35 * (1 - k) ** 3; a = 0.1 * (1 - k) * Math.min(1, k * 8); size = p.size * (1 - 0.75 * k);
      } else if (p.kind === 1) { // a bead swelling on the edge, then it lets go
        world(p.u, p.pos); p.pos.y -= 0.012 * (p.age / p.life);
        size = p.size * (0.4 + 0.6 * p.age / p.life); r = 3; g = 2.6; b = 1.9;
        if (p.age > p.life) { p.kind = 2; p.age = 0; p.life = 4; p.vel.copy(tipVel).multiplyScalar(0.5); }
      } else {
        p.vel.y -= 9 * dt; p.pos.addScaledVector(p.vel, dt);
        r = 3; g = 2.4; b = 1.5;
        if (p.pos.y < 0.02 || p.age > p.life) {
          if (p.pos.y < 0.02) { const s = splats[nextSplat++ % SPL]; s.age = 0; s.size = p.size * (1.1 + rnd()); s.m.position.set(p.pos.x, 0.012 + 0.0004 * (nextSplat % SPL), p.pos.z); s.m.visible = true; }
          parts.splice(i, 1); continue;
        }
      }
      pPos.set([p.pos.x, p.pos.y, p.pos.z], n * 3); pCol.set([r, g, b, a], n * 4); pSize[n] = size; n++;
    }
    pg.setDrawRange(0, n);
    pg.attributes.position.needsUpdate = pg.attributes.aCol.needsUpdate = pg.attributes.aSize.needsUpdate = true;
    for (const s of splats) {
      if (!s.m.visible) continue;
      s.age += dt;
      const k = s.age / 2.6;
      if (k > 1) { s.m.visible = false; continue; }
      const grow = s.size * (1 + 0.8 * Math.min(1, s.age * 6));
      s.m.scale.set(grow, 1, grow);
      // white-hot, then orange, then a dull red that dies
      const c = (s.m.material as THREE.MeshBasicMaterial).color, heat = (1 - k) ** 2;
      c.setRGB(3 * heat + 0.25 * (1 - k), 2.4 * heat ** 2 + 0.03 * (1 - k), 1.5 * heat ** 4);
    }
  }
  return { update };
}
