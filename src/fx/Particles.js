// Marine snow (GPU-wrapped around the camera), bubbles and smoke (small CPU pools).
import * as THREE from 'three';
import { U } from './materials.js';

const SNOW_BOX = 56;

const SNOW_VERT = /* glsl */ `
uniform float uTime, uSize;
uniform vec3 uCam;
attribute float aSeed;
varying float vA;
void main() {
  vec3 drift = vec3(sin(uTime * 0.07 + aSeed * 6.0) * 0.6, -0.12 - aSeed * 0.1, cos(uTime * 0.05 + aSeed * 4.0) * 0.6) * uTime;
  vec3 p = mod(position + drift - uCam + ${SNOW_BOX / 2}.0, ${SNOW_BOX}.0) - ${SNOW_BOX / 2}.0 + uCam;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  gl_PointSize = uSize * (0.5 + aSeed) * 30.0 / max(d, 0.5);
  vA = smoothstep(${SNOW_BOX / 2}.0, 6.0, d) * smoothstep(0.3, 1.2, d) * step(p.y, -0.3);
}`;
const SNOW_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, r) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a * 0.55);
}`;

const POOL_VERT = /* glsl */ `
attribute float aSize, aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(aSize * uScale / max(-mv.z, 0.3), 256.0);
  vAlpha = aAlpha;
  vColor = aColor;
}`;
const BUBBLE_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = length(q);
  if (r > 0.5) discard;
  float rim = smoothstep(0.32, 0.47, r) * smoothstep(0.5, 0.46, r);
  float hi = smoothstep(0.16, 0.0, length(q - vec2(-0.15, -0.15)));
  gl_FragColor = vec4(vColor * (rim + hi * 1.5 + 0.08), (rim * 0.8 + hi + 0.06) * vAlpha);
}`;
const SMOKE_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, r);
  gl_FragColor = vec4(vColor, a * a * vAlpha);
}`;

class Pool {
  constructor(scene, n, frag) {
    this.n = n;
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.size = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.col = new Float32Array(n * 3);
    this.kind = new Uint8Array(n);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 300 } }, vertexShader: POOL_VERT, fragmentShader: frag,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, life, size, grow, r, g, b, kind = 0) {
    const i = this.next;
    this.next = (i + 1) % this.n;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life;
    this.size0[i] = size; this.grow[i] = grow;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.kind[i] = kind;
  }
  flush() {
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = a.aColor.needsUpdate = true;
    this.mat.uniforms.uScale.value = window.innerHeight * 0.005;
  }
}

export class Particles {
  constructor(scene, quality, oceanHeight) {
    this.oceanHeight = oceanHeight; // (x, z) => surface height
    const n = { low: 1200, medium: 2600, high: 4200, ultra: 7000 }[quality] ?? 3000;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.random() * SNOW_BOX; pos[i * 3 + 1] = Math.random() * SNOW_BOX; pos[i * 3 + 2] = Math.random() * SNOW_BOX;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.snowU = { uTime: U.uTime, uSize: { value: 1.6 }, uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(0.75, 0.9, 0.95) } };
    this.snow = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.snowU, vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG, transparent: true, depthWrite: false,
    }));
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 7;
    scene.add(this.snow);
    this.bubbles = new Pool(scene, 600, BUBBLE_FRAG);
    this.smoke = new Pool(scene, quality === 'low' ? 250 : 600, SMOKE_FRAG);
  }

  bubble(x, y, z, n = 1, spread = 0.2, size = 1) {
    for (let i = 0; i < n; i++) {
      const s = (0.04 + Math.random() * 0.08) * size;
      this.bubbles.spawn(x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread, z + (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * 0.4, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 0.4, 8 + Math.random() * 10, s, 0, 0.85, 0.95, 1);
    }
  }

  // emitters: [{x,y,z,rate,type:'vent'|'smoke'|'bubbles'|'mist'|'spout'}]
  update(dt, camera, emitters) {
    const cp = camera.position;
    this.snowU.uCam.value.copy(cp);
    this.snow.visible = U.uCamUnder.value > 0.5;
    // snow is lit by the same depth/daylight curve as the water, with a faint floor so the lamp still picks it out
    this.snowU.uColor.value.setRGB(0.75, 0.9, 0.95).multiplyScalar(Math.min(1, 0.1 + U.uWaterShallow.value.g / 0.27));
    const t = U.uTime.value;
    for (const e of emitters) {
      if (Math.hypot(e.x - cp.x, e.y - cp.y, e.z - cp.z) > (e.type === 'bubbles' ? 70 : 260)) continue;
      // expected spawns this frame; the fractional part spawns with that probability
      for (let k = e.rate * dt * (e.type === 'vent' ? 10 : 6); k > 0; k -= 1) {
        if (Math.random() >= k) continue;
        const r = Math.random;
        if (e.type === 'bubbles') this.bubble(e.x, e.y, e.z, 1, 0.3, 0.7); // seep from a rock crevice
        else if (e.type === 'vent') {
          this.smoke.spawn(e.x + (r() - 0.5) * 0.6, e.y, e.z + (r() - 0.5) * 0.6, (r() - 0.5) * 0.3, 1.4 + r(), (r() - 0.5) * 0.3,
            9 + r() * 6, 1.2, 0.5, 0.09, 0.08, 0.075, 1);
          if (r() < 0.3) this.bubble(e.x, e.y + 0.3, e.z, 1, 0.8, 1.5);
        } else if (e.type === 'spout') { // a whale's blow: a tall column of spray
          this.smoke.spawn(e.x + (r() - 0.5) * 0.8, e.y, e.z + (r() - 0.5) * 0.8, (r() - 0.5) * 1.2, 6 + r() * 4, (r() - 0.5) * 1.2,
            1.8 + r(), 1.2, 2.2, 0.92, 0.95, 0.97, 2);
        } else if (e.type === 'mist') { // spray at the foot of a waterfall
          this.smoke.spawn(e.x + (r() - 0.5) * 3, e.y, e.z + (r() - 0.5) * 3, (r() - 0.5) * 0.8, 0.3 + r() * 0.5, (r() - 0.5) * 0.8,
            2.5 + r() * 2, 1.4, 1.2, 0.85, 0.9, 0.92, 2);
        } else {
          this.smoke.spawn(e.x + (r() - 0.5) * 0.5, e.y, e.z + (r() - 0.5) * 0.5, 0.3 + r() * 0.2, 0.9 + r() * 0.6, (r() - 0.5) * 0.2,
            7 + r() * 5, 0.8, 0.9, 0.55, 0.53, 0.5, 2);
        }
      }
    }
    const B = this.bubbles;
    for (let i = 0; i < B.n; i++) {
      if (B.life[i] <= 0) { B.alpha[i] = 0; continue; }
      B.life[i] -= dt;
      const j = i * 3;
      B.v[j + 1] = Math.min(B.v[j + 1] + dt * 1.2, 1.6 + B.size0[i] * 6);
      B.p[j] += (B.v[j] + Math.sin(t * 7 + i) * 0.25) * dt;
      B.p[j + 1] += B.v[j + 1] * dt;
      B.p[j + 2] += (B.v[j + 2] + Math.cos(t * 6 + i) * 0.25) * dt;
      B.v[j] *= 0.98; B.v[j + 2] *= 0.98;
      if (B.p[j + 1] > this.oceanHeight(B.p[j], B.p[j + 2]) - 0.05) B.life[i] = 0;
      B.size[i] = B.size0[i] * (1 + (1 - B.life[i] / B.max[i]) * 0.6) * 100;
      B.alpha[i] = B.life[i] > 0 ? Math.min(1, B.life[i]) : 0;
    }
    B.flush();
    const S = this.smoke;
    for (let i = 0; i < S.n; i++) {
      if (S.life[i] <= 0) { S.alpha[i] = 0; continue; }
      S.life[i] -= dt;
      const j = i * 3, f = 1 - S.life[i] / S.max[i];
      S.p[j] += S.v[j] * dt; S.p[j + 1] += S.v[j + 1] * dt; S.p[j + 2] += S.v[j + 2] * dt;
      S.v[j + 1] *= 0.995;
      const air = S.kind[i] === 2;
      if (!air && S.p[j + 1] > this.oceanHeight(S.p[j], S.p[j + 2])) S.life[i] = 0;
      S.size[i] = (S.size0[i] + S.grow[i] * f * S.max[i]) * 100;
      S.alpha[i] = S.life[i] > 0 ? Math.min(f * 6, 1) * (1 - f) * (air ? 0.35 : 0.55) : 0;
    }
    S.flush();
  }
}
