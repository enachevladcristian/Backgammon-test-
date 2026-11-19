/* ------------------------------------------------------------------
   Pseudo-3D scene renderer for the backgammon board.

   Everything is drawn with the 2D canvas API, but all geometry lives
   in 3D space and is projected through a perspective camera that looks
   down on the board at an angle ("2.5D"). Checkers are real cylinders
   (silhouette + top face) and the dice are real cubes with pips on the
   faces, so they tumble convincingly while being rolled.
   ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const BOARD = {
  // play field: 6 columns | vertical bar | 6 columns, points meet at y = 0
  X0: -6.42, X1: 6.42, Y0: -4, Y1: 4,
  BAR_HW: 0.42,
  FELT_X0: -7.0, FELT_X1: 8.35,
  FELT_Y0: -4.45, FELT_Y1: 4.45,
  RAIL: 0.62,
  THICK: 0.95,
  TRAY_X0: 6.82, TRAY_X1: 8.25,
  R: 0.42,          // checker radius
  CH: 0.2,          // checker thickness
  CSTEP: 0.172,     // vertical step between stacked checkers
  BAR_TOP: 0.22,
  DIE: 0.72,        // die edge length
};
BOARD.OUT_X0 = BOARD.FELT_X0 - BOARD.RAIL;
BOARD.OUT_X1 = BOARD.FELT_X1 + BOARD.RAIL;
BOARD.OUT_Y0 = BOARD.FELT_Y0 - BOARD.RAIL;
BOARD.OUT_Y1 = BOARD.FELT_Y1 + BOARD.RAIL;
BOARD.CX = (BOARD.OUT_X0 + BOARD.OUT_X1) / 2;

/* dice rest in front of the board, on the table */
export const DICE_REST = [
  { x: 0.1, y: -5.98 },
  { x: 1.4, y: -5.84 },
];

const COL = {
  woodHi: '#a9774a',
  wood: '#7f5130',
  woodLo: '#54321a',
  woodDeep: '#371d0d',
  feltHi: '#1a6051',
  felt: '#0f4639',
  feltLo: '#082e27',
  cream: '#eadfbf',
  creamLo: '#cbb894',
  red: '#a63f2f',
  redLo: '#79281b',
  gold: '#d8b26a',
  ivory: '#f3ead7',
  ivoryDark: '#c9b998',
  ebony: '#2b2a32',
  ebonyDark: '#15141a',
  ebonyHi: '#4d4b58',
};

const LIGHT_DIR = (() => {
  const v = [-0.45, -0.55, 0.9];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
})();

/* ------------------------------------------------------------------ camera */

export class Camera {
  constructor() {
    this.elev = 0.99;          // radians above the board plane (~57deg)
    this.yaw = -0.045;
    this.dist = 44;
    this.focal = 300;
    this.cx = 0;
    this.cy = 0;
    this.trig();
  }

  trig() {
    this.cosE = Math.cos(this.elev);
    this.sinE = Math.sin(this.elev);
    this.cosY = Math.cos(this.yaw);
    this.sinY = Math.sin(this.yaw);
  }

  project(x, y, z) {
    const xr = x * this.cosY - y * this.sinY;
    const yr = x * this.sinY + y * this.cosY;
    const dy = yr + this.dist * this.cosE;
    const dz = z - this.dist * this.sinE;
    const Y = dy * this.sinE + dz * this.cosE;
    const Z = dy * this.cosE - dz * this.sinE;
    const s = this.focal / Z;
    return { x: this.cx + xr * s, y: this.cy - Y * s, s, z: Z };
  }

  /** screen -> board plane (z = 0) */
  unproject(sx, sy) {
    const k1 = (sx - this.cx) / this.focal;
    const k2 = (this.cy - sy) / this.focal;
    const dz = -this.dist * this.sinE;
    const denom = this.sinE - k2 * this.cosE;
    if (Math.abs(denom) < 1e-9) return null;
    const dy = (-dz * (this.cosE + k2 * this.sinE)) / denom;
    const Z = dy * this.cosE - dz * this.sinE;
    const xr = k1 * Z;
    const yr = dy - this.dist * this.cosE;
    return {
      x: xr * this.cosY + yr * this.sinY,
      y: -xr * this.sinY + yr * this.cosY,
    };
  }
}

/* --------------------------------------------------------------- geometry */

