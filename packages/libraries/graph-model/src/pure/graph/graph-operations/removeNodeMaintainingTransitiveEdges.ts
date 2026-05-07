import type { Graph, GraphNode, NodeIdAndFilePath, GraphDelta, NodeDelta } from '..'
import * as O from 'fp-ts/lib/Option.js'

/**
 * Creates a GraphDelta for removing a node.
 * Deletes the node and removes edges from parent nodes that pointed to it.
 * Children and their edges are left untouched (they become disconnected).
 *
 * Pure function: same input -> same output, no side effects.
 *
 * @param graph - The current graph
 * @param nodeIdToRemove - ID of the node to remove
 * @returns GraphDelta containing DeleteNode + UpsertNode for each parent with cleaned-up edges
 */
export function deleteNodeSimple(
    graph: Graph,
    nodeIdToRemove: NodeIdAndFilePath
): GraphDelta {
    const nodeToRemove: GraphNode | undefined = graph.nodes[nodeIdToRemove]

    if (!nodeToRemove) {
        return []
    }

    const deleteNodeDelta: NodeDelta = { type: 'DeleteNode', nodeId: nodeIdToRemove, deletedNode: O.some(nodeToRemove) }

    // Find all parent nodes that point to the removed node and remove their edges
    const incomerIds: readonly NodeIdAndFilePath[] = graph.incomingEdgesIndex.get(nodeIdToRemove) ?? []
    const upsertDeltas: readonly NodeDelta[] = incomerIds
        .filter(nodeId => graph.nodes[nodeId])
        .map(nodeId => {
            const node: GraphNode = graph.nodes[nodeId]
            return {
                type: 'UpsertNode' as const,
                nodeToUpsert: {
                    ...node,
                    outgoingEdges: node.outgoingEdges.filter(e => e.targetId !== nodeIdToRemove)
                },
                previousNode: O.some(node)
            }
        })

    return [deleteNodeDelta, ...upsertDeltas]
}
