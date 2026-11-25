// Procedural plant / coral / rock geometries. Every geometry carries position, normal, color and aGlow
// so they can be merged and instanced with one material per type.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, createNoise } from './noise.js';
import { leafUV } from '../fx/textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const N3 = createNoise(424242);

function paint(geo, c0, c1 = c0, glow = 0, yRange = null) {
  if (geo.index === null) {
    const idx = [];
    for (let i = 0; i < geo.attributes.position.count; i++) idx.push(i);
    geo.setIndex(idx);
  }
  if (!geo.userData.cards) geo.deleteAttribute('uv'); // leaf cards keep their atlas uv
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
  // parts without atlas uv (wood, cores) get uv -1: clamped onto the atlas's opaque white corner
  if (parts.some((p) => p.attributes.uv)) for (const p of parts) if (!p.attributes.uv) p.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.attributes.position.count * 2).fill(-1), 2));
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

// Foliage clump: a dark inner core wrapped in a shell of curved leaf-spray cards (alpha-cut atlas tiles, see
// textures.js getLeafTexture), so the silhouette breaks into real leaf shapes. Card normals blend toward the clump's
// sphere normal so the canopy shades as one soft volume. tile: atlas tile; lod: fewer, larger flat cards for far trees.
function leafClump(c, r, n, rnd, c0, c1, opt = {}) {
  const { size = 0.32, sq = 1, core = 0.7, coreCol = c0, tile = 0, lod = false } = opt;
  const pos = [], nrm = [], col = [], uv = [], idx = [];
  const A = new THREE.Color(c0), B = new THREE.Color(c1), t = new THREE.Color();
  const d = new THREE.Vector3(), q = new THREE.Vector3(), X = new THREE.Vector3(), N = new THREE.Vector3(), Z = new THREE.Vector3();
  const w = new THREE.Vector3(), s = new THREE.Vector3();
  const so = c.x * 1.7 + c.z * 0.9; // per-clump noise offset: each clump gets its own lobes
  const nc = Math.max(4, Math.round(n * (lod ? 0.2 : 0.5))); // each card carries 5-20 leaves
  const rows = lod ? [0, 1] : [0, 0.5, 1];
  for (let i = 0; i < nc; i++) {
    const yv = 1 - 1.75 * ((i + 0.5) / nc), rr = Math.sqrt(Math.max(0, 1 - yv * yv)), ph = i * 2.39996 + rnd() * 1.4;
    d.set(Math.cos(ph) * rr + (rnd() - 0.5) * 0.25, yv + (rnd() - 0.5) * 0.2, Math.sin(ph) * rr + (rnd() - 0.5) * 0.25).normalize();
    // lobed outline (sub-clusters and gaps instead of a sphere) and cards rooted at varied depth inside it
    const lobe = 0.8 + 0.5 * N3.fbm3(d.x * 1.6 + so, d.y * 1.6, d.z * 1.6 - so, 2);
    const depth = rnd() < 0.25 ? 0.35 + rnd() * 0.3 : 0.62 + rnd() * 0.3;
    q.copy(d).multiplyScalar(r * lobe * depth);
    q.y *= sq;
    q.add(c);
    X.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5);
    X.addScaledVector(d, -X.dot(d)).normalize().addScaledVector(d, 0.35 + rnd() * 0.5).add(s.set(0, -0.1 - rnd() * 0.3, 0)).normalize();
    N.copy(d).addScaledVector(X, -d.dot(X)).normalize();
    Z.crossVectors(X, N);
    const L = r * size * (0.7 + rnd() * 0.6) * (lod ? 3.2 : 2.2), W = L * (0.75 + rnd() * 0.3);
    const arch = (0.08 + rnd() * 0.2) * L, droop = (0.15 + rnd() * 0.35) * L, twist = (rnd() - 0.5) * 0.5, flip = rnd() < 0.5;
    const f = Math.min(1, Math.max(0, 0.45 + 0.4 * d.y + 0.25 * (rnd() - 0.5)));
    t.copy(A).lerp(B, f).multiplyScalar((0.85 + rnd() * 0.3) * (depth < 0.6 ? 0.7 : 1)); // inner sprays sit in their own shade
    const b = pos.length / 3;
    for (const l of rows) {
      const ly = arch * l - droop * l * l, k = 0.74 + 0.4 * l; // spray arches out then droops; base in shade, tip lit
      for (const side of [0, 1]) {
        const lz = (side - 0.5) * W * (0.8 + 0.25 * l);
        w.copy(q).addScaledVector(X, l * L).addScaledVector(N, ly + lz * twist * l).addScaledVector(Z, lz);
        pos.push(w.x, w.y, w.z);
        s.copy(w).sub(c);
        s.y /= sq;
        s.normalize().multiplyScalar(0.7).addScaledVector(N, 0.3).normalize();
        nrm.push(s.x, s.y, s.z);
        col.push(t.r * k, t.g * k, t.b * k);
        uv.push(...leafUV(tile, l, flip ? 1 - side : side));
      }
    }
    for (let j = 0; j < rows.length - 1; j++) { const o = b + j * 2; idx.push(o, o + 1, o + 3, o, o + 3, o + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.userData.cards = true;
  paint(g, 0xffffff);
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const k = new THREE.IcosahedronGeometry(r * core, lod ? 0 : 1);
  displace(k, r * 0.2, 1.6 / r, c.x + c.z);
  k.scale(1, sq, 1);
  k.translate(c.x, c.y, c.z);
  const kc = new THREE.Color(coreCol).multiplyScalar(0.55);
  return [g, paint(k, kc.getHex(), coreCol)];
}

// Wood along a smooth curve. radius(t, angle, point) -> [radius, darken]; darken goes into the vertex colour
// (bark furrows, root crotches) so the bark reads without a texture.
function branchTube(pts, radius, radial, segs, c0, c1) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const p = g.attributes.position, nr = g.attributes.normal, n = new THREE.Vector3(), c = new THREE.Vector3();
  const dark = new Float32Array(p.count);
  for (let i = 0; i <= segs; i++) {
    curve.getPointAt(i / segs, c);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      n.fromBufferAttribute(nr, k);
      const [r, dk] = radius(i / segs, Math.atan2(n.z, n.x), c);
      p.setXYZ(k, c.x + n.x * r, c.y + n.y * r, c.z + n.z * r);
      dark[k] = dk;
    }
  }
  g.computeVertexNormals();
  paint(g, c0, c1);
  const col = g.attributes.color;
  for (let k = 0; k < col.count; k++) col.setXYZ(k, col.getX(k) * (1 - dark[k]), col.getY(k) * (1 - dark[k]), col.getZ(k) * (1 - dark[k]));
  return g;
}

