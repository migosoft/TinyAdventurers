// SPIKE (#379): the demon in a smooth, lit look on a skeleton. A throwaway page (plain three.js, not the game's 3D view):
// /demon-look.html?mode=stand|look|attack|fly&t=<s pinned>&fold=<0..1>&cam=game|front|side|back|close&bloom=0
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { build, rig } from './body';
import { sheetMaterial, skinMaterial, uBillow, uBreath, uFold, uLCol, uLPos, uTime } from './materials';
import { animate, beat, breathOut, type State } from './pose';
import { OPTS, on } from './opts';

const url = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050302);
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const CAMS: Record<string, [number, number, number, number]> = { game: [0, 8.4, 9.2, 2.3], front: [0, 3.2, 14, 2.2], side: [13, 4, 2, 2.2], headside: [3.4, 2.5, 0.9, 2.3], back: [5, 5, -12, 2.2], spine: [1.6, 3.6, -5.2, 1.7], close: [1.2, 3.4, 4.6, 2.1], face: [0.5, 3.3, 2.6, 2.25], grin: [0.7, 1.95, 2.2, 2.1], level: [0, 2.3, 2.4, 2.3], zoom: [0, 5.6, 5.4, 2.3], head: [0.9, 2.5, 2.6, 2.3], jaw: [3.2, 2.3, 2.4, 2.25], maw: [0.7, 1.75, 3.0, 2.15], wing: [-3.2, 4.2, 5.5, 2.9] };
const cam = CAMS[url.get('cam') ?? 'game'] ?? CAMS.game;
camera.position.set(cam[0], cam[1], cam[2]);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, cam[3], 0);
controls.update();

// ---- the hall: a slab floor, a pillar with a torch
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function slabs(g: CanvasRenderingContext2D, size: number, rows: number, hues: string[]) {
  g.fillStyle = '#120c08'; g.fillRect(0, 0, size, size);
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * rh;
    while (x < size) {
      const w = rh * (1 + rnd() * 1.4);
      g.fillStyle = hues[Math.floor(rnd() * hues.length)];
      g.fillRect(x + 3, r * rh + 3, w - 6, rh - 6);
      for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,220,170'},${rnd() * 0.06})`; g.fillRect(x + 3 + rnd() * (w - 10), r * rh + 3 + rnd() * (rh - 10), 2 + rnd() * 14, 2 + rnd() * 5); }
      x += w;
    }
  }
}
const floorTex = canvasTexture(1024, 1024, (g) => slabs(g, 1024, 8, ['#6b5238', '#7a5e3e', '#5c4632', '#866a46', '#4f4030', '#70583a', '#5a4e42']));
floorTex.repeat.set(7, 7); floorTex.rotation = Math.PI / 5;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ map: floorTex, bumpMap: floorTex, bumpScale: 1.5, roughness: 0.88 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const brick = canvasTexture(512, 512, (g) => slabs(g, 512, 10, ['#6e5a40', '#7c6648', '#5f4d38', '#857052']));
const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3.2, 1.5), new THREE.MeshStandardMaterial({ map: brick, bumpMap: brick, bumpScale: 1.5, roughness: 0.9 }));
pillar.position.set(-1.6, 1.6, -3.4); pillar.castShadow = pillar.receiveShadow = true; scene.add(pillar);

