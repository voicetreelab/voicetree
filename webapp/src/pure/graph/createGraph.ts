/**
 * Graph creation utilities that ensure all indexes are properly initialized.
 */

import type { Graph, GraphNode, NodeIdAndFilePath } from '@/pure/graph'
import { buildIncomingEdgesIndex } from '@/pure/graph/graph-operations/incomingEdgesIndex'
import { buildNodeByBaseNameIndex, buildUnresolvedLinksIndex } from '@/pure/graph/graph-operations/linkResolutionIndexes'

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
