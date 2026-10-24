// A coarse grid of air velocities that figures, projectiles and blasts stir, for the cosmetic dungeon air (mood.ts). Pure maths.

/** Side of a grid cell in px. */
export const WIND_CELL = 8;
/** Px of grid kept around the view. */
export const WIND_MARGIN = 48;
/** Seconds for a gust to fade to 1/e. */
export const WIND_DECAY = 0.45;
/** Fastest air in px/s. */
export const WIND_MAX = 160;
/** Strongest ambient draft in px/s. */
export const DRAFT_MAX = 3;
/** Cells a gust spreads per second squared (variance 10 cell² per s, about one cell per 0.1 s). */
const SPREAD_RATE = 10;
/** Most weight a cell gives each neighbour per frame (explicit stepping stays stable). */
const MAX_BLUR = 0.25;
/** Longest frame the field integrates, in s. */
const MAX_DT = 0.1;
/** Air slower than this (px/s) settles to exactly still. */
const REST_SPEED = 0.05;
/** Most pending pushes, wakes and blasts between two steps. */
const MAX_EVENTS = 512;
/** Event slots: kind, x, y, vx, vy, r. */
const EVENT_SIZE = 6;
const PUSH = 0;
const WAKE = 1;
const BLAST = 2;

/** Pocket: peak air speed along the motion, outward and swirl, as shares of the mover's speed. */
const POCKET_ALONG = 0.7;
const POCKET_OUT = 0.35;
const POCKET_SWIRL = 0.3;
/** Pocket reach: POCKET_REACH body radii, at least POCKET_MIN_REACH px. */
const POCKET_REACH = 4;
const POCKET_MIN_REACH = 24;
/** The pocket centre sits this many body radii ahead of the mover. */
const POCKET_AHEAD = 1;
/** Swirls: radius (body radii, at least SWIRL_MIN_RADIUS px), sideways offset and distance behind the pocket centre (body radii). */
const SWIRL_RADIUS = 2;
const SWIRL_MIN_RADIUS = 10;
const SWIRL_SIDE = 1.5;
const SWIRL_BEHIND = 2;
/** Wake shares of the projectile's speed, and its radius in px. */
const WAKE_ALONG = 0.5;
const WAKE_OUT = 0.3;
const WAKE_RADIUS = 6;
/** Blast: peak speed (px/s) at BLAST_PEAK_R px, reaching 0 at BLAST_END_R px. */
const BLAST_SPEED = 120;
const BLAST_PEAK_R = 24;
const BLAST_END_R = 56;

/** Draft: spatial wavelength about 160 px, period about 20 s. */
const DRAFT_K = (2 * Math.PI) / 160;
const DRAFT_W = (2 * Math.PI) / 20;

/** Seconds a mover's push takes to fill its pocket. A held push settles at about POCKET_ALONG * WIND_DECAY / PUSH_FILL (1.6 with 0.7, 0.45, 0.2) times the mover's speed in the centre, capped by WIND_MAX. */
const PUSH_FILL = 0.2;

export interface WindView {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Air velocity (px/s) on a grid that follows the view. Pushes queue up until the next `step`. */
export class Wind {
  /** Adds the slow ambient draft to every sample. */
  draftOn = true;

  private ox = 0;
  private oy = 0;
  private nx = 0;
  private ny = 0;
  private vx = new Float32Array(0);
  private vy = new Float32Array(0);
  private tx = new Float32Array(0);
  private ty = new Float32Array(0);
  private wall = new Uint8Array(0);
  private time = 0;
  private events = new Float64Array(MAX_EVENTS * EVENT_SIZE);
  private count = 0;
  private i0 = 0;
  private i1 = 0;
  private j0 = 0;
  private j1 = 0;
  private bx = 0;
  /** The wall mask needs rebuilding (the grid moved or grew, or the map changed). */
  private wallsDirty = true;
  /** The grid may hold air (false: every cell is exactly 0). */
  private active = false;
  private by = 0;

