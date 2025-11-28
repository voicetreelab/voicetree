import type { GraphNode, NodeIdAndFilePath, Edge } from '@/pure/graph'

/**
 * Redirects edges in a node from oldTargetId to newTargetId.
 * Returns a new node with updated edges (immutable operation).
 *
 * @param node - The GraphNode to update
 * @param oldTargetId - The target ID to replace
 * @param newTargetId - The new target ID
 * @returns A new GraphNode with redirected edges
 */
export function redirectEdgeTarget(
  node: GraphNode,
  oldTargetId: NodeIdAndFilePath,
  newTargetId: NodeIdAndFilePath
): GraphNode {
  const updatedEdges: readonly Edge[] = node.outgoingEdges.map((edge): Edge => {
    if (edge.targetId === oldTargetId) {
      return {
        targetId: newTargetId,
        label: edge.label
      }
    }
    return edge
  })

  return {
    ...node,
    outgoingEdges: updatedEdges
  }
}
