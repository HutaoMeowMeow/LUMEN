// Settings and save game, persisted in localStorage (both survive a failing/blocked storage gracefully).

export const PRESETS = {
  low: { pixelRatio: 0.75, resMin: 0.6, shadows: 0, bloom: false, viewUnder: 110, shafts: 0, label: 'Low' },
  medium: { pixelRatio: 1, resMin: 0.6, shadows: 1024, bloom: true, viewUnder: 150, shafts: 24, label: 'Medium' },
  high: { pixelRatio: 1.25, resMin: 0.7, shadows: 2048, bloom: true, viewUnder: 190, shafts: 40, label: 'High' },
  ultra: { pixelRatio: 2, resMin: 0.8, shadows: 4096, bloom: true, viewUnder: 240, shafts: 60, label: 'Ultra' },
};

function guessQuality() {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile || (navigator.hardwareConcurrency || 4) <= 4) return 'low';
  return 'medium';
}

const DEFAULTS = { quality: null, sensitivity: 1, invertY: false, fov: 75, master: 0.8, ambience: 0.8, effects: 0.9, music: 0.5, showFps: false };

function load(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function store(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; }
}

export class Settings {
  constructor() {
    const s = load('lumen.settings') || {};
    Object.assign(this, DEFAULTS, s);
    if (!PRESETS[this.quality]) this.quality = guessQuality();
  }
  get preset() { return PRESETS[this.quality]; }
  save() { store('lumen.settings', Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, this[k]]))); }
}

export const SaveGame = {
  load() {
    const s = load('lumen.save');
    return s && s.v === 1 && Array.isArray(s.pos) && s.pos.every(Number.isFinite) ? s : null;
  },
  save(data) { return store('lumen.save', { v: 1, ...data }); },
  clear() { try { localStorage.removeItem('lumen.save'); } catch { /* storage unavailable */ } },
};
