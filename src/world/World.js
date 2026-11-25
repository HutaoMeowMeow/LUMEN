// World data on the main thread: heightmap/biome generation (via workers) and spatial queries.
import { WORLD, CAVES } from './layout.js';
import { caveSdf, caveAt, caveEnclosure } from './caves.js';
import { clamp } from './noise.js';

export class World {
  constructor() {
    const { res, biomeRes } = WORLD;
    this.heights = new Float32Array(res * res);
    this.biome = new Uint8Array(biomeRes * biomeRes * 4);
    this.caveMeshes = new Array(CAVES.length);
    this.colliders = null; // set by Structures (Colliders instance)
  }

  // Generates everything with a pool of workers. onProgress(0..1, label)
  async generate(onProgress) {
    const { res } = WORLD;
    const threads = clamp(navigator.hardwareConcurrency || 4, 2, 8); // the main thread only waits on the loading screen
    const workers = Array.from({ length: threads }, () => new Worker(new URL('./worldgen.worker.js', import.meta.url), { type: 'module' }));
    const jobs = [];
    // Caves first: they are the longest single jobs, so they start early
    for (let i = 0; i < CAVES.length; i++) jobs.push({ type: 'cave', index: i, weight: 6 });
    const rowsPerJob = 32;
    for (let r = 0; r < res; r += rowsPerJob) jobs.push({ type: 'rows', r0: r, r1: Math.min(res, r + rowsPerJob), weight: 1 });
    const total = jobs.reduce((s, j) => s + j.weight, 0);
    let done = 0;

    await new Promise((resolve, reject) => {
      let next = 0, active = 0;
      const pump = (w) => {
        if (next >= jobs.length) {
          if (active === 0) resolve();
          return;
        }
        const job = jobs[next++];
        active++;
        w.onmessage = (e) => {
          active--;
          this._accept(e.data);
          done += job.weight;
          onProgress?.(done / total, job.type === 'cave' ? 'Carving caves' : 'Shaping the sea floor');
          pump(w);
        };
        w.onerror = (err) => reject(err);
        w.postMessage(job);
      };
      workers.forEach(pump);
    });
    workers.forEach((w) => w.terminate());
  }

  _accept(msg) {
    if (msg.type === 'rows') {
      this.heights.set(msg.heights, msg.r0 * WORLD.res);
      for (const b of msg.bRows) this.biome.set(b.data, b.row * WORLD.biomeRes * 4);
    } else if (msg.type === 'cave') {
      this.caveMeshes[msg.index] = msg;
    }
  }

  // Height interpolated over the same triangles the terrain mesh uses (diagonal b-c).
  heightAt(x, z) {
    const { res, half, cell } = WORLD;
    let fx = (x + half) / cell, fz = (z + half) / cell;
    fx = clamp(fx, 0, res - 1.001); fz = clamp(fz, 0, res - 1.001);
    const i = fx | 0, j = fz | 0;
    const u = fx - i, v = fz - j;
    const H = this.heights;
    const a = j * res + i;
    const ha = H[a], hb = H[a + 1], hc = H[a + res], hd = H[a + res + 1];
    if (u + v <= 1) return ha + (hb - ha) * u + (hc - ha) * v;
    return hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
  }

  // Raw sample at grid index (clamped)
  hAt(i, j) {
    const r = WORLD.res;
    i = i < 0 ? 0 : i >= r ? r - 1 : i;
    j = j < 0 ? 0 : j >= r ? r - 1 : j;
    return this.heights[j * r + i];
  }

  normalAt(x, z, out = [0, 1, 0]) {
    const e = WORLD.cell;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const nx = -dx, ny = 2 * e, nz = -dz;
    const l = Math.hypot(nx, ny, nz);
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
    return out;
  }

  // Biome weights 0..1: [reef, kelp, rift, volcanic]
  biomeAt(x, z, out = [0, 0, 0, 0]) {
    const { half, biomeRes, size } = WORLD;
    const i = clamp(Math.round(((x + half) / size) * (biomeRes - 1)), 0, biomeRes - 1);
    const j = clamp(Math.round(((z + half) / size) * (biomeRes - 1)), 0, biomeRes - 1);
    const o = (j * biomeRes + i) * 4;
    out[0] = this.biome[o] / 255; out[1] = this.biome[o + 1] / 255; out[2] = this.biome[o + 2] / 255; out[3] = this.biome[o + 3] / 255;
    return out;
  }

  // Signed distance to any solid (approximate, exact near surfaces). Negative = inside.
  sdf(x, y, z) {
    const h = this.heightAt(x, z);
    const e = 1.0;
    const gx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) * 0.5;
    const gz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) * 0.5;
    let d = (y - h) / Math.sqrt(1 + gx * gx + gz * gz);
    const c = caveSdf(x, y, z);
    if (c < d) d = c;
    if (this.colliders) {
      const s = this.colliders.sdf(x, y, z);
      if (s < d) d = s;
    }
    return d;
  }

  sdfNormal(x, y, z, out) {
    const e = 0.05;
    const gx = this.sdf(x + e, y, z) - this.sdf(x - e, y, z);
    const gy = this.sdf(x, y + e, z) - this.sdf(x, y - e, z);
    const gz = this.sdf(x, y, z + e) - this.sdf(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    out.set(gx / l, gy / l, gz / l);
    return out;
  }

  caveIndexAt(x, y, z) { return caveAt(x, y, z); }
  enclosure(x, y, z) { return caveEnclosure(x, y, z); }
  inBounds(x, z) { return Math.hypot(x, z) < WORLD.boundary; }
}
