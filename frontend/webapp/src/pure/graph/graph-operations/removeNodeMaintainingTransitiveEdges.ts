import type { Graph, GraphNode, NodeIdAndFilePath, Edge } from '@/pure/graph'
import { addOutgoingEdge } from '@/pure/graph/graph-operations/graph-edge-operations'

/**
 * Removes a node from the graph while preserving transitive connectivity.
 *
 * For any parent -> nodeToRemove -> children structure, this creates
 * parent -> children edges, preserving the parent's original edge label.
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

    // Remove the node from the graph
    const remainingNodes: { readonly [k: string]: GraphNode } = Object.fromEntries(
        Object.entries(graph.nodes).filter(([nodeId]) => nodeId !== nodeIdToRemove)
    )

    // For each remaining node, handle edge preservation:
    // 1. If node has edge to removed node, remove it and add edges to removed node's children
    // 2. Use the parent's original label for new edges
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

            // Add edges to all children of removed node, using parent's label
            // addOutgoingEdge handles duplicate prevention
            const nodeWithPreservedEdges: GraphNode = childrenOfRemovedNode.reduce(
                (accNode, childEdge) => addOutgoingEdge(accNode, childEdge.targetId, edgeToRemovedNode.label),
                nodeWithoutRemovedEdge
            )

            return [nodeId, nodeWithPreservedEdges]
        })
    )

    return { nodes: nodesWithPreservedEdges }
}
