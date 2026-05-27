import { performance } from 'node:perf_hooks';
import { ForceAtlas2Layout } from '@antv/layout';

const makeGraph = (n) => ({
  nodes: Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    data: {
      x: Math.cos(i * 0.61803398875) * 1000 + (i % 31) * 3,
      y: Math.sin(i * 0.61803398875) * 1000 + (i % 17) * 5,
      size: 10,
    },
  })),
  edges: Array.from({ length: n * 3 }, (_, i) => ({
    id: `e${i}`,
    source: `n${i % n}`,
    target: `n${(i * 17 + 13) % n}`,
    data: { weight: 1 },
  })).filter((edge) => edge.source !== edge.target),
});

const run = async (n, barnesHut) => {
  const layout = new ForceAtlas2Layout({
    width: 2000,
    height: 1400,
    center: [0, 0],
    barnesHut,
    preventOverlap: false,
    prune: false,
    maxIteration: 25,
    kr: 5,
    kg: 1,
    ks: 0.1,
  });
  const t0 = performance.now();
  await layout.execute(makeGraph(n));
  const elapsedMs = performance.now() - t0;
  const sample = [];
  layout.forEachNode((node, i) => {
    if (i < 5) sample.push([node.id, Number(node.x.toFixed(3)), Number(node.y.toFixed(3))]);
  });
  layout.destroy();
  return { n, barnesHut, elapsedMs: Number(elapsedMs.toFixed(2)), sample };
};

const rows = [];
for (const n of [500, 1000]) {
  rows.push(await run(n, false), await run(n, true));
}

const byKey = (n, barnesHut) => rows.find((row) => row.n === n && row.barnesHut === barnesHut);
console.table(rows.map(({ n, barnesHut, elapsedMs }) => ({ n, barnesHut, elapsedMs })));
console.log(JSON.stringify({
  outputDiffersAt500: JSON.stringify(byKey(500, true).sample) !== JSON.stringify(byKey(500, false).sample),
  noBarnesHutDoublingRatio: Number((byKey(1000, false).elapsedMs / byKey(500, false).elapsedMs).toFixed(2)),
  barnesHutDoublingRatio: Number((byKey(1000, true).elapsedMs / byKey(500, true).elapsedMs).toFixed(2)),
  noBarnesHut500Sample: byKey(500, false).sample,
  barnesHut500Sample: byKey(500, true).sample,
}, null, 2));
