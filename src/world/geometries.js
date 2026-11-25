// Procedural plant / coral / rock geometries. Every geometry carries position, normal, color and aGlow
// so they can be merged and instanced with one material per type.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, createNoise } from './noise.js';

const UP = new THREE.Vector3(0, 1, 0);
const N3 = createNoise(424242);

function paint(geo, c0, c1 = c0, glow = 0, yRange = null) {
  if (geo.index === null) {
    const idx = [];
    for (let i = 0; i < geo.attributes.position.count; i++) idx.push(i);
    geo.setIndex(idx);
  }
  geo.deleteAttribute('uv');
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const y0 = yRange ? yRange[0] : geo.boundingBox.min.y, y1 = yRange ? yRange[1] : geo.boundingBox.max.y;
  const col = new Float32Array(pos.count * 3), gl = new Float32Array(pos.count);
  const a = new THREE.Color(c0), b = new THREE.Color(c1), t = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const f = Math.min(Math.max((pos.getY(i) - y0) / Math.max(y1 - y0, 1e-4), 0), 1);
    t.copy(a).lerp(b, f);
    col[i * 3] = t.r; col[i * 3 + 1] = t.g; col[i * 3 + 2] = t.b;
    gl[i] = typeof glow === 'function' ? glow(f) : glow;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
  if (!geo.attributes.normal) geo.computeVertexNormals();
  return geo;
}

function orientTo(geo, dir, at) {
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()));
  geo.translate(at.x, at.y, at.z);
  return geo;
}

function merged(parts) {
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function displace(geo, amt, freq, seed = 0, flattenY = 1) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = N3.fbm3(v.x * freq + seed, v.y * freq, v.z * freq, 3);
    const l = v.length() || 1;
    v.multiplyScalar(1 + (n * amt) / l);
    v.y *= flattenY;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------- underwater ----------
export function branchCoral(seed = 1, lo = false) {
  const rnd = mulberry32(seed);
  const parts = [];
  const br = (base, dir, len, rad, depth) => {
    const g = new THREE.CylinderGeometry(rad * 0.7, rad, len, lo ? 3 : 5, 1, depth > 0);
    g.translate(0, len / 2, 0);
    parts.push(paint(orientTo(g, dir, base), 0xffffff, 0xffffff));
    const tip = base.clone().addScaledVector(dir, len);
    if (depth > 0) {
      const n = depth === 3 ? 3 : 2 + (rnd() < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const nd = dir.clone().add(new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).multiplyScalar(1.3)).add(new THREE.Vector3(0, 0.45, 0)).normalize();
        br(tip, nd, len * (0.68 + rnd() * 0.2), rad * 0.72, depth - 1);
      }
    } else {
      const s = new THREE.SphereGeometry(rad * 0.85, lo ? 3 : 5, lo ? 2 : 4);
      s.translate(tip.x, tip.y, tip.z);
      parts.push(paint(s, 0xffffff));
    }
  };
  br(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 0.32, 0.07, 3);
  const g = merged(parts);
  return paint(g, 0x6a5a66, 0xffffff, (f) => f * f * 0.0);
}

export function brainCoral(lo = false) {
  const g = new THREE.SphereGeometry(0.5, lo ? 14 : 22, lo ? 7 : 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const ridge = Math.abs(Math.sin(N3.n3(v.x * 4, v.y * 4, v.z * 4) * 9)) * 0.04;
    v.multiplyScalar(1 + ridge);
    v.y = v.y * 0.75;
    p.setXYZ(i, v.x, v.y - 0.05, v.z);
  }
  g.computeVertexNormals();
  return paint(g, 0x8a7a60, 0xfff2d8);
}

export function fanCoral(seed = 2, lo = false) {
  const rnd = mulberry32(seed);
  const parts = [];
  const br = (x, y, ang, len, w, depth) => {
    const g = lo ? new THREE.PlaneGeometry(w, len) : new THREE.BoxGeometry(w, len, w * 0.5);
    g.translate(0, len / 2, 0);
    g.rotateZ(ang);
    g.translate(x, y, 0);
    parts.push(paint(g, 0xffffff));
    if (depth > 0) {
      const ex = x - Math.sin(ang) * len, ey = y + Math.cos(ang) * len;
      br(ex, ey, ang + 0.28 + rnd() * 0.2, len * 0.8, w * 0.8, depth - 1);
      br(ex, ey, ang - 0.28 - rnd() * 0.2, len * 0.8, w * 0.8, depth - 1);
    }
  };
  br(0, 0, 0, 0.3, 0.05, 5);
  const g = merged(parts);
  return paint(g, 0x553040, 0xffffff);
}