  constructor(private solid: (px: number, py: number) => boolean) {}

  /** Re-anchors the grid to cover `view` plus WIND_MARGIN px, world-aligned; advects, blurs, decays; zeroes solid cells. dt is clamped to [0, 0.1]. */
  step(dt: number, view: WindView): void {
    dt = Number.isFinite(dt) ? Math.min(MAX_DT, Math.max(0, dt)) : 0;
    this.anchor(view);
    this.time += dt;
    if (this.wallsDirty) this.markWalls();
    // Still air and nothing queued: nothing to move.
    if (!this.active && this.count === 0) return;
    if (dt > 0 && this.active) this.flow(dt);
    this.applyEvents(dt);
    this.finish();
  }

  /** The solid cells changed (the map was edited): the wall mask is rebuilt on the next `step`. */
  wallsChanged(): void {
    this.wallsDirty = true;
  }

  /** A figure's pocket of air. v in px/s, r = body radius in px. */
  push(x: number, y: number, vx: number, vy: number, r: number): void {
    this.queue(PUSH, x, y, vx, vy, r);
  }

  /** A projectile's narrow wake. */
  wake(x: number, y: number, vx: number, vy: number): void {
    this.queue(WAKE, x, y, vx, vy, WAKE_RADIUS);
  }

  /** An outward ring, once per blast. */
  blast(x: number, y: number): void {
    this.queue(BLAST, x, y, 0, 0, 0);
  }

  /** Air velocity at (x, y) in px/s: grid (bilinear) plus draft; 0 in solid cells and outside the grid. Writes into `out`, returns it. */
  sample(x: number, y: number, out: [number, number]): [number, number] {
    out[0] = 0;
    out[1] = 0;
    const ci = Math.floor((x - this.ox) / WIND_CELL);
    const cj = Math.floor((y - this.oy) / WIND_CELL);
    if (ci < 0 || cj < 0 || ci >= this.nx || cj >= this.ny || this.wall[cj * this.nx + ci]) return out;
    this.bilinear(this.vx, this.vy, (x - this.ox) / WIND_CELL - 0.5, (y - this.oy) / WIND_CELL - 0.5);
    out[0] = this.bx;
    out[1] = this.by;
    if (this.draftOn) {
      const t = this.time * DRAFT_W;
      const a = x * DRAFT_K;
      const b = y * DRAFT_K;
      const k = DRAFT_MAX / Math.SQRT2 / 3;
      out[0] += k * (Math.sin(a + 1.3 * t) + Math.sin(0.7 * b - 0.9 * t + 2) + Math.sin(0.5 * (a + b) + 0.6 * t + 4));
      out[1] += k * (Math.sin(b - 1.1 * t + 1) + Math.sin(0.8 * a + 0.7 * t + 3) + Math.sin(0.6 * (a - b) - 0.5 * t));
    }
    return out;
  }

  private queue(kind: number, x: number, y: number, vx: number, vy: number, r: number): void {
    if (this.count >= MAX_EVENTS) return;
    const e = this.events;
    const o = this.count++ * EVENT_SIZE;
    e[o] = kind;
    e[o + 1] = x;
    e[o + 2] = y;
    e[o + 3] = vx;
    e[o + 4] = vy;
    e[o + 5] = r;
  }

