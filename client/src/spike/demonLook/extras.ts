// SPIKE (#441): things that make the demon live and hot: embers rising from the cracks, smoke from the mouth, and a broken
// shackle with a few links of chain on the left wrist.
import * as THREE from 'three';

interface P { age: number; life: number; pos: THREE.Vector3; vel: THREE.Vector3; size: number; seed: number }
function cloud(scene: THREE.Scene, max: number, additive: boolean) {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(max * 3), col = new Float32Array(max * 4), size = new Float32Array(max);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 4)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const uPx = { value: 1000 };
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uPx }, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, transparent: true,
    vertexShader: 'attribute vec4 aCol; attribute float aSize; uniform float uPx; varying vec4 vCol; void main(){ vCol = aCol; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = aSize*uPx/-mv.z; gl_Position = projectionMatrix*mv; }',
    fragmentShader: additive
      ? 'varying vec4 vCol; void main(){ float a = max(0., 1.-length(gl_PointCoord-0.5)*2.); gl_FragColor = vec4(vCol.rgb*a*a*vCol.a, 1.); }'
      : 'varying vec4 vCol; void main(){ float a = max(0., 1.-length(gl_PointCoord-0.5)*2.); gl_FragColor = vec4(vCol.rgb, a*a*vCol.a); }',
  }));
  pts.frustumCulled = false; scene.add(pts);
  return { g, pos, col, size, uPx, parts: [] as P[], max };
}

export function makeEmbers(scene: THREE.Scene, chest: THREE.Bone, jaw: THREE.Bone) {
  const em = cloud(scene, 120, true), sm = cloud(scene, 60, false);
  let eDue = 0, sDue = 0;
  const v = new THREE.Vector3(), rnd = Math.random;
  return (dt: number, time: number, px: number, breath: number) => {
    em.uPx.value = sm.uPx.value = px;
    eDue += dt * 16; sDue += dt * (2 + 22 * breath) * (0.4 + 0.6 * Math.max(0, Math.sin(time * 1.3)));
    while (eDue > 1) { eDue--; if (em.parts.length < em.max) em.parts.push({ age: 0, life: 1.4 + rnd() * 2, pos: chest.localToWorld(v.set((rnd() - 0.5) * 0.6, -0.25 + rnd() * 0.6, 0.18 + rnd() * 0.1)).clone(), vel: new THREE.Vector3((rnd() - 0.5) * 0.15, 0.25 + rnd() * 0.4, 0.1 + rnd() * 0.15), size: 0.012 + rnd() * 0.022, seed: rnd() * 20 }); }
    while (sDue > 1) { sDue--; if (sm.parts.length < sm.max) sm.parts.push({ age: 0, life: 1.2 + rnd() * 1.2, pos: jaw.localToWorld(v.set((rnd() < 0.5 ? -1 : 1) * 0.07, 0.02, 0.14)).clone(), vel: new THREE.Vector3((rnd() - 0.5) * 0.08, 0.22 + rnd() * 0.15, 0.12), size: 0.08 + rnd() * 0.06, seed: rnd() * 20 }); }
    for (const [c, ember] of [[em, true], [sm, false]] as const) {
      let n = 0;
      for (let i = c.parts.length - 1; i >= 0; i--) {
        const p = c.parts[i]; p.age += dt;
        if (p.age > p.life) { c.parts.splice(i, 1); continue; }
        const k = p.age / p.life;
        p.vel.x += Math.sin(time * 3 + p.seed) * dt * 0.25; p.vel.z += Math.cos(time * 2.3 + p.seed) * dt * 0.2; p.pos.addScaledVector(p.vel, dt);
        c.pos.set([p.pos.x, p.pos.y, p.pos.z], n * 3);
        if (ember) { const fl = 0.6 + 0.4 * Math.sin(time * 14 + p.seed); c.col.set([2.4, 0.9 - 0.6 * k, 0.15 * (1 - k), (1 - k) * Math.min(1, k * 6) * fl], n * 4); c.size[n] = p.size; }
        else { c.col.set([0.09, 0.07, 0.065, 0.16 * (1 - k) * Math.min(1, k * 5)], n * 4); c.size[n] = p.size * (1 + 2.5 * k); }
        n++;
      }
      c.g.setDrawRange(0, n);
      c.g.attributes.position.needsUpdate = c.g.attributes.aCol.needsUpdate = c.g.attributes.aSize.needsUpdate = true;
    }
  };
}

/** A broken shackle on the forearm (given in the bone's own space, with the arm's direction) and a hanging length of chain. */
export function makeChain(foreArm: THREE.Bone, at: THREE.Vector3, along: THREE.Vector3) {
  const iron = new THREE.MeshStandardMaterial({ color: 0x241c18, metalness: 0.75, roughness: 0.55 });
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.03, 8, 20), iron);
  cuff.scale.z = 2.2; cuff.position.copy(at); cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), along.clone().normalize()); cuff.castShadow = true;
  foreArm.add(cuff);
  const hang = new THREE.Group(); hang.position.copy(at).add(new THREE.Vector3(-0.1, 0, 0.03)); foreArm.add(hang);
  const links: THREE.Object3D[] = [];
  let parent: THREE.Object3D = hang;
  for (let i = 0; i < 6; i++) {
    const pivot = new THREE.Group(); pivot.position.y = i ? -0.075 : -0.03;
    const link = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.011, 6, 14, i === 5 ? Math.PI * 1.35 : Math.PI * 2), iron);
    link.scale.y = 1.45; link.rotation.y = i % 2 ? Math.PI / 2 : 0; link.position.y = -0.04; link.castShadow = true;
    pivot.add(link); parent.add(pivot); parent = pivot; links.push(pivot);
  }
  const q = new THREE.Quaternion(), prev = new THREE.Vector3(), now = new THREE.Vector3(), swing = new THREE.Vector2(), vel = new THREE.Vector2();
  return (dt: number, time: number) => {
    // the chain hangs straight down whatever the arm does, and swings behind the arm's movement
    hang.getWorldPosition(now);
    const ax = (now.x - prev.x) / Math.max(dt, 1e-3), az = (now.z - prev.z) / Math.max(dt, 1e-3); prev.copy(now);
    if (Math.abs(ax) + Math.abs(az) < 20) { vel.x += (-ax * 0.9 - swing.x * 30 - vel.x * 2.2) * dt; vel.y += (-az * 0.9 - swing.y * 30 - vel.y * 2.2) * dt; }
    swing.addScaledVector(vel, dt); swing.clampLength(0, 0.9);
    foreArm.getWorldQuaternion(q);
    hang.quaternion.copy(q.invert());
    links.forEach((l, i) => { l.rotation.z = -swing.x * (0.25 + 0.06 * i) + 0.02 * Math.sin(time * 1.1 + i); l.rotation.x = swing.y * (0.25 + 0.06 * i); });
  };
}
