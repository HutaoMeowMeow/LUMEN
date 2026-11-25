// Streams instanced vegetation, corals, seabed life and island plants in 128 m cells around the player.
// Placement is two-pass: shaped clusters (reef bommies, kelp groves, rock piles, palm groves) and an ambient
// grid gated by noise masks (seagrass meadows, open sand, beach band, jungle / edge / clearing).
import * as THREE from 'three';
import * as GEO from './geometries.js';
import { stdMat } from '../fx/materials.js';
import { mulberry32, createNoise, smoothstep } from './noise.js';
import { WORLD, ISLANDS, POIS, CAVES } from './layout.js';

const CELL = 128;
const TAU = Math.PI * 2;
const NV = createNoise(WORLD.seed + 5);
const spire = ISLANDS.find((i) => i.id === 'spire');
const TROPIC = ISLANDS.filter((i) => i.type === 'tropical' || i.type === 'atoll');
const CURRENT = 0.7 / TAU; // prevailing current heading as a rotation fraction; sea fans grow broadside to it

// muted reef palettes; index i of each palette belongs to the same colour family so clusters stay coherent
const CORAL = [0xd88a7a, 0xe0a060, 0xa080c8, 0xd87aa0, 0xd8c060, 0x5ab0a8];
const FAN = [0xa83a5a, 0xc8703a, 0x7a3aa8, 0xc85a7a, 0xc89038, 0x3a8a9a];
const SPONGE = [0xd87a3a, 0xc89040, 0xa8508a, 0xa8506a, 0xd8c050, 0x40a8a0];

// Crabs: shuffle sideways and back with a leg-bob (local space, before instancing)
const CRAB_GLSL = /* glsl */ `
#ifdef USE_INSTANCING
  float cph = instanceMatrix[3].x * 1.37 + instanceMatrix[3].z * 0.91;
#else
  float cph = 0.0;
#endif
  transformed.x += 0.5 * sin(uTime * 0.35 + cph);
  transformed.y += 0.012 * abs(sin(uTime * 14.0 + cph)) * abs(cos(uTime * 0.35 + cph));`;

// Surface shading per type (local units; corals/props are ~1 unit tall before instance scale).
// d: shader relief [kind, scale, bump metres, cavity]; ao: contact darkening [min, height]; tl: sun translucency; leaf: translucency only where green
// vol: leaf-clump canopy whose card normals point out of the clump, kept on back faces too
const SURF = {
  branch: { d: ['coral', 0.9, 0.012, 0.3], ao: [0.45, 0.5] },
  staghorn: { d: ['coral', 0.7, 0.012, 0.3], ao: [0.45, 0.7] },
  brain: { d: ['coral', 0.8, 0.015, 0.3], ao: [0.55, 0.3] },
  fan: { d: ['leaf', 2, 0.002, 0.15], tl: 0.55 },
  tube: { d: ['sponge', 1.2, 0.012, 0.35], ao: [0.5, 0.5] },
  table: { d: ['coral', 0.8, 0.012, 0.3], ao: [0.5, 0.35] },
  mushroom: { d: ['coral', 1.2, 0.006, 0.25] },
  soft: { d: ['leaf', 2, 0.004, 0.2], ao: [0.5, 0.4], tl: 0.6 },
  sponge: { d: ['sponge', 0.9, 0.018, 0.4], ao: [0.5, 0.5] },
  anemone: { ao: [0.5, 0.2], tl: 0.5 },
  seagrass: { ao: [0.5, 0.45], tl: 0.45 },
  ribbon: { ao: [0.55, 0.3], tl: 0.45 },
  kelp: { d: ['leaf', 1.5, 0.0, 0.12], ao: [0.55, 0.12], tl: 0.6 },
  rock: { d: ['rock', 1.6, 0.05, 0.4], ao: [0.6, 0.35] },
  urchin: { ao: [0.5, 0.15] },
  cucumber: { d: ['sponge', 2.5, 0.004, 0.25] },
  rubble: { d: ['coral', 1.5, 0.006, 0.3] },
  barnacles: { d: ['rock', 3, 0.004, 0.3] },
  palm: { d: ['plant', 0.45, 0.02, 0.3], ao: [0.6, 1.2], tl: 0.6, leaf: true },
  palmShort: { d: ['plant', 0.45, 0.02, 0.3], ao: [0.6, 1.0], tl: 0.6, leaf: true },
  broadleaf: { d: ['plant', 0.45, 0.025, 0.3], ao: [0.55, 1.4], tl: 0.55, leaf: true, vol: true },
  broadleaf2: { d: ['plant', 0.45, 0.025, 0.3], ao: [0.55, 1.4], tl: 0.55, leaf: true, vol: true },
  bigleaf: { d: ['plant', 1.2, 0.003, 0.2], ao: [0.5, 0.5], tl: 0.7, leaf: true },
  shrub: { d: ['plant', 1.2, 0.004, 0.25], ao: [0.45, 0.7], tl: 0.5, leaf: true, vol: true },
  bush: { d: ['plant', 1.2, 0.004, 0.25], ao: [0.45, 0.7], tl: 0.5, leaf: true, vol: true },
  fern: { d: ['plant', 1.5, 0.002, 0.2], ao: [0.5, 0.15], tl: 0.7, leaf: true },
  grass: { ao: [0.5, 0.4], tl: 0.5, leaf: true },
  beachgrass: { ao: [0.55, 0.4], tl: 0.4, leaf: true },
  flowers: { ao: [0.6, 0.3], tl: 0.5 },
  driftwood: { d: ['bark', 0.6, 0.02, 0.35], ao: [0.6, 0.15] },
  pine: { d: ['plant', 0.45, 0.02, 0.3], ao: [0.6, 1.2], tl: 0.35, leaf: true },
  deadtree: { d: ['bark', 0.45, 0.025, 0.35], ao: [0.6, 1.2] },
};

