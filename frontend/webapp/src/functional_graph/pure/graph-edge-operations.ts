/**
 * Centralized edge manipulation functions for GraphNode.
 *
 * All modifications to node.outgoingEdges should go through these functions.
 * This makes future optimization (e.g., maintaining an incoming edges index) trivial.
 *
 * See: PARENT_LOOKUP_OPTIMIZATION_HANDOVER.md
 */

import type { GraphNode, NodeId } from './types'

/**
 * Adds a single outgoing edge to a node.
 * Returns a new node with the edge added (does not mutate).
 */
export function addOutgoingEdge(node: GraphNode, targetId: NodeId): GraphNode {
    // Avoid duplicates
    if (node.outgoingEdges.includes(targetId)) {
        return node
    }

    return {
        ...node,
        outgoingEdges: [...node.outgoingEdges, targetId]
    }
}

/**
 * Removes a single outgoing edge from a node.
 * Returns a new node with the edge removed (does not mutate).
 */
export function removeOutgoingEdge(node: GraphNode, targetId: NodeId): GraphNode {
    return {
        ...node,
        outgoingEdges: node.outgoingEdges.filter(id => id !== targetId)
    }
}

/**
 * Removes multiple outgoing edges from a node.
 * Returns a new node with the edges removed (does not mutate).
 */
export function removeOutgoingEdges(node: GraphNode, targetIds: readonly NodeId[]): GraphNode {
    const targetSet = new Set(targetIds)
    return {
        ...node,
        outgoingEdges: node.outgoingEdges.filter(id => !targetSet.has(id))
    }
}

/**
 * Replaces all outgoing edges with a new set.
 * Returns a new node with edges replaced (does not mutate).
 *
 * Use this when:
 * - Loading from disk (parsing wikilinks)
 * - Updating from file system changes (re-parsing content)
 */
export function setOutgoingEdges(node: GraphNode, edges: readonly NodeId[]): GraphNode {
    return {
        ...node,
        outgoingEdges: edges
    }
}
