// World generation worker: heightmap rows and cave meshes.
import { generateRows } from './worldgen.js';
import { meshCave } from './caves.js';

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'rows') {
    const { heights, bRows } = generateRows(msg.r0, msg.r1);
    self.postMessage({ type: 'rows', r0: msg.r0, r1: msg.r1, heights, bRows }, [heights.buffer, ...bRows.map((b) => b.data.buffer)]);
  } else if (msg.type === 'cave') {
    const m = meshCave(msg.index);
    self.postMessage({ type: 'cave', index: msg.index, ...m }, [m.positions.buffer, m.normals.buffer, m.inner.buffer, m.indices.buffer]);
  }
};
