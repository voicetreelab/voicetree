import type {Graph, GraphDelta, GraphNode} from '@/pure/graph'
import {removeOutgoingEdge} from '@/pure/graph/graph-operations/graph-edge-operations'
import * as O from 'fp-ts/lib/Option.js'

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
            const existingNode: GraphNode | undefined = currentGraph.nodes[nodeDelta.nodeToUpsert.relativeFilePathIsID]
            const newNode: GraphNode = nodeDelta.nodeToUpsert

            // TODO: This position-preservation logic is a workaround. It should be moved to a more
            // suitable location (e.g., dedicated position management layer) or replaced with better
            // overall position saving logic that writes positions to disk proactively.
            // See: saveNodePositions.test.ts "BUG DEMONSTRATION" for context.
            const mergedNode: GraphNode = (existingNode && O.isSome(existingNode.nodeUIMetadata.position) && O.isNone(newNode.nodeUIMetadata.position))
                ? { ...newNode, nodeUIMetadata: { ...newNode.nodeUIMetadata, position: existingNode.nodeUIMetadata.position } }
                : newNode

            return {
                nodes: {
                    ...currentGraph.nodes,
                    [mergedNode.relativeFilePathIsID]: mergedNode
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
