import { performance } from 'node:perf_hooks';
import { hierarchy, tree } from 'd3-hierarchy';

const root = {
  id: 'root',
  children: Array.from({ length: 4 }, (_, group) => ({
    id: `group-${group}`,
    children: Array.from({ length: 5 }, (_, leaf) => ({ id: `leaf-${group}-${leaf}` })),
  })),
};

const t0 = performance.now();
const positioned = tree().nodeSize([80, 180])(hierarchy(root));
const elapsedMs = performance.now() - t0;
const sample = positioned.descendants().slice(0, 10).map((node) => ({
  id: node.data.id,
  x: Number(node.x.toFixed(2)),
  y: Number(node.y.toFixed(2)),
}));

console.log(JSON.stringify({
  nodes: positioned.descendants().length,
  elapsedMs: Number(elapsedMs.toFixed(3)),
  sample,
}, null, 2));
