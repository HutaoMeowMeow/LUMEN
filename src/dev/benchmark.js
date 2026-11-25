// Development-only frame profiler. Loaded from main.js only when import.meta.env.DEV,
// so the production bundle never contains this module.
//
// Usage in the dev server console:
//   await __lumenBench.measure('menu')
//   __lumenBench.start('dive'); ... ; __lumenBench.stop()
//
// Frame time is measured from an independent requestAnimationFrame probe, so it reflects the
// cadence the user actually sees. GPU time comes from EXT_disjoint_timer_query_webgl2 around
// the whole composer submit; when the extension is unavailable (or reports a disjoint event)
// gpuMs is null rather than guessed from JavaScript timings.

import { World } from '../world/World.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stats(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  const at = (q) => s[Math.min(n - 1, Math.max(0, Math.floor(q * n)))];
  return { avg: sum / n, min: s[0], p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s[n - 1], n };
}

function fmt(v, digits = 2) { return v == null || !Number.isFinite(v) ? 'n/a' : v.toFixed(digits); }

function trackWorkers() {
  const NativeWorker = window.Worker;
  const live = new Set();
  const s = { created: 0, sent: 0, received: 0, errors: 0 };
  class TrackedWorker extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      s.created++;
      live.add(this);
      this.addEventListener('message', () => { s.received++; });
      this.addEventListener('error', () => { s.errors++; });
    }
    postMessage(message, transfer) { s.sent++; return super.postMessage(message, transfer); }
    terminate() { live.delete(this); return super.terminate(); }
  }
  window.Worker = TrackedWorker;
  return {
    snapshot: () => ({ created: s.created, live: live.size, messagesSent: s.sent, messagesReceived: s.received, errors: s.errors }),
    dispose: () => { window.Worker = NativeWorker; },
  };
}

