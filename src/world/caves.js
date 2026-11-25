// Cave systems: signed distance functions + naive surface-nets mesher. Pure module.
// SDF convention: negative = inside solid rock.
import { createNoise, clamp } from './noise.js';
import { WORLD, CAVES } from './layout.js';

const N = createNoise(WORLD.seed + 99);

function smin(a, b, k) {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
}

// Ellipsoid with a "skirt": stretched downward so rock always meets the seabed.
function sdBlob(px, py, pz, b) {
  const ry = py < b[1] ? b[4] * 3 : b[4];
  const kx = (px - b[0]) / b[3], ky = (py - b[1]) / ry, kz = (pz - b[2]) / b[5];
  const k0 = Math.sqrt(kx * kx + ky * ky + kz * kz);
  const k1 = Math.sqrt((kx / b[3]) ** 2 + (ky / ry) ** 2 + (kz / b[5]) ** 2) + 1e-9;
  return (k0 * (k0 - 1)) / k1;
}

// Precompile tunnels into flat segment arrays
const compiled = CAVES.map((C) => {
  const segs = [];
  for (const t of C.tunnels) {
    for (let i = 0; i < t.length - 1; i++) {
      const a = t[i], b = t[i + 1];
      segs.push({ ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], ra: a[3], rb: b[3] });
    }
  }
  return { C, segs };
});

function tunnelDist(cc, x, y, z) {
  let d = 1e9;
  for (const s of cc.segs) {
    const abx = s.bx - s.ax, aby = s.by - s.ay, abz = s.bz - s.az;
    const t = clamp(((x - s.ax) * abx + (y - s.ay) * aby + (z - s.az) * abz) / (abx * abx + aby * aby + abz * abz), 0, 1);
    const dx = x - (s.ax + abx * t), dy = y - (s.ay + aby * t), dz = z - (s.az + abz * t);
    const v = Math.sqrt(dx * dx + dy * dy + dz * dz) - (s.ra + (s.rb - s.ra) * t);
    d = smin(d, v, 2.5);
  }
  for (const c of cc.C.chambers) {
    const v = Math.hypot(x - c[0], (y - c[1]) * 1.25, z - c[2]) - c[3];
    d = smin(d, v, 5);
  }
  return d - 1.1 * N.n3(x * 0.11, y * 0.11, z * 0.11);
}

function rockDist(cc, x, y, z) {
  let d = 1e9;
  for (const b of cc.C.blobs) d = smin(d, sdBlob(x, y, z, b), 12);
  return d + 4.2 * N.fbm3(x * 0.03, y * 0.03, z * 0.03, 3) + 0.9 * N.n3(x * 0.16, y * 0.22, z * 0.16);
}

export function caveSdfIndex(idx, x, y, z) {
  const cc = compiled[idx];
  const r = rockDist(cc, x, y, z);
  if (r > 6) return r; // far outside rock: tunnels irrelevant
  return Math.max(r, -tunnelDist(cc, x, y, z));
}

// Returns which cave (index) a point is inside the bounds of, or -1.
export function caveAt(x, y, z, pad = 0) {
  for (let i = 0; i < CAVES.length; i++) {
    const C = CAVES[i];
    if (x > C.min[0] - pad && x < C.max[0] + pad && y > C.min[1] - pad && y < C.max[1] + pad && z > C.min[2] - pad && z < C.max[2] + pad) return i;
  }
  return -1;
}

export function caveSdf(x, y, z) {
  const i = caveAt(x, y, z, 1);
  return i < 0 ? 1e9 : caveSdfIndex(i, x, y, z);
}

// How "inside the rock" a point is: 0 outside, 1 deep in a tunnel (used for darkness / ambience)
export function caveEnclosure(x, y, z) {
  const i = caveAt(x, y, z);
  if (i < 0) return 0;
  const r = rockDist(compiled[i], x, y, z);
  return clamp(-r / 7, 0, 1) * CAVES[i].dark;
}

export function tunnelWallness(idx, x, y, z) {
  return tunnelDist(compiled[idx], x, y, z);
}

