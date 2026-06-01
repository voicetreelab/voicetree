/**
 * Extracts a subgraph containing all nodes within a weighted distance threshold from a starting node.
 * Uses DFS traversal with different edge costs for outgoing vs incoming edges.
 */

import type { Graph, NodeIdAndFilePath, GraphNode, Edge } from '../..'
import { getIncomingNodes } from '../indexes/getIncomingNodes'
import { setOutgoingEdges } from '../transforms/graph-edge-operations'
import { removeContextNodes } from '../transforms/removeContextNodes'
import { createEmptyGraph, createGraph } from '../graphOperationPrimitives'

/**
 * Performs weighted DFS to find all nodes within maxDistance from startNodeId.
 *
 * Distance costs:
 * - Outgoing edges (following children): 1.5
 * - Incoming edges (following parents): 1.0
 *
 * Context nodes are pre-transformed out of the graph before traversal:
 * - Context nodes are removed while preserving transitive edges
 * - A -> ContextNode -> B becomes A -> B
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
  // Step 1: Pre-transform - remove all context nodes with transitive edge preservation
  const cleanGraph: Graph = removeContextNodes(graph)

  // If start node was a context node, it won't be in cleanGraph
  if (!cleanGraph.nodes[startNodeId]) {
    // Try to find children of the original start node if it was a context node
    const originalNode: GraphNode | undefined = graph.nodes[startNodeId]
    if (!originalNode) {
      return createEmptyGraph()
    }
    // If start was a context node, traverse from its non-context children
    if (originalNode.nodeUIMetadata.isContextNode) {
      const childResults: readonly Graph[] = originalNode.outgoingEdges
        .filter(edge => cleanGraph.nodes[edge.targetId])
        .map(edge => getSubgraphByDistance(graph, edge.targetId, maxDistance))
      return mergeGraphs(childResults)
    }
    return createEmptyGraph()
  }

  // Step 2: Simple DFS on the clean graph (no context node logic needed)
  const visited: ReadonlySet<NodeIdAndFilePath> = dfsTraversal(cleanGraph, startNodeId, maxDistance)

  // Step 3: Build result graph with filtered edges
  const filteredNodes: Record<NodeIdAndFilePath, GraphNode> = Object.fromEntries(
    Array.from(visited)
      .filter(id => cleanGraph.nodes[id])
      .map(id => {
        const node: GraphNode = cleanGraph.nodes[id]
        const filteredEdges: readonly Edge[] = node.outgoingEdges.filter(
          edge => visited.has(edge.targetId)
        )
        return [id, setOutgoingEdges(node, filteredEdges)]
      })
  )

  return createGraph(filteredNodes)
}

/**
 * Pure DFS traversal without context node handling.
 *
 * `visited` is both the cycle/duplicate guard and the result: every node added is exactly
 * the set returned. Accumulating into a single mutable Set keeps this O(V); the previous
 * implementation threaded an immutable set and rebuilt it (`new Set([...visited, id])`) on
 * every visit, which is O(V^2). DFS order and the first-reach distance semantics are
 * unchanged — the per-edge `distance + cost < maxDistance` filter was constant across a
 * node's edges, so it is equivalent to a single guard around each edge group.
 */
function dfsTraversal(
  graph: Graph,
  startNodeId: NodeIdAndFilePath,
  maxDistance: number
): ReadonlySet<NodeIdAndFilePath> {
  const visited: Set<NodeIdAndFilePath> = new Set()

  const dfsVisit = (nodeId: NodeIdAndFilePath, distance: number): void => {
    if (visited.has(nodeId) || !graph.nodes[nodeId]) {
      return
    }

    visited.add(nodeId)
    const node: GraphNode = graph.nodes[nodeId]

    // Explore outgoing edges (children) with cost 1.5
    if (distance + 1.5 < maxDistance) {
      node.outgoingEdges.forEach(edge => dfsVisit(edge.targetId, distance + 1.5))
    }

    // Explore incoming edges (parents) with cost 1.0
    if (distance + 1.0 < maxDistance) {
      getIncomingNodes(node, graph).forEach(parentNode =>
        dfsVisit(parentNode.absoluteFilePathIsID, distance + 1.0)
      )
    }
  }

  dfsVisit(startNodeId, 0)
  return visited
}

/**
 * Merge multiple graphs into one, preserving all edges.
 */
function mergeGraphs(graphs: readonly Graph[]): Graph {
  const allNodeIds: Set<NodeIdAndFilePath> = new Set()
  graphs.forEach(g => Object.keys(g.nodes).forEach(id => allNodeIds.add(id)))

  const mergedNodes: Record<NodeIdAndFilePath, GraphNode> = Object.fromEntries(
    Array.from(allNodeIds).map(id => {
      // Find the first graph that has this node
      const sourceGraph: Graph = graphs.find(g => g.nodes[id])!
      const node: GraphNode = sourceGraph.nodes[id]
      const filteredEdges: readonly Edge[] = node.outgoingEdges.filter(
        edge => allNodeIds.has(edge.targetId)
      )
      return [id, setOutgoingEdges(node, filteredEdges)]
    })
  )

  return createGraph(mergedNodes)
}

/**
 * Get union of subgraphs from multiple starting nodes.
 * Used for Ask Mode to gather context from all relevant search results.
 *
 * @param graph - The complete graph to search
 * @param startNodeIds - Array of node IDs to start traversal from
 * @param maxDistance - Maximum distance threshold for each traversal
 * @returns Merged graph containing nodes within distance of any starting node
 */
export function getUnionSubgraphByDistance(
  graph: Graph,
  startNodeIds: readonly NodeIdAndFilePath[],
  maxDistance: number
): Graph {
  const subgraphs: readonly Graph[] = startNodeIds
    .filter(id => graph.nodes[id])
    .map(id => getSubgraphByDistance(graph, id, maxDistance))

  return mergeGraphs(subgraphs)
}
