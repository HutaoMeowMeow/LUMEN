// Animated, tileable caustics rendered into a small texture each frame (periodic animated Voronoi edges).
import * as THREE from 'three';
import { U } from './materials.js';

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float edges(vec2 uv, float P, float t) {
  vec2 p = uv * P, ip = floor(p), fp = fract(p);
  float f1 = 8.0, f2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash2(mod(ip + g, P));
    o = 0.5 + 0.42 * sin(t * (0.6 + o.yx * 0.8) + 6.2831 * o);
    float d = length(g + o - fp);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return f2 - f1;
}
void main() {
  float e1 = edges(vUv, 6.0, uTime * 0.9);
  float e2 = edges(fract(vUv + 0.31), 9.0, uTime * 1.25);
  float c = pow(1.0 - smoothstep(0.0, 0.2, e1), 2.2) * 0.8 + pow(1.0 - smoothstep(0.0, 0.16, e2), 2.0) * 0.5;
  gl_FragColor = vec4(vec3(c), 1.0);
}`;

export class Caustics {
  constructor(renderer, size = 512) {
    this.renderer = renderer;
    this.rt = new THREE.WebGLRenderTarget(size, size, {
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      generateMipmaps: true, depthBuffer: false,
    });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
      depthTest: false, depthWrite: false,
    });
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    U.uCaustics.value = this.rt.texture;
    this.frame = 0;
  }

  update(time) {
    // caustics change slowly; refresh at half rate
    if ((this.frame++ & 1) === 1) return;
    this.mat.uniforms.uTime.value = time;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.cam);
    this.renderer.setRenderTarget(prev);
  }
}