// view: max draw distance (m). tilt: follow the ground normal. trunk: [height, radius] collider. lod: far geometry.
// surf: tall enough to be seen from above water at full range (other sea-floor types stop at SEABED_ABOVE).
// lo: geo(true) builds a reduced-detail mesh, used everywhere on Low and as the far LOD otherwise (always 64 m+ away).
// water/wind: [amplitude per metre of instance height, frequency, local sway height]
const TYPES = [
  // ---- reef ----
  { name: 'branch', geo: (lo) => GEO.branchCoral(3, lo), lo: true, pal: CORAL, water: [0.03, 1.2, 1.2], view: 160 },
  { name: 'staghorn', geo: (lo) => GEO.staghornCoral(21, lo), lo: true, pal: [0xc8a07a, 0xd89a6a, 0x9a8ac0, 0xc87a8a, 0xb8b070, 0x7ab0a0], view: 150 },
  { name: 'brain', geo: (lo) => GEO.brainCoral(lo), lo: true, pal: [0xc8b070, 0xd09868, 0xa898b8, 0xb88a70, 0xa8b878, 0x90b8a0], view: 170, tilt: 0.6 },
  { name: 'fan', geo: (lo) => GEO.fanCoral(4, lo), lo: true, pal: FAN, water: [0.07, 1.0, 1.3], side: 2, view: 150 },
  { name: 'tube', geo: () => GEO.tubeCoral(5), pal: SPONGE, water: [0.02, 0.9, 1.0], view: 150, tilt: 0.6 },
  { name: 'table', geo: () => GEO.tableCoral(1), pal: [0xb8a87a, 0xc8a890, 0xa8a0c0, 0xd0a8a8, 0xc8b890, 0x98b890], view: 170, tilt: 0.3 },
  { name: 'mushroom', geo: (lo) => GEO.mushroomCoral(lo), lo: true, pal: [0xd8b0a0, 0xe0c090, 0xc0a0d0, 0xd09090, 0xb0c890, 0xa0c8c0], view: 90, tilt: 1 },
  { name: 'soft', geo: (lo) => GEO.softCoral(23, lo), lo: true, pal: [0xe08a9a, 0xd8a050, 0xb890d8, 0xd86a5a, 0xe0d0a0, 0x8ac8b8], water: [0.05, 1.3, 0.7], view: 120, glow: 0.35 },
  { name: 'sponge', geo: () => GEO.barrelSponge(24), pal: SPONGE, view: 160, tilt: 0.4 },
  { name: 'anemone', geo: () => GEO.anemone(2), pal: [0xe08aa0, 0xe8c098, 0xa8a8e0, 0xe0909a, 0xe8d0a0, 0x98d8a8], water: [0.06, 1.7, 0.35], view: 110, glow: 0.6 },
  { name: 'seagrass', geo: () => GEO.seagrass(6), pal: [0xffffff, 0xd8f0c0, 0xf0e0a0], water: [0.12, 1.1, 0.9], side: 2, view: 110 },
  { name: 'ribbon', geo: () => GEO.ribbonweed(7), pal: [0xffffff, 0xe8e0a8, 0xd0e8a0], water: [0.15, 0.42, 1.0], side: 2, view: 200, surf: true },
  { name: 'kelp', geo: () => GEO.kelp(31), pal: [0xffffff, 0xe8dcb0, 0xd0e0a8], water: [0.045, 0.35, 1.0], side: 2, view: 240, surf: true },
  { name: 'rock', geo: () => GEO.rock(8), pal: [0xffffff, 0xd8d0c0, 0xc0c8d0, 0x9a948a], view: 260, collide: 'sphere', tilt: 0.6 },
  { name: 'urchin', geo: () => GEO.urchin(), pal: [0x3a2040, 0x1a1418, 0x6a2a2a], view: 70, tilt: 1 },
  { name: 'starfish', geo: () => GEO.starfish(52), pal: [0xe07a3a, 0xc8403a, 0x9a5ab0, 0x4a7ad0, 0xe0b050], view: 70, tilt: 1 },
  { name: 'shell', geo: () => GEO.shell(), pal: [0xf0e0d0, 0xe0b090, 0xd8a0a0, 0xc8c0b0], view: 50, tilt: 1 },
  { name: 'cucumber', geo: () => GEO.seaCucumber(), pal: [0x6a4a3a, 0x3a2a2a, 0x8a6a40], view: 60, tilt: 1 },
  { name: 'crab', geo: () => GEO.crab(), pal: [0xc8503a, 0xd8803a, 0x9a6a5a], view: 50, tilt: 1, vmain: CRAB_GLSL },
  { name: 'rubble', geo: () => GEO.rubble(53), pal: [0xffffff, 0xe8e0d0], view: 80, tilt: 1 },
  { name: 'barnacles', geo: () => GEO.barnacles(54), pal: [0xffffff, 0xd8d0c8], view: 60, tilt: 1 },
  { name: 'glowplant', geo: () => GEO.glowPlant(9), pal: [0x40f0ff, 0x80ffb0, 0xb080ff, 0x40a0ff], water: [0.08, 0.8, 1.0], view: 160, glow: 2.6 },
  { name: 'crystal', geo: () => GEO.crystal(10), pal: [0x7a6aff, 0x40e0ff, 0xff60e0], view: 200, glow: 2.2, metal: true },
  { name: 'worms', geo: () => GEO.tubeWorms(11), pal: [0xffffff], water: [0.05, 1.4, 1.5], view: 120, glow: 1.0 },
  // ---- land ----
  { name: 'palm', geo: (lo) => GEO.palm(12, 7.5, 1, 12, lo), lod: () => GEO.palm(12, 7.5, 1, 12, 2), pal: [0xffffff, 0xe8f0d0, 0xf0e8c0], wind: [0.35, 0.9, 7.5], side: 2, view: 900, trunk: [5, 0.28], land: true },
  { name: 'palmShort', geo: (lo) => GEO.palm(19, 4.6, 1.6, 10, lo), lod: () => GEO.palm(19, 4.6, 1.6, 10, 2), pal: [0xffffff, 0xe0f0c8, 0xf0e8c0], wind: [0.3, 1.0, 4.6], side: 2, view: 700, trunk: [3, 0.26], land: true },
  { name: 'broadleaf', geo: () => GEO.broadleafTree(41), lod: () => GEO.broadleafTree(41, true), pal: [0xffffff, 0xd8e8c0, 0xc8d8b0, 0xe0e0b8], wind: [0.04, 0.7, 7.0], side: 2, view: 900, trunk: [5, 0.42], land: true },
  { name: 'broadleaf2', geo: () => GEO.broadleafTree(48), lod: () => GEO.broadleafTree(48, true), pal: [0xffffff, 0xd0e0b0, 0xe8e8c0], wind: [0.04, 0.75, 7.0], side: 2, view: 900, trunk: [5, 0.42], land: true },
  { name: 'bigleaf', geo: () => GEO.bigLeafPlant(42), pal: [0xffffff, 0xd8f0b8, 0xc0d8a0], wind: [0.08, 1.4, 1.2], side: 2, view: 260, land: true },
  { name: 'shrub', geo: (lo) => GEO.floweringShrub(45, lo), lo: true, pal: [0xffffff, 0xe0f0d0], wind: [0.04, 1.2, 1.2], side: 2, view: 320, tilt: 0.5, land: true },
  { name: 'beachgrass', geo: () => GEO.beachGrass(43), pal: [0xffffff, 0xe8d8a0, 0xd0d8a0], wind: [0.1, 2.0, 0.9], side: 2, view: 160, land: true },
  { name: 'driftwood', geo: () => GEO.driftwood(44), pal: [0xffffff, 0xd8d0c0], view: 200, tilt: 1, land: true },
  { name: 'bush', geo: (lo) => GEO.bush(13, lo), lo: true, pal: [0xffffff, 0xd0e8b0, 0xe8e0a0], wind: [0.06, 1.3, 1.2], side: 2, view: 420, tilt: 0.5, land: true },
  { name: 'fern', geo: () => GEO.fern(14), pal: [0xffffff, 0xd8f0b0], wind: [0.08, 1.6, 0.6], side: 2, view: 260, land: true },
  { name: 'grass', geo: () => GEO.seagrass(15, true), pal: [0xffffff, 0xe8e0a0, 0xc8e0a0], wind: [0.07, 2.2, 0.8], side: 2, view: 150, land: true },
  { name: 'flowers', geo: () => GEO.flowers(16), pal: [0xff6a8a, 0xffe04a, 0xb08aff, 0xffffff, 0xff9a3a], wind: [0.05, 2.0, 0.5], side: 2, view: 160, land: true },
  { name: 'pine', geo: () => GEO.pine(17), pal: [0xffffff, 0xd0e0d0], wind: [0.12, 0.7, 6.0], view: 900, trunk: [4, 0.28], land: true },
  { name: 'deadtree', geo: () => GEO.deadTree(18), pal: [0xffffff], view: 700, trunk: [4, 0.28], land: true },
];
const T = Object.fromEntries(TYPES.map((t, i) => [t.name, i]));
const LONE = [T.brain, T.branch, T.soft, T.sponge, T.tube, T.anemone];

