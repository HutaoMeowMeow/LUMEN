// Fully procedural sound: every sound is synthesised with WebAudio at runtime (no audio files, no licensing).
// Buses: ambience (surf, wind, underwater rumble, deep drone) and effects (bubbles, splashes, breath, chimes, whale song),
// both through a shared lowpass that closes when the head goes underwater, plus a music bus of slow generative pads.

const PENTA = [0, 2, 4, 7, 9];

function noiseBuffer(ctx, seconds, brown = false) {
  const n = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return b;
}

function impulse(ctx, seconds, decay) {
  const n = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return b;
}

export class Audio {
  constructor(settings) {
    this.ok = false; // becomes true once a user gesture lets the context start
    this.settings = settings;
  }

  // browsers refuse to start audio before a user gesture, so the graph is built on the first resume()
  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.filter.connect(this.master);
    this.amb = ctx.createGain(); this.amb.connect(this.filter);
    this.fx = ctx.createGain(); this.fx.connect(this.filter);
    this.music = ctx.createGain(); this.music.connect(this.master);
    this.verb = ctx.createConvolver();
    this.verb.buffer = impulse(ctx, 4, 2.5);
    this.verbOut = ctx.createGain(); this.verbOut.gain.value = 0.5;
    this.verb.connect(this.verbOut).connect(this.filter);
    this.musicVerb = ctx.createConvolver();
    this.musicVerb.buffer = impulse(ctx, 5, 2);
    this.musicVerb.connect(this.music);

