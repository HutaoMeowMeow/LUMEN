// Primitive signed-distance colliders in a spatial hash (structures, tree trunks, boulders).
// Transformed primitives store the inverse world matrix so queries happen in local space.
import * as THREE from 'three';

const CELL = 16;
const _m = new THREE.Matrix4();
const key = (i, k) => (i + 4096) * 8192 + (k + 4096);

export class Colliders {
  constructor() {
    this.items = new Map();
    this.grid = new Map();
    this.nextId = 1;
  }

  _insert(item) {
    const id = this.nextId++;
    this.items.set(id, item);
    const { cx, cz, r } = item;
    item.keys = [];
    for (let i = Math.floor((cx - r) / CELL); i <= Math.floor((cx + r) / CELL); i++) {
      for (let k = Math.floor((cz - r) / CELL); k <= Math.floor((cz + r) / CELL); k++) {
        const kk = key(i, k);
        let list = this.grid.get(kk);
        if (!list) this.grid.set(kk, (list = []));
        list.push(id);
        item.keys.push(kk);
      }
    }
    return id;
  }

  remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.items.delete(id);
    for (const kk of it.keys) {
      const l = this.grid.get(kk);
      const i = l ? l.indexOf(id) : -1;
      if (i >= 0) l.splice(i, 1);
      if (l && !l.length) this.grid.delete(kk);
    }
  }

  addSphere(x, y, z, r) { return this._insert({ t: 0, x, y, z, rad: r, cx: x, cy: y, cz: z, r }); }

  addCapsule(ax, ay, az, bx, by, bz, rad) {
    return this._insert({ t: 1, ax, ay, az, bx, by, bz, rad, cx: (ax + bx) / 2, cy: (ay + by) / 2, cz: (az + bz) / 2,
      r: Math.hypot(bx - ax, by - ay, bz - az) / 2 + rad });
  }

  // Shapes below take a world matrix (THREE.Matrix4, uniform scale) and local dimensions.
  _xf(t, matrix, dims, bound) {
    const inv = _m.copy(matrix).invert().elements.slice();
    const p = new THREE.Vector3().setFromMatrixPosition(matrix);
    const sc = new THREE.Vector3().setFromMatrixScale(matrix).x;
    return this._insert({ t, inv, sc, ...dims, cx: p.x, cy: p.y, cz: p.z, r: bound * sc });
  }
  addBox(matrix, hx, hy, hz) { return this._xf(2, matrix, { hx, hy, hz }, Math.hypot(hx, hy, hz)); }
  addCylinder(matrix, rad, hh) { return this._xf(3, matrix, { rad, hh }, Math.hypot(rad, hh)); }
  // hollow open-ended tube along local Y, wall thickness th (corridors you can swim through)
  addTube(matrix, rad, hh, th) { return this._xf(4, matrix, { rad, hh, th }, Math.hypot(rad, hh)); }
  // hollow sphere shell with everything below local y = cutY removed (dome with an open floor)
  addDome(matrix, rad, th, cutY) { return this._xf(5, matrix, { rad, th, cutY }, rad); }
  // torus in local XY plane (ring gate)
  addTorus(matrix, R, rad) { return this._xf(6, matrix, { R, rad }, R + rad); }

  _dist(it, x, y, z) {
    if (it.t === 0) return Math.hypot(x - it.x, y - it.y, z - it.z) - it.rad;
    if (it.t === 1) {
      const abx = it.bx - it.ax, aby = it.by - it.ay, abz = it.bz - it.az;
      let t = ((x - it.ax) * abx + (y - it.ay) * aby + (z - it.az) * abz) / (abx * abx + aby * aby + abz * abz || 1);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      return Math.hypot(x - it.ax - abx * t, y - it.ay - aby * t, z - it.az - abz * t) - it.rad;
    }
    const e = it.inv;
    const lx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const ly = e[1] * x + e[5] * y + e[9] * z + e[13];
    const lz = e[2] * x + e[6] * y + e[10] * z + e[14];
    let d;
    if (it.t === 2) {
      const qx = Math.abs(lx) - it.hx, qy = Math.abs(ly) - it.hy, qz = Math.abs(lz) - it.hz;
      d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
    } else if (it.t === 3 || it.t === 4) {
      let dr = Math.hypot(lx, lz) - it.rad;
      if (it.t === 4) dr = Math.abs(dr + it.th * 0.5) - it.th * 0.5;
      const dy = Math.abs(ly) - it.hh;
      d = Math.hypot(Math.max(dr, 0), Math.max(dy, 0)) + Math.min(Math.max(dr, dy), 0);
    } else if (it.t === 5) {
      d = Math.max(Math.abs(Math.hypot(lx, ly, lz) - it.rad + it.th * 0.5) - it.th * 0.5, it.cutY - ly);
    } else {
      d = Math.hypot(Math.hypot(lx, ly) - it.R, lz) - it.rad;
    }
    return d * it.sc;
  }

  // A cut item subtracts its volume from every other collider (doorways through walls).
  cut(id) { this.items.get(id).cut = true; return id; }

  sdf(x, y, z) {
    let best = 1e9, cut = 1e9;
    const list = this.grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (list) for (const id of list) {
      const it = this.items.get(id);
      if (Math.abs(y - it.cy) > it.r + 4) continue;
      const d = this._dist(it, x, y, z);
      if (it.cut) { if (d < cut) cut = d; } else if (d < best) best = d;
    }
    return Math.max(best, -cut);
  }
}
