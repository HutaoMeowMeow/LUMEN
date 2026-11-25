// Owns the renderer, world systems, game states (loading → menu → playing ⇄ paused) and the frame loop.
import * as THREE from 'three';
import { World } from '../world/World.js';
import { ISLANDS, SPAWN } from '../world/layout.js';
import { Sky } from '../world/Sky.js';
import { Ocean } from '../world/Ocean.js';
import { Terrain } from '../world/Terrain.js';
import { buildCaves } from '../world/CaveMeshes.js';
import { Colliders } from '../world/Colliders.js';
import { Structures } from '../world/Structures.js';
import { Vegetation } from '../world/Vegetation.js';
import { loadModels } from '../world/Models.js';
import { U, MAX_GLOWS } from '../fx/materials.js';
import { Caustics } from '../fx/Caustics.js';
import { LightShafts } from '../fx/LightShafts.js';
import { Particles } from '../fx/Particles.js';
import { PostFX } from '../fx/PostFX.js';
import { Creatures } from '../creatures/Creatures.js';
import { Input } from '../player/Input.js';
import { Player } from '../player/Player.js';
import { Audio } from '../audio/Audio.js';
import { Discoveries } from './Discoveries.js';
import { PLACES } from './lore.js';
import { Settings, SaveGame } from './Settings.js';
import { UI } from '../ui/UI.js';

const BASE_SHALLOW = U.uWaterShallow.value.clone(), BASE_DEEP = U.uWaterDeep.value.clone();
const TURQ_SHALLOW = new THREE.Color(0x26a6a2), TURQ_DEEP = new THREE.Color(0x0d4c5c); // sunlit lagoon tint near the surface
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const _f = new THREE.Vector3(), _v = new THREE.Vector3();

export class Game {
  constructor() {
    this.settings = new Settings();
    this.quality = this.settings.quality; // fixed for this page load; changes need a reload
    this.state = 'loading';
    this.inGame = false;
    this.time = 0;
    this.tod = 0.32;
    this.playTime = 0;
    this.fade = 1;
    this.fps = 0;
    this.res = { scale: 1, t0: 0, n: 0, up: 0, down: 0, wait: 4, raisedAt: -1e9 }; // dynamic resolution state
    this.audio = new Audio(this.settings);
    this.ui = new UI(this);
    // audio may only start after a user gesture
    const wake = () => this.audio.resume();
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
  }

  hasSave() { return !!SaveGame.load(); }

  async init() {
    const P = this.settings.preset, ui = this.ui;
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, P.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = P.shadows > 0;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    document.getElementById('app').appendChild(renderer.domElement);

    const scene = this.scene = new THREE.Scene();
    const camera = this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.1, 2600);

    ui.setLoading(0.02, 'Shaping the sea floor');
    const world = this.world = new World();
    await world.generate((f, label) => ui.setLoading(0.02 + f * 0.76, label));

