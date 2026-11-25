// Hand-built points of interest: research station, wreck, ruins, gate, vents, fossils, pillars, landmarks.
// Each structure is a Kit: primitives are merged into one mesh per material bucket and get matching colliders.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stdMat, U } from '../fx/materials.js';
import { getNoiseTexture } from '../fx/textures.js';
import { POIS, ISLANDS, HAVEN } from './layout.js';
import { broadleafTree } from './geometries.js';
import { mulberry32, createNoise } from './noise.js';

const NS = createNoise(9191);

const PI = Math.PI;
const ONE = new THREE.Vector3(1, 1, 1);
const mat4 = (p = [0, 0, 0], r = [0, 0, 0]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'YXZ')), ONE);
const _c = new THREE.Color();

function tint(geo, color, k = 1) {
  if (geo.index === null) geo = geo.toNonIndexed(); // all built-ins are indexed; guard anyway
  geo.deleteAttribute('uv');
  _c.set(color);
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r * k; a[i * 3 + 1] = _c.g * k; a[i * 3 + 2] = _c.b * k; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

let MATS = null;
function materials() {
  if (MATS) return MATS;
  const grime = /* glsl */ `
    {
      float g = texture2D(uNoise, vWPos.xz * 0.043 + vWPos.y * 0.031).r;
      float g2 = texture2D(uNoise, vec2(vWPos.x + vWPos.z, vWPos.y) * 0.11).g;
      diffuseColor.rgb *= mix(0.6, 1.08, g) * mix(0.85, 1.05, g2);
      float wet = smoothstep(0.0, -3.0, vWPos.y - uWaterLevel);
      float algae = smoothstep(0.45, 0.75, g * 0.6 + g2 * 0.5) * wet;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.3, 0.19), algae * 0.6);
    }`;
  MATS = {
    solid: stdMat({ vertexColors: true, roughness: 0.78, metalness: 0.15, side: THREE.DoubleSide }, {
      key: 'struct', uniforms: { uNoise: { value: getNoiseTexture() } }, fragDecl: 'uniform sampler2D uNoise;', fragColor: grime,
      detail: { kind: 'rock', scale: 0.7, bump: 0.015, cavity: 0.22 }, // weathering: pitting, fine cracks (geometry is world-space)
    }),
    glow: stdMat({ vertexColors: true, color: 0x0a0a0a, roughness: 0.6 }, {
      key: 'structglow', fragEmissive: 'totalEmissiveRadiance += vColor.rgb * (0.88 + 0.12 * sin(uTime * 3.0 + vWPos.x * 2.0 + vWPos.z));',
    }),
    glass: stdMat({ vertexColors: true, roughness: 0.05, metalness: 0.5, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }, { key: 'glass' }),
  };
  return MATS;
}

class Kit {
  constructor(S, name, x, z, rot = [0, 0, 0]) {
    this.S = S;
    this.name = name;
    this.pos = [x, S.world.heightAt(x, z), z];
    this.rot = typeof rot === 'number' ? [0, rot, 0] : rot;
    this.base = mat4(this.pos, this.rot);
    this.parts = { solid: [], glow: [], glass: [] };
  }

  // Rest the kit on the lowest ground under the given local points, sunk by `sink` metres.
  settle(points, sink = 0) {
    let lo = Infinity;
    const yaw = mat4([this.pos[0], 0, this.pos[2]], [0, this.rot[1], 0]);
    for (const [lx, lz] of points) {
      const v = new THREE.Vector3(lx, 0, lz).applyMatrix4(yaw);
      lo = Math.min(lo, this.S.world.heightAt(v.x, v.z));
    }
    this.pos[1] = lo - sink;
    this.base = mat4(this.pos, this.rot);
    return this;
  }
  at(y) { this.pos[1] = y; this.base = mat4(this.pos, this.rot); return this; }

  wp(p) { return new THREE.Vector3(...p).applyMatrix4(this.base); }
  // ground height relative to the kit origin under a local point
  gy(lx, lz) { const v = this.wp([lx, 0, lz]); return this.S.world.heightAt(v.x, v.z) - this.pos[1]; }

  put(geo, color, p, r, o = {}) {
    const m = mat4(p, r);
    geo.applyMatrix4(m);
    this.parts[o.bucket || 'solid'].push(tint(geo, color, o.k ?? 1));
    return this.base.clone().multiply(m);
  }
  _col(o) { return o.collide ?? (o.bucket !== 'glow'); }

  // weathered standing stone: a subdivided box with eroded, chipped faces; collides as its box
  stone(w, h, d, color, p, r, seed = 0) {
    const g = new THREE.BoxGeometry(w, h, d, 3, 8, 2), q = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < q.count; i++) {
      v.fromBufferAttribute(q, i);
      const n = NS.fbm3(v.x * 0.9 + seed, v.y * 0.9, v.z * 0.9 + seed * 0.37, 4);
      const edge = Math.max(Math.abs(v.x) / (w / 2), Math.abs(v.z) / (d / 2)); // corners erode most
      const taper = 1 - 0.18 * Math.max(0, v.y / h + 0.1);
      v.x *= taper * (1 + 0.16 * n - 0.07 * edge);
      v.z *= taper * (1 + 0.16 * n - 0.07 * edge);
      v.y += 0.12 * n * h * (v.y > 0 ? 1 : 0.3);
      q.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    const m = this.put(g, color, p, r);
    this.S.colliders.addBox(m, w / 2, h / 2, d / 2);
    return m;
  }
  box(w, h, d, color, p, r, o = {}) {
    const m = this.put(new THREE.BoxGeometry(w, h, d), color, p, r, o);
    if (this._col(o)) this.S.colliders.addBox(m, w / 2, h / 2, d / 2);
    return m;
  }
  cyl(rt, rb, h, color, p, r, o = {}) {
    const g = new THREE.CylinderGeometry(rt, rb, h, o.seg ?? 16, 1, !!o.open, o.t0 ?? 0, o.tl ?? PI * 2);
    const m = this.put(g, color, p, r, o);
    if (this._col(o)) {
      if (o.open) this.S.colliders.addTube(m, Math.max(rt, rb), h / 2, o.th ?? 0.3);
      else this.S.colliders.addCylinder(m, (rt + rb) / 2, h / 2);
    }
    return m;
  }
  sphere(rad, color, p, r, o = {}) {
    const g = new THREE.SphereGeometry(rad, o.ws ?? 24, o.hs ?? 14, 0, PI * 2, o.th0 ?? 0, o.thl ?? PI);
    if (o.scale) g.scale(...o.scale);
    const m = this.put(g, color, p, r, o);
    if (this._col(o)) {
      if (o.shell) this.S.colliders.addDome(m, rad, o.shell, o.cutY ?? -rad - 1);
      else { const v = new THREE.Vector3().setFromMatrixPosition(m); this.S.colliders.addSphere(v.x, v.y, v.z, rad * (o.scale ? Math.min(...o.scale) : 1)); }
    }
    return m;
  }
  // torus in local XY plane; partial arcs collide as a chain of capsules
  torus(R, tube, color, p, r, o = {}) {
    const arc = o.arc ?? PI * 2;
    const m = this.put(new THREE.TorusGeometry(R, tube, o.rs ?? 8, o.ts ?? 32, arc), color, p, r, o);
    if (this._col(o)) {
      if (arc >= PI * 2) this.S.colliders.addTorus(m, R, tube);
      else {
        const n = Math.max(2, Math.round(arc / 0.45));
        let prev = null;
        for (let i = 0; i <= n; i++) {
          const a = (arc * i) / n, q = new THREE.Vector3(R * Math.cos(a), R * Math.sin(a), 0).applyMatrix4(m);
          if (prev) this.S.colliders.addCapsule(prev.x, prev.y, prev.z, q.x, q.y, q.z, tube);
          prev = q;
        }
      }
    }
    return m;
  }
  // flat annulus (end caps with a doorway); collides as a thin tube
  ring(inner, outer, color, p, r, o = {}) {
    const m = this.put(new THREE.RingGeometry(inner, outer, o.seg ?? 32), color, p, r, o);
    if (this._col(o)) this.S.colliders.addTube(m.clone().multiply(mat4([0, 0, 0], [PI / 2, 0, 0])), outer, 0.15, outer - inner);
    return m;
  }
  // subtract a cylinder (local Y axis) from colliders: a doorway
  hole(rad, hh, p, r) { this.S.colliders.cut(this.S.colliders.addCylinder(this.base.clone().multiply(mat4(p, r)), rad, hh)); }

  light(p, color, radius, mode = 'steady', night = false) {
    const v = this.wp(p);
    this.S.lights.push({ x: v.x, y: v.y, z: v.z, r: radius, color: new THREE.Color(color), mode, night, phase: Math.random() * 10 });
  }
  anchor(id, p) { this.S.anchors[id] = this.wp(p); }
  clear(r, p = [0, 0, 0]) { const v = this.wp(p); this.S.clearings.push({ x: v.x, z: v.z, r }); }

  finish() {
    const M = materials();
    for (const b of ['solid', 'glow', 'glass']) {
      if (!this.parts[b].length) continue;
      const g = mergeGeometries(this.parts[b], false);
      this.parts[b].forEach((p) => p.dispose());
      g.applyMatrix4(this.base);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, M[b]);
      mesh.name = this.name + ':' + b;
      mesh.userData.deep = g.boundingBox.max.y < -25; // hidden from above water, like deep terrain chunks
      mesh.castShadow = b === 'solid';
      mesh.receiveShadow = b !== 'glass';
      if (b === 'glass') mesh.renderOrder = 4;
      this.S.scene.add(mesh);
      this.S.meshes.push(mesh);
    }
    this.parts = null;
  }
}

