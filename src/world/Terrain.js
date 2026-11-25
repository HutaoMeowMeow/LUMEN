// Heightmap terrain: 256 m chunks with distance LOD, skirts, and a biome-aware procedural material.
import * as THREE from 'three';
import { WORLD } from './layout.js';
import { stdMat, U } from '../fx/materials.js';
import { getNoiseTexture } from '../fx/textures.js';

const CHUNK = 256;
const CELLS = CHUNK / WORLD.cell; // 128 grid cells per chunk
const NCH = WORLD.size / CHUNK; // 16 chunks per side
const STRIDES = [1, 2, 4, 8, 16];

// Shared world-space terrain shading, also used by cave rock and boulders.
export const TERRAIN_DECL = /* glsl */ `
uniform sampler2D uNoise, uBiome;
uniform float uWorldHalf;
varying vec3 vWNormal;
vec3 terrainAlbedo(vec3 P, vec3 Nw, out float rough) {
  vec4 bio = texture2D(uBiome, (P.xz + uWorldHalf) / (2.0 * uWorldHalf));
  float n1 = texture2D(uNoise, P.xz * 0.043).r;
  float n2 = texture2D(uNoise, P.xz * 0.21).g;
  float n3 = texture2D(uNoise, P.xz * 0.0061).b;
  float nv = texture2D(uNoise, vec2(P.x + P.z, P.y) * 0.05).r; // vertical strata for cliffs
  float slope = 1.0 - Nw.y;
  float y = P.y;
  vec3 sand = mix(vec3(0.8, 0.67, 0.47), vec3(0.95, 0.86, 0.66), n1) * (0.88 + 0.24 * n2);
  sand = mix(sand, sand * vec3(1.04, 0.93, 0.86), smoothstep(0.55, 0.8, n3)); // broad warm/pale drifts
  vec3 silt = mix(vec3(0.46, 0.45, 0.38), vec3(0.6, 0.56, 0.45), n1);
  vec3 rock = mix(vec3(0.33, 0.31, 0.29), vec3(0.52, 0.48, 0.42), n2) * (0.8 + 0.35 * nv);
  vec3 grass = mix(vec3(0.16, 0.31, 0.09), vec3(0.3, 0.44, 0.14), n1) * (0.8 + 0.35 * n2);
  grass = mix(grass, vec3(0.46, 0.43, 0.2) * (0.85 + 0.3 * n1), smoothstep(0.45, 0.75, n3) * 0.55); // dry patches
  vec3 dirt = vec3(0.36, 0.29, 0.2) * (0.8 + 0.3 * n2);
  vec3 ash = mix(vec3(0.09, 0.085, 0.085), vec3(0.2, 0.17, 0.16), n2);
  vec3 ooze = mix(vec3(0.07, 0.08, 0.11), vec3(0.14, 0.14, 0.18), n1);
  vec3 col;
  rough = 0.95;
  if (y > 0.6) {
    float beach = 1.0 - smoothstep(1.6, 3.2 + 1.5 * n1, y);
    col = mix(grass, dirt, smoothstep(0.55, 0.8, n3) * 0.6);
    col = mix(col, sand, beach);
    col = mix(col, rock, smoothstep(0.32, 0.5, slope + 0.1 * n2));
    col = mix(col, ash, bio.a * (1.0 - beach * 0.5));
    col = mix(col, sand * 0.7, (1.0 - smoothstep(0.6, 1.4, y)));
  } else {
    float depthT = smoothstep(-12.0, -45.0, y + 10.0 * (n3 - 0.5));
    col = mix(sand, silt, depthT);
    col *= 0.85 + 0.25 * smoothstep(0.3, 0.7, n2);
    vec3 reefC = mix(vec3(0.6, 0.42, 0.44), vec3(0.48, 0.5, 0.36), n2);
    col = mix(col, reefC, bio.r * smoothstep(0.45, 0.65, n1) * 0.7);
    col = mix(col, silt * vec3(0.75, 0.85, 0.7), bio.g * 0.6);
    col = mix(col, rock * 0.85, smoothstep(0.3, 0.5, slope + 0.12 * n2));
    col = mix(col, ooze, smoothstep(-110.0, -180.0, y) * max(bio.b, 0.6));
    col = mix(col, ash, bio.a * 0.8);
    col = mix(col, sand * 0.6, smoothstep(-1.5, 0.6, y)); // wet sand at the waterline
    rough = mix(0.95, 0.55, smoothstep(-1.0, 0.6, y) * (1.0 - smoothstep(0.6, 1.4, y)));
  }
  return col;
}
`;

