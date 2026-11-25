// Marine life: fish schools and jelly blooms that respawn around the player, gliding rays,
// a wandering whale with her calf, and seabirds circling the islands.
import * as THREE from 'three';
import { stdMat } from '../fx/materials.js';
import { ISLANDS } from '../world/layout.js';
import { fishShape, jellyShape, rayShape, birdShape, whaleShape, turtleShape } from './shapes.js';

const TAU = Math.PI * 2;
const R = Math.random;

// habitat(g, b, y?) -> weight. g = ground height (negative underwater), b = [reef, kelp, rift, volcanic]
// kinds: school (wandering flock), reef (a few fish circling one coral head), jelly (drifting bloom),
// ray (gliders; mid: cruise mid-water instead of skimming the floor)
export const SPECIES = {
  glintfin: {
    name: 'Glintfin', kind: 'school', size: [0.22, 0.32], n: [18, 34], speed: 2.6, freq: 14, amp: 0.06, depth: [2, 14], see: 9,
    shape: { top: 0x3a7ab8, belly: 0xe8f0f4, fin: 0xf0c830, h: 0.3, w: 0.1 },
    habitat: (g, b) => (g < -4 && g > -40 ? 0.3 + b[0] * 2 : 0),
  },
  emberdart: {
    name: 'Ember Dart', kind: 'reef', size: [0.22, 0.32], n: [3, 7], speed: 3.0, freq: 16, amp: 0.07, depth: [1.5, 8], see: 8,
    shape: { top: 0xe0601a, belly: 0xf8b070, stripe: 0xf8f4ea, stripeFreq: 16, h: 0.34, w: 0.11, fins: 'round' },
    habitat: (g, b) => (g < -3 && g > -30 ? b[0] * 2.5 : 0),
  },
  bannerfish: {
    name: 'Bannerfish', kind: 'reef', size: [0.3, 0.42], n: [2, 4], speed: 1.2, freq: 11, amp: 0.04, depth: [2, 20], see: 7,
    shape: { top: 0xe8c84a, belly: 0xf4f0e0, fin: 0xe8c84a, stripe: 0x1e1c1a, stripeFreq: 11, h: 0.62, w: 0.06, fins: 'round', taper: 0.55 },
    habitat: (g, b) => (g < -3 && g > -26 ? b[0] * 1.6 : 0),
  },
  regalfin: {
    name: 'Regalfin', kind: 'reef', size: [0.36, 0.5], n: [1, 3], speed: 1.0, freq: 8, amp: 0.04, depth: [3, 25], see: 8,
    shape: { top: 0x2a4a9a, belly: 0xd8b040, fin: 0x3a6ac0, stripe: 0x9ac0e8, stripeFreq: 26, h: 0.78, w: 0.05, fins: 'round', taper: 0.5 },
    habitat: (g, b) => (g < -4 && g > -30 ? b[0] * 1.1 : 0),
  },
  greyfin: {
    name: 'Greyfin Shark', kind: 'school', size: [1.5, 2.2], n: [1, 2], speed: 2.0, freq: 3.2, amp: 0.07, depth: [4, 40], see: 16,
    shape: { top: 0x5a646c, belly: 0xd8dcd8, fin: 0x4a545c, h: 0.17, w: 0.1, taper: 0.8, pecs: 0.16 },
    habitat: (g, b) => (g < -8 && g > -50 ? 0.12 + b[0] * 0.2 : 0),
  },
  gloamjaw: {
    name: 'Gloamjaw', kind: 'school', size: [0.5, 0.75], n: [1, 2], speed: 1.0, freq: 5, amp: 0.05, depth: [70, 300], see: 9, deep: true,
    shape: { top: 0x101214, belly: 0x1c1e22, fin: 0x16181c, h: 0.36, w: 0.16, taper: 0.9, fins: 'round', lure: 0x9affd0, eyeGlow: true },
    habitat: (g, b) => (g < -90 ? 0.5 + b[2] : 0),
  },
  kelpperch: {
    name: 'Kelp Perch', kind: 'school', size: [0.35, 0.5], n: [8, 16], speed: 1.8, freq: 9, amp: 0.05, depth: [3, 20], see: 9,
    shape: { top: 0x5a6a30, belly: 0xc8c090, stripe: 0x3a4420, stripeFreq: 22, h: 0.32, w: 0.12, pecs: 0.08 },
    habitat: (g, b) => (g < -6 ? b[1] * 3 : 0),
  },
  mirrorfin: {
    name: 'Mirrorfin', kind: 'school', size: [0.25, 0.35], n: [30, 46], speed: 3.4, freq: 15, amp: 0.05, depth: [6, 40], see: 12,
    shape: { top: 0x2a4a6a, belly: 0xf0f4f8, fin: 0x8aa0b0, h: 0.22, w: 0.08, taper: 0.8 },
    habitat: (g, b) => (g < -25 ? 0.8 * (1 - b[0]) * (1 - b[1]) : 0),
  },
  lanternet: {
    name: 'Lanternet', kind: 'school', size: [0.3, 0.42], n: [10, 22], speed: 1.6, freq: 8, amp: 0.06, depth: [45, 260], see: 10, deep: true,
    shape: { top: 0x121418, belly: 0x2a2e34, spots: 0x50f0ff, eyeGlow: true, h: 0.3, w: 0.12, fins: 'round', finGlow: true },
    habitat: (g, b) => (g < -70 ? 1 + b[2] * 3 : 0),
  },
  veilbell: {
    name: 'Veilbell', kind: 'jelly', size: [0.6, 1.3], n: [6, 14], speed: 0.25, freq: 2.2, depth: [30, 220], see: 8, deep: true,
    colors: [0x8070ff, 0x60f0ff],
    habitat: (g) => (g < -50 ? 1 : 0),
  },
  sunbell: {
    name: 'Sunbell', kind: 'jelly', size: [0.35, 0.6], n: [8, 16], speed: 0.2, freq: 2.8, depth: [2, 12], see: 6,
    colors: [0xf0c8a0, 0xffa060],
    habitat: (g, b) => (g < -10 ? 0.4 * (1 - b[0]) : 0),
  },
  sandglider: {
    name: 'Sand Glider', kind: 'ray', size: [1.6, 2.6], n: [1, 3], speed: 1.6, freq: 1.6, amp: 0.18, see: 12,
    colors: [0x3a4a58, 0x9aa8b0, 0xd8e0e0],
    habitat: (g, b) => (g < -6 && g > -45 ? 0.6 * (1 - b[1]) : 0),
  },
  skyray: {
    name: 'Skyray', kind: 'ray', mid: true, size: [3.4, 5], n: [1, 2], speed: 1.8, freq: 0.9, amp: 0.22, see: 20,
    colors: [0x1c242c, 0xe8ecec, 0x2a343c],
    habitat: (g, b) => (g < -15 ? 0.06 * (1 - b[1]) : 0), // rare: one giant now and then
  },
  shellback: {
    name: 'Shellback Turtle', kind: 'ray', mid: true, shape: 'turtle', size: [0.9, 1.3], n: [1, 1], speed: 1.1, freq: 1.4, amp: 0.1, see: 10,
    habitat: (g, b) => (g < -3 && g > -35 ? 0.15 + b[0] * 0.35 : 0),
  },
  hollowsong: { name: 'Hollowsong', kind: 'whale', see: 45 },
  saltwing: { name: 'Saltwing', kind: 'bird', see: 40 },
};

