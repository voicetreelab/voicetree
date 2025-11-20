/**
 * Extracts a subgraph containing all nodes within a weighted distance threshold from a starting node.
 * Uses DFS traversal with different edge costs for outgoing vs incoming edges.
 */

import type { Graph, NodeId } from '@/pure/graph'
import { getIncomingNodes } from './getIncomingNodes.ts'
import { setOutgoingEdges } from './graph-edge-operations.ts'

/**
 * Performs weighted DFS to find all nodes within maxDistance from startNodeId.
 *
 * Distance costs:
 * - Outgoing edges (following children): 1.5
 * - Incoming edges (following parents): 1.0
 *
 * Returns a new graph containing only the nodes and edges within the distance threshold.
 * Edges are filtered so both source and target must be in the result set.
 *
 * @param graph - The complete graph to search
 * @param startNodeId - The node ID to start DFS from
 * @param maxDistance - Maximum distance threshold (exclusive)
 * @returns Filtered graph containing only nodes within distance
 *
 * @example
 * const subgraph = getSubgraphByDistance(fullGraph, 'node-5', 7)
 * // Returns graph with all nodes distance < 7 from 'node-5'
 */
export function getSubgraphByDistance(
  graph: Graph,
  startNodeId: NodeId,
  maxDistance: number
): Graph {
  // Recursive DFS implementation
  const dfsVisit = (
    nodeId: NodeId,
    distance: number,
    visited: ReadonlySet<NodeId>
  ): ReadonlySet<NodeId> => {
    // Base cases: stop if already visited or node doesn't exist
    if (visited.has(nodeId) || !graph.nodes[nodeId]) {
      return visited
    }

    // Add current node to visited set
    const newVisited = new Set([...visited, nodeId])
    const node = graph.nodes[nodeId]

    // Explore outgoing edges (children, cost 1.5) - only if within distance threshold
    const afterChildren = node.outgoingEdges
      .filter(_edge => distance + 1.5 < maxDistance)
      .reduce<ReadonlySet<NodeId>>(
        (acc, edge) => dfsVisit(edge.targetId, distance + 1.5, acc),
        newVisited
      )

    // Explore incoming edges (parents, cost 1.0) - only if within distance threshold
    const incomingNodes = getIncomingNodes(node, graph)
    const afterParents = incomingNodes
      .filter(() => distance + 1.0 < maxDistance)
      .reduce<ReadonlySet<NodeId>>(
        (acc, parentNode) => dfsVisit(parentNode.relativeFilePathIsID, distance + 1.0, acc),
        afterChildren
      )

    return afterParents
  }

  const visited = dfsVisit(startNodeId, 0, new Set())

  // Filter graph to only visited nodes, and filter edges to only include
  // edges where both source and target are in the visited set
  const filteredNodes = Object.fromEntries(
    Array.from(visited)
      .filter(id => graph.nodes[id])
      .map(id => {
        const node = graph.nodes[id]
        const filteredEdges = node.outgoingEdges.filter(edge => visited.has(edge.targetId))
        return [id, setOutgoingEdges(node, filteredEdges)]
      })
  )

  return { nodes: filteredNodes }
}
