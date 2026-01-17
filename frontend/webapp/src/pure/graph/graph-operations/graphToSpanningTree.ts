/**
 * Converts a graph to a spanning tree rooted at the specified node.
 *
 * This function removes cycle-creating edges using DFS traversal,
 * ensuring the result is a proper tree (DAG) that can be safely traversed.
 *
 * The algorithm:
 * 1. Starts DFS from the root node
 * 2. Follows both outgoing and incoming edges bidirectionally
 * 3. Only keeps edges that don't create cycles (edges to unvisited nodes)
 * 4. Returns a new graph with same nodes but only tree-forming edges
 *
 * @param graph - The input graph (may contain cycles)
 * @param rootNodeId - The node to use as the tree root
 * @returns A new Graph with only tree edges (no cycles)
 *
 * @example
 * ```typescript
 * // Graph with cycle: A → B → C → A
 * const tree = graphToSpanningTree(cyclicGraph, 'A')
 * // Returns: A → B → C (edge C→A removed since A already visited)
 * ```
 */

import type { Graph, NodeIdAndFilePath, GraphNode, Edge } from '@/pure/graph'
import { createGraph, createEmptyGraph } from '@/pure/graph/createGraph'
import { getIncomingNodes } from '@/pure/graph/graph-operations/getIncomingNodes'
import { setOutgoingEdges } from '@/pure/graph/graph-operations/graph-edge-operations'

/**
 * Immutable state for DFS traversal
 */
interface TraversalState {
  readonly visited: ReadonlySet<NodeIdAndFilePath>
  readonly treeEdges: ReadonlyMap<NodeIdAndFilePath, readonly Edge[]>
}

/**
 * Creates a new state with the node marked as visited and edges initialized
 */
function markVisited(
  state: TraversalState,
  nodeId: NodeIdAndFilePath
): TraversalState {
  const newVisited: ReadonlySet<NodeIdAndFilePath> = new Set([...state.visited, nodeId])
  const newTreeEdges: ReadonlyMap<NodeIdAndFilePath, readonly Edge[]> = state.treeEdges.has(nodeId)
    ? state.treeEdges
    : new Map([...state.treeEdges, [nodeId, []]])
  return { visited: newVisited, treeEdges: newTreeEdges }
}

/**
 * Adds a tree edge from sourceId to targetId
 */
function addTreeEdge(
  state: TraversalState,
  sourceId: NodeIdAndFilePath,
  edge: Edge
): TraversalState {
  const currentEdges: readonly Edge[] = state.treeEdges.get(sourceId) ?? []
  const newTreeEdges: ReadonlyMap<NodeIdAndFilePath, readonly Edge[]> = new Map([
    ...state.treeEdges,
    [sourceId, [...currentEdges, edge]]
  ])
  return { visited: state.visited, treeEdges: newTreeEdges }
}

/**
 * DFS to build spanning tree using functional reduce pattern.
 * Only adds edges to unvisited nodes, preventing cycles.
 */
function buildTree(
  graph: Graph,
  nodeId: NodeIdAndFilePath,
  state: TraversalState
): TraversalState {
  if (state.visited.has(nodeId)) return state

  const node: GraphNode | undefined = graph.nodes[nodeId]
  if (!node) return state

  // Mark this node as visited
  const stateWithNode: TraversalState = markVisited(state, nodeId)

  // Process outgoing edges - add edge and recurse if target not visited
  // Note: We check visited state inside reduce (not filter) because earlier edges
  // in this same iteration may have already visited the target via a different path.
  const stateAfterOutgoing: TraversalState = node.outgoingEdges
    .filter(edge => graph.nodes[edge.targetId] !== undefined)
    .reduce<TraversalState>((currentState, edge) => {
      // Skip if target already visited (may have been visited by earlier edge in this reduce)
      if (currentState.visited.has(edge.targetId)) {
        return currentState
      }
      // Add edge before recursing (so child sees it's connected)
      const withEdge: TraversalState = addTreeEdge(currentState, nodeId, edge)
      return buildTree(graph, edge.targetId, withEdge)
    }, stateWithNode)

  // Process incoming edges (for bidirectional traversal)
  // Note: Same as outgoing - check visited state inside reduce for accuracy.
  const incomingNodes: readonly GraphNode[] = getIncomingNodes(node, graph)
  const finalState: TraversalState = incomingNodes
    .reduce<TraversalState>((currentState, parentNode) => {
      // Skip if parent already visited (may have been visited by earlier edge in this reduce)
      if (currentState.visited.has(parentNode.relativeFilePathIsID)) {
        return currentState
      }
      // Ensure parent has edges array initialized
      const withParentInit: TraversalState = currentState.treeEdges.has(parentNode.relativeFilePathIsID)
        ? currentState
        : { visited: currentState.visited, treeEdges: new Map([...currentState.treeEdges, [parentNode.relativeFilePathIsID, []]]) }
      // Add edge from parent to current node
      const withEdge: TraversalState = addTreeEdge(withParentInit, parentNode.relativeFilePathIsID, {
        targetId: nodeId,
        label: ''
      })
      return buildTree(graph, parentNode.relativeFilePathIsID, withEdge)
    }, stateAfterOutgoing)

  return finalState
}

export function graphToSpanningTree(
  graph: Graph,
  rootNodeId: NodeIdAndFilePath
): Graph {
  // If root doesn't exist, return empty graph
  if (!graph.nodes[rootNodeId]) {
    return createEmptyGraph()
  }

  // Initial state
  const initialState: TraversalState = {
    visited: new Set(),
    treeEdges: new Map()
  }

  // Build the spanning tree starting from root
  const finalState: TraversalState = buildTree(graph, rootNodeId, initialState)

  // Construct the result graph with only tree edges
  const resultNodes: Record<NodeIdAndFilePath, GraphNode> = Object.fromEntries(
    Array.from(finalState.visited)
      .map((nodeId): [NodeIdAndFilePath, GraphNode] | null => {
        const originalNode: GraphNode | undefined = graph.nodes[nodeId]
        if (!originalNode) return null
        const nodeTreeEdges: readonly Edge[] = finalState.treeEdges.get(nodeId) ?? []
        return [nodeId, setOutgoingEdges(originalNode, nodeTreeEdges)]
      })
      .filter((entry): entry is [NodeIdAndFilePath, GraphNode] => entry !== null)
  )

  return createGraph(resultNodes)
}

export type GraphToSpanningTree = typeof graphToSpanningTree
