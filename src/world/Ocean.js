// Animated ocean surface: Gerstner waves, sky reflection, sun glitter, shoreline foam, Snell's window from below.
import * as THREE from 'three';
import { U } from '../fx/materials.js';
import { SKY_GLSL } from './Sky.js';
import { WORLD } from './layout.js';

// [dirAngle, wavelength, amplitude, steepness, speedMul]
const WAVES = [
  [0.3, 48, 0.42, 0.45, 1],
  [1.1, 31, 0.26, 0.5, 1],
  [-0.6, 21, 0.17, 0.55, 1],
  [2.2, 13, 0.09, 0.6, 1],
  [0.8, 8.5, 0.05, 0.6, 1],
  [-1.6, 5.6, 0.03, 0.5, 1],
];
const G = 9.81;
const W = WAVES.map(([ang, L, A, Q, sp]) => {
  const k = (2 * Math.PI) / L;
  return { dx: Math.cos(ang), dz: Math.sin(ang), k, A, Q: Q / (k * A * WAVES.length), w: Math.sqrt(G * k) * sp };
});

// JS mirror of the vertex shader: displacement at original point p
function gerstner(x, z, t, out) {
  let ox = 0, oy = 0, oz = 0;
  for (const w of W) {
    const ph = w.k * (w.dx * x + w.dz * z) - w.w * t;
    const c = Math.cos(ph), s = Math.sin(ph);
    ox += w.Q * w.A * w.dx * c;
    oz += w.Q * w.A * w.dz * c;
    oy += w.A * s;
  }
  out[0] = ox; out[1] = oy; out[2] = oz;
  return out;
}

const tmp = [0, 0, 0];
// Surface height at world (x,z): invert horizontal displacement with fixed-point iterations.
export function waveHeight(x, z, t, scale = 1) {
  let px = x, pz = z;
  for (let i = 0; i < 3; i++) {
    gerstner(px, pz, t, tmp);
    px = x - tmp[0] * scale; pz = z - tmp[2] * scale;
  }
  gerstner(px, pz, t, tmp);
  return tmp[1] * scale;
}

const WAVE_GLSL = /* glsl */ `
uniform float uWaveScale;
uniform vec4 uWaveA[${W.length}]; // dx, dz, k, A
uniform vec2 uWaveB[${W.length}]; // Q, w
vec3 gerstner(vec2 p, float t, out vec3 nrm) {
  vec3 o = vec3(0.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < ${W.length}; i++) {
    vec4 a = uWaveA[i]; vec2 b = uWaveB[i];
    float ph = a.z * dot(a.xy, p) - b.y * t;
    float c = cos(ph), s = sin(ph);
    o.x += b.x * a.w * a.x * c;
    o.z += b.x * a.w * a.y * c;
    o.y += a.w * s;
    float wa = a.z * a.w;
    n.x -= a.x * wa * c;
    n.z -= a.y * wa * c;
    n.y -= b.x * wa * s;
  }
  nrm = normalize(vec3(n.x * uWaveScale, n.y, n.z * uWaveScale));
  return o * uWaveScale;
}
`;