export function installBenchmark(game) {
  if (game.__lumenBench) return game.__lumenBench;

  // Workers are created by game.init() -> world.generate(), so tracking starts immediately.
  const workers = trackWorkers();
  const state = { rec: null, pending: null, closed: false, gpuError: null, attached: false, probing: false, worldgenMs: null };

  // Time the worker-driven terrain generation inside the real init() path.
  const previousGenerate = World.prototype.generate;
  World.prototype.generate = async function generate(...args) {
    const t0 = performance.now();
    try { return await previousGenerate.apply(this, args); }
    finally { state.worldgenMs = performance.now() - t0; }
  };

  let renderer = null;
  let gl = null;
  let ext = null;
  let info = null;
  let previousAutoReset = true;
  let originalRender = null;
  let originalTick = null;

  const sample = () => {
    const pending = state.pending;
    if (!pending) return;
    let available = false;
    try { available = gl.getQueryParameter(pending.query, gl.QUERY_RESULT_AVAILABLE); } catch { available = false; }
    if (!available) return;
    let ns = 0, disjoint = false;
    try {
      ns = gl.getQueryParameter(pending.query, gl.QUERY_RESULT);
      disjoint = ext ? !!gl.getParameter(ext.GPU_DISJOINT_EXT) : true;
      gl.deleteQuery(pending.query);
    } catch (err) {
      state.gpuError = String(err?.message || err);
      disjoint = true;
    }
    state.pending = null;
    if (!disjoint && pending.rec.active) pending.rec.gpu.push(ns / 1e6);
  };

  const newRec = (label) => ({
    label, active: false, t0: 0, durationMs: 0, intervals: [], tick: [], renderCpu: [], gpu: [], calls: [], tris: [],
  });

  // Instrumentation needs the renderer and composer, which Game only builds in init().
  const ensure = () => {
    if (state.attached) return;
    if (!game.renderer || !game.postfx) throw new Error('LUMEN is still initialising; measure again once the menu appears');
    renderer = game.renderer;
    gl = renderer.getContext();
    try { ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); } catch { ext = null; }
    info = renderer.info;
    previousAutoReset = info.autoReset;
    info.autoReset = false; // reset once per tick, then read totals after the submit

    originalRender = game.postfx.render;
    game.postfx.render = (dt) => {
      sample();
      const rec = state.rec;
      if (!rec || !rec.active) return originalRender.call(game.postfx, dt);
      let query = null;
      if (ext && !state.pending && !state.gpuError) {
        try {
          query = gl.createQuery();
          gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
        } catch (err) {
          state.gpuError = String(err?.message || err);
          query = null;
        }
      }
      const t0 = performance.now();
      originalRender.call(game.postfx, dt);
      const cpu = performance.now() - t0;
      rec.renderCpu.push(cpu);
      if (query) {
        try {
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          state.pending = { query, rec };
        } catch (err) {
          state.gpuError = String(err?.message || err);
          try { gl.deleteQuery(query); } catch { /* ignore */ }
        }
      }
    };

    originalTick = game._tick;
    game._tick = function tick() {
      info.reset();
      const rec = state.rec;
      if (!rec || !rec.active) return originalTick.call(game);
      const t0 = performance.now();
      originalTick.call(game);
      const total = performance.now() - t0;
      rec.tick.push(total);
      rec.calls.push(info.render.calls);
      rec.tris.push(info.render.triangles);
    };

    state.attached = true;
    if (!state.probing) {
      state.probing = true;
      let lastRaf = performance.now();
      const probe = () => {
        if (state.closed) return;
        const now = performance.now();
        const rec = state.rec;
        if (rec && rec.active) rec.intervals.push(now - lastRaf);
        lastRaf = now;
        requestAnimationFrame(probe);
      };
      requestAnimationFrame(probe);
    }
  };

  const countObjects = () => {
    let objects = 0, instancedMeshes = 0, instances = 0;
    game.scene.traverse((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      objects++;
      if (o.isInstancedMesh) { instancedMeshes++; instances += o.count; }
    });
    return { objects, instancedMeshes, instances, sceneChildren: game.scene.children.length };
  };

  const summarize = (rec) => {
    const frame = stats(rec.intervals);
    const gpu = stats(rec.gpu);
    const tick = stats(rec.tick);
    const renderCpu = stats(rec.renderCpu);
    const calls = stats(rec.calls);
    const tris = stats(rec.tris);
    const update = rec.tick.map((t, i) => Math.max(0, t - (rec.renderCpu[i] ?? 0)));
    const updateStats = stats(update);
    const fps = frame ? {
      avg: 1000 / frame.avg,
      min: 1000 / frame.max, // slowest single frame
      low1: 1000 / frame.p99, // slowest 1% of frames
    } : null;
    return {
      label: rec.label,
      gameState: game.state,
      quality: game.quality,
      worldgenMs: state.worldgenMs == null ? null : Math.round(state.worldgenMs),
      durationMs: Math.round(rec.durationMs || 0),
      frames: rec.intervals.length,
      fps,
      frameMs: frame,
      updateMs: updateStats, // main-thread scene/update work, excluding the composer submit
      tickMs: tick, // all main-thread JS in the frame loop
      renderCpuMs: renderCpu, // JS time spent submitting the composer (not GPU execution)
      gpuMs: gpu, // measured GPU execution of the composer, null when unsupported
      gpuTimer: ext ? 'EXT_disjoint_timer_query_webgl2' : 'unavailable',
      gpuNote: state.gpuError || (gpu ? null : ext ? 'no query results this window' : 'timer extension unavailable'),
      drawCalls: calls,
      triangles: tris,
      objects: countObjects(),
      display: {
        canvas: [renderer.domElement.width, renderer.domElement.height],
        window: [window.innerWidth, window.innerHeight],
        pixelRatio: renderer.getPixelRatio(),
      },
      memory: { ...info.memory, programs: info.programs?.length ?? null },
      workers: workers.snapshot(),
    };
  };

  const log = (s) => {
    if (!s) return;
    const gpu = s.gpuMs ? `${fmt(s.gpuMs.avg)} ms (${s.gpuMs.n} samples)` : 'n/a';
    console.log(
      `[bench] ${s.label} | ${fmt(s.fps?.avg, 1)} fps avg / ${fmt(s.fps?.low1, 1)} fps 1% low / ${fmt(s.fps?.min, 1)} fps min | ` +
      `frame ${fmt(s.frameMs?.avg)} ms | JS tick ${fmt(s.tickMs?.avg)} ms (update ${fmt(s.updateMs?.avg)} + submit ${fmt(s.renderCpuMs?.avg)}) | ` +
      `GPU ${gpu} | ${Math.round(s.drawCalls?.avg ?? 0)} draw calls | ${fmt((s.triangles?.avg ?? 0) / 1e6)} M tris | ` +
      `${s.objects.objects} objects (${s.objects.instancedMeshes} instanced / ${s.objects.instances} instances) | ` +
      `workers ${s.workers.live} live / ${s.workers.created} created` +
      (s.worldgenMs == null ? '' : ` | worldgen ${fmt(s.worldgenMs / 1000)} s`),
    );
  };

  const api = {
    /**
     * Measures a fixed window after an optional warm-up (shader compilation, first cells).
     * Returns the summary and logs it. Only one measurement can run at a time.
     */
    async measure(label = 'frame', { durationMs = 6000, warmupMs = 2000 } = {}) {
      ensure();
      if (state.rec) throw new Error('a measurement is already running');
      const rec = newRec(label);
      state.rec = rec;
      try {
        if (warmupMs > 0) await sleep(warmupMs);
        // Drop a query still in flight from the warm-up so its sample can't leak into the window.
        if (state.pending) { try { gl.deleteQuery(state.pending.query); } catch { /* ignore */ } state.pending = null; }
        rec.active = true;
        rec.t0 = performance.now();
        await sleep(durationMs);
        rec.durationMs = performance.now() - rec.t0;
      } finally {
        rec.active = false;
        state.rec = null;
      }
      const summary = summarize(rec);
      log(summary);
      return summary;
    },
    start(label = 'frame') {
      ensure();
      if (state.rec) throw new Error('a measurement is already running');
      const rec = newRec(label);
      rec.active = true;
      rec.t0 = performance.now();
      state.rec = rec;
      return label;
    },
    stop() {
      const rec = state.rec;
      if (!rec) return null;
      rec.active = false;
      rec.durationMs = performance.now() - rec.t0;
      state.rec = null;
      const summary = summarize(rec);
      log(summary);
      return summary;
    },
    dispose() {
      state.closed = true;
      state.rec = null;
      if (state.pending) { try { gl.deleteQuery(state.pending.query); } catch { /* ignore */ } state.pending = null; }
      if (state.attached) {
        game.postfx.render = originalRender;
        game._tick = originalTick;
        info.autoReset = previousAutoReset;
      }
      World.prototype.generate = previousGenerate;
      workers.dispose();
      delete game.__lumenBench;
      delete window.__lumenBench;
    },
  };

  game.__lumenBench = api;
  return api;
}