export function tubeCoral(seed = 3) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const h = 0.35 + rnd() * 0.7, r = 0.06 + rnd() * 0.06;
    const g = new THREE.CylinderGeometry(r, r * 0.8, h, 8, 1, false);
    g.translate((rnd() - 0.5) * 0.35, h / 2, (rnd() - 0.5) * 0.35);
    // dark inner "mouth" on the cap
    const cap = new THREE.CircleGeometry(r * 0.75, 8);
    cap.rotateX(-Math.PI / 2);
    const bb = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
    cap.translate((bb.min.x + bb.max.x) / 2, h + 0.003, (bb.min.z + bb.max.z) / 2);
    parts.push(paint(g, 0x9a6040, 0xffffff), paint(cap, 0x201010));
  }
  return merged(parts);
}

export function tableCoral(seed = 4) {
  const parts = [];
  const stem = new THREE.CylinderGeometry(0.07, 0.12, 0.35, 6);
  stem.translate(0, 0.175, 0);
  parts.push(paint(stem, 0x7a6a50, 0xbfae90));
  const top = new THREE.CylinderGeometry(0.75, 0.5, 0.07, 18, 1);
  const p = top.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), r = Math.hypot(x, z);
    p.setY(i, p.getY(i) + 0.35 + Math.sin(a * 5 + seed) * 0.03 * r + r * r * 0.06);
  }
  top.computeVertexNormals();
  parts.push(paint(top, 0xd8c8a8, 0xffffff));
  return merged(parts);
}

export function anemone(seed = 5) {
  const rnd = mulberry32(seed);
  const parts = [];
  const base = new THREE.CylinderGeometry(0.14, 0.17, 0.14, 10);
  base.translate(0, 0.07, 0);
  parts.push(paint(base, 0x7a3a2a, 0xa04a30));
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rnd() * 0.2, r = 0.05 + rnd() * 0.08;
    const len = 0.22 + rnd() * 0.14;
    const g = new THREE.ConeGeometry(0.018, len, 4);
    g.translate(0, len / 2, 0);
    const dir = new THREE.Vector3(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5);
    parts.push(paint(orientTo(g, dir, new THREE.Vector3(Math.cos(a) * r, 0.13, Math.sin(a) * r)), 0xffffff, 0xffffff, 0.15));
  }
  return paint(merged(parts), 0xa06850, 0xfff0e0, (f) => 0.25 * f);
}

export function seagrass(seed = 6, land = false) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < (land ? 9 : 7); i++) {
    const h = (land ? 0.35 : 0.5) + rnd() * 0.5;
    const g = new THREE.PlaneGeometry(land ? 0.05 : 0.07, h, 1, 4);
    g.translate(0, h / 2, 0);
    const p = g.attributes.position;
    const bend = (rnd() - 0.5) * 0.5;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setZ(k, bend * y * y); }
    g.rotateY(rnd() * Math.PI);
    g.translate((rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.4);
    g.computeVertexNormals();
    parts.push(paint(g, 0xffffff));
  }
  const g = merged(parts);
  return land ? paint(g, 0x34501a, 0x9ab84a) : paint(g, 0x2c4a1a, 0x8aa83a);
}

// Tall ribbon stalk with alternating blades and float bladders. Height 1 (scaled per instance).
export function ribbonweed(seed = 7) {
  const rnd = mulberry32(seed);
  const parts = [];
  const stalk = new THREE.CylinderGeometry(0.006, 0.012, 1, 4, 12, true);
  stalk.translate(0, 0.5, 0);
  parts.push(paint(stalk, 0x4a3a18, 0x7a6a28));
  for (let i = 0; i < 16; i++) {
    const y = 0.06 + (i / 16) * 0.92;
    const len = 0.09 + rnd() * 0.05;
    const g = new THREE.PlaneGeometry(0.026, len, 1, 3);
    g.translate(0, len / 2, 0);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const yy = p.getY(k); p.setZ(k, yy * yy * 3); }
    g.rotateX(-0.6);
    g.rotateY((i % 2) * Math.PI + rnd() * 0.6);
    g.translate(0, y, 0);
    g.computeVertexNormals();
    parts.push(paint(g, 0x5a6a20, 0xa8a840));
    if (i % 4 === 1) {
      const b = new THREE.SphereGeometry(0.012, 5, 4);
      b.translate(0.008, y, 0);
      parts.push(paint(b, 0xc8a840));
    }
  }
  return merged(parts);
}

export function rock(seed = 8, flat = 0.7) {
  const g = new THREE.IcosahedronGeometry(0.5, 2);
  displace(g, 0.22, 2.1, seed, flat);
  g.translate(0, 0.15, 0);
  return paint(g, 0x6a6660, 0x8c867c);
}