function creatureMat(key, defines, extra = {}) {
  const m = stdMat({ vertexColors: true, roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide, ...extra }, {
    key: 'cr-' + key,
    uniforms: { uFreq: { value: 10 }, uAmp: { value: 0.05 }, uGlowK: { value: 1 } },
    vertDecl: 'attribute float aGlow; attribute float aPhase; uniform float uFreq, uAmp; varying float vGlow;',
    vertMain: /* glsl */ `
      vGlow = aGlow;
      float ph = aPhase * 6.2831;
      #if defined(WIG_SWIM)
        float tb = clamp(0.5 - transformed.z, 0.0, 1.0);
        float wv = sin(uTime * uFreq + ph - tb * 3.5) * uAmp * (0.15 + tb * tb);
        #ifdef WIG_VERT
          transformed.y += wv;
        #else
          transformed.x += wv;
        #endif
      #elif defined(WIG_FLAP)
        float ax = abs(transformed.x) * 2.0;
        #ifdef FLAP_DEAD
          ax = max(ax - FLAP_DEAD, 0.0) * 2.0;
        #endif
        transformed.y += sin(uTime * uFreq + ph - ax * 1.2) * uAmp * pow(ax, 1.4);
      #elif defined(WIG_JELLY)
        float pulse = 0.5 + 0.5 * sin(uTime * uFreq + ph);
        float bell = smoothstep(-0.05, 0.2, transformed.y);
        transformed.xz *= 1.0 - pulse * 0.2 * bell;
        transformed.y += pulse * 0.05 * bell;
        float hang = clamp(-transformed.y, 0.0, 1.0);
        transformed.x += sin(uTime * 1.3 + ph + transformed.y * 3.0) * hang * 0.12;
        transformed.z += cos(uTime * 1.1 + ph + transformed.y * 2.5) * hang * 0.1;
      #endif`,
    fragDecl: 'uniform float uGlowK; varying float vGlow;',
    fragEmissive: 'totalEmissiveRadiance += vColor.rgb * vGlow * uGlowK;',
  });
  m.defines = { ...(m.defines || {}), ...defines };
  return m;
}