// ---------- underwater ----------
export function branchCoral(seed = 1, lo = false) {
  const rnd = mulberry32(seed);
  const parts = [];
  const br = (base, dir, len, rad, depth) => {
    const g = new THREE.CylinderGeometry(rad * 0.7, rad, len, lo ? 3 : 7, 1, depth > 0);
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
      const s = new THREE.SphereGeometry(rad * 0.85, lo ? 3 : 7, lo ? 2 : 5);
      s.translate(tip.x, tip.y, tip.z);
      parts.push(paint(s, 0xffffff));
    }
  };
  br(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 0.32, 0.07, 3);
  const g = merged(parts);
  return paint(g, 0x6a5a66, 0xffffff, (f) => f * f * 0.0);
}

// Brain coral: a lumpy dome covered in meandering ridges with narrow dark grooves between them
export function brainCoral(lo = false) {
  let g = new THREE.SphereGeometry(0.5, lo ? 18 : 64, lo ? 9 : 32, 0, Math.PI * 2, 0, Math.PI * 0.55);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g); // weld the seam so the ridges shade continuously
  const p = g.attributes.position;
  const v = new THREE.Vector3(), H = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const lump = 1 + 0.12 * N3.fbm3(v.x * 2.2 + 7, v.y * 2.2, v.z * 2.2, 3);
    const warp = N3.n3(v.x * 1.8, v.y * 1.8, v.z * 1.8) * 1.4 + N3.n3(v.x * 5 + 3, v.y * 5, v.z * 5) * 0.3;
    const ridge = lo ? 0.7 : Math.sqrt(Math.abs(Math.sin(warp * 4.2))); // rounded crests, V-shaped grooves
    H[i] = ridge;
    v.multiplyScalar(lump * (1 + 0.05 * ridge));
    p.setXYZ(i, v.x, v.y * 0.75 - 0.05, v.z);
  }
  g.computeVertexNormals();
  paint(g, 0x8a7a60, 0xfff2d8);
  const c = g.attributes.color;
  for (let i = 0; i < c.count; i++) { const k = 0.5 + 0.5 * H[i]; c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k); }
  return g;
}