const vents = POIS.vents;
// From above water the fresnel-bright surface hides the seabed past a few tens of metres: draw only nearby cells
const SEABED_ABOVE = 50;
const STRIDE = 6; // x, z, scale, rotation fraction, palette index, y offset

export class Vegetation {
  constructor(scene, world, quality, colliders, emitters = []) {
    this.scene = scene;
    this.world = world;
    this.colliders = colliders;
    this.emitters = emitters; // shared with Particles: crevice bubble streams are added/removed with their cell
    this.density = { low: 0.45, medium: 0.75, high: 1, ultra: 1.25 }[quality] ?? 1;
    this.viewMul = { low: 0.65, medium: 0.85, high: 1, ultra: 1.3 }[quality] ?? 1;
    this.radius = Math.max(...TYPES.map((t) => t.view)) * this.viewMul;
    this.cells = new Map();
    const lowDetail = quality === 'low';
    this.types = TYPES.map((t) => {
      const geo = t.geo(lowDetail);
      const sw = t.water || t.wind;
      const sf = SURF[t.name] || {};
      const mat = stdMat({ vertexColors: true, roughness: t.metal ? 0.25 : 0.85, metalness: t.metal ? 0.1 : 0, side: t.side ?? 0, transparent: false }, {
        key: 'veg-' + t.name,
        sway: t.water ? 'water' : t.wind ? 'wind' : undefined,
        swayAmp: sw?.[0], swayFreq: sw?.[1], swayHeight: sw?.[2],
        detail: sf.d && !lowDetail ? { kind: sf.d[0], scale: sf.d[1], bump: sf.d[2], cavity: sf.d[3] } : undefined,
        ao: sf.ao && { min: sf.ao[0], height: sf.ao[1] },
        translucent: sf.tl, leafOnly: sf.leaf, volume: sf.vol,
        uniforms: { uGlowStrength: { value: t.glow ?? 0 } },
        vertDecl: 'attribute float aGlow; varying float vGlow;',
        vertMain: 'vGlow = aGlow;' + (t.vmain || ''),
        fragDecl: 'uniform float uGlowStrength; varying float vGlow;',
        fragEmissive: 'totalEmissiveRadiance += diffuseColor.rgb * vGlow * uGlowStrength * (0.85 + 0.15 * sin(uTime * 2.0 + vWPos.x));',
      });
      const lodGeo = t.lod ? t.lod() : t.lo && !lowDetail ? t.geo(true) : null;
      return { ...t, geo, lodGeo, lodDist: t.lod ? 150 * this.viewMul : CELL * 1.03, mat, pal: t.pal.map((h) => new THREE.Color(h)) };
    });
    this.dummy = new THREE.Object3D();
    this.tmpC = new THREE.Color();
    this.tmpN = [0, 1, 0];
    this.tmpB = [0, 0, 0, 0];
  }

