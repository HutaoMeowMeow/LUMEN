// Entry point: check for WebGL 2, then boot the game.
import { Game } from './core/Game.js';

function fail(msg) {
  document.getElementById('loading').classList.remove('show');
  document.getElementById('error').classList.add('show');
  document.getElementById('error-text').textContent = msg;
}

const probe = document.createElement('canvas');
if (!probe.getContext('webgl2')) {
  fail('WebGL 2 is not available in this browser or is disabled.');
} else {
  const game = new Game();
  window.__lumen = game; // handy for debugging and automated tests
  if (import.meta.env.DEV) {
    // Development-only profiler. The production build drops this branch (and the module).
    const { installBenchmark } = await import('./dev/benchmark.js');
    window.__lumenBench = installBenchmark(game);
  }
  game.init().catch((err) => {
    console.error(err);
    fail(`Something went wrong while building the world: ${err?.message || err}`);
  });
}
