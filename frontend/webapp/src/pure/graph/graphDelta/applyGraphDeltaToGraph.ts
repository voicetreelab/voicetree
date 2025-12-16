import type {Graph, GraphDelta, GraphNode} from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

/**
 * Apply a GraphDelta to a Graph, producing a new Graph.
 *
 * Pure function: same input -> same output, no side effects
 *
 * Handles:
 * - UpsertNode: Creates new node or updates existing node
 * - DeleteNode: Simply removes the node from the graph
 *
 * Note: Transitive edge maintenance is handled at the edge layer in
 * applyGraphDeltaToDBThroughMemAndUI, which expands DeleteNode deltas
 * using deleteNodeMaintainingTransitiveEdges before calling this function.
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
            // Simple delete - just remove the node
            const { [nodeDelta.nodeId]: _, ...remaining } = currentGraph.nodes
            return { nodes: remaining }
        }

        // Should never reach here due to TypeScript exhaustiveness checking
        return currentGraph
    }, graph)
}

// export default applyGraphDeltaToGraph