export function colIndex(p) {
  return p <= 12 ? 12 - p : p - 13;
}
/** centre x of a column (0..5 left of the bar, 6..11 right of it) */
export function colX(c) {
  const b = BOARD;
  return c < 6 ? b.X0 + c + 0.5 : b.BAR_HW + c - 5.5;
}
export function pointX(p) {
  return colX(colIndex(p));
}
export function pointY(p) {
  return p <= 12 ? BOARD.Y0 + BOARD.R + 0.08 : BOARD.Y1 - BOARD.R - 0.08;
}
export function stackTop(count) {
  return count * BOARD.CSTEP;
}
/** checkers on the bar pile up on the raised strip, each side of the middle */
export function barPos(player, index = 0) {
  return { x: 0, y: player === 0 ? -2.05 : 2.05, z: BOARD.BAR_TOP + index * BOARD.CSTEP };
}
export function offPos(player, i) {
  const slots = Math.min(14, i);
  const order = [1, 0, 2];
  const col = order[Math.floor(slots / 5)];
  const row = slots % 5;
  const x = 7.535 + (col - 1) * 0.48;
  const y = player === 0 ? -3.95 + row * 0.75 : 3.95 - row * 0.75;
  return { x, y, z: 0.006 };
}
/** column under a board x coordinate, or -1 when outside / on the bar */
export function colAt(x) {
  const b = BOARD;
  if (x < b.X0 || x > b.X1) return -1;
  if (x < -b.BAR_HW) return clamp(Math.floor(x - b.X0), 0, 5);
  if (x > b.BAR_HW) return 6 + clamp(Math.floor(x - b.BAR_HW), 0, 5);
  return -1;
}

export function hitTest(world) {
  if (!world) return null;
  const { x, y } = world;
  const b = BOARD;
  if (x > b.TRAY_X0 - 0.12 && x < b.TRAY_X1 + 0.22 && Math.abs(y) < b.Y1 + 0.3) {
    return { kind: 'off' };
  }
  if (Math.abs(x) <= b.BAR_HW + 0.04 && Math.abs(y) <= b.Y1 + 0.25) {
    return { kind: 'bar' };
  }
  if (Math.abs(y) > b.Y1 + 0.5) return null;
  const col = colAt(x);
  if (col < 0) return null;
  return { kind: 'point', p: y > 0 ? 13 + col : 12 - col };
}

/* --------------------------------------------------------------- 2d utils */

function trace(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function circlePts(cam, cx, cy, z, r, n = 30) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    out.push(cam.project(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z));
  }
  return out;
}

function hull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/* ---------------------------------------------------------- quaternions */

export function qAxisAngle(axis, angle) {
  const l = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const s = Math.sin(angle / 2);
  return {
    x: (axis[0] / l) * s,
    y: (axis[1] / l) * s,
    z: (axis[2] / l) * s,
    w: Math.cos(angle / 2),
  };
}