const VERT = /* glsl */ `
uniform float uTime;
varying vec3 vWPos;
varying vec3 vNrm;
varying float vCrest;
${WAVE_GLSL}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float fade = 1.0 - smoothstep(600.0, 2400.0, length(wp.xz - cameraPosition.xz));
  vec3 n;
  vec3 d = gerstner(wp.xz, uTime, n);
  wp.xyz += d * fade;
  vNrm = normalize(mix(vec3(0.0, 1.0, 0.0), n, fade));
  vCrest = d.y;
  vWPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform float uTime, uWaterLevel, uCamUnder, uWaterFogDensity, uAirFogDensity, uDay;
uniform vec3 uWaterShallow, uWaterDeep, uAirFogColor, uSunFogColor, uSunDirW, uLightDir, uLightColor;
uniform sampler2D uDepthTex, uNormalTex;
uniform float uWorldHalf;
varying vec3 vWPos;
varying vec3 vNrm;
varying float vCrest;
${SKY_GLSL}
void main() {
  vec2 duv = (vWPos.xz + uWorldHalf) / (2.0 * uWorldHalf);
  float inside = step(0.0, duv.x) * step(duv.x, 1.0) * step(0.0, duv.y) * step(duv.y, 1.0);
  float depth = mix(120.0, texture2D(uDepthTex, duv).r * 64.0, inside);
  depth = depth >= 63.9 ? 200.0 : depth;
  float dist = length(vWPos - cameraPosition);
  float detailFade = 1.0 - smoothstep(80.0, 700.0, dist);
  vec3 n1 = texture2D(uNormalTex, vWPos.xz * 0.045 + vec2(uTime * 0.012, uTime * 0.007)).xzy * 2.0 - 1.0;
  vec3 n2 = texture2D(uNormalTex, vWPos.xz * 0.11 - vec2(uTime * 0.017, -uTime * 0.011)).xzy * 2.0 - 1.0;
  vec3 n3 = texture2D(uNormalTex, vWPos.xz * 0.29 + vec2(uTime * 0.031, uTime * 0.023)).xzy * 2.0 - 1.0;
  float fineFade = 1.0 - smoothstep(15.0, 160.0, dist); // capillary ripples only up close
  vec3 N = normalize(vNrm + (vec3(n1.x + n2.x, 0.0, n1.z + n2.z) * 0.32 + vec3(n3.x, 0.0, n3.z) * 0.14 * fineFade) * detailFade);
  vec3 V = normalize(cameraPosition - vWPos);
  vec3 col;
  float alpha = 1.0;
  if (uCamUnder < 0.5) {
    if (dot(N, V) < 0.0) N = normalize(N + V * (-dot(N, V) + 0.05));
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 refl = skyBase(R);
    vec4 cl = skyClouds(R, uTime);
    refl = mix(refl, cl.rgb, cl.a * 0.8);
    // depth ramp: pale lagoon over sand -> turquoise -> open-ocean blue
    float shallow = exp(-depth * 0.09);
    vec3 body = mix(uWaterDeep * 0.9, uWaterShallow * 1.15, shallow * 0.85 + 0.12);
    body = mix(body, vec3(0.16, 0.5, 0.46) * (0.6 + 0.5 * uDay), exp(-depth * 0.35) * 0.55);
    body *= 0.25 + 0.75 * uDay;
    // subsurface glow on wave crests facing the light
    float sss = pow(max(dot(V, -uLightDir + N * 0.4), 0.0), 3.0) * max(vCrest, 0.0) * 0.6;
    body += uWaterShallow * sss * uDay;
    col = mix(body, refl, fres);
    vec3 H = normalize(uLightDir + V);
    float spec = pow(max(dot(N, H), 0.0), 600.0) * 6.0 + pow(max(dot(N, H), 0.0), 60.0) * 0.18;
    // glitter: sparse sharp glints from the fine ripples, strongest along the sun's path
    vec3 Ng = normalize(vNrm + vec3(n2.x + n3.x * 1.6, 0.0, n2.z + n3.z * 1.6) * 0.5);
    spec += pow(max(dot(Ng, H), 0.0), 2500.0) * 5.0 * fineFade * smoothstep(0.1, 0.3, n3.x + n1.z * 0.5);
    col += uLightColor * spec * step(0.0, uLightDir.y);
    // foam: shoreline + crests
    float foamN = texture2D(uNormalTex, vWPos.xz * 0.19 + uTime * 0.01).a;
    float foamF = texture2D(uNormalTex, vWPos.xz * 0.53 - uTime * 0.02).a;
    float lace = smoothstep(0.35, 0.7, foamN * 0.6 + foamF * 0.6 - 0.1); // broken, lacy foam texture
    float swash = (1.0 - smoothstep(0.0, 0.7, depth)) * smoothstep(0.2, 0.6, foamN + 0.3 * sin(uTime * 0.9 + foamF * 2.0));
    float bands = (1.0 - smoothstep(0.3, 3.2, depth)) * smoothstep(0.55, 0.95, sin(depth * 2.6 - uTime * 1.3 + foamN * 2.0)) * lace;
    float shore = max(swash * (0.55 + 0.45 * lace), bands * 0.8);
    float crest = smoothstep(0.55, 0.95, vCrest) * smoothstep(0.5, 0.8, foamN);
    float foam = clamp(shore + crest * detailFade, 0.0, 1.0);
    col = mix(col, vec3(0.92, 0.96, 1.0) * (0.3 + 0.7 * uDay), foam * 0.85);
    alpha = clamp(mix(0.55, 0.985, 1.0 - exp(-depth * 0.22)) + fres * 0.5 + foam, 0.0, 1.0);
    // atmospheric fog
    float fa = 1.0 - exp(-pow(dist * uAirFogDensity, 1.35));
    float sunAmt = pow(max(dot(-V, uSunDirW), 0.0), 6.0);
    col = mix(col, mix(uAirFogColor, uSunFogColor, sunAmt), fa);
  } else {
    // seen from below: Snell's window and total internal reflection
    // a calmer normal: full detail opens false windows at grazing angles
    vec3 Nd = -normalize(vNrm + (N - vNrm) * 0.25);
    float cosI = dot(V, Nd);
    vec3 T = refract(-V, Nd, 1.33);
    float tir = dot(T, T) < 0.001 ? 1.0 : 0.0;
    vec3 sky = skyBase(normalize(T + vec3(0.0, 0.001, 0.0)));
    float sunAmt = pow(max(dot(normalize(T), uSunDirW), 0.0), 90.0);
    vec3 win = mix(sky * 1.1, uWaterShallow * 1.6 + 0.08, 0.4) + uLightColor * sunAmt * 3.0;
    // underside of the surface: rippled, catching scattered light, so it never reads as a flat ceiling
    float rip = 0.85 + 0.3 * (n1.x * n2.z + n3.x * 0.5);
    vec3 under = uWaterShallow * (0.35 + 0.4 * uDay) * rip;
    float edge = smoothstep(0.62, 0.86, abs(cosI));
    col = mix(under, win, (1.0 - tir) * edge);
    col = mix(col, uWaterShallow * 1.4 * (0.4 + 0.6 * uDay), smoothstep(0.75, 0.95, vCrest) * 0.25);
    float f = 1.0 - exp(-dist * uWaterFogDensity * 1.3);
    float k = clamp((vWPos.y - cameraPosition.y) / max(dist, 1.0), -1.0, 1.0);
    col = mix(col, mix(uWaterDeep, uWaterShallow, 0.5 + 0.5 * k), f);
  }
  gl_FragColor = vec4(col, alpha);
}`;

