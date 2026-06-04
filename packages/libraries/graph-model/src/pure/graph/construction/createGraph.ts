/**
 * Graph creation utilities that ensure all indexes are properly initialized.
 */

import type { Graph, GraphNode, NodeIdAndFilePath } from '..'
import { buildIncomingEdgesIndex } from '../graph-operations/indexes/incomingEdgesIndex'
import { buildNodeByBaseNameIndex, buildUnresolvedLinksIndex } from '../graph-operations/indexes/linkResolutionIndexes'
import { applyGraphDeltaToGraph } from '../graphDelta/applyGraphDeltaToGraph'
import { mapNewGraphToDelta } from '../graphDelta/mapNewGraphtoDelta'

/**
 * Create an empty graph with initialized (empty) indexes.
 */
export function createEmptyGraph(): Graph {
  return {
    nodes: {},
    incomingEdgesIndex: new Map(),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map()
  }
}

/**
 * Create a graph from a record of nodes, automatically building all indexes.
 */
export function createGraph(nodes: Record<NodeIdAndFilePath, GraphNode>): Graph {
  return {
    nodes,
    incomingEdgesIndex: buildIncomingEdgesIndex(nodes),
    nodeByBaseName: buildNodeByBaseNameIndex(nodes),
    unresolvedLinksIndex: buildUnresolvedLinksIndex(nodes)
  }
}

/**
 * Rehydrate a graph that crossed a JSON boundary.
 *
 * A `Graph`'s index fields (`incomingEdgesIndex`, `nodeByBaseName`,
 * `unresolvedLinksIndex`) are `Map`s, which `JSON.stringify` flattens to `{}` —
 * so any `Graph` received over an RPC/SSE wire arrives with empty, broken
 * indexes (`.get` is undefined) even though its static type still says `Graph`.
 * Every consumer that reads a serialized graph MUST pass it through here first;
 * the indexes are pure functions of `nodes`, so they are rebuilt from the nodes
 * record alone. The node-by-node delta application also normalizes each node's
 * shape, matching how the daemon builds its in-memory graph.
 */
export function rehydrateSerializedGraph(raw: { readonly nodes: Record<string, unknown> }): Graph {
  const emptyGraph: Graph = createEmptyGraph()
  return applyGraphDeltaToGraph(
    emptyGraph,
    mapNewGraphToDelta({
      ...emptyGraph,
      nodes: raw.nodes as Record<NodeIdAndFilePath, GraphNode>,
    }),
  )
}
