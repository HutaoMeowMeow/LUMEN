// Shared lighting/fog uniforms and the MeshStandardMaterial patch every world material uses.
// The patch adds: per-channel light absorption with depth, caustics, local glow lights,
// a custom flashlight, plant sway, and custom underwater / atmospheric fog.
import * as THREE from 'three';

export const MAX_GLOWS = 8;

export const U = {
  uTime: { value: 0 },
  uWaterLevel: { value: 0 },
  uCamUnder: { value: 0 },
  uCaustics: { value: null },
  uCausticStrength: { value: 1 },
  uAbsorb: { value: new THREE.Vector3(0.16, 0.052, 0.026) },
  uWaterShallow: { value: new THREE.Color(0x1f8fb0) },
  uWaterDeep: { value: new THREE.Color(0x0a3b58) },
  uWaterFogDensity: { value: 0.024 },
  uAirFogColor: { value: new THREE.Color(0xa9cbe0) },
  uSunFogColor: { value: new THREE.Color(0xffe0b0) },
  uAirFogDensity: { value: 0.00022 },
  uSunDirW: { value: new THREE.Vector3(0, 1, 0) },
  uDay: { value: 1 },
  uFlash: { value: 0 },
  uFlashDir: { value: new THREE.Vector3(0, 0, -1) },
  uGlowPos: { value: Array.from({ length: MAX_GLOWS }, () => new THREE.Vector4(0, 0, 0, 0)) },
  uGlowCol: { value: Array.from({ length: MAX_GLOWS }, () => new THREE.Vector3()) },
  uWind: { value: 1 },
  uCaveDark: { value: 0 },
};

const FRAG_COMMON = /* glsl */ `
uniform float uTime, uWaterLevel, uCamUnder, uCausticStrength, uWaterFogDensity, uAirFogDensity, uDay, uFlash, uCaveDark;
uniform sampler2D uCaustics;
uniform vec3 uAbsorb, uWaterShallow, uWaterDeep, uAirFogColor, uSunFogColor, uFlashDir, uSunDirW;
uniform vec4 uGlowPos[${MAX_GLOWS}];
uniform vec3 uGlowCol[${MAX_GLOWS}];
varying vec3 vWPos;
float lumenCaustics(vec2 p) {
  float a = texture2D(uCaustics, p * 0.067).r;
  float b = texture2D(uCaustics, p * 0.041 + vec2(0.37, 0.71)).r;
  return min(a, b) * 2.6 + a * 0.35;
}
`;

export const FOG_GLSL = /* glsl */ `
{
  vec3 Vd = vWPos - cameraPosition;
  float dist = length(Vd);
  if (uCamUnder > 0.5) {
    float f = 1.0 - exp(-dist * uWaterFogDensity);
    float k = clamp((vWPos.y - cameraPosition.y) / max(dist, 1.0), -1.0, 1.0);
    vec3 fc = mix(uWaterDeep, uWaterShallow, 0.5 + 0.5 * k);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, f);
  } else {
    float dBelow = uWaterLevel - vWPos.y;
    if (dBelow > 0.0) {
      float path = dBelow / max(-Vd.y / max(dist, 1e-3), 0.06);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, uWaterShallow * 0.85, 1.0 - exp(-path * uWaterFogDensity * 1.1));
    }
    float fa = 1.0 - exp(-pow(dist * uAirFogDensity, 1.35));
    float sunAmt = pow(max(dot(Vd / max(dist, 1e-3), uSunDirW), 0.0), 6.0);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(uAirFogColor, uSunFogColor, sunAmt), fa);
  }
}
`;