export function qMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function qNorm(q) {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

export function qSlerp(a, b, t) {
  let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bb = b;
  if (cos < 0) {
    cos = -cos;
    bb = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }
  if (cos > 0.9995) {
    return qNorm({
      x: a.x + (bb.x - a.x) * t,
      y: a.y + (bb.y - a.y) * t,
      z: a.z + (bb.z - a.z) * t,
      w: a.w + (bb.w - a.w) * t,
    });
  }
  const theta = Math.acos(cos);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return { x: a.x * wa + bb.x * wb, y: a.y * wa + bb.y * wb, z: a.z * wa + bb.z * wb, w: a.w * wa + bb.w * wb };
}

/** rotation matrix (row major 3x3) from a quaternion */
export function qMat(q) {
  const { x, y, z, w } = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

export function mv(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** quaternion that maps local direction `n` onto +Z (with a random-ish spin) */
export function qFaceUp(n, spin = 0) {
  const from = [n[0], n[1], n[2]];
  const to = [0, 0, 1];
  const dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  let align;
  if (dot > 0.9999) {
    align = { x: 0, y: 0, z: 0, w: 1 };
  } else if (dot < -0.9999) {
    align = qAxisAngle([1, 0, 0], Math.PI);
  } else {
    const axis = [
      from[1] * to[2] - from[2] * to[1],
      from[2] * to[0] - from[0] * to[2],
      from[0] * to[1] - from[1] * to[0],
    ];
    align = qAxisAngle(axis, Math.acos(clamp(dot, -1, 1)));
  }
  const zs = qAxisAngle([0, 0, 1], spin);
  return qNorm(qMul(zs, align));
}

/* ------------------------------------------------------------------ dice */

const DIE_FACES = [
  { v: 1, n: [0, 0, 1], t1: [1, 0, 0], t2: [0, 1, 0] },
  { v: 6, n: [0, 0, -1], t1: [-1, 0, 0], t2: [0, 1, 0] },
  { v: 2, n: [1, 0, 0], t1: [0, 1, 0], t2: [0, 0, 1] },
  { v: 5, n: [-1, 0, 0], t1: [0, 0, 1], t2: [0, 1, 0] },
  { v: 3, n: [0, 1, 0], t1: [0, 0, 1], t2: [1, 0, 0] },
  { v: 4, n: [0, -1, 0], t1: [1, 0, 0], t2: [0, 0, 1] },
];

const PIPS = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};

export function faceNormalForValue(v) {
  const f = DIE_FACES.find((f) => f.v === v);
  return f ? f.n : [0, 0, 1];
}

/* --------------------------------------------------------------- renderer */

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = new Camera();
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.static = document.createElement('canvas');
    this.sctx = this.static.getContext('2d');
    this.dirty = true;
    this.lastLayout = '';
  }

  resize(w, h, dpr) {
    const key = `${w}x${h}@${dpr}`;
    if (key === this.lastLayout) return;
    this.lastLayout = key;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.static.width = this.canvas.width;
    this.static.height = this.canvas.height;
    this.fit();
    this.dirty = true;
  }

  fit() {
    const cam = this.cam;
    const b = BOARD;
    const padX = this.w < 780 ? 12 : 34;
    const padTop = this.w < 780 ? 72 : 78;
    const padBottom = this.w < 780 ? 104 : 112;
    const availW0 = Math.max(80, this.w - padX * 2);
    const availH0 = Math.max(80, this.h - padTop - padBottom);
    // wide viewports get a lower camera so the board can grow
    cam.elev = clamp(1.02 - 0.18 * (availW0 / availH0 - 1.25), 0.74, 1.02);
    cam.trig();
    cam.cx = 0;
    cam.cy = 0;
    cam.focal = 1;
    const samples = [];
    const push = (x, y, z) => samples.push(cam.project(x, y, z));
    for (const x of [b.OUT_X0, b.OUT_X1]) {
      for (const y of [b.OUT_Y0, b.OUT_Y1]) {
        push(x, y, 0);
        push(x, y, -b.THICK);
      }
    }
    // tall stacks (tray can hold a full 15 checker line up to ~2 high)
    push(b.X0 + 0.5, b.Y0, 1.6);
    push(b.X1 - 0.5, b.Y0, 1.6);
    push(b.X0 + 0.5, b.Y1, 1.6);
    push(b.X1 - 0.5, b.Y1, 1.6);
    push(7.9, -4.2, 1.2);
    push(7.9, 4.2, 1.2);
    // bar towers
    push(0, -2.05, 1.9);
    push(0, 2.05, 1.9);
    // dice in front
    push(-0.5, -6.9, -b.THICK);
    push(1.9, -6.9, -b.THICK);

    const bb = bbox(samples);
    const bw = bb.x1 - bb.x0 || 1;
    const bh = bb.y1 - bb.y0 || 1;
    const availW = availW0;
    const availH = availH0;
    cam.focal = Math.min(availW / bw, availH / bh);
    const bcx = (bb.x0 + bb.x1) / 2;
    const bcy = (bb.y0 + bb.y1) / 2;
    cam.cx = this.w / 2 - cam.focal * bcx;
    cam.cy = padTop + availH / 2 - cam.focal * bcy;
  }

  /* -------------------------------------------------- static layers */

  buildStatic() {
    const ctx = this.sctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.drawTable(ctx);
    this.drawBoard(ctx);
    this.drawFelt(ctx);
    this.drawTray(ctx);
    this.drawPoints(ctx);
    this.drawBar(ctx);
    this.drawLabels(ctx);
    this.dirty = false;
  }

  p(x, y, z) {
    return this.cam.project(x, y, z);
  }

  poly3(ctx, pts3) {
    return pts3.map(([x, y, z]) => this.p(x, y, z));
  }

  drawTable(ctx) {
    const { w, h } = this;
    ctx.fillStyle = '#060b0d';
    ctx.fillRect(0, 0, w, h);
    let g = ctx.createRadialGradient(w * 0.46, h * 0.34, Math.min(w, h) * 0.04, w * 0.5, h * 0.5, Math.max(w, h) * 0.9);
    g.addColorStop(0, 'rgba(64,98,100,0.55)');
    g.addColorStop(0.42, 'rgba(26,48,52,0.42)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    g = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.22, w * 0.5, h * 0.5, Math.max(w, h) * 0.82);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  drawBoard(ctx) {
    const b = BOARD;
    const T = b.THICK;
    const outer = [
      [b.OUT_X0, b.OUT_Y0],
      [b.OUT_X1, b.OUT_Y0],
      [b.OUT_X1, b.OUT_Y1],
      [b.OUT_X0, b.OUT_Y1],
    ];

    // ---- soft contact shadow on the table (layered, no blur filter needed)
    const mx = (b.OUT_X0 + b.OUT_X1) / 2;
    for (let i = 0; i < 5; i++) {
      const k = 1 + i * 0.052;
      const off = 0.16 + i * 0.2;
      const pts = outer.map(([x, y]) => this.p(mx + (x - mx) * k, y * k - off, -T));
      trace(ctx, pts);
      ctx.fillStyle = `rgba(0,0,0,${0.15 - i * 0.024})`;
      ctx.fill();
    }

    // ---- sides
    const shades = [
      ['#6d4526', '#3d2210'], // front (nearest)
      ['#4c2e16', '#2a1608'], // right
      ['#3a2110', '#20120a'], // back
      ['#4c2e16', '#2a1608'], // left
    ];
    for (let i = 0; i < 4; i++) {
      const a = outer[i];
      const c = outer[(i + 1) % 4];
      const pts = [
        this.p(a[0], a[1], 0),
        this.p(c[0], c[1], 0),
        this.p(c[0], c[1], -T),
        this.p(a[0], a[1], -T),
      ];
      const bb = bbox(pts);
      const g = ctx.createLinearGradient(bb.x0, bb.y0, bb.x1, bb.y1);
      g.addColorStop(0, shades[i][0]);
      g.addColorStop(1, shades[i][1]);
      trace(ctx, pts);
      ctx.fillStyle = g;
      ctx.fill();
    }

    // ---- top face
    const top = this.poly3(ctx, outer.map(([x, y]) => [x, y, 0]));
    const bb = bbox(top);
    let g = ctx.createLinearGradient(bb.x0, bb.y0, bb.x1, bb.y1);
    g.addColorStop(0, COL.woodHi);
    g.addColorStop(0.35, COL.wood);
    g.addColorStop(1, COL.woodLo);
    trace(ctx, top);
    ctx.fillStyle = g;
    ctx.fill();

    // grain: a few soft streaks following the long axis
    ctx.save();
    trace(ctx, top);
    ctx.clip();
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = '#3a210f';
    ctx.lineWidth = 1;
    for (let i = 0; i < 22; i++) {
      const y = b.OUT_Y0 + 0.35 + (i / 22) * (b.OUT_Y1 - b.OUT_Y0 - 0.7);
      const a = this.p(b.OUT_X0 - 0.3, y + Math.sin(i * 1.7) * 0.06, 0);
      const c = this.p(b.OUT_X1 + 0.3, y + Math.cos(i * 2.3) * 0.06, 0);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
    }
    ctx.restore();

    // bevel highlight along the top-left rail
    const hl = this.poly3(ctx, [
      [b.OUT_X0, b.OUT_Y1, 0],
      [b.OUT_X1, b.OUT_Y1, 0],
      [b.OUT_X1 - 0.14, b.OUT_Y1 - 0.14, 0],
      [b.OUT_X0 + 0.14, b.OUT_Y1 - 0.14, 0],
    ]);
    trace(ctx, hl);
    ctx.fillStyle = 'rgba(255,225,180,0.10)';
    ctx.fill();

    // outer edge line
    trace(ctx, top);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  drawFelt(ctx) {
    const b = BOARD;
    const felt = this.poly3(ctx, [
      [b.FELT_X0, b.FELT_Y0, 0.004],
      [b.FELT_X1, b.FELT_Y0, 0.004],
      [b.FELT_X1, b.FELT_Y1, 0.004],
      [b.FELT_X0, b.FELT_Y1, 0.004],
    ]);
    const bb = bbox(felt);
    const g = ctx.createRadialGradient(
      (bb.x0 + bb.x1) / 2 - bb.x0 * 0.05, (bb.y0 + bb.y1) / 2, 10,
      (bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2, Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.72,
    );
    g.addColorStop(0, COL.feltHi);
    g.addColorStop(0.55, COL.felt);
    g.addColorStop(1, COL.feltLo);
    trace(ctx, felt);
    ctx.fillStyle = g;
    ctx.fill();

    // inner shadow so the felt looks recessed
    ctx.save();
    trace(ctx, felt);
    ctx.clip();
    const inner = this.poly3(ctx, [
      [b.FELT_X0, b.FELT_Y0, 0.004],
      [b.FELT_X1, b.FELT_Y0, 0.004],
      [b.FELT_X1, b.FELT_Y1, 0.004],
      [b.FELT_X0, b.FELT_Y1, 0.004],
    ]);
    trace(ctx, inner);
    ctx.strokeStyle = 'rgba(0,0,0,0.42)';
    ctx.lineWidth = 10 * (this.cam.focal / 90);
    ctx.stroke();
    ctx.restore();

    trace(ctx, felt);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // gold inlay on the rail
    const inset = 0.28;
    const inlay = this.poly3(ctx, [
      [b.FELT_X0 - inset, b.FELT_Y0 - inset, 0],
      [b.FELT_X1 + inset, b.FELT_Y0 - inset, 0],
      [b.FELT_X1 + inset, b.FELT_Y1 + inset, 0],
      [b.FELT_X0 - inset, b.FELT_Y1 + inset, 0],
    ]);
    trace(ctx, inlay);
    ctx.strokeStyle = 'rgba(216,178,106,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawTray(ctx) {
    const b = BOARD;
    const x0 = b.TRAY_X0;
    const x1 = b.TRAY_X1;
    const y0 = b.FELT_Y0 + 0.28;
    const y1 = b.FELT_Y1 - 0.28;
    const z = 0.006;
    const pts = this.poly3(ctx, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]);
    trace(ctx, pts);
    ctx.fillStyle = 'rgba(3,18,15,0.62)';
    ctx.fill();

    // recessed inner shadow
    ctx.save();
    trace(ctx, pts);
    ctx.clip();
    const inner = this.poly3(ctx, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]);
    trace(ctx, inner);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.restore();

    // gold rim
    trace(ctx, pts);
    ctx.strokeStyle = 'rgba(216,178,106,0.26)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // divider between white's (bottom) and black's (top) tray
    const a = this.p(x0, 0, 0.004);
    const c = this.p(x1, 0, 0.004);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(c.x, c.y);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(216,178,106,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // separator line between the two halves of the board
    const s0 = this.p(-6.9, 0, 0.004);
    const s1 = this.p(6.6, 0, 0.004);
    ctx.beginPath();
    ctx.moveTo(s0.x, s0.y);
    ctx.lineTo(s1.x, s1.y);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  drawPoints(ctx) {
    const b = BOARD;
    for (let p = 1; p <= 24; p++) {
      const bottom = p <= 12;
      const xc = colX(colIndex(p));
      const x0 = xc - 0.5;
      const x1 = xc + 0.5;
      const baseY = bottom ? b.Y0 : b.Y1;
      const apexY = 0;
      const z = 0.008;
      const tri = this.poly3(ctx, [[x0, baseY, z], [x1, baseY, z], [xc, apexY, z]]);
      const isRed = colIndex(p) % 2 === 1;
      const base = isRed ? COL.red : COL.cream;
      const lo = isRed ? COL.redLo : COL.creamLo;
      const gBase = this.p(xc, baseY, z);
      const gApex = this.p(xc, apexY, z);
      const g = ctx.createLinearGradient(gBase.x, gBase.y, gApex.x, gApex.y);
      g.addColorStop(0, base);
      g.addColorStop(1, lo);
      trace(ctx, tri);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = isRed ? 'rgba(0,0,0,0.22)' : 'rgba(120,95,50,0.30)';
      ctx.lineWidth = 0.9;
      ctx.stroke();

      // subtle specular sheen on the left flank
      const sheen = this.poly3(ctx, [
        [x0 + 0.02, baseY, z],
        [xc - 0.06, apexY, z],
        [x0 + 0.2, baseY, z],
      ]);
      trace(ctx, sheen);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fill();
    }
  }

  drawBar(ctx) {
    const b = BOARD;
    const zt = b.BAR_TOP;
    const x0 = -b.BAR_HW;
    const x1 = b.BAR_HW;
    const y0 = b.OUT_Y0;
    const y1 = b.OUT_Y1;

    // soft shadow the raised bar casts on the felt on both sides
    for (const side of [-1, 1]) {
      const edge = side < 0 ? x0 : x1;
      for (let i = 0; i < 3; i++) {
        const a = edge + side * (0.01 + i * 0.1);
        const c = a + side * 0.1;
        const band = this.poly3(ctx, [
          [a, b.FELT_Y0, 0.006], [c, b.FELT_Y0, 0.006],
          [c, b.FELT_Y1, 0.006], [a, b.FELT_Y1, 0.006],
        ]);
        trace(ctx, band);
        ctx.fillStyle = `rgba(0,0,0,${0.18 - i * 0.055})`;
        ctx.fill();
      }
    }

    // the two long side faces
    for (const [x, col] of [[x0, '#432510'], [x1, '#4d2b14']]) {
      const face = this.poly3(ctx, [[x, y0, zt], [x, y1, zt], [x, y1, 0.008], [x, y0, 0.008]]);
      trace(ctx, face);
      ctx.fillStyle = col;
      ctx.fill();
    }

    // near end face
    const front = this.poly3(ctx, [[x0, y0, zt], [x1, y0, zt], [x1, y0, 0.008], [x0, y0, 0.008]]);
    let bb = bbox(front);
    let g = ctx.createLinearGradient(bb.x0, bb.y0, bb.x0, bb.y1);
    g.addColorStop(0, '#7d5229');
    g.addColorStop(0.55, '#57351a');
    g.addColorStop(1, '#331b0b');
    trace(ctx, front);
    ctx.fillStyle = g;
    ctx.fill();

    // top face
    const top = this.poly3(ctx, [[x0, y0, zt], [x1, y0, zt], [x1, y1, zt], [x0, y1, zt]]);
    bb = bbox(top);
    g = ctx.createLinearGradient(bb.x0, bb.y0, bb.x1, bb.y1);
    g.addColorStop(0, '#93643a');
    g.addColorStop(0.45, '#7a5029');
    g.addColorStop(1, '#553318');
    trace(ctx, top);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,220,170,0.20)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // fine centre bead so the separation reads clearly
    const bead = this.poly3(ctx, [
      [-0.05, y0 + 0.75, zt], [0.05, y0 + 0.75, zt],
      [0.05, y1 - 0.75, zt], [-0.05, y1 - 0.75, zt],
    ]);
    trace(ctx, bead);
    ctx.fillStyle = 'rgba(216,178,106,0.16)';
    ctx.fill();
  }

  drawLabels(ctx) {
    const b = BOARD;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let p = 1; p <= 24; p++) {
      const bottom = p <= 12;
      const x = colX(colIndex(p));
      const y = bottom ? b.Y0 - 0.85 : b.Y1 + 0.85;
      const pos = this.p(x, y, 0.01);
      const dir = this.p(x + 0.2, y, 0.01);
      const ang = Math.atan2(dir.y - pos.y, dir.x - pos.x);
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(ang);
      const fs = Math.max(7, 0.26 * pos.s);
      ctx.font = `600 ${fs.toFixed(1)}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = 'rgba(24,13,4,0.5)';
      ctx.fillText(String(p), 0, 0.9);
      ctx.fillStyle = 'rgba(246,226,178,0.55)';
      ctx.fillText(String(p), 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------ dynamic */

  render(view) {
    if (this.dirty) this.buildStatic();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.static, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const { state, time } = view;

    this.drawSelectionGlow(ctx, view);
    this.drawPieces(ctx, view);
    this.drawFlight(ctx, view);
    this.drawDice(ctx, view);
    this.drawTargets(ctx, view, time);
    this.drawHover(ctx, view);
  }

  drawSelectionGlow(ctx, view) {
    const { state, selected, time } = view;
    if (!selected) return;
    const pulse = 0.62 + 0.38 * Math.sin(time / 380);
    let x, y, z;
    if (selected.kind === 'bar') {
      const bp = barPos(state.turn, Math.max(0, state.bar[state.turn] - 1));
      x = bp.x;
      y = bp.y;
      z = BOARD.BAR_TOP;
    } else if (selected.kind === 'off') {
      return;
    } else {
      x = pointX(selected.p);
      y = pointY(selected.p);
      z = 0.01;
    }
    const ring = circlePts(this.cam, x, y, z, BOARD.R * 1.34, 34);
    trace(ctx, ring);
    ctx.save();
    ctx.shadowColor = 'rgba(255,209,128,0.95)';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = `rgba(255,214,140,${0.45 + 0.45 * pulse})`;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();
  }

  drawPieces(ctx, view) {
    const { state } = view;
    const hide = view.hideTop;
    const pieces = [];

    for (let p = 1; p <= 24; p++) {
      const pt = state.points[p - 1];
      if (pt.count <= 0) continue;
      for (let i = 0; i < pt.count; i++) {
        if (hide && hide.kind === 'point' && hide.p === p && i === pt.count - 1) continue;
        pieces.push({
          owner: pt.owner,
          x: pointX(p),
          y: pointY(p),
          z: i * BOARD.CSTEP,
          surfaceZ: 0.01,
          i,
        });
      }
    }
    for (let pl = 0; pl < 2; pl++) {
      for (let i = 0; i < state.bar[pl]; i++) {
        if (hide && hide.kind === 'bar' && hide.player === pl && i === state.bar[pl] - 1) continue;
        const bp = barPos(pl, i);
        pieces.push({
          owner: pl,
          x: bp.x,
          y: bp.y,
          z: bp.z,
          surfaceZ: BOARD.BAR_TOP,
          i,
        });
      }
      for (let i = 0; i < state.off[pl]; i++) {
        const pos = offPos(pl, i);
        pieces.push({ owner: pl, x: pos.x, y: pos.y, z: pos.z, surfaceZ: 0.006, small: true, i });
      }
    }

    // painter's algorithm: farthest first
    for (const p of pieces) {
      p.depth = this.cam.project(p.x, p.y, p.z).z;
    }
    pieces.sort((a, b) => b.depth - a.depth);

    // shadows first (one per stack)
    for (const p of pieces) {
      if (p.small || p.i !== 0) continue;
      this.checkerShadow(ctx, p.x, p.y, p.surfaceZ, BOARD.R);
    }
    for (const p of pieces) this.drawChecker(ctx, p.owner, p.x, p.y, p.z, p.small ? BOARD.R * 0.6 : BOARD.R);
  }

  checkerShadow(ctx, x, y, z, r) {
    for (let i = 0; i < 3; i++) {
      const rr = r * (0.98 + i * 0.14);
      const pts = circlePts(this.cam, x + 0.055, y - 0.075, z + 0.001, rr, 20);
      trace(ctx, pts);
      ctx.fillStyle = `rgba(0,0,0,${0.2 / (i * 0.9 + 1)})`;
      ctx.fill();
    }
  }

  drawChecker(ctx, owner, x, y, z, r = BOARD.R) {
    const cam = this.cam;
    const h = BOARD.CH;
    const top = circlePts(cam, x, y, z + h, r, 30);
    const bot = circlePts(cam, x, y, z, r, 30);
    const sil = hull(top.concat(bot));
    const bb = bbox(sil);

    const white = owner === 0;
    const bodyHi = white ? '#fbf4e4' : '#4a4854';
    const bodyMid = white ? '#e6d8ba' : '#2b2a32';
    const bodyLo = white ? '#a4916e' : '#131218';

    // side wall
    const g = ctx.createLinearGradient(bb.x0, bb.y0, bb.x1, bb.y1);
    g.addColorStop(0, white ? '#efdfc0' : '#454351');
    g.addColorStop(0.45, white ? '#cbb894' : '#232229');
    g.addColorStop(1, white ? '#8d7a58' : '#0f0e13');
    trace(ctx, sil);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = white ? 'rgba(58,42,18,0.35)' : 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // top face
    const cbak = cam.project(x, y, z + h);
    const rg = ctx.createRadialGradient(
      cbak.x - r * cbak.s * 0.42, cbak.y - r * cbak.s * 0.5, r * cbak.s * 0.05,
      cbak.x, cbak.y, r * cbak.s * 1.35,
    );
    rg.addColorStop(0, bodyHi);
    rg.addColorStop(0.55, bodyMid);
    rg.addColorStop(1, bodyLo);
    trace(ctx, top);
    ctx.fillStyle = rg;
    ctx.fill();

    // rim
    ctx.strokeStyle = white ? 'rgba(255,250,235,0.55)' : 'rgba(150,148,170,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // engraved ring
    const groove = circlePts(cam, x, y, z + h, r * 0.74, 24);
    trace(ctx, groove);
    ctx.strokeStyle = white ? 'rgba(120,98,62,0.30)' : 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    const inner = circlePts(cam, x, y, z + h, r * 0.6, 22);
    trace(ctx, inner);
    ctx.fillStyle = white ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.05)';
    ctx.fill();

    // specular
    const hi = circlePts(cam, x - r * 0.26, y - r * 0.3, z + h, r * 0.3, 14);
    trace(ctx, hi);
    ctx.fillStyle = white ? 'rgba(255,255,255,0.5)' : 'rgba(190,190,215,0.22)';
    ctx.fill();
  }

  drawFlight(ctx, view) {
    const f = view.flight;
    if (!f) return;
    const t = clamp((view.time - f.t0) / f.dur, 0, 1);
    const e = 1 - Math.pow(1 - t, 3);
    const x = f.from.x + (f.to.x - f.from.x) * e;
    const y = f.from.y + (f.to.y - f.from.y) * e;
    const z = f.from.z + (f.to.z - f.from.z) * e + Math.sin(Math.PI * t) * f.arc;
    const surf = f.surfaceZ;
    const rr = f.shrink ? BOARD.R * (1 - 0.4 * e) : BOARD.R;
    this.checkerShadow(ctx, x, y, surf, rr * (0.85 + 0.15 * (1 - t)));
    this.drawChecker(ctx, f.owner, x, y, z, rr);
  }

  drawDice(ctx, view) {
    const dice = view.dice;
    if (!dice || !dice.length) return;
    for (const d of dice) {
      // contact shadow — on the felt while the dice are over the board,
      // on the table once they have landed in front of it
      const overBoard = Math.abs(d.x) < BOARD.OUT_X1 && Math.abs(d.y) < BOARD.OUT_Y1;
      const shadowZ = overBoard ? 0.008 : -BOARD.THICK + 0.002;
      for (let i = 0; i < 3; i++) {
        const pts = circlePts(this.cam, d.x + 0.07, d.y - 0.06, shadowZ, (BOARD.DIE * 0.62) * (1 + i * 0.2), 18);
        trace(ctx, pts);
        ctx.fillStyle = `rgba(0,0,0,${(d.z < 0 ? 0.26 : 0.1) / (i * 0.9 + 1)})`;
        ctx.fill();
      }
      this.drawDie(ctx, d.x, d.y, d.z, d.q, d.value, d.used ? 0.42 : 1);
    }
  }

  drawDie(ctx, cx, cy, cz, q, value, alpha) {
    const cam = this.cam;
    const s = BOARD.DIE;
    const h = s / 2;
    const m = qMat(q);
    const faces = [];
    for (const f of DIE_FACES) {
      const n = mv(m, f.n);
      const t1 = mv(m, f.t1);
      const t2 = mv(m, f.t2);
      const c = [cx + n[0] * h, cy + n[1] * h, cz + n[2] * h];
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [
        c[0] + t1[0] * i * h + t2[0] * j * h,
        c[1] + t1[1] * i * h + t2[1] * j * h,
        c[2] + t1[2] * i * h + t2[2] * j * h,
      ]);
      const pts = corners.map((p) => cam.project(p[0], p[1], p[2]));
      let area = 0;
      for (let i = 0; i < 4; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 4];
        area += a.x * b.y - b.x * a.y;
      }
      if (area >= 0) continue; // back facing
      faces.push({ f, n, t1, t2, c, pts, depth: cam.project(c[0], c[1], c[2]).z });
    }
    faces.sort((a, b) => b.depth - a.depth);

    ctx.save();
    ctx.globalAlpha = alpha;
    for (const face of faces) {
      const { n } = face;
      const lambert = clamp(n[0] * LIGHT_DIR[0] + n[1] * LIGHT_DIR[1] + n[2] * LIGHT_DIR[2], 0, 1);
      const tone = 0.55 + 0.45 * lambert;
      const base = [246, 238, 220];
      const col = base.map((c) => Math.round(clamp(c * tone, 40, 255)));
      trace(ctx, face.pts);
      ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,45,30,0.45)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // pips
      const off = s * 0.235;
      const pr = s * 0.088;
      for (const [pu, pv] of PIPS[face.f.v]) {
        const pc = [
          face.c[0] + face.t1[0] * pu * off + face.t2[0] * pv * off + face.n[0] * 0.001,
          face.c[1] + face.t1[1] * pu * off + face.t2[1] * pv * off + face.n[1] * 0.001,
          face.c[2] + face.t1[2] * pu * off + face.t2[2] * pv * off + face.n[2] * 0.001,
        ];
        const pipPts = [];
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU;
          const px3 = [
            pc[0] + face.t1[0] * Math.cos(a) * pr + face.t2[0] * Math.sin(a) * pr + face.n[0] * 0.002,
            pc[1] + face.t1[1] * Math.cos(a) * pr + face.t2[1] * Math.sin(a) * pr + face.n[1] * 0.002,
            pc[2] + face.t1[2] * Math.cos(a) * pr + face.t2[2] * Math.sin(a) * pr + face.n[2] * 0.002,
          ];
          pipPts.push(cam.project(px3[0], px3[1], px3[2]));
        }
        trace(ctx, pipPts);
        ctx.fillStyle = 'rgba(26,22,18,0.92)';
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawTargets(ctx, view, time) {
    const targets = view.targets || [];
    if (!targets.length) return;
    const pulse = 0.5 + 0.5 * Math.sin(time / 300);
    for (const t of targets) {
      const pos = this.cam.project(t.x, t.y, t.z);
      const r = Math.max(9, 0.27 * pos.s) * (0.94 + 0.06 * pulse);
      const hovered = !!(view.hover && (
        (t.to === 'off' && view.hover.kind === 'off') ||
        (view.hover.kind === 'point' && view.hover.p === t.to)
      ));
      ctx.save();
      // outer glow
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r * (hovered ? 1.5 : 1.28), 0, TAU);
      const g = ctx.createRadialGradient(pos.x, pos.y, r * 0.2, pos.x, pos.y, r * (hovered ? 1.5 : 1.28));
      g.addColorStop(0, 'rgba(255,214,140,0.55)');
      g.addColorStop(1, 'rgba(255,190,110,0)');
      ctx.fillStyle = g;
      ctx.fill();
      // disc
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r * (hovered ? 1.1 : 1), 0, TAU);
      ctx.fillStyle = 'rgba(255,214,140,0.94)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(80,50,10,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // die value
      ctx.fillStyle = '#2a1c07';
      ctx.font = `700 ${Math.max(9, r * 1.15).toFixed(1)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(t.die), pos.x, pos.y + r * 0.04);
      ctx.restore();
    }
  }

  drawHover(ctx, view) {
    const h = view.hover;
    if (!h || h.kind !== 'point') return;
    if (view.targetKeys && view.targetKeys.has(`p${h.p}`)) return; // already has a marker
    const state = view.state;
    const pt = state.points[h.p - 1];
    if (pt.count <= 0) return;
    const x = pointX(h.p);
    const y = pointY(h.p);
    const z = pt.count * BOARD.CSTEP + BOARD.CH + 0.02;
    const pts = circlePts(this.cam, x, y, z, BOARD.R * 1.05, 24);
    trace(ctx, pts);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}
