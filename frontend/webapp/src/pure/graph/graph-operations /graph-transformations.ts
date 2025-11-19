/**
 * Graph-level transformation functions.
 * These functions transform entire graphs, operating on all nodes at once.
 */

import type { Graph, GraphNode, NodeId } from '@/pure/graph'
import { setOutgoingEdges } from './graph-edge-operations.ts'

/**
 * Reverses all edges in a graph.
 * Each edge A -> B with label "foo" becomes B -> A with the same label "foo".
 *
 * Returns a new graph (does not mutate).
 *
 * IMPORTANT: Edge labels are preserved during reversal. The reversed edge
 * keeps the same label as the original edge (it doesn't make semantic sense
 * to reverse the label meaning, since labels describe the forward relationship).
 *
 * @example
 * Given graph: A --("extends")--> B --("implements")--> C
 * Result:      C --("implements")--> B --("extends")--> A
 */
export function reverseGraphEdges(graph: Graph): Graph {
    // Build map of incoming edges with their labels preserved
    // Map: targetId -> Array<{ sourceId, label }>
    type IncomingEdge = { readonly sourceId: NodeId; readonly label: string }
    const initialIncomingEdgesMap = Object.keys(graph.nodes).reduce<Record<NodeId, readonly IncomingEdge[]>>(
        (acc, nodeId) => ({ ...acc, [nodeId]: [] }),
        {}
    )

    // Compute incoming edges for all nodes by scanning all outgoing edges
    const incomingEdgesMap = Object.entries(graph.nodes).reduce<Record<NodeId, readonly IncomingEdge[]>>(
        (acc, [sourceId, node]) => {
            // For each outgoing edge sourceId -> targetId with label,
            // add {sourceId, label} to targetId's incoming edges
            return node.outgoingEdges.reduce(
                (innerAcc, edge) => ({
                    ...innerAcc,
                    [edge.targetId]: [...(innerAcc[edge.targetId] || []), { sourceId, label: edge.label }]
                }),
                acc
            )
        },
        initialIncomingEdgesMap
    )

    // Create new graph where outgoing edges are the previous incoming edges (with labels preserved)
    const newNodes = Object.entries(graph.nodes).reduce<Record<NodeId, GraphNode>>(
        (acc, [nodeId, node]) => {
            const incomingEdges = incomingEdgesMap[nodeId] || []
            const newOutgoingEdges = incomingEdges.map(({ sourceId, label }) => ({
                targetId: sourceId,
                label  // Preserve the label from the original edge
            }))
            return {
                ...acc,
                [nodeId]: setOutgoingEdges(node, newOutgoingEdges)
            }
        },
        {}
    )

    return {
        nodes: newNodes
    }
}
