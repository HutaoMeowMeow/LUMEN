// Procedural tileable textures generated at startup (no image assets needed).
import * as THREE from 'three';
import { mulberry32 } from '../world/noise.js';

// Periodic value-noise fbm: returns Float32Array size*size in 0..1
function periodicFbm(size, basePeriod, octaves, seed) {
  const out = new Float32Array(size * size);
  const rnd = mulberry32(seed);
  let amp = 1, total = 0, period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    const lat = new Float32Array(period * period);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * period, iy = Math.floor(fy), ty = fy - iy;
      const sy = ty * ty * (3 - 2 * ty);
      const y0 = iy % period, y1 = (iy + 1) % period;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * period, ix = Math.floor(fx), tx = fx - ix;
        const sx = tx * tx * (3 - 2 * tx);
        const x0 = ix % period, x1 = (ix + 1) % period;
        const a = lat[y0 * period + x0], b = lat[y0 * period + x1], c = lat[y1 * period + x0], d = lat[y1 * period + x1];
        out[y * size + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    total += amp;
    amp *= 0.5;
    period *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function stretch(arr) {
  let lo = Infinity, hi = -Infinity;
  for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - lo) / (hi - lo);
  return arr;
}

let noiseTex = null;
// RGBA: R medium fbm, G fine fbm, B coarse fbm, A ridged
export function getNoiseTexture() {
  if (noiseTex) return noiseTex;
  const size = 256;
  const r = stretch(periodicFbm(size, 8, 5, 11));
  const g = stretch(periodicFbm(size, 32, 3, 23));
  const b = stretch(periodicFbm(size, 4, 4, 37));
  const a = stretch(periodicFbm(size, 16, 4, 51).map((v) => 1 - Math.abs(v * 2 - 1)));
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = r[i] * 255; data[i * 4 + 1] = g[i] * 255; data[i * 4 + 2] = b[i] * 255; data[i * 4 + 3] = a[i] * 255;
  }
  noiseTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.anisotropy = 4;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

// Soft round sprite for particles
let dotTex = null;
export function getDotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}