    const step = async (p, label, fn) => { ui.setLoading(p, label); await nextFrame(); fn(); };
    await step(0.8, 'Raising the sky', () => {
      this.sky = new Sky(scene);
      this.ocean = new Ocean(scene, world, this.quality);
      this.sun = new THREE.DirectionalLight(0xffffff, 2);
      this.sun.castShadow = P.shadows > 0;
      if (P.shadows) {
        const s = this.sun.shadow;
        s.mapSize.set(P.shadows, P.shadows);
        Object.assign(s.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 500 });
        s.bias = -0.0004;
        s.normalBias = 0.06;
      }
      scene.add(this.sun, this.sun.target);
      this.hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1);
      scene.add(this.hemi);
    });
    await step(0.83, 'Laying the terrain', () => {
      this.terrain = new Terrain(scene, world, this.quality);
      this.caves = buildCaves(scene, world, this.terrain.uniforms);
    });
    await step(0.86, 'Sinking the wrecks', () => {
      this.colliders = new Colliders();
      this.structures = new Structures(scene, world, this.colliders);
    });
    ui.setLoading(0.875, 'Gathering shells and stones');
    await loadModels();
    await step(0.89, 'Growing reefs and forests', () => {
      this.vegetation = new Vegetation(scene, world, this.quality, this.colliders, this.structures.emitters);
    });
    await step(0.92, 'Waking the creatures', () => {
      this.creatures = new Creatures(scene, world, this.quality, this.vegetation);
      this.structures.emitters.push(this.creatures.spout);
      this.caustics = new Caustics(renderer);
      this.shafts = new LightShafts(scene, P.shafts);
      this.particles = new Particles(scene, this.quality, (x, z) => this.ocean.heightAt(x, z, this.time), (x, z) => world.heightAt(x, z));
      this.postfx = new PostFX(renderer, scene, camera, this.quality);
      this.input = new Input(renderer.domElement);
      this.player = new Player(world, this.ocean, camera, this.input);
      this.discoveries = new Discoveries(this.structures.anchors);
      this._bindInput();
      this.applySettings();
    });
    await step(0.95, 'Preparing the view', () => {
      this._menuCamera(0);
      this.terrain.prewarm(camera.position.x, camera.position.z);
      this.vegetation.prewarm(camera.position.x, camera.position.z);
      this.terrain.prewarm(SPAWN.x, SPAWN.z);
      this.vegetation.prewarm(SPAWN.x, SPAWN.z);
    });
    ui.setLoading(0.97, 'Compiling shaders');
    await nextFrame();
    this._frame(0.016); // set every uniform once before compiling
    try { await renderer.compileAsync(scene, camera); } catch { /* compiles lazily on first render instead */ }
    window.addEventListener('resize', () => this._resize());
    this.state = 'menu';
    ui.setLoading(1, 'Ready');
    ui.hideLoading();
    ui.open('menu', false);
    this.last = performance.now();
    renderer.setAnimationLoop(() => this._tick());
  }

  // ---- state changes -------------------------------------------------------------------
  newGame() {
    SaveGame.clear();
    this.discoveries = new Discoveries(this.structures.anchors);
    this._hookDiscoveries();
    const [sx, sy, sz] = this._spawnPoint();
    this.player.place(sx, sy, sz, SPAWN.yaw);
    Object.assign(this.player, { o2: this.player.maxO2, blackout: 0, flashlight: false });
    this.tod = 0.32;
    this.playTime = 0;
    this.endingShown = false;
    this._start();
    this.ui.hint('Click to capture the mouse · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · <kbd>Space</kbd> jump · <kbd>Shift</kbd> sprint · wade into the sea to swim and dive · <kbd>Esc</kbd> pause', 12);
  }

  // First dry, gentle spot clear of rocks and trunks on a spiral around the layout spawn
  _spawnPoint() {
    const W = this.world;
    for (let i = 0; i < 600; i++) {
      const a = i * 2.4, r = Math.sqrt(i) * 1.5;
      const x = SPAWN.x + Math.cos(a) * r, z = SPAWN.z + Math.sin(a) * r;
      const h = W.heightAt(x, z);
      if (h < 1 || Math.abs(W.heightAt(x + 1.5, z) - h) + Math.abs(W.heightAt(x, z + 1.5) - h) > 1) continue;
      if (W.sdf(x, h + 0.5, z) < 0.42 || W.sdf(x, h + 1.45, z) < 0.34) continue;
      return [x, h + 1.62, z];
    }
    return [SPAWN.x, Math.max(W.heightAt(SPAWN.x, SPAWN.z), 0.3) + 1.7, SPAWN.z];
  }

  continueGame() {
    const s = SaveGame.load();
    if (!s) return this.newGame();
    this.discoveries = new Discoveries(this.structures.anchors, Array.isArray(s.found) ? s.found.filter((k) => typeof k === 'string') : []);
    this._hookDiscoveries();
    this.player.place(s.pos[0], s.pos[1], s.pos[2], Number(s.yaw) || 0);
    this.player.pitch = Number(s.pitch) || 0;
    this.player.o2 = Math.min(this.player.maxO2, Math.max(10, Number(s.o2) || this.player.maxO2));
    this.player.flashlight = !!s.flashlight;
    this.tod = Number.isFinite(s.tod) ? s.tod : 0.32;
    this.playTime = Number(s.playTime) || 0;
    this.endingShown = this.discoveries.count >= this.discoveries.total;
    this._start();
    this.ui.hint('Welcome back. Click to capture the mouse.', 5);
  }

  _start() {
    this.inGame = true;
    this.fade = 1;
    this.discT = 0;
    this.saveT = 30;
    this.audio.resume();
    this.resume();
  }

  resume() {
    if (!this.inGame) return;
    this.state = 'playing';
    this.ui.closeAll();
    this.ui.showHud(true);
    this.input.enabled = true;
    this.input.lock();
  }

  pause(panel = 'pause') {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.pausedAt = performance.now();
    this.input.enabled = false;
    this.input.dragging = false;
    this.input.unlock();
    this.ui.closeAll();
    this.ui.open(panel, false);
    this.saveNow();
  }

  quitToMenu() {
    this.saveNow();
    this.inGame = false;
    this.state = 'menu';
    this.ui.showHud(false);
    this.ui.closeAll();
    this.ui.open('menu', false);
  }

  saveNow() {
    if (!this.inGame) return;
    const p = this.player;
    SaveGame.save({
      pos: [p.pos.x, p.pos.y, p.pos.z], yaw: p.yaw, pitch: p.pitch, o2: p.o2, flashlight: p.flashlight,
      tod: this.tod, playTime: this.playTime, found: [...this.discoveries.order],
    });
  }

  applySettings() {
    const S = this.settings;
    if (this.player) Object.assign(this.player, { sensitivity: S.sensitivity, invertY: S.invertY });
    if (this.camera && this.camera.fov !== S.fov) { this.camera.fov = S.fov; this.camera.updateProjectionMatrix(); }
    this.audio.applyVolumes();
  }

  _hookDiscoveries() {
    this.discoveries.onFound = (key, e) => {
      this.ui.toast(e.kind, e.title);
      this.audio.play('discover');
      this.saveNow();
    };
  }

  _bindInput() {
    const canvas = this.renderer.domElement;
    this.input.onLockChange = (locked) => { if (!locked && this.state === 'playing') this.pause(); };
    canvas.addEventListener('click', () => { if (this.state === 'playing' && !this.input.locked) this.input.lock(); });
    window.addEventListener('keydown', (e) => {
      if (this.state !== 'paused') return;
      // the Esc that released pointer lock can also arrive as a keydown: ignore it
      if (performance.now() - this.pausedAt < 300) return;
      const panel = this.ui.panel;
      if (e.code === 'Escape' || (e.code === 'KeyJ' && panel === 'journal') || (e.code === 'KeyM' && panel === 'map')) {
        e.preventDefault();
        if (panel === 'pause' || (e.code !== 'Escape') || !this.ui.stack.length) this.resume(); else this.ui.back();
      }
    });
    // Ctrl+W cannot be intercepted; ask before closing only if Ctrl is held mid-dive
    window.addEventListener('beforeunload', (e) => {
      this.saveNow();
      if (this.state === 'playing' && (this.input.down('ControlLeft') || this.input.down('ControlRight'))) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.saveNow(); if (this.state === 'playing') this.pause(); }
    });
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.settings.preset.pixelRatio) * this.res.scale;
    this.renderer.setPixelRatio(pr);
    this.postfx.composer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.postfx.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- frame loop ----------------------------------------------------------------------
  _tick() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.fps = this.fps ? this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05 : 60;
    if (this.state === 'playing') this._adaptRes(now);
    this._frame(dt);
    this.postfx.render(dt);
    this.input.endFrame();
  }

  // Dynamic resolution: most scenes are fill-bound on integrated GPUs (half the pixels ~ half the GPU time),
  // so render fewer pixels while frames run long and climb back once frames hold the display rate again.
  _adaptRes(now) {
    const R = this.res;
    if (now - R.t0 > 2000) { R.t0 = now; R.n = 0; return; } // first frame, or resumed after a pause
    R.n++;
    if (now - R.t0 < 1000) return;
    const ms = (now - R.t0) / R.n;
    R.t0 = now; R.n = 0;
    if (ms > 21) { R.up = 0; if (++R.down >= 2 && R.scale > this._resMin()) this._setRes(R.scale - 0.1, now); }
    else if (ms < 17.8) { R.down = 0; if (++R.up >= R.wait && R.scale < 1) { R.raisedAt = now; this._setRes(R.scale + 0.1, now); } }
    else R.up = R.down = 0;
  }

  _setRes(scale, now) {
    const R = this.res;
    if (scale < R.scale && now - R.raisedAt < 6000) R.wait = Math.min(R.wait * 2, 64); // the last step up was too much: wait longer next time
    R.scale = Math.round(Math.min(1, Math.max(this._resMin(), scale)) * 10) / 10;
    R.up = R.down = 0;
    this._resize();
  }

  // High/Ultra keep most of their sharpness: thin foliage aliases badly once the frame is upscaled from 60%
  _resMin() { return this.settings.preset.resMin ?? 0.6; }

  _menuCamera(time) {
    const I = ISLANDS.find((i) => i.id === 'haven') || ISLANDS[0];
    const a = time * 0.025 + 0.6, r = I.r + 110;
    this.camera.position.set(I.x + Math.cos(a) * r, 7 + Math.sin(time * 0.2) * 1.5, I.z + Math.sin(a) * r);
    this.camera.lookAt(I.x, 10, I.z);
  }

  _frame(dt) {
    const playing = this.state === 'playing', P = this.settings.preset;
    const { camera, player, sky, ocean, world } = this;
    this.time += dt;
    const time = this.time;
    U.uTime.value = time;
    if (playing) { this.tod = (this.tod + dt / 1200) % 1; this.playTime += dt; }
    else if (this.state === 'menu') this.tod = (this.tod + dt / 600) % 1;

    if (playing) player.update(dt, time);
    else if (!this.inGame) this._menuCamera(time);
    const cp = camera.position;

    // shared lighting / fog state
    sky.update(this.tod, time, camera);
    const surf = ocean.heightAt(cp.x, cp.z, time);
    const under = cp.y < surf;
    const depth = Math.max(0, surf - cp.y);
    const cave = under ? world.enclosure(cp.x, cp.y, cp.z) : 0;
    const day = sky.day;
    U.uCamUnder.value = under ? 1 : 0;
    U.uDay.value = day;
    U.uSunDirW.value.copy(sky.sunDir);
    U.uAirFogColor.value.copy(sky.horizon);
    U.uSunFogColor.value.copy(sky.sunColor).multiplyScalar(0.4 + 0.6 * day);
    const k = Math.max(0.04, day * 0.95 + 0.05) * Math.exp(-depth * 0.012) * (1 - cave * 0.8);
    const turq = (1 - THREE.MathUtils.smoothstep(depth, 3, 30)) * (1 - cave) * day; // shallow turquoise -> open blue below ~30 m
    U.uWaterShallow.value.copy(BASE_SHALLOW).lerp(TURQ_SHALLOW, 0.6 * turq).multiplyScalar(Math.max(k, 0.03));
    U.uWaterDeep.value.copy(BASE_DEEP).lerp(TURQ_DEEP, 0.45 * turq).multiplyScalar(Math.max(k * 1.3, 0.05));
    U.uCaveDark.value = cave;
    U.uWaterFogDensity.value = 0.017 + 0.01 * THREE.MathUtils.smoothstep(depth, 2, 70); // clear shallows, murkier depths
    U.uCausticStrength.value = day;
    U.uFlash.value = this.inGame && player.flashlight ? 1 : 0;
    U.uFlashDir.value.copy(player.forward(_f));
    if (!this.inGame) U.uFlashDir.value.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this._glows(time, day);

    const L = sky.lightDir;
    _v.set(Math.round(cp.x / 4) * 4, Math.round(cp.y / 4) * 4, Math.round(cp.z / 4) * 4); // snapped to curb shadow shimmer
    this.sun.target.position.copy(_v);
    this.sun.position.copy(_v).addScaledVector(L, 200);
    this.sun.color.copy(sky.sunColor);
    this.sun.intensity = sky.sunIntensity * (under ? 1 : sky.moonLift); // night boosts stay above water: underwater brightness unchanged
    this.hemi.color.copy(sky.skyAmbient);
    if (!under) this.hemi.color.add(sky.nightFill);
    this.hemi.groundColor.copy(sky.groundAmbient);
    this.hemi.intensity = 0.75;

    // world systems
    ocean.update(time, camera, sky);
    this.terrain.update(camera, P.viewUnder);
    this.vegetation.update(camera, P.viewUnder, 1);
    this.caustics.update(time);
    this.shafts.update(camera, sky, cave);
    this.structures.update(time, day);
    this.creatures.update(dt, time, this.inGame ? player : { pos: cp }, day);
    this.particles.update(dt, camera, this.structures.emitters);

    // screen pass
    const u = this.postfx.u;
    this.fade = Math.max(0, this.fade - dt * 0.8);
    u.uUnder.value = under ? 1 : 0;
    u.uTime.value = time;
    u.uLowO2.value = this.inGame && under ? clamp01(1 - player.o2 / (player.maxO2 * 0.25)) : 0;
    u.uFade.value = Math.max(this.inGame ? player.blackout : 0, this.fade);
    u.uSurface.value = clamp01(1 - Math.abs(cp.y - surf) / 0.35);

    this._audio(dt, under, depth, cave);
    if (playing) this._play(dt, under, depth, cave);
  }

  // nearest glow lights go into the shared shader slots
  _glows(time, day) {
    const cp = this.camera.position, L = this.structures.lights;
    const near = [];
    for (const l of L) {
      const d = Math.hypot(l.x - cp.x, l.y - cp.y, l.z - cp.z) - l.r;
      if (d < 120) near.push([d, l]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < MAX_GLOWS; i++) {
      const e = near[i];
      if (!e) { U.uGlowPos.value[i].set(0, -9999, 0, 0); U.uGlowCol.value[i].set(0, 0, 0); continue; }
      const l = e[1], kk = this.structures.lightLevel(l, time, day);
      U.uGlowPos.value[i].set(l.x, l.y, l.z, l.r);
      U.uGlowCol.value[i].set(l.color.r * kk, l.color.g * kk, l.color.b * kk);
    }
  }

  _audio(dt, under, depth, cave) {
    if (!this.audio.ok) return;
    const p = this.player, cp = this.camera.position, walking = this.inGame && p.mode === 'walk';
    let nearIsland = false;
    for (const I of ISLANDS) if (Math.hypot(cp.x - I.x, cp.z - I.z) < I.r + 90) { nearIsland = true; break; }
    this.audio.update(dt, {
      under, depth, cave, nearIsland,
      height: cp.y,
      speed: this.inGame ? p.speed : 0,
      walking, stepping: walking && p.grounded && p.speed > 0.6, wading: walking && p.pos.y - 1.6 < p.surface - 0.1, bob: p.bob,
      o2Frac: this.inGame ? p.o2 / p.maxO2 : 1,
      whaleDist: this.creatures.whale.p.distanceTo(cp),
      exhale: () => { if (this.inGame && under) this._exhale(); },
    });
  }

  _exhale() {
    const cp = this.camera.position, f = this.player.forward(_f);
    this.particles.bubble(cp.x + f.x * 0.35, cp.y - 0.15, cp.z + f.z * 0.35, 7, 0.15, 0.9);
  }

  _play(dt, under, depth, cave) {
    const p = this.player, I = this.input, cp = this.camera.position, ui = this.ui;
    // player events → sound and particles
    for (const ev of p.events) {
      if (ev === 'splash-in') { this.audio.play('splash-in'); this.particles.bubble(cp.x, cp.y - 0.4, cp.z, 30, 1.2, 1.3); }
      else if (ev === 'splash-out') this.audio.play('splash-out');
      else if (ev === 'breath') {
        if (time() - (this.lastBreath || 0) > 4) { this.audio.play('breath'); this.lastBreath = time(); }
      } else if (ev === 'blackout') { this.audio.play('blackout'); ui.hint('You blacked out, and came to where you last had air.', 6); }
    }
    p.events.length = 0;
    if (!this.audio.ok || this.audio.ctx.state !== 'running') {
      // keep breathing bubbles visible even without sound
      this.exhaleT = (this.exhaleT ?? 4) - dt;
      if (under && this.exhaleT <= 0) { this._exhale(); this.exhaleT = 4 + Math.random() * 2; }
    }
    if (I.pressed('KeyF')) this.audio.play('flashlight');
    if (p.mode === 'walk' && I.pressed('Space')) this.audio.play('jump');

    // examine
    const tgt = this.discoveries.target(cp, p.forward(_f));
    let prompt = null;
    if (tgt) {
      const key = 'place:' + tgt.id, title = PLACES[tgt.id].title;
      prompt = `<kbd>E</kbd> ${this.discoveries.found.has(key) ? 'Read' : 'Examine'}: ${title}`;
      if (I.pressed('KeyE')) {
        this.discoveries.interact(tgt);
        this.pause('journal');
        ui.openEntry(key);
        return;
      }
    }
    this.discT -= dt;
    if (this.discT <= 0) { this.discT = 0.25; this.discoveries.update(p, this.creatures, this.world); }
    this.saveT -= dt;
    if (this.saveT <= 0) { this.saveT = 30; this.saveNow(); }

    ui.hud({
      yaw: p.yaw, under, depth, cave, walking: p.mode === 'walk', altitude: p.pos.y - 1.6,
      o2: p.o2, maxO2: p.maxO2, flashlight: p.flashlight, prompt, outOfBounds: p.outOfBounds,
      fps: this.settings.showFps ? Math.round(this.fps) : 0,
      res: this.res.scale,
    });

    if (!this.endingShown && this.discoveries.count >= this.discoveries.total) {
      this.endingShown = true;
      this.pause('ending');
      return;
    }
    if (I.pressed('KeyJ')) return this.pause('journal');
    if (I.pressed('KeyM')) return this.pause('map');
    if (I.pressed('Escape') && !I.locked) return this.pause();
  }
}

const time = () => performance.now() / 1000;
