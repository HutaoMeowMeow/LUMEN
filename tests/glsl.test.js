// GLSL smoothstep is undefined when edge0 >= edge1 (works on some drivers, not all): keep literal edges ascending.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SHADER_FILES = ['src/fx/materials.js', 'src/fx/Particles.js', 'src/fx/LightShafts.js', 'src/fx/PostFX.js', 'src/fx/Caustics.js',
  'src/world/Sky.js', 'src/world/Ocean.js', 'src/world/Structures.js', 'src/world/Terrain.js', 'src/world/CaveMeshes.js'];

test('GLSL smoothstep literal edges are ascending', () => {
  const bad = [];
  for (const f of SHADER_FILES) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/smoothstep\((-?[0-9.]+), *(-?[0-9.]+),/g)) {
      if (parseFloat(m[1]) >= parseFloat(m[2])) bad.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});
