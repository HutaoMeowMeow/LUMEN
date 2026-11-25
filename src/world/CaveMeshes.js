// Renders the surface-nets cave meshes produced by the world workers.
import * as THREE from 'three';
import { CAVES } from './layout.js';
import { stdMat } from '../fx/materials.js';
import { TERRAIN_DECL } from './Terrain.js';

const GLOW = { grotto: [0.2, 0.9, 0.85], labyrinth: [0.45, 0.35, 1.0], arch: [0, 0, 0] };

export function buildCaves(scene, world, terrainUniforms) {
  const meshes = [];
  CAVES.forEach((C, i) => {
    const m = world.caveMeshes[i];
    if (!m || !m.positions.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    g.setAttribute('aInner', new THREE.BufferAttribute(m.inner, 1));
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const gc = GLOW[C.id] || [0, 0, 0];
    const mat = stdMat({ color: 0xffffff, roughness: 0.9, metalness: 0 }, {
      key: 'cave', uniforms: { ...terrainUniforms, uCaveGlow: { value: new THREE.Vector3(...gc) } },
      vertDecl: 'attribute float aInner; varying float vInner; varying vec3 vWNormal;',
      vertMain: 'vInner = aInner; vWNormal = normalize(mat3(modelMatrix) * objectNormal);',
      fragDecl: TERRAIN_DECL + 'uniform vec3 uCaveGlow; varying float vInner;',
      fragColor: /* glsl */ `
        float tr;
        vec3 Nw = normalize(vWNormal);
        vec3 base = terrainAlbedo(vWPos, vec3(0.0, 0.2, 0.0), tr);
        float nn = texture2D(uNoise, vec2(vWPos.x * 0.07 + vWPos.y * 0.05, vWPos.z * 0.07 - vWPos.y * 0.03)).r;
        vec3 wall = mix(vec3(0.24, 0.23, 0.25), vec3(0.42, 0.38, 0.34), nn);
        diffuseColor.rgb *= mix(base, wall, max(vInner, 1.0 - smoothstep(0.2, 0.6, Nw.y)));`,
      fragEmissive: /* glsl */ `
        {
          // sparse glowing colonies: fine ridged noise gated by a slow patch mask so walls are mostly bare rock
          float sp = texture2D(uNoise, vWPos.xz * 0.07 + vWPos.y * 0.05).a * texture2D(uNoise, vWPos.zx * 0.055 - vWPos.y * 0.04).a;
          float patchy = smoothstep(0.55, 0.75, texture2D(uNoise, vWPos.xz * 0.006 + vWPos.y * 0.004).b);
          float spots = smoothstep(0.78, 0.92, sp) * patchy * vInner;
          totalEmissiveRadiance += uCaveGlow * spots * (0.8 + 0.4 * sin(uTime * 1.3 + vWPos.x * 0.5));
        }`,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'cave:' + C.id;
    scene.add(mesh);
    meshes.push(mesh);
  });
  return meshes;
}
