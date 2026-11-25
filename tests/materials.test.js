// The material patch splices GLSL into three's standard shader by string anchors; no GPU here,
// so check that every anchor still exists and the injected code lands in a usable order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { stdMat } from '../src/fx/materials.js';

function patched(opts) {
  const mat = stdMat({}, opts);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  mat.onBeforeCompile(shader);
  return { mat, shader };
}

test('every injected hook finds its anchor in the standard shader', () => {
  const { shader } = patched({ detail: { kind: 'coral' }, ao: { min: 0.5, height: 1 }, translucent: 0.5, sway: 'water' });
  const f = shader.fragmentShader, v = shader.vertexShader;
  for (const s of ['lumenDetail', 'float lumenAO', 'float lumenH', 'uTranslucency', 'uWaterFogDensity', 'uGlowPos']) assert.ok(f.includes(s), s);
  assert.ok(v.includes('vLPos = transformed') && v.includes('vWPos = lw.xyz'));
  assert.ok(!v.includes('#include <project_vertex>') && !f.includes('#include <fog_fragment>'));
  for (const u of ['uDetailTex', 'uDetailScale', 'uAOMin', 'uTranslucency', 'uSwayAmp', 'uTime']) assert.ok(shader.uniforms[u], u);
});

test('declarations precede uses in the fragment shader', () => {
  const f = patched({ detail: { kind: 'rock' } }).shader.fragmentShader;
  const at = (s) => { const i = f.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('float lumenAO') < at('*= lumenAO'));
  assert.ok(at('float lumenH') < at('dFdx(lumenH)'));
  assert.ok(at('#include <roughnessmap_fragment>') < at('roughnessFactor = clamp'));
  assert.ok(at('#include <normal_fragment_begin>') < at('float lumenFD') && at('float lumenFD') < at('* lumenFD'));
});

test('shadow filtering patch lands in three\'s PCF and leaf canopies keep their volume normals', () => {
  const f = patched({ translucent: 0.5, leafOnly: true, volume: true }).shader.fragmentShader;
  const at = (s) => { const i = f.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at('float lumenShadowFp') < at('max(shadowRadius, lumenShadowFp)'), 'PCF radius anchor (three upgrade?)');
  assert.equal(f.split('shadowIntensity * ( 1.0 - lumenShadowSoft )').length - 1, 5, 'shadow return anchors');
  assert.ok(at('float lumenLeaf') < at('if (lumenLeaf > 0.5)'));
  assert.ok(at('#include <normal_fragment_begin>') < at('nonPerturbedNormal = normal; lumenFD'));
  assert.ok(patched({ volume: true }).mat.defines.LEAF_VOLUME);
});

test('feature defines and cache keys differ per option set', () => {
  const a = patched({ key: 'x' }).mat, b = patched({ key: 'x', detail: { kind: 'bark' }, translucent: 1 }).mat;
  assert.equal(b.defines.DETAIL_KIND, 2);
  assert.ok(b.defines.TRANSLUCENT && !a.defines?.DETAIL);
  assert.notEqual(a.customProgramCacheKey(), b.customProgramCacheKey());
});
