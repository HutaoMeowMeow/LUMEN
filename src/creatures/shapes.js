// Procedural creature meshes. Every shape is built at unit scale facing +Z, with vertex colours and an aGlow attribute.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const C = (h) => new THREE.Color(h);

// paint(x, y, z) -> [color, glow]
function paint(geo, fn) {
  geo.deleteAttribute('uv');
  const p = geo.attributes.position, n = p.count;
  const col = new Float32Array(n * 3), glow = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [c, g] = fn(p.getX(i), p.getY(i), p.getZ(i));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    glow[i] = g;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  return geo;
}

function tri(verts, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts.flat(), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(verts.length * 2).fill(0), 2));
  return g;
}

// A fish one unit long. o: { h, w, top, belly, fin, stripe, stripeFreq, spots, glowLine, taper, fins: 'fork'|'round'|'fluke', pecs, eyeGlow, finGlow }
export function fishShape(o) {
  const h = o.h ?? 0.28, w = o.w ?? 0.12;
  const top = C(o.top), belly = C(o.belly), fin = C(o.fin ?? o.top), stripe = o.stripe ? C(o.stripe) : null, spots = o.spots ? C(o.spots) : null;
  const body = new THREE.SphereGeometry(0.5, 16, 10);
  body.rotateX(Math.PI / 2);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), t = z / 0.5; // -1 tail .. 1 head
    const k = t < 0 ? 1 + (o.taper ?? 0.7) * t : 1 - 0.15 * t * t;
    p.setXYZ(i, p.getX(i) * w * 2 * k, p.getY(i) * h * 2 * k, z);
  }
  body.computeVertexNormals();
  paint(body, (x, y, z) => {
    let c = belly.clone().lerp(top, ss(-0.25 * h, 0.3 * h, y));
    let g = 0;
    if (stripe && Math.sin(z * (o.stripeFreq ?? 18)) > 0.55 && Math.abs(z) < 0.38) c = stripe.clone();
    if (spots && Math.abs(y + 0.02) < h * 0.12 && Math.sin(z * 40) > 0.3) { c = spots.clone(); g = 1; }
    if (o.glowLine && Math.abs(Math.abs(y) - h * 0.22) < h * 0.05) { c = C(o.glowLine); g = 1; }
    return [c, g];
  });
  const parts = [body];
  const tz = -0.42;
  const tail = o.fins === 'fluke'
    ? tri([[0, 0, tz], [w * 2.4, 0, tz - 0.2], [0, 0, tz - 0.12], [-w * 2.4, 0, tz - 0.2]], [0, 1, 2, 0, 2, 3])
    : o.fins === 'round'
      ? tri([[0, 0, tz], [0, h * 0.45, tz - 0.2], [0, 0, tz - 0.25], [0, -h * 0.45, tz - 0.2]], [0, 1, 2, 0, 2, 3])
      : tri([[0, 0, tz], [0, h * 0.75, tz - 0.22], [0, 0, tz - 0.13], [0, -h * 0.75, tz - 0.22]], [0, 1, 2, 0, 2, 3]);
  parts.push(paint(tail, () => [fin, o.finGlow ? 0.6 : 0]));
  if (o.fins !== 'fluke') parts.push(paint(tri([[0, h * 0.4, 0.12], [0, h * 0.95, -0.08], [0, h * 0.38, -0.22]], [0, 1, 2]), () => [fin, 0]));
  if (o.pecs) for (const s of [-1, 1]) {
    parts.push(paint(tri([[s * w * 0.8, -h * 0.15, 0.18], [s * (w + o.pecs), -h * 0.45, -0.02], [s * w * 0.8, -h * 0.25, 0.0]], [0, 1, 2]), () => [fin, 0]));
  }
  for (const s of [-1, 1]) {
    const e = new THREE.SphereGeometry(h * 0.075, 6, 4);
    e.translate(s * w * 0.78, h * 0.1, 0.33);
    parts.push(paint(e, () => [C(0x101010), o.eyeGlow ? 1 : 0]));
  }
  if (o.lure) { // a glowing bait on a stalk arching over the head
    const st = new THREE.CylinderGeometry(0.006, 0.012, 0.36, 4, 1);
    st.translate(0, 0.18, 0);
    st.rotateX(0.75);
    st.translate(0, h * 0.42, 0.22);
    parts.push(paint(st, () => [top, 0]));
    const b = new THREE.SphereGeometry(0.035, 8, 6);
    b.translate(0, h * 0.42 + 0.36 * Math.cos(0.75), 0.22 + 0.36 * Math.sin(0.75));
    parts.push(paint(b, () => [C(o.lure), 1]));
  }
  return mergeGeometries(parts);
}

