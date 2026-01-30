import type { Graph, NodeIdAndFilePath, Edge, GraphNode } from '@/pure/graph'

/**
 * Returns all edges from nodes OUTSIDE the subgraph that point TO nodes INSIDE the subgraph.
 *
 * This function identifies "incoming edges" to a subgraph by:
 * 1. Iterating through all nodes in the graph
 * 2. Filtering out nodes that are part of the subgraph (we only want external sources)
 * 3. For each external node, checking its outgoing edges
 * 4. If an edge's target is in the subgraph, including it in the result
 *
 * @param subgraphNodeIds - Array of node IDs that define the subgraph
 * @param graph - The full graph to search
 * @returns Array of objects containing the source node ID and the edge pointing into the subgraph
 */
export function getIncomingEdgesToSubgraph(
  subgraphNodeIds: readonly NodeIdAndFilePath[],
  graph: Graph
): readonly { readonly sourceNodeId: NodeIdAndFilePath; readonly edge: Edge }[] {
  // Create a Set for O(1) lookup of subgraph node IDs
  const subgraphNodeIdSet: ReadonlySet<NodeIdAndFilePath> = new Set(subgraphNodeIds)

  // Get all [nodeId, node] pairs from the graph
  const allNodeEntries: readonly (readonly [string, GraphNode])[] = Object.entries(graph.nodes)

  // Filter to only external nodes (not in subgraph, and not context nodes)
  // Context nodes are excluded because they're derived/temporary - we don't redirect their edges
  const externalNodes: readonly (readonly [string, GraphNode])[] = allNodeEntries.filter(
    ([nodeId, node]) => !subgraphNodeIdSet.has(nodeId) && !node.nodeUIMetadata.isContextNode
  )

  // For each external node, find edges that point into the subgraph
  const incomingEdges: readonly {
    readonly sourceNodeId: NodeIdAndFilePath
    readonly edge: Edge
  }[] = externalNodes.flatMap(([sourceNodeId, node]) =>
    node.outgoingEdges
      .filter((edge: Edge) => subgraphNodeIdSet.has(edge.targetId))
      .map((edge: Edge) => ({
        sourceNodeId,
        edge
      }))
  )

  return incomingEdges
}