export function glowPlant(seed = 9) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const h = 0.4 + rnd() * 0.6;
    const dir = new THREE.Vector3((rnd() - 0.5) * 0.6, 1, (rnd() - 0.5) * 0.6).normalize();
    const s = new THREE.CylinderGeometry(0.012, 0.025, h, 4, 3, true);
    s.translate(0, h / 2, 0);
    parts.push(paint(orientTo(s, dir, new THREE.Vector3()), 0x202838, 0x30405a));
    const bulb = new THREE.SphereGeometry(0.05 + rnd() * 0.03, 7, 5);
    bulb.scale(1, 1.5, 1);
    const tip = dir.clone().multiplyScalar(h);
    bulb.translate(tip.x, tip.y, tip.z);
    parts.push(paint(bulb, 0xffffff, 0xffffff, 1.0));
  }
  return merged(parts);
}

export function crystal(seed = 10) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const h = 0.5 + rnd() * 1.1;
    const g = new THREE.OctahedronGeometry(0.16, 0);
    g.scale(0.7 + rnd() * 0.4, h * 2.6, 0.7 + rnd() * 0.4);
    g.translate(0, h * 0.35, 0);
    const dir = new THREE.Vector3((rnd() - 0.5) * 1.2, 1, (rnd() - 0.5) * 1.2).normalize();
    parts.push(paint(orientTo(g, dir, new THREE.Vector3((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3)), 0xffffff, 0xffffff, (f) => 0.4 + 0.6 * f));
  }
  return merged(parts);
}

export function tubeWorms(seed = 11) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 14; i++) {
    const h = 0.5 + rnd() * 1.1;
    const x = (rnd() - 0.5) * 0.7, z = (rnd() - 0.5) * 0.7;
    const t = new THREE.CylinderGeometry(0.025, 0.035, h, 6, 1, true);
    t.translate(x, h / 2, z);
    parts.push(paint(t, 0x8a8478, 0xe8e4d8));
    const plume = new THREE.SphereGeometry(0.05, 6, 5);
    plume.scale(1, 1.4, 1);
    plume.translate(x, h + 0.04, z);
    parts.push(paint(plume, 0xd8202a, 0xff4040, 0.35));
  }
  return merged(parts);
}

// ---------- land ----------
// Feathered frond: arched spine along +x with paired leaflets drooping off both sides.
function frond(len, rnd, droop = 0.18, n = 14) {
  const v = [], idx = [];
  const spineY = (x) => 0.35 * x - droop * x * x;
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * len, y = spineY(x), dx = len / n;
    const L = (0.15 + 0.85 * Math.sin((x / len) * Math.PI * 0.92 + 0.15)) * len * 0.3;
    for (const s of [-1, 1]) {
      const b = v.length / 3;
      const tipX = x + L * 0.45, tipY = y - L * (0.45 + rnd() * 0.25), tipZ = s * L;
      v.push(x - dx * 0.45, y, 0, x + dx * 0.45, spineY(x + dx * 0.45), 0, tipX + dx * 0.2, tipY, tipZ, tipX - dx * 0.2, tipY - 0.02, tipZ * 0.97);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  // spine
  const b = v.length / 3;
  const ns = Math.min(8, n);
  for (let i = 0; i <= ns; i++) { const x = (i / ns) * len; v.push(x, spineY(x) + 0.02, -0.025, x, spineY(x) + 0.02, 0.025); }
  for (let i = 0; i < ns; i++) idx.push(b + i * 2, b + i * 2 + 1, b + i * 2 + 2, b + i * 2 + 1, b + i * 2 + 3, b + i * 2 + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Palm: curved ringed trunk with a crown of feathered fronds. H = height, bend = lean of the crown.
// lo: false = full, true = reduced (Low preset), 2 = far LOD
export function palm(seed = 12, H = 6.5, bend = 1, nFronds = 11, lo = false) {
  const rnd = mulberry32(seed);
  const parts = [];
  const lean = new THREE.Vector3((0.7 + rnd() * 0.6) * bend * (H / 6.5), 0, 0);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean.x * 0.2, H * 0.55, 0), new THREE.Vector3(lean.x, H, 0));
  const trunk = new THREE.TubeGeometry(curve, lo === 2 ? 4 : lo ? 6 : 10, 0.16, lo === 2 ? 4 : lo ? 5 : 6, false);
  // taper
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = y / H;
    const c = curve.getPoint(Math.min(Math.max(t, 0), 1));
    const s = 1.25 - 0.45 * t + 0.08 * Math.sin(y * 9);
    p.setXYZ(i, c.x + (p.getX(i) - c.x) * s, y, c.z + (p.getZ(i) - c.z) * s);
  }
  trunk.computeVertexNormals();
  parts.push(paint(trunk, 0x5a4630, 0x8a7050));
  const top = curve.getPoint(1);
  for (let f = 0; f < nFronds; f++) {
    const a = (f / nFronds) * Math.PI * 2 + rnd() * 0.35;
    const len = (2.4 + rnd() * 1.0) * Math.min(1.2, 0.55 + H / 14);
    const g = frond(len, rnd, 0.14 + rnd() * 0.1 + (f % 3 === 0 ? 0.08 : 0), lo === 2 ? 4 : lo ? 8 : 14);
    g.rotateZ(f % 2 ? 0.25 : -0.05); // some fronds point up, some hang
    g.rotateY(a);
    g.translate(top.x, top.y, top.z);
    parts.push(paint(g, f % 4 === 0 ? 0x5a6a20 : 0x2a5214, f % 4 === 0 ? 0x9a9a40 : 0x5e9028));
  }
  for (let c = 0; c < 3; c++) {
    const s = new THREE.SphereGeometry(0.15, lo ? 4 : 6, lo ? 3 : 5);
    s.translate(top.x + Math.cos(c * 2.1) * 0.2, top.y - 0.2, top.z + Math.sin(c * 2.1) * 0.2);
    parts.push(paint(s, 0x4a3a18));
  }
  return merged(parts);
}

