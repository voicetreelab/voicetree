import { performance } from 'node:perf_hooks';
import { ComboCombinedLayout, ForceAtlas2Layout } from '@antv/layout';
import { hierarchy, tree } from 'd3-hierarchy';
import * as cola from 'webcola';

// Lightweight algorithm-level benchmark. ForceAtlas2 and mindmap use the target
// 500/1000-node scale; ComboCombined and webcola use smaller caps so this stays
// runnable as a quick probe rather than replacing the Electron perf suite.

const round = (value) => Number(value.toFixed(2));

const syntheticGraph = (nodeCount) => {
  const columns = Math.ceil(Math.sqrt(nodeCount));
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `n${index}`,
    x: (index % columns) * 24,
    y: Math.floor(index / columns) * 24,
    data: { size: [24, 24] },
  }));
  const edges = Array.from({ length: nodeCount * 2 }, (_, index) => ({
    id: `e${index}`,
    source: `n${index % nodeCount}`,
    target: `n${(index * 17 + 23) % nodeCount}`,
    data: { weight: 1 },
  })).filter((edge) => edge.source !== edge.target);
  return { nodes, edges };
};

const syntheticComboGraph = (nodeCount) => {
  const comboCount = Math.max(4, Math.ceil(nodeCount / 100));
  const combos = Array.from({ length: comboCount }, (_, index) => ({
    id: `combo-${index}`,
    data: { isCombo: true, size: [80, 80] },
  }));
  const leaves = Array.from({ length: nodeCount }, (_, index) => ({
    id: `n${index}`,
    data: {
      parentId: `combo-${index % comboCount}`,
      x: (index % 50) * 18,
      y: Math.floor(index / 50) * 18,
      size: [18, 18],
    },
  }));
  const edges = syntheticGraph(nodeCount).edges;
  return { nodes: [...combos, ...leaves], edges };
};

const syntheticTree = (nodeCount) => {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({ id: `n${index}`, children: [] }));
  for (let index = 1; index < nodeCount; index += 1) {
    const parent = Math.floor((index - 1) / 4);
    nodes[parent].children.push(nodes[index]);
  }
  return nodes[0];
};

const measure = async (backend, nodeCount, run) => {
  const t0 = performance.now();
  await run(nodeCount);
  const result = {
    backend,
    nodes: nodeCount,
    elapsedMs: round(performance.now() - t0),
  };
  console.log(`[layout-benchmark] ${backend} ${nodeCount} nodes: ${result.elapsedMs}ms`);
  return result;
};

const runForceAtlas2 = async (nodeCount) => {
  const graph = syntheticGraph(nodeCount);
  const layout = new ForceAtlas2Layout({
    center: [0, 0],
    width: 1600,
    height: 1200,
    barnesHut: true,
    preventOverlap: false,
    prune: false,
    maxIteration: 250,
    kg: 1,
    kr: 5,
    ks: 0.1,
    nodeSize: (node) => node.data.size,
  });
  await layout.execute(graph);
  layout.destroy();
};

const runComboCombined = async (nodeCount) => {
  const graph = syntheticComboGraph(nodeCount);
  const layout = new ComboCombinedLayout({
    center: [0, 0],
    nodeSize: (node) => node.data?.size ?? node.size ?? [18, 18],
    comboPadding: 40,
    comboSpacing: 120,
    layout: (comboId) => comboId
      ? { type: 'concentric', preventOverlap: true, nodeSize: [18, 18] }
      : { type: 'force-atlas2', barnesHut: true, preventOverlap: false, maxIteration: 120 },
    node: (datum) => ({
      id: datum.id,
      x: datum.data?.x,
      y: datum.data?.y,
      parentId: datum.data?.parentId,
      isCombo: datum.data?.isCombo,
    }),
  });
  await layout.execute(graph);
  layout.destroy();
};

const runMindmap = (nodeCount) => {
  tree().nodeSize([80, 180])(hierarchy(syntheticTree(nodeCount)));
};

const runWebcola = (nodeCount) => {
  const graph = syntheticGraph(nodeCount);
  const nodes = graph.nodes.map((node) => ({
    x: node.x,
    y: node.y,
    width: node.data.size[0],
    height: node.data.size[1],
  }));
  const links = graph.edges.map((edge) => ({
    source: Number(edge.source.slice(1)),
    target: Number(edge.target.slice(1)),
  }));
  new cola.Layout()
    .nodes(nodes)
    .links(links)
    .avoidOverlaps(true)
    .linkDistance(180)
    .size([1600, 1200])
    .start(15, 25, 25);
};

const RUNNERS = [
  { backend: 'forceatlas2', sizes: [500, 1000], run: runForceAtlas2 },
  { backend: 'combocombined', sizes: [100, 250], run: runComboCombined },
  { backend: 'mindmap', sizes: [500, 1000], run: runMindmap },
  { backend: 'webcola', sizes: [100, 250], run: runWebcola },
];

const results = [];
for (const { backend, sizes, run } of RUNNERS) {
  for (const size of sizes) {
    results.push(await measure(backend, size, run));
  }
}

const ratios = RUNNERS.map(({ backend, sizes }) => {
  const small = results.find((result) => result.backend === backend && result.nodes === sizes[0]);
  const large = results.find((result) => result.backend === backend && result.nodes === sizes[1]);
  return {
    backend,
    fromNodes: sizes[0],
    toNodes: sizes[1],
    doublingRatio: round(large.elapsedMs / small.elapsedMs),
  };
});

console.table(results);
console.table(ratios);
console.log(JSON.stringify({ results, ratios }, null, 2));
