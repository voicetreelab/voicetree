import type {Graph, GraphDelta, GraphNode} from '@/pure/graph'
import {removeOutgoingEdge} from '@/pure/graph/graph-operations/graph-edge-operations'

/**
 * Apply a GraphDelta to a Graph, producing a new Graph.
 *
 * Pure function: same input -> same output, no side effects
 *
 * Handles:
 * - UpsertNode: Creates new node or updates existing node
 * - DeleteNode: Removes node and cleans up edges pointing to it
 *
 * @param graph - The current graph state
 * @param delta - The delta to apply
 * @returns A new Graph with the delta applied
 *
 * @example
 * ```typescript
 * const graph: Graph = { nodes: { 'note1': {...} } }
 * const delta: GraphDelta = [{ type: 'UpsertNode', nodeToUpsert: {...} }]
 * const newGraph = applyGraphDeltaToGraph(graph, delta)
 * ```
 */
export function applyGraphDeltaToGraph(graph: Graph, delta: GraphDelta): Graph {
    // Process each node delta sequentially
    return delta.reduce((currentGraph, nodeDelta) => {
        if (nodeDelta.type === 'UpsertNode') {
            // Upsert node: add new or update existing
            return {
                nodes: {
                    ...currentGraph.nodes,
                    [nodeDelta.nodeToUpsert.relativeFilePathIsID]: nodeDelta.nodeToUpsert
                }
            }
        } else if (nodeDelta.type === 'DeleteNode') {
            // Delete node: remove from nodes and clean up edges
            const remainingNodes: { readonly [k: string]: GraphNode; } = Object.fromEntries(
                Object.entries(currentGraph.nodes).filter(([nodeId]) => nodeId !== nodeDelta.nodeId)
            )

            // Remove any edges pointing to the deleted node from remaining nodes
            const nodesWithCleanedEdges: { readonly [k: string]: GraphNode; } = Object.fromEntries(
                Object.entries(remainingNodes).map(([nodeId, node]) => {
                    // Filter out edges pointing to deleted node
                    const cleanedNode: GraphNode = removeOutgoingEdge(node, nodeDelta.nodeId)
                    return [nodeId, cleanedNode]
                })
            )

            return {
                nodes: nodesWithCleanedEdges
            }
        }

        // Should never reach here due to TypeScript exhaustiveness checking
        return currentGraph
    }, graph)
}

// export default applyGraphDeltaToGraph