  /** Moves the grid to the view, keeping the air where it is in the world; grows the arrays only if the view grew. */
  private anchor(view: WindView): void {
    const ox = Math.floor((view.x - WIND_MARGIN) / WIND_CELL) * WIND_CELL;
    const oy = Math.floor((view.y - WIND_MARGIN) / WIND_CELL) * WIND_CELL;
    const nx = Math.max(this.nx, Math.ceil((view.width + 2 * WIND_MARGIN) / WIND_CELL) + 1);
    const ny = Math.max(this.ny, Math.ceil((view.height + 2 * WIND_MARGIN) / WIND_CELL) + 1);
    const si = Math.round((ox - this.ox) / WIND_CELL);
    const sj = Math.round((oy - this.oy) / WIND_CELL);
    if (nx === this.nx && ny === this.ny && si === 0 && sj === 0) return;
    let dx = this.tx;
    let dy = this.ty;
    if (nx !== this.nx || ny !== this.ny) {
      dx = new Float32Array(nx * ny);
      dy = new Float32Array(nx * ny);
      this.tx = new Float32Array(nx * ny);
      this.ty = new Float32Array(nx * ny);
      this.wall = new Uint8Array(nx * ny);
    } else {
      dx.fill(0);
      dy.fill(0);
    }
    for (let j = 0; j < ny; j++) {
      const oj = j + sj;
      if (oj < 0 || oj >= this.ny) continue;
      for (let i = 0; i < nx; i++) {
        const oi = i + si;
        if (oi < 0 || oi >= this.nx) continue;
        dx[j * nx + i] = this.vx[oj * this.nx + oi];
        dy[j * nx + i] = this.vy[oj * this.nx + oi];
      }
    }
    if (dx === this.tx) {
      this.tx = this.vx;
      this.ty = this.vy;
    }
    this.vx = dx;
    this.vy = dy;
    this.ox = ox;
    this.oy = oy;
    this.nx = nx;
    this.ny = ny;
    this.wallsDirty = true;
  }

  private markWalls(): void {
    this.wallsDirty = false;
    for (let j = 0; j < this.ny; j++) {
      const y = this.oy + (j + 0.5) * WIND_CELL;
      for (let i = 0; i < this.nx; i++) this.wall[j * this.nx + i] = this.solid(this.ox + (i + 0.5) * WIND_CELL, y) ? 1 : 0;
    }
  }