const torch = new THREE.PointLight(0xff8a3a, 16, 30, 1.8);
torch.position.set(-0.6, 2.6, -2.4); torch.castShadow = true; torch.shadow.mapSize.set(2048, 2048); torch.shadow.bias = -0.006; torch.shadow.normalBias = 0.07;
scene.add(torch);
const flame = new THREE.Sprite(new THREE.SpriteMaterial({
  map: canvasTexture(64, 64, (g) => { const gr = g.createRadialGradient(32, 38, 2, 32, 32, 30); gr.addColorStop(0, '#fff3c0'); gr.addColorStop(0.3, '#ffa030'); gr.addColorStop(1, 'rgba(255,60,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }),
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
flame.position.copy(torch.position); flame.scale.set(0.5, 0.75, 1); scene.add(flame);
// the hall's other torches, out of the picture: a warm key from the front left, a dim red rim from behind, a little air
const key = new THREE.PointLight(0xffc890, 90, 40, 1.8); key.position.set(-4.5, 6.5, 6); scene.add(key);
const rim = new THREE.PointLight(0xff8050, 30, 40, 1.8); rim.position.set(5, 5, -6); scene.add(rim);
scene.add(new THREE.HemisphereLight(0x5a4c40, 0x120c08, 0.35));
const lava = new THREE.PointLight(0xff5a10, 0.7, 4, 2); scene.add(lava);
const fire = new THREE.PointLight(0xff7a20, 0, 8, 2); scene.add(fire);

// ---- the demon
const r = rig();
const rest = new Map(r.bones.map((b) => [b, b.position.clone()]));
const built = build(r);
const demon = new THREE.Group();
demon.add(r.root);
const skinMat = skinMaterial();
for (const [geo, mat] of [[built.body, skinMat], [built.tail, skinMat], [built.tubes, skinMat], [built.web, sheetMaterial(true)], [built.cloth, sheetMaterial(false)]] as const) {
  const m = new THREE.SkinnedMesh(geo, mat);
  m.bind(r.skeleton, new THREE.Matrix4());
  m.castShadow = m.receiveShadow = true; m.frustumCulled = false;
  demon.add(m);
}
scene.add(demon);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.4, 1.0);
if (url.get('bloom') !== '0') composer.addPass(bloom);
composer.addPass(new OutputPass());
function resize() {
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---- the panel
let mode = url.get('mode') ?? 'stand';
const st: State = { fly: mode === 'fly' ? 1 : 0, look: mode === 'look' ? 1 : 0, attack: -1, breath: -1, fold: Number(url.get('fold') ?? 0) };
const panel = document.getElementById('panel')!;
for (const m of ['stand', 'look', 'attack', 'breath', 'fly']) {
  const b = document.createElement('button'); b.textContent = m; b.onclick = () => { mode = m; st.attack = m === 'attack' ? 0 : -1; st.breath = m === 'breath' ? 0 : -1; };
  panel.append(b);
}
const fold = document.createElement('input'); fold.type = 'range'; fold.min = '0'; fold.max = '1'; fold.step = '0.01'; fold.value = String(st.fold);
fold.oninput = () => { st.fold = Number(fold.value); };
const label = document.createElement('label'); label.textContent = ' fold wings '; label.append(fold); panel.append(label);
// every adaptation can be switched off again (the page builds the demon anew)
for (const o of OPTS) {
  const c = document.createElement('input'); c.type = 'checkbox'; c.checked = on(o);
  c.onchange = () => { const u = new URL(location.href); if (c.checked) u.searchParams.delete(o); else u.searchParams.set(o, '0'); location.href = u.href; };
  const l = document.createElement('label'); l.append(' ', c, o); panel.append(l);
}
const note = document.createElement('span'); note.textContent = ` built in ${Math.round(built.ms)} ms, ${built.verts} points; drag to turn, wheel to zoom`; panel.append(note);

const pinned = url.has('t') ? Number(url.get('t')) : null;
if (mode === 'attack') st.attack = 0;
if (mode === 'breath') st.breath = 0;
const clock = new THREE.Clock();
let time = 0;
const chestAt = new THREE.Vector3();
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  time = pinned ?? time + dt;
  const to = (x: number, target: number, rate: number) => (pinned !== null ? target : x + (target - x) * Math.min(1, dt * rate));
  st.fly = to(st.fly, mode === 'fly' ? 1 : 0, 1.6); st.look = to(st.look, mode === 'look' ? 1 : 0, 3);
  if (st.attack >= 0) st.attack = pinned ?? st.attack + dt;
  if (st.breath >= 0) st.breath = pinned ?? st.breath + dt;
  uBreath.value = breathOut(st.breath);
  uTime.value = time;
  const fl01 = st.fly * st.fly * (3 - 2 * st.fly);
  uFold.value = st.fold * (1 - fl01); uBillow.value = -fl01 * Math.cos(beat(time));
  [torch, key, rim].forEach((l, i) => { uLPos.value[i].copy(l.position); uLCol.value[i].copy(l.color).multiplyScalar(l.intensity); });
  animate(r, rest, time, st);
  lava.position.copy(r.by.chest.getWorldPosition(chestAt)).add(new THREE.Vector3(0, 0.1, 0.6));
  fire.position.copy(r.by.jaw.getWorldPosition(chestAt)).add(new THREE.Vector3(0, -0.1, 0.5)); fire.intensity = 1.0 * uBreath.value * (0.8 + 0.2 * Math.sin(time * 23));
  const fl = 0.9 + 0.1 * Math.sin(time * 11) * Math.sin(time * 7.3);
  torch.intensity = 16 * fl; flame.scale.set(0.5 * fl, 0.75 * fl, 1);
  composer.render();
  (window as unknown as { __demon: unknown }).__demon = { frames: renderer.info.render.frame, ms: built.ms, verts: built.verts };
  requestAnimationFrame(frame);
}
frame();
