// Dynamic resolution controller (Game._adaptRes) driven with synthetic frame times.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/core/Game.js';

function rig() {
  const g = { res: { scale: 1, t0: 0, n: 0, up: 0, down: 0, wait: 4, raisedAt: -1e9 }, resized: 0 };
  g._resize = () => { g.resized++; };
  g._setRes = Game.prototype._setRes;
  g._adaptRes = Game.prototype._adaptRes;
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