    this.white = noiseBuffer(ctx, 3);
    this.brown = noiseBuffer(ctx, 4, true);
    const loop = (buf, type, f, q, dest) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
      const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(flt).connect(g).connect(dest); s.start();
      return { g, flt };
    };
    this.surf = loop(this.white, 'bandpass', 500, 0.5, this.amb);
    this.wind = loop(this.white, 'bandpass', 900, 0.8, this.amb);
    this.rumble = loop(this.brown, 'lowpass', 220, 0.7, this.amb);
    // deep drone: detuned low sines
    this.drone = ctx.createGain(); this.drone.gain.value = 0; this.drone.connect(this.amb);
    for (const f of [55, 55.6, 82.4]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(this.drone); o.start();
    }
    this.nextBubble = 2;
    this.nextMusic = 6;
    this.nextSong = 10;
    this.nextBird = 3;
    this.nextBeep = 0;
    this.stepPhase = 0;
    this.t = 0;
    this.ok = true;
    this.applyVolumes();
  }

  resume() {
    if (!this.ctx) this._init();
    if (this.ok && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }
  suspend() { if (this.ok && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }

  applyVolumes() {
    if (!this.ok) return;
    const s = this.settings;
    this.master.gain.value = s.master;
    this.amb.gain.value = s.ambience;
    this.fx.gain.value = s.effects;
    this.music.gain.value = s.music * 0.6;
  }

  _env(node, t0, a, peak, d) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(peak, t0 + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  _noiseHit(f, q, peak, a, d, type = 'bandpass', dest = this.fx, sweep = 0) {
    const ctx = this.ctx, now = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.white;
    const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    if (sweep) flt.frequency.exponentialRampToValueAtTime(Math.max(40, f * sweep), now + a + d);
    const g = ctx.createGain();
    this._env(g, now, a, peak, d);
    s.connect(flt).connect(g).connect(dest);
    s.start(now, Math.random() * 2); s.stop(now + a + d + 0.05);
  }

  _tone(f, peak, a, d, type = 'sine', dest = this.fx, glide = 0, delay = 0) {
    const ctx = this.ctx, t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(f * glide, t0 + a + d);
    const g = ctx.createGain();
    this._env(g, t0, a, peak, d);
    o.connect(g).connect(dest);
    o.start(t0); o.stop(t0 + a + d + 0.05);
  }

  bubbles(n = 6, big = 1) {
    for (let i = 0; i < n; i++) {
      const f = (500 + Math.random() * 900) / big;
      this._tone(f, 0.05 + Math.random() * 0.05, 0.005, 0.06 + Math.random() * 0.05, 'sine', this.fx, 1.8, i * (0.03 + Math.random() * 0.06));
    }
  }

  play(name) {
    if (!this.ok || this.ctx.state !== 'running') return;
    switch (name) {
      case 'splash-in': this._noiseHit(1200, 0.6, 0.5, 0.01, 0.5, 'lowpass', this.fx, 0.2); this.bubbles(12, 1.4); break;
      case 'splash-out': this._noiseHit(1800, 0.7, 0.35, 0.01, 0.35, 'bandpass', this.fx, 0.5); break;
      case 'breath': this._noiseHit(1400, 1.2, 0.18, 0.12, 0.5, 'bandpass', this.fx, 0.6); break;
      case 'blackout': this._tone(70, 0.4, 0.05, 2.5, 'sine', this.fx, 0.5); break;
      case 'discover': [0, 4, 7, 12].forEach((s, i) => this._tone(523.25 * 2 ** (s / 12), 0.12, 0.01, 1.6, 'triangle', this.verb, 0, i * 0.12)); break;
      case 'click': this._tone(880, 0.05, 0.003, 0.06, 'square'); break;
      case 'flashlight': this._noiseHit(3000, 3, 0.08, 0.002, 0.04, 'bandpass'); break;
      case 'jump': this._noiseHit(400, 1, 0.12, 0.01, 0.12, 'lowpass'); break;
      default: break;
    }
  }

  _whaleSong(dist) {
    const ctx = this.ctx, now = ctx.currentTime;
    const vol = Math.min(0.5, 60 / Math.max(dist, 40)) * 0.35;
    const base = 90 + Math.random() * 80, dur = 2.5 + Math.random() * 3;
    const o = ctx.createOscillator(); o.type = 'sine';
    const vib = ctx.createOscillator(); vib.frequency.value = 4 + Math.random() * 2;
    const vg = ctx.createGain(); vg.gain.value = base * 0.02; vib.connect(vg).connect(o.frequency);
    o.frequency.setValueAtTime(base, now);
    o.frequency.linearRampToValueAtTime(base * (1.3 + Math.random() * 0.8), now + dur * 0.45);
    o.frequency.linearRampToValueAtTime(base * (0.7 + Math.random() * 0.3), now + dur);
    const h = ctx.createOscillator(); h.type = 'triangle'; h.frequency.value = base * 2.01;
    const hg = ctx.createGain(); hg.gain.value = 0.25;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); h.connect(hg).connect(g);
    g.connect(this.verb); g.connect(this.fx);
    for (const x of [o, vib, h]) { x.start(now); x.stop(now + dur + 0.1); }
  }

  _bird() {
    const f = 1800 + Math.random() * 1200;
    for (let i = 0; i < 2 + (Math.random() * 3 | 0); i++) this._tone(f, 0.03, 0.01, 0.12, 'sine', this.amb, 0.6 + Math.random() * 0.3, i * 0.16);
  }

  _musicPhrase(deep) {
    const ctx = this.ctx, now = ctx.currentTime;
    const root = deep ? 110 : 146.83; // A2 or D3
    const notes = [0, 2 + (Math.random() * 2 | 0), 4].map((i) => PENTA[i]);
    notes.forEach((st, i) => {
      const f = root * 2 ** (st / 12) * (i === 2 ? 2 : 1);
      const o = ctx.createOscillator(); o.type = i === 0 ? 'sine' : 'triangle'; o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      const g = ctx.createGain();
      const dur = 9 + Math.random() * 4, t0 = now + i * 1.2;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + 3);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.musicVerb); g.connect(this.music);
      o.start(t0); o.stop(t0 + dur + 0.1);
    });
    const bell = root * 4 * 2 ** (PENTA[Math.random() * 5 | 0] / 12);
    this._tone(bell, 0.03, 0.01, 4, 'sine', this.musicVerb, 0, 2 + Math.random() * 3);
  }

  // s: { under, depth, height, speed, walking, stepping, wading, bob, o2Frac, whaleDist, nearIsland, cave, exhale() }
  update(dt, s) {
    if (!this.ok || this.ctx.state !== 'running') return;
    this.t += dt;
    const now = this.ctx.currentTime;
    const tgt = (param, v) => param.setTargetAtTime(v, now, 0.15);
    tgt(this.filter.frequency, s.under ? Math.max(260, 520 - Math.min(s.depth, 200) * 1.2) : 20000);
    const surfNear = Math.max(0, 1 - Math.abs(s.height) / 30);
    tgt(this.surf.g.gain, s.under ? 0.05 * Math.max(0, 1 - s.depth / 15) : 0.16 * (0.6 + 0.4 * Math.sin(this.t * 0.35)) * (0.4 + 0.6 * surfNear));
    this.surf.flt.frequency.setTargetAtTime(400 + 300 * Math.sin(this.t * 0.21), now, 0.5);
    tgt(this.wind.g.gain, s.under ? 0 : 0.03 + Math.min(Math.max(s.height, 0) / 80, 1) * 0.08 + s.speed * 0.004);
    tgt(this.rumble.g.gain, s.under ? 0.35 + Math.min(s.depth / 150, 1) * 0.3 + s.speed * 0.02 : 0);
    tgt(this.drone.gain, s.under ? Math.min(Math.max(s.depth - 30, 0) / 150, 1) * 0.05 + s.cave * 0.04 : 0);
    this.verbOut.gain.value = s.under ? 0.6 : 0.25;

    if (s.under) {
      this.nextBubble -= dt;
      if (this.nextBubble <= 0) { this.bubbles(4 + (Math.random() * 6 | 0)); this.nextBubble = 3.5 + Math.random() * 2.5; s.exhale?.(); }
      if (s.o2Frac < 0.25) {
        this.nextBeep -= dt;
        if (this.nextBeep <= 0) { this._tone(660, 0.08, 0.005, 0.15, 'square'); this.nextBeep = s.o2Frac < 0.1 ? 0.5 : 1.2; }
      }
    } else if (s.nearIsland) {
      this.nextBird -= dt;
      if (this.nextBird <= 0) { this._bird(); this.nextBird = 3 + Math.random() * 7; }
    }
    if (s.walking && s.stepping) {
      const p = Math.floor(s.bob / Math.PI);
      if (p !== this.stepPhase) { this.stepPhase = p; this._noiseHit(s.wading ? 700 : 260, 0.8, s.wading ? 0.12 : 0.1, 0.005, 0.12, s.wading ? 'bandpass' : 'lowpass'); }
    }
    if (s.whaleDist < 450) {
      this.nextSong -= dt;
      if (this.nextSong <= 0) { this._whaleSong(s.whaleDist); this.nextSong = 4 + Math.random() * 9; }
    }
    this.nextMusic -= dt;
    if (this.nextMusic <= 0) { this._musicPhrase(s.under && s.depth > 50); this.nextMusic = 16 + Math.random() * 14; }
  }
}