class Herd {
  // One InstancedMesh per species; slots are written each frame.
  constructor(scene, geo, mat, cap) {
    this.cap = cap;
    const phase = new Float32Array(cap);
    for (let i = 0; i < cap; i++) phase[i] = R();
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
    this.n = 0;
  }
  begin() { this.n = 0; }
  // basis from a forward vector (x = up × f, y = f × x)
  push(p, f, s, bank = 0) {
    if (this.n >= this.cap) return;
    const e = this.mesh.instanceMatrix.array, o = this.n++ * 16;
    let fx = f.x, fy = f.y, fz = f.z;
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    let xx = fz, xz = -fx; // up × f with up = (0,1,0)
    const xl = Math.hypot(xx, xz) || 1; xx /= xl; xz /= xl;
    let yx = fy * xz, yy = fz * xx - fx * xz, yz = -fy * xx;
    let xy = 0;
    if (bank) { // roll around forward
      const c = Math.cos(bank), sn = Math.sin(bank);
      const nx = xx * c + yx * sn, ny = xy * c + yy * sn, nz = xz * c + yz * sn;
      yx = yx * c - xx * sn; yy = yy * c - xy * sn; yz = yz * c - xz * sn;
      xx = nx; xy = ny; xz = nz;
    }
    e[o] = xx * s; e[o + 1] = xy * s; e[o + 2] = xz * s; e[o + 3] = 0;
    e[o + 4] = yx * s; e[o + 5] = yy * s; e[o + 6] = yz * s; e[o + 7] = 0;
    e[o + 8] = fx * s; e[o + 9] = fy * s; e[o + 10] = fz * s; e[o + 11] = 0;
    e[o + 12] = p.x; e[o + 13] = p.y; e[o + 14] = p.z; e[o + 15] = 1;
  }
  end() { this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true; }
}

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _d = new THREE.Vector3();
const _b = [0, 0, 0, 0];

