import type {Graph, GraphDelta, GraphNode} from '@/pure/graph'
import { updateIndexForUpsert, updateIndexForDelete } from '@/pure/graph/graph-operations/incomingEdgesIndex'
import type { IncomingEdgesIndex } from '@/pure/graph/graph-operations/incomingEdgesIndex'
import {
  updateNodeByBaseNameIndexForUpsert,
  updateNodeByBaseNameIndexForDelete,
  updateUnresolvedLinksIndexForUpsert,
  updateUnresolvedLinksIndexForDelete
} from '@/pure/graph/graph-operations/linkResolutionIndexes'
import type { NodeByBaseNameIndex, UnresolvedLinksIndex } from '@/pure/graph/graph-operations/linkResolutionIndexes'
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
 * const graph: Graph = { nodes: { 'note1': {...} }, incomingEdgesIndex: new Map() }
 * const delta: GraphDelta = [{ type: 'UpsertNode', nodeToUpsert: {...} }]
 * const newGraph = applyGraphDeltaToGraph(graph, delta)
 * ```
 */
export function applyGraphDeltaToGraph(graph: Graph, delta: GraphDelta): Graph {
    // Process each node delta sequentially
    return delta.reduce<Graph>((currentGraph, nodeDelta) => {
        if (nodeDelta.type === 'UpsertNode') {
            // Upsert node: add new or update existing
            const existingNode: GraphNode | undefined = currentGraph.nodes[nodeDelta.nodeToUpsert.absoluteFilePathIsID]
            const newNode: GraphNode = nodeDelta.nodeToUpsert

            // Position preservation: positions are stored in .voicetree/positions.json, not YAML. //human
            // When FS events re-parse a node, the parsed node has no position (O.none).
            // This merge keeps the in-memory position (loaded from positions.json at startup).
            const mergedNode: GraphNode = (existingNode && O.isSome(existingNode.nodeUIMetadata.position) && O.isNone(newNode.nodeUIMetadata.position))
                ? { ...newNode, nodeUIMetadata: { ...newNode.nodeUIMetadata, position: existingNode.nodeUIMetadata.position } }
                : newNode

            const previousNode: O.Option<GraphNode> = existingNode ? O.some(existingNode) : O.none

            // Build new nodes record
            const newNodes: Record<string, GraphNode> = {
                ...currentGraph.nodes,
                [mergedNode.absoluteFilePathIsID]: mergedNode
            }

            // Update all indexes
            const newIncomingEdgesIndex: IncomingEdgesIndex = updateIndexForUpsert(currentGraph.incomingEdgesIndex, mergedNode, previousNode)
            const newNodeByBaseName: NodeByBaseNameIndex = updateNodeByBaseNameIndexForUpsert(currentGraph.nodeByBaseName, mergedNode, previousNode)
            const newUnresolvedLinksIndex: UnresolvedLinksIndex = updateUnresolvedLinksIndexForUpsert(currentGraph.unresolvedLinksIndex, mergedNode, previousNode, newNodes)

            return {
                nodes: newNodes,
                incomingEdgesIndex: newIncomingEdgesIndex,
                nodeByBaseName: newNodeByBaseName,
                unresolvedLinksIndex: newUnresolvedLinksIndex
            }
        } else if (nodeDelta.type === 'DeleteNode') {
            // Simple delete - just remove the node
            const { [nodeDelta.nodeId]: deletedNode, ...remaining } = currentGraph.nodes

            if (!deletedNode) {
                return currentGraph
            }

            // Update all indexes
            const newIncomingEdgesIndex: IncomingEdgesIndex = updateIndexForDelete(currentGraph.incomingEdgesIndex, deletedNode)
            const newNodeByBaseName: NodeByBaseNameIndex = updateNodeByBaseNameIndexForDelete(currentGraph.nodeByBaseName, deletedNode)
            const newUnresolvedLinksIndex: UnresolvedLinksIndex = updateUnresolvedLinksIndexForDelete(currentGraph.unresolvedLinksIndex, deletedNode, remaining)

            return {
                nodes: remaining,
                incomingEdgesIndex: newIncomingEdgesIndex,
                nodeByBaseName: newNodeByBaseName,
                unresolvedLinksIndex: newUnresolvedLinksIndex
            }
        }

        // Should never reach here due to TypeScript exhaustiveness checking
        return currentGraph
    }, graph)
}

// export default applyGraphDeltaToGraph
