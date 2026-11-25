// Marine snow (GPU-wrapped around the camera), bubbles and smoke (small CPU pools), night fireflies over land.
import * as THREE from 'three';
import { U } from './materials.js';

const SNOW_BOX = 48;

// Marine snow: sparse organic detritus suspended in the water. World-sized flakes (6-26 mm) so distant ones go
// sub-pixel and fade by coverage instead of staying fixed-size dots; patchy density carried by the current;
// lit only by the water's own scattered light, the sun's forward scatter and the diver's lamp.
const SNOW_VERT = /* glsl */ `
uniform float uTime, uViewH, uWaterFogDensity, uDay, uFlash, uCaveDark;
uniform vec3 uCam, uDrift, uAmb, uSunDirW, uFlashDir, uAbsorb;
attribute float aSeed;
varying float vA;
varying vec3 vCol;
float snowHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float snowNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(snowHash(i), snowHash(i + vec3(1, 0, 0)), f.x), mix(snowHash(i + vec3(0, 1, 0)), snowHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(snowHash(i + vec3(0, 0, 1)), snowHash(i + vec3(1, 0, 1)), f.x), mix(snowHash(i + vec3(0, 1, 1)), snowHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  float h1 = aSeed, h2 = fract(aSeed * 7.31 + 0.13), h3 = fract(aSeed * 13.7 + 0.71), h4 = fract(aSeed * 29.3 + 0.37);
  // carried by the shared current, each flake sinking at its own rate with its own slow, unsynchronised wander
  vec3 wander = vec3(sin(uTime * (0.11 + 0.17 * h2) + h1 * 40.0), 0.5 * sin(uTime * (0.07 + 0.13 * h4) + h3 * 30.0),
                     cos(uTime * (0.09 + 0.15 * h3) + h4 * 50.0)) * (0.15 + 0.35 * h4);
  vec3 sink = vec3(0.0, -(0.015 + 0.03 * h3) * uTime, 0.0);
  vec3 p = mod(position + uDrift + sink + wander - uCam + ${SNOW_BOX / 2}.0, ${SNOW_BOX}.0) - ${SNOW_BOX / 2}.0 + uCam;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  // patches: a low-frequency field that moves with the water; sparse open water, occasional denser drifts, more at depth
  vec3 q = p - uDrift;
  float dens = snowNoise(q * 0.055) * 0.65 + snowNoise(q * 0.16 + 7.3) * 0.35 + 0.12 * smoothstep(4.0, 30.0, -p.y) - 0.06;
  float keep = smoothstep(0.0, 0.12, dens - 0.25 - 0.55 * h2);
  float sz = 0.006 + 0.02 * h3 * h3 * h3;
  float px = sz * projectionMatrix[1][1] * uViewH * 0.5 / max(d, 0.1);
  gl_PointSize = clamp(px, 1.0, 8.0);
  vA = keep * min(px * px, 1.0) * (0.4 + 0.6 * h4) * 0.38
     * smoothstep(0.9, 2.5, d) * smoothstep(22.0, 9.0, d) * exp(-d * uWaterFogDensity) * smoothstep(-0.2, -1.5, p.y);
  // lighting: the depth-scaled water light (darker below the camera, dark in caves), brighter toward the sun, plus the lamp
  vec3 vd = (p - cameraPosition) / max(length(p - cameraPosition), 1e-3);
  float fs = pow(max(dot(vd, normalize(uSunDirW + vec3(0.0, 1.2, 0.0))), 0.0), 5.0) * uDay;
  vec3 col = uAmb * exp(-max(uCam.y - p.y, 0.0) * 0.012) * (1.0 + 1.2 * fs) * mix(1.0, 0.3, uCaveDark);
  float cd = dot(vd, uFlashDir);
  float fa = uFlash * (0.25 * smoothstep(0.55, 0.85, cd) + smoothstep(0.82, 0.96, cd)) / (1.0 + 0.01 * d * d);
  vCol = col + vec3(1.0, 0.95, 0.85) * exp(-uAbsorb * d * 0.5) * fa * 0.5;
  vA *= 1.0 + fa * 0.6;
}`;
const SNOW_FRAG = /* glsl */ `
varying float vA;
varying vec3 vCol;
void main() {
  float a = smoothstep(0.5, 0.12, length(gl_PointCoord - 0.5)) * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol, a);
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

const FLY_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = exp(-r * r * 60.0) + smoothstep(0.5, 0.0, r) * 0.12; // tight core, faint glow
  gl_FragColor = vec4(vColor, a * vAlpha);
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
  constructor(scene, quality, oceanHeight, groundHeight) {
    this.oceanHeight = oceanHeight; // (x, z) => surface height
    this.groundHeight = groundHeight; // (x, z) => terrain height, for fireflies
    const n = { low: 500, medium: 1000, high: 1500, ultra: 2200 }[quality] ?? 1000;
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.random() * SNOW_BOX; pos[i * 3 + 1] = Math.random() * SNOW_BOX; pos[i * 3 + 2] = Math.random() * SNOW_BOX;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.snowU = {
      uTime: U.uTime, uWaterFogDensity: U.uWaterFogDensity, uDay: U.uDay, uFlash: U.uFlash, uCaveDark: U.uCaveDark,
      uSunDirW: U.uSunDirW, uFlashDir: U.uFlashDir, uAbsorb: U.uAbsorb,
      uViewH: { value: 1080 }, uCam: { value: new THREE.Vector3() }, uDrift: { value: new THREE.Vector3() }, uAmb: { value: new THREE.Color() },
    };
    this.snow = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.snowU, vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG, transparent: true, depthWrite: false,
    }));
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 7;
    const buf = new THREE.Vector2();
    this.snow.onBeforeRender = (r) => { this.snowU.uViewH.value = r.getDrawingBufferSize(buf).y; }; // flake size in real render pixels
    scene.add(this.snow);
    this.bubbles = new Pool(scene, 600, BUBBLE_FRAG);
    this.smoke = new Pool(scene, quality === 'low' ? 250 : 600, SMOKE_FRAG);
    this.flies = new Pool(scene, quality === 'low' ? 24 : 48, FLY_FRAG);
    this.flies.mat.blending = THREE.AdditiveBlending;
    for (let i = 0; i < this.flies.n; i++) { this.flies.size0[i] = Math.random(); this.flies.life[i] = 0; }
  }

  // fireflies: hover low over vegetated land near the camera, blinking slowly; night and above water only
  _flies(cp, t) {
    const F = this.flies, d = U.uDay.value;
    const night = 1 - Math.min(1, Math.max(0, (d - 0.04) / 0.2));
    F.points.visible = !!this.groundHeight && night > 0 && U.uCamUnder.value < 0.5;
    if (!F.points.visible) return;
    for (let i = 0; i < F.n; i++) {
      const j = i * 3, s = F.size0[i];
      // F.v holds each fly's home point; respawn when the camera has moved away
      if (F.life[i] <= 0 || Math.hypot(F.v[j] - cp.x, F.v[j + 2] - cp.z) > 45) {
        const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 35;
        const x = cp.x + Math.cos(a) * r, z = cp.z + Math.sin(a) * r, h = this.groundHeight(x, z);
        F.life[i] = h > 1.5 && h < 30 ? 1 : 0;
        F.v[j] = x; F.v[j + 1] = h + 0.4 + Math.random() * 2.2; F.v[j + 2] = z;
        if (!F.life[i]) { F.alpha[i] = 0; continue; }
      }
      F.p[j] = F.v[j] + Math.sin(t * 0.37 + s * 17) * 1.3 + Math.sin(t * 0.9 + s * 5) * 0.3;
      F.p[j + 1] = F.v[j + 1] + Math.sin(t * 0.5 + s * 11) * 0.4;
      F.p[j + 2] = F.v[j + 2] + Math.cos(t * 0.31 + s * 23) * 1.3;
      F.alpha[i] = Math.max(0, Math.sin(t * (0.7 + s * 0.6) + s * 40)) ** 6 * night;
      F.size[i] = 7;
      F.col[j] = 0.75; F.col[j + 1] = 1.0; F.col[j + 2] = 0.35;
    }
    F.flush();
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
    const t = U.uTime.value;
    // flakes scatter the water's own light: its depth/daylight-scaled colour, slightly brighter and less saturated
    const ws = U.uWaterShallow.value;
    this.snowU.uAmb.value.copy(ws).multiplyScalar(1.3).addScalar((ws.r + ws.g + ws.b) * 0.17);
    // a slow current whose heading wanders over minutes; integrated so changes never jump the flakes
    const ca = Math.sin(t * 0.0021) * 2.2 + 0.6;
    this.snowU.uDrift.value.x += Math.cos(ca) * 0.07 * dt;
    this.snowU.uDrift.value.z += Math.sin(ca) * 0.07 * dt;
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
    this._flies(cp, t);
  }
}
