// Dynamic resolution controller (Game._adaptRes) driven with synthetic frame times.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/Game.js';

function rig(preset) {
  const g = { res: { scale: 1, t0: 0, last: 0, n: 0, dt: new Float32Array(256), ms: 0, up: 0, down: 0, wait: 4, raisedAt: -1e9 }, resized: 0, settings: { preset: preset ?? {} } };
  g._resize = () => { g.resized++; };
  g._setRes = Game.prototype._setRes;
  g._adaptRes = Game.prototype._adaptRes;
  g._resMin = Game.prototype._resMin;
  return g;
}
const run = (g, from, secs, frameMs) => { let t = from; for (; t < from + secs * 1000; t += frameMs) g._adaptRes(t); return t; };

test('dynamic resolution steps down under load, floors at 0.6, and recovers', () => {
  const g = rig();
  let t = run(g, 5000, 30, 30); // ~33 fps
  assert.equal(g.res.scale, 0.6);
  t = run(g, t, 3, 30);
  assert.equal(g.res.scale, 0.6, 'never below the floor');
  run(g, t, 30, 16.7); // vsync-bound again
  assert.equal(g.res.scale, 1);
});

test('a step up that costs frame rate doubles the wait before the next try', () => {
  const g = rig();
  g.res.scale = 0.9;
  let t = run(g, 5000, 6, 16.7);
  assert.equal(g.res.scale, 1);
  run(g, t, 3, 30);
  assert.equal(g.res.scale, 0.9);
  assert.equal(g.res.wait, 8);
});

test('one long frame a second (a hitch, not fill rate) does not lower resolution', () => {
  const g = rig();
  let t = 5000;
  for (let s = 0; s < 10; s++) { t = run(g, t, 1, 16.7); t += 300; } // 300 ms stall each second: mean ~26 ms, median 16.7
  assert.equal(g.res.scale, 1);
  assert.ok(Math.abs(g.res.ms - 16.7) < 0.1);
});

test('ultra keeps a higher resolution floor than the default presets', () => {
  const g = rig({ resMin: 0.8 });
  run(g, 5000, 30, 30);
  assert.equal(g.res.scale, 0.8);
});