export class Creatures {
  constructor(scene, world, quality, vegetation = null) {
    this.world = world;
    this.vegetation = vegetation; // reef fish home on its coral heads
    this.slots = { low: 9, medium: 14, high: 18, ultra: 24 }[quality] ?? 14;
    this.herds = {};
    for (const [id, S] of Object.entries(SPECIES)) {
      if (S.kind === 'school' || S.kind === 'reef') {
        this.herds[id] = new Herd(scene, fishShape(S.shape), creatureMat(id, { WIG_SWIM: 1 }), Math.ceil(this.slots * 0.6) * S.n[1]);
        this.herds[id].mesh.material.userData.uniforms.uFreq.value = S.freq;
        this.herds[id].mesh.material.userData.uniforms.uAmp.value = S.amp;
      } else if (S.kind === 'jelly') {
        this.herds[id] = new Herd(scene, jellyShape(...S.colors), creatureMat(id, { WIG_JELLY: 1 }, { transparent: true, opacity: 0.6, depthWrite: false, roughness: 0.2 }), 6 * S.n[1]);
        this.herds[id].mesh.material.userData.uniforms.uFreq.value = S.freq;
        this.herds[id].mesh.renderOrder = 3;
      } else if (S.kind === 'ray') {
        const turtle = S.shape === 'turtle'; // rigid shell: only the flippers beat
        this.herds[id] = new Herd(scene, turtle ? turtleShape() : rayShape(...S.colors), creatureMat(id, turtle ? { WIG_FLAP: 1, FLAP_DEAD: '0.62' } : { WIG_FLAP: 1 }), 12);
        Object.assign(this.herds[id].mesh.material.userData.uniforms, { uFreq: { value: S.freq }, uAmp: { value: S.amp } });
      }
    }
    // whale + calf share one mesh
    const wg = whaleShape({ top: 0x26323e, belly: 0x9aa6ac, fin: 0x222c36, glowLine: 0x60d0ff });
    this.whaleHerd = new Herd(scene, wg, creatureMat('whale', { WIG_SWIM: 1, WIG_VERT: 1 }, { roughness: 0.7 }), 2);
    Object.assign(this.whaleHerd.mesh.material.userData.uniforms, { uFreq: { value: 0.9 }, uAmp: { value: 0.035 } });
    this.whaleHerd.mesh.castShadow = true;
    this.whale = { p: new THREE.Vector3(260, -45, 640), f: new THREE.Vector3(1, 0, 0), target: new THREE.Vector3(), retarget: 0, speed: 3.2, len: 34, yaw: 0, breath: 70, surf: 0 };
    this.spout = { x: 0, y: 0, z: 0, rate: 0, type: 'spout' }; // Game adds it to the shared emitter list
    this.calf = { p: new THREE.Vector3(250, -45, 655), f: new THREE.Vector3(1, 0, 0) };
    // birds circle the islands
    this.birdHerd = new Herd(scene, birdShape(), creatureMat('bird', { WIG_FLAP: 1 }, { roughness: 0.8 }), ISLANDS.length * 7);
    Object.assign(this.birdHerd.mesh.material.userData.uniforms, { uFreq: { value: 7 }, uAmp: { value: 0.12 } });
    this.birds = [];
    for (const I of ISLANDS) for (let i = 0; i < 7; i++) {
      this.birds.push({ I, r: 25 + R() * I.r * 0.4, h: I.peak * 0.6 + 18 + R() * 25, a: R() * TAU, w: (0.12 + R() * 0.08) * (R() < 0.5 ? -1 : 1), glide: R() * 10 });
    }
    this.groups = []; // active schools / blooms / rays near the player
    this.time = 0;
  }

  _habitatPick(x, z) {
    const g = this.world.heightAt(x, z);
    if (g > -2.5) return null;
    this.world.biomeAt(x, z, _b);
    let total = 0;
    const cand = [];
    for (const [id, S] of Object.entries(SPECIES)) {
      if (!S.habitat) continue;
      const w = S.habitat(g, _b);
      if (w > 0) { cand.push([id, w]); total += w; }
    }
    if (!total) return null;
    let r = R() * total;
    for (const [id, w] of cand) if ((r -= w) <= 0) return [id, g];
    return [cand[cand.length - 1][0], g];
  }