const VERT_DECL = /* glsl */ `varying vec3 vWNormal;`;
const VERT_MAIN = /* glsl */ `vWNormal = normalize(mat3(modelMatrix) * objectNormal);`;

const FRAG_COLOR = /* glsl */ `
float tRough;
diffuseColor.rgb *= terrainAlbedo(vWPos, normalize(vWNormal), tRough);
`;
// small-scale ripples and grit via noise gradient (cheap bump)
const FRAG_NORMAL = /* glsl */ `
{
  float e = 0.35;
  float s = vWPos.y < 0.5 ? 0.9 : 0.5;
  vec2 q = vWPos.xz;
  float rip = vWPos.y < 0.5 ? 1.0 : 0.0;
  float h0 = texture2D(uNoise, q * 0.37).g + rip * 0.5 * sin(dot(q, vec2(0.9, 0.35)) * 2.2 + texture2D(uNoise, q * 0.03).r * 8.0);
  float hx = texture2D(uNoise, (q + vec2(e, 0.0)) * 0.37).g + rip * 0.5 * sin(dot(q + vec2(e, 0.0), vec2(0.9, 0.35)) * 2.2 + texture2D(uNoise, (q + vec2(e, 0.0)) * 0.03).r * 8.0);
  float hz = texture2D(uNoise, (q + vec2(0.0, e)) * 0.37).g + rip * 0.5 * sin(dot(q + vec2(0.0, e), vec2(0.9, 0.35)) * 2.2 + texture2D(uNoise, (q + vec2(0.0, e)) * 0.03).r * 8.0);
  vec3 bw = normalize(vec3(-(hx - h0) / e * 0.12 * s, 1.0, -(hz - h0) / e * 0.12 * s));
  float fade = 1.0 - smoothstep(25.0, 70.0, length(vWPos - cameraPosition));
  vec3 bv = normalize((viewMatrix * vec4(bw, 0.0)).xyz);
  vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  normal = normalize(normal + (bv - up) * fade * normalize(vWNormal).y);
}
`;

export function terrainUniforms(world) {
  const biomeTex = new THREE.DataTexture(world.biome, WORLD.biomeRes, WORLD.biomeRes, THREE.RGBAFormat);
  biomeTex.magFilter = THREE.LinearFilter;
  biomeTex.minFilter = THREE.LinearFilter;
  biomeTex.needsUpdate = true;
  return { uNoise: { value: getNoiseTexture() }, uBiome: { value: biomeTex }, uWorldHalf: { value: WORLD.half } };
}

export function makeTerrainMaterial(uniforms, key = 'terrain', extra = {}) {
  return stdMat({ color: 0xffffff, roughness: 0.95, metalness: 0 }, {
    key, uniforms,
    vertDecl: VERT_DECL, vertMain: VERT_MAIN,
    fragDecl: TERRAIN_DECL + (extra.fragDecl || ''),
    fragColor: FRAG_COLOR + (extra.fragColor || ''),
    fragNormal: FRAG_NORMAL,
    fragEmissive: extra.fragEmissive || '',
  });
}

// Index buffers shared by all chunks of one LOD
function buildIndex(n) {
  const idx = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // skirt: ring of n*4 vertices after the grid, following the perimeter
  const base = n * n;
  const per = [];
  for (let i = 0; i < n; i++) per.push(i);
  for (let j = 1; j < n; j++) per.push(j * n + n - 1);
  for (let i = n - 2; i >= 0; i--) per.push((n - 1) * n + i);
  for (let j = n - 2; j > 0; j--) per.push(j * n);
  const m = per.length;
  for (let k = 0; k < m; k++) {
    const a = per[k], b = per[(k + 1) % m], sa = base + k, sb = base + ((k + 1) % m);
    idx.push(a, b, sa, b, sb, sa, a, sa, b, b, sa, sb);
  }
  return { index: idx, perimeter: per };
}

export class Terrain {
  constructor(scene, world, quality) {
    this.scene = scene;
    this.world = world;
    this.uniforms = terrainUniforms(world);
    this.material = makeTerrainMaterial(this.uniforms);
    this.lodDist = quality === 'low' ? [220, 420, 800, 1400] : quality === 'ultra' ? [420, 800, 1400, 2200] : [300, 600, 1100, 1800];
    this.indices = STRIDES.map((s) => {
      const n = CELLS / s + 1;
      const { index, perimeter } = buildIndex(n);
      return { n, perimeter, attr: new THREE.Uint32BufferAttribute(index, 1) };
    });
    this.chunks = [];
    for (let cz = 0; cz < NCH; cz++) for (let cx = 0; cx < NCH; cx++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      let hmin = Infinity, hmax = -Infinity;
      for (let j = 0; j <= CELLS; j += 4) for (let i = 0; i <= CELLS; i += 4) {
        const h = world.hAt(cx * CELLS + i, cz * CELLS + j);
        if (h < hmin) hmin = h; if (h > hmax) hmax = h;
      }
      const x0 = -WORLD.half + cx * CHUNK, z0 = -WORLD.half + cz * CHUNK;
      this.chunks.push({ cx, cz, mesh, lod: -1, geos: [], hmin, hmax, cxw: x0 + CHUNK / 2, czw: z0 + CHUNK / 2 });
      scene.add(mesh);
    }
  }

