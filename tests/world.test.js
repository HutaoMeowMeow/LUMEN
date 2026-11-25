// Node-side sanity checks for the pure modules (no WebGL needed): run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// minimal localStorage so Settings/SaveGame can be imported outside a browser
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { WORLD, ISLANDS, POIS, SPAWN } = await import('../src/world/layout.js');
const { sampleWorld } = await import('../src/world/worldgen.js');
const { SaveGame, Settings, PRESETS } = await import('../src/core/Settings.js');
const { PLACES } = await import('../src/core/lore.js');

test('islands rise above the sea and the open ocean stays below it', () => {
  for (const I of ISLANDS) {
    if (I.type === 'atoll') continue; // the lagoon centre is water by design
    // the coast is domain-warped, so look for land anywhere within the nominal radius
    let top = -Infinity;
    for (let dx = -I.r; dx <= I.r; dx += I.r / 8) for (let dz = -I.r; dz <= I.r; dz += I.r / 8) top = Math.max(top, sampleWorld(I.x + dx, I.z + dz));
    assert.ok(top > 2, `${I.id} should rise above the sea`);
  }
  assert.ok(sampleWorld(SPAWN.x, SPAWN.z) > 1, 'new games start on dry land');
  assert.ok(sampleWorld(1700, -1700) < -10, 'far ocean is deep');
});

test('heights are finite and deterministic', () => {
  const out = [0, 0, 0, 0];
  for (let i = 0; i < 200; i++) {
    const x = (i * 97.3) % WORLD.size - WORLD.half, z = (i * 61.7) % WORLD.size - WORLD.half;
    const h = sampleWorld(x, z, out);
    assert.ok(Number.isFinite(h) && h > -600 && h < 200, `bad height ${h} at ${x},${z}`);
    assert.equal(h, sampleWorld(x, z));
    for (const b of out) assert.ok(b >= 0 && b <= 1.0001, `biome weight out of range: ${b}`);
  }
});

test('points of interest lie inside the playable boundary', () => {
  for (const [id, p] of Object.entries(POIS)) {
    if (p.island) assert.ok(ISLANDS.some((I) => I.id === p.island), id);
    else assert.ok(Math.hypot(p.x, p.z) < WORLD.boundary, id);
  }
});

test('every examinable anchor has a journal entry', () => {
  const src = readFileSync(new URL('../src/world/Structures.js', import.meta.url), 'utf8');
  const ids = [...src.matchAll(/\.anchor\('([\w-]+)'/g)].map((m) => m[1]);
  assert.ok(ids.length >= 10, 'anchors found in Structures.js');
  for (const id of ids) assert.ok(PLACES[id]?.title && PLACES[id]?.text, `PLACES['${id}'] missing`);
});

test('save games round-trip and corrupt saves are rejected', () => {
  assert.equal(SaveGame.load(), null);
  SaveGame.save({ pos: [1, 2, 3], yaw: 0.5, found: ['place:gate'] });
  assert.deepEqual(SaveGame.load().pos, [1, 2, 3]);
  localStorage.setItem('lumen.save', '{"v":1,"pos":[1,null,3]}');
  assert.equal(SaveGame.load(), null);
  localStorage.setItem('lumen.save', 'not json');
  assert.equal(SaveGame.load(), null);
  SaveGame.clear();
  assert.equal(SaveGame.load(), null);
});

test('settings fall back to a valid preset', () => {
  localStorage.setItem('lumen.settings', '{"quality":"bogus","fov":90}');
  const s = new Settings();
  assert.ok(PRESETS[s.quality]);
  assert.equal(s.fov, 90);
});

test('journal totals 40 and stale save keys never count toward the ending', async () => {
  const { Discoveries } = await import('../src/core/Discoveries.js');
  const anchors = Object.fromEntries(Object.keys(PLACES).map((id) => [id, { x: 0, y: 0, z: 0 }]));
  const d = new Discoveries(anchors, ['place:removed-long-ago', 'species:nope']);
  assert.equal(d.total, 40);
  assert.equal(d.count, 0);
  for (const sec of d.journal()) for (const it of sec.items) d._add(it.key);
  assert.equal(d.count, d.total);
});