// Naive surface nets. Returns { positions, normals, inner, indices }.
export function meshCave(idx) {
  const C = CAVES[idx];
  const v = C.voxel;
  const nx = Math.ceil((C.max[0] - C.min[0]) / v) + 1;
  const ny = Math.ceil((C.max[1] - C.min[1]) / v) + 1;
  const nz = Math.ceil((C.max[2] - C.min[2]) / v) + 1;
  const field = new Float32Array(nx * ny * nz);
  const ox = C.min[0], oy = C.min[1], oz = C.min[2];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const id = i + nx * (j + ny * k);
        const border = i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1;
        // Borders are forced to air so the mesh is closed (the bottom cap sits below the seabed).
        field[id] = border ? 1 : caveSdfIndex(idx, ox + i * v, oy + j * v, oz + k * v);
      }
    }
  }

  const vIndex = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cx = [0, 1, 0, 1, 0, 1, 0, 1], cy = [0, 0, 1, 1, 0, 0, 1, 1], cz = [0, 0, 0, 0, 1, 1, 1, 1];
  const val = new Float32Array(8);
  let count = 0;
  for (let k = 0; k < nz - 1; k++) {
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const f = field[(i + cx[c]) + nx * ((j + cy[c]) + ny * (k + cz[c]))];
          val[c] = f;
          if (f < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of EDGES) {
          const fa = val[a], fb = val[b];
          if ((fa < 0) === (fb < 0)) continue;
          const t = fa / (fa - fb);
          sx += cx[a] + (cx[b] - cx[a]) * t;
          sy += cy[a] + (cy[b] - cy[a]) * t;
          sz += cz[a] + (cz[b] - cz[a]) * t;
          n++;
        }
        vIndex[i + nx * (j + ny * k)] = count++;
        pos.push(ox + (i + sx / n) * v, oy + (j + sy / n) * v, oz + (k + sz / n) * v);
      }
    }
  }

  const positions = new Float32Array(pos);
  const normals = new Float32Array(positions.length);
  const inner = new Float32Array(count);
  const e = v * 0.5;
  for (let q = 0; q < count; q++) {
    const x = positions[q * 3], y = positions[q * 3 + 1], z = positions[q * 3 + 2];
    let gx = caveSdfIndex(idx, x + e, y, z) - caveSdfIndex(idx, x - e, y, z);
    let gy = caveSdfIndex(idx, x, y + e, z) - caveSdfIndex(idx, x, y - e, z);
    let gz = caveSdfIndex(idx, x, y, z + e) - caveSdfIndex(idx, x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    normals[q * 3] = gx / l; normals[q * 3 + 1] = gy / l; normals[q * 3 + 2] = gz / l;
    // 1 = tunnel wall (inside the cave), 0 = outer rock surface
    inner[q] = clamp(1 - Math.abs(tunnelDist(compiled[idx], x, y, z)) / 2.5, 0, 1);
  }

  const idxs = [];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    pushTri(a, b, c); pushTri(a, c, d);
  };
  const pushTri = (a, b, c) => {
    // orient by the SDF gradient (vertex normals) so faces point out of the rock
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
    const wx = positions[c * 3] - ax, wy = positions[c * 3 + 1] - ay, wz = positions[c * 3 + 2] - az;
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    const nxv = normals[a * 3] + normals[b * 3] + normals[c * 3];
    const nyv = normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1];
    const nzv = normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c * 3 + 2];
    if (fx * nxv + fy * nyv + fz * nzv >= 0) idxs.push(a, b, c);
    else idxs.push(a, c, b);
  };
  const VI = (i, j, k) => vIndex[i + nx * (j + ny * k)];
  for (let k = 1; k < nz - 1; k++) {
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const inside = field[i + nx * (j + ny * k)] < 0;
        if (inside !== (field[(i + 1) + nx * (j + ny * k)] < 0)) quad(VI(i, j - 1, k - 1), VI(i, j, k - 1), VI(i, j, k), VI(i, j - 1, k));
        if (inside !== (field[i + nx * ((j + 1) + ny * k)] < 0)) quad(VI(i - 1, j, k - 1), VI(i, j, k - 1), VI(i, j, k), VI(i - 1, j, k));
        if (inside !== (field[i + nx * (j + ny * (k + 1))] < 0)) quad(VI(i - 1, j - 1, k), VI(i, j - 1, k), VI(i, j, k), VI(i - 1, j, k));
      }
    }
  }
  const indices = count > 65535 ? new Uint32Array(idxs) : new Uint16Array(idxs);
  return { positions, normals, inner, indices };
}
