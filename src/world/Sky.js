// Procedural sky dome (gradient, sun, moon, stars, clouds) + day/night lighting state.
import * as THREE from 'three';
import { U } from '../fx/materials.js';

// Shared GLSL: analytic sky colour, also used by the ocean for reflections.
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform float uCloudCover;
float skyHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float skyNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(skyHash(i), skyHash(i + vec2(1, 0)), f.x), mix(skyHash(i + vec2(0, 1)), skyHash(i + vec2(1, 1)), f.x), f.y);
}
float skyFbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * skyNoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return v;
}
vec3 skyBase(vec3 d) {
  float sy = uSunDir.y;
  float day = smoothstep(-0.12, 0.25, sy);
  float dusk = smoothstep(-0.22, 0.02, sy) * (1.0 - smoothstep(0.02, 0.38, sy));
  float h = clamp(d.y, 0.0, 1.0);
  vec3 zen = mix(vec3(0.004, 0.01, 0.03), vec3(0.13, 0.36, 0.78), day);
  vec3 hor = mix(vec3(0.018, 0.035, 0.07), vec3(0.6, 0.78, 0.93), day);
  vec3 col = mix(hor, zen, pow(h, 0.5));
  float sunAmt = max(dot(d, uSunDir), 0.0);
  col += vec3(1.0, 0.42, 0.16) * dusk * pow(1.0 - h, 4.0) * (0.3 + 1.1 * pow(sunAmt, 3.0));
  col += vec3(1.0, 0.82, 0.58) * pow(sunAmt, 10.0) * 0.45 * (day + dusk);
  if (d.y < 0.0) col = mix(hor, hor * 0.55, clamp(-d.y * 4.0, 0.0, 1.0));
  return col;
}
vec4 skyClouds(vec3 d, float t) {
  if (d.y <= 0.01) return vec4(0.0);
  vec2 uv = d.xz / (d.y + 0.12) * 1.6 + vec2(t * 0.006, t * 0.0025);
  float n = skyFbm(uv);
  float cov = mix(0.62, 0.38, uCloudCover);
  float c = smoothstep(cov, cov + 0.25, n);
  float lit = skyFbm(uv + uSunDir.xz * 0.05);
  float shade = clamp(0.55 + (n - lit) * 3.0, 0.2, 1.1);
  float day = smoothstep(-0.15, 0.2, uSunDir.y);
  float dusk = smoothstep(-0.22, 0.02, uSunDir.y) * (1.0 - smoothstep(0.02, 0.38, uSunDir.y));
  vec3 cc = mix(vec3(0.03, 0.04, 0.07), vec3(1.0, 0.98, 0.96), day) * shade;
  cc = mix(cc, vec3(1.0, 0.55, 0.32) * shade, dusk * 0.6);
  return vec4(cc, c * smoothstep(0.01, 0.15, d.y));
}
`;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const FRAG = /* glsl */ `
uniform vec3 uMoonDir;
uniform float uTime, uCamUnder;
uniform vec3 uWaterDeep, uWaterShallow;
varying vec3 vDir;
${SKY_GLSL}
void main() {
  vec3 d = normalize(vDir);
  // from below the surface the dome is only seen past the ocean mesh: show the water fog colour
  if (uCamUnder > 0.5) { gl_FragColor = vec4(mix(uWaterDeep, uWaterShallow, 0.5 + 0.5 * d.y), 1.0); return; }
  vec3 col = skyBase(d);
  float night = 1.0 - smoothstep(-0.25, 0.05, uSunDir.y);
  if (d.y > 0.0 && night > 0.0) {
    vec3 sd = d * 300.0;
    vec2 cell = floor(sd.xy + sd.z * vec2(0.37, 0.71));
    float s = skyHash(cell);
    float tw = 0.6 + 0.4 * sin(uTime * 2.0 + s * 50.0);
    col += vec3(0.85, 0.9, 1.0) * step(0.9975, s) * tw * night * smoothstep(0.0, 0.25, d.y) * 1.4;
    // faint milky band
    float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.5, 0.8))), 2.0) * 18.0);
    col += vec3(0.05, 0.06, 0.1) * band * night * skyFbm(d.xz * 6.0);
  }
  float sunAmt = dot(d, uSunDir);
  col += vec3(1.0, 0.92, 0.75) * smoothstep(0.9993, 0.9997, sunAmt) * 20.0;
  float moon = dot(d, uMoonDir);
  float mDisc = smoothstep(0.9992, 0.9995, moon);
  col += vec3(0.75, 0.82, 0.95) * mDisc * (0.6 + 0.4 * skyNoise(d.xy * 900.0)) * 1.6;
  col += vec3(0.25, 0.3, 0.45) * pow(max(moon, 0.0), 300.0) * night * 0.6;
  vec4 cl = skyClouds(d, uTime);
  col = mix(col, cl.rgb, cl.a * 0.92);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uTime: { value: 0 },
      uCloudCover: { value: 0.5 },
      uCamUnder: U.uCamUnder, uWaterDeep: U.uWaterDeep, uWaterShallow: U.uWaterShallow,
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.BackSide, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // Lighting state, refreshed by update()
    this.sunDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3(); // sun or moon, whichever lights the world
    this.sunColor = new THREE.Color();
    this.sunIntensity = 1;
    this.skyAmbient = new THREE.Color();
    this.groundAmbient = new THREE.Color();
    this.horizon = new THREE.Color();
    this.day = 1;
    this.dusk = 0;
  }

  // tod: 0..1 (0.25 sunrise, 0.5 noon, 0.75 sunset)
  update(tod, time, camera) {
    const a = (tod - 0.25) * Math.PI * 2;
    // sun arc tilted to the south so shadows have shape at noon
    this.sunDir.set(Math.cos(a), Math.sin(a), -0.35).normalize();
    const moon = this.uniforms.uMoonDir.value.set(-Math.cos(a) * 0.9, -Math.sin(a), 0.42).normalize();
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uTime.value = time;
    this.mesh.position.copy(camera.position);

    const sy = this.sunDir.y;
    const ss = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
    this.day = ss(-0.12, 0.25, sy);
    this.dusk = ss(-0.22, 0.02, sy) * (1 - ss(0.02, 0.38, sy));
    const sunUp = ss(-0.04, 0.1, sy);
    if (sunUp > 0.02) {
      this.lightDir.copy(this.sunDir);
      this.sunColor.setRGB(1.0, 0.93, 0.82).lerp(new THREE.Color(1.0, 0.55, 0.3), this.dusk * 0.8);
      this.sunIntensity = 2.6 * sunUp;
    } else {
      this.lightDir.copy(moon);
      this.sunColor.setRGB(0.55, 0.65, 0.95);
      this.sunIntensity = 0.32 * ss(0.0, 0.2, moon.y);
    }
    this.skyAmbient.setRGB(0.03, 0.05, 0.1).lerp(new THREE.Color(0.55, 0.7, 0.95), this.day);
    this.groundAmbient.setRGB(0.02, 0.025, 0.035).lerp(new THREE.Color(0.35, 0.32, 0.26), this.day);
    this.horizon.setRGB(0.018, 0.035, 0.07).lerp(new THREE.Color(0.6, 0.78, 0.93), this.day)
      .lerp(new THREE.Color(0.95, 0.55, 0.38), this.dusk * 0.5);
  }
}