// Baleen whale one unit long: blunt head, slender tail stock, long pectorals, wide fluke, pale grooved throat
export function whaleShape(o) {
  const h = 0.085, w = 0.08, top = C(o.top), belly = C(o.belly), fin = C(o.fin);
  const body = new THREE.SphereGeometry(0.5, 28, 16);
  body.rotateX(Math.PI / 2);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), t = z / 0.5;
    const k = t > 0 ? Math.pow(Math.max(0, 1 - t ** 4), 0.5) : Math.pow(Math.max(0, 1 - t * t), 0.3) * (1 + t * 0.86);
    const y = p.getY(i) * h * 2 * k;
    p.setXYZ(i, p.getX(i) * w * 2 * k, y < 0 ? y * 0.85 : y, z);
  }
  body.computeVertexNormals();
  paint(body, (x, y, z) => {
    let c = belly.clone().lerp(top, ss(-0.3 * h, 0.25 * h, y)), g = 0;
    if (y < -0.35 * h && z > 0.05 && Math.sin(x * 160) > 0.5) c.multiplyScalar(0.72); // throat grooves
    if (y > 0 && Math.sin(x * 53 + z * 7) * Math.sin(z * 61) > 0.82) c.lerp(belly, 0.35); // pale mottling
    if (o.glowLine && Math.abs(y + h * 0.05) < h * 0.05 && z < 0.3) { c = C(o.glowLine); g = 1; }
    return [c, g];
  });
  const parts = [body];
  parts.push(paint(tri([[0, 0, -0.44], [0.2, 0.012, -0.56], [0.03, 0, -0.52], [0, 0, -0.5], [-0.03, 0, -0.52], [-0.2, 0.012, -0.56]],
    [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]), () => [fin, 0]));
  parts.push(paint(tri([[0, h * 0.7, -0.14], [0, h * 1.15, -0.24], [0, h * 0.62, -0.28]], [0, 1, 2]), () => [fin, 0]));
  for (const s of [-1, 1]) {
    parts.push(paint(tri([[s * w * 0.85, -h * 0.35, 0.24], [s * w * 0.85, -h * 0.5, 0.13], [s * (w + 0.26), -h * 1.6, -0.06], [s * (w + 0.22), -h * 1.5, 0.0]],
      [0, 1, 2, 0, 2, 3]), (x) => [fin.clone().lerp(belly, ss(0.15, 0.3, Math.abs(x))), 0]));
    const e = new THREE.SphereGeometry(0.008, 6, 4);
    e.translate(s * w * 0.9, -h * 0.2, 0.36);
    parts.push(paint(e, () => [C(0x0a0a0a), 0]));
  }
  return mergeGeometries(parts);
}