export function bush(seed = 13, lo = false) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.IcosahedronGeometry(0.45 + rnd() * 0.25, lo ? 0 : 1);
    displace(g, 0.12, 3, seed + i);
    g.translate((rnd() - 0.5) * 0.8, 0.35 + rnd() * 0.3, (rnd() - 0.5) * 0.8);
    parts.push(paint(g, 0x24401a, 0x4a7428));
  }
  return merged(parts);
}

export function fern(seed = 14) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 8; i++) {
    const len = 0.8 + rnd() * 0.4;
    const g = new THREE.PlaneGeometry(len, 0.22, 6, 1);
    const q = g.attributes.position;
    for (let k = 0; k < q.count; k++) {
      const x = q.getX(k) + len / 2, y = q.getY(k);
      const w = Math.sin((x / len) * Math.PI);
      q.setXYZ(k, x, 0.9 * x - 0.75 * x * x, y * w);
    }
    g.rotateY((i / 8) * Math.PI * 2 + rnd() * 0.4);
    g.computeVertexNormals();
    parts.push(paint(g, 0x1e3a12, 0x4e7a24));
  }
  return merged(parts);
}

export function flowers(seed = 15) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const h = 0.25 + rnd() * 0.3;
    const x = (rnd() - 0.5) * 0.5, z = (rnd() - 0.5) * 0.5;
    const s = new THREE.CylinderGeometry(0.008, 0.01, h, 3);
    s.translate(x, h / 2, z);
    parts.push(paint(s, 0x3a5a1a));
    const head = new THREE.IcosahedronGeometry(0.05, 0);
    head.scale(1, 0.5, 1);
    head.translate(x, h, z);
    parts.push(paint(head, 0xffffff));
  }
  return merged(parts);
}

export function pine(seed = 16) {
  const rnd = mulberry32(seed);
  const parts = [];
  const t = new THREE.CylinderGeometry(0.1, 0.2, 2, 6);
  t.translate(0, 1, 0);
  parts.push(paint(t, 0x3a2a1a, 0x4a3a22));
  for (let i = 0; i < 4; i++) {
    const r = 1.5 - i * 0.32, h = 1.5;
    const c = new THREE.ConeGeometry(r, h, 8, 1);
    displace(c, 0.08, 2, seed + i);
    c.translate(0, 1.4 + i * 0.85 + h / 2, 0);
    c.rotateY(rnd());
    parts.push(paint(c, 0x183018, 0x2e5228));
  }
  return merged(parts);
}

export function deadTree(seed = 17) {
  const rnd = mulberry32(seed);
  const parts = [];
  const br = (base, dir, len, rad, depth) => {
    const g = new THREE.CylinderGeometry(rad * 0.65, rad, len, 5, 1, true);
    g.translate(0, len / 2, 0);
    parts.push(paint(orientTo(g, dir, base), 0x1e1a18, 0x2e2622));
    if (depth > 0) {
      const tip = base.clone().addScaledVector(dir, len);
      for (let k = 0; k < 2; k++) {
        const nd = dir.clone().add(new THREE.Vector3(rnd() - 0.5, 0.1, rnd() - 0.5).multiplyScalar(1.4)).normalize();
        br(tip, nd, len * 0.7, rad * 0.65, depth - 1);
      }
    }
  };
  br(new THREE.Vector3(), new THREE.Vector3(0.1, 1, 0).normalize(), 2.2, 0.2, 3);
  return merged(parts);
}