function makeNormalTexture(size = 256) {
  // tileable height field from integer-frequency sinusoids
  const rnd = (() => { let s = 12345; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const comps = [];
  for (let i = 0; i < 28; i++) {
    const f = 1 + Math.floor(rnd() * 12);
    const a = rnd() * Math.PI * 2;
    comps.push({ fx: Math.round(Math.cos(a) * f), fy: Math.round(Math.sin(a) * f), ph: rnd() * 6.28, amp: 1 / (1 + Math.hypot(Math.cos(a) * f, Math.sin(a) * f)) });
  }
  const h = new Float32Array(size * size);
  const foam = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, fv = 0;
    for (const c of comps) {
      const p = ((c.fx * x + c.fy * y) / size) * Math.PI * 2 + c.ph;
      v += Math.sin(p) * c.amp;
      fv += Math.abs(Math.sin(p * 1.7 + c.ph)) * c.amp;
    }
    h[y * size + x] = v;
    foam[y * size + x] = fv;
  }
  let fmin = Infinity, fmax = -Infinity;
  for (const v of foam) { fmin = Math.min(fmin, v); fmax = Math.max(fmax, v); }
  const data = new Uint8Array(size * size * 4);
  const s = 2.5;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
    const hy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
    let nx = -hx * s, ny = -hy * s, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const o = (y * size + x) * 4;
    data[o] = ((nx / l) * 0.5 + 0.5) * 255;
    data[o + 1] = ((ny / l) * 0.5 + 0.5) * 255;
    data[o + 2] = ((nz / l) * 0.5 + 0.5) * 255;
    data[o + 3] = ((foam[y * size + x] - fmin) / (fmax - fmin)) * 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// Depth below sea level, 0..64 m in 0.25 m steps, at 4 m resolution
export function makeDepthTexture(world) {
  const n = WORLD.biomeRes;
  const data = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const h = world.hAt(i * 2, j * 2);
    data[j * n + i] = Math.min(255, Math.max(0, -h * 4));
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function makeGeometry(rings = 150, segs = 200, maxR = 7000) {
  const pos = [0, 0, 0];
  const idx = [];
  let r = 0.6;
  for (let i = 1; i <= rings; i++) {
    r = i < 40 ? i * 1.0 : r * 1.045;
    if (i === rings) r = maxR;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * segs, b0 = 1 + (i + 1) * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      idx.push(a0 + s, a0 + s1, b0 + s, a0 + s1, b0 + s1, b0 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Ocean {
  constructor(scene, world, quality) {
    this.waveScale = 1;
    const waveA = W.map((w) => new THREE.Vector4(w.dx, w.dz, w.k, w.A));
    const waveB = W.map((w) => new THREE.Vector2(w.Q, w.w));
    this.uniforms = {
      ...U,
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uCloudCover: { value: 0.5 },
      uLightDir: { value: new THREE.Vector3(0, 1, 0) },
      uLightColor: { value: new THREE.Color(1, 1, 1) },
      uWaveScale: { value: 1 },
      uWaveA: { value: waveA },
      uWaveB: { value: waveB },
      uDepthTex: { value: makeDepthTexture(world) },
      uNormalTex: { value: makeNormalTexture() },
      uWorldHalf: { value: WORLD.half },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, side: THREE.DoubleSide, depthWrite: true,
    });
    const segs = quality === 'low' ? 120 : quality === 'ultra' ? 280 : 200;
    this.mesh = new THREE.Mesh(makeGeometry(quality === 'low' ? 110 : 150, segs), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  update(time, camera, sky) {
    const u = this.uniforms;
    u.uSunDir.value.copy(sky.sunDir);
    u.uLightDir.value.copy(sky.lightDir);
    u.uLightColor.value.copy(sky.sunColor).multiplyScalar(Math.min(sky.sunIntensity, 1.6));
    u.uCloudCover.value = sky.uniforms.uCloudCover.value;
    u.uWaveScale.value = this.waveScale;
    this.mesh.position.set(camera.position.x, 0, camera.position.z);
  }

  heightAt(x, z, t) { return waveHeight(x, z, t, this.waveScale); }
}