  _spawn(group, cam, initial) {
    for (let tries = 0; tries < 10; tries++) {
      const a = R() * TAU, d = initial ? 15 + R() * 120 : 110 + R() * 60;
      const x = cam.x + Math.cos(a) * d, z = cam.z + Math.sin(a) * d;
      if (!this.world.inBounds(x, z)) continue;
      const pick = this._habitatPick(x, z);
      if (!pick) continue;
      const [id, g] = pick, S = SPECIES[id];
      if (S.kind === 'reef') {
        const rd = initial ? 8 + R() * 50 : 35 + R() * 35; // small residents: live close in, recycled at 90 m
        const home = this.vegetation?.reefNear(cam.x + Math.cos(a) * rd, cam.z + Math.sin(a) * rd, 25);
        if (!home || home.y > -2.5 || this.groups.some((o) => o.alive && o.home === home)) continue;
        this._spawnReef(group, id, S, home);
        return true;
      }
      const top = -Math.min(S.depth?.[0] ?? 2, -g * 0.5), bottom = Math.max(g + 2.5, -(S.depth?.[1] ?? 60));
      if (bottom > top) continue;
      const y = S.kind === 'ray' && !S.mid ? g + 1.5 : bottom + R() * (top - bottom);
      if (this.world.sdf(x, y, z) < 3) continue;
      const n = Math.round(S.n[0] + R() * (S.n[1] - S.n[0]));
      group.id = id; group.S = S; group.alive = true; group.home = null;
      group.c = new THREE.Vector3(x, y, z);
      group.v = new THREE.Vector3(Math.cos(a + 1.5), 0, Math.sin(a + 1.5)).multiplyScalar(S.speed * 0.6);
      group.wp = group.c.clone();
      group.wpT = 0;
      group.members = [];
      const spread = S.kind === 'jelly' ? 14 : S.kind === 'ray' ? 6 : 2.5;
      for (let i = 0; i < n; i++) {
        const p = group.c.clone().add(_v.set(R() - 0.5, (R() - 0.5) * (S.kind === 'ray' ? 0.3 : 0.6), R() - 0.5).multiplyScalar(spread * 2));
        group.members.push({ p, v: group.v.clone(), s: S.size[0] + R() * (S.size[1] - S.size[0]), o: new THREE.Vector3(R() - 0.5, (R() - 0.5) * 0.5, R() - 0.5).multiplyScalar(spread), bank: 0 });
      }
      return true;
    }
    group.alive = false;
    return false;
  }