  // Nearest reef cluster centre {x, y, z, r} within maxD of (x, z), among loaded cells; null if none.
  reefNear(x, z, maxD = 60) {
    let best = null, bd = maxD * maxD;
    for (const cell of this.cells.values()) for (const r of cell.reefs) {
      const d = (r.x - x) ** 2 + (r.z - z) ** 2;
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  _tropical(x, z) {
    for (const I of TROPIC) if ((x - I.x) ** 2 + (z - I.z) ** 2 < (I.r * 1.3) ** 2) return I;
    return null;
  }

  // ---------- clusters ----------
  _clusters(x0, z0, C) {
    const { rnd } = C;
    const W = this.world;
    const placed = [];
    const free = (x, z, r) => placed.every((p) => (p[0] - x) ** 2 + (p[1] - z) ** 2 > ((p[2] + r) * 0.85) ** 2);
    for (let k = 0; k < 80; k++) {
      const x = x0 + rnd() * CELL, z = z0 + rnd() * CELL, kind = rnd();
      const h = W.heightAt(x, z);
      const slope = 1 - W.normalAt(x, z, this.tmpN)[1];
      const b = W.biomeAt(x, z, this.tmpB);
      let R = 0, fn = null;
      if (h < -2.5 && h > -34 && b[0] > 0.3 && slope < 0.45) {
        if (NV.fbm2(x * 0.018 + 7, z * 0.018 - 3, 2) < 0) continue; // sand channels between patch reefs
        R = 3 + rnd() * 5 * Math.min(1, b[0] + 0.3);
        if (!free(x, z, R * 1.8)) continue; // keep open sand between bommies
        fn = () => this._bommie(x, z, h, R, C);
      } else if (h < -6 && h > -45 && b[1] > 0.25 && kind < 0.35) {
        R = 8 + rnd() * 10;
        fn = () => this._kelpGrove(x, z, R, C);
      } else if (h < -4 && h > -90 && slope < 0.6 && kind < 0.25 && NV.fbm2(x * 0.007 + 31, z * 0.007 - 12, 2) > 0.15) {
        R = 2.5 + rnd() * 3;
        fn = () => this._rockPile(x, z, h, R, C);
      } else if (h > -1.5 && h < 2.4 && kind < 0.12 && this._tropical(x, z)) {
        R = 3 + rnd() * 3;
        fn = () => this._shore(x, z, h, R, C);
      } else if (h > 1.1 && h < 14 && slope < 0.3 && kind < 0.2 && this._tropical(x, z)) {
        R = 4 + rnd() * 4;
        fn = () => this._palmGrove(x, z, R, C);
      }
      if (!fn || !free(x, z, R)) continue;
      placed.push([x, z, R]);
      fn();
    }
  }

  // Patch reef: a centrepiece ringed by medium corals, then soft corals, then sand life at the fringe.
  _bommie(cx, cz, h0, R, C) {
    const { rnd, add, dens } = C;
    const th = Math.floor(rnd() * 6); // colour family shared by the cluster
    const tc = () => (rnd() < 0.6 ? th : Math.floor(rnd() * 6));
    const fan = () => CURRENT + (rnd() - 0.5) * 0.08;
    // a rock mound raises the core so the inner ring sits on a hump, not flat sand
    const ms = rnd() < 0.7 ? Math.min(R * 0.6, 1.8 + rnd() * 2.6) : 0;
    const rr = ms * 0.55;
    if (ms) add(T.rock, cx, cz, ms, 0);
    const top = ms * 0.4;
    const kind = rnd();
    if (kind < 0.35) {
      add(T.brain, cx, cz, 1.6 + rnd() * 1.6, tc(), top);
    } else if (kind < 0.6) {
      add(T.table, cx, cz, 1.8 + rnd() * 1.0, tc(), top);
      add(T.table, cx + (rnd() - 0.5) * 2.5, cz + (rnd() - 0.5) * 2.5, 1.1 + rnd() * 0.6, tc(), top * 0.5);
    } else if (kind < 0.8) {
      for (let i = 0; i < 16; i++) {
        const a = rnd() * TAU, d = rnd() * R * 0.45;
        add(T.staghorn, cx + Math.cos(a) * d, cz + Math.sin(a) * d, 0.7 + rnd() * 0.7, th, d < rr ? top * 0.6 : 0);
      }
    } else {
      for (let i = 0; i < 3; i++) add(T.sponge, cx + (rnd() - 0.5) * 2, cz + (rnd() - 0.5) * 2, 1.6 + rnd() * 1.2, tc(), top * 0.7);
    }
    const n = Math.round(R * R * 2.2 * (0.5 + 0.5 * dens)); // the reef is the hero; thin it less than ambient clutter
    for (let i = 0; i < n; i++) {
      const f = Math.sqrt(rnd()), a = rnd() * TAU;
      const x = cx + Math.cos(a) * f * R, z = cz + Math.sin(a) * f * R;
      const dr = f * R, yo = rr > 0 && dr < rr ? rr * 0.7 * Math.sqrt(1 - (dr / rr) ** 2) : 0;
      const k = rnd();
      if (f < 0.38) {
        if (k < 0.25) add(T.brain, x, z, 0.5 + rnd() * 0.8, tc(), yo);
        else if (k < 0.5) add(T.branch, x, z, 0.7 + rnd() * 1.0, tc(), yo);
        else if (k < 0.68) add(T.fan, x, z, 0.7 + rnd() * 1.1, tc(), yo, fan());
        else if (k < 0.84) add(T.sponge, x, z, 0.8 + rnd() * 0.9, tc(), yo);
        else add(T.staghorn, x, z, 0.6 + rnd() * 0.6, tc(), yo);
      } else if (f < 0.72) {
        if (k < 0.24) add(T.soft, x, z, 0.8 + rnd() * 0.9, tc());
        else if (k < 0.42) add(T.anemone, x, z, 0.7 + rnd() * 0.7, tc());
        else if (k < 0.56) add(T.mushroom, x, z, 0.5 + rnd() * 0.6, tc());
        else if (k < 0.7) add(T.tube, x, z, 0.6 + rnd() * 0.8, tc());
        else if (k < 0.84) add(T.branch, x, z, 0.5 + rnd() * 0.7, tc());
        else if (k < 0.93) add(T.fan, x, z, 0.5 + rnd() * 0.8, tc(), 0, fan());
        else add(T.rock, x, z, 0.4 + rnd() * 0.7, 0);
      } else {
        if (k < 0.14) add(T.urchin, x, z, 0.8 + rnd() * 0.6);
        else if (k < 0.24) add(T.starfish, x, z, 0.8 + rnd() * 0.5);
        else if (k < 0.4) add(T.rubble, x, z, 0.8 + rnd() * 0.8);
        else if (k < 0.48) add(T.shell, x, z, 0.8 + rnd() * 0.6);
        else if (k < 0.68 && h0 > -18) add(T.seagrass, x, z, 0.7 + rnd() * 0.6);
        else if (k < 0.75) add(T.cucumber, x, z, 0.8 + rnd() * 0.5);
        else if (k < 0.82) add(T.mushroom, x, z, 0.4 + rnd() * 0.4, tc());
        else if (k < 0.85) add(T.crab, x, z, 0.8 + rnd() * 0.5);
        // else: bare sand
      }
    }
    C.reefs.push({ x: cx, y: h0, z: cz, r: R });
  }

  // Giant kelp: stalks reach almost to the surface over boulders and a seagrass floor.
  _kelpGrove(cx, cz, R, C) {
    const { rnd, add, dens } = C;
    const W = this.world;
    const n = Math.round(R * R * 0.2 * dens);
    for (let i = 0; i < n; i++) {
      const f = Math.sqrt(rnd()), a = rnd() * TAU;
      const x = cx + Math.cos(a) * f * R, z = cz + Math.sin(a) * f * R;
      const h = W.heightAt(x, z);
      if (h > -5) continue;
      add(T.kelp, x, z, -h * (0.84 + rnd() * 0.12), Math.floor(rnd() * 3));
      const k = rnd();
      if (k < 0.12) add(T.rock, x + rnd() * 2 - 1, z + rnd() * 2 - 1, 1 + rnd() * 1.8);
      else if (k < 0.7) add(T.seagrass, x + rnd() * 2 - 1, z + rnd() * 2 - 1, 0.8 + rnd() * 0.7);
      else if (k < 0.8) add(T.ribbon, x + rnd() * 2 - 1, z + rnd() * 2 - 1, 2 + rnd() * 4);
      else if (k < 0.84) add(T.urchin, x + rnd() - 0.5, z + rnd() - 0.5, 0.8 + rnd() * 0.5);
    }
  }

  // Rocky reef: a boulder pile with barnacles, urchins in the cracks, a fan on top and sometimes a bubble seep.
  _rockPile(cx, cz, h0, R, C) {
    const { rnd, add } = C;
    const s0 = 1.8 + rnd() * 2.4;
    add(T.rock, cx, cz, s0, Math.floor(rnd() * 4));
    const m = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < m; i++) {
      const a = rnd() * TAU, d = s0 * 0.45 + rnd() * R * 0.6;
      add(T.rock, cx + Math.cos(a) * d, cz + Math.sin(a) * d, 0.6 + rnd() * 1.2, Math.floor(rnd() * 4));
    }
    for (let i = 0; i < 3; i++) add(T.barnacles, cx + (rnd() - 0.5) * s0 * 0.5, cz + (rnd() - 0.5) * s0 * 0.5, 1.4 + rnd(), 0, s0 * 0.35);
    for (let i = 0; i < 4 + rnd() * 5; i++) {
      const a = rnd() * TAU, d = s0 * (0.45 + rnd() * 0.25);
      add(T.urchin, cx + Math.cos(a) * d, cz + Math.sin(a) * d, 0.8 + rnd() * 0.6);
    }
    if (h0 > -40) add(T.fan, cx + (rnd() - 0.5) * s0 * 0.3, cz + (rnd() - 0.5) * s0 * 0.3, 0.9 + rnd() * 0.8, Math.floor(rnd() * 6), s0 * 0.38, CURRENT);
    if (rnd() < 0.6) add(T.anemone, cx + (rnd() - 0.5) * s0, cz + (rnd() - 0.5) * s0, 0.7 + rnd() * 0.6);
    if (rnd() < 0.35) {
      const a = rnd() * TAU;
      C.emit.push({ x: cx + Math.cos(a) * s0 * 0.5, y: h0 + 0.2, z: cz + Math.sin(a) * s0 * 0.5, rate: 0.35, type: 'bubbles' });
    }
  }

  // Shoreline detail: a group of weathered rocks with barnacles at the waterline, or a driftwood log in a grass tuft
  _shore(cx, cz, h0, R, C) {
    const { rnd, add } = C;
    const W = this.world;
    if (h0 < 0.8 || rnd() < 0.55) {
      const n = 3 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) {
        const a = rnd() * TAU, d = rnd() * R * 0.7;
        const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        const s = i === 0 ? 1.4 + rnd() * 1.8 : 0.4 + rnd() * 1.1;
        add(T.rock, x, z, s, Math.floor(rnd() * 3));
        if (s > 1 && W.heightAt(x, z) < 0.6) add(T.barnacles, x, z, 1.2 + rnd(), 0, s * 0.3);
      }
      if (rnd() < 0.5) add(T.crab, cx + (rnd() - 0.5) * R, cz + (rnd() - 0.5) * R, 0.9 + rnd() * 0.4);
    } else {
      add(T.driftwood, cx, cz, 0.8 + rnd() * 0.7);
      for (let i = 0; i < 3 + rnd() * 5; i++) {
        const x = cx + (rnd() - 0.5) * R, z = cz + (rnd() - 0.5) * R;
        if (W.heightAt(x, z) > 1.3) add(T.beachgrass, x, z, 0.7 + rnd() * 0.7);
      }
    }
    for (let i = 0; i < 4; i++) add(T.shell, cx + (rnd() - 0.5) * R * 1.5, cz + (rnd() - 0.5) * R * 1.5, 0.8 + rnd() * 0.6);
  }