// ---------------------------------------------------------------------------------------------
// Haven landmarks: optional scenery with no journal anchor, so the ending never depends on them.

let greyNoise = null;
function flowMat(S, color, opacity, speed, rep) {
  if (!greyNoise) { // one noise channel in all of rgb: the shared noise texture's channels differ and read as a rainbow
    const src = getNoiseTexture().image, d = new Uint8Array(src.data.length);
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 150 + src.data[i + 1] * 0.41, d[i + 3] = 255;
    greyNoise = new THREE.DataTexture(d, src.width, src.height, THREE.RGBAFormat);
    greyNoise.wrapS = greyNoise.wrapT = THREE.RepeatWrapping;
    greyNoise.needsUpdate = true;
  }
  const map = greyNoise.clone();
  map.needsUpdate = true;
  map.repeat.set(rep[0], rep[1]);
  const m = new THREE.MeshStandardMaterial({ color, map, transparent: true, opacity, depthWrite: false, roughness: 0.15, metalness: 0.05, side: THREE.DoubleSide });
  m.userData.speed = speed;
  S.flows.push(m);
  return m;
}

function strip(pos, uv, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function addMesh(S, g, mat, order = 3) {
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = order;
  S.scene.add(m);
  S.meshes.push(m);
  return m;
}

// A sheet of water hugging the valley-head cliff, a pool at its foot and a stream down the valley floor to the beach
function falls(S) {
  const W = S.world, [[ax, az], [bx, bz]] = HAVEN.valley, P = HAVEN.pool;
  const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L; // up-valley
  const px = -dz, pz = dx; // across the valley
  const at = (u) => [ax + (bx - ax) * u, az + (bz - az) * u];
  const poolY = W.heightAt(P.x + px * P.r * 0.7, P.z + pz * P.r * 0.7) - 0.25; // just under the rim
  // waterfall: rows from the lip down to the pool, held 0.6 m off the rock
  const pos = [], uv = [], idx = [], rows = 14, hw = 3.6;
  for (let i = 0; i <= rows; i++) {
    const u = 1.05 - (i / rows) * 0.075, [cx, cz] = at(u);
    const y = Math.max(poolY, W.heightAt(cx, cz) + 0.1);
    for (const s of [-1, 1]) { pos.push(cx + px * hw * s - dx * 0.6, y, cz + pz * hw * s - dz * 0.6); uv.push((s + 1) / 2, (-i / rows) * 4); }
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  addMesh(S, strip(pos, uv, idx), flowMat(S, 0xe4f4f2, 0.82, 0.9, [1.5, 1]));
  const pg = new THREE.CircleGeometry(P.r * 1.05, 40);
  pg.rotateX(-PI / 2);
  pg.translate(P.x, poolY, P.z);
  addMesh(S, pg, new THREE.MeshStandardMaterial({ color: 0x2c6e72, transparent: true, opacity: 0.78, roughness: 0.05, metalness: 0.2, depthWrite: false }));
  // stream: a ribbon on the valley floor from the pool to the beach, lifted over the highest point across it
  const sp = [], su = [], si = [], n = 40;
  for (let i = 0; i <= n; i++) {
    const u = 0.9 - (i / n) * 0.92, [cx, cz] = at(u), w = 1.2 + (i / n) * 1.6;
    let y = -Infinity;
    for (const s of [-1, 0, 1]) y = Math.max(y, W.heightAt(cx + px * w * s, cz + pz * w * s));
    y = Math.max(y + 0.08, 0.05);
    for (const s of [-1, 1]) { sp.push(cx + px * w * s, y, cz + pz * w * s); su.push((s + 1) / 2, (-u * L) / 6); }
    if (i) { const a = (i - 1) * 2; si.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  addMesh(S, strip(sp, su, si), flowMat(S, 0x5a9aa0, 0.7, 0.25, [1, 1]));
  const [fx, fz] = at(0.99);
  S.emitters.push({ x: fx - dx, y: poolY + 0.3, z: fz - dz, rate: 0.6, type: 'mist' });
  S.clearings.push({ x: P.x, z: P.z, r: P.r + 2 });
  for (let u = 0.05; u < 0.9; u += 0.06) { const [cx, cz] = at(u); S.clearings.push({ x: cx, z: cz, r: 3.5 }); }
  S.falls = { x: fx, z: fz, poolY };
}

// A lone forest giant on the flattest inland ground away from the valley, in its own clearing
function giantTree(S) {
  const W = S.world, I = ISLANDS.find((i) => i.id === 'haven');
  const [[ax, az], [bx, bz]] = HAVEN.valley;
  let best = null;
  for (let a = 0; a < PI * 2; a += 0.15) for (let r = 70; r <= 140; r += 10) {
    const x = I.x + Math.cos(a) * r, z = I.z + Math.sin(a) * r, h = W.heightAt(x, z);
    if (h < 12 || h > 40) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
    if (Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t) < 45) continue;
    let slope = 0;
    for (const [ox, oz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) slope = Math.max(slope, Math.abs(W.heightAt(x + ox, z + oz) - h));
    if (!best || slope < best.slope) best = { x, z, h, slope };
  }
  const sc = 3.4, g = broadleafTree(77);
  g.scale(sc, sc * 1.15, sc);
  g.translate(best.x, best.h - 0.6, best.z);
  g.computeBoundingSphere();
  const m = addMesh(S, g, stdMat({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }, {
    key: 'giant-tree', detail: { kind: 'plant', scale: 0.25, bump: 0.05, cavity: 0.35 }, translucent: 0.55, leafOnly: true,
  }), 0);
  m.castShadow = m.receiveShadow = true;
  S.colliders.addCapsule(best.x, best.h - 1, best.z, best.x, best.h + 5 * sc, best.z, 0.42 * sc);
  S.clearings.push({ x: best.x, z: best.z, r: 15 });
  S.giantTree = best;
}

// A weathered natural arch in the shallows off Haven's east beach; you can swim or wade through it
function seaArch(S) {
  const I = ISLANDS.find((i) => i.id === 'haven'), a = 0.3;
  let r = 150;
  while (r < 400 && S.world.heightAt(I.x + Math.cos(a) * r, I.z + Math.sin(a) * r) > -0.5) r += 2; // walk out to the waterline
  const x = I.x + Math.cos(a) * (r + 8), z = I.z + Math.sin(a) * (r + 8);
  const k = new Kit(S, 'arch', x, z, PI / 2 - a); // local x runs along the shore
  k.settle([[-8, 0], [8, 0]], 1.5);
  const g = new THREE.TorusGeometry(7, 2.3, 20, 56, PI);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const ang = Math.atan2(v.y, v.x), cx = Math.cos(ang) * 7, cy = Math.sin(ang) * 7;
    // broad lobes plus eroded pockets and layered ledges (noise is position-based, so the seam stays closed)
    const n = 1 + 0.22 * Math.sin(v.x * 1.7 + v.z * 2.3) * Math.cos(v.y * 1.3) + 0.12 * Math.sin(v.y * 3.1 + v.x * 0.7)
      + 0.14 * NS.fbm3(v.x * 0.45, v.y * 0.45, v.z * 0.45, 4) + 0.04 * Math.sin(v.y * 4.2 + NS.n3(v.x * 0.3, v.y * 0.3, v.z * 0.3) * 3);
    p.setXYZ(i, cx + (v.x - cx) * n, cy + (v.y - cy) * n * 1.1, v.z * n * (1.2 - 0.25 * Math.sin(ang)));
  }
  g.computeVertexNormals();
  const m = k.put(g, 0x8a8174, [0, 0, 0], [0, 0, 0]);
  for (let i = 0; i <= 8; i++) {
    const t0 = (PI * i) / 8, q = new THREE.Vector3(7 * Math.cos(t0), 7 * Math.sin(t0), 0).applyMatrix4(m);
    S.colliders.addSphere(q.x, q.y, q.z, 2.0);
  }
  for (const s of [-1, 1]) k.sphere(2.6, 0x7a7266, [s * 8.2, 0.4, 0.8 * s], [0.3, s, 0.2], { scale: [1, 0.6, 1.2], ws: 9, hs: 6 });
  k.finish();
  S.arch = { x, z };
}

// ---------------------------------------------------------------------------------------------
const C = {
  white: 0xd8dcd6, yellow: 0xe0b030, dark: 0x3a4048, steel: 0x7a828a, glass: 0x9ad8ff, teal: 0x40ffe0, warm: 0xffb060,
  red: 0xff3a2a, hullRed: 0x7a2a20, hullDark: 0x24282c, stone: 0xb8ae98, stoneDark: 0x8a8270, rune: 0x50ffd0, bone: 0xe0d6c0,
};

function station(S) {
  const P = POIS.station;
  const k = new Kit(S, 'station', P.x, P.z, P.rot).settle([[0, 0], [25, 0], [-15, -25], [-10, 18]], 0.3);
  const HR = 7, FY = 4, WH = 5, CY = FY + 2.5;
  const doors = [PI / 2, (PI * 7) / 6, (PI * 11) / 6];
  const dh = 0.3; // door half angle at the hub wall
  // hub wall in arcs between doors, with bands above/below each doorway
  for (let i = 0; i < 3; i++) {
    const a0 = doors[i] + dh, a1 = doors[(i + 1) % 3] - dh + (i === 2 ? PI * 2 : 0);
    k.cyl(HR, HR, WH, C.white, [0, FY + WH / 2, 0], 0, { open: true, t0: a0, tl: a1 - a0, collide: false, seg: 24 });
    k.cyl(HR, HR, 0.7, C.yellow, [0, FY + 0.35, 0], 0, { open: true, t0: doors[i] - dh, tl: dh * 2, collide: false, seg: 4 });
    k.cyl(HR, HR, 0.7, C.white, [0, FY + WH - 0.35, 0], 0, { open: true, t0: doors[i] - dh, tl: dh * 2, collide: false, seg: 4 });
  }
  S.colliders.addTube(k.base.clone().multiply(mat4([0, FY + WH / 2, 0])), HR, WH / 2, 0.35);
  for (const d of doors) k.hole(1.5, 0.8, [Math.sin(d) * HR, CY, Math.cos(d) * HR], [PI / 2, d, 0]);
  // dome: metal skirt + glass cap
  k.sphere(HR, C.white, [0, FY + WH, 0], 0, { th0: 0.62, thl: PI / 2 - 0.62, collide: false });
  k.sphere(HR, C.glass, [0, FY + WH, 0], 0, { thl: 0.62, bucket: 'glass', collide: false });
  S.colliders.addDome(k.base.clone().multiply(mat4([0, FY + WH, 0])), HR, 0.35, 0);
  k.torus(HR, 0.18, C.yellow, [0, FY + WH, 0], [PI / 2, 0, 0], { ts: 48, collide: false });
  // floor with a moonpool: the way in from below
  k.ring(2.2, HR, C.dark, [0, FY, 0], [-PI / 2, 0, 0]);
  k.torus(2.2, 0.15, C.yellow, [0, FY, 0], [PI / 2, 0, 0], { collide: false });
  for (let i = 0; i < 4; i++) {
    const a = PI / 4 + (i * PI) / 2;
    k.cyl(0.45, 0.6, FY + 3, C.steel, [Math.sin(a) * 5, FY / 2 - 1.5, Math.cos(a) * 5]);
  }
  // hub interior
  k.box(2.4, 1.2, 0.8, C.dark, [0, FY + 0.6, HR - 1.1]);
  k.box(1.8, 0.9, 0.06, 0x30a0ff, [0, FY + 1.7, HR - 1.0], [-0.25, 0, 0], { bucket: 'glow', k: 1.6 });
  k.anchor('station-hub', [0, FY + 1.5, HR - 2.2]);
  for (let i = 0; i < 4; i++) k.box(0.9, 2.3, 0.6, i % 2 ? C.steel : C.white, [-1.5 + i, FY + 1.15, -HR + 0.9]);
  k.box(1.8, 0.1, 1.0, C.steel, [-3.4, FY + 0.95, 2.2], [0, 0.6, 0]);
  k.torus(3.2, 0.08, C.teal, [0, FY + WH - 0.25, 0], [PI / 2, 0, 0], { bucket: 'glow', k: 1.4, ts: 48 });
  k.light([0, FY + 3, 0], 0x40ffe0, 13);

  // corridor to the laboratory (+x)
  const corridor = (d, r0, r1, broken = false) => {
    const len = r1 - r0, rc = (r0 + r1) / 2;
    k.cyl(1.8, 1.8, len, C.white, [Math.sin(d) * rc, CY, Math.cos(d) * rc], [PI / 2, d, 0], { open: true, seg: 20 });
    for (let r = r0 + 1.2; r < r1 - 0.5; r += 2.6) k.torus(1.86, 0.12, C.yellow, [Math.sin(d) * r, CY, Math.cos(d) * r], [0, d, 0], { collide: false });
    k.box(1.6, 0.12, len, C.dark, [Math.sin(d) * rc, CY - 1.45, Math.cos(d) * rc], [0, d, 0]);
    if (broken) for (let i = 0; i < 5; i++) {
      const a = (i / 5) * PI * 2;
      k.box(0.9, 0.12, 1.4, C.white, [Math.sin(d) * (r1 + 0.4) + Math.cos(a) * 1.7 * Math.cos(d), CY + Math.sin(a) * 1.7, Math.cos(d) * (r1 + 0.4) - Math.cos(a) * 1.7 * Math.sin(d)], [a, d, 0.5], { collide: false });
    }
  };
  corridor(doors[0], 6.7, 16);
  // laboratory: horizontal cylinder along +x
  const LX = 25;
  k.cyl(4, 4, 18, C.white, [LX, CY, 0], [PI / 2, PI / 2, 0], { open: true, seg: 28, th: 0.35 });
  k.ring(1.8, 4, C.white, [16, CY, 0], [0, PI / 2, 0]);
  k.ring(2.4, 4, C.white, [34, CY, 0], [0, PI / 2, 0]);
  for (const x of [16.2, 25, 33.8]) k.torus(4.06, 0.2, C.yellow, [x, CY, 0], [0, PI / 2, 0], { collide: false, ts: 40 });
  k.box(18, 0.25, 5.6, C.dark, [LX, CY - 2.75, 0]);
  for (const x of [19, 31]) for (const z of [-2.4, 2.4]) k.cyl(0.35, 0.45, CY, C.steel, [x, CY / 2 - 3.2, z]);
  for (const x of [18.5, 22.5]) {
    k.box(3, 0.9, 1.0, C.steel, [x, CY - 2.2, 2.0]);
    k.box(1.2, 0.7, 0.05, 0x30ffa0, [x, CY - 1.3, 2.35], [0.3, PI, 0], { bucket: 'glow', k: 1.3 });
  }
  for (let i = 0; i < 4; i++) k.box(0.85, 2.2, 0.6, i === 2 ? C.yellow : C.white, [18 + i * 0.95, CY - 1.5, -2.5], [0, 0, i === 3 ? 0.35 : 0]);
  // specimen tank with something still glowing inside
  k.cyl(0.95, 0.95, 0.4, C.dark, [28, CY - 2.4, -1.6]);
  k.cyl(0.9, 0.9, 2.4, C.glass, [28, CY - 1.0, -1.6], 0, { bucket: 'glass', open: true, collide: false });
  k.cyl(0.95, 0.95, 0.3, C.dark, [28, CY + 0.35, -1.6], 0, { collide: false });
  S.colliders.addCylinder(k.base.clone().multiply(mat4([28, CY - 1.0, -1.6])), 0.95, 1.4);
  k.sphere(0.32, 0xb080ff, [28, CY - 1.0, -1.6], 0, { bucket: 'glow', k: 2.2, scale: [1, 1.6, 1] });
  for (let i = 0; i < 6; i++) k.cyl(0.03, 0.06, 0.9, 0xb080ff, [28 + Math.cos(i) * 0.25, CY - 1.7, -1.6 + Math.sin(i) * 0.25], [0.3 * Math.cos(i * 2), 0, 0.3 * Math.sin(i * 2)], { bucket: 'glow', k: 1.5 });
  k.anchor('station-tank', [27, CY - 1.2, -0.6]);
  k.box(1.6, 1.1, 0.7, C.dark, [31.5, CY - 2.1, 2.1]);
  k.box(1.3, 0.8, 0.05, 0xff6040, [31.5, CY - 1.2, 2.2], [0.3, PI, 0], { bucket: 'glow', k: 1.5 });
  k.anchor('station-lab', [31.5, CY - 1.2, 1.2]);
  k.box(14, 0.08, 0.3, C.warm, [LX, CY + 3.75, 0], 0, { bucket: 'glow', k: 1.2 });
  k.light([LX, CY + 1, 0], 0xffb070, 15, 'flicker');
  k.sphere(1.6, C.steel, [29, CY + 4.6, 0], [0.5, 0, 0.3], { th0: 0, thl: 0.7, collide: false });
  k.cyl(0.1, 0.1, 1.2, C.steel, [29, CY + 4.1, 0]);

  // observatory: a glass bubble whose open pole faces the hub
  const d2 = doors[1], OR = 19.2;
  corridor(d2, 6.7, 14.4);
  const oc = [Math.sin(d2) * OR, CY, Math.cos(d2) * OR];
  k.sphere(5, C.glass, oc, [PI / 2, d2 + PI, 0], { th0: 0.33, thl: PI - 0.33, bucket: 'glass', collide: false, ws: 32, hs: 18 });
  S.colliders.addDome(k.base.clone().multiply(mat4(oc)), 5, 0.3, -6);
  k.hole(1.5, 0.8, [Math.sin(d2) * (OR - 5), CY, Math.cos(d2) * (OR - 5)], [PI / 2, d2, 0]);
  k.torus(1.75, 0.2, C.yellow, [Math.sin(d2) * (OR - 4.75), CY, Math.cos(d2) * (OR - 4.75)], [0, d2, 0], { collide: false });
  for (let i = 0; i < 3; i++) k.torus(5.02, 0.1, C.white, oc, [0, d2 + (i * PI) / 3, 0], { collide: false, ts: 48 });
  k.torus(5.02, 0.12, C.white, oc, [PI / 2, 0, 0], { collide: false, ts: 48 });
  k.cyl(4.3, 4.3, 0.2, C.dark, [oc[0], CY - 2.4, oc[2]]);
  k.cyl(1.2, 1.6, CY + 1, C.steel, [oc[0], (CY - 5) / 2 - 1, oc[2]]);
  k.box(1.4, 1.0, 0.7, C.dark, [oc[0], CY - 1.8, oc[2]], [0, d2, 0]);
  k.box(1.2, 0.6, 0.05, 0x60a0ff, [oc[0] + Math.sin(d2) * 0.38, CY - 1.15, oc[2] + Math.cos(d2) * 0.38], [-0.4, d2, 0], { bucket: 'glow', k: 1.5 });
  k.cyl(0.25, 0.35, 2.6, C.steel, [oc[0] + Math.sin(d2) * 1.8, CY - 0.6, oc[2] + Math.cos(d2) * 1.8], [0.5, d2, 0]);
  k.anchor('station-obs', [oc[0] - Math.sin(d2) * 0.8, CY - 1.0, oc[2] - Math.cos(d2) * 0.8]);
  k.light([oc[0], CY, oc[2]], 0x6090ff, 10);

  // broken stub: a second way into the hub
  corridor(doors[2], 6.7, 11, true);
  const d3 = doors[2];
  const fx = Math.sin(d3) * 18, fz = Math.cos(d3) * 18;
  k.cyl(1.8, 1.8, 7, C.white, [fx, k.gy(fx, fz) + 1.2, fz], [PI / 2 - 0.15, d3 + 0.5, 0.1], { open: true, seg: 20 });

  // beacon mast to the surface: the station is findable from the boat lane
  const top = FY + WH + HR, surf = 1.6 - k.pos[1];
  k.cyl(0.28, 0.32, surf - top, C.steel, [0, (top + surf) / 2, 0]);
  k.sphere(1.3, 0xff7a20, [0, 0.2 - k.pos[1], 0], 0, { th0: 0, thl: PI });
  k.sphere(0.25, C.red, [0, surf + 0.3, 0], 0, { bucket: 'glow', k: 3, collide: false });
  k.light([0, surf + 0.3, 0], 0xff3020, 10, 'blink');

  const rnd = mulberry32(77);
  for (let i = 0; i < 9; i++) {
    const a = rnd() * PI * 2, r = 10 + rnd() * 14, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const s = 0.8 + rnd() * 0.6;
    k.box(1.2 * s, 1.0 * s, 1.2 * s, rnd() < 0.5 ? C.yellow : C.steel, [x, k.gy(x, z) + 0.4 * s, z], [rnd() * 0.3, rnd() * 3, rnd() * 0.3]);
  }
  k.clear(42);
  k.finish();
}

function hull(k, x0, x1, o) {
  const len = x1 - x0, mx = (x0 + x1) / 2;
  k.box(len, 0.6, 9.6, C.hullRed, [mx, 0.3, 0]);
  for (const s of [-1, 1]) {
    k.box(len, 3.6, 0.4, C.hullRed, [mx, 2.4, 4.9 * s]);
    k.box(len, 3.4, 0.4, C.hullDark, [mx, 5.9, 4.9 * s]);
    k.box(len, 0.25, 0.5, C.white, [mx, 7.55, 4.9 * s], 0, { collide: false });
  }
  for (const [a, b, z0 = -5, z1 = 5] of o.deck) k.box(b - a, 0.3, z1 - z0, 0x5a4a3a, [(a + b) / 2, 7.4, (z0 + z1) / 2]);
}

function wreck(S) {
  const P = POIS.wreck;
  const rnd = mulberry32(91);
  const fwd = [Math.cos(P.rot), -Math.sin(P.rot)];
  // stern half
  const k = new Kit(S, 'wreck-stern', P.x, P.z, [0.3, P.rot, 0.04]).settle([[-22, -5], [-22, 5], [2, -5], [2, 5], [-10, 0]], 1.6);
  hull(k, -22, 2, { deck: [[-22, -11], [-6, 2, -5, 0]] });
  k.box(0.4, 7, 10, C.hullDark, [-22, 3.8, 0]);
  for (const s of [-1, 1]) k.box(0.4, 7, 3.4, 0x4a4a4a, [-8, 3.8, 3.3 * s]);
  k.box(0.4, 2.2, 3.2, 0x4a4a4a, [-8, 6.2, 0]);
  // bridge house (hollow, enterable through the aft door)
  const BY = 7.6;
  k.box(7, 0.3, 9, C.white, [-14.5, BY + 5, 0]);
  k.box(0.3, 5, 9, C.white, [-18, BY + 2.5, 0]);
  for (const s of [-1, 1]) {
    k.box(7, 2.2, 0.3, C.white, [-14.5, BY + 1.1, 4.4 * s]);
    k.box(7, 1.2, 0.3, C.white, [-14.5, BY + 4.4, 4.4 * s]);
    k.box(7, 1.6, 0.1, 0x406080, [-14.5, BY + 3.0, 4.4 * s], 0, { bucket: 'glass', collide: false });
    k.box(0.3, 5, 3, C.white, [-11, BY + 2.5, 3 * s]);
  }
  k.box(0.3, 1.6, 3, C.white, [-11, BY + 4.2, 0]);
  k.box(1.6, 1.1, 3.4, C.dark, [-12, BY + 0.55, 0]);
  k.box(0.05, 0.5, 2.6, 0x40ff80, [-11.6, BY + 1.2, 0], [0, 0, 0.4], { bucket: 'glow', k: 0.7 });
  k.anchor('wreck-bridge', [-13, BY + 1.4, 0]);
  k.cyl(1.3, 1.5, 5, C.hullDark, [-15, BY + 7.5, 0]);
  k.cyl(1.32, 1.32, 0.8, C.yellow, [-15, BY + 8.6, 0], 0, { collide: false });
  // propeller + rudder
  k.cyl(0.5, 0.5, 1.2, 0x8a6a3a, [-22.8, 2.2, 0], [0, 0, PI / 2]);
  for (let i = 0; i < 4; i++) k.box(0.15, 2.0, 0.8, 0x9a7a40, [-23.2, 2.2 + Math.cos(i * PI / 2) * 1.0, Math.sin(i * PI / 2) * 1.0], [i * PI / 2, 0, 0.3], { collide: false });
  k.box(1.6, 3.2, 0.25, C.hullDark, [-24.2, 2.6, 0]);
  k.light([-14, BY + 2, 0], 0x40ff90, 6, 'flicker');
  k.finish();

  // bow half, broken away and slewed
  const b = new Kit(S, 'wreck-bow', P.x + fwd[0] * 8 + fwd[1] * 4, P.z + fwd[1] * 8 - fwd[0] * 4, [-0.22, P.rot + 0.35, -0.08])
    .settle([[2, -5], [2, 5], [22, -5], [22, 5], [30, 0]], 1.4);
  hull(b, 2, 22, { deck: [[11, 22]] });
  for (const s of [-1, 1]) {
    b.box(9.43, 3.6, 0.4, C.hullRed, [26, 2.4, 2.45 * s], [0, 0.558 * s, 0]);
    b.box(9.43, 3.4, 0.4, C.hullDark, [26, 5.9, 2.45 * s], [0, 0.558 * s, 0]);
  }
  b.box(8, 0.6, 5, C.hullRed, [25, 0.3, 0]);
  b.box(8, 0.3, 4, 0x5a4a3a, [25, 7.4, 0]);
  b.cyl(0.25, 0.3, 12, C.steel, [16, 13.5, 0]);
  b.box(0.2, 0.2, 6, C.steel, [16, 17, 0]);
  const pal = [0xc0503a, 0x3a6ab0, 0xd0a030, 0x3a8a5a, 0x8a8a8a];
  b.box(6, 2.6, 2.6, pal[0], [5.5, 1.9, -2.2]);
  b.box(6, 2.6, 2.6, pal[1], [5.5, 1.9, 1.6], [0, 0.1, 0]);
  b.box(6, 2.6, 2.6, pal[2], [6.5, 4.5, -1.5], [0.4, 0.2, 0]);
  b.anchor('wreck-hold', [6, 3, 0]);
  b.finish();

  // containers spilled on the seabed
  const c = new Kit(S, 'wreck-cargo', P.x, P.z, P.rot);
  for (let i = 0; i < 6; i++) {
    const x = -10 + rnd() * 40, z = 9 + rnd() * 14 * (rnd() < 0.5 ? 1 : -1.6);
    c.box(6, 2.6, 2.6, pal[i % pal.length], [x, c.gy(x, z) + 0.9, z], [rnd() * 0.4 - 0.2, rnd() * PI, rnd() < 0.3 ? PI / 2 : 0.1]);
  }
  c.clear(46, [4, 0, 0]);
  c.finish();
}

function boat(S) {
  const P = POIS.boat;
  const k = new Kit(S, 'boat', P.x, P.z, [0.35, P.rot, 0.05]).settle([[-4, 0], [4, 0], [0, 1], [0, -1]], 0.35);
  k.box(7, 0.3, 2.8, 0xe8e4da, [0, 0.15, 0]);
  for (const s of [-1, 1]) {
    k.box(7, 1.3, 0.2, 0xe8e4da, [0, 0.95, 1.4 * s]);
    k.box(7, 0.25, 0.22, 0x2a5a9a, [0, 1.35, 1.4 * s], 0, { collide: false });
    k.box(2.3, 1.3, 0.2, 0xe8e4da, [4.3, 0.95, 0.75 * s], [0, 0.6 * s, 0]);
  }
  k.box(0.2, 1.3, 2.8, 0xe8e4da, [-3.5, 0.95, 0]);
  k.box(2.4, 1.8, 2.0, 0xd8d0c0, [-1.4, 2.1, 0]);
  k.box(0.05, 0.6, 1.4, 0x406080, [-0.18, 2.4, 0], 0, { bucket: 'glass', collide: false });
  k.cyl(0.08, 0.1, 4, 0x8a6a4a, [1.2, 3, 0]);
  k.box(0.9, 0.5, 0.6, 0x8a6a4a, [1.8, 0.55, -0.6], [0, 0.3, 0]);
  k.anchor('boat', [1.8, 1.1, -0.6]);
  k.clear(9);
  k.finish();
}

function ruins(S) {
  const P = POIS.ruins;
  const rnd = mulberry32(123);
  const k = new Kit(S, 'ruins', P.x, P.z, 0.3).settle([[0, 0], [10, 10], [-10, -10], [10, -10], [-10, 10]], 0.6);
  k.box(24, 3, 24, C.stone, [0, 1.5, 0]);
  k.box(17, 3, 17, C.stoneDark, [0, 4.5, 0]);
  k.box(10, 3, 10, C.stone, [0, 7.5, 0]);
  for (let i = 0; i < 7; i++) k.box(2 + rnd(), 1.4, 2 + rnd(), C.stoneDark, [9 + rnd() * 6, k.gy(12, 12) + 0.6, 9 + rnd() * 6], [rnd() * 0.5, rnd() * 3, rnd() * 0.5]);
  // the monolith and its glyph bands
  k.box(1.6, 8, 1.0, 0x5a5650, [0, 13, 0]);
  for (const y of [10.4, 12, 13.6, 15.2]) k.box(1.64, 0.14, 1.04, C.rune, [0, y, 0], 0, { bucket: 'glow', k: 2.2 });
  k.light([0, 13, 0], 0x50ffd0, 20);
  k.anchor('ruins-monolith', [0, 11, 2.2]);
  // column ring
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * PI * 2, x = Math.cos(a) * 32, z = Math.sin(a) * 32, g = k.gy(x, z);
    const intact = i % 3 === 0, h = intact ? 11 : 3 + rnd() * 6;
    k.cyl(1.0, 1.15, h + 1, C.stone, [x, g + h / 2 - 0.5, z], 0, { seg: 12 });
    if (intact) k.box(2.8, 0.8, 2.8, C.stoneDark, [x, g + h + 0.4, z], [0, a, 0]);
    else if (rnd() < 0.6) {
      const fa = rnd() * PI * 2, fl = 4 + rnd() * 4;
      const fx = x + Math.cos(fa) * (fl / 2 + 1.5), fz = z + Math.sin(fa) * (fl / 2 + 1.5);
      k.cyl(1.0, 1.0, fl, C.stone, [fx, k.gy(fx, fz) + 0.7, fz], [PI / 2, PI / 2 - fa, 0], { seg: 12 });
    }
  }
  // arches
  for (let i = 0; i < 4; i++) {
    const a = (i * PI) / 2 + 0.4, cx = Math.cos(a) * 52, cz = Math.sin(a) * 52, tx = -Math.sin(a), tz = Math.cos(a);
    for (const s of [-1, 1]) { const x = cx + tx * 4 * s, z = cz + tz * 4 * s; k.box(2, 11, 2, C.stone, [x, k.gy(x, z) + 4.5, z], [0, -a, 0]); }
    const g = k.gy(cx, cz);
    if (i === 2) k.box(10, 1.6, 2.4, C.stoneDark, [cx + Math.cos(a) * 5, k.gy(cx + Math.cos(a) * 5, cz + Math.sin(a) * 5) + 0.6, cz + Math.sin(a) * 5], [0.2, -a + PI / 2 + 0.3, 0.1]);
    else k.box(10.5, 1.6, 2.4, C.stoneDark, [cx, g + 10.8, cz], [0, -a + PI / 2, 0]);
  }
  // the watcher mask, half buried
  const mz = -24, mg = k.gy(0, mz);
  k.box(6, 7, 2, 0x7a7466, [0, mg + 2.2, mz], [-0.45, 0, 0.12]);
  k.box(2.2, 3, 1.2, 0x7a7466, [0, mg + 1.6, mz + 1.2], [-0.45, 0, 0.12]);
  for (const s of [-1, 1]) k.box(1.4, 0.3, 0.3, C.rune, [1.4 * s, mg + 3.9, mz + 1.6], [-0.45, 0, 0.12], { bucket: 'glow', k: 2.5 });
  k.anchor('ruins-mask', [0, mg + 2.5, mz + 4]);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * PI * 2, r = 16 + rnd() * 32, x = Math.cos(a) * r, z = Math.sin(a) * r;
    k.box(2.6 + rnd(), 0.35, 2.6 + rnd(), rnd() < 0.5 ? C.stone : C.stoneDark, [x, k.gy(x, z) + 0.05, z], [rnd() * 0.1, rnd() * 3, rnd() * 0.1], { collide: false });
  }
  k.clear(60);
  k.finish();
}

function gate(S) {
  const P = POIS.gate;
  const k = new Kit(S, 'gate', P.x, P.z, PI / 2).settle([[0, 0], [-11, 0], [11, 0]], 1);
  k.torus(22, 2.0, 0x3a3f4a, [0, 26, 0], 0, { rs: 12, ts: 96 });
  k.torus(20.3, 0.35, 0x60e0ff, [0, 26, 0], 0, { bucket: 'glow', k: 2.4, ts: 96 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2 + PI / 8;
    k.box(4.8, 0.9, 4.5, 0x9af0ff, [Math.cos(a) * 22, 26 + Math.sin(a) * 22, 0], [0, 0, a], { bucket: 'glow', k: 2.0 });
  }
  for (const s of [-1, 1]) {
    k.box(3.5, 10, 4.5, 0x2e323a, [11.5 * s, 3.5, 0], [0, 0, 0.3 * s]);
    k.box(2, 18, 2, 0x2e323a, [32 * s, k.gy(32 * s, 0) + 8, 0]);
    k.box(2.1, 0.3, 2.1, 0x9af0ff, [32 * s, k.gy(32 * s, 0) + 16.5, 0], 0, { bucket: 'glow', k: 2.5 });
  }
  k.light([0, 26, 0], 0x60e0ff, 45);
  k.anchor('gate', [0, 8, 5]);
  k.clear(36);
  k.finish();
}

function vents(S) {
  const P = POIS.vents;
  const rnd = mulberry32(55);
  const k = new Kit(S, 'vents', P.x, P.z);
  const list = [];
  for (let i = 0; i < 7; i++) {
    const a = rnd() * PI * 2, r = i === 0 ? 0 : 8 + rnd() * 24, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = i === 0 ? 16 : 4 + rnd() * 9, rb = 1.6 + h * 0.1 + rnd(), rt = 0.5 + rnd() * 0.4, g = k.gy(x, z) - 1;
    k.cyl(rt, rb, h, 0x2a2522, [x, g + h / 2, z], 0, { seg: 10 });
    k.cyl(rt * 0.75, rt * 0.9, 0.35, 0xff6a20, [x, g + h + 0.05, z], 0, { bucket: 'glow', k: 3, collide: false, seg: 10 });
    k.cyl(rb * 0.9, rb * 1.08, 0.5, 0x5a3a20, [x, g + h * 0.35, z], 0, { collide: false, seg: 10 });
    const v = k.wp([x, g + h + 0.3, z]);
    S.emitters.push({ x: v.x, y: v.y, z: v.z, rate: h / 16, type: 'vent' });
    list.push([h, x, g + h + 1, z]);
  }
  list.sort((a, b) => b[0] - a[0]);
  for (const [, x, y, z] of list.slice(0, 2)) k.light([x, y, z], 0xff6020, 22, 'flicker');
  k.anchor('vents', [list[0][1] + 4, list[0][2] - 6, list[0][3]]);
  k.clear(38);
  k.finish();
}

function bones(S) {
  const P = POIS.bones;
  const k = new Kit(S, 'bones', P.x, P.z, P.rot).settle([[0, 0], [-20, 0], [20, 0], [28, 0]], 0.5);
  const ribR = (x) => Math.max(1.5, 7.5 * (1 - ((x - 2) / 30) ** 2));
  let prev = null;
  for (let x = -30; x <= 22; x += 2.6) {
    const R = ribR(x), y = x < -16 ? R - 1 + (x + 16) * 0.12 : R - 1;
    const v = k.wp([x, y, 0]);
    k.sphere(1.0, C.bone, [x, y, 0], [0, 0, 0.3], { scale: [1.2, 0.9, 1.1], ws: 10, hs: 8, collide: false });
    k.box(0.4, 1.6, 0.5, C.bone, [x, y + 1.0, 0], 0, { collide: false });
    if (prev) S.colliders.addCapsule(prev.x, prev.y, prev.z, v.x, v.y, v.z, 0.9);
    prev = v;
    if (x > -17 && x < 14) k.torus(R, 0.32 + R * 0.02, C.bone, [x, -1, 0], [0, PI / 2, 0], { arc: PI, rs: 6, ts: 20 });
  }
  k.sphere(3, C.bone, [27, 2.8, 0], [0, 0, -0.15], { scale: [2.0, 1.0, 1.3], ws: 18, hs: 12 });
  k.box(8, 0.8, 2.6, C.bone, [31, 0.7, 0], [0, 0, 0.12]);
  for (const s of [-1, 1]) k.sphere(0.7, 0x2a2620, [29.5, 3.4, 1.5 * s], 0, { ws: 8, hs: 6, collide: false });
  for (let i = 0; i < 8; i++) k.cyl(0, 0.22, 1.2, C.bone, [28.5 + i * 0.8, 1.6, (i % 2 ? 1 : -1) * 1.1], [PI, 0, 0], { collide: false, seg: 6 });
  k.anchor('bones', [0, 1.8, 0]);
  k.clear(36, [0, 0, 0]);
  k.finish();
}

function choir(S) {
  const P = POIS.choir;
  const rnd = mulberry32(31);
  const k = new Kit(S, 'choir', P.x, P.z);
  const cols = [];
  for (let tries = 0; cols.length < 46 && tries < 600; tries++) {
    const a = rnd() * PI * 2, r = Math.sqrt(rnd()) * 130, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const rad = 1.4 + rnd() * 1.8;
    if (cols.some((c) => Math.hypot(c.x - x, c.z - z) < c.rad + rad + 1.5)) continue;
    const h = (6 + rnd() ** 2 * 26) * (1 + 0.6 * (1 - r / 130));
    cols.push({ x, z, rad, h });
  }
  for (const c of cols) {
    const g = k.gy(c.x, c.z) - 2, col = new THREE.Color(0x34383e).lerp(new THREE.Color(0x5a5c60), rnd());
    k.cyl(c.rad * 0.92, c.rad, c.h + 2, col, [c.x, g + (c.h + 2) / 2, c.z], [rnd() * 0.08 - 0.04, rnd(), rnd() * 0.08 - 0.04], { seg: 6 });
    if (rnd() < 0.35) k.cyl(c.rad * 1.02, c.rad * 1.04, 0.4, 0x50ffa0, [c.x, g + 2 + rnd() * c.h * 0.7, c.z], 0, { bucket: 'glow', k: 1.1, seg: 6 });
  }
  k.anchor('choir', [0, k.gy(0, 0) + 4, 0]);
  S.choir = { x: P.x, z: P.z, columns: cols.length };
  k.finish();
}

function summit(world, I, frac = 0.5) {
  let best = [I.x, I.z, -1e9];
  for (let dx = -I.r * frac; dx <= I.r * frac; dx += 3) for (let dz = -I.r * frac; dz <= I.r * frac; dz += 3) {
    const h = world.heightAt(I.x + dx, I.z + dz);
    if (h > best[2]) best = [I.x + dx, I.z + dz, h];
  }
  return best;
}

function stones(S) {
  const I = ISLANDS.find((i) => i.id === POIS.stones.island);
  const [x, z] = summit(S.world, I);
  const rnd = mulberry32(17);
  const k = new Kit(S, 'stones', x, z);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * PI * 2, sx = Math.cos(a) * 7.5, sz = Math.sin(a) * 7.5, h = 3.2 + rnd() * 1.6;
    const tone = [0xa19c92, 0x9a968c, 0xa8a090][i % 3]; // pale weathered granite; the old 0x8a8680 read near-black on shadowed faces
    k.stone(1.3, h + 1, 0.8, tone, [sx, k.gy(sx, sz) + h / 2 - 0.5, sz], [rnd() * 0.12 - 0.06, -a + PI / 2, rnd() * 0.1 - 0.05], i * 3.1);
  }
  const g = k.gy(0, 0);
  k.stone(4.6, 0.7, 1.1, 0x948e84, [Math.cos(0.35) * 7.6, k.gy(7.6, 2.6) + 4.6, Math.sin(0.35) * 7.6], [0, -0.35 + PI, 0], 40);
  k.stone(2.4, 0.9, 1.6, 0x948e84, [0, g + 0.35, 0], [0, 0.4, 0], 50);
  k.torus(0.55, 0.05, 0xc080ff, [0, g + 0.82, 0], [PI / 2, 0, 0], { bucket: 'glow', k: 2, collide: false });
  k.torus(0.28, 0.04, 0xc080ff, [0, g + 0.82, 0], [PI / 2, 0, 0], { bucket: 'glow', k: 2, collide: false });
  k.light([0, g + 1.5, 0], 0xb070ff, 7, 'steady', true);
  k.anchor('stones', [0, g + 1.2, 1.4]);
  k.clear(11);
  k.finish();
}

function lighthouse(S) {
  const I = ISLANDS.find((i) => i.id === POIS.lighthouse.island);
  const [x, z] = summit(S.world, I, 0.35);
  const k = new Kit(S, 'lighthouse', x, z).settle([[-3, -3], [3, 3], [3, -3], [-3, 3]], 0.5);
  for (let i = 0; i < 4; i++) {
    const r0 = 3.2 - i * 0.25, r1 = r0 - 0.25;
    k.cyl(r1, r0, 4, i % 2 ? 0xb03a2e : 0xece8e0, [0, 2 + i * 4, 0], 0, { seg: 24, collide: false });
  }
  S.colliders.addCylinder(k.base.clone().multiply(mat4([0, 8, 0])), 2.75, 8);
  k.cyl(3.4, 3.4, 0.35, 0x30302e, [0, 16.2, 0], 0, { seg: 24 });
  k.torus(3.3, 0.06, 0x30302e, [0, 17.2, 0], [PI / 2, 0, 0], { collide: false, ts: 40 });
  for (let i = 0; i < 12; i++) k.cyl(0.04, 0.04, 1, 0x30302e, [Math.cos(i * 0.5236) * 3.3, 16.7, Math.sin(i * 0.5236) * 3.3], 0, { collide: false, seg: 4 });
  k.cyl(1.7, 1.7, 2.6, C.glass, [0, 17.7, 0], 0, { bucket: 'glass', seg: 16 });
  k.sphere(0.55, 0xffe0a0, [0, 17.6, 0], 0, { bucket: 'glow', k: 4, collide: false });
  k.cyl(0, 2.0, 1.6, 0xb03a2e, [0, 19.8, 0], 0, { seg: 16 });
  k.sphere(0.25, 0x30302e, [0, 20.7, 0], 0, { collide: false });
  k.box(1.2, 2.2, 0.4, 0x3a2a20, [0, 1.1, 3.0], 0, { collide: false });
  for (const y of [6, 10, 14]) k.box(0.5, 0.9, 0.3, 0x202428, [0, y, 3.05 - y * 0.06], 0, { collide: false });
  k.light([0, 17.6, 0], 0xffd890, 26, 'steady', true);
  k.anchor('lighthouse', [0, 1.4, 4.4]);
  k.clear(7);
  k.finish();
  // rotating beam, only drawn at night
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const beam = new THREE.Group();
  for (const s of [-1, 1]) {
    const g = new THREE.ConeGeometry(7, 90, 24, 1, true);
    g.translate(0, -45, 0);
    g.rotateZ((PI / 2) * s);
    beam.add(new THREE.Mesh(g, beamMat));
  }
  beam.position.copy(k.wp([0, 17.6, 0]));
  beam.renderOrder = 6;
  S.scene.add(beam);
  S.beam = beam;
}

function camp(S) {
  const P = POIS.camp;
  const k = new Kit(S, 'camp', P.x, P.z, 0.7);
  const g = k.gy(0, 0);
  for (const s of [-1, 1]) k.box(3.2, 0.06, 2.1, 0xc87a3a, [0, g + 0.85, 0.6 * s], [0.956 * s, 0, 0]);
  k.cyl(0.04, 0.04, 2.0, 0x6a4a2a, [1.6, g + 0.9, 0], 0, { collide: false });
  const fx = 2.8, fz = 2.2, fg = k.gy(fx, fz);
  for (let i = 0; i < 8; i++) k.sphere(0.24, 0x6a6660, [fx + Math.cos(i * 0.785) * 0.7, fg + 0.05, fz + Math.sin(i * 0.785) * 0.7], 0, { scale: [1, 0.6, 1], ws: 8, hs: 6, collide: false });
  for (let i = 0; i < 3; i++) k.cyl(0.09, 0.09, 1.1, 0x4a3020, [fx, fg + 0.15, fz], [PI / 2, i * 1.05, 0], { collide: false, seg: 6 });
  k.cyl(0, 0.32, 0.9, 0xff7a20, [fx, fg + 0.6, fz], 0, { bucket: 'glow', k: 3, seg: 7 });
  k.cyl(0, 0.2, 0.6, 0xffd060, [fx + 0.1, fg + 0.5, fz - 0.05], [0, 0.5, 0.15], { bucket: 'glow', k: 3, seg: 6 });
  k.light([fx, fg + 1.2, fz], 0xff8a30, 14, 'flicker');
  S.emitters.push({ ...vec(k.wp([fx, fg + 1.1, fz])), rate: 0.5, type: 'smoke' });
  k.cyl(0.25, 0.25, 2.2, 0x6a4a2a, [fx + 1.8, k.gy(fx + 1.8, fz) + 0.2, fz], [PI / 2, 0.3, 0]);
  k.box(0.8, 0.7, 0.8, 0x9a7a4a, [1.0, k.gy(1, 2.6) + 0.35, 2.6], [0, 0.4, 0]);
  k.cyl(0.35, 0.35, 0.9, 0x3a5a7a, [-0.3, k.gy(-0.3, 2.9) + 0.45, 2.9]);
  k.anchor('camp', [1.0, k.gy(1, 2.6) + 0.9, 2.6]);
  k.clear(7, [1, 0, 1]);
  k.finish();
}

function ember(S) {
  const I = ISLANDS.find((i) => i.id === POIS.ember.island);
  const k = new Kit(S, 'ember', I.x, I.z);
  let sum = 0, n = 0;
  for (let a = 0; a < PI * 2; a += 0.5) { sum += k.gy(Math.cos(a) * 9, Math.sin(a) * 9); n++; }
  const y = Math.max(sum / n, k.gy(0, 0)) + 0.5;
  k.cyl(11, 11, 0.6, 0xff5a1a, [0, y, 0], 0, { bucket: 'glow', k: 2.2, seg: 32 });
  k.cyl(5, 6, 0.65, 0xffc040, [2, y + 0.02, -1], 0, { bucket: 'glow', k: 2.0, seg: 20 });
  k.light([0, y + 4, 0], 0xff5020, 34, 'flicker');
  S.emitters.push({ ...vec(k.wp([0, y + 1, 0])), rate: 1.5, type: 'smoke' });
  k.anchor('ember', [0, y + 6, 12]);
  k.finish();
}

const vec = (v) => ({ x: v.x, y: v.y, z: v.z });

export class Structures {
  constructor(scene, world, colliders) {
    this.scene = scene;
    this.world = world;
    this.colliders = colliders;
    this.meshes = [];
    this.lights = []; // {x,y,z,r,color,mode,night}
    this.anchors = {}; // discovery id -> world Vector3
    this.emitters = []; // smoke / vent particle sources
    this.clearings = []; // vegetation keeps out of these circles
    this.beam = null;
    this.flows = []; // scrolling water materials (waterfall, stream)
    [station, wreck, boat, ruins, gate, vents, bones, choir, stones, lighthouse, camp, ember, falls, giantTree, seaArch].forEach((f) => f(this));
    world.colliders = colliders;
    world.clearings = this.clearings;
  }

  update(time, day) {
    for (const m of this.flows) m.map.offset.y = time * m.userData.speed;
    const under = U.uCamUnder.value > 0.5;
    for (const m of this.meshes) if (m.userData.deep) m.visible = under;
    if (!this.beam) return;
    const night = 1 - day;
    this.beam.visible = night > 0.05;
    this.beam.rotation.y = time * 0.5;
    this.beam.children[0].material.opacity = 0.09 * night;
  }

  // Light intensity multiplier for the shared glow-light slots
  lightLevel(L, time, day) {
    let k = 1;
    if (L.mode === 'flicker') k = 0.75 + 0.15 * Math.sin(time * 9 + L.phase) + 0.1 * Math.sin(time * 23.7 + L.phase * 3);
    else if (L.mode === 'blink') k = (time + L.phase) % 2 < 0.25 ? 1 : 0.05;
    if (L.night) k *= 0.25 + 0.75 * (1 - day);
    return k;
  }
}
