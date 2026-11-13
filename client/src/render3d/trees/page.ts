// Proof of concept (spike/3d-trees): `?r3d=trees`. Real 3D trees and bushes from the vegetation generator's recipe next to
// today's flat cards, under one sun shadow map, with wind and a time of day. Throwaway: its own small renderer loop, no host.
import {
  BufferAttribute, BufferGeometry, DataTexture, DepthTexture, DoubleSide, LinearSRGBColorSpace, Mesh, MeshBasicNodeMaterial, NearestFilter,
  NoColorSpace, OrthographicCamera, QuadMesh, RenderTarget, RGBAFormat, Scene, Texture, UnsignedByteType, Vector2, Vector3, Vector4, WebGPURenderer,
} from 'three/webgpu';
import { atan, attribute, clamp, dot, exp, float, floor, fract, length, max, min, mix, normalize, positionGeometry, pow, select, sin, smoothstep, sqrt, step, texture, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl';
import { drawPlant, type Light } from '../../game/vegetation';
import { P } from '../../game/vegetation/canvas';
import { paintGround } from '../../game/woodland/ground';
import { TILE_ID } from '../../generated/defs';
import { TileMap } from '../../sim/map';
import { loadAtlas } from '../../ui/atlas';
import { snapGround, viewRay } from '../camera';
import { pickZoom } from '../quality';
import { LOBE_PAD, MeshData, buildPlant, layout, type Plant3 } from './build';
import { clock, sky } from './sky';
import '../r3d.css';

type N = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- TSL nodes; the spike does not fight their types
const PITCH = Math.asin(0.75); // 48.6 degrees
const SM = 2048;
const WIND: [number, number] = [0.98, 0.2];

interface Params { hour: number; yaw: number; mode: '3d' | 'cards'; stretch: boolean; wind: boolean; snap: boolean; shadows: boolean; outline: boolean; plain: boolean; res: number; zoom: number; t: number | null; mult: number }

function readParams(search: string): Params {
  const q = new URLSearchParams(search), num = (k: string, d: number) => { const v = Number(q.get(k)); return q.has(k) && Number.isFinite(v) ? v : d; };
  const on = (k: string, d: boolean) => (q.has(k) ? q.get(k) !== '0' : d);
  return {
    hour: Math.min(23, Math.max(4.5, num('hour', 8))), yaw: num('yaw', 0), mode: q.get('mode') === 'cards' ? 'cards' : '3d',
    stretch: on('stretch', true), wind: on('wind', true), snap: on('snap', false), shadows: on('shadows', true), outline: on('outline', false), // the user's picks (2026-11-13): smooth sway, no outline pass, 2 px per art px
    plain: on('plain', false),
    res: Math.max(0, Math.round(num('res', 2))), zoom: Math.max(0, Math.round(num('zoom', 0))), t: q.has('t') ? num('t', 0) : null, mult: Math.max(1, Math.round(num('mult', 1))),
  };
}

function pixelTexture<T extends Texture>(t: T): T {
  t.colorSpace = NoColorSpace; t.magFilter = NearestFilter; t.minFilter = NearestFilter; t.generateMipmaps = false; t.flipY = false; t.premultiplyAlpha = false; t.needsUpdate = true;
  return t;
}

function geometry(attrs: Record<string, [ArrayLike<number>, number]>, idx: ArrayLike<number>): BufferGeometry {
  const g = new BufferGeometry();
  for (const [name, [data, size]] of Object.entries(attrs)) g.setAttribute(name, new BufferAttribute(new Float32Array(data), size));
  g.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
  return g;
}

export async function bootTrees(el: HTMLElement, search: string): Promise<void> {
  const p = readParams(search);
  const canvas = document.createElement('canvas');
  canvas.className = 'r3d'; // the 3D view's full-window canvas style
  el.style.overflow = 'hidden';
  el.appendChild(canvas);
  const renderer = new WebGPURenderer({ canvas, antialias: false, forceWebGL: new URLSearchParams(search).get('backend') === 'webgl' });
  await renderer.init();
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setPixelRatio(1);
  renderer.info.autoReset = false;
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  const atlas = await loadAtlas();

  // ---------------------------------------------------------------- the clearing
  const side = Math.sqrt(p.mult), PADX = 10, PADZ = 8, MW = Math.round(36 * side) + 2 * PADX, MH = Math.round(22 * side) + 2 * PADZ;
  const specs = layout(7, MW - 2 * PADX, MH - 2 * PADZ, 30 * p.mult, 20 * p.mult).map((s) => ({ ...s, x: s.x + PADX, z: s.z + PADZ }));
  const mesh = new MeshData();
  const plants: Plant3[] = specs.map((s) => buildPlant(mesh, s));
  const treeTris = mesh.tris;
  const map = new TileMap(MW, MH, new Uint8Array(MW * MH).fill(TILE_ID.Floor));
  const ground = paintGround(map, 11);
  const groundTex = pixelTexture(new DataTexture(new Uint8Array(ground.data.buffer.slice(0)), ground.w, ground.h, RGBAFormat, UnsignedByteType));
  const atlasTex = pixelTexture(new Texture(atlas.img));
  const AW = atlas.img.width, AH = atlas.img.height;

  // the generator's ramps, dark to light: leaf, conifer, bark, dead wood
  const ramps = ['01234', '56789', 'abcdd', 'efghh'], palData = new Uint8Array(5 * 4 * 4);
  ramps.forEach((r, y) => [...r].forEach((c, x) => palData.set([...P[c], 255], (y * 5 + x) * 4)));
  const palTex = pixelTexture(new DataTexture(palData, 5, 4, RGBAFormat, UnsignedByteType));

  // the plants' pictures (today's cards), packed on shelves
  const CW = 2048; let CH = 256;
  const rects: { x: number; y: number }[] = [];
  { let x = 1, y = 1, rowH = 0;
    for (const pl of plants) { const { w, h } = pl.drawn.img; if (x + w + 1 > CW) { x = 1; y += rowH + 1; rowH = 0; } rects.push({ x, y }); x += w + 1; rowH = Math.max(rowH, h); }
    while (CH < y + rowH + 1) CH *= 2; }
  const cardData = new Uint8Array(CW * CH * 4);
  const cardTex = pixelTexture(new DataTexture(cardData, CW, CH, RGBAFormat, UnsignedByteType));
  function bakeCards(light?: Light): void {
    plants.forEach((pl, i) => {
      const img = light ? drawPlant(pl.spec.kind, pl.spec.seed, pl.spec.scalePct, light).img : pl.drawn.img, r = rects[i];
      if (img.w !== pl.drawn.img.w || img.h !== pl.drawn.img.h) return; // the shape does not depend on the light; keep the old picture if it ever did
      for (let y = 0; y < img.h; y++) cardData.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), ((r.y + y) * CW + r.x) * 4);
    });
    cardTex.needsUpdate = true;
  }
  bakeCards();

  // ---------------------------------------------------------------- uniforms
  const u = {
    sun: uniform(new Vector3(0, 1, 0)), sunCol: uniform(new Vector3(1, 1, 1)), amb: uniform(new Vector3(0.3, 0.3, 0.3)),
    time: uniform(0), wind: uniform(1), snap: uniform(1), stretch: uniform(1), cardStretch: uniform(1 / Math.cos(PITCH)), shadows: uniform(1), outline: uniform(1), plain: uniform(0),
    camR: uniform(new Vector3(1, 0, 0)), camU: uniform(new Vector3(0, 1, 0)), camV: uniform(new Vector3(0, 0, 1)),
    sunR: uniform(new Vector3(1, 0, 0)), sunU: uniform(new Vector3(0, 0, 1)), sunF: uniform(new Vector3(0, -1, 0)), sunRh: uniform(new Vector3(1, 0, 0)),
    sunC: uniform(new Vector3()), sunExt: uniform(new Vector2(1, 1)), sunNF: uniform(new Vector2(0, 1)),
    px: uniform(new Vector2(1, 1)), depthRange: uniform(1),
  };

  const shadowRT = new RenderTarget(SM, SM, { depthBuffer: true, depthTexture: new DepthTexture(SM, SM), magFilter: NearestFilter, minFilter: NearestFilter, generateMipmaps: false });
  const sceneRT = new RenderTarget(4, 4, { depthBuffer: true, depthTexture: new DepthTexture(4, 4), magFilter: NearestFilter, minFilter: NearestFilter, generateMipmaps: false });
  sceneRT.texture.colorSpace = NoColorSpace;

  // ---------------------------------------------------------------- shared shader parts
  const hash3 = (c: N): N => fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
  const shoulder = (c: N): N => mix(c, float(1).sub(exp(c.mul(-1.6))), smoothstep(0.55, 1.1, c));
  /** 1 where the sun (or moon) reaches the point, 0 in shadow. */
  const sunVis = (pt: N): N => {
    const d = pt.sub(u.sunC);
    // three's render-target textures have v = 0 at the top on both backends, so the sun camera's up axis runs against v
    const suv = vec2(dot(d, u.sunR).div(u.sunExt.x).mul(0.5).add(0.5), float(0.5).sub(dot(d, u.sunU).div(u.sunExt.y).mul(0.5)));
    const ref = dot(d, u.sunF).sub(u.sunNF.x).div(u.sunNF.y);
    const sd = texture(shadowRT.depthTexture!, suv).r;
    return max(step(ref, sd.add(float(0.035).div(u.sunNF.y))), float(1).sub(u.shadows));
  };
  /** The wind's shift of a point with sway factor `k` on the plant standing at `foot`, in tiles along the wind. */
  const swayOf = (foot: N, k: N): N => {
    const gust = pow(max(0, sin(foot.x.add(foot.y.mul(0.3)).mul(0.33).sub(u.time.mul(1.5)))), 6);
    const f = sin(u.time.mul(1.3).add(foot.x.mul(0.9)).add(foot.y.mul(0.4))).mul(0.5).add(sin(u.time.mul(2.9).add(foot.y)).mul(0.25)).add(gust.mul(1.4));
    const m = k.mul(f).mul(u.wind);
    const s = mix(m, floor(m.mul(16).add(0.5)).div(16), u.snap);
    return vec3(s.mul(WIND[0]), 0, s.mul(WIND[1]));
  };
  /** A lobe seen along a direction with screen axes R and U: the generator's scalloped outline, its rim band and the unit ball's normal there. */
  const lobeView = (R: N, U: N, V: N) => {
    const n = attribute('normal', 'vec3'), part = attribute('part', 'vec4'), misc = attribute('misc', 'vec4');
    const ns = vec2(dot(n, R), dot(n, U)).mul(LOBE_PAD), rho = length(ns), ang = atan(ns.y, ns.x);
    const d = rho.div(float(1).add(sin(ang.mul(5).add(part.z)).mul(0.06)).add(sin(ang.mul(9).add(part.w)).mul(0.05)).add(sin(ang.mul(14).add(part.z.mul(2))).mul(0.03)));
    const nz = sqrt(max(float(1).sub(rho.mul(rho)), 0));
    const world = R.mul(ns.x).add(U.mul(ns.y)).add(V.mul(nz)).div(max(rho, 1));
    return { keep: d.lessThanEqual(1), edge: d.greaterThan(float(1).sub(misc.z)), dir: ns.div(max(rho, 1e-4)), world };
  };

  // ---------------------------------------------------------------- the 3D trees
  const aSway = attribute('sway', 'vec4'), aPart = attribute('part', 'vec4'), aMisc = attribute('misc', 'vec4'), aGrad = attribute('grad', 'vec4');
  const isLobe = aPart.y.lessThan(0.5), isSkirt = aPart.y.greaterThan(1.5), isBark = aPart.x.greaterThan(1.5);
  const treeOff = swayOf(aSway.xy, aSway.z);
  const vOff: N = varying(treeOff), vP0: N = varying(positionGeometry);

  const treeMat = new MeshBasicNodeMaterial();
  treeMat.side = DoubleSide;
  treeMat.positionNode = positionGeometry.add(treeOff).add(vec3(0, aSway.w.mul(u.stretch.sub(1)), 0));
  {
    const lv = lobeView(u.camR, u.camU, u.camV), nRaw = attribute('normal', 'vec3');
    const nl = select(isLobe, lv.world, nRaw);
    const nw = normalize(select(isLobe, lv.world, select(isSkirt, nRaw.add(vec3(0, 0.4, 0)), nRaw)));
    const cell = floor(vP0.mul(16)), noise = hash3(cell).sub(0.5).mul(0.14);
    const at = cell.add(0.5).div(16).add(vOff).add(nw.mul(0.05)).add(u.sun.mul(0.05));
    const vis = sunVis(at);
    const lp = u.sun.add(vec3(0, aMisc.x, 0));
    // the generator's lobeGreen: ball, crown gradient, height term, noise; a dark rim away from the light and a lit one toward it
    let l: N = select(isLobe, float(0.75), float(0.7)).mul(dot(nl, lp)).add(dot(aGrad.xyz, lp).mul(0.45)).add(aGrad.w).add(noise).sub(select(isLobe, float(0.2), float(0)));
    const nd = dot(lv.dir, vec2(dot(u.sun, u.camR), dot(u.sun, u.camU)));
    l = l.add(select(isLobe.and(lv.edge).and(nd.greaterThan(0.3)), float(0.6), float(0)));
    const shade = float(-0.45).add(nw.y.mul(0.35)).add(min(aGrad.w.sub(0.25), 0).mul(0.3)).add(noise); // in shadow the form still reads: tops a step lighter than sides
    l = select(vis.lessThan(0.5), min(l, shade), l);
    let lvl: N = step(-0.75, l).add(step(-0.3, l)).add(step(0.2, l)).add(step(0.6, l));
    lvl = select(isLobe.and(lv.edge).and(nd.lessThan(-0.1)), float(0), lvl);
    lvl = select(isSkirt.and(aMisc.y.greaterThan(0.9)), float(0), select(isSkirt.and(aMisc.y.greaterThan(0.8)), min(lvl, 1), lvl));
    const dab = hash3(floor(vP0.mul(16 / 2.3)).add(17)).lessThan(0.12).and(dot(nl, u.sun).greaterThan(0.15)).and(lvl.greaterThan(0.5)).and(vis.greaterThan(0.5));
    lvl = min(lvl.add(select(dab, float(1), float(0))), 4);
    // bark: the generator's barkShade plus its wavy dashed lines, a step lighter on the lit side and darker on the other
    const lit = dot(nRaw, u.sun).add(noise.mul(0.5));
    let lb: N = step(-0.5, lit).add(step(0, lit)).add(step(0.55, lit));
    lb = select(vis.lessThan(0.5), min(lb, select(lit.lessThan(-0.3), float(0), float(1))), lb);
    lb = lb.sub(select(aMisc.y.greaterThan(0.5), float(1), float(0)));
    const sa = atan(nRaw.z, nRaw.x).mul(8 / (2 * Math.PI)).add(sin(vP0.y.mul(9)).mul(0.1));
    const line = aMisc.w.greaterThan(0.5).and(fract(sa).lessThan(0.22)).and(hash3(vec3(floor(sa), floor(vP0.y.mul(16 / 3)), 3)).greaterThan(0.4));
    lb = clamp(lb.add(select(line, select(lit.greaterThan(0), float(1), float(-1)), float(0))), 0, 3);
    const level = select(isBark, lb, lvl);
    const grade = u.amb.add(u.sunCol.mul(0.75));
    // in shadow the colour takes the sky's light, not the sun's
    const stepped = texture(palTex, vec2(level.add(0.5).div(5), aPart.x.add(0.5).div(4))).rgb.mul(select(vis.lessThan(0.5), u.amb.mul(1.6).add(u.sunCol.mul(0.25)), grade));
    // "plain": one flat colour per ramp, lit by the environment light alone, as the ground is
    const flat = texture(palTex, vec2(2.5 / 5, aPart.x.add(0.5).div(4))).rgb;
    const plainLit = u.amb.add(u.sunCol.mul(vis).mul(clamp(dot(nw, u.sun).add(0.35).div(1.35), 0, 1)).mul(1.3));
    const rgb = shoulder(select(u.plain.greaterThan(0.5), flat.mul(plainLit), stepped));
    treeMat.colorNode = vec4(rgb, select(isLobe.and(lv.keep.not()), float(0), float(1)));
    treeMat.alphaTest = 0.5;
    treeMat.outputNode = vec4(rgb, aPart.x.add(1).div(5));
  }
  const treeShadowMat = new MeshBasicNodeMaterial();
  treeShadowMat.side = DoubleSide;
  treeShadowMat.positionNode = positionGeometry.add(treeOff);
  {
    const lv = lobeView(u.sunR, u.sunU, u.sun);
    treeShadowMat.colorNode = vec4(0, 0, 0, select(isLobe.and(lv.keep.not()), float(0), float(1)));
    treeShadowMat.alphaTest = 0.5;
  }
  const treeGeo = geometry({ position: [mesh.pos, 3], normal: [mesh.nrm, 3], grad: [mesh.grad, 4], sway: [mesh.sway, 4], part: [mesh.part, 4], misc: [mesh.misc, 4] }, mesh.idx);
  const treeMesh = new Mesh(treeGeo, treeMat), treeShadow = new Mesh(treeGeo, treeShadowMat);
  treeMesh.frustumCulled = false; treeShadow.frustumCulled = false;

  // ---------------------------------------------------------------- cards (figures, and the plants as today)
  /** A card standing on `foot`, spread along `right`; `sw` = sway amplitude, height, how far its shadow lookup moves toward the sun. */
  const cardNodes = (right: N, stretch: N) => {
    const foot: N = attribute('foot', 'vec3'), off: N = attribute('off', 'vec2'), sw: N = attribute('sw', 'vec3');
    const k = sw.x.mul(pow(clamp(off.y.div(max(sw.y, 0.01)), 0, 1), 2));
    const flat = foot.add(right.mul(off.x)).add(swayOf(foot.xz, k));
    // rows below the foot (roots) lie flat on the ground toward the viewer, where the upright card would have shown them
    const lie = normalize(vec3(u.camV.x, 0, u.camV.z)).mul(max(off.y.negate(), 0).div(Math.sin(PITCH)));
    return { real: flat.add(vec3(0, off.y, 0)), shown: flat.add(vec3(0, (max(off.y, 0) as N).mul(stretch).add(0.02), 0)).add(lie).add(u.camV.mul(0.03)), lift: sw.z };
  };
  const cardMat = (tex: Texture, tw: number, th: number): MeshBasicNodeMaterial => {
    const c = cardNodes(u.camR, u.cardStretch), real: N = varying(c.real), lift: N = varying(c.lift), m = new MeshBasicNodeMaterial();
    m.side = DoubleSide;
    m.positionNode = c.shown;
    const t = texture(tex, uv().div(vec2(tw, th)));
    const bright = float(0.62).add(clamp(dot(u.sun, normalize(vec3(u.camV.x, 0, u.camV.z))).add(0.3), 0, 1).mul(0.3)).add(u.sun.y.mul(0.15));
    const rgb = shoulder(t.rgb.mul(u.amb.add(u.sunCol.mul(sunVis(real.add(u.sun.mul(lift)))).mul(bright))));
    m.colorNode = vec4(rgb, t.a);
    m.alphaTest = 0.5;
    m.outputNode = vec4(rgb, 0);
    return m;
  };
  const cardShadowMat = (tex: Texture, tw: number, th: number): MeshBasicNodeMaterial => {
    const m = new MeshBasicNodeMaterial();
    m.side = DoubleSide;
    m.positionNode = cardNodes(u.sunRh, float(1)).real;
    m.colorNode = vec4(0, 0, 0, texture(tex, uv().div(vec2(tw, th))).a);
    m.alphaTest = 0.5;
    return m;
  };
  interface Quad { foot: [number, number, number]; x0: number; x1: number; y0: number; y1: number; u0: number; v0: number; u1: number; v1: number; sw: [number, number, number] }
  const quads = (list: Quad[]): BufferGeometry => {
    const foot: number[] = [], off: number[] = [], uvs: number[] = [], sw: number[] = [], idx: number[] = [], pos: number[] = [];
    list.forEach((q, i) => {
      for (const [x, y, uu, vv] of [[q.x0, q.y0, q.u0, q.v1], [q.x1, q.y0, q.u1, q.v1], [q.x1, q.y1, q.u1, q.v0], [q.x0, q.y1, q.u0, q.v0]]) { foot.push(...q.foot); off.push(x, y); uvs.push(uu, vv); sw.push(...q.sw); pos.push(...q.foot); }
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    });
    return geometry({ position: [pos, 3], foot: [foot, 3], off: [off, 2], uv: [uvs, 2], sw: [sw, 3] }, idx);
  };

  // figures: a few stand among the trees, a knight walks a loop through the clearing
  const cx = MW / 2, cz = PADZ + (MH - 2 * PADZ) * 0.58;
  const figs = [
    { name: 'knight_m_run_anim_f', x: cx, z: cz, walk: true }, { name: 'elf_f_idle_anim_f', x: cx - 3.2, z: cz - 1.4 }, { name: 'wizzard_m_idle_anim_f', x: cx + 2.6, z: cz - 2.2 },
    { name: 'goblin_idle_anim_f', x: cx + 4.4, z: cz + 1.2 }, { name: 'orc_warrior_idle_anim_f', x: cx - 5.2, z: cz + 1.6 }, { name: 'ogre_idle_anim_f', x: cx + 0.6, z: cz - 4.4 },
    { name: 'dwarf_m_idle_anim_f', x: cx - 1.4, z: cz + 2.6 },
  ].filter((f) => atlas.frames[`${f.name}0`]);
  const figQuad = (f: (typeof figs)[number], frame: number, x: number, z: number, flip: boolean): Quad => {
    const r = atlas.frames[`${f.name}${frame % 4}`].frame, hw = r.w / 32;
    return { foot: [x, 0, z], x0: -hw, x1: hw, y0: 0, y1: r.h / 16, u0: flip ? r.x + r.w : r.x, u1: flip ? r.x : r.x + r.w, v0: r.y, v1: r.y + r.h, sw: [0, 1, 0.14] };
  };
  const figGeo = quads(figs.map((f) => figQuad(f, 0, f.x, f.z, false)));
  const figMesh = new Mesh(figGeo, cardMat(atlasTex, AW, AH)), figShadow = new Mesh(figGeo, cardShadowMat(atlasTex, AW, AH));
  function stepFigures(t: number): void {
    const footA = figGeo.getAttribute('foot') as BufferAttribute, uvA = figGeo.getAttribute('uv') as BufferAttribute;
    figs.forEach((f, i) => {
      const a = t * 0.35, x = f.walk ? cx + Math.cos(a) * 3.6 : f.x, z = f.walk ? cz + Math.sin(a) * 2.2 : f.z;
      const q = figQuad(f, Math.floor(t * (f.walk ? 9 : 5) + i), x, z, f.walk ? Math.sin(a) > 0 : false);
      const us = [q.u0, q.v1, q.u1, q.v1, q.u1, q.v0, q.u0, q.v0];
      for (let v = 0; v < 4; v++) { footA.setXYZ(i * 4 + v, x, 0, z); uvA.setXY(i * 4 + v, us[v * 2], us[v * 2 + 1]); }
    });
    footA.needsUpdate = true; uvA.needsUpdate = true;
  }

  // the plants as cards: the picture on a card; it casts as the design says, a narrow trunk card plus one sun-facing disc per lobe
  const plantQuads: Quad[] = [], trunkQuads: Quad[] = [];
  const dc: number[] = [], dOff: number[] = [], dSw: number[] = [], dPos: number[] = [], dIdx: number[] = [];
  plants.forEach((pl, i) => {
    const { img, foot } = pl.drawn, r = rects[i], f: [number, number, number] = [pl.spec.x, 0, pl.spec.z];
    plantQuads.push({ foot: f, x0: -foot.x / 16, x1: (img.w - foot.x) / 16, y0: (foot.y - img.h) / 16, y1: foot.y / 16, u0: r.x, u1: r.x + img.w, v0: r.y, v1: r.y + img.h, sw: [pl.amp, pl.height, 3.6] });
    const px0 = Math.floor(foot.x - pl.trunkHalf * 16), px1 = Math.ceil(foot.x + pl.trunkHalf * 16), py0 = Math.round(foot.y - pl.trunkTop * 16);
    trunkQuads.push({ foot: f, x0: (px0 - foot.x) / 16, x1: (px1 - foot.x) / 16, y0: 0, y1: (foot.y - py0) / 16, u0: r.x + px0, u1: r.x + px1, v0: r.y + py0, v1: r.y + foot.y, sw: [pl.amp, pl.height, 0] });
    const discs = pl.lobes.length ? pl.lobes : pl.drawn.recipe!.skirts.map((s) => ({ x: 0, y: (pl.drawn.recipe!.foot.y - s.yTop - s.h * 0.6) / 16, z: 0, rx: s.W / 16, ry: s.W / 16, rz: 0, ph: 1, ph2: 2, k: pl.amp * 0.5 }));
    for (const b of discs) {
      const base = dPos.length / 3;
      for (const [ox, oy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { dPos.push(f[0] + b.x, b.y, f[2] + b.z); dc.push(f[0], f[2], b.k, b.ph); dOff.push(ox * LOBE_PAD, oy * LOBE_PAD); dSw.push(b.rx, b.ry, b.ph2); }
      dIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  });
  const plantGeo = quads(plantQuads);
  const plantMesh = new Mesh(plantGeo, cardMat(cardTex, CW, CH)), trunkShadow = new Mesh(quads(trunkQuads), cardShadowMat(cardTex, CW, CH));
  const discMat = new MeshBasicNodeMaterial();
  discMat.side = DoubleSide;
  {
    const c = attribute('sway', 'vec4'), o = attribute('off', 'vec2'), r = attribute('sw', 'vec3');
    discMat.positionNode = positionGeometry.add(swayOf(c.xy, c.z)).add(u.sunR.mul(o.x.mul(r.x))).add(u.sunU.mul(o.y.mul(r.y)));
    const ang = atan(o.y, o.x), d = length(o).div(float(1).add(sin(ang.mul(5).add(c.w)).mul(0.06)).add(sin(ang.mul(9).add(r.z)).mul(0.05)));
    discMat.colorNode = vec4(0, 0, 0, select(d.lessThanEqual(1), float(1), float(0)));
    discMat.alphaTest = 0.5;
  }
  const discShadow = new Mesh(geometry({ position: [dPos, 3], sway: [dc, 4], off: [dOff, 2], sw: [dSw, 3] }, dIdx), discMat);

  // ---------------------------------------------------------------- the ground
  const groundMat = new MeshBasicNodeMaterial();
  {
    const cell = floor(positionGeometry.xz.mul(16)).add(0.5).div(16);
    const vis = sunVis(vec3(cell.x, 0.03, cell.y));
    const lit = u.amb.add(u.sunCol.mul(vis).mul(float(0.45).add(u.sun.y.mul(0.55))));
    const rgb = shoulder(texture(groundTex, uv()).rgb.mul(lit));
    groundMat.colorNode = vec4(rgb, 1);
    groundMat.outputNode = vec4(rgb, 0);
  }
  groundMat.side = DoubleSide;
  const groundMesh = new Mesh(geometry({ position: [[0, 0, 0, MW, 0, 0, MW, 0, MH, 0, 0, MH], 3], uv: [[0, 0, 1, 0, 1, 1, 0, 1], 2] }, [0, 2, 1, 0, 3, 2]), groundMat);
  groundMesh.renderOrder = -1;

  const scene = new Scene(), shadowScene = new Scene();
  for (const m of [groundMesh, treeMesh, plantMesh, figMesh]) { m.frustumCulled = false; scene.add(m); }
  for (const m of [treeShadow, trunkShadow, discShadow, figShadow]) { m.frustumCulled = false; shadowScene.add(m); }

  // ---------------------------------------------------------------- outline and seams, from depth edges of the picture
  const postMat = new MeshBasicNodeMaterial();
  {
    const at = (dx: number, dy: number) => { const q = uv().add(u.px.mul(vec2(dx, dy))); return { c: texture(sceneRT.texture, q), d: texture(sceneRT.depthTexture!, q).r.mul(u.depthRange) }; };
    const me = at(0, 0), up = at(0, -1), up2 = at(0, -2), dn = at(0, 1), lf = at(-1, 0), rt = at(1, 0); // v = 0 is the top row
    const plant = me.c.a.greaterThan(0.1);
    const nearer = (n: { c: N; d: N }, gap: number): N => n.c.a.greaterThan(0.1).and(n.d.lessThan(me.d.sub(gap)));
    const anyNear = (gap: number): N => nearer(up, gap).or(nearer(dn, gap)).or(nearer(lf, gap)).or(nearer(rt, gap));
    const grade = u.amb.add(u.sunCol.mul(0.75));
    const ink = shoulder(vec3(P.k[0] / 255, P.k[1] / 255, P.k[2] / 255).mul(grade));
    const dark = shoulder(texture(palTex, vec2(0.5 / 5, me.c.a.mul(5).sub(0.5).div(4))).rgb.mul(grade));
    // outside a plant: the generator's dark outline. Inside: a dark seam under the lip of whatever lies in front; ink where another plant does.
    const seam = nearer(up, 0.3).or(nearer(up2, 0.3)).or(nearer(dn, 0.3));
    const rgb = select(plant, select(anyNear(1.6), ink, select(seam, dark, me.c.rgb)), select(anyNear(0.02), ink, me.c.rgb));
    postMat.colorNode = vec4(select(u.outline.greaterThan(0.5), rgb, me.c.rgb), 1);
  }
  const quad = new QuadMesh(postMat);

  // ---------------------------------------------------------------- cameras
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200), sunCam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const cam = { x: cx, z: cz - 1.2, yaw: (p.yaw * Math.PI) / 180, yawTo: (p.yaw * Math.PI) / 180 };
  let zoom = 2, artW = 1, artH = 1, bakedFor = '', bakeAt = 0;
  const dst = new Vector4(), full = new Vector4(); // the copy's rectangle (whole art px, centred, may overhang) and the canvas

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // device px, as the 3D view's host sizes its canvas
    const w = Math.max(1, Math.round((el.clientWidth || window.innerWidth) * dpr)), h = Math.max(1, Math.round((el.clientHeight || window.innerHeight) * dpr));
    zoom = p.zoom || Math.max(2, pickZoom(w, h) - 1);
    artW = Math.ceil(w / zoom); artH = Math.ceil(h / zoom);
    renderer.setSize(w, h, false);
    dst.set(Math.floor((w - artW * zoom) / 2), Math.floor((h - artH * zoom) / 2), artW * zoom, artH * zoom); full.set(0, 0, w, h);
    const res = p.res === 0 ? zoom : Math.min(p.res, zoom);
    sceneRT.setSize(artW * res, artH * res);
    u.px.value.set(1 / artW, 1 / artH);
  }

  function setSun(): void {
    const s = sky(p.hour), d = new Vector3(...s.dir).normalize(), c0 = new Vector3(MW / 2, 0, MH / 2);
    u.sun.value.copy(d); u.sunCol.value.set(...s.col); u.amb.value.set(...s.amb);
    sunCam.position.copy(c0).addScaledVector(d, 80);
    sunCam.up.set(0, 1, 0);
    sunCam.lookAt(c0);
    sunCam.updateMatrixWorld(true);
    const e = sunCam.matrixWorld.elements, R = new Vector3(e[0], e[1], e[2]), U = new Vector3(e[4], e[5], e[6]), F = d.clone().negate();
    let ex = 0, ey = 0, ez = 0;
    for (const x of [0, MW]) for (const y of [0, 9]) for (const z of [0, MH]) {
      const v = new Vector3(x, y, z).sub(c0);
      ex = Math.max(ex, Math.abs(v.dot(R))); ey = Math.max(ey, Math.abs(v.dot(U))); ez = Math.max(ez, Math.abs(v.dot(F)));
    }
    sunCam.left = -ex; sunCam.right = ex; sunCam.top = ey; sunCam.bottom = -ey; sunCam.near = 80 - ez - 1; sunCam.far = 80 + ez + 1;
    sunCam.updateProjectionMatrix();
    u.sunR.value.copy(R); u.sunU.value.copy(U); u.sunF.value.copy(F); u.sunC.value.copy(sunCam.position);
    u.sunRh.value.set(-d.z, 0, d.x).normalize();
    u.sunExt.value.set(ex, ey); u.sunNF.value.set(sunCam.near, sunCam.far - sunCam.near);
  }

  // ---------------------------------------------------------------- panel
  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;left:8px;top:8px;padding:8px 10px;background:rgba(12,14,18,.82);color:#dde;font:12px/1.5 system-ui,sans-serif;border-radius:6px;min-width:250px;user-select:none';
  const readout = document.createElement('div');
  readout.style.cssText = 'white-space:pre;font:11px/1.4 ui-monospace,monospace;margin-bottom:6px;color:#9fd';
  panel.appendChild(readout);
  const row = (label: string): HTMLLabelElement => { const l = document.createElement('label'); l.style.cssText = 'display:flex;gap:6px;align-items:center;justify-content:space-between'; l.append(label); panel.appendChild(l); return l; };
  const hourL = row('');
  const hourI = document.createElement('input'); hourI.type = 'range'; hourI.min = '4.5'; hourI.max = '23'; hourI.step = '0.25'; hourI.value = String(p.hour); hourI.style.width = '150px';
  hourL.appendChild(hourI);
  const hourText = hourL.firstChild as Text;
  hourI.addEventListener('input', () => { p.hour = Number(hourI.value); changed(); });
  const check = (label: string, key: 'stretch' | 'wind' | 'snap' | 'shadows' | 'outline' | 'plain'): void => {
    const l = row(label), i = document.createElement('input'); i.type = 'checkbox'; i.checked = p[key];
    i.addEventListener('change', () => { p[key] = i.checked; changed(); }); l.appendChild(i);
  };
  const syncs: (() => void)[] = [];
  const choice = <T extends string | number>(label: string, opts: [string, T][], get: () => T, set: (v: T) => void): void => {
    const l = row(label), s = document.createElement('select');
    syncs.push(() => { s.value = String(Math.max(0, opts.findIndex(([, v]) => v === get()))); });
    opts.forEach(([name, v], i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = name; if (v === get()) o.selected = true; s.appendChild(o); });
    s.addEventListener('change', () => { set(opts[Number(s.value)][1]); changed(); }); l.appendChild(s);
  };
  choice<'3d' | 'cards'>('Trees (T)', [['3D', '3d'], ['Flat cards', 'cards']], () => p.mode, (v) => { p.mode = v; });
  choice('Turn (Z / C)', [0, 45, 90, 135, 180, -135, -90, -45].map((d) => [`${d}°`, d] as [string, number]), () => p.yaw, (v) => { p.yaw = v; cam.yawTo = (v * Math.PI) / 180; });
  check('Card proportions (stretch)', 'stretch');
  check('Palette steps off: plain light', 'plain');
  check('Outline and seams', 'outline');
  check('Shadows', 'shadows');
  check('Wind', 'wind');
  check('Sway in whole pixels', 'snap');
  choice('Render px per art px', [['1 (pixel art)', 1], ['2', 2], ['screen', 0]], () => p.res, (v) => { p.res = v; resize(); });
  choice('Zoom', [['Auto', 0], ['2', 2], ['3', 3], ['4', 4], ['5', 5], ['6', 6]], () => p.zoom, (v) => { p.zoom = v; resize(); });
  const help = document.createElement('div'); help.style.cssText = 'margin-top:6px;color:#99a'; help.textContent = 'WASD / arrows pan · T cards ↔ 3D';
  panel.appendChild(help);
  el.appendChild(panel);

  function changed(): void {
    u.wind.value = p.wind ? 1 : 0; u.snap.value = p.snap ? 1 : 0; u.shadows.value = p.shadows ? 1 : 0; u.outline.value = p.outline ? 1 : 0; u.plain.value = p.plain ? 1 : 0;
    u.stretch.value = p.stretch ? 1 / Math.cos(PITCH) : 1;
    treeMesh.visible = treeShadow.visible = p.mode === '3d';
    plantMesh.visible = trunkShadow.visible = discShadow.visible = p.mode === 'cards';
    hourText.textContent = `Time ${clock(p.hour)}`; hourI.value = String(p.hour);
    for (const f of syncs) f();
    setSun();
    bakeAt = performance.now() + 150;
    const q = new URLSearchParams(location.search);
    q.set('hour', String(p.hour)); q.set('yaw', String(p.yaw)); q.set('mode', p.mode);
    for (const k of ['stretch', 'wind', 'snap', 'shadows', 'outline', 'plain'] as const) q.set(k, p[k] ? '1' : '0');
    q.set('res', String(p.res)); q.set('zoom', String(p.zoom));
    history.replaceState(null, '', `?${q.toString().replace('r3d=trees', 'r3d=trees')}`);
  }

  const held = new Set<string>();
  const turn = (by: number) => { p.yaw = ((((Math.round((cam.yawTo * 180) / Math.PI) + by + 180) % 360) + 360) % 360) - 180; cam.yawTo += (by * Math.PI) / 180; changed(); };
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
    held.add(e.code);
    if (e.code === 'KeyZ') turn(45); else if (e.code === 'KeyC') turn(-45); else if (e.code === 'KeyX') turn(-p.yaw);
    else if (e.code === 'KeyT') { p.mode = p.mode === '3d' ? 'cards' : '3d'; changed(); }
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => held.clear());
  window.addEventListener('resize', resize);

  // ---------------------------------------------------------------- frame loop
  const hook = { frames: 0, backend, fps: 0, ms: 0, drawCalls: 0, triangles: 0, treeTris, plants: plants.length, set(next: Partial<Params>) { Object.assign(p, next); if (next.yaw !== undefined) cam.yaw = cam.yawTo = (p.yaw * Math.PI) / 180; resize(); changed(); } };
  (window as unknown as { __r3d: typeof hook }).__r3d = hook;
  resize();
  changed();
  let last = performance.now(), acc = 0, accN = 0, cpu = 0, time = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    time = p.t ?? time + dt;
    u.time.value = time;
    cam.yaw += (cam.yawTo - cam.yaw) * Math.min(1, dt / 0.07);
    if (Math.abs(cam.yawTo - cam.yaw) < 1e-3) cam.yaw = cam.yawTo;
    const ix = (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0), iz = (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0) - (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0);
    const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    cam.x = Math.min(MW, Math.max(0, cam.x + (ix * c - iz * s) * 10 * dt)); cam.z = Math.min(MH, Math.max(0, cam.z + (ix * s + iz * c) * 10 * dt));

    // today's pictures bake the light's side into the card: redraw them when the sun or the turn has settled
    const ls = u.sun.value, lx = ls.x * c + ls.z * s, key = `${p.hour}:${Math.round((cam.yawTo * 180) / Math.PI)}`;
    if (p.mode === 'cards' && key !== bakedFor && now >= bakeAt && cam.yaw === cam.yawTo) {
      const n = Math.hypot(lx, ls.y) || 1;
      bakeCards({ x: lx / n, y: -ls.y / n }); bakedFor = key;
    }

    const halfW = artW / 32, halfH = artH / 32, ray = viewRay(PITCH, cam.yaw), dist = 50 + halfH / Math.tan(PITCH), g = snapGround(PITCH, cam.yaw, cam.x, cam.z);
    camera.left = -halfW; camera.right = halfW; camera.top = halfH; camera.bottom = -halfH; camera.far = 2 * dist + 100;
    camera.position.set(g.x + ray[0] * dist, ray[1] * dist, g.z + ray[2] * dist);
    camera.up.set(0, 1, 0);
    camera.lookAt(g.x, 0, g.z);
    camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
    u.camR.value.set(c, 0, s); u.camV.value.set(ray[0], ray[1], ray[2]); u.camU.value.crossVectors(u.camV.value, u.camR.value);
    u.depthRange.value = camera.far - camera.near;
    stepFigures(time);

    renderer.info.reset();
    renderer.setRenderTarget(shadowRT);
    renderer.render(shadowScene, sunCam);
    renderer.setClearColor(0x0c1410, 1);
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.setViewport(dst);
    quad.render(renderer);
    renderer.setViewport(full);

    cpu += performance.now() - now; acc += dt; accN++;
    hook.frames++;
    if (acc >= 0.5) {
      hook.fps = accN / acc; hook.ms = cpu / accN; hook.drawCalls = renderer.info.render.drawCalls; hook.triangles = renderer.info.render.triangles;
      const res = p.res === 0 ? zoom : Math.min(p.res, zoom);
      readout.textContent = `${hook.fps.toFixed(0)} fps   ${(1000 / hook.fps).toFixed(1)} ms/frame (script ${hook.ms.toFixed(2)} ms)\n${backend}  ${artW * res}x${artH * res} -> ${artW * zoom}x${artH * zoom}\n${hook.drawCalls} draw calls, ${Math.round(hook.triangles / 1000)}k triangles per frame\n${plants.length} plants, ${Math.round(treeTris / 1000)}k triangles in the 3D trees`;
      acc = 0; accN = 0; cpu = 0;
    }
  });
}
