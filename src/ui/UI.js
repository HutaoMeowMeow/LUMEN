// DOM user interface: loading, menus, HUD, journal, chart and settings. Markup lives in index.html.
import { WORLD, ISLANDS, POIS } from '../world/layout.js';
import { INTRO, ENDING } from '../core/lore.js';

const $ = (id) => document.getElementById(id);
const PANELS = ['menu', 'intro', 'controls', 'pause', 'journal', 'map', 'settings', 'ending', 'error'];
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export class UI {
  constructor(game) {
    this.game = game;
    this.stack = [];
    this.panel = null;
    this.tab = 'place';
    this.sel = null;
    this.seen = new Set(); // journal keys already opened
    $('intro-text').textContent = INTRO;
    $('ending-text').textContent = ENDING;
    this._compass();
    this._bind();
  }

  // ---- screens -------------------------------------------------------------------------
  setLoading(p, label) {
    $('load-fill').style.width = `${Math.round(p * 100)}%`;
    if (label) $('load-label').textContent = label;
  }
  hideLoading() { $('loading').classList.remove('show'); }

  // open a panel; push = remember the current one for Back
  open(id, push = true) {
    if (push && this.panel) this.stack.push(this.panel);
    for (const p of PANELS) $(p).classList.toggle('show', p === id);
    this.panel = id;
    if (id === 'journal') this._renderJournal();
    if (id === 'map') this._renderMap();
    if (id === 'settings') this._fillSettings();
    if (id === 'pause') this._pauseStats();
    if (id === 'menu') $('btn-continue').hidden = !this.game.hasSave();
    this.game.audio?.play('click');
    const first = $(id).querySelector('button.primary, button');
    first?.focus({ preventScroll: true });
  }
  back() {
    const prev = this.stack.pop();
    if (prev) this.open(prev, false);
    else this.closeAll();
  }
  closeAll() {
    for (const p of PANELS) $(p).classList.remove('show');
    this.panel = null;
    this.stack = [];
  }
  showHud(on) { $('hud').classList.toggle('show', on); }
  error(msg) { this.hideLoading(); this.open('error'); $('error-text').textContent = msg; }

  _bind() {
    const g = this.game, on = (id, fn) => $(id).addEventListener('click', fn);
    on('btn-new', () => this.open('intro'));
    on('btn-begin', () => g.newGame());
    on('btn-continue', () => g.continueGame());
    on('btn-settings', () => this.open('settings'));
    on('btn-controls', () => this.open('controls'));
    on('btn-resume', () => g.resume());
    on('btn-journal', () => this.open('journal'));
    on('btn-map', () => this.open('map'));
    on('btn-psettings', () => this.open('settings'));
    on('btn-quit', () => g.quitToMenu());
    on('btn-ending', () => g.resume());
    on('btn-reload', () => { g.saveNow(); location.reload(); });
    document.querySelectorAll('.panel .back').forEach((b) => b.addEventListener('click', () => {
      // backing out of the last panel while playing resumes the dive
      if (!this.stack.length && g.state === 'paused') g.resume(); else this.back();
    }));

    const form = $('settings-form'), S = g.settings;
    form.addEventListener('input', (e) => {
      const el = e.target, k = el.name;
      if (!(k in S)) return;
      S[k] = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : Number(el.value);
      $('quality-note').hidden = S.quality === g.quality;
      S.save();
      g.applySettings();
    });
  }

  _fillSettings() {
    const form = $('settings-form'), S = this.game.settings;
    for (const el of form.elements) {
      if (!el.name || !(el.name in S)) continue;
      if (el.type === 'checkbox') el.checked = !!S[el.name]; else el.value = S[el.name];
    }
    $('quality-note').hidden = S.quality === this.game.quality;
  }

  _pauseStats() {
    const d = this.game.discoveries, t = Math.floor(this.game.playTime / 60);
    $('pause-stats').textContent = `${d.count} of ${d.total} journal entries · ${t} min underway`;
  }

  // ---- HUD -----------------------------------------------------------------------------
  _compass() {
    const strip = $('compass-strip');
    this.compassPx = 2.2; // px per degree
    let html = '';
    for (let deg = -360; deg <= 720; deg += 15) {
      const d = ((deg % 360) + 360) % 360;
      const label = d % 45 === 0 ? DIRS[d / 45] : '·';
      html += `<span class="${d % 90 === 0 ? 'c' : ''}" style="left:${(deg + 360) * this.compassPx}px">${label}</span>`;
    }
    strip.innerHTML = html;
  }

  hud(s) {
    // heading: yaw 0 looks toward -z (north); turning left increases yaw
    const heading = (((-s.yaw * 180) / Math.PI) % 360 + 360) % 360;
    const w = $('compass').clientWidth;
    $('compass-strip').style.transform = `translateX(${w / 2 - (heading + 720) * this.compassPx}px)`;
    if (s.under) {
      $('depth-val').textContent = Math.round(s.depth);
      $('depth-unit').textContent = 'm';
      $('depth-label').textContent = s.cave > 0.3 ? 'Cave' : s.depth > 120 ? 'Abyss' : s.depth > 40 ? 'Twilight zone' : 'Depth';
    } else {
      $('depth-val').textContent = s.walking ? Math.max(0, Math.round(s.altitude)) : '0';
      $('depth-unit').textContent = 'm';
      $('depth-label').textContent = s.walking ? 'Altitude' : 'Surface';
    }
    const f = Math.max(0, s.o2 / s.maxO2);
    $('o2-fill').style.width = `${f * 100}%`;
    $('o2-val').textContent = `${Math.ceil(s.o2)}s`;
    $('o2').classList.toggle('low', f < 0.25 && s.under);
    $('lamp').classList.toggle('on', s.flashlight);
    const pr = $('prompt');
    pr.classList.toggle('show', !!s.prompt);
    if (s.prompt && pr.dataset.t !== s.prompt) { pr.innerHTML = s.prompt; pr.dataset.t = s.prompt; }
    $('bounds').classList.toggle('show', !!s.outOfBounds);
    $('fps').textContent = s.fps ? `${s.fps} fps` + (s.res < 1 ? ` · ${Math.round(s.res * 100)}% res` : '') : '';
  }

  hint(text, seconds = 6) {
    const h = $('hint');
    h.innerHTML = text;
    h.style.opacity = 1;
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => { h.style.opacity = 0; }, seconds * 1000);
  }

  toast(kind, title) {
    const el = document.createElement('div');
    el.className = 'toast';
    const label = { place: 'Journal · Place', species: 'Journal · Species', region: 'Journal · Region' }[kind] || 'Journal';
    el.innerHTML = `<b>${label}</b>${escapeHtml(title)}<div class="muted">Press <kbd>J</kbd> to read</div>`;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 6200);
  }

  // ---- journal -------------------------------------------------------------------------
  _renderJournal(selectKey) {
    const d = this.game.discoveries, secs = d.journal();
    $('journal-count').textContent = `${d.count} / ${d.total} discovered`;
    if (selectKey) { this.tab = selectKey.split(':')[0]; this.sel = selectKey; }
    const tabs = $('journal-tabs');
    tabs.innerHTML = '';
    const names = { place: 'Places', species: 'Creatures', region: 'Regions' };
    for (const s of secs) {
      const b = document.createElement('button');
      const n = s.items.filter((i) => i.found).length;
      b.textContent = `${names[s.kind]} ${n}/${s.items.length}`;
      b.className = s.kind === this.tab ? 'on' : '';
      b.onclick = () => { this.tab = s.kind; this.sel = null; this._renderJournal(); };
      tabs.appendChild(b);
    }
    const sec = secs.find((s) => s.kind === this.tab) || secs[0];
    const list = $('journal-list');
    list.innerHTML = '';
    if (!this.sel || !sec.items.some((i) => i.key === this.sel && i.found)) this.sel = sec.items.find((i) => i.found)?.key ?? null;
    for (const it of sec.items) {
      const li = document.createElement('li');
      li.textContent = it.found ? it.title : '— undiscovered —';
      li.className = (it.found ? '' : 'locked') + (it.key === this.sel ? ' sel' : '') + (it.found && !this.seen.has(it.key) ? ' new' : '');
      if (it.found) li.onclick = () => { this.sel = it.key; this._renderJournal(); };
      list.appendChild(li);
    }
    const cur = sec.items.find((i) => i.key === this.sel);
    const art = $('journal-entry');
    if (cur) {
      this.seen.add(cur.key);
      art.innerHTML = `<h3>${escapeHtml(cur.title)}</h3><p>${escapeHtml(cur.text)}</p>`;
    } else {
      art.innerHTML = '<p class="muted">Nothing here yet. Explore to fill this section.</p>';
    }
  }
  openEntry(key) { if (this.panel !== 'journal') this.open('journal'); this._renderJournal(key); }

  // ---- chart ---------------------------------------------------------------------------
  _renderMap() {
    const cv = $('map-canvas'), ctx = cv.getContext('2d'), N = cv.width, g = this.game;
    if (!this.mapBase) {
      // shaded relief, generated once from the heightmap
      const img = ctx.createImageData(N, N), W = g.world;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const wx = (x / N) * WORLD.size - WORLD.half, wz = (y / N) * WORLD.size - WORLD.half;
        const h = W.heightAt(wx, wz), hx = W.heightAt(wx + 6, wz) - h;
        let r, gg, b;
        if (h > 1.5) { const t = Math.min(h / 90, 1); r = 70 + 90 * t; gg = 110 + 40 * t; b = 60 + 60 * t; }
        else if (h > -0.2) { r = 214; gg = 200; b = 150; }
        else { const t = Math.min(-h / 260, 1); r = 40 - 34 * t; gg = 150 - 128 * t; b = 180 - 130 * t; }
        const sh = 1 + Math.max(-0.4, Math.min(0.4, -hx * 0.12));
        const o = (y * N + x) * 4;
        img.data[o] = r * sh; img.data[o + 1] = gg * sh; img.data[o + 2] = b * sh; img.data[o + 3] = 255;
        if (Math.hypot(wx, wz) > WORLD.boundary) { img.data[o] *= 0.5; img.data[o + 1] *= 0.5; img.data[o + 2] *= 0.5; }
      }
      this.mapBase = img;
    }
    ctx.putImageData(this.mapBase, 0, 0);
    const toPx = (x, z) => [((x + WORLD.half) / WORLD.size) * N, ((z + WORLD.half) / WORLD.size) * N];
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const I of ISLANDS) {
      const [px, py] = toPx(I.x, I.z);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(I.name, px + 1, py - I.r / WORLD.size * N - 5);
      ctx.fillStyle = '#f4f0e0'; ctx.fillText(I.name, px, py - I.r / WORLD.size * N - 6);
    }
    // discovered places
    for (const a of g.discoveries.anchors) {
      if (!g.discoveries.found.has('place:' + a.id)) continue;
      const [px, py] = toPx(a.p.x, a.p.z);
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd27a'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
    }
    // station beacon is always charted: it is where the story points you first
    const [sx, sy] = toPx(POIS.station.x, POIS.station.z);
    ctx.strokeStyle = '#6fe3ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#6fe3ff'; ctx.fillText('Meridian Station', sx, sy + 20);
    // player arrow
    const p = g.player.pos, [px, py] = toPx(p.x, p.z), yaw = g.player.yaw;
    ctx.save();
    ctx.translate(px, py); ctx.rotate(-yaw);
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath();
    ctx.fillStyle = '#ff6a5a'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
