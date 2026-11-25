// Underwater god rays: additive camera-facing ribbons hanging from the surface along the refracted sun.
import * as THREE from 'three';
import { U } from './materials.js';

const RANGE = 90;

const VERT = /* glsl */ `
attribute vec4 aShaft; // x, z offset in the wrap cell, width, phase
uniform vec3 uCam, uDir;
uniform float uLen;
varying vec2 vUv;
varying float vPhase, vDist;
void main() {
  vec2 c = mod(aShaft.xy - uCam.xz + ${RANGE / 2}.0, ${RANGE}.0) - ${RANGE / 2}.0 + uCam.xz;
  vec3 top = vec3(c.x, 0.0, c.y);
  vec3 mid = top + uDir * uLen * 0.5;
  vec3 side = normalize(cross(uDir, mid - cameraPosition));
  vec3 p = top + uDir * (-position.y * uLen) + side * position.x * aShaft.z;
  vUv = vec2(position.x + 0.5, -position.y);
  vPhase = aShaft.w;
  vDist = length(c - uCam.xz);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const FRAG = /* glsl */ `
uniform float uTime, uStrength;
uniform vec3 uColor;
varying vec2 vUv;
varying float vPhase, vDist;
void main() {
  float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
  edge *= edge;
  float along = smoothstep(0.0, 0.06, vUv.y) * pow(1.0 - vUv.y, 2.2);
  float flick = 0.55 + 0.45 * sin(uTime * (0.4 + fract(vPhase * 7.0) * 0.5) + vPhase * 6.28);
  float fade = 1.0 - smoothstep(${RANGE / 2 - 18}.0, ${RANGE / 2}.0, vDist);
  gl_FragColor = vec4(uColor * edge * along * flick * fade * uStrength, 1.0);
}`;

export class LightShafts {
  constructor(scene, count = 40) {
    const base = new THREE.PlaneGeometry(1, 1, 1, 8);
    base.translate(0, -0.5, 0);
    const g = new THREE.InstancedBufferGeometry().copy(base);
    g.instanceCount = count;
    const a = new Float32Array(Math.max(count, 1) * 4);
    for (let i = 0; i < count; i++) {
      a[i * 4] = Math.random() * RANGE; a[i * 4 + 1] = Math.random() * RANGE;
      a[i * 4 + 2] = 1.5 + Math.random() * 5; a[i * 4 + 3] = Math.random();
    }
    g.setAttribute('aShaft', new THREE.InstancedBufferAttribute(a, 4));
    this.u = {
      uTime: U.uTime, uCam: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(0, -1, 0) },
      uLen: { value: 60 }, uStrength: { value: 0 }, uColor: { value: new THREE.Color(0.35, 0.75, 0.85) },
    };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.enabled = count > 0;
    this.mesh.visible = this.enabled;
    scene.add(this.mesh);
  }

  update(camera, sky, caveDark) {
    const under = U.uCamUnder.value > 0.5;
    const s = sky.day * (1 - caveDark) * Math.max(0, 1 + camera.position.y / 140) * 0.16;
    this.mesh.visible = this.enabled && under && s > 0.002;
    this.u.uCam.value.copy(camera.position);
    // refract the sun into water (Snell, n = 1.33) for the shaft direction
    const L = sky.sunDir, hl = Math.hypot(L.x, L.z) || 1, h = Math.hypot(L.x, L.z) / 1.33;
    this.u.uDir.value.set(-L.x / hl * h, -Math.sqrt(Math.max(0, 1 - h * h)), -L.z / hl * h).normalize();
    this.u.uStrength.value = s;
  }
}