export function fanCoral(seed = 2, lo = false) {
  const rnd = mulberry32(seed);
  const parts = [];
  // a fine, tapering lattice of twigs in one plane (sea fans grow broadside to the current)
  const br = (x, y, ang, len, w, depth) => {
    const g = lo ? new THREE.PlaneGeometry(w, len) : new THREE.CylinderGeometry(w * 0.36, w * 0.5, len, 4, 1, true);
    g.translate(0, len / 2, 0);
    g.rotateZ(ang);
    g.translate(x, y, (rnd() - 0.5) * 0.01);
    parts.push(paint(g, 0xffffff));
    if (depth > 0) {
      const ex = x - Math.sin(ang) * len, ey = y + Math.cos(ang) * len, k = 0.74 + rnd() * 0.1;
      br(ex, ey, ang + 0.2 + rnd() * 0.25, len * k, w * 0.74, depth - 1);
      br(ex, ey, ang - 0.2 - rnd() * 0.25, len * (1.6 - k), w * 0.74, depth - (rnd() < 0.15 ? 2 : 1));
    }
  };
  const depth = lo ? 4 : 6;
  for (const a of [-0.45, 0, 0.45]) br(0, 0, a + (rnd() - 0.5) * 0.1, 0.26 - Math.abs(a) * 0.12, 0.05, depth - (a ? 1 : 0));
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

// One table plate: polar grid with a scalloped rim, radial growth ridges, upturned edge and a darker underside
function coralPlate(R, thick, seed, S = 64, nr = 5) {
  const pos = [], col = [], idx = [];
  const rim = (a) => 1 + 0.08 * Math.sin(a * 7 + seed) + 0.05 * Math.sin(a * 13 + seed * 2) + 0.05 * N3.n2(Math.cos(a) * 2 + seed, Math.sin(a) * 2);
  const vtx = (r, a, bottom) => {
    const u = r / R, x = Math.cos(a) * r * rim(a), z = Math.sin(a) * r * rim(a);
    const y = 0.09 * u * u * R + 0.004 * Math.sin(a * 46 + seed) * u + 0.02 * Math.sin(a * 5 + seed) * u - (bottom ? thick * (1 - 0.55 * u) : 0);
    pos.push(x, y, z);
    const k = bottom ? 0.5 : 0.82 + 0.18 * u + 0.08 * Math.sin(a * 46 + seed); // pale growing edge, shaded underside
    col.push(k, k, k);
  };
  for (const bottom of [false, true]) {
    vtx(0, 0, bottom);
    for (let k = 1; k <= nr; k++) for (let j = 0; j < S; j++) vtx((R * k) / nr, (j / S) * Math.PI * 2, bottom);
  }
  const half = 1 + nr * S, ring = (k, j) => 1 + (k - 1) * S + (j % S);
  for (let h = 0; h < 2; h++) {
    const o = h * half, tri = (a, b, c) => (h ? idx.push(o + a, o + c, o + b) : idx.push(o + a, o + b, o + c));
    for (let j = 0; j < S; j++) {
      tri(0, ring(1, j + 1), ring(1, j));
      for (let k = 1; k < nr; k++) { tri(ring(k, j), ring(k, j + 1), ring(k + 1, j)); tri(ring(k, j + 1), ring(k + 1, j + 1), ring(k + 1, j)); }
    }
  }
  for (let j = 0; j < S; j++) {
    const t0 = ring(nr, j), t1 = ring(nr, j + 1);
    idx.push(t0, t1, half + t0, t1, half + t1, half + t0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  paint(g, 0xffffff);
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// Table coral: a gnarled stalk carrying two or three overlapping tiers of plates
export function tableCoral(seed = 4) {
  const rnd = mulberry32(seed);
  const parts = [];
  const stem = new THREE.CylinderGeometry(0.06, 0.14, 0.4, 9, 3);
  displace(stem, 0.025, 7, seed);
  stem.translate(0, 0.2, 0);
  parts.push(paint(stem, 0x5a4a38, 0xb0a080));
  for (const [R, y, ox, oz] of [[0.75, 0.36, 0, 0], [0.46, 0.27, 0.32, 0.18], [0.34, 0.47, -0.22, -0.14]]) {
    const pl = coralPlate(R * (0.92 + rnd() * 0.16), 0.05, seed + R * 10);
    pl.rotateY(rnd() * Math.PI * 2);
    pl.translate(ox, y, oz);
    parts.push(pl);
  }
  const g = merged(parts);
  const c = g.attributes.color, base = new THREE.Color(0xd8c8a8);
  for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * base.r, c.getY(i) * base.g, c.getZ(i) * base.b);
  return g;
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
  if (land) { // tuft: tapered blades fanning out of one crown, mostly short with a few tall, some tips dried
    for (let i = 0; i < 13; i++) {
      const h = 0.18 + rnd() * rnd() * 0.8, lean = 0.2 + rnd() * 0.5, a = rnd() * Math.PI * 2;
      const g = new THREE.PlaneGeometry(0.025 + rnd() * 0.035, h, 1, 3);
      g.translate(0, h / 2, 0);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) { const f = p.getY(k) / h; p.setX(k, p.getX(k) * (1 - 0.85 * f)); p.setZ(k, lean * h * f * f); }
      g.rotateY(a);
      g.translate(Math.sin(a) * 0.08 + (rnd() - 0.5) * 0.12, 0, Math.cos(a) * 0.08 + (rnd() - 0.5) * 0.12);
      g.computeVertexNormals();
      parts.push(paint(g, 0x34501a, rnd() < 0.2 ? 0xb8a860 : 0x9ab84a, 0, [0, 0.9]));
    }
    return merged(parts);
  }
  for (let i = 0; i < 12; i++) { // turtle grass: narrow strap blades with rounded tips
    const h = 0.4 + rnd() * 0.6;
    const g = new THREE.PlaneGeometry(0.04, h, 1, 4);
    g.translate(0, h / 2, 0);
    const p = g.attributes.position;
    const bend = (rnd() - 0.5) * 0.5;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setZ(k, bend * y * y); p.setX(k, p.getX(k) * (1 - 0.6 * Math.pow(y / h, 6))); }
    g.rotateY(rnd() * Math.PI);
    g.translate((rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.4);
    g.computeVertexNormals();
    parts.push(paint(g, 0xffffff));
  }
  const g = merged(parts);
  return paint(g, 0x3a6024, 0x9ab846);
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
  const g = new THREE.IcosahedronGeometry(0.5, 3);
  displace(g, 0.22, 2.1, seed, flat);
  // fracture planes: clip the lumpy blob into broad flat cleavage faces with crisp edges
  const rnd = mulberry32(seed * 7 + 1), p = g.attributes.position, v = new THREE.Vector3();
  const cuts = Array.from({ length: 5 }, () => [new THREE.Vector3(rnd() - 0.5, (rnd() - 0.3) * flat, rnd() - 0.5).normalize(), 0.26 + rnd() * 0.12]);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    for (const [n, d] of cuts) { const e = v.dot(n) - d; if (e > 0) v.addScaledVector(n, -e * 0.9); }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
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
// Feathered frond: arched spine along +x with paired leaflet cards drooping off both sides. Each card maps an atlas
// tile (3 palm leaflet pair, 4 fern pinna) whose alpha cuts the real leaflet outlines, and bends through a middle row.
function frond(len, rnd, droop = 0.18, n = 14, rise = 0.35, sag = 1, tile = 3, lo = false) {
  const v = [], uv = [], idx = [];
  const spineY = (x) => rise * x - droop * x * x;
  const rows = lo ? [0, 1] : [0, 0.5, 1];
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * len, y = spineY(x), dx = len / n;
    const L = (0.15 + 0.85 * Math.sin((x / len) * Math.PI * 0.92 + 0.15)) * len * 0.3;
    for (const s of [-1, 1]) {
      const b = v.length / 3;
      const tipX = x + L * 0.45, tipY = y - L * (0.45 + rnd() * 0.25) * sag, tipZ = s * L, arch = L * (0.1 + rnd() * 0.12);
      for (const l of rows) {
        const px = x + (tipX - x) * l, py = y + (tipY - y) * l * l + arch * l * (1 - l), pz = tipZ * l, hw = dx * (0.75 - 0.2 * l);
        v.push(px - hw, py, pz, px + hw, py + (spineY(x + hw) - y) * (1 - l), pz * 0.98);
        uv.push(...leafUV(tile, l, 0), ...leafUV(tile, l, 1));
      }
      for (let j = 0; j < rows.length - 1; j++) { const o = b + j * 2; idx.push(o, o + 1, o + 3, o, o + 3, o + 2); }
    }
  }
  // spine
  const b = v.length / 3;
  const ns = Math.min(8, n);
  for (let i = 0; i <= ns; i++) { const x = (i / ns) * len; v.push(x, spineY(x) + 0.02, -0.025, x, spineY(x) + 0.02, 0.025); uv.push(-1, -1, -1, -1); }
  for (let i = 0; i < ns; i++) idx.push(b + i * 2, b + i * 2 + 1, b + i * 2 + 2, b + i * 2 + 1, b + i * 2 + 3, b + i * 2 + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.userData.cards = true;
  g.computeVertexNormals();
  return g;
}

// Palm: curved ringed trunk with a crown of feathered fronds and a couple of dead fronds hanging under it.
// H = height, bend = lean of the crown. lo: false = full, true = reduced (Low preset), 2 = far LOD
export function palm(seed = 12, H = 6.5, bend = 1, nFronds = 11, lo = false) {
  const rnd = mulberry32(seed);
  const parts = [];
  const lean = new THREE.Vector3((0.7 + rnd() * 0.6) * bend * (H / 6.5), 0, 0);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean.x * 0.2, H * 0.55, 0), new THREE.Vector3(lean.x, H, 0));
  const trunk = new THREE.TubeGeometry(curve, lo === 2 ? 4 : lo ? 8 : 18, 0.16, lo === 2 ? 4 : lo ? 5 : 8, false);
  // taper, a swollen bole at the foot, and leaf-scar rings
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = y / H;
    const c = curve.getPoint(Math.min(Math.max(t, 0), 1));
    const s = 1.2 - 0.4 * t + 0.6 * Math.max(0, 1 - y / 0.8) ** 2 + (lo === 2 ? 0 : 0.05 * Math.sin(y * 9));
    p.setXYZ(i, c.x + (p.getX(i) - c.x) * s, y, c.z + (p.getZ(i) - c.z) * s);
  }
  trunk.computeVertexNormals();
  parts.push(paint(trunk, 0x5a4630, 0x8a7050));
  const top = curve.getPoint(1);
  const nl = lo === 2 ? 5 : lo ? 8 : 14;
  for (let f = 0; f < nFronds; f++) {
    const a = (f / nFronds) * Math.PI * 2 + rnd() * 0.35;
    const len = (2.4 + rnd() * 1.0) * Math.min(1.2, 0.55 + H / 14);
    const g = frond(len, rnd, 0.14 + rnd() * 0.1 + (f % 3 === 0 ? 0.08 : 0), nl, 0.35, 1, 3, lo === 2);
    g.rotateZ(f % 2 ? 0.25 : -0.05); // some fronds point up, some hang
    g.rotateY(a);
    g.translate(top.x, top.y, top.z);
    parts.push(paint(g, f % 4 === 0 ? 0x5a6a20 : 0x2a5214, f % 4 === 0 ? 0x9a9a40 : 0x5e9028));
  }
  if (lo !== 2) for (let f = 0; f < 2; f++) { // dead fronds: brown, folded down against the trunk
    const g = frond(2.0 + rnd() * 0.6, rnd, 0.3, nl, 0.1, 1.4, 3, !!lo);
    g.rotateZ(-1.15 - rnd() * 0.3);
    g.rotateY(rnd() * Math.PI * 2);
    g.translate(top.x, top.y - 0.15, top.z);
    parts.push(paint(g, 0x5a4a30, 0x9a8458));
  }
  for (let c = 0; c < 3; c++) {
    const s = new THREE.SphereGeometry(0.15, lo ? 4 : 6, lo ? 3 : 5);
    s.translate(top.x + Math.cos(c * 2.1) * 0.2, top.y - 0.2, top.z + Math.sin(c * 2.1) * 0.2);
    parts.push(paint(s, 0x4a3a18));
  }
  return merged(parts);
}