// ---------- reef additions ----------
// Staghorn: thin antler branches forking at shallow angles from a few base stems
export function staghornCoral(seed = 21, lo = false) {
  const rnd = mulberry32(seed);
  const parts = [];
  const br = (base, dir, len, rad, depth) => {
    const g = new THREE.CylinderGeometry(rad * 0.78, rad, len, lo ? 3 : 5, 1, true);
    g.translate(0, len / 2, 0);
    parts.push(paint(orientTo(g, dir, base), 0xffffff));
    const tip = base.clone().addScaledVector(dir, len);
    if (depth > 0) {
      const n = rnd() < 0.3 ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const nd = dir.clone().add(new THREE.Vector3(rnd() - 0.5, rnd() * 0.35, rnd() - 0.5).multiplyScalar(0.95)).normalize();
        br(tip, nd, len * (0.78 + rnd() * 0.3), rad * 0.82, depth - 1);
      }
    } else {
      const s = new THREE.SphereGeometry(rad * 0.85, lo ? 3 : 4, lo ? 2 : 3);
      s.translate(tip.x, tip.y, tip.z);
      parts.push(paint(s, 0xffffff));
    }
  };
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rnd();
    const dir = new THREE.Vector3(Math.cos(a) * (0.5 + rnd() * 0.5), 1, Math.sin(a) * (0.5 + rnd() * 0.5)).normalize();
    br(new THREE.Vector3(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1), dir, 0.26 + rnd() * 0.12, 0.035, 3);
  }
  return paint(merged(parts), 0x6a5a4a, 0xffffff);
}

// Mushroom coral: a low disc with radial septa
export function mushroomCoral(lo = false) {
  const g = new THREE.SphereGeometry(0.5, lo ? 24 : 48, lo ? 4 : 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i), a = Math.atan2(z, x), r = Math.hypot(x, z);
    const sep = Math.abs(Math.sin(a * 24)) * 0.035 * Math.min(1, r * 3);
    p.setXYZ(i, x * (1 + 0.06 * Math.sin(a * 3)), y * 0.22 + sep, z);
  }
  g.computeVertexNormals();
  return paint(g, 0x8a7060, 0xfff0e0);
}

// Soft coral: fleshy stalks topped with lumpy polyp heads
export function softCoral(seed = 23, lo = false) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const h = 0.25 + rnd() * 0.45;
    const dir = new THREE.Vector3((rnd() - 0.5) * 0.8, 1, (rnd() - 0.5) * 0.8).normalize();
    const base = new THREE.Vector3((rnd() - 0.5) * 0.2, 0, (rnd() - 0.5) * 0.2);
    const s = new THREE.CylinderGeometry(0.045, 0.075, h, lo ? 4 : 6, lo ? 1 : 2, true);
    s.translate(0, h / 2, 0);
    parts.push(paint(orientTo(s, dir, base), 0xffffff));
    const head = new THREE.IcosahedronGeometry(0.09 + rnd() * 0.06, lo ? 0 : 1);
    displace(head, 0.05, 14, seed + i);
    const tip = base.clone().addScaledVector(dir, h);
    head.translate(tip.x, tip.y + 0.04, tip.z);
    parts.push(paint(head, 0xffffff));
  }
  return paint(merged(parts), 0x9a8080, 0xffffff, (f) => 0.12 * f * f);
}

// Barrel / vase sponge: ridged lathe with a dark open throat
export function barrelSponge(seed = 24) {
  const pr = [[0.12, 0], [0.22, 0.08], [0.3, 0.3], [0.34, 0.55], [0.32, 0.72], [0.27, 0.74], [0.24, 0.6], [0.18, 0.25], [0.02, 0.18]];
  const g = new THREE.LatheGeometry(pr.map(([r, y]) => new THREE.Vector2(r, y)), 16);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x);
    const k = 1 + 0.07 * Math.sin(a * 9) + 0.05 * Math.sin(a * 2 + seed);
    p.setXYZ(i, x * k, p.getY(i), z * k);
  }
  g.computeVertexNormals();
  paint(g, 0x5a3a2a, 0xffffff);
  // darken the throat: the inner wall is the second half of the profile
  const col = g.attributes.color, segs = pr.length;
  for (let i = 0; i < p.count; i++) if (i % segs >= 6) col.setXYZ(i, col.getX(i) * 0.3, col.getY(i) * 0.25, col.getZ(i) * 0.25);
  return g;
}

export function urchin() {
  const parts = [];
  const body = new THREE.SphereGeometry(0.1, 10, 6);
  body.scale(1, 0.7, 1);
  parts.push(paint(body, 0x1a1018, 0x3a2838));
  const rnd = mulberry32(51);
  for (let i = 0; i < 46; i++) {
    const dir = new THREE.Vector3(rnd() - 0.5, rnd() * 0.9 - 0.1, rnd() - 0.5).normalize();
    const len = 0.12 + rnd() * 0.14;
    const c = new THREE.ConeGeometry(0.008, len, 3);
    c.translate(0, len / 2, 0);
    parts.push(paint(orientTo(c, dir, dir.clone().multiplyScalar(0.07)), 0x2a1a2a, 0x8a6a90));
  }
  const g = merged(parts);
  g.translate(0, 0.05, 0);
  return g;
}

