// Tracks what the diver has found: places (press E at an anchor), species (look at them closely) and regions (enter them).
import * as THREE from 'three';
import { REGIONS, RIFT } from '../world/layout.js';
import { PLACES, SPECIES_TEXT, REGION_TEXT } from './lore.js';
import { SPECIES } from '../creatures/Creatures.js';

const _v = new THREE.Vector3();

export class Discoveries {
  constructor(anchors, found = []) {
    this.anchors = Object.entries(anchors).filter(([id]) => PLACES[id]).map(([id, p]) => ({ id, p }));
    this.found = new Set(found);
    this.order = [...found];
    this.onFound = null;
    this.valid = new Set(this.journal().flatMap((sec) => sec.items.map((it) => it.key)));
    this._count = [...this.found].filter((k) => this.valid.has(k)).length;
  }

  get total() { return this.anchors.length + Object.keys(SPECIES_TEXT).length + Object.keys(REGION_TEXT).length; }
  // only keys that still have a journal entry count, so a stale key in an old save can't trigger the ending early
  get count() { return this._count; }

  _add(key) {
    if (this.found.has(key)) return false;
    this.found.add(key);
    this.order.push(key);
    if (this.valid.has(key)) this._count++;
    this.onFound?.(key, entry(key));
    return true;
  }

  // Nearest place anchor in reach and in view, for the interaction prompt
  target(cam, dir) {
    let best = null, bestD = 4;
    for (const a of this.anchors) {
      _v.subVectors(a.p, cam);
      const d = _v.length();
      if (d < bestD && (d < 1.5 || _v.dot(dir) / d > 0.7)) { best = a; bestD = d; }
    }
    return best;
  }

  interact(a) { return this._add('place:' + a.id); }

  update(player, creatures, world) {
    const p = player.pos;
    for (const [id, R] of Object.entries(REGIONS)) {
      if (Math.hypot(p.x - R.x, p.z - R.z) < R.r * 0.6 && player.headUnder) this._add('region:' + id);
    }
    if (player.headUnder) {
      if (world.heightAt(p.x, p.z) < RIFT.floor * 0.55 && p.y < -60) this._add('region:rift');
      if (world.biomeAt(p.x, p.z)[0] > 0.5 && p.y > -25) this._add('region:reef');
    }
    // fish are only identified underwater, birds only from the air
    const skip = new Set(Object.keys(SPECIES).filter((k) => this.found.has('species:' + k) || (k === 'saltwing') === player.headUnder));
    const s = creatures.sighting(p, player.forward(_v), skip);
    if (s) this._add('species:' + s);
  }

  // Journal sections in display order: [{ kind, items: [{ key, title, text, found }] }]
  journal() {
    const sec = (kind, keys, mk) => ({ kind, items: keys.map((k) => ({ key: kind + ':' + k, found: this.found.has(kind + ':' + k), ...mk(k) })) });
    return [
      sec('place', this.anchors.map((a) => a.id), (k) => PLACES[k]),
      sec('species', Object.keys(SPECIES_TEXT), (k) => ({ title: SPECIES[k].name, text: SPECIES_TEXT[k] })),
      sec('region', Object.keys(REGION_TEXT), (k) => ({ title: REGIONS[k]?.name ?? (k === 'rift' ? 'The Hollow Rift' : 'Coral Gardens'), text: REGION_TEXT[k] })),
    ];
  }
}

export function entry(key) {
  const [kind, id] = key.split(':');
  if (kind === 'place') return { kind, title: PLACES[id].title, text: PLACES[id].text };
  if (kind === 'species') return { kind, title: SPECIES[id].name, text: SPECIES_TEXT[id] };
  return { kind, title: REGIONS[id]?.name ?? (id === 'rift' ? 'The Hollow Rift' : 'Coral Gardens'), text: REGION_TEXT[id] };
}
