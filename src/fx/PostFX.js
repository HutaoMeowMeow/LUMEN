// Bloom + underwater/low-oxygen screen grade, tone mapping and a single anti-aliased output pass.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// The screen pass does the job of ShaderPass + OutputPass in one draw: underwater wobble,
// low-oxygen grade, tone mapping, colour-space conversion and FXAA edge smoothing.
const ScreenShader = {
  uniforms: {
    tDiffuse: { value: null }, uUnder: { value: 0 }, uTime: { value: 0 }, uLowO2: { value: 0 }, uFade: { value: 0 },
    uSurface: { value: 0 }, uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) }, toneMappingExposure: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uUnder, uTime, uLowO2, uFade, uSurface;
    uniform vec2 uTexel;
    varying vec2 vUv;
    #include <tonemapping_pars_fragment>

    // local sRGB OETF: Three already injects its colour-space helpers into ShaderMaterial prefixes
    vec3 lumenSRGB(vec3 c) {
      c = max(c, 0.0);
      vec3 hi = pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055;
      return mix(hi, c * 12.92, step(c, vec3(0.0031308)));
    }

    // linear-space colour/luma for the FXAA neighbourhood; the whole frame is tone-mapped once, at the end
    vec3 lin(vec2 uv) { return texture2D(tDiffuse, uv).rgb; }
    float luma(vec3 c) { c = sqrt(max(c, 0.0)); return dot(c, vec3(0.299, 0.587, 0.114)); }

    void main() {
      vec2 uv = vUv;
      float wob = uUnder * 0.0014 + uSurface * 0.006;
      uv += vec2(sin(uv.y * 23.0 + uTime * 1.7), cos(uv.x * 19.0 + uTime * 1.3)) * wob;
      vec3 col = texture2D(tDiffuse, uv).rgb;

      // FXAA: replaces the multisampled composer target, which forces an expensive
      // full-resolution resolve on every pass (a particularly slow path in ANGLE).
      vec3 nw = lin(uv + vec2(-1.0, -1.0) * uTexel), ne = lin(uv + vec2(1.0, -1.0) * uTexel);
      vec3 sw = lin(uv + vec2(-1.0, 1.0) * uTexel), se = lin(uv + vec2(1.0, 1.0) * uTexel);
      float lNW = luma(nw), lNE = luma(ne), lSW = luma(sw), lSE = luma(se), lM = luma(col);
      float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
      float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
      if (lMax - lMin > max(0.0312, lMax * 0.125)) {
        vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
        float dirReduce = max((lNW + lNE + lSW + lSE) * 0.25 * 0.03125, 1.0 / 128.0);
        dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + dirReduce), -8.0, 8.0) * uTexel;
        vec3 a = 0.5 * (lin(uv + dir * (1.0 / 3.0 - 0.5)) + lin(uv + dir * (2.0 / 3.0 - 0.5)));
        vec3 b = a * 0.5 + 0.25 * (lin(uv - dir * 0.5) + lin(uv + dir * 0.5));
        col = (luma(b) < lMin || luma(b) > lMax) ? a : b;
      }

      vec2 d = vUv - 0.5;
      col *= 1.0 - dot(d, d) * mix(0.45, 0.75, uUnder);
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      float pulse = 0.75 + 0.25 * sin(uTime * 5.0);
      col = mix(col, vec3(lum), uLowO2 * 0.65);
      col *= 1.0 - uLowO2 * smoothstep(0.15, 0.75, length(d)) * 0.9 * pulse;
      col *= 1.0 - uFade;
      gl_FragColor = vec4(lumenSRGB(ACESFilmicToneMapping(col)), 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, quality) {
    // No samples: the scene target stays a single-sample HDR buffer and the final pass
    // anti-aliases with FXAA. Multisampling this half-float target makes every post pass
    // resolve 4x the pixels through blitFramebuffer, which dominates the frame on large canvases.
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(renderer.getPixelRatio()); // a custom target defaults the composer to ratio 1
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = null;
    if (quality !== 'low') {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.4, 0.35, 1.0);
      // Clamp what feeds the bloom: the sun disc (HDR ~20) and sea glints otherwise smear a white halo over the horizon
      const hp = this.bloom.materialHighPassFilter;
      hp.fragmentShader = hp.fragmentShader.replace('mix( outputColor, texel, alpha )', 'mix( outputColor, min( texel, vec4( 1.6 ) ), alpha )');
      this.composer.addPass(this.bloom);
    }
    this.screen = new ShaderPass(ScreenShader);
    // The pass includes its own tone-mapping chunk. Without this, Three injects the same
    // definitions into the shader prefix (renderer.toneMapping is ACES) and compilation fails.
    this.screen.material.toneMapped = false;
    this.composer.addPass(this.screen);
    this.setSize(window.innerWidth, window.innerHeight);
  }
  get u() { return this.screen.uniforms; }
  setSize(w, h) {
    this.composer.setSize(w, h);
    const rt = this.composer.renderTarget1;
    this.u.uTexel.value.set(1 / Math.max(rt.width, 1), 1 / Math.max(rt.height, 1));
  }
  render(dt) {
    this.u.toneMappingExposure.value = this.composer.renderer.toneMappingExposure;
    this.composer.render(dt);
  }
  dispose() { this.composer.dispose(); }
}