export function starfish(seed = 52) {
  const rnd = mulberry32(seed);
  const shape = new THREE.Shape();
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2, r = i % 2 ? 0.045 : 0.16 + rnd() * 0.02;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 1, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getZ(i)); p.setY(i, p.getY(i) - r * r * 0.6 + 0.03); }
  g.computeVertexNormals();
  return paint(g, 0xa0a0a0, 0xffffff);
}

// Scallop-like shell lying on the sand
export function shell() {
  const g = new THREE.CircleGeometry(0.1, 16, 0, Math.PI);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z), a = Math.atan2(z, x);
    p.setY(i, 0.012 + (0.1 - r) * 0.22 + Math.abs(Math.sin(a * 8)) * 0.006);
  }
  g.computeVertexNormals();
  return paint(g, 0xc8b8a8, 0xffffff);
}

export function seaCucumber() {
  const g = new THREE.CapsuleGeometry(0.05, 0.28, 3, 8);
  g.rotateZ(Math.PI / 2);
  displace(g, 0.015, 30, 7, 0.75);
  g.translate(0, 0.04, 0);
  return paint(g, 0x705848, 0xd0b8a0);
}

// Small crab, ~0.25 m across; the material scuttles it sideways
export function crab() {
  const parts = [];
  const body = new THREE.SphereGeometry(0.07, 10, 6);
  body.scale(1.3, 0.45, 1);
  body.translate(0, 0.06, 0);
  parts.push(paint(body, 0x8a5a4a, 0xffffff));
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = -0.04 + i * 0.026;
      const l = new THREE.CylinderGeometry(0.006, 0.008, 0.11, 3);
      l.translate(0, 0.055, 0);
      parts.push(paint(orientTo(l, new THREE.Vector3(s * 0.9, -0.55, (z - 0.01) * 4), new THREE.Vector3(s * 0.07, 0.07, z)), 0xb07858));
    }
    const claw = new THREE.SphereGeometry(0.025, 6, 4);
    claw.scale(1, 0.7, 1.5);
    claw.translate(s * 0.07, 0.07, 0.085);
    parts.push(paint(claw, 0xffffff));
  }
  for (const s of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.008, 4, 3);
    e.translate(s * 0.022, 0.1, 0.055);
    parts.push(paint(e, 0x101010));
  }
  return merged(parts);
}

// Bleached coral rubble: broken branch pieces and chips
export function rubble(seed = 53) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const l = 0.1 + rnd() * 0.18;
    const c = new THREE.CylinderGeometry(0.018, 0.024, l, 5);
    c.rotateZ(Math.PI / 2 + (rnd() - 0.5) * 0.4);
    c.rotateY(rnd() * Math.PI);
    c.translate((rnd() - 0.5) * 0.6, 0.015, (rnd() - 0.5) * 0.6);
    parts.push(paint(c, 0xd8d0c0));
  }
  for (let i = 0; i < 5; i++) {
    const c = new THREE.IcosahedronGeometry(0.04 + rnd() * 0.04, 0);
    c.scale(1, 0.5, 1);
    c.translate((rnd() - 0.5) * 0.6, 0.01, (rnd() - 0.5) * 0.6);
    parts.push(paint(c, 0xc8c0b0));
  }
  return merged(parts);
}

export function barnacles(seed = 54) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 16; i++) {
    const r = 0.015 + rnd() * 0.02, x = (rnd() - 0.5) * 0.4, z = (rnd() - 0.5) * 0.4;
    const c = new THREE.CylinderGeometry(r * 0.45, r, r * 1.2, 6, 1, true);
    c.translate(x, r * 0.6, z);
    parts.push(paint(c, 0x9a958a, 0xe0dcd0));
    const cap = new THREE.CircleGeometry(r * 0.45, 6);
    cap.rotateX(-Math.PI / 2);
    cap.translate(x, r * 1.2, z);
    parts.push(paint(cap, 0x2a2622));
  }
  return merged(parts);
}

