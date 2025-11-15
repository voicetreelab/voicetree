/**
 * Graph-level transformation functions.
 * These functions transform entire graphs, operating on all nodes at once.
 */

import type { Graph, GraphNode, NodeId } from '@/functional/pure/graph/types.ts'
import { setOutgoingEdges } from './graph-edge-operations.ts'

/**
 * Reverses all edges in a graph.
 * Each edge A -> B becomes B -> A.
 *
 * Returns a new graph (does not mutate).
 *
 * @example
 * Given graph: A -> B -> C
 * Result:      C -> B -> A
 */
export function reverseGraphEdges(graph: Graph): Graph {
    // Initialize with empty arrays for all existing nodes
    const initialIncomingEdgesMap = Object.keys(graph.nodes).reduce<Record<NodeId, readonly NodeId[]>>(
        (acc, nodeId) => ({ ...acc, [nodeId]: [] }),
        {}
    )

    // Compute incoming edges for all nodes by scanning all outgoing edges
    const incomingEdgesMap = Object.entries(graph.nodes).reduce<Record<NodeId, readonly NodeId[]>>(
        (acc, [sourceId, node]) => {
            // For each outgoing edge sourceId -> targetId, add sourceId to targetId's incoming edges
            return node.outgoingEdges.reduce(
                (innerAcc, targetId) => ({
                    ...innerAcc,
                    [targetId]: [...(innerAcc[targetId] || []), sourceId]
                }),
                acc
            )
        },
        initialIncomingEdgesMap
    )

    // Create new graph where outgoing edges are the previous incoming edges
    const newNodes = Object.entries(graph.nodes).reduce<Record<NodeId, GraphNode>>(
        (acc, [nodeId, node]) => {
            const newOutgoingEdges = incomingEdgesMap[nodeId] || []
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
