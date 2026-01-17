/**
 * Graph creation utilities that ensure the incomingEdgesIndex is properly initialized.
 */

import type { Graph, GraphNode, NodeIdAndFilePath } from '@/pure/graph'
import { buildIncomingEdgesIndex } from '@/pure/graph/graph-operations/incomingEdgesIndex'

/**
 * Create an empty graph with an initialized (empty) incoming edges index.
 */
export function createEmptyGraph(): Graph {
  return {
    nodes: {},
    incomingEdgesIndex: new Map()
  }
}

/**
 * Create a graph from a record of nodes, automatically building the incoming edges index.
 */
export function createGraph(nodes: Record<NodeIdAndFilePath, GraphNode>): Graph {
  return {
    nodes,
    incomingEdgesIndex: buildIncomingEdgesIndex(nodes)
  }
}
