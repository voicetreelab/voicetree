import { performance } from 'node:perf_hooks';
import { ComboCombinedLayout } from '@antv/layout';

const combos = ['combo-a', 'combo-b', 'combo-c'];
const nodes = [
  ...combos.map((id) => ({ id, data: { isCombo: true, size: [160, 120] } })),
  ...Array.from({ length: 50 }, (_, i) => ({
    id: `n${i}`,
    data: {
      parentId: combos[i % combos.length],
      x: (i % 10) * 40,
      y: Math.floor(i / 10) * 40,
      size: [24, 24],
    },
  })),
];
const edges = Array.from({ length: 90 }, (_, i) => ({
  id: `e${i}`,
  source: `n${i % 50}`,
  target: `n${(i * 7 + 11) % 50}`,
})).filter((edge) => edge.source !== edge.target);

const layout = new ComboCombinedLayout({
  center: [0, 0],
  nodeSize: (node) => node.size ?? [24, 24],
  comboPadding: 40,
  comboSpacing: 80,
  layout: (comboId) => comboId
    ? { type: 'concentric', preventOverlap: true, nodeSize: [24, 24] }
    : { type: 'force-atlas2', barnesHut: true, preventOverlap: false, maxIteration: 80 },
  node: (datum) => ({
    id: datum.id,
    x: datum.data?.x,
    y: datum.data?.y,
    parentId: datum.data?.parentId,
    isCombo: datum.data?.isCombo,
  }),
});

const t0 = performance.now();
await layout.execute({ nodes, edges });
const elapsedMs = performance.now() - t0;
const sample = [];
layout.forEachNode((node, i) => {
  if (i < 10) sample.push({ id: node.id, x: Number(node.x.toFixed(2)), y: Number(node.y.toFixed(2)), size: node.size });
});
layout.destroy();
console.log(JSON.stringify({ nodes: nodes.length, edges: edges.length, elapsedMs: Number(elapsedMs.toFixed(2)), sample }, null, 2));