// Bush / shrub crown: one dominant mass plus uneven satellites, low and spread, so it reads as a shrub not a ball
function shrubBlobs(rnd, n, r0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + rnd() * 0.9, d = i ? 0.35 + rnd() * 0.45 : rnd() * 0.15;
    const r = r0 * (i ? 0.55 + rnd() * 0.45 : 1.15 + rnd() * 0.2);
    out.push([new THREE.Vector3(Math.cos(a) * d, r * 0.55 + rnd() * 0.25, Math.sin(a) * d), r, 0.6 + rnd() * 0.3]);
  }
  return out;
}

export function bush(seed = 13, lo = false) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (const [c, r, sq] of shrubBlobs(rnd, 6, 0.55)) parts.push(...leafClump(c, r, Math.round(110 * r * r), rnd, 0x24401a, 0x5a8430, { size: 0.36, sq, tile: 2, lod: lo }));
  return merged(parts);
}

// Fern: a rosette of arching fronds, each a rachis with paired leaflets shrinking toward the tip
export function fern(seed = 14) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const len = 0.8 + rnd() * 0.4;
    const g = frond(len, rnd, 0.95 / len, 12, 1.05, 0.25, 4);
    g.scale(1, 1, 0.55);
    g.rotateY((i / 9) * Math.PI * 2 + rnd() * 0.4);
    parts.push(paint(g, 0x1e3a12, 0x4e7a24));
  }
  return merged(parts);
}

