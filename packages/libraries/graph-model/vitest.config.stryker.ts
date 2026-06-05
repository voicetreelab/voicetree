import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/pure/**/*.test.ts'],
    exclude: [
      'src/pure/graph/graph-operations/transforms/removeContextNodes.test.ts',
      'src/pure/graph/graph-operations/transforms/removeNodeMaintainingTransitiveEdges.test.ts',
      'src/pure/graph/graph-operations/traversal/getSubgraphByDistance.test.ts',
      'src/pure/graph/graphDelta/deleteNodeEdgePreservation.test.ts',
      // End-to-end delivery oracle: spawns a real bash + reads the probe at
      // tools/agent-tree-probe/probe.mjs (repo root). Stryker copies only the
      // package into .stryker-tmp, so the out-of-package probe is unreachable
      // there; it also spawns a subprocess per case (too slow to run per-mutant).
      // The pure agentTree.test.ts carries mutation coverage for the resolver;
      // this oracle runs in the normal unit suite (graph-model-unit).
      'src/pure/settings/agentTreeDelivery.test.ts',
    ],
  },
})
