/**
 * Pure function to extract node IDs in depth-first traversal order.
 *
 * This function provides the canonical traversal order used by graphToAscii,
 * ensuring consistent ordering across different graph operations.
 *
 * The traversal:
 * 1. Finds root nodes (nodes with no incoming edges)
 * 2. Performs depth-first traversal from each root
 * 3. Uses a visited set to handle cycles and shared descendants
 *
 * @param graph - The graph to traverse
 * @returns Array of NodeIds in depth-first traversal order
 *
 * @example
 * ```typescript
 * const graph = { nodes: { A: ..., B: ..., C: ... } }
 * const orderedIds = getNodeIdsInTraversalOrder(graph)
 * // orderedIds = ['A', 'B', 'C'] in tree traversal order
 * ```
 */

import type { Graph, NodeId } from '@/pure/graph'
import { reverseGraphEdges } from '../graph-transformations.ts'

export function getNodeIdsInTraversalOrder(graph: Graph): NodeId[] {
  const nodeIds: NodeId[] = []
  const visited = new Set<NodeId>()

  // Find root nodes (nodes with no incoming edges)
  // We reverse the graph to identify which nodes have no incoming edges
  const reversedGraph = reverseGraphEdges(graph)
  const roots = Object.keys(graph.nodes).filter(nodeId => {
    const reversedNode = reversedGraph.nodes[nodeId]
    return !reversedNode || reversedNode.outgoingEdges.length === 0
  })

  /**
   * Recursive depth-first traversal
   * Matches the traversal order of graphToAscii
   */
  function traverse(nodeId: NodeId): void {
    if (visited.has(nodeId)) return
    visited.add(nodeId)

    const node = graph.nodes[nodeId]
    if (!node) return // Safety check for missing nodes

    // Add to result list
    nodeIds.push(nodeId)

    // Traverse children in order
    const children = node.outgoingEdges.map(e => e.targetId)
    children.forEach(childId => traverse(childId))
  }

  // Traverse from all root nodes
  roots.forEach(rootId => traverse(rootId))

  return nodeIds
}

export type GetNodeIdsInTraversalOrder = typeof getNodeIdsInTraversalOrder
