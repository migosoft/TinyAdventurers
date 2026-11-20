// The lich's builder (#358): a pure function from a pose and a cloth state to fixed vertex streams, every frame. A port of the approved
// spike's `step` (lichSpike.ts): the robe, the head, the jaw, the collar, the staff, the arms, the tome and the ghostly claws.
//
// Model frame: builder units (the spike's "model px"), the front along +x, up +y, the lich's right +z, the foot at the origin. The spike
// built in this frame too (its group was turned by the facing); only the cloth lives in world directions, so the rings and the tome are
// turned into the model frame with `pose.face` here.
//
// Cost: `buildLich` allocates nothing. Module-level scratch and scalar maths replace the spike's tuples. The skull, the staff, the
// right hand and the claws' hands are built once at module load (in a canonical frame) and only placed each frame. The left hand is
// the one that casts: its spread and curl change with the pose, so it is built every frame (still without allocation).
import { newBuiltBuf, type BuiltBuf, type V3 } from '../built';
import { newCloth, type Cloth } from './cloth';
import { LICH_PAINT } from './paint';
import { ROBE_RINGS } from './rings';
import { restPose, type LichPose } from './pose';

export const LICH = { height: 21.6, unit: 21.6 / 21.2, hem: 5.9, bodyVerts: 20000, bodyIndices: 110000, clawVerts: 5000, clawIndices: 26000 } as const;

export interface LichAnchors { gem: V3; eyes: V3; chest: V3; hand: V3; tome: V3; eyeL: V3; eyeR: V3 }
export interface LichOut { body: BuiltBuf; claws: BuiltBuf; anchors: LichAnchors }
export function newLichOut(): LichOut {
  return { body: newBuiltBuf(LICH.bodyVerts, LICH.bodyIndices), claws: newBuiltBuf(LICH.clawVerts, LICH.clawIndices), anchors: { gem: [0, 0, 0], eyes: [0, 0, 0], chest: [0, 0, 0], hand: [0, 0, 0], tome: [0, 0, 0], eyeL: [0, 0, 0], eyeR: [0, 0, 0] } };
}

// ---------------------------------------------------------------- numbers
const AW = LICH_PAINT.w, AH = LICH_PAINT.h, WU = 8 / AW, WV = 8 / AH;
const DEG = Math.PI / 180, TAU = Math.PI * 2;
const mixn = (a: number, b: number, t: number): number => a + (b - a) * t;
const S = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const BONE = [0.8, 0.8, 0.72], BONE_DARK = [0.5, 0.5, 0.44], CLOTH = [0.15, 0.15, 0.18], CLOTH_IN = [0.2, 0.12, 0.27], TRIM = [0.42, 0.38, 0.52];
const METAL = [0.19, 0.11, 0.3], GEM = [0.72, 0.9, 1.0], EYE = [0.93, 0.9, 1.0], GHOST = [0.3, 0.42, 0.62];
const SOCKET = { lon: 30, lat: -5, rho: 19.5 }, NOSE_LAT = -25, STAFF_LEN = 19.7, SKULL_R = 1.9;

