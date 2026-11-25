// Heightmap terrain: 256 m chunks with distance LOD, skirts, and a biome-aware procedural material.
import * as THREE from 'three';
import { WORLD } from './layout.js';
import { stdMat, U } from '../fx/materials.js';
import { getNoiseTexture } from '../fx/textures.js';
import { canopyAt } from './Vegetation.js';

const CHUNK = 256;
const CELLS = CHUNK / WORLD.cell; // 128 grid cells per chunk
const NCH = WORLD.size / CHUNK; // 16 chunks per side
const STRIDES = [1, 2, 4, 8, 16];

// Shared world-space terrain shading, also used by cave rock and boulders.
export const TERRAIN_DECL = /* glsl */ `
uniform sampler2D uNoise, uBiome;
uniform float uWorldHalf;
varying vec3 vWNormal;
float tCanopy = 0.0; // closed-canopy cover; the terrain material sets it from a vertex attribute, cave rock leaves 0
// triplanar sample: cliffs get undistorted rock instead of the top-down projection smeared down their faces
vec4 terrainTri(vec3 P, vec3 Nw, float s) {
  vec3 w = pow(abs(Nw) + 1e-3, vec3(4.0));
  w /= w.x + w.y + w.z;
  return texture2D(uNoise, P.zy * s) * w.x + texture2D(uNoise, P.xz * s) * w.y + texture2D(uNoise, P.xy * s) * w.z;
}
// rock relief 0..1: grain, bedding strata and fractures
float terrainRockH(vec3 P, vec3 Nw, out float crack) {
  vec4 a = terrainTri(P, Nw, 0.045), b = terrainTri(P, Nw, 0.19);
  float strata = 0.5 + 0.5 * sin(P.y * 1.6 + a.b * 7.0 + a.r * 2.0);
  crack = smoothstep(0.86, 0.97, b.a) * (0.5 + 0.5 * a.g);
  return clamp(0.25 + 0.35 * a.r + 0.25 * b.g + 0.2 * strata - crack * 0.6, 0.0, 1.0);
}
vec3 terrainAlbedo(vec3 P, vec3 Nw, out float rough) {
  vec4 bio = texture2D(uBiome, (P.xz + uWorldHalf) / (2.0 * uWorldHalf));
  float n1 = texture2D(uNoise, P.xz * 0.043).r;
  float n2 = texture2D(uNoise, P.xz * 0.21).g;
  float n3 = texture2D(uNoise, P.xz * 0.0061).b;
  float slope = 1.0 - Nw.y;
  float y = P.y;
  float crack;
  float rh = terrainRockH(P, Nw, crack);
  vec3 sand = mix(vec3(0.72, 0.57, 0.37), vec3(0.88, 0.74, 0.5), n1) * (0.88 + 0.24 * n2); // warm cream, not white under the noon sun
  sand = mix(sand, sand * vec3(1.04, 0.93, 0.86), smoothstep(0.55, 0.8, n3)); // broad warm/pale drifts
  vec3 silt = mix(vec3(0.46, 0.45, 0.38), vec3(0.6, 0.56, 0.45), n1);
  vec3 rock = mix(vec3(0.3, 0.285, 0.265), vec3(0.55, 0.5, 0.43), rh) * (0.9 + 0.2 * n2);
  rock = mix(rock, rock * vec3(1.08, 0.95, 0.82), smoothstep(0.4, 0.8, n3) * 0.6); // iron staining
  rock *= 1.0 - crack * 0.45;
  // moss and lichen on ledges and the upper faces of dry rock
  float moss = smoothstep(0.45, 0.8, Nw.y + 0.35 * (n1 - 0.5)) * smoothstep(1.5, 4.0, y) * (1.0 - bio.a);
  rock = mix(rock, mix(vec3(0.16, 0.25, 0.09), vec3(0.42, 0.44, 0.3), n2) * (0.8 + 0.3 * rh), moss * 0.7);
  vec3 grass = mix(vec3(0.16, 0.31, 0.09), vec3(0.3, 0.44, 0.14), n1) * (0.8 + 0.35 * n2);
  grass = mix(grass, vec3(0.46, 0.43, 0.2) * (0.85 + 0.3 * n1), smoothstep(0.55, 0.8, n3) * 0.3); // dry patches
  vec3 dirt = vec3(0.36, 0.29, 0.2) * (0.8 + 0.3 * n2);
  vec3 ash = mix(vec3(0.09, 0.085, 0.085), vec3(0.2, 0.17, 0.16), n2);
  vec3 ooze = mix(vec3(0.07, 0.08, 0.11), vec3(0.14, 0.14, 0.18), n1);
  vec3 col;
  rough = 0.95;
  if (y > 0.6) {
    // fine detail fades to its mip average with distance so far ground never shimmers
    float fine = 1.0 - smoothstep(12.0, 55.0, length(P - cameraPosition));
    vec4 fA = texture2D(uNoise, P.xz * 1.3);  // grain / leaf scale (~2-10 cm)
    vec4 fB = texture2D(uNoise, P.xz * 0.11); // patch scale (~1-9 m)
    // sand: grain jitter, dark mineral specks and pale shell grit
    float fineS = fine * fine; // sand speckle drops off sooner than leaf litter: beyond ~30 m it only shimmers
    float grain = (fA.g - 0.5) * 0.7 + (texture2D(uNoise, P.xz * 0.42).b - 0.5) * 0.5; // two grain scales, no single repeating size
    sand *= 1.0 + grain * 0.13 * fineS;
    sand = mix(sand, sand * vec3(0.62, 0.58, 0.55), smoothstep(0.86, 0.97, fA.a) * 0.35 * fineS);
    sand = mix(sand, sand * vec3(1.18, 1.16, 1.12), smoothstep(0.88, 0.97, fA.r) * 0.3 * fineS); // shell grit: a lift, not white dots
    // tide line: wavy wet band, damp darker sand above it, a thin wrack of dried weed at the high-water mark
    float wl = 1.05 + 0.4 * (fB.r - 0.5) + 0.18 * sin(P.x * 0.09 + P.z * 0.06 + 6.0 * n3);
    float wet = 1.0 - smoothstep(wl - 0.12, wl + 0.08, y);
    float damp = 1.0 - smoothstep(wl, wl + 0.9 + 0.4 * n1, y);
    float hw = wl + 1.05 + 0.25 * n2;
    float wrack = (1.0 - smoothstep(0.03, 0.14, abs(y - hw))) * smoothstep(0.45, 0.7, fB.b + 0.3 * (n2 - 0.5));
    vec3 drySand = sand;
    sand = mix(sand, sand * vec3(0.8, 0.78, 0.76), damp * 0.8);
    sand = mix(sand, drySand * vec3(0.56, 0.54, 0.53), wet);
    sand = mix(sand, mix(vec3(0.2, 0.17, 0.11), vec3(0.36, 0.3, 0.18), fA.g), wrack * 0.75);
    float sandRough = mix(mix(0.93 + 0.07 * fA.g, 0.82, damp), 0.42 + 0.08 * fA.r, wet);
    // forest floor: leaf litter mosaic, humus, root/twig lines and pebbles; grass ground cover in the open
    vec3 leafC = mix(vec3(0.2, 0.13, 0.07), vec3(0.38, 0.25, 0.11), fA.g); // tropical litter is dark and damp; pale tan read as beach sand
    leafC = mix(leafC, vec3(0.3, 0.3, 0.12), smoothstep(0.62, 0.8, fA.r) * 0.6); // fresh yellow-green fall
    leafC = mix(leafC, vec3(0.48, 0.3, 0.13), smoothstep(0.75, 0.9, fA.b) * 0.4);
    leafC = mix(vec3(0.26, 0.18, 0.1), leafC, fine); // far: average colour, no speckle
    vec3 humus = mix(vec3(0.12, 0.09, 0.06), vec3(0.12, 0.17, 0.07), smoothstep(0.5, 0.8, fB.r)) * (0.85 + 0.3 * n2); // with mossy damp hollows
    vec3 floorC = mix(humus, leafC, smoothstep(0.25, 0.6, fA.a + 0.25 * fB.g) * (0.55 + 0.45 * fine));
    float twig = smoothstep(0.9, 0.97, texture2D(uNoise, P.xz * vec2(0.23, 0.61) + n1).a) * fine;
    floorC = mix(floorC, vec3(0.25, 0.19, 0.13), twig * 0.7);
    float pebble = smoothstep(0.83, 0.9, texture2D(uNoise, P.xz * 1.1 + 0.37).r) * fine;
    floorC = mix(floorC, vec3(0.42, 0.4, 0.37) * (0.8 + 0.4 * fA.g), pebble * 0.8);
    // litter lies under the trees (tCanopy); in the open only the odd bare scuff breaks the turf
    float litter = max(tCanopy * (0.7 + 0.3 * smoothstep(0.3, 0.6, fB.b)), smoothstep(0.62, 0.85, fB.b + 0.35 * (n1 - 0.5)) * 0.45) * smoothstep(3.5, 7.0, y);
    grass *= mix(vec3(1.0), vec3(1.12, 1.05, 0.8), smoothstep(0.55, 0.85, fB.r)); // sun-bleached swathes
    grass *= 1.0 + (fA.g - 0.5) * 0.2 * fine;
    float beach = 1.0 - smoothstep(1.6, 3.2 + 1.5 * n1, y + 0.9 * (fB.g - 0.5));
    col = mix(grass, dirt, smoothstep(0.62, 0.85, n3) * 0.3);
    col = mix(col, floorC, litter * 0.85);
    rough = mix(0.88, 0.8, litter);
    col = mix(col, mix(sand, dirt, 0.45) * 0.92, beach * (1.0 - beach) * 2.4); // sandy soil between beach and turf
    col = mix(col, sand, smoothstep(0.25, 0.75, beach));
    rough = mix(rough, sandRough, smoothstep(0.25, 0.75, beach));
    // rock: quartz veins and lichen, darker where it meets the soil so it sits in the ground
    float rb = smoothstep(0.36, 0.54, slope + 0.1 * n2); // vegetation holds all but the steepest ground
    vec4 rt = terrainTri(P, Nw, 0.6);
    rock = mix(rock, vec3(0.7, 0.67, 0.6), smoothstep(0.95, 0.99, terrainTri(P, Nw, 0.07).a) * 0.45);
    rock = mix(rock, mix(vec3(0.62, 0.6, 0.5), vec3(0.62, 0.45, 0.22), rt.b), smoothstep(0.78, 0.9, rt.r) * smoothstep(0.3, 0.7, Nw.y + 0.3) * 0.35 * fine);
    col = mix(col, rock, rb);
    col *= 1.0 - 0.3 * rb * (1.0 - rb) * 4.0;
    rough = mix(rough, mix(0.97, 0.78, rh) + crack * 0.05, rb);
    col = mix(col, col * 0.62, damp * rb); // splash-darkened rock at the shore
    rough = mix(rough, 0.5, wet * rb);
    col = mix(col, ash, bio.a * (1.0 - beach * 0.5));
    rough = mix(rough, 0.97, bio.a);
  } else {
    float depthT = (1.0 - smoothstep(-45.0, -12.0, y + 10.0 * (n3 - 0.5)));
    col = mix(sand, silt, depthT);
    col *= 0.85 + 0.25 * smoothstep(0.3, 0.7, n2);
    vec3 reefC = mix(vec3(0.6, 0.42, 0.44), vec3(0.48, 0.5, 0.36), n2);
    col = mix(col, reefC, bio.r * smoothstep(0.45, 0.65, n1) * 0.7);
    col = mix(col, silt * vec3(0.75, 0.85, 0.7), bio.g * 0.6);
    col = mix(col, rock * 0.85, smoothstep(0.3, 0.5, slope + 0.12 * n2));
    col = mix(col, ooze, (1.0 - smoothstep(-180.0, -110.0, y)) * max(bio.b, 0.6));
    col = mix(col, ash, bio.a * 0.8);
    col = mix(col, sand * 0.56, smoothstep(-1.5, 0.6, y)); // wet sand at the waterline, matching the band above
    rough = mix(0.95, 0.45, smoothstep(-1.0, 0.6, y));
  }
  return col;
}
`;

