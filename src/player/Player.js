// First-person diver: swimming with drag and buoyancy, walking with gravity on land, SDF collision against the world.
import * as THREE from 'three';
import { WORLD } from '../world/layout.js';

const EYE = 1.6; // eye height above the feet when standing
const SWIM_R = 0.45;
const BODY = [{ off: -0.25, r: 0.32 }, { off: -1.2, r: 0.4 }]; // standing collision spheres below the eye
const _n = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _w = new THREE.Vector3();

export class Player {
  constructor(world, ocean, camera, input) {
    this.world = world;
    this.ocean = ocean;
    this.camera = camera;
    this.input = input;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.mode = 'swim';
    this.grounded = false;
    this.headUnder = false;
    this.surface = 0;
    this.depth = 0; // metres below the surface (eye)
    this.maxO2 = 90;
    this.o2 = this.maxO2;
    this.blackout = 0; // 0..1 fade while drowning
    this.flashlight = false;
    this.sensitivity = 1;
    this.invertY = false;
    this.lastAir = new THREE.Vector3();
    this.bob = 0;
    this.speed = 0;
    this.events = []; // 'splash-in' | 'splash-out' | 'blackout' | 'surface' consumed by audio/UI
    this.frozen = false;
  }

  place(x, y, z, yaw = this.yaw) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.lastAir.set(x, Math.max(y, 0.3), z);
    this._sync();
  }

  forward(out = _f) { return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }

  update(dt, time) {
    const I = this.input, W = this.world;
    // look
    const s = 0.0022 * this.sensitivity;
    this.yaw -= I.dx * s;
    this.pitch -= I.dy * s * (this.invertY ? -1 : 1);
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
    if (I.pressed('KeyF')) this.flashlight = !this.flashlight;

    this.surface = this.ocean.heightAt(this.pos.x, this.pos.z, time);
    const wasUnder = this.headUnder;
    this.headUnder = this.pos.y < this.surface - 0.02;
    if (wasUnder !== this.headUnder) this.events.push(this.headUnder ? 'splash-in' : 'splash-out');
    this.depth = Math.max(0, this.surface - this.pos.y);

    // mode with hysteresis: stand when feet are on ground and the head is clear of the water
    if (this.mode === 'swim' && this.grounded && this.pos.y > this.surface + 0.15) this.mode = 'walk';
    else if (this.mode === 'walk' && (this.pos.y < this.surface - 0.1 || (!this.grounded && this.pos.y - EYE < this.surface - 1.2))) this.mode = 'swim';

    const move = this.frozen ? 0 : 1;
    const fwd = (I.down('KeyW') ? 1 : 0) - (I.down('KeyS') ? 1 : 0);
    const str = (I.down('KeyD') ? 1 : 0) - (I.down('KeyA') ? 1 : 0);
    const up = (I.down('Space') ? 1 : 0) - (I.down('ControlLeft') || I.down('ControlRight') || I.down('KeyC') ? 1 : 0);
    const sprint = I.down('ShiftLeft') || I.down('ShiftRight');

    if (this.mode === 'swim') this._swim(dt, fwd * move, str * move, up * move, sprint);
    else this._walk(dt, fwd * move, str * move, up * move, sprint);

    // soft world boundary: a current pushes you back toward the islands
    const rr = Math.hypot(this.pos.x, this.pos.z);
    if (rr > WORLD.boundary) {
      const k = Math.min((rr - WORLD.boundary) / 60, 1) * 14 * dt;
      this.vel.x -= (this.pos.x / rr) * k;
      this.vel.z -= (this.pos.z / rr) * k;
    }
    this.outOfBounds = rr > WORLD.boundary - 40;

    this._integrate(dt);
    this.speed = this.vel.length();
    this._oxygen(dt, sprint && (fwd || str || up));
    this._sync(dt, time);
  }

  _swim(dt, fwd, str, up, sprint) {
    const f = this.forward(_f);
    _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _w.set(0, 0, 0).addScaledVector(f, fwd).addScaledVector(_r, str);
    _w.y += up;
    if (_w.lengthSq() > 1) _w.normalize();
    const acc = sprint ? 22 : 13;
    this.vel.addScaledVector(_w, acc * dt);
    const drag = Math.exp(-2.4 * dt);
    this.vel.multiplyScalar(drag);
    // near the surface: float to treading height, gravity above the water
    const tread = this.surface + 0.12;
    if (this.pos.y > tread) this.vel.y -= 14 * dt;
    else if (this.pos.y > this.surface - 1.2 && up >= 0 && fwd * this.pitch >= -0.15) this.vel.y += (tread - this.pos.y) * 6 * dt;
    // stop swimming up out of the water: the head can only clear the surface a little
    if (this.pos.y > this.surface + 0.35 && this.vel.y > 0) this.vel.y *= 0.5;
  }

  _walk(dt, fwd, str, up, sprint) {
    _w.set(-Math.sin(this.yaw) * fwd + Math.cos(this.yaw) * str, 0, -Math.cos(this.yaw) * fwd - Math.sin(this.yaw) * str);
    if (_w.lengthSq() > 1) _w.normalize();
    const wade = Math.min(Math.max((this.surface - (this.pos.y - EYE)) / 1.2, 0), 1);
    const speed = (sprint ? 8 : 4.6) * (1 - wade * 0.5);
    const k = 1 - Math.exp(-(this.grounded ? 12 : 2) * dt);
    this.vel.x += (_w.x * speed - this.vel.x) * k;
    this.vel.z += (_w.z * speed - this.vel.z) * k;
    this.vel.y -= 22 * dt;
    if (this.grounded && up > 0 && this.input.pressed('Space')) { this.vel.y = 7; this.grounded = false; }
    if (this.grounded && (fwd || str)) this.bob += dt * speed * 1.7;
  }

  _integrate(dt) {
    const W = this.world;
    const steps = Math.max(1, Math.ceil((this.vel.length() * dt) / 0.25));
    const h = dt / steps;
    const spheres = this.mode === 'swim' ? [{ off: 0, r: SWIM_R }, { off: -0.7, r: 0.35 }] : BODY;
    const wasGrounded = this.grounded;
    this.grounded = false;
    for (let s = 0; s < steps; s++) {
      this.pos.addScaledVector(this.vel, h);
      for (let it = 0; it < 3; it++) {
        let hit = false;
        for (const b of spheres) {
          const y = this.pos.y + b.off;
          const d = W.sdf(this.pos.x, y, this.pos.z);
          if (d >= b.r) continue;
          hit = true;
          W.sdfNormal(this.pos.x, y, this.pos.z, _n);
          if (this.mode === 'walk' && _n.y > 0.55) {
            // walkable ground: lift straight up, so gravity can't creep the body downhill when standing still
            this.pos.y += (b.r - d) / _n.y + 0.001;
            if (this.vel.y < 0) this.vel.y = 0;
            if (b === spheres[spheres.length - 1]) this.grounded = true;
            continue;
          }
          this.pos.addScaledVector(_n, b.r - d + 0.001);
          const vn = this.vel.dot(_n);
          if (vn < 0) this.vel.addScaledVector(_n, -vn * (this.mode === 'swim' ? 1 : 1));
          if (_n.y > 0.55 && b === spheres[spheres.length - 1]) this.grounded = true;
        }
        if (!hit) break;
      }
    }
    // keep standing feet glued to slopes when walking downhill
    if (this.mode === 'walk' && !this.grounded && this.vel.y <= 0) {
      const g = W.sdf(this.pos.x, this.pos.y - EYE, this.pos.z);
      if (g < 0.3 && W.sdfNormal(this.pos.x, this.pos.y - EYE, this.pos.z, _n).y > 0.55) {
        if (wasGrounded) { this.pos.y -= Math.max(g, 0); this.vel.y = 0; } // follow the ground down walkable slopes
        if (g < 0.25 || wasGrounded) this.grounded = true;
      }
    }
    if (this.mode === 'swim') {
      const g = W.sdf(this.pos.x, this.pos.y - 0.9, this.pos.z);
      if (g < 0.35) this.grounded = true;
    }
    // last line of defence: never end a frame below the terrain heightfield
    const hg = W.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < hg + 0.3 && W.caveIndexAt(this.pos.x, this.pos.y, this.pos.z) < 0) { this.pos.y = hg + 0.3; if (this.vel.y < 0) this.vel.y = 0; }
  }

  _oxygen(dt, exerting) {
    if (this.headUnder) {
      this.o2 -= dt * (exerting ? 1.5 : 1);
    } else {
      if (this.o2 < this.maxO2 * 0.98 && this.depth <= 0) this.events.push('breath');
      this.o2 = Math.min(this.maxO2, this.o2 + dt * 30);
      this.lastAir.copy(this.pos);
      if (this.blackout > 0) this.blackout = Math.max(0, this.blackout - dt);
    }
    if (this.o2 <= 0) {
      this.o2 = 0;
      this.blackout += dt / 2.5;
      if (this.blackout >= 1) {
        // wake at the last place there was air
        this.events.push('blackout');
        this.place(this.lastAir.x, Math.max(this.lastAir.y, this.ocean.heightAt(this.lastAir.x, this.lastAir.z, 0) + 0.2), this.lastAir.z);
        this.o2 = this.maxO2;
        this.blackout = 0.999; // fades back in while breathing
      }
    }
  }

  _sync(dt = 0, time = 0) {
    const bobY = this.mode === 'walk' ? Math.sin(this.bob * 2) * 0.04 : Math.sin(time * 1.1) * 0.03 * Math.min(this.depth, 1);
    const targetRoll = this.mode === 'swim' ? Math.sin(time * 0.7) * 0.015 - (this.input.down('KeyD') - this.input.down('KeyA')) * 0.04 : 0;
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 4);
    this.camera.position.set(this.pos.x, this.pos.y + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }
}
