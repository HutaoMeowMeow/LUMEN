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

// ---------- leaf atlas ----------
// 3 x 2 tiles of 512 px, drawn once with canvas 2D: alpha-cut leaf sprays that foliage cards map, so a card reads as
// a twig of overlapping shaped leaves (veins, midribs, per-leaf tone) instead of one flat polygon. RGB is near-white
// detail that multiplies the vertex/instance green; the first texels are opaque white so wood and other non-card
// parts (uv -1, clamped onto them, zero derivatives so always mip 0) sample plain white.
// 0 broadleaf spray, 1 broad drooping spray, 2 small-leaf spray (shrubs), 3 palm leaflet pair, 4 fern pinna, 5 big single leaf
const LT = 512, LCOLS = 3, LROWS = 2;
// card coordinates -> atlas uv: l along the card from base (0) to tip (1), w across it (0..1)
export function leafUV(tile, l, w) {
  const c = tile % LCOLS, r = Math.floor(tile / LCOLS);
  return [(c + 0.015 + 0.97 * w) / LCOLS, (r + 0.015 + 0.97 * l) / LROWS];
}

let leafTex = null;
export function getLeafTexture() {
  if (leafTex) return leafTex;
  const W = LT * LCOLS, H = LT * LROWS;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const rnd = mulberry32(777);
  const rgb = (r, gg, b, k = 1) => `rgb(${Math.min(255, r * k) | 0},${Math.min(255, gg * k) | 0},${Math.min(255, b * k) | 0})`;
  // one blade from the current origin along +y. wr: width/length, wide: where it is widest, tip: tip bluntness,
  // lobes: pinnule count per side (fern), tears: margin splits (banana)
  const blade = (len, wr, wide = 0.4, tip = 0.15, lobes = 0, tears = 0) => {
    const w = len * wr, tone = 0.72 + rnd() * 0.28, hue = rnd();
    const base = hue < 0.2 ? [245, 240, 170] : hue < 0.45 ? [195, 228, 215] : [222, 238, 200];
    const edge = (s) => {
      g.moveTo(0, 0);
      if (lobes) {
        for (let i = 1; i <= lobes; i++) {
          const t0 = (i - 1) / lobes, t1 = i / lobes, ww = w * Math.sin(Math.PI * Math.min(1, (t0 + t1) / 2 + 0.08)) * (1 - 0.6 * t1);
          g.quadraticCurveTo(s * ww * 1.25, len * (t0 + 0.25 / lobes), s * ww * 0.15, len * t1);
        }
        g.lineTo(0, len);
      } else {
        g.bezierCurveTo(s * w * 0.9, len * wide * 0.5, s * w * 1.05, len * (wide + 0.15), s * w * tip * 2, len * 0.92);
        g.quadraticCurveTo(s * w * tip * 0.5, len * 0.98, 0, len);
      }
    };
    g.beginPath(); edge(1); edge(-1);
    const gr = g.createLinearGradient(-w, 0, w, 0);
    gr.addColorStop(0, rgb(...base, tone * 0.86)); gr.addColorStop(0.5, rgb(...base, tone)); gr.addColorStop(1, rgb(...base, tone * 0.8));
    g.fillStyle = gr; g.fill();
    g.strokeStyle = rgb(...base, tone * 0.62); g.lineWidth = 1.6; g.stroke();
    g.save(); g.clip();
    // darker base, lighter tip flush, lateral veins
    const lg = g.createLinearGradient(0, 0, 0, len);
    lg.addColorStop(0, 'rgba(40,50,20,0.25)'); lg.addColorStop(0.6, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(255,255,200,0.18)');
    g.fillStyle = lg; g.fillRect(-w * 1.3, 0, w * 2.6, len);
    g.strokeStyle = 'rgba(255,255,225,0.28)'; g.lineWidth = Math.max(1, len / 140);
    for (let i = 1; i < 9; i++) for (const s of [-1, 1]) {
      const y = len * (i / 9.5);
      g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(s * w * 0.5, y + len * 0.05, s * w * 1.1, y + len * 0.14); g.stroke();
    }
    if (tears) {
      g.globalCompositeOperation = 'destination-out'; g.lineWidth = 2.2;
      for (let i = 0; i < tears; i++) {
        const y = len * (0.2 + rnd() * 0.7), s = rnd() < 0.5 ? -1 : 1;
        g.beginPath(); g.moveTo(s * w * 1.2, y + len * 0.12); g.lineTo(s * w * (0.1 + rnd() * 0.3), y); g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
    }
    g.restore();
    g.strokeStyle = 'rgba(255,255,215,0.55)'; g.lineWidth = Math.max(1.2, len / 70);
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(w * 0.04, len * 0.5, 0, len * 0.97); g.stroke();
  };
  const twig = (pts, w0, w1) => {
    g.strokeStyle = rgb(150, 128, 96); g.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) {
      g.lineWidth = w0 + (w1 - w0) * (i / (pts.length - 1));
      g.beginPath(); g.moveTo(...pts[i - 1]); g.lineTo(...pts[i]); g.stroke();
    }
  };
  // n leaves alternating along a twig polyline at angle ang (radians) from it, plus a terminal leaf
  const spray = (pts, n, ang, len0, len1, wr, opt = {}) => {
    const from = opt.from ?? 0.1;
    const at = (t) => {
      const f = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), k = f - i, a = pts[i], b = pts[i + 1];
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, Math.atan2(b[0] - a[0], b[1] - a[1])];
    };
    for (let i = 0; i < n; i++) {
      const [x, y, a] = at(from + (1 - from) * (i / Math.max(1, n - 1)) * 0.94), s = i % 2 ? 1 : -1;
      g.save(); g.translate(x, y); g.rotate(-(a + s * ang * (0.75 + rnd() * 0.5)));
      blade(len0 + (len1 - len0) * rnd(), wr * (0.85 + rnd() * 0.3), opt.wide ?? 0.4, opt.tip ?? 0.15);
      g.restore();
    }
    const [x, y, a] = at(1);
    g.save(); g.translate(x, y); g.rotate(-a); blade(len1 * 0.95, wr, opt.wide ?? 0.4, opt.tip ?? 0.15); g.restore();
  };
  const tile = (i, fn) => {
    g.save(); g.translate((i % LCOLS) * LT + LT / 2, Math.floor(i / LCOLS) * LT + 8);
    g.beginPath(); g.rect(-LT / 2 + 6, -2, LT - 12, LT - 12); g.clip();
    fn(); g.restore();
  };
  const curve = (bx, len, n) => Array.from({ length: n + 1 }, (_, i) => [bx * Math.sin((i / n) * 2.2), (i / n) * len]);
  tile(0, () => { const p = curve(18, 300, 6); twig(p, 7, 2.5); spray(p, 7, 0.9, 120, 175, 0.42); });
  tile(1, () => {
    const p = curve(-14, 240, 5); twig(p, 8, 3);
    const q = [p[2], [p[2][0] + 70, p[2][1] + 90], [p[2][0] + 110, p[2][1] + 200]]; twig(q, 4, 2);
    spray(p, 5, 1.15, 150, 205, 0.36, { wide: 0.5, tip: 0.1 }); spray(q, 3, 1.0, 120, 160, 0.38, { from: 0.3 });
  });
  tile(2, () => {
    const p = curve(10, 430, 8); twig(p, 5, 1.5);
    for (const [t, s] of [[0.25, 1], [0.45, -1], [0.62, 1]]) {
      const b = p[Math.round(t * 8)], q = [b, [b[0] + s * 70, b[1] + 70], [b[0] + s * 120, b[1] + 150]];
      twig(q, 3, 1.2); spray(q, 7, 0.8, 42, 70, 0.5, { wide: 0.45 });
    }
    spray(p, 16, 0.75, 48, 82, 0.5, { wide: 0.45 });
  });
  tile(3, () => { for (const [x, a] of [[-60, 0.1], [60, -0.1]]) { g.save(); g.translate(x, 0); g.rotate(a); blade(480, 0.2, 0.25, 0.05); g.restore(); } });
  tile(4, () => {
    twig([[0, 0], [0, 490]], 4, 1.5);
    for (let i = 0; i < 16; i++) for (const s of [-1, 1]) {
      g.save(); g.translate(0, 12 + i * 29); g.rotate(-s * 1.15); blade(210 * (1 - i / 18) + 30, 0.3, 0.35, 0.3, 4); g.restore();
    }
  });
  tile(5, () => blade(490, 0.42, 0.45, 0.12, 0, 6));
  const d = g.getImageData(0, 0, W, H).data;
  // transparent texels take the mean leaf colour so mip filtering does not bleed black fringes into leaf edges
  let mr = 0, mg = 0, mb = 0, mn = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { mr += d[i]; mg += d[i + 1]; mb += d[i + 2]; mn++; }
  mn = Math.max(1, mn);
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] < 8) { d[i] = mr / mn; d[i + 1] = mg / mn; d[i + 2] = mb / mn; d[i + 3] = 0; }
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) d.set([255, 255, 255, 255], (y * W + x) * 4);
  leafTex = new THREE.DataTexture(new Uint8Array(d.buffer), W, H, THREE.RGBAFormat);
  leafTex.colorSpace = THREE.SRGBColorSpace;
  leafTex.wrapS = leafTex.wrapT = THREE.ClampToEdgeWrapping;
  leafTex.magFilter = THREE.LinearFilter;
  leafTex.minFilter = THREE.LinearMipmapLinearFilter;
  leafTex.generateMipmaps = true;
  leafTex.anisotropy = 4;
  leafTex.needsUpdate = true;
  return leafTex;
}