const VERT_DECL = /* glsl */ `varying vec3 vWNormal; attribute float aCanopy; varying float vCanopy;`;
const VERT_MAIN = /* glsl */ `vWNormal = normalize(mat3(modelMatrix) * objectNormal); vCanopy = aCanopy;`;

const FRAG_COLOR = /* glsl */ `
float tRough;
tCanopy = vCanopy;
diffuseColor.rgb *= terrainAlbedo(vWPos, normalize(vWNormal), tRough);
`;
// small-scale ripples and grit via noise gradient (cheap bump)
const FRAG_NORMAL = /* glsl */ `
roughnessFactor = tRough;
{
  float e = 0.35;
  vec2 q = vWPos.xz;
  float rip = vWPos.y < 0.5 ? 1.0 : 0.0;
  // dry beach: wind ripples (analytic slope, ~0.7 m wavelength, steep lee side), broken up where the sand is disturbed
  float bch = 1.0 - smoothstep(1.6, 3.2 + 1.5 * texture2D(uNoise, q * 0.043).r, vWPos.y + 0.9 * (texture2D(uNoise, q * 0.11).g - 0.5));
  float disturbed = smoothstep(0.55, 0.75, texture2D(uNoise, q * 0.05).a);
  float dry = (1.0 - rip) * smoothstep(0.75, 0.95, bch) * smoothstep(1.3, 2.1, vWPos.y) * (1.0 - smoothstep(0.2, 0.35, 1.0 - normalize(vWNormal).y));
  float s = vWPos.y < 0.5 ? 0.9 : mix(0.5, 0.9, disturbed * bch);
  vec2 wd = vec2(0.8, 0.6);
  float ph = dot(q, wd) * 9.0 + texture2D(uNoise, q * 0.06).r * 10.0;
  vec2 dg = wd * (cos(ph) + 0.35 * cos(2.0 * ph)) * 0.11 * dry * (1.0 - 0.85 * disturbed);
  float h0 = texture2D(uNoise, q * 0.37).g + rip * 0.5 * sin(dot(q, vec2(0.9, 0.35)) * 2.2 + texture2D(uNoise, q * 0.03).r * 8.0);
  float hx = texture2D(uNoise, (q + vec2(e, 0.0)) * 0.37).g + rip * 0.5 * sin(dot(q + vec2(e, 0.0), vec2(0.9, 0.35)) * 2.2 + texture2D(uNoise, (q + vec2(e, 0.0)) * 0.03).r * 8.0);
  float hz = texture2D(uNoise, (q + vec2(0.0, e)) * 0.37).g + rip * 0.5 * sin(dot(q + vec2(0.0, e), vec2(0.9, 0.35)) * 2.2 + texture2D(uNoise, (q + vec2(0.0, e)) * 0.03).r * 8.0);
  vec3 bw = normalize(vec3(-(hx - h0) / e * 0.12 * s - dg.x, 1.0, -(hz - h0) / e * 0.12 * s - dg.y));
  float fade = 1.0 - smoothstep(25.0, 70.0, length(vWPos - cameraPosition));
  vec3 bv = normalize((viewMatrix * vec4(bw, 0.0)).xyz);
  vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  normal = normalize(normal + (bv - up) * fade * normalize(vWNormal).y);
  // cliff relief: derivative bump from the triplanar rock height, on slopes only
  vec3 nw = normalize(vWNormal);
  float cr;
  float rh = terrainRockH(vWPos, nw, cr);
  float bf = 0.35 * smoothstep(0.22, 0.45, 1.0 - nw.y) * (1.0 - smoothstep(30.0, 90.0, length(vViewPosition)));
  vec2 dH = vec2(dFdx(rh), dFdy(rh)) * bf;
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  vec3 R1 = cross(sy, normal), R2 = cross(normal, sx);
  float det = dot(sx, R1) * faceDirection;
  if (abs(det) > 1e-12) normal = normalize(abs(det) * normal - sign(det) * (dH.x * R1 + dH.y * R2));
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
    fragDecl: TERRAIN_DECL + 'varying float vCanopy;' + (extra.fragDecl || ''),
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
    const pos = new Float32Array(cnt * 3), nrm = new Float32Array(cnt * 3), can = new Float32Array(cnt);
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
      can[k] = canopyAt(pos[k * 3], pos[k * 3 + 2], pos[k * 3 + 1], 1 - nrm[k * 3 + 1]);
    }
    const drop = 2 + s * 3;
    for (const p of perimeter) {
      pos[k * 3] = pos[p * 3]; pos[k * 3 + 1] = pos[p * 3 + 1] - drop; pos[k * 3 + 2] = pos[p * 3 + 2];
      nrm[k * 3] = nrm[p * 3]; nrm[k * 3 + 1] = nrm[p * 3 + 1]; nrm[k * 3 + 2] = nrm[p * 3 + 2]; can[k] = can[p];
      k++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('aCanopy', new THREE.BufferAttribute(can, 1));
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