// Giant kelp: unit-height stipe with ruffled blades and gas bladders, plus a floating crown.
// Instances scale y to the water depth and xz by ~5 for blade width.
export function kelp(seed = 31) {
  const rnd = mulberry32(seed);
  const parts = [];
  const stalk = new THREE.CylinderGeometry(0.004, 0.007, 1, 4, 16, true);
  stalk.translate(0, 0.5, 0);
  parts.push(paint(stalk, 0x3a2a10, 0x6a5420));
  const nb = 22;
  for (let i = 0; i < nb; i++) {
    const y = 0.04 + (i / nb) * 0.9;
    const len = 0.06 + rnd() * 0.035, w = 0.05 + rnd() * 0.025;
    const g = new THREE.PlaneGeometry(w, len, 2, 4);
    g.translate(0, len / 2, 0);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const yy = p.getY(k), xx = p.getX(k);
      p.setXYZ(k, xx * Math.sin(((yy / len) * 0.85 + 0.12) * Math.PI), yy, yy * yy * 4 + Math.sin(xx * 120 + yy * 90) * 0.004);
    }
    g.rotateX(-0.35 - rnd() * 0.3);
    g.rotateY(i * 2.4 + rnd() * 0.5);
    g.translate(0, y, 0);
    g.computeVertexNormals();
    parts.push(paint(g, 0x4a4a14, 0xa09a3a));
    const b = new THREE.SphereGeometry(0.009, 5, 3);
    b.scale(1, 0.4, 1);
    b.translate(0, y, 0);
    parts.push(paint(b, 0xb09030));
  }
  for (let i = 0; i < 5; i++) { // canopy blades trailing along the surface
    const len = 0.08 + rnd() * 0.04;
    const g = new THREE.PlaneGeometry(0.06, len, 2, 3);
    g.translate(0, len / 2, 0);
    g.rotateX(-1.35);
    g.rotateY((i / 5) * Math.PI * 2);
    g.translate(0, 0.98, 0);
    g.computeVertexNormals();
    parts.push(paint(g, 0x6a6420, 0xb0a840));
  }
  return merged(parts);
}

// ---------- island additions ----------
// Broadleaf tree: buttressed trunk, a few limbs, a clumped canopy and hanging vines. ~7 m tall.
export function broadleafTree(seed = 41, lod = false) {
  const rnd = mulberry32(seed);
  const parts = [];
  const H = 5 + rnd() * 1.5;
  const trunk = new THREE.CylinderGeometry(0.22, 0.4, H, lod ? 5 : 8, lod ? 1 : 5, true);
  trunk.translate(0, H / 2, 0);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i));
    const flare = 1 + 1.4 * Math.max(0, 0.9 - y) ** 2 * (0.6 + 0.4 * Math.abs(Math.sin(a * 2.5)));
    p.setXYZ(i, p.getX(i) * flare + Math.sin(y * 0.6) * 0.15, y, p.getZ(i) * flare);
  }
  trunk.computeVertexNormals();
  parts.push(paint(trunk, 0x3a2e22, 0x6a5a44));
  const top = new THREE.Vector3(0.15 * Math.sin(H * 0.6), H, 0);
  const tips = [top.clone().add(new THREE.Vector3(0, 1.6, 0))];
  const mids = [];
  const nl = 4;
  for (let i = 0; i < nl; i++) {
    const a = (i / nl) * Math.PI * 2 + rnd() * 0.8;
    const dir = new THREE.Vector3(Math.cos(a), 0.75 + rnd() * 0.4, Math.sin(a)).normalize();
    const len = 2 + rnd() * 1.2;
    const base = top.clone().add(new THREE.Vector3(0, -0.8 - rnd() * 1.2, 0));
    const l = new THREE.CylinderGeometry(0.08, 0.16, len, 5, 1, true);
    l.translate(0, len / 2, 0);
    parts.push(paint(orientTo(l, dir, base), 0x3a2e22, 0x5a4a38));
    tips.push(base.clone().addScaledVector(dir, len));
    mids.push(base.clone().addScaledVector(dir, len * 0.45).add(new THREE.Vector3(0, -0.3, 0)));
  }
  // crown: big clumps on the limb tips, smaller ones lower in the crown so the silhouette is rounded, not an umbrella
  for (const [list, r0, sq] of [[tips, 1.6, 0.8], [mids, 1.1, 0.9]]) for (const t of list) {
    const r = r0 + rnd() * 0.9;
    const c = new THREE.IcosahedronGeometry(r, lod ? 0 : 1);
    if (!lod) displace(c, 0.45, 0.9, seed + t.x);
    c.scale(1, sq, 1);
    c.translate(t.x, t.y + 0.4, t.z);
    parts.push(paint(c, 0x34601f, 0x86b84a));
  }
  if (!lod) for (let i = 0; i < 7; i++) {
    const t = tips[1 + (i % nl)];
    const len = 1.5 + rnd() * 2.5;
    const g = new THREE.PlaneGeometry(0.07, len, 1, 4);
    g.translate((rnd() - 0.5) * 1.6, t.y - len / 2 - 0.3, 0);
    g.rotateY(rnd() * Math.PI);
    g.translate(t.x, 0, t.z);
    parts.push(paint(g, 0x2a4418, 0x3a5a20));
  }
  return merged(parts);
}

