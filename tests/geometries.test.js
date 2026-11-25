// Every procedural geometry must build, carry the attributes the instanced materials read, and contain no NaNs.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/world/geometries.js';

test('all geometries build with color + aGlow and finite positions', () => {
  for (const [name, fn] of Object.entries(G)) {
    if (typeof fn !== 'function') continue;
    const g = fn();
    assert.ok(g.attributes.color && g.attributes.aGlow && g.attributes.normal, name + ' attributes');
    assert.ok(g.attributes.position.array.every(Number.isFinite), name + ' NaN');
    assert.ok(g.attributes.position.count > 0, name + ' empty');
  }
});
