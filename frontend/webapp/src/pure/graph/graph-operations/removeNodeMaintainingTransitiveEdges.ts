import type { Graph, GraphNode, NodeIdAndFilePath, Edge, GraphDelta, NodeDelta } from '@/pure/graph'
import { addOutgoingEdge } from '@/pure/graph/graph-operations/graph-edge-operations'
import * as O from 'fp-ts/lib/Option.js'

/**
 * Creates a GraphDelta for removing a node while preserving transitive connectivity.
 *
 * Preserves two types of connectivity:
 * 1. Outgoing paths: parent -> nodeToRemove -> children becomes parent -> children
 * 2. Fan-in reachability: For bidirectional traversal, nodes pointing to the same
 *    removed node can reach each other. After removal, incomers are connected to
 *    each other to preserve this reachability.
 *
 * Pure function: same input -> same output, no side effects.
 *
 * @param graph - The current graph
 * @param nodeIdToRemove - ID of the node to remove
 * @returns GraphDelta containing DeleteNode + UpsertNode for each modified incomer
 *
 * @example
 * // Given: a -> b -> c
 * // deleteNodeMaintainingTransitiveEdges(graph, 'b')
 * // Result: Delta with delete of b, upsert of a with edge to c
 *
 * @example
 * // Given: a -> x, b -> x (fan-in to sink node x)
 * // deleteNodeMaintainingTransitiveEdges(graph, 'x')
 * // Result: Delta with delete of x, upserts of a and b with edges to each other
 */
export function deleteNodeMaintainingTransitiveEdges(
    graph: Graph,
    nodeIdToRemove: NodeIdAndFilePath
): GraphDelta {
    const nodeToRemove: GraphNode | undefined = graph.nodes[nodeIdToRemove]

    if (!nodeToRemove) {
        return []
    }

    const childrenOfRemovedNode: readonly Edge[] = nodeToRemove.outgoingEdges

    // Find all nodes that point to the removed node (incomers)
    // Use incomingEdgesIndex for O(k) lookup instead of O(n) full graph scan
    const incomerIds: readonly NodeIdAndFilePath[] = graph.incomingEdgesIndex.get(nodeIdToRemove) ?? []
    const incomers: readonly { readonly nodeId: NodeIdAndFilePath; readonly edge: Edge }[] =
        incomerIds
            .filter(nodeId => graph.nodes[nodeId]) // Safety: ensure node exists
            .map(nodeId => {
                const node: GraphNode = graph.nodes[nodeId]
                const edge: Edge | undefined = node.outgoingEdges.find(e => e.targetId === nodeIdToRemove)
                return { nodeId, edge }
            })
            .filter((entry): entry is { readonly nodeId: NodeIdAndFilePath; readonly edge: Edge } =>
                entry.edge !== undefined
            )

    const incomerNodeIds: readonly NodeIdAndFilePath[] = incomers.map(i => i.nodeId)

    // Build the delta: DeleteNode followed by UpsertNode for each modified incomer
    const deleteNodeDelta: NodeDelta = { type: 'DeleteNode', nodeId: nodeIdToRemove, deletedNode: O.some(nodeToRemove) }

    // For each incomer, compute the modified node
    const upsertDeltas: readonly NodeDelta[] = incomers.map(incomer => {
        const node: GraphNode = graph.nodes[incomer.nodeId]
        const edgeToRemovedNode: Edge = incomer.edge

        // Remove the edge to the removed node
        const nodeWithoutRemovedEdge: GraphNode = {
            ...node,
            outgoingEdges: node.outgoingEdges.filter(e => e.targetId !== nodeIdToRemove)
        }

        // Add edges to all children of removed node, using this node's label
        // addOutgoingEdge handles duplicate prevention
        const nodeWithChildEdges: GraphNode = childrenOfRemovedNode.reduce(
            (accNode, childEdge) => addOutgoingEdge(accNode, childEdge.targetId, edgeToRemovedNode.label),
            nodeWithoutRemovedEdge
        )

        // Add edges to all OTHER incomers (preserves fan-in reachability for bidirectional traversal)
        const otherIncomers: readonly NodeIdAndFilePath[] = incomerNodeIds.filter(id => id !== incomer.nodeId)
        const modifiedNode: GraphNode = otherIncomers.reduce(
            (accNode, incomerNodeId) => addOutgoingEdge(accNode, incomerNodeId, edgeToRemovedNode.label),
            nodeWithChildEdges
        )

        return {
            type: 'UpsertNode' as const,
            nodeToUpsert: modifiedNode,
            previousNode: O.some(node)
        }
    })

    return [deleteNodeDelta, ...upsertDeltas]
}