const LIGHT_GLSL = /* glsl */ `
#include <lights_fragment_end>
{
  vec3 nW = inverseTransformDirection(normal, viewMatrix);
  float dBelow = uWaterLevel - vWPos.y;
  float cave = 1.0 - uCaveDark;
  if (dBelow > 0.0) {
    vec3 att = exp(-uAbsorb * dBelow);
    float cs = lumenCaustics(vWPos.xz + nW.xz * 1.5) * uCausticStrength * smoothstep(0.0, 2.0, dBelow)
      * exp(-dBelow * 0.02) * (0.25 + 0.75 * max(nW.y, 0.0));
    reflectedLight.directDiffuse *= att * (1.0 + cs);
    reflectedLight.directSpecular *= att;
    vec3 attI = exp(-uAbsorb * dBelow * 0.72);
    reflectedLight.indirectDiffuse *= attI;
    reflectedLight.indirectSpecular *= attI;
    // light scattered by the water column: a blue fill that fades with depth (uWaterShallow is depth-scaled)
    reflectedLight.indirectDiffuse += material.diffuseColor * uWaterShallow * 0.45 * smoothstep(0.0, 1.5, dBelow);
  }
  reflectedLight.directDiffuse *= cave;
  reflectedLight.directSpecular *= cave;
  reflectedLight.indirectDiffuse *= mix(1.0, 0.08, uCaveDark);
  reflectedLight.indirectSpecular *= mix(1.0, 0.08, uCaveDark);
  vec3 extra = vec3(0.0);
  for (int i = 0; i < ${MAX_GLOWS}; i++) {
    vec4 gp = uGlowPos[i];
    if (gp.w <= 0.0) continue;
    vec3 L = gp.xyz - vWPos;
    float d = length(L);
    float a = clamp(1.0 - d / gp.w, 0.0, 1.0);
    a *= a;
    extra += uGlowCol[i] * a * (0.3 + 0.7 * max(dot(nW, L / max(d, 1e-3)), 0.0));
  }
  if (uFlash > 0.0) {
    vec3 L = cameraPosition - vWPos;
    float d = length(L);
    vec3 l = L / max(d, 1e-3);
    float cd = dot(-l, uFlashDir);
    float fa = uFlash * (0.25 * smoothstep(0.55, 0.85, cd) + smoothstep(0.82, 0.96, cd)) / (1.0 + 0.01 * d * d) * smoothstep(70.0, 4.0, d);
    vec3 fl = vec3(1.0, 0.95, 0.85) * fa * max(dot(nW, l), 0.0) * 3.0;
    if (uCamUnder > 0.5) fl *= exp(-uAbsorb * d * 0.5);
    extra += fl;
  }
  reflectedLight.directDiffuse += extra * material.diffuseColor;
}
`;

const VERT_COMMON = /* glsl */ `
uniform float uTime, uWind;
varying vec3 vWPos;
#ifdef SWAY
uniform float uSwayAmp, uSwayFreq, uSwayHeight;
#endif
`;

const PROJECT_GLSL = /* glsl */ `
vec4 lw = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  lw = instanceMatrix * lw;
#endif
lw = modelMatrix * lw;
#ifdef SWAY
{
  float hn = clamp(position.y / uSwayHeight, 0.0, 1.5);
  float w = hn * hn;
  #ifdef USE_INSTANCING
    float sc = length(instanceMatrix[1].xyz);
  #else
    float sc = 1.0;
  #endif
  float ph = dot(lw.xz, vec2(0.11, 0.137));
  #ifdef SWAY_WIND
    float gust = 0.6 + 0.4 * sin(uTime * 0.6 + ph * 0.3);
    vec2 off = vec2(sin(uTime * uSwayFreq + ph) + 0.6, cos(uTime * uSwayFreq * 1.3 + ph * 1.7) * 0.5) * gust * uWind;
  #else
    vec2 off = vec2(sin(uTime * uSwayFreq + ph), cos(uTime * uSwayFreq * 0.77 + ph * 1.3));
  #endif
  lw.xz += off * uSwayAmp * w * sc;
}
#endif
vWPos = lw.xyz;
vec4 mvPosition = viewMatrix * lw;
gl_Position = projectionMatrix * mvPosition;
`;

// Patch a MeshStandardMaterial in place.
// opts: { sway: 'water'|'wind', swayAmp, swayFreq, swayHeight, uniforms, vertDecl, vertMain, fragDecl, fragColor, fragNormal, fragEmissive, key }
export function patchMaterial(mat, opts = {}) {
  const own = {};
  if (opts.sway) {
    mat.defines = { ...(mat.defines || {}), SWAY: 1 };
    if (opts.sway === 'wind') mat.defines.SWAY_WIND = 1;
    own.uSwayAmp = { value: opts.swayAmp ?? 0.3 };
    own.uSwayFreq = { value: opts.swayFreq ?? 1.0 };
    own.uSwayHeight = { value: opts.swayHeight ?? 1.0 };
  }
  if (opts.uniforms) Object.assign(own, opts.uniforms);
  mat.userData.uniforms = own;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_COMMON + (opts.vertDecl || ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (opts.vertMain || ''))
      .replace('#include <project_vertex>', PROJECT_GLSL);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_COMMON + (opts.fragDecl || ''))
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + (opts.fragColor || ''))
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + (opts.fragNormal || ''))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + (opts.fragEmissive || ''))
      .replace('#include <lights_fragment_end>', LIGHT_GLSL)
      .replace('#include <fog_fragment>', FOG_GLSL);
  };
  const key = (opts.key || '') + '|' + (opts.sway || '');
  mat.customProgramCacheKey = () => 'lumen:' + key;
  return mat;
}

export function stdMat(params, opts) {
  return patchMaterial(new THREE.MeshStandardMaterial(params), opts);
}

// Glowing material (bioluminescence) that still gets fog.
export function glowMat(color, intensity = 2, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color: opts.base ?? 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 1, metalness: 0,
    transparent: !!opts.transparent, opacity: opts.opacity ?? 1, depthWrite: !opts.transparent,
    side: opts.side ?? THREE.FrontSide, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  return patchMaterial(m, { ...opts, key: 'glow' + (opts.key || '') });
}