  // A few palms of mixed height leaning seaward, with understory around their feet.
  _palmGrove(cx, cz, R, C) {
    const { rnd, add } = C;
    const W = this.world;
    const I = this._tropical(cx, cz);
    const out = Math.atan2(-(cz - I.z), cx - I.x); // Object3D yaw that points local +x away from the island centre
    const n = 2 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, d = rnd() * R * 0.6;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const rot = (((out + (rnd() - 0.5) * 1.8) / TAU) % 1 + 1) % 1;
      add(rnd() < 0.6 ? T.palm : T.palmShort, x, z, 0.8 + rnd() * 0.45, -1, 0, rot);
    }
    for (let i = 0; i < 4 + rnd() * 6; i++) {
      const a = rnd() * TAU, d = 1 + rnd() * R;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const h = W.heightAt(x, z);
      if (h < 0.9) continue;
      const k = rnd();
      if (h < 2.4) add(k < 0.6 ? T.beachgrass : T.shell, x, z, 0.7 + rnd() * 0.6);
      else if (k < 0.3) add(T.bigleaf, x, z, 0.7 + rnd() * 0.6);
      else if (k < 0.55) add(T.fern, x, z, 0.7 + rnd() * 0.6);
      else if (k < 0.75) add(T.bush, x, z, 0.6 + rnd() * 0.6);
      else add(T.shrub, x, z, 0.6 + rnd() * 0.5);
    }
  }

  // ---------- ambient grid ----------
  _ambient(x, z, C) {
    const { rnd, add, dens: d } = C;
    const W = this.world;
    const h = W.heightAt(x, z);
    const slope = 1 - W.normalAt(x, z, this.tmpN)[1];
    const b = W.biomeAt(x, z, this.tmpB);
    const r = rnd();
    if (h > 0.9) return this._land(x, z, h, slope, b, r, C);
    if (h > -1.2) { // surf zone: almost bare, the odd shell
      if (r < 0.004 * d) add(T.shell, x, z, 0.8 + rnd() * 0.5);
      return;
    }
    const depth = -h;
    if (h < -100) {
      const dv = Math.hypot(x - vents.x, z - vents.z);
      if (dv < 70 && r < 0.25 * smoothstep(70, 20, dv)) add(T.worms, x, z, 0.7 + rnd() * 0.8);
      else {
        const inLab = Math.hypot(x - CAVES[1].blobs[0][0], z - CAVES[1].blobs[0][2]) < 160;
        if (r < (inLab ? 0.03 : 0.008) * d) add(T.crystal, x, z, 0.8 + rnd() * 2.2);
        else if (r < 0.04 * d) add(T.glowplant, x, z, 0.8 + rnd() * 1.4);
        else if (r < 0.05 * d) add(T.rock, x, z, 0.8 + rnd() * 2.8);
      }
      return;
    }
    // between the bommies: rubble, sand life and the odd lone coral head
    if (b[0] > 0.2 && depth < 34 && r < 0.06 * b[0] * d) {
      const k = rnd();
      if (k < 0.3) add(T.rubble, x, z, 0.7 + rnd() * 0.8);
      else if (k < 0.42) add(T.starfish, x, z, 0.8 + rnd() * 0.5);
      else if (k < 0.52) add(T.shell, x, z, 0.8 + rnd() * 0.5);
      else if (k < 0.6) add(T.cucumber, x, z, 0.8 + rnd() * 0.4);
      else add(LONE[Math.floor(rnd() * LONE.length)], x, z, 0.5 + rnd() * 0.7);
      return;
    }
    // kelp forest floor between groves
    if (b[1] > 0.15) {
      const p = b[1] * d;
      if (r < 0.008 * p && h < -6) add(T.kelp, x, z, depth * (0.8 + rnd() * 0.15), Math.floor(rnd() * 3));
      else if (r < 0.04 * p) add(T.ribbon, x, z, Math.max(1.5, Math.min(depth - 2, 10)) * (0.4 + rnd() * 0.5));
      else if (r < 0.2 * p) add(T.seagrass, x, z, 0.9 + rnd() * 0.8);
      else if (r < 0.215 * p) add(T.rock, x, z, 0.6 + rnd() * 1.8);
      else if (r < 0.22 * p) add(T.starfish, x, z, 0.9 + rnd() * 0.4);
      return;
    }
    // seagrass meadows: noise patches with soft edges; elsewhere open sand
    const m = NV.fbm2(x * 0.012 + 80, z * 0.012 - 20, 3);
    if (depth < 24 && slope < 0.3 && m > 0.05) {
      const p = smoothstep(0.05, 0.3, m) * 0.9 * d;
      if (r < p) {
        add(T.seagrass, x, z, 0.7 + rnd() * 0.7);
        if (rnd() < 0.5) add(T.seagrass, x + rnd() * 1.4 - 0.7, z + rnd() * 1.4 - 0.7, 0.6 + rnd() * 0.6);
      } else if (r < p + 0.012 * d) {
        const k = rnd();
        add(k < 0.4 ? T.cucumber : k < 0.75 ? T.starfish : T.shell, x, z, 0.8 + rnd() * 0.5);
      }
      return;
    }
    if (r < 0.006 * d) add(T.rock, x, z, 0.5 + rnd() * 2.2);
    else if (r < 0.0085 * d) add(T.shell, x, z, 0.8 + rnd() * 0.6);
    else if (r < 0.0105 * d && depth < 40) add(T.starfish, x, z, 0.8 + rnd() * 0.5);
    else if (r < 0.012 * d) add(T.cucumber, x, z, 0.8 + rnd() * 0.5);
    else if (depth > 55 && r < 0.02 * d) add(T.glowplant, x, z, 0.6 + rnd());
    else if (r < 0.014 * d && depth < 40) add(T.anemone, x, z, 0.7 + rnd() * 0.6);
    else if (r < 0.0146 * d && depth < 30) add(T.crab, x, z, 0.8 + rnd() * 0.4);
    else if (r < 0.015 * d && depth < 30) add(T.driftwood, x, z, 0.7 + rnd() * 0.5); // sunken log
  }

  _land(x, z, h, slope, b, r, C) {
    const { rnd, add, dens: d } = C;
    if (slope > 0.6) return;
    if (b[3] > 0.5) { // volcanic
      if (r < 0.004 * d) add(T.deadtree, x, z, 0.8 + rnd() * 0.6);
      else if (r < 0.02 * d) add(T.rock, x, z, 0.8 + rnd() * 2.4);
      else if (r < 0.04 * d && h < 25) add(T.fern, x, z, 0.7 + rnd() * 0.5);
      return;
    }
    if (Math.hypot(x - spire.x, z - spire.z) < spire.r * 1.2) {
      if (h > 9 && r < 0.012 * d && slope < 0.35) add(T.pine, x, z, 0.8 + rnd() * 0.7);
      else if (r < 0.03 * d && slope > 0.25) add(T.rock, x, z, 0.6 + rnd() * 1.6);
      else if (r < 0.35 * d && slope < 0.4) add(T.grass, x, z, 0.8 + rnd() * 0.6);
      else if (r < 0.37 * d) add(T.flowers, x, z, 0.8 + rnd() * 0.5);
      return;
    }
    if (!this._tropical(x, z)) { // rocky islets: wind-cut grass, scrub and stones
      if (r < 0.03 * d && slope > 0.2) add(T.rock, x, z, 0.5 + rnd() * 1.5);
      else if (r < 0.05 * d) add(T.bush, x, z, 0.6 + rnd() * 0.6);
      else if (r < 0.4 * d) add(T.grass, x, z, 0.6 + rnd() * 0.6);
      return;
    }
    // beach band: tussocks of beach grass, shells, driftwood, the odd stone and crab
    if (h < 2.6) {
      const tuss = NV.fbm2(x * 0.05, z * 0.05 + 9, 2);
      if (h > 1.5 && r < (tuss > 0 ? 0.08 + 0.12 * smoothstep(1.5, 2.6, h) : 0.01) * d) add(T.beachgrass, x, z, 0.7 + rnd() * 0.6);
      else if (r > 0.95 && r < 0.95 + 0.012 * d) add(T.shell, x, z, 0.8 + rnd() * 0.6);
      else if (r > 0.97 && r < 0.97 + 0.006 * d) add(T.rock, x, z, 0.3 + rnd() * 0.7);
      else if (r > 0.98 && r < 0.98 + 0.0012 * d) add(T.driftwood, x, z, 0.8 + rnd() * 0.5);
      else if (r > 0.99 && r < 0.99 + 0.002 * d) add(T.crab, x, z, 0.9 + rnd() * 0.4);
      return;
    }
    if (slope > 0.42) { // steep ground: bare rock and ferns in the cracks
      if (r < 0.05 * d) add(T.rock, x, z, 0.6 + rnd() * 1.8);
      else if (r < 0.12 * d) add(T.fern, x, z, 0.6 + rnd() * 0.6);
      return;
    }
    if (h < 4) { // coastal scrub behind the beach
      if (r < 0.07 * d) add(T.beachgrass, x, z, 0.7 + rnd() * 0.6);
      else if (r < 0.085 * d) add(T.shrub, x, z, 0.6 + rnd() * 0.5);
      else if (r < 0.1 * d) add(T.bush, x, z, 0.6 + rnd() * 0.6);
      else if (r < 0.105 * d) add(T.bigleaf, x, z, 0.6 + rnd() * 0.5);
      else if (r < 0.3 * d) add(T.grass, x, z, 0.6 + rnd() * 0.5);
      return;
    }
    // inland: dense jungle where the mask is high, edges, and open clearings where it is low
    const j = NV.fbm2(x * 0.011 + 5, z * 0.011 - 9, 3) + 0.2 * smoothstep(4, 12, h) - 0.35 * smoothstep(38, 56, h) - slope * 0.6;
    const tree = () => (rnd() < 0.5 ? T.broadleaf : T.broadleaf2);
    if (j > 0.1) {
      // canopy density is what makes it read as jungle; thin the understory instead. Both are modulated (mean ~1)
      // so trees gather in groves around light gaps and the undergrowth comes in thickets rather than an even carpet
      const dj = (0.5 + 0.5 * d) * (0.55 + 0.9 * smoothstep(-0.35, 0.35, NV.fbm2(x * 0.03 + 17, z * 0.03 - 5, 2)));
      const u = d * (0.45 + 1.1 * smoothstep(-0.3, 0.4, NV.fbm2(x * 0.07 - 21, z * 0.07 + 4, 2)));
      if (r < 0.1 * dj) add(tree(), x, z, 0.75 + rnd() * 0.75);
      else if (r < 0.115 * dj) add(T.palm, x, z, 0.95 + rnd() * 0.45);
      else if (r < 0.115 * dj + 0.08 * u) add(T.bigleaf, x, z, 0.8 + rnd() * 0.8);
      else if (r < 0.115 * dj + 0.2 * u) add(T.fern, x, z, 0.8 + rnd() * 0.8);
      else if (r < 0.115 * dj + 0.24 * u) add(T.bush, x, z, 0.7 + rnd() * 0.7);
      else if (r < 0.115 * dj + 0.36 * u) add(T.grass, x, z, 0.7 + rnd() * 0.6);
    } else if (j > -0.06) {
      if (r < 0.006 * d) add(tree(), x, z, 0.7 + rnd() * 0.6);
      else if (r < 0.009 * d) add(T.palmShort, x, z, 0.8 + rnd() * 0.4);
      else if (r < 0.03 * d) add(T.shrub, x, z, 0.6 + rnd() * 0.6);
      else if (r < 0.06 * d) add(T.bush, x, z, 0.6 + rnd() * 0.7);
      else if (r < 0.12 * d) add(T.fern, x, z, 0.6 + rnd() * 0.6);
      else if (r < 0.14 * d) add(T.bigleaf, x, z, 0.6 + rnd() * 0.6);
      else if (r < 0.19 * d) add(T.flowers, x, z, 0.7 + rnd() * 0.6);
      else if (r < 0.5 * d) add(T.grass, x, z, 0.7 + rnd() * 0.7);
    } else {
      const fl = NV.fbm2(x * 0.04 - 3, z * 0.04 + 11, 2); // flower drifts across clearings
      if (r < 0.0015 * d) add(tree(), x, z, 1.0 + rnd() * 0.5);
      else if (r < 0.003 * d) add(T.palmShort, x, z, 0.8 + rnd() * 0.4);
      else if (r < 0.01 * d) add(T.bush, x, z, 0.6 + rnd() * 0.6);
      else if (r < 0.014 * d && slope > 0.15) add(T.rock, x, z, 0.5 + rnd() * 1.2);
      else if (r < (0.02 + (fl > 0.15 ? 0.14 : 0)) * d) add(T.flowers, x, z, 0.7 + rnd() * 0.6);
      else if (r < 0.5 * d) add(T.grass, x, z, 0.7 + rnd() * 0.7);
    }
  }

  _buildCell(ci, cj) {
    const key = ci + ',' + cj;
    const x0 = -WORLD.half + ci * CELL, z0 = -WORLD.half + cj * CELL;
    const rnd = mulberry32((ci * 73856093) ^ (cj * 19349663) ^ WORLD.seed);
    const W = this.world;
    const E = TYPES.map(() => []);
    const clr = W.clearings || [];
    const add = (t, x, z, s, col = -1, yo = 0, rot = rnd()) => {
      for (const c of clr) if ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r) return;
      E[t].push(x, z, s, rot, col < 0 ? Math.floor(rnd() * 60) : col, yo);
    };
    const C = { rnd, add, dens: this.density, reefs: [], emit: [] };
    this._clusters(x0, z0, C);
    const step = 2.2;
    for (let z = z0; z < z0 + CELL; z += step) {
      for (let x = x0; x < x0 + CELL; x += step) this._ambient(x + rnd() * step, z + rnd() * step, C);
    }
    const meshes = [];
    const colliderIds = [];
    const dm = this.dummy, col = this.tmpC;
    E.forEach((L, ti) => {
      const count = L.length / STRIDE;
      if (!count) return;
      const t = this.types[ti];
      const im = new THREE.InstancedMesh(t.geo, t.mat, count);
      im.castShadow = !!t.land || t.name === 'rock';
      im.receiveShadow = true;
      for (let k = 0; k < count; k++) {
        const o = k * STRIDE;
        const x = L[o], z = L[o + 1], s = L[o + 2], r = L[o + 3], pi = L[o + 4], yo = L[o + 5];
        const h = W.heightAt(x, z) + yo;
        dm.position.set(x, h - (t.name === 'rock' ? s * 0.12 : 0.02), z);
        if (t.tilt) {
          const n = W.normalAt(x, z, this.tmpN);
          dm.rotation.set(n[2] * t.tilt, r * TAU, -n[0] * t.tilt);
        } else dm.rotation.set(0, r * TAU, 0);
        const v = (r * 7.31) % 1; // second hash of the same random for size variation
        if (t.name === 'ribbon') dm.scale.set(1.6 + v, s, 1.6 + v);
        else if (t.name === 'kelp') dm.scale.set(4.5 + v * 2, s, 4.5 + v * 2);
        else if (t.name === 'rock') dm.scale.set(s * (0.8 + v * 0.6), s * (0.6 + r * 0.5), s);
        else if (t.name === 'grass') dm.scale.set(s, s * (0.65 + v * 0.7), s);
        else if (t.name === 'bush' || t.name === 'shrub') dm.scale.set(s * (0.85 + v * 0.35), s * (0.75 + ((r * 3.7) % 1) * 0.45), s * (0.85 + ((r * 5.3) % 1) * 0.35));
        else dm.scale.setScalar(s);
        dm.updateMatrix();
        im.setMatrixAt(k, dm.matrix);
        im.setColorAt(k, col.copy(t.pal[pi % t.pal.length]).multiplyScalar(0.88 + ((r * 13.7) % 1) * 0.22));
        if (this.colliders) {
          if (t.collide === 'sphere' && s > 0.9) colliderIds.push(this.colliders.addSphere(x, h + s * 0.15, z, s * 0.42));
          else if (t.trunk) colliderIds.push(this.colliders.addCapsule(x, h - 1, z, x, h + t.trunk[0] * s, z, t.trunk[1] * s));
        }
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.userData.view = t.view * this.viewMul;
      im.userData.land = !!t.land;
      im.userData.surf = !!t.surf;
      im.userData.lodDist = t.lodDist;
      this.scene.add(im);
      meshes.push(im);
      if (t.lodGeo) { // far version shares the instance buffers; update() shows one or the other
        const lm = new THREE.InstancedMesh(t.lodGeo, t.mat, count);
        lm.instanceMatrix = im.instanceMatrix;
        lm.instanceColor = im.instanceColor;
        lm.boundingSphere = im.boundingSphere;
        lm.castShadow = im.castShadow;
        lm.receiveShadow = true;
        lm.userData.isLod = true;
        im.userData.lod = lm;
        this.scene.add(lm);
        meshes.push(lm);
      }
    });
    for (const e of C.emit) this.emitters.push(e);
    this.cells.set(key, { meshes, colliderIds, reefs: C.reefs, emit: C.emit, cx: x0 + CELL / 2, cz: z0 + CELL / 2 });
  }

  _disposeCell(key) {
    const cell = this.cells.get(key);
    for (const m of cell.meshes) { this.scene.remove(m); m.dispose(); }
    if (this.colliders) cell.colliderIds.forEach((id) => this.colliders.remove(id));
    for (const e of cell.emit) { const i = this.emitters.indexOf(e); if (i >= 0) this.emitters.splice(i, 1); }
    this.cells.delete(key);
  }

  // build all cells around a point synchronously (loading screen)
  prewarm(x, z) {
    this.update({ position: { x, y: 0, z } }, 1e9, 9999);
  }

  update(camera, viewDistUnder, budget = 1) {
    const p = camera.position;
    const R = this.radius;
    const under = p.y < 0;
    const ci0 = Math.floor((p.x - R + WORLD.half) / CELL), ci1 = Math.floor((p.x + R + WORLD.half) / CELL);
    const cj0 = Math.floor((p.z - R + WORLD.half) / CELL), cj1 = Math.floor((p.z + R + WORLD.half) / CELL);
    const want = [];
    for (let j = Math.max(0, cj0); j <= Math.min(WORLD.size / CELL - 1, cj1); j++) {
      for (let i = Math.max(0, ci0); i <= Math.min(WORLD.size / CELL - 1, ci1); i++) {
        const cx = -WORLD.half + (i + 0.5) * CELL, cz = -WORLD.half + (j + 0.5) * CELL;
        const dd = Math.hypot(cx - p.x, cz - p.z);
        if (dd < R + CELL * 0.71 && !this.cells.has(i + ',' + j)) want.push([dd, i, j]);
      }
    }
    want.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < Math.min(budget, want.length); k++) this._buildCell(want[k][1], want[k][2]);
    for (const [key, cell] of this.cells) {
      const dd = Math.hypot(cell.cx - p.x, cell.cz - p.z);
      if (dd > R + CELL * 1.6) { this._disposeCell(key); continue; }
      for (const m of cell.meshes) {
        if (m.userData.isLod) continue;
        // underwater fog hides everything past viewDistUnder; from above water only sea-floor types are capped
        const u = m.userData;
        const lim = under ? Math.min(u.view, viewDistUnder + 20) : u.land || u.surf ? u.view : Math.min(u.view, SEABED_ABOVE);
        const vis = dd - CELL * 0.71 < lim;
        const lm = m.userData.lod;
        if (lm) {
          const near = dd < m.userData.lodDist;
          m.visible = vis && near;
          lm.visible = vis && !near;
        } else m.visible = vis;
      }
    }
  }
}