  /** Self-advection, blur and decay. */
  private flow(dt: number): void {
    const { nx, ny, vx, vy, tx, ty, wall } = this;
    // Advect: each cell takes the air found one step upstream.
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        if (wall[c] || (vx[c] === 0 && vy[c] === 0)) {
          // Upstream of a still cell is the cell itself, which holds nothing.
          tx[c] = 0;
          ty[c] = 0;
        } else {
          this.bilinear(vx, vy, i - (vx[c] * dt) / WIND_CELL, j - (vy[c] * dt) / WIND_CELL);
          tx[c] = this.bx;
          ty[c] = this.by;
        }
      }
    }
    const w = Math.min(MAX_BLUR, (SPREAD_RATE / 2) * dt);
    const decay = Math.exp(-dt / WIND_DECAY);
    // Blur along x (t -> v), then along y (v -> t) with decay, then swap back.
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        const lx = i > 0 ? tx[c - 1] : 0;
        const rx = i < nx - 1 ? tx[c + 1] : 0;
        const ly = i > 0 ? ty[c - 1] : 0;
        const ry = i < nx - 1 ? ty[c + 1] : 0;
        vx[c] = (1 - 2 * w) * tx[c] + w * (lx + rx);
        vy[c] = (1 - 2 * w) * ty[c] + w * (ly + ry);
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i;
        if (wall[c]) {
          tx[c] = 0;
          ty[c] = 0;
          continue;
        }
        const ux = j > 0 ? vx[c - nx] : 0;
        const dx = j < ny - 1 ? vx[c + nx] : 0;
        const uy = j > 0 ? vy[c - nx] : 0;
        const dy = j < ny - 1 ? vy[c + nx] : 0;
        tx[c] = decay * ((1 - 2 * w) * vx[c] + w * (ux + dx));
        ty[c] = decay * ((1 - 2 * w) * vy[c] + w * (uy + dy));
      }
    }
    this.tx = vx;
    this.ty = vy;
    this.vx = tx;
    this.vy = ty;
  }

  /** Stirs the air for the queued pushes, wakes and blasts. */
  private applyEvents(dt: number): void {
    const e = this.events;
    const gain = dt / PUSH_FILL;
    for (let n = 0; n < this.count; n++) {
      const o = n * EVENT_SIZE;
      const kind = e[o];
      const x = e[o + 1];
      const y = e[o + 2];
      const mx = e[o + 3];
      const my = e[o + 4];
      const r = e[o + 5];
      if (kind === BLAST) {
        this.blastAt(x, y);
        continue;
      }
      const speed = Math.hypot(mx, my);
      if (!(speed > 1) || gain <= 0) continue;
      const dx = mx / speed;
      const dy = my / speed;
      if (kind === WAKE) {
        this.stir(x, y, dx, dy, r, WAKE_ALONG * speed * gain, WAKE_OUT * speed * gain);
        continue;
      }
      const reach = Math.max(POCKET_REACH * r, POCKET_MIN_REACH);
      const px = x + POCKET_AHEAD * r * dx;
      const py = y + POCKET_AHEAD * r * dy;
      this.stir(px, py, dx, dy, reach, POCKET_ALONG * speed * gain, POCKET_OUT * speed * gain);
      const swirlR = Math.max(SWIRL_RADIUS * r, SWIRL_MIN_RADIUS);
      const tangent = POCKET_SWIRL * speed * gain * Math.sqrt(Math.E);
      const cx = px - SWIRL_BEHIND * r * dx;
      const cy = py - SWIRL_BEHIND * r * dy;
      const side = SWIRL_SIDE * r;
      this.swirl(cx - side * dy, cy + side * dx, dx, dy, swirlR, tangent);
      this.swirl(cx + side * dy, cy - side * dx, dx, dy, swirlR, -tangent);
    }
    this.count = 0;
  }

  /** Gaussian bump of radius `reach` at (x, y): `along` px/s along (dx, dy), `out` px/s away from the line through it. */
  private stir(x: number, y: number, dx: number, dy: number, reach: number, along: number, out: number): void {
    this.region(x, y, 2 * reach);
    const soft = (reach * 0.25) ** 2;
    for (let j = this.j0; j <= this.j1; j++) {
      for (let i = this.i0; i <= this.i1; i++) {
        const px = this.ox + (i + 0.5) * WIND_CELL - x;
        const py = this.oy + (j + 0.5) * WIND_CELL - y;
        if (!this.open(x, y, px, py)) continue;
        const w = Math.exp(-(px * px + py * py) / (reach * reach));
        const side = -px * dy + py * dx;
        const away = side / Math.sqrt(side * side + soft);
        const c = j * this.nx + i;
        this.vx[c] += w * (along * dx + out * away * -dy);
        this.vy[c] += w * (along * dy + out * away * dx);
      }
    }
  }

  /** A vortex of radius `reach` at (x, y); the air offset (a, b) along and beside the motion (dx, dy) moves as (-b, a) times `tangent`, so the sign picks the spin. */
  private swirl(x: number, y: number, dx: number, dy: number, reach: number, tangent: number): void {
    this.region(x, y, 2 * reach);
    for (let j = this.j0; j <= this.j1; j++) {
      for (let i = this.i0; i <= this.i1; i++) {
        const px = this.ox + (i + 0.5) * WIND_CELL - x;
        const py = this.oy + (j + 0.5) * WIND_CELL - y;
        if (!this.open(x, y, px, py)) continue;
        const w = (tangent * Math.exp(-(px * px + py * py) / (reach * reach))) / reach;
        const a = px * dx + py * dy;
        const b = -px * dy + py * dx;
        // Rotate the offset a quarter turn in the (motion, sideways) frame: (a, b) -> (-b, a).
        const c = j * this.nx + i;
        this.vx[c] += w * (-b * dx - a * dy);
        this.vy[c] += w * (-b * dy + a * dx);
      }
    }
  }

  private blastAt(x: number, y: number): void {
    this.region(x, y, BLAST_END_R);
    for (let j = this.j0; j <= this.j1; j++) {
      for (let i = this.i0; i <= this.i1; i++) {
        const px = this.ox + (i + 0.5) * WIND_CELL - x;
        const py = this.oy + (j + 0.5) * WIND_CELL - y;
        const d = Math.hypot(px, py);
        if (d <= 0 || d >= BLAST_END_R || !this.open(x, y, px, py)) continue;
        const f =
          d < BLAST_PEAK_R
            ? d / BLAST_PEAK_R
            : 0.5 + 0.5 * Math.cos((Math.PI * (d - BLAST_PEAK_R)) / (BLAST_END_R - BLAST_PEAK_R));
        const c = j * this.nx + i;
        this.vx[c] += (BLAST_SPEED * f * px) / d;
        this.vy[c] += (BLAST_SPEED * f * py) / d;
      }
    }
  }

  /** True when the straight line from (x, y) to the offset (px, py) crosses no wall cell (sampled every half cell; a centre inside a wall opens nothing). */
  private open(x: number, y: number, px: number, py: number): boolean {
    const steps = Math.ceil((Math.hypot(px, py) / WIND_CELL) * 2);
    for (let s = 0; s <= steps; s++) {
      const f = steps > 0 ? s / steps : 0;
      const ci = Math.floor((x + px * f - this.ox) / WIND_CELL);
      const cj = Math.floor((y + py * f - this.oy) / WIND_CELL);
      if (ci >= 0 && cj >= 0 && ci < this.nx && cj < this.ny && this.wall[cj * this.nx + ci]) return false;
    }
    return true;
  }

  /** Zeroes solid cells and caps the speed. */
  private finish(): void {
    const cap2 = WIND_MAX * WIND_MAX;
    let any = false;
    for (let c = 0; c < this.nx * this.ny; c++) {
      if (this.wall[c]) {
        this.vx[c] = 0;
        this.vy[c] = 0;
        continue;
      }
      const m2 = this.vx[c] * this.vx[c] + this.vy[c] * this.vy[c];
      if (m2 < REST_SPEED * REST_SPEED) {
        // Too slow to matter: settle to exactly still (also keeps tiny floats out of the field).
        this.vx[c] = 0;
        this.vy[c] = 0;
        continue;
      }
      any = true;
      if (m2 > cap2) {
        const s = WIND_MAX / Math.sqrt(m2);
        this.vx[c] *= s;
        this.vy[c] *= s;
      }
    }
    this.active = any;
  }

  /** Sets the cell range within `rad` px of (x, y), clipped to the grid. */
  private region(x: number, y: number, rad: number): void {
    this.i0 = Math.max(0, Math.floor((x - rad - this.ox) / WIND_CELL));
    this.i1 = Math.min(this.nx - 1, Math.floor((x + rad - this.ox) / WIND_CELL));
    this.j0 = Math.max(0, Math.floor((y - rad - this.oy) / WIND_CELL));
    this.j1 = Math.min(this.ny - 1, Math.floor((y + rad - this.oy) / WIND_CELL));
  }

  /** Bilinear read of two fields at cell coordinates (cell centres on whole numbers; outside the grid is still air) into bx, by. */
  private bilinear(fx: Float32Array, fy: Float32Array, gx: number, gy: number): void {
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const u = gx - i;
    const v = gy - j;
    let ax = 0;
    let ay = 0;
    for (let q = 0; q < 4; q++) {
      const ci = i + (q & 1);
      const cj = j + (q >> 1);
      if (ci < 0 || cj < 0 || ci >= this.nx || cj >= this.ny) continue;
      const w = (q & 1 ? u : 1 - u) * (q >> 1 ? v : 1 - v);
      ax += w * fx[cj * this.nx + ci];
      ay += w * fy[cj * this.nx + ci];
    }
    this.bx = ax;
    this.by = ay;
  }
}