// ---------------------------------------------------------------- buffer functions
function vert(b: BuiltBuf, px: number, py: number, pz: number, nx: number, ny: number, nz: number, u: number, v: number, unlit: number, ao: number, r: number, g: number, bl: number): number {
  const i = b.verts++, k = i * 3;
  b.position[k] = px; b.position[k + 1] = py; b.position[k + 2] = pz;
  b.normal[k] = nx; b.normal[k + 1] = ny; b.normal[k + 2] = nz;
  b.uv[i * 2] = u; b.uv[i * 2 + 1] = v; b.look[i * 2] = unlit; b.look[i * 2 + 1] = ao;
  b.colour[k] = r; b.colour[k + 1] = g; b.colour[k + 2] = bl;
  return i;
}
function tri(b: BuiltBuf, a: number, c: number, d: number): void { b.index[b.indices++] = a; b.index[b.indices++] = c; b.index[b.indices++] = d; }
/** A grid of `rows` x `cols` vertices that starts at `first`. */
function grid(b: BuiltBuf, first: number, rows: number, cols: number, flip: boolean): void {
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
    const a = first + i * cols + j, c = a + cols;
    if (flip) { tri(b, a, a + 1, c); tri(b, a + 1, c + 1, c); } else { tri(b, a, c, a + 1); tri(b, a + 1, c, c + 1); }
  }
}
/** Smooth normals for the vertices from `v0` on, from the triangles from `i0` on. */
function normals(b: BuiltBuf, v0: number, i0: number): void {
  const p = b.position, n = b.normal, ix = b.index;
  n.fill(0, v0 * 3, b.verts * 3);
  for (let i = i0; i < b.indices; i += 3) {
    const a = ix[i] * 3, c = ix[i + 1] * 3, d = ix[i + 2] * 3;
    const ux = p[c] - p[a], uy = p[c + 1] - p[a + 1], uz = p[c + 2] - p[a + 2], vx = p[d] - p[a], vy = p[d + 1] - p[a + 1], vz = p[d + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    n[a] += nx; n[a + 1] += ny; n[a + 2] += nz; n[c] += nx; n[c + 1] += ny; n[c + 2] += nz; n[d] += nx; n[d + 1] += ny; n[d + 2] += nz;
  }
  for (let i = v0 * 3; i < b.verts * 3; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
}
/** Two columns of a grid share their normals (a seam whose vertices are doubled for the texture). */
function weld(b: BuiltBuf, first: number, rows: number, cols: number): void {
  const n = b.normal;
  for (let i = 0; i < rows; i++) {
    const a = (first + i * cols) * 3, c = (first + i * cols + cols - 1) * 3;
    const x = n[a] + n[c], y = n[a + 1] + n[c + 1], z = n[a + 2] + n[c + 2], l = Math.hypot(x, y, z) || 1;
    n[a] = n[c] = x / l; n[a + 1] = n[c + 1] = y / l; n[a + 2] = n[c + 2] = z / l;
  }
}
function paint(b: BuiltBuf, v0: number, r: number, g: number, bl: number): void { for (let i = v0; i < b.verts; i++) { b.colour[i * 3] = r; b.colour[i * 3 + 1] = g; b.colour[i * 3 + 2] = bl; } }

// ---------------------------------------------------------------- tubes (scratch: points, radii, colours, drooping)
const MAXP = 16;
const TP = new Float64Array(MAXP * 3), TT = new Float64Array(MAXP * 3), TRY = new Float64Array(MAXP), TRZ = new Float64Array(MAXP), TC = new Float64Array(MAXP * 3), TDR = new Float64Array(MAXP);
const pt = (i: number, x: number, y: number, z: number): void => { TP[i * 3] = x; TP[i * 3 + 1] = y; TP[i * 3 + 2] = z; };
const rad = (i: number, ry: number, rz: number): void => { TRY[i] = ry; TRZ[i] = rz; };
const col = (i: number, r: number, g: number, b: number): void => { TC[i * 3] = r; TC[i * 3 + 1] = g; TC[i * 3 + 2] = b; };
const colAll = (n: number, c: ArrayLike<number>, k = 1): void => { for (let i = 0; i < n; i++) col(i, c[0] * k, c[1] * k, c[2] * k); };

/** A tube through the `n` scratch points with an elliptical cross-section (half height `TRY`, half width `TRZ`); the frame is carried along, so it never twists. */
function tube(b: BuiltBuf, n: number, seg: number, sx: number, sy: number, sz: number, unlit: number, cap0: boolean, cap1: boolean, upright: boolean, droop: boolean): void {
  const first = b.verts;
  for (let i = 0; i < n; i++) {
    const a = Math.min(n - 1, i + 1) * 3, c = Math.max(0, i - 1) * 3;
    const x = TP[a] - TP[c], y = TP[a + 1] - TP[c + 1], z = TP[a + 2] - TP[c + 2], l = Math.hypot(x, y, z) || 1;
    TT[i * 3] = x / l; TT[i * 3 + 1] = y / l; TT[i * 3 + 2] = z / l;
  }
  for (let i = 0; i < n; i++) {
    const tx = TT[i * 3], ty = TT[i * 3 + 1], tz = TT[i * 3 + 2], d = sx * tx + sy * ty + sz * tz;
    sx -= tx * d; sy -= ty * d; sz -= tz * d;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    let ux = sy * tz - sz * ty, uy = sz * tx - sx * tz, uz = sx * ty - sy * tx;
    if (upright && uy < 0) { sx = -sx; sy = -sy; sz = -sz; ux = -ux; uy = -uy; uz = -uz; }
    const ry = Math.max(0.01, TRY[i]), rz = Math.max(0.01, TRZ[i]), cr = TC[i * 3], cg = TC[i * 3 + 1], cb = TC[i * 3 + 2];
    for (let j = 0; j <= seg; j++) {
      const an = Math.PI / 2 + (j / seg) * TAU, ca = Math.cos(an), sa = Math.sin(an), f = sa < 0 && droop ? TDR[i] : 1;
      const o1 = rz * ca, o2 = ry * sa * f, n1 = ca / rz, n2 = sa / (ry * f);
      const nx = sx * n1 + ux * n2, ny = sy * n1 + uy * n2, nz = sz * n1 + uz * n2, nl = Math.hypot(nx, ny, nz) || 1;
      vert(b, TP[i * 3] + sx * o1 + ux * o2, TP[i * 3 + 1] + sy * o1 + uy * o2, TP[i * 3 + 2] + sz * o1 + uz * o2, nx / nl, ny / nl, nz / nl, WU, WV, unlit, 1, cr, cg, cb);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) { const a = first + i * (seg + 1) + j, c = a + seg + 1; tri(b, a, c, a + 1); tri(b, a + 1, c, c + 1); }
  for (let e = 0; e < 2; e++) {
    if (!(e === 0 ? cap0 : cap1)) continue;
    const at = e === 0 ? 0 : n - 1, dir = e === 0 ? -1 : 1, rr = Math.min(TRY[at], TRZ[at]), k = dir * 0.5 * rr;
    const c = vert(b, TP[at * 3] + TT[at * 3] * k, TP[at * 3 + 1] + TT[at * 3 + 1] * k, TP[at * 3 + 2] + TT[at * 3 + 2] * k, TT[at * 3] * dir, TT[at * 3 + 1] * dir, TT[at * 3 + 2] * dir, WU, WV, unlit, 1, TC[at * 3], TC[at * 3 + 1], TC[at * 3 + 2]);
    for (let j = 0; j < seg; j++) tri(b, c, first + at * (seg + 1) + j, first + at * (seg + 1) + j + 1);
  }
}

// ---------------------------------------------------------------- templates: built once in a canonical frame, placed with a frame
/** A frame: origin (0..2), then the images of the canonical x, y and z axes (3..5, 6..8, 9..11). */
const frame = (): Float64Array => new Float64Array(12);
function place(b: BuiltBuf, T: BuiltBuf, F: Float64Array): void {
  const first = b.verts, n = T.verts, p = T.position, q = T.normal;
  for (let i = 0; i < n; i++) {
    const k = i * 3, x = p[k], y = p[k + 1], z = p[k + 2], nx = q[k], ny = q[k + 1], nz = q[k + 2];
    vert(b, F[0] + F[3] * x + F[6] * y + F[9] * z, F[1] + F[4] * x + F[7] * y + F[10] * z, F[2] + F[5] * x + F[8] * y + F[11] * z,
      F[3] * nx + F[6] * ny + F[9] * nz, F[4] * nx + F[7] * ny + F[10] * nz, F[5] * nx + F[8] * ny + F[11] * nz,
      T.uv[i * 2], T.uv[i * 2 + 1], T.look[i * 2], T.look[i * 2 + 1], T.colour[k], T.colour[k + 1], T.colour[k + 2]);
  }
  for (let i = 0; i < T.indices; i++) b.index[b.indices++] = first + T.index[i];
}

// ---------------------------------------------------------------- the hand: four fingers and a thumb from the wrist
const HA = new Float64Array(9); // the hand's frame: where the fingers point (0..2), the palm's normal (3..5), the side (6..8)
const HC = new Float64Array(3);
function handFrame(fx: number, fy: number, fz: number, px: number, py: number, pz: number): void {
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  const d = px * fx + py * fy + pz * fz;
  px -= fx * d; py -= fy * d; pz -= fz * d;
  const pl = Math.hypot(px, py, pz) || 1; px /= pl; py /= pl; pz /= pl;
  HA[0] = fx; HA[1] = fy; HA[2] = fz; HA[3] = px; HA[4] = py; HA[5] = pz;
  HA[6] = fy * pz - fz * py; HA[7] = fz * px - fx * pz; HA[8] = fx * py - fy * px;
}
function finger(b: BuiltBuf, unlit: number, bx: number, by: number, bz: number, dx: number, dy: number, dz: number, l0: number, l1: number, l2: number, curl0: number, curl: number, r: number): void {
  pt(0, bx, by, bz); rad(0, r * 1.15, r * 1.15);
  let px = bx, py = by, pz = bz;
  for (let k = 0; k < 3; k++) {
    const th = curl0 + k * curl, c = Math.cos(th), s = Math.sin(th), len = k === 0 ? l0 : k === 1 ? l1 : l2;
    let x = dx * c + HA[3] * s, y = dy * c + HA[4] * s, z = dz * c + HA[5] * s;
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    const qx = px + x * len, qy = py + y * len, qz = pz + z * len;
    pt(1 + 2 * k, px + (qx - px) * 0.5, py + (qy - py) * 0.5, pz + (qz - pz) * 0.5); rad(1 + 2 * k, r * 0.62, r * 0.62);
    pt(2 + 2 * k, qx, qy, qz); rad(2 + 2 * k, k === 2 ? r * 0.4 : r, k === 2 ? r * 0.4 : r);
    px = qx; py = qy; pz = qz;
  }
  colAll(7, HC);
  tube(b, 7, 5, HA[6], HA[7], HA[8], unlit, true, true, false, false);
}
/** The hand in the frame of `HA`, from the wrist `w`. */
function handCore(b: BuiltBuf, wx: number, wy: number, wz: number, spread: number, curl: number, thumb: number, s: number, unlit: number): void {
  const fx = HA[0], fy = HA[1], fz = HA[2], sx = HA[6], sy = HA[7], sz = HA[8];
  for (let j = 0; j < 4; j++) {
    const q = j / 3 - 0.5, sg = q * 2 * spread, cs = Math.cos(sg), sn = Math.sin(sg);
    let dx = fx * cs + sx * sn, dy = fy * cs + sy * sn, dz = fz * cs + sz * sn;
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const kx = wx + fx * 0.85 * s + sx * q * 0.62 * s, ky = wy + fy * 0.85 * s + sy * q * 0.62 * s, kz = wz + fz * 0.85 * s + sz * q * 0.62 * s;
    pt(0, wx + sx * q * 0.2 * s, wy + sy * q * 0.2 * s, wz + sz * q * 0.2 * s); pt(1, kx, ky, kz); rad(0, 0.07 * s, 0.07 * s); rad(1, 0.075 * s, 0.075 * s);
    colAll(2, HC);
    tube(b, 2, 4, sx, sy, sz, unlit, false, false, false, false);
    const lf = (j === 0 ? 0.9 : j === 1 ? 1 : j === 2 ? 0.95 : 0.74) * s;
    finger(b, unlit, kx, ky, kz, dx, dy, dz, 0.56 * lf, 0.42 * lf, 0.32 * lf, curl * 0.6, curl, 0.09 * s);
  }
  let tx = fx * 0.55 + sx * thumb * 0.83, ty = fy * 0.55 + sy * thumb * 0.83, tz = fz * 0.55 + sz * thumb * 0.83;
  const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
  finger(b, unlit, wx + sx * thumb * 0.2 * s + fx * 0.12 * s, wy + sy * thumb * 0.2 * s + fy * 0.12 * s, wz + sz * thumb * 0.2 * s + fz * 0.12 * s, tx, ty, tz, 0.5 * s, 0.4 * s, 0.3 * s, curl * 0.4, curl * 0.7, 0.095 * s);
  pt(0, wx - fx * 0.12 * s, wy - fy * 0.12 * s, wz - fz * 0.12 * s); pt(1, wx + fx * 0.1 * s, wy + fy * 0.1 * s, wz + fz * 0.1 * s);
  rad(0, 0.11 * s, 0.24 * s); rad(1, 0.1 * s, 0.22 * s);
  colAll(2, HC);
  tube(b, 2, 6, sx, sy, sz, unlit, true, true, false, false);
}
/** A hand built straight into `b`: `f`: where the fingers point, `pn`: the palm's normal (the fingers curl toward it). */
function hand(b: BuiltBuf, wx: number, wy: number, wz: number, fx: number, fy: number, fz: number, px: number, py: number, pz: number, spread: number, curl: number, thumb: number, s: number, c: number[], k: number, unlit: number): void {
  handFrame(fx, fy, fz, px, py, pz);
  HC[0] = c[0] * k; HC[1] = c[1] * k; HC[2] = c[2] * k;
  handCore(b, wx, wy, wz, spread, curl, thumb, s, unlit);
}
function handTemplate(spread: number, curl: number, thumb: number, s: number, unlit: number): BuiltBuf {
  const T = newBuiltBuf(600, 3000);
  hand(T, 0, 0, 0, 1, 0, 0, 0, 1, 0, spread, curl, thumb, s, BONE, 1, unlit);
  return T;
}
/** `HA` holds the hand's frame (set by `handFrame`); the wrist is `w`. The colour overwrites the template's; `uv` 0.5 for the shapes of light. */
const HF = frame();
function placeHand(b: BuiltBuf, T: BuiltBuf, wx: number, wy: number, wz: number, c: number[], k: number, solid: boolean): void {
  HF[0] = wx; HF[1] = wy; HF[2] = wz;
  for (let i = 0; i < 9; i++) HF[3 + i] = HA[i];
  const v0 = b.verts;
  place(b, T, HF);
  paint(b, v0, c[0] * k, c[1] * k, c[2] * k);
  if (solid) for (let i = v0; i < b.verts; i++) { b.uv[i * 2] = 0.5; b.uv[i * 2 + 1] = 0.5; }
}
/** The right hand's two variants (thumb -1, +1) and the claws' (side -1, +1): spreads and curls are fixed there. */
const RIGHT_HAND = [handTemplate(0.08, 1.15, -1, 1, 0), handTemplate(0.08, 1.15, 1, 1, 0)];
const CLAW_HAND = [handTemplate(0.3, 0.62, -1, 1.25, 1), handTemplate(0.3, 0.62, 1, 1.25, 1)];

// ---------------------------------------------------------------- the skull (built once, placed every frame)
function skullR(lonD: number, latD: number): number {
  const lon = lonD * DEG, lat = latD * DEG, al = Math.abs(lonD);
  const dx = Math.cos(lat) * Math.cos(lon), dy = Math.sin(lat), dz = Math.cos(lat) * Math.sin(lon);
  let r = 1 / Math.sqrt((dx / 1.04) ** 2 + (dy / 1.04) ** 2 + (dz / 0.94) ** 2);
  const low = S(-14, -42, latD);
  r *= 1 - low * (0.5 - 0.36 * Math.max(0, dx) ** 1.5);
  r *= 1 + 0.13 * Math.exp(-((al - 56) ** 2 + (latD + 20) ** 2) / 170); // cheekbones
  r *= 1 + 0.07 * Math.exp(-((latD - 13) ** 2) / 40) * S(62, 40, al); // the brow
  r *= 1 - 0.09 * Math.exp(-((al - 80) ** 2 + (latD + 2) ** 2) / 250); // the temples
  r *= 1 + 0.2 * Math.exp(-((latD + 47) ** 2) / 110) * S(48, 28, al); // the upper jaw stands forward
  r *= 1 - 0.2 * (1 - S(0.5, 1.05, Math.hypot(lonD / 6.5, (latD - NOSE_LAT) / 7))); // the nose
  const c = Math.sin(latD * DEG) * Math.sin(SOCKET.lat * DEG) + Math.cos(latD * DEG) * Math.cos(SOCKET.lat * DEG) * Math.cos((al - SOCKET.lon) * DEG);
  const sd = Math.acos(Math.min(1, Math.max(-1, c))) / DEG;
  r *= 1 - 0.44 * (1 - S(SOCKET.rho * 0.68, SOCKET.rho, sd)); // the eye sockets
  r *= 1 - 0.62 * S(-55, -64, latD);
  return r;
}
const SP = new Float64Array(3);
function skullXYZ(lonD: number, latD: number, depth: number): void {
  const r = skullR(lonD, latD) * SKULL_R * depth, lon = lonD * DEG, lat = latD * DEG;
  SP[0] = r * Math.cos(lat) * Math.cos(lon); SP[1] = r * Math.sin(lat); SP[2] = r * Math.cos(lat) * Math.sin(lon);
}
const NLON = 72, NLAT = 44;
const SKULL = ((): BuiltBuf => {
  const b = newBuiltBuf((NLON + 1) * (NLAT + 1), NLON * NLAT * 6);
  for (let i = 0; i <= NLAT; i++) for (let j = 0; j <= NLON; j++) {
    skullXYZ(-180 + (360 * j) / NLON, -90 + (180 * i) / NLAT, 1);
    vert(b, SP[0], SP[1], SP[2], 0, 1, 0, (16.5 + (j / NLON) * 255) / AW, (0.5 + (i / NLAT) * 127) / AH, 0, 1, 1, 1, 1);
  }
  grid(b, 0, NLAT + 1, NLON + 1, false);
  normals(b, 0, 0);
  const top = (Math.floor(NLAT * 0.8) * (NLON + 1) + NLON / 2) * 3; // outward: the crown's normal points up
  if (b.normal[top] * b.position[top] + b.normal[top + 1] * b.position[top + 1] + b.normal[top + 2] * b.position[top + 2] < 0) {
    for (let i = 0; i < b.indices; i += 3) { const t = b.index[i + 1]; b.index[i + 1] = b.index[i + 2]; b.index[i + 2] = t; }
    normals(b, 0, 0);
  }
  weld(b, 0, NLAT + 1, NLON + 1);
  return b;
})();
/** The two eye lights in skull space (floating in the sockets). */
const EYE_PT = ((): Float64Array => { const e = new Float64Array(6); for (let s = 0; s < 2; s++) { skullXYZ((s === 0 ? -1 : 1) * SOCKET.lon, SOCKET.lat, 1.42); e[s * 3] = SP[0]; e[s * 3 + 1] = SP[1]; e[s * 3 + 2] = SP[2]; } return e; })();

// ---------------------------------------------------------------- the staff (built once, placed every frame)
// Canonical frame: x across (the staff's side), y along it from the foot, z the staff's up; the foot at the origin.
const SL = STAFF_LEN, STAFF_R = 0.26;
const GEM_VERTS = 5 * 7;
const STAFF = ((): BuiltBuf => {
  const b = newBuiltBuf(900, 4500);
  for (let half = 0; half < 2; half++) {
    const s0 = b.verts, NS = 12, SEG = 10;
    for (let i = 0; i <= NS; i++) for (let j = 0; j <= SEG; j++) {
      const an = (j / SEG) * TAU, ca = Math.cos(an), sa = Math.sin(an);
      vert(b, STAFF_R * ca, ((half + i / NS) * SL) / 2, STAFF_R * sa, ca, 0, sa, (16.5 + (i / NS) * 255) / AW, (128.5 + half * 48 + (j / SEG) * 47) / AH, 0, 1, 1, 1, 1);
    }
    grid(b, s0, NS + 1, SEG + 1, false);
  }
  const onStaff = (i: number, h: number, sx = 0, sz = 0): void => pt(i, sx, h, sz);
  onStaff(0, -0.12); onStaff(1, 0.1); onStaff(2, 0.7); onStaff(3, 0.85);
  [0.16, 0.33, 0.33, 0.27].forEach((r, i) => rad(i, r, r)); colAll(4, METAL);
  tube(b, 4, 8, 0, 0, 1, 0, true, false, false, false);
  onStaff(0, SL - 0.75); onStaff(1, SL - 0.6); onStaff(2, SL - 0.15); onStaff(3, SL);
  [0.27, 0.37, 0.37, 0.27].forEach((r, i) => rad(i, r, r)); colAll(4, METAL);
  tube(b, 4, 8, 0, 0, 1, 0, false, false, false, false);
  return b;
})();
/** The gem, in the same canonical frame; its colour is written at placement. */
const STAFF_GEM = ((): BuiltBuf => {
  const b = newBuiltBuf(GEM_VERTS, 200);
  const gemC = SL + 0.85;
  [-0.55, -0.2, 0, 0.25, 0.6].forEach((d, i) => pt(i, 0, gemC + d, 0));
  [0.03, 0.3, 0.4, 0.28, 0.03].forEach((r, i) => rad(i, r, r)); colAll(5, GEM);
  tube(b, 5, 6, 0, 0, 1, 1, false, false, false, false);
  return b;
})();
const ST = frame(); // the staff's frame: base, side, axis, up
/** The three claws at the top that hold the gem. Built every frame: the spike seeds each tube's frame with the model's z axis, which is
 * not a fixed direction in the staff's own frame, so a placed template would differ in the vertices' phase round the thin tubes. */
function staffClaws(b: BuiltBuf): void {
  for (let q = 0; q < 3; q++) {
    const an = (q / 3) * TAU + 0.4, cx = Math.cos(an), cz = Math.sin(an);
    for (let i = 0; i < 4; i++) {
      const h = i === 0 ? SL - 0.2 : i === 1 ? SL + 0.3 : i === 2 ? SL + 0.9 : SL + 1.4, k = i === 0 ? 0.1 : i === 1 ? 0.52 : i === 2 ? 0.6 : 0.3, sx = k * cx, sz = k * cz;
      pt(i, ST[0] + ST[3] * sx + ST[6] * h + ST[9] * sz, ST[1] + ST[4] * sx + ST[7] * h + ST[10] * sz, ST[2] + ST[5] * sx + ST[8] * h + ST[11] * sz);
      rad(i, CLAW_R[i], CLAW_R[i]);
    }
    colAll(4, METAL, 1.15);
    tube(b, 4, 5, 0, 0, 1, 0, false, true, false, false);
  }
}
const CLAW_R = [0.17, 0.13, 0.1, 0.04];

// ---------------------------------------------------------------- the robe
const RINGS = ROBE_RINGS, NR = RINGS.length, RSEG = 48;
export { ROBE_RINGS };
const RF = new Float64Array(NR * 5);
RINGS.forEach((r, i) => r.forEach((v, k) => { RF[i * 5 + k] = v; }));
const RING_V = ((): Float64Array => {
  const d = new Float64Array(NR);
  for (let i = 1; i < NR; i++) d[i] = d[i - 1] + Math.hypot(RINGS[i][0] - RINGS[i - 1][0], RINGS[i][1] - RINGS[i - 1][1]);
  return d.map((v) => 1 - v / d[NR - 1]);
})();
// the angle-only parts of the robe's folds, per column
const CA = new Float64Array(RSEG + 1), SA = new Float64Array(RSEG + 1), FC = new Float64Array(RSEG + 1), FS = new Float64Array(RSEG + 1), F4 = new Float64Array(RSEG + 1);
const K11C = new Float64Array(RSEG + 1), K11S = new Float64Array(RSEG + 1), TRAIN = new Float64Array(RSEG + 1);
for (let j = 0; j <= RSEG; j++) {
  const an = Math.PI + (j / RSEG) * TAU, a9 = 9 * an + 1.3 * Math.sin(2 * an);
  CA[j] = Math.cos(an); SA[j] = Math.sin(an); FC[j] = Math.cos(a9); FS[j] = Math.sin(a9); F4[j] = Math.cos(4 * an + 1);
  K11C[j] = Math.cos(11 * an); K11S[j] = Math.sin(11 * an); TRAIN[j] = Math.max(0, -CA[j]) ** 2;
}

// ---------------------------------------------------------------- the body's line: a slight stoop, leaning on the staff
let GZ = 0, MV = 0, HU = 0, BOB = 0; // the gaze, the glide and the hurt of this frame, the bob of the body
/** A flinch (`hurt`) straightens the body: the stoop shrinks by up to 60 %. One function for the builder and `ringLean`. */
const stoopOf = (y: number, gaze: number, mv: number, hurt: number): number => (y > 11 ? 0.04 * (y - 11) ** 1.5 * (1 + 0.5 * gaze + 0.3 * mv) * (1 - 0.6 * hurt) : 0);
const sideOf = (y: number, mv: number): number => (y > 8 ? 0.022 * (y - 8) * (1 - mv * 0.6) : 0);
const lift = (y: number): number => (y > 4 ? BOB * S(4, 12, y) : 0);
const AT = new Float64Array(3);
function at(x: number, y: number, z: number): void { AT[0] = x + stoopOf(y, GZ, MV, HU); AT[1] = y + lift(y); AT[2] = z + sideOf(y, MV); }

/** The body's line at each ring (x forward, z sideways) for the cloth: the spike's `stoop` and `side`. Writes 2 floats per ring. */
export function ringLean(pose: LichPose, out: Float32Array): Float32Array {
  for (let i = 0; i < NR; i++) { out[i * 2] = stoopOf(RF[i * 5], pose.gaze, pose.glide, pose.hurt); out[i * 2 + 1] = sideOf(RF[i * 5], pose.glide); }
  return out;
}

function robe(b: BuiltBuf, pose: LichPose, cl: Cloth, cf: number, sf: number): void {
  const t = pose.t, mv = pose.glide, c9 = Math.cos(9 * t), s9 = Math.sin(9 * t);
  const back = Math.atan2(cl.vx * sf - cl.vz * cf, -(cl.vx * cf + cl.vz * sf)), cb = Math.cos(back), sb = Math.sin(back); // the velocity in the model frame
  const first = b.verts;
  for (let i = 0; i < NR; i++) {
    const y0 = RF[i * 5], hw = RF[i * 5 + 1], hd = RF[i * 5 + 2], fd = RF[i * 5 + 3], lag = Math.min(1, Math.max(0, RF[i * 5 + 4]));
    const c0 = cl.rx[i] * cf + cl.rz[i] * sf, c1 = -cl.rx[i] * sf + cl.rz[i] * cf; // the ring's centre in the model frame
    const tw = -wrap(pose.face - cl.rt[i]), ct = Math.cos(tw), st = Math.sin(tw);
    const y = y0 + lift(y0), ph = 0.25 * Math.sin(t * 0.9 + i * 0.3) + i * 0.05, cph = Math.cos(ph), sph = Math.sin(ph);
    const vv = (0.5 + RING_V[i] * 255) / AH, ml = mv * lag, l2 = lag * lag;
    for (let j = 0; j <= RSEG; j++) {
      const ca = CA[j], sa = SA[j], fold = 0.8 * (FC[j] * cph - FS[j] * sph) + 0.2 * F4[j], toBack = ca * cb + sa * sb;
      let m = 1 + fd * fold + ml * 0.05 * (K11S[j] * c9 - K11C[j] * s9);
      m *= 1 + 0.3 * l2 * TRAIN[j]; // a short train behind
      m *= 1 + mv * l2 * (0.42 * Math.max(0, toBack) ** 2 - 0.2 * Math.max(0, -toBack));
      const ex = hd * m * ca, ez = hw * m * sa;
      vert(b, c0 + ex * ct - ez * st, Math.max(0.05, y + (lag > 0.95 ? 0.05 * fold : 0)), c1 + ex * st + ez * ct, 0, 1, 0, (272.5 + (j / RSEG) * 127) / AW, vv, 0, 1, 1, 1, 1);
    }
  }
  const i0 = b.indices;
  grid(b, first, NR, RSEG + 1, true);
  normals(b, first, i0);
  weld(b, first, NR, RSEG + 1);
}

// ---------------------------------------------------------------- the head
const HD = frame(); // the head's frame: origin, HX (forward), HY (up), HZ (sideways); the skull is placed with it
const IH = new Float64Array(3);
function inHead(x: number, y: number, z: number): void {
  IH[0] = HD[0] + HD[3] * x + HD[6] * y + HD[9] * z; IH[1] = HD[1] + HD[4] * x + HD[7] * y + HD[10] * z; IH[2] = HD[2] + HD[5] * x + HD[8] * y + HD[11] * z;
}
const JAW = [-0.35, -0.95, 0.86, -0.3, -1.48, 0.78, 0.42, -1.74, 0.62, 0.98, -1.78, 0.35, 1.17, -1.78, 0];
let CJ = 1, SJ = 0;
/** A point in the jaw's space (hinged below the ears), into scratch point `i`. */
function jawPt(i: number, qx: number, qy: number, qz: number): void {
  const x = qx + 0.35, y = qy + 0.95;
  inHead(-0.35 + x * CJ + y * SJ, -0.95 - x * SJ + y * CJ, qz);
  pt(i, IH[0], IH[1], IH[2]);
}
function head(b: BuiltBuf, pose: LichPose, an: LichAnchors): void {
  const t = pose.t, gaze = pose.gaze;
  at(1.05, 19.6, 0);
  HD[0] = AT[0] + 0.5 * gaze; HD[1] = AT[1]; HD[2] = AT[2];
  const yaw = pose.headYaw, pitch = -0.46 + 0.16 * gaze + 0.05 * Math.sin(t * 0.7) - 0.22 * pose.novaUp - 0.1 * pose.flingOut - 0.25 * pose.hurt; // a more negative pitch tips the face up and back (as for the Nova)
  const cp = Math.cos(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  HD[3] = cy * cp; HD[4] = -Math.sin(pitch); HD[5] = sy * cp; // HX
  HD[9] = -sy; HD[10] = 0; HD[11] = cy; // HZ
  HD[6] = HD[10] * HD[5] - HD[11] * HD[4]; HD[7] = HD[11] * HD[3] - HD[9] * HD[5]; HD[8] = HD[9] * HD[4] - HD[10] * HD[3]; // HY = HZ x HX
  place(b, SKULL, HD);
  // the lower jaw: its own bone, hinged below the ears; it drops open when a spell is spoken
  const jawA = 0.02 + 0.03 * Math.sin(t * 0.8) + 0.3 * pose.flingOut + 0.4 * pose.novaHit + 0.22 * pose.raiseLift + 0.16 * gaze;
  CJ = Math.cos(jawA); SJ = Math.sin(jawA);
  for (let i = 0; i < 9; i++) {
    const k = i < 5 ? i : 8 - i, m = 1 - Math.abs(i - 4) / 4;
    jawPt(i, JAW[k * 3], JAW[k * 3 + 1], i < 5 ? JAW[k * 3 + 2] : -JAW[k * 3 + 2]);
    rad(i, 0.2 + 0.06 * m, 0.13 + 0.04 * m); col(i, BONE[0] * (0.8 + 0.1 * m), BONE[1] * (0.8 + 0.1 * m), BONE[2] * (0.8 + 0.1 * m));
  }
  tube(b, 9, 7, 0, 0, 1, 0, true, true, false, false);
  for (let q = -3; q <= 3; q++) { // the lower teeth: broad and flat, side by side along the jaw's front
    const a2 = (q / 3.6) * 1.2, tx = 0.56 + 0.58 * Math.cos(a2), tz = 0.44 * Math.sin(a2), wide = q === 0 ? 0.085 : 0.1;
    let ax = HD[3] * -0.58 * Math.sin(a2) + HD[9] * 0.44 * Math.cos(a2), ay = HD[4] * -0.58 * Math.sin(a2) + HD[10] * 0.44 * Math.cos(a2), az = HD[5] * -0.58 * Math.sin(a2) + HD[11] * 0.44 * Math.cos(a2);
    const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    jawPt(0, tx + 0.05, -1.62, tz); jawPt(1, tx + 0.06, -1.4, tz); jawPt(2, tx + 0.07, -1.2, tz);
    rad(0, 0.055, wide); rad(1, 0.055, wide); rad(2, 0.045, wide * 0.88);
    col(0, 0.86, 0.84, 0.72); col(1, 0.86, 0.84, 0.72); col(2, 0.86, 0.84, 0.72);
    tube(b, 3, 6, ax, ay, az, 0, false, true, false, false);
  }
  // the eyes: two small lights that float in the middle of the hollow sockets
  const r = 0.16 + 0.05 * gaze, glow = Math.min(1.3, pose.eye);
  for (let s = 0; s < 2; s++) {
    inHead(EYE_PT[s * 3], EYE_PT[s * 3 + 1], EYE_PT[s * 3 + 2]);
    const ex = IH[0], ey = IH[1], ez = IH[2], to = s === 0 ? an.eyeL : an.eyeR;
    to[0] = ex; to[1] = ey; to[2] = ez;
    pt(0, ex - HD[3] * r, ey - HD[4] * r, ez - HD[5] * r); pt(1, ex, ey, ez); pt(2, ex + HD[3] * r, ey + HD[4] * r, ez + HD[5] * r);
    rad(0, r * 0.55, r * 0.55); rad(1, r, r); rad(2, r * 0.55, r * 0.55);
    for (let i = 0; i < 3; i++) col(i, EYE[0] * glow, EYE[1] * glow, EYE[2] * glow);
    tube(b, 3, 6, 0, 0, 1, 1, true, true, false, false);
  }
  an.eyes[0] = (an.eyeL[0] + an.eyeR[0]) / 2; an.eyes[1] = (an.eyeL[1] + an.eyeR[1]) / 2; an.eyes[2] = (an.eyeL[2] + an.eyeR[2]) / 2;
}

/** The collar: high behind the head, open in front, a purple lining. */
function collar(b: BuiltBuf): void {
  const COLS = 27, ROWS = 7;
  for (let inner = 0; inner < 2; inner++) {
    const c0 = b.verts, j0 = b.indices, base = inner ? CLOTH_IN : CLOTH;
    for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) {
      const s = i / (ROWS - 1), an = (-132 + (264 * j) / (COLS - 1)) * DEG, ca = Math.cos(an);
      const h = 1.1 + 4.4 * Math.max(0, Math.cos(an / 2)) ** 1.7 + 0.9 * Math.exp(-((an / (22 * DEG)) ** 2));
      const rxc = mixn(1.2, 2.25, s ** 0.8) - inner * 0.07, rzc = mixn(2.3, 2.75, s) - inner * 0.07;
      at(0.3 - ca * rxc, 16.2 - 0.5 * (1 - ca) * (1 - s) + h * s, Math.sin(an) * rzc);
      const edge = Math.min(1, S(0.82, 1, s) + S(0.9, 1, Math.abs(an) / (132 * DEG)) * 0.8) * (inner ? 0.5 : 1);
      vert(b, AT[0], AT[1], AT[2], 0, 1, 0, WU, WV, 0, 1, mixn(base[0], TRIM[0], edge), mixn(base[1], TRIM[1], edge), mixn(base[2], TRIM[2], edge));
    }
    grid(b, c0, ROWS, COLS, inner === 1);
    normals(b, c0, j0);
  }
}

// ---------------------------------------------------------------- the staff in place, the arms
const EL = new Float64Array(3);
/** The middle joint of a two-bone limb from `a` to `c`, bent toward `pole`, into `EL`. */
function ik(ax: number, ay: number, az: number, cx: number, cy: number, cz: number, l1: number, l2: number, px: number, py: number, pz: number): void {
  const x0 = cx - ax, y0 = cy - ay, z0 = cz - az, l0 = Math.hypot(x0, y0, z0) || 1, d = Math.min(l0, (l1 + l2) * 0.999), dx = x0 / l0, dy = y0 / l0, dz = z0 / l0;
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x)), dp = px * dx + py * dy + pz * dz;
  let qx = px - dx * dp, qy = py - dy * dp, qz = pz - dz * dp;
  const ql = Math.hypot(qx, qy, qz) || 1; qx /= ql; qy /= ql; qz /= ql;
  EL[0] = ax + dx * x + qx * h; EL[1] = ay + dy * x + qy * h; EL[2] = az + dz * x + qz * h;
}
const SLEEVE_RY = [0.95, 0.85, 0.8, 0.95, 1.2, 1.3], SLEEVE_RZ = [0.9, 0.8, 0.75, 0.85, 1.0, 1.1], SLEEVE_DROOP = [1, 1, 1.15, 1.6, 2.3, 2.6];
/** A sleeve to the wrist and the bones of the forearm. */
function sleeve(b: BuiltBuf, sx: number, sy: number, sz: number, wx: number, wy: number, wz: number, px: number, py: number, pz: number): void {
  ik(sx, sy, sz, wx, wy, wz, 3.7, 3.7, px, py, pz);
  const ex = EL[0], ey = EL[1], ez = EL[2], cx = ex + (wx - ex) * 0.72, cy = ey + (wy - ey) * 0.72, cz = ez + (wz - ez) * 0.72;
  const dl = Math.hypot(wx - ex, wy - ey, wz - ez) || 1, nx = (wx - ex) / dl, ny = (wy - ey) / dl, nz = (wz - ez) / dl;
  pt(0, sx, sy, sz); pt(1, (sx + ex) / 2, (sy + ey) / 2, (sz + ez) / 2); pt(2, ex, ey, ez);
  pt(3, ex + (cx - ex) * 0.55, ey + (cy - ey) * 0.55, ez + (cz - ez) * 0.55); pt(4, cx, cy, cz); pt(5, cx + nx * 0.5, cy - 0.25 + ny * 0.5, cz + nz * 0.5);
  for (let i = 0; i < 6; i++) { rad(i, SLEEVE_RY[i], SLEEVE_RZ[i]); TDR[i] = SLEEVE_DROOP[i]; const c = i === 5 ? TRIM : CLOTH; col(i, c[0], c[1], c[2]); }
  const kx = -(wz - sz), kz = wx - sx, kl = Math.hypot(kx, kz) || 1; // cross(wrist - shoulder, up)
  tube(b, 6, 12, kx / kl, 0, kz / kl, 0, false, false, true, true);
  pt(0, ex, ey, ez); pt(1, wx, wy, wz); rad(0, 0.2, 0.2); rad(1, 0.15, 0.15); colAll(2, BONE_DARK);
  tube(b, 2, 5, 0, 0, 1, 0, false, false, false, false);
}
const HP = new Float64Array(3), HFV = new Float64Array(3), HNV = new Float64Array(3);
let LSPREAD = 0, LCURL = 0;
function pull(w: number, qx: number, qy: number, qz: number, fx: number, fy: number, fz: number, nx: number, ny: number, nz: number, sp: number, cu: number): void {
  HP[0] = mixn(HP[0], qx, w); HP[1] = mixn(HP[1], qy, w); HP[2] = mixn(HP[2], qz, w);
  HFV[0] = mixn(HFV[0], fx, w); HFV[1] = mixn(HFV[1], fy, w); HFV[2] = mixn(HFV[2], fz, w);
  HNV[0] = mixn(HNV[0], nx, w); HNV[1] = mixn(HNV[1], ny, w); HNV[2] = mixn(HNV[2], nz, w);
  LSPREAD = mixn(LSPREAD, sp, w); LCURL = mixn(LCURL, cu, w);
}

function staffAndArms(b: BuiltBuf, pose: LichPose, an: LichAnchors): void {
  const { novaUp, novaChest, novaOut, raiseUp, raiseLow, raiseLift, flingBack, flingOut } = pose, mv = pose.glide, t = pose.t;
  const reach = Math.max(flingOut, raiseLift, novaOut);
  // the staff: planted at rest, lifted and tilted back in motion, raised for the Nova, struck down for Nova and Raise Dead
  const bx = 3.6 - 0.7 * mv + 0.7 * novaUp + 0.3 * raiseUp, by = 0.9 * mv * (1 - novaUp) + 7.2 * novaUp + 2.8 * raiseUp + pose.strike, bz = 5.4 - 1.9 * novaUp + 1.1 * reach;
  let ax = -0.03 + 0.17 * mv - 0.05 * novaUp, ay = 1, az = -0.1 + 0.09 * novaUp + 0.1 * reach + 0.02 * Math.sin(t * 0.8) * (1 - mv);
  const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
  let sx = ay, sy = -ax, sz = 0; // cross(axis, [0, 0, 1])
  const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
  const ux = sy * az - sz * ay, uy = sz * ax - sx * az, uz = sx * ay - sy * ax; // cross(side, axis)
  ST[0] = bx; ST[1] = by; ST[2] = bz; ST[3] = sx; ST[4] = sy; ST[5] = sz; ST[6] = ax; ST[7] = ay; ST[8] = az; ST[9] = ux; ST[10] = uy; ST[11] = uz;
  place(b, STAFF, ST);
  staffClaws(b);
  place(b, STAFF_GEM, ST);
  paint(b, b.verts - GEM_VERTS,GEM[0] * Math.min(1.25, 0.65 + 0.4 * pose.gem), GEM[1] * Math.min(1.25, 0.65 + 0.4 * pose.gem), GEM[2] * Math.min(1.25, 0.65 + 0.4 * pose.gem)); // the gem is unlit: its own colour carries the pulse
  const gh = SL + 0.85;
  an.gem[0] = bx + ax * gh; an.gem[1] = by + ay * gh; an.gem[2] = bz + az * gh;

  // the right hand grips the staff; the hand continues the forearm: its fingers run on across the staff and close round it
  const gr = SL * 0.6 - 4.2 * novaUp - 1.2 * raiseUp, gx = bx + ax * gr, gy = by + ay * gr, gz = bz + az * gr;
  at(0.3, 15.9, 2.25);
  const shx = AT[0], shy = AT[1], shz = AT[2];
  ik(shx, shy, shz, gx, gy, gz, 3.7, 3.7, -1, -0.7, -0.15);
  let qx = gx - EL[0], qy = gy - EL[1], qz = gz - EL[2];
  const qd = qx * ax + qy * ay + qz * az;
  qx -= ax * qd; qy -= ay * qd; qz -= az * qd;
  const ql = Math.hypot(qx, qy, qz) || 1, fx = qx / ql, fy = qy / ql, fz = qz / ql;
  let nx = ay * fz - az * fy, ny = az * fx - ax * fz, nz = ax * fy - ay * fx; // the palm on the staff's outer side
  if (nz > 0) { nx = -nx; ny = -ny; nz = -nz; }
  const wx = gx - nx * 0.3 - fx * 0.8, wy = gy - ny * 0.3 - fy * 0.8, wz = gz - nz * 0.3 - fz * 0.8;
  sleeve(b, shx, shy, shz, wx + fx * 0.15, wy + fy * 0.15, wz + fz * 0.15, -1, -0.7, -0.15);
  handFrame(fx, fy, fz, nx, ny, nz);
  placeHand(b, RIGHT_HAND[fz * nx - fx * nz > 0 ? 1 : 0], wx, wy, wz, BONE, 1, false);

  // the left hand is the one that casts
  at(0.3, 15.9, -2.25);
  const lx = AT[0], ly = AT[1], lz = AT[2];
  HP[0] = 3.3; HP[1] = 12.3 + 0.15 * Math.sin(t * 1.1); HP[2] = -1.9; HFV[0] = 0.9; HFV[1] = -0.3; HFV[2] = 0.2; HNV[0] = -0.2; HNV[1] = -1; HNV[2] = 0; LSPREAD = 0.24; LCURL = 0.3;
  pull(novaChest, 1.9, 13.8, -0.5, 0.3, 0.9, 0.3, 0.9, 0, 0.3, 0.1, 0.55);
  pull(novaOut, 3.8, 17, -8, 0.35, 0.3, -0.9, 0.8, -0.3, 0.2, 0.5, 0.05);
  pull(raiseLow, 5, 10.8, -3.6, 1, -0.1, -0.2, 0, -1, 0, 0.45, 0.12);
  pull(raiseLift, 4.8, 20.4, -4.4, 0.5, 0.85, -0.2, -0.5, 0.6, 0.2, 0.4, 0.6);
  pull(flingBack, 0.4, 15.2, -3.4, -0.2, 0.9, -0.3, 0.9, 0.2, 0, 0.2, 0.6);
  pull(flingOut, 7.3, 15.2, -1.3, 1, 0.08, 0.05, 0.2, -0.9, 0, 0.5, 0.04);
  an.hand[0] = HP[0]; an.hand[1] = HP[1]; an.hand[2] = HP[2];
  sleeve(b, lx, ly, lz, HP[0], HP[1], HP[2], -0.7, -0.4, -0.6);
  const hl = Math.hypot(HFV[0], HFV[1], HFV[2]) || 1;
  hand(b, HP[0] - (HFV[0] / hl) * 0.3, HP[1] - (HFV[1] / hl) * 0.3, HP[2] - (HFV[2] / hl) * 0.3, HFV[0], HFV[1], HFV[2], HNV[0], HNV[1], HNV[2], LSPREAD, LCURL, 1, 1, BONE, 1, 0);
}

// ---------------------------------------------------------------- the tome and the ghostly claws
const PWD = 3.1, PHT = 4.3;
const BC = new Float64Array(3), BR = new Float64Array(3), BN = new Float64Array(3), BU2 = new Float64Array(3);
/** A page that lies at the angle `phi` round the spine (0: flat to the right, pi: flat to the left). `half`: which half of the painting. */
function page(b: BuiltBuf, phi: number, half: number, liftN: number, curve: number, cover: boolean): void {
  const p0 = b.verts, j0 = b.indices, QN = 7, SN = 2, w = cover ? PWD + 0.2 : PWD, hgt = cover ? PHT + 0.3 : PHT, cp = Math.cos(phi), sp = Math.sin(phi);
  for (let i = 0; i < SN; i++) for (let j = 0; j < QN; j++) {
    const q = j / (QN - 1), s = i / (SN - 1), bend = curve * Math.sin(Math.PI * q) ** 0.7 * (1 - 0.45 * q);
    const hh = (s - 0.5) * hgt, ww = q * w;
    const px = BC[0] + BU2[0] * hh + (BR[0] * cp + BN[0] * sp) * ww + (-BR[0] * sp + BN[0] * cp) * bend + BN[0] * liftN;
    const py = BC[1] + BU2[1] * hh + (BR[1] * cp + BN[1] * sp) * ww + (-BR[1] * sp + BN[1] * cp) * bend + BN[1] * liftN;
    const pz = BC[2] + BU2[2] * hh + (BR[2] * cp + BN[2] * sp) * ww + (-BR[2] * sp + BN[2] * cp) * bend + BN[2] * liftN;
    vert(b, px, py, pz, 0, 1, 0, (400.5 + (half ? 56 + q * 55 : 55 - q * 55)) / AW, cover ? (96.5 + s * 63) / AH : (0.5 + s * 95) / AH, 0, 1, 1, 1, 1);
  }
  grid(b, p0, SN, QN, cp < 0);
  normals(b, p0, j0);
}
function tome(b: BuiltBuf, pose: LichPose, cl: Cloth, cf: number, sf: number, an: LichAnchors): void {
  const t = pose.t, tilt = 0.2 + 0.05 * Math.sin(t * 0.9 + 1), roll = 0.06 * Math.sin(t * 0.7);
  BC[0] = cl.tomeX * cf + cl.tomeZ * sf; BC[1] = 9.6 + 0.38 * Math.sin(t * 1.3); BC[2] = -cl.tomeX * sf + cl.tomeZ * cf;
  const ux = Math.cos(tilt), uy = Math.sin(tilt); // Bu = (ux, uy, 0)
  const rl = Math.hypot(Math.sin(roll), Math.cos(roll));
  BR[0] = 0; BR[1] = Math.sin(roll) / rl; BR[2] = Math.cos(roll) / rl;
  let nx = BR[1] * 0 - BR[2] * uy, ny = BR[2] * ux - BR[0] * 0, nz = BR[0] * uy - BR[1] * ux; // Bn = norm(cross(Br, Bu))
  const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
  BN[0] = nx; BN[1] = ny; BN[2] = nz;
  BU2[0] = ny * BR[2] - nz * BR[1]; BU2[1] = nz * BR[0] - nx * BR[2]; BU2[2] = nx * BR[1] - ny * BR[0]; // cross(Bn, Br)
  page(b, 0.05, 1, -0.25, 0, true); page(b, Math.PI - 0.05, 0, -0.25, 0, true);
  page(b, 0.16, 1, 0, 0.32, false); page(b, Math.PI - 0.16, 0, 0, 0.32, false);
  const h = PHT / 2 + 0.15;
  pt(0, BC[0] - BU2[0] * h - BN[0] * 0.22, BC[1] - BU2[1] * h - BN[1] * 0.22, BC[2] - BU2[2] * h - BN[2] * 0.22);
  pt(1, BC[0] + BU2[0] * h - BN[0] * 0.22, BC[1] + BU2[1] * h - BN[1] * 0.22, BC[2] + BU2[2] * h - BN[2] * 0.22);
  rad(0, 0.2, 0.2); rad(1, 0.2, 0.2); col(0, 0.2, 0.13, 0.22); col(1, 0.2, 0.13, 0.22);
  tube(b, 2, 6, 0, 0, 1, 0, true, true, false, false);
  // a turning page: one slow turn every seven seconds at rest, a quick riffle while casting
  const slow = (t % 7) / 1.3, quick = (t * 2.4) % 1, turn = pose.casting > 0.05 ? quick : slow < 1 ? slow : -1;
  if (turn >= 0) page(b, mixn(0.16, Math.PI - 0.16, S(0, 1, turn)), turn < 0.5 ? 1 : 0, 0.02, 0.3 + 0.5 * Math.sin(Math.PI * turn), false);
  an.tome[0] = BC[0] + BN[0] * 0.3; an.tome[1] = BC[1] + BN[1] * 0.3; an.tome[2] = BC[2] + BN[2] * 0.3;
}
const CLAW_ARM_DOWN = [0, 1.3, 2.4, 3.3], CLAW_ARM_SIDE = [0, 0.4, 0.8, 1.0], CLAW_ARM_FADE = [1, 0.55, 0.2, 0], CLAW_ARM_R = [0.2, 0.19, 0.17, 0.1];
function claws(g: BuiltBuf, pose: LichPose): void {
  const t = pose.t;
  for (let k = 0; k < 2; k++) { // two hands of pale light that hook over the tome's outer edges, their arms fading away below
    const s = k === 0 ? -1 : 1, phi = s > 0 ? 0.05 : Math.PI - 0.05, cp = Math.cos(phi), sp = Math.sin(phi);
    const axx = BR[0] * cp + BN[0] * sp, axy = BR[1] * cp + BN[1] * sp, axz = BR[2] * cp + BN[2] * sp;
    const ex = BC[0] + axx * (PWD + 0.2) - BU2[0] * 0.2 * s, ey = BC[1] + axy * (PWD + 0.2) - BU2[1] * 0.2 * s, ez = BC[2] + axz * (PWD + 0.2) - BU2[2] * 0.2 * s;
    const wx = ex + BR[0] * s * 0.7 - BN[0] * 1.5, wy = ey + BR[1] * s * 0.7 - BN[1] * 1.5, wz = ez + BR[2] * s * 0.7 - BN[2] * 1.5;
    const pal = 0.85 + 0.15 * Math.sin(t * 2 + s);
    handFrame(BN[0] - BR[0] * s * 0.1, BN[1] - BR[1] * s * 0.1, BN[2] - BR[2] * s * 0.1, -BR[0] * s, -BR[1] * s, -BR[2] * s);
    placeHand(g, CLAW_HAND[k], wx, wy, wz, GHOST, 0.8 * pal, true);
    for (let i = 0; i < 4; i++) {
      const d = CLAW_ARM_DOWN[i], side = CLAW_ARM_SIDE[i] * s, f = 0.7 * pal * CLAW_ARM_FADE[i];
      pt(i, wx - BN[0] * d + BR[0] * side, wy - BN[1] * d + BR[1] * side, wz - BN[2] * d + BR[2] * side);
      rad(i, CLAW_ARM_R[i], CLAW_ARM_R[i]);
      col(i, GHOST[0] * f, GHOST[1] * f, GHOST[2] * f);
    }
    const a0 = g.verts;
    tube(g, 4, 6, 0, 0, 1, 1, false, false, false, false);
    for (let i = a0; i < g.verts; i++) { g.uv[i * 2] = 0.5; g.uv[i * 2 + 1] = 0.5; } // solid shapes of light: no falloff
  }
}

/** `parts: 'caster'` leaves out the tome and the claws (the lamp outline). */
export function buildLich(pose: LichPose, cloth: Cloth, out: LichOut, parts: 'all' | 'caster' = 'all'): void {
  const b = out.body, g = out.claws, an = out.anchors;
  b.verts = 0; b.indices = 0; g.verts = 0; g.indices = 0;
  // The uvs, look values and indices depend only on `parts` (the topology is fixed; poses move positions, normals and colours).
  b.fixed = g.fixed = parts === 'all' ? 1 : 2;
  GZ = pose.gaze; MV = pose.glide; HU = pose.hurt; BOB = 0.1 * Math.sin(pose.t * 1.4);
  const cf = Math.cos(pose.face), sf = Math.sin(pose.face);
  robe(b, pose, cloth, cf, sf);
  head(b, pose, an);
  collar(b);
  staffAndArms(b, pose, an);
  at(1.2, 13.8, 0);
  an.chest[0] = AT[0]; an.chest[1] = AT[1]; an.chest[2] = AT[2];
  if (parts === 'all') { tome(b, pose, cloth, cf, sf, an); claws(g, pose); }
}

const REST: { all?: LichOut; caster?: LichOut } = {};
/** The rest pose built once (clock 0, cloth at its places, nothing cast) and kept: the same object on every call, so callers must not write into it. */
export function lichRest(parts: 'all' | 'caster' = 'all'): LichOut {
  let o = REST[parts];
  if (!o) {
    const pose = restPose(), cloth = newCloth(), lean = ringLean(pose, new Float32Array(NR * 2));
    for (let i = 0; i < NR; i++) { cloth.rx[i] = lean[i * 2]; cloth.rz[i] = lean[i * 2 + 1]; cloth.rt[i] = pose.face; } // facing 0: the world directions are the model's
    cloth.tomeX = 5.6; cloth.tomeZ = -0.35;
    o = newLichOut();
    buildLich(pose, cloth, o, parts);
    REST[parts] = o;
  }
  return o;
}
export const LICH_TOP: number = ((): number => {
  const o = lichRest('caster');
  let top = -Infinity;
  for (let i = 0; i < o.body.verts; i++) top = Math.max(top, o.body.position[i * 3 + 1]);
  return top;
})();