  _geometry(ch, lod) {
    if (ch.geos[lod]) return ch.geos[lod];
    const s = STRIDES[lod];
    const { n, perimeter, attr } = this.indices[lod];
    const W = this.world;
    const cnt = n * n + perimeter.length;
    const pos = new Float32Array(cnt * 3), nrm = new Float32Array(cnt * 3);
    const gx0 = ch.cx * CELLS, gz0 = ch.cz * CELLS, cell = WORLD.cell;
    let k = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++, k++) {
      const gi = gx0 + i * s, gj = gz0 + j * s;
      pos[k * 3] = -WORLD.half + gi * cell;
      pos[k * 3 + 1] = W.hAt(gi, gj);
      pos[k * 3 + 2] = -WORLD.half + gj * cell;
      const dx = W.hAt(gi + 1, gj) - W.hAt(gi - 1, gj), dz = W.hAt(gi, gj + 1) - W.hAt(gi, gj - 1);
      const l = Math.hypot(dx, 2 * cell, dz);
      nrm[k * 3] = -dx / l; nrm[k * 3 + 1] = (2 * cell) / l; nrm[k * 3 + 2] = -dz / l;
    }
    const drop = 2 + s * 3;
    for (const p of perimeter) {
      pos[k * 3] = pos[p * 3]; pos[k * 3 + 1] = pos[p * 3 + 1] - drop; pos[k * 3 + 2] = pos[p * 3 + 2];
      nrm[k * 3] = nrm[p * 3]; nrm[k * 3 + 1] = nrm[p * 3 + 1]; nrm[k * 3 + 2] = nrm[p * 3 + 2];
      k++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(attr);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(ch.cxw - CHUNK / 2, ch.hmin - drop, ch.czw - CHUNK / 2), new THREE.Vector3(ch.cxw + CHUNK / 2, ch.hmax, ch.czw + CHUNK / 2));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    ch.geos[lod] = g;
    return g;
  }

  // Builds the nearby chunks immediately (used during loading)
  prewarm(x, z) {
    for (const ch of this.chunks) {
      const d = Math.hypot(ch.cxw - x, ch.czw - z);
      if (d < 700) this._geometry(ch, this._lodFor(d));
    }
  }

  _lodFor(d) {
    const L = this.lodDist;
    return d < L[0] ? 0 : d < L[1] ? 1 : d < L[2] ? 2 : d < L[3] ? 3 : 4;
  }

  update(camera, underwaterViewDist) {
    const cp = camera.position;
    const under = U.uCamUnder.value > 0.5;
    let builds = 0;
    for (const ch of this.chunks) {
      // distance from camera to the chunk's footprint
      const dx = Math.max(Math.abs(cp.x - ch.cxw) - CHUNK / 2, 0), dz = Math.max(Math.abs(cp.z - ch.czw) - CHUNK / 2, 0);
      const dEdge = Math.hypot(dx, dz);
      let vis = true;
      if (under && dEdge > underwaterViewDist) vis = false;
      // from above water the ocean is >99% opaque over 25 m of water (Ocean.js alpha), so wholly deep chunks can't be seen
      if (!under && ch.hmax < -25 && dEdge > 40) vis = false;
      ch.mesh.visible = vis;
      if (!vis) continue;
      const dC = Math.hypot(cp.x - ch.cxw, cp.z - ch.czw);
      let want = this._lodFor(Math.max(0, dC - 60));
      if (ch.lod >= 0 && want !== ch.lod) {
        // hysteresis: only switch when well past the threshold
        const alt = this._lodFor(Math.max(0, dC - 60 + (want > ch.lod ? -40 : 40)));
        if (alt === ch.lod) want = ch.lod;
      }
      if (want !== ch.lod) {
        if (!ch.geos[want] && builds >= 3 && ch.lod >= 0) continue;
        if (!ch.geos[want]) builds++;
        ch.mesh.geometry = this._geometry(ch, want);
        ch.lod = want;
      }
      ch.mesh.castShadow = dEdge < 200;
    }
  }
}
