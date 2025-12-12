/**
 * Extracts a subgraph containing all nodes within a weighted distance threshold from a starting node.
 * Uses DFS traversal with different edge costs for outgoing vs incoming edges.
 */

import type { Graph, NodeIdAndFilePath, GraphNode, Edge } from '@/pure/graph'
import { getIncomingNodes } from '@/pure/graph/graph-operations/getIncomingNodes'
import { setOutgoingEdges } from '@/pure/graph/graph-operations/graph-edge-operations'

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
  startNodeId: NodeIdAndFilePath,
  maxDistance: number
): Graph {
  // Track which nodes we've processed to avoid cycles (separate from result set)
  const processed: Set<NodeIdAndFilePath> = new Set()

  // Recursive DFS implementation
  const dfsVisit: (nodeId: NodeIdAndFilePath, distance: number, visited: ReadonlySet<NodeIdAndFilePath>) => ReadonlySet<NodeIdAndFilePath> = (
    nodeId: NodeIdAndFilePath,
    distance: number,
    visited: ReadonlySet<NodeIdAndFilePath>
  ): ReadonlySet<NodeIdAndFilePath> => {
    // Base cases: stop if already processed or node doesn't exist
    if (processed.has(nodeId) || !graph.nodes[nodeId]) {
      return visited
    }

    // Mark as processed to avoid cycles
    processed.add(nodeId)

    const node: GraphNode = graph.nodes[nodeId]

    // Context nodes: traverse through them but don't include in result or add distance
    const isContextNode: boolean | undefined = node.nodeUIMetadata.isContextNode

    // Only add non-context nodes to visited set
    const newVisited: ReadonlySet<string> = isContextNode
      ? visited
      : new Set([...visited, nodeId])

    // For context nodes, don't add distance cost (pretend they don't exist)
    const childDistanceCost: number = isContextNode ? 0 : 1.5
    const parentDistanceCost: number = isContextNode ? 0 : 1.0

    // Explore outgoing edges (children) - only if within distance threshold
    const afterChildren: ReadonlySet<string> = node.outgoingEdges
      .filter(_edge => distance + childDistanceCost < maxDistance || isContextNode)
      .reduce<ReadonlySet<NodeIdAndFilePath>>(
        (acc, edge) => dfsVisit(edge.targetId, distance + childDistanceCost, acc),
        newVisited
      )

    // Explore incoming edges (parents) - only if within distance threshold
    const incomingNodes: readonly GraphNode[] = getIncomingNodes(node, graph)
    const afterParents: ReadonlySet<string> = incomingNodes
      .filter(() => distance + parentDistanceCost < maxDistance || isContextNode)
      .reduce<ReadonlySet<NodeIdAndFilePath>>(
        (acc, parentNode) => dfsVisit(parentNode.relativeFilePathIsID, distance + parentDistanceCost, acc),
        afterChildren
      )

    return afterParents
  }

  const visited: ReadonlySet<string> = dfsVisit(startNodeId, 0, new Set())

  // Filter graph to only visited nodes, and filter edges to only include
  // edges where both source and target are in the visited set
  const filteredNodes: { readonly [k: string]: GraphNode } = Object.fromEntries(
    Array.from(visited)
      .filter(id => graph.nodes[id])
      .map(id => {
        const node: GraphNode = graph.nodes[id]
        const filteredEdges: readonly Edge[] = node.outgoingEdges.filter(edge => visited.has(edge.targetId))
        return [id, setOutgoingEdges(node, filteredEdges)]
      })
  )

  return { nodes: filteredNodes }
}