// Flowers: thin stems, a pair of leaves, and five-petal cupped blooms with a pale centre
export function flowers(seed = 15) {
  const rnd = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const h = 0.25 + rnd() * 0.3;
    const x = (rnd() - 0.5) * 0.5, z = (rnd() - 0.5) * 0.5;
    const s = new THREE.CylinderGeometry(0.008, 0.01, h, 3);
    s.translate(x, h / 2, z);
    parts.push(paint(s, 0x3a5a1a));
    for (const side of [-1, 1]) {
      const lf = new THREE.PlaneGeometry(0.09, 0.03);
      lf.translate(0.045, 0, 0);
      lf.rotateZ(0.5);
      lf.rotateY(side > 0 ? rnd() * 3 : rnd() * 3 + Math.PI);
      lf.translate(x, h * (0.25 + rnd() * 0.2), z);
      parts.push(paint(lf, 0x2e5216));
    }
    const rot = rnd() * Math.PI;
    for (let k = 0; k < 5; k++) {
      const pt = new THREE.PlaneGeometry(0.05, 0.034);
      pt.translate(0.03, 0, 0);
      pt.rotateX(-Math.PI / 2);
      pt.rotateZ(0.45); // petals cup upward
      pt.rotateY(rot + (k / 5) * Math.PI * 2);
      pt.translate(x, h, z);
      parts.push(paint(pt, 0xffffff));
    }
    const c = new THREE.IcosahedronGeometry(0.014, 0);
    c.translate(x, h + 0.008, z);
    parts.push(paint(c, 0xfff0a0));
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
    let head = new THREE.IcosahedronGeometry(0.09 + rnd() * 0.06, lo ? 1 : 3);
    head.deleteAttribute('uv');
    head.deleteAttribute('normal');
    head = mergeVertices(head); // welded so the lobes shade round, not faceted
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
// Broadleaf tree: buttressed trunk, limbs that fork, a clumped canopy of leaf-spray cards and hanging vines.
// sp shapes the species (defaults: ~6 m mid-canopy tree); see EMERGENT / UNDERSTORY. lod: far version, same crown.
export const EMERGENT = { H0: 13, Hr: 4, from: 0.72, limbs: 7, len0: 3.4, lenR: 2.0, rise0: 0.2, riseR: 0.2, crown: 1.3, sq0: 0.42, tile: 1, girth: 1.9, vines: 12, leaf: [0x264a18, 0x7aa844] };
export const UNDERSTORY = { H0: 2.4, Hr: 1.0, from: 0.4, limbs: 6, len0: 1.2, lenR: 0.6, rise0: 0.65, riseR: 0.3, crown: 0.75, sq0: 0.75, tile: 0, girth: 0.5, vines: 0, leaf: [0x1e4614, 0x5a9a34] };
// low-branching, wide spreading crown (fig-like): fills the bare-trunk band so groves read as a closed canopy
export const SPREADING = { H0: 4.6, Hr: 1.4, from: 0.36, limbs: 7, len0: 2.7, lenR: 1.2, rise0: 0.3, riseR: 0.3, crown: 1.15, sq0: 0.55, tile: 0, girth: 1.15, vines: 6, leaf: [0x24481a, 0x7cae46] };

// lantern tree (original species): corkscrew trunk, low open crown, glowing orange seed pods hanging on long stalks
export const LANTERN = { H0: 5.2, Hr: 1.6, from: 0.45, limbs: 6, len0: 2.8, lenR: 1.2, rise0: 0.25, riseR: 0.25, crown: 0.9, sq0: 0.48, tile: 0, girth: 0.95, vines: 3, leaf: [0x2e4c1c, 0x94ac4a], twist: 1, lanterns: 22 };

export function broadleafTree(seed = 41, lod = false, sp = {}) {
  const { H0 = 5, Hr = 1.5, from = 0.58, limbs = 5, len0 = 2.0, lenR = 1.1, rise0 = 0.45, riseR = 0.35, crown = 1, sq0 = 0.65, tile = 0, girth = 1, vines = 7, leaf = [0x2a521a, 0x8ab84c], twist = 0, lanterns = 0 } = sp;
  const rnd = mulberry32(seed), lrnd = mulberry32(seed * 7 + 1); // leaves draw from their own stream so LOD and full crowns match
  const parts = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const BARK0 = 0x544638, BARK1 = 0x867862; // weathered grey-brown: the darker bark crushed to black in canopy shade
  const H = H0 + rnd() * Hr;
  // trunk: gentle S-curved lean, taper, four buttress lobes at the foot, furrowed bark and a few knots
  const lean = rnd() * Math.PI * 2, bend = (0.25 + rnd() * 0.3) * Math.sqrt(H / 6), ph = rnd() * 6, lobePh = rnd() * 6;
  const tpts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6, off = bend * t * t + (0.12 + 0.3 * twist) * Math.sin(t * (3.5 + 3 * twist) + ph) * t * Math.sqrt(H / 6);
    const tw = twist * 0.35 * Math.sin(t * 7 + ph) * t; // corkscrew: a second sway across the lean
    tpts.push(V(Math.cos(lean) * off - Math.sin(lean) * tw, -0.5 + (H + 0.5) * t, Math.sin(lean) * off + Math.cos(lean) * tw));
  }
  const tc = new THREE.CatmullRomCurve3(tpts);
  const knots = [0, 1, 2].map(() => [0.25 + rnd() * 0.55, rnd() * Math.PI * 2]);
  const trunkR = (t) => (0.4 - 0.22 * t) * girth;
  const footH = 1.7 * Math.sqrt(girth);
  parts.push(branchTube(tpts, (t, a, c) => {
    const foot = Math.max(0, 1 - (c.y + 0.5) / footH) ** 2;
    const lobes = (0.3 + 0.7 * Math.abs(Math.sin(a * 2 + lobePh)) ** 3) * (0.75 + 0.25 * Math.sin(a + ph));
    const fur = lod ? 0 : 0.5 + 0.5 * Math.sin(a * 5 + c.y * 0.45 + 2 * N3.fbm3(Math.cos(a), c.y * 0.8, Math.sin(a), 2));
    let knot = 0;
    if (!lod) for (const [kt, ka] of knots) { const da = Math.atan2(Math.sin(a - ka), Math.cos(a - ka)); knot += Math.exp(-((t - kt) ** 2) / 0.0015 - (da * da) / 0.12); }
    const lump = 1 + 0.07 * N3.fbm3(Math.cos(a) * 0.8 + seed, c.y * 0.6, Math.sin(a) * 0.8, 2);
    return [trunkR(t) * (1 + 1.7 * foot * lobes) * lump * (1 - 0.05 * fur) + 0.06 * knot * girth, 0.28 * fur * (1 - foot) + 0.3 * foot * (1 - lobes) + 0.2 * knot];
  }, lod ? 6 : Math.round(12 + H * 0.8), lod ? 5 : 12, BARK0, BARK1));
  // wood with a flared collar where it leaves its parent, so limbs grow out of the trunk instead of poking into it
  const wood = (pts, r0, r1, radial, segs) => parts.push(branchTube(pts, (t, a, c) => [
    (r0 + (r1 - r0) * t) * (1 + 0.55 * Math.max(0, 1 - t / 0.12) ** 2) * (1 + 0.12 * N3.fbm3(c.x * 2 + Math.cos(a) * 0.3, c.y * 2, c.z * 2 + Math.sin(a) * 0.3, 2)), 0.12 * (1 - t),
  ], radial, segs, BARK0, BARK1));
  // surface roots running out from the buttress lobes and diving into the soil
  if (!lod) for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2 - lobePh + i * Math.PI) / 2, o = V(Math.cos(a), 0, Math.sin(a)), L = (1.1 + rnd() * 0.8) * Math.sqrt(girth);
    wood([V(0, 0.4, 0).addScaledVector(o, 0.2 * girth), V(0, 0.1, 0).addScaledVector(o, 0.3 * girth + L * 0.45), V(0, -0.3, 0).addScaledVector(o, 0.3 * girth + L)], 0.14 * girth, 0.04, 6, 5);
  }
  // limbs spiral up the upper trunk, arch outward then curl toward the light; most fork once or twice
  const top = tc.getPointAt(1);
  const clumps = [[top.clone().add(V(0, 0.9 * crown, 0)), (1.45 + rnd() * 0.4) * crown]];
  const tips = [];
  for (let i = 0; i < limbs; i++) {
    const tb = Math.min(0.97, from + (0.97 - from) * (i / (limbs - 1)) + (rnd() - 0.5) * 0.06);
    const base = tc.getPointAt(tb);
    const a = i * 2.39996 + lean + rnd() * 0.5, out = V(Math.cos(a), 0, Math.sin(a));
    const len = (len0 + rnd() * lenR) * (1.15 - (tb - from)), rise = rise0 + rnd() * riseR;
    const p1 = base.clone().addScaledVector(out, len * 0.35).add(V(0, len * rise * 0.3, 0));
    const p2 = base.clone().addScaledVector(out, len * 0.7).add(V(0, len * rise * 0.5, 0));
    const p3 = base.clone().addScaledVector(out, len * 0.95).add(V(0, len * rise * 0.85, 0));
    const pts = [base.clone().addScaledVector(out, -0.05), p1, p2, p3];
    const r0 = trunkR(tb) * (0.55 + rnd() * 0.15);
    wood(pts, r0, r0 * 0.3, lod ? 4 : 8, lod ? 3 : 8);
    clumps.push([p3, (1.1 + rnd() * 0.5) * crown]);
    tips.push(p3);
    if (rnd() < 0.7) clumps.push([p1.clone().lerp(p2, 0.6).add(V(0, 0.35, 0)), (0.75 + rnd() * 0.35) * crown]);
    const lc = new THREE.CatmullRomCurve3(pts);
    for (let f = 0, nf = rnd() < 0.6 ? 2 : 1; f < nf; f++) {
      const fb = lc.getPointAt(0.5 + rnd() * 0.25), fa = a + (f ? -1 : 1) * (0.6 + rnd() * 0.5);
      const fo = V(Math.cos(fa), 0, Math.sin(fa)), fl = len * (0.4 + rnd() * 0.2);
      const q2 = fb.clone().addScaledVector(fo, fl).add(V(0, fl * Math.max(0.35, rise * 1.4), 0));
      wood([fb, fb.clone().addScaledVector(fo, fl * 0.5).add(V(0, fl * 0.35, 0)), q2], r0 * 0.45, r0 * 0.15, lod ? 3 : 6, lod ? 2 : 5);
      clumps.push([q2, (0.9 + rnd() * 0.4) * crown]);
      tips.push(q2);
    }
  }
  // crown: many clumps of varied squash on every branch end, so the silhouette breaks into masses and sky gaps
  for (const [p, r] of clumps) {
    const sq = sq0 + rnd() * 0.3, cc = V(p.x, p.y + 0.25, p.z);
    parts.push(...leafClump(cc, r, Math.round(48 * r * r), lrnd, leaf[0], leaf[1], { size: 0.42 / r, sq, core: 0.62, tile, lod }));
  }
  if (!lod) for (let i = 0; i < vines; i++) {
    const t = tips[i % tips.length];
    const len = (1.5 + rnd() * 2.5) * Math.sqrt(H / 6);
    const g = new THREE.PlaneGeometry(0.07, len, 1, 4);
    g.translate((rnd() - 0.5) * 1.6, t.y - len / 2 - 0.3, 0);
    g.rotateY(rnd() * Math.PI);
    g.translate(t.x, 0, t.z);
    parts.push(paint(g, 0x2a4418, 0x3a5a20));
  }
  // lantern pods: own random stream, so full and LOD trees hang the same fruit
  const frnd = mulberry32(seed * 13 + 5);
  for (let i = 0; i < lanterns; i++) {
    const t = tips[i % tips.length], a = frnd() * Math.PI * 2, rr = (0.3 + frnd() * 0.9) * crown;
    const x = t.x + Math.cos(a) * rr, z = t.z + Math.sin(a) * rr, y = t.y - 0.1, len = 0.5 + frnd() * 1.1, pr = 0.13 + frnd() * 0.07;
    if (!lod) {
      const st = new THREE.CylinderGeometry(0.01, 0.014, len, 3);
      st.translate(x, y - len / 2, z);
      parts.push(paint(st, 0x3a3a1c, 0x4e4a24));
    }
    const pod = new THREE.SphereGeometry(pr, lod ? 5 : 9, lod ? 4 : 7);
    pod.scale(1, 1.5, 1);
    pod.translate(x, y - len - pr * 1.3, z);
    parts.push(paint(pod, 0xb8401a, 0xffa848, 1));
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
    const L = 0.9 + rnd() * 0.6, W = L * 0.9;
    const g = new THREE.PlaneGeometry(L, W, 6, 2);
    const q = g.attributes.position, u = g.attributes.uv;
    for (let k = 0; k < q.count; k++) {
      const x = q.getX(k) + L / 2, y = q.getY(k);
      q.setXYZ(k, x, 0.25 * x - 0.45 * x * x + Math.abs(y) * 0.35, y);
      u.setXY(k, ...leafUV(5, x / L, y / W + 0.5));
    }
    g.userData.cards = true;
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

// Exposed surface roots for big jungle trunks: a ring of half-buried tubes that snake outward, fork and dive into the soil
export function surfaceRoots(seed = 46) {
  const rnd = mulberry32(seed);
  const parts = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const root = (o, side, r0, L, y0, wander, depth) => {
    const ys = [y0, 0.06, 0.02 + rnd() * 0.08, -0.02, -depth]; // arches off the trunk, rides the surface, dives
    const pts = [0, 0.28, 0.55, 0.8, 1].map((t, k) => V(0, ys[k], 0).addScaledVector(o, L * t).addScaledVector(side, wander * L * t * t));
    parts.push(branchTube(pts, (t, a) => [r0 * (1 - 0.75 * t) * (1 + 0.12 * Math.sin(a * 3 + L)), 0.25 * (1 - t)], 6, 10, 0x3e3428, 0x6a5c48));
    return pts;
  };
  for (let i = 0, n = 6 + Math.floor(rnd() * 3); i < n; i++) {
    const a = ((i + rnd() * 0.7) / n) * Math.PI * 2, o = V(Math.cos(a), 0, Math.sin(a)), side = V(-o.z, 0, o.x);
    const L = 1.4 + rnd() * 2.2, w = (rnd() - 0.5) * 0.6;
    const pts = root(o, side, 0.13 + rnd() * 0.07, L, 0.3, w, 0.3);
    if (rnd() < 0.5) { // a thinner fork leaves the root halfway out
      const b = pts[2], fo = o.clone().addScaledVector(side, rnd() < 0.5 ? 0.8 : -0.8).normalize();
      const fl = 0.6 + rnd() * 0.9;
      parts.push(branchTube([b.clone(), b.clone().addScaledVector(fo, fl * 0.5).setY(0.02), b.clone().addScaledVector(fo, fl).setY(-0.2)], (t) => [0.06 * (1 - 0.6 * t), 0.2 * (1 - t)], 5, 5, 0x3e3428, 0x6a5c48));
    }
  }
  return merged(parts);
}

// Hibiscus-like shrub: leafy mound dotted with flowers
export function floweringShrub(seed = 45, lo = false) {
  const rnd = mulberry32(seed), lrnd = mulberry32(seed * 7 + 1);
  const parts = [];
  const blobs = shrubBlobs(rnd, 6, 0.5);
  for (const [c, r, sq] of blobs) parts.push(...leafClump(c, r, Math.round(105 * r * r), lrnd, 0x1c3a14, 0x4a7a2a, { size: 0.34, sq, tile: 2, lod: lo }));
  for (let i = 0; i < 18; i++) {
    const [c, r, sq] = blobs[i % blobs.length];
    const d = new THREE.Vector3(rnd() - 0.5, rnd() * 0.8 + 0.1, rnd() - 0.5).normalize();
    const f = new THREE.IcosahedronGeometry(0.07, 0);
    f.scale(1, 0.55, 1);
    f.translate(c.x + d.x * r, c.y + d.y * r * sq, c.z + d.z * r);
    parts.push(paint(f, i % 3 ? 0xe0405a : 0xf09a3a));
  }
  return merged(parts);
}