  // A few fish living around one coral head: each keeps its own orbit radius, height and direction
  _spawnReef(group, id, S, home) {
    group.id = id; group.S = S; group.alive = true; group.home = home;
    group.c = new THREE.Vector3(home.x, home.y + 1, home.z);
    group.members = [];
    const n = Math.round(S.n[0] + R() * (S.n[1] - S.n[0])), dir = R() < 0.5 ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const r = home.r * 0.4 + 0.5 + R() * (id === 'emberdart' ? 0.8 : 1.8), a = R() * TAU;
      group.members.push({
        p: new THREE.Vector3(home.x + Math.cos(a) * r, home.y + 0.8 + R() * 2, home.z + Math.sin(a) * r), v: new THREE.Vector3(),
        s: S.size[0] + R() * (S.size[1] - S.size[0]), a, r, hy: 0.5 + R() * (id === 'emberdart' ? 1.2 : 2.6),
        w: (dir * (0.25 + R() * 0.2)) / Math.sqrt(r), flee: 0, ph: R() * TAU,
      });
    }
  }

  _updateReef(g, dt, time, cam) {
    const S = g.S, H = g.home, herd = this.herds[g.id], W = this.world;
    for (const m of g.members) {
      _v.subVectors(m.p, cam);
      const pd = _v.length();
      if (pd < 3.5 && m.flee <= 0) m.flee = 1.5 + R(); // startled: dart away, then drift home
      if (m.flee > 0) {
        m.flee -= dt;
        m.v.addScaledVector(_v, (dt * 14) / Math.max(pd, 0.5));
      } else {
        m.a += m.w * dt * (1 + 0.3 * Math.sin(time * 0.7 + m.ph));
        const r = m.r * (1 + 0.15 * Math.sin(time * 0.4 + m.ph));
        _a.set(H.x + Math.cos(m.a) * r, H.y + m.hy + 0.4 * Math.sin(time * 0.6 + m.ph), H.z + Math.sin(m.a) * r).sub(m.p);
        m.v.addScaledVector(_a, dt * 1.6);
        m.v.multiplyScalar(1 - Math.min(1, dt * 1.2));
      }
      const sp = m.v.length(), mx = m.flee > 0 ? S.speed * 4 : S.speed;
      if (sp > mx) m.v.multiplyScalar(mx / sp);
      m.p.addScaledVector(m.v, dt);
      const gh = W.heightAt(m.p.x, m.p.z) + 0.3;
      if (m.p.y < gh) m.p.y = gh;
      if (m.p.y > -0.5) m.p.y = -0.5;
      // face along the path; when hovering, along the orbit tangent
      if (sp > 0.15) _d.copy(m.v); else _d.set(-Math.sin(m.a) * Math.sign(m.w), 0, Math.cos(m.a) * Math.sign(m.w));
      herd.push(m.p, _d, m.s);
    }
  }

  update(dt, time, player, day) {
    dt = Math.min(dt, 0.05);
    this.time = time;
    const cam = player.pos, W = this.world;
    while (this.groups.length < this.slots) this.groups.push({ alive: false, first: true });
    // retire distant groups, spawn replacements a few per frame
    let spawns = 2;
    for (const g of this.groups) {
      if (g.alive && g.c.distanceTo(cam) > (g.home ? 90 : 200)) g.alive = false;
      if (!g.alive && spawns-- > 0) { this._spawn(g, cam, g.first); g.first = false; }
    }
    for (const h of Object.values(this.herds)) h.begin();
    for (const g of this.groups) if (g.alive) (g.S.kind === 'reef' ? this._updateReef(g, dt, time, cam) : this._updateGroup(g, dt, time, cam));
    for (const h of Object.values(this.herds)) h.end();
    for (const id of ['lanternet', 'veilbell', 'gloamjaw']) this.herds[id].mesh.material.userData.uniforms.uGlowK.value = 1.6;
    this._updateWhale(dt, time, cam, day);
    this._updateBirds(dt, time, cam);
  }

  _updateGroup(g, dt, time, cam) {
    const S = g.S, W = this.world, herd = this.herds[g.id];
    // wander: pick a new waypoint now and then, staying in the species' depth band
    g.wpT -= dt;
    if (g.wpT <= 0) {
      g.wpT = 6 + R() * 8;
      for (let k = 0; k < 4; k++) {
        const x = g.c.x + (R() - 0.5) * 50, z = g.c.z + (R() - 0.5) * 50, gh = W.heightAt(x, z);
        if (gh > -2.5) continue;
        const top = Math.min(-(S.depth?.[0] ?? 2), gh * 0.2), bottom = Math.max(gh + (S.kind === 'ray' && !S.mid ? 1.2 : 2.5), -(S.depth?.[1] ?? 60));
        if (bottom > top) continue;
        g.wp.set(x, S.kind === 'ray' && !S.mid ? gh + 1.2 + R() : bottom + R() * (top - bottom), z);
        break;
      }
    }
    _d.subVectors(g.wp, g.c);
    const dl = _d.length();
    if (dl > 1) g.v.lerp(_d.multiplyScalar(S.speed / dl), Math.min(1, dt * 0.6));
    // shy of the diver
    _a.subVectors(g.c, cam);
    const pd = _a.length();
    if (pd < 9 && S.kind !== 'jelly') g.v.addScaledVector(_a, (dt * 3 * (9 - pd)) / Math.max(pd, 0.5));
    // keep the centre out of the rock and below the surface
    const ahead = W.sdf(g.c.x + g.v.x * 2, g.c.y + g.v.y * 2, g.c.z + g.v.z * 2);
    if (ahead < 2.5) { g.v.y += dt * 4; g.v.x *= 0.95; g.v.z *= 0.95; g.wpT = 0; }
    if (g.c.y > -1.2) g.v.y -= dt * 3;
    const sp = g.v.length(), maxS = S.speed * 1.8;
    if (sp > maxS) g.v.multiplyScalar(maxS / sp);
    g.c.addScaledVector(g.v, dt);

    if (S.kind === 'jelly') {
      for (const m of g.members) {
        m.p.x += Math.sin(time * 0.1 + m.o.x) * 0.1 * dt + g.v.x * dt * 0.3;
        m.p.z += Math.cos(time * 0.1 + m.o.z) * 0.1 * dt + g.v.z * dt * 0.3;
        m.p.y += Math.sin(time * 0.35 + m.o.y * 9) * 0.25 * dt;
        const gh = W.heightAt(m.p.x, m.p.z);
        if (m.p.y < gh + 2) m.p.y = gh + 2;
        if (m.p.y > -1.5) m.p.y = -1.5;
        _v.set(Math.sin(time * 0.2 + m.o.x) * 0.15, 1, Math.cos(time * 0.2 + m.o.z) * 0.15);
        // jellies "face" up: forward = up, so use a tilted basis via push with forward=(0,0,1) & then the shape is upright already
        herd.push(m.p, _a.set(Math.sin(m.o.x * 7), 0, Math.cos(m.o.x * 7)), m.s);
      }
      return;
    }
    const M = g.members, n = M.length;
    for (let i = 0; i < n; i++) {
      const m = M[i];
      // cohesion to a personal slot in the school, alignment with the school, separation from neighbours
      _a.copy(g.c).add(m.o).sub(m.p).multiplyScalar(S.kind === 'ray' ? 0.25 : 1.1);
      _a.addScaledVector(_v.subVectors(g.v, m.v), 1.4);
      for (const j of [i - 1, i + 1, i + 3]) {
        const o = M[(j + n) % n];
        if (o === m) continue;
        _v.subVectors(m.p, o.p);
        const d2 = _v.lengthSq(), sep = m.s * 2.2;
        if (d2 < sep * sep && d2 > 1e-6) _a.addScaledVector(_v, (6 * (sep - Math.sqrt(d2))) / Math.sqrt(d2));
      }
      _v.subVectors(m.p, cam);
      const pd2 = _v.lengthSq();
      if (pd2 < 25) _a.addScaledVector(_v, 30 / Math.max(pd2, 0.3));
      m.v.addScaledVector(_a, dt);
      m.v.x += Math.sin(time * 1.7 + i) * dt * 0.6;
      m.v.y += Math.cos(time * 1.3 + i * 2) * dt * 0.3;
      const sp2 = m.v.length(), mx = S.speed * 2.2;
      if (sp2 > mx) m.v.multiplyScalar(mx / sp2);
      m.p.addScaledVector(m.v, dt);
      const gh = W.heightAt(m.p.x, m.p.z) + 0.4;
      if (m.p.y < gh) { m.p.y = gh; m.v.y = Math.abs(m.v.y); }
      if (m.p.y > -0.4) { m.p.y = -0.4; m.v.y = -Math.abs(m.v.y); }
      if (S.kind === 'ray') {
        m.bank += (-(m.v.x * g.v.z - m.v.z * g.v.x) * 0.3 - m.bank) * dt;
        herd.push(m.p, _v.set(m.v.x, m.v.y * 0.3, m.v.z), m.s, m.bank);
      } else {
        herd.push(m.p, m.v, m.s);
      }
    }
  }

  _updateWhale(dt, time, cam, day) {
    const w = this.whale, W = this.world, herd = this.whaleHerd;
    w.retarget -= dt;
    if (w.retarget <= 0 || w.p.distanceTo(w.target) < 30) {
      w.retarget = 45;
      // wander somewhere deep within a few hundred metres of the diver
      let best = null, bestH = 0;
      for (let k = 0; k < 10; k++) {
        const a = R() * TAU, d = 120 + R() * 200, x = cam.x + Math.cos(a) * d, z = cam.z + Math.sin(a) * d;
        if (!W.inBounds(x, z)) continue;
        const h = W.heightAt(x, z);
        if (h < bestH) { bestH = h; best = [x, z]; }
        if (h < -60) break;
      }
      if (best) w.target.set(best[0], Math.max(bestH + 22, -55), best[1]);
    }
    // steer toward the target, away from shallows ahead
    _d.subVectors(w.target, w.p).setY(0).normalize();
    const look = (ang) => W.heightAt(w.p.x + Math.sin(w.yaw + ang) * 60, w.p.z + Math.cos(w.yaw + ang) * 60);
    let turn = Math.atan2(_d.x, _d.z) - w.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const hA = look(0);
    if (hA > w.p.y - 10) turn = look(0.6) < look(-0.6) ? 0.8 : -0.8;
    w.yaw += Math.max(-0.12, Math.min(0.12, turn)) * dt;
    const ground = Math.max(W.heightAt(w.p.x, w.p.z), hA);
    // every minute or two she rises to breathe: a slow climb, a few blows at the surface, then down again
    w.breath -= dt;
    if (w.breath <= 0 && w.surf <= 0 && ground < -30) w.surf = 45;
    if (w.surf > 0) {
      w.surf -= dt;
      if (w.surf <= 0) w.breath = 70 + R() * 60;
    }
    const atTop = w.surf > 0 && w.p.y > -5; // blowhole (~2.7 m above centre) is at the surface
    const wantY = w.surf > 4 ? -1 : Math.min(Math.max(ground + 16, w.target.y), -14);
    const vy = Math.max(-1.2, Math.min(1.2, (wantY - w.p.y) * 0.2));
    const sp = this.spout; // blowhole a little behind the head; a blow every 9 s while at the surface
    sp.x = w.p.x + Math.sin(w.yaw) * w.len * 0.3; sp.y = w.p.y + w.len * 0.08; sp.z = w.p.z + Math.cos(w.yaw) * w.len * 0.3;
    sp.rate = atTop && time % 9 < 1.6 ? 3 : 0;
    w.f.set(Math.sin(w.yaw) * w.speed, vy, Math.cos(w.yaw) * w.speed);
    w.p.addScaledVector(w.f, dt);
    // keep the whale from wandering off completely if the diver sprints away
    if (w.p.distanceTo(cam) > 900) { w.p.set(w.target.x, w.target.y, w.target.z); }
    const c = this.calf;
    _v.set(Math.cos(w.yaw) * 14, -4 + Math.sin(time * 0.3) * 1.5, -Math.sin(w.yaw) * 14).addScaledVector(_d.set(Math.sin(w.yaw), 0, Math.cos(w.yaw)), -6 + Math.sin(time * 0.17) * 4);
    c.p.lerp(_a.copy(w.p).add(_v), Math.min(1, dt * 0.5));
    herd.begin();
    herd.push(w.p, _a.set(w.f.x, w.f.y * 0.5, w.f.z), w.len);
    herd.push(c.p, w.f, w.len * 0.38, Math.sin(time * 0.4) * 0.15);
    herd.end();
    herd.mesh.material.userData.uniforms.uGlowK.value = 0.25 + (1 - day) * 1.2;
  }

  _updateBirds(dt, time, cam) {
    const h = this.birdHerd;
    h.begin();
    for (const b of this.birds) {
      const dx = b.I.x - cam.x, dz = b.I.z - cam.z;
      if (dx * dx + dz * dz > 900 * 900) continue;
      b.a += (b.w * dt * 24) / b.r;
      const x = b.I.x + Math.cos(b.a) * b.r, z = b.I.z + Math.sin(b.a) * b.r, y = b.h + Math.sin(time * 0.3 + b.glide) * 3;
      _v.set(x, y, z);
      _d.set(-Math.sin(b.a) * Math.sign(b.w), 0, Math.cos(b.a) * Math.sign(b.w));
      h.push(_v, _d, 1.1, -Math.sign(b.w) * 0.35);
    }
    h.end();
  }

  // Species the camera is looking at closely (for the journal), or null
  sighting(cam, dir, seen) {
    const look = (p, see, rad = 0) => {
      _v.subVectors(p, cam);
      const d = _v.length();
      return d < see + rad && (d < rad + 2 || _v.dot(dir) / d > 0.85);
    };
    for (const g of this.groups) {
      if (!g.alive || seen.has(g.id)) continue;
      for (let i = 0; i < g.members.length; i += 3) if (look(g.members[i].p, g.S.see)) return g.id;
    }
    if (!seen.has('hollowsong') && (look(this.whale.p, SPECIES.hollowsong.see, 15) || look(this.calf.p, 30, 5))) return 'hollowsong';
    if (!seen.has('saltwing')) for (const b of this.birds) {
      _a.set(b.I.x + Math.cos(b.a) * b.r, b.h, b.I.z + Math.sin(b.a) * b.r);
      if (look(_a, SPECIES.saltwing.see)) return 'saltwing';
    }
    return null;
  }
}
