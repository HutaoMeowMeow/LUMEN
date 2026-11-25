// Procedural sky dome (gradient, sun, moon, stars, Milky Way, clouds, meteors, lightning) + day/night lighting state.
import * as THREE from 'three';
import { U } from '../fx/materials.js';

// Shared GLSL: analytic sky colour, moon and clouds, also used by the ocean for reflections.
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir, uMoonDir;
uniform float uCloudCover;
uniform vec4 uLightning; // xyz: direction of the flash, w: intensity
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
float skyFbm3(vec2 p) { // cheaper 3-octave fbm on the same range, for cloud light probes
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * skyNoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return v * 1.107;
}
float skyNight() { return 1.0 - smoothstep(-0.2, 0.02, uSunDir.y); }
float skyMoonUp() { return smoothstep(-0.04, 0.2, uMoonDir.y); }
vec3 skySunTint() { return mix(vec3(1.0, 0.45, 0.18), vec3(1.0, 0.86, 0.64), smoothstep(-0.02, 0.4, uSunDir.y)); }
vec3 skyBase(vec3 d) {
  float sy = uSunDir.y;
  float day = smoothstep(-0.12, 0.25, sy);
  float dusk = smoothstep(-0.22, 0.02, sy) * (1.0 - smoothstep(0.02, 0.38, sy));
  float tw = smoothstep(-0.3, -0.02, sy) * (1.0 - day); // twilight blue lingers before full dark
  float h = clamp(d.y, 0.0, 1.0);
  // low sun: a deeper, less saturated zenith; high sun: full blue
  vec3 zen = mix(vec3(0.004, 0.01, 0.03), mix(vec3(0.07, 0.17, 0.42), vec3(0.11, 0.3, 0.72), smoothstep(0.05, 0.45, sy)), day);
  vec3 hor = mix(vec3(0.018, 0.035, 0.07), vec3(0.62, 0.76, 0.9), day);
  zen += vec3(0.02, 0.045, 0.11) * tw;
  hor += vec3(0.05, 0.06, 0.1) * tw;
  // night: moonlight scatters a faint blue into the whole sky, plus a soft halo around the moon
  float night = skyNight(), mUp = skyMoonUp() * night;
  float mAng = max(dot(d, uMoonDir), 0.0);
  zen += vec3(0.006, 0.011, 0.024) * mUp;
  hor += vec3(0.01, 0.016, 0.03) * mUp;
  // air-mass gradient: deep overhead, paling fast into the low atmosphere
  vec3 col = mix(hor, zen, (1.0 - exp(-h * 3.2)) / 0.959);
  float mu = dot(d, uSunDir);
  col *= mix(1.0, 0.86 + 0.22 * mu * mu, day); // Rayleigh phase: darkest band 90 degrees from the sun
  vec2 az2 = normalize(d.xz + 1e-4), sz2 = normalize(uSunDir.xz + 1e-4);
  float az = dot(az2, sz2);
  // horizon haze: bright aerosol band, warmed toward the sun at dusk
  vec3 haze = mix(hor * 1.06 + 0.025, vec3(1.0, 0.62, 0.4), dusk * (0.35 + 0.4 * max(az, 0.0)));
  col = mix(col, haze, exp(-h * 14.0) * 0.45 * min(day + 0.6 * dusk, 1.0));
  col += vec3(0.04, 0.05, 0.07) * pow(mAng, 24.0) * mUp + vec3(0.1, 0.11, 0.13) * pow(mAng, 900.0) * mUp;
  float sunAmt = max(mu, 0.0);
  // sunrise / sunset: warm glow spread along the horizon around the sun's azimuth, golden right above it,
  // and the pink belt of Venus over the earth's shadow on the opposite side
  col += vec3(1.0, 0.42, 0.16) * dusk * pow(1.0 - h, 4.0) * (0.22 + 0.9 * pow(max(az, 0.0), 3.0) + 0.5 * pow(sunAmt, 6.0));
  col += vec3(1.0, 0.72, 0.32) * dusk * pow(1.0 - h, 14.0) * pow(max(az, 0.0), 8.0) * 0.5;
  float anti = smoothstep(0.1, 0.9, -az) * dusk;
  float vb = (h - 0.1) / 0.07;
  col += vec3(0.3, 0.17, 0.22) * anti * exp(-vb * vb) * 0.7;
  col *= 1.0 - 0.22 * anti * exp(-h * 30.0);
  // Mie aureole: broad forward-scatter glow tightening into a bright halo round the disc
  col += skySunTint() * (pow(sunAmt, 6.0) * 0.18 + pow(sunAmt, 48.0) * 0.45 + pow(sunAmt, 400.0) * 1.2) * (day + dusk);
  if (d.y < 0.0) col = mix(hor, hor * 0.55, clamp(-d.y * 4.0, 0.0, 1.0));
  return col;
}
// Lunar disc: limb-darkened sphere lit by the sun, with maria and craters. a = coverage.
float skyCraters(vec2 p, float s) {
  vec2 c = floor(p * s), f = fract(p * s);
  float r = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    float h = skyHash(c + o + s);
    if (h < 0.45) continue;
    vec2 ctr = o + vec2(skyHash(c + o + 3.7), skyHash(c + o + 9.1)) * 0.6 + 0.2;
    float rad = 0.18 + 0.3 * skyHash(c + o + 5.3);
    float q = length(f - ctr) / rad;
    // bright raised rim, darker bowl
    r += (smoothstep(1.15, 0.9, q) * smoothstep(0.7, 0.95, q) * 0.5 - smoothstep(0.95, 0.4, q) * 0.35) * (h - 0.45) * 1.8;
  }
  return r;
}
vec4 skyMoon(vec3 d) {
  float md = dot(d, uMoonDir);
  if (md < 0.999) return vec4(0.0);
  vec3 mU = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0))), mV = cross(mU, uMoonDir);
  vec2 l = vec2(dot(d, mU), dot(d, mV)) / 0.031;
  float rr = length(l);
  float a = smoothstep(1.0, 0.965, rr);
  if (a <= 0.0) return vec4(0.0);
  vec3 N = l.x * mU + l.y * mV - sqrt(max(0.0, 1.0 - rr * rr)) * uMoonDir;
  float lit = clamp(dot(N, uSunDir) * 1.1 + 0.08, 0.0, 1.0);
  float maria = smoothstep(0.46, 0.66, skyFbm(l * 1.8 + 4.0)) * 0.38;
  float alb = 1.0 - maria + skyCraters(l, 3.0) * 0.5 + skyCraters(l, 7.0) * 0.3 + (skyNoise(l * 24.0) - 0.5) * 0.08;
  vec3 c = vec3(0.74, 0.75, 0.78) * clamp(alb, 0.3, 1.2) * lit * 0.95;
  return vec4(c, a);
}
vec4 skyClouds(vec3 d, float t) {
  if (d.y <= 0.01) return vec4(0.0);
  // cloud deck on a curved shell (earth radius 1, deck 0.06 up): perspective shrinks clouds toward the horizon without smearing
  vec2 base = d.xz * (sqrt(d.y * d.y + 0.1236) - d.y) / 0.06;
  // mid layer: domain-warped billows, so no obvious tiling
  vec2 uv = base * 1.6 + vec2(t * 0.006, t * 0.0025);
  vec2 w = vec2(skyNoise(uv * 0.7 + 3.1), skyNoise(uv * 0.7 + 7.7)) - 0.5;
  vec2 q = uv + w * 1.1;
  float n = skyFbm(q);
  // weather scale: clear gaps and denser banks within one view; fine erosion frays the edges
  float cov = mix(0.66, 0.34, uCloudCover) + (skyNoise(uv * 0.16 + 40.0) - 0.5) * 0.22;
  n -= (skyNoise(q * 9.0) - 0.5) * 0.07 * (1.0 - smoothstep(cov, cov + 0.2, n));
  float c = smoothstep(cov, cov + 0.24, n);
  float thick = smoothstep(cov, cov + 0.5, n);
  // high layer: thin wisps stretched along the wind, drifting faster
  vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * base * vec2(0.7, 2.6) + vec2(t * 0.011, 0.0) + w * 1.6;
  float c2 = smoothstep(0.56, 0.86, skyFbm(uv2 + 31.0)) * (0.25 + 0.4 * uCloudCover);
  float sunUp = smoothstep(-0.06, 0.08, uSunDir.y);
  vec3 L = mix(uMoonDir, uSunDir, sunUp); // only offsets a lookup, so no normalize (sun+moon can nearly cancel)
  float lit = skyFbm(uv + w * 1.1 + L.xz * 0.06);
  float shade = clamp(0.55 + (n - lit) * 3.0, 0.2, 1.1); // night shading keeps its original look
  float sy = uSunDir.y;
  float day = smoothstep(-0.15, 0.2, sy);
  float dusk = smoothstep(-0.22, 0.02, sy) * (1.0 - smoothstep(0.02, 0.38, sy));
  // day: two density probes toward the sun (Beer falloff through the body, powder-darkened rims),
  // sky-blue ambient in the shadows, darker cores, silver lining when looking toward the sun
  float l1 = smoothstep(cov, cov + 0.3, skyFbm3(q + uSunDir.xz * 0.05));
  float l2 = smoothstep(cov, cov + 0.3, skyFbm3(q + uSunDir.xz * 0.14));
  float sl = exp(-1.5 * (l1 + 0.5 * l2)) * mix(1.0, 1.0 - exp(-4.0 * c), 0.5) * smoothstep(-0.06, 0.04, sy);
  float sunAmt = max(dot(d, uSunDir), 0.0);
  vec3 sunC = skySunTint();
  vec3 ambC = mix(vec3(0.36, 0.33, 0.42), vec3(0.6, 0.67, 0.78), smoothstep(0.0, 0.35, sy));
  float thinD = clamp(1.0 - c, 0.0, 1.0) * smoothstep(0.0, 0.3, c);
  vec3 dc = ambC * (1.0 - 0.35 * thick) * 0.8 + sunC * sl * (0.55 + 0.45 * pow(sunAmt, 4.0));
  dc += sunC * thinD * pow(sunAmt, 12.0) * 1.6 * smoothstep(-0.06, 0.04, sy);
  // just after sunset / before sunrise the sun lights the cloud bases from below the horizon
  float underLit = (1.0 - smoothstep(-0.04, 0.06, sy)) * smoothstep(-0.2, -0.06, sy);
  dc += vec3(1.0, 0.38, 0.18) * underLit * (0.4 + 0.8 * pow(sunAmt, 2.0)) * (1.0 - 0.6 * thick);
  // night: dim blue-grey bodies, brighter toward the moon, silver lining on thin edges near it
  float mUp = skyMoonUp(), mAng = max(dot(d, uMoonDir), 0.0);
  vec3 nc = vec3(0.014, 0.018, 0.028) + vec3(0.075, 0.085, 0.11) * mUp * shade * (0.3 + 0.7 * pow(mAng, 4.0))
    + vec3(0.3, 0.32, 0.38) * thinD * pow(mAng, 30.0) * mUp;
  nc += vec3(0.55, 0.6, 0.75) * uLightning.w * pow(max(dot(d, uLightning.xyz), 0.0), 5.0) * (0.4 + c);
  vec3 cc = mix(nc, dc, max(day, dusk));
  cc = mix(cc, skyBase(d), (1.0 - smoothstep(0.0, 0.3, d.y)) * 0.55); // aerial perspective on distant clouds
  float a = 1.0 - (1.0 - c) * (1.0 - c2);
  return vec4(cc, a * smoothstep(0.01, 0.15, d.y));
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
uniform float uTime, uCamUnder, uStarAng;
uniform vec3 uWaterDeep, uWaterShallow;
varying vec3 vDir;
${SKY_GLSL}
// One layer of stars: at most one per 3D cell, jittered inside it, drawn as a pixel-sized gaussian
// (never a square), with a steep brightness distribution and a cool-white / blue / warm colour spread.
vec3 starLayer(vec3 p, float S, float dens, float gain, float px, float t, float tw) {
  vec3 q = p * S;
  vec3 cell = floor(q);
  vec2 k = cell.xy + cell.z * vec2(17.31, 41.7);
  if (skyHash(k * 1.37 + 0.5) > dens) return vec3(0.0);
  vec3 h = vec3(skyHash(k), skyHash(k + 7.3), skyHash(k + 13.9));
  vec3 c = normalize(cell + 0.35 + h * 0.3) * S; // kept off the cell edges so the gaussian is never clipped square
  float dist = length(q - c);
  float mag = pow(skyHash(k + 21.1), 7.0);
  float sz = min(px * S * (0.75 + 0.8 * mag), 0.16);
  float I = exp(-dist * dist / (sz * sz)) * (0.06 + 1.7 * mag) * gain;
  I *= 1.0 + tw * sin(t * (2.0 + h.x * 3.0) + h.y * 60.0) * sin(t * 1.3 + h.z * 40.0);
  vec3 col = h.z < 0.28 ? vec3(0.72, 0.82, 1.0) : h.z < 0.78 ? vec3(0.93, 0.96, 1.0) : vec3(1.0, 0.88, 0.72);
  return col * I;
}
void main() {
  vec3 d = normalize(vDir);
  // from below the surface the dome is only seen past the ocean mesh: show the water fog colour
  if (uCamUnder > 0.5) { gl_FragColor = vec4(mix(uWaterDeep, uWaterShallow, 0.5 + 0.5 * d.y), 1.0); return; }
  vec3 col = skyBase(d);
  float night = skyNight();
  float mUp = skyMoonUp();
  float mAng = max(dot(d, uMoonDir), 0.0);
  float px = length(fwidth(d)) * 0.7; // angular size of a pixel
  if (d.y > 0.0 && night > 0.0) {
    // celestial frame: the stars turn with the sun's arc (same axis), so they keep their place in the sky
    float ca = cos(uStarAng), sa = sin(uStarAng);
    vec3 s = vec3(ca * d.x + sa * d.y, -sa * d.x + ca * d.y, d.z);
    float ext = smoothstep(0.0, 0.22, d.y) * night * (1.0 - 0.7 * pow(mAng, 6.0) * mUp); // horizon haze, moon glare
    float tw = 0.3 * (1.0 - smoothstep(0.05, 0.6, d.y)) + 0.06;
    // Milky Way: an irregular band with clumped density and dark dust lanes
    float bd = dot(s, normalize(vec3(0.35, 0.55, 0.76)));
    float band = exp(-bd * bd * 12.0);
    float clump = skyFbm(s.xy * 3.0 + s.z * 2.0) * skyFbm(s.yz * 3.5 + 5.0) * 2.4;
    float lane = smoothstep(0.42, 0.68, skyFbm(s.xz * 8.0 + 1.7)) * exp(-bd * bd * 70.0);
    float mw = band * clamp(clump, 0.0, 1.4) * (1.0 - 0.75 * lane);
    col += vec3(0.03, 0.033, 0.045) * mw * ext * (1.0 - 0.6 * mUp);
    // constellation-scale clustering of the bright stars
    float group = smoothstep(0.5, 0.78, skyFbm(s.xz * 2.2 + s.y * 1.3 + 11.0));
    vec3 st = starLayer(s, 110.0, 0.05 + 0.5 * mw, 0.3, px, uTime, tw)
            + starLayer(s, 60.0, 0.1 + 0.15 * mw, 0.7, px, uTime, tw)
            + starLayer(s, 28.0, 0.03 + 0.2 * group, 1.6, px, uTime, tw);
    col += st * ext;
    // rare meteor: a short streak along a great circle, about one a minute on average
    float P = 9.0, slot = floor(uTime / P), r = skyHash(vec2(slot, 7.13));
    if (r < 0.14) {
      float lt = uTime - slot * P - skyHash(vec2(slot, 2.7)) * (P - 1.2);
      if (lt > 0.0 && lt < 0.9) {
        float az = skyHash(vec2(slot, 4.1)) * 6.2832;
        vec3 s0 = normalize(vec3(cos(az) * 0.8, 0.45 + 0.4 * skyHash(vec2(slot, 5.9)), sin(az) * 0.8));
        vec3 dir = normalize(cross(s0, normalize(vec3(skyHash(vec2(slot, 8.8)) - 0.5, 0.2, skyHash(vec2(slot, 9.9)) - 0.5))));
        vec3 head = normalize(s0 + dir * lt * 0.35), tail = normalize(s0 + dir * max(lt - 0.3, 0.0) * 0.35);
        vec3 ab = head - tail;
        float u = clamp(dot(d - tail, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        float dl = length(d - tail - ab * u);
        float m = exp(-dl * dl / (px * px * 1.6)) * u * u * sin(lt / 0.9 * 3.1416);
        col += vec3(0.85, 0.9, 1.0) * m * 0.9 * night * smoothstep(0.0, 0.2, d.y);
      }
    }
  }
  float sunAmt = dot(d, uSunDir);
  col += mix(skySunTint(), vec3(1.0, 0.92, 0.75), 0.5) * smoothstep(0.9993, 0.9997, sunAmt) * 20.0; // disc reddens low down
  vec4 moon = skyMoon(d);
  col = mix(col, max(col, moon.rgb * mix(0.3, 1.0, night)), moon.a);
  vec4 cl = skyClouds(d, uTime);
  col = mix(col, cl.rgb, cl.a * 0.92);
  // distant island silhouettes on the horizon, hazed toward the sky colour
  float az = atan(d.z, d.x), isl = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i), c0 = -2.6 + fi * 1.55 + skyHash(vec2(fi, 1.0)) * 0.6, wd = 0.05 + 0.09 * skyHash(vec2(fi, 2.0));
    float x = (az - c0) / wd;
    float hgt = (0.004 + 0.01 * skyHash(vec2(fi, 3.0))) * sqrt(max(0.0, 1.0 - x * x)) * (0.75 + 0.35 * skyNoise(vec2(az * 90.0, fi)));
    isl = max(isl, smoothstep(hgt, hgt - 0.0012, d.y) * step(0.0005, hgt));
  }
  vec3 hz = skyBase(vec3(d.x, 0.002, d.z));
  col = mix(col, hz * mix(0.55, 0.82, smoothstep(-0.12, 0.25, uSunDir.y)), isl * step(-0.02, d.y));
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uTime: { value: 0 },
      uStarAng: { value: 0 },
      uCloudCover: { value: 0.5 },
      uLightning: { value: new THREE.Vector4(1, 0.1, 0, 0) },
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
    this.moonLift = 1; // extra moonlight above water only (Game applies it; underwater brightness is unchanged)
    this.skyAmbient = new THREE.Color();
    this.groundAmbient = new THREE.Color();
    this.nightFill = new THREE.Color(); // blue moonlit ambient added above water only
    this.horizon = new THREE.Color();
    this.day = 1;
    this.dusk = 0;
    this._t = null;
    this._flash = { t: 99, life: 0, k: 0 };
  }

  // tod: 0..1 (0.25 sunrise, 0.5 noon, 0.75 sunset)
  update(tod, time, camera) {
    const dt = this._t === null ? 0 : Math.min(Math.max(time - this._t, 0), 0.5);
    this._t = time;
    const a = (tod - 0.25) * Math.PI * 2;
    // sun arc tilted to the south so shadows have shape at noon
    this.sunDir.set(Math.cos(a), Math.sin(a), -0.35).normalize();
    const moon = this.uniforms.uMoonDir.value.set(-Math.cos(a) * 0.9, -Math.sin(a), 0.42).normalize();
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uTime.value = time;
    this.uniforms.uStarAng.value = a;
    this.mesh.position.copy(camera.position);
    // weather drifts slowly between clear and heavy cloud over tens of minutes
    const cover = Math.min(0.88, Math.max(0.12, 0.5 + 0.26 * Math.sin(time * 0.0019 + 0.7) + 0.13 * Math.sin(time * 0.0047 + 2.1)));
    this.uniforms.uCloudCover.value = cover;

    const sy = this.sunDir.y;
    const ss = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
    this.day = ss(-0.12, 0.25, sy);
    this.dusk = ss(-0.22, 0.02, sy) * (1 - ss(0.02, 0.38, sy));
    const sunUp = ss(-0.04, 0.1, sy);
    const moonUp = ss(0.0, 0.2, moon.y), night = 1 - this.day;
    if (sunUp > 0.02) {
      this.lightDir.copy(this.sunDir);
      this.sunColor.setRGB(1.0, 0.94, 0.84).lerp(new THREE.Color(1.0, 0.55, 0.3), this.dusk * 0.8);
      this.sunIntensity = 2.6 * sunUp * (0.8 + 0.2 * ss(0.05, 0.5, sy)); // longer air path dims a low sun
    } else {
      this.lightDir.copy(moon);
      this.sunColor.setRGB(0.6, 0.7, 0.95);
      this.sunIntensity = 0.32 * moonUp;
    }
    this.moonLift = 1 + 0.45 * (1 - sunUp); // ~1 whenever the sun is the light, so dusk sunlight is not boosted
    // sky fill follows the dome: blue at noon, lilac-rose in the twilight; ground bounce warms with low sun
    this.skyAmbient.setRGB(0.03, 0.05, 0.1).lerp(new THREE.Color(0.55, 0.69, 0.92), this.day)
      .lerp(new THREE.Color(0.52, 0.44, 0.52), this.dusk * 0.35);
    this.groundAmbient.setRGB(0.02, 0.025, 0.035).lerp(new THREE.Color(0.35, 0.32, 0.26), this.day)
      .lerp(new THREE.Color(0.4, 0.28, 0.2), this.dusk * 0.3);
    this.nightFill.setRGB(0.012 + 0.02 * moonUp, 0.017 + 0.028 * moonUp, 0.03 + 0.05 * moonUp).multiplyScalar(night);
    this.horizon.setRGB(0.018, 0.035, 0.07).lerp(new THREE.Color(0.6, 0.78, 0.93), this.day)
      .lerp(new THREE.Color(0.95, 0.55, 0.38), this.dusk * 0.5);

    // distant lightning: only on heavily clouded nights, rare, a short flicker low on the horizon
    const f = this._flash, L = this.uniforms.uLightning.value;
    f.t += dt;
    const storm = ss(0.68, 0.85, cover) * night;
    if (f.t > f.life && storm > 0 && Math.random() < dt * 0.06 * storm) {
      const az = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(az), 0.08 + Math.random() * 0.1, Math.sin(az)).normalize();
      L.set(v.x, v.y, v.z, 0);
      f.t = 0; f.life = 0.25 + Math.random() * 0.35; f.k = 0.5 + Math.random() * 0.5;
    }
    L.w = f.t < f.life ? f.k * storm * Math.max(0, Math.sin(f.t * 70) * 0.5 + 0.5) * (1 - f.t / f.life) : 0;
  }
}
