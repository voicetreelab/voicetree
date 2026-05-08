import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/pure/**/*.test.ts'],
    exclude: [
      'src/pure/graph/graph-operations/removeContextNodes.test.ts',
      'src/pure/graph/graph-operations/removeNodeMaintainingTransitiveEdges.test.ts',
      'src/pure/graph/graph-operations/traversal/getSubgraphByDistance.test.ts',
      'src/pure/graph/graphDelta/deleteNodeEdgePreservation.test.ts',
    ],
  },
})
