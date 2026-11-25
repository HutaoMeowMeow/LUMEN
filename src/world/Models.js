// Bundled CC0 photogrammetry props (Poly Haven, see public/models/CREDITS.txt), loaded once before the world streams.
// Each glTF scene is merged into one BufferGeometry (base at y=0, centred in xz) so Vegetation can instance it like
// its procedural types; the PBR textures come along for its material(s): one geometry group per glTF material.
// Files that pack several plants side by side are split by node-name suffix into MODELS['<id>_<suffix>'].
// A model that fails to load is simply left out.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// id -> scale from the file's metres to one local unit of instance scale, or [scale, variant suffixes to split out]
const LIST = {
  lambis_shell: 1.6, rock_09: 8, dry_branches_medium_01: 1.2, calathea_orbifolia_01: 1.8,
  pachira_aquatica_01: [3.2, ['c', 'd']], fern_02: [2.2, ['b', 'c']], anthurium_botany_01: [2, ['c']],
};

export const MODELS = {};

function merge(scene, scale, only) {
  scene.updateMatrixWorld(true);
  const byMat = new Map(); // material -> geometries using it, in first-seen order
  scene.traverse((o) => {
    if (!o.isMesh || (only && !o.name.endsWith('_' + only) && !o.parent?.name.endsWith('_' + only))) return;
    const g = new THREE.BufferGeometry();
    for (const a of ['position', 'normal', 'uv']) g.setAttribute(a, o.geometry.getAttribute(a));
    g.setIndex(o.geometry.index);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g.applyMatrix4(o.matrixWorld));
  });
  const mats = [...byMat.keys()];
  const per = [...byMat.values()].map((p) => (p.length > 1 ? mergeGeometries(p) : p[0]));
  const geo = per.length > 1 ? mergeGeometries(per, true) : per[0];
  if (!geo) throw new Error('no meshes' + (only ? ' for variant ' + only : ''));
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2).scale(scale, scale, scale);
  geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
  geo.computeBoundingSphere();
  return { geo, mat: mats[0], mats };
}

export async function loadModels(base = import.meta.env.BASE_URL) {
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(LIST).map(async ([id, scale]) => {
    try {
      const gltf = await loader.loadAsync(`${base}models/${id}/${id}_1k.gltf`);
      if (Array.isArray(scale)) for (const v of scale[1]) MODELS[id + '_' + v] = merge(gltf.scene, scale[0], v);
      else MODELS[id] = merge(gltf.scene, scale);
    } catch (e) {
      console.warn('LUMEN: model not loaded, skipping', id, e);
    }
  }));
  return MODELS;
}