// Elephant-ear / banana-like understory: big drooping leaves on stalks
export function bigLeafPlant(seed = 42) {
  const rnd = mulberry32(seed);
  const parts = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5;
    const h = 0.6 + rnd() * 0.7;
    const dir = new THREE.Vector3(Math.cos(a) * 0.45, 1, Math.sin(a) * 0.45).normalize();
    const s = new THREE.CylinderGeometry(0.015, 0.03, h, 4);
    s.translate(0, h / 2, 0);
    parts.push(paint(orientTo(s, dir, new THREE.Vector3()), 0x3a5a1e, 0x5a7a2a));
    const L = 0.8 + rnd() * 0.5, W = L * 0.6;
    const g = new THREE.PlaneGeometry(L, W, 5, 2);
    const q = g.attributes.position;
    for (let k = 0; k < q.count; k++) {
      const x = q.getX(k) + L / 2, y = q.getY(k);
      const w = Math.sin(Math.min(1, (x / L) * 1.15) * Math.PI) * 0.85 + 0.15;
      q.setXYZ(k, x, 0.25 * x - 0.45 * x * x + Math.abs(y) * 0.35, y * w);
    }
    g.computeVertexNormals();
    g.rotateY(-a);
    const tip = dir.clone().multiplyScalar(h);
    g.translate(tip.x, tip.y, tip.z);
    parts.push(paint(g, 0x1e4212, 0x4c8a28));
  }
  return merged(parts);
}

// Beach grass: tall arching blades in a tan-green clump
export function beachGrass(seed = 43) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 16; i++) {
    const h = 0.4 + rnd() * 0.55;
    const g = new THREE.PlaneGeometry(0.035, h, 1, 4);
    g.translate(0, h / 2, 0);
    const p = g.attributes.position;
    const bend = 0.25 + rnd() * 0.45;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setXYZ(k, p.getX(k) * (1 - (y / h) * 0.8), y, bend * y * y); }
    g.rotateY(rnd() * Math.PI * 2);
    g.translate((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3);
    g.computeVertexNormals();
    parts.push(paint(g, 0x5a6a2a, 0xd0c890));
  }
  return merged(parts);
}

export function driftwood(seed = 44) {
  const rnd = mulberry32(seed);
  const parts = [];
  const log = new THREE.CylinderGeometry(0.12, 0.17, 2.4, 7, 6);
  displace(log, 0.05, 3, seed, 1);
  log.rotateZ(Math.PI / 2);
  log.translate(0, 0.12, 0);
  parts.push(paint(log, 0x8a8278, 0xc8c0b0));
  for (let i = 0; i < 3; i++) {
    const l = 0.4 + rnd() * 0.5;
    const b = new THREE.CylinderGeometry(0.03, 0.06, l, 5);
    b.translate(0, l / 2, 0);
    const x = (rnd() - 0.5) * 1.8;
    parts.push(paint(orientTo(b, new THREE.Vector3(rnd() - 0.5, 0.6, rnd() > 0.5 ? 1 : -1), new THREE.Vector3(x, 0.15, 0)), 0x9a9288, 0xc8c0b0));
  }
  const root = new THREE.IcosahedronGeometry(0.3, 1);
  displace(root, 0.15, 4, seed + 3);
  root.translate(1.25, 0.18, 0);
  parts.push(paint(root, 0x7a7268, 0xb8b0a0));
  return merged(parts);
}

// Hibiscus-like shrub: leafy mound dotted with flowers
export function floweringShrub(seed = 45, lo = false) {
  const rnd = mulberry32(seed);
  const parts = [];
  const blobs = [];
  for (let i = 0; i < 5; i++) {
    const r = 0.4 + rnd() * 0.25;
    const g = new THREE.IcosahedronGeometry(r, lo ? 0 : 1);
    displace(g, 0.14, 3, seed + i);
    const c = new THREE.Vector3((rnd() - 0.5) * 0.9, 0.35 + rnd() * 0.35, (rnd() - 0.5) * 0.9);
    g.translate(c.x, c.y, c.z);
    blobs.push([c, r]);
    parts.push(paint(g, 0x1c3a14, 0x3e6a24));
  }
  for (let i = 0; i < 18; i++) {
    const [c, r] = blobs[i % blobs.length];
    const d = new THREE.Vector3(rnd() - 0.5, rnd() * 0.8 + 0.1, rnd() - 0.5).normalize();
    const f = new THREE.IcosahedronGeometry(0.07, 0);
    f.scale(1, 0.55, 1);
    f.translate(c.x + d.x * r, c.y + d.y * r, c.z + d.z * r);
    parts.push(paint(f, i % 3 ? 0xe0405a : 0xf09a3a));
  }
  return merged(parts);
}
