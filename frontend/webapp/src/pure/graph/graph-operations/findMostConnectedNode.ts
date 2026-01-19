import type { Graph, GraphNode, NodeIdAndFilePath } from '@/pure/graph'

/**
 * Count total edges (incoming + outgoing) for a node.
 */
function countEdgesForNode(nodeId: NodeIdAndFilePath, graph: Graph): number {
  const node: GraphNode | undefined = graph.nodes[nodeId]
  if (!node) {
    return 0
  }
  const outgoingCount: number = node.outgoingEdges.length
  const incomingCount: number = graph.incomingEdgesIndex.get(nodeId)?.length ?? 0
  return outgoingCount + incomingCount
}

interface NodeWithCount {
  readonly nodeId: NodeIdAndFilePath
  readonly edgeCount: number
}

/**
 * Find the most-connected node from a selection of nodes.
 *
 * Connection count = incoming edges + outgoing edges.
 * Ties are broken by selection order (first selected wins).
 *
 * @param nodeIds - Array of node IDs to consider (in selection order)
 * @param graph - The graph containing the nodes
 * @returns The node ID with the highest connection count, or empty string if empty input
 */
export function findMostConnectedNode(
  nodeIds: readonly NodeIdAndFilePath[],
  graph: Graph
): NodeIdAndFilePath {
  // Handle empty case by returning empty string (caller should validate)
  if (nodeIds.length === 0) {
    return '' as NodeIdAndFilePath
  }

  // Find node with max edge count, preserving selection order for ties
  // Using reduce to find max while maintaining functional style
  const result: NodeWithCount = nodeIds.reduce<NodeWithCount>(
    (best: NodeWithCount, nodeId: NodeIdAndFilePath): NodeWithCount => {
      const edgeCount: number = countEdgesForNode(nodeId, graph)
      // Only replace if strictly greater (preserves selection order for ties)
      return edgeCount > best.edgeCount ? { nodeId, edgeCount } : best
    },
    { nodeId: nodeIds[0], edgeCount: countEdgesForNode(nodeIds[0], graph) }
  )

  return result.nodeId
}
