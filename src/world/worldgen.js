// Pure terrain + biome functions. Runs inside workers (bulk heightmap) and in tests.
import { createNoise, smoothstep, clamp, lerp } from './noise.js';
import { WORLD, ISLANDS, RIFT, REGIONS, HAVEN } from './layout.js';

const N = createNoise(WORLD.seed);

function distToRift(x, z) {
  const P = RIFT.points;
  let best = 1e9;
  for (let i = 0; i < P.length - 1; i++) {
    const ax = P[i][0], az = P[i][1], bx = P[i + 1][0], bz = P[i + 1][1];
    const abx = bx - ax, abz = bz - az;
    const t = clamp(((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz), 0, 1);
    const dx = x - (ax + abx * t), dz = z - (az + abz * t);
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// Secondary hills, a sea-cliff sector and a stream valley ending at a waterfall pool, so Haven is not one smooth cone
function havenRelief(hi, x, z, dIn, ang) {
  hi += 15 * smoothstep(0.15, 0.75, N.n2(x * 0.009 + 5.1, z * 0.009 - 2.7)) * smoothstep(25, 90, dIn)
    + 1.4 * N.fbm2(x * 0.06, z * 0.06, 2) * smoothstep(6, 25, dIn);
  let da = Math.abs(ang - HAVEN.cliffAng);
  if (da > Math.PI) da = 2 * Math.PI - da;
  hi += 14 * smoothstep(0.5, 0.2, da) * smoothstep(1, 9, dIn);
  const [[ax, az], [bx, bz]] = HAVEN.valley;
  const abx = bx - ax, abz = bz - az, L2 = abx * abx + abz * abz;
  const u = ((x - ax) * abx + (z - az) * abz) / L2;
  const dv = Math.hypot(x - ax - abx * clamp(u, 0, 1), z - az - abz * clamp(u, 0, 1));
  const floor = lerp(1.2, HAVEN_POOL_FLOOR, smoothstep(0, 1, u)) + 0.6 * N.n2(x * 0.08, z * 0.08);
  const wv = smoothstep(24, 7, dv) * smoothstep(1.04, 0.99, u) * smoothstep(-0.1, 0.05, u);
  hi = lerp(hi, Math.min(hi, floor), wv);
  const P = HAVEN.pool, dp = Math.hypot(x - P.x, z - P.z);
  return Math.min(hi, lerp(hi, HAVEN_POOL_FLOOR - 1.4, smoothstep(P.r, P.r * 0.35, dp)));
}
const HAVEN_POOL_FLOOR = 10;

function regionMask(R, wx, wz, soft = 0.55) {
  const d = Math.hypot(wx - R.x, wz - R.z) * (1 + 0.18 * N.n2(wx * 0.004 + R.x, wz * 0.004));
  return smoothstep(R.r, R.r * soft, d);
}

// Returns height (and optionally fills biome weights into out[0..3] = reef, kelp, rift, volcanic)
export function sampleWorld(x, z, out) {
  // Beyond the Pale Edge everything below resolves to exactly -420; skipping it saves ~22% of generation
  if (x * x + z * z >= 2040 * 2040) {
    if (out) out[0] = out[1] = out[2] = out[3] = 0;
    return -420;
  }
  const wx = x + 140 * N.n2(x * 0.0013 + 11.3, z * 0.0013 - 4.1);
  const wz = z + 140 * N.n2(x * 0.0013 - 7.9, z * 0.0013 + 2.6);

  // Open seabed: rolling plains, -30..-66 m
  const base = -48 + 14 * N.fbm2(wx * 0.0008, wz * 0.0008, 4) + 5 * N.fbm2(wx * 0.004, wz * 0.004, 3)
    + 2.2 * N.ridged2(wx * 0.011, wz * 0.011, 2);
  let h = base;

  let reef = 0, volcanic = 0;

  // Islands use a milder warp so small islets stay where the layout puts them
  const iwx = x + (wx - x) * 0.3, iwz = z + (wz - z) * 0.3;
  for (let k = 0; k < ISLANDS.length; k++) {
    const I = ISLANDS[k];
    const dx = iwx - I.x, dz = iwz - I.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > I.r + 520) continue;
    const ang = Math.atan2(dz, dx);
    const coastWobble = 1 + 0.17 * N.n2(Math.cos(ang) * 1.6 + k * 17.1, Math.sin(ang) * 1.6) + 0.07 * N.n2(wx * 0.008, wz * 0.008);
    const d = dist / (I.r * coastWobble); // 1.0 at the coastline
    let s; // metres outside coast (negative inland)
    if (I.type === 'atoll') {
      const ringHalf = 34 + 14 * N.n2(ang * 3.0, k);
      s = Math.abs(d - 0.8) * I.r - ringHalf;
      let ga = Math.abs(ang - I.gap); if (ga > Math.PI) ga = 2 * Math.PI - ga;
      s += 70 * smoothstep(0.32, 0.08, ga); // channel into the lagoon
    } else {
      s = (d - 1) * I.r;
    }

    let hi;
    if (s >= 0) {
      const bommies = 3.2 * Math.max(0, N.n2(wx * 0.035, wz * 0.035)) ** 2 * 2 + 1.2 * N.fbm2(wx * 0.02, wz * 0.02, 2);
      const steep = I.type === 'spire' ? 0.55 : I.type === 'rock' ? 0.35 : 0.2;
      const beachSlope = -1.2 - s * steep;
      const flat = -7 - s * 0.045 + bommies;
      hi = lerp(beachSlope, Math.min(flat, beachSlope + 6), smoothstep(5, 45, s));
      if (I.type === 'atoll' && d < 0.8) hi = Math.max(hi, -4.8 + 1.4 * N.fbm2(wx * 0.01, wz * 0.01, 2) + bommies * 0.4);
      const dropAt = 150 + 50 * N.n2(wx * 0.003, wz * 0.003);
      const drop = smoothstep(dropAt, dropAt + 210, s);
      hi = lerp(hi, base, drop);
      const reefW = (1 - drop) * smoothstep(-2, -5, hi) * (I.type === 'volcanic' ? 0.35 : 1);
      if (reefW > reef) reef = reefW;
    } else {
      const dIn = -s;
      const beach = Math.min(-1.2 + dIn * (I.type === 'spire' ? 0.5 : 0.12), 2.4);
      const n = N.fbm2(wx * 0.004 + k * 3.3, wz * 0.004, 4);
      if (I.type === 'tropical') {
        const t = smoothstep(12, I.r * 0.95, dIn);
        hi = beach + I.peak * Math.pow(t, 1.5) * (0.72 + 0.4 * n) + 7 * N.ridged2(wx * 0.012, wz * 0.012, 3) * t;
        if (I.id === 'haven') hi = havenRelief(hi, x, z, dIn, ang);
      } else if (I.type === 'atoll') {
        const t = smoothstep(4, 30, dIn);
        hi = beach + I.peak * t * (0.6 + 0.5 * n);
      } else if (I.type === 'spire') {
        const t = smoothstep(4, I.r * 0.75, dIn);
        let v = I.peak * Math.pow(t, 0.7) * (0.8 + 0.25 * n);
        const step = 9;
        const terr = Math.floor(v / step) * step;
        v = lerp(v, terr + step * smoothstep(0.65, 1, (v - terr) / step), 0.75); // cliff ledges
        hi = beach + v + 4 * N.ridged2(wx * 0.02, wz * 0.02, 2) * t;
      } else if (I.type === 'volcanic') {
        const t = smoothstep(6, I.r * 0.92, dIn);
        hi = beach + I.peak * Math.pow(t, 1.25) * (0.85 + 0.2 * n);
        hi -= 26 * smoothstep(0.2, 0.06, d); // crater
        volcanic = Math.max(volcanic, 1);
      } else {
        const t = smoothstep(2, I.r * 0.8, dIn);
        hi = beach + I.peak * Math.pow(t, 0.8) * (0.7 + 0.5 * n) + 3 * N.ridged2(wx * 0.04, wz * 0.04, 2) * t;
      }
    }
    if (I.type === 'volcanic') volcanic = Math.max(volcanic, smoothstep(320, 120, s));
    if (hi > h) h = hi;
  }

  // Regions
  const kM = regionMask(REGIONS.kelp, wx, wz);
  h = lerp(h, Math.max(h, -36 + 6 * N.fbm2(wx * 0.006, wz * 0.006, 3)), kM * 0.85);

  const dM = regionMask(REGIONS.dunes, wx, wz, 0.4);
  if (dM > 0) {
    const ca = 0.83, sa = 0.56; // dune direction
    const u = wx * ca + wz * sa, v = -wx * sa + wz * ca;
    const dune = N.ridged2(u * 0.0035, v * 0.011, 2);
    h += dM * (7 * dune - 3);
  }

  const cM = regionMask(REGIONS.choir, wx, wz);
  if (cM > 0) h += cM * (9 * N.ridged2(wx * 0.009, wz * 0.009, 3) - 4);

  for (const key of ['station', 'ruins']) {
    const R = REGIONS[key];
    const d = Math.hypot(x - R.x, z - R.z);
    const f = smoothstep(R.r, R.r * 0.45, d);
    if (f > 0) h = lerp(h, R.h + 1.2 * N.fbm2(x * 0.05, z * 0.05, 2), f * 0.92);
  }

  // The Hollow Rift
  const dR = distToRift(wx, wz);
  let rift = 0;
  const wR = RIFT.width * (1 + 0.28 * N.n2(wx * 0.002, wz * 0.002));
  if (dR < wR * 1.4) {
    const t = smoothstep(wR, wR * 0.32, dR);
    const floor = RIFT.floor + 22 * N.fbm2(wx * 0.004, wz * 0.004, 3) + 14 * N.ridged2(wx * 0.015, wz * 0.015, 2);
    const ledges = 10 * Math.sin(dR * 0.09 + 3 * N.n2(wx * 0.01, wz * 0.01)) * t * (1 - t) * 4;
    h = lerp(h, floor, t) + ledges;
    rift = smoothstep(0.05, 0.6, t);
  }

  // The Pale Edge: the world falls away into the abyss
  const rr = Math.hypot(x, z);
  if (rr > 1720) h = lerp(h, -420, smoothstep(1720, 2040, rr));

  if (out) {
    out[0] = reef;
    out[1] = kM * smoothstep(-15, -25, h);
    out[2] = rift;
    out[3] = volcanic;
  }
  return h;
}

// Fill rows [r0, r1) of the heightmap. Biome texture is written for even rows/cols.
export function generateRows(r0, r1) {
  const { res, half, cell } = WORLD;
  const heights = new Float32Array((r1 - r0) * res);
  const bRows = [];
  const tmp = [0, 0, 0, 0];
  for (let j = r0; j < r1; j++) {
    const z = -half + j * cell;
    const doBiome = (j & 1) === 0;
    const brow = doBiome ? new Uint8Array(WORLD.biomeRes * 4) : null;
    for (let i = 0; i < res; i++) {
      const x = -half + i * cell;
      const b = doBiome && (i & 1) === 0;
      heights[(j - r0) * res + i] = sampleWorld(x, z, b ? tmp : null);
      if (b) {
        const o = (i >> 1) * 4;
        brow[o] = tmp[0] * 255; brow[o + 1] = tmp[1] * 255; brow[o + 2] = tmp[2] * 255; brow[o + 3] = tmp[3] * 255;
      }
    }
    if (doBiome) bRows.push({ row: j >> 1, data: brow });
  }
  return { heights, bRows };
}
