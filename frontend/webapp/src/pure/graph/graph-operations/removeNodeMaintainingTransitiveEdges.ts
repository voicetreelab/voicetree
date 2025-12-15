import type { Graph, GraphNode, NodeIdAndFilePath, Edge } from '@/pure/graph'
import { addOutgoingEdge } from '@/pure/graph/graph-operations/graph-edge-operations'

/**
 * Removes a node from the graph while preserving transitive connectivity.
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
 * @returns New graph with node removed and transitive edges preserved
 *
 * @example
 * // Given: a -> b -> c
 * // removeNodeMaintainingTransitiveEdges(graph, 'b')
 * // Result: a -> c (with a's original label)
 *
 * @example
 * // Given: a -> x, b -> x (fan-in to sink node x)
 * // removeNodeMaintainingTransitiveEdges(graph, 'x')
 * // Result: a -> b, b -> a (incomers connected to each other)
 */
export function removeNodeMaintainingTransitiveEdges(
    graph: Graph,
    nodeIdToRemove: NodeIdAndFilePath
): Graph {
    const nodeToRemove: GraphNode | undefined = graph.nodes[nodeIdToRemove]

    if (!nodeToRemove) {
        return graph
    }

    const childrenOfRemovedNode: readonly Edge[] = nodeToRemove.outgoingEdges

    // Find all nodes that point to the removed node (incomers)
    const incomers: readonly { readonly nodeId: NodeIdAndFilePath; readonly edge: Edge }[] =
        Object.entries(graph.nodes)
            .filter(([nodeId]) => nodeId !== nodeIdToRemove)
            .map(([nodeId, node]) => ({
                nodeId,
                edge: node.outgoingEdges.find(e => e.targetId === nodeIdToRemove)
            }))
            .filter((entry): entry is { readonly nodeId: NodeIdAndFilePath; readonly edge: Edge } =>
                entry.edge !== undefined
            )

    const incomerNodeIds: readonly NodeIdAndFilePath[] = incomers.map(i => i.nodeId)

    // Remove the node from the graph
    const remainingNodes: { readonly [k: string]: GraphNode } = Object.fromEntries(
        Object.entries(graph.nodes).filter(([nodeId]) => nodeId !== nodeIdToRemove)
    )

    // For each remaining node, handle edge preservation:
    // 1. If node has edge to removed node, remove it
    // 2. Add edges to removed node's children (preserves outgoing paths)
    // 3. Add edges to all other incomers (preserves fan-in reachability)
    const nodesWithPreservedEdges: { readonly [k: string]: GraphNode } = Object.fromEntries(
        Object.entries(remainingNodes).map(([nodeId, node]) => {
            const edgeToRemovedNode: Edge | undefined = node.outgoingEdges.find(
                e => e.targetId === nodeIdToRemove
            )

            if (!edgeToRemovedNode) {
                return [nodeId, node]
            }

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
            const otherIncomers: readonly NodeIdAndFilePath[] = incomerNodeIds.filter(id => id !== nodeId)
            const nodeWithIncomerEdges: GraphNode = otherIncomers.reduce(
                (accNode, incomerNodeId) => addOutgoingEdge(accNode, incomerNodeId, edgeToRemovedNode.label),
                nodeWithChildEdges
            )

            return [nodeId, nodeWithIncomerEdges]
        })
    )

    return { nodes: nodesWithPreservedEdges }
}