// Sea turtle one unit long: domed shell with scutes, pale plastron, long front flippers, small rear ones
export function turtleShape() {
  const shellC = C(0x5a4a2c), scute = C(0x3a2e1c), skin = C(0x6a6a52), plast = C(0xc8b88a);
  const shell = new THREE.SphereGeometry(0.4, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  shell.scale(0.85, 0.42, 1.05);
  paint(shell, (x, y, z) => [Math.abs(Math.sin(x * 22)) < 0.12 || Math.abs(Math.sin(z * 18 + Math.abs(x) * 6)) < 0.1 ? scute : shellC.clone().lerp(C(0x8a7040), ss(0.0, 0.17, y) * 0.5), 0]);
  const plastron = new THREE.CircleGeometry(0.4, 18);
  plastron.rotateX(Math.PI / 2);
  plastron.scale(0.85, 1, 1.05);
  plastron.translate(0, -0.01, 0);
  const parts = [shell, paint(plastron, () => [plast, 0])];
  const head = new THREE.SphereGeometry(0.1, 10, 8);
  head.scale(0.9, 0.8, 1.3);
  head.translate(0, 0.02, 0.5);
  parts.push(paint(head, (x, y) => [y > 0.04 ? skin.clone().multiplyScalar(0.8) : skin, 0]));
  for (const s of [-1, 1]) {
    parts.push(paint(tri([[s * 0.28, 0, 0.25], [s * 0.3, 0, 0.1], [s * 0.82, -0.03, -0.1], [s * 0.78, -0.03, 0.02]], [0, 1, 2, 0, 2, 3]), () => [skin, 0]));
    parts.push(paint(tri([[s * 0.22, 0, -0.3], [s * 0.18, 0, -0.38], [s * 0.42, -0.02, -0.5]], [0, 1, 2]), () => [skin, 0]));
  }
  return mergeGeometries(parts);
}

// Bell jellyfish about one unit tall (bell top at y = 0.25, tentacles hang to y = -1)
export function jellyShape(bellCol, glowCol) {
  const bc = C(bellCol), gc = C(glowCol);
  const bell = new THREE.SphereGeometry(0.3, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  bell.scale(1, 0.85, 1);
  paint(bell, (x, y) => [bc.clone().lerp(gc, ss(0.12, -0.02, y)), ss(0.1, -0.02, y) * 0.8 + 0.15]);
  const parts = [bell];
  const inner = new THREE.SphereGeometry(0.13, 10, 6);
  inner.translate(0, 0.07, 0);
  parts.push(paint(inner, () => [gc, 1]));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const t = new THREE.CylinderGeometry(0.006, 0.012, 0.9 + (i % 3) * 0.15, 3, 6, true);
    t.translate(Math.cos(a) * 0.24, -0.45 - (i % 3) * 0.07, Math.sin(a) * 0.24);
    parts.push(paint(t, (x, y) => [gc, 0.4 + 0.5 * ss(-0.2, -0.9, y)]));
  }
  for (let i = 0; i < 4; i++) {
    const r = new THREE.PlaneGeometry(0.07, 0.75, 1, 6);
    r.translate(0, -0.42, 0);
    r.rotateY((i / 4) * Math.PI);
    parts.push(paint(r, () => [bc, 0.5]));
  }
  return mergeGeometries(parts);
}

// Ray: wingspan 1 along x, faces +Z
export function rayShape(top, under, spot) {
  const tc = C(top), uc = C(under), sc = C(spot);
  const g = new THREE.PlaneGeometry(1, 0.75, 12, 6);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), ax = Math.abs(x) * 2;
    const zz = (z + 0.06) * (1 - ax * 0.85) - ax * 0.08; // swept diamond
    p.setXYZ(i, x, 0.05 * (1 - ax) * (1 - Math.abs(z) * 2.2), zz);
  }
  g.computeVertexNormals();
  paint(g, (x, y, z) => [Math.sin(x * 37) * Math.sin(z * 41) > 0.7 ? sc : tc.clone().lerp(uc, ss(0.3, 0.5, Math.abs(x))), 0]);
  const tail = new THREE.CylinderGeometry(0.004, 0.012, 0.7, 4, 1);
  tail.rotateX(Math.PI / 2);
  tail.translate(0, 0, -0.55);
  return mergeGeometries([g, paint(tail, () => [tc, 0])]);
}

// Seabird: wingspan 1
export function birdShape() {
  const body = new THREE.SphereGeometry(0.06, 8, 6);
  body.scale(1, 0.9, 3.2);
  paint(body, (x, y) => [C(y > 0.02 ? 0xb8bcc0 : 0xf2f2ee), 0]);
  const parts = [body];
  for (const s of [-1, 1]) {
    const wg = tri([[0, 0, 0.08], [s * 0.5, 0.02, -0.04], [s * 0.18, 0, -0.1], [0, 0, -0.06]], [0, 1, 2, 0, 2, 3]);
    parts.push(paint(wg, (x) => [Math.abs(x) > 0.4 ? C(0x2a2a2a) : C(0xe8e8e4), 0]));
  }
  const beak = new THREE.ConeGeometry(0.015, 0.07, 4);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 0, 0.22);
  parts.push(paint(beak, () => [C(0xe0a020), 0]));
  return mergeGeometries(parts);
}
